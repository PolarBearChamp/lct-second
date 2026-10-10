import { expect, test, type Browser } from '@playwright/test';
import { candidateProfileId } from '../helpers/db';
import { DEMO_PASSWORD } from '../helpers/env';
import { login } from '../helpers/ui';

async function asUser(browser: Browser, email: string) {
  const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, DEMO_PASSWORD);
  return { context, page };
}

/**
 * Сценарий 11: сигналы честности прохождения теста (ответ организаторов FTT.4), демо-аккаунты без новых регистраций.
 * Работодатель видит нейтральную отметку рядом с грейдом в банке и подробную сводку в карточке; грейд при этом не меняется.
 * Сам сбор сигналов в интерфейсе теста (уход со вкладки) проверяется в сценарии 1. В демо-данных помечены два кандидата:
 * Backend Middle №4 («заметные отметки») и Frontend Middle №4 («отметки»); кандидаты из других сценариев в банке тоже могут быть.
 */
test('работодатель видит сигналы прохождения в банке и карточке; грейд от них не зависит', async ({ browser }) => {
  const backendId = await candidateProfileId('be.middle.04@demo.example');
  const frontendId = await candidateProfileId('fe.middle.04@demo.example');
  const fintech = await asUser(browser, 'hr.fintech@demo.example');

  // ── Банк: отметка рядом с грейдом именно у этих кандидатов ──
  const bankCard = (id: string) => fintech.page.locator('article', { has: fintech.page.locator(`a[href*="/employer/candidates/${id}"]`) });
  await fintech.page.goto('/employer/candidates?category=BACKEND:MIDDLE');
  await expect(bankCard(backendId).getByText('Заметные отметки при прохождении', { exact: true })).toBeVisible();
  await expect(bankCard(backendId).getByText(/Грейд по тесту: Middle/)).toBeVisible();

  await fintech.page.goto('/employer/candidates?category=FRONTEND:MIDDLE');
  await expect(bankCard(frontendId).getByText('Отметки при прохождении', { exact: true })).toBeVisible();
  await expect(bankCard(frontendId).getByText(/Грейд по тесту: Middle/)).toBeVisible();

  // ── Карточка: нейтральные формулировки и пояснение, что это не доказательство ──
  await fintech.page.goto(`/employer/candidates/${backendId}`);
  const summary = fintech.page.getByTestId('integrity-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('есть заметные отметки');
  await expect(summary).toContainText('Вкладка теста скрывалась 9 раз, суммарно около 7 мин');
  await expect(summary).toContainText('Вставка текста из буфера обмена в поля ответа: 3 раза');
  await expect(summary).toContainText('Копирование текста задания: 4 раза');
  await expect(summary).toContainText('ничего не доказывают');
  await expect(summary).toContainText('не влияют на баллы и грейд');
  await expect(fintech.page.getByText(/Грейд по тесту: Middle/).first()).toBeVisible();
  await expect(fintech.page.getByText(/tabHidden|focusLoss/)).toHaveCount(0); // сырых счётчиков работодателю не показываем

  await fintech.page.goto(`/employer/candidates/${frontendId}`);
  await expect(fintech.page.getByTestId('integrity-summary')).toContainText('есть отметки');
  await expect(fintech.page.getByTestId('integrity-summary')).toContainText('Вкладка теста скрывалась 4 раза');
  await fintech.context.close();
});
