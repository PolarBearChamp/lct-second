import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { opt, round, table, text } from '../helpers';

/**
 * M4. Метрики при дисбалансе классов и ранжирующие метрики.
 * Junior — парадокс accuracy: «всегда отрицательный» классификатор; F1 по счётчикам.
 * Middle — ROC-AUC как доля правильно упорядоченных пар; инвариантность к монотонным преобразованиям оценок.
 * Senior — precision через TPR, FPR и распространённость (формула Байеса); число ложных срабатываний на выборке.
 */

interface Params {
  population: number;
  positives?: number;
  tp?: number;
  fp?: number;
  fn?: number;
  scored?: Array<{ score: number; label: 0 | 1 }>;
  transforms?: string[];
  tpr?: number;
  fpr?: number;
  prevalence?: number;
  domain: number;
}

const DOMAINS = ['редкое заболевание', 'мошенничество с картами', 'отказ оборудования', 'отток премиальных клиентов'];
const r2 = (v: number) => round(v, 2);

// ROC-AUC зависит только от порядка оценок между положительными и отрицательными объектами:
// строго возрастающие преобразования его не меняют, а разворот порядка или меток даёт 1 − AUC (при AUC ≠ 0.5 это иное число).
const TRANSFORMS = [
  { key: 'times2', label: 'Умножить все оценки на 2', keeps: true },
  { key: 'sigmoid', label: 'Применить сигмоиду к оценкам', keeps: true },
  { key: 'shift', label: 'Прибавить 0.3 ко всем оценкам', keeps: true },
  { key: 'log', label: 'Взять логарифм всех (положительных) оценок', keeps: true },
  { key: 'rank', label: 'Заменить оценки их рангами (1 — наименьшая оценка)', keeps: true },
  { key: 'neg', label: 'Заменить оценки на их отрицательные значения', keeps: false },
  { key: 'one-minus', label: 'Заменить каждую оценку s на 1 − s', keeps: false },
  { key: 'flip-labels', label: 'Поменять местами метки классов 0 и 1 (оценки не менять)', keeps: false },
];

export function rocAuc(scored: Array<{ score: number; label: 0 | 1 }>): number {
  const pos = scored.filter((s) => s.label === 1);
  const neg = scored.filter((s) => s.label === 0);
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export const imbalanceMetricsFamily: FamilyDefinition<Params> = {
  id: 'ml.imbalance-metrics',
  version: 1,
  specialization: 'ML_ENGINEER',
  group: 'ML_METRICS',
  title: 'Метрики при дисбалансе и ранжирование',
  description: 'Accuracy при редком классе, ROC-AUC как доля верно упорядоченных пар, precision через распространённость.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['ml-metrics', 'classification'],
  gradeNotes: {
    JUNIOR: 'Парадокс accuracy на редком классе; F1 по TP/FP/FN.',
    MIDDLE: 'ROC-AUC по парам объектов; инвариантность к монотонным преобразованиям оценок.',
    SENIOR: 'Precision при заданных TPR, FPR и распространённости; ложные срабатывания на большой выборке.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    const domain = rng.int(0, DOMAINS.length - 1);
    if (grade === 'JUNIOR') {
      const positives = rng.pick([20, 30, 40, 50, 80]);
      const tp = rng.int(Math.ceil(positives * 0.4), Math.floor(positives * 0.9));
      const fp = rng.int(5, 40);
      return { domain, population: 1000, positives, tp, fp, fn: positives - tp };
    }
    if (grade === 'MIDDLE') {
      for (let guard = 0; guard < 500; guard += 1) {
        const total = rng.int(7, 8);
        const used = new Set<number>();
        const scored = Array.from({ length: total }, () => {
          let score = rng.int(5, 95) / 100;
          while (used.has(score)) score = rng.int(5, 95) / 100;
          used.add(score);
          return { score, label: (rng.bool(0.4) ? 1 : 0) as 0 | 1 };
        });
        const positives = scored.filter((s) => s.label === 1).length;
        const auc = rocAuc(scored);
        if (positives >= 2 && positives <= 4 && Math.abs(auc - 0.5) > 0.05 && auc < 0.95) {
          const keep = rng.sample(TRANSFORMS.filter((t) => t.keeps), 2);
          const drop = rng.sample(TRANSFORMS.filter((t) => !t.keeps), 2);
          return { domain, population: total, scored, transforms: [...keep, ...drop].map((t) => t.key).sort() };
        }
      }
      throw new Error('ml.imbalance-metrics: генерация не удалась');
    }
    return { domain, population: 10_000, tpr: rng.pick([0.8, 0.85, 0.9, 0.95]), fpr: rng.pick([0.01, 0.02, 0.05]), prevalence: rng.pick([0.01, 0.02, 0.05]) };
  },
  complexity(params) {
    return params.scored?.length ?? (params.tpr ? 4 : 3);
  },
  build(params, grade) {
    const domain = DOMAINS[params.domain];
    const parts: AuthoredPart[] = [];
    if (grade === 'JUNIOR') {
      const { positives, tp, fp, fn } = params as Required<Params>;
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Какова accuracy (в процентах) тривиального классификатора, который всегда отвечает «отрицательный класс»?', correct: ((1000 - positives) / 1000) * 100, tolerance: 0, integer: true, unit: '%', skillTags: ['ml-metrics', 'classification'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Чему равна F1-мера модели из второго абзаца? Округлите до сотых.', correct: r2((2 * tp) / (2 * tp + fp + fn)), tolerance: 0.01, integer: false, skillTags: ['ml-metrics'] });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: 'Какой набор метрик лучше описывает качество при таком дисбалансе?',
        options: [opt('pr', 'Precision, recall и F1 (или PR-AUC) положительного класса'), opt('acc', 'Только accuracy: она учитывает всю выборку'), opt('tn', 'Только число верных отрицательных ответов'), opt('mse', 'Среднеквадратичная ошибка между метками и предсказанными классами')],
        correct: 'pr',
        skillTags: ['ml-metrics', 'classification'],
      });
      return {
        title: 'Accuracy при редком классе',
        context: [
          text(`Задача: ${domain}. В выборке 1000 объектов, из них ${positives} положительных.`),
          text(`Обученная модель нашла ${tp} положительных, пропустила ${fn} и дала ${fp} ложных срабатываний.`),
        ],
        parts,
      };
    }
    if (grade === 'MIDDLE') {
      const scored = params.scored!;
      const keys = params.transforms!;
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Чему равна ROC-AUC (доля пар «положительный – отрицательный», где у положительного оценка выше)? Округлите до сотых.', correct: r2(rocAuc(scored)), tolerance: 0.01, integer: false, skillTags: ['ml-metrics', 'classification'] });
      parts.push({
        id: 'p2',
        format: 'MULTI_SELECT',
        prompt: 'После каких преобразований оценок ROC-AUC на этих объектах гарантированно не изменится?',
        options: keys.map((k) => opt(k, TRANSFORMS.find((t) => t.key === k)!.label)),
        correct: keys.filter((k) => TRANSFORMS.find((t) => t.key === k)!.keeps),
        skillTags: ['ml-metrics'],
      });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: 'Что означает ROC-AUC = 0.5?',
        options: [opt('random', 'Модель ранжирует объекты не лучше случайного угадывания'), opt('half', 'Модель верно классифицирует половину объектов'), opt('perfect', 'Модель идеально разделяет классы'), opt('thr', 'Оптимальный порог равен 0.5')],
        correct: 'random',
        skillTags: ['ml-metrics'],
      });
      return {
        title: 'ROC-AUC по парам объектов',
        context: [text(`Задача: ${domain}. Модель выдала оценки для ${scored.length} объектов.`), table(['№', 'Оценка', 'Метка'], scored.map((s, i) => [i + 1, s.score, s.label]))],
        parts,
      };
    }
    const { tpr, fpr, prevalence } = params as Required<Params>;
    const positives = Math.round(prevalence * 10_000);
    const tp = Math.round(tpr * positives);
    const falseAlarms = Math.round(fpr * (10_000 - positives));
    parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Сколько объектов получат положительное предсказание при ложной тревоге (FP)?', correct: falseAlarms, tolerance: 0, integer: true, skillTags: ['ml-metrics', 'classification'] });
    parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Чему равна precision на этой выборке? Округлите до сотых.', correct: r2(tp / (tp + falseAlarms)), tolerance: 0.01, integer: false, skillTags: ['ml-metrics'] });
    parts.push({
      id: 'p3',
      format: 'SINGLE_CHOICE',
      prompt: 'Что произойдёт с precision, если распространённость положительного класса вырастет, а TPR и FPR останутся прежними?',
      options: [opt('up', 'Precision вырастет'), opt('down', 'Precision упадёт'), opt('same', 'Precision не изменится: она зависит только от TPR и FPR'), opt('both', 'Вырастут и precision, и FPR')],
      correct: 'up',
      skillTags: ['ml-metrics', 'classification'],
    });
    return {
      title: 'Precision и распространённость',
      context: [
        text(`Задача: ${domain}. Скрининг ${(10_000).toLocaleString('ru-RU')} объектов. Распространённость положительного класса — ${(prevalence * 100).toFixed(0)}%.`),
        table(['Показатель', 'Значение'], [['TPR (recall)', tpr], ['FPR', fpr], ['Распространённость', prevalence]]),
      ],
      parts,
    };
  },
};
