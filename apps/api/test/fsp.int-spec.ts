import { createTestApp, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { createCandidate, createEmployer } from './helpers/factories';
import { FspProviderError, type FspAchievementRecord, type FspProvider } from '../src/modules/fsp/fsp-provider';

// Демонстрационные участники из data/fixtures/fsp-mock.json.
const WITH_HISTORY = { fspId: 'FSP-DEMO-1001', code: '731905' }; // 2 достижения, роль BACKEND
const OTHER_WITH_HISTORY = { fspId: 'FSP-DEMO-1002', code: '284613' };
const EMPTY = { fspId: 'FSP-DEMO-2001', code: '502288' };
const UNAVAILABLE = { fspId: 'FSP-DEMO-3001', code: '860431' };

type BankItem = { candidateId: string; bankScore: number; fsp: { achievements: number; points: number } };

async function bankEntry(employer: Client, candidateId: string): Promise<BankItem | undefined> {
  const res = await employer.get('/employer/candidates?specialization=BACKEND&pageSize=50');
  expect(res.status).toBe(200);
  return (res.body.items as BankItem[]).find((item) => item.candidateId === candidateId);
}

describe('привязка ФСП ID и достижения (демонстрационный провайдер)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await ctx.prisma.$executeRawUnsafe('TRUNCATE "User", "FspLinkCodeRedemption", "AuditEvent" CASCADE');
  });

  it('до привязки состояние NOT_LINKED; интеграция помечена как демонстрационная', async () => {
    const { client } = await createCandidate(ctx, { publish: false });
    const state = await client.get('/candidate/fsp-link');
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ provider: 'mock', demo: true, state: 'NOT_LINKED', externalId: null, achievements: [] });
    expect(state.body.notice).toContain('Демонстрационная интеграция');
  });

  it('верный ID и код: история загружается, ID регистронезависим, исход считается по месту', async () => {
    const { client } = await createCandidate(ctx);
    const linked = await client.post('/candidate/fsp-link', { fspId: WITH_HISTORY.fspId.toLowerCase(), code: WITH_HISTORY.code });
    expect(linked.status).toBe(201);
    expect(linked.body).toMatchObject({ state: 'LINKED_WITH_HISTORY', externalId: 'FSP-DEMO-1001', demo: true });
    expect(linked.body.lastSuccessfulSyncAt).not.toBeNull();
    expect(linked.body.lastErrorCode).toBeNull();
    const achievements = linked.body.achievements as Array<{ outcome: string; place: number; eventTitle: string; isDemo: boolean; year: number }>;
    expect(achievements).toHaveLength(2);
    expect(achievements.map((a) => [a.place, a.outcome]).sort()).toEqual([[1, 'WIN'], [2, 'PRIZE']]);
    // Владелец видит названия мероприятий, все записи помечены как демонстрационные.
    expect(achievements.every((a) => a.eventTitle.startsWith('Демо:') && a.isDemo)).toBe(true);
    expect(achievements.map((a) => a.year).sort()).toEqual([2024, 2025]);
  });

  it('неверный код и неизвестный ID дают одинаковую ошибку (существование ID не раскрывается), привязки нет', async () => {
    const { client } = await createCandidate(ctx);
    const wrongCode = await client.post('/candidate/fsp-link', { fspId: WITH_HISTORY.fspId, code: '000000' });
    const unknownId = await client.post('/candidate/fsp-link', { fspId: 'FSP-DEMO-9999', code: '731905' });
    for (const res of [wrongCode, unknownId]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('FSP_CODE_INVALID');
    }
    expect(wrongCode.body.message).toBe(unknownId.body.message);
    const malformed = await client.post('/candidate/fsp-link', { fspId: 'a b', code: '731905' });
    expect(malformed.status).toBe(422);
    expect(malformed.body.code).toBe('VALIDATION_FAILED');
    expect(await ctx.prisma.fspLink.count()).toBe(0);
    expect(await ctx.prisma.fspLinkCodeRedemption.count()).toBe(0);
    expect((await client.get('/candidate/fsp-link')).body.state).toBe('NOT_LINKED');
  });

  it('чужой профиль не может занять уже привязанный ID; код одноразовый для других профилей, владелец может привязать заново', async () => {
    const owner = await createCandidate(ctx);
    const stranger = await createCandidate(ctx);
    expect((await owner.client.post('/candidate/fsp-link', WITH_HISTORY)).status).toBe(201);

    const taken = await stranger.client.post('/candidate/fsp-link', WITH_HISTORY);
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('FSP_ID_TAKEN');

    // После отвязки код уже погашен владельцем и недоступен другому профилю.
    expect((await owner.client.delete('/candidate/fsp-link')).body.state).toBe('NOT_LINKED');
    const reused = await stranger.client.post('/candidate/fsp-link', WITH_HISTORY);
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe('FSP_CODE_USED');
    expect(await ctx.prisma.fspLink.count()).toBe(0);

    const relinked = await owner.client.post('/candidate/fsp-link', WITH_HISTORY);
    expect(relinked.status).toBe(201);
    expect(relinked.body.state).toBe('LINKED_WITH_HISTORY');
    expect(await ctx.prisma.fspLinkCodeRedemption.count()).toBe(1);
  });

  it('параллельная привязка одного ID двумя профилями: успешна ровно одна', async () => {
    const a = await createCandidate(ctx);
    const b = await createCandidate(ctx);
    const [x, y] = await Promise.all([a.client.post('/candidate/fsp-link', OTHER_WITH_HISTORY), b.client.post('/candidate/fsp-link', OTHER_WITH_HISTORY)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const loser = x.status === 409 ? x : y;
    expect(['FSP_ID_TAKEN', 'FSP_CODE_USED']).toContain(loser.body.code);
    expect(await ctx.prisma.fspLink.count()).toBe(1);
    expect(await ctx.prisma.fspLinkCodeRedemption.count()).toBe(1);
  });

  it('повторная привязка уже привязанного профиля — 409; синхронизация без привязки — 409', async () => {
    const { client } = await createCandidate(ctx);
    const early = await client.post('/candidate/fsp-link/sync');
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('FSP_NOT_LINKED');
    await client.post('/candidate/fsp-link', WITH_HISTORY);
    const second = await client.post('/candidate/fsp-link', OTHER_WITH_HISTORY);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('FSP_ALREADY_LINKED');
  });

  it('ФСП ID без истории: LINKED_WITHOUT_HISTORY, достижений нет, бонуса нет', async () => {
    const candidate = await createCandidate(ctx);
    const employer = await createEmployer(ctx);
    const before = await bankEntry(employer.client, candidate.candidateId);
    const linked = await candidate.client.post('/candidate/fsp-link', EMPTY);
    expect(linked.status).toBe(201);
    expect(linked.body).toMatchObject({ state: 'LINKED_WITHOUT_HISTORY', achievements: [], lastErrorCode: null });
    const after = await bankEntry(employer.client, candidate.candidateId);
    expect(after?.fsp).toEqual({ achievements: 0, relevantEvents: 0, points: 0 });
    expect(after?.bankScore).toBe(before?.bankScore);
  });

  it('реестр недоступен: привязка в состоянии SYNC_ERROR, онбординг и поиск не ломаются', async () => {
    const candidate = await createCandidate(ctx);
    const employer = await createEmployer(ctx);
    const linked = await candidate.client.post('/candidate/fsp-link', UNAVAILABLE);
    expect(linked.status).toBe(201);
    expect(linked.body).toMatchObject({ state: 'SYNC_ERROR', lastErrorCode: 'FSP_UNAVAILABLE', achievements: [], lastSuccessfulSyncAt: null });

    // Профиль, тест и публикация продолжают работать.
    const me = await candidate.client.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.candidate.discoverable).toBe(true);
    const entry = await bankEntry(employer.client, candidate.candidateId);
    expect(entry).toBeDefined();
    expect(entry?.fsp.points).toBe(0);

    // Повторная попытка при той же недоступности ничего не ломает и остаётся в SYNC_ERROR.
    const retry = await candidate.client.post('/candidate/fsp-link/sync');
    expect(retry.status).toBe(200);
    expect(retry.body.state).toBe('SYNC_ERROR');
  });

  it('привязка даёт бонус в подборе, отвязка убирает бонус и достижения; повторная отвязка безвредна', async () => {
    const candidate = await createCandidate(ctx);
    const employer = await createEmployer(ctx);
    const before = await bankEntry(employer.client, candidate.candidateId);
    expect(before?.fsp.points).toBe(0);

    await candidate.client.post('/candidate/fsp-link', WITH_HISTORY);
    const linked = await bankEntry(employer.client, candidate.candidateId);
    expect(linked!.fsp.points).toBeGreaterThan(0);
    expect(linked!.fsp.achievements).toBe(2);
    expect(linked!.bankScore).toBeGreaterThan(before!.bankScore);

    const unlinked = await candidate.client.delete('/candidate/fsp-link');
    expect(unlinked.body).toMatchObject({ state: 'NOT_LINKED', achievements: [], externalId: null });
    const after = await bankEntry(employer.client, candidate.candidateId);
    expect(after?.fsp).toEqual({ achievements: 0, relevantEvents: 0, points: 0 });
    expect(after?.bankScore).toBe(before?.bankScore);
    expect(await ctx.prisma.fspAchievement.count()).toBe(0);

    expect((await candidate.client.delete('/candidate/fsp-link')).status).toBe(200);
  });

  it('скрытие ФСП от работодателей убирает достижения из карточки и бонус из подбора, владелец их по-прежнему видит', async () => {
    const candidate = await createCandidate(ctx);
    const employer = await createEmployer(ctx);
    await candidate.client.post('/candidate/fsp-link', WITH_HISTORY);
    expect((await bankEntry(employer.client, candidate.candidateId))!.fsp.points).toBeGreaterThan(0);
    const shown = await employer.client.get(`/employer/candidates/${candidate.candidateId}`);
    expect(shown.body.profile.fsp.linked).toBe(true);
    expect(shown.body.profile.fsp.achievements).toHaveLength(2);
    // В обезличенной карточке названия мероприятий не раскрываются.
    expect(JSON.stringify(shown.body.profile.fsp)).not.toContain('Демо: финал кубка');
    expect(shown.body.profile.fsp.demoNotice).toContain('Демонстрационная');

    expect((await candidate.client.patch('/candidate/profile', { showFspToEmployers: false })).status).toBe(200);
    const hidden = await employer.client.get(`/employer/candidates/${candidate.candidateId}`);
    expect(hidden.body.profile.fsp).toMatchObject({ linked: false, state: null, achievements: [], demoNotice: null });
    expect((await bankEntry(employer.client, candidate.candidateId))!.fsp.points).toBe(0);
    expect((await candidate.client.get('/candidate/fsp-link')).body.achievements).toHaveLength(2);
  });

  it('эндпоинты привязки доступны только кандидату', async () => {
    const employer = await createEmployer(ctx);
    expect((await employer.client.get('/candidate/fsp-link')).status).toBe(403);
    expect((await employer.client.post('/candidate/fsp-link', WITH_HISTORY)).status).toBe(403);
    expect((await employer.client.delete('/candidate/fsp-link')).status).toBe(403);
    expect((await new Client(ctx.app).get('/candidate/fsp-link')).status).toBe(401);
  });
});

describe('защита одноразового кода от перебора', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({ realRateLimit: true });
  });
  afterAll(() => ctx.close());

  it('после 10 попыток за 15 минут привязка блокируется даже с верным кодом; через окно доступ возвращается', async () => {
    const { client } = await createCandidate(ctx, { publish: false });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await client.post('/candidate/fsp-link', { fspId: WITH_HISTORY.fspId, code: String(100_000 + attempt) });
      expect(res.status).toBe(422);
    }
    const blocked = await client.post('/candidate/fsp-link', WITH_HISTORY);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(await ctx.prisma.fspLink.count()).toBe(0);

    ctx.clock.advance(15 * 60_000 + 1000);
    const ok = await client.post('/candidate/fsp-link', WITH_HISTORY);
    expect(ok.status).toBe(201);
  });
});

describe('нестабильный провайдер (подмена FspProvider)', () => {
  const record = (id: string, overrides: Partial<FspAchievementRecord> = {}): FspAchievementRecord => ({
    externalId: id,
    eventId: `ev-${id}`,
    eventTitle: `Событие ${id}`,
    discipline: 'PRODUCT',
    eventLevel: 'NATIONAL',
    eventDate: '2025-05-01',
    participationType: 'TEAM',
    place: 1,
    teamRole: 'BACKEND',
    skillTags: ['rest-api'],
    source: 'test',
    verifiedAt: null,
    ...overrides,
  });

  class FlakyProvider implements FspProvider {
    readonly name = 'flaky';
    readonly isDemo = true;
    failWith: Error | null = null;
    records: FspAchievementRecord[] = [record('r1')];
    async verifyLinkCode(_externalId: string, code: string) {
      return code === '424242';
    }
    async fetchAchievements() {
      if (this.failWith) throw this.failWith;
      return this.records.map((r) => ({ ...r }));
    }
  }

  const provider = new FlakyProvider();
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({ fspProvider: provider });
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    provider.failWith = null;
    provider.records = [record('r1')];
    await ctx.prisma.$executeRawUnsafe('TRUNCATE "User", "FspLinkCodeRedemption", "AuditEvent" CASCADE');
  });

  const link = (client: Client) => client.post('/candidate/fsp-link', { fspId: 'FLAKY-001', code: '424242' });

  it('ошибка синхронизации сохраняет последнюю успешную историю; после восстановления история заменяется актуальной', async () => {
    const candidate = await createCandidate(ctx);
    const employer = await createEmployer(ctx);
    const linked = await link(candidate.client);
    expect(linked.body).toMatchObject({ state: 'LINKED_WITH_HISTORY', provider: 'flaky' });
    const firstSuccess = linked.body.lastSuccessfulSyncAt as string;
    expect(linked.body.achievements).toHaveLength(1);

    ctx.clock.advanceHours(2);
    provider.failWith = new FspProviderError('FSP_UNAVAILABLE', 'реестр недоступен');
    const failed = await candidate.client.post('/candidate/fsp-link/sync');
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ state: 'SYNC_ERROR', lastErrorCode: 'FSP_UNAVAILABLE', lastSuccessfulSyncAt: firstSuccess });
    expect(new Date(failed.body.lastSyncAttemptAt).getTime()).toBeGreaterThan(new Date(firstSuccess).getTime());
    // История сохранена и у владельца, и в подборе.
    expect(failed.body.achievements).toHaveLength(1);
    expect((await bankEntry(employer.client, candidate.candidateId))!.fsp.achievements).toBe(1);

    // Другой тип ошибки провайдера фиксируется кодом, а не падением сервера.
    provider.failWith = new FspProviderError('FSP_BAD_RESPONSE', 'некорректный ответ');
    expect((await candidate.client.post('/candidate/fsp-link/sync')).body).toMatchObject({ state: 'SYNC_ERROR', lastErrorCode: 'FSP_BAD_RESPONSE' });
    provider.failWith = new Error('неожиданный сбой');
    expect((await candidate.client.post('/candidate/fsp-link/sync')).body).toMatchObject({ state: 'SYNC_ERROR', lastErrorCode: 'FSP_UNAVAILABLE' });

    provider.failWith = null;
    provider.records = [record('r1', { place: 3 }), record('r2', { eventId: 'ev-other', place: 1 })];
    const recovered = await candidate.client.post('/candidate/fsp-link/sync');
    expect(recovered.body).toMatchObject({ state: 'LINKED_WITH_HISTORY', lastErrorCode: null });
    expect(recovered.body.achievements).toHaveLength(2);

    provider.records = [];
    const emptied = await candidate.client.post('/candidate/fsp-link/sync');
    expect(emptied.body).toMatchObject({ state: 'LINKED_WITHOUT_HISTORY', achievements: [] });
    expect(await ctx.prisma.fspAchievement.count()).toBe(0);
  });

  it('записи без места, даты и роли не выдумываются: участие без года, карточки и PDF строятся без ошибок', async () => {
    provider.records = [record('sparse', { place: null, eventDate: null, teamRole: null, eventTitle: null, eventLevel: null, discipline: null, skillTags: [] })];
    const candidate = await createCandidate(ctx);
    const linked = await link(candidate.client);
    expect(linked.status).toBe(201);
    expect(linked.body.achievements).toEqual([expect.objectContaining({ place: null, year: null, outcome: 'PARTICIPATION', relevantToSpecialization: false, eventTitle: null })]);
    const employer = await createEmployer(ctx);
    expect((await employer.client.get(`/employer/candidates/${candidate.candidateId}`)).status).toBe(200);
    expect((await employer.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`)).status).toBe(200);
    expect((await candidate.client.getBuffer('/candidate/profile/pdf')).status).toBe(200);
    expect((await bankEntry(employer.client, candidate.candidateId))!.fsp.points).toBe(0);
  });

  it('несколько записей об одном мероприятии засчитываются один раз (лучший результат)', async () => {
    provider.records = [record('a', { eventId: 'ev-same', place: 2 }), record('b', { eventId: 'ev-same', place: 1 })];
    const candidate = await createCandidate(ctx);
    const employer = await createEmployer(ctx);
    await link(candidate.client);
    const one = (await bankEntry(employer.client, candidate.candidateId))!;
    expect(one.fsp.achievements).toBe(2);

    await candidate.client.post('/candidate/fsp-link/sync');
    provider.records = [record('a', { eventId: 'ev-same', place: 1 })];
    await candidate.client.post('/candidate/fsp-link/sync');
    const single = (await bankEntry(employer.client, candidate.candidateId))!;
    expect(single.fsp.points).toBe(one.fsp.points);
  });
});
