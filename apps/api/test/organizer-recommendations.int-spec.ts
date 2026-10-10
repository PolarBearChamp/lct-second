import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { normalize, readPdf } from './helpers/pdf';
import { createCandidate, createEmployer, defaultNeed, fillProfile, invitationBody, publish, startAttempt, submitAttempt, taskBody, uniqueEmail, vacancyBody } from './helpers/factories';

/**
 * Изменения по итогам встречи организаторов с участниками:
 *  - кандидат без подтверждённого грейда виден ниже подтверждённых, с пометкой (вопросы 6 и 20);
 *  - адресное задание конкретному кандидату (вопросы 2 и 53);
 *  - добровольная проверка компании — метка доверия (вопрос 41);
 *  - кандидаты 16–17 лет (вопрос 16).
 * Срок пересдачи 30 дней (вопрос 7) проверяется в assessments.int-spec.
 */
describe('рекомендации организаторов', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.prisma));

  /** Опубликованный кандидат без теста: стек содержит обязательные навыки потребности по умолчанию (sql, postgresql). */
  async function unconfirmedCandidate(profile: Record<string, unknown> = {}) {
    const client = new Client(ctx.app, 'unconfirmed');
    await client.registerAndVerify(ctx.mail, uniqueEmail('unconf'), 'CANDIDATE');
    await fillProfile(client, profile);
    await publish(client);
    const me = await client.get('/auth/me');
    return { client, candidateId: me.body.candidate.profileId as string };
  }

  describe('кандидат без подтверждённого грейда', () => {
    it('виден в банке после подтверждённых своей специализации, без балла и с пометкой; можно скрыть фильтром', async () => {
      const employer = await createEmployer(ctx);
      const confirmed = await createCandidate(ctx, { grade: 'JUNIOR' });
      const unconfirmed = await unconfirmedCandidate();
      expect((await unconfirmed.client.get('/auth/me')).body.candidate).toMatchObject({ discoverable: true, confirmedGrade: null });
      expect((await unconfirmed.client.get('/candidate/profile')).body.discoverability).toMatchObject({ discoverable: true, gradeConfirmed: false });

      const bank = await employer.client.get('/employer/candidates?specialization=BACKEND');
      expect(bank.status).toBe(200);
      expect(bank.body.items.map((i: { candidateId: string }) => i.candidateId)).toEqual([confirmed.candidateId, unconfirmed.candidateId]);
      expect(bank.body.items[1]).toMatchObject({ gradeConfirmed: false, grade: null, declaredGrade: 'MIDDLE', bankScore: null, overallScore: null, category: 'BACKEND:UNCONFIRMED' });

      expect((await employer.client.get('/employer/candidates?specialization=BACKEND&includeUnconfirmed=false')).body.items).toHaveLength(1);
      const only = await employer.client.get('/employer/candidates?category=BACKEND:UNCONFIRMED');
      expect(only.body.items.map((i: { candidateId: string }) => i.candidateId)).toEqual([unconfirmed.candidateId]);
      // Подтверждённая категория не включает неподтверждённых, даже если заявленный грейд совпадает.
      expect((await employer.client.get('/employer/candidates?category=BACKEND:MIDDLE')).body.items).toEqual([]);
    });

    it('в подборке — отдельным блоком после всех подтверждённых, без балла; уточнение по баллу их исключает', async () => {
      const employer = await createEmployer(ctx);
      const confirmed = await createCandidate(ctx, { grade: 'MIDDLE' });
      const unconfirmed = await unconfirmedCandidate();
      const need = await employer.client.post('/employer/needs', defaultNeed());
      const run = await employer.client.post(`/employer/needs/${need.body.id}/selections`, {});
      expect(run.status).toBe(201);
      expect(run.body).toMatchObject({ totalMatched: 1, totalUnconfirmed: 1 });
      expect(run.body.items.map((i: { candidate: { candidateId: string } }) => i.candidate.candidateId)).toEqual([confirmed.candidateId, unconfirmed.candidateId]);
      expect(run.body.items[0]).toMatchObject({ rank: 1, gradeConfirmed: true });
      expect(run.body.items[1]).toMatchObject({ rank: 2, gradeConfirmed: false, score: null });
      expect(run.body.items[1].explanation.notVerified[0]).toContain('Грейд не подтверждён тестом');

      const refined = await employer.client.post(`/employer/needs/${need.body.id}/selections`, { refinements: { minOverallScore: 50 }, parentRunId: run.body.id });
      expect(refined.status).toBe(201);
      expect(refined.body).toMatchObject({ totalMatched: 1, totalUnconfirmed: 0 });

      const card = await employer.client.get(`/employer/candidates/${unconfirmed.candidateId}?needId=${need.body.id}`);
      expect(card.status).toBe(200);
      expect(card.body.match).toMatchObject({ gradeConfirmed: false, passes: true, score: null });
      expect(card.body.profile.qualification).toBeNull();
    });

    it('без публикации профиля не виден; работодатель может пригласить видимого неподтверждённого', async () => {
      const employer = await createEmployer(ctx);
      const hidden = new Client(ctx.app, 'hidden');
      await hidden.registerAndVerify(ctx.mail, uniqueEmail('hidden'), 'CANDIDATE');
      await fillProfile(hidden);
      expect((await employer.client.get('/employer/candidates')).body.items).toEqual([]);

      const visible = await unconfirmedCandidate();
      const invite = await employer.client.post('/employer/invitations', invitationBody(visible.candidateId));
      expect(invite.status).toBe(201);
    });

    it('регулярные задания не предлагаются без подтверждённого грейда — с понятной причиной', async () => {
      const employer = await createEmployer(ctx);
      await employer.client.post('/employer/tasks', taskBody());
      const unconfirmed = await unconfirmedCandidate();
      const overview = await unconfirmed.client.get('/candidate/tasks');
      expect(overview.body).toMatchObject({ current: null, blocker: 'NO_CONFIRMED_QUALIFICATION', direct: [] });
    });
  });

  describe('адресное задание конкретному кандидату', () => {
    it('работодатель отправляет активное задание видимому кандидату — даже без подтверждённого грейда; ответ видит под псевдонимом', async () => {
      const employer = await createEmployer(ctx);
      const task = await employer.client.post('/employer/tasks', taskBody());
      const target = await unconfirmedCandidate();
      const sent = await employer.client.post(`/employer/tasks/${task.body.id}/assign`, { candidateId: target.candidateId, note: 'Хотим посмотреть ваш подход' });
      expect(sent.status).toBe(201);
      expect(sent.body).toMatchObject({ candidateId: target.candidateId, taskId: task.body.id });
      expect((await target.client.get('/auth/me')).body.candidate.pendingDirectTasks).toBe(1);

      const overview = await target.client.get('/candidate/tasks');
      expect(overview.body.current).toBeNull();
      expect(overview.body.direct).toHaveLength(1);
      expect(overview.body.direct[0]).toMatchObject({ source: 'DIRECT', note: 'Хотим посмотреть ваш подход', canSubmit: true });
      const answered = await target.client.post(`/candidate/tasks/${overview.body.direct[0].id}/submit`, { selectedIndex: 1 });
      expect(answered.status).toBe(200);
      expect((await target.client.get('/auth/me')).body.candidate.pendingDirectTasks).toBe(0);

      const submissions = await employer.client.get(`/employer/tasks/${task.body.id}/submissions`);
      expect(submissions.body.items[0]).toMatchObject({ source: 'DIRECT', confirmedGrade: null, isCorrect: true });
      // Повторно то же задание тому же кандидату не отправляется.
      const again = await employer.client.post(`/employer/tasks/${task.body.id}/assign`, { candidateId: target.candidateId });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('TASK_ALREADY_ASSIGNED');
    });

    it('не зависит от недельного периода: у кандидата одновременно регулярное и адресное задание; второе адресное от той же компании — 409', async () => {
      const employer = await createEmployer(ctx);
      await employer.client.post('/employer/tasks', taskBody({ title: 'Регулярное задание' }));
      const person = await createCandidate(ctx);
      const current = (await person.client.get('/candidate/tasks')).body.current;
      expect(current.task.title).toBe('Регулярное задание');
      // Адресные задания создаются после регулярного предложения, поэтому в ротацию этого кандидата не попадают.
      const first = await employer.client.post('/employer/tasks', taskBody({ title: 'Первое адресное задание' }));
      const second = await employer.client.post('/employer/tasks', taskBody({ title: 'Второе адресное задание' }));
      expect((await employer.client.post(`/employer/tasks/${first.body.id}/assign`, { candidateId: person.candidateId })).status).toBe(201);
      const overview = (await person.client.get('/candidate/tasks')).body;
      expect(overview.current.id).toBe(current.id);
      expect(overview.direct.map((t: { task: { title: string } }) => t.task.title)).toEqual(['Первое адресное задание']);
      const pending = await employer.client.post(`/employer/tasks/${second.body.id}/assign`, { candidateId: person.candidateId });
      expect(pending.status).toBe(409);
      expect(pending.body.code).toBe('DIRECT_TASK_PENDING');
    });

    it('черновик, скрытый кандидат и чужое задание — отказ', async () => {
      const owner = await createEmployer(ctx, { name: 'Автор' });
      const intruder = await createEmployer(ctx, { name: 'Посторонний' });
      const draft = await owner.client.post('/employer/tasks', taskBody({ publish: false }));
      const active = await owner.client.post('/employer/tasks', taskBody({ title: 'Активное задание' }));
      const person = await createCandidate(ctx);
      const hidden = await createCandidate(ctx, { publish: false });
      expect((await owner.client.post(`/employer/tasks/${draft.body.id}/assign`, { candidateId: person.candidateId })).body.code).toBe('TASK_NOT_ACTIVE');
      expect((await owner.client.post(`/employer/tasks/${active.body.id}/assign`, { candidateId: hidden.candidateId })).status).toBe(404);
      expect((await intruder.client.post(`/employer/tasks/${active.body.id}/assign`, { candidateId: person.candidateId })).status).toBe(404);
      expect((await owner.client.post(`/employer/tasks/${active.body.id}/assign`, { candidateId: 'not-a-uuid' })).status).toBe(422);
    });
  });

  describe('добровольная проверка компании (метка доверия)', () => {
    it('ИНН из реестра, совпадающее название и домен почты — метка видна кандидату в вакансиях, приглашениях и заданиях', async () => {
      const employer = await createEmployer(ctx);
      const before = await employer.client.get('/employer/company');
      expect(before.body.company).toMatchObject({ verified: false, verification: { status: 'NOT_REQUESTED', checks: [], demo: true } });
      const checked = await employer.client.post('/employer/company/verification', { inn: '0077050050' });
      expect(checked.status).toBe(200);
      expect(checked.body.company).toMatchObject({ verified: true, verification: { status: 'VERIFIED', inn: '0077050050' } });
      expect(checked.body.company.verification.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);

      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      await employer.client.post('/employer/tasks', taskBody());
      const person = await createCandidate(ctx);
      const list = await person.client.get('/candidate/vacancies');
      expect(list.body.items[0].companyVerified).toBe(true);
      expect((await person.client.get(`/candidate/vacancies/${vacancy.body.id}`)).body.company.verified).toBe(true);
      const invitation = await employer.client.post('/employer/invitations', invitationBody(person.candidateId));
      expect((await person.client.get(`/candidate/invitations/${invitation.body.id}`)).body.companyVerified).toBe(true);
      expect((await person.client.get('/candidate/tasks')).body.current.task.companyVerified).toBe(true);
    });

    it('каждая проверка объясняет отказ; формат ИНН — 422; смена названия снимает метку; без проверки всё работает', async () => {
      const employer = await createEmployer(ctx);
      expect((await employer.client.post('/employer/company/verification', { inn: '12345' })).status).toBe(422);
      const badChecksum = await employer.client.post('/employer/company/verification', { inn: '0077050051' });
      expect(badChecksum.body.company.verification.status).toBe('REJECTED');
      expect(badChecksum.body.company.verification.checks.find((c: { code: string }) => c.code === 'INN_FORMAT').passed).toBe(false);
      const unknown = await employer.client.post('/employer/company/verification', { inn: '7707083893' });
      expect(unknown.body.company.verification.checks.filter((c: { passed: boolean }) => !c.passed).map((c: { code: string }) => c.code)).toEqual(['REGISTRY_FOUND', 'NAME_MATCH', 'EMAIL_DOMAIN']);

      expect((await employer.client.post('/employer/company/verification', { inn: '0077050050' })).body.company.verified).toBe(true);
      const renamed = await employer.client.put('/employer/company', { name: 'Новое название', industry: 'FINTECH', contactChannelType: 'EMAIL', contactValue: 'hr@test-company.example' });
      expect(renamed.body.company).toMatchObject({ verified: false, verification: { status: 'NOT_REQUESTED' } });
      // Проверка не блокирует основной сценарий: потребности, подборки и приглашения работают без неё.
      expect((await employer.client.post('/employer/needs', defaultNeed())).status).toBe(201);
    });

    it('почта аккаунта не на домене организации — метка не выдаётся', async () => {
      const client = new Client(ctx.app, 'foreign-employer');
      await client.registerAndVerify(ctx.mail, `hr.${Date.now().toString(36)}@other-domain.example`, 'EMPLOYER');
      await client.put('/employer/company', { name: 'Тест Компания', industry: 'FINTECH', contactChannelType: 'EMAIL', contactValue: 'hr@test-company.example' });
      const result = await client.post('/employer/company/verification', { inn: '0077050050' });
      expect(result.body.company.verification.status).toBe('REJECTED');
      expect(result.body.company.verification.checks.filter((c: { passed: boolean }) => !c.passed).map((c: { code: string }) => c.code)).toEqual(['EMAIL_DOMAIN']);
    });
  });

  describe('несколько подтверждённых категорий (VS.2)', () => {
    const frontendNeed = (overrides: Record<string, unknown> = {}) => defaultNeed({ title: 'Frontend-разработчик', specialization: 'FRONTEND', allowedGrades: ['JUNIOR'], requiredSkills: [], ...overrides });

    /** Кандидат с Backend Middle (активная) и подтверждённым Frontend Junior. */
    async function multiCandidate() {
      const person = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
      const started = await startAttempt(person.client, 'FRONTEND', 'JUNIOR');
      expect(started.status).toBe(201);
      expect((await submitAttempt(ctx, person.client, started.body.id)).body.status).toBe('PASSED');
      return person;
    }

    it('в общем банке — по строке на каждую категорию; в строке видны остальные категории; фильтр по специализации — одна строка', async () => {
      const employer = await createEmployer(ctx);
      const multi = await multiCandidate();
      const single = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });

      const bank = await employer.client.get('/employer/candidates');
      expect(bank.status).toBe(200);
      const rows = bank.body.items.filter((i: { candidateId: string }) => i.candidateId === multi.candidateId);
      expect(rows.map((r: { category: string }) => r.category).sort()).toEqual(['BACKEND:MIDDLE', 'FRONTEND:JUNIOR']);
      const backend = rows.find((r: { category: string }) => r.category === 'BACKEND:MIDDLE');
      const frontend = rows.find((r: { category: string }) => r.category === 'FRONTEND:JUNIOR');
      expect(backend.otherCategories).toEqual([expect.objectContaining({ specialization: 'FRONTEND', grade: 'JUNIOR', gradeTitle: 'Junior' })]);
      expect(frontend.otherCategories).toEqual([expect.objectContaining({ specialization: 'BACKEND', grade: 'MIDDLE' })]);
      expect(frontend).toMatchObject({ specialization: 'FRONTEND', grade: 'JUNIOR', gradeConfirmed: true });
      // Кандидат только с одной категорией — одна строка и пустой список остальных.
      const singleRows = bank.body.items.filter((i: { candidateId: string }) => i.candidateId === single.candidateId);
      expect(singleRows).toHaveLength(1);
      expect(singleRows[0].otherCategories).toEqual([]);

      const onlyFrontend = await employer.client.get('/employer/candidates?specialization=FRONTEND');
      expect(onlyFrontend.body.items.map((i: { candidateId: string; category: string }) => [i.candidateId, i.category])).toEqual([[multi.candidateId, 'FRONTEND:JUNIOR']]);
      expect((await employer.client.get('/employer/candidates?category=FRONTEND:JUNIOR')).body.items).toHaveLength(1);
      expect((await employer.client.get('/employer/candidates?category=BACKEND:MIDDLE')).body.items).toHaveLength(2);
    });

    it('подборка по потребности другой специализации находит кандидата по его подтверждённой категории', async () => {
      const employer = await createEmployer(ctx);
      const multi = await multiCandidate();
      const backendOnly = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
      const need = await employer.client.post('/employer/needs', frontendNeed());
      expect(need.status).toBe(201);
      const run = await employer.client.post(`/employer/needs/${need.body.id}/selections`, {});
      expect(run.status).toBe(201);
      expect(run.body.totalMatched).toBe(1);
      expect(run.body.items.map((i: { candidate: { candidateId: string } }) => i.candidate.candidateId)).toEqual([multi.candidateId]);
      expect(run.body.items[0].candidate).toMatchObject({ specialization: 'FRONTEND', grade: 'JUNIOR', gradeConfirmed: true });
      expect(run.body.items[0].candidate.otherCategories).toEqual([expect.objectContaining({ specialization: 'BACKEND', grade: 'MIDDLE' })]);
      // Повторное открытие сохранённой подборки показывает ту же категорию, а не активную специализацию кандидата.
      const reopened = await employer.client.get(`/employer/selections/${run.body.id}`);
      expect(reopened.body.items[0].candidate).toMatchObject({ specialization: 'FRONTEND', grade: 'JUNIOR' });
      expect(backendOnly.candidateId).not.toBe(multi.candidateId);
    });

    it('карточка показывает категорию потребности (или выбранную специализацию) и остальные; заявленный грейд — только для активной', async () => {
      const employer = await createEmployer(ctx);
      const multi = await multiCandidate();
      const need = await employer.client.post('/employer/needs', frontendNeed());

      const byDefault = await employer.client.get(`/employer/candidates/${multi.candidateId}`);
      expect(byDefault.body.profile.qualification).toMatchObject({ specialization: 'BACKEND', grade: 'MIDDLE' });
      expect(byDefault.body.profile.declaredGrade).toMatchObject({ code: 'MIDDLE' });
      expect(byDefault.body.profile.otherCategories).toEqual([expect.objectContaining({ specialization: 'FRONTEND', grade: 'JUNIOR' })]);

      for (const url of [`?needId=${need.body.id}`, '?specialization=FRONTEND']) {
        const card = await employer.client.get(`/employer/candidates/${multi.candidateId}${url}`);
        expect(card.status).toBe(200);
        expect(card.body.profile.qualification).toMatchObject({ specialization: 'FRONTEND', grade: 'JUNIOR' });
        expect(card.body.profile.specialization.code).toBe('FRONTEND');
        expect(card.body.profile.declaredGrade).toBeNull();
        expect(card.body.profile.otherCategories).toEqual([expect.objectContaining({ specialization: 'BACKEND', grade: 'MIDDLE' })]);
      }
      expect((await employer.client.get(`/employer/candidates/${multi.candidateId}?needId=${need.body.id}`)).body.match).toMatchObject({ gradeConfirmed: true, passes: true });
      // Специализация без подтверждения у кандидата — показывается активная категория.
      const none = await employer.client.get(`/employer/candidates/${multi.candidateId}?specialization=ML_ENGINEER`);
      expect(none.body.profile.qualification).toMatchObject({ specialization: 'BACKEND' });
      expect((await employer.client.get(`/employer/candidates/${multi.candidateId}?specialization=DESIGNER`)).status).toBe(422);
    });

    it('PDF строится той же категорией, что и карточка: по умолчанию активная, с ?specialization — выбранная', async () => {
      const employer = await createEmployer(ctx);
      const multi = await multiCandidate();
      const pdfText = async (query = '') => {
        const res = await employer.client.getBuffer(`/employer/candidates/${multi.candidateId}/pdf${query}`);
        expect(res.status).toBe(200);
        return normalize(readPdf(res.body).text);
      };
      const byDefault = await pdfText();
      expect(byDefault).toContain('Грейд по результатам тестирования: Middle');
      expect(byDefault).toContain('Другие подтверждённые категории: Frontend-разработчик · Junior');
      const frontend = await pdfText('?specialization=FRONTEND');
      expect(frontend).toContain('Грейд по результатам тестирования: Junior');
      expect(frontend).toContain('Другие подтверждённые категории: Backend-разработчик · Middle');
      expect((await employer.client.getBuffer(`/employer/candidates/${multi.candidateId}/pdf?specialization=DESIGNER`)).status).toBe(422);
    });

    it('кандидат без подтверждения во второй специализации в ней не виден; скрытый — нигде', async () => {
      const employer = await createEmployer(ctx);
      const backendOnly = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
      const hidden = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', publish: false });
      expect((await employer.client.get('/employer/candidates?specialization=FRONTEND')).body.items).toEqual([]);
      const ids = (await employer.client.get('/employer/candidates')).body.items.map((i: { candidateId: string }) => i.candidateId);
      expect(ids).toEqual([backendOnly.candidateId]);
      expect(ids).not.toContain(hidden.candidateId);
    });

    it('PDF и JSON одного представления: в PDF указаны остальные категории', async () => {
      const employer = await createEmployer(ctx);
      const multi = await multiCandidate();
      const pdf = await employer.client.getBuffer(`/employer/candidates/${multi.candidateId}/pdf`);
      expect(pdf.status).toBe(200);
      const text = normalize(readPdf(pdf.body).text);
      expect(text).toContain('Другие подтверждённые категории');
      expect(text).toContain('Frontend-разработчик');
    });
  });

  describe('кандидаты 16–17 лет', () => {
    const GUARDIAN = 'Представителева Анна Сергеевна';

    it('без даты рождения профиль неполон; младше 16 не публикуется', async () => {
      const client = new Client(ctx.app, 'young');
      await client.registerAndVerify(ctx.mail, uniqueEmail('young'), 'CANDIDATE');
      await fillProfile(client, { birthDate: null });
      await publish(client);
      expect((await client.get('/auth/me')).body.candidate.discoverabilityIssues.find((i: { code: string }) => i.code === 'PROFILE_INCOMPLETE').missingFields).toContain('birthDate');
      await client.patch('/candidate/profile', { birthDate: '2012-03-01' });
      const me = (await client.get('/auth/me')).body.candidate;
      expect(me.discoverable).toBe(false);
      expect(me.discoverabilityIssues.map((i: { code: string }) => i.code)).toContain('UNDERAGE');
      expect((await client.patch('/candidate/profile', { birthDate: '2030-01-01' })).status).toBe(422);
      expect((await client.patch('/candidate/profile', { birthDate: '01.02.2000' })).status).toBe(422);
    });

    it('16–17 лет: нужен законный представитель; работодатель видит только отметку «16–17 лет» и подтверждает особые условия при приглашении', async () => {
      const employer = await createEmployer(ctx);
      const teen = await createCandidate(ctx, { grade: 'JUNIOR', profile: { birthDate: '2009-06-01' } });
      const issues = (await teen.client.get('/auth/me')).body.candidate.discoverabilityIssues.map((i: { code: string }) => i.code);
      expect(issues).toEqual(['GUARDIAN_CONSENT_REQUIRED']);
      expect((await employer.client.get('/employer/candidates')).body.items).toEqual([]);

      expect((await teen.client.put('/candidate/consents/guardian', { consent: true })).status).toBe(422); // нужно ФИО
      const consent = await teen.client.put('/candidate/consents/guardian', { consent: true, guardianName: GUARDIAN });
      expect(consent.status).toBe(200);
      expect(consent.body.consents.guardian.active).toBe(true);
      expect(consent.body.profile).toMatchObject({ ageGroup: 'MINOR_16_17', guardianName: GUARDIAN, birthDate: '2009-06-01' });
      expect((await teen.client.get('/auth/me')).body.candidate.discoverable).toBe(true);

      const bank = await employer.client.get('/employer/candidates');
      expect(bank.body.items[0]).toMatchObject({ candidateId: teen.candidateId, minor: true });
      const card = await employer.client.get(`/employer/candidates/${teen.candidateId}`);
      expect(card.body.profile.minor).toBe(true);
      // Дата рождения и представитель работодателю не раскрываются.
      for (const body of [bank.body, card.body]) {
        expect(JSON.stringify(body)).not.toContain('2009-06-01');
        expect(JSON.stringify(body)).not.toContain(GUARDIAN);
      }

      const noAck = await employer.client.post('/employer/invitations', invitationBody(teen.candidateId));
      expect(noAck.status).toBe(422);
      expect(noAck.body.code).toBe('MINOR_CONDITIONS_REQUIRED');
      const withAck = await employer.client.post('/employer/invitations', invitationBody(teen.candidateId, { minorConditionsAcknowledged: true }));
      expect(withAck.status).toBe(201);
      expect(withAck.body.minorConditionsAcknowledged).toBe(true);
      expect((await teen.client.get(`/candidate/invitations/${withAck.body.id}`)).body.minorConditionsAcknowledged).toBe(true);

      // Отзыв согласия представителя скрывает профиль.
      await teen.client.put('/candidate/consents/guardian', { consent: false });
      expect((await teen.client.get('/auth/me')).body.candidate.discoverable).toBe(false);
      const events = await ctx.prisma.auditEvent.findMany({ where: { action: { startsWith: 'candidate.guardian_consent' } } });
      expect(JSON.stringify(events)).not.toContain(GUARDIAN);
    });

    it('взрослому согласие представителя не нужно и не принимается; приглашение взрослому — без подтверждения', async () => {
      const employer = await createEmployer(ctx);
      const adult = await createCandidate(ctx);
      const res = await adult.client.put('/candidate/consents/guardian', { consent: true, guardianName: GUARDIAN });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('GUARDIAN_CONSENT_NOT_APPLICABLE');
      const invite = await employer.client.post('/employer/invitations', invitationBody(adult.candidateId));
      expect(invite.status).toBe(201);
      expect(invite.body.minorConditionsAcknowledged).toBe(false);
    });
  });
});
