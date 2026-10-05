import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { safeEqual } from '../auth/crypto';
import { FspProviderError, type FspAchievementRecord, type FspProvider } from './fsp-provider';

/** Формат демонстрационного «внешнего» реестра (см. data/fixtures/fsp-mock.json). */
interface ExternalParticipant {
  participant_id: string;
  one_time_code: string;
  mode: 'OK' | 'UNAVAILABLE';
  results: Array<{
    record_id: string;
    event?: { id?: string; title?: string; discipline?: string; level?: string; date?: string };
    participation?: string;
    place?: number | null;
    role?: string;
    skills?: string[];
    verified_at?: string;
  }>;
}

export function resolveFixturePath(file: string): string {
  const candidates = [
    process.env.FSP_MOCK_DATA_PATH,
    path.resolve(process.cwd(), 'data/fixtures', file),
    path.resolve(process.cwd(), '../../data/fixtures', file),
    path.resolve(__dirname, '../../../../../data/fixtures', file),
    path.resolve(__dirname, '../../../../data/fixtures', file),
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Не найден файл фикстуры ${file}. Укажите путь в FSP_MOCK_DATA_PATH.`);
  return found;
}

/**
 * Демонстрационный провайдер ФСП. Данные синтетические и явно помечаются как демонстрационные.
 * Ввод чужого ID без кода не даёт доступа к его достижениям.
 */
export class MockFspProvider implements FspProvider {
  readonly name = 'mock';
  readonly isDemo = true;
  private readonly participants: Map<string, ExternalParticipant>;

  constructor(fixturePath = resolveFixturePath('fsp-mock.json')) {
    const data = JSON.parse(readFileSync(fixturePath, 'utf8')) as { participants: ExternalParticipant[] };
    this.participants = new Map(data.participants.map((p) => [p.participant_id.toUpperCase(), p]));
  }

  async verifyLinkCode(externalId: string, code: string): Promise<boolean> {
    const participant = this.participants.get(externalId.toUpperCase());
    return Boolean(participant && safeEqual(participant.one_time_code, code.trim()));
  }

  async fetchAchievements(externalId: string): Promise<FspAchievementRecord[]> {
    const participant = this.participants.get(externalId.toUpperCase());
    if (!participant) throw new FspProviderError('FSP_NOT_FOUND', 'Участник не найден в реестре');
    if (participant.mode === 'UNAVAILABLE') throw new FspProviderError('FSP_UNAVAILABLE', 'Реестр ФСП временно недоступен');
    return participant.results.map((r) => ({
      externalId: r.record_id,
      eventId: r.event?.id ?? null,
      eventTitle: r.event?.title ?? null,
      discipline: r.event?.discipline ?? null,
      eventLevel: r.event?.level ?? null,
      eventDate: r.event?.date ?? null,
      participationType: r.participation ?? null,
      // Отсутствующие значения не придумываются: нет места — null.
      place: typeof r.place === 'number' ? r.place : null,
      teamRole: r.role ?? null,
      skillTags: r.skills ?? [],
      source: 'fsp-demo-registry',
      verifiedAt: r.verified_at ?? null,
    }));
  }
}
