// E5 — телефон. Гра має бути придатною до гри з телефона, а не «якось відкриватись».

import { expect, test } from '@playwright/test';
import { openApp, playThrough } from './helpers.ts';

test('E5: на телефоні немає горизонтального скролу і керування досяжне', async ({ page }) => {
  const errors = await openApp(page);

  const noOverflow = async (where: string) => {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(over, `горизонтальний скрол: ${where}`).toBe(false);
  };

  await noOverflow('меню');

  await page.selectOption('[data-test="team-select"]', 'haas');
  await page.click('#lenSeg button[data-len="25"]');
  await page.click('[data-test="new-season"]');
  await expect(page.locator('[data-test="hub"]')).toBeVisible();
  await noOverflow('штаб');

  await page.click('[data-test="start-race"]');
  await expect(page.locator('#trackCanvas')).toBeVisible();
  await noOverflow('гонка');

  // Пітвол на телефоні має бути і видимим, і клікабельним
  const card = page.locator('#pitwall .pw-card').first();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await card.locator('[data-pace="2"]').click();
  await expect(card.locator('[data-pace="2"]')).toHaveClass(/on/);

  // Мапа не схлопнулась у нуль
  const box = await page.locator('#trackCanvas').boundingBox();
  expect(box!.height).toBeGreaterThan(200);
  expect(box!.width).toBeGreaterThan(280);

  await playThrough(page, { maxSeconds: 90 });
  await expect(page.locator('[data-test="results"]')).toBeVisible();
  await noOverflow('результати');

  expect(errors, `помилки консолі: ${errors.join(' | ')}`).toEqual([]);
});
