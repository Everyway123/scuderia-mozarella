// Гума: знос, кліф, вибір суміші.
// Головний ресурс гри — усе інше крутиться навколо нього.

import { COMPOUNDS, PACE_WEAR } from './constants.ts';
import type { CompoundId, Driver, PaceMode, Track, TyreState, WeatherState } from './types.ts';

export function freshTyre(compound: CompoundId): TyreState {
  return { compound, age: 0, wear: 0 };
}

/**
 * Скільки секунд на коло втрачає болід через стан гуми.
 * Лінійна складова + кліф, що росте квадратично після порогу.
 */
/**
 * Наскільки пілот сповільнює сам знос. Нормовано на середній рівень 0.8,
 * щоб калібрування трас не поїхало: Алонсо (0.95) втрачає на ~7% менше
 * за коло, Стролл (0.65) — на ~7% більше.
 *
 * Раніше вміння берегти гуму впливало лише на те, коли настане кліф, але не
 * на сам знос — і два пілоти з різними руками отримували однакову стратегію
 * до дванадцятого знака.
 */
function managementFactor(driver: Driver): number {
  return 1 - 0.5 * (driver.tyreManagement - 0.8);
}

export function tyreDelta(tyre: TyreState, track: Track, driver: Driver): number {
  const spec = COMPOUNDS[tyre.compound];
  const c = track.compression ?? 1;

  // Стиснення гонки: одне коло «коштує» c справжніх.
  // Стала складова множиться на c, а лінійна по віку — на c², бо вік у колах
  // теж стиснувся. Без квадрата коротка гонка втрачає всю гумову драму.
  let loss =
    spec.offset * c +
    spec.degPerLap * tyre.age * track.tyreWear * c * c * managementFactor(driver);

  if (tyre.wear > spec.cliff) {
    const past = (tyre.wear - spec.cliff) / (1 - spec.cliff);
    loss += spec.cliffLoss * past * past * c;
  }
  return loss;
}

/**
 * Частка ресурсу, що згорає за одне коло.
 * Темп, траса й уміння пілота берегти гуму — три множники.
 */
export function wearPerLap(
  tyre: TyreState,
  track: Track,
  driver: Driver,
  paceMode: PaceMode,
  weather: WeatherState,
): number {
  const spec = COMPOUNDS[tyre.compound];
  // Ресурс витрачається пропорційно стисненню — щоб кліф наставав
  // на тій самій частці дистанції, що й у повній гонці
  const base = (track.compression ?? 1) / spec.lifeLaps;
  const skill = 1 - 0.25 * driver.tyreManagement;
  // На мокрій трасі суха гума помирає за кілька кіл, дощова навпаки бережеться
  const isWetTyre = tyre.compound === 'inter' || tyre.compound === 'wet';
  let weatherMult = 1;
  if (weather !== 'dry') weatherMult = isWetTyre ? 0.8 : 3.0;
  else if (isWetTyre) weatherMult = 2.4;

  return base * track.tyreWear * PACE_WEAR[paceMode] * skill * weatherMult;
}

export function ageTyre(
  tyre: TyreState,
  track: Track,
  driver: Driver,
  paceMode: PaceMode,
  weather: WeatherState,
): void {
  tyre.age += 1;
  tyre.wear = Math.min(1, tyre.wear + wearPerLap(tyre, track, driver, paceMode, weather));
}

/** Чи вже за кліфом — пілот по радіо просить бокси саме тут. */
export { managementFactor };

export function pastCliff(tyre: TyreState): boolean {
  return tyre.wear > COMPOUNDS[tyre.compound].cliff;
}

/**
 * Скільки кіл лишилось до кліфа при поточному темпі.
 * Це те число, на яке дивиться і гравець, і стратег ШІ.
 */
export function lapsToCliff(
  tyre: TyreState,
  track: Track,
  driver: Driver,
  paceMode: PaceMode,
  weather: WeatherState,
): number {
  const spec = COMPOUNDS[tyre.compound];
  const rate = wearPerLap(tyre, track, driver, paceMode, weather);
  if (rate <= 0) return 99;
  return Math.max(0, Math.floor((spec.cliff - tyre.wear) / rate));
}

/** Правило двох сумішей: у суху гонку треба відпрацювати щонайменше дві. */
export function needsSecondCompound(used: CompoundId[], weather: WeatherState): boolean {
  if (weather !== 'dry') return false;
  const dry = new Set(used.filter((c) => c === 'soft' || c === 'medium' || c === 'hard'));
  return dry.size < 2;
}

export function compoundLabel(id: CompoundId): string {
  return COMPOUNDS[id].label;
}
