import { expect, test, type Browser } from '@playwright/test';
import { ApiSession } from '../helpers/api';
import { DEMO_PASSWORD, E2E_PASSWORD, uniqueEmail } from '../helpers/env';
import { login } from '../helpers/ui';

const CONTACT = 'e2e.task.contact@e2e.example';

async function asUser(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

async function backendCandidate(prefix: string) {
  const email = uniqueEmail(prefix);
  const api = await ApiSession.create();
  await api.registerAndVerify(email, 'CANDIDATE');
  await api.fillCandidateProfile({ contactEmail: CONTACT, disclosureChannels: ['EMAIL'] });
  expect((await api.takeAssessment(email, 'BACKEND', 'MIDDLE')).status).toBe('PASSED');
  await api.publishProfile();
  await api.dispose();
  return email;
}

/**
 * Сценарий 8 (дополнительный по ТЗ). Работодатель публикует короткое задание-тест и задание-разбор; кандидаты получают их в разделе
 * «Короткие задания», отвечают; тест проверяется автоматически, разбор оценивает автор. Автор видит ответы под псевдонимом,
 * без ФИО и контактов; подтверждённый грейд ответы не меняют.
 */
test('короткие задания: публикация → предложение кандидату → ответ → оценка автором → обратная связь', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const quizTitle = `Идемпотентность (e2e ${stamp})`;
  const essayTitle = `Разбор медленного запроса (e2e ${stamp})`;
  const firstEmail = await backendCandidate('cand.task1');
  const secondEmail = await backendCandidate('cand.task2');

  // ── Работодатель создаёт тест через интерфейс ──
  const employer = await asUser(browser, 'hr.fintech@demo.example', DEMO_PASSWORD);
  await employer.page.goto('/employer/tasks/new');
  await employer.page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(employer.page.getByText('Не короче 3 символов')).toBeVisible(); // пустое задание не публикуется
  await employer.page.getByLabel('Название').fill(quizTitle);
  await employer.page.getByLabel('Условие').fill('Клиент повторил POST /payments из-за таймаута. Как не списать деньги дважды?');
  await employer.page.getByLabel('Вариант 1', { exact: true }).fill('Игнорировать повторы');
  await employer.page.getByLabel('Вариант 2', { exact: true }).fill('Ключ идемпотентности и уникальный индекс');
  await employer.page.getByLabel('Вариант 2 — верный').check();
  await employer.page.getByLabel('Пояснение после ответа').fill('Повтор безопасен, если сервер помнит ключ запроса.');
  await employer.page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(employer.page.getByRole('heading', { level: 1, name: new RegExp(quizTitle.replace(/[()]/g, '\\$&')) })).toBeVisible();
  await expect(employer.page.getByText('Активно', { exact: true }).first()).toBeVisible();
  await expect(employer.page.getByText('Ответов пока нет')).toBeVisible();
  const quizUrl = employer.page.url();

  // Опубликованное задание не редактируется.
  await employer.page.goto(`${quizUrl}/edit`);
  await expect(employer.page.getByText('Опубликованное задание не редактируется')).toBeVisible();

  // ── Кандидат получает задание, отвечает; тест проверяется автоматически ──
  const first = await asUser(browser, firstEmail, E2E_PASSWORD);
  await first.page.goto('/candidate/tasks');
  await expect(first.page.getByRole('heading', { name: quizTitle })).toBeVisible();
  const submitQuiz = first.page.getByRole('button', { name: 'Отправить ответ' });
  await expect(submitQuiz).toBeDisabled(); // пока вариант не выбран
  await first.page.getByLabel('Ключ идемпотентности и уникальный индекс').check();
  await submitQuiz.click();
  await expect(first.page.getByText('верно', { exact: true })).toBeVisible();
  await expect(first.page.getByText('Пояснение: Повтор безопасен, если сервер помнит ключ запроса.')).toBeVisible();
  await expect(first.page.getByText(/задание решено за 90 дней/)).toBeVisible();
  // Подтверждённый грейд остался прежним.
  await first.page.goto('/candidate/assessments');
  await expect(first.page.getByText('Middle').first()).toBeVisible();

  // ── Автор видит ответ под псевдонимом, без ФИО и контактов ──
  await employer.page.goto(quizUrl);
  await expect(employer.page.getByText('Верно ответили 1 из 1')).toBeVisible();
  await expect(employer.page.getByText(/Кандидат [A-Z0-9]{4}/).first()).toBeVisible();
  await expect(employer.page.getByText('грейд по тесту: Middle')).toBeVisible();
  await expect(employer.page.locator('main')).not.toContainText('Е2Е Кандидатов');
  await expect(employer.page.locator('main')).not.toContainText(CONTACT);

  // ── Текстовый разбор: ответ → оценка автором → обратная связь кандидату ──
  const apiEmployer = await ApiSession.create();
  await apiEmployer.login('hr.fintech@demo.example', DEMO_PASSWORD);
  await apiEmployer.ok('post', '/employer/tasks', {
    title: essayTitle,
    prompt: 'Страница отчёта открывается 12 секунд. Опишите, как будете искать причину и что проверите в первую очередь.',
    specialization: 'BACKEND',
    kind: 'APPROACH',
    publish: true,
  });
  await apiEmployer.dispose();

  const second = await asUser(browser, secondEmail, E2E_PASSWORD);
  await second.page.goto('/candidate/tasks');
  await expect(second.page.getByRole('heading', { name: essayTitle })).toBeVisible();
  const send = second.page.getByRole('button', { name: 'Отправить ответ' });
  await second.page.getByLabel('Ваш ответ').fill('Коротко');
  await expect(send).toBeDisabled(); // меньше 20 символов
  await second.page.getByLabel('Ваш ответ').fill('Сначала замерю, где уходит время, затем посмотрю план запроса и индексы.');
  await send.click();
  await expect(second.page.getByText('Автор задания ещё не оценил ответ.')).toBeVisible();

  await employer.page.goto('/employer/tasks');
  await expect(employer.page.getByRole('link', { name: new RegExp(essayTitle.replace(/[()]/g, '\\$&')) })).toContainText('ждут оценки: 1');
  await employer.page.getByRole('link', { name: new RegExp(essayTitle.replace(/[()]/g, '\\$&')) }).click();
  await employer.page.getByRole('button', { name: 'Оценить', exact: true }).click();
  const dialog = employer.page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Сохранить оценку' })).toBeDisabled();
  await dialog.getByLabel('Сильный ответ').check();
  await dialog.getByLabel('Комментарий кандидату').fill('Хороший план, добавьте метрики.');
  await dialog.getByRole('button', { name: 'Сохранить оценку' }).click();
  await expect(employer.page.getByText('Ваш комментарий: Хороший план, добавьте метрики.')).toBeVisible();

  await second.page.goto('/candidate/tasks');
  const history = second.page.locator('details', { hasText: essayTitle });
  await history.locator('summary').click();
  await expect(history).toContainText('Сильный ответ');
  await expect(history).toContainText('Комментарий автора: Хороший план, добавьте метрики.');

  // ── Закрытие задания ──
  await employer.page.goto(quizUrl);
  await employer.page.getByRole('button', { name: 'Закрыть задание' }).click();
  await employer.page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(employer.page.getByText('Задание закрыто', { exact: true })).toBeVisible();

  await employer.context.close();
  await first.context.close();
  await second.context.close();
});
