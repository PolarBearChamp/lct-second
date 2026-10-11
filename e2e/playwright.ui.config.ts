import { defineConfig } from '@playwright/test';

/** Isolated frontend regressions: local auth fixture + mocked browser API; no DB or real credentials. */
export default defineConfig({
  testDir: './ui',
  reporter: 'list',
  workers: 1,
  use: { baseURL: 'http://localhost:3100', browserName: 'chromium', screenshot: 'only-on-failure', viewport: { width: 1440, height: 1000 } },
  webServer: [
    { command: 'node ui/auth-server.mjs', url: 'http://127.0.0.1:3101/api/v1/auth/me', reuseExistingServer: false },
    { command: 'pnpm --filter @fsp/web exec next start --port 3100', url: 'http://localhost:3100/login', env: { API_INTERNAL_URL: 'http://127.0.0.1:3101' }, reuseExistingServer: false },
  ],
});
