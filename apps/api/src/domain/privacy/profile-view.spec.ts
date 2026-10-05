import { buildProfileView, type FspSource, type ProfileSource, type QualificationSource } from './profile-view';

const profile: ProfileSource = {
  id: '11111111-1111-4111-8111-111111111111',
  alias: 'A17F',
  fullName: 'Иванов Секретный Иванович',
  contactEmail: 'secret.person@private-mail.example',
  phone: '+7 (999) 123-45-67',
  messenger: '@secret_handle',
  city: 'Казань',
  timezone: 'Europe/Moscow',
  workFormats: ['REMOTE'],
  availability: 'ACTIVE',
  salaryFrom: 200_000,
  salaryTo: 260_000,
  industries: ['FINTECH'],
  activeSpecializationCode: 'BACKEND',
  declaredGrade: 'SENIOR',
  experienceMonths: 60,
  teamRoles: ['MENTOR'],
  experienceDescription: 'Работал в КомпанииСекрет, делал проект СверхСекретный.',
  softSkills: ['TEAMWORK'],
  externalLinks: ['https://github.com/secret-person'],
  showSalaryToEmployers: true,
  showFspToEmployers: true,
  skills: [
    { skillCode: 'sql', months: 40 },
    { skillCode: 'kafka', months: 12 },
  ],
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

const qualification: QualificationSource = {
  specializationCode: 'BACKEND',
  confirmedGrade: 'MIDDLE',
  overallScore: 88,
  groupScores: [{ group: 'BE_API', title: 'API и обработка запросов', score: 90 }],
  skillEvidence: [
    { skill: 'sql', score: 90, cases: 2, status: 'CONFIRMED' },
    { skill: 'transactions', score: 50, cases: 1, status: 'INSUFFICIENT_DATA' },
  ],
  confirmedAt: new Date('2026-09-20T00:00:00Z'),
  nextReassessmentAt: new Date('2026-12-19T00:00:00Z'),
  policyVersion: 'assessment-policy-v1',
};

const fsp: FspSource = {
  state: 'LINKED_WITH_HISTORY',
  linkedAt: new Date('2026-09-01T00:00:00Z'),
  lastSuccessfulSyncAt: new Date('2026-09-01T00:00:00Z'),
  externalId: 'FSP-SECRET-777',
  achievements: [
    {
      externalId: 'rec-1',
      eventTitle: 'Секретный турнир ФСП',
      discipline: 'PRODUCT',
      eventLevel: 'NATIONAL',
      eventDate: new Date('2025-11-14T00:00:00Z'),
      participationType: 'TEAM',
      place: 2,
      teamRole: 'BACKEND',
      skillTags: ['rest-api'],
      isDemo: true,
    },
  ],
};

const FORBIDDEN = ['Иванов', 'Секретный', 'secret.person', 'private-mail', '+7 (999)', '123-45-67', '@secret_handle', 'github.com/secret-person', 'КомпанииСекрет', 'СверхСекретный', 'FSP-SECRET-777', 'Секретный турнир'];

describe('представление профиля: обезличенная карточка', () => {
  const view = buildProfileView('EMPLOYER_REDACTED', profile, qualification, fsp);
  const json = JSON.stringify(view);

  it('не содержит ФИО, контактов, ссылок, свободного текста, ФСП ID и названий мероприятий', () => {
    for (const secret of FORBIDDEN) expect(json).not.toContain(secret);
    expect(view.personal).toBeUndefined();
    expect(view.contacts).toBeUndefined();
    expect(view.grant).toBeUndefined();
  });

  it('показывает псевдоним, специализацию, подтверждённый грейд и баллы', () => {
    expect(view.displayName).toBe('Кандидат A17F');
    expect(view.specialization?.code).toBe('BACKEND');
    expect(view.qualification).toMatchObject({ grade: 'MIDDLE', overallScore: 88 });
  });

  it('различает «указано кандидатом» и «проверено тестом»', () => {
    const sql = view.skills.find((s) => s.code === 'sql');
    const kafka = view.skills.find((s) => s.code === 'kafka');
    expect(sql?.source).toBe('VERIFIED');
    expect(kafka?.source).toBe('SELF_REPORTED');
  });

  it('достижения обезличены: тип, уровень, место, год, релевантность — без названия и даты', () => {
    expect(view.fsp.achievements[0]).toMatchObject({ outcome: 'PRIZE', place: 2, year: 2025, relevantToSpecialization: true, isDemo: true });
    expect(view.fsp.achievements[0].eventTitle).toBeUndefined();
    expect(view.fsp.demoNotice).toContain('Демонстрационная интеграция');
  });

  it('квалификация другой специализации не показывается как квалификация активной', () => {
    const other = buildProfileView('EMPLOYER_REDACTED', { ...profile, activeSpecializationCode: 'FRONTEND' }, qualification, null);
    expect(other.qualification).toBeNull();
  });

  it('скрытая зарплата и скрытые достижения не попадают в карточку', () => {
    const hidden = buildProfileView('EMPLOYER_REDACTED', { ...profile, showSalaryToEmployers: false, showFspToEmployers: false }, qualification, fsp);
    expect(hidden.salaryExpectation).toBeNull();
    expect(hidden.fsp.achievements).toEqual([]);
    expect(hidden.fsp.linked).toBe(false);
  });
});

describe('представление профиля: с доступом к контактам', () => {
  it('раскрывает только выбранные кандидатом каналы', () => {
    const view = buildProfileView('EMPLOYER_GRANTED', profile, qualification, fsp, { channels: ['EMAIL'], grantedAt: new Date('2026-10-02T00:00:00Z') });
    expect(view.contacts).toEqual([{ channel: 'EMAIL', value: 'secret.person@private-mail.example' }]);
    const json = JSON.stringify(view);
    expect(json).not.toContain('+7 (999)');
    expect(json).not.toContain('@secret_handle');
    expect(view.displayName).toBe('Иванов Секретный Иванович');
    expect(view.personal?.externalLinks).toEqual(['https://github.com/secret-person']);
  });

  it('требует действующий доступ', () => {
    expect(() => buildProfileView('EMPLOYER_GRANTED', profile, qualification, fsp, null)).toThrow();
  });

  it('канал без заполненного значения не раскрывается', () => {
    const view = buildProfileView('EMPLOYER_GRANTED', { ...profile, phone: null }, qualification, fsp, { channels: ['EMAIL', 'PHONE'], grantedAt: new Date() });
    expect(view.contacts?.map((c) => c.channel)).toEqual(['EMAIL']);
  });
});

describe('представление профиля: владелец', () => {
  it('видит все свои данные и контакты', () => {
    const view = buildProfileView('OWNER', profile, qualification, fsp);
    expect(view.contacts?.map((c) => c.channel)).toEqual(['EMAIL', 'PHONE', 'MESSENGER']);
    expect(view.personal?.experienceDescription).toContain('КомпанииСекрет');
    expect(view.fsp.achievements[0].eventTitle).toBe('Секретный турнир ФСП');
  });
});
