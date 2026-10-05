// Отладочные скриншоты интерфейса.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3000';
const OUT = process.env.SHOTS_DIR ?? 'shots';
const [, , email, password, ...paths] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => msg.type() === 'error' && console.log('console error:', msg.text().slice(0, 200)));
page.on('pageerror', (err) => console.log('page error:', err.message.slice(0, 300)));
if (email && email !== '-') {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
}
for (const p of paths) {
  const cut = p.lastIndexOf('='); const path = p.slice(0, cut); const name = p.slice(cut + 1);
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('shot', name, page.url());
}
await browser.close();
