import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { conflict, notFound, unprocessable } from '../../common/errors';
import { GRADE_TITLES, getSpecialization } from '../../domain/catalog/catalog';
import { MAX_ACTIVE_TASKS_PER_COMPANY, validateTaskContent } from '../../domain/tasks/rules';
import type { Company, Grade, Prisma, ShortTask, ShortTaskKind, ShortTaskStatus, TaskVerdict } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateTaskDto, ReviewSubmissionDto, TaskSubmissionsQueryDto, UpdateTaskDto } from './dto/task.dto';

export const TASK_KIND_TEXT: Record<ShortTaskKind, string> = {
  QUIZ: 'Тест с одним верным ответом',
  APPROACH: 'Короткий разбор (текст)',
};
export const TASK_STATUS_TEXT: Record<ShortTaskStatus, string> = { DRAFT: 'Черновик', ACTIVE: 'Активно', CLOSED: 'Закрыто' };
export const VERDICT_TEXT: Record<TaskVerdict, string> = { STRONG: 'Сильный ответ', ACCEPTABLE: 'Приемлемо', WEAK: 'Слабый ответ' };

type SubmissionRow = Prisma.TaskAssignmentGetPayload<{ include: { candidate: { select: { alias: true } } } }>;

interface TaskCounts {
  offered: number;
  submitted: number;
  pendingReview: number;
}

/**
 * Короткие задания работодателя: черновик → активно → закрыто. Опубликованное задание не редактируется, чтобы все ответы
 * оценивались по одному и тому же условию. Автор видит ответы кандидатов под псевдонимом и подтверждённым грейдом —
 * без ФИО и контактов: раскрытие по-прежнему только через приглашение или отклик.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async create(company: Company, userId: string, dto: CreateTaskDto, requestId: string) {
    const content = this.contentOf(dto);
    const deadlineAt = this.parseDeadline(dto.deadlineAt);
    const publish = dto.publish === true;
    if (publish) await this.assertCanActivate(company.id, deadlineAt);
    const now = this.clock.now();
    const task = await this.prisma.shortTask.create({
      data: {
        companyId: company.id,
        title: dto.title.trim(),
        prompt: dto.prompt.trim(),
        specializationCode: dto.specialization,
        allowedGrades: (dto.allowedGrades ?? []) as Grade[],
        kind: dto.kind,
        options: content.options,
        correctIndex: content.correctIndex,
        explanation: dto.explanation?.trim() || null,
        deadlineAt,
        status: publish ? 'ACTIVE' : 'DRAFT',
        publishedAt: publish ? now : null,
      },
    });
    await this.audit.record({ actorUserId: userId, action: 'task.created', objectType: 'ShortTask', objectId: task.id, requestId, metadata: { published: publish, kind: task.kind } });
    return this.employerView(company, task.id);
  }

  async list(company: Company, status?: string) {
    const tasks = await this.prisma.shortTask.findMany({
      where: { companyId: company.id, ...(status ? { status: status as ShortTaskStatus } : {}) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    const counts = await this.counts(tasks.map((task) => task.id));
    return tasks.map((task) => this.view(task, counts.get(task.id)));
  }

  /** Задание своей компании; чужое — 404 (как несуществующее). */
  async getOwn(company: Company, taskId: string): Promise<ShortTask> {
    const task = await this.prisma.shortTask.findFirst({ where: { id: taskId, companyId: company.id } });
    if (!task) throw notFound('TASK_NOT_FOUND', 'Задание не найдено');
    return task;
  }

  async employerView(company: Company, taskId: string) {
    const task = await this.getOwn(company, taskId);
    const counts = await this.counts([task.id]);
    return this.view(task, counts.get(task.id));
  }

  async update(company: Company, userId: string, taskId: string, dto: UpdateTaskDto, requestId: string) {
    const current = await this.getOwn(company, taskId);
    if (current.status !== 'DRAFT') {
      throw conflict('TASK_NOT_EDITABLE', 'Опубликованное задание не редактируется: ответы оцениваются по одному условию. Создайте новое задание.');
    }
    const kind = dto.kind ?? current.kind;
    const merged = this.contentOf({
      kind,
      // При смене вида на APPROACH варианты и верный ответ сбрасываются; при смене на QUIZ их нужно передать явно.
      options: dto.options ?? (kind === current.kind ? current.options : []),
      correctIndex: dto.correctIndex !== undefined ? dto.correctIndex : kind === current.kind ? current.correctIndex ?? undefined : undefined,
    });
    const deadlineAt = dto.deadlineAt !== undefined ? this.parseDeadline(dto.deadlineAt) : current.deadlineAt;
    const data: Prisma.ShortTaskUncheckedUpdateManyInput = {
      ...(dto.specialization !== undefined ? { specializationCode: dto.specialization } : {}),
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.prompt !== undefined ? { prompt: dto.prompt.trim() } : {}),
      ...(dto.allowedGrades !== undefined ? { allowedGrades: dto.allowedGrades as Grade[] } : {}),
      ...(dto.explanation !== undefined ? { explanation: dto.explanation?.trim() || null } : {}),
      kind,
      options: merged.options,
      correctIndex: merged.correctIndex,
      deadlineAt,
    };
    // Условный UPDATE: параллельная публикация не должна «проскочить» правку.
    const result = await this.prisma.shortTask.updateMany({ where: { id: taskId, companyId: company.id, status: 'DRAFT' }, data });
    if (result.count === 0) throw conflict('TASK_NOT_EDITABLE', 'Опубликованное задание не редактируется: ответы оцениваются по одному условию. Создайте новое задание.');
    await this.audit.record({ actorUserId: userId, action: 'task.updated', objectType: 'ShortTask', objectId: taskId, requestId });
    return this.employerView(company, taskId);
  }

  async publish(company: Company, userId: string, taskId: string, requestId: string) {
    const task = await this.getOwn(company, taskId);
    if (task.status === 'ACTIVE') return this.employerView(company, taskId);
    if (task.status === 'CLOSED') throw conflict('TASK_CLOSED', 'Закрытое задание нельзя опубликовать повторно — создайте новое');
    await this.assertCanActivate(company.id, task.deadlineAt);
    const result = await this.prisma.shortTask.updateMany({
      where: { id: taskId, companyId: company.id, status: 'DRAFT' },
      data: { status: 'ACTIVE', publishedAt: this.clock.now() },
    });
    if (result.count === 1) {
      await this.audit.record({ actorUserId: userId, action: 'task.published', objectType: 'ShortTask', objectId: taskId, requestId });
    }
    return this.employerView(company, taskId);
  }

  async close(company: Company, userId: string, taskId: string, requestId: string) {
    const task = await this.getOwn(company, taskId);
    if (task.status === 'CLOSED') return this.employerView(company, taskId);
    if (task.status === 'DRAFT') throw conflict('TASK_NOT_ACTIVE', 'Черновик не нужно закрывать — удалите его или опубликуйте');
    const result = await this.prisma.shortTask.updateMany({
      where: { id: taskId, companyId: company.id, status: 'ACTIVE' },
      data: { status: 'CLOSED', closedAt: this.clock.now() },
    });
    if (result.count === 1) {
      await this.audit.record({ actorUserId: userId, action: 'task.closed', objectType: 'ShortTask', objectId: taskId, requestId });
    }
    return this.employerView(company, taskId);
  }

  async submissions(company: Company, taskId: string, query: TaskSubmissionsQueryDto) {
    const task = await this.getOwn(company, taskId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.TaskAssignmentWhereInput = {
      taskId,
      status: 'SUBMITTED',
      ...(query.pendingOnly ? { verdict: null, task: { kind: 'APPROACH' } } : {}),
    };
    const [total, rows, counts, quiz] = await Promise.all([
      this.prisma.taskAssignment.count({ where }),
      this.prisma.taskAssignment.findMany({
        where,
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { candidate: { select: { alias: true } } },
      }),
      this.counts([taskId]),
      task.kind === 'QUIZ'
        ? this.prisma.taskAssignment.groupBy({ by: ['isCorrect'], where: { taskId, status: 'SUBMITTED' }, _count: { _all: true } })
        : Promise.resolve([]),
    ]);
    const grades = await this.prisma.candidateQualification.findMany({
      where: { specializationCode: task.specializationCode, candidateId: { in: rows.map((row) => row.candidateId) } },
      select: { candidateId: true, confirmedGrade: true },
    });
    const gradeOf = new Map(grades.map((q) => [q.candidateId, q.confirmedGrade]));
    return {
      page,
      pageSize,
      total,
      task: this.view(task, counts.get(taskId)),
      quiz:
        task.kind === 'QUIZ'
          ? { answered: quiz.reduce((sum, g) => sum + g._count._all, 0), correct: quiz.find((g) => g.isCorrect === true)?._count._all ?? 0 }
          : null,
      items: rows.map((row) => this.submissionItem(task, row, gradeOf.get(row.candidateId) ?? null)),
    };
  }

  private submissionItem(task: Pick<ShortTask, 'kind'>, row: SubmissionRow, grade: string | null) {
    return {
      id: row.id,
      candidateId: row.candidateId,
      candidateAlias: row.candidate.alias,
      confirmedGrade: grade,
      confirmedGradeTitle: grade ? GRADE_TITLES[grade as Grade] : null,
      submittedAt: row.submittedAt!.toISOString(),
      selectedIndex: row.selectedIndex,
      answerText: row.answerText,
      isCorrect: row.isCorrect,
      needsReview: task.kind === 'APPROACH' && !row.verdict,
      verdict: row.verdict,
      verdictTitle: row.verdict ? VERDICT_TEXT[row.verdict] : null,
      reviewComment: row.reviewComment,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    };
  }

  /** Оценка текстового разбора автором задания; повторная оценка заменяет предыдущую. */
  async review(company: Company, userId: string, assignmentId: string, dto: ReviewSubmissionDto, requestId: string) {
    const assignment = await this.prisma.taskAssignment.findFirst({
      where: { id: assignmentId, task: { companyId: company.id } },
      include: { task: { select: { kind: true, id: true } } },
    });
    if (!assignment) throw notFound('SUBMISSION_NOT_FOUND', 'Ответ не найден');
    if (assignment.task.kind !== 'APPROACH') throw conflict('TASK_AUTO_SCORED', 'Тест с одним верным ответом оценивается автоматически');
    const result = await this.prisma.taskAssignment.updateMany({
      where: { id: assignmentId, status: 'SUBMITTED' },
      data: { verdict: dto.verdict, reviewComment: dto.comment?.trim() || null, reviewedAt: this.clock.now() },
    });
    if (result.count === 0) throw conflict('SUBMISSION_NOT_SUBMITTED', 'Кандидат ещё не отправил ответ на это задание');
    await this.audit.record({
      actorUserId: userId,
      action: 'task.reviewed',
      objectType: 'TaskAssignment',
      objectId: assignmentId,
      requestId,
      metadata: { taskId: assignment.task.id, verdict: dto.verdict },
    });
    const row = await this.prisma.taskAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { candidate: { select: { alias: true } }, task: { select: { kind: true, specializationCode: true } } } });
    const qualification = await this.prisma.candidateQualification.findUnique({
      where: { candidateId_specializationCode: { candidateId: row.candidateId, specializationCode: row.task.specializationCode } },
      select: { confirmedGrade: true },
    });
    return this.submissionItem(row.task, row, qualification?.confirmedGrade ?? null);
  }

  // ───────────────────────────── Вспомогательное ─────────────────────────────

  private contentOf(dto: { kind: ShortTaskKind; options?: string[]; correctIndex?: number }) {
    const options = (dto.options ?? []).map((option) => option.trim());
    const issues = validateTaskContent({ kind: dto.kind, options, correctIndex: dto.correctIndex ?? null });
    if (Object.keys(issues).length) throw unprocessable('VALIDATION_FAILED', 'Проверьте содержимое задания', { fields: Object.fromEntries(Object.entries(issues).map(([field, message]) => [field, [message]])) });
    return { options: dto.kind === 'QUIZ' ? options : [], correctIndex: dto.kind === 'QUIZ' ? dto.correctIndex! : null };
  }

  private parseDeadline(value: string | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw unprocessable('VALIDATION_FAILED', 'Некорректный срок', { fields: { deadlineAt: ['Укажите дату в формате ISO 8601'] } });
    return date;
  }

  /** Активировать можно ограниченное число заданий, и срок публикуемого задания не должен быть в прошлом. */
  private async assertCanActivate(companyId: string, deadlineAt: Date | null) {
    if (deadlineAt && deadlineAt <= this.clock.now()) {
      throw unprocessable('VALIDATION_FAILED', 'Срок приёма ответов уже прошёл', { fields: { deadlineAt: ['Укажите срок в будущем'] } });
    }
    const active = await this.prisma.shortTask.count({ where: { companyId, status: 'ACTIVE' } });
    if (active >= MAX_ACTIVE_TASKS_PER_COMPANY) {
      throw conflict('TASK_LIMIT_REACHED', `Одновременно активно не более ${MAX_ACTIVE_TASKS_PER_COMPANY} заданий — закройте ненужные`, { limit: MAX_ACTIVE_TASKS_PER_COMPANY });
    }
  }

  private async counts(taskIds: string[]): Promise<Map<string, TaskCounts>> {
    const result = new Map<string, TaskCounts>();
    if (taskIds.length === 0) return result;
    const [byStatus, pending] = await Promise.all([
      this.prisma.taskAssignment.groupBy({ by: ['taskId', 'status'], where: { taskId: { in: taskIds } }, _count: { _all: true } }),
      this.prisma.taskAssignment.groupBy({ by: ['taskId'], where: { taskId: { in: taskIds }, status: 'SUBMITTED', verdict: null, task: { kind: 'APPROACH' } }, _count: { _all: true } }),
    ]);
    for (const id of taskIds) result.set(id, { offered: 0, submitted: 0, pendingReview: 0 });
    for (const row of byStatus) {
      const counts = result.get(row.taskId)!;
      counts.offered += row._count._all;
      if (row.status === 'SUBMITTED') counts.submitted += row._count._all;
    }
    for (const row of pending) result.get(row.taskId)!.pendingReview = row._count._all;
    return result;
  }

  private view(task: ShortTask, counts: TaskCounts = { offered: 0, submitted: 0, pendingReview: 0 }) {
    return {
      id: task.id,
      title: task.title,
      prompt: task.prompt,
      specialization: task.specializationCode,
      specializationTitle: getSpecialization(task.specializationCode)?.title ?? task.specializationCode,
      allowedGrades: task.allowedGrades,
      kind: task.kind,
      kindTitle: TASK_KIND_TEXT[task.kind],
      options: task.options,
      correctIndex: task.correctIndex,
      explanation: task.explanation,
      status: task.status,
      statusTitle: TASK_STATUS_TEXT[task.status],
      publishedAt: task.publishedAt?.toISOString() ?? null,
      closedAt: task.closedAt?.toISOString() ?? null,
      deadlineAt: task.deadlineAt?.toISOString() ?? null,
      offeredCount: counts.offered,
      submittedCount: counts.submitted,
      pendingReviewCount: counts.pendingReview,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }
}
