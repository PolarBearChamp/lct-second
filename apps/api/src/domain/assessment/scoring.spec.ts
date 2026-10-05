import { getAssessmentPolicy } from '../../config/policies';
import { recommendationsFor, scoreAttempt, skillEvidence, type ScoredItemInput } from './scoring';
import type { ItemEvaluation, PartEvaluation } from './types';

const policy = getAssessmentPolicy('assessment-policy-v1');
const GROUPS = ['G1', 'G2', 'G3'];

/** Кейс с точной долей earned/total (в долях верных частей). */
const item = (groupCode: string, earned: number, total: number, tags: string[] = []): ScoredItemInput => {
  const parts: PartEvaluation[] = Array.from({ length: total }, (_, i) => ({
    partId: `p${i}`,
    format: 'NUMERIC',
    answered: true,
    correct: i < earned,
    score: i < earned ? 1 : 0,
    skillTags: tags,
  }));
  const evaluation: ItemEvaluation = { parts, earned, total };
  return { groupCode, evaluation };
};

/** Два кейса на группу: точный балл группы задаётся долей верных частей в обоих кейсах. */
const attempt = (g1: [number, number], g2: [number, number], g3: [number, number]): ScoredItemInput[] =>
  [g1, g2, g3].flatMap(([earned, total], i) => [item(GROUPS[i], earned, total), item(GROUPS[i], earned, total)]);

describe('подсчёт результата попытки', () => {
  it('прохождение при общем балле ровно 75 и группах не ниже 50 (граница 75)', () => {
    // 100, 75, 50 → среднее 75
    const score = scoreAttempt(attempt([4, 4], [3, 4], [2, 4]), GROUPS, policy);
    expect(score.groups.map((g) => g.score)).toEqual([100, 75, 50]);
    expect(score.overall).toBe(75);
    expect(score.passed).toBe(true);
  });

  it('не проходит при общем балле 74: 74.67 округляется вниз, а не вверх (граница 74)', () => {
    // 100, 74, 50 → среднее 74.67 → 74
    const score = scoreAttempt(attempt([4, 4], [74, 100], [2, 4]), GROUPS, policy);
    expect(score.overall).toBe(74);
    expect(score.passed).toBe(false);
  });

  it('не проходит, если любая группа ниже 50, даже при высоком общем балле', () => {
    const score = scoreAttempt(attempt([4, 4], [4, 4], [49, 100]), GROUPS, policy);
    expect(score.overall).toBeGreaterThanOrEqual(75);
    expect(score.groups[2].score).toBe(49);
    expect(score.failedGroups).toEqual(['G3']);
    expect(score.passed).toBe(false);
  });

  it('группа ровно на пороге 50 допустима', () => {
    const score = scoreAttempt(attempt([4, 4], [4, 4], [50, 100]), GROUPS, policy);
    expect(score.groups[2].score).toBe(50);
    expect(score.passed).toBe(true);
  });

  it('«уверенное прохождение»: общий ≥ 90 и каждая группа ≥ 75', () => {
    expect(scoreAttempt(attempt([4, 4], [90, 100], [80, 100]), GROUPS, policy).confident).toBe(true); // 100, 90, 80 → 90
    // общий 91, но группа 74 < 75: пройден, но не уверенно
    const lowGroup = scoreAttempt(attempt([4, 4], [4, 4], [74, 100]), GROUPS, policy);
    expect(lowGroup.passed).toBe(true);
    expect(lowGroup.confident).toBe(false);
    // общий 89.67 → 89 < 90
    const lowOverall = scoreAttempt(attempt([4, 4], [89, 100], [80, 100]), GROUPS, policy);
    expect(lowOverall.overall).toBe(89);
    expect(lowOverall.confident).toBe(false);
  });

  it('балл группы — среднее по кейсам, а не по частям', () => {
    // кейс 1: 1/4, кейс 2: 4/4 → (25 + 100) / 2 = 62.5 → 62
    const items = [item('G1', 1, 4), item('G1', 4, 4), item('G2', 4, 4), item('G2', 4, 4), item('G3', 4, 4), item('G3', 4, 4)];
    expect(scoreAttempt(items, GROUPS, policy).groups[0].score).toBe(62);
  });

  it('без ответов — ноль и непрохождение', () => {
    const score = scoreAttempt(attempt([0, 4], [0, 4], [0, 4]), GROUPS, policy);
    expect(score.overall).toBe(0);
    expect(score.passed).toBe(false);
  });
});

describe('подтверждение навыков (skill evidence)', () => {
  it('навык, оценённый только в одном кейсе, получает «недостаточно данных» даже при 100%', () => {
    const items = [item('G1', 2, 2, ['sql']), item('G1', 2, 2, ['http'])];
    const evidence = skillEvidence(items, policy);
    expect(evidence.find((e) => e.skill === 'sql')).toMatchObject({ cases: 1, score: 100, status: 'INSUFFICIENT_DATA' });
  });

  it('навык подтверждается при ≥ 2 кейсах и результате ≥ 70 (граница 69/70)', () => {
    const at70 = skillEvidence([item('G1', 7, 10, ['sql']), item('G2', 7, 10, ['sql'])], policy);
    expect(at70[0]).toMatchObject({ cases: 2, score: 70, status: 'CONFIRMED' });
    const at69 = skillEvidence([item('G1', 69, 100, ['sql']), item('G2', 69, 100, ['sql'])], policy);
    expect(at69[0]).toMatchObject({ score: 69, status: 'BELOW_THRESHOLD' });
  });

  it('несколько частей одного кейса считаются одним кейсом', () => {
    const one = item('G1', 4, 4, ['sql']);
    one.evaluation.parts.push(...one.evaluation.parts.map((p) => ({ ...p, partId: `${p.partId}-b` })));
    expect(skillEvidence([one], policy)[0].cases).toBe(1);
  });
});

describe('рекомендации после теста', () => {
  it('высокий балл предлагает отдельную проверку следующего уровня и не присваивает его', () => {
    const score = scoreAttempt(attempt([4, 4], [4, 4], [4, 4]), GROUPS, policy);
    const recommendations = recommendationsFor(score, 'MIDDLE', policy);
    expect(recommendations.some((r) => r.kind === 'NEXT_GRADE' && r.grade === 'SENIOR')).toBe(true);
    expect(recommendations.some((r) => r.message.toLowerCase().includes('отдельно'))).toBe(true);
  });

  it('после неуспеха предлагается более низкий уровень и повтор через 24 часа', () => {
    const score = scoreAttempt(attempt([2, 4], [2, 4], [2, 4]), GROUPS, policy);
    const recommendations = recommendationsFor(score, 'MIDDLE', policy);
    expect(recommendations.some((r) => r.kind === 'RETRY_LOWER_GRADE' && r.grade === 'JUNIOR')).toBe(true);
    expect(recommendations.some((r) => r.kind === 'RETRY_SAME_GRADE' && r.message.includes('24'))).toBe(true);
  });

  it('для Junior нет рекомендации перейти ниже', () => {
    const score = scoreAttempt(attempt([2, 4], [2, 4], [2, 4]), GROUPS, policy);
    expect(recommendationsFor(score, 'JUNIOR', policy).some((r) => r.kind === 'RETRY_LOWER_GRADE')).toBe(false);
  });
});
