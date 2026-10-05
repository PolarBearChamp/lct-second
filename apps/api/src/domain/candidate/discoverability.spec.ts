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
};

const codes = (facts: Partial<DiscoverabilityFacts>) => evaluateDiscoverability({ ...ready, ...facts }).issues.map((i) => i.code);

describe('условия попадания кандидата в поиск', () => {
  it('все условия выполнены — кандидат виден', () => {
    expect(evaluateDiscoverability(ready)).toEqual({ discoverable: true, issues: [] });
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
    ['нет подтверждённой квалификации', { confirmedSpecializations: [] }, 'NO_CONFIRMED_QUALIFICATION'],
  ])('%s → недоступен', (_title, facts, code) => {
    expect(codes(facts)).toContain(code);
    expect(evaluateDiscoverability({ ...ready, ...facts }).discoverable).toBe(false);
  });

  it('квалификация другой специализации не делает кандидата видимым по активной', () => {
    expect(codes({ activeSpecializationCode: 'FRONTEND', confirmedSpecializations: ['BACKEND'] })).toContain('NO_CONFIRMED_QUALIFICATION');
  });

  it('заявленный грейд не влияет на видимость — только подтверждённая квалификация', () => {
    expect(evaluateDiscoverability({ ...ready, declaredGrade: 'SENIOR' }).discoverable).toBe(true);
    expect(codes({ confirmedSpecializations: [], declaredGrade: 'SENIOR' })).toContain('NO_CONFIRMED_QUALIFICATION');
  });
});
