import { formatCooldown, type AssessmentPolicy } from '../../config/policies';
import { GRADE_ORDER, GRADE_TITLES, type GradeCode } from '../catalog/catalog';

export type AttemptStatusCode = 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'EXPIRED' | 'ABANDONED';
export const UNSUCCESSFUL_STATUSES: AttemptStatusCode[] = ['FAILED', 'EXPIRED', 'ABANDONED'];

export interface EligibilityAttempt {
  specializationCode: string;
  requestedGrade: GradeCode;
  status: AttemptStatusCode;
  finishedAt: Date | null;
}

export interface EligibilityInput {
  now: Date;
  specialization: string;
  grade: GradeCode;
  policy: Pick<AssessmentPolicy, 'retryCooldownHours' | 'reassessmentDays'>;
  /** Подтверждённая квалификация по этой специализации. */
  qualification: { confirmedGrade: GradeCode; nextReassessmentAt: Date } | null;
  /** Завершённые попытки кандидата (любые специализации — фильтр внутри). */
  attempts: EligibilityAttempt[];
  /** Активная (не истёкшая) попытка кандидата по любой специализации. */
  activeAttempt: { id: string; specializationCode: string; requestedGrade: GradeCode } | null;
}

export type EligibilityReason = 'ACTIVE_ATTEMPT' | 'REASSESSMENT_LOCKED' | 'RETRY_COOLDOWN';

export interface EligibilityWarning {
  code: 'REPLACES_WITH_LOWER_GRADE' | 'RECONFIRMS_GRADE' | 'RAISES_GRADE';
  message: string;
}

export interface EligibilityResult {
  grade: GradeCode;
  allowed: boolean;
  reason?: EligibilityReason;
  message: string;
  /** Когда попытка станет доступна (UTC), если сейчас запрещена по сроку. */
  availableAt?: Date;
  activeAttemptId?: string;
  warnings: EligibilityWarning[];
}

const HOUR_MS = 3_600_000;

/**
 * Правила допуска к оценке (assessment-policy):
 *  - не более одной активной попытки;
 *  - после подтверждения специализации новая официальная оценка — не раньше nextReassessmentAt;
 *  - повтор той же пары специализация+грейд после неуспеха — не раньше чем через retryCooldownHours;
 *  - более низкий грейд можно выбрать сразу, если для него нет собственной задержки;
 *  - специализации независимы.
 */
export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const { now, grade, qualification, activeAttempt, policy } = input;
  const warnings: EligibilityWarning[] = [];

  if (activeAttempt) {
    return {
      grade,
      allowed: false,
      reason: 'ACTIVE_ATTEMPT',
      activeAttemptId: activeAttempt.id,
      message: 'У вас есть незавершённая попытка тестирования. Завершите или прервите её, чтобы начать новую.',
      warnings,
    };
  }

  if (qualification && now < qualification.nextReassessmentAt) {
    return {
      grade,
      allowed: false,
      reason: 'REASSESSMENT_LOCKED',
      availableAt: qualification.nextReassessmentAt,
      message: `Грейд по этой специализации подтверждён. Новая официальная оценка станет доступна через ${policy.reassessmentDays} дней после подтверждения.`,
      warnings,
    };
  }

  const lastUnsuccessful = input.attempts
    .filter(
      (attempt) =>
        attempt.specializationCode === input.specialization &&
        attempt.requestedGrade === grade &&
        UNSUCCESSFUL_STATUSES.includes(attempt.status) &&
        attempt.finishedAt,
    )
    .sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())[0];
  if (lastUnsuccessful) {
    const availableAt = new Date(lastUnsuccessful.finishedAt!.getTime() + policy.retryCooldownHours * HOUR_MS);
    if (now < availableAt) {
      return {
        grade,
        allowed: false,
        reason: 'RETRY_COOLDOWN',
        availableAt,
        message: `Повторная попытка на уровень ${GRADE_TITLES[grade]} возможна через ${formatCooldown(policy.retryCooldownHours)} после завершения предыдущей неуспешной попытки.`,
        warnings,
      };
    }
  }

  if (qualification) {
    const current = qualification.confirmedGrade;
    if (GRADE_ORDER[grade] < GRADE_ORDER[current]) {
      warnings.push({
        code: 'REPLACES_WITH_LOWER_GRADE',
        message: `Успешный результат заменит действующий грейд ${GRADE_TITLES[current]} на ${GRADE_TITLES[grade]}. Неуспех не изменит текущий грейд.`,
      });
    } else if (grade === current) {
      warnings.push({
        code: 'RECONFIRMS_GRADE',
        message: `Успешный результат подтвердит грейд ${GRADE_TITLES[grade]} заново и обновит дату следующей оценки.`,
      });
    } else {
      warnings.push({
        code: 'RAISES_GRADE',
        message: `Успешный результат повысит грейд до ${GRADE_TITLES[grade]}. Неуспех не изменит текущий грейд ${GRADE_TITLES[current]}.`,
      });
    }
  }

  return { grade, allowed: true, message: 'Тест можно начать сейчас.', warnings };
}
