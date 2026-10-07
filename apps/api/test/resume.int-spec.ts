import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { createCandidate, createEmployer } from './helpers/factories';
import { makeImageOnlyPdf, makeResumePdf } from './helpers/resume-pdf';
import { Client } from './helpers/client';

const RESUME = [
  'Кузнецова Дарья Андреевна',
  'Backend-разработчик (Middle)',
  'Контакты',
  'Email: daria.kuznetsova@resume-test.example',
  'Телефон: +7 (903) 111-22-33',
  'Telegram: @daria_dev',
  'GitHub: https://github.com/dariakuznetsova',
  'Город: Новосибирск',
  '',
  'Опыт работы',
  'Март 2019 – июнь 2022  ООО «Сервис»',
  'Разработка REST API на Python и Django, наставничество джуниоров',
  'Июль 2022 – настоящее время  АО «Банк»',
  'Платёжные сервисы, PostgreSQL, Kafka. Финтех.',
  '',
  'Навыки',
  'Python — 6 лет, Django, PostgreSQL (4 года), SQL, Docker, Kafka, Git',
  'Командная работа, ответственность',
];

describe('автораспознавание PDF-резюме', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.prisma));

  const upload = (client: Client, body: Buffer | string, headers: Record<string, string> = { 'Content-Type': 'application/pdf' }) =>
    client.post('/candidate/profile/resume', body, headers);

  it('PDF → предложения для профиля; файл нигде не сохраняется, ничего не применяется автоматически', async () => {
    const candidate = await createCandidate(ctx, { skipAssessment: true });
    const before = await candidate.client.get('/candidate/profile');
    const pdf = await makeResumePdf(RESUME);
    const res = await upload(candidate.client, pdf);
    expect(res.status).toBe(200);
    const { suggestion, source, notice } = res.body;
    expect(suggestion).toMatchObject({
      fullName: 'Кузнецова Дарья Андреевна',
      contactEmail: 'daria.kuznetsova@resume-test.example',
      phone: '+7 903 111-22-33',
      messenger: '@daria_dev',
      city: 'Новосибирск',
      timezone: 'Asia/Novosibirsk',
      activeSpecialization: 'BACKEND',
      declaredGrade: 'MIDDLE',
    });
    expect(suggestion.externalLinks).toEqual(['https://github.com/dariakuznetsova']);
    const skills = Object.fromEntries((suggestion.skills as Array<{ code: string; months: number | null }>).map((s) => [s.code, s.months]));
    expect(skills.python).toBe(72);
    expect(skills.postgresql).toBe(48);
    for (const code of ['django', 'sql', 'docker', 'kafka', 'git']) expect(skills).toHaveProperty(code);
    expect(suggestion.teamRoles).toEqual(expect.arrayContaining(['DEVELOPER', 'MENTOR']));
    expect(suggestion.softSkills).toEqual(expect.arrayContaining(['TEAMWORK', 'OWNERSHIP']));
    expect(suggestion.industries).toContain('FINTECH');
    // Март 2019 – октябрь 2026 включительно без пропусков: 92 месяца.
    expect(suggestion.experienceMonths).toBe(92);
    expect(source).toMatchObject({ pages: 1, truncated: false });
    expect(source.recognizedFields).toBeGreaterThanOrEqual(10);
    expect(notice).toMatch(/самоописание/);

    // Профиль не изменился: применяет кандидат сам.
    const after = await candidate.client.get('/candidate/profile');
    expect(after.body.profile).toEqual(before.body.profile);
    // Файл не сохранён: в журнале только счётчики, без содержимого.
    const audit = await ctx.prisma.auditEvent.findMany({ where: { action: 'candidate.resume_parsed' } });
    expect(audit).toHaveLength(1);
    const logged = JSON.stringify(audit);
    for (const secret of ['daria.kuznetsova', '903', 'Кузнецова', 'daria_dev']) expect(logged).not.toContain(secret);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('предложения применяются обычным PATCH профиля: навыки — самоописание, подтверждённой категории нет', async () => {
    const candidate = await createCandidate(ctx, { skipAssessment: true });
    const { body } = await upload(candidate.client, await makeResumePdf(RESUME));
    const s = body.suggestion;
    const patched = await candidate.client.patch('/candidate/profile', {
      fullName: s.fullName,
      contactEmail: s.contactEmail,
      phone: s.phone,
      messenger: s.messenger,
      city: s.city,
      timezone: s.timezone,
      experienceMonths: s.experienceMonths,
      externalLinks: s.externalLinks,
      teamRoles: s.teamRoles,
      softSkills: s.softSkills,
      industries: s.industries,
      skills: s.skills.map((x: { code: string; months: number | null }) => ({ code: x.code, months: x.months })),
      activeSpecialization: s.activeSpecialization,
      declaredGrade: s.declaredGrade,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.profile).toMatchObject({ fullName: 'Кузнецова Дарья Андреевна', city: 'Новосибирск', experienceMonths: 92 });
    const skills = patched.body.profile.skills as Array<{ code: string; verified: boolean }>;
    expect(skills.length).toBeGreaterThanOrEqual(6);
    expect(skills.every((x) => x.verified === false)).toBe(true); // самоописание, а не подтверждение тестом
    expect(patched.body.qualification).toBeNull(); // грейд по результатам тестирования не появился
  });

  it('многостраничный PDF разбирается целиком', async () => {
    const candidate = await createCandidate(ctx, { skipAssessment: true });
    const res = await upload(candidate.client, await makeResumePdf([...RESUME, ...RESUME.slice(0, 4)], { pages: 2 }));
    expect(res.status).toBe(200);
    expect(res.body.source.pages).toBe(2);
  });

  it('ошибки загрузки: не PDF, битый PDF, скан без текста, пустое тело, чужой Content-Type, слишком большой файл', async () => {
    const candidate = await createCandidate(ctx, { skipAssessment: true });
    const notPdf = await upload(candidate.client, Buffer.from('это просто текст, а не PDF'));
    expect(notPdf.status).toBe(422);
    expect(notPdf.body.code).toBe('RESUME_NOT_PDF');

    const broken = await upload(candidate.client, Buffer.from('%PDF-1.4\nthis is not a valid pdf body at all\n%%EOF'));
    expect(broken.status).toBe(422);
    expect(broken.body.code).toBe('RESUME_UNREADABLE');

    const scan = await upload(candidate.client, await makeImageOnlyPdf());
    expect(scan.status).toBe(422);
    expect(scan.body.code).toBe('RESUME_NO_TEXT');
    expect(scan.body.message).toMatch(/OCR/);

    const json = await upload(candidate.client, JSON.stringify({ a: 1 }), { 'Content-Type': 'application/json' });
    expect(json.status).toBe(415);
    expect(json.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const empty = await upload(candidate.client, Buffer.alloc(0));
    expect(empty.status).toBe(415);

    const huge = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20)]);
    const tooLarge = await upload(candidate.client, huge);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(JSON.stringify([notPdf.body, broken.body, scan.body])).not.toMatch(/stack|node_modules|pdfjs/i);
  });

  it('доступ: только кандидат; без входа — 401', async () => {
    const employer = await createEmployer(ctx);
    expect((await upload(employer.client, await makeResumePdf(RESUME))).body.code).toBe('FORBIDDEN_ROLE');
    expect((await upload(new Client(ctx.app), await makeResumePdf(RESUME))).status).toBe(401);
  });

  it('частота разбора ограничена: 10 файлов за 15 минут на пользователя, затем 429', async () => {
    const limited = await createTestApp({ realRateLimit: true });
    const candidate = await createCandidate(limited, { skipAssessment: true });
    const pdf = await makeResumePdf(RESUME);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await upload(candidate.client, pdf)).status);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    await limited.close();
  });
});
