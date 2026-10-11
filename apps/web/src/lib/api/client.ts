'use client';

import type { ApiErrorBody } from '@fsp/contracts';

/** Ошибка API в едином формате { code, message, details?, requestId }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Ошибки полей формы из VALIDATION_FAILED. */
  get fieldErrors(): Record<string, string[]> {
    const fields = this.details?.fields;
    return fields && typeof fields === 'object' ? (fields as Record<string, string[]>) : {};
  }
}

const CSRF_COOKIE = 'fsp_csrf';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfRequest: Promise<string> | null = null;

async function ensureCsrf(force = false): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing && !force) return existing;
  csrfRequest ??= fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    .then((res) => res.json())
    .then((body: { csrfToken: string }) => body.csrfToken)
    .finally(() => {
      csrfRequest = null;
    });
  return csrfRequest;
}

export interface RequestOptions {
  body?: unknown;
  /** Бинарное тело (загрузка файла); не сериализуется в JSON. */
  raw?: { data: Blob; contentType: string };
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.raw) headers['Content-Type'] = options.raw.contentType;
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method)) headers['X-CSRF-Token'] = await ensureCsrf();

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: options.raw ? options.raw.data : options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Нет связи с сервером. Проверьте подключение и повторите.');
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!response.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>;
    if (response.status === 403 && body.code === 'CSRF_TOKEN_INVALID' && !retried) {
      await ensureCsrf(true);
      return request<T>(method, path, options, true);
    }
    throw new ApiError(
      response.status,
      body.code ?? 'HTTP_ERROR',
      body.message ?? 'Не удалось выполнить запрос',
      body.details,
      body.requestId,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
  /** Загрузка файла как тела запроса (например, PDF-резюме). */
  upload: <T>(path: string, file: Blob, contentType: string, options?: RequestOptions) => request<T>('POST', path, { ...options, raw: { data: file, contentType } }),
};

/** Ключ идемпотентности для защиты от двойной отправки. */
export function idempotencyKey(): string {
  // getRandomValues is also available on HTTP origins; randomUUID requires HTTPS or localhost.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Что-то пошло не так';
}
