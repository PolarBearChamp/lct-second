import { expect, test, type Page } from '@playwright/test';

const rules = { policyVersion: 'test', durationMinutes: 30, cases: 1, itemsPerGroup: 1, minScoredParts: 1, passOverall: 70, passGroupMin: 50, confidentOverall: 90, confidentGroupMin: 80, skillMinCases: 1, skillMinScore: 70, retryCooldownHours: 720, reassessmentDays: 90 };
const grades = ['JUNIOR', 'MIDDLE', 'SENIOR'].map((grade) => ({ grade, allowed: grade !== 'MIDDLE', message: 'Повторная попытка позже', availableAt: grade === 'MIDDLE' ? '2099-11-10T12:32:00Z' : null, warnings: [] }));
const eligibility = { specialization: 'FRONTEND', specializationTitle: 'Frontend-разработчик', serverNow: new Date().toISOString(), qualification: null, activeAttempt: null, grades, rules };
const summary = { id: 'attempt', specialization: 'FRONTEND', specializationTitle: 'Frontend-разработчик', grade: 'MIDDLE', status: 'IN_PROGRESS', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), finishedAt: null, overallScore: null, confident: null, qualificationGranted: false, isSynthetic: true };
const attempt = { ...summary, serverNow: new Date().toISOString(), durationMinutes: 30, policyVersion: 'test', items: [{ id: 'item', position: 0, groupCode: 'js', groupTitle: 'JavaScript', revision: 0, savedAt: null, answer: null, task: { title: 'Порядок выполнения', context: [], parts: [{ id: 'ordering', format: 'ORDERING', prompt: 'Расположите строки по порядку.', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }] } }] };
const result = { ...summary, status: 'FAILED', finishedAt: new Date().toISOString(), passed: false, groups: [], skills: [], recommendations: [], thresholds: rules, versions: { policy: 'test', bank: 'test', blueprint: 'test' }, eligibility, statusMessage: 'Тест не пройден', integrity: null };

async function setup(page: Page, role = 'candidate') {
  await page.context().addCookies([{ name: 'fsp_session', value: role, url: 'http://localhost:3100', httpOnly: true }, { name: 'fsp_csrf', value: 'ui-test', url: 'http://localhost:3100' }]);
  const saved: Array<{ answer: { parts: { ordering: { order: string[] } } }; revision: number }> = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    let body: unknown = [];
    if (path === '/auth/me') { const response = await page.request.get('http://127.0.0.1:3101/api/v1/auth/me', { headers: { cookie: `fsp_session=${role}` } }); body = await response.json(); }
    else if (path === '/auth/csrf') body = { csrfToken: 'ui-test' };
    else if (path.endsWith('/answers/item')) { const data = request.postDataJSON() as (typeof saved)[number]; saved.push(data); body = { itemId: 'item', revision: data.revision, savedAt: new Date().toISOString() }; }
    else if (path === '/candidate/assessments/attempt') body = attempt;
    else if (path === '/candidate/assessments/attempt/result') body = result;
    else if (path === '/candidate/assessments/eligibility') body = eligibility;
    else if (path === '/candidate/qualifications') body = { qualifications: [], history: [] };
    else if (path === '/catalogs/reference') body = { industries: [] };
    else if (path === '/employer/company') body = { company: { id: 'company', name: 'Компания', description: '', contactChannelType: 'EMAIL', contactValue: 'ui@example.test', verified: true, verification: { status: 'VERIFIED', inn: '0077010019', verifiedAt: '2026-10-10T12:00:00Z', checks: [], demo: true } } };
    else if (path === '/employer/needs') body = [1, 2, 3].map((n) => ({ id: `need-${n}`, title: `Frontend ${n}`, status: 'ACTIVE', specializationTitle: 'Frontend-разработчик', allowedGrades: ['MIDDLE', 'SENIOR'], workFormat: 'REMOTE', salaryFrom: 220000, salaryTo: 320000, version: 1, selectionsCount: 2, updatedAt: '2026-10-10T12:00:00Z', requiredSkills: Array.from({ length: n * 4 }, (_, i) => ({ code: `skill-${i}`, title: `Длинный навык JavaScript / TypeScript ${i}` })), preferredSkills: [] }));
    await route.fulfill({ json: body });
  });
  return saved;
}

async function order(page: Page) { return page.locator('[data-order-item]').evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.orderItem)); }

test('mouse drag and keyboard reorder are autosaved; test hides workspace navigation', async ({ page }) => {
  const saved = await setup(page);
  await page.goto('/candidate/assessments/attempt');
  await expect(page.getByRole('navigation', { name: 'Разделы кабинета' })).toBeHidden();
  const handle = page.getByRole('button', { name: 'Перетащить «A»', exact: true });
  const from = await handle.boundingBox();
  const target = await page.locator('[data-order-item="c"]').boundingBox();
  expect(from && target).toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + 80, target!.y + target!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(['b', 'c', 'a']);
  await expect.poll(() => saved.at(-1)?.answer.parts.ordering.order).toEqual(['b', 'c', 'a']);
  await page.getByRole('button', { name: 'Переместить «A» выше', exact: true }).click();
  await expect.poll(() => order(page)).toEqual(['b', 'a', 'c']);
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => saved.at(-1)?.answer.parts.ordering.order).toEqual(['a', 'b', 'c']);
  await page.screenshot({ path: '.artifacts/ordering-desktop.png', fullPage: true });
});

test('touch drag works on a phone and dropping outside cancels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const saved = await setup(page);
  await page.goto('/candidate/assessments/attempt');
  const handle = page.getByRole('button', { name: 'Перетащить «A»', exact: true });
  await handle.evaluate((button) => button.closest('ol')!.scrollIntoView({ block: 'center' }));
  const from = await handle.boundingBox();
  const target = await page.locator('[data-order-item="c"]').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from!.x + 10, y: from!.y + 10 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target!.x + 50, y: target!.y + 20 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => saved.at(-1)?.answer.parts.ordering.order).toEqual(['b', 'c', 'a']);
  const moved = await handle.boundingBox();
  await page.mouse.move(moved!.x + 10, moved!.y + 10);
  await page.mouse.down();
  await page.mouse.move(2, 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(['b', 'c', 'a']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('available grades link to the right selection without starting a timer; menu can collapse', async ({ page }) => {
  await setup(page);
  await page.goto('/candidate/assessments/attempt/result');
  await expect(page.getByRole('navigation', { name: 'Разделы кабинета' })).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Разделы кабинета' })).toBeHidden();
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Разделы кабинета' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Выбрать Middle' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Выбрать Senior' }).click();
  await expect(page).toHaveURL(/grade=SENIOR.*#grade-SENIOR/);
  await page.locator('#grade-SENIOR').getByRole('button', { name: 'Начать тест' }).click();
  await expect(page.getByRole('dialog')).toContainText('Начать тест на уровень Senior?');
  await page.screenshot({ path: '.artifacts/grade-confirmation.png', fullPage: true });
});

test('salary remains in its column with many chips, and has a stable mobile layout', async ({ page }) => {
  await setup(page, 'employer');
  await page.goto('/employer/needs');
  const cards = page.locator('main li > a');
  await expect(cards).toHaveCount(3);
  const columns = await cards.evaluateAll((items) => items.map((item) => { const salary = item.lastElementChild!.getBoundingClientRect(); const card = item.getBoundingClientRect(); return { x: salary.x, y: salary.y - card.y }; }));
  expect(new Set(columns.map((column) => column.x)).size).toBe(1);
  expect(new Set(columns.map((column) => column.y)).size).toBe(1);
  await page.screenshot({ path: '.artifacts/salary-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('company verification button aligns with input and has a visible hover state', async ({ page }) => {
  await setup(page, 'employer');
  await page.goto('/employer/company');
  const input = page.getByLabel('ИНН компании');
  const button = page.getByRole('button', { name: 'Проверить снова' });
  const fieldBox = await input.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(Math.abs(fieldBox!.y - buttonBox!.y)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: '.artifacts/company-desktop.png', fullPage: true });
  const before = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
  await button.hover();
  await expect.poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before);
  await page.setViewportSize({ width: 320, height: 844 });
  const smallInput = await input.boundingBox();
  const smallButton = await button.boundingBox();
  expect(smallButton!.y).toBeGreaterThan(smallInput!.y + smallInput!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
