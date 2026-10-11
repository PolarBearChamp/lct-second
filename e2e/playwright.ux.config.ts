import { defineConfig } from '@playwright/test';

/** Frontend smoke checks; no database, API or seed required. Start the web app first. */
export default defineConfig({
  testDir: './ux',
  reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', browserName: 'chromium' },
  projects: [
    { name: 'phone', use: { viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
