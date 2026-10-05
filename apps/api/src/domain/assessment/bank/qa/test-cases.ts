import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredOption, AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { list, opt, table, text } from '../helpers';

/**
 * Q6. Тест-кейсы и отчёты о дефектах.
 * Junior — качество отчёта о дефекте: обязательные поля, шаги воспроизведения, выбор лучшего отчёта.
 * Middle — ожидаемые ответы API по правилам с приоритетом проверок; покрытие кодов ответа тестами.
 * Senior — анализ воспроизводимости: условие дефекта по таблице запусков, полный перебор окружений, заголовок отчёта.
 */

const SCENARIOS = [
  { feature: 'Применение промокода', steps: ['Открыть каталог', 'Добавить товар в корзину', 'Перейти в корзину', 'Ввести промокод SALE10', 'Нажать «Применить»'], actual: 'Скидка не применяется, сообщение об ошибке не показано', expected: 'Цена товара уменьшается на 10%' },
  { feature: 'Загрузка аватара', steps: ['Войти в личный кабинет', 'Открыть раздел «Профиль»', 'Нажать «Загрузить фото»', 'Выбрать файл JPG размером 3 МБ', 'Нажать «Сохранить»'], actual: 'Страница зависает, фото не сохраняется', expected: 'Фото сохраняется и отображается в профиле' },
  { feature: 'Восстановление пароля', steps: ['Открыть страницу входа', 'Нажать «Забыли пароль?»', 'Ввести email зарегистрированного пользователя', 'Нажать «Отправить»', 'Открыть почтовый ящик'], actual: 'Письмо не приходит в течение 10 минут', expected: 'Письмо со ссылкой приходит в течение 1 минуты' },
  { feature: 'Перевод между счетами', steps: ['Войти в приложение', 'Выбрать счёт списания', 'Ввести сумму 1000 ₽', 'Выбрать получателя из контактов', 'Нажать «Перевести»'], actual: 'Сумма списывается дважды', expected: 'Сумма списывается один раз' },
];

const FIELDS = ['Заголовок', 'Шаги воспроизведения', 'Фактический результат', 'Ожидаемый результат', 'Окружение'];
const ENVIRONMENTS = ['Chrome 126, Windows 11', 'Safari 17, macOS 14', 'Firefox 127, Ubuntu 22.04', 'Приложение 3.4.1, Android 14'];

const FLAWS = [
  { key: 'no-expected', label: 'нет ожидаемого результата' },
  { key: 'vague-steps', label: 'шаги не конкретны' },
  { key: 'multi', label: 'в одном отчёте несколько дефектов' },
  { key: 'subjective', label: 'субъективное описание результата' },
];

type Request = { auth: boolean; json: boolean; quantity: number | null; exists: boolean | null; stock: boolean | null };

const CODES = [201, 400, 401, 404, 409, 422];

interface AttrPick {
  attr: number;
  values: string[];
}

interface Params {
  variant: 'report' | 'api' | 'repro';
  scenario: number;
  env: number;
  missing?: number[];
  flaws?: string[];
  maxQuantity?: number;
  requests?: Request[];
  attrs?: AttrPick[];
  secret?: [[number, string], [number, string]];
  runs?: Array<{ values: string[]; failed: boolean }>;
}

const ATTRS = [
  { name: 'Браузер', values: ['Chrome', 'Firefox', 'Safari'] },
  { name: 'Роль', values: ['клиент', 'админ'] },
  { name: 'Язык', values: ['ru', 'en'] },
  { name: 'Размер файла', values: ['до 1 МБ', 'свыше 1 МБ'] },
  { name: 'Устройство', values: ['ноутбук', 'телефон'] },
];

export function expectedStatus(r: Request, maxQuantity: number): number {
  if (!r.auth) return 401;
  if (!r.json) return 400;
  if (r.quantity === null || !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > maxQuantity) return 422;
  if (!r.exists) return 404;
  if (!r.stock) return 409;
  return 201;
}

function randomRequest(rng: Rng, maxQuantity: number): Request {
  const auth = rng.bool(0.8);
  const json = rng.bool(0.85);
  const quantity = rng.pick([0, 1, 2, maxQuantity, maxQuantity + 1, 3]);
  const exists = rng.bool(0.8);
  const stock = rng.bool(0.75);
  return { auth, json, quantity: json ? quantity : null, exists, stock };
}

function reportOption(scenario: (typeof SCENARIOS)[number], env: string, flaw: string | null): AuthoredOption {
  const steps = scenario.steps.map((s, i) => `${i + 1}) ${s}`).join('; ');
  const title = flaw === 'multi' ? `${scenario.feature}: не работает, а также не открывается раздел «Помощь»` : `${scenario.feature}: ${scenario.actual.toLowerCase()}`;
  const fields = [
    `Заголовок: ${title}`,
    `Шаги: ${flaw === 'vague-steps' ? 'попробовать выполнить операцию' : steps}`,
    `Фактический результат: ${flaw === 'subjective' ? 'работает как-то странно' : scenario.actual}`,
    ...(flaw === 'no-expected' ? [] : [`Ожидаемый результат: ${scenario.expected}`]),
    `Окружение: ${env}`,
  ];
  return opt(flaw ?? 'good', fields.join('. '));
}

export function matchingConditions(attrs: AttrPick[], runs: Array<{ values: string[]; failed: boolean }>) {
  const pairs: Array<[[number, string], [number, string]]> = [];
  for (let i = 0; i < attrs.length; i += 1) {
    for (let j = i + 1; j < attrs.length; j += 1) {
      for (const vi of attrs[i].values) for (const vj of attrs[j].values) pairs.push([[i, vi], [j, vj]]);
    }
  }
  const perfect = pairs.filter(([a, b]) => runs.every((r) => r.failed === (r.values[a[0]] === a[1] && r.values[b[0]] === b[1])));
  const single = attrs.flatMap((p, i) => p.values.map((v) => [i, v] as [number, string])).filter(([i, v]) => runs.every((r) => r.failed === (r.values[i] === v)));
  return { perfect, single, pairs };
}

export const testCasesFamily: FamilyDefinition<Params> = {
  id: 'qa.test-cases',
  version: 1,
  specialization: 'MANUAL_QA',
  group: 'QA_DEFECTS',
  title: 'Тест-кейсы и отчёты о дефектах',
  description: 'Качество отчёта о дефекте, ожидаемые ответы API по правилам и анализ воспроизводимости.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['bug-reporting', 'test-design'],
  gradeNotes: {
    JUNIOR: 'Обязательные поля и шаги воспроизведения, выбор лучшего отчёта о дефекте.',
    MIDDLE: 'Ожидаемые коды ответа API при приоритете проверок; непокрытые тестами коды.',
    SENIOR: 'Условие дефекта по таблице запусков, число окружений полного перебора, информативный заголовок отчёта.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    const scenario = rng.int(0, SCENARIOS.length - 1);
    const env = rng.int(0, ENVIRONMENTS.length - 1);
    if (grade === 'JUNIOR') {
      return { variant: 'report', scenario, env, missing: rng.sample([0, 1, 2, 3, 4], rng.int(1, 3)).sort(), flaws: rng.sample(FLAWS.map((f) => f.key), 3).sort() };
    }
    if (grade === 'MIDDLE') {
      for (let guard = 0; guard < 500; guard += 1) {
        const maxQuantity = rng.pick([5, 10, 100]);
        const requests = Array.from({ length: rng.int(4, 5) }, () => randomRequest(rng, maxQuantity));
        const codes = new Set(requests.map((r) => expectedStatus(r, maxQuantity)));
        if (codes.size >= 3 && codes.size < 6 && requests.some((r) => r.auth && r.json && r.quantity !== null && (r.quantity === 0 || r.quantity > maxQuantity))) {
          return { variant: 'api', scenario, env, maxQuantity, requests };
        }
      }
      throw new Error('qa.test-cases: генерация (Middle) не удалась');
    }
    for (let guard = 0; guard < 5000; guard += 1) {
      const attrs: AttrPick[] = rng.sample(ATTRS.map((_, i) => i), 4).map((attr) => ({ attr, values: ATTRS[attr].values }));
      const i = rng.int(0, 3);
      let j = rng.int(0, 3);
      while (j === i) j = rng.int(0, 3);
      const [a, b] = i < j ? [i, j] : [j, i];
      const secret: [[number, string], [number, string]] = [[a, rng.pick(attrs[a].values)], [b, rng.pick(attrs[b].values)]];
      const seen = new Set<string>();
      const runs: Array<{ values: string[]; failed: boolean }> = [];
      while (runs.length < 10) {
        const values = attrs.map((p) => rng.pick(p.values));
        const key = values.join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        runs.push({ values, failed: values[secret[0][0]] === secret[0][1] && values[secret[1][0]] === secret[1][1] });
      }
      const failures = runs.filter((r) => r.failed).length;
      const { perfect, single } = matchingConditions(attrs, runs);
      if (failures >= 3 && failures <= 5 && perfect.length === 1 && single.length === 0) return { variant: 'repro', scenario, env, attrs, secret, runs };
    }
    throw new Error('qa.test-cases: генерация (Senior) не удалась');
  },
  complexity(params) {
    return (params.requests?.length ?? params.runs?.length ?? params.missing?.length ?? 3) * 2;
  },
  build(params) {
    const scenario = SCENARIOS[params.scenario];
    const env = ENVIRONMENTS[params.env];
    const parts: AuthoredPart[] = [];
    if (params.variant === 'report') {
      const missing = new Set(params.missing!);
      const values = [`${scenario.feature}: ${scenario.actual.toLowerCase()}`, scenario.steps.map((s, i) => `${i + 1}) ${s}`).join('; '), scenario.actual, scenario.expected, env];
      const options = [reportOption(scenario, env, null), ...params.flaws!.map((f) => reportOption(scenario, env, f))];
      parts.push({ id: 'p1', format: 'SINGLE_CHOICE', prompt: 'Какой из отчётов о дефекте оформлен лучше всего?', options, correct: 'good', skillTags: ['bug-reporting', 'test-design'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Для воспроизведения и приоритизации в отчёте обязательны пять полей (заголовок, шаги, фактический результат, ожидаемый результат, окружение). Сколько обязательных полей не заполнено в отчёте из таблицы?', correct: missing.size, tolerance: 0, integer: true, skillTags: ['bug-reporting'] });
      parts.push({ id: 'p3', format: 'ORDERING', prompt: 'Расположите шаги воспроизведения в правильном порядке.', items: scenario.steps.map((s, i) => opt(`s${i}`, s)), correct: scenario.steps.map((_, i) => `s${i}`), skillTags: ['bug-reporting', 'test-design'] });
      return {
        title: `Отчёт о дефекте: ${scenario.feature}`,
        context: [text(`Тестировщик нашёл дефект в функции «${scenario.feature}». Черновик отчёта:`), table(['Поле', 'Содержимое'], FIELDS.map((f, i) => [f, missing.has(i) ? '—' : values[i]]))],
        parts,
      };
    }
    if (params.variant === 'api') {
      const requests = params.requests!;
      const max = params.maxQuantity!;
      const statuses = requests.map((r) => expectedStatus(r, max));
      const covered = new Set(statuses);
      parts.push({ id: 'p1', format: 'MATCHING', prompt: 'Определите ожидаемый код ответа для каждого запроса.', left: requests.map((_, i) => opt(`r${i}`, `Запрос R${i + 1}`)), right: CODES.map((c) => opt(`c${c}`, String(c))), correct: Object.fromEntries(statuses.map((c, i) => [`r${i}`, `c${c}`])), skillTags: ['test-design'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Сколько запросов должны завершиться ответами 4xx?', correct: statuses.filter((c) => c >= 400).length, tolerance: 0, integer: true, skillTags: ['test-design'] });
      parts.push({ id: 'p3', format: 'NUMERIC', prompt: 'Для скольких из шести кодов ответа, перечисленных в спецификации, в этом наборе нет ни одного запроса?', correct: CODES.length - covered.size, tolerance: 0, integer: true, skillTags: ['test-design'] });
      const invalid = requests.find((r) => r.auth && r.json && r.quantity !== null && expectedStatus(r, max) === 422)!;
      parts.push({
        id: 'p4',
        format: 'SINGLE_CHOICE',
        prompt: `При проверке сервис ответил 201 на запрос с quantity = ${invalid.quantity} (корректный токен и JSON). Какой заголовок отчёта о дефекте оформлен правильно?`,
        options: [
          opt('exact', `POST /orders с quantity = ${invalid.quantity} возвращает 201 вместо 422 (ожидается ошибка валидации)`),
          opt('vague', 'Заказы создаются неправильно'),
          opt('blame', 'API снова сломали при релизе'),
          opt('no-expected', `POST /orders с quantity = ${invalid.quantity} возвращает 201`),
        ],
        correct: 'exact',
        skillTags: ['bug-reporting'],
      });
      return {
        title: 'Ожидаемые ответы API',
        context: [
          text('POST /orders создаёт заказ. Правила проверяются строго по порядку, возвращается ответ первого сработавшего правила:'),
          list(['нет токена авторизации → 401;', 'тело не является корректным JSON → 400;', `quantity отсутствует, не целое или вне диапазона 1–${max} → 422;`, 'товар с указанным productId не найден → 404;', 'товара нет в наличии → 409;', 'иначе → 201.']),
          table(['Запрос', 'Токен', 'Тело — корректный JSON', 'quantity', 'Товар существует', 'Товар в наличии'], requests.map((r, i) => [`R${i + 1}`, r.auth ? 'есть' : 'нет', r.json ? 'да' : 'нет', r.quantity ?? '—', r.exists ? 'да' : 'нет', r.stock ? 'да' : 'нет'])),
        ],
        parts,
      };
    }
    const attrs = params.attrs!;
    const runs = params.runs!;
    const secret = params.secret!;
    const { pairs } = matchingConditions(attrs, runs);
    const label = (c: [[number, string], [number, string]]) => `${ATTRS[attrs[c[0][0]].attr].name} = ${c[0][1]} и ${ATTRS[attrs[c[1][0]].attr].name} = ${c[1][1]}`;
    const failingRuns = runs.filter((r) => r.failed);
    const coversFailures = pairs.filter(([a, b]) => failingRuns.every((r) => r.values[a[0]] === a[1] && r.values[b[0]] === b[1]));
    const distractors = pairs.filter((c) => c !== pairs.find((p) => p[0][0] === secret[0][0] && p[0][1] === secret[0][1] && p[1][0] === secret[1][0] && p[1][1] === secret[1][1])).sort((x, y) => Number(coversFailures.includes(y)) - Number(coversFailures.includes(x)));
    const chosen = [secret, ...distractors.slice(0, 3)] as Array<[[number, string], [number, string]]>;
    const otherCombos = attrs.filter((_, k) => k !== secret[0][0] && k !== secret[1][0]).reduce((product, p) => product * p.values.length, 1);
    const titleOptions: AuthoredOption[] = [
      opt('exact', `${scenario.feature}: ошибка при ${secret[0][1]} + ${secret[1][1]} (${ATTRS[attrs[secret[0][0]].attr].name} и ${ATTRS[attrs[secret[1][0]].attr].name}); в остальных окружениях не воспроизводится`),
      opt('vague', `${scenario.feature}: не работает`),
      opt('blame', `${scenario.feature}: разработчики опять сломали`),
      opt('single', `${scenario.feature}: ошибка при ${secret[0][1]} (в любых окружениях)`),
    ];
    parts.push({ id: 'p1', format: 'SINGLE_CHOICE', prompt: 'При каком сочетании условий дефект воспроизводится всегда и только при нём?', options: chosen.map((c, i) => opt(`c${i}`, label(c))), correct: 'c0', skillTags: ['bug-reporting', 'test-design'] });
    parts.push({ id: 'p2', format: 'NUMERIC', prompt: `Сколько окружений из полного перебора всех значений четырёх параметров (${attrs.reduce((product, p) => product * p.values.length, 1)} комбинаций) воспроизведут дефект, если найденное условие верно?`, correct: otherCombos, tolerance: 0, integer: true, skillTags: ['test-design'] });
    parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: 'Какой заголовок отчёта о дефекте наиболее информативен?', options: titleOptions, correct: 'exact', skillTags: ['bug-reporting'] });
    return {
      title: `Воспроизводимость: ${scenario.feature}`,
      context: [
        text(`Дефект в функции «${scenario.feature}» проявляется не всегда. Результаты десяти запусков в разных окружениях:`),
        table(['№', ...attrs.map((p) => ATTRS[p.attr].name), 'Дефект'], runs.map((r, i) => [i + 1, ...r.values, r.failed ? 'воспроизвёлся' : 'нет'])),
      ],
      parts,
    };
  },
};
