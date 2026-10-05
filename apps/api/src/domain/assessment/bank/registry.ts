import { createHash } from 'node:crypto';
import type { GradeCode, SpecializationCode } from '../../catalog/catalog';
import type { AnyFamilyDefinition } from '../types';
import { BACKEND_FAMILIES } from './backend';
import { FRONTEND_FAMILIES } from './frontend';
import { ML_FAMILIES } from './ml';
import { QA_FAMILIES } from './qa';

/** Все семейства банка. Порядок не влияет на генерацию (выбор идёт по id). */
export const FAMILIES: AnyFamilyDefinition[] = [...FRONTEND_FAMILIES, ...BACKEND_FAMILIES, ...ML_FAMILIES, ...QA_FAMILIES];

const familyIndex = new Map(FAMILIES.map((family) => [family.id, family]));

export function getFamily(id: string): AnyFamilyDefinition | undefined {
  return familyIndex.get(id);
}

export function familiesFor(specialization: SpecializationCode, group?: string, grade?: GradeCode): AnyFamilyDefinition[] {
  return FAMILIES.filter(
    (family) =>
      family.specialization === specialization &&
      (!group || family.group === group) &&
      (!grade || family.supportedGrades.includes(grade)),
  ).sort((a, b) => a.id.localeCompare(b.id));
}

/** Версия банка — хеш списка семейств и их версий. Сохраняется в каждой попытке. */
export const BANK_VERSION = `bank-${createHash('sha256')
  .update(
    FAMILIES.map((family) => `${family.id}@${family.version}`)
      .sort()
      .join('|'),
  )
  .digest('hex')
  .slice(0, 10)}`;

/** Навыки, которые реально проверяются семействами специализации (навык → семейства). */
export function assessableSkills(specialization: SpecializationCode): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const family of familiesFor(specialization)) {
    for (const tag of family.skillTags) result.set(tag, [...(result.get(tag) ?? []), family.id]);
  }
  return result;
}

export function isAssessable(specialization: SpecializationCode, skill: string): boolean {
  return assessableSkills(specialization).has(skill);
}
