/**
 * Статистика для проверки определения грейда (см. scripts/validation/grading.ts): согласованность присвоенных грейдов при
 * повторном прохождении (каппа Коэна), точность присвоения и разделяющая сила заданий. Чистые функции без обращения к БД.
 */
import type { Rng } from './types';

/** Матрица сопряжённости k × k по парам (строка, столбец) — индексы категорий от 0 до k − 1. */
export function confusionMatrix(pairs: ReadonlyArray<readonly [number, number]>, k: number): number[][] {
  const matrix = Array.from({ length: k }, () => Array<number>(k).fill(0));
  for (const [row, column] of pairs) matrix[row][column] += 1;
  return matrix;
}

/** Доля совпадений (диагональ матрицы). */
export function agreement(matrix: number[][]): number {
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return matrix.reduce((sum, row, i) => sum + row[i], 0) / total;
}

/**
 * Каппа Коэна. linear = true — взвешенная (линейные веса: чем дальше друг от друга грейды, тем больше штраф),
 * иначе обычная. 1 — полное согласие, 0 — как при независимых оценках. Если по строкам и столбцам нет разброса
 * (все оценки одинаковы), каппа не определена — возвращается null.
 */
export function cohensKappa(matrix: number[][], linear: boolean): number | null {
  const k = matrix.length;
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  if (total === 0 || k < 2) return null;
  const rows = matrix.map((row) => row.reduce((a, b) => a + b, 0) / total);
  const columns = matrix[0].map((_, j) => matrix.reduce((sum, row) => sum + row[j], 0) / total);
  const weight = (i: number, j: number) => (linear ? 1 - Math.abs(i - j) / (k - 1) : i === j ? 1 : 0);
  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      observed += weight(i, j) * (matrix[i][j] / total);
      expected += weight(i, j) * rows[i] * columns[j];
    }
  }
  if (1 - expected < 1e-12) return null;
  return (observed - expected) / (1 - expected);
}

/** Коэффициент корреляции Пирсона; null, если у одной из величин нет разброса. */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 3 || n !== y.length) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx < 1e-12 || syy < 1e-12) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Индекс различения D = среднее по верхней группе − среднее по нижней группе (по умолчанию 27 % попыток с лучшим и
 * худшим итогом без этого задания). Значения 0.4 и выше — отличное задание, 0.2–0.4 — приемлемое, ниже 0.2 — слабо
 * разделяет сильных и слабых (классическая шкала Эбеля). null — если попыток слишком мало.
 */
export function discriminationIndex(restScores: readonly number[], itemScores: readonly number[], fraction = 0.27): number | null {
  const n = restScores.length;
  const group = Math.floor(n * fraction);
  if (group < 5 || n !== itemScores.length) return null;
  const order = restScores.map((rest, index) => ({ rest, index })).sort((a, b) => a.rest - b.rest || a.index - b.index);
  const mean = (items: typeof order) => items.reduce((sum, { index }) => sum + itemScores[index], 0) / items.length;
  return mean(order.slice(n - group)) - mean(order.slice(0, group));
}

/** Логистическая функция с масштабом 1.7 (приближение нормальной огивы): вероятность знать часть задания при способности theta. */
export const knowsProbability = (theta: number, difficulty: number): number => 1 / (1 + Math.exp(-1.7 * (theta - difficulty)));

/** Стандартное нормальное значение (Бокса — Мюллера) из детерминированного генератора. */
export function normalSample(rng: Rng): number {
  const u1 = 1 - rng.next();
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
