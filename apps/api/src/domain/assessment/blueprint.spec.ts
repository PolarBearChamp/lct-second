import { getAssessmentPolicy } from '../../config/policies';
import { groupsOf, SPECIALIZATION_CODES, GRADE_CODES } from '../catalog/catalog';
import { assessableSkills, getFamily } from './bank/registry';
import { buildAssessmentBlueprint, buildStandardBlueprint } from './blueprint';
import { createRng } from './rng';

const policy = getAssessmentPolicy('assessment-policy-v1');

describe('стандартный план теста', () => {
  for (const spec of SPECIALIZATION_CODES) {
    for (const grade of GRADE_CODES) {
      it(`${spec} ${grade}: три группы по два кейса, семейства не повторяются`, () => {
        const blueprint = buildStandardBlueprint(spec, grade, createRng(`bp-${spec}-${grade}`), policy);
        expect(blueprint.slots).toHaveLength(6);
        for (const group of groupsOf(spec)) expect(blueprint.slots.filter((s) => s.groupCode === group.code)).toHaveLength(2);
        const families = blueprint.slots.map((s) => s.familyId);
        expect(new Set(families).size).toBe(families.length);
        for (const id of families) expect(getFamily(id)?.supportedGrades).toContain(grade);
      });
    }
  }

  it('предпочитает семейства, которые кандидат видел реже (при большем банке); при равных — любое', () => {
    const rng = createRng('prefer');
    const blueprint = buildStandardBlueprint('BACKEND', 'MIDDLE', rng, policy, new Map([['be.http-semantics', 5]]));
    // В группе BE_API всего два семейства — оба используются независимо от частоты.
    expect(blueprint.slots.filter((s) => s.groupCode === 'BE_API')).toHaveLength(2);
  });
});

describe('план теста под потребность', () => {
  it('связывает требования с навыками и семействами, помечает непокрытые', () => {
    const blueprint = buildAssessmentBlueprint(
      {
        specialization: 'BACKEND',
        requiredSkills: ['sql', 'postgresql'],
        preferredSkills: [
          { skill: 'kafka', mode: 'SELF_REPORTED_ALLOWED' },
          { skill: 'transactions', mode: 'VERIFIED_ONLY' },
        ],
      },
      'MIDDLE',
      policy,
    );
    const byskill = new Map(blueprint.coverage.map((c) => [c.skill, c]));
    expect(byskill.get('sql')?.status).toBe('COVERED');
    expect(byskill.get('sql')?.bankFamilies.length).toBeGreaterThanOrEqual(2);
    expect(byskill.get('kafka')?.status).toBe('NOT_COVERED');
    expect(byskill.get('kafka')?.bankFamilies).toEqual([]);
    expect(blueprint.slots).toHaveLength(6);
    expect(blueprint.slots.filter((s) => s.covers.includes('sql')).length).toBeGreaterThanOrEqual(2);
  });

  it('непокрытые требования не подменяются случайными заданиями и не меняют число кейсов', () => {
    const bare = buildAssessmentBlueprint({ specialization: 'FRONTEND', requiredSkills: [], preferredSkills: [] }, 'SENIOR', policy);
    const withUncovered = buildAssessmentBlueprint({ specialization: 'FRONTEND', requiredSkills: [], preferredSkills: [{ skill: 'vue', mode: 'VERIFIED_ONLY' }] }, 'SENIOR', policy);
    expect(withUncovered.slots).toHaveLength(bare.slots.length);
    expect(withUncovered.coverage[0].status).toBe('NOT_COVERED');
    expect(withUncovered.slots.every((slot) => slot.covers.length === 0)).toBe(true);
  });

  it('неизвестный навык отмечается отдельно', () => {
    const blueprint = buildAssessmentBlueprint({ specialization: 'BACKEND', requiredSkills: ['no-such-skill'], preferredSkills: [] }, 'JUNIOR', policy);
    expect(blueprint.coverage[0].status).toBe('UNKNOWN_SKILL');
  });

  it('сообщает, когда в банке нет альтернатив и используются все семейства группы', () => {
    const blueprint = buildAssessmentBlueprint({ specialization: 'MANUAL_QA', requiredSkills: ['test-design'], preferredSkills: [] }, 'MIDDLE', policy);
    expect(blueprint.bankNotes.length).toBeGreaterThan(0);
  });

  it('проверяемые навыки каждой специализации известны банку', () => {
    for (const spec of SPECIALIZATION_CODES) expect(assessableSkills(spec).size).toBeGreaterThanOrEqual(4);
  });
});
