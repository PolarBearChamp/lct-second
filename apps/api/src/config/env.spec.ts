import { ConfigValidationError, parseEnv } from './env';
import { formatCooldown, getAssessmentPolicy, getInvitationPolicy, getMatchingFormula } from './policies';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  APP_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'x'.repeat(40),
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
} as NodeJS.ProcessEnv;

describe('конфигурация окружения', () => {
  it('принимает корректную конфигурацию и подставляет значения по умолчанию', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.SESSION_COOKIE_SECURE).toBe(false);
    expect(env.ASSESSMENT_POLICY_VERSION).toBe('assessment-policy-v2');
  });

  it('в production cookie по умолчанию Secure, локально по HTTP можно выключить явно', () => {
    expect(parseEnv({ ...valid, NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40) }).SESSION_COOKIE_SECURE).toBe(true);
    expect(parseEnv({ ...valid, NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40), SESSION_COOKIE_SECURE: 'false' }).SESSION_COOKIE_SECURE).toBe(false);
  });

  it('выводит понятный список ошибок при отсутствии обязательных переменных', () => {
    expect(() => parseEnv({} as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
    try {
      parseEnv({} as NodeJS.ProcessEnv);
    } catch (error) {
      const issues = (error as ConfigValidationError).issues.join('\n');
      for (const name of ['DATABASE_URL', 'APP_ORIGIN', 'SESSION_SECRET', 'SMTP_HOST']) expect(issues).toContain(name);
    }
  });

  it.each([
    ['короткий секрет сессии', { SESSION_SECRET: 'short' }],
    ['URL БД не PostgreSQL', { DATABASE_URL: 'mysql://x' }],
    ['origin с путём', { APP_ORIGIN: 'http://localhost:3000/app' }],
  ])('отклоняет: %s', (_title, patch) => {
    expect(() => parseEnv({ ...valid, ...patch } as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it('в production запрещён секрет из .env.example', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production', SESSION_SECRET: 'change-me-local-dev-secret-0123456789abcdef' } as NodeJS.ProcessEnv)).toThrow(/production/);
  });
});

describe('версионируемые политики', () => {
  it('пороги соответствуют принятым допущениям', () => {
    expect(getAssessmentPolicy('assessment-policy-v1')).toMatchObject({
      durationMinutes: 30,
      passOverall: 75,
      passGroupMin: 50,
      confidentOverall: 90,
      confidentGroupMin: 75,
      retryCooldownHours: 24,
      reassessmentDays: 90,
      skillEvidence: { minCases: 2, minScore: 70 },
    });
    // v2 отличается только сроком повтора того же уровня: 30 дней вместо 24 часов.
    const { version: _v1, retryCooldownHours: v1Retry, ...v1Rest } = getAssessmentPolicy('assessment-policy-v1');
    const { version: _v2, retryCooldownHours: v2Retry, ...v2Rest } = getAssessmentPolicy('assessment-policy-v2');
    expect(v2Rest).toEqual(v1Rest);
    expect([v1Retry, v2Retry]).toEqual([24, 720]);
    expect(formatCooldown(720)).toBe('30 дней');
    expect(formatCooldown(24)).toBe('1 день');
    expect(formatCooldown(5)).toBe('5 ч');
    expect(getMatchingFormula('matching-formula-v1').needWeights).toEqual({ preferredFit: 70, assessmentQuality: 25, fspEvidence: 5 });
    expect(getInvitationPolicy('invitation-policy-v1').ttlDays).toBe(14);
  });

  it('неизвестная версия политики — понятная ошибка', () => {
    expect(() => getAssessmentPolicy('nope')).toThrow(/Неизвестная версия/);
  });
});
