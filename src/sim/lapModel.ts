// Модель часу кола — серце симуляції.
// Побудована за схемою академічної race-simulation (TU München): дискретизація
// по колах, довгострокові ефекти маси палива й зносу гуми, взаємодія учасників.
//
//   t_lap = t_base
//         + k_fuel · m_fuel
//         + Δ_гума(суміш, вік, кліф)
//         + Δ_темп(режим)
//         + Δ_енергія(профіль, Override)
//         − p_болід − p_пілот
//         + брудне повітря
//         + погода
//         − еволюція траси
//         + шум

import {
  COMPOUNDS,
  DIRTY_AIR,
  FUEL_EFFECT,
  LAP_NOISE_MAX,
  LAP_NOISE_MIN,
  OVERRIDE_WINDOW,
  PACE_TIME,
  SC_LAP_FACTOR,
  TRACK_EVOLUTION,
  VSC_LAP_FACTOR,
  WET_PENALTY,
} from './constants.ts';
import { stepEnergy } from './energy.ts';
import type { Rng } from './rng.ts';
import { tyreDelta } from './tyres.ts';
import type {
  CarState,
  CompoundId,
  Driver,
  FlagState,
  Team,
  Track,
  WeatherState,
} from './types.ts';

export interface LapContext {
  track: Track;
  driver: Driver;
  team: Team;
  weather: WeatherState;
  flag: FlagState;
  /** 0..1 — наскільки траса вже загумована. */
  evolution: number;
  /** Гап до машини попереду на початок кола, с. Infinity для лідера. */
  gapAhead: number;
  rng: Rng;
}

export interface LapResult {
  time: number;
  battery: number;
  overrideUsed: boolean;
  flatBattery: boolean;
  /** Розклад по складових — для дебагу балансу й для екрана розбору. */
  breakdown: Record<string, number>;
}

export function computeLap(car: CarState, ctx: LapContext): LapResult {
  const { track, driver, team, weather, evolution, gapAhead, rng } = ctx;

  const base = track.baseLap;
  const fuel = FUEL_EFFECT * car.fuelKg;
  const tyre = tyreDelta(car.tyre, track, driver, team.tyreWear ?? 1);
  const pace = PACE_TIME[car.paceMode];
  const carPace = -carAdvantage(team);
  const driverPace = -driverAdvantage(driver, weather);

  const energy = stepEnergy(car, track, gapAhead);

  // Брудне повітря: сидиш у хвості — втрачаєш темп. 2026 регламент його зменшив,
  // але не прибрав.
  const dirty = gapAhead <= OVERRIDE_WINDOW ? DIRTY_AIR : 0;

  const wet = wetPenalty(weather, driver, car);
  const evo = -TRACK_EVOLUTION * evolution;

  // Шум: стабільний пілот їде рівно, нестабільний стрибає.
  const sd = LAP_NOISE_MAX - (LAP_NOISE_MAX - LAP_NOISE_MIN) * driver.consistency;
  const noise = rng.gauss(0, sd);

  // Стиснення гонки має бути послідовним. Гума вже масштабована всередині
  // tyreDelta, паливо — через fuelPerLap. Але темп, енергія, брудне повітря
  // й перевага боліда теж накопичуються за дистанцію: у стиснутій гонці
  // одне коло «коштує» c справжніх, тож і вони множаться на c.
  //
  // Без цього виходив перекіс, який убивав саму гру: знос наприкінці стінта
  // давав десяток секунд на колі, а важіль темпу — пів секунди. Рішення
  // гравця ставали шумом, і пасивна гра обігравала будь-яку стратегію.
  const c = track.compression ?? 1;
  const perLap = (pace + carPace + driverPace + energy.timeDelta + dirty + wet + evo) * c;
  // Шум — сума незалежних кіл, тому росте як корінь, а не лінійно
  const scaledNoise = noise * Math.sqrt(c);

  let time = base + fuel + tyre + perLap + scaledNoise;

  // Під жовтими прапорами темп задає не болід
  if (ctx.flag === 'safety-car') time = base * SC_LAP_FACTOR;
  else if (ctx.flag === 'vsc') time = base * VSC_LAP_FACTOR;

  return {
    time,
    battery: energy.battery,
    overrideUsed: energy.overrideUsed,
    flatBattery: energy.flat,
    breakdown: {
      base,
      fuel,
      tyre,
      pace,
      car: carPace,
      driver: driverPace,
      energy: energy.timeDelta,
      dirty,
      wet,
      evo,
      noise,
    },
  };
}

/** Перевага боліда в секундах на коло (більше = швидше). */
function carAdvantage(team: Team): number {
  return -team.pace;
}

/** Перевага пілота в секундах на коло. У дощ вага навички різко росте. */
function driverAdvantage(driver: Driver, weather: WeatherState): number {
  let adv = -driver.pace;
  if (weather !== 'dry') {
    const wetBonus = (driver.wet - 0.75) * (weather === 'rain' ? 3.2 : 1.8);
    adv += wetBonus;
  }
  return adv;
}

/** Скільки коштує мокра траса — і чи взагалі та гума, що треба. */
function wetPenalty(weather: WeatherState, _driver: Driver, car: CarState): number {
  if (weather === 'dry') {
    // Дощова гума на сухій трасі — катастрофа
    if (car.tyre.compound === 'wet') return 8.0;
    if (car.tyre.compound === 'inter') return 3.5;
    return 0;
  }
  const base = WET_PENALTY[weather] ?? 0;
  // Частка штрафу за гуму: 0.15 — правильна, 1.0 — слік, який нікуди не їде.
  // Інтер у зливу — проміжний: гірший за дощову, але це не катастрофа.
  // Разом із offset суміші кросовер сходиться в правильному порядку:
  //   легкий дощ:  інтер 4.3 < слік 6.0 < дощова 7.4   (с/коло)
  //   злива:       дощова 8.5 < інтер 9.3 < слік 13.0
  let factor: number;
  if (weather === 'rain') {
    factor = car.tyre.compound === 'wet' ? 0.15 : car.tyre.compound === 'inter' ? 0.45 : 1;
  } else {
    factor = car.tyre.compound === 'inter' || car.tyre.compound === 'wet' ? 0.15 : 1;
  }
  return base * factor;
}

/**
 * Скільки секунд на колі коштує ця гума проти НАЙКРАЩОЇ для цієї погоди.
 * Ті самі числа, що й у wetPenalty + offset суміші — для чесного розбору
 * після гонки («3 кола на сліках під дощем — ≈14 с»). Без стиснення:
 * движок множить на compression сам.
 */
export function tyreWeatherLoss(weather: WeatherState, compound: CompoundId): number {
  const cost = (c: CompoundId): number => {
    const offset = COMPOUNDS[c].offset;
    if (weather === 'dry') return c === 'wet' ? 8.0 + offset : c === 'inter' ? 3.5 + offset : 0;
    const base = WET_PENALTY[weather] ?? 0;
    const dry = c !== 'wet' && c !== 'inter';
    const factor =
      weather === 'rain' ? (c === 'wet' ? 0.15 : c === 'inter' ? 0.45 : 1) : dry ? 1 : 0.15;
    return base * factor + (dry ? 0 : offset);
  };
  const best = weather === 'dry' ? 'soft' : weather === 'rain' ? 'wet' : 'inter';
  return Math.max(0, cost(compound) - cost(best));
}

/**
 * Скільки палива витрачає коло. Під сейфті-каром — менше.
 */
export function fuelBurn(track: Track, flag: FlagState): number {
  const mult = flag === 'safety-car' ? 0.45 : flag === 'vsc' ? 0.7 : 1;
  return track.fuelPerLap * mult;
}

/** Стартовий запас палива під обрану довжину гонки. */
export function startingFuel(track: Track, laps: number, marginKg: number): number {
  return track.fuelPerLap * laps + marginKg;
}
