import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { closeDb, db } from './helpers/db';
import { BASE_URL, E2E_DOMAIN, MAILPIT_URL, ROOT } from './helpers/env';
import { clearMailbox } from './helpers/mail';

async function assertReachable(name: string, url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`${name} недоступен (${url}): ${(error as Error).message}\n${hint}`);
  }
}

/** Удаляет аккаунты прежних прогонов (@e2e.example) в порядке, учитывающем ограничения целостности. */
async function removeE2eAccounts(): Promise<number> {
  const users = `(SELECT id FROM "User" WHERE "normalizedEmail" LIKE '%@${E2E_DOMAIN}')`;
  const profiles = `(SELECT id FROM "CandidateProfile" WHERE "userId" IN ${users})`;
  const companies = `(SELECT id FROM "Company" WHERE "ownerUserId" IN ${users})`;
  const { rows } = await db().query(`SELECT count(*)::int AS n FROM "User" WHERE "normalizedEmail" LIKE '%@${E2E_DOMAIN}'`);
  const statements = [
    `DELETE FROM "Invitation" WHERE "companyId" IN ${companies} OR "candidateId" IN ${profiles}`,
    `DELETE FROM "ContactAccessGrant" WHERE "companyId" IN ${companies} OR "candidateId" IN ${profiles}`,
    `DELETE FROM "SelectionRun" WHERE "companyId" IN ${companies}`,
    `DELETE FROM "CandidateBookmark" WHERE "companyId" IN ${companies} OR "candidateId" IN ${profiles}`,
    `DELETE FROM "HiringNeed" WHERE "companyId" IN ${companies}`,
    `DELETE FROM "QualificationHistory" WHERE "candidateId" IN ${profiles}`,
    `DELETE FROM "CandidateQualification" WHERE "candidateId" IN ${profiles}`,
    `DELETE FROM "AssessmentAttempt" WHERE "candidateId" IN ${profiles}`,
    `DELETE FROM "FspLinkCodeRedemption" WHERE "candidateId" IN ${profiles}`,
    `DELETE FROM "FspAchievement" WHERE "candidateId" IN ${profiles}`,
    `DELETE FROM "FspLink" WHERE "candidateId" IN ${profiles}`,
    `DELETE FROM "AuditEvent" WHERE "actorUserId" IN ${users}`,
    `DELETE FROM "User" WHERE id IN ${users}`,
  ];
  for (const statement of statements) await db().query(statement);
  return rows[0].n as number;
}

export default async function globalSetup(): Promise<void> {
  await assertReachable('API (через web-прокси)', `${BASE_URL}/api/v1/health/ready`, 'Запустите стенд: pnpm infra:up && pnpm db:migrate && pnpm build && pnpm start (или pnpm dev).');
  await assertReachable('Web', BASE_URL, 'Запустите web: pnpm start (после pnpm build) или pnpm dev.');
  await assertReachable('Mailpit', `${MAILPIT_URL}/api/v1/info`, 'Запустите почту: pnpm infra:up.');

  const removed = await removeE2eAccounts();
  console.log(`[e2e] удалено аккаунтов прошлых прогонов: ${removed}`);

  if (process.env.E2E_SKIP_SEED === '1') {
    console.log('[e2e] seed пропущен (E2E_SKIP_SEED=1): используются текущие демо-данные');
  } else {
    console.log('[e2e] пересоздаю демо-данные (seed --reset)…');
    execFileSync(process.execPath, [path.join('apps', 'api', 'dist', 'scripts', 'seed.js'), '--reset'], { cwd: ROOT, stdio: 'inherit', env: process.env });
  }
  await clearMailbox();
  await closeDb();
}
