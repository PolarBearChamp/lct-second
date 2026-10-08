import { ageAt, ageGroup, isMinor, isPlausibleBirthDate } from './age';

const NOW = new Date('2026-10-09T12:00:00Z');
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('возраст кандидата', () => {
  it('полные годы с учётом дня рождения', () => {
    expect(ageAt(d('2008-10-09'), NOW)).toBe(18);
    expect(ageAt(d('2008-10-10'), NOW)).toBe(17);
    expect(ageAt(d('2010-10-09'), NOW)).toBe(16);
    expect(ageAt(d('2010-10-10'), NOW)).toBe(15);
  });

  it('группы: до 16, 16–17, взрослый; без даты — неизвестно', () => {
    expect(ageGroup(d('2010-10-10'), NOW)).toBe('UNDER_16');
    expect(ageGroup(d('2010-10-09'), NOW)).toBe('MINOR_16_17');
    expect(ageGroup(d('2008-10-10'), NOW)).toBe('MINOR_16_17');
    expect(ageGroup(d('2008-10-09'), NOW)).toBe('ADULT');
    expect(ageGroup(null, NOW)).toBeNull();
    expect(isMinor(d('2009-05-01'), NOW)).toBe(true);
    expect(isMinor(d('1990-05-01'), NOW)).toBe(false);
  });

  it('в 18-й день рождения ограничения снимаются автоматически', () => {
    const birth = d('2008-12-31');
    expect(isMinor(birth, d('2026-12-30'))).toBe(true);
    expect(isMinor(birth, d('2026-12-31'))).toBe(false);
  });

  it('правдоподобная дата рождения: не в будущем, 10–100 лет', () => {
    expect(isPlausibleBirthDate(d('2030-01-01'), NOW)).toBe(false);
    expect(isPlausibleBirthDate(d('2020-01-01'), NOW)).toBe(false);
    expect(isPlausibleBirthDate(d('1900-01-01'), NOW)).toBe(false);
    expect(isPlausibleBirthDate(d('1995-06-15'), NOW)).toBe(true);
  });
});
