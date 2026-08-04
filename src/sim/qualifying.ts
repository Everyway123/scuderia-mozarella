// Квала: одне швидке коло на пілота. Дає стартову решітку.
// Коротко навмисно — це 60 секунд перед головною стравою, а не окрема гра.

import { COMPOUNDS } from './constants.ts';
import type { Rng } from './rng.ts';
import type { Driver, Team, Track } from './types.ts';

/** Наскільки пілот ризикує в кваліфікації. */
export type QualiRisk = 'safe' | 'edge' | 'all-in';

const RISK_GAIN: Record<QualiRisk, number> = {
  safe: +0.18,
  edge: 0,
  'all-in': -0.22,
};

/** Ймовірність зіпсувати коло (або поїхати в стіну на вуличній трасі). */
const RISK_FAIL: Record<QualiRisk, number> = {
  safe: 0.02,
  edge: 0.07,
  'all-in': 0.2,
};

export interface QualiResult {
  driverId: string;
  time: number;
  /** Коло зіпсоване — стартує з кінця. */
  spoiled: boolean;
}

export function runQualifying(
  track: Track,
  drivers: Driver[],
  teams: Map<string, Team>,
  rng: Rng,
  risks: Map<string, QualiRisk> = new Map(),
): QualiResult[] {
  // Квала їдеться на софті з мінімумом палива — звідси відрив від гоночного темпу
  const qualiBase = track.baseLap - 2.6 + COMPOUNDS.soft.offset;

  const results: QualiResult[] = drivers.map((d) => {
    const team = teams.get(d.teamId)!;
    const risk = risks.get(d.id) ?? 'edge';

    // На вуличній трасі ва-банк карається жорсткіше
    const failChance = RISK_FAIL[risk] * (track.street ? 1.5 : 1) * (1.4 - d.consistency);
    const spoiled = rng.chance(failChance);

    const noise = rng.gauss(0, 0.12 + 0.2 * (1 - d.consistency));
    const time =
      qualiBase + team.pace + d.pace + RISK_GAIN[risk] + noise + (spoiled ? rng.range(0.8, 2.5) : 0);

    return { driverId: d.id, time, spoiled };
  });

  results.sort((a, b) => a.time - b.time);
  return results;
}

export function gridFromQuali(results: QualiResult[]): string[] {
  return results.map((r) => r.driverId);
}
