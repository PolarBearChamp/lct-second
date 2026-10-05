import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, round, table, text } from '../helpers';

/**
 * M2. Подготовка признаков в pandas.
 * Результат каждого фрагмента вычисляется моделью семантики pandas (NaN пропускаются в mean/median/count,
 * сравнение с NaN даёт False, drop_duplicates считает строки равными по всем столбцам).
 * Junior — dropna, fillna(mean), drop_duplicates, фильтрация с NaN.
 * Middle — groupby + transform, медиана по группам, value_counts(normalize=True).
 * Senior — размножение строк при merge, импутация только по train, pd.cut с правыми границами, count против size.
 */

interface Row {
  city: string;
  segment: 'A' | 'B';
  age: number | null;
  income: number | null;
}

interface Snippet {
  template: string;
  k?: number;
  threshold?: number;
  city?: string;
  trainRows?: number;
}

interface Params {
  rows: Row[];
  snippets: Snippet[];
  customers?: Array<{ customer_id: number; tier: string }>;
  orders?: Array<{ order_id: number; customer_id: number }>;
}

const CITIES = ['Казань', 'Пермь', 'Томск', 'Самара'];

const nn = (v: number | null): v is number => v !== null;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface Template {
  key: string;
  grade: GradeCode;
  code: (s: Snippet) => string;
  prompt: (s: Snippet) => string;
  integer: boolean;
  compute: (p: Params, s: Snippet) => number;
  configure: (rng: Rng, p: Params) => Snippet | null;
}

const TEMPLATES: Template[] = [
  {
    key: 'dropna-age',
    grade: 'JUNIOR',
    code: () => "df.dropna(subset=['age']).shape[0]",
    prompt: () => 'Сколько строк вернёт выражение?',
    integer: true,
    compute: (p) => p.rows.filter((r) => nn(r.age)).length,
    configure: () => ({ template: 'dropna-age' }),
  },
  {
    key: 'fillna-mean',
    grade: 'JUNIOR',
    code: (s) => `df['income'].fillna(df['income'].mean()).iloc[${s.k}]`,
    prompt: () => 'Какое значение вернёт выражение? Ответ с точностью до сотых.',
    integer: false,
    compute: (p, s) => round(p.rows[s.k!].income ?? mean(p.rows.map((r) => r.income).filter(nn)), 2),
    configure: (rng, p) => {
      const idx = p.rows.map((r, i) => (r.income === null ? i : -1)).filter((i) => i >= 0);
      return idx.length ? { template: 'fillna-mean', k: rng.pick(idx) } : null;
    },
  },
  {
    key: 'drop-duplicates',
    grade: 'JUNIOR',
    code: () => 'df.drop_duplicates().shape[0]',
    prompt: () => 'Сколько строк вернёт выражение?',
    integer: true,
    compute: (p) => new Set(p.rows.map((r) => JSON.stringify(r))).size,
    configure: () => ({ template: 'drop-duplicates' }),
  },
  {
    key: 'filter-age',
    grade: 'JUNIOR',
    code: (s) => `(df['age'] > ${s.threshold}).sum()`,
    prompt: () => 'Какое число вернёт выражение?',
    integer: true,
    compute: (p, s) => p.rows.filter((r) => nn(r.age) && r.age > s.threshold!).length,
    configure: (rng) => ({ template: 'filter-age', threshold: rng.pick([25, 30, 35, 40]) }),
  },
  {
    key: 'group-transform-mean',
    grade: 'MIDDLE',
    code: (s) => `df.groupby('city')['income'].transform('mean').iloc[${s.k}]`,
    prompt: () => 'Какое значение вернёт выражение? Ответ с точностью до сотых.',
    integer: false,
    compute: (p, s) => round(mean(p.rows.filter((r) => r.city === p.rows[s.k!].city).map((r) => r.income).filter(nn)), 2),
    configure: (rng, p) => {
      const ok = p.rows.map((r, i) => (p.rows.filter((x) => x.city === r.city && nn(x.income)).length >= 2 ? i : -1)).filter((i) => i >= 0);
      return ok.length ? { template: 'group-transform-mean', k: rng.pick(ok) } : null;
    },
  },
  {
    key: 'group-median-fill',
    grade: 'MIDDLE',
    code: (s) => `df['age'].fillna(df.groupby('segment')['age'].transform('median')).iloc[${s.k}]`,
    prompt: () => 'Какое значение вернёт выражение? Ответ с точностью до сотых.',
    integer: false,
    compute: (p, s) => {
      const row = p.rows[s.k!];
      return round(row.age ?? median(p.rows.filter((r) => r.segment === row.segment).map((r) => r.age).filter(nn)), 2);
    },
    configure: (rng, p) => {
      const idx = p.rows
        .map((r, i) => (r.age === null && p.rows.filter((x) => x.segment === r.segment && nn(x.age)).length >= 2 ? i : -1))
        .filter((i) => i >= 0);
      return idx.length ? { template: 'group-median-fill', k: rng.pick(idx) } : null;
    },
  },
  {
    key: 'value-counts-share',
    grade: 'MIDDLE',
    code: () => "df['segment'].value_counts(normalize=True)['A']",
    prompt: () => 'Какое значение вернёт выражение? Ответ с точностью до сотых.',
    integer: false,
    compute: (p) => round(p.rows.filter((r) => r.segment === 'A').length / p.rows.length, 2),
    configure: () => ({ template: 'value-counts-share' }),
  },
  {
    key: 'segment-mean-max',
    grade: 'MIDDLE',
    code: () => "df.groupby('segment')['income'].mean().max()",
    prompt: () => 'Какое значение вернёт выражение? Ответ с точностью до сотых.',
    integer: false,
    compute: (p) =>
      round(
        Math.max(...(['A', 'B'] as const).map((seg) => p.rows.filter((r) => r.segment === seg).map((r) => r.income).filter(nn)).filter((xs) => xs.length).map(mean)),
        2,
      ),
    configure: () => ({ template: 'segment-mean-max' }),
  },
  {
    key: 'merge-fanout',
    grade: 'SENIOR',
    code: () => "orders.merge(customers, on='customer_id', how='left').shape[0]",
    prompt: () => 'Сколько строк вернёт выражение?',
    integer: true,
    compute: (p) => p.orders!.reduce((sum, o) => sum + Math.max(1, p.customers!.filter((c) => c.customer_id === o.customer_id).length), 0),
    configure: () => ({ template: 'merge-fanout' }),
  },
  {
    key: 'train-only-impute',
    grade: 'SENIOR',
    code: (s) =>
      `train, test = df.iloc[:${s.trainRows}], df.iloc[${s.trainRows}:]\nimp = SimpleImputer(strategy='mean').fit(train[['income']])\nimp.transform(test[['income']])[${(s.k ?? 0) - (s.trainRows ?? 0)}, 0]`,
    prompt: () => 'Какое значение вернёт последнее выражение? Ответ с точностью до сотых.',
    integer: false,
    compute: (p, s) => round(p.rows[s.k!].income ?? mean(p.rows.slice(0, s.trainRows).map((r) => r.income).filter(nn)), 2),
    configure: (rng, p) => {
      const trainRows = rng.int(Math.ceil(p.rows.length / 2), p.rows.length - 2);
      const testNan = p.rows.map((r, i) => (i >= trainRows && r.income === null ? i : -1)).filter((i) => i >= 0);
      const trainValues = p.rows.slice(0, trainRows).map((r) => r.income).filter(nn);
      return testNan.length && trainValues.length >= 2 ? { template: 'train-only-impute', trainRows, k: rng.pick(testNan) } : null;
    },
  },
  {
    key: 'cut-bins',
    grade: 'SENIOR',
    code: () => "pd.cut(df['age'], bins=[0, 25, 40, 100]).value_counts()[pd.Interval(25, 40, closed='right')]",
    prompt: () => 'Какое число вернёт выражение?',
    integer: true,
    compute: (p) => p.rows.filter((r) => nn(r.age) && r.age > 25 && r.age <= 40).length,
    configure: () => ({ template: 'cut-bins' }),
  },
  {
    key: 'count-vs-size',
    grade: 'SENIOR',
    code: () => "(df.groupby('city')['income'].count() >= 2).sum()",
    prompt: () => 'Какое число вернёт выражение?',
    integer: true,
    compute: (p) => [...new Set(p.rows.map((r) => r.city))].filter((c) => p.rows.filter((r) => r.city === c && nn(r.income)).length >= 2).length,
    configure: () => ({ template: 'count-vs-size' }),
  },
];

function generateRows(rng: Rng, grade: GradeCode): Row[] {
  const count = grade === 'JUNIOR' ? rng.int(6, 7) : rng.int(7, 8);
  const cities = rng.sample(CITIES, 3);
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      city: rng.pick(cities),
      segment: rng.pick(['A', 'B'] as const),
      // Значения с границами 25 и 40 нужны для проверки pd.cut.
      age: rng.bool(0.22) ? null : rng.pick([19, 22, 25, 28, 31, 34, 40, 45, 52]),
      income: rng.bool(0.25) ? null : rng.pick([40, 55, 60, 72, 85, 90, 110, 125, 150]),
    });
  }
  if (grade === 'JUNIOR' && rng.bool(0.6)) {
    const source = rows.find((r) => r.age !== null && r.income !== null);
    if (source) rows.splice(rng.int(1, rows.length), 0, { ...source });
  }
  return rows;
}

function sample(rng: Rng, grade: GradeCode): Params {
  for (let guard = 0; guard < 300; guard += 1) {
    const params: Params = { rows: generateRows(rng, grade), snippets: [] };
    if (grade === 'SENIOR') {
      params.customers = [];
      const ids = [1, 2, 3, 4];
      for (const id of ids) {
        params.customers.push({ customer_id: id, tier: rng.pick(['basic', 'gold']) });
        if (rng.bool(0.35)) params.customers.push({ customer_id: id, tier: rng.pick(['basic', 'gold']) });
      }
      params.orders = Array.from({ length: rng.int(4, 6) }, (_, i) => ({ order_id: 500 + i, customer_id: rng.pick([1, 2, 3, 4, 5]) }));
    }
    const pool = rng.shuffle(TEMPLATES.filter((t) => t.grade === grade));
    for (const template of pool) {
      if (params.snippets.length === 2) break;
      const snippet = template.configure(rng, params);
      if (snippet) params.snippets.push(snippet);
    }
    if (params.snippets.length === 2 && (grade !== 'SENIOR' || params.customers!.length > 4 || params.snippets.every((s) => s.template !== 'merge-fanout'))) {
      return params;
    }
  }
  throw new Error('ml.pandas-prep: генерация не удалась');
}

const show = (v: number | null) => (v === null ? 'NaN' : v);

export const pandasPrepFamily: FamilyDefinition<Params> = {
  id: 'ml.pandas-prep',
  version: 1,
  specialization: 'ML_ENGINEER',
  group: 'ML_DATA',
  title: 'Подготовка признаков в pandas',
  description: 'Результат операций pandas с пропусками, группировками и объединениями таблиц.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['pandas', 'data-preparation', 'python', 'scikit-learn'],
  gradeNotes: {
    JUNIOR: 'dropna, fillna средним, drop_duplicates, сравнение с NaN.',
    MIDDLE: 'groupby + transform, медиана по группам, value_counts(normalize=True).',
    SENIOR: 'Размножение строк при merge, импутация только по train, pd.cut, count против size.',
  },
  sample,
  complexity(params) {
    return params.rows.length + params.rows.filter((r) => r.age === null || r.income === null).length;
  },
  build(params) {
    const parts: AuthoredPart[] = params.snippets.map((snippet, index) => {
      const template = TEMPLATES.find((t) => t.key === snippet.template)!;
      return {
        id: `p${index + 1}`,
        format: 'NUMERIC',
        prompt: `Фрагмент ${index + 1}. ${template.prompt(snippet)}`,
        correct: template.compute(params, snippet),
        tolerance: template.integer ? 0 : 0.01,
        integer: template.integer,
        skillTags: snippet.template === 'train-only-impute' ? ['scikit-learn', 'data-preparation', 'python'] : ['pandas', 'data-preparation', 'python'],
      };
    });
    const context = [
      text('DataFrame df (индекс — номер строки, NaN — пропуск):'),
      table(['', 'city', 'segment', 'age', 'income'], params.rows.map((r, i) => [i, r.city, r.segment, show(r.age), show(r.income)]), 'df'),
    ];
    if (params.snippets.some((s) => s.template === 'merge-fanout')) {
      context.push(table(['customer_id', 'tier'], params.customers!.map((c) => [c.customer_id, c.tier]), 'customers'));
      context.push(table(['order_id', 'customer_id'], params.orders!.map((o) => [o.order_id, o.customer_id]), 'orders'));
    }
    context.push(
      code(
        'python',
        params.snippets.map((s, i) => `# Фрагмент ${i + 1}\n${TEMPLATES.find((t) => t.key === s.template)!.code(s)}`).join('\n\n'),
      ),
    );
    return { title: 'Результат операций pandas', context, parts };
  },
};
