import { ageGroup, MIN_PUBLICATION_AGE } from './age';

/**
 * Условия попадания кандидата в поиск работодателей (все одновременно):
 *  1. Email подтверждён.
 *  2. Обязательные поля профиля заполнены и выбран хотя бы один канал связи с заполненным значением.
 *  3. Действует согласие на публикацию профиля и включена видимость (isDiscoverable).
 *  4. Статус готовности ACTIVE.
 *  5. Возраст не меньше 16 лет; для 16–17 лет — действующее согласие законного представителя.
 *
 * Подтверждённый тестом грейд **не** обязателен (рекомендация организаторов на встрече с участниками: не скрывать кандидата,
 * а показывать ниже с пометкой). Без подтверждения кандидат виден работодателям после всех подтверждённых, с пометкой
 * «грейд не подтверждён»; категорию по-прежнему определяет только тест. Признак — gradeConfirmed.
 *
 * Одна и та же функция используется для экрана кандидата, /auth/me и фильтра подбора.
 */

export type DiscoverabilityIssueCode =
  | 'EMAIL_NOT_VERIFIED'
  | 'PROFILE_INCOMPLETE'
  | 'NO_CONTACT_CHANNEL'
  | 'NO_PUBLICATION_CONSENT'
  | 'NOT_DISCOVERABLE'
  | 'PAUSED'
  | 'NO_CONFIRMED_QUALIFICATION'
  | 'UNDERAGE'
  | 'GUARDIAN_CONSENT_REQUIRED';

export interface DiscoverabilityIssue {
  code: DiscoverabilityIssueCode;
  message: string;
  missingFields?: string[];
}

export interface DiscoverabilityFacts {
  emailVerified: boolean;
  fullName: string | null;
  city: string | null;
  timezone: string | null;
  workFormats: string[];
  activeSpecializationCode: string | null;
  declaredGrade: string | null;
  experienceMonths: number | null;
  skillsCount: number;
  disclosureChannels: string[];
  contactEmail: string | null;
  phone: string | null;
  messenger: string | null;
  hasActivePublicationConsent: boolean;
  isDiscoverable: boolean;
  availability: string;
  /** Специализации, по которым есть подтверждённая квалификация. */
  confirmedSpecializations: string[];
  birthDate: Date | null;
  /** Действующее согласие законного представителя (для кандидатов 16–17 лет). */
  hasGuardianConsent: boolean;
}

export const REQUIRED_PROFILE_FIELDS: Array<{ field: string; title: string; check: (facts: DiscoverabilityFacts) => boolean }> = [
  { field: 'fullName', title: 'ФИО', check: (f) => Boolean(f.fullName?.trim()) },
  { field: 'city', title: 'город', check: (f) => Boolean(f.city?.trim()) },
  { field: 'timezone', title: 'часовой пояс', check: (f) => Boolean(f.timezone) },
  { field: 'workFormats', title: 'формат работы', check: (f) => f.workFormats.length > 0 },
  { field: 'activeSpecializationCode', title: 'специализация', check: (f) => Boolean(f.activeSpecializationCode) },
  { field: 'declaredGrade', title: 'заявленный грейд', check: (f) => Boolean(f.declaredGrade) },
  { field: 'experienceMonths', title: 'опыт в месяцах', check: (f) => f.experienceMonths !== null },
  { field: 'skills', title: 'стек из справочника', check: (f) => f.skillsCount > 0 },
  { field: 'birthDate', title: 'дата рождения', check: (f) => f.birthDate !== null },
];

/** Каналы связи, которые реально можно раскрыть (выбраны и заполнены). */
export function usableContactChannels(facts: Pick<DiscoverabilityFacts, 'disclosureChannels' | 'contactEmail' | 'phone' | 'messenger'>): string[] {
  return facts.disclosureChannels.filter((channel) => {
    if (channel === 'EMAIL') return Boolean(facts.contactEmail?.trim());
    if (channel === 'PHONE') return Boolean(facts.phone?.trim());
    if (channel === 'MESSENGER') return Boolean(facts.messenger?.trim());
    return false;
  });
}

export function missingProfileFields(facts: DiscoverabilityFacts): string[] {
  return REQUIRED_PROFILE_FIELDS.filter((rule) => !rule.check(facts)).map((rule) => rule.field);
}

export interface DiscoverabilityResult {
  discoverable: boolean;
  /** Есть подтверждённый тестом грейд по активной специализации (иначе кандидат виден ниже подтверждённых, с пометкой). */
  gradeConfirmed: boolean;
  issues: DiscoverabilityIssue[];
}

export function evaluateDiscoverability(facts: DiscoverabilityFacts, now: Date = new Date()): DiscoverabilityResult {
  const issues: DiscoverabilityIssue[] = [];
  if (!facts.emailVerified) issues.push({ code: 'EMAIL_NOT_VERIFIED', message: 'Email не подтверждён' });

  const missing = missingProfileFields(facts);
  if (missing.length) {
    const titles = REQUIRED_PROFILE_FIELDS.filter((rule) => missing.includes(rule.field)).map((rule) => rule.title);
    issues.push({ code: 'PROFILE_INCOMPLETE', message: `Не заполнены поля: ${titles.join(', ')}`, missingFields: missing });
  }
  if (usableContactChannels(facts).length === 0) {
    issues.push({
      code: 'NO_CONTACT_CHANNEL',
      message: 'Выберите хотя бы один канал связи для раскрытия после принятия приглашения и заполните его',
    });
  }
  if (!facts.hasActivePublicationConsent) {
    issues.push({ code: 'NO_PUBLICATION_CONSENT', message: 'Нет согласия на публикацию профиля работодателям' });
  }
  if (!facts.isDiscoverable) issues.push({ code: 'NOT_DISCOVERABLE', message: 'Профиль скрыт из поиска' });
  if (facts.availability !== 'ACTIVE') issues.push({ code: 'PAUSED', message: 'Вы приостановили рассмотрение предложений' });
  const group = ageGroup(facts.birthDate, now);
  if (group === 'UNDER_16') issues.push({ code: 'UNDERAGE', message: `Публикация профиля доступна с ${MIN_PUBLICATION_AGE} лет` });
  if (group === 'MINOR_16_17' && !facts.hasGuardianConsent) {
    issues.push({ code: 'GUARDIAN_CONSENT_REQUIRED', message: 'Кандидатам 16–17 лет нужно согласие законного представителя (раздел «Приватность и ФСП»)' });
  }
  const gradeConfirmed = Boolean(facts.activeSpecializationCode && facts.confirmedSpecializations.includes(facts.activeSpecializationCode));
  return { discoverable: issues.length === 0, gradeConfirmed, issues };
}
