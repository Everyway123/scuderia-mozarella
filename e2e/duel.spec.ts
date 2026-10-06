// Онлайн-дуелі: посилання-виклик відтворює гонку, фініш показує вердикт.

import { expect, test } from '@playwright/test';
import { finishRace, openApp, pickLength, pickTeam, watchConsole } from './helpers.ts';

/** Той самий формат, що в src/online/duel.ts: base64url від JSON. */
function duelPayload(result: { points: number; bestPos: number; time: number }): string {
  const ch = {
    v: 1,
    trackId: 'monza',
    length: 25,
    seed: 777,
    teamId: 'haas',
    name: 'Тестер',
    result,
  };
  return Buffer.from(JSON.stringify(ch), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

test('E16: дуель за посиланням — прийняти, зіграти, побачити вердикт', async ({ page }) => {
  const errors = watchConsole(page);
  // Суперник із недосяжним результатом — вердикт детермінований: програш
  await page.goto(`/#duel=${duelPayload({ points: 44, bestPos: 1, time: 1 })}`);
  await expect(page.locator('[data-test="duel-accept"]')).toBeVisible();
  await expect(page.locator('[data-test="duel-accept"]')).toContainText('Тестер');

  await page.click('[data-test="duel-go"]');
  await expect(page.locator('#trackCanvas')).toBeVisible();
  await finishRace(page);

  const verdict = page.locator('[data-test="duel-verdict"]');
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Дуель програно');
  // Відповісти на виклик теж можна
  await expect(page.locator('[data-test="duel-challenge"]')).toContainText('відповідь');

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E17: зіпсоване посилання-виклик не ламає гру', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/#duel=%%%сміття%%%');
  await expect(page.locator('[data-test="menu"]')).toBeVisible();
  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E18: гонка тижня стартує з меню, після фінішу можна кинути виклик', async ({ page }) => {
  const errors = await openApp(page);
  await pickTeam(page, 'williams');
  await pickLength(page, 25);
  await page.click('[data-test="weekly"]');
  await expect(page.locator('#trackCanvas')).toBeVisible();
  await finishRace(page);

  await expect(page.locator('[data-test="duel-challenge"]')).toBeVisible();
  await page.fill('#duelName', 'Андрій');
  // Кнопка не повинна падати навіть без clipboard-дозволів
  await page.click('[data-test="duel-challenge"]');

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});
