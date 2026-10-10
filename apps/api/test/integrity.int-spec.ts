import { answerShape } from './helpers/answers';
import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { normalize, readPdf } from './helpers/pdf';
import { createEmployer, fillProfile, publish, startAttempt, submitAttempt, uniqueEmail } from './helpers/factories';

/**
 * Сигналы честности прохождения теста (ответ организаторов FTT.4: проверка не требуется, но будет большим плюсом).
 * Сигналы — информация: на баллы и грейд они не влияют, содержимое ответов не передаётся.
 */
describe('сигналы честности прохождения теста', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.prisma));

  async function candidateWithAttempt() {
    const client = new Client(ctx.app, 'candidate');
    await client.registerAndVerify(ctx.mail, uniqueEmail('integrity'), 'CANDIDATE');
    await fillProfile(client);
    const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
    expect(started.status).toBe(201);
    const me = await client.get('/auth/me');
    return { client, attemptId: started.body.id as string, candidateId: me.body.candidate.profileId as string };
  }

  /** Спокойное прохождение: верный ответ на каждый кейс через stepMs после предыдущего (как автосохранение при обычной работе). */
  async function answerSlowly(client: Client, attemptId: string, stepMs = 3 * 60_000) {
    const items = await ctx.prisma.assessmentItem.findMany({ where: { attemptId }, orderBy: { position: 'asc' } });
    for (const item of items) {
      ctx.clock.advance(stepMs);
      const saved = await client.put(`/candidate/assessments/${attemptId}/answers/${item.id}`, {
        answer: answerShape(item.privateKey as never, item.publicSnapshot as never, 'correct'),
        revision: 1,
      });
      expect(saved.status).toBe(200);
    }
  }

  const signalCodes = (body: { integrity: { signals: Array<{ code: string }> } | null }) => (body.integrity?.signals ?? []).map((s) => s.code);

  describe('приём сигналов', () => {
    it('принимает счётчики только у своей активной попытки', async () => {
      const owner = await candidateWithAttempt();
      const stranger = new Client(ctx.app, 'stranger');
      await stranger.registerAndVerify(ctx.mail, uniqueEmail('stranger'), 'CANDIDATE');
      await fillProfile(stranger);

      expect((await owner.client.post(`/candidate/assessments/${owner.attemptId}/signals`, { tabHiddenCount: 1, tabHiddenMs: 4_000, pasteCount: 1 })).status).toBe(204);
      // Чужая попытка выглядит как несуществующая, без утечки факта её существования.
      const foreign = await stranger.post(`/candidate/assessments/${owner.attemptId}/signals`, { tabHiddenCount: 5 });
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('ATTEMPT_NOT_FOUND');
      // Без входа — отказ.
      expect((await new Client(ctx.app, 'anon').post(`/candidate/assessments/${owner.attemptId}/signals`, { tabHiddenCount: 1 })).status).toBe(401);

      const row = await ctx.prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: owner.attemptId } });
      expect(row).toMatchObject({ tabHiddenCount: 1, tabHiddenMs: 4_000, pasteCount: 1, copyCount: 0, focusLossCount: 0 });
      expect(row.integrity).toBeNull();
    });

    it('счётчики накапливаются; нулевой и пустой пакеты допустимы', async () => {
      const { client, attemptId } = await candidateWithAttempt();
      const url = `/candidate/assessments/${attemptId}/signals`;
      await client.post(url, { tabHiddenCount: 2, tabHiddenMs: 10_000, focusLossCount: 3 });
      await client.post(url, { tabHiddenCount: 1, tabHiddenMs: 5_000, copyCount: 2 });
      expect((await client.post(url, {})).status).toBe(204);
      expect(await ctx.prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({
        tabHiddenCount: 3,
        tabHiddenMs: 15_000,
        copyCount: 2,
        focusLossCount: 3,
      });
    });

    it('значения вне допустимых границ отклоняются, а накопленное время со скрытой вкладкой не превышает длительность теста', async () => {
      const { client, attemptId } = await candidateWithAttempt();
      const url = `/candidate/assessments/${attemptId}/signals`;
      for (const body of [{ tabHiddenCount: -1 }, { tabHiddenCount: 51 }, { tabHiddenMs: 1_800_001 }, { pasteCount: 1.5 }, { copyCount: '3' }]) {
        expect([body, (await client.post(url, body)).status]).toEqual([body, 422]);
      }
      // Два максимальных пакета: время ограничено сверху длительностью теста (30 минут), число уходов — тысячей.
      await client.post(url, { tabHiddenCount: 50, tabHiddenMs: 1_800_000 });
      await client.post(url, { tabHiddenCount: 50, tabHiddenMs: 1_800_000 });
      const row = await ctx.prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(row.tabHiddenMs).toBe(30 * 60_000);
      expect(row.tabHiddenCount).toBe(100);
    });

    it('после завершения и после истечения времени сигналы не принимаются (409)', async () => {
      const finished = await candidateWithAttempt();
      await submitAttempt(ctx, finished.client, finished.attemptId);
      const afterSubmit = await finished.client.post(`/candidate/assessments/${finished.attemptId}/signals`, { tabHiddenCount: 1 });
      expect([afterSubmit.status, afterSubmit.body.code]).toEqual([409, 'ATTEMPT_NOT_ACTIVE']);

      const second = new Client(ctx.app, 'second');
      await second.registerAndVerify(ctx.mail, uniqueEmail('late'), 'CANDIDATE');
      await fillProfile(second);
      const started = await startAttempt(second, 'FRONTEND', 'JUNIOR');
      ctx.clock.advance(31 * 60_000);
      const late = await second.post(`/candidate/assessments/${started.body.id}/signals`, { pasteCount: 5 });
      expect([late.status, late.body.code]).toEqual([409, 'ATTEMPT_EXPIRED']);
      const row = await ctx.prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: started.body.id } });
      expect(row).toMatchObject({ status: 'EXPIRED', pasteCount: 0 });
    });
  });

  describe('время первого сохранения ответа', () => {
    it('не меняется при повторных сохранениях, а время последнего сохранения обновляется', async () => {
      const { client, attemptId } = await candidateWithAttempt();
      const [item] = await ctx.prisma.assessmentItem.findMany({ where: { attemptId }, orderBy: { position: 'asc' } });
      const url = `/candidate/assessments/${attemptId}/answers/${item.id}`;
      const answer = answerShape(item.privateKey as never, item.publicSnapshot as never, 'wrong');
      expect((await client.put(url, { answer, revision: 1 })).status).toBe(200);
      const first = await ctx.prisma.assessmentAnswer.findFirstOrThrow({ where: { attemptId, itemId: item.id } });
      expect(first.firstSavedAt?.getTime()).toBe(first.savedAt.getTime());

      ctx.clock.advance(2 * 60_000);
      expect((await client.put(url, { answer: answerShape(item.privateKey as never, item.publicSnapshot as never, 'correct'), revision: 2 })).status).toBe(200);
      const second = await ctx.prisma.assessmentAnswer.findFirstOrThrow({ where: { attemptId, itemId: item.id } });
      expect(second.firstSavedAt?.getTime()).toBe(first.firstSavedAt?.getTime());
      expect(second.savedAt.getTime() - first.savedAt.getTime()).toBe(2 * 60_000);
    });
  });

  describe('оценка при завершении', () => {
    it('обычное прохождение без особых действий — без сигналов', async () => {
      const { client, attemptId } = await candidateWithAttempt();
      await answerSlowly(client, attemptId);
      const result = await client.post(`/candidate/assessments/${attemptId}/submit`, { answers: [] });
      expect(result.body.status).toBe('PASSED');
      expect(result.body.integrity).toMatchObject({ level: 'NONE', signals: [], version: 'integrity-signals-v1' });
      expect(result.body.integrity.counters).toEqual({ tabHiddenCount: 0, tabHiddenMs: 0, pasteCount: 0, copyCount: 0, focusLossCount: 0 });
      // Тот же результат при повторном чтении.
      expect((await client.get(`/candidate/assessments/${attemptId}/result`)).body.integrity).toEqual(result.body.integrity);
    });

    it('уходы со вкладки и вставка попадают в сводку; серверные сигналы скорости — по времени сохранений', async () => {
      const { client, attemptId } = await candidateWithAttempt();
      await client.post(`/candidate/assessments/${attemptId}/signals`, { tabHiddenCount: 4, tabHiddenMs: 120_000, pasteCount: 1 });
      await answerSlowly(client, attemptId);
      const result = await client.post(`/candidate/assessments/${attemptId}/submit`, { answers: [] });
      expect(result.body.integrity.level).toBe('NOTE');
      expect(signalCodes(result.body)).toEqual(['TAB_HIDDEN', 'PASTE']);
      expect(result.body.integrity.signals[0]).toMatchObject({ severity: 'NOTE', value: 4 });
      expect(result.body.integrity.signals[0].text).toContain('Вкладка теста скрывалась 4 раза');
    });

    it('мгновенное прохождение: быстрое завершение и быстро решённые кейсы — предупреждение', async () => {
      const { client, attemptId } = await candidateWithAttempt();
      const result = await submitAttempt(ctx, client, attemptId);
      expect(result.body.status).toBe('PASSED');
      expect(signalCodes(result.body)).toEqual(['FAST_COMPLETION', 'FAST_ITEMS']);
      expect(result.body.integrity.level).toBe('ATTENTION');
    });

    it('сигналы не влияют на баллы и грейд: те же ответы дают тот же результат', async () => {
      const calm = await candidateWithAttempt();
      await answerSlowly(calm.client, calm.attemptId);
      const calmResult = await calm.client.post(`/candidate/assessments/${calm.attemptId}/submit`, { answers: [] });

      const noisy = new Client(ctx.app, 'noisy');
      await noisy.registerAndVerify(ctx.mail, uniqueEmail('noisy'), 'CANDIDATE');
      await fillProfile(noisy);
      const started = await startAttempt(noisy, 'BACKEND', 'MIDDLE');
      await noisy.post(`/candidate/assessments/${started.body.id}/signals`, { tabHiddenCount: 20, tabHiddenMs: 600_000, pasteCount: 9, copyCount: 9 });
      const noisyResult = await submitAttempt(ctx, noisy, started.body.id);

      expect(calmResult.body.integrity.level).toBe('NONE');
      expect(noisyResult.body.integrity.level).toBe('ATTENTION');
      // Задания в попытках разные (экземпляры случайны), поэтому сравниваются итоговые оценки, а не число частей.
      for (const field of ['status', 'overallScore', 'confident']) expect(noisyResult.body[field]).toEqual(calmResult.body[field]);
      const groupScores = (body: { groups: Array<{ group: string; score: number }> }) => body.groups.map((g) => [g.group, g.score]);
      expect(groupScores(noisyResult.body)).toEqual(groupScores(calmResult.body));
      const qualification = await noisy.get('/candidate/qualifications');
      expect(qualification.body.qualifications[0]).toMatchObject({ grade: 'MIDDLE', specialization: 'BACKEND' });
    });

    it('при истечении времени оценка тоже сохраняется; у прерванной попытки её нет', async () => {
      const expired = await candidateWithAttempt();
      await expired.client.post(`/candidate/assessments/${expired.attemptId}/signals`, { pasteCount: 4 });
      ctx.clock.advance(31 * 60_000);
      const result = await expired.client.get(`/candidate/assessments/${expired.attemptId}/result`);
      expect(result.body.status).toBe('EXPIRED');
      expect(signalCodes(result.body)).toEqual(['PASTE']);

      const quitter = new Client(ctx.app, 'quitter');
      await quitter.registerAndVerify(ctx.mail, uniqueEmail('quitter'), 'CANDIDATE');
      await fillProfile(quitter);
      const started = await startAttempt(quitter, 'FRONTEND', 'JUNIOR');
      await quitter.post(`/candidate/assessments/${started.body.id}/abandon`);
      expect((await quitter.get(`/candidate/assessments/${started.body.id}/result`)).body.integrity).toBeNull();
    });
  });

  describe('работодатель', () => {
    /** Кандидат прошёл тест со знакомым набором сигналов и опубликован. */
    async function publishedCandidate(signals: Record<string, number>, slow: boolean) {
      const c = await candidateWithAttempt();
      if (Object.keys(signals).length) await c.client.post(`/candidate/assessments/${c.attemptId}/signals`, signals);
      if (slow) {
        await answerSlowly(c.client, c.attemptId);
        await c.client.post(`/candidate/assessments/${c.attemptId}/submit`, { answers: [] });
      } else {
        await submitAttempt(ctx, c.client, c.attemptId);
      }
      await publish(c.client);
      return c;
    }

    it('видит сводный уровень в банке и нейтральные формулировки в карточке, но не счётчики', async () => {
      const calm = await publishedCandidate({}, true);
      const noted = await publishedCandidate({ tabHiddenCount: 4, tabHiddenMs: 90_000, pasteCount: 1 }, true);
      const employer = await createEmployer(ctx);

      const bank = await employer.client.get('/employer/candidates?specialization=BACKEND');
      const level = (id: string) => bank.body.items.find((i: { candidateId: string }) => i.candidateId === id).integrityLevel;
      expect([level(calm.candidateId), level(noted.candidateId)]).toEqual(['NONE', 'NOTE']);

      const card = await employer.client.get(`/employer/candidates/${noted.candidateId}`);
      expect(card.status).toBe(200);
      expect(card.body.profile.qualification.integrity).toEqual({
        level: 'NOTE',
        signals: [
          expect.objectContaining({ code: 'TAB_HIDDEN', severity: 'NOTE', value: 4 }),
          expect.objectContaining({ code: 'PASTE', severity: 'NOTE', value: 1 }),
        ],
      });
      expect(JSON.stringify(card.body)).not.toMatch(/tabHiddenMs|focusLossCount|counters/);
      expect((await employer.client.get(`/employer/candidates/${calm.candidateId}`)).body.profile.qualification.integrity).toMatchObject({ level: 'NONE', signals: [] });

      // PDF строится тем же представлением: те же формулировки, без счётчиков.
      const pdf = await employer.client.getBuffer(`/employer/candidates/${noted.candidateId}/pdf`);
      expect(pdf.status).toBe(200);
      const pdfText = normalize(readPdf(pdf.body).text);
      expect(pdfText).toContain('Сигналы при прохождении теста');
      expect(pdfText).toContain('Вкладка теста скрывалась 4 раза');
      expect(pdfText).not.toContain('tabHidden');

      // Кандидат видит ту же сводку в предпросмотре своей карточки.
      const preview = await noted.client.get('/candidate/profile/preview');
      expect(preview.body.qualification.integrity.level).toBe('NOTE');
    });

    it('у попыток без оценки (до введения сигналов) уровень не показывается', async () => {
      const c = await publishedCandidate({}, true);
      await ctx.prisma.$executeRaw`UPDATE "AssessmentAttempt" SET "integrity" = NULL WHERE "id" = ${c.attemptId}::uuid`;
      const employer = await createEmployer(ctx);
      const bank = await employer.client.get('/employer/candidates?specialization=BACKEND');
      expect(bank.body.items[0].integrityLevel).toBeNull();
      expect((await employer.client.get(`/employer/candidates/${c.candidateId}`)).body.profile.qualification.integrity).toBeNull();
    });

    it('оценка не попадает в аудит и не меняет порядок в банке', async () => {
      const noisy = await publishedCandidate({ tabHiddenCount: 12, tabHiddenMs: 400_000, pasteCount: 5, copyCount: 6 }, false);
      const calm = await publishedCandidate({}, true);
      const employer = await createEmployer(ctx);
      const bank = await employer.client.get('/employer/candidates?specialization=BACKEND');
      // Одинаковые баллы и навыки: сигналы честности порядок не меняют, он определяется только подбором.
      expect(bank.body.items).toHaveLength(2);
      expect(new Set(bank.body.items.map((i: { bankScore: number }) => i.bankScore)).size).toBe(1);
      expect(bank.body.items.map((i: { candidateId: string }) => i.candidateId).sort()).toEqual([calm.candidateId, noisy.candidateId].sort());
      const audit = await ctx.prisma.auditEvent.findMany();
      expect(JSON.stringify(audit)).not.toMatch(/tabHidden|pasteCount|copyCount|integrity/i);
    });
  });
});

describe('ограничение частоты отправки сигналов', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({ realRateLimit: true });
  });
  afterAll(() => ctx.close());

  it('не больше 200 пакетов за 30 минут на попытку; лимит одной попытки не мешает другим', async () => {
    const client = new Client(ctx.app, 'limited');
    await client.registerAndVerify(ctx.mail, uniqueEmail('limited'), 'CANDIDATE');
    await fillProfile(client);
    const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
    const url = `/candidate/assessments/${started.body.id}/signals`;
    for (let i = 0; i < 200; i += 1) {
      const res = await client.post(url, { focusLossCount: 1 });
      if (res.status !== 204) throw new Error(`пакет ${i + 1}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const limited = await client.post(url, { focusLossCount: 1 });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    const row = await ctx.prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: started.body.id } });
    expect(row.focusLossCount).toBe(200);
  });
});
