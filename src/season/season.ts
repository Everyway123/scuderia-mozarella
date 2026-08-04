// Сезон: 24 етапи, залік, розробка картками, ставка на етап, козирі, фірмові траси.
//
// Тут немає нічого від симуляції — сезон лише готує вхідні дані для гонки
// (склад команд із урахуванням розробки) і приймає її результат.

import { DRIVERS_2026, driversOfTeam } from '../data/drivers2026.ts';
import { TEAMS_2026 } from '../data/teams2026.ts';
import { TRACKS_2026 } from '../data/tracks2026.ts';
import type { ClassifiedCar } from '../sim/raceEngine.ts';
import { Rng } from '../sim/rng.ts';
import type { RaceLength, Team } from '../sim/types.ts';
import { OFFER_SIZE, PART_BY_ID, PARTS } from './parts.ts';

export const SAVE_KEY = 'scuderiaMozarellaSeason1';
const SAVE_VERSION = 2;

export type ChipId = 'triple' | 'rebuild' | 'doubleRp';

export interface ChipSpec {
  id: ChipId;
  name: string;
  note: string;
  /** Чи діє на найближчу гонку (на відміну від миттєвої дії). */
  armed: boolean;
}

/**
 * Одноразові сезонні козирі — ідея чіпів із F1 Fantasy.
 * Цінність не в силі ефекту, а в рішенні «коли»: воно розтягнуте на 24 етапи.
 */
export const CHIPS: ChipSpec[] = [
  {
    id: 'triple',
    name: 'Потрійна ставка',
    note: 'Очки лідера етапу рахуються ×3 замість ×2',
    armed: true,
  },
  {
    id: 'doubleRp',
    name: 'Подвійна розробка',
    note: 'Увесь RP за цей етап подвоюється',
    armed: true,
  },
  {
    id: 'rebuild',
    name: 'Перебудова',
    note: 'Зняти всі деталі й повернути витрачений RP',
    armed: false,
  },
];

export const CHIP_BY_ID = new Map(CHIPS.map((c) => [c.id, c]));

export interface RaceRecord {
  round: number;
  trackId: string;
  podium: string[];
  bestPosition: number;
  pointsScored: number;
  rpGained: number;
  /** Чи виправдав лідер етапу ставку. */
  betPaid: boolean;
}

export interface SeasonState {
  version: number;
  teamId: string;
  /** Наступний етап, 1..24. Коли > 24 — сезон завершено. */
  round: number;
  length: RaceLength;
  seed: number;
  driverPoints: Record<string, number>;
  teamPoints: Record<string, number>;
  /** Невитрачені очки розробки. */
  rp: number;
  /** Встановлені деталі. */
  parts: string[];
  /** Ставка на етап: хто з двох пілотів має привезти результат. */
  nomination: string | null;
  /** Чи вже використано зміну ставки після квали на цьому етапі. */
  betFixed: boolean;
  /** Використані козирі. */
  chipsUsed: ChipId[];
  /** Козир, зведений на найближчу гонку. */
  armedChip: ChipId | null;
  /** Траси, де команда вигравала — там вона почувається як удома. */
  homeTracks: string[];
  history: RaceRecord[];
}

export function newSeason(teamId: string, length: RaceLength, seed: number): SeasonState {
  const first = driversOfTeam(teamId)[0]?.id ?? null;
  return {
    version: SAVE_VERSION,
    teamId,
    round: 1,
    length,
    seed,
    driverPoints: {},
    teamPoints: {},
    rp: 8,
    parts: [],
    nomination: first,
    betFixed: false,
    chipsUsed: [],
    armedChip: null,
    homeTracks: [],
    history: [],
  };
}

// ---- Розробка ---------------------------------------------------------

/**
 * Три пропозиції на етап. Вибірка детермінована від seed сезону й номера
 * етапу — тож перезавантаження сторінки не перетасовує колоду, і «рероллити»
 * оновленням не вийде.
 */
export function offersFor(state: SeasonState): string[] {
  const rng = new Rng(state.seed * 31337 + state.round * 17);
  const pool = PARTS.filter((p) => !state.parts.includes(p.id)).map((p) => p.id);
  const out: string[] = [];
  while (out.length < OFFER_SIZE && pool.length > 0) {
    const i = Math.floor(rng.next() * pool.length);
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}

export function spentRp(state: SeasonState): number {
  return state.parts.reduce((a, id) => a + (PART_BY_ID.get(id)?.cost ?? 0), 0);
}

/**
 * Склад команд для конкретного етапу.
 *
 * Розробка гравця — його прогрес. Але суперники теж не стоять: кожен етап
 * їхній темп трохи дрейфує за seed сезону. Без цього гравець за пів сезону
 * відʼїжджає від пелотона і чемпіонат закінчується в березні.
 */
export function teamsForRound(state: SeasonState): Team[] {
  const rng = new Rng(state.seed * 7919 + state.round * 131);
  const track = currentTrack(state);
  const home = state.homeTracks.includes(track.id);

  return TEAMS_2026.map((team) => {
    if (team.id !== state.teamId) {
      // Суперники розвиваються самі: сильніші трохи повільніше, слабші швидше —
      // так грид із часом стискається, а не розповзається
      const catchUp = (team.pace - 0.6) * 0.02;
      const drift = rng.gauss(0, 0.035);
      return { ...team, pace: Math.max(0, team.pace - state.round * 0.012 - catchUp - drift) };
    }

    let pace = team.pace;
    let reliability = team.reliability;
    let pitCrew = team.pitCrew;
    let strategy = team.strategy;

    for (const id of state.parts) {
      const part = PART_BY_ID.get(id);
      if (!part) continue;
      pace += part.pace ?? 0;
      reliability *= part.reliability ?? 1;
      pitCrew += part.pitCrew ?? 0;
      strategy += part.strategy ?? 0;
    }

    // Фірмова траса: тут команда вже вигравала й знає її напамʼять
    if (home) pace -= HOME_TRACK_BONUS;

    return {
      ...team,
      pace: Math.max(0, pace),
      reliability: Math.max(0.3, reliability),
      pitCrew: Math.max(1.9, pitCrew),
      strategy: Math.min(0.98, strategy),
    };
  });
}

/** Наскільки швидше команда їде на трасі, де вже вигравала. */
export const HOME_TRACK_BONUS = 0.04;

// ---- Очки розробки ----------------------------------------------------

/** Скільки RP дає одна відіграна позиція. */
const RP_PER_GAINED = 0.5;

export interface RpBreakdown {
  base: number;
  fromPoints: number;
  fromGained: number;
  fromBet: number;
  chipMultiplier: number;
  total: number;
}

/**
 * Очки розробки за етап.
 *
 * Ключова частина — **відіграні позиції**. Без них у аутсайдера сезон без
 * подій: очок не буде ніколи, тож і мотивації немає. «З двадцятого на
 * чотирнадцяте» — це результат, і він має оплачуватись.
 */
export function computeRp(
  state: SeasonState,
  mine: ClassifiedCar[],
): RpBreakdown {
  const pointsScored = mine.reduce((a, c) => a + c.points, 0);
  const gained = mine.reduce((a, c) => a + Math.max(0, c.gained), 0);

  const base = 3;
  const fromPoints = Math.round(pointsScored / 4);
  const fromGained = Math.round(gained * RP_PER_GAINED);

  // Ставка на етап: механіка DRS Boost із Fantasy, перероблена так, щоб
  // гравець ставив на СВОГО пілота, а не збирав чужих
  let fromBet = 0;
  const nominated = mine.find((c) => c.driver.id === state.nomination);
  if (nominated) {
    const mult = state.armedChip === 'triple' ? 3 : 2;
    if (nominated.status === 'dnf') fromBet = -2;
    else if (nominated.points === 0) fromBet = -1;
    else fromBet = Math.round((nominated.points / 4) * (mult - 1));
  }

  const chipMultiplier = state.armedChip === 'doubleRp' ? 2 : 1;
  const total = Math.max(0, Math.round((base + fromPoints + fromGained + fromBet) * chipMultiplier));

  return { base, fromPoints, fromGained, fromBet, chipMultiplier, total };
}

export function recordRace(
  state: SeasonState,
  classification: ClassifiedCar[],
  trackId: string,
): RaceRecord & { rp: RpBreakdown } {
  let best = 99;

  for (const c of classification) {
    if (c.points > 0) {
      state.driverPoints[c.driver.id] = (state.driverPoints[c.driver.id] ?? 0) + c.points;
      state.teamPoints[c.team.id] = (state.teamPoints[c.team.id] ?? 0) + c.points;
    }
    if (c.team.id === state.teamId && c.status !== 'dnf') best = Math.min(best, c.position);
  }

  const mine = classification.filter((c) => c.team.id === state.teamId);
  const rp = computeRp(state, mine);
  const nominated = mine.find((c) => c.driver.id === state.nomination);

  // Перемога робить трасу фірмовою — сезон отримує памʼять
  const winner = classification.find((c) => c.position === 1 && c.status !== 'dnf');
  if (winner?.team.id === state.teamId && !state.homeTracks.includes(trackId)) {
    state.homeTracks.push(trackId);
  }

  const record: RaceRecord = {
    round: state.round,
    trackId,
    podium: classification.slice(0, 3).map((c) => c.driver.id),
    bestPosition: best === 99 ? 0 : best,
    pointsScored: mine.reduce((a, c) => a + c.points, 0),
    rpGained: rp.total,
    betPaid: !!nominated && nominated.status !== 'dnf' && nominated.points > 0,
  };

  state.history.push(record);
  state.rp += rp.total;
  state.round += 1;

  // Козир діє один етап
  if (state.armedChip) {
    if (!state.chipsUsed.includes(state.armedChip)) state.chipsUsed.push(state.armedChip);
    state.armedChip = null;
  }
  state.betFixed = false;

  return { ...record, rp };
}

// ---- Козирі -----------------------------------------------------------

export function canUseChip(state: SeasonState, id: ChipId): boolean {
  if (state.chipsUsed.includes(id)) return false;
  const spec = CHIP_BY_ID.get(id);
  if (!spec) return false;
  if (spec.armed) return state.armedChip === null;
  return true;
}

export function useChip(state: SeasonState, id: ChipId): boolean {
  if (!canUseChip(state, id)) return false;
  const spec = CHIP_BY_ID.get(id)!;

  if (id === 'rebuild') {
    state.rp += spentRp(state);
    state.parts = [];
    state.chipsUsed.push(id);
    return true;
  }
  if (spec.armed) {
    state.armedChip = id;
    return true;
  }
  return false;
}

// ---- Залік ------------------------------------------------------------

export interface StandingRow {
  id: string;
  name: string;
  color: string;
  points: number;
  isPlayer: boolean;
}

export function driverStandings(state: SeasonState): StandingRow[] {
  return DRIVERS_2026.map((d) => {
    const team = TEAMS_2026.find((t) => t.id === d.teamId)!;
    return {
      id: d.id,
      name: d.name,
      color: team.color,
      points: state.driverPoints[d.id] ?? 0,
      isPlayer: d.teamId === state.teamId,
    };
  }).sort((a, b) => b.points - a.points);
}

export function teamStandings(state: SeasonState): StandingRow[] {
  return TEAMS_2026.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    points: state.teamPoints[t.id] ?? 0,
    isPlayer: t.id === state.teamId,
  })).sort((a, b) => b.points - a.points);
}

export function currentTrack(state: SeasonState) {
  return TRACKS_2026.find((t) => t.round === state.round) ?? TRACKS_2026[0]!;
}

export function isSeasonOver(state: SeasonState): boolean {
  return state.round > TRACKS_2026.length;
}

/** Seed конкретного етапу — щоб гонка була відтворюваною всередині сезону. */
export function raceSeed(state: SeasonState): number {
  return state.seed * 104729 + state.round * 31;
}

// ---- Збереження -------------------------------------------------------

export function save(state: SeasonState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // приватний режим або переповнене сховище — гра має продовжити працювати
  }
}

export function load(): SeasonState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeasonState;
    // Стара версія збереження несумісна за структурою: там була лінійна
    // розробка замість карток. Чесніше почати заново, ніж мігрувати наосліп.
    if (parsed.version !== SAVE_VERSION) return null;
    if (!parsed.teamId || typeof parsed.round !== 'number') return null;
    if (!Array.isArray(parsed.parts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* нічого страшного */
  }
}
