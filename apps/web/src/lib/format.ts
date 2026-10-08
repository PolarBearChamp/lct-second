const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—');
export const formatDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '—');
export const formatMoney = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${money.format(value)} ₽`);

/** «от 180 000 до 250 000 ₽ в месяц до вычета налогов». */
export function formatSalaryRange(from: number | null | undefined, to: number | null | undefined, withGross = true): string {
  const suffix = withGross ? ' в месяц до вычета налогов' : '';
  if (from && to) return `${money.format(from)} – ${money.format(to)} ₽${suffix}`;
  if (from) return `от ${money.format(from)} ₽${suffix}`;
  if (to) return `до ${money.format(to)} ₽${suffix}`;
  return 'не указаны';
}

export function formatMonths(months: number | null | undefined): string {
  if (months === null || months === undefined) return '—';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years ? `${years} ${plural(years, 'год', 'года', 'лет')}` : '';
  const m = rest ? `${rest} ${plural(rest, 'месяц', 'месяца', 'месяцев')}` : '';
  return [y, m].filter(Boolean).join(' ') || 'меньше месяца';
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Срок в часах → «30 дней» или «5 ч». */
export function formatHoursPeriod(hours: number): string {
  if (hours % 24 !== 0) return `${hours} ч`;
  const days = hours / 24;
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

/** Оставшееся время в формате мм:сс (или чч:мм:сс). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function relativeFromNow(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const text = abs < 3_600_000 ? 'меньше часа' : hours < 48 ? `${hours} ${plural(hours, 'час', 'часа', 'часов')}` : `${days} ${plural(days, 'день', 'дня', 'дней')}`;
  return diff >= 0 ? `через ${text}` : `${text} назад`;
}
