import { createHash } from 'node:crypto';

/** Детерминированный UUID (v5-подобный) по имени: повторный запуск seed обращается к тем же строкам. */
export function uuidFrom(name: string): string {
  const hash = createHash('sha1').update(`fsp-seed-v1|${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Короткий детерминированный числовой хеш (для выбора вариантов без Math.random). */
export function hashInt(name: string): number {
  return createHash('sha1').update(`fsp-seed-hash|${name}`).digest().readUInt32BE(0);
}
