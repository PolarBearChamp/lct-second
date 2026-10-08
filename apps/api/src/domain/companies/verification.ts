/**
 * Добровольная проверка компании — метка доверия, которая не блокирует основной сценарий (ответ организаторов на встрече
 * с участниками: такой вариант допустим). Чистые функции; реестр передаётся снаружи (в MVP — демонстрационный).
 */

export type VerificationCheckCode = 'INN_FORMAT' | 'REGISTRY_FOUND' | 'NAME_MATCH' | 'EMAIL_DOMAIN';

export interface VerificationCheck {
  code: VerificationCheckCode;
  passed: boolean;
  text: string;
}

export interface RegistryOrganization {
  inn: string;
  name: string;
  /** Домены корпоративной почты организации. */
  domains: string[];
}

const W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const checkDigit = (digits: number[], weights: number[]) => (weights.reduce((sum, w, i) => sum + w * digits[i], 0) % 11) % 10;

/** ИНН юрлица (10 цифр) или физлица/ИП (12 цифр) с корректными контрольными разрядами. */
export function isValidInn(inn: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(inn)) return false;
  const d = inn.split('').map(Number);
  if (d.length === 10) return checkDigit(d, W10) === d[9];
  return checkDigit(d, W11) === d[10] && checkDigit(d, W12) === d[11];
}

/** Название без кавычек, организационно-правовой формы и различий в регистре и «ё». */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'„“”]/g, ' ')
    // \b в JS не работает с кириллицей — границы слова задаются пробелами.
    .replace(/(^|\s)(ооо|ао|пао|зао|оао|ип|llc|ltd|inc)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function emailDomain(email: string): string {
  return email.split('@')[1]?.trim().toLowerCase() ?? '';
}

/** Домен совпадает с одним из разрешённых или является его поддоменом. */
export function domainMatches(domain: string, allowed: readonly string[]): boolean {
  return Boolean(domain) && allowed.some((a) => domain === a.toLowerCase() || domain.endsWith(`.${a.toLowerCase()}`));
}

export function runVerification(
  input: { inn: string; companyName: string; ownerEmail: string },
  findOrganization: (inn: string) => RegistryOrganization | null,
): { verified: boolean; checks: VerificationCheck[] } {
  const checks: VerificationCheck[] = [];
  const formatOk = isValidInn(input.inn);
  checks.push({ code: 'INN_FORMAT', passed: formatOk, text: formatOk ? 'ИНН корректен (контрольные разряды сходятся)' : 'ИНН некорректен: 10 или 12 цифр с верными контрольными разрядами' });
  const organization = formatOk ? findOrganization(input.inn) : null;
  checks.push({ code: 'REGISTRY_FOUND', passed: Boolean(organization), text: organization ? 'Организация найдена в реестре' : 'Организация с таким ИНН в реестре не найдена' });
  const nameOk = Boolean(organization) && normalizeCompanyName(organization!.name) === normalizeCompanyName(input.companyName);
  checks.push({
    code: 'NAME_MATCH',
    passed: nameOk,
    text: nameOk ? 'Название совпадает с реестром' : organization ? `Название в профиле не совпадает с реестром («${organization.name}»)` : 'Название не с чем сравнить',
  });
  const domain = emailDomain(input.ownerEmail);
  const domainOk = Boolean(organization) && domainMatches(domain, organization!.domains);
  checks.push({
    code: 'EMAIL_DOMAIN',
    passed: domainOk,
    text: domainOk ? `Почта аккаунта на домене организации (${domain})` : `Почта аккаунта (${domain || 'без домена'}) не на домене организации из реестра`,
  });
  return { verified: checks.every((c) => c.passed), checks };
}
