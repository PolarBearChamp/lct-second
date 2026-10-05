import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { uniqueEmail } from './helpers/factories';

describe('авторизация, сессии, CSRF и роли', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const newClient = () => new Client(ctx.app);

  describe('регистрация и подтверждение email', () => {
    it('поток: регистрация → неподтверждённый видит только экран подтверждения → подтверждение POST → доступ', async () => {
      const client = newClient();
      const email = uniqueEmail('flow');
      const registered = await client.post('/auth/register', { email, password: 'Very-Strong-Pass-1', role: 'CANDIDATE', acceptPrivacyPolicy: true });
      expect(registered.status).toBe(201);
      expect(registered.body.user.emailVerified).toBe(false);
      expect(registered.body.candidate.nextStep).toBe('EMAIL');

      // До подтверждения защищённые разделы закрыты, /auth/me, повторная отправка и выход доступны.
      const blocked = await client.get('/candidate/profile');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect((await client.get('/auth/me')).status).toBe(200);
      ctx.clock.advance(61_000);
      expect((await client.post('/auth/resend-verification')).status).toBe(202);

      // Ссылка из письма ничего не меняет сама по себе: GET-маршрута подтверждения нет.
      const token = ctx.mail.tokenFor(email);
      expect((await client.get(`/auth/verify-email?token=${token}`)).status).toBe(404);
      expect((await client.get('/auth/me')).body.user.emailVerified).toBe(false);

      expect((await client.post('/auth/verify-email', { token })).status).toBe(200);
      expect((await client.get('/candidate/profile')).status).toBe(200);
      // Повторное подтверждение тем же токеном безвредно.
      expect((await client.post('/auth/verify-email', { token })).status).toBe(200);
    });

    it('в БД хранится только хеш токена подтверждения; просроченный токен отвергается', async () => {
      const client = newClient();
      const email = uniqueEmail('expire');
      await client.post('/auth/register', { email, password: 'Very-Strong-Pass-1', role: 'EMPLOYER', acceptPrivacyPolicy: true });
      const token = ctx.mail.tokenFor(email);
      const stored = await ctx.prisma.emailVerificationToken.findMany();
      expect(stored.some((t) => t.tokenHash === token)).toBe(false);
      ctx.clock.advanceHours(25);
      const expired = await client.post('/auth/verify-email', { token });
      expect(expired.status).toBe(400);
      expect(expired.body.code).toBe('VERIFICATION_TOKEN_INVALID');
    });

    it('повторная регистрация того же email (в любом регистре) — 409', async () => {
      const email = uniqueEmail('dup');
      expect((await newClient().post('/auth/register', { email, password: 'Very-Strong-Pass-1', role: 'CANDIDATE', acceptPrivacyPolicy: true })).status).toBe(201);
      const again = await newClient().post('/auth/register', { email: email.toUpperCase(), password: 'Very-Strong-Pass-1', role: 'CANDIDATE', acceptPrivacyPolicy: true });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('согласие на обработку данных обязательно и фиксируется с версией политики', async () => {
      const email = uniqueEmail('consent');
      const refused = await newClient().post('/auth/register', { email, password: 'Very-Strong-Pass-1', role: 'CANDIDATE', acceptPrivacyPolicy: false });
      expect(refused.status).toBe(422);
      expect(refused.body.details.fields.acceptPrivacyPolicy).toBeDefined();
      await newClient().post('/auth/register', { email, password: 'Very-Strong-Pass-1', role: 'CANDIDATE', acceptPrivacyPolicy: true });
      const consent = await ctx.prisma.consentRecord.findFirstOrThrow({ where: { user: { normalizedEmail: email } } });
      expect(consent).toMatchObject({ type: 'DATA_PROCESSING', withdrawnAt: null });
      expect(consent.policyVersion).toMatch(/^privacy-policy-/);
    });

    it('слабые и слишком короткие пароли отклоняются', async () => {
      const res = await newClient().post('/auth/register', { email: uniqueEmail('weak'), password: 'short', role: 'CANDIDATE', acceptPrivacyPolicy: true });
      expect(res.status).toBe(422);
    });
  });

  describe('вход, сессии и выход', () => {
    let email: string;
    beforeAll(async () => {
      email = uniqueEmail('session');
      await newClient().registerAndVerify(ctx.mail, email, 'CANDIDATE');
    });

    it('пароль в БД — Argon2id; в cookie непрозрачный токен, в БД его SHA-256; флаги cookie безопасны', async () => {
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { normalizedEmail: email } });
      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);

      const csrf = await request(ctx.app.getHttpServer()).get('/api/v1/auth/csrf');
      const csrfCookie = (csrf.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('fsp_csrf='))!;
      const csrfToken = csrf.body.csrfToken as string;
      const login = await request(ctx.app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', csrfCookie.split(';')[0])
        .set('X-CSRF-Token', csrfToken)
        .send({ email, password: 'Very-Strong-Pass-1' });
      expect(login.status).toBe(200);
      const setCookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('fsp_session='))!;
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
      const raw = setCookie.split(';')[0].split('=')[1];
      const sessions = await ctx.prisma.session.findMany({ where: { userId: user.id } });
      expect(sessions.some((s) => s.tokenHash === raw)).toBe(false);
      expect(sessions.some((s) => s.tokenHash.length === 64)).toBe(true);
    });

    it('неверный пароль и несуществующий email дают одинаковый ответ', async () => {
      const wrong = await newClient().post('/auth/login', { email, password: 'Wrong-Password-1' });
      const unknown = await newClient().post('/auth/login', { email: uniqueEmail('ghost'), password: 'Wrong-Password-1' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('выход отзывает сессию: прежний cookie больше не даёт доступа', async () => {
      const client = newClient();
      const login = await client.post('/auth/login', { email, password: 'Very-Strong-Pass-1' });
      expect(login.status).toBe(200);
      const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('fsp_session='))!.split(';')[0];
      expect((await request(ctx.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
      expect((await client.post('/auth/logout')).status).toBe(204);
      const after = await request(ctx.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(after.status).toBe(401);
      const sessions = await ctx.prisma.session.findMany({ where: { revokedAt: { not: null } } });
      expect(sessions.length).toBeGreaterThan(0);
    });

    it('просроченная сессия не даёт доступа (срок — серверный)', async () => {
      const client = newClient();
      const login = await client.post('/auth/login', { email, password: 'Very-Strong-Pass-1' });
      const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('fsp_session='))!.split(';')[0];
      ctx.clock.advanceHours(24 * 7 - 1);
      expect((await request(ctx.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
      ctx.clock.advanceHours(2);
      expect((await request(ctx.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
    });
  });

  describe('CSRF и проверка Origin', () => {
    it('изменяющий запрос без CSRF-токена отклоняется', async () => {
      const res = await request(ctx.app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({ email: 'a@b.example', password: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('чужой Origin отклоняется даже с корректным токеном', async () => {
      const csrf = await request(ctx.app.getHttpServer()).get('/api/v1/auth/csrf');
      const cookie = (csrf.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf.body.csrfToken)
        .send({ email: 'a@b.example', password: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_ORIGIN_MISMATCH');
    });

    it('токен из заголовка должен совпадать с cookie', async () => {
      const a = await request(ctx.app.getHttpServer()).get('/api/v1/auth/csrf');
      const b = await request(ctx.app.getHttpServer()).get('/api/v1/auth/csrf');
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', (a.headers['set-cookie'] as unknown as string[])[0].split(';')[0])
        .set('X-CSRF-Token', b.body.csrfToken)
        .send({ email: 'a@b.example', password: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('роли разграничены на backend', () => {
    it('401 без сессии, 403 при чужой роли', async () => {
      const candidate = newClient();
      const employer = newClient();
      await candidate.registerAndVerify(ctx.mail, uniqueEmail('role-c'), 'CANDIDATE');
      await employer.registerAndVerify(ctx.mail, uniqueEmail('role-e'), 'EMPLOYER');

      expect((await newClient().get('/candidate/profile')).status).toBe(401);
      expect((await newClient().get('/employer/company')).status).toBe(401);
      for (const path of ['/employer/company', '/employer/needs', '/employer/candidates', '/employer/bookmarks', '/employer/invitations']) {
        const res = await candidate.get(path);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN_ROLE');
      }
      for (const path of ['/candidate/profile', '/candidate/invitations', '/candidate/assessments', '/candidate/qualifications', '/candidate/contact-access']) {
        expect((await employer.get(path)).status).toBe(403);
      }
    });
  });

  describe('ограничение частоты', () => {
    it('вход блокируется на 429 с Retry-After после серии неудач', async () => {
      const limited = await createTestApp({ realRateLimit: true });
      try {
        const client = new Client(limited.app);
        const email = uniqueEmail('limit');
        let last: request.Response | undefined;
        for (let i = 0; i < 6; i += 1) last = await client.post('/auth/login', { email, password: 'Wrong-Password-1' });
        expect(last!.status).toBe(429);
        expect(last!.body.code).toBe('RATE_LIMITED');
        expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
      } finally {
        await limited.close();
      }
    });

    it('повторная отправка письма подтверждения ограничена', async () => {
      const limited = await createTestApp({ realRateLimit: true });
      try {
        const client = new Client(limited.app);
        await client.post('/auth/register', { email: uniqueEmail('resend'), password: 'Very-Strong-Pass-1', role: 'CANDIDATE', acceptPrivacyPolicy: true });
        limited.clock.advance(61_000);
        expect((await client.post('/auth/resend-verification')).status).toBe(202);
        expect((await client.post('/auth/resend-verification')).status).toBe(429);
      } finally {
        await limited.close();
      }
    });
  });

  describe('единый формат ошибок', () => {
    it('ошибки содержат code, message, requestId и не раскрывают внутренности', async () => {
      const notFound = await newClient().get('/no-such-route');
      expect(notFound.status).toBe(404);
      expect(Object.keys(notFound.body).sort()).toEqual(['code', 'message', 'requestId']);
      expect(notFound.headers['x-request-id']).toBe(notFound.body.requestId);

      const client = newClient();
      await client.registerAndVerify(ctx.mail, uniqueEmail('fmt'), 'CANDIDATE');
      const validation = await client.patch('/candidate/profile', { salaryFrom: -5, fullName: 123 });
      expect(validation.status).toBe(422);
      expect(validation.body.code).toBe('VALIDATION_FAILED');
      expect(validation.body.details.fields.salaryFrom).toBeDefined();
      expect(JSON.stringify(validation.body)).not.toMatch(/\bat \w+.*\(/);

      const malformed = await request(ctx.app.getHttpServer())
        .post('/api/v1/auth/csrf')
        .set('Content-Type', 'application/json')
        .send('{"broken');
      expect([400, 403, 404]).toContain(malformed.status);
    });

    it('идентификатор некорректного формата в пути — 400, а не 500', async () => {
      const client = newClient();
      await client.registerAndVerify(ctx.mail, uniqueEmail('uuid'), 'CANDIDATE');
      const res = await client.get('/candidate/assessments/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ID');
    });

    it('приватные ответы не кэшируются', async () => {
      const client = newClient();
      await client.registerAndVerify(ctx.mail, uniqueEmail('cache'), 'CANDIDATE');
      const res = await client.get('/candidate/profile');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });
  });

  describe('здоровье приложения', () => {
    it('live и ready', async () => {
      expect((await newClient().get('/health/live')).body).toEqual({ status: 'ok' });
      const ready = await newClient().get('/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.body.checks).toEqual({ database: 'ok', catalog: 'ok' });
    });
  });
});
