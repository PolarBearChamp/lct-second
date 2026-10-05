import type { AssessmentPolicy } from '../../config/policies';
import { getGroup, getSkill, groupsOf, isKnownSkill, type GradeCode, type SpecializationCode } from '../catalog/catalog';
import { familiesFor } from './bank/registry';
import type { FamilyDefinition, Rng } from './types';

export const BLUEPRINT_VERSION = 'blueprint-v1';

export interface BlueprintSlot {
  position: number;
  groupCode: string;
  familyId: string;
}

export interface StandardBlueprint {
  version: string;
  specialization: SpecializationCode;
  grade: GradeCode;
  slots: BlueprintSlot[];
}

export class BankCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankCoverageError';
  }
}

/**
 * Общий план регистрационного теста: по itemsPerGroup мини-кейса из каждой из трёх групп,
 * семейства внутри попытки не повторяются. При выборе предпочитаются семейства, которые кандидат
 * видел реже (recentFamilyUse), но при небольшом банке повтор семейств между попытками неизбежен.
 */
export function buildStandardBlueprint(
  specialization: SpecializationCode,
  grade: GradeCode,
  rng: Rng,
  policy: Pick<AssessmentPolicy, 'itemsPerGroup'>,
  recentFamilyUse: Map<string, number> = new Map(),
): StandardBlueprint {
  const slots: BlueprintSlot[] = [];
  for (const group of groupsOf(specialization)) {
    const available = familiesFor(specialization, group.code, grade);
    if (available.length < policy.itemsPerGroup) {
      throw new BankCoverageError(
        `В группе «${group.title}» для грейда ${grade} доступно ${available.length} семейств, нужно ${policy.itemsPerGroup}`,
      );
    }
    // Случайный порядок, затем стабильная сортировка по частоте использования.
    const chosen = rng
      .shuffle(available)
      .sort((a, b) => (recentFamilyUse.get(a.id) ?? 0) - (recentFamilyUse.get(b.id) ?? 0))
      .slice(0, policy.itemsPerGroup);
    for (const family of chosen) slots.push({ position: slots.length, groupCode: group.code, familyId: family.id });
  }
  return { version: BLUEPRINT_VERSION, specialization, grade, slots };
}

// ───────────────────────── План теста по потребности работодателя ─────────────────────────

export interface NeedRequirementsInput {
  specialization: SpecializationCode;
  requiredSkills: string[];
  preferredSkills: Array<{ skill: string; mode: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY' }>;
}

export type CoverageStatus = 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'UNKNOWN_SKILL';

export interface RequirementCoverage {
  skill: string;
  title: string;
  kind: 'REQUIRED' | 'PREFERRED';
  mode?: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY';
  status: CoverageStatus;
  /** Семейства банка, которые проверяют навык (во всём банке специализации). */
  bankFamilies: Array<{ familyId: string; title: string; group: string }>;
  /** Сколько мини-кейсов плана оценивают навык. */
  casesInPlan: number;
  note: string;
}

export interface NeedBlueprintSlot extends BlueprintSlot {
  groupTitle: string;
  familyTitle: string;
  familyDescription: string;
  /** Требования потребности, которые проверяет этот мини-кейс. */
  covers: string[];
}

export interface NeedBlueprint {
  version: string;
  specialization: SpecializationCode;
  grade: GradeCode;
  slots: NeedBlueprintSlot[];
  coverage: RequirementCoverage[];
  bankNotes: string[];
}

/**
 * buildAssessmentBlueprint(need, grade):
 *  1. Валидирует навыки по справочнику.
 *  2. Сопоставляет их с семействами банка специализации.
 *  3. Строит план с сохранением трёх обязательных групп и правил сложности грейда
 *     (параметры требований выбирают семейства, но не меняют пороги и сложность грейда).
 *  4. Показывает связь «требование → навык → семейство».
 *  5. Требования без проверяющих заданий помечаются как непокрытые и ничем не подменяются.
 */
export function buildAssessmentBlueprint(
  need: NeedRequirementsInput,
  grade: GradeCode,
  policy: Pick<AssessmentPolicy, 'itemsPerGroup' | 'skillEvidence'>,
): NeedBlueprint {
  const requirements = [
    ...need.requiredSkills.map((skill) => ({ skill, kind: 'REQUIRED' as const, mode: undefined, weight: 3 })),
    ...need.preferredSkills.map((p) => ({ skill: p.skill, kind: 'PREFERRED' as const, mode: p.mode, weight: 1 })),
  ];
  const bankNotes: string[] = [];
  const slots: NeedBlueprintSlot[] = [];

  const weightOf = (family: FamilyDefinition<unknown>) =>
    requirements.reduce((sum, req) => sum + (family.skillTags.includes(req.skill) ? req.weight : 0), 0);

  for (const group of groupsOf(need.specialization)) {
    const available = familiesFor(need.specialization, group.code, grade);
    if (available.length < policy.itemsPerGroup) {
      throw new BankCoverageError(`В группе «${group.title}» недостаточно семейств для грейда ${grade}`);
    }
    if (available.length === policy.itemsPerGroup) {
      bankNotes.push(
        `Группа «${group.title}»: в банке ${available.length} семейства — выбор альтернативных семейств под требования невозможен, используются все.`,
      );
    }
    const chosen = [...available]
      .sort((a, b) => weightOf(b) - weightOf(a) || a.id.localeCompare(b.id))
      .slice(0, policy.itemsPerGroup);
    for (const family of chosen) {
      slots.push({
        position: slots.length,
        groupCode: group.code,
        groupTitle: group.title,
        familyId: family.id,
        familyTitle: family.title,
        familyDescription: family.description,
        covers: requirements.filter((req) => family.skillTags.includes(req.skill)).map((req) => req.skill),
      });
    }
  }

  const allFamilies = familiesFor(need.specialization);
  const coverage: RequirementCoverage[] = requirements.map((req) => {
    const title = getSkill(req.skill)?.title ?? req.skill;
    if (!isKnownSkill(req.skill)) {
      return {
        skill: req.skill,
        title,
        kind: req.kind,
        mode: req.mode,
        status: 'UNKNOWN_SKILL',
        bankFamilies: [],
        casesInPlan: 0,
        note: 'Навык отсутствует в справочнике',
      };
    }
    const bankFamilies = allFamilies
      .filter((family) => family.skillTags.includes(req.skill))
      .map((family) => ({ familyId: family.id, title: family.title, group: getGroup(family.group)?.title ?? family.group }));
    const casesInPlan = slots.filter((slot) => slot.covers.includes(req.skill)).length;
    let status: CoverageStatus;
    let note: string;
    if (bankFamilies.length === 0) {
      status = 'NOT_COVERED';
      note =
        req.kind === 'REQUIRED'
          ? 'В банке нет заданий, проверяющих этот навык: подтвердить его тестом нельзя.'
          : req.mode === 'VERIFIED_ONLY'
            ? 'Навык не проверяется тестами — в режиме «только подтверждённые» он не даст вклада никому.'
            : 'Навык не проверяется тестами — учитывается только самоописание кандидата.';
    } else if (casesInPlan >= policy.skillEvidence.minCases) {
      status = 'COVERED';
      note = `Оценивается в ${casesInPlan} мини-кейсах — достаточно для подтверждения навыка.`;
    } else {
      status = 'PARTIAL';
      note = `Оценивается в ${casesInPlan} мини-кейсе(ах) — меньше ${policy.skillEvidence.minCases}, навык получит статус «недостаточно данных».`;
    }
    return { skill: req.skill, title, kind: req.kind, mode: req.mode, status, bankFamilies, casesInPlan, note };
  });

  return { version: BLUEPRINT_VERSION, specialization: need.specialization, grade, slots, coverage, bankNotes };
}
