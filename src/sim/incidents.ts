// Випадковість: сходи, сейфті-кар, погода, помилки пілотів.
// Усе через seeded RNG — щоб гонку можна було відтворити.

import {
  DNF_PER_RACE,
  PACE_RISK,
  SC_MAX_LAPS,
  SC_MIN_LAPS,
  STEWARD_BASE,
  STEWARD_DUEL_RISK,
  STEWARD_PACE_RISK,
} from './constants.ts';
import type { Rng } from './rng.ts';
import type { CarState, Driver, RaceState, Team, Track, WeatherState } from './types.ts';

const DNF_REASONS = [
  'відмова силової установки',
  'проблема з коробкою',
  'перегрів гальм',
  'втрата тиску масла',
  'збій батареї',
  'прокол',
];

/** Чи сходить болід на цьому колі. */
export function checkDnf(
  car: CarState,
  team: Team,
  driver: Driver,
  rng: Rng,
  totalLaps: number,
): string | null {
  const stress = PACE_RISK[car.paceMode];
  // Нестабільний пілот частіше ловить помилку, що закінчується стіною
  const errorProne = 1 + (1 - driver.consistency) * 0.8;
  // Ризик заданий на гонку й ділиться на її довжину: так і Монако з 78 колами,
  // і Спа з 44 мають однаковий базовий шанс сходу. Стиснення враховано
  // автоматично — у короткій гонці кіл менше, тож на коло припадає більше.
  //
  // Надійність команди — у степені 1.5: лінійна залежність робила топ-боліди
  // майже такими ж ламкими, як хвіст пелотона, і зірка сходила двічі поспіль
  // частіше, ніж це виглядає чесним. Тепер 0.85 → ×0.78, а 1.7 → ×2.2.
  const p =
    (DNF_PER_RACE / Math.max(1, totalLaps)) * Math.pow(team.reliability, 1.5) * stress * errorProne;

  if (rng.chance(p)) {
    // Помилка пілота чи техніка — від режиму темпу залежить, що саме
    if (car.paceMode >= 4 && rng.chance(0.4)) return 'помилка й виліт із траси';
    return rng.pick(DNF_REASONS);
  }
  return null;
}

/** Чи виїжджає сейфті-кар. Ймовірність за гонку розмазана по колах. */
export function checkSafetyCar(state: RaceState, track: Track, rng: Rng): number {
  if (state.flag !== 'green') return 0;
  if (state.lap < 2 || state.lap > state.totalLaps - 3) return 0;

  const perLap = track.safetyCar / state.totalLaps;
  if (!rng.chance(perLap)) return 0;

  return Math.round(rng.range(SC_MIN_LAPS, SC_MAX_LAPS + 1));
}

/**
 * Погода розписується наперед — один фронт на гонку, а не монетка щокола.
 * Так і реалістичніше (дощ не блимає), і головне — з'являється прогноз,
 * на який гравець може поставити. Марковський ланцюг такого не дає.
 */
export function planWeather(track: Track, totalLaps: number, rng: Rng): WeatherState[] {
  const script: WeatherState[] = new Array(totalLaps + 1).fill('dry');
  if (!rng.chance(track.rainChance)) return script;

  const start = Math.floor(rng.range(totalLaps * 0.12, totalLaps * 0.78));
  const buildUp = Math.round(rng.range(2, 5));
  const heavy = rng.chance(0.45);
  const core = Math.round(rng.range(totalLaps * 0.15, totalLaps * 0.45));
  const easesOff = rng.chance(0.6);

  let lap = start;
  for (let i = 0; i < buildUp && lap <= totalLaps; i++) script[lap++] = 'light-rain';
  for (let i = 0; i < core && lap <= totalLaps; i++) script[lap++] = heavy ? 'rain' : 'light-rain';
  if (easesOff) {
    for (let i = 0; i < buildUp && lap <= totalLaps; i++) script[lap++] = 'light-rain';
    // далі лишається 'dry' із заповнення
  } else {
    while (lap <= totalLaps) script[lap++] = heavy ? 'rain' : 'light-rain';
  }
  return script;
}

/**
 * Прогноз, який бачить гравець: правда, розмита тим сильніше,
 * чим далі коло. На цьому будується ставка «ставимо інтер зараз чи чекаємо».
 */
export function forecast(
  script: WeatherState[],
  fromLap: number,
  horizon: number,
  rng: Rng,
): { lap: number; chance: number }[] {
  const out: { lap: number; chance: number }[] = [];
  for (let i = 1; i <= horizon; i++) {
    const lap = fromLap + i;
    const truth = script[lap] ?? 'dry';
    const certainty = Math.max(0.35, 1 - i / (horizon * 1.4));
    const base = truth === 'dry' ? 0.1 : 0.9;
    const blurred = base * certainty + 0.5 * (1 - certainty) + rng.gauss(0, 0.06);
    out.push({ lap, chance: Math.max(0, Math.min(1, blurred)) });
  }
  return out;
}

/**
 * Дрібні помилки, що не закінчують гонку: блокування колеса, зріз, широкий вихід.
 * Дають втрату часу і плоску пляму на гумі.
 */
export function checkMistake(
  car: CarState,
  driver: Driver,
  underPressure: boolean,
  rng: Rng,
  compression = 1,
): { cost: number; text: string } | null {
  let p = 0.012 * (1 - driver.consistency) * PACE_RISK[car.paceMode] * compression;
  if (underPressure) p *= 2.1;
  if (car.tyre.wear > 0.85) p *= 1.6;

  if (!rng.chance(p)) return null;

  const roll = rng.next();
  if (roll < 0.45) {
    car.tyre.wear = Math.min(1, car.tyre.wear + 0.06);
    return { cost: rng.range(0.4, 1.2), text: 'заблокував колесо — плоска пляма' };
  }
  if (roll < 0.8) return { cost: rng.range(0.3, 0.9), text: 'широкий вихід із повороту' };
  return { cost: rng.range(1.2, 2.6), text: 'зріз, довелось віддати перевагу' };
}

export function pitStopTime(team: Team, rng: Rng): number {
  const t = rng.gauss(team.pitCrew, team.pitCrewSd);
  // Затримок буває більше, ніж ідеальних стоянок — асиметричний хвіст
  if (rng.chance(0.05)) return t + rng.range(1.5, 6.0);
  return Math.max(1.9, t);
}

const PENALTY_REASONS = [
  'вихід за межі траси',
  'зіткнення в боротьбі',
  'небезпечне зближення',
  'виїзд із боксів через суцільну',
];

/**
 * Стюарди. Агресивний темп і невдалі спроби обгону дають шанс отримати
 * п'ятисекундний штраф.
 *
 * Це не косметика: без штрафів режим «Атака» коштував лише гуми, і той самий
 * прорахунок робив за гравця ШІ. Ризик, від якого штатний стратег тікає,
 * а сміливий гравець може його прийняти, — це і є простір для рішення.
 */
export function checkStewards(
  car: CarState,
  driver: Driver,
  duelledAndFailed: boolean,
  totalLaps: number,
  referenceLaps: number,
  rng: Rng,
): string | null {
  const paceRisk = STEWARD_PACE_RISK[car.paceMode];
  const duel = duelledAndFailed ? STEWARD_DUEL_RISK : 1;
  const style = 0.6 + 0.9 * driver.aggression;
  const sloppy = 1 + (1 - driver.consistency) * 0.7;
  // Ризик заданий на еталонну дистанцію й ділиться на реальну кількість кіл,
  // тому Монако з 78 колами не карає більше за Спа з 44
  const scale = referenceLaps / Math.max(1, totalLaps);

  const p = STEWARD_BASE * paceRisk * duel * style * sloppy * scale;
  return rng.chance(p) ? rng.pick(PENALTY_REASONS) : null;
}
