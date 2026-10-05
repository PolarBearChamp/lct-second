import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { type AppEnv, ConfigValidationError, parseEnv } from './config/env';

// Локальный запуск: переменные из корневого .env. В Docker переменные передаются окружением.
loadEnv({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), '.env'), quiet: true });

function readEnvOrExit(): AppEnv {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

async function bootstrap(): Promise<void> {
  // Ранняя проверка конфигурации с понятным сообщением до инициализации модулей.
  const env = readEnvOrExit();
  const levels: Record<AppEnv['LOG_LEVEL'], Array<'error' | 'warn' | 'log' | 'debug'>> = {
    error: ['error'],
    warn: ['error', 'warn'],
    info: ['error', 'warn', 'log'],
    debug: ['error', 'warn', 'log', 'debug'],
  };
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: levels[env.LOG_LEVEL] });
  configureApp(app);
  setupSwagger(app);
  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`API запущен на порту ${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
