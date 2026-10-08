import { domainMatches, isValidInn, normalizeCompanyName, runVerification, type RegistryOrganization } from './verification';

const REGISTRY: RegistryOrganization[] = [{ inn: '0077010019', name: 'Демо Финтех', domains: ['demo.example'] }];
const find = (inn: string) => REGISTRY.find((o) => o.inn === inn) ?? null;

describe('проверка ИНН', () => {
  it('10 и 12 цифр с верными контрольными разрядами', () => {
    expect(isValidInn('0077010019')).toBe(true);
    expect(isValidInn('7707083893')).toBe(true); // общеизвестный пример из документации ФНС
    expect(isValidInn('500100732259')).toBe(true);
  });

  it('неверная длина, буквы и неверный контрольный разряд — отказ', () => {
    expect(isValidInn('0077010018')).toBe(false);
    expect(isValidInn('500100732258')).toBe(false);
    expect(isValidInn('12345')).toBe(false);
    expect(isValidInn('77070838a3')).toBe(false);
  });
});

describe('сопоставление названия и домена', () => {
  it('название без кавычек, формы и регистра', () => {
    expect(normalizeCompanyName('ООО «Демо Финтех»')).toBe(normalizeCompanyName('демо финтех'));
    expect(normalizeCompanyName('Демо Финтех')).not.toBe(normalizeCompanyName('Демо Ритейл'));
    expect(normalizeCompanyName('АО Ромашка')).toBe('ромашка');
    expect(normalizeCompanyName('Аорта')).toBe('аорта');
  });

  it('домен: совпадение или поддомен, но не «похожий» домен', () => {
    expect(domainMatches('demo.example', ['demo.example'])).toBe(true);
    expect(domainMatches('hr.demo.example', ['demo.example'])).toBe(true);
    expect(domainMatches('notdemo.example', ['demo.example'])).toBe(false);
    expect(domainMatches('', ['demo.example'])).toBe(false);
  });
});

describe('итог проверки', () => {
  it('все проверки пройдены — компания подтверждена', () => {
    const result = runVerification({ inn: '0077010019', companyName: 'ООО «Демо Финтех»', ownerEmail: 'hr.fintech@demo.example' }, find);
    expect(result.verified).toBe(true);
    expect(result.checks.map((c) => c.passed)).toEqual([true, true, true, true]);
  });

  it('каждая непройденная проверка названа: формат, реестр, название, домен почты', () => {
    expect(runVerification({ inn: '0077010018', companyName: 'Демо Финтех', ownerEmail: 'a@demo.example' }, find).checks.filter((c) => !c.passed).map((c) => c.code)).toEqual([
      'INN_FORMAT',
      'REGISTRY_FOUND',
      'NAME_MATCH',
      'EMAIL_DOMAIN',
    ]);
    expect(runVerification({ inn: '0077010019', companyName: 'Другая компания', ownerEmail: 'a@demo.example' }, find).checks.filter((c) => !c.passed).map((c) => c.code)).toEqual(['NAME_MATCH']);
    expect(runVerification({ inn: '0077010019', companyName: 'Демо Финтех', ownerEmail: 'a@gmail.example' }, find).checks.filter((c) => !c.passed).map((c) => c.code)).toEqual(['EMAIL_DOMAIN']);
  });
});
