import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 не загружает .env автоматически: читаем локальный .env API и корневой .env монорепозитория.
loadEnv({ path: path.resolve(__dirname, '.env'), quiet: true });
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    // Для `prisma generate` URL не нужен, поэтому пустая строка допустима; migrate без URL завершится понятной ошибкой.
    url: process.env.DATABASE_URL ?? '',
  },
});
