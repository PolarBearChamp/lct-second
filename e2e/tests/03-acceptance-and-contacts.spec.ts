import { expect, test, type Browser } from '@playwright/test';
import { ApiSession } from '../helpers/api';
import { candidateProfileId } from '../helpers/db';
import { DEMO_PASSWORD, E2E_PASSWORD, uniqueEmail } from '../helpers/env';
import { login } from '../helpers/ui';

const CONTACT = 'e2e.accept.contact@e2e.example';

async function asUser(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

/**
 * Сценарий 3. Две компании приглашают одного кандидата. Кандидат видит зарплату, принимает приглашение первой:
 * контакты получает только она, вторая компания видит по-прежнему обезличенную карточку.
 */
test('принятие приглашения раскрывает контакты только принявшей компании', async ({ browser }) => {
  // Предусловие (через API): опубликованный кандидат с подтверждённым грейдом.
  const email = uniqueEmail('cand.accept');
  const api = await ApiSession.create();
  await api.registerAndVerify(email, 'CANDIDATE');
  await api.fillCandidateProfile({ contactEmail: CONTACT, disclosureChannels: ['EMAIL'] });
  expect((await api.takeAssessment(email, 'BACKEND', 'MIDDLE')).status).toBe('PASSED');
  await api.publishProfile();
  await api.dispose();
  const candidateId = await candidateProfileId(email);

  const sendInvitation = async (employerEmail: string, title: string, from: string, to: string) => {
    const { context, page } = await asUser(browser, employerEmail, DEMO_PASSWORD);
    await page.goto(`/employer/candidates/${candidateId}`);
    await expect(page.getByRole('heading', { level: 1, name: /^Кандидат [0-9A-F]{4,6}$/ })).toBeVisible();
    await page.getByLabel('Заголовок предложения').fill(title);
    await page.getByLabel('Задачи и условия').fill(`Условия предложения «${title}»: удалённо, команда платежей.`);
    await page.getByLabel('Зарплата от, ₽/мес (GROSS)').fill(from);
    await page.getByLabel('Зарплата до, ₽/мес (GROSS)').fill(to);
    await page.getByRole('button', { name: 'Предпросмотр и отправка' }).click();
    await page.getByRole('button', { name: 'Отправить приглашение' }).click();
    await expect(page.getByText('Приглашение уже отправлено')).toBeVisible();
    await context.close();
  };
  await sendInvitation('hr.fintech@demo.example', 'Предложение от Финтех', '270000', '330000');
  await sendInvitation('hr.retail@demo.example', 'Предложение от Ритейл', '240000', '300000');

  // ── Кандидат: видит зарплату до принятия, принимает первое приглашение ──
  const candidate = await asUser(browser, email, E2E_PASSWORD);
  await candidate.page.goto('/candidate/invitations');
  await expect(candidate.page.getByText('Предложение от Финтех')).toBeVisible();
  await expect(candidate.page.getByText('Предложение от Ритейл')).toBeVisible();
  await candidate.page.getByText('Предложение от Финтех').click();
  await expect(candidate.page.getByText(/270\s?000/).first()).toBeVisible();
  await expect(candidate.page.getByText('в месяц до вычета налогов (GROSS)')).toBeVisible();
  await expect(candidate.page.getByText('Контакты раскрыты этой компании')).toHaveCount(0);
  await candidate.page.getByRole('button', { name: 'Принять и раскрыть контакты' }).click();
  await expect(candidate.page.getByText('Только этой компании будет раскрыто:')).toBeVisible();
  const accept = candidate.page.getByRole('button', { name: 'Принять и раскрыть', exact: true });
  await expect(accept).toBeDisabled(); // нужно явное подтверждение раскрытия
  await candidate.page.getByRole('checkbox', { name: /Я понимаю, какие данные будут раскрыты/ }).check();
  await accept.click();
  await expect(candidate.page.getByText('Контакты раскрыты этой компании')).toBeVisible();

  // ── Первая компания получает контакты ──
  const first = await asUser(browser, 'hr.fintech@demo.example', DEMO_PASSWORD);
  await first.page.goto(`/employer/candidates/${candidateId}`);
  await expect(first.page.getByText('Данные, раскрытые кандидатом')).toBeVisible();
  await expect(first.page.getByText(CONTACT)).toBeVisible();
  await expect(first.page.getByText('Тестов Кандидат')).toHaveCount(0); // ФИО из API-профиля: «Е2Е Кандидатов»
  await expect(first.page.getByText('Е2Е Кандидатов').first()).toBeVisible();
  await first.context.close();

  // ── Вторая компания по-прежнему не видит контактов ──
  const second = await asUser(browser, 'hr.retail@demo.example', DEMO_PASSWORD);
  await second.page.goto(`/employer/candidates/${candidateId}`);
  await expect(second.page.getByRole('heading', { level: 1, name: /^Кандидат [0-9A-F]{4,6}$/ })).toBeVisible();
  await expect(second.page.getByText('Данные, раскрытые кандидатом')).toHaveCount(0);
  await expect(second.page.locator('body')).not.toContainText(CONTACT);
  await expect(second.page.locator('body')).not.toContainText('Е2Е Кандидатов');
  await second.page.goto('/employer/invitations');
  const retailRow = second.page.getByRole('row').filter({ hasText: 'Предложение от Ритейл' });
  await expect(retailRow.getByText('Отправлено', { exact: true })).toBeVisible(); // в демо-данных есть другие принятые приглашения — смотрим только свою строку
  await expect(retailRow.getByText('Принято', { exact: true })).toHaveCount(0);
  await expect(retailRow.getByText('контакты', { exact: true })).toHaveCount(0);

  // PDF второй компании не содержит контактов.
  const pdf = await second.page.request.get(`/api/v1/employer/candidates/${candidateId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).includes(Buffer.from(CONTACT))).toBe(false);
  await second.context.close();

  // ── Кандидат отзывает доступ: у первой компании контакты исчезают (в карточке и PDF) ──
  await candidate.page.goto('/candidate/settings#contact-access');
  await expect(candidate.page.getByText('Компании с доступом к контактам')).toBeVisible();
  const grants = candidate.page.locator('#contact-access li');
  await expect(grants).toHaveCount(1);
  await grants.getByRole('button', { name: 'Отозвать доступ' }).click();
  await candidate.page.getByRole('button', { name: 'Отозвать', exact: true }).click();
  await expect(grants.getByText(/^Отозван /)).toBeVisible();
  await candidate.context.close();

  const revoked = await asUser(browser, 'hr.fintech@demo.example', DEMO_PASSWORD);
  await revoked.page.goto(`/employer/candidates/${candidateId}`);
  await expect(revoked.page.getByRole('heading', { level: 1, name: /^Кандидат [0-9A-F]{4,6}$/ })).toBeVisible();
  await expect(revoked.page.locator('body')).not.toContainText(CONTACT);
  const pdfAfter = await revoked.page.request.get(`/api/v1/employer/candidates/${candidateId}/pdf`);
  expect((await pdfAfter.body()).includes(Buffer.from(CONTACT))).toBe(false);
  await revoked.context.close();
});
