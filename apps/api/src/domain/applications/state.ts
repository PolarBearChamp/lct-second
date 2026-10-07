/**
 * Статусы отклика кандидата на вакансию и допустимые переходы:
 *   SENT → VIEWED                         работодатель явно открыл отклик
 *   SENT / VIEWED → SHORTLISTED           работодатель взял кандидата в шорт-лист
 *   SENT / VIEWED / SHORTLISTED → REJECTED    работодатель отклонил
 *   SENT / VIEWED / SHORTLISTED → WITHDRAWN   кандидат отозвал отклик
 * REJECTED и WITHDRAWN — финальные и не переходят друг в друга.
 */
export type ApplicationStatusCode = 'SENT' | 'VIEWED' | 'SHORTLISTED' | 'REJECTED' | 'WITHDRAWN';

export const ACTIVE_APPLICATION_STATUSES: ApplicationStatusCode[] = ['SENT', 'VIEWED', 'SHORTLISTED'];
export const FINAL_APPLICATION_STATUSES: ApplicationStatusCode[] = ['REJECTED', 'WITHDRAWN'];

const TRANSITIONS: Record<ApplicationStatusCode, ApplicationStatusCode[]> = {
  SENT: ['VIEWED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'],
  VIEWED: ['SHORTLISTED', 'REJECTED', 'WITHDRAWN'],
  SHORTLISTED: ['REJECTED', 'WITHDRAWN'],
  REJECTED: [],
  WITHDRAWN: [],
};

export function canTransitionApplication(from: ApplicationStatusCode, to: ApplicationStatusCode): boolean {
  return TRANSITIONS[from].includes(to);
}

export const isActiveApplication = (status: string) => ACTIVE_APPLICATION_STATUSES.includes(status as ApplicationStatusCode);

/** Откуда допустим переход в `to` — для условного UPDATE (WHERE status IN …). */
export function sourcesOf(to: ApplicationStatusCode): ApplicationStatusCode[] {
  return (Object.keys(TRANSITIONS) as ApplicationStatusCode[]).filter((from) => TRANSITIONS[from].includes(to));
}

const LIFECYCLE_RANK: Record<ApplicationStatusCode, number> = { SENT: 0, VIEWED: 1, SHORTLISTED: 2, REJECTED: 3, WITHDRAWN: 3 };

/** Порядок истории: по времени, при совпадении меток — по ходу жизненного цикла (SENT → VIEWED → … → итог). */
export function compareApplicationEvents(a: { occurredAt: Date; toStatus: string }, b: { occurredAt: Date; toStatus: string }): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  return LIFECYCLE_RANK[a.toStatus as ApplicationStatusCode] - LIFECYCLE_RANK[b.toStatus as ApplicationStatusCode];
}

// ───────────────────────────── Вакансия ─────────────────────────────

export type VacancyStatusCode = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

/** DRAFT → PUBLISHED (публикация); PUBLISHED → CLOSED (закрытие); CLOSED → PUBLISHED (повторное открытие). */
const VACANCY_TRANSITIONS: Record<VacancyStatusCode, VacancyStatusCode[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['CLOSED'],
  CLOSED: ['PUBLISHED'],
};

export const canTransitionVacancy = (from: VacancyStatusCode, to: VacancyStatusCode) => VACANCY_TRANSITIONS[from].includes(to);

export function vacancySources(to: VacancyStatusCode): VacancyStatusCode[] {
  return (Object.keys(VACANCY_TRANSITIONS) as VacancyStatusCode[]).filter((from) => VACANCY_TRANSITIONS[from].includes(to));
}

// ───────────────────────────── Допуск к отклику ─────────────────────────────

export type ApplyBlockerCode =
  | 'VACANCY_NOT_OPEN'
  | 'QUALIFICATION_REQUIRED'
  | 'PROFILE_INCOMPLETE'
  | 'NO_CONTACT_CHANNEL'
  | 'ACTIVE_APPLICATION_EXISTS';

export interface ApplyBlocker {
  code: ApplyBlockerCode;
  message: string;
  missingFields?: string[];
}

export interface ApplyFacts {
  vacancyStatus: VacancyStatusCode;
  vacancySpecialization: string;
  /** Специализации, по которым у кандидата есть подтверждённая тестом квалификация. */
  confirmedSpecializations: string[];
  /** Незаполненные обязательные поля профиля (как для публикации). */
  missingProfileFields: string[];
  /** Заполненные каналы связи, выбранные для раскрытия. */
  usableChannels: string[];
  hasActiveApplication: boolean;
}

/**
 * Что мешает кандидату откликнуться. Пустой список — отклик возможен.
 * Подтверждённая квалификация нужна по специализации вакансии (категория определяется тестом, а не самоописанием), но грейд и
 * обязательные навыки НЕ блокируют отклик: кандидат вправе проявить инициативу, а работодатель видит, что именно не подтверждено.
 */
export function applyBlockers(facts: ApplyFacts, titles: { specialization: string; fields: (codes: string[]) => string }): ApplyBlocker[] {
  const blockers: ApplyBlocker[] = [];
  if (facts.vacancyStatus !== 'PUBLISHED') {
    blockers.push({ code: 'VACANCY_NOT_OPEN', message: 'Вакансия закрыта для откликов' });
    return blockers;
  }
  if (facts.hasActiveApplication) {
    blockers.push({ code: 'ACTIVE_APPLICATION_EXISTS', message: 'Вы уже откликнулись на эту вакансию' });
  }
  if (!facts.confirmedSpecializations.includes(facts.vacancySpecialization)) {
    blockers.push({
      code: 'QUALIFICATION_REQUIRED',
      message: `Для отклика нужен грейд, подтверждённый тестом по специализации «${titles.specialization}». Пройдите тестирование в разделе «Тестирование».`,
    });
  }
  if (facts.missingProfileFields.length) {
    blockers.push({
      code: 'PROFILE_INCOMPLETE',
      message: `Заполните профиль: ${titles.fields(facts.missingProfileFields)}`,
      missingFields: facts.missingProfileFields,
    });
  }
  if (facts.usableChannels.length === 0) {
    blockers.push({
      code: 'NO_CONTACT_CHANNEL',
      message: 'Выберите хотя бы один канал связи для раскрытия компании и заполните его в разделе «Приватность и ФСП»',
    });
  }
  return blockers;
}
