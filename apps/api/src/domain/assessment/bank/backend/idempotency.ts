import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { list, opt, table, text } from '../helpers';

/**
 * B2. Повторные запросы и идемпотентность (Idempotency-Key).
 * Junior — повтор с тем же/другим телом, запросы без ключа.
 * Middle — дополнительно истечение срока хранения ключа.
 * Senior — дополнительно параллельный запрос, пока первый ещё обрабатывается (409).
 * Правильный результат вычисляется детерминированной моделью сервиса ниже.
 */

type Outcome = 'created' | 'replayed' | 'mismatch' | 'inflight';

interface Req {
  n: number;
  /** Минуты от 10:00. */
  t: number;
  key: string | null;
  amount: number;
  /** Длительность обработки, минуты (только Senior). */
  duration: number;
}

interface Params {
  service: string;
  ttlMinutes: number;
  requests: Req[];
  askIndex: number;
}

const SERVICES = [
  { key: 'payments', path: '/payments', entity: 'платёж', entities: 'платежей' },
  { key: 'transfers', path: '/transfers', entity: 'перевод', entities: 'переводов' },
  { key: 'refunds', path: '/refunds', entity: 'возврат', entities: 'возвратов' },
  { key: 'orders', path: '/orders', entity: 'заказ', entities: 'заказов' },
];

export function simulateIdempotency(params: Pick<Params, 'ttlMinutes' | 'requests'>): Outcome[] {
  return runModel(params).outcomes;
}

/** Модель сервиса. boundary=true, если запрос пришёл ровно на границе срока/обработки (такие сценарии не выдаются). */
function runModel(params: Pick<Params, 'ttlMinutes' | 'requests'>): { outcomes: Outcome[]; boundary: boolean } {
  const store = new Map<string, { amount: number; storedAt: number; completesAt: number }>();
  const ordered = [...params.requests].sort((a, b) => a.t - b.t || a.n - b.n);
  const outcomes = new Map<number, Outcome>();
  let boundary = false;
  for (const req of ordered) {
    if (req.key === null) {
      outcomes.set(req.n, 'created');
      continue;
    }
    let entry = store.get(req.key);
    if (entry && (req.t === entry.storedAt + params.ttlMinutes || (req.t === entry.completesAt && entry.completesAt > entry.storedAt))) {
      boundary = true;
    }
    if (entry && req.t >= entry.storedAt + params.ttlMinutes) {
      store.delete(req.key);
      entry = undefined;
    }
    if (!entry) {
      store.set(req.key, { amount: req.amount, storedAt: req.t, completesAt: req.t + req.duration });
      outcomes.set(req.n, 'created');
    } else if (req.t < entry.completesAt) {
      outcomes.set(req.n, 'inflight');
    } else if (req.amount === entry.amount) {
      outcomes.set(req.n, 'replayed');
    } else {
      outcomes.set(req.n, 'mismatch');
    }
  }
  return { outcomes: params.requests.map((r) => outcomes.get(r.n)!), boundary };
}

const clock = (minutes: number) => {
  const h = 10 + Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

function generate(rng: Rng, grade: GradeCode): Params {
  const ttlMinutes = grade === 'JUNIOR' ? 24 * 60 : rng.pick([60, 90, 120]);
  const requestCount = grade === 'JUNIOR' ? rng.int(4, 5) : grade === 'MIDDLE' ? 6 : 7;
  const keys = rng.sample(['k-1a7f', 'k-2c9e', 'k-3b41', 'k-4d08', 'k-5e62', 'k-6f15', 'k-7a93'], 3);
  const amounts = rng.sample([500, 750, 1200, 1500, 2000, 2500, 3000, 4500], 3);

  for (let guard = 0; guard < 500; guard += 1) {
    const requests: Req[] = [];
    let t = rng.int(0, 5);
    for (let n = 1; n <= requestCount; n += 1) {
      const keyless = rng.bool(grade === 'JUNIOR' ? 0.2 : 0.12);
      const keyIndex = rng.int(0, 2);
      const sameBody = rng.bool(0.6);
      const previousWithKey = requests.find((r) => r.key === keys[keyIndex]);
      const amount = previousWithKey && sameBody ? previousWithKey.amount : rng.pick(amounts);
      const gap = grade === 'JUNIOR' ? rng.int(1, 6) : grade === 'MIDDLE' ? rng.pick([2, 5, 15, 40, 70]) : rng.pick([1, 2, 3, 20, 45, 80]);
      t += n === 1 ? 0 : gap;
      requests.push({
        n,
        t,
        key: keyless ? null : keys[keyIndex],
        amount,
        duration: grade === 'SENIOR' ? rng.int(2, 6) : 0,
      });
    }
    const { outcomes, boundary } = runModel({ ttlMinutes, requests });
    if (boundary) continue;
    const countOf = (o: Outcome) => outcomes.filter((x) => x === o).length;
    const createdWithKeyAgain = requests.some(
      (r, i) => r.key && outcomes[i] === 'created' && requests.slice(0, i).some((p) => p.key === r.key),
    );
    const ok =
      countOf('created') >= 2 &&
      countOf('replayed') >= 1 &&
      countOf('mismatch') >= 1 &&
      (grade === 'JUNIOR' || createdWithKeyAgain) &&
      (grade !== 'SENIOR' || countOf('inflight') >= 1) &&
      (grade === 'JUNIOR' || requests.some((r) => r.key === null) || countOf('created') >= 3);
    if (!ok) continue;
    const interesting = requests.filter((r, i) => r.key !== null && (outcomes[i] !== 'created' || createdWithKeyAgain));
    const askIndex = rng.pick(interesting.length ? interesting : requests).n;
    return { service: rng.pick(SERVICES).key, ttlMinutes, requests, askIndex };
  }
  throw new Error('be.idempotency: не удалось сгенерировать сценарий');
}

const OUTCOME_LABELS: Record<Outcome, string> = {
  created: 'Создаётся новая запись, ответ 201',
  replayed: 'Новая запись не создаётся, возвращается сохранённый ответ первого запроса',
  mismatch: 'Ответ 422: ключ уже использован с другим телом, запись не создаётся',
  inflight: 'Ответ 409: запрос с этим ключом ещё обрабатывается, запись не создаётся',
};

export const idempotencyFamily: FamilyDefinition<Params> = {
  id: 'be.idempotency',
  version: 1,
  specialization: 'BACKEND',
  group: 'BE_API',
  title: 'Повторные запросы и идемпотентность',
  description: 'Поведение API с Idempotency-Key при повторах, изменённом теле, истечении ключа и параллельных запросах.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['rest-api', 'http'],
  gradeNotes: {
    JUNIOR: 'Повтор с тем же и с другим телом, запросы без ключа.',
    MIDDLE: 'Плюс истечение срока хранения ключа: повтор после срока создаёт запись заново.',
    SENIOR: 'Плюс параллельная обработка: запрос с ключом, который ещё обрабатывается, получает 409.',
  },
  sample: generate,
  complexity(params) {
    return params.requests.length + (params.requests.some((r) => r.duration > 0) ? 2 : 0);
  },
  build(params, grade) {
    const service = SERVICES.find((s) => s.key === params.service)!;
    const outcomes = simulateIdempotency(params);
    const rules = [
      `Запрос без ключа всегда создаёт новый ${service.entity}.`,
      `Новый ключ: ${service.entity} создаётся, ответ сохраняется вместе с ключом и телом запроса${grade === 'JUNIOR' ? '' : ` на ${params.ttlMinutes} мин с момента первого запроса`}.`,
      ...(grade === 'SENIOR'
        ? ['Если запрос с этим ключом ещё обрабатывается (не истекло время обработки первого запроса), сервер отвечает 409.']
        : []),
      'Повтор с тем же ключом и тем же телом: новая запись не создаётся, возвращается сохранённый ответ.',
      'Тот же ключ с другим телом: ответ 422, запись не создаётся.',
      ...(grade === 'JUNIOR' ? [] : ['После истечения срока хранения ключ забывается и считается новым.']),
    ];
    const columns = ['№', 'Время', 'Idempotency-Key', 'Сумма, ₽', ...(grade === 'SENIOR' ? ['Обработка, мин'] : [])];
    const rows = params.requests.map((r) => [
      r.n,
      clock(r.t),
      r.key ?? '— (без ключа)',
      r.amount,
      ...(grade === 'SENIOR' ? [r.duration] : []),
    ]);
    const asked = params.requests.find((r) => r.n === params.askIndex)!;
    const askedOutcome = outcomes[params.requests.indexOf(asked)];
    const parts: AuthoredPart[] = [
      {
        id: 'p1',
        format: 'NUMERIC',
        prompt: `Сколько записей «${service.entity}» будет создано в результате всех запросов?`,
        correct: outcomes.filter((o) => o === 'created').length,
        tolerance: 0,
        integer: true,
        skillTags: ['rest-api'],
      },
      {
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: `Что произойдёт с запросом №${asked.n} (${clock(asked.t)})?`,
        options: (Object.keys(OUTCOME_LABELS) as Outcome[]).map((o) => opt(o, OUTCOME_LABELS[o])),
        correct: askedOutcome,
        skillTags: ['rest-api', 'http'],
      },
    ];
    if (grade === 'SENIOR') {
      parts.push({
        id: 'p3',
        format: 'MULTI_SELECT',
        prompt: 'Отметьте запросы, которые завершились без создания новой записи.',
        options: params.requests.map((r) => opt(`r${r.n}`, `Запрос №${r.n}`)),
        correct: params.requests.filter((_, i) => outcomes[i] !== 'created').map((r) => `r${r.n}`),
        skillTags: ['rest-api', 'http'],
      });
    }
    return {
      title: `Идемпотентный POST ${service.path}`,
      context: [
        text(
          `Сервис принимает POST ${service.path} с заголовком Idempotency-Key; тело запроса содержит только сумму. Правила проверяются по порядку:`,
        ),
        list(rules),
        text(
          grade === 'SENIOR'
            ? 'Журнал запросов (время обработки — сколько минут сервер обрабатывает запрос, начиная с времени поступления):'
            : 'Журнал запросов:',
        ),
        table(columns, rows),
      ],
      parts,
    };
  },
};
