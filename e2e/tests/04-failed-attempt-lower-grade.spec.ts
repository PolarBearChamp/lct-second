import { expect, test } from '@playwright/test';
import { ApiSession } from '../helpers/api';
import { E2E_PASSWORD, uniqueEmail } from '../helpers/env';
import { login, takeAssessmentInUi } from '../helpers/ui';

/**
 * Сценарий 4. Неуспешная первая попытка не выдаёт грейд и не публикует профиль; повтор того же уровня закрыт
 * с точной датой, а путь к более низкому грейду открыт сразу и приводит к подтверждению.
 */
test('неуспех первой попытки: грейд не выдан, профиль не опубликован, подтверждается более низкий грейд', async ({ page }) => {
  const email = uniqueEmail('cand.failed');
  const api = await ApiSession.create();
  await api.registerAndVerify(email, 'CANDIDATE');
  await api.fillCandidateProfile({ declaredGrade: 'MIDDLE' });
  await api.ok('put', '/candidate/consents', { profilePublication: true }); // согласие дано заранее: публикацию блокирует только отсутствие грейда
  await api.dispose();

  await login(page, email, E2E_PASSWORD);

  // ── Первая попытка (Middle) без ответов ──
  await page.goto('/candidate/assessments');
  await page.getByRole('button', { name: 'Начать тест' }).nth(1).click();
  await page.getByRole('button', { name: 'Начать — таймер запустится' }).click();
  await expect(page).toHaveURL(/\/candidate\/assessments\/[0-9a-f-]{36}$/);
  await takeAssessmentInUi(page, email, 'empty');

  await expect(page.getByText(/Порог прохождения на уровень Middle не достигнут/)).toBeVisible();
  await expect(page.getByText('Подтверждённый грейд не выдан и не изменён.')).toBeVisible();
  await expect(page.getByText('Уверенное прохождение', { exact: true })).toHaveCount(0);

  // Грейда нет.
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as { candidate: { confirmedGrade: string | null; discoverable: boolean; discoverabilityIssues: Array<{ code: string }> } };
  expect(me.candidate.confirmedGrade).toBeNull();
  expect(me.candidate.discoverable).toBe(false);
  // Без подтверждённого грейда кандидат может быть виден (ниже подтверждённых, с пометкой), но этот профиль ещё не опубликован.
  const profile = (await (await page.request.get('/api/v1/candidate/profile')).json()) as { discoverability: { gradeConfirmed: boolean } };
  expect(profile.discoverability.gradeConfirmed).toBe(false);

  // ── Повтор Middle закрыт с точной датой; Junior доступен сразу ──
  await page.goto('/candidate/assessments');
  const gradeCards = page.locator('div.rounded-xl.border:has(button:has-text("Начать тест"))');
  await expect(gradeCards).toHaveCount(3);
  const middle = gradeCards.nth(1);
  await expect(middle.getByText('недоступен')).toBeVisible();
  await expect(middle.getByText(/Доступно: \d{1,2} [а-я]+ \d{4} г\.,? (в )?\d{2}:\d{2}/)).toBeVisible(); // точная дата и время повтора
  await expect(middle.getByText(/возможна через 30 дней после завершения предыдущей неуспешной попытки/)).toBeVisible();
  await expect(middle.getByRole('button', { name: 'Начать тест' })).toBeDisabled();
  const junior = gradeCards.nth(0);
  await expect(junior.getByText('доступен', { exact: true })).toBeVisible();
  await junior.getByRole('button', { name: 'Начать тест' }).click();
  await page.getByRole('button', { name: 'Начать — таймер запустится' }).click();
  await expect(page).toHaveURL(/\/candidate\/assessments\/[0-9a-f-]{36}$/);

  // ── Успешная попытка на Junior подтверждает более низкий грейд ──
  await takeAssessmentInUi(page, email, 'correct');
  await expect(page.getByText(/Тест пройден: грейд Junior подтверждён/)).toBeVisible();

  const after = (await (await page.request.get('/api/v1/auth/me')).json()) as { candidate: { confirmedGrade: string | null } };
  expect(after.candidate.confirmedGrade).toBe('JUNIOR');

  // История попыток хранит оба результата, публикация возможна.
  await page.goto('/candidate/assessments');
  await expect(page.getByRole('row').filter({ hasText: 'Middle' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Junior' })).toBeVisible();
  await page.goto('/candidate/settings');
  const visibility = page.getByRole('checkbox', { name: /^Показывать профиль в поиске работодателей/ });
  await visibility.click(); // состояние берётся с сервера: флажок меняется после ответа API
  await expect(visibility).toBeChecked();
  await expect(page.getByText('Профиль виден работодателям в поиске')).toBeVisible();
});
