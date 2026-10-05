import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { MailCapture } from './app';

const ORIGIN = 'http://localhost:3000';

/** HTTP-клиент одного пользователя: cookie сессии и CSRF-токен хранятся в agent, как в браузере. */
export class Client {
  private readonly agent;
  private csrf: string | null = null;
  private credentials: { email: string; password: string } | null = null;

  constructor(
    app: INestApplication,
    readonly name = 'client',
  ) {
    this.agent = request.agent(app.getHttpServer());
  }

  private async ensureCsrf(): Promise<string> {
    if (!this.csrf) {
      const res = await this.agent.get('/api/v1/auth/csrf');
      this.csrf = res.body.csrfToken as string;
    }
    return this.csrf;
  }

  get(path: string, headers: Record<string, string> = {}) {
    return this.agent.get(`/api/v1${path}`).set(headers);
  }

  private async mutate(method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown, headers: Record<string, string> = {}) {
    const token = await this.ensureCsrf();
    const req = this.agent[method](`/api/v1${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', token).set(headers);
    return body === undefined ? req : req.send(body as object);
  }

  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.mutate('post', path, body, headers);
  }
  put(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.mutate('put', path, body, headers);
  }
  patch(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.mutate('patch', path, body, headers);
  }
  delete(path: string, headers?: Record<string, string>) {
    return this.mutate('delete', path, undefined, headers);
  }

  /** Бинарный ответ (PDF). */
  async getBuffer(path: string): Promise<{ status: number; body: Buffer; headers: Record<string, string> }> {
    const res = await this.agent
      .get(`/api/v1${path}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return { status: res.status, body: res.body as Buffer, headers: res.headers as Record<string, string> };
  }

  async registerAndVerify(mail: MailCapture, email: string, role: 'CANDIDATE' | 'EMPLOYER', password = 'Very-Strong-Pass-1') {
    const registered = await this.post('/auth/register', { email, password, role, acceptPrivacyPolicy: true });
    if (registered.status !== 201) throw new Error(`register ${email}: ${registered.status} ${JSON.stringify(registered.body)}`);
    const verified = await this.post('/auth/verify-email', { token: mail.tokenFor(email) });
    if (verified.status !== 200) throw new Error(`verify ${email}: ${verified.status}`);
    this.credentials = { email, password };
    return registered.body;
  }

  /** Повторный вход (после того как тест продвинул часы дальше срока серверной сессии). */
  async relogin() {
    if (!this.credentials) throw new Error('relogin: учётные данные неизвестны');
    const res = await this.post('/auth/login', this.credentials);
    if (res.status !== 200) throw new Error(`relogin: ${res.status}`);
    return res;
  }
}
