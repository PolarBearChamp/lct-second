/**
 * Проверка определения грейда (ответ организаторов PR.1): повторное прохождение теста одним и тем же профилем (test-retest)
 * со сравнением присвоенных грейдов и оценка разделяющей силы заданий. Допустима симуляция на синтетических кандидатах.
 *
 * Модель кандидата. У кандидата есть скрытая способность θ, у задания каждого грейда — трудность b: Junior −1.5,
 * Middle 0, Senior +1.5. Часть задания кандидат «знает» с вероятностью logistic(1.7·(θ − b)); не знает — отвечает наугад
 * тем же случайным ответом, что и стратегия «случайное угадывание» (поэтому вероятность угадать у каждого формата своя).
 * Истинный уровень T задаёт центр θ: на своём уровне кандидат знает в среднем около 90 % частей. Модель — допущение
 * команды, а не измерение на людях.
 *
 * Процедура присвоения повторяет продукт: кандидат заявляет грейд, проходит тест; при неуспехе сразу пробует уровень ниже;
 * присвоенный грейд — первый пройденный (или «нет»). Автоматического повышения нет. Повторное прохождение — тот же профиль
 * (тот же θ и тот же заявленный уровень), новые экземпляры с исключением уже виденных отпечатков, как в сервисе.
 */
import { getAssessmentPolicy, type AssessmentPolicy } from '../../src/config/policies';
import { generateAttemptInstances } from '../../src/domain/assessment/attempt-generation';
import { correctAnswerFromKey, evaluateItem } from '../../src/domain/assessment/evaluate';
import { agreement, cohensKappa, confusionMatrix, discriminationIndex, knowsProbability, normalSample, pearson } from '../../src/domain/assessment/grading-stats';
import { createRng } from '../../src/domain/assessment/rng';
import { scoreAttempt } from '../../src/domain/assessment/scoring';
import type { ItemAnswer, PrivateTaskInstance } from '../../src/domain/assessment/types';
import { groupsOf, SPECIALIZATION_CODES, type GradeCode, type SpecializationCode } from '../../src/domain/catalog/catalog';
import { mean, quantile, round } from './common';
import { uniformRandomAnswer } from './testing';

/** 0 — уровня нет, 1 — Junior, 2 — Middle, 3 — Senior. */
type Level = 0 | 1 | 2 | 3;
const LEVEL_TITLES = ['нет уровня', 'Junior', 'Middle', 'Senior'] as const;
const GRADES: GradeCode[] = ['JUNIOR', 'MIDDLE', 'SENIOR'];
const BASE_DIFFICULTY = [-1.5, 0, 1.5];
/** Смещение центра способности относительно трудности своего уровня: около 90 % знаемых частей. */
const LEVEL_OFFSET = 1.29;
/** Доли способов заявить грейд: честно / на ступень выше / на ступень ниже. */
const CLAIM_SHARES = { honest: 0.7, over: 0.15, under: 0.15 };

export interface GradingOptions {
  candidatesPerLevel: number;
  sensitivityCandidatesPerLevel: number;
  bootstrap: number;
}

export const DEFAULT_GRADING_OPTIONS: GradingOptions = { candidatesPerLevel: 150, sensitivityCandidatesPerLevel: 60, bootstrap: 1000 };
export const QUICK_GRADING_OPTIONS: GradingOptions = { candidatesPerLevel: 25, sensitivityCandidatesPerLevel: 10, bootstrap: 200 };

interface Scenario {
  name: string;
  /** Разброс способности внутри уровня. */
  sigma: number;
  /** Сдвиг трудности всего банка относительно кандидатов: > 0 — банк труднее. */
  shift: number;
  perLevel: number;
}

type ClaimMode = 'honest' | 'over' | 'under';

interface SimCandidate {
  id: string;
  spec: SpecializationCode;
  trueLevel: Level;
  theta: number;
  claim: Level;
  claimMode: ClaimMode;
}

interface AttemptRecord {
  spec: SpecializationCode;
  grade: Level;
  trueLevel: Level;
  families: string[];
  caseScores: number[];
}

export interface Kappa {
  value: number | null;
  low: number | null;
  high: number | null;
}

export interface ScenarioResult {
  name: string;
  sigma: number;
  shift: number;
  candidates: number;
  attempts: number;
  /** Доля совпадения присвоенных грейдов при повторном прохождении. */
  retestAgreement: number;
  kappaWeighted: Kappa;
  kappaUnweighted: number | null;
  /** Строки — присвоено при первом прохождении, столбцы — при втором (индексы 0–3: нет, Junior, Middle, Senior). */
  retestMatrix: number[][];
  /** Строки — истинный уровень, столбцы — присвоенный при первом прохождении. */
  truthMatrix: number[][];
  byClaim: Array<{ mode: ClaimMode; n: number; exact: number; over: number; under: number; notIssued: number }>;
  overall: { exact: number; over: number; under: number; notIssued: number };
}

export interface ItemDiscrimination {
  family: string;
  specialization: SpecializationCode;
  grade: GradeCode;
  attempts: number;
  /** Корреляция балла кейса со средним баллом остальных кейсов попытки. */
  itemRestCorrelation: number | null;
  /** D: верхние 27 % попыток по остальным кейсам минус нижние 27 %. */
  discriminationD: number | null;
  /** Средний балл кейса у кандидатов, чей истинный уровень равен этому грейду. */
  meanAtLevel: number | null;
  /** Средний балл кейса у кандидатов на ступень ниже. */
  meanBelow: number | null;
  /** Разница между соседними уровнями. */
  levelGap: number | null;
}

export interface GradingResults {
  model: { difficulties: Record<string, number>; levelOffset: number; claimShares: typeof CLAIM_SHARES; sigma: number; pass: string };
  options: GradingOptions;
  main: ScenarioResult;
  sensitivity: ScenarioResult[];
  items: ItemDiscrimination[];
  itemSummary: {
    pairs: number;
    withD: number;
    dAtLeast02: number;
    dShare: number;
    negativeCorrelations: number;
    medianCorrelation: number | null;
    medianD: number | null;
    medianGap: number | null;
    nonPositiveGap: number;
  };
  gates: Array<{ name: string; ok: boolean; detail: string }>;
}

const groupOrder = (spec: SpecializationCode) => groupsOf(spec).map((g) => g.code);
/** Центр способности кандидата истинного уровня; кандидат без уровня — чуть ниже трудности Junior. */
const levelCenter = (level: Level): number => (level === 0 ? BASE_DIFFICULTY[0] - 0.5 : BASE_DIFFICULTY[level - 1] + LEVEL_OFFSET);

function makePopulation(scenario: Scenario): SimCandidate[] {
  const population: SimCandidate[] = [];
  for (const spec of SPECIALIZATION_CODES) {
    for (const trueLevel of [0, 1, 2, 3] as Level[]) {
      for (let i = 0; i < scenario.perLevel; i += 1) {
        const id = `${scenario.name}|${spec}|${trueLevel}|${i}`;
        const rng = createRng(`grading-candidate|${id}`);
        const theta = levelCenter(trueLevel) + scenario.sigma * normalSample(rng);
        const roll = rng.next();
        const delta = roll < CLAIM_SHARES.honest ? 0 : roll < CLAIM_SHARES.honest + CLAIM_SHARES.over ? 1 : -1;
        const base = Math.max(1, trueLevel) as Level;
        const claim = Math.min(3, Math.max(1, base + delta)) as Level;
        population.push({ id, spec, trueLevel, theta, claim, claimMode: claim > base ? 'over' : claim < base ? 'under' : 'honest' });
      }
    }
  }
  return population;
}

/** Ответ кандидата с способностью theta на экземпляр задания грейда grade. */
function modelAnswer(instance: PrivateTaskInstance, theta: number, difficulty: number, rng: ReturnType<typeof createRng>): ItemAnswer {
  const knows = knowsProbability(theta, difficulty);
  const correct = correctAnswerFromKey(instance.key);
  const guess = uniformRandomAnswer(instance, rng);
  const parts: ItemAnswer['parts'] = {};
  for (const key of instance.key.parts) parts[key.partId] = rng.next() < knows ? correct.parts[key.partId] : guess.parts[key.partId];
  return { parts };
}

/** Одно прохождение процедуры: заявленный грейд, при неуспехе — уровень ниже и так до Junior. Возвращает присвоенный уровень. */
function runProcedure(
  candidate: SimCandidate,
  scenario: Scenario,
  run: number,
  history: { familyUse: Map<string, number>; seenFingerprints: Set<string> },
  policy: AssessmentPolicy,
  records: AttemptRecord[],
): Level {
  let counterValue = 0;
  const seedSource = () => `grading|${candidate.id}|run${run}|${counterValue++}`;
  for (let grade = candidate.claim; grade >= 1; grade -= 1) {
    const gradeCode = GRADES[grade - 1];
    const generated = generateAttemptInstances(candidate.spec, gradeCode, policy, history, seedSource);
    const rng = createRng(`grading-answers|${candidate.id}|run${run}|grade${grade}`);
    const scored = generated.instances.map((instance) => ({
      groupCode: instance.groupCode,
      evaluation: evaluateItem(instance.key, modelAnswer(instance, candidate.theta, BASE_DIFFICULTY[grade - 1] + scenario.shift, rng)),
    }));
    for (const instance of generated.instances) {
      history.familyUse.set(instance.familyId, (history.familyUse.get(instance.familyId) ?? 0) + 1);
      history.seenFingerprints.add(instance.fingerprint);
    }
    records.push({
      spec: candidate.spec,
      grade: grade as Level,
      trueLevel: candidate.trueLevel,
      families: generated.instances.map((i) => i.familyId),
      caseScores: scored.map((s) => s.evaluation.earned / Math.max(1, s.evaluation.total)),
    });
    if (scoreAttempt(scored, groupOrder(candidate.spec), policy).passed) return grade as Level;
  }
  return 0;
}

function bootstrapKappa(pairs: Array<readonly [number, number]>, seed: string, resamples: number): Kappa {
  const matrix = confusionMatrix(pairs, 4);
  const value = cohensKappa(matrix, true);
  const rng = createRng(`grading-bootstrap|${seed}`);
  const samples: number[] = [];
  for (let b = 0; b < resamples; b += 1) {
    const resampled = pairs.map(() => pairs[rng.int(0, pairs.length - 1)]);
    const k = cohensKappa(confusionMatrix(resampled, 4), true);
    if (k !== null) samples.push(k);
  }
  return { value: round(value, 3), low: round(quantile(samples, 0.025), 3), high: round(quantile(samples, 0.975), 3) };
}

function accuracy(rows: Array<{ truth: Level; assigned: Level }>) {
  const n = rows.length;
  if (n === 0) return { exact: 0, over: 0, under: 0, notIssued: 0 };
  const share = (predicate: (r: { truth: Level; assigned: Level }) => boolean) => round(rows.filter(predicate).length / n, 4)!;
  return {
    exact: share((r) => r.assigned === r.truth),
    over: share((r) => r.assigned > r.truth),
    // «Занижен» — присвоен ниже истинного, но выдан; «не выдан» — кандидат с уровнем получил «нет».
    under: share((r) => r.assigned < r.truth && r.assigned > 0),
    notIssued: share((r) => r.truth > 0 && r.assigned === 0),
  };
}

function runScenario(scenario: Scenario, policy: AssessmentPolicy, bootstrap: number, collect: AttemptRecord[] | null): ScenarioResult {
  const population = makePopulation(scenario);
  const records: AttemptRecord[] = [];
  const retest: Array<readonly [number, number]> = [];
  const outcomes: Array<{ truth: Level; assigned: Level; mode: ClaimMode }> = [];
  for (const candidate of population) {
    const history = { familyUse: new Map<string, number>(), seenFingerprints: new Set<string>() };
    const first = runProcedure(candidate, scenario, 1, history, policy, records);
    const second = runProcedure(candidate, scenario, 2, history, policy, records);
    retest.push([first, second]);
    outcomes.push({ truth: candidate.trueLevel, assigned: first, mode: candidate.claimMode });
  }
  if (collect) collect.push(...records);
  const retestMatrix = confusionMatrix(retest, 4);
  const truthMatrix = confusionMatrix(outcomes.map((o) => [o.truth, o.assigned] as const), 4);
  return {
    name: scenario.name,
    sigma: scenario.sigma,
    shift: scenario.shift,
    candidates: population.length,
    attempts: records.length,
    retestAgreement: round(agreement(retestMatrix), 4)!,
    kappaWeighted: bootstrapKappa(retest, scenario.name, bootstrap),
    kappaUnweighted: round(cohensKappa(retestMatrix, false), 3),
    retestMatrix,
    truthMatrix,
    byClaim: (['honest', 'over', 'under'] as ClaimMode[]).map((mode) => {
      const rows = outcomes.filter((o) => o.mode === mode);
      return { mode, n: rows.length, ...accuracy(rows) };
    }),
    overall: accuracy(outcomes),
  };
}

function itemDiscrimination(records: AttemptRecord[]): ItemDiscrimination[] {
  type Bucket = { family: string; spec: SpecializationCode; grade: Level; item: number[]; rest: number[]; trueLevels: Level[] };
  const buckets = new Map<string, Bucket>();
  for (const record of records) {
    const total = record.caseScores.reduce((a, b) => a + b, 0);
    record.families.forEach((family, index) => {
      const key = `${family}|${record.grade}`;
      const bucket = buckets.get(key) ?? { family, spec: record.spec, grade: record.grade, item: [], rest: [], trueLevels: [] };
      const score = record.caseScores[index];
      bucket.item.push(score);
      bucket.rest.push((total - score) / Math.max(1, record.caseScores.length - 1));
      bucket.trueLevels.push(record.trueLevel);
      buckets.set(key, bucket);
    });
  }
  return [...buckets.values()]
    .map((bucket) => {
      const at = bucket.item.filter((_, i) => bucket.trueLevels[i] === bucket.grade);
      const below = bucket.item.filter((_, i) => bucket.trueLevels[i] === bucket.grade - 1);
      const meanAt = mean(at);
      const meanBelow = mean(below);
      return {
        family: bucket.family,
        specialization: bucket.spec,
        grade: GRADES[bucket.grade - 1],
        attempts: bucket.item.length,
        itemRestCorrelation: round(pearson(bucket.item, bucket.rest), 3),
        discriminationD: round(discriminationIndex(bucket.rest, bucket.item), 3),
        meanAtLevel: round(meanAt, 3),
        meanBelow: round(meanBelow, 3),
        levelGap: meanAt !== null && meanBelow !== null && at.length >= 10 && below.length >= 10 ? round(meanAt - meanBelow, 3) : null,
      };
    })
    .sort((a, b) => a.family.localeCompare(b.family) || GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
}

export function runGradingValidation(options: GradingOptions = DEFAULT_GRADING_OPTIONS, log: (message: string) => void = () => undefined): GradingResults {
  const policy = getAssessmentPolicy('assessment-policy-v2');
  const sigma = 0.5;

  log('Определение грейда: основной прогон…');
  const records: AttemptRecord[] = [];
  const main = runScenario({ name: 'основной', sigma, shift: 0, perLevel: options.candidatesPerLevel }, policy, options.bootstrap, records);

  const sensitivity: ScenarioResult[] = [];
  const variants: Array<Omit<Scenario, 'perLevel'>> = [
    { name: 'разброс способности σ = 0,3', sigma: 0.3, shift: 0 },
    { name: 'разброс способности σ = 0,8', sigma: 0.8, shift: 0 },
    { name: 'банк труднее на 0,5', sigma: 0.5, shift: 0.5 },
    { name: 'банк легче на 0,5', sigma: 0.5, shift: -0.5 },
  ];
  for (const variant of variants) {
    log(`Определение грейда: ${variant.name}…`);
    sensitivity.push(runScenario({ ...variant, perLevel: options.sensitivityCandidatesPerLevel }, policy, Math.max(100, Math.floor(options.bootstrap / 4)), null));
  }

  const items = itemDiscrimination(records);
  const ds = items.map((i) => i.discriminationD).filter((v): v is number => v !== null);
  const correlations = items.map((i) => i.itemRestCorrelation).filter((v): v is number => v !== null);
  const gaps = items.map((i) => i.levelGap).filter((v): v is number => v !== null);
  const itemSummary = {
    pairs: items.length,
    withD: ds.length,
    dAtLeast02: ds.filter((d) => d >= 0.2).length,
    dShare: ds.length ? round(ds.filter((d) => d >= 0.2).length / ds.length, 3)! : 0,
    negativeCorrelations: correlations.filter((c) => c < 0).length,
    medianCorrelation: round(quantile(correlations, 0.5), 3),
    medianD: round(quantile(ds, 0.5), 3),
    medianGap: round(quantile(gaps, 0.5), 3),
    nonPositiveGap: gaps.filter((g) => g <= 0).length,
  };

  const honest = main.byClaim.find((c) => c.mode === 'honest')!;
  const kappa = main.kappaWeighted;
  const gates = [
    {
      name: 'Определение грейда: взвешенная каппа повторного прохождения (test-retest) не ниже 0.6',
      ok: kappa.value !== null && kappa.value >= 0.6,
      detail: `κw ${kappa.value} (95 % интервал ${kappa.low}–${kappa.high}), ${main.candidates} кандидатов`,
    },
    { name: 'Определение грейда: при повторе совпадает не менее 80 % присвоенных грейдов', ok: main.retestAgreement >= 0.8, detail: `${Math.round(main.retestAgreement * 1000) / 10} %` },
    { name: 'Определение грейда: у честно заявивших завышение не более 5 %', ok: honest.over <= 0.05, detail: `${Math.round(honest.over * 1000) / 10} % из ${honest.n}` },
    {
      name: 'Разделяющая сила: индекс D ≥ 0.2 не менее чем у 90 % пар «семейство × грейд»',
      ok: itemSummary.dShare >= 0.9,
      detail: `${itemSummary.dAtLeast02} из ${itemSummary.withD} (${Math.round(itemSummary.dShare * 1000) / 10} %), медиана D ${itemSummary.medianD}`,
    },
    { name: 'Разделяющая сила: ни у одной пары нет отрицательной корреляции с остальными кейсами', ok: itemSummary.negativeCorrelations === 0, detail: `${itemSummary.negativeCorrelations} из ${correlations.length}, медиана ${itemSummary.medianCorrelation}` },
  ];

  return {
    model: {
      difficulties: { Junior: BASE_DIFFICULTY[0], Middle: BASE_DIFFICULTY[1], Senior: BASE_DIFFICULTY[2] },
      levelOffset: LEVEL_OFFSET,
      claimShares: CLAIM_SHARES,
      sigma,
      pass: policy.version,
    },
    options,
    main,
    sensitivity,
    items,
    itemSummary,
    gates,
  };
}

export { LEVEL_TITLES };
