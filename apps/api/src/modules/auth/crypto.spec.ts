import { createCsrfToken, generateToken, hashPassword, isValidCsrfToken, normalizeEmail, safeEqual, sha256, verifyPassword } from './crypto';

describe('криптография авторизации', () => {
  it('пароль хранится как Argon2id-хеш и проверяется', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-9');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('Correct-Horse');
    expect(await verifyPassword(hash, 'Correct-Horse-Battery-9')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('два хеша одного пароля различаются (соль)', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('токены случайны, достаточно длинны и не повторяются', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken(32)));
    expect(tokens.size).toBe(500);
    expect([...tokens][0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('в БД хранится только хеш токена, а не сам токен', () => {
    const token = generateToken(32);
    expect(sha256(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(token)).not.toContain(token);
    expect(sha256(token)).toBe(sha256(token));
  });

  it('CSRF-токен подписан секретом: подделка и чужой секрет отвергаются', () => {
    const secret = 'a'.repeat(40);
    const token = createCsrfToken(secret);
    expect(isValidCsrfToken(secret, token)).toBe(true);
    expect(isValidCsrfToken('b'.repeat(40), token)).toBe(false);
    const [nonce] = token.split('.');
    expect(isValidCsrfToken(secret, `${nonce}.forged`)).toBe(false);
    expect(isValidCsrfToken(secret, undefined)).toBe(false);
    expect(isValidCsrfToken(secret, `${token}.extra`)).toBe(false);
  });

  it('сравнение строк постоянного времени работает с разной длиной', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('email нормализуется: регистр, пробелы, юникод', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });
});
