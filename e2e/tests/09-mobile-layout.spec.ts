import { expect, test, type Page } from '@playwright/test';
import { ApiSession } from '../helpers/api';
import { DEMO_PASSWORD, E2E_PASSWORD, uniqueEmail } from '../helpers/env';
import { login } from '../helpers/ui';

/**
 * Сценарий 9 (дополнительный по ТЗ): адаптивная вёрстка. Эмуляция телефона в Chromium (390 и 320 px, касание, мобильный режим):
 * на ключевых экранах обеих ролей нет горизонтального переполнения страницы, шапка и меню доступны, диалоги помещаются на экране,
 * а основные действия выполняются. Это эмуляция в Chromium: реальные устройства и Safari/Firefox не проверялись.
 */
const WIDTHS = [390, 320];

/** Страница не шире окна, и ни один элемент вне прокручиваемых контейнеров не выходит за правый край. */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  await page.waitForLoadState('networkidle').catch(() => {});
  const result = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.right <= viewport + 1) continue;
      let parent = el.parentElement;
      let scrollable = false;
      while (parent && parent !== document.body) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) {
          scrollable = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!scrollable) offenders.push(`${el.tagName.toLowerCase()} «${(el.textContent ?? '').trim().slice(0, 30)}» right=${Math.round(rect.right)}`);
    }
    return { viewport, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 5) };
  });
  expect({ label, scrollWidth: result.scrollWidth, offenders: result.offenders }).toEqual({ label, scrollWidth: result.viewport, offenders: [] });
}

const getJson = (page: Page, path: string) => page.evaluate(async (url) => (await fetch(`/api/v1${url}`, { credentials: 'same-origin' })).json(), path);

for (const width of WIDTHS) {
  test.describe(`телефон ${width} px`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });

    test('кандидат: экраны без горизонтального переполнения, меню и действия доступны', async ({ page }) => {
      await login(page, 'anna.demidova@demo.example', DEMO_PASSWORD);
      const [invitations, applications, vacancies, attempts] = await Promise.all([
        getJson(page, '/candidate/invitations?pageSize=3'),
        getJson(page, '/candidate/applications?pageSize=3'),
        getJson(page, '/candidate/vacancies?pageSize=3'),
        getJson(page, '/candidate/assessments'),
      ]);
      const passed = (attempts.items ?? attempts).find((a: { status: string }) => a.status === 'PASSED');
      const routes = [
        '/candidate',
        '/candidate/profile',
        '/candidate/survey',
        '/candidate/assessments',
        ...(passed ? [`/candidate/assessments/${passed.id}/result`] : []),
        '/candidate/vacancies',
        ...(vacancies.items?.[0] ? [`/candidate/vacancies/${vacancies.items[0].id}`] : []),
        '/candidate/applications',
        ...(applications.items?.[0] ? [`/candidate/applications/${applications.items[0].id}`] : []),
        '/candidate/tasks',
        '/candidate/invitations',
        ...(invitations.items?.[0] ? [`/candidate/invitations/${invitations.items[0].id}`] : []),
        '/candidate/settings',
      ];
      expect(routes.length).toBeGreaterThanOrEqual(12);
      for (const route of routes) {
        await page.goto(route);
        await expectNoHorizontalOverflow(page, route);
      }

      // Шапка: выход доступен, роль видна.
      await page.goto('/candidate');
      await expect(page.getByRole('button', { name: 'Выйти' })).toBeInViewport();
      // Меню раскрывает все разделы без горизонтальной прокрутки.
      const menu = page.getByRole('button', { name: /Раздел:.*Меню/ });
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await menu.tap();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('link', { name: 'Приватность и ФСП' }).tap();
      await expect(page).toHaveURL(/\/candidate\/settings/);
      await expect(page.getByRole('button', { name: /Раздел:.*Меню/ })).toHaveAttribute('aria-expanded', 'false');
      await expectNoHorizontalOverflow(page, 'после перехода через меню');

      // Диалог отклика помещается на экран.
      await page.goto('/candidate/vacancies');
      await page.getByRole('link').filter({ hasText: /₽/ }).first().tap();
      const apply = page.getByRole('button', { name: 'Откликнуться', exact: true });
      if (await apply.isVisible()) {
        await apply.tap();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
        await page.keyboard.press('Escape');
      }
    });

    test('кандидат: экран прохождения теста (таймер, все форматы заданий) без переполнения', async ({ page }) => {
      // Регистрация нового аккаунта ограничена по IP (10 в час), поэтому экран теста проверяется на одной ширине.
      test.skip(width !== 390, 'экран теста проверяется на ширине 390 px');
      const email = uniqueEmail('cand.mobile');
      const api = await ApiSession.create();
      await api.registerAndVerify(email, 'CANDIDATE');
      await api.fillCandidateProfile();
      const started = await api.ok('post', '/candidate/assessments', { specialization: 'BACKEND', grade: 'MIDDLE' });
      await api.dispose();
      await login(page, email, E2E_PASSWORD);
      await page.goto(`/candidate/assessments/${started.id}`);
      await expect(page.getByRole('button', { name: /Завершить/ })).toBeVisible();
      await expectNoHorizontalOverflow(page, 'тест: начало');
      // Прокрутка до конца: все части заданий (выбор, число, сопоставление, упорядочивание) отрисованы и не выходят за край.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expectNoHorizontalOverflow(page, 'тест: конец страницы');
    });

    test('работодатель: экраны без горизонтального переполнения, формы доступны', async ({ page }) => {
      await login(page, 'hr.fintech@demo.example', DEMO_PASSWORD);
      const [needs, vacancies, tasks, bank, invitations] = await Promise.all([
        getJson(page, '/employer/needs'),
        getJson(page, '/employer/vacancies'),
        getJson(page, '/employer/tasks'),
        getJson(page, '/employer/candidates?pageSize=3'),
        getJson(page, '/employer/invitations?pageSize=3'),
      ]);
      const vacancy = vacancies.find((v: { applicationsCount: number }) => v.applicationsCount > 0) ?? vacancies[0];
      const applications = vacancy ? await getJson(page, `/employer/vacancies/${vacancy.id}/applications?pageSize=3`) : null;
      const task = tasks.find((t: { submittedCount: number }) => t.submittedCount > 0) ?? tasks[0];
      const routes = [
        '/employer',
        '/employer/company',
        '/employer/needs',
        '/employer/needs/new',
        ...(needs[0] ? [`/employer/needs/${needs[0].id}`, `/employer/needs/${needs[0].id}/coverage`] : []),
        '/employer/candidates',
        ...(bank.items?.[0] ? [`/employer/candidates/${bank.items[0].candidateId}`] : []),
        '/employer/bookmarks',
        '/employer/vacancies',
        '/employer/vacancies/new',
        ...(vacancy ? [`/employer/vacancies/${vacancy.id}`] : []),
        ...(applications?.items?.[0] ? [`/employer/applications/${applications.items[0].id}`] : []),
        '/employer/tasks',
        '/employer/tasks/new',
        ...(task ? [`/employer/tasks/${task.id}`] : []),
        '/employer/invitations',
        ...(invitations.items?.[0] ? [`/employer/invitations/${invitations.items[0].id}`] : []),
      ];
      expect(routes.length).toBeGreaterThanOrEqual(16);
      for (const route of routes) {
        await page.goto(route);
        await expectNoHorizontalOverflow(page, route);
      }

      // Форма задания заполняется и сохраняется на телефоне.
      await page.goto('/employer/tasks/new');
      await page.getByLabel('Название').fill(`Мобильный черновик ${Date.now().toString(36)}`);
      await page.getByLabel('Условие').fill('Короткое задание, созданное с телефона для проверки вёрстки форм.');
      await page.getByLabel('Вариант 1', { exact: true }).fill('Первый вариант');
      await page.getByLabel('Вариант 2', { exact: true }).fill('Второй вариант');
      await page.getByRole('button', { name: 'Сохранить черновик' }).tap();
      await expect(page.getByText('Это черновик: кандидаты задание не получают')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'карточка созданного задания');
    });

    test('публичные страницы без горизонтального переполнения', async ({ page }) => {
      for (const route of ['/', '/login', '/register']) {
        await page.goto(route);
        await expectNoHorizontalOverflow(page, route);
      }
    });
  });
}
