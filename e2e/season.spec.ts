// E4 — сезон і збереження. Найважливіший сценарій продукту: без нього гра
// розсипається на окремі гонки.

import { expect, test } from '@playwright/test';
import { finishRace, openApp, pickLength, pickTeam, playThrough } from './helpers.ts';

test('E4: гонка → залік оновився → перезавантаження → залік на місці', async ({ page }) => {
  const errors = await openApp(page);

  await pickTeam(page, 'williams');
  await pickLength(page, 25);
  await page.click('[data-test="new-season"]');
  await expect(page.locator('[data-test="hub"]')).toBeVisible();
  await expect(page.locator('[data-test="hub"] h3').first()).toContainText('Етап 1 з 24');

  // До гонки залік порожній
  const zeroSum = await page
    .locator('[data-test="team-standings"] b')
    .allTextContents()
    .then((v) => v.reduce((a, b) => a + Number(b), 0));
  expect(zeroSum).toBe(0);

  await page.click('[data-test="start-race"]');
  await playThrough(page, { maxSeconds: 90 });
  await expect(page.locator('[data-test="results"]')).toBeVisible();
  await page.click('[data-test="results-next"]');

  // Після гонки: етап 2, очки нараховані
  await expect(page.locator('[data-test="hub"] h3').first()).toContainText('Етап 2 з 24');
  const afterSum = await page
    .locator('[data-test="team-standings"] b')
    .allTextContents()
    .then((v) => v.reduce((a, b) => a + Number(b), 0));
  // 25+18+15+12+10+8+6+4+2+1 = 101, плюс до 1 очка за швидке коло
  expect(afterSum).toBeGreaterThanOrEqual(101);

  const standingsBefore = await page.locator('[data-test="team-standings"]').textContent();
  const rpBefore = await page.locator('[data-test="rp"]').textContent();

  // Перезавантаження: прогрес мусить пережити
  await page.reload();
  await expect(page.locator('[data-test="menu"]')).toBeVisible();
  await page.click('[data-test="continue"]');
  await expect(page.locator('[data-test="hub"]')).toBeVisible();
  await expect(page.locator('[data-test="hub"] h3').first()).toContainText('Етап 2 з 24');
  expect(await page.locator('[data-test="team-standings"]').textContent()).toBe(standingsBefore);
  expect(await page.locator('[data-test="rp"]').textContent()).toBe(rpBefore);

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E4b: розробка боліда витрачає RP і зберігається', async ({ page }) => {
  const errors = await openApp(page);
  await pickTeam(page, 'audi');
  await pickLength(page, 25);
  await page.click('[data-test="new-season"]');

  const rpText = async () => Number((await page.locator('[data-test="rp"]').textContent())!.split(' ')[0]);
  const start = await rpText();
  expect(start).toBeGreaterThan(0);

  await page.click('[data-test="dev-aero"]');
  const spent = await rpText();
  expect(spent).toBeLessThan(start);
  await expect(page.locator('.dev-pips i.on')).toHaveCount(1);

  await page.reload();
  await page.click('[data-test="continue"]');
  expect(await rpText()).toBe(spent);
  await expect(page.locator('.dev-pips i.on')).toHaveCount(1);

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E4c: три етапи поспіль без падіння', async ({ page }) => {
  const errors = await openApp(page);
  await pickTeam(page, 'ferrari');
  await pickLength(page, 25);
  await page.click('[data-test="new-season"]');

  for (let round = 1; round <= 3; round++) {
    await expect(page.locator('[data-test="hub"] h3').first()).toContainText(`Етап ${round} з 24`);
    await page.click('[data-test="start-race"]');
    await playThrough(page, { maxSeconds: 90 });
    await expect(page.locator('[data-test="results"]')).toBeVisible();
    await page.click('[data-test="results-next"]');
  }
  await expect(page.locator('[data-test="hub"] h3').first()).toContainText('Етап 4 з 24');

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E1b: швидка гонка не чіпає збереження сезону', async ({ page }) => {
  await openApp(page);
  await pickTeam(page, 'alpine');
  await pickLength(page, 25);
  await page.click('[data-test="new-season"]');
  await expect(page.locator('[data-test="hub"]')).toBeVisible();
  await page.click('[data-test="to-menu"]');

  await page.click('[data-test="quick-race"]');
  await page.click('[data-test="go"]');
  await expect(page.locator('#trackCanvas')).toBeVisible();
  await finishRace(page);
  await page.click('[data-test="results-next"]');

  await expect(page.locator('[data-test="continue"]')).toContainText('етап 1/24');
});
