import { expect, type Locator, type Page } from '@playwright/test';
import { activeAttemptItems, labelOf, type AttemptItem, type PartKey, type PublicPart } from './db';

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/(candidate|employer)/);
}

export async function logout(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** Заполняет одну часть задания в интерфейсе по ключу из БД. Условие и варианты берутся из публичного снимка. */
async function answerPart(fieldset: Locator, part: PublicPart, key: PartKey): Promise<void> {
  switch (part.format) {
    case 'SINGLE_CHOICE': {
      if (key.format !== 'SINGLE_CHOICE') throw new Error('несоответствие ключа');
      await fieldset.getByLabel(labelOf(part.options, key.correctOptionId), { exact: true }).check();
      break;
    }
    case 'MULTI_SELECT': {
      if (key.format !== 'MULTI_SELECT') throw new Error('несоответствие ключа');
      for (const id of key.correctOptionIds) await fieldset.getByLabel(labelOf(part.options, id), { exact: true }).check();
      break;
    }
    case 'NUMERIC': {
      if (key.format !== 'NUMERIC') throw new Error('несоответствие ключа');
      await fieldset.getByRole('textbox').fill(String(key.correctValue));
      break;
    }
    case 'MATCHING': {
      if (key.format !== 'MATCHING') throw new Error('несоответствие ключа');
      for (const [leftId, rightId] of Object.entries(key.correctPairs)) {
        await fieldset.getByLabel(labelOf(part.left, leftId), { exact: true }).selectOption({ label: labelOf(part.right, rightId) });
      }
      break;
    }
    case 'ORDERING': {
      if (key.format !== 'ORDERING') throw new Error('несоответствие ключа');
      const wanted = key.correctOrder.map((id) => labelOf(part.items, id));
      for (let target = 0; target < wanted.length; target += 1) {
        // Текущее положение элемента в списке; поднимаем его кнопкой «выше», пока не встанет на свою позицию.
        for (let guard = 0; guard < wanted.length; guard += 1) {
          const labels = await fieldset.locator('ol li > span:nth-child(2)').allTextContents();
          const current = labels.indexOf(wanted[target]);
          if (current <= target) break;
          await fieldset.getByRole('button', { name: `Переместить «${wanted[target]}» выше`, exact: true }).click();
        }
      }
      const commit = fieldset.getByRole('button', { name: 'Зафиксировать текущий порядок как ответ' });
      if (await commit.isVisible()) await commit.click();
      await expect(fieldset.getByText('Порядок сохранён как ответ.')).toBeVisible();
      break;
    }
  }
}

/**
 * Проходит открытую попытку в интерфейсе: «правильно» — ответы по ключам из БД; «пусто» — без ответов.
 * Затем завершает тест через диалог подтверждения. simulateTabSwitches — сколько раз «уйти» со вкладки теста перед завершением
 * (подмена document.visibilityState и событие visibilitychange, как при переключении вкладки в браузере).
 */
export async function takeAssessmentInUi(page: Page, email: string, mode: 'correct' | 'empty', options: { simulateTabSwitches?: number } = {}): Promise<AttemptItem[]> {
  await expect(page.getByRole('timer', { name: 'Оставшееся время' })).toBeVisible();
  const { items } = await activeAttemptItems(email);
  if (mode === 'correct') {
    for (const [index, item] of items.entries()) {
      await page.getByRole('navigation', { name: 'Кейсы теста' }).getByRole('button', { name: new RegExp(`Кейс ${index + 1}`) }).click();
      await expect(page.getByText(`Кейс ${index + 1} из ${items.length}`)).toBeVisible();
      const fieldsets = page.locator('article fieldset');
      await expect(fieldsets).toHaveCount(item.parts.length);
      for (const [partIndex, part] of item.parts.entries()) await answerPart(fieldsets.nth(partIndex), part, item.keys[partIndex]);
    }
    // Все части отмечены как отвеченные; автосохранение успевает отработать до завершения.
    const total = items.reduce((sum, item) => sum + item.parts.length, 0);
    await expect(page.getByText(`из ${total}`).first()).toBeVisible();
    await expect(page.getByText('Ответы сохранены')).toBeVisible({ timeout: 30_000 });
  }
  if (options.simulateTabSwitches) {
    await page.evaluate(async (times) => {
      const setVisibility = (state: 'hidden' | 'visible') => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
        document.dispatchEvent(new Event('visibilitychange'));
      };
      for (let i = 0; i < times; i += 1) {
        setVisibility('hidden');
        await new Promise((resolve) => setTimeout(resolve, 150));
        setVisibility('visible');
      }
    }, options.simulateTabSwitches);
  }
  await page.getByRole('button', { name: 'Завершить тест' }).click();
  await page.getByRole('button', { name: 'Завершить и получить результат' }).click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 60_000 });
  return items;
}
