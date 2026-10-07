import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { toJsonSchemaDraft7 } from '../scripts/openapi/responses';
import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { makeResumePdf } from './helpers/resume-pdf';
import { approachBody, createCandidate, createEmployer, defaultNeed, fillProfile, invitationBody, publish, startAttempt, submitAttempt, taskBody, uniqueEmail, vacancyBody } from './helpers/factories';

/**
 * Контрактный тест: реальные ответы API проверяются по схемам из docs/openapi.json (тот же документ строится здесь заново).
 * Если сервис вернёт поле, которого нет в контракте, или не вернёт обязательное — тест упадёт, и документация не разойдётся с API.
 */
describe('OpenAPI: ответы API соответствуют описанию', () => {
  let ctx: TestContext;
  let document: { paths: Record<string, unknown>; components: unknown };
  let components: unknown;
  const ajv = new Ajv({ strict: false, allErrors: true });
  const compiled = new Map<string, ValidateFunction>();
  const covered = new Set<string>();

  beforeAll(async () => {
    ctx = await createTestApp();
    // Документ выпускает pnpm openapi:export (сборка с плагином @nestjs/swagger); тест проверяет его соответствие реальным ответам.
    const file = path.resolve(__dirname, '../../../docs/openapi.json');
    if (!existsSync(file)) throw new Error('Нет docs/openapi.json — выполните pnpm openapi:export');
    document = JSON.parse(readFileSync(file, 'utf8'));
    components = toJsonSchemaDraft7(document.components);
  }, 120_000);
  afterAll(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.prisma));

  /** Проверяет тело ответа по схеме операции и фактическому статусу. */
  function conforms(operation: string, res: { status: number; body: unknown }) {
    const [method, template] = operation.split(' ');
    const item = (document.paths as Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>>)[`/api/v1${template}`];
    const response = item?.[method.toLowerCase()]?.responses?.[String(res.status)];
    if (!response) throw new Error(`${operation}: статус ${res.status} не описан в OpenAPI`);
    const schema = response.content?.['application/json']?.schema;
    if (!schema) {
      expect({ operation, hasBody: res.body !== undefined && res.status !== 204 && Object.keys((res.body as object) ?? {}).length > 0 }).toEqual({ operation, hasBody: false });
      covered.add(operation);
      return;
    }
    const key = `${operation}:${res.status}`;
    let validate = compiled.get(key);
    if (!validate) {
      validate = ajv.compile({ ...(toJsonSchemaDraft7(schema) as object), components });
      compiled.set(key, validate);
    }
    const valid = validate(res.body);
    expect({ operation, status: res.status, errors: valid ? [] : validate.errors?.slice(0, 5).map((e) => `${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`) }).toEqual({ operation, status: res.status, errors: [] });
    covered.add(operation);
  }

  const checked = <T extends { status: number; body: unknown }>(operation: string, res: T, expectedStatus?: number): T => {
    if (expectedStatus !== undefined) expect([operation, res.status]).toEqual([operation, expectedStatus]);
    conforms(operation, res);
    return res;
  };

  it('публичные маршруты и аутентификация', async () => {
    const client = new Client(ctx.app);
    checked('GET /health/live', await client.get('/health/live'), 200);
    checked('GET /health/ready', await client.get('/health/ready'), 200);
    checked('GET /catalogs/specializations', await client.get('/catalogs/specializations'), 200);
    checked('GET /catalogs/skills', await client.get('/catalogs/skills'), 200);
    checked('GET /catalogs/reference', await client.get('/catalogs/reference'), 200);
    checked('GET /catalogs/survey', await client.get('/catalogs/survey'), 200);
    checked('GET /auth/csrf', await client.get('/auth/csrf'), 200);

    const email = uniqueEmail('openapi-auth');
    const registered = await client.post('/auth/register', { email, password: 'Very-Strong-Pass-1', role: 'CANDIDATE', acceptPrivacyPolicy: true });
    checked('POST /auth/register', registered, 201);
    checked('POST /auth/resend-verification', await client.post('/auth/resend-verification'), 202);
    checked('POST /auth/verify-email', await client.post('/auth/verify-email', { token: ctx.mail.tokenFor(email) }), 200);
    checked('GET /auth/me', await client.get('/auth/me'), 200);
    checked('POST /auth/logout', await client.post('/auth/logout'), 204);
    checked('POST /auth/login', await client.post('/auth/login', { email, password: 'Very-Strong-Pass-1' }), 200);
  });

  it('кандидат: профиль, опрос, согласия, тест, квалификации, ФСП, PDF', async () => {
    const client = new Client(ctx.app);
    await client.registerAndVerify(ctx.mail, uniqueEmail('openapi-cand'), 'CANDIDATE');
    checked('PUT /candidate/survey', await client.put('/candidate/survey', { answers: { focus: 'SERVER', industries: ['FINTECH'], recentTasks: ['API', 'DB'], experience: 'Y1_3', autonomy: 'INDEPENDENT' } }), 200);
    await fillProfile(client);
    checked('GET /candidate/profile', await client.get('/candidate/profile'), 200);
    checked('PATCH /candidate/profile', await client.patch('/candidate/profile', { city: 'Казань' }), 200);
    const resumePdf = await makeResumePdf(['Иванов Пётр Сергеевич', 'Backend-разработчик', 'Email: petr.ivanov@resume-test.example', 'Навыки: Node.js, PostgreSQL']);
    checked('POST /candidate/profile/resume', await client.post('/candidate/profile/resume', resumePdf, { 'Content-Type': 'application/pdf' }), 200);
    checked('GET /candidate/assessments/eligibility', await client.get('/candidate/assessments/eligibility?specialization=BACKEND'), 200);
    const started = checked('POST /candidate/assessments', await startAttempt(client, 'BACKEND', 'MIDDLE'), 201);
    const attemptId = started.body.id as string;
    checked('GET /candidate/assessments', await client.get('/candidate/assessments'), 200);
    const view = checked('GET /candidate/assessments/{id}', await client.get(`/candidate/assessments/${attemptId}`), 200);
    const first = view.body.items[0];
    checked(
      'PUT /candidate/assessments/{id}/answers/{itemId}',
      await client.put(`/candidate/assessments/${attemptId}/answers/${first.id}`, { answer: { parts: {} }, revision: 1 }),
      200,
    );
    const submitted = checked('POST /candidate/assessments/{id}/submit', await submitAttempt(ctx, client, attemptId), 200);
    expect(submitted.body.status).toBe('PASSED');
    checked('GET /candidate/assessments/{id}/result', await client.get(`/candidate/assessments/${attemptId}/result`), 200);
    checked('GET /candidate/qualifications', await client.get('/candidate/qualifications'), 200);
    checked('PUT /candidate/consents', await client.put('/candidate/consents', { profilePublication: true }), 200);
    await publish(client);
    checked('GET /candidate/profile/preview', await client.get('/candidate/profile/preview'), 200);

    checked('GET /candidate/fsp-link', await client.get('/candidate/fsp-link'), 200);
    checked('POST /candidate/fsp-link', await client.post('/candidate/fsp-link', { fspId: 'FSP-DEMO-1001', code: '731905' }), 201);
    checked('POST /candidate/fsp-link/sync', await client.post('/candidate/fsp-link/sync'), 200);
    checked('DELETE /candidate/fsp-link', await client.delete('/candidate/fsp-link'), 200);

    const pdf = await client.getBuffer('/candidate/profile/pdf');
    expect([pdf.status, pdf.headers['content-type']]).toEqual([200, 'application/pdf']);
    conforms('GET /candidate/profile/pdf', { status: 200, body: pdf.body.subarray(0, 4).toString() === '%PDF' ? undefined : 'invalid' });

    // Повторная попытка и прерывание: ещё одна ветка жизненного цикла.
    ctx.clock.advanceHours(24 * 91);
    await client.relogin();
    const second = await startAttempt(client, 'BACKEND', 'MIDDLE');
    expect(second.status).toBe(201);
    checked('POST /candidate/assessments/{id}/abandon', await client.post(`/candidate/assessments/${second.body.id}/abandon`), 200);
  });

  it('работодатель: компания, потребности, банк, подборки, закладки, приглашения; кандидат: приглашения и доступ', async () => {
    const candidate = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
    const employer = await createEmployer(ctx);
    const ec = employer.client;

    checked('GET /employer/company', await ec.get('/employer/company'), 200);
    checked('PUT /employer/company', await ec.put('/employer/company', { name: 'Тест Компания', industry: 'FINTECH', contactChannelType: 'EMAIL', contactValue: 'hr@test-company.example' }), 200);

    const need = checked('POST /employer/needs', await ec.post('/employer/needs', defaultNeed()), 201);
    const needId = need.body.id as string;
    checked('GET /employer/needs', await ec.get('/employer/needs'), 200);
    checked('GET /employer/needs/{id}', await ec.get(`/employer/needs/${needId}`), 200);
    checked('PATCH /employer/needs/{id}', await ec.patch(`/employer/needs/${needId}`, { title: 'Backend-разработчик (обновлено)' }), 200);
    checked('POST /employer/needs/{id}/assessment-preview', await ec.post(`/employer/needs/${needId}/assessment-preview`, { grade: 'MIDDLE' }), 200);

    checked('GET /employer/candidates', await ec.get('/employer/candidates?specialization=BACKEND'), 200);
    checked('GET /employer/candidates/{id}', await ec.get(`/employer/candidates/${candidate.candidateId}?needId=${needId}`), 200);
    const redactedPdf = await ec.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`);
    expect(redactedPdf.status).toBe(200);
    conforms('GET /employer/candidates/{id}/pdf', { status: 200, body: undefined });

    const run = checked('POST /employer/needs/{id}/selections', await ec.post(`/employer/needs/${needId}/selections`, {}), 201);
    checked('GET /employer/needs/{id}/selections', await ec.get(`/employer/needs/${needId}/selections`), 200);
    checked('GET /employer/selections/{id}', await ec.get(`/employer/selections/${run.body.id}`), 200);
    checked('POST /employer/bookmarks/{candidateId}', await ec.post(`/employer/bookmarks/${candidate.candidateId}`), 201);
    checked('GET /employer/bookmarks', await ec.get('/employer/bookmarks'), 200);
    checked('DELETE /employer/bookmarks/{candidateId}', await ec.delete(`/employer/bookmarks/${candidate.candidateId}`), 200);

    const invitation = checked('POST /employer/invitations', await ec.post('/employer/invitations', invitationBody(candidate.candidateId, { needId })), 201);
    const again = await ec.post('/employer/invitations', invitationBody(candidate.candidateId, { needId }), { 'Idempotency-Key': 'openapi-key-0001' });
    expect(again.status).toBe(409);
    checked('GET /employer/invitations', await ec.get('/employer/invitations'), 200);
    checked('GET /employer/invitations/{id}', await ec.get(`/employer/invitations/${invitation.body.id}`), 200);

    const cc = candidate.client;
    checked('GET /candidate/invitations', await cc.get('/candidate/invitations'), 200);
    checked('GET /candidate/invitations/{id}', await cc.get(`/candidate/invitations/${invitation.body.id}`), 200);
    checked('POST /candidate/invitations/{id}/view', await cc.post(`/candidate/invitations/${invitation.body.id}/view`), 200);
    checked('POST /candidate/invitations/{id}/accept', await cc.post(`/candidate/invitations/${invitation.body.id}/accept`, { confirmDisclosure: true }), 200);
    checked('GET /candidate/contact-access', await cc.get('/candidate/contact-access'), 200);

    // С раскрытыми контактами карточка и PDF строятся в режиме EMPLOYER_GRANTED.
    const granted = checked('GET /employer/candidates/{id}', await ec.get(`/employer/candidates/${candidate.candidateId}`), 200);
    expect(granted.body.profile.mode).toBe('EMPLOYER_GRANTED');
    checked('DELETE /candidate/contact-access/{companyId}', await cc.delete(`/candidate/contact-access/${employer.companyId}`), 200);

    // Отклонение и отзыв — по второму работодателю.
    const other = await createEmployer(ctx, { name: 'Вторая компания' });
    const second = await other.client.post('/employer/invitations', invitationBody(candidate.candidateId));
    checked('POST /candidate/invitations/{id}/decline', await cc.post(`/candidate/invitations/${second.body.id}/decline`, {}), 200);
    const third = await other.client.post('/employer/invitations', invitationBody(candidate.candidateId));
    checked('POST /employer/invitations/{id}/withdraw', await other.client.post(`/employer/invitations/${third.body.id}/withdraw`), 200);
  }, 120_000);

  it('вакансии и отклики: работодатель публикует вакансию и работает с откликами, кандидат откликается и отзывает отклик', async () => {
    const candidate = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
    const second = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'JUNIOR' });
    const employer = await createEmployer(ctx);
    const ec = employer.client;
    const cc = candidate.client;

    const need = await ec.post('/employer/needs', defaultNeed());
    const vacancy = checked('POST /employer/vacancies', await ec.post('/employer/vacancies', vacancyBody({ needId: need.body.id, publish: false })), 201);
    const vacancyId = vacancy.body.id as string;
    checked('GET /employer/vacancies', await ec.get('/employer/vacancies'), 200);
    checked('GET /employer/vacancies/{id}', await ec.get(`/employer/vacancies/${vacancyId}`), 200);
    checked('PATCH /employer/vacancies/{id}', await ec.patch(`/employer/vacancies/${vacancyId}`, { title: 'Backend (обновлено)' }), 200);
    checked('POST /employer/vacancies/{id}/publish', await ec.post(`/employer/vacancies/${vacancyId}/publish`), 200);

    checked('GET /candidate/vacancies', await cc.get('/candidate/vacancies'), 200);
    checked('GET /candidate/vacancies/{id}', await cc.get(`/candidate/vacancies/${vacancyId}`), 200);
    const application = checked('POST /candidate/vacancies/{id}/applications', await cc.post(`/candidate/vacancies/${vacancyId}/applications`, { confirmDisclosure: true, coverNote: 'Готов обсудить условия.' }), 201);
    const applicationId = application.body.id as string;
    checked('GET /candidate/applications', await cc.get('/candidate/applications'), 200);
    checked('GET /candidate/applications/{id}', await cc.get(`/candidate/applications/${applicationId}`), 200);

    checked('GET /employer/vacancies/{id}/applications', await ec.get(`/employer/vacancies/${vacancyId}/applications`), 200);
    checked('GET /employer/applications/{id}', await ec.get(`/employer/applications/${applicationId}`), 200);
    checked('POST /employer/applications/{id}/view', await ec.post(`/employer/applications/${applicationId}/view`), 200);
    checked('POST /employer/applications/{id}/shortlist', await ec.post(`/employer/applications/${applicationId}/shortlist`), 200);

    // Отказ и отзыв — на втором отклике; граничные ответы с описанным телом ошибки.
    const other = await second.client.post(`/candidate/vacancies/${vacancyId}/applications`, { confirmDisclosure: true });
    expect(other.status).toBe(201);
    checked('POST /employer/applications/{id}/reject', await ec.post(`/employer/applications/${other.body.id}/reject`), 200);
    const third = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
    const withdrawable = await third.client.post(`/candidate/vacancies/${vacancyId}/applications`, { confirmDisclosure: true });
    checked('POST /candidate/applications/{id}/withdraw', await third.client.post(`/candidate/applications/${withdrawable.body.id}/withdraw`, { revokeContactAccess: true }), 200);
    checked('POST /employer/vacancies/{id}/close', await ec.post(`/employer/vacancies/${vacancyId}/close`), 200);

    const duplicate = await cc.post(`/candidate/vacancies/${vacancyId}/applications`, { confirmDisclosure: true });
    expect(duplicate.status).toBe(409);
    conforms('POST /candidate/vacancies/{id}/applications', duplicate);
  }, 120_000);

  it('короткие задания: кабинет работодателя и кандидата', async () => {
    const employer = await createEmployer(ctx);
    const ec = employer.client;
    const draft = checked('POST /employer/tasks', await ec.post('/employer/tasks', taskBody({ publish: false })), 201);
    checked('GET /employer/tasks', await ec.get('/employer/tasks'), 200);
    checked('GET /employer/tasks/{id}', await ec.get(`/employer/tasks/${draft.body.id}`), 200);
    checked('PATCH /employer/tasks/{id}', await ec.patch(`/employer/tasks/${draft.body.id}`, { title: 'Идемпотентность запросов (правка)' }), 200);
    checked('POST /employer/tasks/{id}/publish', await ec.post(`/employer/tasks/${draft.body.id}/publish`), 200);
    const approach = await ec.post('/employer/tasks', approachBody());
    expect(approach.status).toBe(201);

    const person = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
    const second = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
    const cc = person.client;
    const overview = checked('GET /candidate/tasks', await cc.get('/candidate/tasks'), 200);
    const offer = overview.body.current as { id: string; task: { kind: string } };
    const otherOverview = await second.client.get('/candidate/tasks');
    const otherOffer = otherOverview.body.current as { id: string; task: { kind: string } };
    expect([offer.task.kind, otherOffer.task.kind].sort()).toEqual(['APPROACH', 'QUIZ']);
    const quizTaker = offer.task.kind === 'QUIZ' ? cc : second.client;
    const quizOffer = offer.task.kind === 'QUIZ' ? offer : otherOffer;
    const approachTaker = offer.task.kind === 'QUIZ' ? second.client : cc;
    const approachOffer = offer.task.kind === 'QUIZ' ? otherOffer : offer;

    checked('GET /candidate/tasks/{id}', await quizTaker.get(`/candidate/tasks/${quizOffer.id}`), 200);
    checked('POST /candidate/tasks/{id}/submit', await quizTaker.post(`/candidate/tasks/${quizOffer.id}/submit`, { selectedIndex: 1 }), 200);
    const repeated = await quizTaker.post(`/candidate/tasks/${quizOffer.id}/submit`, { selectedIndex: 1 });
    expect(repeated.status).toBe(409);
    conforms('POST /candidate/tasks/{id}/submit', repeated);
    await approachTaker.post(`/candidate/tasks/${approachOffer.id}/submit`, { answerText: 'Сначала посмотрю план выполнения запроса и наличие нужных индексов.' });

    const submissions = checked('GET /employer/tasks/{id}/submissions', await ec.get(`/employer/tasks/${approach.body.id}/submissions`), 200);
    checked('POST /employer/task-submissions/{id}/review', await ec.post(`/employer/task-submissions/${submissions.body.items[0].id}/review`, { verdict: 'STRONG', comment: 'Хорошо' }), 200);
    checked('GET /employer/tasks/{id}/submissions', await ec.get(`/employer/tasks/${draft.body.id}/submissions`), 200);

    const skipTarget = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
    const skipOffer = (await skipTarget.client.get('/candidate/tasks')).body.current as { id: string };
    checked('POST /candidate/tasks/{id}/skip', await skipTarget.client.post(`/candidate/tasks/${skipOffer.id}/skip`), 200);
    checked('POST /employer/tasks/{id}/close', await ec.post(`/employer/tasks/${draft.body.id}/close`), 200);
  }, 120_000);

  it('ошибки имеют единый формат ApiErrorBody', async () => {
    const anonymous = new Client(ctx.app);
    const employer = await createEmployer(ctx);
    const candidate = await createCandidate(ctx, { skipAssessment: true });
    const cases: Array<[string, { status: number; body: unknown }]> = [
      ['GET /candidate/profile', await anonymous.get('/candidate/profile')],
      ['GET /candidate/profile', await employer.client.get('/candidate/profile')],
      ['GET /employer/needs/{id}', await employer.client.get('/employer/needs/00000000-0000-4000-8000-000000000000')],
      ['GET /employer/needs/{id}', await employer.client.get('/employer/needs/not-a-uuid')],
      ['POST /employer/needs', await employer.client.post('/employer/needs', { title: '' })],
      ['POST /candidate/assessments', await candidate.client.post('/candidate/assessments', { specialization: 'BACKEND', grade: 'MIDDLE' })],
    ];
    expect(cases.map(([, res]) => res.status)).toEqual([401, 403, 404, 400, 422, 201]);
    for (const [operation, res] of cases.slice(0, 5)) conforms(operation, res);
    const conflict = await candidate.client.post('/candidate/assessments', { specialization: 'BACKEND', grade: 'MIDDLE' });
    expect(conflict.status).toBe(409);
    conforms('POST /candidate/assessments', conflict);
  });

  it('все операции с описанным телом ответа были проверены (кроме явно перечисленных)', () => {
    const operations = Object.entries(document.paths).flatMap(([p, item]) =>
      Object.entries(item as Record<string, unknown>)
        .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
        .map(([method]) => `${method.toUpperCase()} ${p.replace(/^\/api\/v1/, '')}`),
    );
    const notCovered = operations.filter((operation) => !covered.has(operation));
    // Эти сценарии проверяются в отдельных файлах; здесь их ответы не воспроизводятся.
    expect(notCovered).toEqual([]);
  });
});
