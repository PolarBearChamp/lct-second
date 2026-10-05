import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// Интеграционные тесты работают с отдельной БД (TEST_DATABASE_URL), а не с демонстрационной.
loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL не задан: интеграционные тесты не запускаются на рабочей БД');
}
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'test-secret-0123456789abcdef0123456789abcdef';
process.env.SESSION_COOKIE_SECURE = 'false';
process.env.SMTP_HOST = process.env.SMTP_HOST ?? 'localhost';
process.env.SMTP_PORT = process.env.SMTP_PORT ?? '1025';
process.env.SWAGGER_ENABLED = 'false';
process.env.SKIP_CATALOG_SYNC = 'false';
