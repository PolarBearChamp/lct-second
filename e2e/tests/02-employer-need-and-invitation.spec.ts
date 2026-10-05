import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD } from '../helpers/env';
import { login } from '../helpers/ui';

/**
 * Сценарий 2. Работодатель (демо-компания) создаёт потребность, видит подходящих кандидатов с объяснением и скрытыми
 * контактами, отправляет предложение с обязательной зарплатной вилкой — без публикации вакансии.
 */
test('работодатель: потребность → подборка с объяснениями → обезличенная карточка → предложение с зарплатой', async ({ page }) => {
  await login(page, 'hr.fintech@demo.example', DEMO_PASSWORD);

  // ── Потребность ──
  await page.goto('/employer/needs/new');
  await page.getByLabel('Название').fill('Backend-разработчик в платёжную команду (e2e)');
  await page.getByLabel('Команда и задачи').fill('Развитие платёжного API: PostgreSQL, очереди, надёжность. Команда из шести человек.');
  await page.getByRole('checkbox', { name: 'Middle', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Senior', exact: true }).check();
  await page.getByRole('checkbox', { name: 'SQL', exact: true }).check();
  await page.getByRole('checkbox', { name: 'PostgreSQL', exact: true }).check();
  await page.getByLabel('Добавить навык').fill('Kafka');
  await page.getByRole('button', { name: '+ Apache Kafka' }).click();
  await page.getByLabel('Зарплата от, ₽/мес').fill('250000');
  await page.getByLabel('Зарплата до, ₽/мес').fill('350000');
  await page.getByRole('button', { name: 'Создать потребность' }).click();
  await expect(page.getByRole('heading', { name: 'Backend-разработчик в платёжную команду (e2e)' })).toBeVisible();

  // ── Подборка ──
  await page.getByRole('button', { name: 'Построить подборку' }).click();
  await expect(page.getByRole('heading', { name: 'Подборка кандидатов' })).toBeVisible();
  const cards = page.locator('article[aria-label^="Кандидат "]');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
  const first = cards.first();
  await expect(first.getByText('Почему подходит')).toBeVisible();
  await expect(first.getByText('Что пока не подтверждено')).toBeVisible();
  await expect(first.getByText(/Грейд по тесту: (Middle|Senior)/)).toBeVisible();

  // Контактов и персональных данных в выдаче нет: ни email, ни телефонов, ни ФИО.
  const text = (await page.locator('main').innerText()).toLowerCase();
  expect(text).not.toMatch(/@demo\.example|@example\.|\+7 ?\(?\d{3}/);

  // ── Обезличенная карточка ──
  const names = /^Кандидат [0-9A-F]{4,6}$/;
  const candidates = await cards.getByRole('link', { name: names }).evaluateAll((anchors) =>
    anchors.map((anchor) => ({ name: (anchor.textContent ?? '').trim(), href: anchor.getAttribute('href') ?? '' })),
  );
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates[0].name).toMatch(names);

  // В демо-данных части кандидатов приглашение от этой компании уже отправлено (активное приглашение на пару — одно),
  // поэтому берём первого кандидата выдачи, которому предложение ещё можно отправить.
  const inviteTitle = page.getByLabel('Заголовок предложения');
  const alreadySent = page.getByText('Приглашение уже отправлено');
  let invited: string | null = null;
  for (const candidate of candidates) {
    await page.goto(candidate.href);
    await expect(page.getByRole('heading', { level: 1, name: candidate.name })).toBeVisible();
    await expect(inviteTitle.or(alreadySent)).toBeVisible();
    if (await inviteTitle.isVisible()) {
      invited = candidate.name;
      break;
    }
  }
  expect(invited, 'в подборке не нашлось кандидата без активного приглашения').not.toBeNull();
  await expect(page.getByRole('heading', { name: 'Подтверждено тестом' })).toBeVisible();
  await expect(page.getByText('Данные, раскрытые кандидатом')).toHaveCount(0);
  await expect(page.getByText(/Соответствие потребности/)).toBeVisible();

  // ── Предложение с обязательной вилкой (поля предзаполнены из потребности) ──
  const salaryFrom = page.getByLabel('Зарплата от, ₽/мес (GROSS)');
  await expect(salaryFrom).toHaveValue('250000');
  await salaryFrom.fill('');
  await page.getByRole('button', { name: 'Предпросмотр и отправка' }).click();
  await expect(page.getByText('Укажите сумму').first()).toBeVisible(); // без вилки отправить нельзя
  await salaryFrom.fill('260000');
  await page.getByLabel('Зарплата до, ₽/мес (GROSS)').fill('340000');
  await page.getByRole('button', { name: 'Предпросмотр и отправка' }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте предложение перед отправкой' })).toBeVisible();
  await expect(page.getByText(/260\s000 – 340\s000 ₽ в месяц до вычета налогов/)).toBeVisible();
  await page.getByRole('button', { name: 'Отправить приглашение' }).click();
  await expect(page.getByText('Приглашение уже отправлено')).toBeVisible();

  // ── Список приглашений ──
  await page.goto('/employer/invitations');
  const row = page.getByRole('row').filter({ hasText: invited! });
  await expect(row).toContainText('Backend-разработчик в платёжную команду (e2e)');
  await expect(row).toContainText(/260\s000 – 340\s000/);
  await expect(row.getByText('Отправлено', { exact: true })).toBeVisible();
});
