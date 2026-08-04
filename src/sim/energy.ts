// Гібрид 2026 — третій ресурс поруч із гумою й паливом.
// MGU-K 350 кВт, рекуперація ~8.5 МДж за коло, Override замість DRS.
// На відміну від гуми, енергія відновлювана — але повільно, і саме це створює
// постійний вибір: спалити овертейк зараз чи зберегти на фінал.

import {
  BATTERY_MAX,
  ENERGY_SPEND,
  ENERGY_TIME,
  FLAT_BATTERY_PENALTY,
  OVERRIDE_COST,
  OVERRIDE_GAIN,
  OVERRIDE_WINDOW,
} from './constants.ts';
import type { CarState, EnergyMode, Track } from './types.ts';

export interface EnergyResult {
  /** Дельта часу кола, с (мінус = швидше). */
  timeDelta: number;
  /** Новий заряд, МДж. */
  battery: number;
  /** Чи спрацював Override на цьому колі. */
  overrideUsed: boolean;
  /** Чи сів акумулятор — привід для радіо. */
  flat: boolean;
}

/**
 * Рекуперація за коло. Траса з довгими гальмуваннями (Монреаль, Баку)
 * заряджає краще, ніж швидкі кільця (Монца, Спа).
 */
function harvest(track: Track, mode: EnergyMode): number {
  const modeBonus = mode === 'recover' ? 1.45 : mode === 'balance' ? 1.0 : 0.75;
  // 8.5 МДж рекуперації за коло, але в накопичувач за раз влазить лише частина
  return (track.harvestMJ / 8.5) * 1.15 * modeBonus;
}

export function stepEnergy(car: CarState, track: Track, gapAhead: number): EnergyResult {
  let battery = car.energyMJ;
  let timeDelta = ENERGY_TIME[car.energyMode];
  let overrideUsed = false;

  const wantsOverride =
    car.overrideArmed &&
    car.overrideLeft > 0 &&
    gapAhead <= OVERRIDE_WINDOW &&
    battery >= OVERRIDE_COST;

  if (wantsOverride) {
    battery -= OVERRIDE_COST;
    timeDelta -= OVERRIDE_GAIN;
    overrideUsed = true;
  }

  battery += harvest(track, car.energyMode) - ENERGY_SPEND[car.energyMode];

  let flat = false;
  if (battery < 0) {
    // Немає заряду — немає темпу. Ця помилка має відчуватись боляче.
    timeDelta += FLAT_BATTERY_PENALTY;
    battery = 0;
    flat = true;
  }
  battery = Math.min(BATTERY_MAX, battery);

  return { timeDelta, battery, overrideUsed, flat };
}

/** Чи можна зараз тиснути кнопку — для підсвітки в UI. */
export function canOverride(car: CarState, gapAhead: number): boolean {
  return (
    car.overrideLeft > 0 && gapAhead <= OVERRIDE_WINDOW && car.energyMJ >= OVERRIDE_COST
  );
}

export function batteryPercent(car: CarState): number {
  return Math.round((car.energyMJ / BATTERY_MAX) * 100);
}
