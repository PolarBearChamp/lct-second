import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify, argon2id } from 'argon2';

/** Криптографически случайный непрозрачный токен (base64url). Math.random не используется. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** В БД хранится только SHA-256 от токена сессии / подтверждения. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Параметры Argon2id по рекомендации OWASP (m=19 MiB, t=2, p=1).
const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Заранее вычисленный хеш для выравнивания времени ответа при несуществующем email. */
let dummyHashPromise: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(generateToken(16));
  return dummyHashPromise;
}

/**
 * CSRF-токен по схеме signed double-submit: `<random>.<hmac(secret, random)>`.
 * Токен лежит в cookie (не HttpOnly) и дублируется клиентом в заголовке X-CSRF-Token.
 */
export function createCsrfToken(secret: string): string {
  const nonce = generateToken(24);
  return `${nonce}.${signCsrf(secret, nonce)}`;
}

export function isValidCsrfToken(secret: string, token: string | undefined): boolean {
  if (!token) return false;
  const [nonce, signature, extra] = token.split('.');
  if (!nonce || !signature || extra !== undefined) return false;
  return safeEqual(signature, signCsrf(secret, nonce));
}

function signCsrf(secret: string, nonce: string): string {
  return createHmac('sha256', secret).update(`csrf:${nonce}`).digest('base64url');
}

export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}
