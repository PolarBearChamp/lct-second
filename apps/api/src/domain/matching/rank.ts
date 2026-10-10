import type { MatchingFormula } from '../../config/policies';
import { GRADE_ORDER, GRADE_TITLES, getSkill, SPECIALIZATION_CODES, type GradeCode } from '../catalog/catalog';
import { fspEvidence, type FspAchievementFacts } from './fsp-relevance';

/**
 * Подбор кандидатов по потребности работодателя и сортировка общего банка (matching-formula-v1).
 *
 * 1. Жёсткие условия: видимость, подтверждённая специализация и допустимый грейд, все обязательные навыки
 *    подтверждены тестом, совместимость формата/города, пересечение зарплатных вилок (если ожидания заданы и видимы).
 *    ФСП, самоописание и высокий общий балл не компенсируют провал обязательного условия.
 * 2. Для прошедших: score = w1·preferredFit + w2·assessmentQuality + w3·fspEvidence (компоненты 0..1).
 * 3. Стабильный порядок: score ↓, балл теста ↓, id кандидата ↑.
 * 4. Кандидаты без подтверждённого грейда по специализации потребности (рекомендация организаторов: не скрывать, а
 *    показывать ниже с пометкой) идут отдельным блоком **после всех** подтверждённых. Для них проверяются те же условия,
 *    но по заявленным данным (заявленный грейд, обязательные навыки из самоописания), score не считается: формула
 *    опирается на результат теста. Порядок внутри блока: желательные навыки из самоописания ↓, бонус ФСП ↓, id ↑.
 *
 * Score — относительная мера соответствия описанной потребности, а не вероятность найма.
 */

export const MATCHING_ALGORITHM_VERSION = 'rank-v1';

export interface MatchCandidate {
  candidateId: string;
  alias: string;
  /** Все условия попадания в поиск выполнены (email, профиль, согласие, видимость, ACTIVE). Подтверждённый грейд не обязателен. */
  discoverable: boolean;
  /** Заявленный кандидатом грейд (самоописание). */
  declaredGrade: GradeCode | null;
  /** Кандидату 16–17 лет: особые условия трудоустройства (ТК РФ, гл. 42). Дата рождения не передаётся. */
  minor: boolean;
  /** Остальные подтверждённые категории кандидата (кроме той, по которой он оценивается в этой записи). */
  otherCategories: Array<{ specialization: string; grade: GradeCode }>;
  specialization: string | null;
  qualification: {
    specialization: string;
    grade: GradeCode;
    overallScore: number;
    verifiedSkills: string[];
    groupScores: Array<{ group: string; title: string; score: number }>;
    /** Сводный уровень сигналов честности попытки (информация, на подбор не влияет); null — оценки нет. */
    integrityLevel: 'NONE' | 'NOTE' | 'ATTENTION' | null;
  } | null;
  selfReportedSkills: string[];
  workFormats: string[];
  city: string | null;
  /** null — ожидания не заданы; hidden=true — кандидат скрыл ожидания от работодателей. */
  salary: { from: number | null; to: number | null } | null;
  salaryHidden: boolean;
  fspAchievements: FspAchievementFacts[];
  experienceMonths: number | null;
}

export interface NeedSpec {
  specialization: string;
  allowedGrades: GradeCode[];
  requiredSkills: string[];
  preferredSkills: Array<{ skill: string; mode: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY' }>;
  workFormat: 'REMOTE' | 'HYBRID' | 'OFFICE';
  city: string | null;
  salaryFrom: number;
  salaryTo: number;
}

/** Уточнения поверх потребности. Всегда сужают выдачу, никогда не ослабляют обязательные условия. */
export interface Refinements {
  onlyWithFsp?: boolean;
  minOverallScore?: number;
  extraRequiredSkills?: string[];
  cities?: string[];
}

export type RejectionReason =
  | 'NOT_DISCOVERABLE'
  | 'SPECIALIZATION'
  | 'GRADE'
  | 'REQUIRED_SKILL'
  | 'WORK_FORMAT'
  | 'CITY'
  | 'SALARY'
  | 'REFINEMENT_FSP'
  | 'REFINEMENT_SCORE'
  | 'REFINEMENT_SKILL'
  | 'REFINEMENT_CITY';

export interface ComponentBreakdown {
  value: number;
  weight: number;
  contribution: number;
}

export interface MatchExplanation {
  /** «Почему подходит» — пройденные обязательные условия и совпадения. */
  why: string[];
  /** «Что пока не подтверждено». */
  notVerified: string[];
  passedRequirements: Array<{ code: string; text: string }>;
  matchedPreferred: Array<{ skill: string; title: string; evidence: 'VERIFIED' | 'SELF_REPORTED'; credit: number }>;
  unmatchedPreferred: Array<{ skill: string; title: string; reason: 'NOT_PRESENT' | 'SELF_REPORTED_NOT_ACCEPTED' }>;
  salary: { status: 'OVERLAP' | 'NOT_SPECIFIED' | 'HIDDEN'; text: string };
  components: { preferredFit: ComponentBreakdown; assessmentQuality: ComponentBreakdown; fspEvidence: ComponentBreakdown & { relevantEvents: number; points: number } };
}

export interface RankedCandidate {
  candidateId: string;
  alias: string;
  rank: number;
  score: number;
  overallScore: number;
  grade: GradeCode;
  explanation: MatchExplanation;
}

/** Кандидат без подтверждённого грейда: показывается после подтверждённых, без score. */
export interface UnconfirmedRankedCandidate {
  candidateId: string;
  alias: string;
  rank: number;
  declaredGrade: GradeCode;
  explanation: MatchExplanation;
}

export interface RankResult {
  ranked: RankedCandidate[];
  /** Блок «без подтверждённого грейда»; ранги продолжают нумерацию подтверждённых. */
  unconfirmed: UnconfirmedRankedCandidate[];
  considered: number;
  rejections: Record<RejectionReason, number>;
  rejectedBySkill: Record<string, number>;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
const fmt = (n: number) => n.toLocaleString('ru-RU');
const skillTitle = (code: string) => getSkill(code)?.title ?? code;

function emptyRejections(): Record<RejectionReason, number> {
  return {
    NOT_DISCOVERABLE: 0,
    SPECIALIZATION: 0,
    GRADE: 0,
    REQUIRED_SKILL: 0,
    WORK_FORMAT: 0,
    CITY: 0,
    SALARY: 0,
    REFINEMENT_FSP: 0,
    REFINEMENT_SCORE: 0,
    REFINEMENT_SKILL: 0,
    REFINEMENT_CITY: 0,
  };
}

/** Пересечение зарплатных вилок. Ожидания кандидата могут быть заданы только «от» или только «до». */
export function salaryOverlaps(candidate: { from: number | null; to: number | null }, needFrom: number, needTo: number): boolean {
  const from = candidate.from ?? 0;
  const to = candidate.to ?? Number.POSITIVE_INFINITY;
  return from <= needTo && to >= needFrom;
}

/** Проверка обязательных условий. Возвращает список нарушений (пустой — кандидат проходит). */
export function mandatoryViolations(candidate: MatchCandidate, need: NeedSpec, refinements: Refinements = {}): RejectionReason[] {
  const violations: RejectionReason[] = [];
  if (!candidate.discoverable) violations.push('NOT_DISCOVERABLE');
  const q = candidate.qualification;
  if (!q || candidate.specialization !== need.specialization || q.specialization !== need.specialization) {
    violations.push('SPECIALIZATION');
    return violations;
  }
  if (!need.allowedGrades.includes(q.grade)) violations.push('GRADE');
  if (need.requiredSkills.some((skill) => !q.verifiedSkills.includes(skill))) violations.push('REQUIRED_SKILL');
  if (!candidate.workFormats.includes(need.workFormat)) violations.push('WORK_FORMAT');
  if (need.workFormat !== 'REMOTE' && need.city && norm(candidate.city) !== norm(need.city)) violations.push('CITY');
  if (candidate.salary && !candidate.salaryHidden && !salaryOverlaps(candidate.salary, need.salaryFrom, need.salaryTo)) {
    violations.push('SALARY');
  }
  if (refinements.onlyWithFsp && candidate.fspAchievements.length === 0) violations.push('REFINEMENT_FSP');
  if (refinements.minOverallScore !== undefined && q.overallScore < refinements.minOverallScore) violations.push('REFINEMENT_SCORE');
  if (refinements.extraRequiredSkills?.some((skill) => !q.verifiedSkills.includes(skill))) violations.push('REFINEMENT_SKILL');
  if (refinements.cities?.length && !refinements.cities.map(norm).includes(norm(candidate.city))) violations.push('REFINEMENT_CITY');
  return violations;
}

/** Кандидат без подтверждённой квалификации по специализации потребности, который виден работодателям. */
export function isUnconfirmedForSpec(candidate: MatchCandidate, specialization: string): boolean {
  return candidate.discoverable && !candidate.qualification && candidate.specialization === specialization;
}

/**
 * Условия для блока «без подтверждённого грейда»: те же, что для подтверждённых, но по заявленным данным.
 * Уточнения, требующие результата теста (минимальный балл, дополнительные подтверждённые навыки), такие кандидаты не проходят.
 */
export function unconfirmedViolations(candidate: MatchCandidate, need: NeedSpec, refinements: Refinements = {}): RejectionReason[] {
  const violations: RejectionReason[] = [];
  if (!candidate.declaredGrade || !need.allowedGrades.includes(candidate.declaredGrade)) violations.push('GRADE');
  if (need.requiredSkills.some((skill) => !candidate.selfReportedSkills.includes(skill))) violations.push('REQUIRED_SKILL');
  if (!candidate.workFormats.includes(need.workFormat)) violations.push('WORK_FORMAT');
  if (need.workFormat !== 'REMOTE' && need.city && norm(candidate.city) !== norm(need.city)) violations.push('CITY');
  if (candidate.salary && !candidate.salaryHidden && !salaryOverlaps(candidate.salary, need.salaryFrom, need.salaryTo)) violations.push('SALARY');
  if (refinements.onlyWithFsp && candidate.fspAchievements.length === 0) violations.push('REFINEMENT_FSP');
  if (refinements.minOverallScore !== undefined) violations.push('REFINEMENT_SCORE');
  if (refinements.extraRequiredSkills?.length) violations.push('REFINEMENT_SKILL');
  if (refinements.cities?.length && !refinements.cities.map(norm).includes(norm(candidate.city))) violations.push('REFINEMENT_CITY');
  return violations;
}

export function preferredFit(candidate: MatchCandidate, need: NeedSpec, formula: MatchingFormula) {
  const verified = new Set(candidate.qualification?.verifiedSkills ?? []);
  const self = new Set(candidate.selfReportedSkills);
  const matched: MatchExplanation['matchedPreferred'] = [];
  const unmatched: MatchExplanation['unmatchedPreferred'] = [];
  if (need.preferredSkills.length === 0) return { value: 1, matched, unmatched };
  let sum = 0;
  for (const pref of need.preferredSkills) {
    if (verified.has(pref.skill)) {
      sum += 1;
      matched.push({ skill: pref.skill, title: skillTitle(pref.skill), evidence: 'VERIFIED', credit: 1 });
    } else if (self.has(pref.skill)) {
      if (pref.mode === 'SELF_REPORTED_ALLOWED') {
        sum += formula.selfReportedCredit;
        matched.push({ skill: pref.skill, title: skillTitle(pref.skill), evidence: 'SELF_REPORTED', credit: formula.selfReportedCredit });
      } else {
        unmatched.push({ skill: pref.skill, title: skillTitle(pref.skill), reason: 'SELF_REPORTED_NOT_ACCEPTED' });
      }
    } else {
      unmatched.push({ skill: pref.skill, title: skillTitle(pref.skill), reason: 'NOT_PRESENT' });
    }
  }
  return { value: sum / need.preferredSkills.length, matched, unmatched };
}

function compareRanked(a: { score: number; overallScore: number; candidateId: string }, b: { score: number; overallScore: number; candidateId: string }) {
  return b.score - a.score || b.overallScore - a.overallScore || (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0);
}

/** Подбор по потребности: жёсткие фильтры → компоненты → стабильная сортировка всего множества (до пагинации). */
export function rankForNeed(candidates: MatchCandidate[], need: NeedSpec, formula: MatchingFormula, refinements: Refinements = {}): RankResult {
  const rejections = emptyRejections();
  const rejectedBySkill: Record<string, number> = {};
  const scored: Array<Omit<RankedCandidate, 'rank'>> = [];
  const pending: Array<Omit<UnconfirmedRankedCandidate, 'rank'> & { preferred: number; fsp: number }> = [];
  const w = formula.needWeights;

  for (const candidate of candidates) {
    if (isUnconfirmedForSpec(candidate, need.specialization)) {
      const soft = unconfirmedViolations(candidate, need, refinements);
      if (soft.length) {
        for (const v of soft) rejections[v] += 1;
        continue;
      }
      const pf = preferredFit(candidate, need, formula);
      const fsp = fspEvidence(candidate.fspAchievements, need.specialization, formula);
      pending.push({
        candidateId: candidate.candidateId,
        alias: candidate.alias,
        declaredGrade: candidate.declaredGrade!,
        preferred: pf.value,
        fsp: fsp.value,
        explanation: explainUnconfirmed(candidate, need, formula, pf, fsp),
      });
      continue;
    }
    const violations = mandatoryViolations(candidate, need, refinements);
    if (violations.length) {
      for (const v of violations) rejections[v] += 1;
      if (violations.includes('REQUIRED_SKILL') && candidate.qualification) {
        for (const skill of need.requiredSkills) {
          if (!candidate.qualification.verifiedSkills.includes(skill)) rejectedBySkill[skill] = (rejectedBySkill[skill] ?? 0) + 1;
        }
      }
      continue;
    }
    const q = candidate.qualification!;
    const pf = preferredFit(candidate, need, formula);
    const aq = q.overallScore / 100;
    const fsp = fspEvidence(candidate.fspAchievements, need.specialization, formula);
    const score = round2(w.preferredFit * pf.value + w.assessmentQuality * aq + w.fspEvidence * fsp.value);
    scored.push({
      candidateId: candidate.candidateId,
      alias: candidate.alias,
      score,
      overallScore: q.overallScore,
      grade: q.grade,
      explanation: explain(candidate, need, formula, pf, aq, fsp),
    });
  }
  scored.sort(compareRanked);
  pending.sort((a, b) => b.preferred - a.preferred || b.fsp - a.fsp || (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
  return {
    ranked: scored.map((item, index) => ({ ...item, rank: index + 1 })),
    unconfirmed: pending.map(({ preferred: _p, fsp: _f, ...item }, index) => ({ ...item, rank: scored.length + index + 1 })),
    considered: candidates.length,
    rejections,
    rejectedBySkill,
  };
}

function formatRequirement(need: NeedSpec): string {
  const formatTitle = { REMOTE: 'удалённо', HYBRID: 'гибрид', OFFICE: 'офис' }[need.workFormat];
  return need.workFormat === 'REMOTE' || !need.city ? `Подходит формат работы: ${formatTitle}` : `Подходит формат работы (${formatTitle}) и город ${need.city}`;
}

function salaryStatus(candidate: MatchCandidate, need: NeedSpec): MatchExplanation['salary'] {
  if (candidate.salaryHidden) return { status: 'HIDDEN', text: 'Кандидат скрыл зарплатные ожидания — они не использовались в подборе' };
  if (!candidate.salary) return { status: 'NOT_SPECIFIED', text: 'Ожидания не указаны' };
  const s = candidate.salary;
  const range = s.from && s.to ? `${fmt(s.from)}–${fmt(s.to)} ₽` : s.from ? `от ${fmt(s.from)} ₽` : `до ${fmt(s.to!)} ₽`;
  return { status: 'OVERLAP', text: `Ожидания ${range} пересекаются с вилкой ${fmt(need.salaryFrom)}–${fmt(need.salaryTo)} ₽` };
}

/** Объяснение для блока «без подтверждённого грейда»: всё, что совпало, — по самоописанию и явно помечено. */
function explainUnconfirmed(
  candidate: MatchCandidate,
  need: NeedSpec,
  formula: MatchingFormula,
  pf: ReturnType<typeof preferredFit>,
  fsp: ReturnType<typeof fspEvidence>,
): MatchExplanation {
  const w = formula.needWeights;
  const salary = salaryStatus(candidate, need);
  const passed: Array<{ code: string; text: string }> = [
    {
      code: 'DECLARED_GRADE',
      text: `Заявленный грейд ${GRADE_TITLES[candidate.declaredGrade!]} входит в допустимые (${need.allowedGrades.map((g) => GRADE_TITLES[g]).join(', ')}) — тестом не подтверждён`,
    },
  ];
  if (need.requiredSkills.length) {
    passed.push({ code: 'REQUIRED_SKILLS_DECLARED', text: `Обязательные навыки указаны кандидатом: ${need.requiredSkills.map(skillTitle).join(', ')}` });
  }
  passed.push({ code: 'FORMAT', text: formatRequirement(need) });
  passed.push({ code: 'SALARY', text: salary.text });
  const why = passed.map((p) => p.text);
  const selfMatches = pf.matched.filter((m) => m.evidence === 'SELF_REPORTED');
  if (selfMatches.length) why.push(`Желательные навыки указаны кандидатом: ${selfMatches.map((m) => m.title).join(', ')}`);
  if (fsp.relevantEvents > 0) why.push(`Релевантные достижения ФСП: ${fsp.relevantEvents} мероприятие(й), ${fsp.points} балл(ов) бонуса`);
  const notVerified = [
    'Грейд не подтверждён тестом: кандидат показан ниже всех подтверждённых, балл подбора не считается',
    ...(need.requiredSkills.length ? [`Обязательные навыки тестом не проверены: ${need.requiredSkills.map(skillTitle).join(', ')}`] : []),
    ...pf.unmatched.map((item) =>
      item.reason === 'SELF_REPORTED_NOT_ACCEPTED'
        ? `${item.title}: указан кандидатом, но требование — только подтверждённый тестом`
        : `${item.title}: нет ни подтверждения тестом, ни упоминания в профиле`,
    ),
  ];
  if (fsp.relevantEvents === 0) notVerified.push('Нет релевантных достижений ФСП');
  return {
    why,
    notVerified,
    passedRequirements: passed,
    matchedPreferred: pf.matched,
    unmatchedPreferred: pf.unmatched,
    salary,
    components: {
      preferredFit: { value: round2(pf.value), weight: w.preferredFit, contribution: round2(w.preferredFit * pf.value) },
      assessmentQuality: { value: 0, weight: w.assessmentQuality, contribution: 0 },
      fspEvidence: { value: round2(fsp.value), weight: w.fspEvidence, contribution: round2(w.fspEvidence * fsp.value), relevantEvents: fsp.relevantEvents, points: fsp.points },
    },
  };
}

function explain(
  candidate: MatchCandidate,
  need: NeedSpec,
  formula: MatchingFormula,
  pf: ReturnType<typeof preferredFit>,
  aq: number,
  fsp: ReturnType<typeof fspEvidence>,
): MatchExplanation {
  const q = candidate.qualification!;
  const w = formula.needWeights;
  const passed: Array<{ code: string; text: string }> = [
    {
      code: 'GRADE',
      text: `Грейд по результатам тестирования ${GRADE_TITLES[q.grade]} входит в допустимые (${need.allowedGrades.map((g) => GRADE_TITLES[g]).join(', ')})`,
    },
  ];
  if (need.requiredSkills.length) {
    passed.push({ code: 'REQUIRED_SKILLS', text: `Подтверждены тестом все обязательные навыки: ${need.requiredSkills.map(skillTitle).join(', ')}` });
  }
  const formatTitle = { REMOTE: 'удалённо', HYBRID: 'гибрид', OFFICE: 'офис' }[need.workFormat];
  passed.push({
    code: 'FORMAT',
    text: need.workFormat === 'REMOTE' || !need.city ? `Подходит формат работы: ${formatTitle}` : `Подходит формат работы (${formatTitle}) и город ${need.city}`,
  });

  let salary: MatchExplanation['salary'];
  if (candidate.salaryHidden) {
    salary = { status: 'HIDDEN', text: 'Кандидат скрыл зарплатные ожидания — они не использовались в подборе' };
  } else if (!candidate.salary) {
    salary = { status: 'NOT_SPECIFIED', text: 'Ожидания не указаны' };
  } else {
    const s = candidate.salary;
    const range = s.from && s.to ? `${fmt(s.from)}–${fmt(s.to)} ₽` : s.from ? `от ${fmt(s.from)} ₽` : `до ${fmt(s.to!)} ₽`;
    salary = { status: 'OVERLAP', text: `Ожидания ${range} пересекаются с вилкой ${fmt(need.salaryFrom)}–${fmt(need.salaryTo)} ₽` };
  }
  passed.push({ code: 'SALARY', text: salary.text });

  const why = [...passed.map((p) => p.text)];
  const verifiedMatches = pf.matched.filter((m) => m.evidence === 'VERIFIED');
  const selfMatches = pf.matched.filter((m) => m.evidence === 'SELF_REPORTED');
  if (verifiedMatches.length) why.push(`Желательные навыки подтверждены тестом: ${verifiedMatches.map((m) => m.title).join(', ')}`);
  if (selfMatches.length) why.push(`Желательные навыки указаны кандидатом (вклад ×${formula.selfReportedCredit}): ${selfMatches.map((m) => m.title).join(', ')}`);
  why.push(`Общий балл теста: ${q.overallScore} из 100`);
  if (fsp.relevantEvents > 0) why.push(`Релевантные достижения ФСП: ${fsp.relevantEvents} мероприятие(й), ${fsp.points} балл(ов) бонуса`);

  const notVerified: string[] = [];
  for (const item of pf.unmatched) {
    notVerified.push(
      item.reason === 'SELF_REPORTED_NOT_ACCEPTED'
        ? `${item.title}: указан кандидатом, но требование — только подтверждённый тестом`
        : `${item.title}: нет ни подтверждения тестом, ни упоминания в профиле`,
    );
  }
  for (const m of selfMatches) notVerified.push(`${m.title}: только самоописание, тестом не проверялся`);
  if (fsp.relevantEvents === 0) notVerified.push('Нет релевантных достижений ФСП (это не снижает доступ к подборке)');

  return {
    why,
    notVerified,
    passedRequirements: passed,
    matchedPreferred: pf.matched,
    unmatchedPreferred: pf.unmatched,
    salary,
    components: {
      preferredFit: { value: round2(pf.value), weight: w.preferredFit, contribution: round2(w.preferredFit * pf.value) },
      assessmentQuality: { value: round2(aq), weight: w.assessmentQuality, contribution: round2(w.assessmentQuality * aq) },
      fspEvidence: {
        value: round2(fsp.value),
        weight: w.fspEvidence,
        contribution: round2(w.fspEvidence * fsp.value),
        relevantEvents: fsp.relevantEvents,
        points: fsp.points,
      },
    },
  };
}

// ───────────────────────────── Общий банк ─────────────────────────────

export interface BankFilters {
  specialization?: string;
  /** Показывать кандидатов без подтверждённого грейда (после подтверждённых своей специализации). По умолчанию — да. */
  includeUnconfirmed?: boolean;
  /** Только кандидаты без подтверждённого грейда (категория «SPEC:UNCONFIRMED»). */
  onlyUnconfirmed?: boolean;
  grades?: GradeCode[];
  skills?: string[];
  /** VERIFIED — навыки должны быть подтверждены тестом; ANY — подтверждены или указаны кандидатом. */
  skillSource?: 'VERIFIED' | 'ANY';
  workFormat?: 'REMOTE' | 'HYBRID' | 'OFFICE';
  hasFsp?: boolean;
  city?: string;
}

export interface BankRanked {
  candidateId: string;
  alias: string;
  specialization: string;
  /** null — грейд не подтверждён тестом. */
  grade: GradeCode | null;
  overallScore: number | null;
  /** null — без подтверждённого грейда балл не считается. */
  bankScore: number | null;
  fspPoints: number;
  fspValue: number;
}

/**
 * Общий банк: видимые кандидаты. Сортировка по категории (специализация, затем подтверждённый грейд от Senior к Junior),
 * внутри категории — bankWeights (качество теста + бонус ФСП). Категории не перемешиваются, будто числовой балл полностью
 * отражает разницу грейдов. Кандидаты без подтверждённого грейда — последней «категорией» своей специализации, без балла
 * (порядок: бонус ФСП ↓, id ↑); фильтры по грейду применяются к заявленному грейду, по навыкам «подтверждены тестом» их исключают.
 */
export function rankBank(candidates: MatchCandidate[], filters: BankFilters, formula: MatchingFormula): BankRanked[] {
  const w = formula.bankWeights;
  const result: BankRanked[] = [];
  for (const c of candidates) {
    const q = c.qualification;
    if (!c.discoverable) continue;
    if (!q) {
      if (filters.includeUnconfirmed === false || !c.specialization) continue;
      if (filters.specialization && c.specialization !== filters.specialization) continue;
      if (filters.grades?.length && (!c.declaredGrade || !filters.grades.includes(c.declaredGrade))) continue;
      if (filters.skills?.length && (filters.skillSource !== 'ANY' || !filters.skills.every((s) => c.selfReportedSkills.includes(s)))) continue;
      if (filters.workFormat && !c.workFormats.includes(filters.workFormat)) continue;
      if (filters.hasFsp && c.fspAchievements.length === 0) continue;
      if (filters.city && norm(c.city) !== norm(filters.city)) continue;
      const fsp = fspEvidence(c.fspAchievements, c.specialization, formula);
      result.push({ candidateId: c.candidateId, alias: c.alias, specialization: c.specialization, grade: null, overallScore: null, bankScore: null, fspPoints: fsp.points, fspValue: round2(fsp.value) });
      continue;
    }
    if (filters.onlyUnconfirmed || c.specialization !== q.specialization) continue;
    if (filters.specialization && q.specialization !== filters.specialization) continue;
    if (filters.grades?.length && !filters.grades.includes(q.grade)) continue;
    if (filters.skills?.length) {
      const pool = new Set(filters.skillSource === 'ANY' ? [...q.verifiedSkills, ...c.selfReportedSkills] : q.verifiedSkills);
      if (!filters.skills.every((s) => pool.has(s))) continue;
    }
    if (filters.workFormat && !c.workFormats.includes(filters.workFormat)) continue;
    if (filters.hasFsp && c.fspAchievements.length === 0) continue;
    if (filters.city && norm(c.city) !== norm(filters.city)) continue;
    const fsp = fspEvidence(c.fspAchievements, q.specialization, formula);
    result.push({
      candidateId: c.candidateId,
      alias: c.alias,
      specialization: q.specialization,
      grade: q.grade,
      overallScore: q.overallScore,
      bankScore: round2(w.assessmentQuality * (q.overallScore / 100) + w.fspEvidence * fsp.value),
      fspPoints: fsp.points,
      fspValue: round2(fsp.value),
    });
  }
  const specOrder = (code: string) => SPECIALIZATION_CODES.indexOf(code as never);
  // Без подтверждённого грейда — ниже Junior своей специализации.
  const gradeRank = (grade: GradeCode | null) => (grade ? GRADE_ORDER[grade] : -1);
  return result.sort(
    (a, b) =>
      specOrder(a.specialization) - specOrder(b.specialization) ||
      gradeRank(b.grade) - gradeRank(a.grade) ||
      (b.bankScore ?? -1) - (a.bankScore ?? -1) ||
      (b.overallScore ?? -1) - (a.overallScore ?? -1) ||
      b.fspValue - a.fspValue ||
      (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0),
  );
}

/** Пагинация после полной сортировки: порядок не зависит от размера страницы. */
export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

/** Причины для кандидатов без подтверждённого грейда: условия проверялись по заявленным данным. */
export const UNCONFIRMED_REJECTION_TEXTS: Partial<Record<RejectionReason, string>> = {
  GRADE: 'заявленный грейд вне допустимых',
  REQUIRED_SKILL: 'обязательные навыки не указаны кандидатом',
  REFINEMENT_SCORE: 'нет результата теста для уточнения по баллу',
  REFINEMENT_SKILL: 'нет подтверждённых тестом навыков для уточнения',
};

export const REJECTION_TEXTS: Record<RejectionReason, string> = {
  NOT_DISCOVERABLE: 'профиль скрыт или не опубликован',
  SPECIALIZATION: 'нет подтверждённой квалификации по специализации',
  GRADE: 'подтверждённый грейд вне допустимых',
  REQUIRED_SKILL: 'не подтверждены обязательные навыки',
  WORK_FORMAT: 'не подходит формат работы',
  CITY: 'другой город при офисном или гибридном формате',
  SALARY: 'зарплатные ожидания не пересекаются с вилкой',
  REFINEMENT_FSP: 'нет достижений ФСП (уточнение)',
  REFINEMENT_SCORE: 'балл теста ниже порога уточнения',
  REFINEMENT_SKILL: 'не подтверждены навыки из уточнения',
  REFINEMENT_CITY: 'город не из списка уточнения',
};
