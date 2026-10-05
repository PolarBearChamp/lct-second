/**
 * Источник времени. Вся бизнес-логика со сроками (таймер теста, задержки пересдач, срок приглашений)
 * получает время отсюда, чтобы в тестах можно было подставить управляемые часы.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Управляемые часы для тестов. */
export class FakeClock extends Clock {
  constructor(private current: Date = new Date('2026-10-05T09:00:00.000Z')) {
    super();
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date | string): void {
    this.current = new Date(date);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceHours(hours: number): void {
    this.advance(hours * 3_600_000);
  }

  advanceDays(days: number): void {
    this.advance(days * 86_400_000);
  }
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * HOUR_MS);
export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
export const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
