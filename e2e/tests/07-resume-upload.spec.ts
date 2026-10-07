import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, uniqueEmail } from '../helpers/env';
import { ApiSession } from '../helpers/api';
import { login } from '../helpers/ui';

/**
 * Сценарий 7 (дополнительный по ТЗ). Кандидат загружает PDF-резюме: платформа распознаёт поля и предлагает заполнить профиль;
 * применяется только то, что кандидат отметил. Навыки и грейд остаются самоописанием, подтверждённой категории нет.
 */
test('PDF-резюме: загрузка → распознанные поля → выборочное применение → профиль заполнен, категория не подтверждена', async ({ page }) => {
  const accountEmail = uniqueEmail('cand.resume');
  const api = await ApiSession.create();
  await api.registerAndVerify(accountEmail, 'CANDIDATE');
  await api.dispose();

  await login(page, accountEmail, E2E_PASSWORD);
  await page.goto('/candidate/profile');
  await expect(page.getByRole('heading', { name: 'Заполнить из PDF-резюме' })).toBeVisible();

  // Файл не PDF отклоняется до отправки.
  await page.getByLabel('PDF-файл резюме').setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('просто текст') });
  await expect(page.getByText('Нужен файл в формате PDF')).toBeVisible();

  await page.getByLabel('PDF-файл резюме').setInputFiles(path.resolve(__dirname, '../fixtures/resume-sample.pdf'));
  const result = page.getByRole('region', { name: 'Результат распознавания' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Соколова Марина Игоревна');
  await expect(result).toContainText('marina.sokolova@demo-resume.example');
  await expect(result).toContainText('+7 921 555-01-23');
  await expect(result).toContainText('@marina_front');
  await expect(result).toContainText('Санкт-Петербург');
  await expect(result).toContainText('React');
  await expect(result).toContainText('TypeScript');
  await expect(result).toContainText('Frontend-разработчик');
  await expect(result).toContainText('Middle');
  await expect(result).toContainText('самоописание');

  // Предложение не применено, пока кандидат не подтвердил: поле профиля пока пустое.
  const form = page.locator('form');
  await expect(form.getByLabel('ФИО')).toHaveValue('');

  // Контактный email при регистрации заполнен адресом аккаунта, поэтому замена по умолчанию не отмечена — отмечаем осознанно.
  const email = result.getByRole('checkbox', { name: /Контактный email/ });
  await expect(email).not.toBeChecked();
  await expect(result).toContainText('Заменит:');
  await email.check();
  // Снимаем отметку с мессенджера — он не должен попасть в профиль.
  await result.getByRole('checkbox', { name: /Мессенджер/ }).uncheck();
  await result.getByRole('button', { name: /Применить выбранное/ }).click();

  await expect(page.getByText(/Применено полей/)).toBeVisible();
  await expect(form.getByLabel('ФИО')).toHaveValue('Соколова Марина Игоревна');
  await expect(page.getByRole('textbox', { name: 'Город', exact: true })).toHaveValue('Санкт-Петербург');
  await expect(page.getByLabel('Контактный email')).toHaveValue('marina.sokolova@demo-resume.example');
  await expect(form.getByLabel('Мессенджер')).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: /^React/ })).toBeChecked();
  // Категория по-прежнему не подтверждена: резюме не заменяет тест.
  await expect(page.getByText('Грейда по результатам тестирования пока нет')).toBeVisible();
});
