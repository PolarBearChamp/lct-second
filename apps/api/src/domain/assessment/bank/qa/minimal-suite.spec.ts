import { minimalEquivalenceTests } from './minimal-suite';

type Field = { field: string; valid: number; invalid: number };

/**
 * Независимая проверка «наименьшего числа тестов» полным перебором (поиск покрытия с итеративным углублением),
 * а не той же формулой. Тест — выбор одного класса в каждом поле, не более одного недопустимого.
 */
function bruteForceMinimum(fields: Field[]): number {
  type Cls = { f: number; kind: 'v' | 'i'; n: number };
  const options: Cls[][] = fields.map((field, f) => [
    ...Array.from({ length: field.valid }, (_, n) => ({ f, kind: 'v' as const, n })),
    ...Array.from({ length: field.invalid }, (_, n) => ({ f, kind: 'i' as const, n })),
  ]);
  const key = (c: Cls) => `${c.f}${c.kind}${c.n}`;
  const allClasses = options.flat().map(key);

  const tests: string[][] = [];
  const build = (f: number, picked: Cls[], invalidCount: number) => {
    if (f === fields.length) return void tests.push(picked.map(key));
    for (const option of options[f]) {
      const nextInvalid = invalidCount + (option.kind === 'i' ? 1 : 0);
      if (nextInvalid <= 1) build(f + 1, [...picked, option], nextInvalid);
    }
  };
  build(0, [], 0);

  const maxCover = fields.length;
  for (let limit = 1; limit <= allClasses.length; limit += 1) {
    const search = (covered: Set<string>, used: number): boolean => {
      const uncovered = allClasses.filter((c) => !covered.has(c));
      if (uncovered.length === 0) return true;
      if (used >= limit || used + Math.ceil(uncovered.length / maxCover) > limit) return false;
      const target = uncovered[0];
      for (const test of tests.filter((t) => t.includes(target))) {
        if (search(new Set([...covered, ...test]), used + 1)) return true;
      }
      return false;
    };
    if (search(new Set(), 0)) return limit;
  }
  throw new Error('нет покрытия');
}

describe('qa.minimal-suite: наименьшее число тестов для классов эквивалентности', () => {
  const cases: Field[][] = [
    [{ field: 'A', valid: 4, invalid: 1 }, { field: 'B', valid: 1, invalid: 1 }],
    [{ field: 'A', valid: 2, invalid: 2 }, { field: 'B', valid: 4, invalid: 3 }, { field: 'C', valid: 1, invalid: 3 }], // пример из контрольного экземпляра (ответ 8)
    [{ field: 'A', valid: 1, invalid: 1 }, { field: 'B', valid: 4, invalid: 1 }, { field: 'C', valid: 4, invalid: 3 }], // пример из контрольного экземпляра (ответ 7)
    [{ field: 'A', valid: 1, invalid: 1 }, { field: 'B', valid: 1, invalid: 1 }],
    [{ field: 'A', valid: 3, invalid: 2 }, { field: 'B', valid: 3, invalid: 2 }],
    [{ field: 'A', valid: 2, invalid: 1 }, { field: 'B', valid: 2, invalid: 1 }, { field: 'C', valid: 2, invalid: 1 }],
    [{ field: 'A', valid: 3, invalid: 1 }, { field: 'B', valid: 1, invalid: 2 }, { field: 'C', valid: 2, invalid: 2 }],
    [{ field: 'A', valid: 4, invalid: 2 }, { field: 'B', valid: 1, invalid: 1 }, { field: 'C', valid: 2, invalid: 1 }],
  ];

  it.each(cases.map((fields) => [fields.map((f) => `${f.valid}/${f.invalid}`).join(' · '), fields] as const))('поля (допустимых/недопустимых) %s', (_name, fields) => {
    expect(minimalEquivalenceTests(fields)).toBe(bruteForceMinimum(fields));
  });

  it('формула «максимум допустимых + все недопустимые» (версия 1) — верхняя оценка, не минимум', () => {
    const fields: Field[] = [{ field: 'A', valid: 2, invalid: 2 }, { field: 'B', valid: 4, invalid: 3 }, { field: 'C', valid: 1, invalid: 3 }];
    const v1 = Math.max(...fields.map((f) => f.valid)) + fields.reduce((s, f) => s + f.invalid, 0);
    expect(v1).toBe(12);
    expect(minimalEquivalenceTests(fields)).toBe(8);
  });
});
