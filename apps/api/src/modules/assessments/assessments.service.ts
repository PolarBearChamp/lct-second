import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { addMinutes, Clock } from '../../common/clock';
import { RATE_LIMITS, RateLimitService } from '../../common/rate-limit.service';
import { conflict, isUniqueViolation, notFound, unprocessable } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import type { AssessmentPolicy } from '../../config/policies';
import { generateAttemptInstances } from '../../domain/assessment/attempt-generation';
import { BANK_VERSION } from '../../domain/assessment/bank/registry';
import { BLUEPRINT_VERSION } from '../../domain/assessment/blueprint';
import { checkEligibility, type EligibilityResult } from '../../domain/assessment/eligibility';
import { evaluateItem, validateItemAnswerShape } from '../../domain/assessment/evaluate';
import { evaluateIntegrity, type IntegrityCounters, type IntegrityEvaluation } from '../../domain/assessment/integrity';
import { recommendationsFor, scoreAttempt, type AttemptScore, type GroupScore, type SkillEvidence } from '../../domain/assessment/scoring';
import type { ItemAnswer, PrivateKey, PrivateTaskInstance, PublicTask } from '../../domain/assessment/types';
import { getGroup, getSpecialization, GRADE_TITLES, groupsOf, isSpecializationCode, type GradeCode, type SpecializationCode } from '../../domain/catalog/catalog';
import type { AssessmentAttempt, Grade, Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { grantQualification } from './qualification';

type FinalizeKind = 'SUBMIT' | 'EXPIRE' | 'ABANDON';

export interface SubmittedAnswerInput {
  itemId: string;
  answer: ItemAnswer;
  revision: number;
}

interface StoredScore {
  groups: GroupScore[];
  skills: SkillEvidence[];
}

const GRADES: GradeCode[] = ['JUNIOR', 'MIDDLE', 'SENIOR'];

/**
 * Жизненный цикл попытки тестирования:
 * IN_PROGRESS → PASSED | FAILED (submit), EXPIRED (истёк серверный expiresAt), ABANDONED (явное прерывание).
 * Завершённая попытка неизменяема. Таймер определяется только сервером; просроченность проверяется при каждом
 * чтении и изменении, а не только фоновой задачей.
 */
@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly policies: PolicyService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // ───────────────────────────── Допуск ─────────────────────────────

  async eligibility(candidateId: string, specialization: string) {
    this.assertSpecialization(specialization);
    await this.expireStale(candidateId);
    const policy = this.policies.assessment;
    const now = this.clock.now();
    const [qualification, attempts, active] = await Promise.all([
      this.prisma.candidateQualification.findUnique({
        where: { candidateId_specializationCode: { candidateId, specializationCode: specialization } },
      }),
      this.prisma.assessmentAttempt.findMany({
        where: { candidateId, status: { not: 'IN_PROGRESS' } },
        select: { specializationCode: true, requestedGrade: true, status: true, finishedAt: true },
      }),
      this.prisma.assessmentAttempt.findFirst({ where: { candidateId, status: 'IN_PROGRESS' } }),
    ]);
    const grades: EligibilityResult[] = GRADES.map((grade) =>
      checkEligibility({
        now,
        specialization,
        grade,
        policy,
        qualification: qualification
          ? { confirmedGrade: qualification.confirmedGrade as GradeCode, nextReassessmentAt: qualification.nextReassessmentAt }
          : null,
        attempts: attempts.map((a) => ({ ...a, requestedGrade: a.requestedGrade as GradeCode })),
        activeAttempt: active
          ? { id: active.id, specializationCode: active.specializationCode, requestedGrade: active.requestedGrade as GradeCode }
          : null,
      }),
    );
    return {
      specialization,
      specializationTitle: getSpecialization(specialization)?.title ?? specialization,
      serverNow: now.toISOString(),
      qualification: qualification
        ? {
            grade: qualification.confirmedGrade,
            overallScore: qualification.overallScore,
            confirmedAt: qualification.confirmedAt.toISOString(),
            nextReassessmentAt: qualification.nextReassessmentAt.toISOString(),
          }
        : null,
      activeAttempt: active
        ? { id: active.id, specialization: active.specializationCode, grade: active.requestedGrade, expiresAt: active.expiresAt.toISOString() }
        : null,
      grades: grades.map((g) => ({ ...g, availableAt: g.availableAt?.toISOString() ?? null })),
      rules: this.rulesSummary(policy),
    };
  }

  private rulesSummary(policy: AssessmentPolicy) {
    return {
      policyVersion: policy.version,
      durationMinutes: policy.durationMinutes,
      cases: policy.itemsPerGroup * 3,
      itemsPerGroup: policy.itemsPerGroup,
      minScoredParts: policy.minScoredParts,
      passOverall: policy.passOverall,
      passGroupMin: policy.passGroupMin,
      confidentOverall: policy.confidentOverall,
      confidentGroupMin: policy.confidentGroupMin,
      skillMinCases: policy.skillEvidence.minCases,
      skillMinScore: policy.skillEvidence.minScore,
      retryCooldownHours: policy.retryCooldownHours,
      reassessmentDays: policy.reassessmentDays,
    };
  }

  // ───────────────────────────── Старт ─────────────────────────────

  async start(
    candidateId: string,
    userId: string,
    specialization: string,
    grade: GradeCode,
    idempotencyKey: string | undefined,
    requestId: string,
  ) {
    this.assertSpecialization(specialization);
    if (idempotencyKey) {
      const existing = await this.prisma.assessmentAttempt.findUnique({
        where: { candidateId_clientRequestId: { candidateId, clientRequestId: idempotencyKey } },
      });
      if (existing) return { attempt: await this.view(candidateId, existing.id), created: false };
    }
    await this.expireStale(candidateId);
    const eligibility = await this.eligibility(candidateId, specialization);
    const verdict = eligibility.grades.find((g) => g.grade === grade)!;
    if (!verdict.allowed) {
      throw conflict('ASSESSMENT_NOT_ALLOWED', verdict.message, {
        reason: verdict.reason,
        availableAt: verdict.availableAt,
        activeAttemptId: verdict.activeAttemptId,
      });
    }

    const policy = this.policies.assessment;
    const generated = await this.generateInstances(candidateId, specialization as SpecializationCode, grade, policy);
    const totalParts = generated.reduce((sum, inst) => sum + inst.public.parts.length, 0);
    if (totalParts < policy.minScoredParts) {
      throw new Error(`Банк сформировал ${totalParts} частей, требуется ${policy.minScoredParts}`);
    }
    const now = this.clock.now();
    try {
      const attempt = await this.prisma.$transaction(async (tx) => {
        const created = await tx.assessmentAttempt.create({
          data: {
            candidateId,
            specializationCode: specialization,
            requestedGrade: grade as Grade,
            status: 'IN_PROGRESS',
            startedAt: now,
            expiresAt: addMinutes(now, policy.durationMinutes),
            blueprintVersion: BLUEPRINT_VERSION,
            bankVersion: BANK_VERSION,
            policyVersion: policy.version,
            policySnapshot: policy as unknown as Prisma.InputJsonValue,
            clientRequestId: idempotencyKey ?? null,
          },
        });
        await tx.assessmentItem.createMany({
          data: generated.map((inst, position) => ({
            attemptId: created.id,
            position,
            groupCode: inst.groupCode,
            familyId: inst.familyId,
            familyVersion: inst.familyVersion,
            grade: inst.grade as Grade,
            seed: inst.seed,
            fingerprint: inst.fingerprint,
            skillTags: inst.skillTags,
            publicSnapshot: inst.public as unknown as Prisma.InputJsonValue,
            privateKey: inst.key as unknown as Prisma.InputJsonValue,
          })),
        });
        await this.audit.recordTx(tx, {
          actorUserId: userId,
          action: 'assessment.started',
          objectType: 'AssessmentAttempt',
          objectId: created.id,
          requestId,
          metadata: { specialization, grade, policyVersion: policy.version, bankVersion: BANK_VERSION },
        });
        return created;
      });
      return { attempt: await this.view(candidateId, attempt.id), created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (idempotencyKey) {
          const existing = await this.prisma.assessmentAttempt.findUnique({
            where: { candidateId_clientRequestId: { candidateId, clientRequestId: idempotencyKey } },
          });
          if (existing) return { attempt: await this.view(candidateId, existing.id), created: false };
        }
        const active = await this.prisma.assessmentAttempt.findFirst({ where: { candidateId, status: 'IN_PROGRESS' } });
        throw conflict('ASSESSMENT_NOT_ALLOWED', 'У вас уже есть незавершённая попытка тестирования.', {
          reason: 'ACTIVE_ATTEMPT',
          activeAttemptId: active?.id,
        });
      }
      throw error;
    }
  }

  /**
   * Генерация экземпляров по общему blueprint специализации. Экземпляры с отпечатком, который кандидат уже видел,
   * перегенерируются (до maxFingerprintRetries раз). Seed — криптографически случайный.
   */
  async generateInstances(
    candidateId: string,
    specialization: SpecializationCode,
    grade: GradeCode,
    policy: AssessmentPolicy,
    seedSource: () => string = () => randomBytes(16).toString('hex'),
  ): Promise<PrivateTaskInstance[]> {
    const previous = await this.prisma.assessmentItem.findMany({
      where: { attempt: { candidateId } },
      select: { familyId: true, fingerprint: true },
    });
    const familyUse = new Map<string, number>();
    const seenFingerprints = new Set<string>();
    for (const item of previous) {
      familyUse.set(item.familyId, (familyUse.get(item.familyId) ?? 0) + 1);
      seenFingerprints.add(item.fingerprint);
    }
    const { instances, exactRepeats } = generateAttemptInstances(specialization, grade, policy, { familyUse, seenFingerprints }, seedSource);
    if (exactRepeats > 0) {
      this.logger.warn(`Точный повтор экземпляров (${exactRepeats}): альтернатив не найдено за ${policy.maxFingerprintRetries} попыток`);
    }
    return instances;
  }

  // ───────────────────────────── Чтение ─────────────────────────────

  async list(candidateId: string) {
    await this.expireStale(candidateId);
    const attempts = await this.prisma.assessmentAttempt.findMany({
      where: { candidateId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    return attempts.map((a) => this.summary(a));
  }

  private summary(a: AssessmentAttempt) {
    return {
      id: a.id,
      specialization: a.specializationCode,
      specializationTitle: getSpecialization(a.specializationCode)?.title ?? a.specializationCode,
      grade: a.requestedGrade,
      status: a.status,
      startedAt: a.startedAt.toISOString(),
      expiresAt: a.expiresAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      overallScore: a.overallScore,
      confident: a.confident,
      qualificationGranted: a.qualificationGranted,
      isSynthetic: a.isSynthetic,
    };
  }

  async view(candidateId: string, attemptId: string) {
    let attempt = await this.ownAttempt(candidateId, attemptId);
    if (attempt.status === 'IN_PROGRESS' && attempt.expiresAt <= this.clock.now()) {
      await this.finalizeById(attempt.id, 'EXPIRE');
      attempt = await this.ownAttempt(candidateId, attemptId);
    }
    const inProgress = attempt.status === 'IN_PROGRESS';
    const items = inProgress
      ? await this.prisma.assessmentItem.findMany({
          where: { attemptId },
          orderBy: { position: 'asc' },
          select: { id: true, position: true, groupCode: true, publicSnapshot: true, answers: { select: { answer: true, revision: true, savedAt: true } } },
        })
      : [];
    const policy = attempt.policySnapshot as unknown as AssessmentPolicy;
    return {
      ...this.summary(attempt),
      serverNow: this.clock.now().toISOString(),
      durationMinutes: policy.durationMinutes,
      policyVersion: attempt.policyVersion,
      items: items.map((item) => ({
        id: item.id,
        position: item.position,
        groupCode: item.groupCode,
        groupTitle: getGroup(item.groupCode)?.title ?? item.groupCode,
        task: item.publicSnapshot as unknown as PublicTask,
        answer: (item.answers[0]?.answer as unknown as ItemAnswer) ?? null,
        revision: item.answers[0]?.revision ?? 0,
        savedAt: item.answers[0]?.savedAt.toISOString() ?? null,
      })),
    };
  }

  async result(candidateId: string, attemptId: string) {
    let attempt = await this.ownAttempt(candidateId, attemptId);
    if (attempt.status === 'IN_PROGRESS') {
      if (attempt.expiresAt > this.clock.now()) {
        throw conflict('ATTEMPT_IN_PROGRESS', 'Попытка ещё не завершена');
      }
      await this.finalizeById(attempt.id, 'EXPIRE');
      attempt = await this.ownAttempt(candidateId, attemptId);
    }
    return this.buildResult(attempt);
  }

  private async buildResult(attempt: AssessmentAttempt) {
    const policy = attempt.policySnapshot as unknown as AssessmentPolicy;
    const stored: StoredScore = {
      groups: (attempt.groupScores as unknown as GroupScore[]) ?? [],
      skills: (attempt.skillEvidence as unknown as SkillEvidence[]) ?? [],
    };
    const hasScore = attempt.overallScore !== null;
    const score: AttemptScore | null = hasScore
      ? {
          groups: stored.groups,
          overall: attempt.overallScore!,
          passed: attempt.status === 'PASSED',
          confident: Boolean(attempt.confident),
          skills: stored.skills,
          failedGroups: stored.groups.filter((g) => g.score < policy.passGroupMin).map((g) => g.group),
        }
      : null;
    const eligibility = await this.eligibility(attempt.candidateId, attempt.specializationCode);
    return {
      ...this.summary(attempt),
      passed: attempt.status === 'PASSED',
      groups: stored.groups,
      skills: stored.skills,
      recommendations: score ? recommendationsFor(score, attempt.requestedGrade as GradeCode, policy) : [],
      thresholds: this.rulesSummary(policy),
      versions: { policy: attempt.policyVersion, bank: attempt.bankVersion, blueprint: attempt.blueprintVersion },
      eligibility,
      statusMessage: this.statusMessage(attempt),
      integrity: attempt.integrity ? { ...(attempt.integrity as unknown as IntegrityEvaluation) } : null,
    };
  }

  private statusMessage(attempt: AssessmentAttempt): string {
    const grade = GRADE_TITLES[attempt.requestedGrade as GradeCode];
    switch (attempt.status) {
      case 'PASSED':
        return `Тест пройден: грейд ${grade} подтверждён${attempt.confident ? ' (уверенное прохождение)' : ''}.`;
      case 'FAILED':
        return `Порог прохождения на уровень ${grade} не достигнут. Подтверждённый грейд не выдан и не изменён.`;
      case 'EXPIRED':
        return 'Время теста истекло. Баллы по сохранённым ответам показаны для обратной связи; квалификация не выдаётся.';
      case 'ABANDONED':
        return 'Попытка прервана. Задержка повторной попытки на этот уровень действует как после неуспеха.';
      default:
        return 'Попытка в процессе.';
    }
  }

  // ───────────────────────────── Ответы ─────────────────────────────

  async saveAnswer(candidateId: string, attemptId: string, itemId: string, answer: unknown, revision: number) {
    const attempt = await this.ownAttempt(candidateId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') throw conflict('ATTEMPT_NOT_ACTIVE', 'Попытка уже завершена');
    if (attempt.expiresAt <= this.clock.now()) {
      await this.finalizeById(attempt.id, 'EXPIRE');
      throw conflict('ATTEMPT_EXPIRED', 'Время теста истекло');
    }
    const item = await this.prisma.assessmentItem.findFirst({ where: { id: itemId, attemptId }, select: { id: true, publicSnapshot: true } });
    if (!item) throw notFound('ITEM_NOT_FOUND', 'Задание не найдено в этой попытке');
    const shapeError = validateItemAnswerShape(item.publicSnapshot as unknown as PublicTask, answer);
    if (shapeError) throw unprocessable('ANSWER_INVALID', `Некорректный формат ответа: ${shapeError}`);

    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockAttempt(tx, attemptId, 'SHARE');
      if (locked.status !== 'IN_PROGRESS') throw conflict('ATTEMPT_NOT_ACTIVE', 'Попытка уже завершена');
      if (locked.expiresAt <= now) throw conflict('ATTEMPT_EXPIRED', 'Время теста истекло');
      const saved = await this.upsertAnswer(tx, attemptId, itemId, answer as ItemAnswer, revision, now);
      if (!saved) {
        const current = await tx.assessmentAnswer.findUnique({ where: { attemptId_itemId: { attemptId, itemId } } });
        throw conflict('STALE_REVISION', 'На сервере сохранена более новая версия ответа', {
          current: current ? { revision: current.revision, answer: current.answer, savedAt: current.savedAt.toISOString() } : null,
        });
      }
      return { itemId, revision: saved.revision, savedAt: saved.savedAt.toISOString() };
    });
  }

  /**
   * Сигналы честности от интерфейса теста: агрегированные счётчики (без содержимого). Накапливаются атомарным UPDATE только
   * у активной непросроченной попытки, с верхними границами; на баллы не влияют. Итоговая оценка — при завершении попытки.
   */
  async recordSignals(candidateId: string, attemptId: string, signals: Partial<IntegrityCounters>): Promise<void> {
    const attempt = await this.ownAttempt(candidateId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') throw conflict('ATTEMPT_NOT_ACTIVE', 'Попытка уже завершена');
    const now = this.clock.now();
    if (attempt.expiresAt <= now) {
      await this.finalizeById(attempt.id, 'EXPIRE');
      throw conflict('ATTEMPT_EXPIRED', 'Время теста истекло');
    }
    this.rateLimit.consume(`signals:${attemptId}`, RATE_LIMITS.signalsPerAttempt);
    const policy = attempt.policySnapshot as unknown as AssessmentPolicy;
    const maxHiddenMs = policy.durationMinutes * 60_000;
    const changed = await this.prisma.$executeRaw`
      UPDATE "AssessmentAttempt" SET
        "tabHiddenCount" = LEAST("tabHiddenCount" + ${signals.tabHiddenCount ?? 0}, 1000),
        "tabHiddenMs" = LEAST("tabHiddenMs" + ${signals.tabHiddenMs ?? 0}, ${maxHiddenMs}),
        "pasteCount" = LEAST("pasteCount" + ${signals.pasteCount ?? 0}, 1000),
        "copyCount" = LEAST("copyCount" + ${signals.copyCount ?? 0}, 1000),
        "focusLossCount" = LEAST("focusLossCount" + ${signals.focusLossCount ?? 0}, 1000)
      WHERE "id" = ${attemptId}::uuid AND "status" = 'IN_PROGRESS' AND "expiresAt" > ${now}`;
    if (changed === 0) throw conflict('ATTEMPT_NOT_ACTIVE', 'Попытка уже завершена');
  }

  private countersOf(attempt: Pick<AssessmentAttempt, 'tabHiddenCount' | 'tabHiddenMs' | 'pasteCount' | 'copyCount' | 'focusLossCount'>): IntegrityCounters {
    return {
      tabHiddenCount: attempt.tabHiddenCount,
      tabHiddenMs: attempt.tabHiddenMs,
      pasteCount: attempt.pasteCount,
      copyCount: attempt.copyCount,
      focusLossCount: attempt.focusLossCount,
    };
  }

  /** Условная запись: обновляет ответ, только если ревизия новее сохранённой (устаревший autosave не перезапишет свежий). */
  private async upsertAnswer(tx: Tx, attemptId: string, itemId: string, answer: ItemAnswer, revision: number, now: Date) {
    const rows = await tx.$queryRaw<Array<{ revision: number; savedAt: Date }>>`
      INSERT INTO "AssessmentAnswer" ("id", "attemptId", "itemId", "answer", "revision", "savedAt", "firstSavedAt")
      VALUES (gen_random_uuid(), ${attemptId}::uuid, ${itemId}::uuid, ${JSON.stringify(answer)}::jsonb, ${revision}, ${now}, ${now})
      ON CONFLICT ("attemptId", "itemId") DO UPDATE
        SET "answer" = EXCLUDED."answer", "revision" = EXCLUDED."revision", "savedAt" = EXCLUDED."savedAt"
        WHERE "AssessmentAnswer"."revision" < EXCLUDED."revision"
      RETURNING "revision", "savedAt"`;
    return rows[0] ?? null;
  }

  private async lockAttempt(tx: Tx, attemptId: string, mode: 'UPDATE' | 'SHARE') {
    const rows =
      mode === 'UPDATE'
        ? await tx.$queryRaw<Array<{ status: string; expiresAt: Date }>>`
            SELECT "status", "expiresAt" FROM "AssessmentAttempt" WHERE "id" = ${attemptId}::uuid FOR UPDATE`
        : await tx.$queryRaw<Array<{ status: string; expiresAt: Date }>>`
            SELECT "status", "expiresAt" FROM "AssessmentAttempt" WHERE "id" = ${attemptId}::uuid FOR SHARE`;
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  // ───────────────────────────── Завершение ─────────────────────────────

  /**
   * Завершение: сначала синхронно сохраняются переданные клиентом актуальные ответы (с проверкой ревизии),
   * затем фиксируется результат. Повторный submit возвращает тот же результат и не создаёт новую квалификацию.
   */
  async submit(candidateId: string, userId: string, attemptId: string, finalAnswers: SubmittedAnswerInput[], requestId: string) {
    const attempt = await this.ownAttempt(candidateId, attemptId);
    if (attempt.status === 'IN_PROGRESS') {
      const items = await this.prisma.assessmentItem.findMany({ where: { attemptId }, select: { id: true, publicSnapshot: true } });
      for (const final of finalAnswers) {
        const item = items.find((i) => i.id === final.itemId);
        if (!item) throw notFound('ITEM_NOT_FOUND', 'Задание не найдено в этой попытке');
        const shapeError = validateItemAnswerShape(item.publicSnapshot as unknown as PublicTask, final.answer);
        if (shapeError) throw unprocessable('ANSWER_INVALID', `Некорректный формат ответа: ${shapeError}`);
      }
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockAttempt(tx, attemptId, 'UPDATE');
        if (locked.status !== 'IN_PROGRESS') return;
        const now = this.clock.now();
        if (locked.expiresAt <= now) {
          await this.finalizeTx(tx, attemptId, 'EXPIRE', now);
          return;
        }
        for (const final of finalAnswers) {
          await this.upsertAnswer(tx, attemptId, final.itemId, final.answer, final.revision, now);
        }
        await this.finalizeTx(tx, attemptId, 'SUBMIT', now);
      });
      const finished = await this.ownAttempt(candidateId, attemptId);
      await this.audit.record({
        actorUserId: userId,
        action: 'assessment.finished',
        objectType: 'AssessmentAttempt',
        objectId: attemptId,
        requestId,
        metadata: { status: finished.status, overallScore: finished.overallScore, qualificationGranted: finished.qualificationGranted },
      });
    }
    return this.buildResult(await this.ownAttempt(candidateId, attemptId));
  }

  async abandon(candidateId: string, userId: string, attemptId: string, requestId: string) {
    const attempt = await this.ownAttempt(candidateId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') {
      if (attempt.status === 'ABANDONED' || attempt.status === 'EXPIRED') return this.summary(attempt);
      throw conflict('ATTEMPT_NOT_ACTIVE', 'Завершённую попытку нельзя прервать');
    }
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockAttempt(tx, attemptId, 'UPDATE');
      if (locked.status !== 'IN_PROGRESS') return;
      const now = this.clock.now();
      await this.finalizeTx(tx, attemptId, locked.expiresAt <= now ? 'EXPIRE' : 'ABANDON', now);
    });
    const finished = await this.ownAttempt(candidateId, attemptId);
    if (finished.status === 'ABANDONED') {
      await this.audit.record({ actorUserId: userId, action: 'assessment.abandoned', objectType: 'AssessmentAttempt', objectId: attemptId, requestId });
    } else if (finished.status !== 'EXPIRED') {
      throw conflict('ATTEMPT_NOT_ACTIVE', 'Завершённую попытку нельзя прервать');
    }
    return this.summary(finished);
  }

  /** Ленивое истечение: все просроченные активные попытки кандидата фиксируются как EXPIRED. */
  async expireStale(candidateId: string): Promise<void> {
    const stale = await this.prisma.assessmentAttempt.findMany({
      where: { candidateId, status: 'IN_PROGRESS', expiresAt: { lte: this.clock.now() } },
      select: { id: true },
    });
    for (const attempt of stale) await this.finalizeById(attempt.id, 'EXPIRE');
  }

  private async finalizeById(attemptId: string, kind: FinalizeKind): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockAttempt(tx, attemptId, 'UPDATE');
      if (locked.status !== 'IN_PROGRESS') return;
      await this.finalizeTx(tx, attemptId, kind, this.clock.now());
    });
  }

  /** Подсчёт и фиксация результата внутри транзакции (строка попытки уже заблокирована FOR UPDATE). */
  private async finalizeTx(tx: Tx, attemptId: string, kind: FinalizeKind, now: Date): Promise<void> {
    const attempt = await tx.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { items: { orderBy: { position: 'asc' } }, answers: true },
    });
    if (attempt.status !== 'IN_PROGRESS') return;
    const policy = attempt.policySnapshot as unknown as AssessmentPolicy;

    if (kind === 'ABANDON') {
      await tx.assessmentAttempt.update({
        where: { id: attemptId },
        data: { status: 'ABANDONED', finishedAt: now, qualificationGranted: false },
      });
      return;
    }

    const answers = new Map(attempt.answers.map((a) => [a.itemId, a.answer as unknown as ItemAnswer]));
    const evaluated = attempt.items.map((item) => ({
      groupCode: item.groupCode,
      evaluation: evaluateItem(item.privateKey as unknown as PrivateKey, answers.get(item.id) ?? null),
    }));
    const score = scoreAttempt(
      evaluated,
      groupsOf(attempt.specializationCode as SpecializationCode).map((g) => g.code),
      policy,
    );
    const finishedAt = kind === 'EXPIRE' ? attempt.expiresAt : now;
    const status = kind === 'EXPIRE' ? 'EXPIRED' : score.passed ? 'PASSED' : 'FAILED';
    const granted = status === 'PASSED';
    // Сигналы честности — информация о прохождении; на баллы и грейд не влияют.
    const answerRows = new Map(attempt.answers.map((a) => [a.itemId, a]));
    const integrity = evaluateIntegrity({
      kind: kind === 'EXPIRE' ? 'EXPIRE' : 'SUBMIT',
      startedAtMs: attempt.startedAt.getTime(),
      durationMs: policy.durationMinutes * 60_000,
      elapsedMs: finishedAt.getTime() - attempt.startedAt.getTime(),
      overall: score.overall,
      passOverall: policy.passOverall,
      items: attempt.items.map((item, index) => ({
        firstSavedAtMs: (answerRows.get(item.id)?.firstSavedAt ?? null)?.getTime() ?? null,
        score: evaluated[index].evaluation.earned / Math.max(1, evaluated[index].evaluation.total),
      })),
      counters: this.countersOf(attempt),
    });

    await tx.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status,
        finishedAt,
        overallScore: score.overall,
        groupScores: score.groups as unknown as Prisma.InputJsonValue,
        skillEvidence: score.skills as unknown as Prisma.InputJsonValue,
        confident: status === 'PASSED' ? score.confident : false,
        qualificationGranted: granted,
        integrity: integrity as unknown as Prisma.InputJsonValue,
      },
    });

    if (granted) await grantQualification(tx, attempt, score, policy, finishedAt);
  }

  // ───────────────────────────── Вспомогательное ─────────────────────────────

  private async ownAttempt(candidateId: string, attemptId: string): Promise<AssessmentAttempt> {
    const attempt = await this.prisma.assessmentAttempt.findFirst({ where: { id: attemptId, candidateId } });
    if (!attempt) throw notFound('ATTEMPT_NOT_FOUND', 'Попытка не найдена');
    return attempt;
  }

  private assertSpecialization(code: string): asserts code is SpecializationCode {
    if (!isSpecializationCode(code)) throw unprocessable('UNKNOWN_SPECIALIZATION', 'Неизвестная специализация');
  }
}
