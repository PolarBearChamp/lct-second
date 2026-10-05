import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { opt, table, text } from '../helpers';

/**
 * Q4. Минимально достаточный набор проверок.
 * Junior — полный перебор и покрытие значений; когда применять попарное тестирование.
 * Middle — покрытие пар значений: непокрытые пары, нижняя оценка набора, лучший тест для добавления.
 * Senior — покрытие функций минимальным набором тестов и приоритизация по риску за минуту при лимите времени.
 */

const PARAMS = [
  { name: 'Браузер', values: ['Chrome', 'Firefox', 'Safari', 'Edge'] },
  { name: 'ОС', values: ['Windows', 'macOS', 'Linux', 'Android', 'iOS'] },
  { name: 'Язык', values: ['ru', 'en', 'de'] },
  { name: 'Оплата', values: ['карта', 'СБП', 'наличные', 'рассрочка'] },
  { name: 'Роль', values: ['гость', 'клиент', 'админ'] },
  { name: 'Экран', values: ['телефон', 'планшет', 'ноутбук'] },
];

interface PickedParam {
  param: number;
  values: string[];
}

interface SeniorTest {
  duration: number;
  risk: number;
  features: number[];
}

interface EpField {
  field: string;
  valid: number;
  invalid: number;
}

interface Params {
  variant: 'full' | 'pairs' | 'risk';
  /** Классы эквивалентности полей формы (Middle и Senior). */
  ep?: EpField[];
  picked?: PickedParam[];
  suite?: number[][];
  candidates?: number[][];
  tests?: SeniorTest[];
  features?: string[];
  budget?: number;
}

const FEATURES = ['Поиск', 'Корзина', 'Оплата', 'Профиль', 'Уведомления'];
const EP_FIELDS = ['Email', 'Возраст', 'Сумма платежа', 'Промокод', 'Город доставки'];

/**
 * Наименьшее число тестов, покрывающих все классы при условии «не более одного недопустимого значения в тесте».
 *  - каждый недопустимый класс требует отдельного теста: T ≥ Σ invalid;
 *  - в тесте поле не может быть одновременно допустимым и недопустимым, поэтому допустимые классы поля
 *    размещаются в тестах, где оно допустимо: T − invalid(f) ≥ valid(f), то есть T ≥ valid(f) + invalid(f).
 * Этих двух условий достаточно: тесты с недопустимым значением заодно несут допустимые значения остальных полей,
 * а допустимые классы повторяются циклически. Версия 1 считала «max(valid) + Σ invalid» — это верхняя оценка
 * (классический порядок «сначала допустимые, затем по одному недопустимому»), а не наименьшее число.
 */
export function minimalEquivalenceTests(fields: EpField[]): number {
  const invalidTotal = fields.reduce((sum, f) => sum + f.invalid, 0);
  return Math.max(invalidTotal, ...fields.map((f) => f.valid + f.invalid));
}

function pickEp(rng: Rng): EpField[] {
  return rng.sample(EP_FIELDS, 3).map((field) => ({ field, valid: rng.int(1, 4), invalid: rng.int(1, 3) }));
}

export function allPairs(counts: number[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < counts.length; i += 1) {
    for (let j = i + 1; j < counts.length; j += 1) {
      for (let a = 0; a < counts[i]; a += 1) for (let b = 0; b < counts[j]; b += 1) pairs.add(`${i}:${a}|${j}:${b}`);
    }
  }
  return pairs;
}

export function coveredPairs(tests: number[][]): Set<string> {
  const pairs = new Set<string>();
  for (const t of tests) for (let i = 0; i < t.length; i += 1) for (let j = i + 1; j < t.length; j += 1) pairs.add(`${i}:${t[i]}|${j}:${t[j]}`);
  return pairs;
}

export function minimalFeatureCover(tests: SeniorTest[], features: number): number {
  for (let k = 1; k <= tests.length; k += 1) {
    const pick = (start: number, chosen: number[]): boolean => {
      if (chosen.length === k) return new Set(chosen.flatMap((i) => tests[i].features)).size === features;
      for (let i = start; i < tests.length; i += 1) if (pick(i + 1, [...chosen, i])) return true;
      return false;
    };
    if (pick(0, [])) return k;
  }
  return tests.length;
}

/** Порядок по убыванию «риск / длительность»; сравнение через перекрёстное умножение без деления. */
export function riskOrder(tests: SeniorTest[]): number[] {
  return tests.map((_, i) => i).sort((a, b) => tests[b].risk * tests[a].duration - tests[a].risk * tests[b].duration || a - b);
}

export function runWithinBudget(tests: SeniorTest[], budget: number): { taken: number[]; risk: number } {
  let spent = 0;
  const taken: number[] = [];
  for (const i of riskOrder(tests)) {
    if (spent + tests[i].duration <= budget) {
      spent += tests[i].duration;
      taken.push(i);
    }
  }
  return { taken, risk: taken.reduce((sum, i) => sum + tests[i].risk, 0) };
}

function pickParams(rng: Rng, count: number): PickedParam[] {
  return rng.sample(PARAMS.map((_, i) => i), count).map((param) => ({ param, values: rng.sample(PARAMS[param].values, rng.int(2, Math.min(4, PARAMS[param].values.length))) }));
}

export const minimalSuiteFamily: FamilyDefinition<Params> = {
  id: 'qa.minimal-suite',
  // v2: ответ на вопрос о классах эквивалентности — действительно наименьшее число тестов (v1 давала верхнюю оценку).
  version: 2,
  specialization: 'MANUAL_QA',
  group: 'QA_TEST_DESIGN',
  title: 'Минимально достаточный набор проверок',
  description: 'Число комбинаций, покрытие пар значений и классов эквивалентности, минимальный набор по функциям и приоритизация по риску.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['test-design', 'test-prioritization', 'boundary-testing'],
  gradeNotes: {
    JUNIOR: 'Полный перебор, покрытие каждого значения (классов эквивалентности), выбор техники сокращения.',
    MIDDLE: 'Попарное покрытие: непокрытые пары, нижняя оценка набора, лучший тест; классы эквивалентности с одним недопустимым значением на тест.',
    SENIOR: 'Минимальный набор для покрытия функций, порядок запуска по риску за минуту, ограничение по времени; классы эквивалентности.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    if (grade === 'JUNIOR') return { variant: 'full', picked: pickParams(rng, rng.int(3, 4)) };
    if (grade === 'MIDDLE') {
      for (let guard = 0; guard < 1000; guard += 1) {
        const picked = pickParams(rng, 3);
        const counts = picked.map((p) => p.values.length);
        const randomTest = () => counts.map((c) => rng.int(0, c - 1));
        const suite = Array.from({ length: rng.int(4, 6) }, randomTest);
        const covered = coveredPairs(suite);
        const candidates = Array.from({ length: 4 }, randomTest);
        const gains = candidates.map((c) => [...coveredPairs([c])].filter((pair) => !covered.has(pair)).length);
        const best = Math.max(...gains);
        const uncovered = allPairs(counts).size - covered.size;
        if (gains.filter((g) => g === best).length === 1 && best >= 2 && uncovered >= 4 && new Set(candidates.map((c) => c.join(','))).size === 4) {
          return { variant: 'pairs', picked, suite, candidates, ep: pickEp(rng) };
        }
      }
      throw new Error('qa.minimal-suite: генерация (Middle) не удалась');
    }
    for (let guard = 0; guard < 3000; guard += 1) {
      const count = 6;
      const tests: SeniorTest[] = Array.from({ length: count }, () => ({ duration: rng.pick([5, 10, 15, 20, 30]), risk: rng.int(1, 9), features: rng.sample([0, 1, 2, 3, 4], rng.int(1, 3)).sort((a, b) => a - b) }));
      if (new Set(tests.flatMap((t) => t.features)).size !== 5) continue;
      const ratios = tests.map((t) => t.risk / t.duration);
      if (new Set(ratios.map((r) => r.toFixed(6))).size !== count) continue;
      const budget = rng.pick([30, 40, 50, 60]);
      const run = runWithinBudget(tests, budget);
      const cover = minimalFeatureCover(tests, 5);
      // Интересно, когда жадный порядок пропускает хотя бы один тест, но берёт более поздние.
      const order = riskOrder(tests);
      const skippedThenTaken = order.some((i, pos) => !run.taken.includes(i) && order.slice(pos + 1).some((j) => run.taken.includes(j)));
      if (cover >= 2 && cover <= 4 && skippedThenTaken && run.taken.length >= 2) return { variant: 'risk', tests, features: FEATURES, budget, ep: pickEp(rng) };
    }
    throw new Error('qa.minimal-suite: генерация (Senior) не удалась');
  },
  complexity(params) {
    return (params.picked?.length ?? 0) * 2 + (params.suite?.length ?? 0) + (params.tests?.length ?? 0);
  },
  build(params) {
    const parts: AuthoredPart[] = [];
    const epPart = (id: string, ep: EpField[]): AuthoredPart => ({
      id,
      format: 'NUMERIC',
      prompt: 'Каждый тест должен содержать не более одного недопустимого значения, допустимые классы разных полей можно объединять в одном тесте. Какое наименьшее число тестов покрывает все классы эквивалентности всех полей?',
      correct: minimalEquivalenceTests(ep),
      tolerance: 0,
      integer: true,
      skillTags: ['boundary-testing', 'test-design'],
    });
    const epTable = (ep: EpField[]) => table(['Поле формы', 'Допустимых классов', 'Недопустимых классов'], ep.map((f) => [f.field, f.valid, f.invalid]));
    if (params.variant === 'risk') {
      const tests = params.tests!;
      const run = runWithinBudget(tests, params.budget!);
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Какое наименьшее число тестов покрывает все пять функций?', correct: minimalFeatureCover(tests, 5), tolerance: 0, integer: true, skillTags: ['test-design', 'test-prioritization'] });
      parts.push({ id: 'p2', format: 'ORDERING', prompt: 'Расположите тесты в порядке запуска: по убыванию отношения «риск / длительность».', items: tests.map((t, i) => opt(`t${i}`, `T${i + 1} (риск ${t.risk}, ${t.duration} мин)`)), correct: riskOrder(tests).map((i) => `t${i}`), skillTags: ['test-prioritization'] });
      parts.push({ id: 'p3', format: 'NUMERIC', prompt: `Тесты запускаются в этом порядке, пока позволяет лимит ${params.budget} минут: тест, который не помещается в остаток времени, пропускается, и берётся следующий. Какой суммарный риск будет покрыт?`, correct: run.risk, tolerance: 0, integer: true, skillTags: ['test-prioritization', 'test-design'] });
      parts.push(epPart('p4', params.ep!));
      return {
        title: 'Минимальный набор и приоритеты',
        context: [text('Регрессионные тесты и функции, которые они проверяют:'), table(['Тест', 'Длительность, мин', 'Риск (1–9)', 'Функции'], tests.map((t, i) => [`T${i + 1}`, t.duration, t.risk, t.features.map((f) => FEATURES[f]).join(', ')])), text('Для формы оформления заказа определены классы эквивалентности полей:'), epTable(params.ep!)],
        parts,
      };
    }
    const picked = params.picked!;
    const counts = picked.map((p) => p.values.length);
    const names = picked.map((p) => PARAMS[p.param].name);
    const paramTable = table(['Параметр', 'Значения'], picked.map((p) => [PARAMS[p.param].name, p.values.join(', ')]));
    if (params.variant === 'full') {
      const product = counts.reduce((a, b) => a * b, 1);
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Сколько всего комбинаций значений параметров?', correct: product, tolerance: 0, integer: true, skillTags: ['test-design'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Какое наименьшее число тестов нужно, чтобы каждое значение каждого параметра встретилось хотя бы один раз?', correct: Math.max(...counts), tolerance: 0, integer: true, skillTags: ['boundary-testing', 'test-design'] });
      parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: 'Какую технику применить, чтобы сократить число комбинаций, сохранив проверку взаимодействия любых двух параметров?', options: [opt('pairwise', 'Попарное тестирование (pairwise)'), opt('random', 'Случайный выбор комбинаций'), opt('single', 'Проверять только комбинации по умолчанию'), opt('boundary', 'Анализ граничных значений каждого параметра')], correct: 'pairwise', skillTags: ['test-design', 'test-prioritization'] });
      return { title: 'Комбинации параметров', context: [text('Форма заказа проверяется на нескольких конфигурациях.'), paramTable], parts };
    }
    const suite = params.suite!;
    const candidates = params.candidates!;
    const covered = coveredPairs(suite);
    const total = allPairs(counts).size;
    const sorted = [...counts].sort((a, b) => b - a);
    const gains = candidates.map((c) => [...coveredPairs([c])].filter((pair) => !covered.has(pair)).length);
    const describe = (t: number[]) => t.map((v, i) => picked[i].values[v]).join(' · ');
    parts.push({ id: 'p1', format: 'NUMERIC', prompt: `Сколько пар значений разных параметров остаются непокрытыми текущим набором из ${suite.length} тестов?`, correct: total - covered.size, tolerance: 0, integer: true, skillTags: ['test-design', 'test-prioritization'] });
    parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Каково нижнее ограничение числа тестов в полном попарном наборе (произведение количества значений двух самых «больших» параметров)?', correct: sorted[0] * sorted[1], tolerance: 0, integer: true, skillTags: ['test-design'] });
    parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: 'Какой из кандидатов добавит больше всего новых непокрытых пар?', options: candidates.map((c, i) => opt(`c${i}`, describe(c))), correct: `c${gains.indexOf(Math.max(...gains))}`, skillTags: ['test-design', 'test-prioritization'] });
    parts.push(epPart('p4', params.ep!));
    return {
      title: 'Попарное покрытие',
      context: [text(`Параметры: ${names.join(', ')}. Всего пар значений разных параметров: ${total}.`), paramTable, table(['Тест', ...names], suite.map((t, i) => [`№${i + 1}`, ...t.map((v, k) => picked[k].values[v])]), 'Текущий набор'), text('Отдельно: для формы регистрации определены классы эквивалентности полей:'), epTable(params.ep!)],
      parts,
    };
  },
};
