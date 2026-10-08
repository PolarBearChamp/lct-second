/**
 * Возраст кандидата. Платформа доступна с 16 лет (ответ организаторов на встрече с участниками: поддержка 16–17 лет — плюс).
 * Для 16–17 лет нужны согласие законного представителя и особые условия труда (ТК РФ, гл. 42: сокращённое время, запрет
 * вредных и ночных работ и др.); работодатель видит только признак «16–17 лет», а не дату рождения.
 */

export const MIN_PUBLICATION_AGE = 16;
export const ADULT_AGE = 18;

/** Полных лет на дату now (по календарю UTC: дата рождения хранится как дата без времени). */
export function ageAt(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() || (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export type AgeGroup = 'UNDER_16' | 'MINOR_16_17' | 'ADULT';

export function ageGroup(birthDate: Date | null, now: Date): AgeGroup | null {
  if (!birthDate) return null;
  const age = ageAt(birthDate, now);
  if (age < MIN_PUBLICATION_AGE) return 'UNDER_16';
  if (age < ADULT_AGE) return 'MINOR_16_17';
  return 'ADULT';
}

export const isMinor = (birthDate: Date | null, now: Date): boolean => ageGroup(birthDate, now) === 'MINOR_16_17';

/** Правдоподобная дата рождения: не в будущем, возраст от 10 до 100 лет. */
export function isPlausibleBirthDate(birthDate: Date, now: Date): boolean {
  if (Number.isNaN(birthDate.getTime()) || birthDate > now) return false;
  const age = ageAt(birthDate, now);
  return age >= 10 && age <= 100;
}
