import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { conflict, isUniqueViolation, notFound, unprocessable } from '../../common/errors';
import { evaluateDiscoverability } from '../../domain/candidate/discoverability';
import { getSpecialization } from '../../domain/catalog/catalog';
import {
  addDays,
  APPROACH_MAX_LENGTH,
  APPROACH_MIN_LENGTH,
  canOfferNow,
  dueAtFor,
  isTaskEligible,
  nextOfferAfter,
  normalizeAnswerText,
  pickTaskToOffer,
  PRACTICE_WINDOW_DAYS,
  TASK_OFFER_INTERVAL_DAYS,
} from '../../domain/tasks/rules';
import type { Prisma, TaskAssignmentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { candidateFactsInclude, hasActivePublicationConsent, toDiscoverabilityFacts } from '../candidate-profiles/candidate-facts';
import type { SubmitTaskDto } from './dto/task.dto';
import { TASK_KIND_TEXT, VERDICT_TEXT } from './tasks.service';

const ASSIGNMENT_TEXT: Record<TaskAssignmentStatus, string> = {
  OFFERED: 'Ждёт ответа',
  SUBMITTED: 'Ответ отправлен',
  SKIPPED: 'Пропущено',
  EXPIRED: 'Срок истёк',
};

const HISTORY_LIMIT = 20;

const assignmentInclude = { task: { include: { company: { select: { name: true, verificationStatus: true } } } } } satisfies Prisma.TaskAssignmentInclude;
type AssignmentRow = Prisma.TaskAssignmentGetPayload<{ include: typeof assignmentInclude }>;

type OfferBlocker = 'NOT_DISCOVERABLE' | 'PAUSED' | 'NO_CONFIRMED_QUALIFICATION';

/**
 * Регулярные короткие задания для кандидата. Задание предлагается лениво — при открытии раздела — не чаще раза в неделю
 * и только если нет неотвеченного; «не больше одного неотвеченного» дополнительно гарантирует частичный уникальный индекс.
 * Задания подбираются по подтверждённой тестом квалификации и показываются только кандидатам, видимым работодателям:
 * ответ увидит автор задания. Выполнение не меняет подтверждённый грейд и не входит в формулу подбора.
 *
 * Адресные задания (source = DIRECT) отправляет работодатель конкретному кандидату; они не зависят от недельного периода и
 * квалификации (так работодатель может проверить и кандидата без подтверждённого грейда) и показываются отдельным списком.
 */
@Injectable()
export class CandidateTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async overview(candidateId: string, userId: string) {
    const now = this.clock.now();
    await this.expireStale(candidateId, now);

    const blocker = await this.blockerOf(candidateId, userId);
    let current = await this.currentOf(candidateId);
    if (!current && !blocker) {
      const offered = await this.offerIfDue(candidateId, userId, now);
      if (offered) current = await this.currentOf(candidateId);
    }

    const [direct, history, last, practice] = await Promise.all([
      this.prisma.taskAssignment.findMany({
        where: { candidateId, status: 'OFFERED', source: 'DIRECT' },
        orderBy: [{ offeredAt: 'desc' }, { id: 'asc' }],
        include: assignmentInclude,
      }),
      this.prisma.taskAssignment.findMany({
        where: { candidateId, status: { not: 'OFFERED' } },
        orderBy: [{ offeredAt: 'desc' }, { id: 'asc' }],
        take: HISTORY_LIMIT,
        include: assignmentInclude,
      }),
      this.prisma.taskAssignment.findFirst({ where: { candidateId, source: 'ROTATION' }, orderBy: { offeredAt: 'desc' }, select: { offeredAt: true } }),
      this.practiceOf(candidateId, now),
    ]);
    const next = nextOfferAfter(last?.offeredAt ?? null);
    return {
      current: current ? this.view(current, now) : null,
      direct: direct.map((row) => this.view(row, now)),
      history: history.map((row) => this.view(row, now)),
      intervalDays: TASK_OFFER_INTERVAL_DAYS,
      nextOfferAt: !current && !blocker && next && next > now ? next.toISOString() : null,
      blocker: blocker?.code ?? null,
      blockerMessage: blocker?.message ?? null,
      practice,
    };
  }

  async get(candidateId: string, assignmentId: string) {
    const now = this.clock.now();
    await this.expireStale(candidateId, now);
    const row = await this.prisma.taskAssignment.findFirst({ where: { id: assignmentId, candidateId }, include: assignmentInclude });
    if (!row) throw notFound('TASK_ASSIGNMENT_NOT_FOUND', 'Задание не найдено');
    return this.view(row, now);
  }

  async submit(candidateId: string, userId: string, assignmentId: string, dto: SubmitTaskDto, requestId: string) {
    const now = this.clock.now();
    await this.expireStale(candidateId, now);
    const row = await this.prisma.taskAssignment.findFirst({ where: { id: assignmentId, candidateId }, include: assignmentInclude });
    if (!row) throw notFound('TASK_ASSIGNMENT_NOT_FOUND', 'Задание не найдено');
    if (row.status === 'SUBMITTED') throw conflict('TASK_ALREADY_SUBMITTED', 'Ответ на это задание уже отправлен');
    if (row.status === 'EXPIRED') throw conflict('TASK_EXPIRED', 'Срок ответа на это задание истёк');
    if (row.status === 'SKIPPED') throw conflict('TASK_NOT_OPEN', 'Это задание вы пропустили');

    // Ответ увидит автор задания, поэтому автор должен видеть кандидата: профиль в поиске или (для адресного) доступ к контактам.
    if (!(await this.visibleToAuthor(candidateId, userId, row.task.companyId, row.source === 'DIRECT'))) {
      throw conflict('PUBLICATION_REQUIRED', 'Ответ увидит автор задания: сначала верните профиль в поиск');
    }

    const { task } = row;
    let selectedIndex: number | null = null;
    let answerText: string | null = null;
    let isCorrect: boolean | null = null;
    if (task.kind === 'QUIZ') {
      if (dto.answerText !== undefined) throw unprocessable('VALIDATION_FAILED', 'В тесте нужно выбрать вариант', { fields: { answerText: ['Текст не принимается'] } });
      if (dto.selectedIndex === undefined || dto.selectedIndex >= task.options.length) {
        throw unprocessable('VALIDATION_FAILED', 'Выберите один из вариантов', { fields: { selectedIndex: ['Выберите вариант из списка'] } });
      }
      selectedIndex = dto.selectedIndex;
      isCorrect = selectedIndex === task.correctIndex;
    } else {
      if (dto.selectedIndex !== undefined) throw unprocessable('VALIDATION_FAILED', 'В разборе нужен текст', { fields: { selectedIndex: ['Выбор варианта не принимается'] } });
      answerText = normalizeAnswerText(dto.answerText ?? '');
      if (answerText.length < APPROACH_MIN_LENGTH || answerText.length > APPROACH_MAX_LENGTH) {
        throw unprocessable('VALIDATION_FAILED', 'Проверьте текст ответа', { fields: { answerText: [`От ${APPROACH_MIN_LENGTH} до ${APPROACH_MAX_LENGTH} символов`] } });
      }
    }

    // Условный UPDATE: двойной клик и параллельные запросы дают ровно один принятый ответ.
    const saved = await this.prisma.$transaction(async (tx) => {
      const result = await tx.taskAssignment.updateMany({
        where: { id: assignmentId, candidateId, status: 'OFFERED' },
        data: { status: 'SUBMITTED', submittedAt: now, selectedIndex, answerText, isCorrect },
      });
      if (result.count === 0) return false;
      await this.audit.recordTx(tx, {
        actorUserId: userId,
        action: 'task.submitted',
        objectType: 'TaskAssignment',
        objectId: assignmentId,
        requestId,
        metadata: { taskId: task.id, kind: task.kind },
      });
      return true;
    });
    if (!saved) throw conflict('TASK_ALREADY_SUBMITTED', 'Ответ на это задание уже отправлен или срок истёк');
    return this.get(candidateId, assignmentId);
  }

  async skip(candidateId: string, userId: string, assignmentId: string, requestId: string) {
    const now = this.clock.now();
    await this.expireStale(candidateId, now);
    const row = await this.prisma.taskAssignment.findFirst({ where: { id: assignmentId, candidateId }, select: { status: true, taskId: true } });
    if (!row) throw notFound('TASK_ASSIGNMENT_NOT_FOUND', 'Задание не найдено');
    if (row.status === 'SKIPPED') return this.get(candidateId, assignmentId);
    if (row.status !== 'OFFERED') throw conflict('TASK_NOT_OPEN', row.status === 'SUBMITTED' ? 'Ответ уже отправлен' : 'Срок ответа на это задание истёк');
    const result = await this.prisma.taskAssignment.updateMany({ where: { id: assignmentId, candidateId, status: 'OFFERED' }, data: { status: 'SKIPPED', skippedAt: now } });
    if (result.count === 1) {
      await this.audit.record({ actorUserId: userId, action: 'task.skipped', objectType: 'TaskAssignment', objectId: assignmentId, requestId, metadata: { taskId: row.taskId } });
    }
    return this.get(candidateId, assignmentId);
  }

  // ───────────────────────────── Предложение заданий ─────────────────────────────

  /** Предложения с истёкшим сроком или по закрытому заданию переводятся в «Срок истёк». */
  private async expireStale(candidateId: string, now: Date) {
    await this.prisma.taskAssignment.updateMany({
      where: { candidateId, status: 'OFFERED', OR: [{ dueAt: { lte: now } }, { task: { status: 'CLOSED' } }] },
      data: { status: 'EXPIRED' },
    });
  }

  private currentOf(candidateId: string) {
    return this.prisma.taskAssignment.findFirst({ where: { candidateId, status: 'OFFERED', source: 'ROTATION' }, include: assignmentInclude });
  }

  private async visibleToAuthor(candidateId: string, userId: string, companyId: string, allowGrant: boolean): Promise<boolean> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { id: candidateId }, include: candidateFactsInclude });
    if (!profile) return false;
    const consent = await hasActivePublicationConsent(this.prisma, userId);
    if (evaluateDiscoverability(toDiscoverabilityFacts(profile, consent)).discoverable) return true;
    if (!allowGrant) return false;
    const grant = await this.prisma.contactAccessGrant.findUnique({ where: { candidateId_companyId: { candidateId, companyId } } });
    return Boolean(grant && !grant.revokedAt);
  }

  private async blockerOf(candidateId: string, userId: string): Promise<{ code: OfferBlocker; message: string } | null> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { id: candidateId }, include: candidateFactsInclude });
    if (!profile) throw notFound('PROFILE_NOT_FOUND', 'Профиль кандидата не найден');
    const consent = await hasActivePublicationConsent(this.prisma, userId);
    const { discoverable, issues } = evaluateDiscoverability(toDiscoverabilityFacts(profile, consent));
    if (discoverable) {
      // Регулярные задания подбираются по подтверждённой квалификации; адресные от работодателя приходят и без неё.
      if (profile.qualifications.length === 0) {
        return { code: 'NO_CONFIRMED_QUALIFICATION', message: 'Регулярные задания подбираются по подтверждённому тестом грейду: пройдите тест по своей специализации.' };
      }
      return null;
    }
    const codes = issues.map((issue) => issue.code);
    const code: OfferBlocker = codes.includes('PAUSED') ? 'PAUSED' : 'NOT_DISCOVERABLE';
    return { code, message: `Задания предлагаются кандидатам, которых видят работодатели. ${issues.map((issue) => issue.message).join('; ')}.` };
  }

  /** Предлагает одно подходящее задание, если прошла неделя с прошлого предложения. Возвращает true, если предложение создано. */
  private async offerIfDue(candidateId: string, userId: string, now: Date): Promise<boolean> {
    const last = await this.prisma.taskAssignment.findFirst({ where: { candidateId, source: 'ROTATION' }, orderBy: { offeredAt: 'desc' }, select: { offeredAt: true } });
    if (!canOfferNow(last?.offeredAt ?? null, now)) return false;

    const qualifications = await this.prisma.candidateQualification.findMany({ where: { candidateId }, select: { specializationCode: true, confirmedGrade: true } });
    if (qualifications.length === 0) return false;
    const tasks = await this.prisma.shortTask.findMany({
      where: {
        status: 'ACTIVE',
        specializationCode: { in: [...new Set(qualifications.map((q) => q.specializationCode))] },
        OR: [{ deadlineAt: null }, { deadlineAt: { gt: now } }],
        assignments: { none: { candidateId } },
      },
      select: { id: true, publishedAt: true, deadlineAt: true, specializationCode: true, allowedGrades: true, _count: { select: { assignments: true } } },
    });
    const eligible = tasks.filter((task) => isTaskEligible(task, qualifications)).map((task) => ({ ...task, offeredCount: task._count.assignments }));
    const picked = pickTaskToOffer(eligible, now);
    if (!picked) return false;

    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.taskAssignment.create({
          data: { taskId: picked.id, candidateId, status: 'OFFERED', offeredAt: now, dueAt: dueAtFor(now, picked.deadlineAt) },
        });
        await this.audit.recordTx(tx, { actorUserId: userId, action: 'task.offered', objectType: 'TaskAssignment', objectId: created.id, metadata: { taskId: picked.id } });
      });
      return true;
    } catch (error) {
      // Параллельный запрос уже предложил задание (частичный уникальный индекс «одно неотвеченное») — это не ошибка.
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  private async practiceOf(candidateId: string, now: Date) {
    const since = addDays(now, -PRACTICE_WINDOW_DAYS);
    const [solved, last] = await Promise.all([
      this.prisma.taskAssignment.count({ where: { candidateId, status: 'SUBMITTED', submittedAt: { gte: since } } }),
      this.prisma.taskAssignment.findFirst({ where: { candidateId, status: 'SUBMITTED' }, orderBy: { submittedAt: 'desc' }, select: { submittedAt: true } }),
    ]);
    return { solvedLast90Days: solved, lastSubmittedAt: last?.submittedAt?.toISOString() ?? null };
  }

  /** Условие задания и результат. Верный вариант теста раскрывается только после отправки ответа. */
  private view(row: AssignmentRow, now: Date) {
    const { task } = row;
    const submitted = row.status === 'SUBMITTED';
    return {
      id: row.id,
      status: row.status,
      statusTitle: ASSIGNMENT_TEXT[row.status],
      source: row.source,
      note: row.note,
      offeredAt: row.offeredAt.toISOString(),
      dueAt: row.dueAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      canSubmit: row.status === 'OFFERED' && row.dueAt > now && task.status === 'ACTIVE',
      task: {
        title: task.title,
        prompt: task.prompt,
        kind: task.kind,
        kindTitle: TASK_KIND_TEXT[task.kind],
        options: task.options,
        specialization: task.specializationCode,
        specializationTitle: getSpecialization(task.specializationCode)?.title ?? task.specializationCode,
        companyName: task.company.name,
        companyVerified: task.company.verificationStatus === 'VERIFIED',
        closed: task.status === 'CLOSED',
      },
      result: submitted
        ? {
            selectedIndex: row.selectedIndex,
            answerText: row.answerText,
            isCorrect: row.isCorrect,
            correctIndex: task.kind === 'QUIZ' ? task.correctIndex : null,
            explanation: task.explanation,
            verdict: row.verdict,
            verdictTitle: row.verdict ? VERDICT_TEXT[row.verdict] : null,
            reviewComment: row.reviewComment,
            reviewedAt: row.reviewedAt?.toISOString() ?? null,
          }
        : null,
    };
  }
}
