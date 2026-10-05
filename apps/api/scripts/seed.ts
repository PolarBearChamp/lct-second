/**
 * Воспроизводимый seed демонстрационных данных (только синтетика).
 *
 *   pnpm db:seed              — создать данные (идемпотентно: существующие демо-аккаунты не дублируются)
 *   pnpm db:seed -- --reset   — сначала удалить все демо-данные (аккаунты с isDemo = true), затем создать заново
 *
 * Квалификации кандидатов получены не присваиванием поля: для каждого создаются синтетические попытки,
 * ответы «решателя» оцениваются тем же серверным evaluator-ом, а квалификация выдаётся той же функцией,
 * что и при реальном завершении теста. Подбор, приглашения, закладки и ФСП проходят через штатные сервисы.
 * Seed не запускается автоматически при старте приложения.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { Clock, DAY_MS, HOUR_MS } from '../src/common/clock';
import { PolicyService } from '../src/common/policy.service';
import { parseEnv } from '../src/config/env';
import { CONSENT_POLICY_VERSIONS } from '../src/config/policies';
import { BANK_VERSION, getFamily } from '../src/domain/assessment/bank/registry';
import { BLUEPRINT_VERSION, buildStandardBlueprint } from '../src/domain/assessment/blueprint';
import { evaluateItem } from '../src/domain/assessment/evaluate';
import { instantiate } from '../src/domain/assessment/instantiate';
import { createRng } from '../src/domain/assessment/rng';
import { scoreAttempt, type AttemptScore } from '../src/domain/assessment/scoring';
import type { ItemAnswer, PrivateTaskInstance } from '../src/domain/assessment/types';
import { groupsOf, type SpecializationCode } from '../src/domain/catalog/catalog';
import { SURVEY_VERSION } from '../src/domain/catalog/survey';
import type { ContactChannel, Prisma, WorkFormat } from '../src/generated/prisma/client';
import { hashPassword, normalizeEmail } from '../src/modules/auth/crypto';
import { grantQualification } from '../src/modules/assessments/qualification';
import { FspService } from '../src/modules/fsp/fsp.service';
import { resolveFixturePath } from '../src/modules/fsp/mock-fsp.provider';
import { HiringNeedsService } from '../src/modules/hiring-needs/hiring-needs.service';
import type { CreateNeedDto } from '../src/modules/hiring-needs/dto/need.dto';
import { InvitationsService } from '../src/modules/invitations/invitations.service';
import { MatchingService } from '../src/modules/matching/matching.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { readFileSync } from 'node:fs';
import {
  BOOKMARKS,
  COMPANIES,
  INVITATIONS,
  NEEDS,
  SELECTION_NEEDS,
  extraCandidates,
  mainCandidates,
  type AttemptPlan,
  type CandidateDef,
} from './seed/definitions';
import { hashInt, uuidFrom } from './seed/ids';
import { CITIES, DESCRIPTIONS, EXPERIENCE_RANGE, FOCUS_BY_SPEC, INDUSTRY_CODES, SALARY_BASE, SELF_SKILLS, SOFT_SKILL_CODES, TASKS_BY_SPEC } from './seed/people';
import { solveInstance } from './seed/solver';

// Запуск из dist/scripts (4 уровня до корня монорепозитория) и из исходников scripts/ (3 уровня).
for (const candidate of ['../../../../.env', '../../../.env']) loadEnv({ path: path.resolve(__dirname, candidate), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const DEFAULT_DEMO_PASSWORD = 'Demo-Password-2026';
const REQUEST_ID = 'seed';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const env = parseEnv(process.env);
  if (env.NODE_ENV === 'production' && process.env.SEED_CONFIRM !== 'yes') {
    console.error('Seed демонстрационных данных не запускается в production без явного SEED_CONFIRM=yes.');
    process.exit(1);
  }
  const password = process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const policy = app.get(PolicyService).assessment;
  const fsp = app.get(FspService);
  const needsService = app.get(HiringNeedsService);
  const matching = app.get(MatchingService);
  const invitations = app.get(InvitationsService);

  // Управляемые часы: операции выполняются «в прошлом», чтобы история и сроки выглядели реалистично.
  const realNow = new Date();
  let current = new Date(realNow);
  Object.defineProperty(app.get(Clock), 'now', { value: () => new Date(current), writable: true, configurable: true });
  const setNow = (date: Date) => {
    current = date;
  };
  const daysBefore = (days: number, hours = 0) => new Date(realNow.getTime() - days * DAY_MS - hours * HOUR_MS);

  if (args.has('--reset')) await resetDemoData(prisma);

  const passwordHash = await hashPassword(password);
  const usedNames = new Set<string>();
  // SEED_PER_CELL (по умолчанию 8) — кандидатов на ячейку «специализация × грейд»; больше 8 нужно только для нагрузочного прогона.
  const perCell = Number(process.env.SEED_PER_CELL ?? 8);
  if (!Number.isInteger(perCell) || perCell < 8 || perCell > 200) throw new Error('SEED_PER_CELL: целое число от 8 до 200');
  const defs: CandidateDef[] = [...mainCandidates(usedNames, perCell), ...extraCandidates(usedNames)];
  const usedAliases = new Set((await prisma.candidateProfile.findMany({ select: { alias: true } })).map((p) => p.alias));

  // ───────────── Кандидаты ─────────────
  const candidates = new Map<string, { userId: string; candidateId: string }>();
  let createdCandidates = 0;
  for (const def of defs) {
    const existing = await prisma.user.findUnique({ where: { normalizedEmail: normalizeEmail(def.email) }, include: { candidateProfile: true } });
    if (existing?.candidateProfile) {
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, isDemo: true } });
      candidates.set(def.key, { userId: existing.id, candidateId: existing.candidateProfile.id });
      continue;
    }
    const ids = await createCandidate(def);
    candidates.set(def.key, ids);
    createdCandidates += 1;
    for (const [index, plan] of def.attempts.entries()) await seedAttempt(ids.candidateId, def, plan, index);
    if (def.fsp) await seedFsp(ids, def);
  }

  // ───────────── Работодатели, компании, потребности ─────────────
  const companies = new Map<string, { userId: string; companyId: string }>();
  for (const def of COMPANIES) {
    const userId = uuidFrom(`user|${def.email}`);
    await prisma.user.upsert({
      where: { normalizedEmail: normalizeEmail(def.email) },
      create: { id: userId, email: def.email, normalizedEmail: normalizeEmail(def.email), passwordHash, role: 'EMPLOYER', emailVerifiedAt: daysBefore(60), isDemo: true, createdAt: daysBefore(60) },
      update: { passwordHash, isDemo: true },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: normalizeEmail(def.email) } });
    const consent = await prisma.consentRecord.findFirst({ where: { userId: user.id, type: 'DATA_PROCESSING' } });
    if (!consent) {
      await prisma.consentRecord.create({ data: { id: uuidFrom(`consent|dp|company|${def.key}`), userId: user.id, type: 'DATA_PROCESSING', policyVersion: CONSENT_POLICY_VERSIONS.DATA_PROCESSING, acceptedAt: daysBefore(60) } });
    }
    const company = await prisma.company.upsert({
      where: { ownerUserId: user.id },
      create: { id: uuidFrom(`company|${def.key}`), ownerUserId: user.id, name: def.name, description: def.description, industry: def.industry, website: def.website, contactPersonName: def.contactPersonName, contactChannelType: def.contactChannelType, contactValue: def.contactValue },
      update: { name: def.name, description: def.description, industry: def.industry, website: def.website, contactPersonName: def.contactPersonName, contactChannelType: def.contactChannelType, contactValue: def.contactValue },
    });
    companies.set(def.key, { userId: user.id, companyId: company.id });
  }

  const needIds = new Map<string, string>();
  for (const def of NEEDS) {
    const owner = companies.get(def.company)!;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    const existing = await prisma.hiringNeed.findFirst({ where: { companyId: company.id, title: def.title } });
    if (existing) {
      needIds.set(def.key, existing.id);
      continue;
    }
    setNow(daysBefore(30));
    const created = await needsService.create(
      company,
      owner.userId,
      { ...def, city: def.city ?? null, salaryType: 'GROSS', status: 'ACTIVE' } as unknown as CreateNeedDto,
      REQUEST_ID,
    );
    needIds.set(def.key, created.id);
    setNow(realNow);
  }

  // ───────────── Приглашения во всех состояниях ─────────────
  let invitationCount = 0;
  for (const def of INVITATIONS) {
    const owner = companies.get(def.company)!;
    const candidate = candidates.get(def.candidate);
    if (!candidate) throw new Error(`Seed: кандидат ${def.candidate} не найден для приглашения`);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    const existing = await prisma.invitation.findFirst({ where: { companyId: company.id, candidateId: candidate.candidateId, title: def.title } });
    if (existing) continue;
    const sentAt = daysBefore(def.daysAgo);
    setNow(sentAt);
    const { invitation } = await invitations.send(
      company,
      owner.userId,
      {
        candidateId: candidate.candidateId,
        needId: def.need ? needIds.get(def.need) : undefined,
        title: def.title,
        description: def.description,
        salaryFrom: def.salaryFrom,
        salaryTo: def.salaryTo,
        salaryType: 'GROSS',
        workFormat: def.workFormat,
        employerContactType: company.contactChannelType as ContactChannel,
        employerContact: company.contactValue ?? '',
      },
      undefined,
      REQUEST_ID,
    );
    invitationCount += 1;
    const after = (hours: number) => setNow(new Date(sentAt.getTime() + hours * HOUR_MS));
    switch (def.outcome) {
      case 'VIEWED':
        after(2);
        await invitations.markViewed(candidate.candidateId, candidate.userId, invitation.id);
        break;
      case 'ACCEPTED':
        after(5);
        await invitations.accept(candidate.candidateId, candidate.userId, invitation.id, REQUEST_ID);
        break;
      case 'ACCEPTED_REVOKED':
        after(5);
        await invitations.accept(candidate.candidateId, candidate.userId, invitation.id, REQUEST_ID);
        after(48);
        await invitations.revokeAccess(candidate.candidateId, candidate.userId, company.id, REQUEST_ID);
        break;
      case 'DECLINED':
        after(7);
        await invitations.decline(candidate.candidateId, candidate.userId, invitation.id, 'SALARY', REQUEST_ID);
        break;
      case 'WITHDRAWN':
        after(26);
        await invitations.withdraw(company, owner.userId, invitation.id, REQUEST_ID);
        break;
      case 'EXPIRED':
        setNow(realNow);
        await invitations.expireStale({ ids: [invitation.id] });
        break;
      case 'SENT':
        break;
    }
    setNow(realNow);
  }

  // ───────────── Подборки и закладки ─────────────
  let selections = 0;
  for (const needKey of SELECTION_NEEDS) {
    const def = NEEDS.find((n) => n.key === needKey)!;
    const owner = companies.get(def.company)!;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    const needId = needIds.get(needKey)!;
    if (await prisma.selectionRun.findFirst({ where: { companyId: company.id, needId } })) continue;
    setNow(daysBefore(2));
    const first = await matching.createSelection(company, owner.userId, needId, {}, undefined, REQUEST_ID);
    selections += 1;
    if (needKey === 'fintech-backend') {
      setNow(daysBefore(1));
      await matching.createSelection(company, owner.userId, needId, { onlyWithFsp: true }, first.id, REQUEST_ID);
      selections += 1;
    }
    setNow(realNow);
  }
  for (const def of BOOKMARKS) {
    const owner = companies.get(def.company)!;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    const run = await prisma.selectionRun.findFirst({ where: { companyId: company.id, needId: needIds.get(def.need)! }, orderBy: { createdAt: 'asc' } });
    if (!run) continue;
    const view = await matching.getSelection(company, run.id, 1, 10);
    const top = view.items.filter((item) => !item.unavailable).slice(0, def.take);
    for (const item of top) if (!item.unavailable) await matching.addBookmark(company, item.candidate.candidateId);
  }

  const totals = {
    candidates: await prisma.candidateProfile.count({ where: { user: { isDemo: true } } }),
    qualifications: await prisma.candidateQualification.count(),
    attempts: await prisma.assessmentAttempt.count({ where: { isSynthetic: true } }),
    companies: await prisma.company.count({ where: { owner: { isDemo: true } } }),
    needs: await prisma.hiringNeed.count(),
    invitations: await prisma.invitation.count(),
    grants: await prisma.contactAccessGrant.count(),
    selections: await prisma.selectionRun.count(),
    bookmarks: await prisma.candidateBookmark.count(),
    fspLinks: await prisma.fspLink.count(),
  };
  console.log(`\nSeed завершён (создано кандидатов: ${createdCandidates}, приглашений: ${invitationCount}, подборок: ${selections}). Итого в БД:`);
  console.table(totals);
  console.log(`Пароль демо-аккаунтов: ${process.env.SEED_DEMO_PASSWORD ? '(из SEED_DEMO_PASSWORD)' : DEFAULT_DEMO_PASSWORD}`);
  await app.close();

  // ─────────────────────────────── вспомогательные функции ───────────────────────────────

  async function createCandidate(def: CandidateDef): Promise<{ userId: string; candidateId: string }> {
    const rng = createRng(`profile|${def.key}`);
    const userId = uuidFrom(`user|${def.email}`);
    const candidateId = uuidFrom(`candidate|${def.key}`);
    const spec = def.specialization;
    const confirmedGrade = def.attempts.find((a) => a.outcome === 'PASS')?.grade ?? def.declaredGrade;
    const oldest = Math.max(7, ...def.attempts.map((a) => a.daysAgo + 3));
    const createdAt = daysBefore(oldest);
    const full = def.profile === 'FULL';
    const partial = def.profile !== 'EMPTY';

    let alias = '';
    for (let salt = 0; ; salt += 1) {
      alias = uuidFrom(`alias|${def.key}|${salt}`).slice(0, 4).toUpperCase();
      if (!usedAliases.has(alias)) break;
    }
    usedAliases.add(alias);

    const city = rng.pick(CITIES);
    const formatRoll = rng.next();
    const workFormats: WorkFormat[] = formatRoll < 0.55 ? ['REMOTE'] : formatRoll < 0.75 ? ['REMOTE', 'HYBRID'] : formatRoll < 0.9 ? ['HYBRID', 'OFFICE'] : ['OFFICE'];
    const [expMin, expMax] = confirmedGrade ? EXPERIENCE_RANGE[confirmedGrade] : [0, 24];
    const experienceMonths = rng.int(expMin, expMax);
    let salaryFrom: number | null = null;
    let salaryTo: number | null = null;
    if (full && spec && confirmedGrade && rng.bool(0.7)) {
      const base = SALARY_BASE[spec][confirmedGrade];
      salaryFrom = Math.round((base * (0.9 + rng.next() * 0.25)) / 5000) * 5000;
      salaryTo = Math.round((salaryFrom * (1.2 + rng.next() * 0.2)) / 5000) * 5000;
    }
    const channelRoll = rng.next();
    const disclosure: ContactChannel[] = ['EMAIL', ...(channelRoll < 0.5 ? (['PHONE'] as const) : []), ...(channelRoll > 0.6 ? (['MESSENGER'] as const) : [])];
    const local = def.email.split('@')[0];
    const digits = String(hashInt(`phone|${def.key}`) % 10000).padStart(4, '0');
    const skills = full && spec ? rng.sample(SELF_SKILLS[spec], rng.int(5, 9)) : [];
    const survey =
      def.survey && spec && confirmedGrade
        ? {
            version: SURVEY_VERSION,
            completedAt: createdAt.toISOString(),
            answers: {
              industries: rng.sample(INDUSTRY_CODES.filter((c) => c !== 'ANY'), rng.int(1, 3)),
              focus: FOCUS_BY_SPEC[spec],
              recentTasks: TASKS_BY_SPEC[spec],
              experience: confirmedGrade === 'SENIOR' ? 'Y3_PLUS' : confirmedGrade === 'MIDDLE' ? 'Y1_3' : experienceMonths > 6 ? 'LT1' : 'NONE',
              autonomy: confirmedGrade === 'SENIOR' ? 'LEADING' : confirmedGrade === 'MIDDLE' ? 'INDEPENDENT' : 'GUIDED',
              fspParticipation: def.fsp ? 'YES' : 'NO',
            },
          }
        : null;

    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: { id: userId, email: def.email, normalizedEmail: normalizeEmail(def.email), passwordHash, role: 'CANDIDATE', emailVerifiedAt: def.emailVerified ? createdAt : null, isDemo: true, createdAt },
      });
      await tx.consentRecord.create({ data: { id: uuidFrom(`consent|dp|${def.key}`), userId, type: 'DATA_PROCESSING', policyVersion: CONSENT_POLICY_VERSIONS.DATA_PROCESSING, acceptedAt: createdAt } });
      if (def.publication !== 'NO_CONSENT') {
        await tx.consentRecord.create({ data: { id: uuidFrom(`consent|pub|${def.key}`), userId, type: 'PROFILE_PUBLICATION', policyVersion: CONSENT_POLICY_VERSIONS.PROFILE_PUBLICATION, acceptedAt: daysBefore(Math.max(1, oldest - 2)) } });
      }
      await tx.candidateProfile.create({
        data: {
          id: candidateId,
          userId,
          alias,
          fullName: partial ? def.fullName : null,
          contactEmail: partial ? `contact.${local}@demo.example` : null,
          phone: full ? `+7 (900) 000-${digits.slice(0, 2)}-${digits.slice(2)}` : null,
          messenger: full ? `@demo_${def.key.replace(/-/g, '_')}` : null,
          city: full ? city.city : null,
          timezone: full ? city.tz : null,
          workFormats: full ? workFormats : [],
          availability: def.availability,
          salaryFrom,
          salaryTo,
          industries: survey ? (survey.answers.industries as string[]) : [],
          activeSpecializationCode: spec,
          declaredGrade: def.declaredGrade,
          experienceMonths: full ? experienceMonths : null,
          teamRoles: full && spec ? (spec === 'MANUAL_QA' ? ['TESTER'] : spec === 'ML_ENGINEER' ? ['DATA_SCIENTIST'] : ['DEVELOPER']).concat(confirmedGrade === 'SENIOR' ? ['MENTOR'] : []) : [],
          experienceDescription: full && spec ? rng.pick(DESCRIPTIONS[spec]) : null,
          softSkills: full ? rng.sample(SOFT_SKILL_CODES, rng.int(2, 4)) : [],
          externalLinks: full && rng.bool(0.4) ? [`https://example.org/demo-profile/${def.key}`] : [],
          isDiscoverable: def.publication === 'PUBLISHED',
          showSalaryToEmployers: def.showSalary,
          showFspToEmployers: def.showFsp,
          disclosureChannels: full ? disclosure : [],
          survey: survey ?? undefined,
          createdAt,
        },
      });
      if (skills.length) {
        await tx.candidateSkill.createMany({ data: skills.map((code) => ({ candidateId, skillCode: code, months: rng.bool(0.8) ? rng.int(3, Math.max(6, experienceMonths)) : null })) });
      }
    });
    return { userId, candidateId };
  }

  async function seedAttempt(candidateId: string, def: CandidateDef, plan: AttemptPlan, index: number): Promise<void> {
    const spec = def.specialization as SpecializationCode;
    const attemptId = uuidFrom(`attempt|${def.key}|${index}`);
    if (await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } })) return;
    const base = `seed|${def.key}|${index}`;
    const blueprint = buildStandardBlueprint(spec, plan.grade, createRng(`${base}|blueprint`), policy);
    const instances: PrivateTaskInstance[] = blueprint.slots.map((slot) => instantiate(getFamily(slot.familyId)!, plan.grade, `${base}|${slot.position}`));
    const groupOrder = groupsOf(spec).map((g) => g.code);

    const accRng = createRng(`accuracy|${def.key}|${index}`);
    // Точность «решателя»: успешные попытки — высокая с редкой слабой группой; неуспешные — заметно ниже порога.
    const baseAccuracy = plan.outcome === 'FAIL' ? 0.5 + accRng.next() * 0.15 : plan.outcome === 'EXPIRED' ? 0.8 : 0.84 + accRng.next() * 0.12;
    const weakGroup = accRng.int(0, 2);
    const weak = plan.outcome === 'PASS' && accRng.bool(0.3);
    const jitter = () => (accRng.next() - 0.5) * 0.06;
    const accuracy: [number, number, number] =
      plan.accuracy ?? (plan.confident ? [0.98, 0.98, 0.98] : ([0, 1, 2].map((i) => (weak && i === weakGroup ? 0.66 + accRng.next() * 0.1 : baseAccuracy + jitter())) as [number, number, number]));

    const answeredCount = plan.outcome === 'EXPIRED' ? Math.ceil(instances.length / 2) : plan.outcome === 'ABANDONED' ? 2 : instances.length;
    let answers: Array<ItemAnswer | null> = [];
    let score: AttemptScore | null = null;
    for (let salt = 0; salt < 600; salt += 1) {
      const rng = createRng(`solve|${base}|${salt}`);
      answers = instances.map((inst, position) => (position < answeredCount ? solveInstance(inst, accuracy[groupOrder.indexOf(inst.groupCode)], rng) : null));
      const evaluated = instances.map((inst, position) => ({ groupCode: inst.groupCode, evaluation: evaluateItem(inst.key, answers[position]) }));
      score = scoreAttempt(evaluated, groupOrder, policy);
      if (plan.outcome === 'PASS' && score.passed && (plan.confident === undefined || score.confident === plan.confident)) break;
      if (plan.outcome === 'FAIL' && !score.passed && score.overall >= 35) break;
      if (plan.outcome === 'EXPIRED' && score.overall >= 20) break;
      if (plan.outcome === 'ABANDONED') break;
      if (salt === 599) throw new Error(`Seed: не удалось получить исход ${plan.outcome} для ${def.key}`);
    }

    const endTime = daysBefore(plan.daysAgo, plan.hoursAgo ?? 0);
    const duration = (12 + (hashInt(`duration|${base}`) % 16)) * 60_000;
    const startedAt = plan.outcome === 'PASS' || plan.outcome === 'FAIL' ? new Date(endTime.getTime() - duration) : endTime;
    const expiresAt = new Date(startedAt.getTime() + policy.durationMinutes * 60_000);
    const finishedAt = plan.outcome === 'EXPIRED' ? expiresAt : plan.outcome === 'ABANDONED' ? new Date(startedAt.getTime() + 6 * 60_000) : endTime;
    const status = plan.outcome === 'PASS' ? 'PASSED' : plan.outcome === 'FAIL' ? 'FAILED' : plan.outcome === 'EXPIRED' ? 'EXPIRED' : 'ABANDONED';
    const scored = plan.outcome !== 'ABANDONED' ? score : null;

    await prisma.$transaction(async (tx) => {
      const attempt = await tx.assessmentAttempt.create({
        data: {
          id: attemptId,
          candidateId,
          specializationCode: spec,
          requestedGrade: plan.grade,
          status,
          startedAt,
          expiresAt,
          finishedAt,
          blueprintVersion: BLUEPRINT_VERSION,
          bankVersion: BANK_VERSION,
          policyVersion: policy.version,
          policySnapshot: policy as unknown as Prisma.InputJsonValue,
          overallScore: scored?.overall ?? null,
          groupScores: scored ? (scored.groups as unknown as Prisma.InputJsonValue) : undefined,
          skillEvidence: scored ? (scored.skills as unknown as Prisma.InputJsonValue) : undefined,
          confident: plan.outcome === 'PASS' ? scored!.confident : plan.outcome === 'ABANDONED' ? null : false,
          qualificationGranted: status === 'PASSED',
          isSynthetic: true,
        },
      });
      await tx.assessmentItem.createMany({
        data: instances.map((inst, position) => ({
          id: uuidFrom(`item|${attemptId}|${position}`),
          attemptId,
          position,
          groupCode: inst.groupCode,
          familyId: inst.familyId,
          familyVersion: inst.familyVersion,
          grade: plan.grade,
          seed: inst.seed,
          fingerprint: inst.fingerprint,
          skillTags: inst.skillTags,
          publicSnapshot: inst.public as unknown as Prisma.InputJsonValue,
          privateKey: inst.key as unknown as Prisma.InputJsonValue,
        })),
      });
      const rows = answers.flatMap((answer, position) =>
        answer
          ? [{ id: uuidFrom(`answer|${attemptId}|${position}`), attemptId, itemId: uuidFrom(`item|${attemptId}|${position}`), answer: answer as unknown as Prisma.InputJsonValue, revision: 1, savedAt: new Date(startedAt.getTime() + (position + 1) * 90_000) }]
          : [],
      );
      if (rows.length) await tx.assessmentAnswer.createMany({ data: rows });
      if (status === 'PASSED') await grantQualification(tx, attempt, scored!, policy, finishedAt);
    });
  }

  async function seedFsp(ids: { userId: string; candidateId: string }, def: CandidateDef): Promise<void> {
    const plan = def.fsp!;
    if (plan.kind === 'LINK') {
      setNow(daysBefore(8));
      try {
        await fsp.link(ids.candidateId, ids.userId, plan.id, plan.code, REQUEST_ID);
      } catch (error) {
        console.warn(`Seed: не удалось привязать ${plan.id} к ${def.key}: ${(error as Error).message}. Выполните pnpm --filter @fsp/api fixtures:fsp`);
      }
      setNow(realNow);
      return;
    }
    // SYNC_ERROR: реестр сейчас недоступен, но ранее история была успешно загружена.
    type FixtureResult = {
      record_id: string;
      event?: { id?: string; title?: string; discipline?: string; level?: string; date?: string };
      participation?: string;
      place?: number | null;
      role?: string;
      skills?: string[];
      verified_at?: string;
    };
    const fixture = JSON.parse(readFileSync(resolveFixturePath('fsp-mock.json'), 'utf8')) as { participants: Array<{ participant_id: string; results: FixtureResult[] }> };
    const participant = fixture.participants.find((p) => p.participant_id === plan.id);
    const syncedAt = daysBefore(3);
    await prisma.$transaction(async (tx) => {
      await tx.fspLink.create({ data: { candidateId: ids.candidateId, provider: 'mock', externalId: plan.id, state: 'SYNC_ERROR', linkedAt: daysBefore(10), lastSyncAttemptAt: daysBefore(0, 1), lastSuccessfulSyncAt: syncedAt, lastErrorCode: 'FSP_UNAVAILABLE' } });
      await tx.fspAchievement.createMany({
        data: (participant?.results ?? []).map((r) => ({
          candidateId: ids.candidateId,
          provider: 'mock',
          externalId: r.record_id,
          eventId: r.event?.id ?? null,
          eventTitle: r.event?.title ?? null,
          discipline: r.event?.discipline ?? null,
          eventLevel: r.event?.level ?? null,
          eventDate: r.event?.date ? new Date(`${r.event.date}T00:00:00.000Z`) : null,
          participationType: r.participation ?? null,
          place: typeof r.place === 'number' ? r.place : null,
          teamRole: r.role ?? null,
          skillTags: r.skills ?? [],
          source: 'fsp-demo-registry',
          verifiedAt: r.verified_at ? new Date(r.verified_at) : null,
          syncedAt,
          isDemo: true,
        })),
      });
    });
  }
}

/** Удаляет демо-данные в порядке, который учитывает ограничения целостности (история подтверждений защищена от каскада). */
async function resetDemoData(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { isDemo: true }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return;
  const profiles = await prisma.candidateProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const companies = await prisma.company.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const candidateIds = profiles.map((p) => p.id);
  const companyIds = companies.map((c) => c.id);
  await prisma.$transaction([
    prisma.invitation.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { candidateId: { in: candidateIds } }] } }),
    prisma.contactAccessGrant.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { candidateId: { in: candidateIds } }] } }),
    prisma.selectionRun.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.candidateBookmark.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { candidateId: { in: candidateIds } }] } }),
    prisma.hiringNeed.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.qualificationHistory.deleteMany({ where: { candidateId: { in: candidateIds } } }),
    prisma.candidateQualification.deleteMany({ where: { candidateId: { in: candidateIds } } }),
    prisma.assessmentAttempt.deleteMany({ where: { candidateId: { in: candidateIds } } }),
    prisma.fspLinkCodeRedemption.deleteMany({ where: { candidateId: { in: candidateIds } } }),
    prisma.fspAchievement.deleteMany({ where: { candidateId: { in: candidateIds } } }),
    prisma.fspLink.deleteMany({ where: { candidateId: { in: candidateIds } } }),
    prisma.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  console.log(`Удалены демо-данные: аккаунтов ${userIds.length}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
