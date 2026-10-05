import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredOption, AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, opt, table, text } from '../helpers';

/**
 * F2. Комбинаторы промисов, время завершения и типы TypeScript.
 * Junior — Promise.all: результат, первая ошибка по времени, время завершения; тип кортежа.
 * Middle — race / any / allSettled со смешанными исходами; тип результата.
 * Senior — последовательное и параллельное ожидание с ошибкой; сужение типа PromiseSettledResult.
 */

type Combinator = 'all' | 'race' | 'any' | 'allSettled';

interface Spec {
  name: string;
  ok: boolean;
  ms: number;
  value: string;
  error: string;
}

interface Params {
  promises: Spec[];
  combinator: Combinator;
  typePair: number;
  /** Senior: задержки fetchItem по id и id, на котором запрос отклоняется (или null). */
  items?: Array<{ id: number; ms: number }>;
  failingId?: number | null;
}

const TYPE_PAIRS = [
  { a: 'User', fa: 'getUser', b: 'Order[]', fb: 'getOrders' },
  { a: 'Profile', fa: 'getProfile', b: 'Settings', fb: 'getSettings' },
  { a: 'Product', fa: 'getProduct', b: 'Review[]', fb: 'getReviews' },
  { a: 'Invoice', fa: 'getInvoice', b: 'Payment[]', fb: 'getPayments' },
  { a: 'Team', fa: 'getTeam', b: 'Member[]', fb: 'getMembers' },
];

const VALUES = ['"ok"', '42', '"user"', '"cache"', '7', '"done"', '"draft"'];
const ERRORS = ['timeout', 'forbidden', 'not found', 'network', 'rate limit', 'conflict'];

function settleTime(promises: Spec[], combinator: Combinator): number {
  const rejects = promises.filter((p) => !p.ok);
  const resolves = promises.filter((p) => p.ok);
  switch (combinator) {
    case 'all':
      return rejects.length ? Math.min(...rejects.map((p) => p.ms)) : Math.max(...promises.map((p) => p.ms));
    case 'race':
      return Math.min(...promises.map((p) => p.ms));
    case 'any':
      return resolves.length ? Math.min(...resolves.map((p) => p.ms)) : Math.max(...promises.map((p) => p.ms));
    case 'allSettled':
      return Math.max(...promises.map((p) => p.ms));
  }
}

function sample(rng: Rng, grade: GradeCode): Params {
  const typePair = rng.int(0, TYPE_PAIRS.length - 1);
  if (grade === 'SENIOR') {
    const count = rng.int(3, 5);
    const latencies = rng.sample([40, 60, 80, 120, 150, 200, 250, 300], count);
    const items = latencies.map((ms, i) => ({ id: 101 + i, ms }));
    const failingId = rng.bool(0.5) ? rng.pick(items).id : null;
    return { promises: [], combinator: 'all', typePair, items, failingId };
  }
  for (let guard = 0; guard < 200; guard += 1) {
    const count = rng.int(3, 4);
    const times = rng.sample([50, 100, 150, 200, 300, 400, 500], count);
    const names = ['p1', 'p2', 'p3', 'p4'];
    const values = rng.sample(VALUES, count);
    const errors = rng.sample(ERRORS, count);
    const combinator: Combinator = grade === 'JUNIOR' ? 'all' : rng.pick(['race', 'any', 'allSettled'] as const);
    const allOk = grade === 'JUNIOR' && rng.bool(0.35);
    const promises = times.map((ms, i) => ({ name: names[i], ok: allOk ? true : rng.bool(0.55), ms, value: values[i], error: errors[i] }));
    const okCount = promises.filter((p) => p.ok).length;
    const valid =
      (grade === 'JUNIOR' && (allOk || (okCount >= 1 && okCount < count))) ||
      (grade === 'MIDDLE' && okCount >= 1 && okCount < count) ||
      (combinator === 'any' && okCount === 0);
    if (valid) return { promises, combinator, typePair };
  }
  throw new Error('fe.promise-combinators: генерация не удалась');
}

function outcomeOptions(params: Params): { options: AuthoredOption[]; correct: string } {
  const { promises, combinator } = params;
  const byTime = [...promises].sort((a, b) => a.ms - b.ms);
  const rejects = byTime.filter((p) => !p.ok);
  const resolves = byTime.filter((p) => p.ok);
  const options: AuthoredOption[] = [];
  let correct = '';
  if (combinator === 'all') {
    if (rejects.length === 0) {
      options.push(opt('array', `Вернёт массив [${promises.map((p) => p.value).join(', ')}]`));
      const finishOrder = byTime.map((p) => p.value).join(', ');
      if (finishOrder !== promises.map((p) => p.value).join(', ')) {
        options.push(opt('by-time', `Вернёт массив в порядке завершения [${finishOrder}]`));
      }
      options.push(opt('err-aggregate', 'Отклонится с AggregateError'));
      options.push(opt('first-only', `Вернёт только первое по времени значение ${byTime[0].value}`));
      correct = 'array';
    } else {
      options.push(opt('with-undefined', `Вернёт массив [${promises.map((p) => (p.ok ? p.value : 'undefined')).join(', ')}]`));
      if (resolves.length) options.push(opt('values-only', `Вернёт массив только успешных значений [${promises.filter((p) => p.ok).map((p) => p.value).join(', ')}]`));
      for (const p of promises.filter((x) => !x.ok)) options.push(opt(`err-${p.name}`, `Отклонится с ошибкой «${p.error}»`));
      if (options.length < 4) options.push(opt('err-aggregate', 'Отклонится с AggregateError'));
      correct = `err-${rejects[0].name}`;
    }
  } else if (combinator === 'race') {
    const first = byTime[0];
    for (const p of promises) options.push(opt(p.ok ? `val-${p.name}` : `err-${p.name}`, p.ok ? `Вернёт ${p.value}` : `Отклонится с ошибкой «${p.error}»`));
    correct = first.ok ? `val-${first.name}` : `err-${first.name}`;
  } else if (combinator === 'any') {
    for (const p of promises) if (p.ok) options.push(opt(`val-${p.name}`, `Вернёт ${p.value}`));
    options.push(opt('aggregate', 'Отклонится с AggregateError'));
    for (const p of rejects.slice(0, 2)) options.push(opt(`err-${p.name}`, `Отклонится с ошибкой «${p.error}»`));
    correct = resolves.length ? `val-${resolves[0].name}` : 'aggregate';
  }
  return { options, correct };
}

export const promiseCombinatorsFamily: FamilyDefinition<Params> = {
  id: 'fe.promise-combinators',
  version: 1,
  specialization: 'FRONTEND',
  group: 'FE_JS_ASYNC',
  title: 'Комбинаторы промисов и типы TypeScript',
  description: 'Исход и время завершения Promise.all / race / any / allSettled, последовательное и параллельное ожидание, типы результатов.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['javascript', 'async-js', 'typescript'],
  gradeNotes: {
    JUNIOR: 'Promise.all: первая ошибка по времени, время завершения, тип кортежа.',
    MIDDLE: 'race, any, allSettled при смешанных исходах; тип результата комбинатора.',
    SENIOR: 'Последовательный цикл с await против Promise.all при ошибке; сужение PromiseSettledResult.',
  },
  sample,
  complexity(params) {
    return params.items ? params.items.length + (params.failingId ? 2 : 0) : params.promises.length + (params.combinator === 'all' ? 0 : 1);
  },
  build(params, grade) {
    const types = TYPE_PAIRS[params.typePair];
    if (grade === 'SENIOR') {
      const items = params.items!;
      const failIndex = items.findIndex((i) => i.id === params.failingId);
      const sequential = (failIndex >= 0 ? items.slice(0, failIndex + 1) : items).reduce((sum, i) => sum + i.ms, 0);
      const parallel = failIndex >= 0 ? items[failIndex].ms : Math.max(...items.map((i) => i.ms));
      const parts: AuthoredPart[] = [
        {
          id: 'p1',
          format: 'NUMERIC',
          prompt: 'Через сколько миллисекунд после вызова завершится (успешно или с ошибкой) sequential(ids)?',
          correct: sequential,
          tolerance: 0,
          integer: true,
          unit: 'мс',
          skillTags: ['javascript', 'async-js'],
        },
        {
          id: 'p2',
          format: 'NUMERIC',
          prompt: 'Через сколько миллисекунд после вызова завершится (успешно или с ошибкой) parallel(ids)?',
          correct: parallel,
          tolerance: 0,
          integer: true,
          unit: 'мс',
          skillTags: ['async-js'],
        },
        {
          id: 'p3',
          format: 'SINGLE_CHOICE',
          prompt: 'Какой тип у переменной r внутри блока if в функции report?',
          options: [
            opt('fulfilled', 'PromiseFulfilledResult<Item>'),
            opt('settled', 'PromiseSettledResult<Item>'),
            opt('item', 'Item'),
            opt('rejected', 'PromiseRejectedResult'),
          ],
          correct: 'fulfilled',
          skillTags: ['typescript'],
        },
      ];
      return {
        title: 'Последовательное и параллельное ожидание',
        context: [
          text(
            `fetchItem(id) выполняет запрос за фиксированное время из таблицы.${params.failingId ? ` Запрос для id = ${params.failingId} отклоняется с ошибкой по истечении своего времени.` : ' Все запросы завершаются успешно.'} Накладными расходами пренебрегите.`,
          ),
          table(['id', 'Время ответа, мс'], items.map((i) => [i.id, i.ms])),
          code(
            'typescript',
            [
              `const ids = [${items.map((i) => i.id).join(', ')}];`,
              '',
              'async function sequential(ids: number[]): Promise<Item[]> {',
              '  const result: Item[] = [];',
              '  for (const id of ids) {',
              '    result.push(await fetchItem(id));',
              '  }',
              '  return result;',
              '}',
              '',
              'async function parallel(ids: number[]): Promise<Item[]> {',
              '  return Promise.all(ids.map((id) => fetchItem(id)));',
              '}',
              '',
              'async function report(ids: number[]) {',
              '  const results = await Promise.allSettled(ids.map((id) => fetchItem(id)));',
              '  for (const r of results) {',
              "    if (r.status === 'fulfilled') {",
              '      // ← какой здесь тип у r?',
              '    }',
              '  }',
              '}',
            ].join('\n'),
          ),
        ],
        parts,
      };
    }

    const name = { all: 'Promise.all', race: 'Promise.race', any: 'Promise.any', allSettled: 'Promise.allSettled' }[params.combinator];
    const parts: AuthoredPart[] = [];
    if (params.combinator === 'allSettled') {
      parts.push({
        id: 'p1',
        format: 'MULTI_SELECT',
        prompt: `Какие элементы массива-результата ${name} будут иметь status: 'fulfilled'?`,
        options: params.promises.map((p) => opt(p.name, `Элемент для ${p.name}`)),
        correct: params.promises.filter((p) => p.ok).map((p) => p.name),
        skillTags: ['javascript', 'async-js'],
      });
    } else {
      const { options, correct } = outcomeOptions(params);
      parts.push({ id: 'p1', format: 'SINGLE_CHOICE', prompt: `Чем завершится await ${name}([${params.promises.map((p) => p.name).join(', ')}])?`, options, correct, skillTags: ['javascript', 'async-js'] });
    }
    parts.push({
      id: 'p2',
      format: 'NUMERIC',
      prompt: `Через сколько миллисекунд после старта ${name} перейдёт в итоговое состояние (выполнится или отклонится)?`,
      correct: settleTime(params.promises, params.combinator),
      tolerance: 0,
      integer: true,
      unit: 'мс',
      skillTags: ['async-js'],
    });
    const tsCombinator = grade === 'JUNIOR' ? 'all' : params.combinator;
    const tsOptions = [
      opt('tuple', `[${types.a}, ${types.b}]`),
      opt('union', `${types.a} | ${types.b}`),
      opt('settled', `[PromiseSettledResult<${types.a}>, PromiseSettledResult<${types.b}>]`),
      opt('array', `(${types.a} | ${types.b})[]`),
    ];
    parts.push({
      id: 'p3',
      format: 'SINGLE_CHOICE',
      prompt: `${types.fa}(): Promise<${types.a}>, ${types.fb}(): Promise<${types.b}>. Какой тип выведет TypeScript для const result = await Promise.${tsCombinator}([${types.fa}(), ${types.fb}()])?`,
      options: tsOptions,
      correct: tsCombinator === 'all' ? 'tuple' : tsCombinator === 'allSettled' ? 'settled' : 'union',
      skillTags: ['typescript'],
    });
    return {
      title: `${name}: исход и время`,
      context: [
        text('Каждый промис стартует одновременно и через указанное время выполняется со значением или отклоняется с ошибкой (new Error с указанным текстом).'),
        table(
          ['Промис', 'Исход', 'Через, мс'],
          params.promises.map((p) => [p.name, p.ok ? `выполнится: ${p.value}` : `отклонится: «${p.error}»`, p.ms]),
        ),
      ],
      parts,
    };
  },
};
