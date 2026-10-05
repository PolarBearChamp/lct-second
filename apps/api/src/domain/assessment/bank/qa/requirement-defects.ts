import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { list, opt, table, text } from '../helpers';

/**
 * Q1. Анализ требований: дефекты формулировок и трассируемость.
 * Типы дефектов определены в условии, поэтому классификация однозначна:
 *  - неоднозначность — значение параметра не задано («несколько», «некоторое время»);
 *  - непроверяемость — субъективный критерий без измеримого результата («удобно», «разумно»);
 *  - неполнота — перечисление не охватывает все категории из спецификации;
 *  - противоречие — другое требование задаёт иное значение того же параметра.
 * Junior — классификация отдельных требований. Middle — плюс противоречащая пара и подсчёт пропусков.
 * Senior — трассируемость: влияние изменения требования с учётом транзитивных зависимостей и пробелы покрытия.
 */

type DefectType = 'OK' | 'AMBIGUOUS' | 'UNTESTABLE' | 'INCOMPLETE' | 'CONTRADICTION';

const LABELS: Record<DefectType, string> = {
  OK: 'Дефектов нет: требование пригодно для тест-дизайна',
  AMBIGUOUS: 'Неоднозначность: значение параметра не задано',
  UNTESTABLE: 'Непроверяемость: субъективный критерий без измеримого результата',
  INCOMPLETE: 'Неполнота: перечисление не охватывает все категории из спецификации',
  CONTRADICTION: 'Противоречие: другое требование задаёт иное значение того же параметра',
};

const DEFINITIONS = [
  'Неоднозначность — значение параметра не определено («несколько», «некоторое время»).',
  'Непроверяемость — критерий субъективен, измеримого результата нет («удобно», «разумно»).',
  'Неполнота — перечисление в требовании не охватывает все категории из спецификации.',
  'Противоречие — два требования задают разные значения одного и того же параметра.',
];

const DOMAINS = [
  { feature: 'Перевод между счетами', plural: 'Переводы', gen: 'переводов', cats: ['обычный', 'серебряный', 'золотой', 'премиум'] },
  { feature: 'Оплата коммунальных услуг', plural: 'Платежи', gen: 'платежей', cats: ['гость', 'клиент', 'премиум', 'корпоративный'] },
  { feature: 'Оформление заказа', plural: 'Заказы', gen: 'заказов', cats: ['новый', 'постоянный', 'оптовый', 'партнёр'] },
];

const UX_BAD = [
  'Интерфейс должен быть удобным и интуитивно понятным.',
  'Сообщения об ошибках должны быть понятными пользователю.',
  'При сбоях система должна вести себя разумно.',
  'Страница должна выглядеть приятно и современно.',
];
const UX_OK = [
  'При ошибке сервера пользователь видит сообщение «Не удалось выполнить операцию» и кнопку «Повторить».',
  'Если введённая сумма превышает остаток, кнопка «Подтвердить» неактивна, а под полем суммы показано «Недостаточно средств».',
  'Страница подтверждения содержит сумму, получателя и кнопки «Подтвердить» и «Отмена».',
];

const TRACE_TITLES = ['Ввод данных операции', 'Проверка лимитов', 'Проверка баланса', 'Подтверждение одноразовым кодом', 'Проведение операции', 'Уведомление клиента', 'Запись в журнал операций'];

interface Req {
  text: string;
  type: DefectType;
}

interface Trace {
  titles: string[];
  /** [i, j]: требование i использует результат требования j (j < i). */
  deps: Array<[number, number]>;
  /** Для каждого теста — индексы связанных требований. */
  tests: number[][];
  changed: number;
}

interface Params {
  variant: 'single' | 'pair' | 'trace';
  domain: number;
  reqs: Req[];
  pair?: [number, number];
  missing?: number;
  trace?: Trace;
}

type Kind = 'limit' | 'session' | 'tiers' | 'ux';

function makeReq(rng: Rng, domain: (typeof DOMAINS)[number], kind: Kind, type: DefectType, missing = 1): Req {
  switch (kind) {
    case 'limit': {
      const n = rng.pick([3, 5, 10, 20]);
      return type === 'AMBIGUOUS'
        ? { type, text: `Допускается несколько ${domain.gen} в сутки на одного клиента.` }
        : { type: 'OK', text: `Допускается не более ${n} ${domain.gen} в сутки на одного клиента.` };
    }
    case 'session': {
      const minutes = rng.pick([10, 15, 20, 30]);
      return type === 'AMBIGUOUS'
        ? { type, text: 'Сессия завершается через некоторое время бездействия клиента.' }
        : { type: 'OK', text: `Сессия завершается после ${minutes} минут бездействия клиента.` };
    }
    case 'tiers': {
      const values = rng.sample([50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000], domain.cats.length).sort((a, b) => a - b);
      const omitted = new Set(type === 'INCOMPLETE' ? rng.sample([0, 1, 2, 3], missing) : []);
      const parts = domain.cats.map((c, i) => (omitted.has(i) ? null : `${c} — ${values[i].toLocaleString('ru-RU')} ₽`)).filter(Boolean);
      return { type: type === 'INCOMPLETE' ? 'INCOMPLETE' : 'OK', text: `Суточный лимит суммы: ${parts.join(', ')}.` };
    }
    case 'ux':
      return type === 'UNTESTABLE' ? { type, text: rng.pick(UX_BAD) } : { type: 'OK', text: rng.pick(UX_OK) };
  }
}

const KINDS: Array<{ kind: Kind; defect: DefectType }> = [
  { kind: 'limit', defect: 'AMBIGUOUS' },
  { kind: 'session', defect: 'AMBIGUOUS' },
  { kind: 'tiers', defect: 'INCOMPLETE' },
  { kind: 'ux', defect: 'UNTESTABLE' },
];

function singleReqs(rng: Rng, domain: (typeof DOMAINS)[number], needIncomplete: boolean, missing: number): Req[] {
  for (;;) {
    const flags = KINDS.map((k) => (k.kind === 'tiers' && needIncomplete ? true : rng.bool(0.55)));
    const defects = flags.filter(Boolean).length;
    if (defects < 2 || defects === KINDS.length) continue;
    return rng.shuffle(KINDS.map((k, i) => makeReq(rng, domain, k.kind, flags[i] ? k.defect : 'OK', missing)));
  }
}

function traceInstance(rng: Rng): Trace {
  const size = 5;
  const titles = rng.sample(TRACE_TITLES, size);
  for (let guard = 0; guard < 500; guard += 1) {
    const deps: Array<[number, number]> = [];
    for (let i = 1; i < size; i += 1) {
      for (let j = 0; j < i; j += 1) if (rng.bool(0.3)) deps.push([i, j]);
    }
    if (deps.length < 3 || deps.length > 6) continue;
    const untested = new Set(rng.sample([0, 1, 2, 3, 4], rng.int(1, 2)));
    const testable = [0, 1, 2, 3, 4].filter((r) => !untested.has(r));
    const tests = Array.from({ length: 8 }, () => rng.sample(testable, rng.int(1, 2)).sort((a, b) => a - b));
    // Каждое «тестируемое» требование должно иметь хотя бы один тест, иначе число пробелов не совпадёт с замыслом.
    if (testable.some((r) => !tests.some((t) => t.includes(r)))) continue;
    const changed = rng.int(0, size - 2);
    const impacted = impactedRequirements(deps, changed);
    const impactedTests = tests.filter((t) => t.some((r) => impacted.has(r))).length;
    if (impacted.size >= 3 && impacted.size <= 4 && impactedTests >= 3 && impactedTests <= 6) return { titles, deps, tests, changed };
  }
  throw new Error('qa.requirement-defects: генерация трассировки не удалась');
}

export function impactedRequirements(deps: Array<[number, number]>, changed: number): Set<number> {
  const result = new Set([changed]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [user, used] of deps) {
      if (result.has(used) && !result.has(user)) {
        result.add(user);
        grew = true;
      }
    }
  }
  return result;
}

export const requirementDefectsFamily: FamilyDefinition<Params> = {
  id: 'qa.requirement-defects',
  version: 1,
  specialization: 'MANUAL_QA',
  group: 'QA_REQUIREMENTS',
  title: 'Анализ требований: дефекты и трассируемость',
  description: 'Классификация дефектов формулировок требований, поиск противоречий и анализ влияния изменений.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['requirements-analysis', 'test-design'],
  gradeNotes: {
    JUNIOR: 'Классификация отдельных требований по заданным определениям дефектов.',
    MIDDLE: 'Противоречие между двумя требованиями, подсчёт пропущенных категорий, отбор требований на уточнение.',
    SENIOR: 'Трассируемость: транзитивное влияние изменения требования на тесты и пробелы покрытия.',
  },
  sample(rng, grade) {
    const domain = rng.int(0, DOMAINS.length - 1);
    const d = DOMAINS[domain];
    if (grade === 'JUNIOR') return { variant: 'single', domain, reqs: singleReqs(rng, d, false, 1) };
    if (grade === 'MIDDLE') {
      const missing = rng.int(1, 2);
      const base = singleReqs(rng, d, true, missing);
      const m1 = rng.pick([100, 200, 500, 1000]);
      const m2 = m1 + rng.pick([-50, 50, 100]) * (m1 >= 200 ? 1 : 0.5);
      const a: Req = { type: 'CONTRADICTION', text: `Минимальная сумма операции — ${m1} ₽.` };
      const b: Req = { type: 'CONTRADICTION', text: `${d.plural} на сумму менее ${m2} ₽ отклоняются системой.` };
      const reqs = rng.shuffle([...base, a, b]);
      const pair = reqs.map((r, i) => (r.type === 'CONTRADICTION' ? i : -1)).filter((i) => i >= 0) as [number, number];
      return { variant: 'pair', domain, reqs, pair, missing };
    }
    return { variant: 'trace', domain, reqs: [], trace: traceInstance(rng) };
  },
  complexity(params) {
    return params.trace ? params.trace.deps.length + params.trace.tests.length : params.reqs.length * 2;
  },
  build(params) {
    const d = DOMAINS[params.domain];
    const parts: AuthoredPart[] = [];
    if (params.variant === 'trace') {
      const t = params.trace!;
      const impacted = impactedRequirements(t.deps, t.changed);
      const impactedTests = t.tests.filter((tc) => tc.some((r) => impacted.has(r))).length;
      const untested = t.titles.map((_, r) => r).filter((r) => !t.tests.some((tc) => tc.includes(r)));
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: `Изменилось требование R${t.changed + 1}. Сколько тест-кейсов нужно пересмотреть (связанные с изменённым требованием и со всеми зависящими от него — прямо или косвенно)?`, correct: impactedTests, tolerance: 0, integer: true, skillTags: ['requirements-analysis', 'test-design'] });
      parts.push({ id: 'p2', format: 'MULTI_SELECT', prompt: `Какие требования затрагивает изменение R${t.changed + 1} (включая само R${t.changed + 1})?`, options: t.titles.map((title, r) => opt(`r${r}`, `R${r + 1}: ${title}`)), correct: [...impacted].map((r) => `r${r}`), skillTags: ['requirements-analysis'] });
      parts.push({ id: 'p3', format: 'NUMERIC', prompt: 'Сколько требований не покрыто ни одним тест-кейсом?', correct: untested.length, tolerance: 0, integer: true, skillTags: ['requirements-analysis', 'test-design'] });
      return {
        title: `Трассируемость: ${d.feature}`,
        context: [
          text(`Функция «${d.feature}». Требование «Ri → Rj» означает, что Ri использует результат Rj, поэтому изменение Rj может повлиять на Ri.`),
          table(['Требование', 'Использует результат'], t.titles.map((title, r) => [`R${r + 1}: ${title}`, t.deps.filter(([i]) => i === r).map(([, j]) => `R${j + 1}`).join(', ') || '—'])),
          table(['Тест-кейс', 'Проверяет требования'], t.tests.map((tc, i) => [`T${i + 1}`, tc.map((r) => `R${r + 1}`).join(', ')])),
        ],
        parts,
      };
    }
    const reqs = params.reqs;
    const intro = [
      text(`Требования к функции «${d.feature}». Категории клиентов в спецификации: ${d.cats.join(', ')}.`),
      list(DEFINITIONS),
      table(['№', 'Требование'], reqs.map((r, i) => [`R${i + 1}`, r.text])),
    ];
    if (params.variant === 'single') {
      parts.push({
        id: 'p1',
        format: 'MATCHING',
        prompt: 'Определите, какой дефект содержит каждое требование.',
        left: reqs.map((r, i) => opt(`r${i}`, `R${i + 1}: ${r.text}`)),
        right: (Object.keys(LABELS) as DefectType[]).map((k) => opt(k, LABELS[k])),
        correct: Object.fromEntries(reqs.map((r, i) => [`r${i}`, r.type])),
        skillTags: ['requirements-analysis'],
      });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Сколько требований можно взять в тест-дизайн без уточнения?', correct: reqs.filter((r) => r.type === 'OK').length, tolerance: 0, integer: true, skillTags: ['requirements-analysis', 'test-design'] });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: 'Что правильно сделать с требованием, содержащим субъективный критерий?',
        options: [opt('clarify', 'Запросить у аналитика измеримый критерий приёмки и только затем писать тесты'), opt('own', 'Самостоятельно придумать порог и проверять по нему'), opt('skip', 'Не тестировать: субъективные требования проверять нельзя'), opt('later', 'Проверить после релиза по отзывам пользователей')],
        correct: 'clarify',
        skillTags: ['requirements-analysis', 'test-design'],
      });
      return { title: `Дефекты требований: ${d.feature}`, context: intro, parts };
    }
    const [i, j] = params.pair!;
    // Дистракторы — пары, делящие ровно одно требование с настоящей парой: самые правдоподобные ошибки.
    const correctPair: [number, number] = [Math.min(i, j), Math.max(i, j)];
    const sharing: Array<[number, number]> = [];
    for (let a = 0; a < reqs.length; a += 1) {
      for (let b = a + 1; b < reqs.length; b += 1) {
        const shared = [a, b].filter((x) => correctPair.includes(x)).length;
        if (shared === 1) sharing.push([a, b]);
      }
    }
    const uniquePairs = [correctPair, ...sharing.slice(0, 3)];
    parts.push({ id: 'p1', format: 'SINGLE_CHOICE', prompt: 'Какие два требования противоречат друг другу?', options: uniquePairs.map(([a, b]) => opt(`${a}-${b}`, `R${a + 1} и R${b + 1}`)), correct: `${correctPair[0]}-${correctPair[1]}`, skillTags: ['requirements-analysis'] });
    parts.push({ id: 'p2', format: 'MULTI_SELECT', prompt: 'Какие требования нужно уточнить до начала тест-дизайна?', options: reqs.map((r, k) => opt(`r${k}`, `R${k + 1}`)), correct: reqs.map((r, k) => (r.type === 'OK' ? null : `r${k}`)).filter((x): x is string => x !== null), skillTags: ['requirements-analysis', 'test-design'] });
    parts.push({ id: 'p3', format: 'NUMERIC', prompt: 'Для скольких категорий клиентов в требовании о суточном лимите не задано значение?', correct: params.missing!, tolerance: 0, integer: true, skillTags: ['requirements-analysis'] });
    return { title: `Противоречия и пропуски: ${d.feature}`, context: intro, parts };
  },
};
