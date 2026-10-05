import path from 'node:path';
import { config as loadEnv } from 'dotenv';

export const ROOT = path.resolve(__dirname, '../..');
loadEnv({ path: path.join(ROOT, '.env'), quiet: true });

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://fsp:fsp_local_password@localhost:5433/fsp?schema=public';
export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Demo-Password-2026';
/** Пароль аккаунтов, создаваемых тестами. */
export const E2E_PASSWORD = 'E2e-Strong-Pass-2026';
export const E2E_DOMAIN = 'e2e.example';

let counter = 0;
export const uniqueEmail = (prefix: string) => `${prefix}.${Date.now().toString(36)}${(counter += 1)}@${E2E_DOMAIN}`;
