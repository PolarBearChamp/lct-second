import { addDays } from '../../common/clock';
import type { AssessmentPolicy } from '../../config/policies';
import { isHigherGrade, type AttemptScore } from '../../domain/assessment/scoring';
import type { GradeCode } from '../../domain/catalog/catalog';
import type { AssessmentAttempt, Grade, Prisma, QualificationEventType } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/**
 * Выдача или обновление подтверждённой квалификации по успешной попытке (внутри транзакции завершения попытки).
 * Используется сервисом тестирования и сидером синтетических данных — правила одни и те же:
 *  - квалификация одна на пару кандидат+специализация, новая дата переоценки = момент подтверждения + reassessmentDays;
 *  - каждое подтверждение записывается в неизменяемую историю (CONFIRMED / RECONFIRMED / RAISED / LOWERED_BY_CHOICE).
 */
export async function grantQualification(tx: Tx, attempt: AssessmentAttempt, score: AttemptScore, policy: AssessmentPolicy, at: Date): Promise<void> {
  const key = { candidateId: attempt.candidateId, specializationCode: attempt.specializationCode };
  const existing = await tx.candidateQualification.findUnique({ where: { candidateId_specializationCode: key } });
  const grade = attempt.requestedGrade as GradeCode;
  let eventType: QualificationEventType = 'CONFIRMED';
  if (existing) {
    const previous = existing.confirmedGrade as GradeCode;
    eventType = previous === grade ? 'RECONFIRMED' : isHigherGrade(grade, previous) ? 'RAISED' : 'LOWERED_BY_CHOICE';
  }
  const data = {
    confirmedGrade: grade as Grade,
    attemptId: attempt.id,
    overallScore: score.overall,
    groupScores: score.groups as unknown as Prisma.InputJsonValue,
    skillEvidence: score.skills as unknown as Prisma.InputJsonValue,
    verifiedSkills: score.skills.filter((s) => s.status === 'CONFIRMED').map((s) => s.skill),
    confirmedAt: at,
    nextReassessmentAt: addDays(at, policy.reassessmentDays),
    policyVersion: policy.version,
  };
  await tx.candidateQualification.upsert({
    where: { candidateId_specializationCode: key },
    create: { ...key, ...data },
    update: data,
  });
  await tx.qualificationHistory.create({
    data: {
      ...key,
      eventType,
      grade: grade as Grade,
      previousGrade: existing?.confirmedGrade ?? null,
      attemptId: attempt.id,
      overallScore: score.overall,
      groupScores: score.groups as unknown as Prisma.InputJsonValue,
      policyVersion: policy.version,
      occurredAt: at,
    },
  });
}
