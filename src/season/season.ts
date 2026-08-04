// Сезон: 24 етапи, залік, розвиток боліда, збереження.
//
// Тут немає нічого від симуляції — сезон лише готує вхідні дані для гонки
// (склад команд із урахуванням розробки) і приймає її результат.

import { DRIVERS_2026 } from '../data/drivers2026.ts';
import { TEAMS_2026 } from '../data/teams2026.ts';
import { TRACKS_2026 } from '../data/tracks2026.ts';
import type { ClassifiedCar } from '../sim/raceEngine.ts';
import { Rng } from '../sim/rng.ts';
import type { RaceLength, Team } from '../sim/types.ts';

export const SAVE_KEY = 'scuderiaMozarellaSeason1';
const SAVE_VERSION = 1;

export type DevArea = 'aero' | 'chassis' | 'power' | 'reliability';

export const DEV_AREAS: { id: DevArea; label: string; note: string }[] = [
  { id: 'aero', label: 'Аеродинаміка', note: '−0.045 с на коло за рівень' },
  { id: 'chassis', label: 'Шасі', note: '−0.030 с і трохи менший знос гуми' },
  { id: 'power', label: 'Силова установка', note: '−0.045 с, але +5% ризику' },
  { id: 'reliability', label: 'Надійність', note: '−12% ризику сходу' },
];

export interface RaceRecord {
  round: number;
  trackId: string;
  podium: string[];
  bestPosition: number;
  pointsScored: number;
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
  development: Record<DevArea, number>;
  /** Невитрачені очки розробки. */
  rp: number;
  history: RaceRecord[];
}

export function newSeason(teamId: string, length: RaceLength, seed: number): SeasonState {
  return {
    version: SAVE_VERSION,
    teamId,
    round: 1,
    length,
    seed,
    driverPoints: {},
    teamPoints: {},
    development: { aero: 0, chassis: 0, power: 0, reliability: 0 },
    rp: 6,
    history: [],
  };
}

/** Скільки коштує наступний рівень напряму — зростає, щоб не качати все підряд. */
export function devCost(level: number): number {
  return 3 + level * 2;
}

export const DEV_MAX = 8;

/**
 * Склад команд для конкретного етапу.
 *
 * Розробка гравця — це його прогрес. Але суперники теж не стоять: кожен етап
 * їхній темп трохи дрейфує за seed сезону. Без цього гравець за пів сезону
 * від'їжджає від пелотона і чемпіонат закінчується в березні.
 */
export function teamsForRound(state: SeasonState): Team[] {
  const rng = new Rng(state.seed * 7919 + state.round * 131);

  return TEAMS_2026.map((team) => {
    let pace = team.pace;
    let reliability = team.reliability;

    if (team.id === state.teamId) {
      const d = state.development;
      pace -= d.aero * 0.045 + d.chassis * 0.03 + d.power * 0.045;
      reliability *= 1 + d.power * 0.05 - d.reliability * 0.12;
    } else {
      // Суперники розвиваються самі: сильніші трохи повільніше, слабші швидше —
      // так грид із часом стискається, а не розповзається
      const catchUp = (team.pace - 0.6) * 0.02;
      const drift = rng.gauss(0, 0.035);
      pace -= state.round * 0.012 + catchUp + drift;
    }

    return {
      ...team,
      pace: Math.max(0, pace),
      reliability: Math.max(0.35, reliability),
    };
  });
}

/** Скільки очок розробки дає етап: за очки в заліку плюс базова сума. */
export function rpFromResult(pointsScored: number): number {
  return 3 + Math.round(pointsScored / 4);
}

export function recordRace(
  state: SeasonState,
  classification: ClassifiedCar[],
  trackId: string,
): RaceRecord {
  let scored = 0;
  let best = 99;

  for (const c of classification) {
    if (c.points > 0) {
      state.driverPoints[c.driver.id] = (state.driverPoints[c.driver.id] ?? 0) + c.points;
      state.teamPoints[c.team.id] = (state.teamPoints[c.team.id] ?? 0) + c.points;
    }
    if (c.team.id === state.teamId) {
      scored += c.points;
      if (c.status !== 'dnf') best = Math.min(best, c.position);
    }
  }

  const record: RaceRecord = {
    round: state.round,
    trackId,
    podium: classification.slice(0, 3).map((c) => c.driver.id),
    bestPosition: best === 99 ? 0 : best,
    pointsScored: scored,
  };

  state.history.push(record);
  state.rp += rpFromResult(scored);
  state.round += 1;
  return record;
}

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

// ---- Збереження -----------------------------------------------------------

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
    if (parsed.version !== SAVE_VERSION) return null;
    if (!parsed.teamId || typeof parsed.round !== 'number') return null;
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
