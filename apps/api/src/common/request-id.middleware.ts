import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from './request-context';

const SAFE_REQUEST_ID = /^[a-zA-Z0-9._-]{8,64}$/;

/** Присваивает каждому запросу идентификатор (принимает безопасный X-Request-Id от прокси). */
export function requestIdMiddleware(req: AppRequest, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** Приватные ответы API не кэшируются ни браузером, ни промежуточными прокси. */
export function noStoreMiddleware(_req: AppRequest, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  next();
}
