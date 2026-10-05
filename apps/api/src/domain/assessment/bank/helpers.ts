import type { AuthoredOption, ContentBlock, Rng } from '../types';

export const opt = (key: string, label: string): AuthoredOption => ({ key, label });

export const text = (value: string): ContentBlock => ({ type: 'text', text: value });
export const code = (language: string, value: string): ContentBlock => ({ type: 'code', language, code: value });
export const list = (items: string[]): ContentBlock => ({ type: 'list', items });
export const table = (columns: string[], rows: Array<Array<string | number | null>>, caption?: string): ContentBlock => ({
  type: 'table',
  columns,
  rows,
  caption,
});

/** Числовые варианты для SINGLE_CHOICE: правильный + правдоподобные отвлекающие, без дублей. */
export function numericOptions(correct: number, distractors: number[], format: (n: number) => string = String): {
  options: AuthoredOption[];
  correctKey: string;
} {
  const values = [correct, ...distractors.filter((d) => d !== correct)];
  const unique = [...new Set(values)];
  return {
    options: unique.map((value) => opt(`v${value}`, format(value))),
    correctKey: `v${correct}`,
  };
}

/** Дополняет список отвлекающих чисел до нужного количества уникальными значениями. */
export function fillDistractors(rng: Rng, correct: number, base: number[], count: number, min = 0, max = correct + 10): number[] {
  const result = [...new Set(base.filter((n) => n !== correct && n >= min))];
  let guard = 0;
  while (result.length < count && guard < 200) {
    const candidate = rng.int(min, Math.max(min + 1, max));
    if (candidate !== correct && !result.includes(candidate)) result.push(candidate);
    guard += 1;
  }
  return result.slice(0, count);
}

export const pct = (value: number) => `${value}%`;

export const rub = (value: number) => `${value.toLocaleString('ru-RU')} ₽`;

/** Округление до заданного числа знаков (для числовых ответов с допуском). */
export const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function letters(count: number): string[] {
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, count).split('');
}
