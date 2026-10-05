import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { list, opt, table, text } from '../helpers';

/**
 * Q3. Граничные значения и классы эквивалентности.
 * Junior — перевод словесных границ («больше», «не менее») в допустимый интервал; двухзначный анализ границ.
 * Middle — тарифные диапазоны: число уникальных значений трёхзначного анализа, ожидаемый результат на границе.
 * Senior — десятичная точность, период с включёнными датами, число тестов robust BVA для нескольких полей.
 */

const FIELDS = [
  { name: 'возраст клиента', unit: 'лет' },
  { name: 'количество товаров в корзине', unit: 'шт.' },
  { name: 'длина пароля', unit: 'символов' },
  { name: 'срок вклада', unit: 'месяцев' },
  { name: 'количество гостей в бронировании', unit: 'человек' },
];

interface Params {
  variant: 'words' | 'tiers' | 'decimal';
  field: number;
  lower?: { kind: 'ge' | 'gt'; value: number };
  upper?: { kind: 'le' | 'lt'; value: number };
  askValue?: number;
  tiers?: Array<{ from: number; to: number; price: number }>;
  askBoundary?: number;
  decimals?: 1 | 2;
  max?: number;
  min?: number;
  startDate?: string;
  days?: number;
  fields?: number;
}

const fmtDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

export function validRange(p: Pick<Params, 'lower' | 'upper'>): { min: number; max: number } {
  return { min: p.lower!.kind === 'ge' ? p.lower!.value : p.lower!.value + 1, max: p.upper!.kind === 'le' ? p.upper!.value : p.upper!.value - 1 };
}

export function threeValueBoundaries(classes: Array<{ from: number; to: number }>): number[] {
  const set = new Set<number>();
  for (const c of classes) [c.from - 1, c.from, c.from + 1, c.to - 1, c.to, c.to + 1].forEach((v) => set.add(v));
  return [...set].sort((a, b) => a - b);
}

export function twoValueBoundaries(classes: Array<{ from: number; to: number }>): number[] {
  const set = new Set<number>();
  for (const c of classes) [c.from - 1, c.from, c.to, c.to + 1].forEach((v) => set.add(v));
  return [...set].sort((a, b) => a - b);
}

const words = (p: Params) =>
  `${p.lower!.kind === 'ge' ? `не менее ${p.lower!.value}` : `строго больше ${p.lower!.value}`}, ${p.upper!.kind === 'le' ? `не более ${p.upper!.value}` : `строго меньше ${p.upper!.value}`}`;

export const boundaryValuesFamily: FamilyDefinition<Params> = {
  id: 'qa.boundary-values',
  version: 1,
  specialization: 'MANUAL_QA',
  group: 'QA_TEST_DESIGN',
  title: 'Граничные значения и классы эквивалентности',
  description: 'Допустимые интервалы по словесным требованиям, наборы граничных значений, точность и периоды.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['boundary-testing', 'test-design'],
  gradeNotes: {
    JUNIOR: 'Перевод «больше / не менее / менее / не более» в допустимый интервал; двухзначный анализ границ.',
    MIDDLE: 'Тарифные диапазоны: число уникальных значений трёхзначного анализа; результат на границе классов.',
    SENIOR: 'Десятичная точность, период с включёнными датами, число тестов robust BVA для нескольких полей.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    const field = rng.int(0, FIELDS.length - 1);
    if (grade === 'JUNIOR') {
      const lowerValue = rng.int(1, 30);
      const lower = { kind: rng.pick(['ge', 'gt'] as const), value: lowerValue };
      const upper = { kind: rng.pick(['le', 'lt'] as const), value: lowerValue + rng.int(10, 60) };
      const p: Params = { variant: 'words', field, lower, upper };
      const range = validRange(p);
      return { ...p, askValue: rng.pick([lower.value, upper.value, range.min, range.max]) };
    }
    if (grade === 'MIDDLE') {
      const count = rng.int(2, 3);
      const tiers: Array<{ from: number; to: number; price: number }> = [];
      let from = 1;
      for (let i = 0; i < count; i += 1) {
        const to = from + rng.int(1, 14);
        tiers.push({ from, to, price: 0 });
        from = to + 1;
      }
      const prices = rng.sample([300, 450, 500, 700, 900, 1200], count).sort((a, b) => a - b);
      tiers.forEach((t, i) => (t.price = prices[i]));
      const boundaries = twoValueBoundaries(tiers);
      return { variant: 'tiers', field, tiers, askBoundary: rng.pick(boundaries) };
    }
    const decimals = rng.pick([1, 2] as const);
    const step = 10 ** -decimals;
    const startDate = fmtDate(new Date(Date.UTC(rng.int(2025, 2026), rng.int(0, 11), rng.int(1, 28))));
    return {
      variant: 'decimal',
      field,
      decimals,
      min: Math.round(rng.int(1, 9) * step * 100) / 100,
      max: rng.pick([30, 150, 1000, 5000]),
      startDate,
      days: rng.pick([7, 14, 30, 31, 45, 90]),
      fields: rng.int(2, 6),
    };
  },
  complexity(params) {
    return (params.tiers?.length ?? 1) * 3 + (params.fields ?? 2);
  },
  build(params) {
    const parts: AuthoredPart[] = [];
    if (params.variant === 'words') {
      const f = FIELDS[params.field];
      const range = validRange(params);
      const candidates = [...new Set([range.min - 1, range.min, range.min + 1, range.max - 1, range.max, range.max + 1, params.lower!.value, params.upper!.value])].sort((a, b) => a - b);
      const verdict = params.askValue! < range.min ? 'low' : params.askValue! > range.max ? 'high' : 'ok';
      parts.push({ id: 'p1', format: 'MULTI_SELECT', prompt: 'Какие значения составляют набор двухзначного анализа границ (для каждой границы — значение на границе допустимого интервала и ближайшее значение из соседнего недопустимого класса)?', options: candidates.map((v) => opt(`v${v}`, String(v))), correct: [range.min - 1, range.min, range.max, range.max + 1].map((v) => `v${v}`), skillTags: ['boundary-testing', 'test-design'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Сколько целых значений входит в допустимый класс эквивалентности?', correct: range.max - range.min + 1, tolerance: 0, integer: true, skillTags: ['boundary-testing'] });
      parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: `Система получила значение ${params.askValue}. Какой результат ожидается?`, options: [opt('ok', 'Значение принято'), opt('low', 'Отклонено: ниже допустимого минимума'), opt('high', 'Отклонено: выше допустимого максимума')], correct: verdict, skillTags: ['boundary-testing', 'test-design'] });
      return {
        title: `Допустимый интервал: ${f.name}`,
        context: [text(`Требование: поле «${f.name}» (${f.unit}) принимает целые числа ${words(params)}.`)],
        parts,
      };
    }
    if (params.variant === 'tiers') {
      const f = FIELDS[params.field];
      const tiers = params.tiers!;
      const two = twoValueBoundaries(tiers);
      const three = threeValueBoundaries(tiers);
      // Внутренние значения классов и далёкие значения вне диапазонов — заведомо не граничные.
      const last = tiers[tiers.length - 1].to;
      const interior = [...tiers.map((t) => Math.floor((t.from + t.to) / 2)), last + 5, last + 12].filter((v) => !two.includes(v));
      const candidates = [...new Set([...two, ...interior])].sort((a, b) => a - b);
      const priceOf = (v: number) => tiers.find((t) => v >= t.from && v <= t.to)?.price ?? null;
      const ask = params.askBoundary!;
      const price = priceOf(ask);
      const priceOptions = [...new Set(tiers.map((t) => t.price))].sort((a, b) => a - b);
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Сколько уникальных значений даёт трёхзначный анализ границ (для каждой границы каждого допустимого диапазона берутся значения на 1 ниже, на самой границе и на 1 выше) по всем допустимым диапазонам вместе?', correct: three.length, tolerance: 0, integer: true, skillTags: ['boundary-testing', 'test-design'] });
      parts.push({ id: 'p2', format: 'MULTI_SELECT', prompt: 'Какие из значений входят в набор двухзначного анализа границ между классами (значение на границе класса и ближайшее значение соседнего класса)?', options: candidates.map((v) => opt(`v${v}`, String(v))), correct: two.map((v) => `v${v}`), skillTags: ['boundary-testing'] });
      parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: `Какой результат ожидается для значения ${ask}?`, options: [...priceOptions.map((p) => opt(`p${p}`, `Тариф ${p} ₽`)), opt('reject', 'Отклонено как недопустимое значение')], correct: price === null ? 'reject' : `p${price}`, skillTags: ['boundary-testing', 'test-design'] });
      return {
        title: `Тарифные диапазоны: ${f.name}`,
        context: [
          text(`Сервис считает стоимость по значению поля «${f.name}» (${f.unit}, целое число, не менее 1). Значения вне диапазонов отклоняются.`),
          table(['Диапазон (включительно)', 'Тариф, ₽'], tiers.map((t) => [`${t.from}–${t.to}`, t.price])),
        ],
        parts,
      };
    }
    const decimals = params.decimals!;
    const step = 10 ** -decimals;
    const fixed = (v: number) => v.toFixed(decimals);
    const max = params.max!;
    const min = params.min!;
    const start = new Date(`${params.startDate!.split('.').reverse().join('-')}T00:00:00Z`);
    const validEnd = addDays(start, params.days! - 1);
    const dateOptions = [addDays(validEnd, -1), validEnd, addDays(validEnd, 1), addDays(validEnd, params.days!)];
    parts.push({ id: 'p1', format: 'SINGLE_CHOICE', prompt: `Какое значение является ближайшим недопустимым значением выше максимума в поле веса груза (допустимо от ${fixed(min)} до ${fixed(max)} кг включительно, не более ${decimals} зн. после запятой)?`, options: [opt('next', `${fixed(max + step)} кг`), opt('plus1', `${fixed(max + 1)} кг`), opt('half', `${fixed(max + step * 5)} кг`), opt('same', `${fixed(max)} кг`)], correct: 'next', skillTags: ['boundary-testing'] });
    parts.push({ id: 'p2', format: 'SINGLE_CHOICE', prompt: `Отчёт можно строить за период не более ${params.days} дней, обе граничные даты включаются. Начало периода — ${params.startDate}. Какая дата является последней допустимой датой окончания?`, options: dateOptions.map((d) => opt(`d${fmtDate(d)}`, fmtDate(d))), correct: `d${fmtDate(validEnd)}`, skillTags: ['boundary-testing', 'test-design'] });
    parts.push({ id: 'p3', format: 'NUMERIC', prompt: `Сколько тестов в наборе robust boundary value analysis для формы с ${params.fields} независимыми числовыми полями (по одной границе за раз, остальные поля — номинальные значения)? Для каждого поля берутся min−1, min, min+1, max−1, max, max+1, плюс один общий тест из номинальных значений.`, correct: 6 * params.fields! + 1, tolerance: 0, integer: true, skillTags: ['boundary-testing', 'test-design'] });
    return {
      title: 'Точность, периоды и несколько полей',
      context: [text('Форма построения отчёта о грузоперевозках содержит поле веса и поля периода.'), list([`вес — число с точностью до ${decimals} знака(ов) после запятой, допустимо ${fixed(min)}–${fixed(max)} кг включительно;`, 'период — две даты; длина периода считается с учётом обеих дат.'])],
      parts,
    };
  },
};
