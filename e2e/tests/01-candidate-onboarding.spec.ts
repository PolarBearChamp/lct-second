import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, uniqueEmail } from '../helpers/env';
import { waitForVerificationLink } from '../helpers/mail';
import { takeAssessmentInUi } from '../helpers/ui';

/**
 * Сценарий 1 и 5. Новый кандидат без привязки ФСП проходит весь основной путь только через интерфейс:
 * регистрация → подтверждение email через Mailpit → опрос → профиль → тест → подтверждённая категория → публикация.
 */
test('новый кандидат без ФСП: регистрация, подтверждение email, опрос, профиль, тест, категория и публикация', async ({ page }) => {
  const email = uniqueEmail('cand.onboarding');

  // ── Регистрация ──
  await page.goto('/register');
  await page.getByRole('radio', { name: /Я ищу работу/ }).check();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(E2E_PASSWORD);
  await page.getByRole('checkbox', { name: /Я согласен\(на\) на обработку персональных данных/ }).check();
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByRole('heading', { name: 'Подтвердите email' })).toBeVisible();

  // До подтверждения кабинет недоступен.
  await page.goto('/candidate');
  await expect(page).toHaveURL(/\/verify-email/);

  // ── Подтверждение по письму из Mailpit (GET безопасен: подтверждает только явный POST по кнопке) ──
  const { url } = await waitForVerificationLink(email);
  await page.goto(url);
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Адрес подтверждён')).toBeVisible();
  await page.getByRole('button', { name: 'Перейти в кабинет' }).click();
  await expect(page).toHaveURL(/\/candidate$/);
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();

  // ── Опрос и выбор специализации ──
  await page.goto('/candidate/survey');
  const next = page.getByRole('button', { name: /^(Далее|Завершить опрос)$/ });
  await expect(next).toBeVisible(); // мастер загружает определение опроса и профиль — ждём первый вопрос
  for (let step = 0; step < 20; step += 1) {
    const legend = page.locator('main fieldset legend').first();
    const question = await legend.innerText();
    const isLast = (await next.innerText()).trim() === 'Завершить опрос';
    await page.locator('main fieldset input').first().check();
    await next.click();
    if (isLast) break;
    await expect(legend).not.toHaveText(question); // следующий вопрос отрисован
    if (step === 0) {
      // Незавершённый опрос не теряется: после перезагрузки восстанавливаются ответы и текущий вопрос.
      await page.reload();
      await expect(page.getByText('Восстановлены ваши незавершённые ответы опроса')).toBeVisible();
      await expect(next).toBeVisible();
      await expect(legend).not.toHaveText(question);
    }
  }
  await expect(page.getByText('Рекомендация по результатам опроса')).toBeVisible();
  await page.getByRole('radio', { name: /^Backend-разработчик/ }).check();
  await page.getByRole('radio', { name: /^Middle/ }).check();
  await page.getByRole('button', { name: 'Сохранить и перейти к тестированию' }).click();
  await expect(page).toHaveURL(/\/candidate\/assessments$/);

  // ── Профиль: сначала неполный — прогресс сохраняется и не теряется после перезагрузки ──
  await page.goto('/candidate/profile');
  await page.getByLabel('ФИО').fill('Тестов Кандидат Сквозной');
  await page.getByRole('textbox', { name: 'Город', exact: true }).fill('Казань');
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(page.getByText('Профиль сохранён')).toBeVisible();
  await expect(page.getByText(/Не заполнены поля: .*часовой пояс/)).toBeVisible(); // что осталось до публикации
  await page.reload();
  await expect(page.getByLabel('ФИО')).toHaveValue('Тестов Кандидат Сквозной');

  // ── Затем обязательные поля, стек из справочника, контакты ──
  await page.getByLabel('Часовой пояс').selectOption('Europe/Moscow');
  await page.getByLabel('Опыт по специальности, месяцев').fill('36');
  await page.getByLabel('Дата рождения').fill('1997-04-12');
  await page.getByLabel('Поиск по справочнику').fill('PostgreSQL');
  await page.getByRole('checkbox', { name: /^PostgreSQL/ }).check();
  await page.getByLabel('Поиск по справочнику').fill('SQL');
  await page.getByRole('checkbox', { name: /^SQL/ }).first().check();
  await page.getByLabel('Контактный email').fill('e2e.candidate.profile@e2e.example');
  await page.getByRole('checkbox', { name: 'Удалённо' }).check();
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(page.getByText('Профиль сохранён')).toBeVisible();
  await expect(page.getByText('Грейда по результатам тестирования пока нет')).toBeVisible();

  // ── Тест: до результата подтверждённой категории нет ──
  await page.goto('/candidate/assessments');
  await expect(page.getByText('Приоритет')).toHaveCount(0);
  const startButtons = page.getByRole('button', { name: 'Начать тест' });
  await expect(startButtons).toHaveCount(3);
  await startButtons.nth(1).click(); // Middle
  await page.getByRole('button', { name: 'Начать — таймер запустится' }).click();
  await expect(page).toHaveURL(/\/candidate\/assessments\/[0-9a-f-]{36}$/);
  await takeAssessmentInUi(page, email, 'correct', { simulateTabSwitches: 3 });

  // ── Результат и подтверждённая категория ──
  await expect(page.getByRole('heading', { name: 'Результат тестирования' })).toBeVisible();
  await expect(page.getByText(/Тест пройден: грейд Middle подтверждён/)).toBeVisible();
  await expect(page.getByText('Уверенное прохождение', { exact: true })).toBeVisible();
  // Сигналы честности: кандидат видит ту же сводку, что и работодатель; на результат они не влияют.
  await expect(page.getByRole('heading', { name: 'Сигналы при прохождении' })).toBeVisible();
  await expect(page.getByText(/Вкладка теста скрывалась 3 раза/).first()).toBeVisible();
  await expect(page.getByText(/ничего не доказывают.*не влияют на баллы и грейд/).first()).toBeVisible();
  await page.goto('/candidate');
  await expect(page.getByText('Работодатели видят только грейд, подтверждённый тестированием.')).toBeVisible();
  await expect(page.getByText('Middle').first()).toBeVisible();

  // ── Публикация: явное согласие + хотя бы один канал связи для раскрытия после принятия приглашения ──
  await page.goto('/candidate/settings');
  await expect(page.getByText('Профиль не виден в поиске')).toBeVisible();
  await page.getByRole('checkbox', { name: /Я согласен\(на\) на публикацию обезличенного профиля/ }).check();
  await page.getByRole('button', { name: 'Дать согласие и опубликовать' }).click();
  await expect(page.getByText('Согласие на публикацию дано')).toBeVisible();
  await expect(page.getByText('Профиль не виден в поиске')).toBeVisible(); // без канала раскрытия публикация не завершена
  await expect(page.getByText('Выберите хотя бы один канал связи для раскрытия')).toBeVisible();
  const emailChannel = page.getByRole('group', { name: 'Какие каналы раскрывать после принятия приглашения' }).getByRole('checkbox', { name: /^Email/ });
  await emailChannel.click(); // состояние берётся с сервера, поэтому check() не подходит: флажок меняется после ответа API
  await expect(emailChannel).toBeChecked();
  await expect(page.getByText('Профиль виден работодателям в поиске')).toBeVisible();

  // ── ФСП не привязан и не мешал ни одному шагу ──
  await expect(page.getByRole('button', { name: 'Привязать' })).toBeVisible();
  const me = await page.request.get('/api/v1/auth/me');
  const body = (await me.json()) as { candidate: { discoverable: boolean; confirmedGrade: string | null } };
  expect(body.candidate).toMatchObject({ discoverable: true, confirmedGrade: 'MIDDLE' });
});
