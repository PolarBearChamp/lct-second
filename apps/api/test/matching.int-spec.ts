import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { createCandidate, createEmployer, defaultNeed, uniqueEmail } from './helpers/factories';

interface SelectionItem {
  rank: number;
  unavailable: boolean;
  score?: number;
  candidate?: { candidateId: string; alias: string };
  explanation?: { why: string[]; notVerified: string[]; components: Record<string, { value: number; weight: number; contribution: number }> };
}

describe('подбор: жёсткие условия, ранжирование, объяснения, сохранение подборок', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const ids = (items: SelectionItem[]) => items.filter((i) => !i.unavailable).map((i) => i.candidate!.candidateId);

  async function buildSelection(employer: Client, needBody: Record<string, unknown> = defaultNeed(), refinements: Record<string, unknown> = {}) {
    const need = await employer.post('/employer/needs', needBody);
    expect(need.status).toBe(201);
    const run = await employer.post(`/employer/needs/${need.body.id}/selections`, { refinements });
    expect(run.status).toBe(201);
    return { needId: need.body.id as string, run: run.body };
  }

  describe('обязательные условия не обходятся ни баллом, ни ФСП', () => {
    let employer: Client;
    let good: string;
    let juniorOnly: string;
    let frontend: string;
    let expensive: string;
    let famous: string;
    let selfReported: string;

    beforeAll(async () => {
      await resetDatabase(ctx.prisma);
      employer = (await createEmployer(ctx)).client;
      good = (await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' })).candidateId;
      juniorOnly = (await createCandidate(ctx, { specialization: 'BACKEND', grade: 'JUNIOR' })).candidateId;
      frontend = (await createCandidate(ctx, { specialization: 'FRONTEND', grade: 'MIDDLE' })).candidateId;
      expensive = (await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', profile: { salaryFrom: 500_000, salaryTo: 600_000 } })).candidateId;
      const famousCandidate = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'SENIOR' });
      famous = famousCandidate.candidateId;
      // Привязка ФСП с богатой историей (демонстрационный участник FSP-DEMO-1001) …
      const fsp = await famousCandidate.client.post('/candidate/fsp-link', { fspId: 'FSP-DEMO-1001', code: '731905' });
      expect(fsp.status).toBe(201);
      expect(fsp.body.state).toBe('LINKED_WITH_HISTORY');
      // … и фикстура границы: у этого кандидата тестом не подтверждён postgresql (обязательный навык потребности).
      await ctx.prisma.candidateQualification.update({
        where: { candidateId_specializationCode: { candidateId: famous, specializationCode: 'BACKEND' } },
        data: { verifiedSkills: { set: ['sql'] }, overallScore: 100 },
      });
      selfReported = (await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', profile: { skills: [{ code: 'postgresql' }, { code: 'sql' }, { code: 'kafka' }] } })).candidateId;
      await ctx.prisma.candidateQualification.update({
        where: { candidateId_specializationCode: { candidateId: selfReported, specializationCode: 'BACKEND' } },
        data: { verifiedSkills: { set: ['sql'] } },
      });
    });

    it('в подборку попадают только подходящие: нужный грейд, специализация, навыки, вилка', async () => {
      const { run } = await buildSelection(employer);
      expect(ids(run.items)).toEqual([good]);
      // Рассматриваются опубликованные кандидаты с подтверждением по специализации потребности (frontend отсечён сразу).
      expect(run.totalConsidered).toBe(5);
      expect(run.totalMatched).toBe(1);
      for (const excluded of [juniorOnly, frontend, expensive, famous, selfReported]) expect(ids(run.items)).not.toContain(excluded);
    });

    it('ФСП и высокий балл не компенсируют провал обязательного условия', async () => {
      const { run } = await buildSelection(employer);
      expect(ids(run.items)).not.toContain(famous);
      const bank = await employer.get('/employer/candidates?specialization=BACKEND&grades=SENIOR&skills=postgresql&skillSource=VERIFIED');
      expect(bank.body.items.map((i: { candidateId: string }) => i.candidateId)).not.toContain(famous);
      // Без требования по postgresql тот же кандидат проходит — значит, исключило именно обязательное условие.
      const relaxed = await buildSelection(employer, defaultNeed({ title: 'Только SQL', requiredSkills: ['sql'], allowedGrades: ['SENIOR'] }));
      expect(ids(relaxed.run.items)).toContain(famous);
    });

    it('навык, указанный кандидатом, не удовлетворяет обязательному подтверждённому', async () => {
      const { run } = await buildSelection(employer);
      expect(ids(run.items)).not.toContain(selfReported);
    });

    it('зарплатные ожидания: несовместимая вилка исключает; при расширенной вилке кандидат подходит', async () => {
      const cheap = await buildSelection(employer, defaultNeed({ title: 'Вилка выше', salaryFrom: 450_000, salaryTo: 650_000 }));
      expect(ids(cheap.run.items)).toContain(expensive);
      // У кандидата good ожидания не заданы — вилка его не исключает.
      expect(ids(cheap.run.items)).toContain(good);
    });

    it('кандидат без ожиданий не исключается, а в объяснении сказано «ожидания не указаны»', async () => {
      const noSalary = (await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', profile: { salaryFrom: null, salaryTo: null } })).candidateId;
      const { run } = await buildSelection(employer, defaultNeed({ title: 'Любая вилка' }));
      const item = run.items.find((i: SelectionItem) => i.candidate?.candidateId === noSalary) as SelectionItem;
      expect(item).toBeDefined();
      expect(item.explanation!.why.join(' ')).toContain('Ожидания не указаны');
    });

    it('пустая выдача объясняет причины и ничего не ослабляет автоматически', async () => {
      const { run } = await buildSelection(employer, defaultNeed({ title: 'Нет таких', allowedGrades: ['SENIOR'], requiredSkills: ['concurrency', 'transactions', 'sql', 'postgresql'], salaryFrom: 1_000_000, salaryTo: 1_200_000 }));
      expect(run.totalMatched).toBe(0);
      expect(run.items).toEqual([]);
      expect(run.emptyReasons.length).toBeGreaterThan(0);
      expect(run.emptyReasons[0]).toEqual(expect.objectContaining({ text: expect.any(String), count: expect.any(Number) }));
    });

    it('обязательный навык должен проверяться тестами: непроверяемый отклоняется при создании потребности', async () => {
      const res = await employer.post('/employer/needs', defaultNeed({ requiredSkills: ['nestjs'] }));
      expect(res.status).toBe(422);
      expect(res.body.details.fields.requiredSkills[0]).toContain('NestJS');
    });
  });

  describe('ранжирование и объяснения', () => {
    beforeEach(() => resetDatabase(ctx.prisma));

    it('желательные навыки: подтверждённый = 1, указанный кандидатом = 0.3 (если допустимо), иначе 0; формула 70/25/5', async () => {
      const employer = (await createEmployer(ctx)).client;
      const verified = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', profile: { salaryFrom: null, salaryTo: null, skills: [{ code: 'sql' }, { code: 'postgresql' }] } });
      await ctx.prisma.candidateQualification.update({
        where: { candidateId_specializationCode: { candidateId: verified.candidateId, specializationCode: 'BACKEND' } },
        data: { verifiedSkills: { set: ['sql', 'postgresql', 'transactions'] }, overallScore: 80 },
      });
      const self = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', profile: { salaryFrom: null, salaryTo: null, skills: [{ code: 'sql' }, { code: 'postgresql' }, { code: 'kafka' }] } });
      await ctx.prisma.candidateQualification.update({
        where: { candidateId_specializationCode: { candidateId: self.candidateId, specializationCode: 'BACKEND' } },
        data: { verifiedSkills: { set: ['sql', 'postgresql'] }, overallScore: 80 },
      });
      const { run } = await buildSelection(
        employer,
        defaultNeed({ title: 'С желательными', preferredSkills: [{ skill: 'transactions', mode: 'VERIFIED_ONLY' }, { skill: 'kafka', mode: 'SELF_REPORTED_ALLOWED' }] }),
      );
      const byId = new Map((run.items as SelectionItem[]).map((i) => [i.candidate!.candidateId, i]));
      const a = byId.get(verified.candidateId)!;
      const b = byId.get(self.candidateId)!;
      expect(a.explanation!.components.preferredFit.value).toBe(0.5); // (1 + 0) / 2
      expect(b.explanation!.components.preferredFit.value).toBe(0.15); // (0 + 0.3) / 2
      expect(a.score).toBe(70 * 0.5 + 25 * 0.8);
      expect(b.score).toBe(70 * 0.15 + 25 * 0.8);
      expect(a.rank).toBe(1);
      expect(a.explanation!.why.length).toBeGreaterThan(2);
      expect(b.explanation!.notVerified.join(' ')).toContain('Apache Kafka');
      expect(JSON.stringify(run)).not.toMatch(/вероятност[ьи] найма|пригодност/i);
    });

    it('порядок и пагинация общего банка не зависят от размера страницы', async () => {
      const employer = (await createEmployer(ctx)).client;
      for (let i = 0; i < 7; i += 1) await createCandidate(ctx, { specialization: 'FRONTEND', grade: i % 2 === 0 ? 'MIDDLE' : 'SENIOR', profile: { skills: [{ code: 'react' }, { code: 'typescript' }] } });
      const collect = async (pageSize: number) => {
        const result: string[] = [];
        for (let page = 1; page <= Math.ceil(7 / pageSize) + 1; page += 1) {
          const res = await employer.get(`/employer/candidates?specialization=FRONTEND&page=${page}&pageSize=${pageSize}`);
          expect(res.status).toBe(200);
          result.push(...res.body.items.map((i: { candidateId: string }) => i.candidateId));
        }
        return result;
      };
      const full = await collect(50);
      expect(full.length).toBeGreaterThanOrEqual(7);
      for (const size of [2, 3, 5]) expect(await collect(size)).toEqual(full);
      // Категории не смешиваются: сначала все Senior, затем Middle.
      const bank = await employer.get('/employer/candidates?specialization=FRONTEND&pageSize=50');
      const grades = bank.body.items.map((i: { grade: string }) => i.grade);
      expect(grades).toEqual([...grades].sort((a: string, b: string) => ['SENIOR', 'MIDDLE', 'JUNIOR'].indexOf(a) - ['SENIOR', 'MIDDLE', 'JUNIOR'].indexOf(b)));
    });

    it('кандидат без пройденного теста не попадает ни в банк, ни в подборку', async () => {
      const employer = (await createEmployer(ctx)).client;
      const untested = await createCandidate(ctx, { specialization: 'MANUAL_QA', grade: 'MIDDLE', skipAssessment: true });
      const bank = await employer.get('/employer/candidates?specialization=MANUAL_QA&pageSize=50');
      expect(bank.body.items.map((i: { candidateId: string }) => i.candidateId)).not.toContain(untested.candidateId);
      expect((await employer.get(`/employer/candidates/${untested.candidateId}`)).status).toBe(404);
    });
  });

  describe('сохранение подборок, уточнения и закладки', () => {
    beforeEach(() => resetDatabase(ctx.prisma));

    it('каждое построение сохраняется (версия потребности, фильтры, формула); уточнение — новая версия, прежняя доступна', async () => {
      const employer = (await createEmployer(ctx)).client;
      const c = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', profile: { salaryFrom: null, salaryTo: null } });
      const { needId, run } = await buildSelection(employer);
      expect(run).toMatchObject({ needVersion: 1, formulaVersion: 'matching-formula-v1' });
      expect(run.formula.needWeights).toEqual({ preferredFit: 70, assessmentQuality: 25, fspEvidence: 5 });
      const refined = await employer.post(`/employer/needs/${needId}/selections`, { refinements: { minOverallScore: 99 }, parentRunId: run.id });
      expect(refined.status).toBe(201);
      expect(refined.body.parentRunId).toBe(run.id);
      expect(refined.body.filters).toEqual({ minOverallScore: 99 });
      const history = await employer.get(`/employer/needs/${needId}/selections`);
      expect(history.body).toHaveLength(2);
      const original = await employer.get(`/employer/selections/${run.id}`);
      expect(ids(original.body.items)).toContain(c.candidateId);
      // Изменение потребности создаёт новую версию, подборка сохраняет исходную.
      await employer.patch(`/employer/needs/${needId}`, { title: 'Переименовано' });
      const afterEdit = await employer.get(`/employer/selections/${run.id}`);
      expect(afterEdit.body).toMatchObject({ needVersion: 1, currentNeedVersion: 2 });
    });

    it('скрытый кандидат не раскрывается через старую подборку, закладку и карточку', async () => {
      const employer = (await createEmployer(ctx)).client;
      const c = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', profile: { salaryFrom: null, salaryTo: null } });
      const { run } = await buildSelection(employer);
      expect(ids(run.items)).toContain(c.candidateId);
      const rank = (run.items as SelectionItem[]).find((i) => i.candidate?.candidateId === c.candidateId)!.rank;
      expect((await employer.post(`/employer/bookmarks/${c.candidateId}`)).status).toBe(201);

      await c.client.patch('/candidate/profile', { isDiscoverable: false });

      const old = await employer.get(`/employer/selections/${run.id}`);
      expect(old.status).toBe(200);
      const item = old.body.items.find((i: SelectionItem) => i.rank === rank);
      expect(item).toEqual({ rank, unavailable: true });
      expect(JSON.stringify(old.body)).not.toContain(c.candidateId);
      const bookmarks = await employer.get('/employer/bookmarks');
      expect(bookmarks.body).toEqual([expect.objectContaining({ candidateId: c.candidateId, unavailable: true })]);
      expect(bookmarks.body[0].candidate).toBeUndefined();
      expect((await employer.get(`/employer/candidates/${c.candidateId}`)).status).toBe(404);
      expect((await employer.post(`/employer/needs/${(await employer.get('/employer/needs')).body[0].id}/selections`, {})).body.items).toEqual([]);

      // Возвращение видимости возвращает кандидата.
      await c.client.patch('/candidate/profile', { isDiscoverable: true });
      expect((await employer.get(`/employer/candidates/${c.candidateId}`)).status).toBe(200);
    });

    it('закладки не зависят от фильтров подборок и идемпотентны', async () => {
      const employer = (await createEmployer(ctx)).client;
      const c = await createCandidate(ctx, { specialization: 'FRONTEND', grade: 'MIDDLE' });
      expect((await employer.post(`/employer/bookmarks/${c.candidateId}`)).status).toBe(201);
      expect((await employer.post(`/employer/bookmarks/${c.candidateId}`)).status).toBe(201);
      expect((await employer.get('/employer/bookmarks')).body).toHaveLength(1);
      expect((await employer.delete(`/employer/bookmarks/${c.candidateId}`)).status).toBe(200);
      expect((await employer.get('/employer/bookmarks')).body).toHaveLength(0);
    });

    it('в сохранённых снимках нет контактов и персональных данных', async () => {
      const employer = (await createEmployer(ctx)).client;
      const c = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE', profile: { fullName: 'Секретов Секрет Секретович', contactEmail: 'secret.mail@private.example', phone: '+7 911 222-33-44', salaryFrom: null, salaryTo: null } });
      const { run } = await buildSelection(employer);
      expect(ids(run.items)).toContain(c.candidateId);
      const rows = JSON.stringify(await ctx.prisma.selectionResult.findMany());
      for (const secret of ['Секретов', 'secret.mail', '222-33-44']) {
        expect(rows).not.toContain(secret);
        expect(JSON.stringify(run)).not.toContain(secret);
      }
    });
  });

  describe('изоляция работодателей', () => {
    beforeEach(() => resetDatabase(ctx.prisma));

    it('чужие потребности, подборки и закладки недоступны (404), роль кандидата — 403', async () => {
      const a = (await createEmployer(ctx, { name: 'Компания А' })).client;
      const b = (await createEmployer(ctx, { name: 'Компания Б' })).client;
      const { needId, run } = await buildSelection(a);
      expect((await b.get(`/employer/needs/${needId}`)).status).toBe(404);
      expect((await b.patch(`/employer/needs/${needId}`, { title: 'Взлом' })).status).toBe(404);
      expect((await b.post(`/employer/needs/${needId}/selections`, {})).status).toBe(404);
      expect((await b.get(`/employer/needs/${needId}/selections`)).status).toBe(404);
      expect((await b.get(`/employer/selections/${run.id}`)).status).toBe(404);
      expect((await b.post(`/employer/needs/${needId}/assessment-preview`, {})).status).toBe(404);
      expect((await b.get('/employer/needs')).body).toEqual([]);
      const candidate = (await createCandidate(ctx, { skipAssessment: true })).client;
      expect((await candidate.get(`/employer/needs/${needId}`)).status).toBe(403);
    });

    it('нельзя создать потребность без профиля компании', async () => {
      const client = new Client(ctx.app);
      await client.registerAndVerify(ctx.mail, uniqueEmail('nocompany'), 'EMPLOYER');
      const res = await client.post('/employer/needs', defaultNeed());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('COMPANY_PROFILE_REQUIRED');
    });

    it('валидация потребности: вилка, грейды, формат и город', async () => {
      const employer = (await createEmployer(ctx)).client;
      expect((await employer.post('/employer/needs', defaultNeed({ salaryFrom: 300_000, salaryTo: 200_000 }))).status).toBe(422);
      expect((await employer.post('/employer/needs', defaultNeed({ allowedGrades: [] }))).status).toBe(422);
      expect((await employer.post('/employer/needs', defaultNeed({ salaryType: 'NET' }))).status).toBe(422);
      const office = await employer.post('/employer/needs', defaultNeed({ workFormat: 'OFFICE', city: null }));
      expect(office.status).toBe(422);
      expect(office.body.details.fields.city).toBeDefined();
      expect((await employer.post('/employer/needs', defaultNeed({ requiredSkills: ['no-such-skill'] }))).status).toBe(422);
    });
  });

  describe('предпросмотр плана теста под потребность', () => {
    beforeEach(() => resetDatabase(ctx.prisma));

    it('связывает требования с семействами, помечает непокрытые и не раскрывает ответы', async () => {
      const employer = (await createEmployer(ctx)).client;
      const need = await employer.post('/employer/needs', defaultNeed({ preferredSkills: [{ skill: 'kafka', mode: 'SELF_REPORTED_ALLOWED' }, { skill: 'transactions', mode: 'VERIFIED_ONLY' }] }));
      const preview = await employer.post(`/employer/needs/${need.body.id}/assessment-preview`, { grade: 'MIDDLE' });
      expect(preview.status).toBe(200);
      const grade = preview.body.grades[0];
      const coverage = new Map(grade.blueprint.coverage.map((c: { skill: string; status: string }) => [c.skill, c.status]));
      expect(coverage.get('sql')).toBe('COVERED');
      expect(coverage.get('kafka')).toBe('NOT_COVERED');
      expect(grade.samples).toHaveLength(6);
      const json = JSON.stringify(preview.body);
      for (const key of ['correctOptionId', 'correctValue', 'correctPairs', 'correctOrder', 'privateKey', 'semanticMap']) expect(json).not.toContain(key);
      expect(preview.body.notice).toContain('не проводится');
    });
  });
});
