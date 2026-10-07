import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { createCandidate, createEmployer, vacancyBody } from './helpers/factories';
import { normalize, readPdf } from './helpers/pdf';

const SECRET = {
  name: 'Откликов Тайный Секретович',
  email: 'applicant.person@secret-mail.example',
  phone: '+7 922 111-22-33',
  messenger: '@applicant_handle',
};

describe('вакансии и самостоятельные отклики', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.prisma));

  const leaks = (value: unknown) => Object.values(SECRET).filter((secret) => JSON.stringify(value).includes(secret));

  async function applicant(options: { channels?: string[]; grade?: 'JUNIOR' | 'MIDDLE' | 'SENIOR'; publish?: boolean; skipAssessment?: boolean; profile?: Record<string, unknown> } = {}) {
    return createCandidate(ctx, {
      specialization: 'BACKEND',
      grade: options.grade ?? 'MIDDLE',
      publish: options.publish,
      skipAssessment: options.skipAssessment,
      profile: {
        fullName: SECRET.name,
        contactEmail: SECRET.email,
        phone: SECRET.phone,
        messenger: SECRET.messenger,
        externalLinks: ['https://example.org/applicant-portfolio'],
        experienceDescription: 'Работал в закрытой компании над секретным проектом.',
        disclosureChannels: options.channels ?? ['EMAIL'],
        ...options.profile,
      },
    });
  }

  const apply = (client: Awaited<ReturnType<typeof applicant>>['client'], vacancyId: string, body: Record<string, unknown> = { confirmDisclosure: true }) =>
    client.post(`/candidate/vacancies/${vacancyId}/applications`, body);

  describe('публикация вакансии работодателем', () => {
    it('зарплатная вилка обязательна и в вакансии: нет вилки, from > to, не GROSS, нулевые значения — отказ', async () => {
      const employer = await createEmployer(ctx);
      const body = vacancyBody() as Record<string, unknown>;
      const without = { ...body };
      delete without.salaryFrom;
      delete without.salaryTo;
      expect((await employer.client.post('/employer/vacancies', without)).status).toBe(422);
      expect((await employer.client.post('/employer/vacancies', vacancyBody({ salaryFrom: 400_000, salaryTo: 300_000 }))).status).toBe(422);
      expect((await employer.client.post('/employer/vacancies', vacancyBody({ salaryType: 'NET' }))).status).toBe(422);
      expect((await employer.client.post('/employer/vacancies', vacancyBody({ salaryFrom: 0 }))).status).toBe(422);
      expect((await employer.client.post('/employer/vacancies', vacancyBody({ salaryTo: 300_000.5 }))).status).toBe(422);
      expect((await employer.client.get('/employer/vacancies')).body).toEqual([]);
    });

    it('требования проверяются как у потребности: неизвестный навык, непроверяемый обязательный навык, город для офиса', async () => {
      const employer = await createEmployer(ctx);
      const unknown = await employer.client.post('/employer/vacancies', vacancyBody({ requiredSkills: ['no-such-skill'] }));
      expect(unknown.status).toBe(422);
      expect(unknown.body.details.fields.requiredSkills).toBeDefined();
      const noCity = await employer.client.post('/employer/vacancies', vacancyBody({ workFormat: 'OFFICE', city: null }));
      expect(noCity.status).toBe(422);
      expect(noCity.body.details.fields.city).toBeDefined();
      const foreignNeed = await employer.client.post('/employer/vacancies', vacancyBody({ needId: '00000000-0000-4000-8000-000000000000' }));
      expect(foreignNeed.status).toBe(404);
    });

    it('черновик не виден кандидатам; публикация открывает вакансию; закрытие прекращает приём откликов; повторное открытие возвращает', async () => {
      const employer = await createEmployer(ctx, { name: 'Компания Альфа' });
      const candidate = await applicant();
      const draft = await employer.client.post('/employer/vacancies', vacancyBody({ publish: false }));
      expect(draft.status).toBe(201);
      expect(draft.body).toMatchObject({ status: 'DRAFT', version: 1, publishedAt: null, applicationsCount: 0, salaryType: 'GROSS' });

      expect((await candidate.client.get('/candidate/vacancies')).body.items).toEqual([]);
      expect((await candidate.client.get(`/candidate/vacancies/${draft.body.id}`)).status).toBe(404);
      expect((await apply(candidate.client, draft.body.id)).status).toBe(404);
      // Закрыть черновик нельзя.
      const closeDraft = await employer.client.post(`/employer/vacancies/${draft.body.id}/close`);
      expect(closeDraft.status).toBe(409);
      expect(closeDraft.body.code).toBe('VACANCY_NOT_PUBLISHED');

      const published = await employer.client.post(`/employer/vacancies/${draft.body.id}/publish`);
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('PUBLISHED');
      expect(published.body.publishedAt).not.toBeNull();
      expect((await employer.client.post(`/employer/vacancies/${draft.body.id}/publish`)).body.status).toBe('PUBLISHED'); // идемпотентно

      const listed = await candidate.client.get('/candidate/vacancies');
      expect(listed.body.total).toBe(1);
      // Зарплата и компания видны ДО отклика.
      expect(listed.body.items[0]).toMatchObject({ title: draft.body.title, companyName: 'Компания Альфа', salaryFrom: 200_000, salaryTo: 300_000, salaryType: 'GROSS', myApplication: null, canApply: true });

      const closed = await employer.client.post(`/employer/vacancies/${draft.body.id}/close`);
      expect(closed.body).toMatchObject({ status: 'CLOSED' });
      expect((await employer.client.post(`/employer/vacancies/${draft.body.id}/close`)).body.status).toBe('CLOSED'); // идемпотентно
      expect((await candidate.client.get('/candidate/vacancies')).body.items).toEqual([]);
      const lateApply = await apply(candidate.client, draft.body.id);
      expect(lateApply.status).toBe(409);
      expect(lateApply.body.code).toBe('VACANCY_CLOSED');
      // Закрытую вакансию без откликов кандидат не видит.
      expect((await candidate.client.get(`/candidate/vacancies/${draft.body.id}`)).status).toBe(404);

      const reopened = await employer.client.post(`/employer/vacancies/${draft.body.id}/publish`);
      expect(reopened.body).toMatchObject({ status: 'PUBLISHED', closedAt: null });
      expect((await apply(candidate.client, draft.body.id)).status).toBe(201);
    });

    it('правка создаёт новую версию; отклик хранит снимок вакансии на момент подачи', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant();
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody({ title: 'Исходное название' }));
      const application = await apply(candidate.client, vacancy.body.id);
      expect(application.status).toBe(201);

      const edited = await employer.client.patch(`/employer/vacancies/${vacancy.body.id}`, { title: 'Новое название', salaryFrom: 250_000, salaryTo: 350_000 });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ title: 'Новое название', version: 2, salaryFrom: 250_000 });
      expect((await employer.client.patch(`/employer/vacancies/${vacancy.body.id}`, { salaryFrom: 500_000 })).status).toBe(422); // from > to

      const mine = await candidate.client.get(`/candidate/applications/${application.body.id}`);
      expect(mine.body).toMatchObject({ vacancyTitle: 'Исходное название', salaryFrom: 200_000, salaryTo: 300_000 });
      const seen = await employer.client.get(`/employer/applications/${application.body.id}`);
      expect(seen.body).toMatchObject({ vacancyTitle: 'Исходное название', vacancyCurrentVersion: 2 });
    });
  });

  describe('витрина вакансий для кандидата', () => {
    it('фильтры по специализации, формату, грейду, городу и тексту; удалённые вакансии подходят любому городу; пагинация стабильна', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant();
      const make = (overrides: Record<string, unknown>) => employer.client.post('/employer/vacancies', vacancyBody(overrides));
      await make({ title: 'Backend удалённо' });
      await make({ title: 'Backend офис Казань', workFormat: 'OFFICE', city: 'Казань' });
      await make({ title: 'Backend офис Москва', workFormat: 'OFFICE', city: 'Москва', allowedGrades: ['JUNIOR'] });
      await make({ title: 'Frontend удалённо', specialization: 'FRONTEND', requiredSkills: ['javascript'], preferredSkills: [] });

      const all = await candidate.client.get('/candidate/vacancies');
      expect(all.body.total).toBe(4);
      const titles = (res: { body: { items: Array<{ title: string }> } }) => res.body.items.map((i) => i.title).sort();
      expect(titles(await candidate.client.get('/candidate/vacancies?specialization=FRONTEND'))).toEqual(['Frontend удалённо']);
      expect(titles(await candidate.client.get('/candidate/vacancies?workFormat=OFFICE'))).toEqual(['Backend офис Казань', 'Backend офис Москва']);
      expect(titles(await candidate.client.get('/candidate/vacancies?grade=JUNIOR'))).toEqual(['Backend офис Москва']);
      expect(titles(await candidate.client.get(`/candidate/vacancies?city=${encodeURIComponent('казань')}`))).toEqual(['Backend офис Казань', 'Backend удалённо', 'Frontend удалённо']);
      expect(titles(await candidate.client.get(`/candidate/vacancies?q=${encodeURIComponent('МОСКВА')}`))).toEqual(['Backend офис Москва']);
      expect(titles(await candidate.client.get('/candidate/vacancies?onlyMine=true'))).toEqual(['Backend офис Казань', 'Backend офис Москва', 'Backend удалённо']);
      expect((await candidate.client.get('/candidate/vacancies?pageSize=51')).status).toBe(422);
      expect((await candidate.client.get('/candidate/vacancies?workFormat=MOON')).status).toBe(422);

      const page1 = await candidate.client.get('/candidate/vacancies?pageSize=3&page=1');
      const page2 = await candidate.client.get('/candidate/vacancies?pageSize=3&page=2');
      const seen = [...page1.body.items, ...page2.body.items].map((i: { id: string }) => i.id);
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
    });

    it('соответствие считается по подтверждённым данным и не блокирует отклик: грейд вне допустимых — предупреждение', async () => {
      const employer = await createEmployer(ctx);
      const junior = await applicant({ grade: 'JUNIOR' });
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const detail = await junior.client.get(`/candidate/vacancies/${vacancy.body.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.fit.passes).toBe(false);
      expect(detail.body.fit.violations).toContain('подтверждённый грейд вне допустимых');
      expect(detail.body.canApply).toBe(true);
      expect(detail.body.blockers).toEqual([]);
      // Перед откликом показывается, что именно будет раскрыто — только выбранные каналы.
      expect(detail.body.disclosure.channels).toEqual([{ channel: 'EMAIL', value: SECRET.email }]);
      expect(JSON.stringify(detail.body)).not.toContain(SECRET.phone);

      const middle = await applicant({ grade: 'MIDDLE' });
      const fit = (await middle.client.get(`/candidate/vacancies/${vacancy.body.id}`)).body.fit;
      expect(fit.passes).toBe(true);
      expect(fit.score).toBeGreaterThan(0);
      expect(fit.explanation.passedRequirements.length).toBeGreaterThan(0);
    });

    it('без подтверждённой квалификации по специализации вакансии отклик закрыт; квалификация другой специализации не подходит', async () => {
      const employer = await createEmployer(ctx);
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const unqualified = await applicant({ skipAssessment: true });
      const detail = await unqualified.client.get(`/candidate/vacancies/${vacancy.body.id}`);
      expect(detail.body.canApply).toBe(false);
      expect(detail.body.blockers.map((b: { code: string }) => b.code)).toContain('QUALIFICATION_REQUIRED');
      const rejected = await apply(unqualified.client, vacancy.body.id);
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe('QUALIFICATION_REQUIRED');
      expect(await ctx.prisma.application.count()).toBe(0);
      expect(await ctx.prisma.contactAccessGrant.count()).toBe(0);

      const frontendOnly = await createCandidate(ctx, { specialization: 'FRONTEND', grade: 'MIDDLE' });
      const wrong = await apply(frontendOnly.client, vacancy.body.id);
      expect(wrong.status).toBe(409);
      expect(wrong.body.code).toBe('QUALIFICATION_REQUIRED');
    });

    it('неполный профиль и отсутствие канала раскрытия перечислены как препятствия', async () => {
      const employer = await createEmployer(ctx);
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const noChannel = await applicant({ channels: [] });
      const detail = await noChannel.client.get(`/candidate/vacancies/${vacancy.body.id}`);
      expect(detail.body.canApply).toBe(false);
      expect(detail.body.blockers.map((b: { code: string }) => b.code)).toEqual(['NO_CONTACT_CHANNEL']);
      expect((await apply(noChannel.client, vacancy.body.id)).body.code).toBe('NO_CONTACT_CHANNEL');

      const incomplete = await applicant();
      expect((await incomplete.client.patch('/candidate/profile', { city: null })).status).toBe(200);
      const blocked = await apply(incomplete.client, vacancy.body.id);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('PROFILE_INCOMPLETE');
      expect(blocked.body.details.blockers[0].missingFields).toContain('city');
    });
  });

  describe('отклик и раскрытие контактов', () => {
    it('отклик требует явного подтверждения раскрытия; без него ничего не создаётся', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant();
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      expect((await apply(candidate.client, vacancy.body.id, {})).status).toBe(422);
      expect((await apply(candidate.client, vacancy.body.id, { confirmDisclosure: false })).status).toBe(422);
      expect((await apply(candidate.client, vacancy.body.id, { confirmDisclosure: true, coverNote: 'x'.repeat(1001) })).status).toBe(422);
      expect(await ctx.prisma.application.count()).toBe(0);
      expect(await ctx.prisma.contactAccessGrant.count()).toBe(0);
    });

    it('отклик раскрывает выбранные каналы только этой компании — в JSON и в PDF; другая компания по-прежнему видит обезличенную карточку', async () => {
      const a = await createEmployer(ctx, { name: 'Компания Альфа' });
      const b = await createEmployer(ctx, { name: 'Компания Бета' });
      const candidate = await applicant({ channels: ['EMAIL'] });
      const vacancy = await a.client.post('/employer/vacancies', vacancyBody());
      await b.client.post('/employer/vacancies', vacancyBody({ title: 'Вакансия Беты' }));

      // До отклика у компании только обезличенная карточка.
      const before = await a.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(before.body.profile.mode).toBe('EMPLOYER_REDACTED');
      expect(leaks(before.body)).toEqual([]);

      const created = await apply(candidate.client, vacancy.body.id, { confirmDisclosure: true, coverNote: 'Работал с платёжными API.' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        status: 'SENT',
        vacancyTitle: vacancy.body.title,
        companyName: 'Компания Альфа',
        salaryFrom: 200_000,
        coverNote: 'Работал с платёжными API.',
        canWithdraw: true,
        contactAccess: { active: true, channels: ['EMAIL'] },
      });
      expect(await ctx.prisma.contactAccessGrant.count()).toBe(1);

      const granted = await a.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(granted.body.profile.mode).toBe('EMPLOYER_GRANTED');
      expect(granted.body.profile.contacts).toEqual([{ channel: 'EMAIL', value: SECRET.email }]);
      expect(granted.body.profile.personal.fullName).toBe(SECRET.name);
      expect(JSON.stringify(granted.body)).not.toContain(SECRET.phone);
      expect(JSON.stringify(granted.body)).not.toContain(SECRET.messenger);
      const grantedPdf = normalize(readPdf((await a.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`)).body).text);
      expect(grantedPdf).toContain(SECRET.email);
      expect(grantedPdf).not.toContain(SECRET.phone);

      const other = await b.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(other.body.profile.mode).toBe('EMPLOYER_REDACTED');
      expect(leaks(other.body)).toEqual([]);
      const otherPdf = normalize(readPdf((await b.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`)).body).text);
      expect(otherPdf).not.toContain('Откликов');
      expect(otherPdf).not.toContain(SECRET.email);

      // Отклик на вакансию Беты у компании Беты не виден компании Альфа.
      const grants = await candidate.client.get('/candidate/contact-access');
      expect(grants.body).toEqual([expect.objectContaining({ companyId: a.companyId, active: true, sourceInvitationId: null, sourceApplicationId: created.body.id })]);
    });

    it('кандидат, не публиковавший профиль, может откликнуться: доступ нужен только откликнувшейся компании, в общий поиск он не попадает', async () => {
      const a = await createEmployer(ctx);
      const b = await createEmployer(ctx);
      const candidate = await applicant({ publish: false });
      const vacancy = await a.client.post('/employer/vacancies', vacancyBody());
      expect((await b.client.get(`/employer/candidates/${candidate.candidateId}`)).status).toBe(404); // скрыт для всех
      const created = await apply(candidate.client, vacancy.body.id);
      expect(created.status).toBe(201);
      expect((await a.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_GRANTED');
      expect((await b.client.get(`/employer/candidates/${candidate.candidateId}`)).status).toBe(404);
      expect((await b.client.get('/employer/candidates?specialization=BACKEND')).body.total).toBe(0);
    });

    it('повторный и параллельный отклик на ту же вакансию: ровно один активный отклик', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant();
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const results = await Promise.all([apply(candidate.client, vacancy.body.id), apply(candidate.client, vacancy.body.id), apply(candidate.client, vacancy.body.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const conflicts = results.filter((r) => r.status === 409);
      expect(conflicts.every((r) => r.body.code === 'ACTIVE_APPLICATION_EXISTS')).toBe(true);
      expect(await ctx.prisma.application.count()).toBe(1);
      const again = await apply(candidate.client, vacancy.body.id);
      expect(again.status).toBe(409);
      expect(again.body.details.applicationId).toBeDefined();
      const detail = await candidate.client.get(`/candidate/vacancies/${vacancy.body.id}`);
      expect(detail.body.myApplication).toMatchObject({ status: 'SENT' });
      expect(detail.body.canApply).toBe(false);
    });
  });

  describe('работа работодателя с откликами', () => {
    async function scene() {
      const employer = await createEmployer(ctx, { name: 'Компания Альфа' });
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const strong = await applicant({ grade: 'MIDDLE', profile: { fullName: 'Сильный Кандидат Первый' } });
      const weak = await applicant({ grade: 'JUNIOR', profile: { fullName: 'Слабый Кандидат Второй' } });
      const strongApp = await apply(strong.client, vacancy.body.id); // откликнулся раньше
      ctx.clock.advanceHours(1);
      const weakApp = await apply(weak.client, vacancy.body.id);
      return { employer, vacancy: vacancy.body as { id: string }, strong, weak, weakApp: weakApp.body, strongApp: strongApp.body };
    }

    it('список по умолчанию — по соответствию: подходящие выше, с причинами несоответствия у остальных; по дате — новые выше', async () => {
      const { employer, vacancy, strongApp, weakApp } = await scene();
      const byFit = await employer.client.get(`/employer/vacancies/${vacancy.id}/applications`);
      expect(byFit.status).toBe(200);
      expect(byFit.body.total).toBe(2);
      expect(byFit.body.items.map((i: { id: string }) => i.id)).toEqual([strongApp.id, weakApp.id]);
      expect(byFit.body.items[0].fit).toMatchObject({ passes: true, violations: [] });
      expect(byFit.body.items[0].fit.score).toBeGreaterThan(0);
      expect(byFit.body.items[1].fit).toMatchObject({ passes: false, score: null });
      expect(byFit.body.items[1].fit.violations).toContain('подтверждённый грейд вне допустимых');
      expect(byFit.body.items[0]).toMatchObject({ gradeTitle: 'Middle', hasContactAccess: true, status: 'SENT' });
      expect(byFit.body.items[0].overallScore).toBeGreaterThan(0);

      const byDate = await employer.client.get(`/employer/vacancies/${vacancy.id}/applications?sort=DATE`);
      expect(byDate.body.items.map((i: { id: string }) => i.id)).toEqual([weakApp.id, strongApp.id]); // новые выше
      // Счётчики вакансии.
      const counted = await employer.client.get(`/employer/vacancies/${vacancy.id}`);
      expect(counted.body).toMatchObject({ applicationsCount: 2, newApplicationsCount: 2, activeApplicationsCount: 2 });
    });

    it('чтение списка и карточки статус не меняет; «просмотрено» ставится только явным действием; решения атомарны и идемпотентны', async () => {
      const { employer, vacancy, strongApp } = await scene();
      await employer.client.get(`/employer/vacancies/${vacancy.id}/applications`);
      const opened = await employer.client.get(`/employer/applications/${strongApp.id}`);
      expect(opened.body.status).toBe('SENT');
      expect(opened.body.profile.mode).toBe('EMPLOYER_GRANTED');
      expect(opened.body.profile.contacts).toEqual([{ channel: 'EMAIL', value: SECRET.email }]);
      expect(opened.body.coverNote).toBeNull();
      expect(opened.body.fit.explanation.components).toBeDefined();
      expect(opened.body.canDecide).toBe(true);

      const viewed = await employer.client.post(`/employer/applications/${strongApp.id}/view`);
      expect(viewed.body.status).toBe('VIEWED');
      expect((await employer.client.post(`/employer/applications/${strongApp.id}/view`)).body.status).toBe('VIEWED'); // повтор
      const shortlisted = await employer.client.post(`/employer/applications/${strongApp.id}/shortlist`);
      expect(shortlisted.body.status).toBe('SHORTLISTED');
      expect((await employer.client.post(`/employer/applications/${strongApp.id}/shortlist`)).body.status).toBe('SHORTLISTED'); // идемпотентно
      expect(shortlisted.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['SENT', 'VIEWED', 'SHORTLISTED']);
      // Просмотр после решения статус не откатывает.
      expect((await employer.client.post(`/employer/applications/${strongApp.id}/view`)).body.status).toBe('SHORTLISTED');

      const rejected = await employer.client.post(`/employer/applications/${strongApp.id}/reject`);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', canDecide: false });
      const afterFinal = await employer.client.post(`/employer/applications/${strongApp.id}/shortlist`);
      expect(afterFinal.status).toBe(409);
      expect(afterFinal.body.code).toBe('APPLICATION_FINAL');
      expect((await employer.client.post(`/employer/applications/${strongApp.id}/reject`)).body.status).toBe('REJECTED'); // идемпотентно
    });

    it('кандидат видит обновления статуса своего отклика, но не данные других откликов', async () => {
      const { employer, strong, weak, strongApp, weakApp } = await scene();
      await employer.client.post(`/employer/applications/${strongApp.id}/shortlist`);
      const mine = await strong.client.get('/candidate/applications');
      expect(mine.body.total).toBe(1);
      expect(mine.body.items[0]).toMatchObject({ id: strongApp.id, status: 'SHORTLISTED' });
      const detail = await strong.client.get(`/candidate/applications/${strongApp.id}`);
      expect(detail.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['SENT', 'SHORTLISTED']);
      expect(detail.body.companyContact).toEqual({ type: 'EMAIL', value: 'hr@test-company.example' });
      expect((await strong.client.get(`/candidate/applications/${weakApp.id}`)).status).toBe(404);
      expect((await weak.client.get(`/candidate/applications/${strongApp.id}`)).status).toBe(404);
      expect((await weak.client.post(`/candidate/applications/${strongApp.id}/withdraw`, {})).status).toBe(404);
    });

    it('параллельно «в шорт-лист» и «отозвать»: побеждает одно действие, второе получает 409 или тот же итог', async () => {
      const { employer, strong, strongApp } = await scene();
      const [shortlist, withdraw] = await Promise.all([
        employer.client.post(`/employer/applications/${strongApp.id}/shortlist`),
        strong.client.post(`/candidate/applications/${strongApp.id}/withdraw`, {}),
      ]);
      const final = await ctx.prisma.application.findUniqueOrThrow({ where: { id: strongApp.id } });
      expect(['SHORTLISTED', 'WITHDRAWN']).toContain(final.status);
      // Одновременно 200 и 200 возможно только если шорт-лист успел раньше отзыва (SHORTLISTED → WITHDRAWN допустим).
      expect([shortlist.status, withdraw.status].every((s) => s === 200 || s === 409)).toBe(true);
      const events = await ctx.prisma.applicationEvent.findMany({ where: { applicationId: strongApp.id }, orderBy: { occurredAt: 'asc' } });
      expect(events.filter((e) => e.toStatus === final.status)).toHaveLength(1);
    });
  });

  describe('отзыв отклика и доступ к контактам', () => {
    it('по умолчанию отзыв отклика доступ сохраняет, с revokeContactAccess — закрывает; контакты пропадают из JSON и PDF', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant({ publish: false });
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const created = await apply(candidate.client, vacancy.body.id);

      const kept = await candidate.client.post(`/candidate/applications/${created.body.id}/withdraw`, {});
      expect(kept.status).toBe(200);
      expect(kept.body).toMatchObject({ status: 'WITHDRAWN', canWithdraw: false, contactAccess: { active: true } });
      expect((await employer.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_GRANTED');

      const revoked = await candidate.client.post(`/candidate/applications/${created.body.id}/withdraw`, { revokeContactAccess: true });
      expect(revoked.status).toBe(200); // повтор отзыва идемпотентен, но закрывает доступ
      expect(revoked.body.contactAccess.active).toBe(false);
      const card = await employer.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(card.status).toBe(404); // кандидат не публиковал профиль, доступ закрыт
      const detail = await employer.client.get(`/employer/applications/${created.body.id}`);
      expect(detail.body.profile).toBeNull();
      expect(detail.body.status).toBe('WITHDRAWN');
      expect(leaks(detail.body)).toEqual([]);
      const list = await employer.client.get(`/employer/vacancies/${vacancy.body.id}/applications`);
      expect(list.body.items[0]).toMatchObject({ hasContactAccess: false });
      expect(list.body.items[0].candidateName).toMatch(/^Кандидат /);
      expect(leaks(list.body)).toEqual([]);

      // Отозванный отклик нельзя ни отклонить, ни взять в шорт-лист; новый отклик — новое осознанное согласие.
      expect((await employer.client.post(`/employer/applications/${created.body.id}/reject`)).status).toBe(409);
      expect((await candidate.client.post(`/candidate/applications/${created.body.id}/withdraw`, {})).status).toBe(200);
      const fresh = await apply(candidate.client, vacancy.body.id);
      expect(fresh.status).toBe(201);
      expect(fresh.body.contactAccess.active).toBe(true);
      expect(await ctx.prisma.application.count()).toBe(2);
    });

    it('отклонённый работодателем отклик отозвать нельзя (409); отзыв доступа в «Приватность» закрывает контакты и после отклика', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant({ publish: false });
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const created = await apply(candidate.client, vacancy.body.id);
      await employer.client.post(`/employer/applications/${created.body.id}/reject`);
      const late = await candidate.client.post(`/candidate/applications/${created.body.id}/withdraw`, {});
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('APPLICATION_FINAL');

      const revoked = await candidate.client.delete(`/candidate/contact-access/${employer.companyId}`);
      expect(revoked.body[0]).toMatchObject({ active: false });
      expect((await employer.client.get(`/employer/applications/${created.body.id}`)).body.profile).toBeNull();
    });

    it('вакансию закрыли после отклика: отклик остаётся в работе, кандидат видит вакансию из своего отклика', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant();
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const created = await apply(candidate.client, vacancy.body.id);
      await employer.client.post(`/employer/vacancies/${vacancy.body.id}/close`);
      expect((await candidate.client.get(`/candidate/vacancies/${vacancy.body.id}`)).body).toMatchObject({ status: 'CLOSED', canApply: false });
      expect((await candidate.client.get(`/candidate/applications/${created.body.id}`)).body).toMatchObject({ vacancyStatus: 'CLOSED', canWithdraw: true });
      expect((await employer.client.post(`/employer/applications/${created.body.id}/shortlist`)).body.status).toBe('SHORTLISTED');
      expect((await employer.client.get('/employer/vacancies?status=CLOSED')).body).toHaveLength(1);
    });
  });

  describe('изоляция и аудит', () => {
    it('работодатель не видит и не меняет вакансии и отклики другой компании; чужие идентификаторы — 404', async () => {
      const owner = await createEmployer(ctx, { name: 'Владелец' });
      const intruder = await createEmployer(ctx, { name: 'Посторонний' });
      const candidate = await applicant();
      const vacancy = await owner.client.post('/employer/vacancies', vacancyBody({ title: 'Закрытая вакансия' }));
      const created = await apply(candidate.client, vacancy.body.id);
      const attempts: Array<[string, () => Promise<{ status: number }>]> = [
        ['GET vacancy', () => intruder.client.get(`/employer/vacancies/${vacancy.body.id}`)],
        ['PATCH vacancy', () => intruder.client.patch(`/employer/vacancies/${vacancy.body.id}`, { title: 'Взлом' })],
        ['publish', () => intruder.client.post(`/employer/vacancies/${vacancy.body.id}/publish`)],
        ['close', () => intruder.client.post(`/employer/vacancies/${vacancy.body.id}/close`)],
        ['list applications', () => intruder.client.get(`/employer/vacancies/${vacancy.body.id}/applications`)],
        ['GET application', () => intruder.client.get(`/employer/applications/${created.body.id}`)],
        ['view', () => intruder.client.post(`/employer/applications/${created.body.id}/view`)],
        ['shortlist', () => intruder.client.post(`/employer/applications/${created.body.id}/shortlist`)],
        ['reject', () => intruder.client.post(`/employer/applications/${created.body.id}/reject`)],
      ];
      for (const [name, attempt] of attempts) expect([name, (await attempt()).status]).toEqual([name, 404]);
      expect((await owner.client.get(`/employer/vacancies/${vacancy.body.id}`)).body.title).toBe('Закрытая вакансия');
      expect((await owner.client.get(`/employer/applications/${created.body.id}`)).body.status).toBe('SENT');
      expect((await intruder.client.get('/employer/vacancies')).body).toEqual([]);
      // Чужая компания не получила доступа к контактам.
      expect((await intruder.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_REDACTED');
    });

    it('ключевые действия попадают в журнал аудита без персональных данных', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant();
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      const created = await apply(candidate.client, vacancy.body.id, { confirmDisclosure: true, coverNote: 'Секретное сообщение для компании' });
      await employer.client.get(`/employer/applications/${created.body.id}`);
      await employer.client.post(`/employer/applications/${created.body.id}/shortlist`);
      await candidate.client.post(`/candidate/applications/${created.body.id}/withdraw`, { revokeContactAccess: true });
      const events = await ctx.prisma.auditEvent.findMany({ where: { action: { startsWith: 'vacancy.' } } });
      const apps = await ctx.prisma.auditEvent.findMany({ where: { action: { startsWith: 'application.' } } });
      expect(events.map((e) => e.action)).toEqual(['vacancy.created']);
      expect(apps.map((e) => e.action)).toEqual(expect.arrayContaining(['application.submitted', 'application.shortlisted', 'application.withdrawn']));
      const text = JSON.stringify([...events, ...apps]);
      for (const secret of [...Object.values(SECRET), 'Секретное сообщение']) expect(text).not.toContain(secret);
      expect((await ctx.prisma.auditEvent.findMany({ where: { action: 'contact_access.revoked' } })).length).toBeGreaterThanOrEqual(1);
    });

    it('кандидату закрыт раздел работодателя, работодателю — раздел кандидата (403 FORBIDDEN_ROLE)', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant();
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      expect((await candidate.client.get('/employer/vacancies')).body.code).toBe('FORBIDDEN_ROLE');
      expect((await candidate.client.post('/employer/vacancies', vacancyBody())).status).toBe(403);
      expect((await employer.client.get('/candidate/vacancies')).body.code).toBe('FORBIDDEN_ROLE');
      expect((await employer.client.post(`/candidate/vacancies/${vacancy.body.id}/applications`, { confirmDisclosure: true })).status).toBe(403);
    });

    it('счётчик новых откликов в /auth/me растёт и обнуляется после просмотра', async () => {
      const employer = await createEmployer(ctx);
      const candidate = await applicant();
      const vacancy = await employer.client.post('/employer/vacancies', vacancyBody());
      expect((await employer.client.get('/auth/me')).body.employer.newApplications).toBe(0);
      const created = await apply(candidate.client, vacancy.body.id);
      expect((await employer.client.get('/auth/me')).body.employer.newApplications).toBe(1);
      await employer.client.post(`/employer/applications/${created.body.id}/view`);
      expect((await employer.client.get('/auth/me')).body.employer.newApplications).toBe(0);
    });
  });
});
