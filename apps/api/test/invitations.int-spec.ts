import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { Client } from './helpers/client';
import { createCandidate, createEmployer, invitationBody } from './helpers/factories';
import { normalize, readPdf } from './helpers/pdf';

const SECRET = {
  name: 'Приватов Тайный Секретович',
  email: 'private.person@secret-mail.example',
  phone: '+7 911 765-43-21',
  messenger: '@private_handle',
};

describe('приглашения и раскрытие контактов', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.prisma));

  async function setup(options: { channels?: string[] } = {}) {
    const candidate = await createCandidate(ctx, {
      specialization: 'BACKEND',
      grade: 'MIDDLE',
      profile: {
        fullName: SECRET.name,
        contactEmail: SECRET.email,
        phone: SECRET.phone,
        messenger: SECRET.messenger,
        externalLinks: ['https://example.org/private-portfolio'],
        experienceDescription: 'Работал в закрытой компании над секретным проектом.',
        disclosureChannels: options.channels ?? ['EMAIL'],
      },
    });
    const a = await createEmployer(ctx, { name: 'Компания Альфа' });
    const b = await createEmployer(ctx, { name: 'Компания Бета' });
    return { candidate, a, b };
  }

  const send = (client: Client, candidateId: string, overrides: Record<string, unknown> = {}, headers?: Record<string, string>) =>
    client.post('/employer/invitations', invitationBody(candidateId, overrides), headers);

  const leaks = (value: unknown) => Object.values(SECRET).filter((secret) => JSON.stringify(value).includes(secret));

  describe('создание и обязательные поля', () => {
    it('зарплатная вилка обязательна: нет вилки, from > to, не GROSS, нулевые значения — отказ', async () => {
      const { candidate, a } = await setup();
      const body = invitationBody(candidate.candidateId);
      const without = { ...body } as Record<string, unknown>;
      delete without.salaryFrom;
      delete without.salaryTo;
      expect((await a.client.post('/employer/invitations', without)).status).toBe(422);
      expect((await send(a.client, candidate.candidateId, { salaryFrom: 400_000, salaryTo: 300_000 })).status).toBe(422);
      expect((await send(a.client, candidate.candidateId, { salaryType: 'NET' })).status).toBe(422);
      expect((await send(a.client, candidate.candidateId, { salaryFrom: 0 })).status).toBe(422);
      expect((await send(a.client, candidate.candidateId, { salaryFrom: 250_000.5 })).status).toBe(422);
      expect((await send(a.client, candidate.candidateId, { title: '' })).status).toBe(422);
    });

    it('привязка к опубликованной вакансии не требуется; в карточке приглашения у кандидата — зарплата и компания', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ status: 'SENT', salaryFrom: 250_000, salaryTo: 320_000, salaryType: 'GROSS', needId: null });
      const incoming = await candidate.client.get(`/candidate/invitations/${created.body.id}`);
      expect(incoming.body).toMatchObject({ status: 'SENT', companyName: 'Компания Альфа', salaryFrom: 250_000, salaryTo: 320_000, employerContact: 'hr@test-company.example' });
      expect(incoming.body.companyVerified).toBe(false);
    });

    it('нельзя пригласить скрытого кандидата, кандидата без квалификации и несуществующего', async () => {
      const { candidate, a } = await setup();
      const untested = await createCandidate(ctx, { skipAssessment: true });
      expect((await send(a.client, untested.candidateId)).status).toBe(404);
      expect((await send(a.client, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      await candidate.client.patch('/candidate/profile', { isDiscoverable: false });
      expect((await send(a.client, candidate.candidateId)).status).toBe(404);
    });

    it('предложение неизменно после отправки: изменить можно только отозвав и создав новое', async () => {
      const { candidate, a } = await setup();
      const first = await send(a.client, candidate.candidateId);
      expect((await a.client.patch(`/employer/invitations/${first.body.id}`, { salaryFrom: 1 })).status).toBe(404);
      const duplicate = await send(a.client, candidate.candidateId, { salaryFrom: 260_000 });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('ACTIVE_INVITATION_EXISTS');
      expect((await a.client.post(`/employer/invitations/${first.body.id}/withdraw`)).status).toBe(200);
      const replacement = await send(a.client, candidate.candidateId, { salaryFrom: 260_000 });
      expect(replacement.status).toBe(201);
      expect(replacement.body.salaryFrom).toBe(260_000);
    });

    it('снимок предложения и компании хранится в приглашении и не содержит приватных данных кандидата', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      const row = await ctx.prisma.invitation.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(JSON.stringify(row)).not.toContain(SECRET.name);
      expect(JSON.stringify(row)).not.toContain(SECRET.email);
      expect(row.companySnapshot).toMatchObject({ name: 'Компания Альфа' });
      await a.client.put('/employer/company', { name: 'Переименованная компания', contactChannelType: 'EMAIL', contactValue: 'new@test-company.example' });
      const incoming = await candidate.client.get(`/candidate/invitations/${created.body.id}`);
      expect(incoming.body.companyName).toBe('Компания Альфа');
    });
  });

  describe('идемпотентность и конкурентность', () => {
    it('Idempotency-Key: повтор отправки возвращает то же приглашение (200), а не создаёт новое', async () => {
      const { candidate, a } = await setup();
      const first = await send(a.client, candidate.candidateId, {}, { 'Idempotency-Key': 'invite-key-0001' });
      const second = await send(a.client, candidate.candidateId, {}, { 'Idempotency-Key': 'invite-key-0001' });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(await ctx.prisma.invitation.count()).toBe(1);
    });

    it('двойной клик: два параллельных запроса создают ровно одно активное приглашение', async () => {
      const { candidate, a } = await setup();
      const [x, y] = await Promise.all([send(a.client, candidate.candidateId), send(a.client, candidate.candidateId, { title: 'Дубль' })]);
      expect([x.status, y.status].sort()).toEqual([201, 409]);
      expect(await ctx.prisma.invitation.count({ where: { status: { in: ['SENT', 'VIEWED'] } } })).toBe(1);
    });

    it('разные компании могут одновременно пригласить одного кандидата', async () => {
      const { candidate, a, b } = await setup();
      const [x, y] = await Promise.all([send(a.client, candidate.candidateId), send(b.client, candidate.candidateId)]);
      expect([x.status, y.status]).toEqual([201, 201]);
    });

    it('одновременные accept и withdraw: побеждает ровно один, состояние и доступ согласованы', async () => {
      for (let round = 0; round < 4; round += 1) {
        const { candidate, a } = await setup();
        const created = await send(a.client, candidate.candidateId);
        const [accepted, withdrawn] = await Promise.all([
          candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: true }),
          a.client.post(`/employer/invitations/${created.body.id}/withdraw`),
        ]);
        expect([accepted.status, withdrawn.status].sort()).toEqual([200, 409]);
        const row = await ctx.prisma.invitation.findUniqueOrThrow({ where: { id: created.body.id } });
        const grants = await ctx.prisma.contactAccessGrant.count();
        if (row.status === 'ACCEPTED') {
          expect(accepted.status).toBe(200);
          expect(withdrawn.body.code).toBe('INVITATION_FINAL');
          expect(grants).toBe(1);
        } else {
          expect(row.status).toBe('WITHDRAWN');
          expect(withdrawn.status).toBe(200);
          expect(accepted.body.code).toBe('INVITATION_FINAL');
          expect(grants).toBe(0);
        }
        const events = await ctx.prisma.invitationEvent.findMany({ where: { invitationId: created.body.id } });
        expect(events.filter((e) => e.toStatus === 'ACCEPTED' || e.toStatus === 'WITHDRAWN')).toHaveLength(1);
        await resetDatabase(ctx.prisma);
      }
    });

    it('параллельные повторные accept идемпотентны: одна запись ACCEPTED и один доступ', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      const results = await Promise.all(Array.from({ length: 4 }, () => candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: true })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(await ctx.prisma.contactAccessGrant.count()).toBe(1);
      expect(await ctx.prisma.invitationEvent.count({ where: { invitationId: created.body.id, toStatus: 'ACCEPTED' } })).toBe(1);
    });
  });

  describe('статусы и переходы', () => {
    it('чтение списка и карточки не переводит в VIEWED; просмотр фиксируется только явным действием', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      await candidate.client.get('/candidate/invitations');
      await candidate.client.get(`/candidate/invitations/${created.body.id}`);
      expect((await a.client.get(`/employer/invitations/${created.body.id}`)).body.status).toBe('SENT');
      const viewed = await candidate.client.post(`/candidate/invitations/${created.body.id}/view`);
      expect(viewed.body.status).toBe('VIEWED');
      expect((await a.client.get(`/employer/invitations/${created.body.id}`)).body.status).toBe('VIEWED');
      // Повторный просмотр безвреден и не возвращает в SENT.
      expect((await candidate.client.post(`/candidate/invitations/${created.body.id}/view`)).body.status).toBe('VIEWED');
    });

    it('обе стороны видят актуальный статус; история переходов фиксируется', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      await candidate.client.post(`/candidate/invitations/${created.body.id}/view`);
      await candidate.client.post(`/candidate/invitations/${created.body.id}/decline`, { reason: 'SALARY' });
      const employerView = await a.client.get(`/employer/invitations/${created.body.id}`);
      expect(employerView.body.status).toBe('DECLINED');
      expect(employerView.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['SENT', 'VIEWED', 'DECLINED']);
      expect((await candidate.client.get('/candidate/invitations')).body.items[0].status).toBe('DECLINED');
    });

    it('финальные статусы не переходят друг в друга (409); повтор того же действия идемпотентен', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      const id = created.body.id;
      expect((await candidate.client.post(`/candidate/invitations/${id}/decline`, {})).status).toBe(200);
      expect((await candidate.client.post(`/candidate/invitations/${id}/decline`, {})).status).toBe(200);
      const accept = await candidate.client.post(`/candidate/invitations/${id}/accept`, { confirmDisclosure: true });
      expect(accept.status).toBe(409);
      expect(accept.body.code).toBe('INVITATION_FINAL');
      const withdraw = await a.client.post(`/employer/invitations/${id}/withdraw`);
      expect(withdraw.status).toBe(409);
      expect(await ctx.prisma.contactAccessGrant.count()).toBe(0);
    });

    it('принятие требует явного подтверждения раскрытия данных', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      expect((await candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, {})).status).toBe(422);
      expect((await candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: false })).status).toBe(422);
    });
  });

  describe('срок действия — серверный, TTL 14 дней', () => {
    it('граница срока: за секунду до принять можно, ровно в момент expiresAt — нельзя', async () => {
      const { candidate, a } = await setup();
      const first = await send(a.client, candidate.candidateId);
      const expiresAt = new Date(first.body.expiresAt).getTime();
      expect(expiresAt - new Date(first.body.createdAt).getTime()).toBe(14 * 86_400_000);
      ctx.clock.set(new Date(expiresAt - 1000));
      await candidate.client.relogin();
      const ok = await candidate.client.post(`/candidate/invitations/${first.body.id}/accept`, { confirmDisclosure: true });
      expect(ok.status).toBe(200);

      const second = await createEmployer(ctx, { name: 'Другая' });
      const created = await send(second.client, candidate.candidateId);
      const expiresSecond = new Date(created.body.expiresAt).getTime();
      ctx.clock.set(new Date(expiresSecond));
      // Серверные сессии живут 7 дней — за две недели обе стороны входят заново.
      await candidate.client.relogin();
      await second.client.relogin();
      const late = await candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: true });
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('INVITATION_EXPIRED');
      expect((await candidate.client.get(`/candidate/invitations/${created.body.id}`)).body.status).toBe('EXPIRED');
      expect((await second.client.get(`/employer/invitations/${created.body.id}`)).body.status).toBe('EXPIRED');
      expect(await ctx.prisma.contactAccessGrant.count({ where: { companyId: second.companyId } })).toBe(0);
    });

    it('после истечения компания может отправить новое приглашение; отзыв истёкшего невозможен', async () => {
      const { candidate, a } = await setup();
      const first = await send(a.client, candidate.candidateId);
      ctx.clock.advanceHours(24 * 15);
      await a.client.relogin();
      const withdraw = await a.client.post(`/employer/invitations/${first.body.id}/withdraw`);
      expect(withdraw.status).toBe(409);
      expect((await send(a.client, candidate.candidateId)).status).toBe(201);
    });
  });

  describe('доступ к контактам', () => {
    it('до ACCEPTED контактов нет ни в JSON, ни в PDF (в том числе у компании, отправившей приглашение)', async () => {
      const { candidate, a } = await setup({ channels: ['EMAIL', 'PHONE', 'MESSENGER'] });
      await send(a.client, candidate.candidateId);
      const card = await a.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(card.status).toBe(200);
      expect(card.body.profile.mode).toBe('EMPLOYER_REDACTED');
      expect(leaks(card.body)).toEqual([]);
      expect(JSON.stringify(card.body)).not.toMatch(/userId|passwordHash|"email"|"phone"|messenger"/);
      const bank = await a.client.get('/employer/candidates?specialization=BACKEND');
      expect(leaks(bank.body)).toEqual([]);

      const pdf = await a.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`);
      expect(pdf.status).toBe(200);
      const content = readPdf(pdf.body);
      const text = normalize(content.text);
      for (const secret of [...Object.values(SECRET), 'private-portfolio', 'закрытой компании', 'секретным проектом']) expect(text).not.toContain(secret);
      expect(JSON.stringify(content.info)).not.toContain('Приватов');
      expect(pdf.headers['content-disposition']).not.toMatch(/Приватов|private/i);
      expect(pdf.headers['cache-control']).toBe('private, no-store');
      expect(text).toContain('Кандидат');
    });

    it('после принятия контакты (только выбранные кандидатом каналы) видит только эта компания — в JSON и в PDF', async () => {
      const { candidate, a, b } = await setup({ channels: ['EMAIL'] });
      const created = await send(a.client, candidate.candidateId);
      await send(b.client, candidate.candidateId);
      const accepted = await candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: true });
      expect(accepted.status).toBe(200);
      expect(accepted.body.contactAccess).toMatchObject({ active: true, channels: ['EMAIL'] });

      const granted = await a.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(granted.body.profile.mode).toBe('EMPLOYER_GRANTED');
      expect(granted.body.profile.contacts).toEqual([{ channel: 'EMAIL', value: SECRET.email }]);
      expect(granted.body.profile.personal.fullName).toBe(SECRET.name);
      expect(JSON.stringify(granted.body)).not.toContain(SECRET.phone);
      expect(JSON.stringify(granted.body)).not.toContain(SECRET.messenger);

      const grantedPdf = normalize(readPdf((await a.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`)).body).text);
      expect(grantedPdf).toContain(SECRET.email);
      expect(grantedPdf).toContain('Приватов');
      expect(grantedPdf).not.toContain(SECRET.phone);

      // Вторая компания (приглашение не принято) по-прежнему видит только обезличенную карточку.
      const other = await b.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(other.body.profile.mode).toBe('EMPLOYER_REDACTED');
      expect(leaks(other.body)).toEqual([]);
      const otherPdf = normalize(readPdf((await b.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`)).body).text);
      expect(otherPdf).not.toContain('Приватов');
      expect(otherPdf).not.toContain(SECRET.email);
      expect(await ctx.prisma.contactAccessGrant.count()).toBe(1);
    });

    it('отзыв доступа закрывает контакты в новых ответах и PDF, статус ACCEPTED в истории остаётся; повторный accept доступ не восстанавливает', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      await candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: true });
      expect((await a.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_GRANTED');

      const grants = await candidate.client.get('/candidate/contact-access');
      expect(grants.body).toEqual([expect.objectContaining({ companyId: a.companyId, active: true })]);
      const revoked = await candidate.client.delete(`/candidate/contact-access/${a.companyId}`);
      expect(revoked.status).toBe(200);
      expect(revoked.body[0]).toMatchObject({ active: false });

      const after = await a.client.get(`/employer/candidates/${candidate.candidateId}`);
      expect(after.body.profile.mode).toBe('EMPLOYER_REDACTED');
      expect(leaks(after.body)).toEqual([]);
      expect(normalize(readPdf((await a.client.getBuffer(`/employer/candidates/${candidate.candidateId}/pdf`)).body).text)).not.toContain(SECRET.email);
      expect((await a.client.get(`/employer/invitations/${created.body.id}`)).body.status).toBe('ACCEPTED');

      const again = await candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: true });
      expect(again.status).toBe(200);
      expect(again.body.contactAccess.active).toBe(false);
      expect((await a.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_REDACTED');

      // Новый доступ — только через новое осознанное согласие (новое приглашение).
      const fresh = await send(a.client, candidate.candidateId, { title: 'Повторное предложение' });
      expect(fresh.status).toBe(201);
      await candidate.client.post(`/candidate/invitations/${fresh.body.id}/accept`, { confirmDisclosure: true });
      expect((await a.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_GRANTED');
    });

    it('скрытие профиля не отзывает выданный доступ, но исключает кандидата для остальных', async () => {
      const { candidate, a, b } = await setup();
      const created = await send(a.client, candidate.candidateId);
      await candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: true });
      await candidate.client.patch('/candidate/profile', { isDiscoverable: false });
      expect((await a.client.get(`/employer/candidates/${candidate.candidateId}`)).body.profile.mode).toBe('EMPLOYER_GRANTED');
      expect((await b.client.get(`/employer/candidates/${candidate.candidateId}`)).status).toBe(404);
      const bank = await b.client.get('/employer/candidates?specialization=BACKEND');
      expect(bank.body.items).toEqual([]);
    });

    it('принять приглашение без заполненных каналов связи нельзя', async () => {
      const { candidate, a } = await setup();
      const created = await send(a.client, candidate.candidateId);
      await candidate.client.patch('/candidate/profile', { contactEmail: null });
      const res = await candidate.client.post(`/candidate/invitations/${created.body.id}/accept`, { confirmDisclosure: true });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NO_CONTACT_CHANNEL');
    });

    it('кандидат видит список раскрываемых данных до принятия', async () => {
      const { candidate, a } = await setup({ channels: ['EMAIL', 'PHONE'] });
      const created = await send(a.client, candidate.candidateId);
      const view = await candidate.client.get(`/candidate/invitations/${created.body.id}`);
      expect(view.body.disclosure.fullName).toBe(SECRET.name);
      expect(view.body.disclosure.channels).toEqual([
        { channel: 'EMAIL', value: SECRET.email },
        { channel: 'PHONE', value: SECRET.phone },
      ]);
    });
  });

  describe('изоляция сторон', () => {
    it('кандидат не видит и не меняет чужие приглашения; работодатель — чужие приглашения компании', async () => {
      const { candidate, a, b } = await setup();
      const other = await createCandidate(ctx, { specialization: 'FRONTEND', grade: 'MIDDLE' });
      const created = await send(a.client, candidate.candidateId);
      expect((await other.client.get('/candidate/invitations')).body.items).toEqual([]);
      const base = `/candidate/invitations/${created.body.id}`;
      expect((await other.client.get(base)).status).toBe(404);
      expect((await other.client.post(`${base}/view`)).status).toBe(404);
      expect((await other.client.post(`${base}/accept`, { confirmDisclosure: true })).status).toBe(404);
      expect((await other.client.post(`${base}/decline`, {})).status).toBe(404);
      expect((await candidate.client.get(base)).body.status).toBe('SENT');
      expect((await b.client.get(`/employer/invitations/${created.body.id}`)).status).toBe(404);
      expect((await b.client.post(`/employer/invitations/${created.body.id}/withdraw`)).status).toBe(404);
      expect((await b.client.get('/employer/invitations')).body.items).toEqual([]);
      expect((await candidate.client.get('/employer/invitations')).status).toBe(403);
      expect((await a.client.get('/candidate/invitations')).status).toBe(403);
    });

    it('кандидат не может отозвать чужой доступ или доступ, которого не было', async () => {
      const { candidate, a } = await setup();
      expect((await candidate.client.delete(`/candidate/contact-access/${a.companyId}`)).status).toBe(404);
    });
  });

  describe('PDF-профиль владельца и устойчивость вёрстки', () => {
    it('владелец получает полный PDF; ссылка не публична; ответ не кэшируется', async () => {
      const { candidate } = await setup({ channels: ['EMAIL', 'PHONE', 'MESSENGER'] });
      const pdf = await candidate.client.getBuffer('/candidate/profile/pdf');
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(pdf.headers['cache-control']).toBe('private, no-store');
      const text = normalize(readPdf(pdf.body).text);
      for (const value of [SECRET.name, SECRET.email, SECRET.phone, SECRET.messenger]) expect(text).toContain(value);
      // Без сессии — 401.
      const anonymous = new Client(ctx.app);
      expect((await anonymous.get('/candidate/profile/pdf')).status).toBe(401);
    });

    it('длинные значения и многострочные тексты переносятся, страницы добавляются, весь текст сохраняется', async () => {
      const longName = 'Длинноимённый-Кандидат-С-Очень-Длинной-Двойной-Фамилией-Перенос-Строки-Без-Пробелов-Проверка Иванович'.slice(0, 120);
      const paragraphs = Array.from({ length: 26 }, (_, i) => `Абзац ${i + 1}: подробное описание опыта работы над проектом с большим количеством деталей и обязанностей.`);
      const experienceDescription = `${paragraphs.join('\n')}\nКОНЕЦ-ОПИСАНИЯ`;
      expect(experienceDescription.length).toBeLessThanOrEqual(3000);
      const candidate = await createCandidate(ctx, { profile: { fullName: longName, experienceDescription } });
      const pdf = await candidate.client.getBuffer('/candidate/profile/pdf');
      expect(pdf.status).toBe(200);
      const content = readPdf(pdf.body);
      expect(content.pages).toBeGreaterThan(1);
      // Перенос по дефису и пробелам в pdfjs даёт разные разделители — сравниваем без пробельных символов.
      const compact = content.text.replace(/\s+/g, '');
      expect(compact).toContain('КОНЕЦ-ОПИСАНИЯ');
      expect(compact).toContain('Абзац26:подробное');
      expect(compact).toContain(longName.replace(/\s+/g, ''));
    });
  });
});
