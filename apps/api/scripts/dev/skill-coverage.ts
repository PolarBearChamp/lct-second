// Отладка: сколько мини-кейсов оценивает каждый навык (минимум по seed) для каждой специализации и грейда.
import { GRADE_CODES, groupsOf, SPECIALIZATION_CODES } from '../../src/domain/catalog/catalog';
import { getAssessmentPolicy } from '../../src/config/policies';
import { buildStandardBlueprint } from '../../src/domain/assessment/blueprint';
import { getFamily } from '../../src/domain/assessment/bank/registry';
import { instantiate } from '../../src/domain/assessment/instantiate';
import { createRng } from '../../src/domain/assessment/rng';

const policy = getAssessmentPolicy('assessment-policy-v2');
for (const spec of SPECIALIZATION_CODES) {
  for (const grade of GRADE_CODES) {
    const min = new Map<string, number>();
    for (let i = 0; i < 60; i += 1) {
      const seed = `cov-${spec}-${grade}-${i}`;
      const blueprint = buildStandardBlueprint(spec, grade, createRng(seed), policy);
      const cases = new Map<string, Set<number>>();
      blueprint.slots.forEach((slot) => {
        const inst = instantiate(getFamily(slot.familyId)!, grade, `${seed}|${slot.position}`);
        for (const part of inst.key.parts) for (const tag of part.skillTags) cases.set(tag, (cases.get(tag) ?? new Set()).add(slot.position));
      });
      const declared = new Set(blueprint.slots.flatMap((slot) => getFamily(slot.familyId)!.skillTags));
      for (const tag of declared) min.set(tag, Math.min(min.get(tag) ?? 99, cases.get(tag)?.size ?? 0));
    }
    console.log(`${spec} ${grade}:`, [...min.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' '));
  }
}
void groupsOf;
