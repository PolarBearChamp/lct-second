import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, list, opt, table, text } from '../helpers';

/**
 * M5. Схемы валидации и подсчёт обучений.
 * Junior — размер train в k-fold, число обучений в GridSearchCV, выбор разбиения под тип данных.
 * Middle — TimeSeriesSplit (расширяющееся окно): размеры train/test по фолдам; разбиение без утечки во времени.
 * Senior — вложенная кросс-валидация: число обучений и смысл внешнего цикла; корректность утверждений о валидации.
 * Размеры вычисляются по формулам scikit-learn (test_size = n // (n_splits + 1)).
 */

interface Params {
  scenario: number;
  n?: number;
  k?: number;
  grid?: number[];
  innerK?: number;
  outerK?: number;
  innerGrid?: number;
  statements?: string[];
  fold?: number;
}

const SPLIT_SCENARIOS = [
  { text: 'классификация редкого дефолта (2% положительных), строки независимы', answer: 'stratified' },
  { text: 'прогноз спроса на следующую неделю по недельным данным за три года', answer: 'time' },
  { text: 'несколько снимков одного пациента в данных; нужно оценить качество на новых пациентах', answer: 'group' },
  { text: 'регрессия цены квартиры, независимые наблюдения, классы отсутствуют', answer: 'kfold' },
];

const STATEMENTS = [
  { key: 'tune-test', label: 'Гиперпараметры подобраны по результатам на test, затем по тому же test сообщена итоговая оценка — оценка честная', valid: false },
  { key: 'nested', label: 'Для честной оценки с подбором гиперпараметров используют вложенную кросс-валидацию', valid: true },
  { key: 'scale-cv', label: 'Масштабирование внутри Pipeline пересчитывается на обучающей части каждого фолда', valid: true },
  { key: 'shuffle-time', label: 'Для временного ряда допустимо случайно перемешать строки перед KFold', valid: false },
  { key: 'holdout', label: 'Финальный отложенный набор используется один раз после выбора модели', valid: true },
  { key: 'stratify', label: 'StratifiedKFold сохраняет долю классов в каждом фолде', valid: true },
  { key: 'peek', label: 'Если качество на test не устроило, допустимо многократно менять модель и смотреть на тот же test', valid: false },
];

/** TimeSeriesSplit(n_splits=k): test_size = n // (k + 1); тест фолда i идёт после его train. */
export function timeSeriesFolds(n: number, k: number): Array<{ train: number; testStart: number; testSize: number }> {
  const testSize = Math.floor(n / (k + 1));
  const first = n - k * testSize;
  return Array.from({ length: k }, (_, i) => ({ train: first + i * testSize, testStart: first + i * testSize, testSize }));
}

export const validationSchemesFamily: FamilyDefinition<Params> = {
  id: 'ml.validation-schemes',
  version: 1,
  specialization: 'ML_ENGINEER',
  group: 'ML_VALIDATION',
  title: 'Схемы валидации и подсчёт обучений',
  description: 'k-fold, GridSearchCV, TimeSeriesSplit, вложенная кросс-валидация и корректность выводов о качестве.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['model-validation', 'scikit-learn'],
  gradeNotes: {
    JUNIOR: 'Размер train в k-fold, число обучений в GridSearchCV, выбор разбиения под тип данных.',
    MIDDLE: 'TimeSeriesSplit: размеры train и test по фолдам; разбиение без утечки из будущего.',
    SENIOR: 'Вложенная кросс-валидация: число обучений, роль внешнего цикла; проверка утверждений о валидации.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    const scenario = rng.int(0, SPLIT_SCENARIOS.length - 1);
    if (grade === 'JUNIOR') {
      const k = rng.pick([4, 5, 10]);
      return { scenario, k, n: k * rng.int(20, 60), grid: [rng.int(2, 4), rng.int(2, 5)] };
    }
    if (grade === 'MIDDLE') {
      const k = rng.pick([3, 4, 5]);
      return { scenario, k, n: (k + 1) * rng.int(8, 20) + rng.int(0, k), fold: rng.int(1, k) };
    }
    let statements: string[];
    do statements = rng.sample(STATEMENTS.map((s) => s.key), 5);
    while (!statements.some((k) => STATEMENTS.find((s) => s.key === k)!.valid) || statements.every((k) => STATEMENTS.find((s) => s.key === k)!.valid));
    return { scenario, outerK: rng.pick([3, 5]), innerK: rng.pick([3, 4, 5]), innerGrid: rng.pick([6, 8, 12]), statements: statements.sort() };
  },
  complexity(params) {
    return (params.k ?? params.outerK ?? 3) + (params.grid?.length ?? 1) + (params.statements?.length ?? 0);
  },
  build(params, grade) {
    const scenario = SPLIT_SCENARIOS[params.scenario];
    const parts: AuthoredPart[] = [];
    const splitterPart = (id: string): AuthoredPart => ({
      id,
      format: 'SINGLE_CHOICE',
      prompt: `Какое разбиение выбрать для случая: ${scenario.text}?`,
      options: [opt('stratified', 'StratifiedKFold'), opt('time', 'TimeSeriesSplit'), opt('group', 'GroupKFold по идентификатору пациента/клиента'), opt('kfold', 'Обычный KFold')],
      correct: scenario.answer,
      skillTags: ['model-validation', 'scikit-learn'],
    });
    if (grade === 'JUNIOR') {
      const { k, n, grid } = params as Required<Params>;
      const fits = grid[0] * grid[1] * k + 1;
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: `Сколько объектов будет в обучающей части одного фолда при KFold(n_splits=${k}) на ${n} объектах?`, correct: (n * (k - 1)) / k, tolerance: 0, integer: true, skillTags: ['model-validation', 'scikit-learn'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Сколько раз всего будет обучена модель при выполнении fit у GridSearchCV (с refit=True)?', correct: fits, tolerance: 0, integer: true, skillTags: ['scikit-learn', 'model-validation'] });
      parts.push(splitterPart('p3'));
      return {
        title: 'k-fold и GridSearchCV',
        context: [
          code('python', `grid = {\n    "n_estimators": [${Array.from({ length: grid[0] }, (_, i) => 100 * (i + 1)).join(', ')}],\n    "max_depth": [${Array.from({ length: grid[1] }, (_, i) => 3 + 2 * i).join(', ')}],\n}\nsearch = GridSearchCV(RandomForestClassifier(), grid, cv=${k}, refit=True)\nsearch.fit(X, y)  # X: ${n} объектов`),
        ],
        parts,
      };
    }
    if (grade === 'MIDDLE') {
      const { k, n, fold } = params as Required<Params>;
      const folds = timeSeriesFolds(n, k);
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: `Сколько объектов в тестовой части каждого фолда TimeSeriesSplit(n_splits=${k}) на ${n} объектах?`, correct: folds[0].testSize, tolerance: 0, integer: true, skillTags: ['model-validation', 'scikit-learn'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: `Сколько объектов в обучающей части фолда №${fold}?`, correct: folds[fold - 1].train, tolerance: 0, integer: true, skillTags: ['model-validation'] });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: 'Чем TimeSeriesSplit отличается от KFold с перемешиванием для временных данных?',
        options: [opt('past', 'Обучающая часть каждого фолда содержит только объекты, предшествующие тестовой'), opt('equal', 'Все фолды имеют одинаковый размер обучающей части'), opt('random', 'Объекты перемешиваются внутри блоков для устойчивости'), opt('gap', 'Между train и test всегда оставляется месяц')],
        correct: 'past',
        skillTags: ['model-validation', 'scikit-learn'],
      });
      parts.push(splitterPart('p4'));
      return {
        title: 'TimeSeriesSplit: размеры фолдов',
        context: [text('Данные упорядочены по времени. Используется TimeSeriesSplit без параметров max_train_size и gap.'), code('python', `tscv = TimeSeriesSplit(n_splits=${k})\nfor train_idx, test_idx in tscv.split(X):  # X: ${n} объектов\n    ...`)],
        parts,
      };
    }
    const { outerK, innerK, innerGrid } = params as Required<Params>;
    const statements = params.statements!.map((key) => STATEMENTS.find((s) => s.key === key)!);
    parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Сколько раз всего будет обучена модель (во внутренних циклах и финальные переобучения лучшего варианта на внешнем обучающем наборе)?', correct: outerK * (innerK * innerGrid + 1), tolerance: 0, integer: true, skillTags: ['model-validation', 'scikit-learn'] });
    parts.push({
      id: 'p2',
      format: 'SINGLE_CHOICE',
      prompt: 'Зачем нужен внешний цикл вложенной кросс-валидации?',
      options: [opt('honest', 'Чтобы оценка качества не использовала данные, по которым подбирались гиперпараметры'), opt('speed', 'Чтобы ускорить подбор гиперпараметров'), opt('more-data', 'Чтобы увеличить размер обучающей выборки'), opt('variance', 'Чтобы уменьшить число моделей в сетке')],
      correct: 'honest',
      skillTags: ['model-validation'],
    });
    parts.push({
      id: 'p3',
      format: 'MULTI_SELECT',
      prompt: 'Какие утверждения о валидации верны?',
      options: statements.map((s) => opt(s.key, s.label)),
      correct: statements.filter((s) => s.valid).map((s) => s.key),
      skillTags: ['model-validation', 'scikit-learn'],
    });
    return {
      title: 'Вложенная кросс-валидация',
      context: [
        text('Схема оценки модели:'),
        list([`внешний цикл — ${outerK} фолдов;`, `во внутреннем цикле для каждого внешнего обучающего набора запускается GridSearchCV: сетка из ${innerGrid} вариантов, ${innerK} фолдов, refit=True;`, 'число обучений считается для всей процедуры целиком.']),
        table(['Параметр', 'Значение'], [['Внешних фолдов', outerK], ['Внутренних фолдов', innerK], ['Вариантов в сетке', innerGrid]]),
      ],
      parts,
    };
  },
};
