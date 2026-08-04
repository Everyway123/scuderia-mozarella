// Стратег: планує пітстопи перед гонкою і реагує під час неї.
// Тим самим кодом користується і ШІ-суперник, і підказка гравцеві на пітволі —
// щоб «оптимальна» стратегія в підказці була тією самою, з якою він бореться.

import { COMPOUNDS, DRY_COMPOUNDS } from './constants.ts';
import type { Rng } from './rng.ts';
import { lapsToCliff, pastCliff } from './tyres.ts';
import type { CarState, CompoundId, Driver, RaceState, Track, WeatherState } from './types.ts';

export interface StintPlan {
  compound: CompoundId;
  laps: number;
}

export interface StrategyPlan {
  stints: StintPlan[];
  /** Оцінка сумарної втрати часу проти ідеалу, с. */
  cost: number;
  stops: number;
}

/**
 * Пілоти не їдуть увесь стінт у режимі «Норма» — вони атакують і бережуть.
 * Планувальник мусить рахувати за тим самим середнім, інакше гума помирає
 * раніше за план і ШІ робить зайвий піт-стоп.
 */
const PLANNING_WEAR = 1.2;

/**
 * Втрата часу за стінт: інтегруємо ту саму модель гуми, що й у гонці.
 * Без цього «оптимальна стратегія» була б вгадуванням.
 */
function stintCost(compound: CompoundId, laps: number, track: Track, driver: Driver): number {
  const spec = COMPOUNDS[compound];
  const c = track.compression ?? 1;
  const rate =
    (c / spec.lifeLaps) * track.tyreWear * PLANNING_WEAR * (1 - 0.25 * driver.tyreManagement);

  let total = 0;
  let wear = 0;
  for (let age = 0; age < laps; age++) {
    // Та сама формула, що й у tyreDelta — інакше «оптимальний» план
    // рахувався б за іншою фізикою, ніж та, за якою їде гонка
    let loss = spec.offset * c + spec.degPerLap * age * track.tyreWear * c * c;
    if (wear > spec.cliff) {
      const past = (wear - spec.cliff) / (1 - spec.cliff);
      loss += spec.cliffLoss * past * past * c;
    }
    // Мертву гуму ніхто не возить — це вже не стратегія, а катастрофа
    if (wear >= 1) loss += 6 * c;
    total += loss;
    wear = Math.min(1.25, wear + rate);
  }
  return total;
}

/** Розбити дистанцію на N+1 стінтів якомога рівніше. */
function splitLaps(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Повний перебір: 1..3 зупинки × усі комбінації сумішей.
 * Максимум 3^4 = 81 варіант — рахується миттєво, тож можна робити чесно.
 */
export function planStrategy(
  track: Track,
  laps: number,
  driver: Driver,
  pitLossTotal: number,
  maxStops = 3,
): StrategyPlan {
  let best: StrategyPlan | null = null;
  for (let stops = 1; stops <= maxStops; stops++) {
    const plan = planWithStops(track, laps, driver, pitLossTotal, stops);
    if (!best || plan.cost < best.cost) best = plan;
  }
  return best!;
}

/** Усі комбінації сумішей для заданої кількості стінтів. */
function compoundCombos(parts: number): CompoundId[][] {
  let combos: CompoundId[][] = [[]];
  for (let i = 0; i < parts; i++) {
    const acc: CompoundId[][] = [];
    for (const combo of combos) for (const c of DRY_COMPOUNDS) acc.push([...combo, c]);
    combos = acc;
  }
  return combos;
}

/** Найкращий план за фіксованої кількості зупинок — для тесту «жодна стратегія не домінує». */
export function planWithStops(
  track: Track,
  laps: number,
  driver: Driver,
  pitLossTotal: number,
  stops: number,
): StrategyPlan {
  const parts = stops + 1;
  const lengths = splitLaps(laps, parts);
  let best: StrategyPlan | null = null;

  for (const combo of compoundCombos(parts)) {
    // Правило двох сумішей
    if (new Set(combo).size < 2) continue;

    let cost = pitLossTotal * stops;
    for (let i = 0; i < parts; i++) cost += stintCost(combo[i]!, lengths[i]!, track, driver);

    if (!best || cost < best.cost) {
      best = { stops, cost, stints: combo.map((compound, i) => ({ compound, laps: lengths[i]! })) };
    }
  }
  return best!;
}

/**
 * План конкретного пілота. Команди інколи свідомо розділяють стратегії —
 * без цього весь пелотон їде однаково і гонка перетворюється на парад.
 * Ризикуємо лише тим, що не програє наперед: альтернатива має бути в межах
 * розумного від оптимуму.
 */
export function planForDriver(
  track: Track,
  laps: number,
  driver: Driver,
  pitLossTotal: number,
  rng: Rng,
): StrategyPlan {
  const plans = [1, 2, 3]
    .map((s) => planWithStops(track, laps, driver, pitLossTotal, s))
    .sort((a, b) => a.cost - b.cost);

  const best = plans[0]!;
  const viable = plans.filter((p) => p.cost - best.cost < 12);

  // ~65% пелотона їде оптимум, решта гуляє в межах життєздатних варіантів
  if (viable.length < 2 || rng.chance(0.65)) return best;
  return viable[1 + Math.floor(rng.next() * (viable.length - 1))] ?? best;
}

export interface AiBrain {
  plan: StrategyPlan;
  /** Індекс поточного стінта. */
  stintIndex: number;
  /** На якому колі планується наступний заїзд. */
  nextPitLap: number;
  /** Чи вже скористався вікном сейфті-кара. */
  usedScWindow: boolean;
}

export function createBrain(plan: StrategyPlan, rng: Rng): AiBrain {
  // Трохи розкиду, щоб увесь пелотон не заїжджав одним колом
  const jitter = Math.round(rng.gauss(0, 1.6));
  return {
    plan,
    stintIndex: 0,
    nextPitLap: Math.max(3, (plan.stints[0]?.laps ?? 20) + jitter),
    usedScWindow: false,
  };
}

/**
 * Яку суміш брати наступною. За замовчуванням — ту, що в плані;
 * план уже складений так, щоб правило двох сумішей виконувалось.
 * Відхиляємось лише коли це останній шанс його виконати.
 */
function nextCompound(
  brain: AiBrain,
  car: CarState,
  state: RaceState,
  weather: WeatherState,
): CompoundId {
  if (weather === 'rain') return 'wet';
  if (weather === 'light-rain') return 'inter';

  const planned = brain.plan.stints[brain.stintIndex + 1]?.compound ?? 'medium';
  const usedDry = new Set(car.compoundsUsed.filter((c) => DRY_COMPOUNDS.includes(c)));

  if (usedDry.size >= 2) return planned;

  // Чи встигнемо ще раз заїхати після цього? Якщо ні — це останній шанс
  const lapsLeft = state.totalLaps - car.lap;
  const nextStint = brain.plan.stints[brain.stintIndex + 1]?.laps ?? lapsLeft;
  const lastChance = lapsLeft <= nextStint + 5;

  if (lastChance && usedDry.has(planned)) {
    return DRY_COMPOUNDS.find((c) => !usedDry.has(c)) ?? planned;
  }
  return planned;
}

export type PitReason = 'weather' | 'safety-car' | 'planned' | 'rule' | 'cliff';

export interface PitDecision {
  compound: CompoundId;
  reason: PitReason;
}

/**
 * Рішення ШІ на це коло: заїжджати чи ні, і на чому.
 * Порядок перевірок = порядок пріоритетів справжнього стратега.
 */
export function decidePit(
  car: CarState,
  brain: AiBrain,
  state: RaceState,
  track: Track,
  driver: Driver,
): PitDecision | null {
  const lapsLeft = state.totalLaps - car.lap;
  if (lapsLeft <= 1) return null;

  const pick = (reason: PitReason): PitDecision => ({
    compound: nextCompound(brain, car, state, state.weather),
    reason,
  });

  const dryTyre = DRY_COMPOUNDS.includes(car.tyre.compound);
  const wrongTyre =
    (state.weather !== 'dry' && dryTyre) || (state.weather === 'dry' && !dryTyre);

  // 1. Не та гума під погоду — заїжджати негайно, це коштує секунди на коло
  if (wrongTyre) return pick('weather');

  // 2. Вікно сейфті-кара — піт коштує вдвічі дешевше, гріх не скористатись.
  //    Але тільки якщо плановий заїзд і так уже не за горами: інакше це
  //    просто зайва зупинка, за яку потім доведеться платити ще однією.
  const planSoon = brain.nextPitLap - car.lap <= Math.max(6, lapsLeft * 0.35);
  if (state.flag !== 'green' && !brain.usedScWindow && lapsLeft > 6 && planSoon) {
    brain.usedScWindow = true;
    return pick('safety-car');
  }

  // 3. Плановий заїзд
  if (car.lap >= brain.nextPitLap) return pick('planned');

  // 4. Кінець гонки, а правило двох сумішей не виконане — заїзд обов'язковий
  const usedDry = new Set(car.compoundsUsed.filter((c) => DRY_COMPOUNDS.includes(c)));
  if (state.weather === 'dry' && usedDry.size < 2 && lapsLeft <= 3) return pick('rule');

  // 5. Позаплановий заїзд: гума за кліфом і до плану ще далеко.
  //    Це вже провал стратегії, тому поріг високий — інакше ШІ панікує
  //    і робить зайву зупинку на рівному місці.
  const toCliff = lapsToCliff(car.tyre, track, driver, car.paceMode, state.weather);
  const planFar = brain.nextPitLap - car.lap > 4;
  if (pastCliff(car.tyre) && toCliff <= 0 && planFar && lapsLeft > 8) return pick('cliff');

  return null;
}

/**
 * Після заїзду план перераховується від залишку дистанції, а не від початкових
 * довжин стінтів. Інакше ранній піт під сейфті-каром зсуває весь графік і ШІ
 * робить зайву зупинку — саме на цьому валилась перша версія.
 */
export function advanceBrain(brain: AiBrain, car: CarState, state: RaceState, rng: Rng): void {
  brain.stintIndex = Math.min(brain.stintIndex + 1, brain.plan.stints.length - 1);

  const stintsLeft = brain.plan.stints.length - brain.stintIndex;
  if (stintsLeft <= 1) {
    brain.nextPitLap = Infinity; // зупинки за планом скінчились — їдемо до фінішу
    return;
  }

  const remaining = state.totalLaps - car.lap;
  const target = remaining / stintsLeft;
  brain.nextPitLap = car.lap + Math.max(5, Math.round(target + rng.gauss(0, 1.4)));
}

/**
 * Який темп тримати. Головне правило: гума мусить дожити до планового заїзду.
 * Без цієї перевірки ШІ атакує, вбиває комплект і робить зайвий піт —
 * а потім дивується, чому програв стратегію.
 */
export function decidePace(
  car: CarState,
  state: RaceState,
  gapAhead: number,
  brain?: AiBrain,
): 1 | 2 | 3 | 4 | 5 {
  const lapsLeft = state.totalLaps - car.lap;

  // Фінал гонки — все одно, що буде з гумою
  if (lapsLeft <= 3) return 5;

  // Скільки ще треба протягнути на цьому комплекті
  const toPit = brain ? Math.max(0, brain.nextPitLap - car.lap) : lapsLeft;
  const budget = Math.min(toPit, lapsLeft);

  if (budget > 2) {
    // Скільки ресурсу можна палити за коло, щоб дотягнути до плану
    const allowed = (0.95 - car.tyre.wear) / budget;
    if (allowed < 0.018) return 1;
    if (allowed < 0.028) return 2;
  }

  // Суперник у зоні атаки — тиснемо
  if (gapAhead < 1.2 && car.tyre.wear < 0.75) return 4;
  return 3;
}
