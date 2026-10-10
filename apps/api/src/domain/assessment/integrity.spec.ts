import { INTEGRITY_POLICY } from '../../config/policies';
import { EMPTY_COUNTERS, evaluateIntegrity, fastCorrectItems, type IntegrityInput } from './integrity';

const MIN = 60_000;
const START = Date.parse('2026-10-09T10:00:00Z');

/** Обычное прохождение: 6 кейсов, по 3 минуты на каждый, завершение за 20 из 30 минут, без особых действий. */
const normal = (overrides: Partial<IntegrityInput> = {}): IntegrityInput => ({
  kind: 'SUBMIT',
  startedAtMs: START,
  durationMs: 30 * MIN,
  elapsedMs: 20 * MIN,
  overall: 84,
  passOverall: 75,
  items: Array.from({ length: 6 }, (_, i) => ({ firstSavedAtMs: START + (i + 1) * 3 * MIN, score: i % 2 ? 1 : 0.5 })),
  counters: { ...EMPTY_COUNTERS },
  ...overrides,
});

const codes = (input: IntegrityInput) => evaluateIntegrity(input).signals.map((s) => s.code);

describe('сигналы честности прохождения теста', () => {
  it('обычное прохождение — без сигналов', () => {
    expect(evaluateIntegrity(normal())).toMatchObject({ level: 'NONE', signals: [], version: INTEGRITY_POLICY.version });
  });

  describe('быстрое завершение', () => {
    it('быстрее 20 % времени при результате не ниже проходного — замечание', () => {
      const result = evaluateIntegrity(normal({ elapsedMs: 5 * MIN }));
      expect(result.signals).toEqual([expect.objectContaining({ code: 'FAST_COMPLETION', severity: 'NOTE' })]);
      expect(result.level).toBe('NOTE');
    });

    it('граница: ровно 20 % — ещё не сигнал', () => {
      expect(codes(normal({ elapsedMs: 6 * MIN }))).toEqual([]);
      expect(codes(normal({ elapsedMs: 6 * MIN - 1 }))).toEqual(['FAST_COMPLETION']);
    });

    it('быстро, но с низким результатом (не знал и сдал) — не сигнал; при истечении времени — тоже', () => {
      expect(codes(normal({ elapsedMs: 3 * MIN, overall: 40 }))).toEqual([]);
      expect(codes(normal({ kind: 'EXPIRE', elapsedMs: 3 * MIN }))).toEqual([]);
    });
  });

  describe('быстро решённые кейсы', () => {
    it('считаются только полностью верные ответы, данные быстрее порога после предыдущего сохранения', () => {
      const items = [
        { firstSavedAtMs: START + 10_000, score: 1 }, // 10 с от старта, верно
        { firstSavedAtMs: START + 20_000, score: 1 }, // 10 с после предыдущего, верно
        { firstSavedAtMs: START + 30_000, score: 0.5 }, // быстро, но неполно — не считается
        { firstSavedAtMs: START + 40_000, score: 1 }, // верно и быстро
        { firstSavedAtMs: START + 5 * MIN, score: 1 }, // долго
        { firstSavedAtMs: null, score: 0 },
      ];
      expect(fastCorrectItems({ startedAtMs: START, items }, 15)).toBe(3);
    });

    it('порог числа кейсов: два быстрых — нет сигнала, три — предупреждение', () => {
      const fastItems = (n: number) => [
        ...Array.from({ length: n }, (_, i) => ({ firstSavedAtMs: START + (i + 1) * 8_000, score: 1 })),
        ...Array.from({ length: 6 - n }, (_, i) => ({ firstSavedAtMs: START + 10 * MIN + i * 4 * MIN, score: 1 })),
      ];
      expect(codes(normal({ items: fastItems(2) }))).toEqual([]);
      const three = evaluateIntegrity(normal({ items: fastItems(3) }));
      expect(three.signals).toEqual([expect.objectContaining({ code: 'FAST_ITEMS', severity: 'ATTENTION', value: 3 })]);
      expect(three.level).toBe('ATTENTION');
    });

    it('порядок элементов во входных данных не важен', () => {
      const items = [
        { firstSavedAtMs: START + 30_000, score: 1 },
        { firstSavedAtMs: START + 10_000, score: 1 },
        { firstSavedAtMs: START + 20_000, score: 1 },
      ];
      expect(fastCorrectItems({ startedAtMs: START, items }, 15)).toBe(3);
    });
  });

  describe('вкладка', () => {
    const hidden = (count: number, ms = 60_000) => normal({ counters: { ...EMPTY_COUNTERS, tabHiddenCount: count, tabHiddenMs: ms } });

    it('два ухода — не сигнал, три — замечание, восемь — предупреждение', () => {
      expect(codes(hidden(2))).toEqual([]);
      expect(evaluateIntegrity(hidden(3)).signals[0]).toMatchObject({ code: 'TAB_HIDDEN', severity: 'NOTE', value: 3 });
      expect(evaluateIntegrity(hidden(8)).signals[0]).toMatchObject({ code: 'TAB_HIDDEN', severity: 'ATTENTION' });
    });

    it('долгое отсутствие при небольшом числе уходов — предупреждение', () => {
      expect(evaluateIntegrity(hidden(3, 6 * MIN)).signals[0].severity).toBe('ATTENTION');
      expect(evaluateIntegrity(hidden(3, 5 * MIN - 1)).signals[0].severity).toBe('NOTE');
    });

    it('текст нейтральный и со склонением', () => {
      expect(evaluateIntegrity(hidden(3)).signals[0].text).toBe('Вкладка теста скрывалась 3 раза, суммарно около 1 мин');
      expect(evaluateIntegrity(hidden(5, 2 * MIN)).signals[0].text).toBe('Вкладка теста скрывалась 5 раз, суммарно около 2 мин');
    });
  });

  describe('буфер обмена', () => {
    it('вставка: один раз — замечание, три — предупреждение', () => {
      expect(evaluateIntegrity(normal({ counters: { ...EMPTY_COUNTERS, pasteCount: 1 } })).signals[0]).toMatchObject({ code: 'PASTE', severity: 'NOTE' });
      expect(evaluateIntegrity(normal({ counters: { ...EMPTY_COUNTERS, pasteCount: 3 } })).signals[0]).toMatchObject({ code: 'PASTE', severity: 'ATTENTION' });
    });

    it('копирование текста задания: меньше трёх — не сигнал, три и больше — замечание', () => {
      expect(codes(normal({ counters: { ...EMPTY_COUNTERS, copyCount: 2 } }))).toEqual([]);
      expect(evaluateIntegrity(normal({ counters: { ...EMPTY_COUNTERS, copyCount: 3 } })).signals[0]).toMatchObject({ code: 'COPY', severity: 'NOTE' });
    });
  });

  it('потери фокуса сами по себе не сигнал; сводный уровень — по самому серьёзному сигналу', () => {
    expect(codes(normal({ counters: { ...EMPTY_COUNTERS, focusLossCount: 50 } }))).toEqual([]);
    const mixed = evaluateIntegrity(normal({ elapsedMs: 4 * MIN, counters: { ...EMPTY_COUNTERS, pasteCount: 4 } }));
    expect(mixed.signals.map((s) => s.code)).toEqual(['FAST_COMPLETION', 'PASTE']);
    expect(mixed.level).toBe('ATTENTION');
  });

  it('счётчики сохраняются в оценке как есть', () => {
    const counters = { tabHiddenCount: 1, tabHiddenMs: 1000, pasteCount: 0, copyCount: 0, focusLossCount: 2 };
    expect(evaluateIntegrity(normal({ counters })).counters).toEqual(counters);
  });
});
