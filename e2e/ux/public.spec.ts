import { expect, test } from '@playwright/test';

test('role actions lead to the matching registration choice without overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Я ищу специалиста', exact: true }).click();
  await expect(page).toHaveURL(/register\?role=EMPLOYER/);
  await expect(page.getByRole('radio', { name: /Я ищу специалиста/ })).toBeChecked();
});

for (const route of ['/login', '/register']) {
  test(`${route}: password visibility preserves the value and does not submit the form`, async ({ page }) => {
    await page.goto(route);
    const password = page.getByLabel(/^Пароль/);
    await password.fill('Example-password-123');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Показать пароль' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('Example-password-123');
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await page.getByRole('button', { name: 'Скрыть пароль' }).click();
    await expect(password).toHaveAttribute('type', 'password');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
