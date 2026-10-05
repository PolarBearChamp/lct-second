import { cookies } from 'next/headers';
import type { MeResponse } from '@fsp/contracts';

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'fsp_session';

/**
 * Серверный запрос к API (из Server Components): внутренний URL и явная передача cookie сессии
 * текущего запроса. Ответы не кэшируются между пользователями (cache: 'no-store').
 */
export async function serverApi<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE)?.value;
  if (!session) return { ok: false, status: 401 };
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  try {
    const response = await fetch(`${base}/api/v1${path}`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}`, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, status: 503 };
  }
}

export async function getMe(): Promise<MeResponse | null> {
  const result = await serverApi<MeResponse>('/auth/me');
  return result.ok ? result.data : null;
}
