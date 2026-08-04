// Спільні помічники E2E.
//
// Правило: симуляцію не мокаємо. Тести ганяють справжній движок у справжньому
// браузері — саме його поведінку ми й перевіряємо.

import { expect, type Page } from '@playwright/test';

/**
 * Ловить помилки консолі. Сценарій вважається зеленим лише коли тут порожньо —
 * так записано в MVP.md.
 */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export async function openApp(page: Page): Promise<string[]> {
  const errors = watchConsole(page);
  await page.goto('/');
  // Чистимо сховище один раз, а не через addInitScript: той спрацьовує на
  // КОЖНІЙ навігації, зокрема на reload — і сам же стирає збереження,
  // яке сценарій E4 щойно пішов перевіряти.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-test="menu"]')).toBeVisible();
  return errors;
}

/** Обрати команду в меню. */
export async function pickTeam(page: Page, teamId: string): Promise<void> {
  await page.selectOption('[data-test="team-select"]', teamId);
}

export async function pickLength(page: Page, len: 25 | 50 | 100): Promise<void> {
  await page.click(`#lenSeg button[data-len="${len}"]`);
}

/** Меню → сезон → штаб → квала → старт гонки. */
export async function startSeasonRace(page: Page, teamId = 'haas'): Promise<void> {
  await pickTeam(page, teamId);
  await pickLength(page, 25);
  await page.click('[data-test="new-season"]');
  await expect(page.locator('[data-test="hub"]')).toBeVisible();
  await goFromHubToRace(page);
}

/** Штаб → квала → гонка. Квала — окремий екран, де можна перерішити ставку. */
export async function goFromHubToRace(page: Page): Promise<void> {
  await page.click('[data-test="start-race"]');
  await expect(page.locator('[data-test="quali"]')).toBeVisible();
  await page.click('[data-test="to-race"]');
  await expect(page.locator('#trackCanvas')).toBeVisible();
}

/** Читає внутрішній стан гонки — так тест перевіряє движок, а не текст на екрані. */
export async function raceState(page: Page) {
  return page.evaluate(() => {
    const view = window.__race?.();
    if (!view) return null;
    const s = view.race.state;
    return {
      lap: s.lap,
      totalLaps: s.totalLaps,
      finished: s.finished,
      flag: s.flag,
      weather: s.weather,
      promptCount: view.promptCount,
      players: view.race.playerCars().map((c) => ({
        driverId: c.driverId,
        paceMode: c.paceMode,
        energyMode: c.energyMode,
        pitRequest: c.pitRequest,
        autoStrategy: c.autoStrategy,
        stops: c.stops,
        compound: c.tyre.compound,
        position: c.position,
        status: c.status,
      })),
      classification: s.finished
        ? view.race.classification().map((c) => ({
            pos: c.position,
            driver: c.driver.id,
            team: c.team.id,
            points: c.points,
            status: c.status,
            totalTime: Number(c.totalTime.toFixed(4)),
          }))
        : null,
    };
  });
}

/** Дограти гонку до кінця й дочекатись таблиці результатів. */
export async function finishRace(page: Page): Promise<void> {
  // Якщо саме зараз висить запит рішення — відповідаємо, інакше кнопка перекрита
  await dismissPromptIfAny(page);
  await page.click('#skipBtn');
  await expect(page.locator('[data-test="results"]')).toBeVisible({ timeout: 30_000 });
}

export async function dismissPromptIfAny(page: Page): Promise<boolean> {
  const prompt = page.locator('.prompt.on');
  if (!(await prompt.isVisible().catch(() => false))) return false;
  await prompt.locator('button').last().click();
  return true;
}

/**
 * Чекає на запит із конкретним заголовком, відповідаючи «останньою кнопкою»
 * на всі інші. Потрібно, бо порядок подій у гонці визначає симуляція,
 * а не тест: до сейфті-кара цілком може прийти інший момент рішення.
 */
export async function waitForPrompt(
  page: Page,
  kind: 'sc' | 'rain' | 'cliff' | 'override',
  maxSeconds = 60,
): Promise<boolean> {
  const deadline = Date.now() + maxSeconds * 1000;
  const prompt = page.locator('.prompt.on');
  while (Date.now() < deadline) {
    if (await page.locator('[data-test="results"]').isVisible().catch(() => false)) return false;
    if (await prompt.isVisible().catch(() => false)) {
      if ((await prompt.getAttribute('data-kind')) === kind) return true;
      await prompt.locator('button').last().click();
      continue;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Прокрутити гонку, відповідаючи на запити за правилом: на запит із заданим
 * заголовком — обрана кнопка, на решту — завжди остання. Так два прогони
 * різняться рівно одним рішенням, і різницю можна приписати саме йому.
 */
export async function playAnswering(
  page: Page,
  rule: { kind: string; use: 'first' | 'last' },
  maxSeconds = 100,
): Promise<void> {
  const deadline = Date.now() + maxSeconds * 1000;
  const prompt = page.locator('.prompt.on');
  await page.click('#speedBtn');
  await page.click('#speedBtn');
  await page.click('#speedBtn');

  while (Date.now() < deadline) {
    if (await page.locator('[data-test="results"]').isVisible().catch(() => false)) return;
    if (await prompt.isVisible().catch(() => false)) {
      const kind = await prompt.getAttribute('data-kind');
      const btns = prompt.locator('button');
      const useFirst = kind === rule.kind && rule.use === 'first';
      await (useFirst ? btns.first() : btns.last()).click();
      continue;
    }
    await page.waitForTimeout(200);
  }
}

/** Крутити гонку, відповідаючи на всі запити, поки не дійде до кінця. */
export async function playThrough(
  page: Page,
  opts: { answerWith?: 'first' | 'last'; maxSeconds?: number } = {},
): Promise<number> {
  const answer = opts.answerWith ?? 'last';
  const deadline = Date.now() + (opts.maxSeconds ?? 90) * 1000;
  let answered = 0;

  await page.click('#speedBtn');
  await page.click('#speedBtn');
  await page.click('#speedBtn'); // 8×

  while (Date.now() < deadline) {
    if (await page.locator('[data-test="results"]').isVisible().catch(() => false)) break;
    const prompt = page.locator('.prompt.on');
    if (await prompt.isVisible().catch(() => false)) {
      const btns = prompt.locator('button');
      await (answer === 'first' ? btns.first() : btns.last()).click();
      answered++;
      continue;
    }
    await page.waitForTimeout(250);
  }
  return answered;
}

// ---------------------------------------------------------------------------
// Пошук seed для сценаріїв.
//
// Прив'язка до конкретного числа ламалась ЧОТИРИ рази поспіль: будь-яка зміна
// калібрування зсуває потік RNG, і подія переїжджає на інше коло. Тому тест
// тепер сам знаходить собі seed тим самим движком, яким грає застосунок.
// ---------------------------------------------------------------------------

import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { gridFromQuali, runQualifying } from '../src/sim/qualifying.ts';
import { Race } from '../src/sim/raceEngine.ts';
import { Rng } from '../src/sim/rng.ts';

/** Прогін гонки рівно так, як це робить екран швидкої гонки. */
function probe(trackId: string, seed: number, teamId: string) {
  const track = TRACK_BY_ID.get(trackId)!;
  const teamMap = new Map(TEAMS_2026.map((t) => [t.id, t]));
  const quali = runQualifying(track, DRIVERS_2026, teamMap, new Rng(seed ^ 0x51ed));
  const race = new Race({
    track,
    drivers: DRIVERS_2026,
    teams: TEAMS_2026,
    length: 25,
    seed,
    grid: gridFromQuali(quali),
    playerTeamId: teamId,
  });
  race.runToEnd();
  return race.state.events;
}

/** Перші кілька seed, на яких потрібна подія трапляється рано. */
export function seedsWithEvent(
  trackId: string,
  kind: 'safety-car' | 'weather',
  maxLap: number,
  want = 3,
  teamId = 'haas',
): number[] {
  const found: number[] = [];
  for (let seed = 1; seed <= 200 && found.length < want; seed++) {
    const first = probe(trackId, seed, teamId).find((e) => e.kind === kind);
    if (first && first.lap <= maxLap) found.push(seed);
  }
  return found;
}
