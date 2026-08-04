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
import type { CarState, Driver, FlagState, Team, Track, WeatherState } from './types.ts';

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
  const tyre = tyreDelta(car.tyre, track, driver);
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
  const right =
    weather === 'rain'
      ? car.tyre.compound === 'wet'
      : car.tyre.compound === 'inter' || car.tyre.compound === 'wet';
  // Суха гума в дощ — це не «повільніше», це «нікуди не їде»
  return right ? base * 0.15 : base;
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
