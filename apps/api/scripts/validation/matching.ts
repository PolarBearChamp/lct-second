import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getMatchingFormula, type MatchingFormula } from '../../src/config/policies';
import { assessableSkills } from '../../src/domain/assessment/bank/registry';
import { isKnownSkill, SPECIALIZATION_CODES, type GradeCode, type SpecializationCode } from '../../src/domain/catalog/catalog';
import { MATCHING_ALGORITHM_VERSION, rankForNeed, REJECTION_TEXTS, type MatchCandidate, type NeedSpec, type RejectionReason } from '../../src/domain/matching/rank';
import { FSP_RELEVANCE_VERSION } from '../../src/domain/matching/fsp-relevance';
import { createRng } from '../../src/domain/assessment/rng';
import { bootstrapMean, mean, rel, repoRoot, round, sha256, sha256File } from './common';

// ───────────────────────────── Формат данных ─────────────────────────────

interface RawCandidate {
  id: string;
  note: string;
  grade: GradeCode;
  overall: number;
  verified: string[];
  self: string[];
  formats: string[];
  city: string | null;
  salary: [number, number] | null;
  salaryHidden?: boolean;
  fsp: Array<{ event: string | null; discipline: string | null; place: number | null; role: string | null }>;
  experienceMonths: number | null;
  discoverable?: boolean;
}

interface RawNeed {
  id: string;
  split: 'tuning' | 'final';
  title: string;
  scenario: string;
  allowedGrades: GradeCode[];
  requiredSkills: string[];
  preferredSkills: Array<{ skill: string; mode: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY' }>;
  workFormat: 'REMOTE' | 'HYBRID' | 'OFFICE';
  city: string | null;
  salary: [number, number];
}

interface RawLabel {
  /** 0 — не подходит, 1 — допустим, 2 — хорошо подходит. */
  l: 0 | 1 | 2;
  /** Нарушено ли явно заявленное условие потребности (по руководству разметчика, не по коду подбора). */
  v: boolean;
  why: string;
}

interface RawFile {
  specialization: SpecializationCode;
  candidates: RawCandidate[];
  needs: RawNeed[];
  labels: Record<string, Record<string, RawLabel>>;
}

export interface Scenario {
  files: Array<{ file: string; sha256: string }>;
  candidates: Array<{ raw: RawCandidate; specialization: SpecializationCode; match: MatchCandidate }>;
  needs: Array<{ raw: RawNeed; specialization: SpecializationCode; spec: NeedSpec }>;
  labels: Map<string, Map<string, RawLabel>>;
}

const FILES = ['backend.json', 'frontend.json', 'ml.json', 'qa.json'];
const FORMATS = ['REMOTE', 'HYBRID', 'OFFICE'];
const GRADES: GradeCode[] = ['JUNIOR', 'MIDDLE', 'SENIOR'];

export function loadScenario(): Scenario {
  const dir = path.join(repoRoot(), 'data', 'validation', 'matching');
  const problems: string[] = [];
  const scenario: Scenario = { files: [], candidates: [], needs: [], labels: new Map() };
  const candidateIds = new Set<string>();
  const needIds = new Set<string>();

  for (const name of FILES) {
    const file = path.join(dir, name);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as RawFile;
    scenario.files.push({ file: rel(file), sha256: sha256File(file) });
    const spec = raw.specialization;
    if (!SPECIALIZATION_CODES.includes(spec)) problems.push(`${name}: неизвестная специализация ${spec}`);
    const assessable = new Set(assessableSkills(spec).keys());
    const poolIds = new Set(raw.candidates.map((c) => c.id));

    for (const c of raw.candidates) {
      if (candidateIds.has(c.id)) problems.push(`повтор id кандидата ${c.id}`);
      candidateIds.add(c.id);
      if (!GRADES.includes(c.grade)) problems.push(`${c.id}: неизвестный грейд ${c.grade}`);
      if (!(c.overall >= 75 && c.overall <= 100)) problems.push(`${c.id}: подтверждённая квалификация требует балла 75–100, указано ${c.overall}`);
      for (const skill of c.verified) {
        if (!assessable.has(skill)) problems.push(`${c.id}: «${skill}» не проверяется тестами специализации ${spec}, подтвердить его нельзя`);
      }
      for (const skill of [...c.verified, ...c.self]) if (!isKnownSkill(skill)) problems.push(`${c.id}: навыка «${skill}» нет в справочнике`);
      if (c.formats.some((f) => !FORMATS.includes(f)) || c.formats.length === 0) problems.push(`${c.id}: некорректные форматы работы`);
      if (c.salary && !(c.salary[0] > 0 && c.salary[0] <= c.salary[1])) problems.push(`${c.id}: некорректная зарплатная вилка`);
      scenario.candidates.push({
        raw: c,
        specialization: spec,
        match: {
          candidateId: c.id,
          alias: c.id,
          discoverable: c.discoverable ?? true,
          declaredGrade: c.grade,
          minor: false,
          otherCategories: [],
          specialization: spec,
          qualification: { specialization: spec, grade: c.grade, overallScore: c.overall, verifiedSkills: c.verified, groupScores: [], integrityLevel: null },
          selfReportedSkills: c.self,
          workFormats: c.formats,
          city: c.city,
          salary: c.salary ? { from: c.salary[0], to: c.salary[1] } : null,
          salaryHidden: c.salaryHidden ?? false,
          fspAchievements: c.fsp.map((a, index) => ({ externalId: `${c.id}-${index}`, eventId: a.event, discipline: a.discipline, place: a.place, teamRole: a.role })),
          experienceMonths: c.experienceMonths,
        },
      });
    }

    for (const n of raw.needs) {
      if (needIds.has(n.id)) problems.push(`повтор id потребности ${n.id}`);
      needIds.add(n.id);
      if (!['tuning', 'final'].includes(n.split)) problems.push(`${n.id}: неизвестная выборка ${n.split}`);
      if (!FORMATS.includes(n.workFormat)) problems.push(`${n.id}: некорректный формат работы`);
      if (!(n.salary[0] > 0 && n.salary[0] <= n.salary[1])) problems.push(`${n.id}: некорректная вилка`);
      if (n.allowedGrades.length === 0 || n.allowedGrades.some((g) => !GRADES.includes(g))) problems.push(`${n.id}: некорректные допустимые грейды`);
      for (const skill of n.requiredSkills) {
        if (!assessable.has(skill)) problems.push(`${n.id}: обязательный навык «${skill}» не проверяется тестами ${spec}`);
      }
      for (const pref of n.preferredSkills) if (!isKnownSkill(pref.skill)) problems.push(`${n.id}: навыка «${pref.skill}» нет в справочнике`);
      scenario.needs.push({
        raw: n,
        specialization: spec,
        spec: {
          specialization: spec,
          allowedGrades: n.allowedGrades,
          requiredSkills: n.requiredSkills,
          preferredSkills: n.preferredSkills,
          workFormat: n.workFormat,
          city: n.city,
          salaryFrom: n.salary[0],
          salaryTo: n.salary[1],
        },
      });
      const labels = raw.labels[n.id];
      if (!labels) {
        problems.push(`${n.id}: нет разметки`);
        continue;
      }
      const map = new Map<string, RawLabel>();
      for (const [candidateId, label] of Object.entries(labels)) {
        if (!poolIds.has(candidateId)) problems.push(`${n.id}: размечен неизвестный кандидат ${candidateId}`);
        if (![0, 1, 2].includes(label.l)) problems.push(`${n.id}/${candidateId}: оценка должна быть 0, 1 или 2`);
        if (typeof label.v !== 'boolean') problems.push(`${n.id}/${candidateId}: нет флага нарушения условия`);
        if (!label.why?.trim()) problems.push(`${n.id}/${candidateId}: нет обоснования`);
        map.set(candidateId, label);
      }
      for (const id of poolIds) if (!map.has(id)) problems.push(`${n.id}: не размечен кандидат ${id}`);
      scenario.labels.set(n.id, map);
    }
  }

  const perSpec = new Map<string, number>();
  for (const n of scenario.needs) perSpec.set(n.specialization, (perSpec.get(n.specialization) ?? 0) + 1);
  for (const spec of SPECIALIZATION_CODES) if ((perSpec.get(spec) ?? 0) < 3) problems.push(`${spec}: нужно не менее 3 оценочных потребностей`);
  if (scenario.needs.length < 12) problems.push(`Нужно не менее 12 оценочных потребностей, есть ${scenario.needs.length}`);
  if (!scenario.needs.some((n) => n.raw.split === 'tuning') || !scenario.needs.some((n) => n.raw.split === 'final')) problems.push('Нужны обе выборки: tuning и final');

  if (problems.length) throw new Error(`Данные валидации подбора некорректны:\n - ${problems.join('\n - ')}`);
  return scenario;
}

// ───────────────────────────── Метрики ─────────────────────────────

const K = 5;

export interface RankedItem {
  candidateId: string;
  label: 0 | 1 | 2;
  violates: boolean;
  score: number | null;
  grade: GradeCode;
  overall: number;
}

export interface NeedMetrics {
  needId: string;
  split: 'tuning' | 'final';
  specialization: SpecializationCode;
  title: string;
  poolSize: number;
  relevantInPool: number;
  strongInPool: number;
  returned: number;
  top: RankedItem[];
  precisionAt5: number;
  precisionStrictAt5: number;
  precisionReturned: number | null;
  ndcgAt5: number;
  recallStrictAt5: number;
  violationRate: number | null;
  falseExclusions: Array<{ candidateId: string; label: number; why: string; rejectedBecause: string[] }>;
}

export interface SystemRun {
  name: string;
  perNeed: NeedMetrics[];
}

const DEFAULT_LABEL: RawLabel = { l: 0, v: true, why: 'другая специализация' };

function discount(index: number) {
  return 1 / Math.log2(index + 2);
}

function evaluate(scenario: Scenario, need: Scenario['needs'][number], ranked: Array<{ candidateId: string; score: number | null }>, rejections: (candidateId: string) => string[]): NeedMetrics {
  const labels = scenario.labels.get(need.raw.id)!;
  const labelOf = (id: string) => labels.get(id) ?? DEFAULT_LABEL;
  const pool = scenario.candidates.filter((c) => c.specialization === need.specialization);
  const byId = new Map(scenario.candidates.map((c) => [c.raw.id, c]));
  const top = ranked.slice(0, K).map((r) => {
    const label = labelOf(r.candidateId);
    const candidate = byId.get(r.candidateId)!;
    return { candidateId: r.candidateId, label: label.l, violates: label.v, score: r.score, grade: candidate.raw.grade, overall: candidate.raw.overall };
  });
  const relevantInPool = pool.filter((c) => labelOf(c.raw.id).l >= 1).length;
  const strongInPool = pool.filter((c) => labelOf(c.raw.id).l === 2).length;
  const hits = top.filter((t) => t.label >= 1).length;
  const strongHits = top.filter((t) => t.label === 2).length;

  const dcg = top.reduce((sum, t, i) => sum + t.label * discount(i), 0);
  const ideal = pool
    .map((c) => labelOf(c.raw.id).l)
    .sort((a, b) => b - a)
    .slice(0, K)
    .reduce<number>((sum, l, i) => sum + l * discount(i), 0);

  const returnedIds = new Set(ranked.map((r) => r.candidateId));
  const falseExclusions = pool
    .filter((c) => labelOf(c.raw.id).l >= 1 && !returnedIds.has(c.raw.id))
    .map((c) => ({ candidateId: c.raw.id, label: labelOf(c.raw.id).l, why: labelOf(c.raw.id).why, rejectedBecause: rejections(c.raw.id) }));

  return {
    needId: need.raw.id,
    split: need.raw.split,
    specialization: need.specialization,
    title: need.raw.title,
    poolSize: pool.length,
    relevantInPool,
    strongInPool,
    returned: ranked.length,
    top,
    // Знаменатель Precision@5 всегда 5, даже если выдача короче; отдельно — по фактически возвращённым.
    precisionAt5: hits / K,
    precisionStrictAt5: strongHits / K,
    precisionReturned: top.length ? hits / top.length : null,
    ndcgAt5: ideal === 0 ? 0 : dcg / ideal,
    recallStrictAt5: strongInPool === 0 ? 0 : strongHits / Math.min(K, strongInPool),
    violationRate: top.length ? top.filter((t) => t.violates).length / top.length : null,
    falseExclusions,
  };
}

// ───────────────────────────── Системы ─────────────────────────────

function runFormula(scenario: Scenario, formula: MatchingFormula, name: string): SystemRun & { rejectionSummary: Record<string, number> } {
  const candidates = scenario.candidates.map((c) => c.match);
  const rejectionSummary: Record<string, number> = {};
  const perNeed = scenario.needs.map((need) => {
    const result = rankForNeed(candidates, need.spec, formula);
    for (const [reason, count] of Object.entries(result.rejections)) rejectionSummary[reason] = (rejectionSummary[reason] ?? 0) + count;
    const kept = new Set(result.ranked.map((r) => r.candidateId));
    return evaluate(
      scenario,
      need,
      result.ranked.map((r) => ({ candidateId: r.candidateId, score: r.score })),
      (id) => {
        if (kept.has(id)) return [];
        // Причины отказа восстанавливаются повторным запуском на одном кандидате (для отчёта, а не для метрик).
        const single = rankForNeed([candidates.find((c) => c.candidateId === id)!], need.spec, formula);
        return (Object.entries(single.rejections) as Array<[RejectionReason, number]>).filter(([, n]) => n > 0).map(([reason]) => REJECTION_TEXTS[reason]);
      },
    );
  });
  return { name, perNeed, rejectionSummary };
}

/** Простой baseline из ТЗ: фильтр по специализации и грейду, сортировка по общему баллу теста. */
function runBaseline(scenario: Scenario): SystemRun {
  const perNeed = scenario.needs.map((need) => {
    const eligible = scenario.candidates
      .filter((c) => c.match.discoverable && c.specialization === need.specialization && need.spec.allowedGrades.includes(c.raw.grade))
      .sort((a, b) => b.raw.overall - a.raw.overall || (a.raw.id < b.raw.id ? -1 : 1));
    const kept = new Set(eligible.map((c) => c.raw.id));
    return evaluate(
      scenario,
      need,
      eligible.map((c) => ({ candidateId: c.raw.id, score: c.raw.overall })),
      (id) => (kept.has(id) ? [] : ['не прошёл фильтр специализации и грейда']),
    );
  });
  return { name: 'baseline: специализация/грейд + балл теста', perNeed };
}

// ───────────────────────────── Агрегирование ─────────────────────────────

export interface Aggregate {
  needs: number;
  precisionAt5: number | null;
  precisionStrictAt5: number | null;
  /** Среднее по потребностям, где выдача непуста. */
  precisionReturned: number | null;
  ndcgAt5: number | null;
  recallStrictAt5: number | null;
  /** Доля нарушений среди всех возвращённых в top-5 (пул по всем потребностям). */
  violationRatePooled: number | null;
  needsWithAnyViolation: number;
  coverage: number | null;
  returnedTotal: number;
  shorterThan5: number;
  falseExclusions: number;
  relevantTotal: number;
}

export function aggregate(rows: NeedMetrics[]): Aggregate {
  const returnedTop = rows.flatMap((r) => r.top);
  const relevantTotal = rows.reduce((sum, r) => sum + r.relevantInPool, 0);
  return {
    needs: rows.length,
    precisionAt5: round(mean(rows.map((r) => r.precisionAt5))),
    precisionStrictAt5: round(mean(rows.map((r) => r.precisionStrictAt5))),
    precisionReturned: round(mean(rows.filter((r) => r.precisionReturned !== null).map((r) => r.precisionReturned!))),
    ndcgAt5: round(mean(rows.map((r) => r.ndcgAt5))),
    recallStrictAt5: round(mean(rows.map((r) => r.recallStrictAt5))),
    violationRatePooled: returnedTop.length ? round(returnedTop.filter((t) => t.violates).length / returnedTop.length) : null,
    needsWithAnyViolation: rows.filter((r) => r.top.some((t) => t.violates)).length,
    coverage: rows.length ? round(rows.filter((r) => r.returned > 0).length / rows.length) : null,
    returnedTotal: returnedTop.length,
    shorterThan5: rows.filter((r) => r.returned < K).length,
    falseExclusions: rows.reduce((sum, r) => sum + r.falseExclusions.length, 0),
    relevantTotal,
  };
}

interface Interval {
  mean: number;
  low: number;
  high: number;
}

const interval = (values: number[], seed: string): Interval | null => {
  const b = bootstrapMean(values, seed);
  return b ? { mean: round(b.mean)!, low: round(b.low)!, high: round(b.high)! } : null;
};

export interface MatchingResults {
  version: { algorithm: string; formula: string; fspRelevance: string };
  formula: MatchingFormula;
  formulaSha256: string;
  protocol: string[];
  datasets: Scenario['files'];
  sizes: { candidates: number; needs: number; tuningNeeds: number; finalNeeds: number; labeledPairs: number; labelCounts: Record<string, number>; hiddenCandidates: number };
  systems: Array<{
    name: string;
    perNeed: NeedMetrics[];
    bySplit: Record<'tuning' | 'final' | 'all', Aggregate>;
    bySpecialization: Record<string, Aggregate>;
    finalIntervals: Record<string, Interval | null>;
    rejectionSummary?: Record<string, number>;
  }>;
  pairedDifference: { metric: string; mean: number; low: number; high: number }[];
  sensitivity: Array<{ name: string; needWeights: MatchingFormula['needWeights']; selfReportedCredit: number; tuning: Aggregate; finalPostHoc: Aggregate }>;
  falseExclusionList: Array<{ needId: string; candidateId: string; label: number; why: string; rejectedBecause: string[] }>;
  gates: Array<{ name: string; ok: boolean; detail: string }>;
}

function summarize(run: SystemRun, rejectionSummary?: Record<string, number>) {
  const split = (name: 'tuning' | 'final' | 'all') => aggregate(run.perNeed.filter((r) => name === 'all' || r.split === name));
  const bySpecialization: Record<string, Aggregate> = {};
  for (const spec of SPECIALIZATION_CODES) bySpecialization[spec] = aggregate(run.perNeed.filter((r) => r.specialization === spec && r.split === 'final'));
  const finals = run.perNeed.filter((r) => r.split === 'final');
  return {
    name: run.name,
    perNeed: run.perNeed,
    bySplit: { tuning: split('tuning'), final: split('final'), all: split('all') },
    bySpecialization,
    finalIntervals: {
      precisionAt5: interval(finals.map((r) => r.precisionAt5), `${run.name}|p5`),
      ndcgAt5: interval(finals.map((r) => r.ndcgAt5), `${run.name}|ndcg`),
    },
    rejectionSummary,
  };
}

export function runMatchingValidation(): MatchingResults {
  const scenario = loadScenario();
  const formula = getMatchingFormula('matching-formula-v1');
  const formulaRun = runFormula(scenario, formula, `matching-formula-v1 (${MATCHING_ALGORITHM_VERSION})`);
  const baselineRun = runBaseline(scenario);

  // Парная разница «формула − baseline» по итоговым потребностям (перевыборка потребностей).
  const finalNeeds = scenario.needs.filter((n) => n.raw.split === 'final').map((n) => n.raw.id);
  const pick = (run: SystemRun, metric: keyof NeedMetrics) => finalNeeds.map((id) => run.perNeed.find((r) => r.needId === id)![metric] as number);
  const paired = (['precisionAt5', 'ndcgAt5'] as const).map((metric) => {
    const a = pick(formulaRun, metric);
    const b = pick(baselineRun, metric);
    const interval = bootstrapMean(a.map((v, i) => v - b[i]), `paired|${metric}`)!;
    return { metric, mean: round(interval.mean)!, low: round(interval.low)!, high: round(interval.high)! };
  });

  // Чувствительность к весам: только по выборке tuning, информационно. Итоговые веса заданы ТЗ и не менялись.
  const variants: Array<{ name: string; needWeights: MatchingFormula['needWeights']; selfReportedCredit: number }> = [
    { name: 'matching-formula-v1 (ТЗ)', needWeights: formula.needWeights, selfReportedCredit: formula.selfReportedCredit },
    { name: 'больше веса качеству теста (30/65/5)', needWeights: { preferredFit: 30, assessmentQuality: 65, fspEvidence: 5 }, selfReportedCredit: formula.selfReportedCredit },
    { name: 'равновесие (50/45/5)', needWeights: { preferredFit: 50, assessmentQuality: 45, fspEvidence: 5 }, selfReportedCredit: formula.selfReportedCredit },
    { name: 'больше веса желательным навыкам (85/10/5)', needWeights: { preferredFit: 85, assessmentQuality: 10, fspEvidence: 5 }, selfReportedCredit: formula.selfReportedCredit },
    { name: 'сильнее бонус ФСП (65/20/15)', needWeights: { preferredFit: 65, assessmentQuality: 20, fspEvidence: 15 }, selfReportedCredit: formula.selfReportedCredit },
    { name: 'заявленный навык без вклада (0)', needWeights: formula.needWeights, selfReportedCredit: 0 },
    { name: 'заявленный навык с вкладом 0,6', needWeights: formula.needWeights, selfReportedCredit: 0.6 },
  ];
  const sensitivity = variants.map((variant) => {
    const run = runFormula(scenario, { ...formula, needWeights: variant.needWeights, selfReportedCredit: variant.selfReportedCredit }, variant.name);
    return {
      ...variant,
      tuning: aggregate(run.perNeed.filter((r) => r.split === 'tuning')),
      // Только для информации: итоговые веса уже зафиксированы и по этому анализу не менялись.
      finalPostHoc: aggregate(run.perNeed.filter((r) => r.split === 'final')),
    };
  });

  const labelCounts: Record<string, number> = { '0': 0, '1': 0, '2': 0 };
  let labeledPairs = 0;
  for (const labels of scenario.labels.values()) {
    for (const label of labels.values()) {
      labelCounts[String(label.l)] += 1;
      labeledPairs += 1;
    }
  }

  // Инварианты подбора на данных валидации (не метрики качества, а свойства реализации).
  const allMatch = scenario.candidates.map((c) => c.match);
  const hiddenIds = new Set(scenario.candidates.filter((c) => c.raw.discoverable === false).map((c) => c.raw.id));
  const returnedHidden = formulaRun.perNeed.flatMap((r) => r.top.filter((t) => hiddenIds.has(t.candidateId)).map((t) => `${r.needId}:${t.candidateId}`));
  let orderMismatches = 0;
  let orderChecks = 0;
  for (const need of scenario.needs) {
    const signature = (candidates: MatchCandidate[]) =>
      rankForNeed(candidates, need.spec, formula)
        .ranked.map((r) => `${r.candidateId}:${r.score}`)
        .join();
    const base = signature(allMatch);
    for (let k = 0; k < 5; k += 1) {
      orderChecks += 1;
      if (signature(createRng(`matching-order|${need.raw.id}|${k}`).shuffle(allMatch)) !== base) orderMismatches += 1;
    }
  }
  const returnedTop = formulaRun.perNeed.flatMap((r) => r.top);
  const pooledViolations = returnedTop.filter((t) => t.violates).length;
  const gates = [
    { name: 'Подбор: скрытые кандидаты никогда не попадают в выдачу', ok: returnedHidden.length === 0, detail: `скрытых в пуле: ${hiddenIds.size}, возвращено: ${returnedHidden.length}` },
    { name: 'Подбор: порядок выдачи не зависит от порядка входных данных', ok: orderMismatches === 0, detail: `${orderMismatches} расхождений в ${orderChecks} перестановках` },
    { name: 'Подбор: в top-5 нет кандидатов с нарушением явного условия потребности (по разметке)', ok: pooledViolations === 0, detail: `${pooledViolations} из ${returnedTop.length} возвращённых` },
    { name: 'Данные: не менее 12 потребностей (по 3 на специализацию), обе выборки непусты', ok: scenario.needs.length >= 12, detail: `${scenario.needs.length} потребностей, ${scenario.candidates.length} кандидатов, ${labeledPairs} размеченных пар` },
  ];

  return {
    version: { algorithm: MATCHING_ALGORITHM_VERSION, formula: formula.version, fspRelevance: FSP_RELEVANCE_VERSION },
    formula,
    formulaSha256: sha256(JSON.stringify(formula)),
    protocol: [
      'Веса matching-formula-v1 заданы ТЗ и зафиксированы в apps/api/src/config/policies.ts до составления разметки; по разметке не подбирались.',
      'Выборка tuning (4 потребности) использовалась для отладки данных и информационного анализа чувствительности весов; веса после этого не менялись.',
      'Итоговые показатели считаются по выборке final (8 потребностей), разметка которой зафиксирована хэшами файлов.',
      'Разметка авторская синтетическая, выполнена теми же людьми, что реализовали формулу; это не экспертная внешняя разметка.',
    ],
    datasets: scenario.files,
    sizes: {
      candidates: scenario.candidates.length,
      needs: scenario.needs.length,
      tuningNeeds: scenario.needs.filter((n) => n.raw.split === 'tuning').length,
      finalNeeds: finalNeeds.length,
      labeledPairs,
      labelCounts,
      hiddenCandidates: scenario.candidates.filter((c) => c.raw.discoverable === false).length,
    },
    systems: [summarize(formulaRun, formulaRun.rejectionSummary), summarize(baselineRun)],
    pairedDifference: paired,
    sensitivity,
    falseExclusionList: formulaRun.perNeed.flatMap((r) => r.falseExclusions.map((f) => ({ needId: r.needId, ...f }))),
    gates,
  };
}

