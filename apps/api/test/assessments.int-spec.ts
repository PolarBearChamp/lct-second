import { createTestApp, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { createCandidate, fillProfile, startAttempt, submitAttempt, uniqueEmail } from './helpers/factories';
import { answerShape } from './helpers/answers';

/** Первый кейс с числовой частью (не у каждого семейства она есть). */
function numericPart(items: Array<{ id: string; task: { parts: Array<{ id: string; format: string }> } }>) {
  for (const item of items) {
    const part = item.task.parts.find((p) => p.format === 'NUMERIC');
    if (part) return { item, part };
  }
  throw new Error('В попытке нет числовых частей');
}

const SECRET_KEYS = ['correctOptionId', 'correctOptionIds', 'correctValue', 'correctPairs', 'correctOrder', 'privateKey', 'semanticMap', 'tolerance'];

describe('тестирование: жизненный цикл попытки, политика пересдач, квалификации', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  async function freshCandidate(spec: 'BACKEND' | 'FRONTEND' | 'ML_ENGINEER' | 'MANUAL_QA' = 'BACKEND') {
    const client = new Client(ctx.app, 'candidate');
    await client.registerAndVerify(ctx.mail, uniqueEmail('att'), 'CANDIDATE');
    await fillProfile(client, { activeSpecialization: spec });
    return client;
  }

  const qualificationOf = (client: Client) => client.get('/candidate/qualifications').then((r) => r.body);

  describe('публичные условия и защита банка', () => {
    it('клиент получает только публичные условия: ни ключей, ни семантических идентификаторов, ни допусков', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      expect(started.status).toBe(201);
      const json = JSON.stringify(started.body);
      for (const key of SECRET_KEYS) expect(json).not.toContain(key);
      expect(started.body.items).toHaveLength(6);
      const parts = started.body.items.reduce((sum: number, item: { task: { parts: unknown[] } }) => sum + item.task.parts.length, 0);
      expect(parts).toBeGreaterThanOrEqual(12);
      // Идентификаторы вариантов непрозрачны: не выдают ни семантику, ни правильность.
      for (const item of started.body.items) for (const part of item.task.parts) for (const option of part.options ?? []) expect(option.id).toMatch(/^o[A-Za-z0-9_-]{10}$/);
    });

    it('результат и история не раскрывают закрытый банк и ключи', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const result = await submitAttempt(ctx, client, started.body.id);
      expect(result.status).toBe(200);
      for (const body of [result.body, (await client.get('/candidate/assessments')).body, (await client.get(`/candidate/assessments/${started.body.id}/result`)).body]) {
        const json = JSON.stringify(body);
        for (const key of SECRET_KEYS) expect(json).not.toContain(key);
      }
    });

    it('чужую попытку нельзя ни читать, ни изменять, ни завершать (404)', async () => {
      const owner = await freshCandidate();
      const other = await freshCandidate();
      const started = await startAttempt(owner, 'BACKEND', 'MIDDLE');
      const id = started.body.id;
      const itemId = started.body.items[0].id;
      expect((await other.get(`/candidate/assessments/${id}`)).status).toBe(404);
      expect((await other.get(`/candidate/assessments/${id}/result`)).status).toBe(404);
      expect((await other.put(`/candidate/assessments/${id}/answers/${itemId}`, { answer: { parts: {} }, revision: 1 })).status).toBe(404);
      expect((await other.post(`/candidate/assessments/${id}/submit`, {})).status).toBe(404);
      expect((await other.post(`/candidate/assessments/${id}/abandon`)).status).toBe(404);
    });

    it('itemId должен принадлежать указанной попытке этого пользователя', async () => {
      const owner = await freshCandidate();
      const first = await startAttempt(owner, 'BACKEND', 'MIDDLE');
      await owner.post(`/candidate/assessments/${first.body.id}/abandon`);
      const second = await startAttempt(owner, 'BACKEND', 'JUNIOR');
      const foreignItem = first.body.items[0].id;
      const res = await owner.put(`/candidate/assessments/${second.body.id}/answers/${foreignItem}`, { answer: { parts: {} }, revision: 1 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ITEM_NOT_FOUND');
    });

    it('формат ответа проверяется по публичной схеме: чужие id вариантов и лишние поля отвергаются', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'JUNIOR');
      const item = started.body.items[0];
      const part = item.task.parts.find((p: { format: string }) => p.format === 'NUMERIC' || p.format === 'SINGLE_CHOICE');
      const bad = part.format === 'NUMERIC' ? { value: 'abc' } : { optionId: 'oNotAnOption' };
      const res = await client.put(`/candidate/assessments/${started.body.id}/answers/${item.id}`, { answer: { parts: { [part.id]: bad } }, revision: 1 });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ANSWER_INVALID');
    });
  });

  describe('создание попытки и конкурентность', () => {
    it('одновременный старт двух попыток создаёт ровно одну активную (частичный уникальный индекс)', async () => {
      const client = await freshCandidate();
      const [a, b] = await Promise.all([startAttempt(client, 'BACKEND', 'MIDDLE'), startAttempt(client, 'BACKEND', 'JUNIOR')]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const failed = a.status === 409 ? a : b;
      expect(failed.body.code).toBe('ASSESSMENT_NOT_ALLOWED');
      expect(failed.body.details.reason).toBe('ACTIVE_ATTEMPT');
      const mine = await client.get('/candidate/assessments');
      expect(mine.body.filter((x: { status: string }) => x.status === 'IN_PROGRESS')).toHaveLength(1);
    });

    it('Idempotency-Key: повтор запроса возвращает ту же попытку, а не создаёт новую', async () => {
      const client = await freshCandidate();
      const first = await startAttempt(client, 'BACKEND', 'MIDDLE', { 'Idempotency-Key': 'idem-key-0001' });
      const second = await startAttempt(client, 'BACKEND', 'MIDDLE', { 'Idempotency-Key': 'idem-key-0001' });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect((await client.get('/candidate/assessments')).body).toHaveLength(1);
    });

    it('снимки заданий и ключи сохраняются при создании попытки', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const items = await ctx.prisma.assessmentItem.findMany({ where: { attemptId: started.body.id } });
      expect(items).toHaveLength(6);
      expect(items.every((i) => i.fingerprint.length === 32 && i.seed.length >= 16)).toBe(true);
      const attempt = await ctx.prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: started.body.id } });
      expect(attempt.bankVersion).toMatch(/^bank-/);
      expect(attempt.policyVersion).toBe('assessment-policy-v1');
      expect(attempt.policySnapshot).toMatchObject({ passOverall: 75 });
    });

    it('повторяющиеся экземпляры не выдаются при наличии альтернатив: отпечатки между попытками различаются', async () => {
      const client = await freshCandidate();
      const first = await startAttempt(client, 'BACKEND', 'MIDDLE');
      await client.post(`/candidate/assessments/${first.body.id}/abandon`);
      ctx.clock.advanceHours(25);
      const second = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const prints = async (id: string) => (await ctx.prisma.assessmentItem.findMany({ where: { attemptId: id } })).map((i) => i.fingerprint);
      const a = await prints(first.body.id);
      const b = await prints(second.body.id);
      expect(a.filter((p) => b.includes(p))).toEqual([]);
    });
  });

  describe('автосохранение, ревизии и завершение', () => {
    it('устаревшая ревизия не перезаписывает более свежую; в ответе — принятый сервером вариант', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const attemptId = started.body.id;
      const { item, part } = numericPart(started.body.items);
      const answer = (value: number) => ({ answer: { parts: { [part.id]: { value } } } });

      expect((await client.put(`/candidate/assessments/${attemptId}/answers/${item.id}`, { ...answer(5), revision: 5 })).status).toBe(200);
      const stale = await client.put(`/candidate/assessments/${attemptId}/answers/${item.id}`, { ...answer(3), revision: 3 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_REVISION');
      expect(stale.body.details.current).toMatchObject({ revision: 5 });
      expect(stale.body.details.current.answer.parts[part.id]).toEqual({ value: 5 });
      // Повтор той же ревизии не затирает сохранённое.
      expect((await client.put(`/candidate/assessments/${attemptId}/answers/${item.id}`, { ...answer(99), revision: 5 })).status).toBe(409);

      const reloaded = await client.get(`/candidate/assessments/${attemptId}`);
      const reloadedItem = reloaded.body.items.find((i: { id: string }) => i.id === item.id);
      expect(reloadedItem).toMatchObject({ revision: 5 });
      expect(reloadedItem.answer.parts[part.id]).toEqual({ value: 5 });
    });

    it('параллельные автосохранения: побеждает наибольшая ревизия независимо от порядка прихода', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const { item, part } = numericPart(started.body.items);
      const revisions = [2, 8, 4, 6, 3, 7, 5];
      await Promise.all(revisions.map((revision) => client.put(`/candidate/assessments/${started.body.id}/answers/${item.id}`, { answer: { parts: { [part.id]: { value: revision * 10 } } }, revision })));
      const stored = await ctx.prisma.assessmentAnswer.findUniqueOrThrow({ where: { attemptId_itemId: { attemptId: started.body.id, itemId: item.id } } });
      expect(stored.revision).toBe(8);
      expect((stored.answer as { parts: Record<string, { value: number }> }).parts[part.id]).toEqual({ value: 80 });
    });

    it('завершение сначала сохраняет актуальные ответы: последняя правка из debounce не теряется', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const items = await ctx.prisma.assessmentItem.findMany({ where: { attemptId: started.body.id }, orderBy: { position: 'asc' } });
      // Ревизия 1 сохранена автосохранением с неверным ответом; верный ответ пришёл только вместе с завершением.
      const wrong = answerShape(items[0].privateKey as never, items[0].publicSnapshot as never, 'wrong');
      await client.put(`/candidate/assessments/${started.body.id}/answers/${items[0].id}`, { answer: wrong, revision: 1 });
      const answers = items.map((item, i) => ({ itemId: item.id, answer: answerShape(item.privateKey as never, item.publicSnapshot as never, 'correct'), revision: i === 0 ? 2 : 1 }));
      const result = await client.post(`/candidate/assessments/${started.body.id}/submit`, { answers });
      expect(result.status).toBe(200);
      expect(result.body.overallScore).toBe(100);
      expect(result.body.status).toBe('PASSED');
    });

    it('устаревший финальный ответ не заменяет более свежий сохранённый', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const items = await ctx.prisma.assessmentItem.findMany({ where: { attemptId: started.body.id }, orderBy: { position: 'asc' } });
      const correct = items.map((item) => answerShape(item.privateKey as never, item.publicSnapshot as never, 'correct'));
      for (const [i, item] of items.entries()) await client.put(`/candidate/assessments/${started.body.id}/answers/${item.id}`, { answer: correct[i], revision: 9 });
      const stale = items.map((item) => ({ itemId: item.id, answer: answerShape(item.privateKey as never, item.publicSnapshot as never, 'wrong'), revision: 2 }));
      const result = await client.post(`/candidate/assessments/${started.body.id}/submit`, { answers: stale });
      expect(result.body.overallScore).toBe(100);
    });

    it('повторное завершение возвращает тот же результат и не создаёт вторую квалификацию', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const first = await submitAttempt(ctx, client, started.body.id);
      const second = await client.post(`/candidate/assessments/${started.body.id}/submit`, {});
      const third = await submitAttempt(ctx, client, started.body.id, 'wrong');
      for (const r of [second, third]) {
        expect(r.status).toBe(200);
        expect(r.body.status).toBe(first.body.status);
        expect(r.body.overallScore).toBe(first.body.overallScore);
        expect(r.body.finishedAt).toBe(first.body.finishedAt);
      }
      const q = await qualificationOf(client);
      expect(q.qualifications).toHaveLength(1);
      expect(q.history).toHaveLength(1);
    });

    it('после завершения ответы изменять нельзя', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      await submitAttempt(ctx, client, started.body.id);
      const res = await client.put(`/candidate/assessments/${started.body.id}/answers/${started.body.items[0].id}`, { answer: { parts: {} }, revision: 99 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ATTEMPT_NOT_ACTIVE');
    });
  });

  describe('таймер определяется сервером', () => {
    it('перезагрузка не продлевает время: expiresAt не меняется', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      ctx.clock.advance(5 * 60_000);
      const reloaded = await client.get(`/candidate/assessments/${started.body.id}`);
      expect(reloaded.body.expiresAt).toBe(started.body.expiresAt);
      expect(new Date(started.body.expiresAt).getTime() - new Date(started.body.startedAt).getTime()).toBe(30 * 60_000);
    });

    it('по истечении времени попытка становится EXPIRED при чтении; квалификация не выдаётся; баллы — для обратной связи', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const items = await ctx.prisma.assessmentItem.findMany({ where: { attemptId: started.body.id }, orderBy: { position: 'asc' } });
      // Верно отвечены только первые два кейса и сохранены автосохранением.
      for (const item of items.slice(0, 2)) {
        await client.put(`/candidate/assessments/${started.body.id}/answers/${item.id}`, { answer: answerShape(item.privateKey as never, item.publicSnapshot as never, 'correct'), revision: 1 });
      }
      ctx.clock.advance(30 * 60_000 + 1000);
      const view = await client.get(`/candidate/assessments/${started.body.id}`);
      expect(view.body.status).toBe('EXPIRED');
      expect(view.body.items).toEqual([]);

      const result = await client.get(`/candidate/assessments/${started.body.id}/result`);
      expect(result.body.status).toBe('EXPIRED');
      expect(result.body.qualificationGranted).toBe(false);
      expect(result.body.overallScore).toBeGreaterThan(0);
      expect(result.body.overallScore).toBeLessThan(75);
      expect((await qualificationOf(client)).qualifications).toHaveLength(0);
    });

    it('сохранение ответа и завершение после истечения отклоняются; просрочка проверяется при изменении, без фоновой задачи', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      ctx.clock.advance(31 * 60_000);
      const save = await client.put(`/candidate/assessments/${started.body.id}/answers/${started.body.items[0].id}`, { answer: { parts: {} }, revision: 1 });
      expect(save.status).toBe(409);
      expect(save.body.code).toBe('ATTEMPT_EXPIRED');
      const submit = await submitAttempt(ctx, client, started.body.id);
      expect(submit.body.status).toBe('EXPIRED');
      expect(submit.body.qualificationGranted).toBe(false);
    });

    it('завершение ровно в момент expiresAt уже считается просроченным', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      ctx.clock.advance(30 * 60_000);
      const result = await submitAttempt(ctx, client, started.body.id);
      expect(result.body.status).toBe('EXPIRED');
    });

    it('на просроченной попытке старт новой возможен; задержка пересдачи того же грейда отсчитывается от expiresAt', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      ctx.clock.advance(35 * 60_000);
      const again = await startAttempt(client, 'BACKEND', 'MIDDLE');
      expect(again.status).toBe(409);
      expect(again.body.details.reason).toBe('RETRY_COOLDOWN');
      expect(new Date(again.body.details.availableAt).getTime()).toBe(new Date(started.body.expiresAt).getTime() + 24 * 3_600_000);
      expect((await startAttempt(client, 'BACKEND', 'JUNIOR')).status).toBe(201);
    });
  });

  describe('неуспех, прерывание и путь к более низкому грейду', () => {
    it('неуспешная первая попытка не выдаёт грейд и не публикует профиль; ограничения указывают точную дату', async () => {
      const client = await freshCandidate();
      await client.put('/candidate/consents', { profilePublication: true });
      await client.patch('/candidate/profile', { isDiscoverable: true });
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const result = await submitAttempt(ctx, client, started.body.id, 'wrong');
      expect(result.body.status).toBe('FAILED');
      expect(result.body.qualificationGranted).toBe(false);
      expect(result.body.statusMessage).toContain('не выдан');
      expect((await qualificationOf(client)).qualifications).toEqual([]);
      const me = await client.get('/auth/me');
      expect(me.body.candidate.confirmedGrade).toBeNull();
      expect(me.body.candidate.discoverable).toBe(false);
      expect(me.body.candidate.discoverabilityIssues.map((i: { code: string }) => i.code)).toContain('NO_CONFIRMED_QUALIFICATION');

      const retry = await startAttempt(client, 'BACKEND', 'MIDDLE');
      expect(retry.status).toBe(409);
      expect(retry.body.details.reason).toBe('RETRY_COOLDOWN');
      expect(new Date(retry.body.details.availableAt).getTime()).toBe(new Date(result.body.finishedAt).getTime() + 24 * 3_600_000);
    });

    it('граница 24 часов: за секунду до — 409, ровно через 24 часа — 201', async () => {
      const client = await freshCandidate();
      const first = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const failed = await submitAttempt(ctx, client, first.body.id, 'wrong');
      const finishedAt = new Date(failed.body.finishedAt).getTime();
      ctx.clock.set(new Date(finishedAt + 24 * 3_600_000 - 1000));
      expect((await startAttempt(client, 'BACKEND', 'MIDDLE')).status).toBe(409);
      ctx.clock.set(new Date(finishedAt + 24 * 3_600_000));
      expect((await startAttempt(client, 'BACKEND', 'MIDDLE')).status).toBe(201);
    });

    it('после неуспеха можно сразу пройти тест на более низкий грейд и получить подтверждение', async () => {
      const client = await freshCandidate();
      const first = await startAttempt(client, 'BACKEND', 'MIDDLE');
      await submitAttempt(ctx, client, first.body.id, 'wrong');
      const lower = await startAttempt(client, 'BACKEND', 'JUNIOR');
      expect(lower.status).toBe(201);
      const result = await submitAttempt(ctx, client, lower.body.id);
      expect(result.body.status).toBe('PASSED');
      const q = await qualificationOf(client);
      expect(q.qualifications[0]).toMatchObject({ specialization: 'BACKEND', grade: 'JUNIOR' });
    });

    it('«Прервать» создаёт ABANDONED и не позволяет обойти задержку пересдачи', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'SENIOR');
      const abandoned = await client.post(`/candidate/assessments/${started.body.id}/abandon`);
      expect(abandoned.status).toBe(200);
      expect(abandoned.body.status).toBe('ABANDONED');
      const blocked = await startAttempt(client, 'BACKEND', 'SENIOR');
      expect(blocked.status).toBe(409);
      expect(blocked.body.details.reason).toBe('RETRY_COOLDOWN');
      expect((await startAttempt(client, 'BACKEND', 'MIDDLE')).status).toBe(201);
    });

    it('во время теста правильность промежуточных ответов не раскрывается', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const items = await ctx.prisma.assessmentItem.findMany({ where: { attemptId: started.body.id }, orderBy: { position: 'asc' } });
      const saved = await client.put(`/candidate/assessments/${started.body.id}/answers/${items[0].id}`, { answer: answerShape(items[0].privateKey as never, items[0].publicSnapshot as never, 'correct'), revision: 1 });
      expect(Object.keys(saved.body).sort()).toEqual(['itemId', 'revision', 'savedAt']);
      const view = await client.get(`/candidate/assessments/${started.body.id}`);
      expect(JSON.stringify(view.body)).not.toMatch(/"(correct|score|passed|earned)/);
      expect((await client.get(`/candidate/assessments/${started.body.id}/result`)).status).toBe(409);
    });
  });

  describe('политика подтверждения: 90 дней, независимость специализаций, отсутствие автопонижения', () => {
    it('после первого PASSED квалификация создана, дата переоценки = +90 дней; до этой даты новая оценка закрыта', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const passed = await submitAttempt(ctx, client, started.body.id);
      expect(passed.body.status).toBe('PASSED');
      const { qualifications } = await qualificationOf(client);
      expect(qualifications[0]).toMatchObject({ grade: 'MIDDLE', specialization: 'BACKEND' });
      const confirmedAt = new Date(qualifications[0].confirmedAt).getTime();
      expect(new Date(qualifications[0].nextReassessmentAt).getTime()).toBe(confirmedAt + 90 * 86_400_000);

      for (const grade of ['JUNIOR', 'MIDDLE', 'SENIOR'] as const) {
        const blocked = await startAttempt(client, 'BACKEND', grade);
        expect(blocked.status).toBe(409);
        expect(blocked.body.details.reason).toBe('REASSESSMENT_LOCKED');
        expect(new Date(blocked.body.details.availableAt).getTime()).toBe(confirmedAt + 90 * 86_400_000);
      }
      ctx.clock.set(new Date(confirmedAt + 90 * 86_400_000 - 1000));
      await client.relogin();
      expect((await startAttempt(client, 'BACKEND', 'SENIOR')).status).toBe(409);
      ctx.clock.set(new Date(confirmedAt + 90 * 86_400_000));
      expect((await startAttempt(client, 'BACKEND', 'SENIOR')).status).toBe(201);
    });

    it('неуспех повторной оценки не понижает и не удаляет подтверждённый грейд', async () => {
      const client = await freshCandidate();
      const first = await startAttempt(client, 'BACKEND', 'MIDDLE');
      await submitAttempt(ctx, client, first.body.id);
      ctx.clock.advanceHours(24 * 91);
      await client.relogin();
      const retest = await startAttempt(client, 'BACKEND', 'SENIOR');
      const failed = await submitAttempt(ctx, client, retest.body.id, 'wrong');
      expect(failed.body.status).toBe('FAILED');
      const q = await qualificationOf(client);
      expect(q.qualifications).toHaveLength(1);
      expect(q.qualifications[0].grade).toBe('MIDDLE');
      expect(q.history).toHaveLength(1);
    });

    it('успех на более низком грейде после срока заменяет активный грейд (по осознанному выбору); вся история сохраняется', async () => {
      const client = await freshCandidate();
      const first = await startAttempt(client, 'BACKEND', 'MIDDLE');
      await submitAttempt(ctx, client, first.body.id);
      ctx.clock.advanceHours(24 * 91);
      await client.relogin();
      const eligibility = await client.get('/candidate/assessments/eligibility?specialization=BACKEND');
      const junior = eligibility.body.grades.find((g: { grade: string }) => g.grade === 'JUNIOR');
      expect(junior.allowed).toBe(true);
      expect(junior.warnings[0].code).toBe('REPLACES_WITH_LOWER_GRADE');
      const lower = await startAttempt(client, 'BACKEND', 'JUNIOR');
      await submitAttempt(ctx, client, lower.body.id);
      const q = await qualificationOf(client);
      expect(q.qualifications[0].grade).toBe('JUNIOR');
      expect(q.history.map((h: { eventType: string }) => h.eventType).sort()).toEqual(['CONFIRMED', 'LOWERED_BY_CHOICE']);
      expect(q.history.find((h: { eventType: string }) => h.eventType === 'LOWERED_BY_CHOICE').previousGrade).toBe('MIDDLE');
    });

    it('высокий балл не присваивает следующий грейд — только предлагает отдельную проверку', async () => {
      const client = await freshCandidate();
      const started = await startAttempt(client, 'BACKEND', 'MIDDLE');
      const result = await submitAttempt(ctx, client, started.body.id);
      expect(result.body.confident).toBe(true);
      expect(result.body.recommendations.some((r: { kind: string; grade?: string }) => r.kind === 'NEXT_GRADE' && r.grade === 'SENIOR')).toBe(true);
      expect((await qualificationOf(client)).qualifications[0].grade).toBe('MIDDLE');
    });

    it('повторное подтверждение того же грейда обновляет дату и пишет RECONFIRMED', async () => {
      const client = await freshCandidate();
      const first = await startAttempt(client, 'BACKEND', 'MIDDLE');
      await submitAttempt(ctx, client, first.body.id);
      ctx.clock.advanceHours(24 * 95);
      await client.relogin();
      const again = await startAttempt(client, 'BACKEND', 'MIDDLE');
      await submitAttempt(ctx, client, again.body.id);
      const q = await qualificationOf(client);
      expect(q.history.map((h: { eventType: string }) => h.eventType).sort()).toEqual(['CONFIRMED', 'RECONFIRMED']);
      expect(new Date(q.qualifications[0].nextReassessmentAt).getTime()).toBeGreaterThan(ctx.clock.now().getTime());
    });

    it('специализации независимы: подтверждение BACKEND не закрывает тест FRONTEND и не переносится на него', async () => {
      const { client } = await createCandidate(ctx, { specialization: 'BACKEND', grade: 'MIDDLE' });
      expect((await client.get('/auth/me')).body.candidate.discoverable).toBe(true);
      const frontend = await startAttempt(client, 'FRONTEND', 'MIDDLE');
      expect(frontend.status).toBe(201);
      await client.post(`/candidate/assessments/${frontend.body.id}/abandon`);
      // Смена активной специализации не переносит результат другой специализации.
      await client.patch('/candidate/profile', { activeSpecialization: 'FRONTEND' });
      const me = await client.get('/auth/me');
      expect(me.body.candidate.confirmedGrade).toBeNull();
      expect(me.body.candidate.discoverable).toBe(false);
      await client.patch('/candidate/profile', { activeSpecialization: 'BACKEND' });
      expect((await client.get('/auth/me')).body.candidate.discoverable).toBe(true);
    });

    it('изменение заявленного грейда не меняет подтверждённую квалификацию', async () => {
      const { client } = await createCandidate(ctx, { grade: 'MIDDLE' });
      await client.patch('/candidate/profile', { declaredGrade: 'SENIOR' });
      const me = await client.get('/auth/me');
      expect(me.body.candidate.declaredGrade).toBe('SENIOR');
      expect(me.body.candidate.confirmedGrade).toBe('MIDDLE');
    });

    it('подтверждены только навыки с покрытием ≥ 2 кейсов и результатом ≥ 70', async () => {
      const { client } = await createCandidate(ctx, { grade: 'MIDDLE' });
      const { qualifications } = await qualificationOf(client);
      const evidence = qualifications[0].skillEvidence as Array<{ skill: string; cases: number; score: number; status: string }>;
      expect(evidence.length).toBeGreaterThan(0);
      for (const e of evidence) {
        if (e.status === 'CONFIRMED') {
          expect(e.cases).toBeGreaterThanOrEqual(2);
          expect(e.score).toBeGreaterThanOrEqual(70);
        } else {
          expect(e.cases < 2 || e.score < 70).toBe(true);
        }
      }
      expect([...qualifications[0].verifiedSkills].sort()).toEqual(evidence.filter((e) => e.status === 'CONFIRMED').map((e) => e.skill).sort());
    });
  });

  describe('все четыре специализации и три грейда проходятся через API', () => {
    const matrix: Array<['FRONTEND' | 'BACKEND' | 'ML_ENGINEER' | 'MANUAL_QA', 'JUNIOR' | 'MIDDLE' | 'SENIOR']> = [];
    for (const spec of ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] as const) for (const grade of ['JUNIOR', 'MIDDLE', 'SENIOR'] as const) matrix.push([spec, grade]);
    it.each(matrix)('%s %s: тест строится, оценивается и подтверждает грейд', async (spec, grade) => {
      const client = await freshCandidate(spec);
      const started = await startAttempt(client, spec, grade);
      expect(started.status).toBe(201);
      expect(started.body.items.map((i: { groupCode: string }) => i.groupCode)).toHaveLength(6);
      const result = await submitAttempt(ctx, client, started.body.id);
      expect(result.body).toMatchObject({ status: 'PASSED', overallScore: 100 });
      expect(result.body.groups).toHaveLength(3);
      expect((await qualificationOf(client)).qualifications[0]).toMatchObject({ specialization: spec, grade });
    });
  });
});
