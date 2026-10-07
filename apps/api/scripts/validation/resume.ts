// Проверка автораспознавания резюме. Две выборки:
//  1) синтетическая: детерминированный генератор резюме в шести вёрстках с ЗАРАНЕЕ известной разметкой;
//  2) независимая ручная: несколько резюме, написанных вручную, с разметкой (data/validation/resume/cases.json).
// Обе выборки проверяют ТЕКСТОВЫЙ разбор. Извлечение текста из PDF проверено отдельно интеграционными тестами на PDF от pdfkit.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRng } from '../../src/domain/assessment/rng';
import type { Rng } from '../../src/domain/assessment/types';
import { parseResume, type ResumeSuggestion } from '../../src/domain/resume/parse';
import { FEMALE_NAMES, MALE_NAMES, SURNAMES } from '../seed/people';
import { repoRoot } from './common';

export const RESUME_VALIDATION_NOW = new Date('2026-10-07T12:00:00Z');

type Spec = 'FRONTEND' | 'BACKEND' | 'ML_ENGINEER' | 'MANUAL_QA';
type Grade = 'JUNIOR' | 'MIDDLE' | 'SENIOR';

interface Truth {
  fullName: string;
  email: string;
  phone: string;
  messenger: string | null;
  city: string | null;
  experienceMonths: number;
  skills: string[];
  specialization: Spec;
  grade: Grade;
  roles: string[];
}

// ───────────────────────────── Генератор ─────────────────────────────

/** Написания навыков в резюме (по несколько вариантов); навыки без однозначного написания в генератор не входят. */
const SURFACE: Record<string, string[]> = {
  javascript: ['JavaScript'], typescript: ['TypeScript'], react: ['React', 'React.js'], nextjs: ['Next.js'], vue: ['Vue.js'], redux: ['Redux'],
  'html-css': ['HTML/CSS'], 'webpack-vite': ['Webpack', 'Vite'], graphql: ['GraphQL'], git: ['Git', 'GitHub'], docker: ['Docker'], nodejs: ['Node.js'],
  'rest-api': ['REST API'], java: ['Java'], spring: ['Spring Boot'], python: ['Python'], django: ['Django', 'FastAPI'], nestjs: ['NestJS'], postgresql: ['PostgreSQL', 'Postgres'],
  sql: ['SQL'], redis: ['Redis'], kafka: ['Kafka'], kubernetes: ['Kubernetes', 'k8s'], linux: ['Linux'], mongodb: ['MongoDB'], pandas: ['pandas'], numpy: ['NumPy'],
  'scikit-learn': ['scikit-learn', 'sklearn'], pytorch: ['PyTorch'], tensorflow: ['TensorFlow'], mlflow: ['MLflow'], airflow: ['Airflow'], spark: ['Spark'],
  jira: ['Jira'], 'api-testing': ['Postman'], 'test-design': ['тест-дизайн'], 'bug-reporting': ['баг-репорты'], 'test-management': ['TestRail'], 'web-testing': ['DevTools'],
  'requirements-analysis': ['анализ требований'], 'traffic-sniffing': ['Charles'],
};

const POOLS: Record<Spec, string[]> = {
  FRONTEND: ['javascript', 'typescript', 'react', 'nextjs', 'vue', 'redux', 'html-css', 'webpack-vite', 'graphql', 'git', 'docker', 'nodejs', 'rest-api'],
  BACKEND: ['java', 'spring', 'python', 'django', 'nodejs', 'nestjs', 'postgresql', 'sql', 'redis', 'kafka', 'docker', 'kubernetes', 'linux', 'git', 'rest-api', 'mongodb'],
  ML_ENGINEER: ['python', 'pandas', 'numpy', 'scikit-learn', 'pytorch', 'tensorflow', 'sql', 'docker', 'git', 'mlflow', 'airflow', 'spark', 'linux'],
  MANUAL_QA: ['jira', 'sql', 'api-testing', 'test-design', 'bug-reporting', 'test-management', 'web-testing', 'git', 'linux', 'requirements-analysis', 'traffic-sniffing'],
};

const TITLES: Record<Spec, { ru: string[]; en: string[]; role: string }> = {
  FRONTEND: { ru: ['Frontend-разработчик', 'Фронтенд-разработчик'], en: ['Frontend Developer', 'Front-end Engineer'], role: 'DEVELOPER' },
  BACKEND: { ru: ['Backend-разработчик', 'Бэкенд-разработчик'], en: ['Backend Developer', 'Backend Engineer'], role: 'DEVELOPER' },
  ML_ENGINEER: { ru: ['ML-инженер', 'Дата-сайентист'], en: ['Machine Learning Engineer', 'Data Scientist'], role: 'DATA_SCIENTIST' },
  MANUAL_QA: { ru: ['Тестировщик (QA)', 'QA-инженер'], en: ['QA Engineer', 'Quality Assurance Engineer'], role: 'TESTER' },
};

const LATIN = ['ivan', 'anna', 'petr', 'olga', 'sergey', 'maria', 'dmitry', 'elena', 'alex', 'nina'];
const LATIN_SURNAMES = ['petrov', 'smirnova', 'kuznetsov', 'popova', 'volkov', 'lebedeva', 'morozov', 'sokolova'];
const PATRONYMICS: [string, string][] = [['Сергеевич', 'Сергеевна'], ['Андреевич', 'Андреевна'], ['Игоревич', 'Игоревна'], ['Олегович', 'Олеговна']];
const CITY_POOL = ['Москва', 'Санкт-Петербург', 'Казань', 'Нижний Новгород', 'Самара', 'Екатеринбург', 'Новосибирск', 'Томск', 'Краснодар', 'Пермь', 'Воронеж', 'Уфа'];
const RU_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMPANIES = ['ООО «Цифровой банк»', 'АО «Магазин»', 'ООО «Платёжные решения»', 'Яндекс-подобная компания', 'ИП Сидоров', 'ООО «Логистика+»', 'Freelance'];
const GRADE_RANGE: Record<Grade, [number, number]> = { JUNIOR: [6, 22], MIDDLE: [30, 66], SENIOR: [78, 150] };

interface Job {
  start: number;
  end: number;
  present: boolean;
}

const monthIndex = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();

function generateJobs(rng: Rng, totalMonths: number, nowIndex: number): { jobs: Job[]; experienceMonths: number } {
  const count = totalMonths < 24 ? rng.int(1, 2) : rng.int(2, 3);
  let end = rng.bool(0.7) ? nowIndex : nowIndex - rng.int(1, 6);
  const present = end === nowIndex;
  const jobs: Job[] = [];
  let remaining = totalMonths;
  for (let i = 0; i < count; i += 1) {
    const length = i === count - 1 ? remaining : Math.max(3, Math.min(remaining - 3 * (count - 1 - i), Math.round(remaining / (count - i)) + rng.int(-4, 4)));
    const start = end - length + 1;
    jobs.push({ start, end, present: present && i === 0 });
    remaining -= length;
    end = start - 1;
  }
  return { jobs, experienceMonths: jobs.reduce((sum, job) => sum + (job.end - job.start + 1), 0) };
}

const ruMonth = (index: number) => RU_MONTHS[index % 12];
const enMonth = (index: number) => EN_MONTHS[index % 12];
const year = (index: number) => Math.floor(index / 12);

interface Layout {
  id: string;
  render(ctx: RenderContext): string[];
}

interface RenderContext {
  rng: Rng;
  truth: Truth;
  titleRu: string;
  titleEn: string;
  levelWord: string | null;
  jobs: Job[];
  skillSurface: string[];
  nameLine: string;
  phoneText: string;
  withDurations: boolean;
}

const levelRu = (grade: Grade) => ({ JUNIOR: 'Junior', MIDDLE: 'Middle', SENIOR: 'Senior' })[grade];

function period(job: Job, style: 'ru-text' | 'numeric' | 'year-only' | 'en-text'): string {
  const pad = (n: number) => String((n % 12) + 1).padStart(2, '0');
  const endText = {
    'ru-text': job.present ? 'настоящее время' : `${ruMonth(job.end)} ${year(job.end)}`,
    numeric: job.present ? 'по н.в.' : `${pad(job.end)}.${year(job.end)}`,
    'year-only': job.present ? 'по настоящее время' : String(year(job.end)),
    'en-text': job.present ? 'Present' : `${enMonth(job.end)} ${year(job.end)}`,
  }[style];
  const startText = {
    'ru-text': `${ruMonth(job.start)} ${year(job.start)}`,
    numeric: `${pad(job.start)}.${year(job.start)}`,
    'year-only': String(year(job.start)),
    'en-text': `${enMonth(job.start)} ${year(job.start)}`,
  }[style];
  return `${startText} – ${endText}`;
}

const LAYOUTS: Layout[] = [
  {
    id: 'A: классический (разделы, метки, текстовые месяцы)',
    render: (c) => [
      c.nameLine, `${c.titleRu}${c.levelWord ? ` (${c.levelWord})` : ''}`, 'Контакты', `Email: ${c.truth.email}`, `Телефон: ${c.phoneText}`,
      ...(c.truth.messenger ? [`Telegram: ${c.truth.messenger}`] : []), ...(c.truth.city ? [`Город: ${c.truth.city}`] : []), '',
      'Опыт работы', ...c.jobs.flatMap((job) => [`${period(job, 'ru-text')}  ${c.rng.pick(COMPANIES)}`, 'Разработка и сопровождение сервисов, работа в команде.']), '',
      'Образование', 'Московский технический университет, 2010 – 2015', '', 'Навыки', c.skillSurface.join(', '),
    ],
  },
  {
    id: 'B: компактная шапка в одну строку, числовые даты',
    render: (c) => [
      c.nameLine, [c.truth.email, c.phoneText, c.truth.messenger, c.truth.city].filter(Boolean).join(' | '), `${c.titleRu}${c.levelWord ? ` ${c.levelWord}` : ''}`, '',
      'Опыт', ...c.jobs.map((job) => `${period(job, 'numeric')} ${c.rng.pick(COMPANIES)}`), '', 'Стек', c.skillSurface.join(' • '),
    ],
  },
  {
    id: 'C: английский, месяцы Jan–Dec',
    render: (c) => [
      c.nameLine, `${c.levelWord ? `${c.levelWord} ` : ''}${c.titleEn}`, `Email: ${c.truth.email}`, `Phone: ${c.phoneText}`, ...(c.truth.city ? [`Location: ${c.truth.city}`] : []), '',
      'Experience', ...c.jobs.map((job) => `${period(job, 'en-text')} ${c.rng.pick(COMPANIES)}`), '', 'Skills', c.skillSurface.join(', '),
    ],
  },
  {
    id: 'D: навыки в тексте «О себе», контакты без меток',
    render: (c) => [
      c.nameLine, `${c.titleRu}${c.levelWord ? ` ${c.levelWord}` : ''}`, `${c.truth.email}   ${c.phoneText}`, ...(c.truth.messenger ? [`${c.truth.messenger}`] : []), '',
      'О себе', `Работаю с ${c.skillSurface.join(', ')}. Люблю командную работу.`, '', 'Опыт работы', ...c.jobs.map((job) => `${period(job, 'numeric')} ${c.rng.pick(COMPANIES)}`),
    ],
  },
  {
    id: 'E: явная фраза о стаже, навыки со сроками',
    render: (c) => {
      const years = Math.floor(c.truth.experienceMonths / 12);
      const months = c.truth.experienceMonths % 12;
      return [
        c.nameLine, `${c.titleRu}${c.levelWord ? ` (${c.levelWord})` : ''}`, `Email: ${c.truth.email}`, `Тел.: ${c.phoneText}`, ...(c.truth.city ? [`Проживает: ${c.truth.city}`] : []), '',
        `Опыт работы: ${years} ${years === 1 ? 'год' : years >= 2 && years <= 4 ? 'года' : 'лет'}${months ? ` ${months} мес.` : ''}`, '', 'Ключевые навыки',
        ...c.skillSurface.map((skill, index) => (index < 3 ? `${skill} — ${c.rng.int(2, 6)} года` : skill)),
      ];
    },
  },
  {
    id: 'F: с шумом (образование с годами, языки, ссылки), даты только годами',
    render: (c) => [
      c.nameLine, `${c.titleRu}${c.levelWord ? ` ${c.levelWord}` : ''}`, `E-mail: ${c.truth.email}`, `Mobile: ${c.phoneText}`, 'Ссылки: https://github.com/example-user, https://habr.com/ru/users/example/', '',
      'Образование', 'Университет ИТМО, 2012 – 2016', 'Курсы Python, 2017', '', 'Работа', ...c.jobs.map((job) => `${period(job, 'year-only')} ${c.rng.pick(COMPANIES)}`), '',
      'Навыки', c.skillSurface.join(', '), 'Английский — B2', 'Желаемая зарплата: от 150 000 руб.',
    ],
  },
];

function generateTruth(rng: Rng, spec: Spec, grade: Grade, nowIndex: number): { truth: Truth; jobs: Job[] } {
  const female = rng.bool();
  const first = rng.pick(female ? FEMALE_NAMES : MALE_NAMES);
  const surname = rng.pick(SURNAMES)[female ? 1 : 0];
  const patronymic = rng.bool(0.4) ? ` ${rng.pick(PATRONYMICS)[female ? 1 : 0]}` : '';
  const digits = Array.from({ length: 10 }, () => rng.int(0, 9));
  digits[0] = 9;
  const [a, b, c, d, e] = [digits.slice(0, 3).join(''), digits.slice(3, 6).join(''), digits.slice(6, 8).join(''), digits.slice(8, 10).join(''), ''];
  void e;
  const [minMonths, maxMonths] = GRADE_RANGE[grade];
  const { jobs, experienceMonths } = generateJobs(rng, rng.int(minMonths, maxMonths), nowIndex);
  const roles = [TITLES[spec].role];
  if (grade === 'SENIOR' && rng.bool(0.4)) roles.push('TEAM_LEAD');
  return {
    jobs,
    truth: {
      fullName: `${surname} ${first}${patronymic}`,
      email: `${rng.pick(LATIN)}.${rng.pick(LATIN_SURNAMES)}${rng.int(1, 99)}@example.org`,
      phone: `+7 ${a} ${b}-${c}-${d}`,
      messenger: rng.bool(0.7) ? `@${rng.pick(LATIN)}_${rng.pick(['dev', 'code', 'qa', 'ml', 'tech'])}${rng.int(1, 99)}` : null,
      city: rng.bool(0.8) ? rng.pick(CITY_POOL) : null,
      experienceMonths,
      skills: rng.sample(POOLS[spec], rng.int(5, 9)),
      specialization: spec,
      grade,
      roles,
    },
  };
}

function phoneVariants(truth: Truth, rng: Rng): string {
  const digits = truth.phone.replace(/\D/g, '').slice(1);
  return rng.pick([
    `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`,
    `8 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`,
    `+7${digits}`,
    `8-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`,
  ]);
}

export interface SyntheticResume {
  layout: string;
  text: string;
  truth: Truth;
}

export function generateResumes(perLayout: number, now: Date = RESUME_VALIDATION_NOW): SyntheticResume[] {
  const nowIndex = monthIndex(now);
  const specs: Spec[] = ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'];
  const grades: Grade[] = ['JUNIOR', 'MIDDLE', 'SENIOR'];
  const result: SyntheticResume[] = [];
  for (const layout of LAYOUTS) {
    for (let i = 0; i < perLayout; i += 1) {
      const rng = createRng(`resume|${layout.id}|${i}`);
      const spec = specs[i % specs.length];
      const grade = grades[Math.floor(i / specs.length) % grades.length];
      const { truth, jobs } = generateTruth(rng, spec, grade, nowIndex);
      const surfaceByCode = truth.skills.map((code) => rng.pick(SURFACE[code]));
      const caps = rng.bool(0.15);
      const nameLine = caps ? truth.fullName.toUpperCase() : truth.fullName;
      const lines = layout.render({
        rng,
        truth,
        titleRu: rng.pick(TITLES[spec].ru) + (truth.roles.includes('TEAM_LEAD') ? ' / Тимлид' : ''),
        titleEn: rng.pick(TITLES[spec].en) + (truth.roles.includes('TEAM_LEAD') ? ' / Team Lead' : ''),
        levelWord: rng.bool(0.6) ? levelRu(grade) : null,
        jobs,
        skillSurface: rng.shuffle(surfaceByCode),
        nameLine,
        phoneText: phoneVariants(truth, rng),
        withDurations: false,
      });
      const text = lines.join('\n');
      // Разметка — только то, что есть на странице: мессенджер и город есть не во всех вёрстках.
      if (truth.messenger && !text.includes(truth.messenger)) truth.messenger = null;
      if (truth.city && !text.includes(truth.city)) truth.city = null;
      result.push({ layout: layout.id, text, truth });
    }
  }
  return result;
}

// ───────────────────────────── Оценка ─────────────────────────────

export interface FieldScore {
  field: string;
  metric: string;
  value: number | null;
  n: number;
}

interface Tally {
  hit: number;
  total: number;
}
const rate = (t: Tally) => (t.total ? t.hit / t.total : null);

interface Counters {
  fullName: Tally;
  email: Tally;
  phone: Tally;
  messenger: Tally;
  city: Tally;
  exp3: Tally;
  exp6: Tally;
  exp12: Tally;
  specialization: Tally;
  grade: Tally;
  skillsTp: number;
  skillsFp: number;
  skillsFn: number;
  rolesHit: Tally;
}

const emptyCounters = (): Counters => ({
  fullName: { hit: 0, total: 0 }, email: { hit: 0, total: 0 }, phone: { hit: 0, total: 0 }, messenger: { hit: 0, total: 0 }, city: { hit: 0, total: 0 },
  exp3: { hit: 0, total: 0 }, exp6: { hit: 0, total: 0 }, exp12: { hit: 0, total: 0 }, specialization: { hit: 0, total: 0 }, grade: { hit: 0, total: 0 },
  skillsTp: 0, skillsFp: 0, skillsFn: 0, rolesHit: { hit: 0, total: 0 },
});

function score(counters: Counters, parsed: ResumeSuggestion, truth: Partial<Truth>): void {
  const eq = (tally: Tally, expected: unknown, actual: unknown) => {
    if (expected === undefined) return;
    tally.total += 1;
    if (expected === actual) tally.hit += 1;
  };
  eq(counters.fullName, truth.fullName, parsed.fullName);
  eq(counters.email, truth.email, parsed.contactEmail);
  eq(counters.phone, truth.phone, parsed.phone);
  if (truth.messenger !== undefined) eq(counters.messenger, truth.messenger, parsed.messenger);
  if (truth.city !== undefined) eq(counters.city, truth.city, parsed.city);
  if (truth.experienceMonths !== undefined) {
    const diff = parsed.experienceMonths === null ? Infinity : Math.abs(parsed.experienceMonths - truth.experienceMonths);
    for (const [tally, limit] of [[counters.exp3, 3], [counters.exp6, 6], [counters.exp12, 12]] as const) {
      tally.total += 1;
      if (diff <= limit) tally.hit += 1;
    }
  }
  eq(counters.specialization, truth.specialization, parsed.activeSpecialization);
  eq(counters.grade, truth.grade, parsed.declaredGrade);
  if (truth.skills) {
    const expected = new Set(truth.skills);
    const actual = new Set(parsed.skills.map((s) => s.code));
    for (const code of actual) {
      if (expected.has(code)) counters.skillsTp += 1;
      else counters.skillsFp += 1;
    }
    for (const code of expected) if (!actual.has(code)) counters.skillsFn += 1;
  }
  if (truth.roles) {
    counters.rolesHit.total += truth.roles.length;
    counters.rolesHit.hit += truth.roles.filter((role) => parsed.teamRoles.includes(role)).length;
  }
}

function summarize(counters: Counters): FieldScore[] {
  const precision = counters.skillsTp + counters.skillsFp ? counters.skillsTp / (counters.skillsTp + counters.skillsFp) : null;
  const recall = counters.skillsTp + counters.skillsFn ? counters.skillsTp / (counters.skillsTp + counters.skillsFn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return [
    { field: 'ФИО', metric: 'точное совпадение', value: rate(counters.fullName), n: counters.fullName.total },
    { field: 'Email', metric: 'точное совпадение', value: rate(counters.email), n: counters.email.total },
    { field: 'Телефон', metric: 'точное совпадение (после нормализации)', value: rate(counters.phone), n: counters.phone.total },
    { field: 'Мессенджер', metric: 'точное совпадение (в т. ч. отсутствие)', value: rate(counters.messenger), n: counters.messenger.total },
    { field: 'Город', metric: 'точное совпадение (в т. ч. отсутствие)', value: rate(counters.city), n: counters.city.total },
    { field: 'Стаж', metric: 'отклонение ≤ 3 мес.', value: rate(counters.exp3), n: counters.exp3.total },
    { field: 'Стаж', metric: 'отклонение ≤ 6 мес.', value: rate(counters.exp6), n: counters.exp6.total },
    { field: 'Стаж', metric: 'отклонение ≤ 12 мес.', value: rate(counters.exp12), n: counters.exp12.total },
    { field: 'Навыки', metric: 'precision', value: precision, n: counters.skillsTp + counters.skillsFp },
    { field: 'Навыки', metric: 'recall', value: recall, n: counters.skillsTp + counters.skillsFn },
    { field: 'Навыки', metric: 'F1', value: f1, n: counters.skillsTp + counters.skillsFp + counters.skillsFn },
    { field: 'Специализация', metric: 'точное совпадение', value: rate(counters.specialization), n: counters.specialization.total },
    { field: 'Грейд (предположение)', metric: 'точное совпадение', value: rate(counters.grade), n: counters.grade.total },
    { field: 'Роли', metric: 'recall', value: rate(counters.rolesHit), n: counters.rolesHit.total },
  ];
}

export interface HandwrittenCase {
  id: string;
  description: string;
  text: string;
  expected: Partial<Truth>;
}

export interface ResumeResults {
  now: string;
  synthetic: { resumes: number; perLayout: number; layouts: string[]; scores: FieldScore[]; byLayout: Array<{ layout: string; scores: FieldScore[] }> };
  handwritten: { cases: number; scores: FieldScore[]; misses: Array<{ caseId: string; field: string; expected: string; actual: string }> };
  gates: Array<{ name: string; ok: boolean; detail: string }>;
  limitations: string[];
}

const show = (value: unknown) => (value === null || value === undefined ? '—' : Array.isArray(value) ? value.join(', ') || '—' : String(value));

export function runResumeValidation(perLayout = 60): ResumeResults {
  const resumes = generateResumes(perLayout);
  const total = emptyCounters();
  const byLayout = new Map<string, Counters>();
  for (const resume of resumes) {
    const parsed = parseResume(resume.text, RESUME_VALIDATION_NOW);
    score(total, parsed, resume.truth);
    const local = byLayout.get(resume.layout) ?? emptyCounters();
    score(local, parsed, resume.truth);
    byLayout.set(resume.layout, local);
  }

  const file = path.join(repoRoot(), 'data', 'validation', 'resume', 'cases.json');
  const cases = JSON.parse(readFileSync(file, 'utf8')) as HandwrittenCase[];
  const handwritten = emptyCounters();
  const misses: ResumeResults['handwritten']['misses'] = [];
  for (const item of cases) {
    const parsed = parseResume(item.text, RESUME_VALIDATION_NOW);
    score(handwritten, parsed, item.expected);
    const compare: Array<[string, unknown, unknown]> = [
      ['ФИО', item.expected.fullName, parsed.fullName], ['Email', item.expected.email, parsed.contactEmail], ['Телефон', item.expected.phone, parsed.phone],
      ['Мессенджер', item.expected.messenger, parsed.messenger], ['Город', item.expected.city, parsed.city], ['Специализация', item.expected.specialization, parsed.activeSpecialization],
      ['Грейд', item.expected.grade, parsed.declaredGrade],
    ];
    for (const [field, expected, actual] of compare) if (expected !== undefined && expected !== actual) misses.push({ caseId: item.id, field, expected: show(expected), actual: show(actual) });
    if (item.expected.experienceMonths !== undefined && (parsed.experienceMonths === null || Math.abs(parsed.experienceMonths - item.expected.experienceMonths) > 6)) {
      misses.push({ caseId: item.id, field: 'Стаж (±6 мес.)', expected: show(item.expected.experienceMonths), actual: show(parsed.experienceMonths) });
    }
    if (item.expected.skills) {
      const wanted = new Set(item.expected.skills);
      const got = new Set(parsed.skills.map((s) => s.code));
      const missing = [...wanted].filter((c) => !got.has(c));
      const extra = [...got].filter((c) => !wanted.has(c));
      if (missing.length || extra.length) misses.push({ caseId: item.id, field: 'Навыки', expected: `нет: ${show(missing)}`, actual: `лишние: ${show(extra)}` });
    }
  }

  const scores = summarize(total);
  const pick = (field: string, metric: string) => scores.find((s) => s.field === field && s.metric === metric)?.value ?? 0;
  const gates = [
    { name: 'Резюме (синтетика): email распознаётся не хуже 98 %', ok: pick('Email', 'точное совпадение') >= 0.98, detail: `${((pick('Email', 'точное совпадение')) * 100).toFixed(1)} %` },
    { name: 'Резюме (синтетика): телефон не хуже 95 %', ok: pick('Телефон', 'точное совпадение (после нормализации)') >= 0.95, detail: `${(pick('Телефон', 'точное совпадение (после нормализации)') * 100).toFixed(1)} %` },
    { name: 'Резюме (синтетика): ФИО не хуже 85 %', ok: pick('ФИО', 'точное совпадение') >= 0.85, detail: `${(pick('ФИО', 'точное совпадение') * 100).toFixed(1)} %` },
    { name: 'Резюме (синтетика): навыки F1 не хуже 0.85', ok: pick('Навыки', 'F1') >= 0.85, detail: `F1 ${pick('Навыки', 'F1').toFixed(3)}` },
    { name: 'Резюме (синтетика): стаж в пределах ±12 мес. не хуже 85 %', ok: pick('Стаж', 'отклонение ≤ 12 мес.') >= 0.85, detail: `${(pick('Стаж', 'отклонение ≤ 12 мес.') * 100).toFixed(1)} %` },
    { name: 'Резюме: на пустом, мусорном и бессмысленном тексте разбор не падает и ничего не придумывает', ok: ['', '   ', '!!!', '12345', 'a'.repeat(5000)].every((text) => parseResume(text, RESUME_VALIDATION_NOW).fullName === null), detail: '5 проб' },
  ];

  return {
    now: RESUME_VALIDATION_NOW.toISOString(),
    synthetic: {
      resumes: resumes.length,
      perLayout,
      layouts: [...byLayout.keys()],
      scores,
      byLayout: [...byLayout.entries()].map(([layout, counters]) => ({ layout, scores: summarize(counters) })),
    },
    handwritten: { cases: cases.length, scores: summarize(handwritten), misses },
    gates,
    limitations: [
      'Синтетический генератор написан теми же людьми, что и парсер, и воспроизводит шесть известных вёрсток: высокие показатели означают согласованность с ними, а не качество на реальных резюме.',
      'Ручной набор мал (6 резюме) и написан после парсера. По итогам его первого прогона в парсер внесены общие правки (английские названия городов, «Фамилия Имя, должность», «по н.в.» и «с 2018 года по настоящее время»), поэтому показатели набора после правок оптимистичны и не являются оценкой на невиданных данных. Оставшиеся расхождения не «подгонялись» и приведены списком.',
      'Проверен только текстовый разбор. Извлечение текста из PDF проверено интеграционными тестами на PDF, созданных pdfkit (однопоточный текст). PDF из Word, Google Docs, LaTeX, многоколоночные и сканы (OCR нет) не проверялись.',
      'Грейд и специализация — предположения по заголовку и стажу, а не оценка квалификации; подтверждённой категорией они не становятся.',
    ],
  };
}
