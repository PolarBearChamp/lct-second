import { expect, test } from '@playwright/test';
import { ApiSession } from '../helpers/api';
import { candidateProfileId } from '../helpers/db';
import { DEMO_PASSWORD, uniqueEmail } from '../helpers/env';
import { login } from '../helpers/ui';

/**
 * Сценарий 5 (сторона работодателя). Кандидат без ФСП ID участвует в подборе наравне с остальными: карточка и
 * объяснение честно сообщают, что достижений нет, но это не снижает доступ к выдаче; зарплатный фильтр и
 * обязательные навыки при этом продолжают работать.
 */
test('кандидат без ФСП попадает в подборку и получает честное объяснение', async ({ page }) => {
  const email = uniqueEmail('cand.nofsp');
  const candidate = await ApiSession.create();
  await candidate.registerAndVerify(email, 'CANDIDATE');
  await candidate.fillCandidateProfile({ salaryFrom: 260_000, salaryTo: 300_000 });
  expect((await candidate.takeAssessment(email, 'BACKEND', 'MIDDLE')).status).toBe('PASSED');
  await candidate.publishProfile();
  expect((await candidate.ok('get', '/candidate/fsp-link')).state).toBe('NOT_LINKED');
  await candidate.dispose();
  const candidateId = await candidateProfileId(email);

  // Потребность создаётся через API (интерфейс создания проверен в сценарии 2), дальше — интерфейс.
  const employer = await ApiSession.create();
  await employer.login('hr.retail@demo.example', DEMO_PASSWORD);
  const need = await employer.ok('post', '/employer/needs', {
    title: 'Backend для ритейл-платформы (e2e)',
    description: 'Сервисы заказов и склада, PostgreSQL, удалённая команда.',
    specialization: 'BACKEND',
    allowedGrades: ['MIDDLE'],
    requiredSkills: ['sql', 'postgresql'],
    preferredSkills: [{ skill: 'kafka', mode: 'SELF_REPORTED_ALLOWED' }],
    workFormat: 'REMOTE',
    city: null,
    salaryFrom: 250_000,
    salaryTo: 320_000,
    salaryType: 'GROSS',
  });
  await employer.dispose();

  await login(page, 'hr.retail@demo.example', DEMO_PASSWORD);
  await page.goto(`/employer/candidates/${candidateId}?needId=${need.id}`);
  await expect(page.getByRole('heading', { level: 1, name: /^Кандидат [0-9A-F]{4,6}$/ })).toBeVisible();

  // Объяснение: обязательные условия пройдены, ФСП отсутствует и это не названо недостатком доступа.
  await expect(page.getByText('Почему подходит')).toBeVisible();
  await expect(page.getByText(/Подтверждены тестом все обязательные навыки: .*SQL/)).toBeVisible();
  await expect(page.getByText('Нет релевантных достижений ФСП (это не снижает доступ к подборке)')).toBeVisible();
  await expect(page.getByText('Достижения ФСП не привязаны. Это не влияет на доступ к подбору.')).toBeVisible();
  await expect(page.getByText(/Ожидания 260\s?000.*300\s?000/)).toBeVisible();

  // Подборка по этой потребности содержит кандидата без ФСП.
  await page.goto(`/employer/needs/${need.id}`);
  await page.getByRole('button', { name: 'Построить подборку' }).click();
  await expect(page.getByRole('heading', { name: 'Подборка кандидатов' })).toBeVisible();
  const links = page.locator(`a[href^="/employer/candidates/${candidateId}"]`);
  await expect(links.first()).toBeVisible();
});
