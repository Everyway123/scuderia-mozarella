// Критерій приймання M1: у гравця має бути що вирішувати.
// Якщо одностоп завжди на 20 секунд кращий за двостоп — стратегії немає,
// і менеджерська гра перетворюється на перегляд заставки.
//
// Але «завжди конкурентні» — теж неправда: Монако й Сінгапур у житті
// одностопові, і гра має це чесно відображати. Тому перевіряємо розподіл,
// а не кожен окремий етап.

import { describe, expect, it } from 'vitest';
import { DRIVER_BY_ID } from '../src/data/drivers2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { compressTrack } from '../src/sim/raceEngine.ts';
import { planStrategy, planWithStops } from '../src/sim/strategyAI.ts';
import type { RaceLength } from '../src/sim/types.ts';

const driver = DRIVER_BY_ID.get('russell')!;
const LENGTHS: RaceLength[] = [25, 50, 100];

/** Так само, як це робить движок: скорочена гонка = стиснута, а не обрізана. */
function raceTrack(trackId: string, length: RaceLength) {
  const track = TRACK_BY_ID.get(trackId)!;
  const laps = Math.max(5, Math.round((track.laps * length) / 100));
  return { track: compressTrack(track, laps), laps };
}

function spread(trackId: string, length: RaceLength): number {
  const { track, laps } = raceTrack(trackId, length);
  const sorted = [1, 2, 3]
    .map((s) => planWithStops(track, laps, driver, track.pitLoss, s).cost)
    .sort((a, b) => a - b);
  return sorted[1]! - sorted[0]!;
}

function best(trackId: string, length: RaceLength) {
  const { track, laps } = raceTrack(trackId, length);
  return planStrategy(track, laps, driver, track.pitLoss);
}

describe('стратегії конкурентні', () => {
  const all = TRACKS_2026.flatMap((t) => LENGTHS.map((l) => ({ id: t.id, l, s: spread(t.id, l) })));

  it('на більшості етапів дві найкращі стратегії близькі', () => {
    const close = all.filter((x) => x.s < 8).length;
    expect(close / all.length).toBeGreaterThan(0.6);
  });

  it('ніде одна стратегія не домінує абсурдно', () => {
    const worst = all.reduce((a, b) => (a.s > b.s ? a : b));
    expect(worst.s).toBeLessThan(25);
  });

  it('календар дає різні оптимальні стратегії, а не одну на весь сезон', () => {
    const counts = new Set(TRACKS_2026.map((t) => best(t.id, 100).stops));
    expect(counts.size).toBeGreaterThanOrEqual(2);
  });

  it('високий знос штовхає до зайвої зупинки, низький — до одностопу', () => {
    // Катар (знос 1.4) проти Лас-Вегаса (0.75)
    expect(best('lusail', 100).stops).toBeGreaterThan(best('vegas', 100).stops);
  });
});

describe('стиснення гонки зберігає стратегію', () => {
  it('спринт має ту саму гумову історію, що й повна дистанція', () => {
    // Це і є сенс регулятора довжини: 25% — не обрізана гонка, а стиснута.
    // Без цього спринт вироджувався б у «поставив харди й доїхав».
    let same = 0;
    for (const track of TRACKS_2026) {
      if (best(track.id, 25).stops === best(track.id, 100).stops) same++;
    }
    expect(same / TRACKS_2026.length).toBeGreaterThan(0.7);
  });

  it('у спринті все одно треба заїжджати в бокси', () => {
    for (const track of TRACKS_2026) {
      expect(best(track.id, 25).stops).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('планувальник коректний', () => {
  it('план завжди виконує правило двох сумішей і покриває дистанцію', () => {
    for (const track of TRACKS_2026) {
      for (const length of LENGTHS) {
        const { laps } = raceTrack(track.id, length);
        const plan = best(track.id, length);
        expect(new Set(plan.stints.map((s) => s.compound)).size).toBeGreaterThanOrEqual(2);
        expect(plan.stints.reduce((a, s) => a + s.laps, 0)).toBe(laps);
        expect(plan.stints.length).toBe(plan.stops + 1);
      }
    }
  });

  it('пілот, що береже гуму, платить за стратегію менше', () => {
    const track = TRACK_BY_ID.get('barcelona')!;
    const alonso = planStrategy(track, 66, DRIVER_BY_ID.get('alonso')!, track.pitLoss);
    const stroll = planStrategy(track, 66, DRIVER_BY_ID.get('stroll')!, track.pitLoss);
    expect(alonso.cost).toBeLessThan(stroll.cost);
  });
});
