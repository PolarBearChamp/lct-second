import { evaluateDiscoverability, type DiscoverabilityFacts } from './discoverability';

const ready: DiscoverabilityFacts = {
  emailVerified: true,
  fullName: 'Иван Тестов',
  city: 'Москва',
  timezone: 'Europe/Moscow',
  workFormats: ['REMOTE'],
  activeSpecializationCode: 'BACKEND',
  declaredGrade: 'MIDDLE',
  experienceMonths: 30,
  skillsCount: 4,
  disclosureChannels: ['EMAIL'],
  contactEmail: 'ivan@example.com',
  phone: null,
  messenger: null,
  hasActivePublicationConsent: true,
  isDiscoverable: true,
  availability: 'ACTIVE',
  confirmedSpecializations: ['BACKEND'],
  birthDate: new Date('1995-06-15T00:00:00Z'),
  hasGuardianConsent: false,
};

const codes = (facts: Partial<DiscoverabilityFacts>) => evaluateDiscoverability({ ...ready, ...facts }).issues.map((i) => i.code);

const NOW = new Date('2026-10-09T12:00:00Z');

describe('возраст: 16+ и согласие законного представителя для 16–17 лет', () => {
  it('без даты рождения профиль неполон', () => {
    expect(codes({ birthDate: null })).toContain('PROFILE_INCOMPLETE');
  });

  it('младше 16 — не публикуется', () => {
    const result = evaluateDiscoverability({ ...ready, birthDate: new Date('2011-01-01T00:00:00Z') }, NOW);
    expect(result.discoverable).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('UNDERAGE');
  });

  it('16–17 лет — только с согласием законного представителя', () => {
    const minor = { ...ready, birthDate: new Date('2009-03-01T00:00:00Z') };
    expect(evaluateDiscoverability(minor, NOW).issues.map((i) => i.code)).toEqual(['GUARDIAN_CONSENT_REQUIRED']);
    expect(evaluateDiscoverability({ ...minor, hasGuardianConsent: true }, NOW).discoverable).toBe(true);
  });

  it('взрослому согласие представителя не нужно', () => {
    expect(evaluateDiscoverability(ready, NOW).discoverable).toBe(true);
  });
});

describe('условия попадания кандидата в поиск', () => {
  it('все условия выполнены — кандидат виден', () => {
    expect(evaluateDiscoverability(ready)).toEqual({ discoverable: true, gradeConfirmed: true, issues: [] });
  });

  it.each<[string, Partial<DiscoverabilityFacts>, string]>([
    ['email не подтверждён', { emailVerified: false }, 'EMAIL_NOT_VERIFIED'],
    ['нет ФИО', { fullName: '  ' }, 'PROFILE_INCOMPLETE'],
    ['нет стека', { skillsCount: 0 }, 'PROFILE_INCOMPLETE'],
    ['нет формата работы', { workFormats: [] }, 'PROFILE_INCOMPLETE'],
    ['канал выбран, но не заполнен', { disclosureChannels: ['PHONE'] }, 'NO_CONTACT_CHANNEL'],
    ['каналы не выбраны', { disclosureChannels: [] }, 'NO_CONTACT_CHANNEL'],
    ['нет согласия на публикацию', { hasActivePublicationConsent: false }, 'NO_PUBLICATION_CONSENT'],
    ['видимость выключена', { isDiscoverable: false }, 'NOT_DISCOVERABLE'],
    ['статус PAUSED', { availability: 'PAUSED' }, 'PAUSED'],
  ])('%s → недоступен', (_title, facts, code) => {
    expect(codes(facts)).toContain(code);
    expect(evaluateDiscoverability({ ...ready, ...facts }).discoverable).toBe(false);
  });

  it('без подтверждённого грейда кандидат виден, но помечен: gradeConfirmed = false (рекомендация организаторов)', () => {
    expect(evaluateDiscoverability({ ...ready, confirmedSpecializations: [] })).toEqual({ discoverable: true, gradeConfirmed: false, issues: [] });
  });

  it('квалификация другой специализации не подтверждает активную', () => {
    expect(evaluateDiscoverability({ ...ready, activeSpecializationCode: 'FRONTEND', confirmedSpecializations: ['BACKEND'] }).gradeConfirmed).toBe(false);
  });

  it('заявленный грейд не подтверждает категорию: только тест', () => {
    expect(evaluateDiscoverability({ ...ready, confirmedSpecializations: [], declaredGrade: 'SENIOR' }).gradeConfirmed).toBe(false);
    expect(codes({ confirmedSpecializations: [] })).toEqual([]);
  });
});
