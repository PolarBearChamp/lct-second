import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getAssessmentPolicy, type AssessmentPolicy } from '../../src/config/policies';
import { emptyHistory, generateAttemptInstances } from '../../src/domain/assessment/attempt-generation';
import { BANK_VERSION, FAMILIES } from '../../src/domain/assessment/bank/registry';
import { runControl, type ControlEntry, type ControlResult } from '../../src/domain/assessment/controls';
import { correctAnswerFromKey, evaluateItem } from '../../src/domain/assessment/evaluate';
import { instantiate, stableStringify } from '../../src/domain/assessment/instantiate';
import { createRng } from '../../src/domain/assessment/rng';
import { scoreAttempt, type AttemptScore } from '../../src/domain/assessment/scoring';
import type { ItemAnswer, PartAnswer, PrivateTaskInstance, PublicPart, Rng } from '../../src/domain/assessment/types';
import { groupsOf, SPECIALIZATION_CODES, type GradeCode, type SpecializationCode } from '../../src/domain/catalog/catalog';
import { wrongPartAnswer } from '../seed/solver';
import { mean, quantile, repoRoot, round, stdev } from './common';

const GRADES: GradeCode[] = ['JUNIOR', 'MIDDLE', 'SENIOR'];

export interface TestingOptions {
  /** Число seed на пару «семейство × грейд» для проверки корректности генерации. */
  generationSeeds: number;
  /** Число seed на пару для воспроизводимости. */
  reproSeeds: number;
  /** Число попыток на пару «специализация × грейд» в симуляциях. */
  attemptsPerCell: number;
  /** Число seed для оценки распределения правильных ответов (атака «по памяти»). */
  priorSeeds: number;
  /** Число последовательных попыток одного кандидата при оценке повторов. */
  retakeAttempts: number;
  retakeCandidates: number;
}

export const DEFAULT_OPTIONS: TestingOptions = { generationSeeds: 200, reproSeeds: 40, attemptsPerCell: 300, priorSeeds: 400, retakeAttempts: 5, retakeCandidates: 100 };

// ───────────────────────────── Утилиты ─────────────────────────────

const answerKeyOf = (part: PublicPart, answer: PartAnswer | undefined | null): string | null => {
  if (!answer) return null;
  const label = (options: Array<{ id: string; label: string }>, id: string) => options.find((o) => o.id === id)?.label ?? id;
  if ('optionId' in answer && 'options' in part) return label(part.options, answer.optionId);
  if ('optionIds' in answer && 'options' in part) return answer.optionIds.map((id) => label(part.options, id)).sort().join(' | ');
  if ('value' in answer) return String(answer.value);
  if ('order' in answer && 'items' in part) return answer.order.map((id) => label(part.items, id)).join(' → ');
  if ('pairs' in answer && 'left' in part) {
    return Object.entries(answer.pairs)
      .map(([l, r]) => `${label(part.left, l)}=${label(part.right, r)}`)
      .sort()
      .join(' | ');
  }
  return null;
};

function groupOrder(spec: SpecializationCode): string[] {
  return groupsOf(spec).map((g) => g.code);
}

function scoreOf(instances: PrivateTaskInstance[], answers: ItemAnswer[], spec: SpecializationCode, policy: AssessmentPolicy): AttemptScore {
  return scoreAttempt(
    instances.map((instance, i) => ({ groupCode: instance.groupCode, evaluation: evaluateItem(instance.key, answers[i]) })),
    groupOrder(spec),
    policy,
  );
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

export interface Distribution {
  n: number;
  mean: number | null;
  sd: number | null;
  min: number | null;
  p5: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

const distribution = (values: number[]): Distribution => ({
  n: values.length,
  mean: round(mean(values), 2),
  sd: round(stdev(values), 2),
  min: values.length ? Math.min(...values) : null,
  p5: round(quantile(values, 0.05), 1),
  p50: round(quantile(values, 0.5), 1),
  p95: round(quantile(values, 0.95), 1),
  max: values.length ? Math.max(...values) : null,
});

// ───────────────────────────── 1. Корректность генерации ─────────────────────────────

export interface GenerationRow {
  family: string;
  grade: GradeCode;
  seeds: number;
  errors: number;
  firstError: string | null;
  distinctFingerprints: number;
  fingerprintCollisionProbability: number;
  parts: { min: number; max: number };
  complexity: { min: number; p50: number; max: number; cv: number };
  formats: Record<string, number>;
  checks: { correctNotFull: number; emptyNotZero: number; wrongNotZero: number; selectAllFull: number; keyLeak: number; badTolerance: number; shape: number };
  msPerInstance: number;
}

function generationCheck(family: (typeof FAMILIES)[number], grade: GradeCode, seeds: number): GenerationRow {
  const fingerprints = new Map<string, number>();
  const formats: Record<string, number> = {};
  const partsCounts: number[] = [];
  const complexities: number[] = [];
  const checks = { correctNotFull: 0, emptyNotZero: 0, wrongNotZero: 0, selectAllFull: 0, keyLeak: 0, badTolerance: 0, shape: 0 };
  let errors = 0;
  let firstError: string | null = null;
  const started = process.hrtime.bigint();
  for (let i = 0; i < seeds; i += 1) {
    try {
      const instance = instantiate(family, grade, `gen-${i}`);
      fingerprints.set(instance.fingerprint, (fingerprints.get(instance.fingerprint) ?? 0) + 1);
      partsCounts.push(instance.public.parts.length);
      complexities.push(instance.complexity);
      for (const part of instance.public.parts) formats[part.format] = (formats[part.format] ?? 0) + 1;

      const full = evaluateItem(instance.key, correctAnswerFromKey(instance.key));
      if (full.earned !== full.total) checks.correctNotFull += 1;
      if (evaluateItem(instance.key, { parts: {} }).earned !== 0) checks.emptyNotZero += 1;

      const rng = createRng(`gen-wrong|${family.id}|${grade}|${i}`);
      const wrong: ItemAnswer = { parts: {} };
      instance.key.parts.forEach((key, index) => {
        wrong.parts[key.partId] = wrongPartAnswer(instance.public.parts[index], key, rng);
      });
      if (evaluateItem(instance.key, wrong).earned !== 0) checks.wrongNotZero += 1;

      // Выбор всех вариантов не должен давать полный балл ни в одной части MULTI_SELECT.
      const allSelected: ItemAnswer = { parts: {} };
      for (const part of instance.public.parts) if (part.format === 'MULTI_SELECT') allSelected.parts[part.id] = { optionIds: part.options.map((o) => o.id) };
      if (Object.keys(allSelected.parts).length && evaluateItem(instance.key, allSelected).earned > 0) checks.selectAllFull += 1;

      // Публичная часть не должна содержать семантических ключей и пояснений ревью.
      const publicJson = JSON.stringify(instance.public);
      if (Object.values(instance.key.semanticMap).some((semantic) => publicJson.includes(semantic)) || publicJson.includes('"explanation"') || publicJson.includes('"correct')) checks.keyLeak += 1;

      for (const [index, part] of instance.public.parts.entries()) {
        const key = instance.key.parts[index];
        if (part.format === 'NUMERIC' && key.format === 'NUMERIC') {
          if (part.integer ? key.tolerance !== 0 : !(key.tolerance > 0 && key.tolerance <= 0.01)) checks.badTolerance += 1;
        }
        if (part.format === 'ORDERING' && key.format === 'ORDERING' && part.items.map((o) => o.id).join() === key.correctOrder.join()) checks.shape += 1;
      }
    } catch (error) {
      errors += 1;
      firstError ??= (error as Error).message.slice(0, 200);
    }
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const counts = [...fingerprints.values()];
  const sortedComplexity = [...complexities].sort((a, b) => a - b);
  const cm = mean(complexities) ?? 0;
  return {
    family: family.id,
    grade,
    seeds,
    errors,
    firstError,
    distinctFingerprints: fingerprints.size,
    // Вероятность совпадения отпечатков у двух независимых экземпляров: Σ p_i² по эмпирическому распределению.
    fingerprintCollisionProbability: round(counts.reduce((sum, c) => sum + (c / seeds) ** 2, 0), 5)!,
    parts: { min: partsCounts.length ? Math.min(...partsCounts) : 0, max: partsCounts.length ? Math.max(...partsCounts) : 0 },
    complexity: {
      min: sortedComplexity[0] ?? 0,
      p50: quantile(complexities, 0.5) ?? 0,
      max: sortedComplexity[sortedComplexity.length - 1] ?? 0,
      cv: cm ? round((stdev(complexities) ?? 0) / cm, 3)! : 0,
    },
    formats,
    checks,
    msPerInstance: round(elapsedMs / seeds, 3)!,
  };
}

// ───────────────────────────── 2. Контрольные примеры ─────────────────────────────

export interface ControlsSummary {
  total: number;
  expected: number;
  pass: number;
  fail: number;
  stale: number;
  changed: number;
  probes: number;
  probeKinds: Record<string, number>;
  failures: ControlResult[];
  perFamily: Array<{ family: string; version: number; grades: Record<GradeCode, ControlResult['status'] | 'MISSING'> }>;
}

export function loadControls(): ControlEntry[] {
  const dir = path.join(repoRoot(), 'data', 'validation', 'controls');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as ControlEntry[]);
}

function controlsSummary(): ControlsSummary {
  const entries = loadControls();
  const results = entries.map(runControl);
  const probeKinds: Record<string, number> = {};
  for (const r of results) for (const [kind, n] of Object.entries(r.probeKinds)) probeKinds[kind] = (probeKinds[kind] ?? 0) + n;
  const byId = new Map(results.map((r) => [r.id, r]));
  return {
    total: results.length,
    expected: FAMILIES.reduce((sum, f) => sum + f.supportedGrades.length, 0),
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    stale: results.filter((r) => r.status === 'STALE_VERSION').length,
    changed: results.filter((r) => r.status === 'INSTANCE_CHANGED').length,
    probes: results.reduce((sum, r) => sum + r.probes, 0),
    probeKinds,
    failures: results.filter((r) => r.status !== 'PASS'),
    perFamily: FAMILIES.map((family) => ({
      family: family.id,
      version: family.version,
      grades: Object.fromEntries(GRADES.map((grade) => [grade, byId.get(`${family.id}:${grade}`)?.status ?? 'MISSING'])) as Record<GradeCode, ControlResult['status'] | 'MISSING'>,
    })),
  };
}

// ───────────────────────────── 3. Воспроизводимость ─────────────────────────────

export interface ReproducibilityResult {
  instancePairs: number;
  instanceMismatches: number;
  attemptPairs: number;
  attemptMismatches: number;
  scoreMismatches: number;
  differentSeedsDiffer: { pairs: number; identical: number };
}

function reproducibility(options: TestingOptions, policy: AssessmentPolicy): ReproducibilityResult {
  let instancePairs = 0;
  let instanceMismatches = 0;
  let different = 0;
  let identical = 0;
  for (const family of FAMILIES) {
    for (const grade of family.supportedGrades) {
      for (let i = 0; i < options.reproSeeds; i += 1) {
        const a = instantiate(family, grade, `repro-${i}`);
        const b = instantiate(family, grade, `repro-${i}`);
        instancePairs += 1;
        if (stableStringify(a) !== stableStringify(b)) instanceMismatches += 1;
        const c = instantiate(family, grade, `repro-other-${i}`);
        different += 1;
        if (stableStringify(a.public) === stableStringify(c.public)) identical += 1;
      }
    }
  }
  let attemptPairs = 0;
  let attemptMismatches = 0;
  let scoreMismatches = 0;
  for (const spec of SPECIALIZATION_CODES) {
    for (const grade of GRADES) {
      for (let i = 0; i < Math.ceil(options.reproSeeds / 2); i += 1) {
        const a = generateAttemptInstances(spec, grade, policy, emptyHistory(), counter(`attempt-repro-${spec}-${grade}-${i}`));
        const b = generateAttemptInstances(spec, grade, policy, emptyHistory(), counter(`attempt-repro-${spec}-${grade}-${i}`));
        attemptPairs += 1;
        if (stableStringify(a.instances) !== stableStringify(b.instances)) attemptMismatches += 1;
        const answersFor = (instances: PrivateTaskInstance[]) => {
          const rng = createRng(`repro-answers|${spec}|${grade}|${i}`);
          return instances.map((instance) => profileAnswer(instance, [0.7, 0.7, 0.7], groupOrder(spec), rng));
        };
        const s1 = scoreOf(a.instances, answersFor(a.instances), spec, policy);
        const s2 = scoreOf(b.instances, answersFor(b.instances), spec, policy);
        if (JSON.stringify(s1) !== JSON.stringify(s2)) scoreMismatches += 1;
      }
    }
  }
  return { instancePairs, instanceMismatches, attemptPairs, attemptMismatches, scoreMismatches, differentSeedsDiffer: { pairs: different, identical } };
}

// ───────────────────────────── 4–5. Стратегии и профили решателей ─────────────────────────────

/** Ответ с заданной вероятностью верного по каждой группе (профиль решателя). */
function profileAnswer(instance: PrivateTaskInstance, accuracyByGroup: number[], groups: string[], rng: Rng): ItemAnswer {
  const accuracy = accuracyByGroup[Math.max(0, groups.indexOf(instance.groupCode))] ?? 0.5;
  const correct = correctAnswerFromKey(instance.key);
  const parts: ItemAnswer['parts'] = {};
  instance.key.parts.forEach((key, index) => {
    parts[key.partId] = rng.next() < accuracy ? correct.parts[key.partId] : wrongPartAnswer(instance.public.parts[index], key, rng);
  });
  return { parts };
}

function uniformRandomAnswer(instance: PrivateTaskInstance, rng: Rng): ItemAnswer {
  const parts: ItemAnswer['parts'] = {};
  for (const part of instance.public.parts) {
    switch (part.format) {
      case 'SINGLE_CHOICE':
        parts[part.id] = { optionId: rng.pick(part.options).id };
        break;
      case 'MULTI_SELECT': {
        let chosen = part.options.filter(() => rng.bool());
        if (chosen.length === 0) chosen = [rng.pick(part.options)];
        parts[part.id] = { optionIds: chosen.map((o) => o.id) };
        break;
      }
      case 'NUMERIC':
        parts[part.id] = { value: part.integer ? rng.int(0, 100) : Math.round(rng.next() * 10000) / 100 };
        break;
      case 'ORDERING':
        parts[part.id] = { order: rng.shuffle(part.items).map((o) => o.id) };
        break;
      case 'MATCHING':
        parts[part.id] = { pairs: Object.fromEntries(part.left.map((l) => [l.id, rng.pick(part.right).id])) };
        break;
    }
  }
  return { parts };
}

/** «Выбрать всё»: все варианты в MULTI_SELECT, первый вариант в остальных, показанный порядок в ORDERING, нули в числах. */
function selectAllAnswer(instance: PrivateTaskInstance): ItemAnswer {
  const parts: ItemAnswer['parts'] = {};
  for (const part of instance.public.parts) {
    switch (part.format) {
      case 'SINGLE_CHOICE':
        parts[part.id] = { optionId: part.options[0].id };
        break;
      case 'MULTI_SELECT':
        parts[part.id] = { optionIds: part.options.map((o) => o.id) };
        break;
      case 'NUMERIC':
        parts[part.id] = { value: 0 };
        break;
      case 'ORDERING':
        parts[part.id] = { order: part.items.map((o) => o.id) };
        break;
      case 'MATCHING':
        parts[part.id] = { pairs: Object.fromEntries(part.left.map((l) => [l.id, part.right[0].id])) };
        break;
    }
  }
  return { parts };
}

/** Распределение правильных ответов по частям: для атаки «выучить банк» (самый частый верный ответ каждой части). */
type Prior = Map<string, Map<string, number>>;

function buildPrior(seeds: number): Prior {
  const prior: Prior = new Map();
  for (const family of FAMILIES) {
    for (const grade of family.supportedGrades) {
      for (let i = 0; i < seeds; i += 1) {
        const instance = instantiate(family, grade, `prior-${i}`);
        const correct = correctAnswerFromKey(instance.key);
        for (const part of instance.public.parts) {
          const key = answerKeyOf(part, correct.parts[part.id]);
          if (key === null) continue;
          const id = `${family.id}|${grade}|${part.id}`;
          const counts = prior.get(id) ?? new Map<string, number>();
          counts.set(key, (counts.get(key) ?? 0) + 1);
          prior.set(id, counts);
        }
      }
    }
  }
  return prior;
}

const modal = (counts: Map<string, number>) => [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];

/** Кандидат, знающий банк: для каждой части отвечает самым частым верным ответом из прошлых экземпляров (если такой вариант есть). */
function memorizerAnswer(instance: PrivateTaskInstance, prior: Prior, rng: Rng): ItemAnswer {
  const parts: ItemAnswer['parts'] = {};
  for (const part of instance.public.parts) {
    const counts = prior.get(`${instance.familyId}|${instance.grade}|${part.id}`);
    const best = counts ? modal(counts)[0] : null;
    const fallback = uniformRandomAnswer(instance, rng).parts[part.id];
    if (best === null) {
      parts[part.id] = fallback;
      continue;
    }
    switch (part.format) {
      case 'SINGLE_CHOICE': {
        const option = part.options.find((o) => o.label === best);
        parts[part.id] = option ? { optionId: option.id } : fallback;
        break;
      }
      case 'MULTI_SELECT': {
        const labels = best.split(' | ');
        const ids = labels.map((label) => part.options.find((o) => o.label === label)?.id).filter((id): id is string => Boolean(id));
        parts[part.id] = ids.length === labels.length ? { optionIds: ids } : fallback;
        break;
      }
      case 'NUMERIC':
        parts[part.id] = { value: Number(best) };
        break;
      case 'ORDERING': {
        const labels = best.split(' → ');
        const ids = labels.map((label) => part.items.find((o) => o.label === label)?.id).filter((id): id is string => Boolean(id));
        parts[part.id] = ids.length === labels.length ? { order: ids } : fallback;
        break;
      }
      case 'MATCHING': {
        const pairs: Record<string, string> = {};
        let ok = true;
        for (const pair of best.split(' | ')) {
          const [l, r] = pair.split('=');
          const left = part.left.find((o) => o.label === l);
          const right = part.right.find((o) => o.label === r);
          if (!left || !right) ok = false;
          else pairs[left.id] = right.id;
        }
        parts[part.id] = ok ? { pairs } : fallback;
        break;
      }
    }
  }
  return { parts };
}

export interface StrategyStats {
  strategy: string;
  attempts: number;
  overall: Distribution;
  passRate: number;
  confidentRate: number;
  fullScoreAttempts: number;
}

export interface CellResult {
  specialization: SpecializationCode;
  grade: GradeCode;
  attempts: number;
  strategies: StrategyStats[];
  profiles: Array<
    StrategyStats & {
      profile: string;
      accuracy: number[];
      groupMeans: number[];
      consistencyEmpirical: number | null;
      consistencyExpected: number;
      failedByGroupOnly: number;
      failedByOverallOnly: number;
      failedByBoth: number;
    }
  >;
  retakes: {
    candidates: number;
    attemptsPerCandidate: number;
    exactRepeatsWithDedup: number;
    slotsAfterFirst: number;
    exactRepeatRateWithDedup: number;
    exactRepeatRateWithoutDedup: number;
    familyOverlapMean: number;
    sameFamilyDifferentInstanceShare: number;
  };
  attemptGenerationMs: number;
}

export const PROFILES: Array<{ name: string; accuracy: number[]; note: string }> = [
  { name: 'слабый', accuracy: [0.35, 0.35, 0.35], note: 'вероятность верного ответа на часть — 35 % во всех группах' },
  { name: 'пограничный', accuracy: [0.78, 0.78, 0.78], note: '78 % во всех группах — около проходного порога 75' },
  { name: 'средний', accuracy: [0.8, 0.8, 0.8], note: '80 % во всех группах' },
  { name: 'сильный', accuracy: [0.95, 0.95, 0.95], note: '95 % во всех группах' },
  { name: 'сильный, но слабая группа 3', accuracy: [0.95, 0.95, 0.3], note: '95 % в группах 1–2 и 30 % в группе 3 (проверка порога по группам)' },
];

function stats(name: string, scores: AttemptScore[]): StrategyStats {
  const overalls = scores.map((s) => s.overall);
  return {
    strategy: name,
    attempts: scores.length,
    overall: distribution(overalls),
    passRate: round(scores.filter((s) => s.passed).length / scores.length, 4)!,
    confidentRate: round(scores.filter((s) => s.confident).length / scores.length, 4)!,
    fullScoreAttempts: scores.filter((s) => s.overall === 100).length,
  };
}

function simulateCell(spec: SpecializationCode, grade: GradeCode, options: TestingOptions, policy: AssessmentPolicy, prior: Prior): CellResult {
  const groups = groupOrder(spec);
  const started = process.hrtime.bigint();
  const attempts = Array.from({ length: options.attemptsPerCell }, (_, i) =>
    generateAttemptInstances(spec, grade, policy, emptyHistory(), counter(`sim-${spec}-${grade}-${i}`)).instances,
  );
  const attemptGenerationMs = Number(process.hrtime.bigint() - started) / 1e6 / options.attemptsPerCell;

  const scoreWith = (answerFor: (instances: PrivateTaskInstance[], index: number) => ItemAnswer[]) => attempts.map((instances, index) => scoreOf(instances, answerFor(instances, index), spec, policy));

  const strategies: StrategyStats[] = [
    stats('верные ответы', scoreWith((instances) => instances.map((instance) => correctAnswerFromKey(instance.key)))),
    stats('без ответов', scoreWith((instances) => instances.map(() => ({ parts: {} })))),
    stats(
      'заведомо неверные',
      scoreWith((instances, index) => {
        const rng = createRng(`wrong|${spec}|${grade}|${index}`);
        return instances.map((instance) => {
          const parts: ItemAnswer['parts'] = {};
          instance.key.parts.forEach((key, i) => {
            parts[key.partId] = wrongPartAnswer(instance.public.parts[i], key, rng);
          });
          return { parts };
        });
      }),
    ),
    stats('«выбрать всё / первый вариант»', scoreWith((instances) => instances.map(selectAllAnswer))),
    stats(
      'случайное угадывание',
      scoreWith((instances, index) => {
        const rng = createRng(`random|${spec}|${grade}|${index}`);
        return instances.map((instance) => uniformRandomAnswer(instance, rng));
      }),
    ),
    stats(
      'знает банк (самый частый верный ответ)',
      scoreWith((instances, index) => {
        const rng = createRng(`memo|${spec}|${grade}|${index}`);
        return instances.map((instance) => memorizerAnswer(instance, prior, rng));
      }),
    ),
  ];

  const profiles = PROFILES.map((profile) => {
    const scores = scoreWith((instances, index) => {
      const rng = createRng(`profile|${profile.name}|${spec}|${grade}|${index}`);
      return instances.map((instance) => profileAnswer(instance, profile.accuracy, groups, rng));
    });
    const passRate = scores.filter((s) => s.passed).length / scores.length;
    let agree = 0;
    let pairs = 0;
    for (let i = 0; i + 1 < scores.length; i += 2) {
      pairs += 1;
      if (scores[i].passed === scores[i + 1].passed) agree += 1;
    }
    const failed = scores.filter((s) => !s.passed);
    return {
      ...stats(profile.name, scores),
      profile: profile.name,
      accuracy: profile.accuracy,
      groupMeans: groups.map((_, g) => round(mean(scores.map((s) => s.groups[g].score)), 1)!),
      consistencyEmpirical: pairs ? round(agree / pairs, 3) : null,
      consistencyExpected: round(passRate ** 2 + (1 - passRate) ** 2, 3)!,
      failedByGroupOnly: failed.filter((s) => s.failedGroups.length > 0 && s.overall >= policy.passOverall).length,
      failedByOverallOnly: failed.filter((s) => s.failedGroups.length === 0 && s.overall < policy.passOverall).length,
      failedByBoth: failed.filter((s) => s.failedGroups.length > 0 && s.overall < policy.passOverall).length,
    };
  });

  // Повторные попытки одного кандидата: с исключением ранее виденных отпечатков (как в сервисе) и без него.
  let exactRepeats = 0;
  let slotsAfterFirst = 0;
  let overlapSum = 0;
  let overlapN = 0;
  let sameFamilyDifferent = 0;
  let sameFamilySlots = 0;
  let naiveRepeats = 0;
  for (let c = 0; c < options.retakeCandidates; c += 1) {
    const familyUse = new Map<string, number>();
    const seen = new Set<string>();
    const naiveSeen = new Set<string>();
    let previousFamilies: string[] | null = null;
    let previousByFamily: Map<string, string> | null = null;
    const source = counter(`retake-${spec}-${grade}-${c}`);
    const naiveSource = counter(`naive-${spec}-${grade}-${c}`);
    for (let a = 0; a < options.retakeAttempts; a += 1) {
      const result = generateAttemptInstances(spec, grade, policy, { familyUse, seenFingerprints: seen }, source);
      const naive = generateAttemptInstances(spec, grade, { ...policy, maxFingerprintRetries: 0 }, emptyHistory(), naiveSource);
      const byFamily = new Map<string, string>();
      for (const instance of result.instances) {
        byFamily.set(instance.familyId, instance.fingerprint);
        familyUse.set(instance.familyId, (familyUse.get(instance.familyId) ?? 0) + 1);
        seen.add(instance.fingerprint);
      }
      if (a > 0) {
        exactRepeats += result.exactRepeats;
        slotsAfterFirst += result.instances.length;
        const families = result.instances.map((i) => i.familyId);
        overlapSum += families.filter((f) => previousFamilies!.includes(f)).length / families.length;
        overlapN += 1;
        for (const [family, fingerprint] of byFamily) {
          if (previousByFamily!.has(family)) {
            sameFamilySlots += 1;
            if (previousByFamily!.get(family) !== fingerprint) sameFamilyDifferent += 1;
          }
        }
        for (const instance of naive.instances) if (naiveSeen.has(instance.fingerprint)) naiveRepeats += 1;
      }
      for (const instance of naive.instances) naiveSeen.add(instance.fingerprint);
      previousFamilies = result.instances.map((i) => i.familyId);
      previousByFamily = byFamily;
    }
  }

  return {
    specialization: spec,
    grade,
    attempts: attempts.length,
    strategies,
    profiles,
    retakes: {
      candidates: options.retakeCandidates,
      attemptsPerCandidate: options.retakeAttempts,
      exactRepeatsWithDedup: exactRepeats,
      slotsAfterFirst,
      exactRepeatRateWithDedup: slotsAfterFirst ? round(exactRepeats / slotsAfterFirst, 5)! : 0,
      exactRepeatRateWithoutDedup: slotsAfterFirst ? round(naiveRepeats / slotsAfterFirst, 5)! : 0,
      familyOverlapMean: overlapN ? round(overlapSum / overlapN, 3)! : 0,
      sameFamilyDifferentInstanceShare: sameFamilySlots ? round(sameFamilyDifferent / sameFamilySlots, 4)! : 0,
    },
    attemptGenerationMs: round(attemptGenerationMs, 2)!,
  };
}

// ───────────────────────────── 6. Постоянные ответы банка ─────────────────────────────

export interface ConstantAnswerRow {
  family: string;
  grade: GradeCode;
  parts: number;
  /** Части, где один и тот же верный ответ встречается в ≥ 90 % экземпляров. */
  constantParts: number;
  byFormat: Record<string, { parts: number; constant: number }>;
}

function constantAnswers(prior: Prior, seeds: number): ConstantAnswerRow[] {
  const rows: ConstantAnswerRow[] = [];
  for (const family of FAMILIES) {
    for (const grade of family.supportedGrades) {
      const instance = instantiate(family, grade, 'prior-0');
      const byFormat: Record<string, { parts: number; constant: number }> = {};
      let constantParts = 0;
      for (const part of instance.public.parts) {
        const counts = prior.get(`${family.id}|${grade}|${part.id}`);
        const share = counts ? modal(counts)[1] / seeds : 0;
        const entry = (byFormat[part.format] ??= { parts: 0, constant: 0 });
        entry.parts += 1;
        if (share >= 0.9) {
          entry.constant += 1;
          constantParts += 1;
        }
      }
      rows.push({ family: family.id, grade, parts: instance.public.parts.length, constantParts, byFormat });
    }
  }
  return rows;
}

// ───────────────────────────── Итог ─────────────────────────────

export interface TestingResults {
  bankVersion: string;
  policy: AssessmentPolicy;
  options: TestingOptions;
  families: number;
  familyGradePairs: number;
  generation: { rows: GenerationRow[]; totalInstances: number; totalErrors: number; minDistinctFingerprints: number; checkTotals: GenerationRow['checks'] };
  controls: ControlsSummary;
  reproducibility: ReproducibilityResult;
  cells: CellResult[];
  constantAnswers: { rows: ConstantAnswerRow[]; totalParts: number; constantParts: number; share: number };
  gates: Array<{ name: string; ok: boolean; detail: string }>;
}

export function runTestingValidation(options: TestingOptions = DEFAULT_OPTIONS, log: (message: string) => void = () => undefined): TestingResults {
  const policy = getAssessmentPolicy('assessment-policy-v2');

  log('Корректность генерации…');
  const rows: GenerationRow[] = [];
  for (const family of FAMILIES) for (const grade of family.supportedGrades) rows.push(generationCheck(family, grade, options.generationSeeds));
  const checkTotals = rows.reduce(
    (sum, r) => ({
      correctNotFull: sum.correctNotFull + r.checks.correctNotFull,
      emptyNotZero: sum.emptyNotZero + r.checks.emptyNotZero,
      wrongNotZero: sum.wrongNotZero + r.checks.wrongNotZero,
      selectAllFull: sum.selectAllFull + r.checks.selectAllFull,
      keyLeak: sum.keyLeak + r.checks.keyLeak,
      badTolerance: sum.badTolerance + r.checks.badTolerance,
      shape: sum.shape + r.checks.shape,
    }),
    { correctNotFull: 0, emptyNotZero: 0, wrongNotZero: 0, selectAllFull: 0, keyLeak: 0, badTolerance: 0, shape: 0 },
  );

  log('Контрольные примеры…');
  const controls = controlsSummary();

  log('Воспроизводимость…');
  const repro = reproducibility(options, policy);

  log('Распределение верных ответов банка…');
  const prior = buildPrior(options.priorSeeds);

  const cells: CellResult[] = [];
  for (const spec of SPECIALIZATION_CODES) {
    for (const grade of GRADES) {
      log(`Симуляция: ${spec} · ${grade}…`);
      cells.push(simulateCell(spec, grade, options, policy, prior));
    }
  }

  const constantRows = constantAnswers(prior, options.priorSeeds);
  const totalParts = constantRows.reduce((s, r) => s + r.parts, 0);
  const constantParts = constantRows.reduce((s, r) => s + r.constantParts, 0);

  const strategy = (cell: CellResult, name: string) => cell.strategies.find((s) => s.strategy === name)!;
  const profile = (cell: CellResult, name: string) => cell.profiles.find((p) => p.profile === name)!;
  const totalErrors = rows.reduce((s, r) => s + r.errors, 0);
  const minDistinct = Math.min(...rows.map((r) => r.distinctFingerprints));
  const gates = [
    { name: 'Генерация: ни одного некорректного экземпляра', ok: totalErrors === 0, detail: `${totalErrors} ошибок на ${rows.length * options.generationSeeds} экземплярах` },
    { name: 'Генерация: ≥ 30 различающихся экземпляров для каждой пары «семейство × грейд»', ok: minDistinct >= 30, detail: `минимум ${minDistinct} при ${options.generationSeeds} seed` },
    { name: 'Верный ответ по ключу даёт полный балл, пустой — 0, заведомо неверный — 0', ok: checkTotals.correctNotFull + checkTotals.emptyNotZero + checkTotals.wrongNotZero === 0, detail: JSON.stringify({ correctNotFull: checkTotals.correctNotFull, emptyNotZero: checkTotals.emptyNotZero, wrongNotZero: checkTotals.wrongNotZero }) },
    { name: 'Выбор всех вариантов в MULTI_SELECT не даёт баллов', ok: checkTotals.selectAllFull === 0, detail: `${checkTotals.selectAllFull} нарушений` },
    { name: 'Публичная часть не содержит ключей и пояснений', ok: checkTotals.keyLeak === 0, detail: `${checkTotals.keyLeak} утечек` },
    { name: 'Допуски числовых частей соответствуют формулировке', ok: checkTotals.badTolerance === 0, detail: `${checkTotals.badTolerance} нарушений` },
    { name: 'Показанный порядок ORDERING не совпадает с верным', ok: checkTotals.shape === 0, detail: `${checkTotals.shape} совпадений` },
    { name: 'Ручные контрольные примеры: по одному на каждую пару «семейство × грейд», все проходят', ok: controls.total === controls.expected && controls.pass === controls.total, detail: `${controls.pass}/${controls.total} из ${controls.expected}, проб: ${controls.probes}` },
    { name: 'Воспроизводимость экземпляров и попыток', ok: repro.instanceMismatches === 0 && repro.attemptMismatches === 0 && repro.scoreMismatches === 0, detail: `${repro.instanceMismatches}/${repro.instancePairs} экземпляров, ${repro.attemptMismatches}/${repro.attemptPairs} попыток, ${repro.scoreMismatches} оценок` },
    { name: 'Верные ответы проходят порог и подтверждаются как «уверенные» во всех ячейках', ok: cells.every((c) => strategy(c, 'верные ответы').passRate === 1 && strategy(c, 'верные ответы').confidentRate === 1), detail: `${cells.length} ячеек × ${options.attemptsPerCell} попыток` },
    { name: 'Заведомо неверные и пустые ответы не проходят', ok: cells.every((c) => strategy(c, 'заведомо неверные').passRate === 0 && strategy(c, 'без ответов').passRate === 0), detail: 'доля прохождений 0' },
    { name: '«Выбрать всё» не даёт полного балла и не проходит порог', ok: cells.every((c) => strategy(c, '«выбрать всё / первый вариант»').fullScoreAttempts === 0 && strategy(c, '«выбрать всё / первый вариант»').passRate === 0), detail: 'максимум баллов: ' + Math.max(...cells.map((c) => strategy(c, '«выбрать всё / первый вариант»').overall.max ?? 0)) },
    { name: 'Случайное угадывание: доля прохождений ≤ 1 %', ok: cells.every((c) => strategy(c, 'случайное угадывание').passRate <= 0.01), detail: 'максимум по ячейкам: ' + Math.max(...cells.map((c) => strategy(c, 'случайное угадывание').passRate)) },
    {
      name: 'Слабый решатель не проходит (≤ 2 %), сильный проходит (≥ 90 %), слабая группа снижает долю прохождений не менее чем на 50 п. п.',
      ok: cells.every((c) => profile(c, 'слабый').passRate <= 0.02 && profile(c, 'сильный').passRate >= 0.9 && profile(c, 'сильный').passRate - profile(c, 'сильный, но слабая группа 3').passRate >= 0.5),
      detail: `слабый ≤ ${Math.max(...cells.map((c) => profile(c, 'слабый').passRate))}, сильный ≥ ${Math.min(...cells.map((c) => profile(c, 'сильный').passRate))}, при слабой группе ≤ ${Math.max(...cells.map((c) => profile(c, 'сильный, но слабая группа 3').passRate))}`,
    },
  ];

  return {
    bankVersion: BANK_VERSION,
    policy,
    options,
    families: FAMILIES.length,
    familyGradePairs: rows.length,
    generation: { rows, totalInstances: rows.length * options.generationSeeds, totalErrors, minDistinctFingerprints: minDistinct, checkTotals },
    controls,
    reproducibility: repro,
    cells,
    constantAnswers: { rows: constantRows, totalParts, constantParts, share: round(constantParts / totalParts, 3)! },
    gates,
  };
}
