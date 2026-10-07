import { expect, test, type Browser } from '@playwright/test';
import { ApiSession } from '../helpers/api';
import { candidateProfileId } from '../helpers/db';
import { DEMO_PASSWORD, E2E_PASSWORD, uniqueEmail } from '../helpers/env';
import { login } from '../helpers/ui';

const CONTACT = 'e2e.apply.contact@e2e.example';

async function asUser(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

/**
 * Сценарий 6 (дополнительный по ТЗ). Работодатель публикует вакансию с обязательной зарплатной вилкой; кандидат, который
 * не публиковал профиль, сам откликается: контакты раскрываются только этой компании. Работодатель работает с откликом
 * (просмотр → шорт-лист), кандидат отзывает отклик вместе с доступом к контактам.
 */
test('вакансия: публикация → самостоятельный отклик → работа с откликом → отзыв отклика и доступа', async ({ browser }) => {
  const title = `Backend-разработчик (e2e вакансия ${Date.now().toString(36)})`;

  // Предусловие (через API): кандидат с подтверждённым грейдом, профиль в общем поиске НЕ опубликован.
  const email = uniqueEmail('cand.apply');
  const api = await ApiSession.create();
  await api.registerAndVerify(email, 'CANDIDATE');
  await api.fillCandidateProfile({ contactEmail: CONTACT, disclosureChannels: ['EMAIL'] });
  expect((await api.takeAssessment(email, 'BACKEND', 'MIDDLE')).status).toBe('PASSED');
  await api.dispose();
  const candidateId = await candidateProfileId(email);

  // ── Работодатель публикует вакансию ──
  const employer = await asUser(browser, 'hr.fintech@demo.example', DEMO_PASSWORD);
  await employer.page.goto('/employer/vacancies/new');
  await employer.page.getByLabel('Название').fill(title);
  await employer.page.getByLabel('Описание вакансии').fill('Развиваем платёжное API: PostgreSQL, очереди, надёжность. Команда из шести человек, удалённо.');
  await employer.page.getByRole('checkbox', { name: 'Middle', exact: true }).check();
  await employer.page.getByRole('checkbox', { name: 'Senior', exact: true }).check();
  await employer.page.getByRole('checkbox', { name: 'SQL', exact: true }).check();
  await employer.page.getByRole('checkbox', { name: 'PostgreSQL', exact: true }).check();
  await employer.page.getByRole('radio', { name: 'Опубликовать сразу' }).check();
  await employer.page.getByRole('button', { name: 'Сохранить вакансию' }).click();
  await expect(employer.page.getByText('Целое положительное число').first()).toBeVisible(); // без вилки сохранить нельзя
  await employer.page.getByLabel('Зарплата от, ₽/мес').fill('260000');
  await employer.page.getByLabel('Зарплата до, ₽/мес').fill('340000');
  await employer.page.getByRole('button', { name: 'Сохранить вакансию' }).click();
  await expect(employer.page.getByRole('heading', { level: 1, name: new RegExp(title.replace(/[()]/g, '\\$&')) })).toBeVisible();
  await expect(employer.page.getByText('Опубликована', { exact: true }).first()).toBeVisible();
  await expect(employer.page.getByText('Откликов в работе нет')).toBeVisible();

  // ── Кандидат находит вакансию: зарплата видна до отклика ──
  const candidate = await asUser(browser, email, E2E_PASSWORD);
  await candidate.page.goto('/candidate/vacancies');
  await candidate.page.getByLabel('Поиск').fill(title);
  await candidate.page.getByRole('button', { name: 'Применить' }).click();
  const card = candidate.page.getByRole('link', { name: new RegExp(title.replace(/[()]/g, '\\$&')) });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/260\s000 – 340\s000 ₽/);
  await expect(card).toContainText('вы подходите по требованиям');
  await card.click();
  await expect(candidate.page.getByText('в месяц до вычета налогов (GROSS)')).toBeVisible();
  await expect(candidate.page.getByText('Как вы соответствуете требованиям')).toBeVisible();

  // ── Отклик: явное согласие на раскрытие контактов только этой компании ──
  await candidate.page.getByRole('button', { name: 'Откликнуться', exact: true }).click();
  await expect(candidate.page.getByText('Только этой компании будет раскрыто:')).toBeVisible();
  await expect(candidate.page.getByRole('dialog')).toContainText(CONTACT);
  const confirm = candidate.page.getByRole('button', { name: 'Откликнуться и раскрыть контакты' });
  await expect(confirm).toBeDisabled(); // нужно явное подтверждение раскрытия
  await candidate.page.getByLabel('Сопроводительное сообщение').fill('Работал с платёжными API, готов обсудить условия.');
  await candidate.page.getByRole('checkbox', { name: /Я понимаю, какие данные будут раскрыты/ }).check();
  await confirm.click();
  await expect(candidate.page.getByRole('heading', { level: 1, name: new RegExp(title.replace(/[()]/g, '\\$&')) })).toBeVisible();
  await expect(candidate.page.getByText('Контакты раскрыты этой компании')).toBeVisible();
  await expect(candidate.page.getByText('Отправлен', { exact: true }).first()).toBeVisible();

  // ── Вторая компания по-прежнему ничего не знает о кандидате ──
  const other = await asUser(browser, 'hr.retail@demo.example', DEMO_PASSWORD);
  await other.page.goto(`/employer/candidates/${candidateId}`);
  await expect(other.page.locator('main')).not.toContainText(CONTACT);
  await expect(other.page.locator('main')).not.toContainText('Е2Е Кандидатов');
  await other.context.close();

  // ── Работодатель: счётчик, список, отклик ──
  await employer.page.goto('/employer/vacancies');
  await expect(employer.page.getByRole('link', { name: new RegExp(title.replace(/[()]/g, '\\$&')) })).toContainText('новых откликов: 1');
  await employer.page.getByRole('link', { name: new RegExp(title.replace(/[()]/g, '\\$&')) }).click();
  const row = employer.page.getByRole('link', { name: /Е2Е Кандидатов/ });
  await expect(row).toContainText('контакты раскрыты');
  await expect(row).toContainText('есть сообщение');
  await row.click();
  await expect(employer.page.getByText('Работал с платёжными API, готов обсудить условия.')).toBeVisible();
  await expect(employer.page.getByText(CONTACT)).toBeVisible();
  await expect(employer.page.getByText('Соответствие требованиям вакансии')).toBeVisible();
  await expect(employer.page.getByText('Почему подходит')).toBeVisible();
  await expect(employer.page.getByText('Просмотрен', { exact: true }).first()).toBeVisible(); // явное открытие отклика зафиксировало просмотр
  await employer.page.getByRole('button', { name: 'Взять в шорт-лист' }).click();
  await expect(employer.page.getByText('В шорт-листе', { exact: true }).first()).toBeVisible();

  // ── Кандидат видит новый статус и отзывает отклик вместе с доступом ──
  await candidate.page.goto('/candidate/applications');
  await candidate.page.getByRole('link', { name: new RegExp(title.replace(/[()]/g, '\\$&')) }).click();
  await expect(candidate.page.getByText('Вас взяли в шорт-лист')).toBeVisible();
  await candidate.page.getByRole('button', { name: 'Отозвать отклик' }).click();
  await expect(candidate.page.getByRole('checkbox', { name: /Также закрыть этой компании доступ/ })).toBeChecked();
  await candidate.page.getByRole('button', { name: 'Отозвать', exact: true }).click();
  await expect(candidate.page.getByText('Вы отозвали отклик')).toBeVisible();
  await expect(candidate.page.getByText('Доступ к контактам закрыт').first()).toBeVisible();

  // ── Работодатель больше не видит контактов; статус отклика сохранился ──
  await employer.page.reload();
  await expect(employer.page.getByText('Карточка кандидата недоступна')).toBeVisible();
  await expect(employer.page.locator('main')).not.toContainText(CONTACT);
  await expect(employer.page.getByText('Отозван', { exact: true }).first()).toBeVisible();

  await employer.context.close();
  await candidate.context.close();
});
