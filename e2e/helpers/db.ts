import { Pool } from 'pg';
import { DATABASE_URL } from './env';

let pool: Pool | null = null;
export function db(): Pool {
  // Строка подключения Prisma содержит ?schema=public — драйвер pg этот параметр не понимает.
  pool ??= new Pool({ connectionString: DATABASE_URL.replace(/\?schema=\w+/, ''), max: 2 });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

// ───────────────────────────── Ключи тестовых заданий ─────────────────────────────
// Правильные ответы берутся напрямую из БД тестового стенда: production-эндпоинта выдачи ключей нет и не создаётся.

interface PublicOption {
  id: string;
  label: string;
}
export type PublicPart =
  | { id: string; format: 'SINGLE_CHOICE' | 'MULTI_SELECT'; prompt: string; options: PublicOption[] }
  | { id: string; format: 'NUMERIC'; prompt: string; integer: boolean }
  | { id: string; format: 'MATCHING'; prompt: string; left: PublicOption[]; right: PublicOption[] }
  | { id: string; format: 'ORDERING'; prompt: string; items: PublicOption[] };
export type PartKey =
  | { partId: string; format: 'SINGLE_CHOICE'; correctOptionId: string }
  | { partId: string; format: 'MULTI_SELECT'; correctOptionIds: string[] }
  | { partId: string; format: 'NUMERIC'; correctValue: number }
  | { partId: string; format: 'MATCHING'; correctPairs: Record<string, string> }
  | { partId: string; format: 'ORDERING'; correctOrder: string[] };

export interface AttemptItem {
  id: string;
  position: number;
  parts: PublicPart[];
  keys: PartKey[];
}

/** Задания активной попытки пользователя вместе с закрытыми ключами. */
export async function activeAttemptItems(email: string): Promise<{ attemptId: string; items: AttemptItem[] }> {
  const { rows } = await db().query(
    `SELECT a.id AS attempt_id, i.id, i.position, i."publicSnapshot" AS pub, i."privateKey" AS key
       FROM "AssessmentAttempt" a
       JOIN "CandidateProfile" p ON p.id = a."candidateId"
       JOIN "User" u ON u.id = p."userId"
       JOIN "AssessmentItem" i ON i."attemptId" = a.id
      WHERE u."normalizedEmail" = $1 AND a.status = 'IN_PROGRESS'
      ORDER BY i.position`,
    [email.toLowerCase()],
  );
  if (rows.length === 0) throw new Error(`У ${email} нет активной попытки`);
  return {
    attemptId: rows[0].attempt_id as string,
    items: rows.map((row) => ({ id: row.id as string, position: row.position as number, parts: row.pub.parts as PublicPart[], keys: row.key.parts as PartKey[] })),
  };
}

/** Ответ части в формате API по ключу. */
export function correctPartAnswer(key: PartKey): unknown {
  switch (key.format) {
    case 'SINGLE_CHOICE':
      return { optionId: key.correctOptionId };
    case 'MULTI_SELECT':
      return { optionIds: key.correctOptionIds };
    case 'NUMERIC':
      return { value: key.correctValue };
    case 'MATCHING':
      return { pairs: key.correctPairs };
    case 'ORDERING':
      return { order: key.correctOrder };
  }
}

export const labelOf = (options: PublicOption[], id: string) => {
  const found = options.find((o) => o.id === id);
  if (!found) throw new Error(`Нет варианта ${id}`);
  return found.label;
};

export async function userExists(email: string): Promise<boolean> {
  const { rowCount } = await db().query('SELECT 1 FROM "User" WHERE "normalizedEmail" = $1', [email.toLowerCase()]);
  return (rowCount ?? 0) > 0;
}

export async function candidateProfileId(email: string): Promise<string> {
  const { rows } = await db().query(
    `SELECT p.id FROM "CandidateProfile" p JOIN "User" u ON u.id = p."userId" WHERE u."normalizedEmail" = $1`,
    [email.toLowerCase()],
  );
  if (!rows[0]) throw new Error(`Нет профиля кандидата для ${email}`);
  return rows[0].id as string;
}
