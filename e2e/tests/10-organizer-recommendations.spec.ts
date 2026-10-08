import { expect, test, type Browser } from '@playwright/test';
import { DEMO_PASSWORD } from '../helpers/env';
import { login } from '../helpers/ui';

async function asUser(browser: Browser, email: string) {
  const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, DEMO_PASSWORD);
  return { context, page };
}

/**
 * Сценарий 10: изменения по итогам встречи организаторов с участниками (демо-аккаунты, без новых регистраций).
 *  - кандидат без подтверждённого грейда виден в банке ниже подтверждённых, с пометкой;
 *  - работодатель отправляет такому кандидату задание лично, кандидат отвечает;
 *  - добровольная проверка компании даёт метку «Компания проверена»;
 *  - кандидату 16–17 лет приглашение отправляется только с подтверждением особых условий труда.
 */
test('без подтверждённого грейда — ниже с пометкой; адресное задание; метка доверия компании; кандидат 16–17 лет', async ({ browser }) => {
  // ── Банк: неподтверждённый кандидат после подтверждённых, с пометкой ──
  const fintech = await asUser(browser, 'hr.fintech@demo.example');
  // Кандидаты без подтверждённого грейда идут после всех подтверждённых — открываем их категорию напрямую.
  await fintech.page.goto('/employer/candidates?category=BACKEND:UNCONFIRMED');
  await expect(fintech.page.getByRole('heading', { name: /Backend-разработчик · грейд не подтверждён тестом/ })).toBeVisible();
  const unconfirmedCard = fintech.page.locator('article', { has: fintech.page.getByText('Грейд не подтверждён тестом', { exact: true }) }).first();
  await expect(unconfirmedCard).toContainText('заявлен: Middle');

  // ── Адресное задание из карточки кандидата ──
  await fintech.page.locator('article', { has: fintech.page.getByText('Грейд не подтверждён тестом', { exact: true }) }).first().getByRole('link').first().click();
  await expect(fintech.page.getByText('Грейд не подтверждён', { exact: true }).first()).toBeVisible();
  await fintech.page.getByLabel('Задание', { exact: true }).selectOption({ label: 'Повтор платёжного запроса · Backend-разработчик' });
  await fintech.page.getByLabel('Сообщение кандидату').fill('Посмотрим ваш подход до приглашения');
  await fintech.page.getByRole('button', { name: 'Отправить задание' }).click();
  await expect(fintech.page.getByText('Задание отправлено')).toBeVisible();

  const candidate = await asUser(browser, 'unconfirmed.candidate@demo.example');
  await candidate.page.goto('/candidate');
  await expect(candidate.page.getByText('Профиль виден, но грейд не подтверждён')).toBeVisible();
  await expect(candidate.page.getByRole('link', { name: /Короткие задания/ })).toContainText('1');
  await candidate.page.goto('/candidate/tasks');
  await expect(candidate.page.getByRole('heading', { name: 'Отправлены вам лично' })).toBeVisible();
  await expect(candidate.page.getByText('Сообщение компании: Посмотрим ваш подход до приглашения')).toBeVisible();
  await expect(candidate.page.getByText('✓ Компания проверена').first()).toBeVisible(); // «Демо Финтех» проверена в seed
  await candidate.page.getByLabel('Ключ идемпотентности и уникальный индекс в базе').check();
  await candidate.page.getByRole('button', { name: 'Отправить ответ' }).click();
  await expect(candidate.page.getByText('верно', { exact: true })).toBeVisible();
  await candidate.context.close();

  // ── Метка доверия: «Демо Индустрия» проходит проверку в профиле компании ──
  const industry = await asUser(browser, 'hr.industry@demo.example');
  await industry.page.goto('/employer/company');
  await industry.page.getByLabel('ИНН компании').fill('0077030031');
  await industry.page.getByRole('button', { name: 'Проверить' }).click();
  await expect(industry.page.getByText('Не пройдена')).toBeVisible();
  await expect(industry.page.getByText(/ИНН некорректен/)).toBeVisible();
  await industry.page.getByLabel('ИНН компании').fill('0077030030');
  await industry.page.getByRole('button', { name: 'Проверить снова' }).click();
  await expect(industry.page.getByText(/Проверена/)).toBeVisible();
  await expect(industry.page.getByText('Почта аккаунта на домене организации (demo.example)')).toBeVisible();
  await industry.context.close();

  // ── Кандидат 16–17 лет: отметка и подтверждение особых условий при приглашении ──
  await fintech.page.goto('/employer/candidates?category=FRONTEND:JUNIOR');
  const teenCard = fintech.page.locator('article', { has: fintech.page.getByText('16–17 лет', { exact: true }) }).first();
  await expect(teenCard).toBeVisible();
  await teenCard.getByRole('link').first().click();
  await expect(fintech.page.getByText('16–17 лет', { exact: true }).first()).toBeVisible();
  await fintech.page.getByLabel('Заголовок предложения').fill('Стажировка во фронтенде');
  await fintech.page.getByLabel('Задачи и условия').fill('Неполный рабочий день, удалённо, задачи по интерфейсу личного кабинета.');
  await fintech.page.getByLabel('Зарплата от, ₽/мес (GROSS)').fill('60000');
  await fintech.page.getByLabel('Зарплата до, ₽/мес (GROSS)').fill('80000');
  await fintech.page.getByRole('button', { name: 'Предпросмотр и отправка' }).click();
  const dialog = fintech.page.getByRole('dialog');
  await expect(dialog.getByText('Кандидату 16–17 лет')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Отправить приглашение' })).toBeDisabled();
  await dialog.getByLabel(/Мы знаем об особых условиях труда/).check();
  await dialog.getByRole('button', { name: 'Отправить приглашение' }).click();
  await expect(fintech.page.getByText('Приглашение уже отправлено')).toBeVisible();
  await fintech.context.close();
});
