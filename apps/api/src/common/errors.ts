import { HttpStatus } from '@nestjs/common';

/**
 * Прикладная ошибка с машиночитаемым кодом. Преобразуется фильтром в единый формат
 * `{ code, message, details?, requestId }`. Сообщение — для пользователя, без персональных данных.
 */
export class AppError extends Error {
  constructor(
    public readonly status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(HttpStatus.BAD_REQUEST, code, message, details);

export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);

export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Требуется вход в систему') =>
  new AppError(HttpStatus.UNAUTHORIZED, code, message);

export const forbidden = (code = 'FORBIDDEN', message = 'Недостаточно прав для этого действия', details?: Record<string, unknown>) =>
  new AppError(HttpStatus.FORBIDDEN, code, message, details);

/** Используется и для «не существует», и для «чужой объект», чтобы не раскрывать наличие чужих данных. */
export const notFound = (code = 'NOT_FOUND', message = 'Объект не найден или недоступен') =>
  new AppError(HttpStatus.NOT_FOUND, code, message);

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(HttpStatus.CONFLICT, code, message, details);

export const tooManyRequests = (retryAfterSeconds: number, message = 'Слишком много запросов. Повторите позже.') =>
  new AppError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', message, { retryAfterSeconds }, {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });

/** Проверка уникального нарушения PostgreSQL / Prisma (P2002 или 23505 из драйвера). */
export function isUniqueViolation(error: unknown, constraintHint?: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; meta?: Record<string, unknown>; cause?: unknown };
  const text = `${candidate.message ?? ''} ${JSON.stringify(candidate.meta ?? {})}`;
  const matchesHint = !constraintHint || text.includes(constraintHint);
  if (candidate.code === 'P2002' || candidate.code === '23505') return matchesHint;
  if (candidate.cause) return isUniqueViolation(candidate.cause, constraintHint);
  return false;
}
