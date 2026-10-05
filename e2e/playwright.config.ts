import { defineConfig, devices } from '@playwright/test';

/**
 * Сквозные проверки идут против запущенного стенда (web + api + postgres + mailpit):
 *   pnpm infra:up && pnpm db:migrate && pnpm build && pnpm start   (или pnpm dev)
 *   pnpm test:e2e
 *
 * Перед прогоном global-setup пересоздаёт демо-данные (seed --reset) и удаляет аккаунты прежних прогонов (@e2e.example).
 * Тесты используют общую БД, поэтому выполняются последовательно в одном потоке.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
