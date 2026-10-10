import { Injectable } from '@nestjs/common';
import { Clock } from './clock';
import { tooManyRequests } from './errors';

interface Window {
  hits: number[];
}

export interface RateLimitRule {
  /** Максимум событий в окне. */
  limit: number;
  /** Длина окна, мс. */
  windowMs: number;
}

/**
 * Ограничение частоты в памяти процесса (скользящее окно).
 * Достаточно для одного экземпляра API в MVP; для нескольких экземпляров нужен общий счётчик.
 */
@Injectable()
export class RateLimitService {
  private readonly windows = new Map<string, Window>();
  private operations = 0;

  constructor(private readonly clock: Clock) {}

  /** Регистрирует событие или выбрасывает 429 с Retry-After. */
  consume(key: string, rule: RateLimitRule): void {
    const now = this.clock.now().getTime();
    const window = this.windows.get(key) ?? { hits: [] };
    window.hits = window.hits.filter((timestamp) => timestamp > now - rule.windowMs);
    if (window.hits.length >= rule.limit) {
      const retryAfterMs = window.hits[0] + rule.windowMs - now;
      this.windows.set(key, window);
      throw tooManyRequests(retryAfterMs / 1000);
    }
    window.hits.push(now);
    this.windows.set(key, window);
    if (++this.operations % 500 === 0) this.cleanup(now);
  }

  /** Сбрасывает счётчик (например, после успешного входа). */
  reset(key: string): void {
    this.windows.delete(key);
  }

  private cleanup(now: number): void {
    const maxWindowMs = 24 * 3_600_000;
    for (const [key, window] of this.windows) {
      if (window.hits.every((timestamp) => timestamp <= now - maxWindowMs)) this.windows.delete(key);
    }
  }
}

export const RATE_LIMITS = {
  loginPerIpAndEmail: { limit: 5, windowMs: 15 * 60_000 },
  loginPerIp: { limit: 30, windowMs: 15 * 60_000 },
  registerPerIp: { limit: 10, windowMs: 60 * 60_000 },
  resendPerUserShort: { limit: 1, windowMs: 60_000 },
  resendPerUserLong: { limit: 5, windowMs: 60 * 60_000 },
  verifyPerIp: { limit: 30, windowMs: 15 * 60_000 },
  fspLinkPerUser: { limit: 10, windowMs: 15 * 60_000 },
  resumePerUser: { limit: 10, windowMs: 15 * 60_000 },
  /** Пакеты сигналов теста: интерфейс отправляет раз в 20 секунд, на 30-минутную попытку хватает с запасом. */
  signalsPerAttempt: { limit: 200, windowMs: 30 * 60_000 },
} satisfies Record<string, RateLimitRule>;
