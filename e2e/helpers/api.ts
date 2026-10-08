import { request, type APIRequestContext } from '@playwright/test';
import { activeAttemptItems, correctPartAnswer } from './db';
import { BASE_URL, E2E_PASSWORD } from './env';
import { waitForVerificationLink } from './mail';

/** Ответы API в тестах не типизируются строго: нужные поля читаются явно и проверяются утверждениями. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface ApiResult<T = Json> {
  status: number;
  body: T;
}

/** API-клиент со своей cookie-сессией: быстрые предусловия сценариев. Сами проверяемые сценарии идут через интерфейс. */
export class ApiSession {
  private csrfToken: string | null = null;

  private constructor(private readonly ctx: APIRequestContext) {}

  static async create(): Promise<ApiSession> {
    return new ApiSession(await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL } }));
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  private async csrf(): Promise<string> {
    if (!this.csrfToken) {
      const res = await this.ctx.get('/api/v1/auth/csrf');
      this.csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;
    }
    return this.csrfToken;
  }

  async send<T = Json>(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, data?: unknown): Promise<ApiResult<T>> {
    const url = `/api/v1${path}`;
    const response =
      method === 'get'
        ? await this.ctx.get(url)
        : await this.ctx[method](url, { data, headers: { 'X-CSRF-Token': await this.csrf() } });
    const text = await response.text();
    return { status: response.status(), body: (text ? JSON.parse(text) : undefined) as T };
  }

  async ok<T = Json>(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, data?: unknown): Promise<T> {
    const result = await this.send<T>(method, path, data);
    if (result.status >= 300) throw new Error(`${method.toUpperCase()} ${path} → ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  }

  /** Регистрация, подтверждение email по письму из Mailpit и вход остаются в этой сессии. */
  async registerAndVerify(email: string, role: 'CANDIDATE' | 'EMPLOYER', password = E2E_PASSWORD): Promise<void> {
    await this.ok('post', '/auth/register', { email, password, role, acceptPrivacyPolicy: true });
    const { token } = await waitForVerificationLink(email);
    await this.ok('post', '/auth/verify-email', { token });
  }

  async login(email: string, password: string): Promise<void> {
    await this.ok('post', '/auth/login', { email, password });
  }

  async fillCandidateProfile(patch: Record<string, unknown> = {}): Promise<void> {
    await this.ok('patch', '/candidate/profile', {
      fullName: 'Е2Е Кандидатов',
      city: 'Казань',
      timezone: 'Europe/Moscow',
      workFormats: ['REMOTE'],
      experienceMonths: 36,
      birthDate: '1996-03-10',
      skills: [{ code: 'postgresql', months: 24 }, { code: 'sql', months: 30 }, { code: 'kafka', months: 6 }],
      contactEmail: 'e2e.candidate@e2e.example',
      phone: '+7 900 000-00-00',
      disclosureChannels: ['EMAIL'],
      salaryFrom: 250_000,
      salaryTo: 320_000,
      activeSpecialization: 'BACKEND',
      declaredGrade: 'MIDDLE',
      ...patch,
    });
  }

  /** Проходит тест по ключам из БД стенда: правильными ответами или без ответов (неуспех). */
  async takeAssessment(email: string, specialization: string, grade: string, mode: 'correct' | 'empty' = 'correct'): Promise<{ attemptId: string; status: string }> {
    const started = await this.ok('post', '/candidate/assessments', { specialization, grade });
    const { items } = await activeAttemptItems(email);
    const answers =
      mode === 'empty'
        ? []
        : items.map((item) => ({
            itemId: item.id,
            revision: 1,
            answer: { parts: Object.fromEntries(item.keys.map((key) => [key.partId, correctPartAnswer(key)])) },
          }));
    const result = await this.ok('post', `/candidate/assessments/${started.id}/submit`, { answers });
    return { attemptId: started.id as string, status: result.status as string };
  }

  async publishProfile(): Promise<void> {
    await this.ok('put', '/candidate/consents', { profilePublication: true });
    await this.ok('patch', '/candidate/profile', { isDiscoverable: true });
  }
}
