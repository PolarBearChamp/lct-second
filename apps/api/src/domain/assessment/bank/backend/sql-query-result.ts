import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, round, table, text } from '../helpers';

/**
 * B3. Результат SQL-запроса на сгенерированных таблицах.
 * Junior — JOIN, фильтры, GROUP BY/HAVING, агрегаты без NULL.
 * Middle — LEFT JOIN и место условия (ON/WHERE), COUNT(col), AVG и сравнения с NULL.
 * Senior — NOT IN при NULL в подзапросе, NOT EXISTS, оконные функции, агрегаты с FILTER.
 * Ответ вычисляется детерминированной моделью семантики SQL (а не исполнением пользовательского кода).
 */

type Status = 'paid' | 'new' | 'cancelled';

interface UserRow {
  id: number;
  name: string;
  city: string;
}

interface OrderRow {
  id: number;
  user_id: number | null;
  amount: number | null;
  status: Status | null;
}

interface QuerySpec {
  template: string;
  city?: string;
  threshold?: number;
  status?: Status;
}

interface Params {
  users: UserRow[];
  orders: OrderRow[];
  queries: QuerySpec[];
}

const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина', 'Егор', 'Жанна', 'Илья', 'Карина', 'Лев'];
const CITIES = ['Москва', 'Казань', 'Пермь', 'Томск', 'Самара'];
const STATUSES: Status[] = ['paid', 'new', 'cancelled'];

interface Template {
  key: string;
  grade: GradeCode;
  sql: (q: QuerySpec) => string;
  question: string;
  integer: boolean;
  compute: (p: Params, q: QuerySpec) => number;
  /** Параметры шаблона. */
  configure?: (rng: Rng, p: Pick<Params, 'users' | 'orders'>) => Partial<QuerySpec>;
}

const nonNull = <T>(value: T | null): value is T => value !== null;
const ordersOf = (p: Params, userId: number) => p.orders.filter((o) => o.user_id === userId);

const TEMPLATES: Template[] = [
  // ── Junior ──
  {
    key: 'join_city',
    grade: 'JUNIOR',
    sql: (q) => `SELECT COUNT(*)\nFROM orders o\nJOIN users u ON u.id = o.user_id\nWHERE u.city = '${q.city}';`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    configure: (rng, p) => ({ city: rng.pick([...new Set(p.users.map((u) => u.city))]) }),
    compute: (p, q) => p.orders.filter((o) => p.users.some((u) => u.id === o.user_id && u.city === q.city)).length,
  },
  {
    key: 'filter_and',
    grade: 'JUNIOR',
    sql: (q) => `SELECT COUNT(*)\nFROM orders\nWHERE amount > ${q.threshold} AND status = '${q.status}';`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    configure: (rng) => ({ threshold: rng.pick([1000, 1500, 2000, 2500]), status: rng.pick(STATUSES) }),
    compute: (p, q) => p.orders.filter((o) => o.amount !== null && o.amount > q.threshold! && o.status === q.status).length,
  },
  {
    key: 'having_count',
    grade: 'JUNIOR',
    sql: () => `SELECT user_id\nFROM orders\nGROUP BY user_id\nHAVING COUNT(*) >= 2;`,
    question: 'Сколько строк вернёт запрос?',
    integer: true,
    compute: (p) => {
      const counts = new Map<number | null, number>();
      for (const o of p.orders) counts.set(o.user_id, (counts.get(o.user_id) ?? 0) + 1);
      return [...counts.values()].filter((c) => c >= 2).length;
    },
  },
  {
    key: 'sum_status',
    grade: 'JUNIOR',
    sql: (q) => `SELECT SUM(amount)\nFROM orders\nWHERE status = '${q.status}';`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    configure: (rng, p) => ({ status: rng.pick([...new Set(p.orders.map((o) => o.status).filter(nonNull))]) }),
    compute: (p, q) => p.orders.filter((o) => o.status === q.status).reduce((sum, o) => sum + (o.amount ?? 0), 0),
  },
  // ── Middle ──
  {
    key: 'left_zero',
    grade: 'MIDDLE',
    sql: () => `SELECT u.id, COUNT(o.id) AS cnt\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nGROUP BY u.id;`,
    question: 'Сколько строк результата будут иметь cnt = 0?',
    integer: true,
    compute: (p) => p.users.filter((u) => ordersOf(p, u.id).length === 0).length,
  },
  {
    key: 'left_where',
    grade: 'MIDDLE',
    sql: (q) => `SELECT COUNT(*)\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE o.status = '${q.status}';`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    configure: (rng) => ({ status: rng.pick(STATUSES) }),
    compute: (p, q) => p.users.reduce((sum, u) => sum + ordersOf(p, u.id).filter((o) => o.status === q.status).length, 0),
  },
  {
    key: 'left_on',
    grade: 'MIDDLE',
    sql: (q) => `SELECT COUNT(*)\nFROM users u\nLEFT JOIN orders o\n  ON o.user_id = u.id AND o.status = '${q.status}';`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    configure: (rng) => ({ status: rng.pick(STATUSES) }),
    compute: (p, q) => p.users.reduce((sum, u) => sum + Math.max(1, ordersOf(p, u.id).filter((o) => o.status === q.status).length), 0),
  },
  {
    key: 'count_column',
    grade: 'MIDDLE',
    sql: () => `SELECT COUNT(status)\nFROM orders;`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    compute: (p) => p.orders.filter((o) => o.status !== null).length,
  },
  {
    key: 'avg_nulls',
    grade: 'MIDDLE',
    sql: () => `SELECT ROUND(AVG(amount), 2)\nFROM orders;`,
    question: 'Какое значение вернёт запрос? Ответ — число с точностью до сотых.',
    integer: false,
    compute: (p) => {
      const values = p.orders.map((o) => o.amount).filter(nonNull);
      return round(values.reduce((a, b) => a + b, 0) / values.length, 2);
    },
  },
  {
    key: 'not_equal_null',
    grade: 'MIDDLE',
    sql: () => `SELECT COUNT(*)\nFROM orders\nWHERE status <> 'cancelled';`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    compute: (p) => p.orders.filter((o) => o.status !== null && o.status !== 'cancelled').length,
  },
  // ── Senior ──
  {
    key: 'not_in_null',
    grade: 'SENIOR',
    sql: () => `SELECT COUNT(*)\nFROM users\nWHERE id NOT IN (SELECT user_id FROM orders);`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    compute: (p) => {
      if (p.orders.some((o) => o.user_id === null)) return 0;
      return p.users.filter((u) => !p.orders.some((o) => o.user_id === u.id)).length;
    },
  },
  {
    key: 'not_exists',
    grade: 'SENIOR',
    sql: () => `SELECT COUNT(*)\nFROM users u\nWHERE NOT EXISTS (\n  SELECT 1 FROM orders o WHERE o.user_id = u.id\n);`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    compute: (p) => p.users.filter((u) => !p.orders.some((o) => o.user_id === u.id)).length,
  },
  {
    key: 'row_number_top',
    grade: 'SENIOR',
    sql: () =>
      `SELECT SUM(amount)\nFROM (\n  SELECT amount,\n         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY amount DESC, id) AS rn\n  FROM orders\n  WHERE user_id IS NOT NULL AND amount IS NOT NULL\n) t\nWHERE rn = 1;`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    compute: (p) => {
      const best = new Map<number, number>();
      for (const o of p.orders) {
        if (o.user_id === null || o.amount === null) continue;
        best.set(o.user_id, Math.max(best.get(o.user_id) ?? -Infinity, o.amount));
      }
      return [...best.values()].reduce((a, b) => a + b, 0);
    },
  },
  {
    key: 'filter_having',
    grade: 'SENIOR',
    sql: (q) =>
      `SELECT user_id\nFROM orders\nWHERE user_id IS NOT NULL\nGROUP BY user_id\nHAVING SUM(amount) FILTER (WHERE status = 'paid') > ${q.threshold};`,
    question: 'Сколько строк вернёт запрос?',
    integer: true,
    configure: (rng) => ({ threshold: rng.pick([1000, 1500, 2000, 3000]) }),
    compute: (p, q) => {
      const sums = new Map<number, number | null>();
      for (const o of p.orders) {
        if (o.user_id === null) continue;
        if (!sums.has(o.user_id)) sums.set(o.user_id, null);
        if (o.status === 'paid' && o.amount !== null) sums.set(o.user_id, (sums.get(o.user_id) ?? 0) + o.amount);
      }
      return [...sums.values()].filter((s) => s !== null && s > q.threshold!).length;
    },
  },
  {
    key: 'count_distinct',
    grade: 'SENIOR',
    sql: () => `SELECT COUNT(DISTINCT user_id)\nFROM orders;`,
    question: 'Какое число вернёт запрос?',
    integer: true,
    compute: (p) => new Set(p.orders.map((o) => o.user_id).filter(nonNull)).size,
  },
];

const templateOf = (key: string) => TEMPLATES.find((t) => t.key === key)!;

function generateData(rng: Rng, grade: GradeCode): Pick<Params, 'users' | 'orders'> {
  const userCount = rng.int(4, 6);
  const names = rng.sample(NAMES, userCount);
  const cities = rng.sample(CITIES, 3);
  const users: UserRow[] = names.map((name, i) => ({ id: i + 1, name, city: rng.pick(cities) }));
  const orderCount = grade === 'JUNIOR' ? rng.int(5, 7) : rng.int(6, 9);
  // У 1–2 пользователей нет заказов (важно для LEFT JOIN / NOT EXISTS).
  const withoutOrders = new Set(rng.sample(users.map((u) => u.id), grade === 'JUNIOR' ? 1 : rng.int(1, 2)));
  const buyers = users.filter((u) => !withoutOrders.has(u.id)).map((u) => u.id);
  const orders: OrderRow[] = [];
  for (let i = 0; i < orderCount; i += 1) {
    orders.push({
      id: 101 + i,
      user_id: rng.pick(buyers),
      amount: rng.pick([500, 800, 1200, 1500, 1800, 2200, 2500, 3100]),
      status: rng.pick(STATUSES),
    });
  }
  if (grade !== 'JUNIOR') {
    // NULL в status и amount.
    rng.pick(orders).status = null;
    const withNullAmount = rng.pick(orders);
    if (orders.filter((o) => o.amount !== null).length > 2) withNullAmount.amount = null;
  }
  if (grade === 'SENIOR' && rng.bool(0.6)) {
    // Гостевой заказ без пользователя.
    orders.push({ id: 101 + orders.length, user_id: null, amount: rng.pick([700, 1300, 1900]), status: rng.pick(STATUSES) });
  }
  return { users, orders };
}

export const sqlQueryResultFamily: FamilyDefinition<Params> = {
  id: 'be.sql-query-result',
  version: 1,
  specialization: 'BACKEND',
  group: 'BE_SQL',
  title: 'Результат SQL-запроса',
  description: 'Вычисление результата запросов с JOIN, агрегатами, NULL и оконными функциями на сгенерированных таблицах.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['sql'],
  gradeNotes: {
    JUNIOR: 'JOIN, фильтры, GROUP BY/HAVING, агрегаты без NULL.',
    MIDDLE: 'LEFT JOIN и место условия (ON против WHERE), COUNT(столбец), AVG и сравнения с NULL.',
    SENIOR: 'NOT IN при NULL в подзапросе, NOT EXISTS, оконные функции, агрегаты с FILTER.',
  },
  sample(rng, grade) {
    const data = generateData(rng, grade);
    const pool = TEMPLATES.filter((t) => t.grade === grade);
    const chosen = rng.sample(pool, 2);
    const queries = chosen.map((t) => ({ template: t.key, ...(t.configure ? t.configure(rng, data) : {}) }));
    return { ...data, queries };
  },
  complexity(params) {
    return params.orders.length + params.users.length + params.orders.filter((o) => o.status === null || o.amount === null || o.user_id === null).length * 2;
  },
  build(params) {
    const parts: AuthoredPart[] = params.queries.map((q, index) => {
      const template = templateOf(q.template);
      return {
        id: `p${index + 1}`,
        format: 'NUMERIC',
        prompt: `Запрос ${index + 1}. ${template.question}`,
        correct: template.compute(params, q),
        tolerance: template.integer ? 0 : 0.01,
        integer: template.integer,
        skillTags: ['sql'],
      };
    });
    const show = (value: string | number | null) => (value === null ? 'NULL' : value);
    return {
      title: 'Что вернёт SQL-запрос',
      context: [
        text('Даны таблицы PostgreSQL. Значение NULL показано как NULL. Определите результат каждого запроса.'),
        table(['id', 'name', 'city'], params.users.map((u) => [u.id, u.name, u.city]), 'users'),
        table(
          ['id', 'user_id', 'amount', 'status'],
          params.orders.map((o) => [o.id, show(o.user_id), show(o.amount), show(o.status)]),
          'orders',
        ),
        code('sql', params.queries.map((q, i) => `-- Запрос ${i + 1}\n${templateOf(q.template).sql(q)}`).join('\n\n')),
      ],
      parts,
    };
  },
};
