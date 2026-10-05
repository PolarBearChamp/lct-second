// Экспорт OpenAPI-описания REST API в docs/openapi.json без запуска сервера и без обращения к БД.
// Запускается из скомпилированного dist (nest build применяет плагин @nestjs/swagger, а Nest DI требует метаданных декораторов):
//
//   pnpm openapi:export
import 'reflect-metadata';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, configureApp } from '../src/bootstrap';
import { applyResponseSchemas, contractSchemas } from './openapi/responses';

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Не найден корень репозитория (pnpm-workspace.yaml)');
}

async function main(): Promise<void> {
  const root = repoRoot();
  loadEnv({ path: path.join(root, '.env'), quiet: true });
  // Для генерации описания соединение с БД и почтой не нужно: подставляются значения-заглушки, если .env отсутствует.
  const defaults: Record<string, string> = {
    DATABASE_URL: 'postgresql://openapi:openapi@localhost:5433/openapi?schema=public',
    APP_ORIGIN: 'http://localhost:3000',
    SESSION_SECRET: 'openapi-export-only-secret-0123456789abcdef',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    FSP_MOCK_DATA_PATH: path.join(root, 'data', 'fixtures', 'fsp-mock.json'),
  };
  for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  const document = buildOpenApiDocument(app);
  await app.close();

  // Схемы ответов из контрактов (packages/contracts) и единый формат ошибок.
  const { unmapped, unused } = applyResponseSchemas(document as unknown as Parameters<typeof applyResponseSchemas>[0], contractSchemas(root));
  if (unmapped.length || unused.length) {
    console.error(`Таблица scripts/openapi/responses.ts не соответствует маршрутам.\n  без схемы ответа: ${unmapped.join(', ') || '—'}\n  лишние записи: ${unused.join(', ') || '—'}`);
    process.exit(1);
  }

  const operations = Object.values(document.paths).reduce((sum, item) => sum + Object.keys(item ?? {}).filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);
  const out = path.join(root, 'docs', 'openapi.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`OpenAPI записан: docs/openapi.json (${Object.keys(document.paths).length} путей, ${operations} операций, схем: ${Object.keys(document.components?.schemas ?? {}).length})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
