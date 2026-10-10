import { createRng } from './rng';
import { agreement, cohensKappa, confusionMatrix, discriminationIndex, knowsProbability, normalSample, pearson } from './grading-stats';

describe('матрица сопряжённости и согласие', () => {
  it('считает пары и долю совпадений', () => {
    const matrix = confusionMatrix([[0, 0], [1, 1], [1, 2], [2, 2]], 3);
    expect(matrix).toEqual([[1, 0, 0], [0, 1, 1], [0, 0, 1]]);
    expect(agreement(matrix)).toBeCloseTo(0.75, 10);
    expect(agreement(confusionMatrix([], 3))).toBe(0);
  });
});

describe('каппа Коэна', () => {
  it('полное согласие — 1, независимые оценки — около 0', () => {
    expect(cohensKappa([[10, 0], [0, 10]], false)).toBeCloseTo(1, 10);
    expect(cohensKappa([[5, 5], [5, 5]], false)).toBeCloseTo(0, 10);
  });

  it('совпадает с ручным расчётом: 2 × 2, наблюдаемое 0,7, ожидаемое 0,5 → 0,4', () => {
    // 50 объектов: оба «да» 20, оба «нет» 15, расхождения 10 + 5; p_o = 0,7; p_e = 0,6·0,5 + 0,4·0,5 = 0,5.
    expect(cohensKappa([[20, 5], [10, 15]], false)).toBeCloseTo(0.4, 10);
  });

  it('взвешенная каппа штрафует далёкие расхождения сильнее ближних', () => {
    const near = [[10, 2, 0], [2, 10, 2], [0, 2, 10]];
    const far = [[10, 0, 2], [2, 10, 2], [2, 0, 10]];
    expect(cohensKappa(near, true)!).toBeGreaterThan(cohensKappa(far, true)!);
    // Без весов эти матрицы равноценны по числу расхождений.
    expect(cohensKappa(near, false)!).toBeCloseTo(cohensKappa(far, false)!, 1);
  });

  it('не определена, если все оценки одинаковы или данных нет', () => {
    expect(cohensKappa([[10, 0], [0, 0]], false)).toBeNull();
    expect(cohensKappa([[0, 0], [0, 0]], false)).toBeNull();
  });
});

describe('корреляция и индекс различения', () => {
  it('корреляция Пирсона на ручных примерах', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });

  it('D = среднее верхней группы − среднее нижней; без разброса по заданию — 0', () => {
    const rest = Array.from({ length: 100 }, (_, i) => i);
    expect(discriminationIndex(rest, rest.map((r) => (r >= 50 ? 1 : 0)))).toBeCloseTo(1, 10);
    expect(discriminationIndex(rest, rest.map(() => 0.5))).toBeCloseTo(0, 10);
    expect(discriminationIndex(rest, rest.map((r) => (r < 50 ? 1 : 0)))).toBeCloseTo(-1, 10);
  });

  it('при малом числе попыток не считается', () => {
    expect(discriminationIndex([1, 2, 3, 4, 5, 6, 7, 8], [0, 0, 0, 0, 1, 1, 1, 1])).toBeNull();
  });
});

describe('модель способности', () => {
  it('вероятность знать часть: 0,5 при равенстве способности и трудности, монотонна по способности', () => {
    expect(knowsProbability(0, 0)).toBeCloseTo(0.5, 10);
    expect(knowsProbability(1, 0)).toBeGreaterThan(knowsProbability(0, 0));
    expect(knowsProbability(0, 1)).toBeLessThan(knowsProbability(0, 0));
    expect(knowsProbability(1.29, 0)).toBeCloseTo(0.9, 1);
  });

  it('нормальные значения детерминированы по seed и имеют среднее около 0, sd около 1', () => {
    const sample = (seed: string) => {
      const rng = createRng(seed);
      return Array.from({ length: 4000 }, () => normalSample(rng));
    };
    const a = sample('theta-test');
    expect(sample('theta-test')).toEqual(a);
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / (a.length - 1));
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(sd).toBeGreaterThan(0.93);
    expect(sd).toBeLessThan(1.07);
  });
});
