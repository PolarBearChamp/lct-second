import {
  INDUSTRIES,
  SKILLS,
  SOFT_SKILLS,
  TEAM_ROLES,
  TIMEZONES,
  type GradeCode,
  type SpecializationCode,
} from '../catalog/catalog';

/**
 * Автораспознавание резюме: правила и словари справочников платформы (без ML и внешних сервисов).
 *
 * Функция получает ТЕКСТ резюме (из PDF) и возвращает ПРЕДЛОЖЕНИЯ для профиля. Ничего не применяется автоматически:
 * кандидат проверяет каждое поле. Распознанные навыки, грейд и опыт — самоописание, а не подтверждение: категория по-прежнему
 * определяется только тестом.
 */

export type ResumeFieldKey =
  | 'fullName'
  | 'contactEmail'
  | 'phone'
  | 'messenger'
  | 'city'
  | 'timezone'
  | 'externalLinks'
  | 'experienceMonths'
  | 'skills'
  | 'teamRoles'
  | 'softSkills'
  | 'industries'
  | 'activeSpecialization'
  | 'declaredGrade'
  | 'experienceDescription';

export type ResumeConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ResumeSuggestion {
  fullName: string | null;
  contactEmail: string | null;
  phone: string | null;
  messenger: string | null;
  city: string | null;
  timezone: string | null;
  externalLinks: string[];
  experienceMonths: number | null;
  skills: Array<{ code: string; title: string; months: number | null }>;
  teamRoles: string[];
  softSkills: string[];
  industries: string[];
  activeSpecialization: SpecializationCode | null;
  declaredGrade: GradeCode | null;
  experienceDescription: string | null;
  /** Уверенность по каждому найденному полю: HIGH — явная метка или однозначный шаблон, LOW — предположение. */
  confidence: Partial<Record<ResumeFieldKey, ResumeConfidence>>;
  warnings: string[];
}

// ───────────────────────────── Нормализация ─────────────────────────────

export function normalizeResumeText(raw: string): string[] {
  return raw
    .replace(new RegExp('[\u00a0\u2007\u202f]', 'g'), ' ')
    .replace(new RegExp('[\u200b-\u200d\ufeff]', 'g'), '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim());
}

const BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}_])';
const BOUNDARY_AFTER = '(?![\\p{L}\\p{N}_])';
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Термин как отдельное слово (с учётом кириллицы и знаков вроде C#, Node.js). */
function termRegExp(term: string, prefix = false): RegExp {
  const tail = term.endsWith('#') || term.endsWith('+') ? '(?![\\p{L}\\p{N}_#+])' : prefix ? '' : BOUNDARY_AFTER;
  return new RegExp(`${BOUNDARY_BEFORE}${escapeRegExp(term)}${tail}`, 'iu');
}

// ───────────────────────────── Разделы ─────────────────────────────

type Section = 'experience' | 'education' | 'skills' | 'about' | 'contacts' | 'other';
const SECTION_HEADERS: Array<{ section: Section; pattern: RegExp }> = [
  { section: 'experience', pattern: /^(?:опыт(?:\s+работы)?|работа|места\s+работы|профессиональный\s+опыт|work\s+experience|experience|employment(?:\s+history)?)$/i },
  { section: 'education', pattern: /^(?:образование|education|курсы|обучение|сертификаты?)$/i },
  { section: 'skills', pattern: /^(?:(?:ключевые\s+)?навыки|стек|технологии|технический\s+стек|tech(?:nical)?\s+stack|skills|key\s+skills|technologies|компетенции)$/i },
  { section: 'about', pattern: /^(?:о\s+себе|обо\s+мне|summary|about(?:\s+me)?|профиль|цель)$/i },
  { section: 'contacts', pattern: /^(?:контакты|контактная\s+информация|contacts?)$/i },
  { section: 'other', pattern: /^(?:достижения|языки|дополнительно|рекомендации|хобби|интересы|languages|achievements|additional|references)$/i },
];

function splitSections(lines: string[]): Map<Section, string[]> {
  const sections = new Map<Section, string[]>();
  let current: Section | null = null;
  for (const line of lines) {
    const header = line.replace(/[:：\-–—\s]+$/, '');
    const hit = header.length > 0 && header.length <= 40 ? SECTION_HEADERS.find((h) => h.pattern.test(header)) : undefined;
    if (hit) {
      current = hit.section;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)!.push(line);
  }
  return sections;
}

// ───────────────────────────── Контакты ─────────────────────────────

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE = /(?<![\d])(?:\+7|8|7)[\s\-().]*\d{3}[\s\-().]*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}(?![\d])/;
const URL = /\bhttps?:\/\/[^\s<>()[\]"']+|\b(?:www\.)?(?:github\.com|gitlab\.com|linkedin\.com\/in|habr\.com|career\.habr\.com|hh\.ru|behance\.net|kaggle\.com|leetcode\.com|codeforces\.com|stackoverflow\.com)\/[^\s<>()[\]"']+/gi;

function findEmail(text: string): string | null {
  return text.match(EMAIL)?.[0] ?? null;
}

function findPhone(text: string): string | null {
  const match = text.match(PHONE)?.[0];
  if (!match) return null;
  const digits = match.replace(/\D/g, '');
  const national = digits.length === 11 ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  return `+7 ${national.slice(0, 3)} ${national.slice(3, 6)}-${national.slice(6, 8)}-${national.slice(8, 10)}`;
}

function findMessenger(text: string): string | null {
  const labelled = text.match(/(?:telegram|телеграм\w*|tg|t\.me\/)\s*[:\-–]?\s*@?([A-Za-z][A-Za-z0-9_]{3,31})/i);
  if (labelled) return `@${labelled[1]}`;
  const bare = text.match(/(?<![\w.@/])@([A-Za-z][A-Za-z0-9_]{3,31})(?![\w.@])/);
  return bare ? `@${bare[1]}` : null;
}

function findLinks(text: string): string[] {
  const found = new Set<string>();
  for (const raw of text.match(URL) ?? []) {
    const cleaned = raw.replace(/[.,;:!?]+$/, '');
    if (/t\.me\//i.test(cleaned)) continue;
    const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned.replace(/^www\./i, '')}`;
    found.add(withScheme);
  }
  return [...found].slice(0, 5);
}

// ───────────────────────────── Имя ─────────────────────────────

const NAME_STOP = new Set(
  [
    'резюме', 'контакты', 'опыт', 'образование', 'навыки', 'о', 'себе', 'resume', 'cv', 'curriculum', 'vitae', 'summary',
    'разработчик', 'инженер', 'тестировщик', 'аналитик', 'специалист', 'программист', 'developer', 'engineer', 'tester', 'qa', 'frontend',
    'backend', 'fullstack', 'full-stack', 'junior', 'middle', 'senior', 'lead', 'python', 'java', 'javascript', 'react', 'data', 'scientist',
    'machine', 'learning', 'manager', 'менеджер', 'руководитель', 'ведущий', 'старший', 'младший', 'стажёр', 'стажер', 'москва', 'россия',
    'работа', 'желаемая', 'должность', 'зарплата', 'telegram', 'email', 'phone', 'github', 'linkedin',
  ].map((w) => w.toLowerCase()),
);
const NAME_TOKEN = /^[А-ЯЁA-Z][а-яёa-z]+(?:-[А-ЯЁA-Z][а-яёa-z]+)?$/u;
const NAME_TOKEN_CAPS = /^[А-ЯЁA-Z]{2,}(?:-[А-ЯЁA-Z]{2,})?$/u;

const titleCase = (token: string) => token.toLowerCase().replace(/(^|-)(\p{L})/gu, (_m, dash: string, ch: string) => dash + ch.toUpperCase());

function plausibleName(line: string): string | null {
  if (/[0-9@/:|•·_]/.test(line)) return null;
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (tokens.some((t) => NAME_STOP.has(t.toLowerCase().replace(/[.,]$/, '')))) return null;
  if (tokens.every((t) => NAME_TOKEN.test(t))) return tokens.join(' ');
  if (tokens.every((t) => NAME_TOKEN_CAPS.test(t))) return tokens.map(titleCase).join(' ');
  return null;
}

function findName(lines: string[]): { value: string; confidence: ResumeConfidence } | null {
  for (const line of lines.slice(0, 40)) {
    const labelled = line.match(/^(?:фио|ф\.и\.о\.|имя|фамилия,?\s+имя(?:\s+отчество)?|name|full\s+name)\s*[:\-–]\s*(.+)$/i);
    if (labelled) {
      const name = plausibleName(labelled[1].trim());
      if (name) return { value: name, confidence: 'HIGH' };
    }
  }
  const head = lines.filter(Boolean).slice(0, 8);
  for (const [index, line] of head.entries()) {
    // «Козлов Иван, ML-инженер» / «Козлов Иван — тестировщик»: имя — часть строки до запятой, тире или «|».
    const name = plausibleName(line) ?? plausibleName(line.split(/\s*[,|–—]\s*/)[0]);
    if (name) return { value: name, confidence: index < 3 ? 'HIGH' : 'MEDIUM' };
  }
  return null;
}

// ───────────────────────────── Город ─────────────────────────────

const CITIES: Array<{ name: string; aliases?: string[]; timezone: string }> = [
  { name: 'Москва', aliases: ['Moscow'], timezone: 'Europe/Moscow' },
  { name: 'Санкт-Петербург', aliases: ['Питер', 'СПб', 'Saint Petersburg', 'St. Petersburg'], timezone: 'Europe/Moscow' },
  { name: 'Казань', aliases: ['Kazan'], timezone: 'Europe/Moscow' },
  { name: 'Нижний Новгород', aliases: ['Nizhny Novgorod'], timezone: 'Europe/Moscow' },
  { name: 'Воронеж', aliases: ['Voronezh'], timezone: 'Europe/Moscow' },
  { name: 'Ростов-на-Дону', timezone: 'Europe/Moscow' },
  { name: 'Краснодар', aliases: ['Krasnodar'], timezone: 'Europe/Moscow' },
  { name: 'Сочи', timezone: 'Europe/Moscow' },
  { name: 'Волгоград', timezone: 'Europe/Moscow' },
  { name: 'Тула', timezone: 'Europe/Moscow' },
  { name: 'Ярославль', timezone: 'Europe/Moscow' },
  { name: 'Калининград', timezone: 'Europe/Kaliningrad' },
  { name: 'Самара', aliases: ['Samara'], timezone: 'Europe/Samara' },
  { name: 'Саратов', timezone: 'Europe/Samara' },
  { name: 'Ульяновск', timezone: 'Europe/Samara' },
  { name: 'Екатеринбург', aliases: ['Yekaterinburg', 'Ekaterinburg'], timezone: 'Asia/Yekaterinburg' },
  { name: 'Пермь', aliases: ['Perm'], timezone: 'Asia/Yekaterinburg' },
  { name: 'Уфа', aliases: ['Ufa'], timezone: 'Asia/Yekaterinburg' },
  { name: 'Челябинск', timezone: 'Asia/Yekaterinburg' },
  { name: 'Тюмень', timezone: 'Asia/Yekaterinburg' },
  { name: 'Омск', timezone: 'Asia/Omsk' },
  { name: 'Новосибирск', aliases: ['Novosibirsk'], timezone: 'Asia/Novosibirsk' },
  { name: 'Томск', aliases: ['Tomsk'], timezone: 'Asia/Novosibirsk' },
  { name: 'Красноярск', timezone: 'Asia/Krasnoyarsk' },
  { name: 'Барнаул', timezone: 'Asia/Krasnoyarsk' },
  { name: 'Кемерово', timezone: 'Asia/Krasnoyarsk' },
  { name: 'Иркутск', timezone: 'Asia/Irkutsk' },
  { name: 'Якутск', timezone: 'Asia/Yakutsk' },
  { name: 'Владивосток', timezone: 'Asia/Vladivostok' },
  { name: 'Хабаровск', timezone: 'Asia/Vladivostok' },
];
const KNOWN_TIMEZONES = new Set(TIMEZONES.map((t) => t.code));

function matchCity(fragment: string): { name: string; timezone: string } | null {
  for (const city of CITIES) {
    for (const alias of [city.name, ...(city.aliases ?? [])]) {
      if (termRegExp(alias).test(fragment)) return { name: city.name, timezone: city.timezone };
    }
  }
  return null;
}

function findCity(lines: string[]): { name: string; timezone: string | null; confidence: ResumeConfidence } | null {
  for (const line of lines.slice(0, 60)) {
    const labelled = line.match(/^(?:город(?:\s+проживания)?|проживает|локация|location|city|регион)\s*[:\-–]\s*(.+)$/i);
    if (!labelled) continue;
    const known = matchCity(labelled[1]);
    if (known) return { ...known, confidence: 'HIGH' };
    const first = labelled[1].split(/[,;(/]/)[0].replace(/^г\.?\s*/i, '').trim();
    if (/^[А-ЯЁA-Z][\p{L}\- ]{1,40}$/u.test(first)) return { name: first, timezone: null, confidence: 'MEDIUM' };
  }
  for (const line of lines.filter(Boolean).slice(0, 15)) {
    const known = matchCity(line);
    if (known && line.length <= 120) return { ...known, confidence: 'MEDIUM' };
  }
  return null;
}

// ───────────────────────────── Опыт ─────────────────────────────

const MONTHS: Array<[RegExp, number]> = [
  [/^янв|^jan/i, 1], [/^фев|^feb/i, 2], [/^мар|^mar/i, 3], [/^апр|^apr/i, 4], [/^ма[йя]|^may/i, 5], [/^июн|^jun/i, 6],
  [/^июл|^jul/i, 7], [/^авг|^aug/i, 8], [/^сен|^sep/i, 9], [/^окт|^oct/i, 10], [/^ноя|^nov/i, 11], [/^дек|^dec/i, 12],
];
const monthOf = (word: string | undefined): number | null => {
  if (!word) return null;
  const hit = MONTHS.find(([pattern]) => pattern.test(word));
  return hit ? hit[1] : null;
};

const PRESENT = '(?:по\\s+)?(?:настоящ\\w*(?:\\s+время)?|н\\.?\\s?в\\.?|сейчас|present|now|current|today)';
const RANGE_TEXT = new RegExp(
  `(?:(?<m1>[A-Za-zА-Яа-яЁё]{3,9})\\.?\\s+)?(?<y1>(?:19|20)\\d{2})(?:\\s*г(?:ода|\\.)?)?\\s*(?:[–—−\\-]|по|до|to)\\s*(?:(?:(?<m2>[A-Za-zА-Яа-яЁё]{3,9})\\.?\\s+)?(?<y2>(?:19|20)\\d{2})|(?<now>${PRESENT}))`,
  'giu',
);
const RANGE_NUM = new RegExp(
  `(?<![\\d.])(?<n1>\\d{1,2})[./](?<y1>(?:19|20)\\d{2})\\s*[–—−\\-]\\s*(?:(?<n2>\\d{1,2})[./](?<y2>(?:19|20)\\d{2})|(?<now>${PRESENT}))`,
  'giu',
);
const STUDY_LINE = /университет|институт|колледж|техникум|школ[аы]|курсы?\b|университета|академи|бакалавр|магистр|специалитет|university|college|bachelor|master'?s|school|bootcamp/i;

interface Interval {
  start: number;
  end: number;
  approximate: boolean;
}

function intervalsFrom(lines: string[], now: Date): Interval[] {
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const result: Interval[] = [];
  for (const line of lines) {
    if (STUDY_LINE.test(line)) continue;
    for (const match of line.matchAll(RANGE_NUM)) {
      const g = match.groups!;
      const month1 = Number(g.n1);
      if (month1 < 1 || month1 > 12) continue;
      const start = Number(g.y1) * 12 + (month1 - 1);
      let end: number;
      if (g.now) end = nowIndex;
      else {
        const month2 = Number(g.n2);
        if (month2 < 1 || month2 > 12) continue;
        end = Number(g.y2) * 12 + (month2 - 1);
      }
      result.push({ start, end, approximate: false });
    }
    // Диапазоны, уже разобранные числовым шаблоном (MM.YYYY), второй раз не считаем.
    const textual = line.replace(RANGE_NUM, ' ');
    for (const match of textual.matchAll(RANGE_TEXT)) {
      const g = match.groups!;
      const m1 = monthOf(g.m1);
      const startYear = Number(g.y1);
      let end: number;
      let approximate = m1 === null;
      if (g.now) end = nowIndex;
      else {
        const m2 = monthOf(g.m2);
        if (m2 === null) approximate = true;
        end = Number(g.y2) * 12 + (m2 === null ? 5 : m2 - 1);
      }
      const start = startYear * 12 + (m1 === null ? 0 : m1 - 1);
      result.push({ start, end, approximate });
    }
  }
  return result.filter((i) => i.end >= i.start && i.end - i.start <= 12 * 45 && i.end <= nowIndex + 1);
}

/** Объединение пересекающихся периодов: параллельная работа в двух местах не удваивает стаж. */
function unionMonths(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  for (const interval of sorted) {
    if (cursorEnd < 0 || interval.start > cursorEnd + 1) {
      if (cursorEnd >= 0) total += cursorEnd - cursorStart + 1;
      cursorStart = interval.start;
      cursorEnd = interval.end;
    } else cursorEnd = Math.max(cursorEnd, interval.end);
  }
  if (cursorEnd >= 0) total += cursorEnd - cursorStart + 1;
  return total;
}

const EXPLICIT_EXPERIENCE =
  /(?:общий\s+)?(?:опыт(?:\s+работы)?|стаж(?:\s+работы)?|experience)[^\d\n]{0,40}?(\d{1,2}(?:[.,]\d)?)\s*\+?\s*(?:лет|года|год|г\.?|yrs?\.?|years?)(?:\s*(?:и\s*)?(\d{1,2})\s*(?:мес\w*|months?|m\b))?/i;
const EXPLICIT_MONTHS_ONLY = /(?:опыт(?:\s+работы)?|стаж)[^\d\n]{0,40}?(\d{1,3})\s*(?:мес\w*|months?)/i;

function findExperience(lines: string[], sections: Map<Section, string[]>, now: Date): { months: number; confidence: ResumeConfidence } | null {
  const text = lines.join('\n');
  const explicit = text.match(EXPLICIT_EXPERIENCE);
  if (explicit) {
    const years = Number(explicit[1].replace(',', '.'));
    const months = Math.round(years * 12) + (explicit[2] ? Number(explicit[2]) : 0);
    if (months > 0 && months <= 600) return { months, confidence: 'HIGH' };
  }
  const monthsOnly = text.match(EXPLICIT_MONTHS_ONLY);
  if (monthsOnly) {
    const months = Number(monthsOnly[1]);
    if (months > 0 && months <= 600) return { months, confidence: 'HIGH' };
  }
  const scope = sections.get('experience')?.length ? sections.get('experience')! : lines.filter((_, index) => !sections.get('education')?.includes(lines[index]));
  const intervals = intervalsFrom(scope, now);
  if (intervals.length === 0) return null;
  const months = unionMonths(intervals);
  if (months <= 0 || months > 600) return null;
  return { months, confidence: intervals.some((i) => i.approximate) ? 'LOW' : 'MEDIUM' };
}

// ───────────────────────────── Навыки ─────────────────────────────

/** Дополнительные написания по кодам справочника. strict — в любом месте текста; short — только в разделе навыков (слишком коротко/неоднозначно). */
const SKILL_ALIASES: Record<string, { strict?: string[]; short?: string[] }> = {
  javascript: { strict: ['JavaScript', 'ECMAScript'], short: ['JS', 'ES6'] },
  'async-js': { strict: ['async/await', 'Promise', 'event loop'] },
  typescript: { strict: ['TypeScript'], short: ['TS'] },
  react: { strict: ['React', 'React.js', 'ReactJS'] },
  'state-management': { strict: ['MobX', 'Zustand', 'Pinia', 'Vuex', 'NgRx', 'state management', 'управление состоянием'] },
  http: { strict: ['HTTP'] },
  'error-handling': { strict: ['обработка ошибок'] },
  'rest-api': { strict: ['REST API', 'RESTful', 'REST'] },
  sql: { strict: ['SQL', 'T-SQL', 'MySQL', 'MSSQL', 'SQLite'] },
  postgresql: { strict: ['PostgreSQL', 'Postgres'], short: ['psql'] },
  transactions: { strict: ['транзакции', 'transactions', 'ACID'] },
  concurrency: { strict: ['многопоточность', 'concurrency', 'конкурентность', 'multithreading'] },
  python: { strict: ['Python', 'питон'] },
  pandas: { strict: ['pandas'] },
  'scikit-learn': { strict: ['scikit-learn', 'sklearn', 'scikit learn'] },
  'data-preparation': { strict: ['подготовка данных', 'data preparation', 'data cleaning', 'feature engineering', 'очистка данных'] },
  'ml-metrics': { strict: ['метрики качества', 'ML metrics', 'ROC-AUC', 'F1-score'] },
  classification: { strict: ['классификация', 'classification'] },
  'model-validation': { strict: ['валидация моделей', 'cross-validation', 'кросс-валидация'] },
  'requirements-analysis': { strict: ['анализ требований', 'requirements analysis', 'работа с требованиями'] },
  'test-design': { strict: ['тест-дизайн', 'test design', 'тест-кейсы', 'test cases', 'тестовая документация'] },
  'boundary-testing': { strict: ['граничные значения', 'классы эквивалентности', 'boundary value'] },
  'bug-reporting': { strict: ['баг-репорт', 'баг-репорты', 'баг репорты', 'bug report', 'bug reports', 'баг-трекинг'] },
  'test-prioritization': { strict: ['приоритизация проверок', 'приоритизация тестов', 'test prioritization'] },
  'html-css': { strict: ['HTML', 'CSS', 'HTML5', 'CSS3', 'SASS', 'SCSS'] },
  vue: { strict: ['Vue', 'Vue.js', 'VueJS', 'Nuxt'] },
  angular: { strict: ['Angular', 'AngularJS'] },
  nextjs: { strict: ['Next.js', 'NextJS', 'Next js'] },
  redux: { strict: ['Redux', 'Redux Toolkit'], short: ['RTK'] },
  'webpack-vite': { strict: ['Webpack', 'Vite', 'Rollup'] },
  'web-accessibility': { strict: ['accessibility', 'a11y', 'WCAG', 'доступность интерфейсов'] },
  graphql: { strict: ['GraphQL'] },
  nodejs: { strict: ['Node.js', 'NodeJS', 'Node js'] },
  nestjs: { strict: ['NestJS', 'Nest.js'] },
  java: { strict: ['Java'] },
  spring: { strict: ['Spring', 'Spring Boot'] },
  go: { strict: ['Golang'], short: ['Go'] },
  csharp: { strict: ['C#', '.NET', 'ASP.NET', 'dotnet'] },
  kotlin: { strict: ['Kotlin'] },
  django: { strict: ['Django', 'FastAPI', 'Flask'] },
  redis: { strict: ['Redis'] },
  mongodb: { strict: ['MongoDB', 'Mongo'] },
  kafka: { strict: ['Kafka', 'Apache Kafka'] },
  docker: { strict: ['Docker', 'docker-compose'] },
  kubernetes: { strict: ['Kubernetes', 'k8s', 'Helm'] },
  linux: { strict: ['Linux', 'Ubuntu', 'Debian', 'Bash'] },
  git: { strict: ['Git', 'GitHub', 'GitLab'] },
  numpy: { strict: ['NumPy'] },
  pytorch: { strict: ['PyTorch'] },
  tensorflow: { strict: ['TensorFlow', 'Keras'] },
  'gradient-boosting': { strict: ['CatBoost', 'XGBoost', 'LightGBM', 'градиентный бустинг'] },
  mlflow: { strict: ['MLflow'] },
  airflow: { strict: ['Airflow'] },
  spark: { strict: ['Spark', 'PySpark'] },
  nlp: { strict: ['NLP', 'обработка естественного языка', 'BERT'] },
  'computer-vision': { strict: ['computer vision', 'компьютерное зрение', 'OpenCV'], short: ['CV'] },
  'api-testing': { strict: ['Postman', 'SoapUI', 'тестирование API', 'API-тестирование'] },
  'mobile-testing': { strict: ['тестирование мобильных', 'мобильное тестирование', 'mobile testing'] },
  'web-testing': { strict: ['DevTools', 'тестирование веб', 'web testing', 'веб-тестирование'] },
  'test-management': { strict: ['TestRail', 'TestIT', 'Allure', 'Zephyr', 'TMS'] },
  jira: { strict: ['Jira', 'YouTrack', 'Confluence'] },
  'traffic-sniffing': { strict: ['Charles', 'Fiddler', 'Wireshark'] },
};

interface SkillMatcher {
  code: string;
  title: string;
  strict: RegExp[];
  short: RegExp[];
}

const SKILL_MATCHERS: SkillMatcher[] = SKILLS.map((skill) => {
  const aliases = SKILL_ALIASES[skill.code] ?? {};
  const strictTerms = [...new Set([skill.title.length >= 4 && skill.title.length <= 24 && !/[()/]/.test(skill.title) ? skill.title : '', ...(aliases.strict ?? [])].filter(Boolean))];
  return {
    code: skill.code,
    title: skill.title,
    strict: strictTerms.map((term) => termRegExp(term)),
    short: (aliases.short ?? []).map((term) => new RegExp(`${BOUNDARY_BEFORE}${escapeRegExp(term)}${BOUNDARY_AFTER}`, 'u')),
  };
});

const DURATION = /^[\s\-–—:(,]*(?:около\s+)?(\d{1,2})(?:[.,]5)?\s*\+?\s*(лет|года|год|yrs?\.?|years?|мес\w*|months?)/i;

function findSkills(lines: string[], sections: Map<Section, string[]>): ResumeSuggestion['skills'] {
  const skillLines = new Set(sections.get('skills') ?? []);
  const found = new Map<string, { title: string; months: number | null; inSkills: boolean }>();
  for (const line of lines) {
    if (!line) continue;
    const inSkills = skillLines.has(line);
    for (const matcher of SKILL_MATCHERS) {
      const patterns = inSkills ? [...matcher.strict, ...matcher.short] : matcher.strict;
      for (const pattern of patterns) {
        const match = pattern.exec(line);
        if (!match) continue;
        const after = line.slice(match.index + match[0].length, match.index + match[0].length + 24);
        const duration = after.match(DURATION);
        let months: number | null = null;
        if (duration) {
          const n = Number(duration[1]) * (/^(?:лет|года|год|y)/i.test(duration[2]) ? 12 : 1);
          months = n > 0 && n <= 600 ? n : null;
        }
        const previous = found.get(matcher.code);
        found.set(matcher.code, {
          title: matcher.title,
          months: months ?? previous?.months ?? null,
          inSkills: inSkills || (previous?.inSkills ?? false),
        });
        break;
      }
    }
  }
  return [...found.entries()]
    .sort(([, a], [, b]) => Number(b.inSkills) - Number(a.inSkills))
    .slice(0, 40)
    .map(([code, value]) => ({ code, title: value.title, months: value.months }));
}

// ───────────────────────────── Роли, soft skills, отрасли ─────────────────────────────

const ROLE_PATTERNS: Record<string, RegExp[]> = {
  DEVELOPER: [/разработчик/i, /developer/i, /программист/i, /software\s+engineer/i],
  TESTER: [/тестировщик/i, /инженер\s+по\s+тестированию/i, /\bQA\b/, /tester/i, /quality\s+assurance/i],
  DATA_SCIENTIST: [/data\s+scientist/i, /дата[-\s]?сайентист/i, /ML[-\s]?инженер/i, /ML\s+engineer/i, /machine\s+learning\s+engineer/i, /исследователь\s+данных/i],
  TEAM_LEAD: [/тим[-\s]?лид/i, /team\s*lead/i, /руководил\w*\s+команд/i, /руководитель\s+(?:группы|команды)/i],
  TECH_LEAD: [/тех[-\s]?лид/i, /tech\s*lead/i, /technical\s+lead/i],
  ARCHITECT: [/архитектор/i, /architect/i],
  MENTOR: [/наставник/i, /наставнич/i, /ментор/i, /mentor/i],
  TEAM_CAPTAIN: [/капитан\s+команды/i, /team\s+captain/i],
};

const SOFT_PATTERNS: Record<string, RegExp[]> = {
  COMMUNICATION: [/коммуникабельн/i, /навыки\s+коммуникации/i, /коммуникаци/i, /communication/i],
  TEAMWORK: [/командная\s+работа/i, /работа\s+в\s+команде/i, /командный\s+игрок/i, /teamwork/i, /team\s+player/i],
  OWNERSHIP: [/ответственн/i, /ownership/i, /самостоятельн\w+\s+ведение/i],
  MENTORING: [/наставнич/i, /менторинг/i, /mentoring/i, /обучал\w*\s+(?:джуниор|новичков|коллег)/i],
  TIME_MANAGEMENT: [/тайм[-\s]?менеджмент/i, /планирование\s+времени/i, /time\s+management/i],
  CRITICAL_THINKING: [/критическ\w+\s+мышлен/i, /аналитическ\w+\s+мышлен/i, /critical\s+thinking/i],
  SELF_LEARNING: [/самообучаем/i, /самообучение/i, /быстро\s+обучаюсь/i, /self[-\s]?learning/i, /быстро\s+учусь/i],
  PUBLIC_SPEAKING: [/публичные\s+выступлени/i, /выступал\w*\s+на\s+(?:конференц|митап)/i, /public\s+speaking/i, /докладчик/i],
  CONFLICT_RESOLUTION: [/разрешение\s+конфликтов/i, /решение\s+конфликтов/i, /conflict\s+resolution/i, /переговор/i],
  STRESS_RESISTANCE: [/стрессоустойчив/i, /работа\s+в\s+сжатые\s+сроки/i, /многозадачност/i, /stress\s+resistance/i, /work\s+under\s+pressure/i],
};

const INDUSTRY_PATTERNS: Record<string, RegExp[]> = {
  FINTECH: [/финтех/i, /fintech/i, /\bбанк/i, /платёжн/i, /платежн/i, /страхов/i],
  ECOMMERCE: [/e-?commerce/i, /интернет-магазин/i, /ритейл/i, /маркетплейс/i, /розничн/i],
  GOVTECH: [/госсектор/i, /государственн/i, /госуслуг/i, /govtech/i],
  EDTECH: [/edtech/i, /образовательн/i, /онлайн-школ/i, /онлайн[-\s]образован/i],
  HEALTHTECH: [/медицин/i, /healthtech/i, /клиник/i, /здравоохранен/i],
  TELECOM: [/телеком/i, /оператор\w*\s+связи/i, /telecom/i],
  GAMEDEV: [/gamedev/i, /game\s?dev/i, /разработка\s+игр/i, /игровая\s+индустр/i],
  INDUSTRIAL: [/промышленн/i, /энергетик/i, /производственн/i],
  LOGISTICS: [/логистик/i, /доставк/i, /транспортн/i],
  MEDIA: [/медиа/i, /стриминг/i, /издательск/i],
  CYBERSECURITY: [/информационн\w+\s+безопасност/i, /кибербезопасност/i, /infosec/i, /cyber\s?security/i],
};

const matchCodes = (text: string, table: Record<string, RegExp[]>, allowed: Set<string>) =>
  Object.entries(table)
    .filter(([code, patterns]) => allowed.has(code) && patterns.some((p) => p.test(text)))
    .map(([code]) => code);

// ───────────────────────────── Специализация и грейд ─────────────────────────────

const TITLE_SPECIALIZATION: Array<{ code: SpecializationCode; pattern: RegExp }> = [
  { code: 'FRONTEND', pattern: /front[-\s]?end|фронт[-\s]?энд|фронтенд|веб[-\s]?интерфейс|react[-\s]?разработчик/i },
  { code: 'BACKEND', pattern: /back[-\s]?end|бэк[-\s]?энд|бэкенд|бекенд|серверн\w+\s+разработ|java[-\s]?разработчик|python[-\s]?разработчик|golang\s+developer/i },
  { code: 'ML_ENGINEER', pattern: /machine\s+learning|\bML\b|data\s+scientist|дата[-\s]?сайентист|машинное\s+обучение|ml[-\s]?инженер/i },
  { code: 'MANUAL_QA', pattern: /\bQA\b|тестировщик|tester|quality\s+assurance|инженер\s+по\s+тестированию|ручное\s+тестирование/i },
];

function guessSpecialization(lines: string[], skills: ResumeSuggestion['skills']): { code: SpecializationCode; confidence: ResumeConfidence } | null {
  const scores = new Map<SpecializationCode, number>();
  const bump = (code: SpecializationCode, value: number) => scores.set(code, (scores.get(code) ?? 0) + value);
  const head = lines.filter(Boolean).slice(0, 12).join('\n');
  for (const { code, pattern } of TITLE_SPECIALIZATION) if (pattern.test(head)) bump(code, 5);
  for (const skill of skills) {
    const def = SKILLS.find((s) => s.code === skill.code);
    if (def && def.specializations.length === 1) bump(def.specializations[0], 1);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 3) return null;
  const tie = ranked.length > 1 && ranked[1][1] === ranked[0][1];
  return { code: ranked[0][0], confidence: tie ? 'LOW' : ranked[0][1] >= 5 ? 'MEDIUM' : 'LOW' };
}

function guessGrade(lines: string[], experienceMonths: number | null): { grade: GradeCode; confidence: ResumeConfidence } | null {
  // Уровень ищется только в заголовочной части (первые строки), а не в тексте об опыте («наставничество джуниоров»).
  const head = lines.filter(Boolean).slice(0, 5).join('\n');
  if (/\bjunior\b|джуниор|стажёр|стажер|\bintern\b|младший/i.test(head)) return { grade: 'JUNIOR', confidence: 'MEDIUM' };
  if (/\bsenior\b|сеньор|ведущий|\blead\b|principal|старший|тим[-\s]?лид|тех[-\s]?лид/i.test(head)) return { grade: 'SENIOR', confidence: 'MEDIUM' };
  if (/\bmiddle\b|мидл|\bmid\b/i.test(head)) return { grade: 'MIDDLE', confidence: 'MEDIUM' };
  if (experienceMonths === null) return null;
  return { grade: experienceMonths < 24 ? 'JUNIOR' : experienceMonths < 72 ? 'MIDDLE' : 'SENIOR', confidence: 'LOW' };
}

// ───────────────────────────── Описание опыта ─────────────────────────────

function findDescription(sections: Map<Section, string[]>): string | null {
  const about = sections.get('about')?.filter(Boolean).join('\n');
  const experience = sections.get('experience')?.filter(Boolean).join('\n');
  const text = [about, experience].filter(Boolean).join('\n\n').trim();
  if (text.length < 40) return null;
  return text.length > 3000 ? `${text.slice(0, 2997)}…` : text;
}

// ───────────────────────────── Главная функция ─────────────────────────────

export function parseResume(rawText: string, now: Date = new Date()): ResumeSuggestion {
  const lines = normalizeResumeText(rawText);
  const text = lines.join('\n');
  const sections = splitSections(lines);
  const confidence: ResumeSuggestion['confidence'] = {};
  const warnings: string[] = [];

  const name = findName(lines);
  const email = findEmail(text);
  const phone = findPhone(text);
  const messenger = findMessenger(text);
  const city = findCity(lines);
  const links = findLinks(text);
  const experience = findExperience(lines, sections, now);
  const skills = findSkills(lines, sections);
  const allowedRoles = new Set(TEAM_ROLES.map((r) => r.code));
  const allowedSoft = new Set(SOFT_SKILLS.map((s) => s.code));
  const allowedIndustries = new Set(INDUSTRIES.filter((i) => i.code !== 'ANY').map((i) => i.code));
  const teamRoles = matchCodes(text, ROLE_PATTERNS, allowedRoles);
  const softSkills = matchCodes(text, SOFT_PATTERNS, allowedSoft).slice(0, 10);
  const industries = matchCodes(text, INDUSTRY_PATTERNS, allowedIndustries).slice(0, 12);
  const specialization = guessSpecialization(lines, skills);
  const grade = guessGrade(lines, experience?.months ?? null);
  const description = findDescription(sections);

  const timezone = city?.timezone && KNOWN_TIMEZONES.has(city.timezone) ? city.timezone : null;

  if (name) confidence.fullName = name.confidence;
  if (email) confidence.contactEmail = 'HIGH';
  if (phone) confidence.phone = 'HIGH';
  if (messenger) confidence.messenger = 'MEDIUM';
  if (city) confidence.city = city.confidence;
  if (timezone) confidence.timezone = 'MEDIUM';
  if (links.length) confidence.externalLinks = 'HIGH';
  if (experience) confidence.experienceMonths = experience.confidence;
  if (skills.length) confidence.skills = (sections.get('skills')?.length ?? 0) > 0 ? 'HIGH' : 'MEDIUM';
  if (teamRoles.length) confidence.teamRoles = 'MEDIUM';
  if (softSkills.length) confidence.softSkills = 'MEDIUM';
  if (industries.length) confidence.industries = 'LOW';
  if (specialization) confidence.activeSpecialization = specialization.confidence;
  if (grade) confidence.declaredGrade = grade.confidence;
  if (description) confidence.experienceDescription = 'MEDIUM';

  if (grade && grade.confidence === 'LOW') warnings.push('Грейд оценён по стажу — это предположение; подтверждённым он становится только после теста.');
  if (experience?.confidence === 'LOW') warnings.push('Стаж рассчитан по периодам работы без точных месяцев — проверьте значение.');
  if (!name) warnings.push('ФИО не найдено — введите вручную.');
  if (lines.filter(Boolean).length < 5) warnings.push('В резюме мало текста: распознавание может быть неполным.');

  return {
    fullName: name?.value ?? null,
    contactEmail: email,
    phone,
    messenger,
    city: city?.name ?? null,
    timezone,
    externalLinks: links,
    experienceMonths: experience?.months ?? null,
    skills,
    teamRoles,
    softSkills,
    industries,
    activeSpecialization: specialization?.code ?? null,
    declaredGrade: grade?.grade ?? null,
    experienceDescription: description,
    confidence,
    warnings,
  };
}

/** Сколько полей удалось распознать (для сводки и аудита без содержимого). */
export function countRecognized(result: ResumeSuggestion): number {
  return Object.keys(result.confidence).length;
}
