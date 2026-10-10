import request from 'supertest';
import { buildOpenApiDocument } from '../src/bootstrap';
import { createTestApp, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { createCandidate, createEmployer, defaultNeed, invitationBody, uniqueEmail } from './helpers/factories';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Operation {
  method: Method;
  /** Путь без префикса /api/v1, параметры подставлены. */
  path: string;
  template: string;
  summary: string | undefined;
  secured: boolean;
}

const METHODS: Method[] = ['get', 'post', 'put', 'patch', 'delete'];
const SOME_UUID = '00000000-0000-4000-8000-000000000000';
const ORIGIN = 'http://localhost:3000';

/** Маршруты, открытые без сессии, — единственный список исключений: новый публичный маршрут требует осознанного решения. */
const PUBLIC_OPERATIONS = new Set([
  'GET /health/live',
  'GET /health/ready',
  'GET /catalogs/specializations',
  'GET /catalogs/skills',
  'GET /catalogs/reference',
  'GET /catalogs/survey',
  'GET /auth/csrf',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/verify-email',
]);
/** Требуют сессию, но не подтверждённый email: без них неподтверждённый пользователь не смог бы подтвердить адрес. */
const ALLOWED_UNVERIFIED = new Set(['GET /auth/me', 'POST /auth/logout', 'POST /auth/resend-verification']);

const key = (op: Pick<Operation, 'method' | 'template'>) => `${op.method.toUpperCase()} ${op.template}`;

function listOperations(ctx: TestContext): Operation[] {
  const document = buildOpenApiDocument(ctx.app);
  const operations: Operation[] = [];
  for (const [rawPath, item] of Object.entries(document.paths)) {
    const template = rawPath.replace(/^\/api\/v1/, '');
    for (const method of METHODS) {
      const operation = (item as Record<string, { summary?: string; security?: unknown[] } | undefined>)[method];
      if (!operation) continue;
      operations.push({
        method,
        template,
        path: template.replace(/\{[^}]+\}/g, SOME_UUID),
        summary: operation.summary,
        secured: Array.isArray(operation.security) && operation.security.length > 0,
      });
    }
  }
  return operations;
}

describe('контроль доступа: проверка всех маршрутов API', () => {
  let ctx: TestContext;
  let operations: Operation[];
  let protectedOps: Operation[];
  beforeAll(async () => {
    ctx = await createTestApp();
    operations = listOperations(ctx);
    protectedOps = operations.filter((op) => !PUBLIC_OPERATIONS.has(key(op)));
  });
  afterAll(() => ctx.close());

  const call = (client: Client, op: Operation) => {
    if (op.method === 'get') return client.get(op.path);
    if (op.method === 'delete') return client.delete(op.path);
    return client[op.method](op.path, {});
  };

  it('перечень маршрутов полон: публичные из списка существуют, защищённые описаны и помечены security', () => {
    const keys = new Set(operations.map(key));
    for (const publicKey of PUBLIC_OPERATIONS) expect(keys).toContain(publicKey);
    expect(operations.length).toBeGreaterThanOrEqual(93);
    expect(protectedOps.length).toBeGreaterThanOrEqual(65);
    expect(operations.filter((op) => !op.summary).map(key)).toEqual([]);
    // Каждый непубличный маршрут объявлен защищённым в OpenAPI — иначе документация вводит в заблуждение.
    expect(protectedOps.filter((op) => !op.secured).map(key)).toEqual([]);
    expect(operations.filter((op) => PUBLIC_OPERATIONS.has(key(op)) && op.secured).map(key)).toEqual([]);
    // Каждый маршрут разделов кандидата и работодателя находится под своим префиксом.
    for (const op of protectedOps) expect(op.template).toMatch(/^\/(employer|candidate|auth)\//);
  });

  it('без сессии все непубличные маршруты отвечают 401 в едином формате ошибок', async () => {
    const anonymous = new Client(ctx.app);
    const failures: string[] = [];
    for (const op of protectedOps) {
      const res = await call(anonymous, op);
      const ok =
        res.status === 401 &&
        res.body.code === 'UNAUTHENTICATED' &&
        typeof res.body.message === 'string' &&
        typeof res.body.requestId === 'string' &&
        res.headers['cache-control'] === 'private, no-store';
      if (!ok) failures.push(`${key(op)} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    expect(failures).toEqual([]);
  });

  it('роль определяет доступ: кандидату закрыт /employer/*, работодателю — /candidate/* (403 FORBIDDEN_ROLE)', async () => {
    const candidate = await createCandidate(ctx, { skipAssessment: true });
    const employer = await createEmployer(ctx);
    const failures: string[] = [];
    let checked = 0;
    for (const op of protectedOps) {
      const forbiddenFor = op.template.startsWith('/employer/') ? candidate.client : op.template.startsWith('/candidate/') ? employer.client : null;
      if (!forbiddenFor) continue;
      checked += 1;
      const res = await call(forbiddenFor, op);
      if (res.status !== 403 || res.body.code !== 'FORBIDDEN_ROLE') failures.push(`${key(op)} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    expect(checked).toBeGreaterThanOrEqual(55);
    expect(failures).toEqual([]);
  });

  it('без подтверждённого email закрыто всё, кроме /auth/me, повторной отправки письма и выхода (403 EMAIL_NOT_VERIFIED)', async () => {
    for (const role of ['CANDIDATE', 'EMPLOYER'] as const) {
      const client = new Client(ctx.app, `unverified-${role}`);
      const registered = await client.post('/auth/register', { email: uniqueEmail('unverified'), password: 'Very-Strong-Pass-1', role, acceptPrivacyPolicy: true });
      expect(registered.status).toBe(201);
      const failures: string[] = [];
      for (const op of protectedOps.filter((candidate) => !ALLOWED_UNVERIFIED.has(key(candidate)))) {
        const res = await call(client, op);
        if (res.status !== 403 || res.body.code !== 'EMAIL_NOT_VERIFIED') failures.push(`${key(op)} → ${res.status} ${JSON.stringify(res.body)}`);
      }
      expect(failures).toEqual([]);
      expect((await client.get('/auth/me')).status).toBe(200);
      expect((await client.post('/auth/resend-verification')).status).toBe(202);
      expect((await client.post('/auth/logout')).status).toBe(204);
    }
  });

  it('все изменяющие маршруты (включая публичные) отклоняют запрос без CSRF-токена и с чужим Origin — до обращения к данным', async () => {
    const server = ctx.app.getHttpServer();
    const mutating = operations.filter((op) => op.method !== 'get');
    expect(mutating.length).toBeGreaterThanOrEqual(35);
    const failures: string[] = [];
    for (const op of mutating) {
      const noToken = await request(server)[op.method](`/api/v1${op.path}`).set('Origin', ORIGIN).send({});
      if (noToken.status !== 403 || noToken.body.code !== 'CSRF_TOKEN_INVALID') failures.push(`${key(op)} без токена → ${noToken.status} ${JSON.stringify(noToken.body)}`);
      const foreign = await request(server)[op.method](`/api/v1${op.path}`).set('Origin', 'https://evil.example').send({});
      if (foreign.status !== 403 || foreign.body.code !== 'CSRF_ORIGIN_MISMATCH') failures.push(`${key(op)} чужой Origin → ${foreign.status} ${JSON.stringify(foreign.body)}`);
    }
    expect(failures).toEqual([]);
  });

  it('безопасные методы не требуют CSRF-токена и не меняют данные: GET-маршруты не создают записей', async () => {
    const employer = await createEmployer(ctx);
    const before = await ctx.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT (SELECT count(*) FROM "Invitation") + (SELECT count(*) FROM "AssessmentAttempt") + (SELECT count(*) FROM "SelectionRun") + (SELECT count(*) FROM "ContactAccessGrant") AS count`,
    );
    const getters = protectedOps.filter((op) => op.method === 'get' && op.template.startsWith('/employer/'));
    for (const op of getters) {
      const res = await employer.client.get(op.path);
      expect(res.status).toBeLessThan(500);
    }
    const after = await ctx.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT (SELECT count(*) FROM "Invitation") + (SELECT count(*) FROM "AssessmentAttempt") + (SELECT count(*) FROM "SelectionRun") + (SELECT count(*) FROM "ContactAccessGrant") AS count`,
    );
    expect(after[0].count).toBe(before[0].count);
  });

  it('идентификаторы в путях: некорректный формат — 400 INVALID_ID, несуществующий или чужой объект — 404, а не 500', async () => {
    const employer = await createEmployer(ctx);
    const candidate = await createCandidate(ctx);
    const failures: string[] = [];
    const idOps = protectedOps.filter((op) => op.template.includes('{') && op.method === 'get');
    for (const op of idOps) {
      const owner = op.template.startsWith('/employer/') ? employer.client : op.template.startsWith('/candidate/') ? candidate.client : null;
      if (!owner) continue;
      const malformed = await owner.get(op.template.replace(/\{[^}]+\}/g, 'not-a-uuid'));
      if (malformed.status !== 400 || malformed.body.code !== 'INVALID_ID') failures.push(`${key(op)} некорректный id → ${malformed.status} ${JSON.stringify(malformed.body)}`);
      const missing = await owner.get(op.path);
      if (missing.status !== 404) failures.push(`${key(op)} несуществующий id → ${missing.status} ${JSON.stringify(missing.body)}`);
    }
    expect(idOps.length).toBeGreaterThanOrEqual(12);
    expect(failures).toEqual([]);
  });

  it('работодатель не видит и не меняет потребности, подборки, закладки и приглашения другой компании', async () => {
    const owner = await createEmployer(ctx, { name: 'Владелец' });
    const intruder = await createEmployer(ctx, { name: 'Посторонний' });
    const target = await createCandidate(ctx);
    const need = await owner.client.post('/employer/needs', defaultNeed({ title: 'Backend' }));
    expect(need.status).toBe(201);
    const run = await owner.client.post(`/employer/needs/${need.body.id}/selections`, {});
    const invitation = await owner.client.post('/employer/invitations', invitationBody(target.candidateId));
    expect(run.status).toBe(201);
    expect(invitation.status).toBe(201);

    const attempts: Array<[string, () => Promise<{ status: number; body: { code?: string } }>]> = [
      ['GET need', () => intruder.client.get(`/employer/needs/${need.body.id}`)],
      ['PATCH need', () => intruder.client.patch(`/employer/needs/${need.body.id}`, { title: 'Взлом' })],
      ['preview', () => intruder.client.post(`/employer/needs/${need.body.id}/assessment-preview`, { grade: 'MIDDLE' })],
      ['create selection', () => intruder.client.post(`/employer/needs/${need.body.id}/selections`, {})],
      ['list selections', () => intruder.client.get(`/employer/needs/${need.body.id}/selections`)],
      ['GET selection', () => intruder.client.get(`/employer/selections/${run.body.id}`)],
      ['GET invitation', () => intruder.client.get(`/employer/invitations/${invitation.body.id}`)],
      ['withdraw invitation', () => intruder.client.post(`/employer/invitations/${invitation.body.id}/withdraw`)],
    ];
    for (const [name, attempt] of attempts) {
      const res = await attempt();
      expect([name, res.status]).toEqual([name, 404]);
    }
    // Исходные данные не изменились.
    expect((await owner.client.get(`/employer/needs/${need.body.id}`)).body.title).toBe('Backend');
    expect((await owner.client.get(`/employer/invitations/${invitation.body.id}`)).body.status).toBe('SENT');
    // Списки чужой компании пусты.
    expect((await intruder.client.get('/employer/needs')).body).toEqual([]);
    expect((await intruder.client.get('/employer/invitations')).body.items).toEqual([]);
    expect((await intruder.client.get('/employer/bookmarks')).body.items ?? []).toEqual([]);
  });

  it('ошибки разбора запроса: битый JSON — 400, слишком большое тело — 413, лишние поля — 422; формат единый', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string;
    const post = (body: string, type = 'application/json') =>
      agent.post('/api/v1/auth/login').set('Origin', ORIGIN).set('X-CSRF-Token', csrf).set('Content-Type', type).send(body);

    const malformed = await post('{"email": ');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ code: 'MALFORMED_JSON', requestId: expect.any(String) });

    const huge = await post(JSON.stringify({ email: 'a@b.example', password: 'x'.repeat(300_000) }));
    expect(huge.status).toBe(413);
    expect(huge.body.code).toBe('PAYLOAD_TOO_LARGE');

    const extra = await post(JSON.stringify({ email: 'a@b.example', password: 'Some-Password-1', isAdmin: true }));
    expect(extra.status).toBe(422);
    expect(extra.body.code).toBe('VALIDATION_FAILED');
    expect(extra.body.details.fields.isAdmin).toBeDefined();

    const unknown = await agent.get('/api/v1/no-such-route');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
    expect(JSON.stringify([malformed.body, huge.body, extra.body, unknown.body])).not.toMatch(/stack|node_modules|at .*\(.*:\d+:\d+\)/);
  });
});
