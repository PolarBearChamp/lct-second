import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { opt, round, table, text } from '../helpers';

/**
 * M3. Матрица ошибок и метрики классификации.
 * Junior — precision, recall из счётчиков TP/FP/FN/TN и выбор приоритетной метрики по цене ошибки.
 * Middle — F1, специфичность, macro-precision по матрице 3×3, связь micro-среднего с accuracy.
 * Senior — precision/recall на заданном пороге по списку оценок и выбор порога с максимальным F1.
 * Числовые ответы вычисляются по формулам и принимаются с допуском 0.01.
 */

type Priority = 'recall' | 'precision';

const SCENARIOS: Array<{ text: string; priority: Priority }> = [
  { text: 'скрининг опасного заболевания: пропущенный больной хуже лишнего повторного обследования', priority: 'recall' },
  { text: 'антиспам-фильтр: потеря важного письма обходится дороже, чем пропущенный спам', priority: 'precision' },
  { text: 'антифрод: ручная проверка подозрительной операции дёшева, пропущенное мошенничество дорого', priority: 'recall' },
  { text: 'автоматическая блокировка аккаунтов: ложная блокировка клиента вызывает отток', priority: 'precision' },
  { text: 'модерация особо опасного контента: нельзя пропускать нарушения, ручная проверка доступна', priority: 'recall' },
  { text: 'звонок менеджера с премиальным предложением: каждый звонок дорог, нерелевантные звонки раздражают', priority: 'precision' },
];

interface Counts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

interface Params {
  scenario: number;
  counts?: Counts;
  classes?: string[];
  matrix?: number[][];
  scored?: Array<{ score: number; label: 0 | 1 }>;
  thresholds?: number[];
  query?: number;
}

const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);
const r2 = (value: number) => round(value, 2);

function counts(rng: Rng): Counts {
  for (;;) {
    const tp = rng.int(20, 90);
    const fp = rng.int(5, 60);
    const fn = rng.int(5, 60);
    const tn = rng.int(60, 300);
    // Метрики должны различаться между собой, иначе вопрос не различает путаницу precision/recall.
    if (Math.abs(r2(ratio(tp, tp + fp)) - r2(ratio(tp, tp + fn))) >= 0.05 && Math.abs(fp - fn) >= 6) return { tp, fp, fn, tn };
  }
}

function f1At(scored: Array<{ score: number; label: 0 | 1 }>, threshold: number) {
  const tp = scored.filter((s) => s.score >= threshold && s.label === 1).length;
  const fp = scored.filter((s) => s.score >= threshold && s.label === 0).length;
  const fn = scored.filter((s) => s.score < threshold && s.label === 1).length;
  return { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn) };
}

function classMetrics(matrix: number[][]) {
  // matrix[i][j]: истинный класс i, предсказан j.
  const size = matrix.length;
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  const trace = matrix.reduce((sum, row, i) => sum + row[i], 0);
  const precision = Array.from({ length: size }, (_, j) => ratio(matrix[j][j], matrix.reduce((sum, row) => sum + row[j], 0)));
  const recall = matrix.map((row, i) => ratio(row[i], row.reduce((a, b) => a + b, 0)));
  return { total, trace, precision, recall };
}

export const confusionMetricsFamily: FamilyDefinition<Params> = {
  id: 'ml.confusion-metrics',
  version: 1,
  specialization: 'ML_ENGINEER',
  group: 'ML_METRICS',
  title: 'Матрица ошибок и метрики классификации',
  description: 'Расчёт precision, recall, F1, специфичности и усреднений; выбор метрики и порога по цене ошибки.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['ml-metrics', 'classification'],
  gradeNotes: {
    JUNIOR: 'Precision и recall из TP/FP/FN/TN, выбор приоритетной метрики по цене ошибки.',
    MIDDLE: 'F1 и специфичность, macro-precision по матрице 3×3, micro-среднее и accuracy.',
    SENIOR: 'Precision и recall на заданном пороге по списку оценок, выбор порога с максимальным F1.',
  },
  sample(rng, grade) {
    const scenario = rng.int(0, SCENARIOS.length - 1);
    if (grade === 'JUNIOR') return { scenario, counts: counts(rng) };
    if (grade === 'MIDDLE') {
      const classes = rng.sample(['кошка', 'собака', 'птица', 'рыба', 'хомяк'], 3);
      for (;;) {
        const matrix = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => (i === j ? rng.int(20, 60) : rng.int(2, 18))));
        const m = classMetrics(matrix);
        // Macro-precision должна заметно отличаться от accuracy.
        const macro = m.precision.reduce((a, b) => a + b, 0) / 3;
        if (Math.abs(r2(macro) - r2(m.trace / m.total)) >= 0.03) return { scenario, counts: counts(rng), classes, matrix, query: rng.int(0, 2) };
      }
    }
    for (let guard = 0; guard < 500; guard += 1) {
      const scored = Array.from({ length: 10 }, () => ({ score: rng.int(5, 99) / 100, label: (rng.bool(0.45) ? 1 : 0) as 0 | 1 }));
      const scores = scored.map((s) => s.score);
      if (new Set(scores).size !== scores.length) continue;
      const positives = scored.filter((s) => s.label === 1).length;
      if (positives < 3 || positives > 6) continue;
      const thresholds = rng.sample([0.2, 0.3, 0.4, 0.5, 0.6, 0.7], 3).sort((a, b) => a - b);
      // Порог не должен совпадать с оценкой (граница включения «≥» не должна влиять на ответ).
      if (thresholds.some((t) => scores.includes(t))) continue;
      const f1s = thresholds.map((t) => r2(f1At(scored, t).f1));
      const best = Math.max(...f1s);
      if (f1s.filter((v) => v === best).length !== 1) continue;
      const at = f1At(scored, thresholds[1]);
      if (at.tp + at.fp === 0 || at.tp === 0) continue;
      return { scenario, scored, thresholds, query: 1 };
    }
    throw new Error('ml.confusion-metrics: генерация не удалась');
  },
  complexity(params) {
    return params.scored?.length ?? (params.matrix ? 9 : 4);
  },
  build(params, grade) {
    const scenario = SCENARIOS[params.scenario];
    const parts: AuthoredPart[] = [];
    if (grade === 'JUNIOR') {
      const c = params.counts!;
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Чему равна precision положительного класса? Округлите до сотых.', correct: r2(ratio(c.tp, c.tp + c.fp)), tolerance: 0.01, integer: false, skillTags: ['ml-metrics', 'classification'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Чему равна recall (полнота) положительного класса? Округлите до сотых.', correct: r2(ratio(c.tp, c.tp + c.fn)), tolerance: 0.01, integer: false, skillTags: ['ml-metrics'] });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: `Сценарий: ${scenario.text}. Какую метрику стоит приоритизировать?`,
        options: [opt('recall', 'Recall (полноту): важно найти как можно больше настоящих положительных'), opt('precision', 'Precision: важно, чтобы срабатывания были верными'), opt('accuracy', 'Accuracy: она учитывает все четыре клетки матрицы'), opt('tn', 'Число верно отвергнутых отрицательных (TN)')],
        correct: scenario.priority,
        skillTags: ['ml-metrics', 'classification'],
      });
      return {
        title: 'Метрики по матрице ошибок',
        context: [text('Бинарный классификатор оценили на отложенной выборке.'), table(['', 'Предсказано 1', 'Предсказано 0'], [['Истинно 1', c.tp, c.fn], ['Истинно 0', c.fp, c.tn]])],
        parts,
      };
    }
    if (grade === 'MIDDLE') {
      const c = params.counts!;
      const classes = params.classes!;
      const matrix = params.matrix!;
      const m = classMetrics(matrix);
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Чему равна F1-мера положительного класса бинарной задачи (первая таблица)? Округлите до сотых.', correct: r2(ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn)), tolerance: 0.01, integer: false, skillTags: ['ml-metrics', 'classification'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Чему равна специфичность (доля верно найденных отрицательных, TN / (TN + FP))? Округлите до сотых.', correct: r2(ratio(c.tn, c.tn + c.fp)), tolerance: 0.01, integer: false, skillTags: ['ml-metrics'] });
      parts.push({ id: 'p3', format: 'NUMERIC', prompt: 'Чему равна macro-precision для трёх классов (вторая таблица)? Округлите до сотых.', correct: r2(m.precision.reduce((a, b) => a + b, 0) / 3), tolerance: 0.01, integer: false, skillTags: ['ml-metrics', 'classification'] });
      parts.push({
        id: 'p4',
        format: 'SINGLE_CHOICE',
        prompt: 'Какое среднее по классам для многоклассовой задачи с одной меткой совпадает с accuracy?',
        options: [opt('micro', 'micro-averaged precision (и recall, и F1)'), opt('macro', 'macro-averaged precision'), opt('weighted-f1', 'weighted F1 по поддержке классов'), opt('none', 'Ни одно: accuracy не выражается через эти средние')],
        correct: 'micro',
        skillTags: ['ml-metrics'],
      });
      return {
        title: 'F1, специфичность и усреднения',
        context: [
          text(`Бинарный классификатор (${scenario.text.split(':')[0]}).`),
          table(['', 'Предсказано 1', 'Предсказано 0'], [['Истинно 1', c.tp, c.fn], ['Истинно 0', c.fp, c.tn]], 'Бинарная матрица'),
          text('Трёхклассовый классификатор: строки — истинный класс, столбцы — предсказанный.'),
          table(['', ...classes.map((x) => `Предсказано: ${x}`)], matrix.map((row, i) => [`Истинно: ${classes[i]}`, ...row]), 'Матрица 3×3'),
        ],
        parts,
      };
    }
    const scored = params.scored!;
    const thresholds = params.thresholds!;
    const at = f1At(scored, thresholds[1]);
    const f1s = thresholds.map((t) => r2(f1At(scored, t).f1));
    const best = thresholds[f1s.indexOf(Math.max(...f1s))];
    parts.push({ id: 'p1', format: 'NUMERIC', prompt: `Чему равна precision при пороге ${thresholds[1]} (положительное предсказание: оценка ≥ порога)? Округлите до сотых.`, correct: r2(at.precision), tolerance: 0.01, integer: false, skillTags: ['ml-metrics', 'classification'] });
    parts.push({ id: 'p2', format: 'NUMERIC', prompt: `Чему равна recall при пороге ${thresholds[1]}? Округлите до сотых.`, correct: r2(at.recall), tolerance: 0.01, integer: false, skillTags: ['ml-metrics'] });
    parts.push({
      id: 'p3',
      format: 'SINGLE_CHOICE',
      prompt: `Какой из порогов даёт наибольшую F1-меру? (Сценарий: ${scenario.text}.)`,
      options: thresholds.map((t) => opt(`t${t}`, `Порог ${t}`)),
      correct: `t${best}`,
      skillTags: ['ml-metrics', 'classification'],
    });
    parts.push({
      id: 'p4',
      format: 'SINGLE_CHOICE',
      prompt: 'Как изменится recall при повышении порога классификации (при неизменной модели)?',
      options: [opt('down', 'Не увеличится: положительных предсказаний станет не больше'), opt('up', 'Увеличится: модель станет увереннее'), opt('same', 'Не изменится: recall не зависит от порога'), opt('random', 'Зависит от случайного разбиения выборки')],
      correct: 'down',
      skillTags: ['ml-metrics'],
    });
    return {
      title: 'Метрики и выбор порога',
      context: [
        text('Модель выдаёт оценку вероятности положительного класса. Результаты на отложенной выборке из 10 объектов:'),
        table(['№', 'Оценка модели', 'Истинная метка'], scored.map((s, i) => [i + 1, s.score, s.label])),
      ],
      parts,
    };
  },
};
