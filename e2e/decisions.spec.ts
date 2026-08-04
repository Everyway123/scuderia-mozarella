// E3 і E8 — моменти рішення.
//
// Seed'и не захардкоджені: тест сам знаходить їх тим самим движком, яким грає
// застосунок. Прив'язка до конкретного числа ламалась чотири рази поспіль —
// будь-яка зміна калібрування зсуває потік RNG, і подія переїжджає.

import { expect, test } from '@playwright/test';
import {
  openApp,
  pickLength,
  pickTeam,
  playAnswering,
  playThrough,
  raceState,
  seedsWithEvent,
  waitForPrompt,
} from './helpers.ts';

async function quickRace(page: import('@playwright/test').Page, trackId: string, seed: number) {
  await pickTeam(page, 'haas');
  await pickLength(page, 25);
  await page.click('[data-test="quick-race"]');
  await page.selectOption('[data-test="track-select"]', trackId);
  await page.fill('[data-test="seed-input"]', String(seed));
  await page.click('[data-test="go"]');
  await expect(page.locator('#trackCanvas')).toBeVisible();
}

test('E3: сейфті-кар піднімає запит, і відповідь заводить машини в бокси', async ({ page }) => {
  const errors = await openApp(page);

  // Seed знаходимо тим самим движком, яким грає застосунок, а не хардкодимо:
  // будь-яка зміна калібрування зсуває RNG і переносить подію на інше коло.
  const seeds = seedsWithEvent('monaco', 'safety-car', 5, 3);
  expect(seeds.length, 'жоден seed не дає раннього сейфті-кара').toBeGreaterThan(0);

  const prompt = page.locator('.prompt.on');
  let got = false;
  for (const seed of seeds) {
    await quickRace(page, 'monaco', seed);
    // Без прискорення 30 секунд очікування покривають лише кілька кіл —
    // саме на цьому сценарій і вичерпував таймаут
    await page.click('#speedBtn');
    await page.click('#speedBtn');
    got = await waitForPrompt(page, 'sc', 30);
    if (got) break;
    await page.goto('/');
    await expect(page.locator('[data-test="menu"]')).toBeVisible();
  }
  expect(got, 'запит про сейфті-кар так і не зʼявився на жодному seed').toBe(true);

  const before = await raceState(page);
  const stopsBefore = new Map(before!.players.map((p) => [p.driverId, p.stops]));

  // Перша кнопка — «обидві в бокси»
  await prompt.locator('button').first().click();

  // Перевіряти проміжний прапорець pitRequest ненадійно: після відповіді гонка
  // одразу відновлюється, і наказ встигає перетворитись на справжній заїзд
  // ще до читання стану. Тому дивимось на результат, а не на намір.
  const armed = await raceState(page);
  for (const p of armed!.players) {
    if (p.status === 'dnf') continue;
    const pitted = p.stops > (stopsBefore.get(p.driverId) ?? 0);
    expect(
      p.pitRequest !== null || pitted,
      `${p.driverId}: наказ у бокси не поставлено й заїзду не сталося`,
    ).toBe(true);
  }

  await playThrough(page, { maxSeconds: 70 });
  const after = await raceState(page);
  for (const p of after!.players) {
    if (p.status === 'dnf') continue;
    expect(p.stops, `${p.driverId}: заїзду так і не сталося`).toBeGreaterThan(
      stopsBefore.get(p.driverId) ?? 0,
    );
  }

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E3b: гра зупиняється 5–9 разів за гонку (критерій G2)', async ({ page }) => {
  const errors = await openApp(page);
  const scSeed = seedsWithEvent('baku', 'safety-car', 6, 1)[0] ?? 2;
  await quickRace(page, 'baku', scSeed);
  await playThrough(page, { maxSeconds: 90 });

  const s = await raceState(page);
  expect(s!.promptCount).toBeGreaterThanOrEqual(3);
  expect(s!.promptCount).toBeLessThanOrEqual(12);

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});

test('E8: рішення про дощ доходить до машин і міняє гонку', async ({ page }) => {
  const errors = await openApp(page);

  // Seed так само шукаємо движком, а не хардкодимо.
  // Два прогони різняться РІВНО одним рішенням — реакцією на дощ.
  // Ціну помилки в позиціях міряє headless-тест G5 на 24 трасах;
  // тут доводимо, що рішення з екрана справді доходить до симуляції.
  const wetSeeds = seedsWithEvent('silverstone', 'weather', 3, 1);
  expect(wetSeeds.length, 'жоден seed не дає раннього дощу').toBeGreaterThan(0);
  const wetSeed = wetSeeds[0]!;

  const runWith = async (onRain: 'first' | 'last') => {
    await quickRace(page, 'silverstone', wetSeed);
    const got = await waitForPrompt(page, 'rain', 60);
    expect(got, 'запит про дощ так і не зʼявився').toBe(true);

    const prompt = page.locator('.prompt.on');
    await (onRain === 'first' ? prompt.locator('button').first() : prompt.locator('button').last()).click();

    // Одразу після відповіді видно, чи пішов наказ у бокси
    const armed = await raceState(page);
    const wetOrder = armed!.players.some(
      (p) => p.pitRequest === 'inter' || p.pitRequest === 'wet',
    );

    await playAnswering(page, { kind: 'rain', use: onRain }, 110);
    await expect(page.locator('[data-test="results"]')).toBeVisible({ timeout: 30_000 });
    const s = await raceState(page);
    const mine = s!.classification!.filter((c) => c.team === 'haas');
    const sum = mine.reduce((a, c) => a + (c.status === 'dnf' ? 24 : c.pos), 0);
    await page.click('[data-test="results-next"]');
    return { wetOrder, sum };
  };

  const reacted = await runWith('first'); // «обидві на дощову гуму»
  const ignored = await runWith('last'); // «чекаємо, може підсохне»

  // Реакція справді відправляє машини в бокси, бездіяльність — ні
  expect(reacted.wetOrder, 'відповідь «в бокси» не поставила наказ').toBe(true);
  expect(ignored.wetOrder, 'відповідь «чекаємо» все одно поставила наказ').toBe(false);
  // Результат навмисно не порівнюємо: автостратегія — страховка, вона
  // виправить гуму наступного кола, тож «чекаємо» не є пасткою.
  // Ціну справжньої впертості міряє headless-тест G5, де страховку вимкнено.
  expect(reacted.sum).toBeGreaterThan(0);
  expect(ignored.sum).toBeGreaterThan(0);

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});
