import { getMatchingFormula } from '../../config/policies';
import type { GradeCode } from '../catalog/catalog';
import { fspEvidence } from './fsp-relevance';
import { mandatoryViolations, paginate, preferredFit, rankBank, rankForNeed, salaryOverlaps, type MatchCandidate, type NeedSpec } from './rank';

const formula = getMatchingFormula('matching-formula-v1');

let counter = 0;
const candidate = (overrides: Partial<MatchCandidate> & { grade?: GradeCode; verified?: string[]; score?: number } = {}): MatchCandidate => {
  counter += 1;
  const { grade = 'MIDDLE', verified = ['sql', 'postgresql'], score = 80, ...rest } = overrides;
  return {
    candidateId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    alias: `C${counter}`,
    discoverable: true,
    specialization: 'BACKEND',
    qualification: { specialization: 'BACKEND', grade, overallScore: score, verifiedSkills: verified, groupScores: [] },
    selfReportedSkills: [],
    workFormats: ['REMOTE'],
    city: 'Москва',
    salary: null,
    salaryHidden: false,
    fspAchievements: [],
    experienceMonths: 36,
    ...rest,
  };
};

const need = (overrides: Partial<NeedSpec> = {}): NeedSpec => ({
  specialization: 'BACKEND',
  allowedGrades: ['MIDDLE', 'SENIOR'],
  requiredSkills: ['sql', 'postgresql'],
  preferredSkills: [],
  workFormat: 'REMOTE',
  city: null,
  salaryFrom: 200_000,
  salaryTo: 300_000,
  ...overrides,
});

describe('жёсткие условия подбора', () => {
  it('кандидат без подтверждения обязательного навыка исключён, даже с высоким баллом и достижениями ФСП', () => {
    const strong = candidate({
      verified: ['sql'],
      score: 100,
      fspAchievements: [{ externalId: 'a', eventId: 'e1', discipline: 'PRODUCT', place: 1, teamRole: 'BACKEND' }],
    });
    const ok = candidate({ score: 76 });
    const result = rankForNeed([strong, ok], need(), formula);
    expect(result.ranked.map((r) => r.candidateId)).toEqual([ok.candidateId]);
    expect(result.rejections.REQUIRED_SKILL).toBe(1);
  });

  it('навык, указанный кандидатом, не заменяет подтверждённый обязательный', () => {
    const selfOnly = candidate({ verified: ['sql'], selfReportedSkills: ['postgresql'] });
    expect(mandatoryViolations(selfOnly, need())).toContain('REQUIRED_SKILL');
  });

  it('грейд вне допустимых исключает: Senior не подходит для позиции Junior', () => {
    const senior = candidate({ grade: 'SENIOR' });
    expect(mandatoryViolations(senior, need({ allowedGrades: ['JUNIOR'] }))).toContain('GRADE');
  });

  it('специализация должна совпадать с подтверждённой', () => {
    const other = candidate({ specialization: 'FRONTEND' });
    expect(mandatoryViolations(other, need())).toContain('SPECIALIZATION');
  });

  it('скрытый или неопубликованный кандидат исключён', () => {
    expect(mandatoryViolations(candidate({ discoverable: false }), need())).toContain('NOT_DISCOVERABLE');
  });

  it('формат работы и город: для офиса город обязателен, для удалёнки нет', () => {
    expect(mandatoryViolations(candidate({ workFormats: ['REMOTE'] }), need({ workFormat: 'OFFICE', city: 'Москва' }))).toContain('WORK_FORMAT');
    expect(mandatoryViolations(candidate({ workFormats: ['OFFICE'], city: 'Казань' }), need({ workFormat: 'OFFICE', city: 'Москва' }))).toContain('CITY');
    expect(mandatoryViolations(candidate({ workFormats: ['OFFICE'], city: 'москва ' }), need({ workFormat: 'OFFICE', city: 'Москва' }))).toEqual([]);
    expect(mandatoryViolations(candidate({ city: 'Казань' }), need({ workFormat: 'REMOTE', city: 'Москва' }))).toEqual([]);
  });

  describe('зарплатные вилки', () => {
    it('пересечение включает границы', () => {
      expect(salaryOverlaps({ from: 300_000, to: 400_000 }, 200_000, 300_000)).toBe(true);
      expect(salaryOverlaps({ from: 300_001, to: 400_000 }, 200_000, 300_000)).toBe(false);
      expect(salaryOverlaps({ from: 100_000, to: 199_999 }, 200_000, 300_000)).toBe(false);
    });

    it('ожидания только «от» или только «до»', () => {
      expect(salaryOverlaps({ from: 250_000, to: null }, 200_000, 300_000)).toBe(true);
      expect(salaryOverlaps({ from: 350_000, to: null }, 200_000, 300_000)).toBe(false);
      expect(salaryOverlaps({ from: null, to: 150_000 }, 200_000, 300_000)).toBe(false);
    });

    it('кандидат с несовместимой вилкой исключён', () => {
      const expensive = candidate({ salary: { from: 350_000, to: 450_000 } });
      expect(mandatoryViolations(expensive, need())).toContain('SALARY');
    });

    it('если ожидания не указаны или скрыты — не исключается', () => {
      expect(mandatoryViolations(candidate({ salary: null }), need())).toEqual([]);
      expect(mandatoryViolations(candidate({ salary: null, salaryHidden: true }), need())).toEqual([]);
    });
  });

  it('уточнения только сужают выдачу', () => {
    const withFsp = candidate({ fspAchievements: [{ externalId: 'a', eventId: 'e', discipline: 'PRODUCT', place: 5, teamRole: 'BACKEND' }] });
    const without = candidate();
    const result = rankForNeed([withFsp, without], need(), formula, { onlyWithFsp: true });
    expect(result.ranked.map((r) => r.candidateId)).toEqual([withFsp.candidateId]);
    expect(rankForNeed([withFsp, without], need(), formula, { minOverallScore: 90 }).ranked).toHaveLength(0);
  });
});

describe('компоненты и формула', () => {
  const pref = (mode: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY', skill = 'kafka') => need({ preferredSkills: [{ skill, mode }] });

  it('подтверждённый навык = 1, указанный кандидатом = 0.3 при допускающем режиме, иначе 0', () => {
    expect(preferredFit(candidate({ verified: ['sql', 'postgresql', 'kafka'] }), pref('VERIFIED_ONLY'), formula).value).toBe(1);
    expect(preferredFit(candidate({ selfReportedSkills: ['kafka'] }), pref('SELF_REPORTED_ALLOWED'), formula).value).toBe(0.3);
    expect(preferredFit(candidate({ selfReportedSkills: ['kafka'] }), pref('VERIFIED_ONLY'), formula).value).toBe(0);
    expect(preferredFit(candidate(), pref('SELF_REPORTED_ALLOWED'), formula).value).toBe(0);
  });

  it('если желательных навыков нет, компонент одинаков и равен 1', () => {
    expect(preferredFit(candidate(), need(), formula).value).toBe(1);
  });

  it('score = 70·preferredFit + 25·assessmentQuality + 5·fspEvidence', () => {
    const c = candidate({ score: 80, verified: ['sql', 'postgresql', 'kafka'], fspAchievements: [{ externalId: 'a', eventId: 'e1', discipline: 'PRODUCT', place: 1, teamRole: 'BACKEND' }] });
    const [ranked] = rankForNeed([c], pref('VERIFIED_ONLY'), formula).ranked;
    // fsp: победа = 3 балла → 3/6 = 0.5 → 5 · 0.5 = 2.5; качество 25 · 0.8 = 20; навык 70
    expect(ranked.score).toBe(92.5);
    expect(ranked.explanation.components.fspEvidence.relevantEvents).toBe(1);
  });

  it('достижение ФСП даёт бонус, но не определяет порядок при существенно разном соответствии', () => {
    const matched = candidate({ score: 76, verified: ['sql', 'postgresql', 'kafka'] });
    const famous = candidate({
      score: 100,
      fspAchievements: Array.from({ length: 6 }, (_, i) => ({ externalId: `r${i}`, eventId: `e${i}`, discipline: 'PRODUCT', place: 1, teamRole: 'BACKEND' })),
    });
    const result = rankForNeed([famous, matched], pref('VERIFIED_ONLY'), formula);
    expect(result.ranked[0].candidateId).toBe(matched.candidateId);
  });

  it('объяснение содержит пройденные условия и непроверенные навыки без выдуманных причин', () => {
    const c = candidate({ selfReportedSkills: ['kafka'] });
    const [ranked] = rankForNeed([c], pref('VERIFIED_ONLY'), formula).ranked;
    expect(ranked.explanation.why.some((line) => line.includes('Грейд по результатам тестирования'))).toBe(true);
    expect(ranked.explanation.notVerified.join(' ')).toContain('Apache Kafka');
    expect(ranked.explanation.unmatchedPreferred[0].reason).toBe('SELF_REPORTED_NOT_ACCEPTED');
  });
});

describe('бонус ФСП', () => {
  const record = (id: string, event: string | null, place: number | null, discipline = 'PRODUCT', role: string | null = 'BACKEND') => ({ externalId: id, eventId: event, discipline, place, teamRole: role });

  it('участие 1, призёр 2, победа 3 балла; нормировка min(sum / 6, 1)', () => {
    expect(fspEvidence([record('a', 'e1', 8)], 'BACKEND', formula).points).toBe(1);
    expect(fspEvidence([record('a', 'e1', 3)], 'BACKEND', formula).points).toBe(2);
    expect(fspEvidence([record('a', 'e1', 1)], 'BACKEND', formula).value).toBe(0.5);
    const many = Array.from({ length: 5 }, (_, i) => record(`r${i}`, `e${i}`, 1));
    expect(fspEvidence(many, 'BACKEND', formula)).toMatchObject({ points: 15, value: 1 });
  });

  it('по одному мероприятию учитывается только сильнейшая запись', () => {
    const result = fspEvidence([record('a', 'e1', 10), record('b', 'e1', 1), record('c', 'e1', 3)], 'BACKEND', formula);
    expect(result.points).toBe(3);
    expect(result.relevantEvents).toBe(1);
  });

  it('нерелевантные достижения бонус не дают', () => {
    expect(fspEvidence([record('a', 'e1', 1, 'ROBOTICS')], 'BACKEND', formula).points).toBe(0);
    expect(fspEvidence([record('a', 'e1', 1, 'PRODUCT', 'FRONTEND')], 'BACKEND', formula).points).toBe(0);
    expect(fspEvidence([record('a', 'e1', 1, 'PRODUCT', 'CAPTAIN')], 'BACKEND', formula).points).toBe(3);
  });

  it('без истории бонус нулевой и не вызывает ошибок', () => {
    expect(fspEvidence([], 'BACKEND', formula)).toEqual({ value: 0, points: 0, relevantEvents: 0, totalAchievements: 0 });
  });
});

describe('стабильность порядка и пагинация', () => {
  const pool = Array.from({ length: 23 }, (_, i) => candidate({ score: 75 + (i % 6) * 4, verified: i % 3 === 0 ? ['sql', 'postgresql', 'kafka'] : ['sql', 'postgresql'] }));
  const spec = need({ preferredSkills: [{ skill: 'kafka', mode: 'VERIFIED_ONLY' }] });

  it('порядок: score ↓, балл теста ↓, идентификатор ↑ — и не зависит от входной перестановки', () => {
    const a = rankForNeed(pool, spec, formula).ranked.map((r) => r.candidateId);
    const b = rankForNeed([...pool].reverse(), spec, formula).ranked.map((r) => r.candidateId);
    expect(a).toEqual(b);
    const ranked = rankForNeed(pool, spec, formula).ranked;
    for (let i = 1; i < ranked.length; i += 1) {
      const [prev, next] = [ranked[i - 1], ranked[i]];
      expect(prev.score >= next.score).toBe(true);
      if (prev.score === next.score) {
        expect(prev.overallScore >= next.overallScore).toBe(true);
        if (prev.overallScore === next.overallScore) expect(prev.candidateId < next.candidateId).toBe(true);
      }
    }
  });

  it('склейка страниц любого размера даёт один и тот же порядок (ранжируется всё множество, потом нарезка)', () => {
    const full = rankForNeed(pool, spec, formula).ranked.map((r) => r.candidateId);
    for (const size of [2, 5, 7, 50]) {
      const pages: string[] = [];
      for (let page = 1; page <= Math.ceil(full.length / size); page += 1) pages.push(...paginate(full, page, size).items);
      expect(pages).toEqual(full);
    }
  });

  it('общий банк сортируется по категориям и не смешивает грейды числовым баллом', () => {
    const bank = [
      candidate({ grade: 'JUNIOR', score: 100 }),
      candidate({ grade: 'SENIOR', score: 75 }),
      candidate({ grade: 'MIDDLE', score: 99 }),
      candidate({ grade: 'SENIOR', score: 90 }),
    ];
    const ranked = rankBank(bank, {}, formula);
    expect(ranked.map((r) => r.grade)).toEqual(['SENIOR', 'SENIOR', 'MIDDLE', 'JUNIOR']);
    expect(ranked[0].overallScore).toBe(90);
  });

  it('банк не включает невидимых и кандидатов без квалификации', () => {
    const bank = [candidate({ discoverable: false }), { ...candidate(), qualification: null }, candidate()];
    expect(rankBank(bank, {}, formula)).toHaveLength(1);
  });

  it('фильтры банка: навыки только подтверждённые или любые', () => {
    const self = candidate({ verified: ['sql'], selfReportedSkills: ['kafka'] });
    expect(rankBank([self], { skills: ['kafka'], skillSource: 'VERIFIED' }, formula)).toHaveLength(0);
    expect(rankBank([self], { skills: ['kafka'], skillSource: 'ANY' }, formula)).toHaveLength(1);
  });
});
