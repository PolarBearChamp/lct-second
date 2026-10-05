import { createHash } from 'node:crypto';
import type { Rng } from './types';

/**
 * Детерминированный генератор (sfc32) для воспроизводимой генерации заданий по серверному seed.
 * Не используется для токенов безопасности — для них применяется crypto.randomBytes.
 */
export function createRng(seed: string): Rng {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  let a = digest.readUInt32LE(0);
  let b = digest.readUInt32LE(4);
  let c = digest.readUInt32LE(8);
  let d = digest.readUInt32LE(12);

  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Прогрев, чтобы близкие seed давали независимые последовательности.
  for (let i = 0; i < 12; i += 1) next();

  const rng: Rng = {
    next,
    int(min, max) {
      if (max < min) throw new Error(`rng.int: max < min (${min}..${max})`);
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick: пустой список');
      return items[Math.floor(next() * items.length)];
    },
    shuffle(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    sample(items, count) {
      if (count > items.length) throw new Error(`rng.sample: нужно ${count}, доступно ${items.length}`);
      return rng.shuffle(items).slice(0, count);
    },
    bool(probability = 0.5) {
      return next() < probability;
    },
  };
  return rng;
}
