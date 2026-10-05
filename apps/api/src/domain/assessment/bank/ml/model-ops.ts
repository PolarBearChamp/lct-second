import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { opt, round, table, text } from '../helpers';

/**
 * M6. Диагностика моделей, выбор порога по стоимости и эксплуатационные сценарии.
 * Junior — диагностика по кривым обучения (переобучение / недообучение) и действия.
 * Middle — выбор порога по стоимости ошибок; сравнение моделей по кросс-валидации с явным правилом значимости.
 * Senior — PSI для мониторинга дрейфа, интерпретация по порогам, типы дрейфа, порядок выкатки.
 */

interface Params {
  scenario: number;
  models?: Array<{ name: string; train: number; val: number }>;
  costFp?: number;
  costFn?: number;
  thresholds?: Array<{ t: number; fp: number; fn: number }>;
  cv?: Array<{ name: string; mean: number; std: number }>;
  bins?: Array<{ expected: number; actual: number }>;
  drift?: string[];
}

const SCENARIOS = ['кредитный скоринг', 'прогноз оттока', 'модерация отзывов', 'рекомендации товаров', 'диагностика поломок'];
const r2 = (v: number) => round(v, 2);

type Diagnosis = 'overfit' | 'underfit' | 'ok';
const DIAGNOSES: Record<Diagnosis, string> = {
  overfit: 'Переобучение: высокое качество на train, заметно ниже на validation',
  underfit: 'Недообучение: низкое качество и на train, и на validation',
  ok: 'Нормальное обобщение: качество на train и validation близко и достаточно высоко',
};

function diagnose(train: number, val: number): Diagnosis {
  if (train - val >= 0.12) return 'overfit';
  if (train < 0.7 && val < 0.7) return 'underfit';
  return 'ok';
}

const DRIFT_TYPES = [
  { key: 'covariate', situation: 'Распределение входных признаков изменилось (новый канал привлечения), связь признаков с целью прежняя' },
  { key: 'concept', situation: 'Связь между признаками и целевой переменной изменилась (изменились правила скоринга)' },
  { key: 'prior', situation: 'Доля положительного класса в потоке выросла, а признаки и связь с целью не изменились' },
  { key: 'pipeline', situation: 'После релиза источника доля пропусков в признаке выросла с 1% до 40%' },
];
const DRIFT_ANSWER: Record<string, string> = { covariate: 'Дрейф признаков (covariate shift)', concept: 'Концептуальный дрейф (concept drift)', prior: 'Сдвиг априорной вероятности класса (label / prior shift)', pipeline: 'Нарушение качества данных (сбой пайплайна)' };

export function psi(bins: Array<{ expected: number; actual: number }>): number {
  return bins.reduce((sum, b) => sum + (b.actual - b.expected) * Math.log(b.actual / b.expected), 0);
}

function normalizedBins(rng: Rng, shift: number): Array<{ expected: number; actual: number }> {
  const count = 5;
  const expected = [0.1, 0.2, 0.4, 0.2, 0.1];
  const moves = Array.from({ length: count }, () => rng.int(-shift, shift) / 100);
  const sum = moves.reduce((a, b) => a + b, 0);
  moves[2] -= sum; // сумма долей остаётся 1
  return expected.map((e, i) => ({ expected: e, actual: Math.max(0.02, r2(e + moves[i])) }));
}

export const modelOpsFamily: FamilyDefinition<Params> = {
  id: 'ml.model-ops',
  version: 1,
  specialization: 'ML_ENGINEER',
  group: 'ML_VALIDATION',
  title: 'Диагностика моделей и эксплуатация',
  description: 'Диагностика по кривым обучения, выбор порога по стоимости, сравнение моделей, PSI и типы дрейфа.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['model-validation', 'classification'],
  gradeNotes: {
    JUNIOR: 'Диагностика недо- и переобучения по train/validation и выбор действия.',
    MIDDLE: 'Выбор порога по стоимости ошибок; сравнение моделей по CV с явным правилом значимости.',
    SENIOR: 'PSI для мониторинга, интерпретация по порогам, типы дрейфа, порядок безопасной выкатки.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    const scenario = rng.int(0, SCENARIOS.length - 1);
    if (grade === 'JUNIOR') {
      for (let guard = 0; guard < 300; guard += 1) {
        const models = ['A', 'B', 'C'].map((name) => {
          const train = rng.int(55, 99) / 100;
          const val = Math.max(0.4, r2(train - rng.pick([0.02, 0.04, 0.15, 0.2, 0.25])));
          return { name, train, val };
        });
        const kinds = models.map((m) => diagnose(m.train, m.val));
        if (new Set(kinds).size === 3) return { scenario, models };
      }
      throw new Error('ml.model-ops: генерация не удалась');
    }
    if (grade === 'MIDDLE') {
      for (let guard = 0; guard < 500; guard += 1) {
        const costFp = rng.pick([1, 2, 5]);
        const costFn = rng.pick([10, 20, 50]);
        const thresholds = [0.3, 0.5, 0.7].map((t, i) => ({ t, fp: [60, 25, 8][i] + rng.int(-4, 4), fn: [5, 15, 40][i] + rng.int(-3, 3) }));
        const costs = thresholds.map((x) => x.fp * costFp + x.fn * costFn);
        const best = Math.min(...costs);
        if (costs.filter((c) => c === best).length !== 1) continue;
        const a = { name: 'A', mean: r2(rng.int(78, 90) / 100), std: rng.pick([0.01, 0.02, 0.03]) };
        const b = { name: 'B', mean: r2(a.mean + rng.pick([0.005, 0.01, 0.02, 0.04]) * (rng.bool() ? 1 : -1)), std: rng.pick([0.01, 0.02, 0.03]) };
        // Разница не должна лежать на границе правила (|Δ| = std_a + std_b), чтобы вывод был однозначным.
        if (Math.abs(Math.abs(a.mean - b.mean) - (a.std + b.std)) > 0.001) return { scenario, costFp, costFn, thresholds, cv: [a, b] };
      }
      throw new Error('ml.model-ops: генерация не удалась');
    }
    for (let guard = 0; guard < 500; guard += 1) {
      const bins = normalizedBins(rng, rng.pick([3, 6, 10]));
      const value = psi(bins);
      const edge = [0.1, 0.25].some((t) => Math.abs(value - t) < 0.02);
      if (!edge && bins.every((b) => b.actual > 0) && Math.abs(bins.reduce((s, b) => s + b.actual, 0) - 1) < 1e-9) {
        return { scenario, bins, drift: rng.sample(DRIFT_TYPES.map((d) => d.key), 3).sort() };
      }
    }
    throw new Error('ml.model-ops: генерация не удалась');
  },
  complexity(params) {
    return (params.models?.length ?? 0) + (params.thresholds?.length ?? 0) + (params.bins?.length ?? 0) + (params.drift?.length ?? 0);
  },
  build(params, grade) {
    const domain = SCENARIOS[params.scenario];
    const parts: AuthoredPart[] = [];
    if (grade === 'JUNIOR') {
      const models = params.models!;
      parts.push({
        id: 'p1',
        format: 'MATCHING',
        prompt: 'Поставьте в соответствие каждой модели диагноз по качеству на обучающей и валидационной выборках.',
        left: models.map((m) => opt(m.name, `Модель ${m.name}: train ${m.train}, validation ${m.val}`)),
        right: (Object.keys(DIAGNOSES) as Diagnosis[]).map((d) => opt(d, DIAGNOSES[d])),
        correct: Object.fromEntries(models.map((m) => [m.name, diagnose(m.train, m.val)])),
        skillTags: ['model-validation'],
      });
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: 'Что разумно попробовать при переобучении?',
        options: [opt('reg', 'Усилить регуляризацию, упростить модель или добавить данные'), opt('complex', 'Усложнить модель и добавить признаки'), opt('more-epochs', 'Обучать дольше без остановки по validation'), opt('drop-val', 'Объединить validation и train и больше не проверять')],
        correct: 'reg',
        skillTags: ['model-validation', 'classification'],
      });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: 'Что разумно попробовать при недообучении?',
        options: [opt('complex', 'Усложнить модель, добавить информативные признаки, ослабить регуляризацию'), opt('reg', 'Усилить регуляризацию'), opt('stop', 'Остановить обучение раньше'), opt('prune', 'Убрать часть признаков для упрощения модели')],
        correct: 'complex',
        skillTags: ['model-validation'],
      });
      return { title: `Кривые обучения: ${domain}`, context: [text(`Для задачи «${domain}» сравнили три модели; метрика — доля верных ответов.`)], parts };
    }
    if (grade === 'MIDDLE') {
      const { costFp, costFn, thresholds, cv } = params as Required<Params>;
      const costs = thresholds.map((x) => x.fp * costFp + x.fn * costFn);
      const best = Math.min(...costs);
      const [a, b] = cv;
      const decisive = Math.abs(a.mean - b.mean) > a.std + b.std + 0.0005;
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Чему равна минимальная суммарная стоимость ошибок среди трёх порогов?', correct: best, tolerance: 0, integer: true, skillTags: ['model-validation', 'classification'] });
      parts.push({ id: 'p2', format: 'SINGLE_CHOICE', prompt: 'Какой порог выбрать?', options: thresholds.map((x) => opt(`t${x.t}`, `Порог ${x.t}`)), correct: `t${thresholds[costs.indexOf(best)].t}`, skillTags: ['model-validation'] });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: 'Правило: разницу считать значимой, только если она больше суммы стандартных отклонений. Что вы скажете о моделях A и B?',
        options: [opt('a-better', 'A значимо лучше B'), opt('b-better', 'B значимо лучше A'), opt('indistinct', 'Различие не значимо по этому правилу — выбирайте более простую или дешёвую модель')],
        correct: decisive ? (a.mean > b.mean ? 'a-better' : 'b-better') : 'indistinct',
        skillTags: ['model-validation', 'classification'],
      });
      return {
        title: `Выбор порога и сравнение моделей: ${domain}`,
        context: [
          text(`Ложное срабатывание (FP) стоит ${costFp} у.е., пропуск (FN) — ${costFn} у.е. Результаты на валидации:`),
          table(['Порог', 'FP', 'FN'], thresholds.map((x) => [x.t, x.fp, x.fn])),
          text('Результаты 5-fold кросс-валидации (среднее ± std по фолдам) для двух моделей:'),
          table(['Модель', 'Среднее', 'Std'], cv.map((m) => [m.name, m.mean, m.std])),
        ],
        parts,
      };
    }
    const bins = params.bins!;
    const value = psi(bins);
    const verdict = value < 0.1 ? 'stable' : value < 0.25 ? 'moderate' : 'major';
    const keys = params.drift!;
    parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Чему равен PSI = Σ (actual − expected) · ln(actual / expected)? Округлите до сотых.', correct: r2(value), tolerance: 0.01, integer: false, skillTags: ['model-validation', 'classification'] });
    parts.push({
      id: 'p2',
      format: 'SINGLE_CHOICE',
      prompt: 'Что означает полученное значение по принятой интерпретации?',
      options: [opt('stable', 'Распределение стабильно, действий не требуется'), opt('moderate', 'Умеренный сдвиг: исследовать причины и усилить мониторинг'), opt('major', 'Существенный сдвиг: расследовать и, вероятно, переобучать модель')],
      correct: verdict,
      skillTags: ['model-validation'],
    });
    parts.push({
      id: 'p3',
      format: 'MATCHING',
      prompt: 'Сопоставьте ситуации с типом проблемы.',
      left: keys.map((k) => opt(k, DRIFT_TYPES.find((d) => d.key === k)!.situation)),
      right: Object.keys(DRIFT_ANSWER).map((k) => opt(k, DRIFT_ANSWER[k])),
      correct: Object.fromEntries(keys.map((k) => [k, k])),
      skillTags: ['model-validation', 'classification'],
    });
    return {
      title: `Мониторинг признака: ${domain}`,
      context: [
        text('Признак разбит на 5 интервалов. Доли объектов в обучающей выборке (expected) и в боевом потоке за неделю (actual), сумма долей каждого столбца равна 1:'),
        table(['Интервал', 'Expected', 'Actual'], bins.map((b, i) => [i + 1, b.expected, b.actual])),
        text('Интерпретация PSI: < 0.1 — стабильно; от 0.1 до 0.25 — умеренный сдвиг; ≥ 0.25 — существенный сдвиг.'),
      ],
      parts,
    };
  },
};
