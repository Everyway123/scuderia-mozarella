// E1, E2, E6, E7 із MVP.md — наскрізний шлях, важелі пітволу, детермінізм,
// керування переглядом.

import { expect, test } from '@playwright/test';
import {
  dismissPromptIfAny,
  finishRace,
  openApp,
  pickLength,
  pickTeam,
  playThrough,
  raceState,
  startSeasonRace,
} from './helpers.ts';

test('E1: меню → сезон → гонка → класифікація', async ({ page }) => {
  const errors = await openApp(page);

  await startSeasonRace(page, 'haas');

  // Гонка справді йде: мапа, вежа й пітвол на місці
  await expect(page.locator('#tower .tt-row')).toHaveCount(22);
  await expect(page.locator('#pitwall .pw-card')).toHaveCount(2);

  await finishRace(page);

  const rows = page.locator('[data-test="results"] tbody tr');
  await expect(rows).toHaveCount(22);
  await expect(page.locator('[data-test="results-summary"]')).toBeVisible();

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E2: важелі пітволу доходять до симуляції', async ({ page }) => {
  const errors = await openApp(page);
  await startSeasonRace(page, 'haas');
  await page.click('#playBtn'); // пауза, щоб нічого не змінилось під руками

  const card = page.locator('#pitwall .pw-card').first();
  const driverId = await card.getAttribute('data-driver');
  expect(driverId).toBeTruthy();

  // Темп
  await card.locator('[data-pace="5"]').click();
  let s = await raceState(page);
  expect(s!.players.find((p) => p.driverId === driverId)!.paceMode).toBe(5);

  await card.locator('[data-pace="1"]').click();
  s = await raceState(page);
  expect(s!.players.find((p) => p.driverId === driverId)!.paceMode).toBe(1);

  // Енергія
  await card.locator('[data-energy="deploy"]').click();
  s = await raceState(page);
  expect(s!.players.find((p) => p.driverId === driverId)!.energyMode).toBe('deploy');

  // Піт-стоп: клік ставить наказ, повторний скасовує
  await card.locator('[data-pit="hard"]').click();
  s = await raceState(page);
  expect(s!.players.find((p) => p.driverId === driverId)!.pitRequest).toBe('hard');

  await card.locator('[data-pit="hard"]').click();
  s = await raceState(page);
  expect(s!.players.find((p) => p.driverId === driverId)!.pitRequest).toBeNull();

  // Ручна стратегія
  await card.locator('[data-f="auto"]').click();
  s = await raceState(page);
  expect(s!.players.find((p) => p.driverId === driverId)!.autoStrategy).toBe(false);

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E2b: наказ у бокси справді призводить до заїзду', async ({ page }) => {
  const errors = await openApp(page);
  await startSeasonRace(page, 'haas');

  const card = page.locator('#pitwall .pw-card').first();
  const driverId = (await card.getAttribute('data-driver'))!;
  const before = await raceState(page);
  const stopsBefore = before!.players.find((p) => p.driverId === driverId)!.stops;

  await card.locator('[data-pit="hard"]').click();
  await playThrough(page, { maxSeconds: 70 });

  const after = await raceState(page);
  const car = after!.players.find((p) => p.driverId === driverId)!;
  expect(car.stops).toBeGreaterThan(stopsBefore);

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E6: той самий seed через UI дає той самий результат', async ({ page }) => {
  const run = async () => {
    await openApp(page);
    await pickTeam(page, 'haas');
    await pickLength(page, 25);
    await page.click('[data-test="quick-race"]');
    await page.selectOption('[data-test="track-select"]', 'monza');
    await page.fill('[data-test="seed-input"]', '777');
    await page.click('[data-test="go"]');
    await expect(page.locator('#trackCanvas')).toBeVisible();
    await finishRace(page);
    const s = await raceState(page);
    await page.click('[data-test="results-next"]');
    return s!.classification!.map((c) => `${c.pos}:${c.driver}:${c.totalTime}`).join('|');
  };

  const a = await run();
  const b = await run();
  expect(a).toBe(b);
  expect(a.length).toBeGreaterThan(50);
});

test('E7: прискорення й «до фінішу» не ламають стан', async ({ page }) => {
  const errors = await openApp(page);
  await startSeasonRace(page, 'mclaren');

  const speed = page.locator('#speedBtn');
  await expect(speed).toHaveText('1×');
  await speed.click();
  await expect(speed).toHaveText('2×');
  await speed.click();
  await expect(speed).toHaveText('4×');
  await speed.click();
  await expect(speed).toHaveText('8×');
  await speed.click();
  await expect(speed).toHaveText('1×');

  // Пауза й відновлення. Момент рішення теж ставить гру на паузу, тому
  // спершу прибираємо запит, якщо він саме висить.
  const play = page.locator('#playBtn');
  await dismissPromptIfAny(page);
  await expect(play).toHaveText('⏸');
  await play.click();
  await expect(play).toHaveText('▶');
  await play.click();
  await expect(play).toHaveText('⏸');

  await dismissPromptIfAny(page);
  await page.click('#skipBtn');
  await expect(page.locator('[data-test="results"]')).toBeVisible();

  const s = await raceState(page);
  expect(s!.finished).toBe(true);
  expect(s!.lap).toBe(s!.totalLaps);
  // Усі 22 машини мають підсумковий рядок, і жодна не «зависла» на пів колі
  expect(s!.classification!.length).toBe(22);

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});
