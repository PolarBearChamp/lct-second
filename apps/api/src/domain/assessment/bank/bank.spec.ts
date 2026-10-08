import { getAssessmentPolicy } from '../../../config/policies';
import { GRADE_CODES, groupsOf, SPECIALIZATION_CODES } from '../../catalog/catalog';
import { buildStandardBlueprint } from '../blueprint';
import { correctAnswerFromKey, evaluateItem } from '../evaluate';
import { instantiate } from '../instantiate';
import { createRng } from '../rng';
import { scoreAttempt } from '../scoring';
import type { ItemAnswer, PrivateTaskInstance } from '../types';
import { assessableSkills, BANK_VERSION, FAMILIES, familiesFor, getFamily } from './registry';

/**
 * Свойства банка заданий на фиксированном наборе seed:
 *  - каждое семейство генерирует корректные (однозначные) экземпляры для всех грейдов;
 *  - ≥ 30 различающихся экземпляров (по отпечатку значимых условий) на пару семейство×грейд;
 *  - воспроизводимость по (версия, грейд, seed);
 *  - правильный ответ даёт полный балл, «выбрать всё» — не даёт.
 */

const SEEDS_PER_GRADE = 300;
const seeds = Array.from({ length: SEEDS_PER_GRADE }, (_, i) => `bank-test-seed-${i}`);
const policy = getAssessmentPolicy('assessment-policy-v2');

function selectAllAnswer(instance: PrivateTaskInstance): ItemAnswer {
  const parts: ItemAnswer['parts'] = {};
  for (const part of instance.public.parts) {
    if (part.format === 'MULTI_SELECT') parts[part.id] = { optionIds: part.options.map((o) => o.id) };
  }
  return { parts };
}

describe('банк заданий', () => {
  it('содержит семейства', () => {
    expect(FAMILIES.length).toBeGreaterThan(0);
    expect(BANK_VERSION).toMatch(/^bank-[0-9a-f]{10}$/);
  });

  it('id семейств уникальны', () => {
    const ids = FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const family of FAMILIES) {
    describe(family.id, () => {
      it('поддерживает все три грейда', () => {
        expect([...family.supportedGrades].sort()).toEqual([...GRADE_CODES].sort());
      });

      for (const grade of family.supportedGrades) {
        it(`${grade}: корректные, разнообразные и воспроизводимые экземпляры`, () => {
          const fingerprints = new Set<string>();
          for (const seed of seeds) {
            const instance = instantiate(family, grade, seed);
            fingerprints.add(instance.fingerprint);
            expect(instance.public.parts.length).toBeGreaterThanOrEqual(2);
            // Публичная часть не содержит ключа и семантических идентификаторов.
            const serialized = JSON.stringify(instance.public);
            expect(serialized).not.toContain('"correct');
            expect(serialized).not.toContain('semantic');

            const full = evaluateItem(instance.key, correctAnswerFromKey(instance.key));
            expect(full.earned).toBe(full.total);
            const empty = evaluateItem(instance.key, { parts: {} });
            expect(empty.earned).toBe(0);
            const selectAll = evaluateItem(instance.key, selectAllAnswer(instance));
            for (const part of selectAll.parts) {
              if (part.format === 'MULTI_SELECT') expect(part.score).toBe(0);
            }
          }
          expect(fingerprints.size).toBeGreaterThanOrEqual(30);

          const again = instantiate(family, grade, seeds[7]);
          const first = instantiate(family, grade, seeds[7]);
          expect(again).toEqual(first);
        });
      }
    });
  }

  it('для каждой реализованной специализации в каждой группе есть ≥ itemsPerGroup семейств на каждый грейд', () => {
    for (const spec of SPECIALIZATION_CODES) {
      if (familiesFor(spec).length === 0) continue;
      for (const group of groupsOf(spec)) {
        for (const grade of GRADE_CODES) {
          expect(familiesFor(spec, group.code, grade).length).toBeGreaterThanOrEqual(policy.itemsPerGroup);
        }
      }
    }
  });

  it('есть минимум 24 семейства: по два на каждую из трёх групп каждой специализации', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(24);
    for (const spec of SPECIALIZATION_CODES) {
      for (const group of groupsOf(spec)) expect(familiesFor(spec, group.code).length).toBeGreaterThanOrEqual(2);
    }
  });

  describe('навыки, объявленные проверяемыми, действительно подтверждаются идеальным прохождением', () => {
    for (const spec of SPECIALIZATION_CODES) {
      for (const grade of GRADE_CODES) {
        it(`${spec} ${grade}`, () => {
          const skills = [...assessableSkills(spec).keys()];
          expect(skills.length).toBeGreaterThan(0);
          for (let i = 0; i < 40; i += 1) {
            const seed = `coverage-${spec}-${grade}-${i}`;
            const blueprint = buildStandardBlueprint(spec, grade, createRng(seed), policy);
            const items = blueprint.slots.map((slot) => {
              const instance = instantiate(getFamily(slot.familyId)!, grade, `${seed}|${slot.position}`);
              return { groupCode: instance.groupCode, evaluation: evaluateItem(instance.key, correctAnswerFromKey(instance.key)) };
            });
            const score = scoreAttempt(items, groupsOf(spec).map((g) => g.code), policy);
            expect(score.passed).toBe(true);
            expect(score.overall).toBe(100);
            const unconfirmed = skills.filter((skill) => score.skills.find((s) => s.skill === skill)?.status !== 'CONFIRMED');
            expect(unconfirmed).toEqual([]);
            const totalParts = items.reduce((sum, item) => sum + item.evaluation.total, 0);
            expect(totalParts).toBeGreaterThanOrEqual(policy.minScoredParts);
          }
        });
      }
    }
  });
});
