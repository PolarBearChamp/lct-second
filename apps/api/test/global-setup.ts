import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

/** Применяет миграции к тестовой БД перед запуском интеграционных тестов. */
export default async function globalSetup(): Promise<void> {
  loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL не задан');
  if (!/fsp_test|_test\b|test/.test(url)) {
    throw new Error('TEST_DATABASE_URL должен указывать на отдельную тестовую базу (имя содержит "test")');
  }
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
