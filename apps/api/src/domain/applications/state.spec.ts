import {
  ACTIVE_APPLICATION_STATUSES,
  applyBlockers,
  canTransitionApplication,
  canTransitionVacancy,
  compareApplicationEvents,
  sourcesOf,
  vacancySources,
  type ApplicationStatusCode,
  type ApplyFacts,
} from './state';

const titles = { specialization: 'Backend-разработчик', fields: (codes: string[]) => codes.join(', ') };
const facts = (overrides: Partial<ApplyFacts> = {}): ApplyFacts => ({
  vacancyStatus: 'PUBLISHED',
  vacancySpecialization: 'BACKEND',
  confirmedSpecializations: ['BACKEND'],
  missingProfileFields: [],
  usableChannels: ['EMAIL'],
  hasActiveApplication: false,
  ...overrides,
});

describe('отклик: автомат статусов', () => {
  const all: ApplicationStatusCode[] = ['SENT', 'VIEWED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'];

  it('допустимые переходы совпадают с описанием', () => {
    expect(canTransitionApplication('SENT', 'VIEWED')).toBe(true);
    expect(canTransitionApplication('SENT', 'SHORTLISTED')).toBe(true);
    expect(canTransitionApplication('VIEWED', 'SHORTLISTED')).toBe(true);
    expect(canTransitionApplication('SHORTLISTED', 'REJECTED')).toBe(true);
    expect(canTransitionApplication('SHORTLISTED', 'WITHDRAWN')).toBe(true);
    // Назад к «просмотрено» и «новый» не возвращаемся.
    expect(canTransitionApplication('SHORTLISTED', 'VIEWED')).toBe(false);
    expect(canTransitionApplication('VIEWED', 'SENT')).toBe(false);
  });

  it('финальные статусы не переходят никуда, включая друг в друга', () => {
    for (const final of ['REJECTED', 'WITHDRAWN'] as const) {
      for (const to of all) expect([final, to, canTransitionApplication(final, to)]).toEqual([final, to, false]);
    }
  });

  it('активные статусы — ровно те, из которых возможен выход в итог', () => {
    expect([...ACTIVE_APPLICATION_STATUSES].sort()).toEqual(['SENT', 'SHORTLISTED', 'VIEWED']);
    expect(sourcesOf('REJECTED').sort()).toEqual(['SENT', 'SHORTLISTED', 'VIEWED']);
    expect(sourcesOf('WITHDRAWN').sort()).toEqual(['SENT', 'SHORTLISTED', 'VIEWED']);
    expect(sourcesOf('VIEWED')).toEqual(['SENT']);
    expect(sourcesOf('SHORTLISTED').sort()).toEqual(['SENT', 'VIEWED']);
  });

  it('история при одинаковых метках времени читается по ходу жизненного цикла', () => {
    const t = new Date('2026-10-06T10:00:00Z');
    const events = [
      { occurredAt: t, toStatus: 'SHORTLISTED' },
      { occurredAt: t, toStatus: 'SENT' },
      { occurredAt: t, toStatus: 'VIEWED' },
    ];
    expect(events.sort(compareApplicationEvents).map((e) => e.toStatus)).toEqual(['SENT', 'VIEWED', 'SHORTLISTED']);
  });
});

describe('вакансия: переходы', () => {
  it('публикация, закрытие и повторное открытие; черновик нельзя закрыть минуя публикацию', () => {
    expect(canTransitionVacancy('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransitionVacancy('PUBLISHED', 'CLOSED')).toBe(true);
    expect(canTransitionVacancy('CLOSED', 'PUBLISHED')).toBe(true);
    expect(canTransitionVacancy('DRAFT', 'CLOSED')).toBe(false);
    expect(canTransitionVacancy('PUBLISHED', 'DRAFT')).toBe(false);
    expect(vacancySources('PUBLISHED').sort()).toEqual(['CLOSED', 'DRAFT']);
    expect(vacancySources('CLOSED')).toEqual(['PUBLISHED']);
  });
});

describe('допуск к отклику', () => {
  it('подходящий кандидат: препятствий нет', () => {
    expect(applyBlockers(facts(), titles)).toEqual([]);
  });

  it('закрытая или неопубликованная вакансия — единственная причина, остальное не проверяется', () => {
    for (const vacancyStatus of ['DRAFT', 'CLOSED'] as const) {
      expect(applyBlockers(facts({ vacancyStatus, confirmedSpecializations: [] }), titles).map((b) => b.code)).toEqual(['VACANCY_NOT_OPEN']);
    }
  });

  it('нет подтверждённой квалификации по специализации вакансии — отклик закрыт (квалификация по другой специализации не подходит)', () => {
    const codes = applyBlockers(facts({ confirmedSpecializations: ['FRONTEND'] }), titles).map((b) => b.code);
    expect(codes).toEqual(['QUALIFICATION_REQUIRED']);
    expect(applyBlockers(facts({ confirmedSpecializations: [] }), titles)[0].message).toContain('Backend-разработчик');
  });

  it('неполный профиль и отсутствие канала раскрытия перечисляются вместе', () => {
    const blockers = applyBlockers(facts({ missingProfileFields: ['city', 'timezone'], usableChannels: [] }), titles);
    expect(blockers.map((b) => b.code)).toEqual(['PROFILE_INCOMPLETE', 'NO_CONTACT_CHANNEL']);
    expect(blockers[0].missingFields).toEqual(['city', 'timezone']);
  });

  it('уже есть активный отклик на эту вакансию', () => {
    expect(applyBlockers(facts({ hasActiveApplication: true }), titles).map((b) => b.code)).toEqual(['ACTIVE_APPLICATION_EXISTS']);
  });
});
