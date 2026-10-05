import { createRng } from '../../src/domain/assessment/rng';
import type { Rng } from '../../src/domain/assessment/types';
import { hashInt } from './ids';

/**
 * Синтетические участники демонстрационного реестра ФСП (формат намеренно «внешний», не совпадает с моделью платформы).
 * Файл data/fixtures/fsp-mock.json генерируется этим кодом: `pnpm --filter @fsp/api fixtures:fsp`.
 * Участники FSP-DEMO-* написаны вручную и при генерации сохраняются без изменений.
 */

export const SEED_PARTICIPANTS_PER_SPEC = 10;
export const SEED_SPECS = ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] as const;

const EVENTS = [
  { id: 'ev-2023-product-cup', title: 'Демо: кубок по продуктовому программированию 2023', discipline: 'PRODUCT', level: 'NATIONAL', date: '2023-11-12' },
  { id: 'ev-2024-product-volga', title: 'Демо: межрегиональный хакатон «Волга» 2024', discipline: 'PRODUCT', level: 'INTERREGIONAL', date: '2024-06-22' },
  { id: 'ev-2024-algo-regional', title: 'Демо: региональный этап по алгоритмическому программированию 2024', discipline: 'ALGORITHMIC', level: 'REGIONAL', date: '2024-10-05' },
  { id: 'ev-2024-algo-national', title: 'Демо: всероссийская олимпиада по алгоритмическому программированию 2024', discipline: 'ALGORITHMIC', level: 'NATIONAL', date: '2024-12-07' },
  { id: 'ev-2025-product-cup-final', title: 'Демо: финал кубка по продуктовому программированию 2025', discipline: 'PRODUCT', level: 'NATIONAL', date: '2025-11-14' },
  { id: 'ev-2025-security-regional', title: 'Демо: региональные соревнования по программированию систем ИБ 2025', discipline: 'SECURITY', level: 'REGIONAL', date: '2025-04-18' },
  { id: 'ev-2025-uav-national', title: 'Демо: всероссийские соревнования по программированию БАС 2025', discipline: 'UAV', level: 'NATIONAL', date: '2025-09-12' },
  { id: 'ev-2023-robotics-school', title: 'Демо: школьные соревнования по робототехнике 2023', discipline: 'ROBOTICS', level: 'REGIONAL', date: '2023-03-11' },
  { id: 'ev-2025-product-hack-volga', title: 'Демо: межрегиональный хакатон «Волга» 2025', discipline: 'PRODUCT', level: 'INTERREGIONAL', date: '2025-06-21' },
  { id: 'ev-2025-algo-international', title: 'Демо: международный турнир по алгоритмическому программированию 2025', discipline: 'ALGORITHMIC', level: 'INTERNATIONAL', date: '2025-08-02' },
];

const ROLES: Record<string, string[]> = {
  FRONTEND: ['FRONTEND', 'FULLSTACK', 'CAPTAIN'],
  BACKEND: ['BACKEND', 'FULLSTACK', 'CAPTAIN'],
  ML_ENGINEER: ['ML', 'ML', 'CAPTAIN'],
  MANUAL_QA: ['QA', 'QA', 'CAPTAIN'],
};
const DISCIPLINES: Record<string, string[]> = {
  FRONTEND: ['PRODUCT', 'PRODUCT', 'PRODUCT', 'ROBOTICS'],
  BACKEND: ['PRODUCT', 'ALGORITHMIC', 'SECURITY', 'PRODUCT'],
  ML_ENGINEER: ['PRODUCT', 'UAV', 'ALGORITHMIC', 'ROBOTICS'],
  MANUAL_QA: ['PRODUCT', 'SECURITY', 'PRODUCT', 'UAV'],
};
const SKILLS: Record<string, string[]> = {
  FRONTEND: ['react', 'typescript', 'javascript', 'http'],
  BACKEND: ['rest-api', 'postgresql', 'sql', 'http'],
  ML_ENGINEER: ['python', 'pandas', 'scikit-learn', 'model-validation'],
  MANUAL_QA: ['test-design', 'bug-reporting', 'boundary-testing'],
};

export interface FspParticipant {
  participant_id: string;
  one_time_code: string;
  mode: 'OK' | 'UNAVAILABLE';
  results: Array<{
    record_id: string;
    event: { id: string; title: string; discipline: string; level: string; date: string };
    participation: string;
    place: number | null;
    role?: string;
    skills: string[];
    verified_at?: string;
  }>;
}

export const seedParticipantId = (n: number) => `FSP-SEED-${String(n).padStart(3, '0')}`;
export const seedParticipantCode = (n: number) => String(100_000 + (hashInt(`fsp-code|${n}`) % 900_000));
export const seedParticipantSpec = (n: number) => SEED_SPECS[(n - 1) % SEED_SPECS.length];

function pickPlace(rng: Rng): number | null {
  const roll = rng.next();
  if (roll < 0.16) return 1;
  if (roll < 0.42) return rng.pick([2, 3]);
  if (roll < 0.8) return rng.int(4, 12);
  return null;
}

export function buildSeedParticipant(n: number, empty = false): FspParticipant {
  const spec = seedParticipantSpec(n);
  const rng = createRng(`fsp-seed|${n}`);
  const base = { participant_id: seedParticipantId(n), one_time_code: seedParticipantCode(n), mode: 'OK' as const };
  if (empty) return { ...base, results: [] };
  const count = rng.int(1, 4);
  const used = new Set<string>();
  const results: FspParticipant['results'] = [];
  for (let i = 0; i < count; i += 1) {
    const discipline = rng.pick(DISCIPLINES[spec]);
    const candidates = EVENTS.filter((e) => e.discipline === discipline && !used.has(e.id));
    if (candidates.length === 0) continue;
    const event = rng.pick(candidates);
    used.add(event.id);
    const place = pickPlace(rng);
    results.push({
      record_id: `rec-${seedParticipantId(n).toLowerCase()}-${String(i + 1).padStart(2, '0')}`,
      event,
      participation: rng.bool(0.7) ? 'TEAM' : 'INDIVIDUAL',
      place,
      ...(discipline === 'ALGORITHMIC' && rng.bool(0.6) ? {} : { role: rng.pick(ROLES[spec]) }),
      skills: rng.sample(SKILLS[spec], rng.int(0, 2)),
      ...(rng.bool(0.5) ? { verified_at: `${event.date}T12:00:00Z` } : {}),
    });
  }
  return { ...base, results };
}

/** Участники сидера: 10 на каждую специализацию; по одному «пустому» (привязан без истории). */
export function buildAllSeedParticipants(): FspParticipant[] {
  const total = SEED_PARTICIPANTS_PER_SPEC * SEED_SPECS.length;
  return Array.from({ length: total }, (_, i) => buildSeedParticipant(i + 1, i + 1 > total - SEED_SPECS.length));
}
