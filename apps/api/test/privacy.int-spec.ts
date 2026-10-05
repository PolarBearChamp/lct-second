import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { createCandidate, createEmployer, defaultNeed, invitationBody, uniqueEmail } from './helpers/factories';
import { normalize, readPdf } from './helpers/pdf';

const SECRET = {
  fullName: 'Конфиденциалов Скрытый Приватович',
  contactEmail: 'secret.contact@privacy-test.example',
  phone: '+7 912 345-67-89',
  messenger: '@hidden_person',
  link: 'https://example.org/hidden-portfolio',
  experience: 'засекреченный проект АЛЬФА-ТАЙНА',
};
const FSP = { fspId: 'FSP-DEMO-1001', code: '731905' };
const FSP_EVENT_TITLES = ['Демо: финал кубка по продуктовому программированию 2025', 'Демо: региональный этап по алгоритмическому программированию 2024'];

const REDACTED_KEYS = [
  'alias', 'candidateId', 'city', 'declaredGrade', 'displayName', 'experienceMonths', 'fsp', 'industries', 'mode', 'qualification',
  'salaryExpectation', 'skills', 'softSkills', 'specialization', 'teamRoles', 'updatedAt', 'workFormats',
];
const REDACTED_ACHIEVEMENT_KEYS = ['discipline', 'eventLevel', 'isDemo', 'outcome', 'participationType', 'place', 'relevantToSpecialization', 'skillTags', 'year'];
const GRANTED_ACHIEVEMENT_KEYS = [...REDACTED_ACHIEVEMENT_KEYS, 'eventDate', 'eventTitle', 'teamRole'].sort();
const BANK_ITEM_KEYS = [
  'activeInvitation', 'alias', 'bankScore', 'bookmarked', 'candidateId', 'category', 'city', 'displayName', 'fsp', 'grade', 'gradeTitle',
  'groupScores', 'hasContactAccess', 'overallScore', 'salary', 'salaryHidden', 'selfReportedSkillsCount', 'specialization', 'verifiedSkills', 'workFormats',
];

describe('приватность: единое представление профиля для JSON и PDF', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.prisma));

  async function setup(options: { channels?: string[]; profile?: Record<string, unknown> } = {}) {
    const accountEmail = uniqueEmail('privacy.account');
    const candidate = await createCandidate(ctx, {
      email: accountEmail,
      profile: {
        fullName: SECRET.fullName,
        contactEmail: SECRET.contactEmail,
        phone: SECRET.phone,
        messenger: SECRET.messenger,
        externalLinks: [SECRET.link],
        experienceDescription: `Работал над проектом: ${SECRET.experience}.`,
        disclosureChannels: options.channels ?? ['EMAIL', 'PHONE', 'MESSENGER'],
        salaryFrom: 210_000,
        salaryTo: 280_000,
        ...options.profile,
      },
    });
    const linked = await candidate.client.post('/candidate/fsp-link', FSP);
    expect(linked.status).toBe(201);
    const granted = await createEmployer(ctx, { name: 'Компания с доступом' });
    const plain = await createEmployer(ctx, { name: 'Компания без доступа' });
    return { candidate, accountEmail, granted, plain };
  }

  async function grantAccess(candidate: Awaited<ReturnType<typeof setup>>['candidate'], employer: Awaited<ReturnType<typeof setup>>['granted']) {
    const invitation = await employer.client.post('/employer/invitations', invitationBody(candidate.candidateId));
    expect(invitation.status).toBe(201);
    const accepted = await candidate.client.post(`/candidate/invitations/${invitation.body.id}/accept`, { confirmDisclosure: true });
    expect(accepted.status).toBe(200);
  }

  const found = (haystack: string, needles: string[]) => needles.filter((needle) => haystack.includes(needle));
  const pdfText = async (client: { getBuffer: (path: string) => Promise<{ status: number; body: Buffer }> }, path: string) => {
    const res = await client.getBuffer(path);
    expect(res.status).toBe(200);
    const content = readPdf(res.body);
    return { text: normalize(content.text), info: JSON.stringify(content.info), pages: content.pages };
  };

  describe('обезличенная карточка (работодатель без доступа)', () => {
    it('JSON ограничен явным списком полей и не содержит ни одного приватного значения', async () => {
      const { candidate, accountEmail, plain } = await setup();
      const card = await plain.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(card.status).toBe(200);
      const profile = card.body.profile;
      expect(profile.mode).toBe('EMPLOYER_REDACTED');
      expect(Object.keys(profile).sort()).toEqual(REDACTED_KEYS);
      expect(profile.displayName).toBe(`Кандидат ${profile.alias}`);

      const achievements = profile.fsp.achievements as Array<Record<string, unknown>>;
      expect(achievements.length).toBeGreaterThan(0);
      for (const achievement of achievements) expect(Object.keys(achievement).sort()).toEqual(REDACTED_ACHIEVEMENT_KEYS);

      const body = JSON.stringify(card.body);
      expect(found(body, [...Object.values(SECRET), accountEmail, FSP.fspId, 'rec-1001', ...FSP_EVENT_TITLES])).toEqual([]);
      expect(body).not.toMatch(/passwordHash|tokenHash|privateKey|"userId"|contactEmail|"phone"|"messenger"|"personal"|"contacts"/);
    });

    it('строка общего банка содержит только безопасные поля', async () => {
      const { candidate, accountEmail, plain } = await setup();
      const bank = await plain.client.get('/employer/candidates?specialization=BACKEND');
      const item = (bank.body.items as Array<Record<string, unknown>>).find((i) => i.candidateId === candidate.candidateId);
      expect(item).toBeDefined();
      expect(Object.keys(item!).sort()).toEqual(BANK_ITEM_KEYS);
      expect(found(JSON.stringify(bank.body), [...Object.values(SECRET), accountEmail, FSP.fspId])).toEqual([]);
    });

    it('PDF: ни текст, ни метаданные, ни имя файла не содержат ФИО, контактов и названий мероприятий ФСП', async () => {
      const { candidate, accountEmail, plain } = await setup();
      const res = await plain.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`);
      expect(res.status).toBe(200);
      const { alias } = (await plain.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile;
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="candidate-${alias.toLowerCase()}-redacted.pdf"`);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');

      const content = readPdf(res.body);
      const text = normalize(content.text);
      const leaked = found(text + JSON.stringify(content.info) + res.headers['content-disposition'], [...Object.values(SECRET), accountEmail, FSP.fspId, ...FSP_EVENT_TITLES, 'Конфиденциалов']);
      expect(leaked).toEqual([]);
      expect(text).toContain(`Кандидат ${alias}`);
      expect(text).toContain('Обезличенная карточка кандидата');
      expect(text).toContain('Достижения ФСП');
      expect(text).toContain('Демонстрационная интеграция');
      expect(JSON.stringify(content.info)).toContain(`Профиль кандидата ${alias}`);
    });

    it('предпросмотр кандидата «как видят работодатели» совпадает с карточкой работодателя без доступа', async () => {
      const { candidate, plain } = await setup();
      const preview = await candidate.client.get('/candidate/profile/preview');
      const card = await plain.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(preview.status).toBe(200);
      expect(preview.body).toEqual(card.body.profile);
    });
  });

  describe('владелец и компания с доступом', () => {
    it('владелец получает полный профиль и PDF с контактами и названиями мероприятий', async () => {
      const { candidate } = await setup();
      const own = await candidate.client.get('/candidate/profile');
      expect(own.body.profile).toMatchObject({ fullName: SECRET.fullName, contactEmail: SECRET.contactEmail, phone: SECRET.phone, messenger: SECRET.messenger });
      const { text } = await pdfText(candidate.client, '/candidate/profile/pdf');
      for (const value of [SECRET.fullName, SECRET.contactEmail, SECRET.phone, SECRET.messenger, SECRET.link, ...FSP_EVENT_TITLES]) {
        expect(text.replace(/ /g, '')).toContain(value.replace(/ /g, ''));
      }
      expect(text).toContain('Профиль кандидата (владелец)');
    });

    it('после принятия JSON и PDF содержат одни и те же раскрытые данные — только выбранные каналы', async () => {
      const { candidate, accountEmail, granted, plain } = await setup({ channels: ['EMAIL', 'MESSENGER'] });
      await grantAccess(candidate, granted);

      const card = await granted.client.get(`/employer/candidates/${candidate.candidateId}`);
      const profile = card.body.profile;
      expect(profile.mode).toBe('EMPLOYER_GRANTED');
      expect(Object.keys(profile).sort()).toEqual([...REDACTED_KEYS, 'contacts', 'grant', 'personal'].sort());
      expect(profile.contacts).toEqual([
        { channel: 'EMAIL', value: SECRET.contactEmail },
        { channel: 'MESSENGER', value: SECRET.messenger },
      ]);
      expect(profile.grant.channels).toEqual(['EMAIL', 'MESSENGER']);
      expect(profile.personal).toMatchObject({ fullName: SECRET.fullName, externalLinks: [SECRET.link] });
      expect(profile.displayName).toBe(SECRET.fullName);
      for (const achievement of profile.fsp.achievements as Array<Record<string, unknown>>) expect(Object.keys(achievement).sort()).toEqual(GRANTED_ACHIEVEMENT_KEYS);
      const json = JSON.stringify(card.body);
      expect(found(json, [SECRET.phone, accountEmail])).toEqual([]);

      const { text } = await pdfText(granted.client, `/employer/candidates/${candidate.candidateId}/pdf`);
      const compact = text.replace(/ /g, '');
      for (const value of [SECRET.fullName, SECRET.contactEmail, SECRET.messenger, SECRET.link, ...FSP_EVENT_TITLES]) expect(compact).toContain(value.replace(/ /g, ''));
      expect(found(text, [SECRET.phone, accountEmail])).toEqual([]);
      expect(text).toContain('Профиль с доступом к контактам');

      // Другая компания, не получившая согласия, по-прежнему видит только обезличенную карточку и PDF.
      const other = await plain.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(other.body.profile.mode).toBe('EMPLOYER_REDACTED');
      const otherPdf = await pdfText(plain.client, `/employer/candidates/${candidate.candidateId}/pdf`);
      expect(found(otherPdf.text + otherPdf.info, [...Object.values(SECRET), 'Конфиденциалов'])).toEqual([]);
    });

    it('доступ фиксирует выбранные при принятии каналы; значения контактов остаются актуальными, новые каналы автоматически не раскрываются', async () => {
      const { candidate, granted } = await setup({ channels: ['EMAIL'] });
      await grantAccess(candidate, granted);
      await candidate.client.patch('/candidate/profile', { disclosureChannels: ['EMAIL', 'PHONE', 'MESSENGER'], contactEmail: 'updated.contact@privacy-test.example' });
      const card = await granted.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(card.body.profile.contacts).toEqual([{ channel: 'EMAIL', value: 'updated.contact@privacy-test.example' }]);
      expect(found(JSON.stringify(card.body), [SECRET.phone, SECRET.messenger])).toEqual([]);
    });
  });

  describe('настройки видимости и согласие', () => {
    it('скрытая зарплата не попадает ни в банк, ни в карточку, ни в PDF; показанная — попадает', async () => {
      const { candidate, plain } = await setup();
      const visible = await plain.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(visible.body.profile.salaryExpectation).toEqual({ from: 210_000, to: 280_000, currency: 'RUB', period: 'MONTH', gross: true });
      expect((await pdfText(plain.client, `/employer/candidates/${candidate.candidateId}/pdf`)).text).toContain('до вычета налогов');

      await candidate.client.patch('/candidate/profile', { showSalaryToEmployers: false });
      const hidden = await plain.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(hidden.body.profile.salaryExpectation).toBeNull();
      const bank = await plain.client.get('/employer/candidates?specialization=BACKEND');
      const item = (bank.body.items as Array<{ candidateId: string; salary: unknown; salaryHidden: boolean }>).find((i) => i.candidateId === candidate.candidateId);
      expect(item).toMatchObject({ salary: null, salaryHidden: true });
      const pdf = await pdfText(plain.client, `/employer/candidates/${candidate.candidateId}/pdf`);
      expect(pdf.text).toContain('не указаны');
      expect(found(pdf.text.replace(/ /g, ''), ['210000', '280000'])).toEqual([]);
      // Владелец свою зарплату по-прежнему видит.
      expect((await candidate.client.get('/candidate/profile')).body.profile).toMatchObject({ salaryFrom: 210_000, salaryTo: 280_000 });
    });

    it('отзыв согласия на публикацию скрывает кандидата; компания с доступом сохраняет доступ; повторная публикация — только явная', async () => {
      const { candidate, granted, plain } = await setup();
      await grantAccess(candidate, granted);

      const withdrawn = await candidate.client.put('/candidate/consents', { profilePublication: false });
      expect(withdrawn.status).toBe(200);
      const me = await candidate.client.get('/auth/me');
      expect(me.body.candidate.discoverable).toBe(false);

      expect((await plain.client.get(`/employer/candidates/${candidate.candidateId}`)).status).toBe(404);
      expect((await plain.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`)).status).toBe(404);
      const bank = await plain.client.get('/employer/candidates?specialization=BACKEND');
      expect(bank.body.items).toEqual([]);
      expect((await granted.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_GRANTED');

      // Возврат согласия не публикует профиль автоматически.
      await candidate.client.put('/candidate/consents', { profilePublication: true });
      expect((await plain.client.get(`/employer/candidates/${candidate.candidateId}`)).status).toBe(404);
      await candidate.client.patch('/candidate/profile', { isDiscoverable: true });
      expect((await plain.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_REDACTED');
      const records = await ctx.prisma.consentRecord.findMany({ where: { type: 'PROFILE_PUBLICATION' }, orderBy: { acceptedAt: 'asc' } });
      expect(records.filter((r) => r.withdrawnAt).length).toBe(1);
    });

    it('двойной клик по согласию идемпотентен: остаётся одна действующая запись, ошибок нет', async () => {
      const { candidate } = await setup();
      await candidate.client.put('/candidate/consents', { profilePublication: false });
      const results = await Promise.all(Array.from({ length: 4 }, () => candidate.client.put('/candidate/consents', { profilePublication: true })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(await ctx.prisma.consentRecord.count({ where: { type: 'PROFILE_PUBLICATION', withdrawnAt: null } })).toBe(1);
      expect((await candidate.client.get('/candidate/profile')).body.consents.profilePublication.active).toBe(true);
    });

    it('пауза рассмотрения предложений исключает кандидата из подбора и банка', async () => {
      const { candidate, plain } = await setup();
      await candidate.client.patch('/candidate/profile', { availability: 'PAUSED' });
      expect((await plain.client.get(`/employer/candidates/${candidate.candidateId}`)).status).toBe(404);
      expect((await plain.client.get('/employer/candidates?specialization=BACKEND')).body.items).toEqual([]);
    });
  });

  describe('хранение и служебные данные', () => {
    it('сохранённые подборки и аудит не содержат контактов и ФИО', async () => {
      const { candidate, accountEmail, granted } = await setup();
      await grantAccess(candidate, granted);
      const need = await granted.client.post('/employer/needs', defaultNeed());
      expect(need.status).toBe(201);
      const run = await granted.client.post(`/employer/needs/${need.body.id}/selections`, {});
      expect(run.status).toBe(201);
      expect(run.body.items.length).toBeGreaterThan(0);
      // Компания с доступом открывает карточку и скачивает PDF с контактами — это тоже попадает в аудит.
      await granted.client.get(`/employer/candidates/${candidate.candidateId}`);
      await granted.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`);

      const selectionRows = JSON.stringify({
        runs: await ctx.prisma.selectionRun.findMany(),
        results: await ctx.prisma.selectionResult.findMany(),
        invitations: await ctx.prisma.invitation.findMany(),
        events: await ctx.prisma.invitationEvent.findMany(),
      });
      expect(found(selectionRows, [...Object.values(SECRET), accountEmail, 'Конфиденциалов'])).toEqual([]);
      const api = JSON.stringify([run.body, (await granted.client.get(`/employer/needs/${need.body.id}/selections`)).body]);
      expect(found(api, [...Object.values(SECRET), accountEmail])).toEqual([]);

      const audit = await ctx.prisma.auditEvent.findMany();
      expect(audit.length).toBeGreaterThan(5);
      expect(found(JSON.stringify(audit), [...Object.values(SECRET), accountEmail, 'Конфиденциалов'])).toEqual([]);
      const pdfAudit = audit.filter((a) => a.action === 'candidate.pdf_downloaded');
      expect(pdfAudit.map((a) => a.metadata)).toEqual([{ mode: 'EMPLOYER_GRANTED' }]);
      expect(audit.some((a) => a.action === 'candidate.granted_profile_viewed')).toBe(true);
    });

    it('ответы API не содержат служебных полей; ответы и PDF не кэшируются', async () => {
      const { candidate, plain } = await setup();
      const responses = [
        await candidate.client.get('/auth/me'),
        await candidate.client.get('/candidate/profile'),
        await plain.client.get('/auth/me'),
        await plain.client.get(`/employer/candidates/${candidate.candidateId}`),
        await plain.client.get('/employer/candidates?specialization=BACKEND'),
      ];
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('private, no-store');
        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|argon2|privateKey|"fingerprint"/i);
      }
      const pdf = await plain.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`);
      expect(pdf.headers['cache-control']).toBe('private, no-store');
      expect(pdf.headers['x-content-type-options']).toBe('nosniff');
      expect(pdf.headers['content-disposition']).toMatch(/^attachment;/);
    });
  });
});
