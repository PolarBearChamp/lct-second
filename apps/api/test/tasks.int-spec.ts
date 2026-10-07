import { createTestApp, resetDatabase, type TestContext } from './helpers/app';
import { approachBody, createCandidate, createEmployer, taskBody } from './helpers/factories';

const SECRET = {
  name: 'Заданиев Тайный Секретович',
  email: 'task.person@secret-mail.example',
  phone: '+7 923 444-55-66',
  messenger: '@task_person_handle',
};

describe('регулярные короткие задания работодателей', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.prisma));

  const leaks = (value: unknown) => Object.values(SECRET).filter((secret) => JSON.stringify(value).includes(secret));

  const candidate = (options: { specialization?: 'BACKEND' | 'FRONTEND'; grade?: 'JUNIOR' | 'MIDDLE' | 'SENIOR'; publish?: boolean } = {}) =>
    createCandidate(ctx, {
      specialization: options.specialization ?? 'BACKEND',
      grade: options.grade ?? 'MIDDLE',
      publish: options.publish,
      profile: { fullName: SECRET.name, contactEmail: SECRET.email, phone: SECRET.phone, messenger: SECRET.messenger, disclosureChannels: ['EMAIL'] },
    });

  const createTask = async (employer: Awaited<ReturnType<typeof createEmployer>>, overrides: Record<string, unknown> = {}, body = taskBody) => {
    const res = await employer.client.post('/employer/tasks', body(overrides));
    if (res.status !== 201) throw new Error(`task: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; status: string };
  };

  describe('публикация задания работодателем', () => {
    it('содержимое проверяется: число вариантов, верный индекс, повторы, лишние поля у разбора, неизвестная специализация', async () => {
      const employer = await createEmployer(ctx);
      const post = (overrides: Record<string, unknown>) => employer.client.post('/employer/tasks', taskBody(overrides));
      const oneOption = await post({ options: ['только один'], correctIndex: 0 });
      expect(oneOption.status).toBe(422);
      expect(oneOption.body.details.fields.options).toBeDefined();
      expect((await post({ options: ['1', '2', '3', '4', '5', '6', '7'], correctIndex: 0 })).status).toBe(422);
      expect((await post({ correctIndex: 3 })).status).toBe(422);
      expect((await post({ correctIndex: undefined })).status).toBe(422);
      expect((await post({ options: ['Да', 'да'], correctIndex: 0 })).status).toBe(422);
      expect((await post({ kind: 'APPROACH' })).status).toBe(422);
      expect((await post({ specialization: 'NO_SUCH' })).status).toBe(422);
      expect((await post({ title: 'ab' })).status).toBe(422);
      expect((await post({ deadlineAt: 'вчера' })).status).toBe(422);
      expect((await post({ deadlineAt: new Date(ctx.clock.now().getTime() - 3600_000).toISOString() })).status).toBe(422);
      expect((await employer.client.get('/employer/tasks')).body).toEqual([]);
    });

    it('черновик редактируется, опубликованное задание — нет; публикация и закрытие идемпотентны', async () => {
      const employer = await createEmployer(ctx);
      const draft = await createTask(employer, { publish: false });
      expect(draft.status).toBe('DRAFT');
      expect((await employer.client.post(`/employer/tasks/${draft.id}/close`)).status).toBe(409);

      const edited = await employer.client.patch(`/employer/tasks/${draft.id}`, { title: 'Новое название задания', kind: 'APPROACH' });
      expect(edited.status).toBe(200);
      expect(edited.body.kind).toBe('APPROACH');
      expect(edited.body.options).toEqual([]);
      expect(edited.body.correctIndex).toBeNull();
      // Возврат к тесту без вариантов — ошибка содержимого, а не молчаливая подстановка.
      expect((await employer.client.patch(`/employer/tasks/${draft.id}`, { kind: 'QUIZ' })).status).toBe(422);

      const published = await employer.client.post(`/employer/tasks/${draft.id}/publish`);
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('ACTIVE');
      expect((await employer.client.post(`/employer/tasks/${draft.id}/publish`)).body.publishedAt).toBe(published.body.publishedAt);
      const locked = await employer.client.patch(`/employer/tasks/${draft.id}`, { title: 'Правка после публикации' });
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe('TASK_NOT_EDITABLE');

      expect((await employer.client.post(`/employer/tasks/${draft.id}/close`)).body.status).toBe('CLOSED');
      expect((await employer.client.post(`/employer/tasks/${draft.id}/close`)).status).toBe(200);
      const reopen = await employer.client.post(`/employer/tasks/${draft.id}/publish`);
      expect(reopen.status).toBe(409);
      expect(reopen.body.code).toBe('TASK_CLOSED');
    });

    it('одновременно активно не более 10 заданий компании', async () => {
      const employer = await createEmployer(ctx);
      for (let i = 0; i < 10; i += 1) await createTask(employer, { title: `Задание номер ${i + 1}` });
      const eleventh = await employer.client.post('/employer/tasks', taskBody({ title: 'Одиннадцатое задание' }));
      expect(eleventh.status).toBe(409);
      expect(eleventh.body.code).toBe('TASK_LIMIT_REACHED');
      const draft = await createTask(employer, { publish: false, title: 'Черновик номер 11' });
      expect((await employer.client.post(`/employer/tasks/${draft.id}/publish`)).status).toBe(409);
      const list = await employer.client.get('/employer/tasks?status=ACTIVE');
      expect(list.body).toHaveLength(10);
    });

    it('чужое задание недоступно: просмотр, правка, публикация, закрытие, ответы, оценка — 404', async () => {
      const owner = await createEmployer(ctx, { name: 'Автор' });
      const intruder = await createEmployer(ctx, { name: 'Посторонний' });
      const task = await createTask(owner);
      const attempts = [
        intruder.client.get(`/employer/tasks/${task.id}`),
        intruder.client.patch(`/employer/tasks/${task.id}`, { title: 'Взлом задания' }),
        intruder.client.post(`/employer/tasks/${task.id}/publish`),
        intruder.client.post(`/employer/tasks/${task.id}/close`),
        intruder.client.get(`/employer/tasks/${task.id}/submissions`),
        intruder.client.post(`/employer/task-submissions/${task.id}/review`, { verdict: 'STRONG' }),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
      expect((await intruder.client.get('/employer/tasks')).body).toEqual([]);
    });
  });

  describe('предложение заданий кандидату', () => {
    it('нет подходящих заданий — ничего не предлагается; появляется задание — предлагается одно, без верного ответа', async () => {
      const employer = await createEmployer(ctx);
      const person = await candidate();
      const empty = await person.client.get('/candidate/tasks');
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({ current: null, history: [], blocker: null, nextOfferAt: null, intervalDays: 7 });

      await createTask(employer);
      const offered = await person.client.get('/candidate/tasks');
      expect(offered.body.current).toMatchObject({ status: 'OFFERED', canSubmit: true, result: null });
      expect(offered.body.current.task).toMatchObject({ kind: 'QUIZ', specialization: 'BACKEND', companyName: 'Тест Компания', closed: false });
      expect(offered.body.current.task.options).toHaveLength(3);
      // Верный вариант и пояснение до ответа не раскрываются ни в каком виде.
      expect(JSON.stringify(offered.body)).not.toContain('correctIndex');
      expect(JSON.stringify(offered.body)).not.toContain('Ключ идемпотентности делает повтор безопасным');
      expect(await ctx.prisma.taskAssignment.count()).toBe(1);

      // Повторное открытие раздела не создаёт второе предложение.
      const again = await person.client.get('/candidate/tasks');
      expect(again.body.current.id).toBe(offered.body.current.id);
      expect(await ctx.prisma.taskAssignment.count()).toBe(1);
    });

    it('подбор по подтверждённой квалификации: чужая специализация и грейд вне списка не предлагаются', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer, { title: 'Только для Frontend', specialization: 'FRONTEND' });
      await createTask(employer, { title: 'Только для Senior', allowedGrades: ['SENIOR'] });
      const backend = await candidate({ specialization: 'BACKEND', grade: 'MIDDLE' });
      const overview = await backend.client.get('/candidate/tasks');
      expect(overview.body.current).toBeNull();
      expect(await ctx.prisma.taskAssignment.count()).toBe(0);

      await createTask(employer, { title: 'Для Middle и Senior', allowedGrades: ['MIDDLE', 'SENIOR'] });
      expect((await backend.client.get('/candidate/tasks')).body.current.task.title).toBe('Для Middle и Senior');
    });

    it('кандидат, которого не видят работодатели, заданий не получает и объясняет причину; пауза — тоже', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer);
      const hidden = await candidate({ publish: false });
      const hiddenView = await hidden.client.get('/candidate/tasks');
      expect(hiddenView.body.current).toBeNull();
      expect(hiddenView.body.blocker).toBe('NOT_DISCOVERABLE');
      expect(hiddenView.body.blockerMessage).toEqual(expect.any(String));

      const paused = await candidate();
      expect((await paused.client.patch('/candidate/profile', { availability: 'PAUSED' })).status).toBe(200);
      const pausedView = await paused.client.get('/candidate/tasks');
      expect(pausedView.body.blocker).toBe('PAUSED');
      expect(pausedView.body.current).toBeNull();
      expect(await ctx.prisma.taskAssignment.count()).toBe(0);
    });

    it('не чаще раза в неделю и не больше одного неотвеченного: после ответа и после пропуска новое — через 7 дней', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer, { title: 'Первое задание' });
      await createTask(employer, { title: 'Второе задание' });
      await createTask(employer, { title: 'Третье задание' });
      const person = await candidate();

      const first = (await person.client.get('/candidate/tasks')).body.current;
      const answered = await person.client.post(`/candidate/tasks/${first.id}/submit`, { selectedIndex: 1 });
      expect(answered.status).toBe(200);
      const waiting = await person.client.get('/candidate/tasks');
      expect(waiting.body.current).toBeNull();
      expect(waiting.body.nextOfferAt).toBe(new Date(ctx.clock.now().getTime() + 7 * 24 * 3600_000).toISOString());
      expect(await ctx.prisma.taskAssignment.count()).toBe(1);

      ctx.clock.advanceDays(6);
      await person.client.relogin();
      expect((await person.client.get('/candidate/tasks')).body.current).toBeNull();
      ctx.clock.advanceDays(1);
      await person.client.relogin();
      const second = (await person.client.get('/candidate/tasks')).body.current;
      expect(second).not.toBeNull();
      expect(second.task.title).not.toBe(first.task.title);

      const skipped = await person.client.post(`/candidate/tasks/${second.id}/skip`);
      expect(skipped.status).toBe(200);
      expect(skipped.body.status).toBe('SKIPPED');
      expect((await person.client.post(`/candidate/tasks/${second.id}/skip`)).status).toBe(200);
      expect((await person.client.get('/candidate/tasks')).body.current).toBeNull();
      ctx.clock.advanceDays(7);
      await person.client.relogin();
      const third = (await person.client.get('/candidate/tasks')).body;
      // Одно и то же задание кандидату не предлагается повторно: остаётся то, которое он ещё не видел.
      expect([first.task.title, second.task.title, third.current.task.title].sort()).toEqual(['Второе задание', 'Первое задание', 'Третье задание']);
      expect(third.history.map((h: { status: string }) => h.status).sort()).toEqual(['SKIPPED', 'SUBMITTED']);
    });

    it('параллельные открытия раздела создают ровно одно предложение', async () => {
      const employer = await createEmployer(ctx);
      for (let i = 0; i < 4; i += 1) await createTask(employer, { title: `Задание номер ${i + 1}` });
      const person = await candidate();
      const results = await Promise.all(Array.from({ length: 8 }, () => person.client.get('/candidate/tasks')));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
      expect(await ctx.prisma.taskAssignment.count({ where: { status: 'OFFERED' } })).toBe(1);
      expect(await ctx.prisma.taskAssignment.count()).toBe(1);
    });

    it('нагрузка распределяется: второй кандидат получает менее востребованное задание', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer, { title: 'Задание А' });
      await createTask(employer, { title: 'Задание Б' });
      const one = await candidate();
      const two = await candidate();
      const a = (await one.client.get('/candidate/tasks')).body.current.task.title;
      const b = (await two.client.get('/candidate/tasks')).body.current.task.title;
      expect(a).not.toBe(b);
    });
  });

  describe('ответ на тест', () => {
    it('автоматическая проверка: верный и неверный ответ; после ответа раскрываются верный вариант и пояснение', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer);
      const right = await candidate();
      const wrong = await candidate();
      const rightOffer = (await right.client.get('/candidate/tasks')).body.current;
      const wrongOffer = (await wrong.client.get('/candidate/tasks')).body.current;

      const ok = await right.client.post(`/candidate/tasks/${rightOffer.id}/submit`, { selectedIndex: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('SUBMITTED');
      expect(ok.body.canSubmit).toBe(false);
      expect(ok.body.result).toMatchObject({ isCorrect: true, selectedIndex: 1, correctIndex: 1, explanation: expect.stringContaining('Ключ идемпотентности') });

      const bad = await wrong.client.post(`/candidate/tasks/${wrongOffer.id}/submit`, { selectedIndex: 0 });
      expect(bad.body.result).toMatchObject({ isCorrect: false, selectedIndex: 0, correctIndex: 1 });

      const practice = (await right.client.get('/candidate/tasks')).body.practice;
      expect(practice.solvedLast90Days).toBe(1);
      expect(practice.lastSubmittedAt).toBe(ctx.clock.now().toISOString());
    });

    it('некорректный ответ отклоняется; двойная отправка и параллельные отправки дают один принятый ответ', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer);
      const person = await candidate();
      const offer = (await person.client.get('/candidate/tasks')).body.current;
      expect((await person.client.post(`/candidate/tasks/${offer.id}/submit`, {})).status).toBe(422);
      expect((await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 3 })).status).toBe(422);
      expect((await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: -1 })).status).toBe(422);
      expect((await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 0, answerText: 'текст в тесте' })).status).toBe(422);

      const results = await Promise.all([0, 1, 2, 1].map((selectedIndex) => person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).map((r) => r.body.code)).toEqual(expect.arrayContaining(['TASK_ALREADY_SUBMITTED']));
      const stored = await ctx.prisma.taskAssignment.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0].status).toBe('SUBMITTED');
      const again = await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 1 });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('TASK_ALREADY_SUBMITTED');
    });

    it('срок ответа 7 дней: после него предложение истекает; закрытие задания тоже гасит неотвеченное предложение', async () => {
      const employer = await createEmployer(ctx);
      const task = await createTask(employer);
      const person = await candidate();
      const offer = (await person.client.get('/candidate/tasks')).body.current;
      ctx.clock.advanceDays(8);
      await person.client.relogin();
      const expired = await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 1 });
      expect(expired.status).toBe(409);
      expect(expired.body.code).toBe('TASK_EXPIRED');
      expect((await person.client.get(`/candidate/tasks/${offer.id}`)).body.status).toBe('EXPIRED');

      // Закрытие задания автором: неотвеченное предложение истекает, а не остаётся «висеть».
      const second = await candidate();
      await employer.client.relogin();
      expect((await employer.client.post(`/employer/tasks/${task.id}/close`)).status).toBe(200);
      const closedView = await second.client.get('/candidate/tasks');
      expect(closedView.body.current).toBeNull();
      expect(await ctx.prisma.taskAssignment.count({ where: { candidateId: second.candidateId } })).toBe(0);

      const extra = await createTask(employer, { title: 'Ещё задание' });
      const third = await candidate();
      const offerThird = (await third.client.get('/candidate/tasks')).body.current;
      expect(offerThird.task.title).toBe('Ещё задание');
      expect((await employer.client.post(`/employer/tasks/${extra.id}/close`)).status).toBe(200);
      const closed = await third.client.post(`/candidate/tasks/${offerThird.id}/submit`, { selectedIndex: 1 });
      expect(closed.status).toBe(409);
      expect(closed.body.code).toBe('TASK_EXPIRED');
    });

    it('ответ видит автор задания, поэтому без публикации профиля он не принимается (PUBLICATION_REQUIRED)', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer);
      const person = await candidate();
      const offer = (await person.client.get('/candidate/tasks')).body.current;
      expect((await person.client.patch('/candidate/profile', { isDiscoverable: false })).status).toBe(200);
      const res = await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PUBLICATION_REQUIRED');
      expect(await ctx.prisma.taskAssignment.count({ where: { status: 'SUBMITTED' } })).toBe(0);
    });

    it('чужое предложение недоступно: просмотр, ответ и пропуск — 404', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer);
      const owner = await candidate();
      const other = await candidate();
      const offer = (await owner.client.get('/candidate/tasks')).body.current;
      expect((await other.client.get(`/candidate/tasks/${offer.id}`)).status).toBe(404);
      expect((await other.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 1 })).status).toBe(404);
      expect((await other.client.post(`/candidate/tasks/${offer.id}/skip`)).status).toBe(404);
      expect((await owner.client.get(`/candidate/tasks/${offer.id}`)).status).toBe(200);
    });
  });

  describe('ответы для автора и оценка разборов', () => {
    it('автор видит псевдоним и подтверждённый грейд, но не ФИО и контакты; статистика теста считается', async () => {
      const employer = await createEmployer(ctx);
      const task = await createTask(employer);
      const people = [await candidate(), await candidate(), await candidate()];
      const picks = [1, 1, 0];
      for (const [index, person] of people.entries()) {
        const offer = (await person.client.get('/candidate/tasks')).body.current;
        expect((await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: picks[index] })).status).toBe(200);
      }
      const submissions = await employer.client.get(`/employer/tasks/${task.id}/submissions`);
      expect(submissions.status).toBe(200);
      expect(submissions.body.total).toBe(3);
      expect(submissions.body.quiz).toEqual({ answered: 3, correct: 2 });
      expect(submissions.body.task).toMatchObject({ submittedCount: 3, offeredCount: 3, correctIndex: 1 });
      expect(submissions.body.items[0]).toMatchObject({ confirmedGrade: 'MIDDLE', confirmedGradeTitle: 'Middle', needsReview: false });
      expect(submissions.body.items[0].candidateAlias).toEqual(expect.any(String));
      expect(leaks(submissions.body)).toEqual([]);
      const paged = await employer.client.get(`/employer/tasks/${task.id}/submissions?pageSize=2&page=2`);
      expect(paged.body.items).toHaveLength(1);
      // Ответы на задание не открывают контакты: доступа к контактам у компании нет.
      expect(await ctx.prisma.contactAccessGrant.count()).toBe(0);
    });

    it('текстовый разбор: ограничения длины, оценка автором, комментарий виден кандидату, счётчик «на оценке» в профиле работодателя', async () => {
      const employer = await createEmployer(ctx);
      const task = await createTask(employer, {}, approachBody);
      const person = await candidate();
      const offer = (await person.client.get('/candidate/tasks')).body.current;
      expect(offer.task.kind).toBe('APPROACH');
      expect(offer.task.options).toEqual([]);

      expect((await person.client.post(`/candidate/tasks/${offer.id}/submit`, { answerText: 'коротко' })).status).toBe(422);
      expect((await person.client.post(`/candidate/tasks/${offer.id}/submit`, { answerText: 'я'.repeat(2001) })).status).toBe(422);
      expect((await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 0 })).status).toBe(422);
      const text = 'Сначала включу логирование медленных запросов, затем посмотрю план выполнения и индексы.';
      const submitted = await person.client.post(`/candidate/tasks/${offer.id}/submit`, { answerText: `  ${text}  ` });
      expect(submitted.status).toBe(200);
      expect(submitted.body.result).toMatchObject({ answerText: text, isCorrect: null, correctIndex: null, verdict: null });

      expect((await employer.client.get('/auth/me')).body.employer.pendingTaskReviews).toBe(1);
      const pending = await employer.client.get(`/employer/tasks/${task.id}/submissions?pendingOnly=true`);
      expect(pending.body.items).toHaveLength(1);
      expect(pending.body.items[0]).toMatchObject({ needsReview: true, answerText: text, verdict: null });
      expect(pending.body.task.pendingReviewCount).toBe(1);
      expect(leaks(pending.body)).toEqual([]);

      const reviewed = await employer.client.post(`/employer/task-submissions/${pending.body.items[0].id}/review`, { verdict: 'STRONG', comment: 'Хороший план, добавьте метрики.' });
      expect(reviewed.status).toBe(200);
      expect(reviewed.body).toMatchObject({ verdict: 'STRONG', verdictTitle: 'Сильный ответ', needsReview: false, reviewComment: 'Хороший план, добавьте метрики.' });
      expect((await employer.client.get('/auth/me')).body.employer.pendingTaskReviews).toBe(0);
      expect((await employer.client.get(`/employer/tasks/${task.id}/submissions?pendingOnly=true`)).body.items).toEqual([]);

      const seen = await person.client.get(`/candidate/tasks/${offer.id}`);
      expect(seen.body.result).toMatchObject({ verdict: 'STRONG', reviewComment: 'Хороший план, добавьте метрики.' });
      // Повторная оценка заменяет предыдущую.
      const changed = await employer.client.post(`/employer/task-submissions/${pending.body.items[0].id}/review`, { verdict: 'ACCEPTABLE' });
      expect(changed.body).toMatchObject({ verdict: 'ACCEPTABLE', reviewComment: null });
      expect((await employer.client.post(`/employer/task-submissions/${pending.body.items[0].id}/review`, { verdict: 'GREAT' })).status).toBe(422);
    });

    it('тест оценивается автоматически — ручная оценка отклоняется; неотправленный ответ оценить нельзя', async () => {
      const employer = await createEmployer(ctx);
      const quiz = await createTask(employer);
      const person = await candidate();
      const offer = (await person.client.get('/candidate/tasks')).body.current;
      const assignment = await ctx.prisma.taskAssignment.findFirstOrThrow({ where: { id: offer.id } });
      const early = await employer.client.post(`/employer/task-submissions/${assignment.id}/review`, { verdict: 'STRONG' });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('TASK_AUTO_SCORED');
      expect(quiz.id).toBe(assignment.taskId);

      const approach = await createTask(employer, { title: 'Разбор для ручной оценки' }, approachBody);
      const other = await candidate({ specialization: 'BACKEND' });
      // Кандидат other получит наименее предлагавшееся задание — разбор.
      const otherOffer = (await other.client.get('/candidate/tasks')).body.current;
      expect(otherOffer.task.title).toBe('Разбор для ручной оценки');
      const notSubmitted = await employer.client.post(`/employer/task-submissions/${otherOffer.id}/review`, { verdict: 'STRONG' });
      expect(notSubmitted.status).toBe(409);
      expect(notSubmitted.body.code).toBe('SUBMISSION_NOT_SUBMITTED');
      expect(approach.id).toBe((await ctx.prisma.taskAssignment.findFirstOrThrow({ where: { id: otherOffer.id } })).taskId);
    });
  });

  describe('влияние на остальное', () => {
    it('задания не меняют подтверждённый грейд, а регулярность считается за 90 дней', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer);
      const person = await candidate();
      const before = (await person.client.get('/candidate/qualifications')).body;
      const offer = (await person.client.get('/candidate/tasks')).body.current;
      await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 0 });
      expect((await person.client.get('/candidate/qualifications')).body).toEqual(before);
      expect((await person.client.get('/candidate/tasks')).body.practice.solvedLast90Days).toBe(1);

      ctx.clock.advanceDays(91);
      await person.client.relogin();
      const later = (await person.client.get('/candidate/tasks')).body.practice;
      expect(later.solvedLast90Days).toBe(0);
      expect(later.lastSubmittedAt).not.toBeNull();
    });

    it('в журнале аудита нет текста ответов и персональных данных', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer, {}, approachBody);
      const person = await candidate();
      const offer = (await person.client.get('/candidate/tasks')).body.current;
      const text = 'Уникальная строка ответа для проверки журнала аудита и поиска утечек.';
      await person.client.post(`/candidate/tasks/${offer.id}/submit`, { answerText: text });
      const events = await ctx.prisma.auditEvent.findMany({ where: { action: { startsWith: 'task.' } } });
      expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['task.created', 'task.offered', 'task.submitted']));
      const dump = JSON.stringify(events);
      expect(dump).not.toContain(text);
      expect(leaks(events)).toEqual([]);
    });

    it('удаление компании каскадно удаляет задания и ответы', async () => {
      const employer = await createEmployer(ctx);
      await createTask(employer);
      const person = await candidate();
      const offer = (await person.client.get('/candidate/tasks')).body.current;
      await person.client.post(`/candidate/tasks/${offer.id}/submit`, { selectedIndex: 1 });
      await ctx.prisma.company.delete({ where: { id: employer.companyId } });
      expect(await ctx.prisma.shortTask.count()).toBe(0);
      expect(await ctx.prisma.taskAssignment.count()).toBe(0);
      expect((await person.client.get('/candidate/tasks')).body.history).toEqual([]);
    });
  });
});
