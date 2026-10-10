/**
 * Версионируемые серверные политики MVP.
 *
 * Значения — рабочие допущения команды (см. docs/assumptions.md), а не требования ТЗ.
 * Чтобы изменить порог или срок, добавьте новую версию политики и переключите её через env;
 * завершённые попытки и подборки хранят версию и снимок параметров, по которым получены.
 */

export interface AssessmentPolicy {
  version: string;
  /** Длительность попытки, минуты. */
  durationMinutes: number;
  /** Мини-кейсов на каждую из трёх групп компетенций. */
  itemsPerGroup: number;
  /** Минимум оцениваемых частей в тесте. */
  minScoredParts: number;
  /** Проходной общий балл (среднее трёх групп), включительно. */
  passOverall: number;
  /** Минимальный балл каждой группы для прохождения. */
  passGroupMin: number;
  /** «Уверенное прохождение»: общий балл. */
  confidentOverall: number;
  /** «Уверенное прохождение»: минимум каждой группы. */
  confidentGroupMin: number;
  skillEvidence: {
    /** Навык должен быть оценён минимум в стольких разных кейсах. */
    minCases: number;
    /** Минимальный результат по навыку (0..100). */
    minScore: number;
  };
  /** Повтор той же пары специализация+грейд после неуспешной попытки, часы. */
  retryCooldownHours: number;
  /** Новая официальная оценка специализации после подтверждения, дни. */
  reassessmentDays: number;
  /** Попыток сгенерировать экземпляр с новым отпечатком, прежде чем допустить повтор. */
  maxFingerprintRetries: number;
}

export const ASSESSMENT_POLICIES: Record<string, AssessmentPolicy> = {
  'assessment-policy-v1': {
    version: 'assessment-policy-v1',
    durationMinutes: 30,
    itemsPerGroup: 2,
    minScoredParts: 12,
    passOverall: 75,
    passGroupMin: 50,
    confidentOverall: 90,
    confidentGroupMin: 75,
    skillEvidence: { minCases: 2, minScore: 70 },
    retryCooldownHours: 24,
    reassessmentDays: 90,
    maxFingerprintRetries: 40,
  },
  /**
   * v2: повтор того же уровня после неуспеха — через 30 дней, а не 24 часа (организаторы на встрече с участниками привели
   * в пример «месяц или два» и для смены грейда, и для повтора того же уровня). Пороги не менялись. Более низкий уровень
   * после неуспеха по-прежнему доступен сразу.
   */
  'assessment-policy-v2': {
    version: 'assessment-policy-v2',
    durationMinutes: 30,
    itemsPerGroup: 2,
    minScoredParts: 12,
    passOverall: 75,
    passGroupMin: 50,
    confidentOverall: 90,
    confidentGroupMin: 75,
    skillEvidence: { minCases: 2, minScore: 70 },
    retryCooldownHours: 30 * 24,
    reassessmentDays: 90,
    maxFingerprintRetries: 40,
  },
};

/** Текущая политика оценки по умолчанию (переопределяется ASSESSMENT_POLICY_VERSION). */
export const DEFAULT_ASSESSMENT_POLICY = 'assessment-policy-v2';

/** «30 дней» или «24 ч» — срок задержки в понятном виде. */
export function formatCooldown(hours: number): string {
  if (hours % 24 !== 0) return `${hours} ч`;
  const days = hours / 24;
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней';
  return `${days} ${word}`;
}

export interface MatchingFormula {
  version: string;
  /** Веса подбора по потребности: score = Σ weight · component (компоненты 0..1). */
  needWeights: { preferredFit: number; assessmentQuality: number; fspEvidence: number };
  /** Веса внутри категории общего банка. */
  bankWeights: { assessmentQuality: number; fspEvidence: number };
  /** Вклад навыка, указанного кандидатом без подтверждения, если режим требования это допускает. */
  selfReportedCredit: number;
  fsp: {
    participationPoints: number;
    prizePoints: number;
    winPoints: number;
    /** Нормировка: min(sum / normalizer, 1). */
    normalizer: number;
    relevanceVersion: string;
  };
}

export const MATCHING_FORMULAS: Record<string, MatchingFormula> = {
  'matching-formula-v1': {
    version: 'matching-formula-v1',
    needWeights: { preferredFit: 70, assessmentQuality: 25, fspEvidence: 5 },
    bankWeights: { assessmentQuality: 95, fspEvidence: 5 },
    selfReportedCredit: 0.3,
    fsp: { participationPoints: 1, prizePoints: 2, winPoints: 3, normalizer: 6, relevanceVersion: 'fsp-relevance-v1' },
  },
};

/**
 * Пороги сигналов честности прохождения теста (domain/assessment/integrity.ts). Рабочие допущения команды, не
 * откалиброванные на людях; на баллы и грейд не влияют, поэтому версионируются отдельно от политики оценки.
 */
export interface IntegrityPolicy {
  version: string;
  /** Тест завершён быстрее этой доли отведённого времени при результате не ниже проходного. */
  fastCompletionShare: number;
  /** Кейс решён полностью верно быстрее стольких секунд после предыдущего сохранения. */
  fastItemSeconds: number;
  /** Сколько таких кейсов нужно для сигнала. */
  fastItemsMin: number;
  /** Сколько раз вкладка скрывалась для замечания и для предупреждения. */
  tabHiddenNote: number;
  tabHiddenAttention: number;
  /** Суммарное время со скрытой вкладкой (мс) для предупреждения. */
  tabHiddenAttentionMs: number;
  pasteNote: number;
  pasteAttention: number;
  copyNote: number;
}

export const INTEGRITY_POLICY: IntegrityPolicy = {
  version: 'integrity-signals-v1',
  fastCompletionShare: 0.2,
  fastItemSeconds: 15,
  fastItemsMin: 3,
  tabHiddenNote: 3,
  tabHiddenAttention: 8,
  tabHiddenAttentionMs: 5 * 60_000,
  pasteNote: 1,
  pasteAttention: 3,
  copyNote: 3,
};

export interface InvitationPolicy {
  version: string;
  ttlDays: number;
}

export const INVITATION_POLICIES: Record<string, InvitationPolicy> = {
  'invitation-policy-v1': { version: 'invitation-policy-v1', ttlDays: 14 },
};

/** Версии документов, на которые даётся согласие. */
export const CONSENT_POLICY_VERSIONS = {
  DATA_PROCESSING: 'privacy-policy-2026-10',
  PROFILE_PUBLICATION: 'profile-publication-2026-10',
  GUARDIAN_CONSENT: 'guardian-consent-2026-10',
} as const;

export const ONBOARDING_SURVEY_VERSION = 'onboarding-survey-v1';

function pick<T>(registry: Record<string, T>, version: string, kind: string): T {
  const policy = registry[version];
  if (!policy) {
    throw new Error(`Неизвестная версия ${kind}: ${version}. Доступны: ${Object.keys(registry).join(', ')}`);
  }
  return policy;
}

export const getAssessmentPolicy = (version: string) => pick(ASSESSMENT_POLICIES, version, 'политики оценки');
export const getMatchingFormula = (version: string) => pick(MATCHING_FORMULAS, version, 'формулы подбора');
export const getInvitationPolicy = (version: string) => pick(INVITATION_POLICIES, version, 'политики приглашений');
