import { addDays, addHours } from '../../common/clock';
import { getAssessmentPolicy } from '../../config/policies';
import { checkEligibility, type EligibilityAttempt, type EligibilityInput } from './eligibility';

const policy = getAssessmentPolicy('assessment-policy-v2');
const NOW = new Date('2026-10-05T12:00:00.000Z');

const input = (overrides: Partial<EligibilityInput> = {}): EligibilityInput => ({
  now: NOW,
  specialization: 'BACKEND',
  grade: 'MIDDLE',
  policy,
  qualification: null,
  attempts: [],
  activeAttempt: null,
  ...overrides,
});

const failed = (grade: EligibilityAttempt['requestedGrade'], finishedAt: Date, status: EligibilityAttempt['status'] = 'FAILED', specialization = 'BACKEND'): EligibilityAttempt => ({
  specializationCode: specialization,
  requestedGrade: grade,
  status,
  finishedAt,
});

describe('допуск к тестированию', () => {
  it('первая попытка доступна сразу по любому грейду', () => {
    for (const grade of ['JUNIOR', 'MIDDLE', 'SENIOR'] as const) expect(checkEligibility(input({ grade })).allowed).toBe(true);
  });

  it('при активной попытке новая запрещена и указан её идентификатор', () => {
    const result = checkEligibility(input({ activeAttempt: { id: 'a1', specializationCode: 'BACKEND', requestedGrade: 'MIDDLE' } }));
    expect(result).toMatchObject({ allowed: false, reason: 'ACTIVE_ATTEMPT', activeAttemptId: 'a1' });
  });

  describe('повтор того же грейда после неуспеха — 30 дней (политика v2)', () => {
    const finishedAt = new Date('2026-10-04T12:00:00.000Z');

    it('за минуту до истечения 30 дней запрещено, дата доступности точная, срок в сообщении — в днях', () => {
      const result = checkEligibility(input({ now: new Date(addHours(finishedAt, 30 * 24).getTime() - 60_000), attempts: [failed('MIDDLE', finishedAt)] }));
      expect(result).toMatchObject({ allowed: false, reason: 'RETRY_COOLDOWN' });
      expect(result.availableAt?.toISOString()).toBe('2026-11-03T12:00:00.000Z');
      expect(result.message).toContain('через 30 дней');
    });

    it('через сутки (прежнее правило v1) ещё запрещено', () => {
      expect(checkEligibility(input({ now: addHours(finishedAt, 24), attempts: [failed('MIDDLE', finishedAt)] })).allowed).toBe(false);
    });

    it('ровно через 30 дней разрешено', () => {
      expect(checkEligibility(input({ now: addHours(finishedAt, 30 * 24), attempts: [failed('MIDDLE', finishedAt)] })).allowed).toBe(true);
    });

    it.each(['FAILED', 'EXPIRED', 'ABANDONED'] as const)('%s тоже запускает задержку', (status) => {
      expect(checkEligibility(input({ now: addHours(finishedAt, 3), attempts: [failed('MIDDLE', finishedAt, status)] })).allowed).toBe(false);
    });

    it('PASSED не создаёт задержки пересдачи', () => {
      expect(checkEligibility(input({ now: addHours(finishedAt, 3), attempts: [failed('MIDDLE', finishedAt, 'PASSED')] })).allowed).toBe(true);
    });

    it('более низкий грейд после неуспеха доступен сразу', () => {
      const attempts = [failed('MIDDLE', new Date(NOW.getTime() - 3_600_000))];
      expect(checkEligibility(input({ grade: 'MIDDLE', attempts })).allowed).toBe(false);
      expect(checkEligibility(input({ grade: 'JUNIOR', attempts })).allowed).toBe(true);
    });

    it('неуспех в другой специализации не мешает', () => {
      const attempts = [failed('MIDDLE', new Date(NOW.getTime() - 3_600_000), 'FAILED', 'FRONTEND')];
      expect(checkEligibility(input({ attempts })).allowed).toBe(true);
    });

    it('учитывается самая свежая неуспешная попытка', () => {
      const attempts = [failed('MIDDLE', addDays(NOW, -10)), failed('MIDDLE', new Date(NOW.getTime() - 3_600_000))];
      expect(checkEligibility(input({ attempts })).allowed).toBe(false);
    });
  });

  describe('новая оценка после подтверждения — 90 дней', () => {
    const confirmedAt = new Date('2026-07-07T12:00:00.000Z');
    const qualification = { confirmedGrade: 'MIDDLE' as const, nextReassessmentAt: addDays(confirmedAt, 90) };

    it('до даты переоценки запрещены все грейды этой специализации', () => {
      for (const grade of ['JUNIOR', 'MIDDLE', 'SENIOR'] as const) {
        const result = checkEligibility(input({ now: new Date(qualification.nextReassessmentAt.getTime() - 1000), grade, qualification }));
        expect(result).toMatchObject({ allowed: false, reason: 'REASSESSMENT_LOCKED' });
        expect(result.availableAt?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
      }
    });

    it('в момент nextReassessmentAt доступно (граница 90 дней)', () => {
      expect(checkEligibility(input({ now: qualification.nextReassessmentAt, qualification })).allowed).toBe(true);
    });

    it('специализации независимы: подтверждение BACKEND не блокирует FRONTEND', () => {
      expect(checkEligibility(input({ now: NOW, specialization: 'FRONTEND', qualification: null })).allowed).toBe(true);
    });

    it('предупреждения: понижение по выбору, повторное подтверждение, повышение', () => {
      const after = { now: qualification.nextReassessmentAt, qualification };
      expect(checkEligibility(input({ ...after, grade: 'JUNIOR' })).warnings[0].code).toBe('REPLACES_WITH_LOWER_GRADE');
      expect(checkEligibility(input({ ...after, grade: 'MIDDLE' })).warnings[0].code).toBe('RECONFIRMS_GRADE');
      expect(checkEligibility(input({ ...after, grade: 'SENIOR' })).warnings[0].code).toBe('RAISES_GRADE');
    });

    it('после срока переоценки действует и задержка пересдачи того же грейда', () => {
      const result = checkEligibility(
        input({ now: addDays(qualification.nextReassessmentAt, 1), qualification, attempts: [failed('SENIOR', new Date(addDays(qualification.nextReassessmentAt, 1).getTime() - 3_600_000))], grade: 'SENIOR' }),
      );
      expect(result).toMatchObject({ allowed: false, reason: 'RETRY_COOLDOWN' });
    });
  });
});
