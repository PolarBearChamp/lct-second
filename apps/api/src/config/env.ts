import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL обязателен')
      .refine((value) => /^postgres(ql)?:\/\//.test(value), 'DATABASE_URL должен быть URL PostgreSQL'),
    APP_ORIGIN: z
      .string()
      .min(1, 'APP_ORIGIN обязателен')
      .refine((value) => /^https?:\/\/[^/]+$/.test(value), 'APP_ORIGIN — origin без пути, например http://localhost:3000'),
    TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
    SESSION_COOKIE_NAME: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('fsp_session'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(168),
    SESSION_COOKIE_SECURE: booleanFromString.optional(),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET должен содержать не менее 32 символов'),
    SMTP_HOST: z.string().min(1, 'SMTP_HOST обязателен'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_SECURE: booleanFromString.default(false),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    MAIL_FROM: z.string().min(3).default('ФСП Таланты <no-reply@fsp-talent.example>'),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    FSP_PROVIDER: z.enum(['mock']).default('mock'),
    ASSESSMENT_POLICY_VERSION: z.string().default('assessment-policy-v1'),
    MATCHING_FORMULA_VERSION: z.string().default('matching-formula-v1'),
    INVITATION_POLICY_VERSION: z.string().default('invitation-policy-v1'),
    SWAGGER_ENABLED: booleanFromString.default(true),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  })
  .transform((env) => ({
    ...env,
    // В production cookie по умолчанию Secure; локально по HTTP можно явно выключить.
    SESSION_COOKIE_SECURE: env.SESSION_COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }));

export type AppEnv = z.infer<typeof envSchema>;

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Некорректная конфигурация окружения:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

/** Валидирует переменные окружения при старте и выбрасывает понятную ошибку. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  if (result.data.NODE_ENV === 'production' && result.data.SESSION_SECRET.startsWith('change-me')) {
    throw new ConfigValidationError(['SESSION_SECRET: в production нельзя использовать значение из .env.example']);
  }
  return result.data;
}

export const APP_ENV = Symbol('APP_ENV');
