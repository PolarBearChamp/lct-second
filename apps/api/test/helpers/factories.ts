import { answerShape } from './answers';
import type { TestContext } from './app';
import { Client } from './client';

export type Spec = 'FRONTEND' | 'BACKEND' | 'ML_ENGINEER' | 'MANUAL_QA';
export type Grade = 'JUNIOR' | 'MIDDLE' | 'SENIOR';

let counter = 0;
export const uniqueEmail = (prefix: string) => `${prefix}.${Date.now().toString(36)}${(counter += 1)}@test.example`;

/** Правильные ответы берутся из закрытых ключей в БД — тестовый helper, production-эндпоинта выдачи ключей нет. */
export async function submitAttempt(ctx: TestContext, client: Client, attemptId: string, mode: 'correct' | 'wrong' = 'correct') {
  const items = await ctx.prisma.assessmentItem.findMany({ where: { attemptId }, orderBy: { position: 'asc' } });
  const answers = items.map((item) => ({ itemId: item.id, answer: answerShape(item.privateKey as never, item.publicSnapshot as never, mode), revision: 1 }));
  return client.post(`/candidate/assessments/${attemptId}/submit`, { answers });
}

/** Профиль, достаточный для публикации: все обязательные поля и канал связи. */
export async function fillProfile(client: Client, patch: Record<string, unknown> = {}) {
  const res = await client.patch('/candidate/profile', {
    fullName: 'Тест Кандидатов',
    city: 'Казань',
    timezone: 'Europe/Moscow',
    workFormats: ['REMOTE'],
    experienceMonths: 36,
    skills: [{ code: 'postgresql', months: 24 }, { code: 'sql', months: 30 }, { code: 'kafka', months: 6 }],
    contactEmail: 'candidate.contact@test.example',
    phone: '+7 900 000-00-00',
    disclosureChannels: ['EMAIL', 'PHONE'],
    activeSpecialization: 'BACKEND',
    declaredGrade: 'MIDDLE',
    ...patch,
  });
  if (res.status !== 200) throw new Error(`fillProfile: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function startAttempt(client: Client, specialization: Spec, grade: Grade, headers?: Record<string, string>) {
  return client.post('/candidate/assessments', { specialization, grade }, headers);
}

export async function publish(client: Client) {
  await client.put('/candidate/consents', { profilePublication: true });
  const res = await client.patch('/candidate/profile', { isDiscoverable: true });
  if (res.status !== 200) throw new Error(`publish: ${res.status}`);
}

export interface CandidateOptions {
  email?: string;
  specialization?: Spec;
  grade?: Grade;
  profile?: Record<string, unknown>;
  publish?: boolean;
  /** Не проходить тест. */
  skipAssessment?: boolean;
}

/** Кандидат «под ключ» через реальные API-потоки: регистрация → профиль → тест → публикация. */
export async function createCandidate(ctx: TestContext, options: CandidateOptions = {}) {
  const client = new Client(ctx.app, 'candidate');
  const email = options.email ?? uniqueEmail('cand');
  const specialization = options.specialization ?? 'BACKEND';
  const grade = options.grade ?? 'MIDDLE';
  await client.registerAndVerify(ctx.mail, email, 'CANDIDATE');
  await fillProfile(client, { activeSpecialization: specialization, declaredGrade: grade, ...options.profile });
  let attemptId: string | null = null;
  if (!options.skipAssessment) {
    const started = await startAttempt(client, specialization, grade);
    if (started.status !== 201) throw new Error(`start: ${started.status} ${JSON.stringify(started.body)}`);
    attemptId = started.body.id as string;
    const result = await submitAttempt(ctx, client, attemptId);
    if (result.body.status !== 'PASSED') throw new Error(`Тест не пройден: ${JSON.stringify(result.body)}`);
  }
  if (options.publish !== false && !options.skipAssessment) await publish(client);
  const me = await client.get('/auth/me');
  return { client, email, candidateId: me.body.candidate.profileId as string, attemptId };
}

export interface CompanyOptions {
  email?: string;
  name?: string;
}

export async function createEmployer(ctx: TestContext, options: CompanyOptions = {}) {
  const client = new Client(ctx.app, 'employer');
  const email = options.email ?? uniqueEmail('emp');
  await client.registerAndVerify(ctx.mail, email, 'EMPLOYER');
  const company = await client.put('/employer/company', {
    name: options.name ?? 'Тест Компания',
    industry: 'FINTECH',
    contactChannelType: 'EMAIL',
    contactValue: 'hr@test-company.example',
  });
  if (company.status !== 200) throw new Error(`company: ${company.status} ${JSON.stringify(company.body)}`);
  return { client, email, companyId: company.body.company.id as string };
}

export const defaultNeed = (overrides: Record<string, unknown> = {}) => ({
  title: 'Backend-разработчик',
  description: 'Платёжные сервисы, PostgreSQL и очереди задач.',
  specialization: 'BACKEND',
  allowedGrades: ['MIDDLE', 'SENIOR'],
  requiredSkills: ['sql', 'postgresql'],
  preferredSkills: [],
  workFormat: 'REMOTE',
  city: null,
  salaryFrom: 200_000,
  salaryTo: 300_000,
  salaryType: 'GROSS',
  ...overrides,
});

export const invitationBody = (candidateId: string, overrides: Record<string, unknown> = {}) => ({
  candidateId,
  title: 'Backend-разработчик',
  description: 'Развитие платёжного API, удалённо, команда из шести человек.',
  salaryFrom: 250_000,
  salaryTo: 320_000,
  salaryType: 'GROSS',
  workFormat: 'REMOTE',
  employerContactType: 'EMAIL',
  employerContact: 'hr@test-company.example',
  ...overrides,
});

export const vacancyBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Backend-разработчик в команду платежей',
  description: 'Развитие платёжного API: идемпотентность, PostgreSQL, очереди задач. Команда из шести человек.',
  specialization: 'BACKEND',
  allowedGrades: ['MIDDLE', 'SENIOR'],
  requiredSkills: ['sql', 'postgresql'],
  preferredSkills: [],
  workFormat: 'REMOTE',
  city: null,
  salaryFrom: 200_000,
  salaryTo: 300_000,
  salaryType: 'GROSS',
  publish: true,
  ...overrides,
});

export const taskBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Идемпотентность платёжного запроса',
  prompt: 'Клиент повторил POST /payments из-за таймаута. Что нужно сделать, чтобы не списать деньги дважды?',
  specialization: 'BACKEND',
  allowedGrades: [],
  kind: 'QUIZ',
  options: ['Игнорировать повторы', 'Ключ идемпотентности и уникальный индекс', 'Увеличить таймаут клиента'],
  correctIndex: 1,
  explanation: 'Ключ идемпотентности делает повтор безопасным: второй запрос вернёт результат первого.',
  publish: true,
  ...overrides,
});

export const approachBody = (overrides: Record<string, unknown> = {}) =>
  taskBody({ title: 'Разбор медленного запроса', prompt: 'Страница отчёта открывается 12 секунд. Опишите, как вы найдёте причину и что проверите в первую очередь.', kind: 'APPROACH', options: [], correctIndex: undefined, explanation: undefined, ...overrides });
