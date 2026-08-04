// Детермінізм — фундамент усього. Без нього неможливі ні балансувальні
// прогони, ні «переграти цю гонку», ні відтворення багів за seed.

import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { Race } from '../src/sim/raceEngine.ts';
import { Rng } from '../src/sim/rng.ts';
import type { RaceLength } from '../src/sim/types.ts';

function fingerprint(trackId: string, length: RaceLength, seed: number): string {
  const race = new Race({
    track: TRACK_BY_ID.get(trackId)!,
    drivers: DRIVERS_2026,
    teams: TEAMS_2026,
    length,
    seed,
  });
  race.runToEnd();
  return race
    .classification()
    .map((c) => `${c.position}:${c.driver.id}:${c.totalTime.toFixed(6)}:${c.stops}`)
    .join('|');
}

describe('детермінізм', () => {
  it('той самий seed дає побайтово той самий результат', () => {
    for (const track of TRACKS_2026.slice(0, 8)) {
      for (const seed of [1, 42, 2026]) {
        expect(fingerprint(track.id, 100, seed)).toBe(fingerprint(track.id, 100, seed));
      }
    }
  });

  it('різні seed дають різні гонки', () => {
    const a = fingerprint('bahrain', 100, 1);
    const b = fingerprint('bahrain', 100, 2);
    expect(a).not.toBe(b);
  });

  it('довжина гонки не ламає відтворюваність', () => {
    for (const length of [25, 50, 100] as RaceLength[]) {
      expect(fingerprint('monza', length, 7)).toBe(fingerprint('monza', length, 7));
    }
  });

  it('RNG стабільний між запусками', () => {
    const seq = () => {
      const r = new Rng(12345);
      return Array.from({ length: 5 }, () => r.next());
    };
    expect(seq()).toEqual(seq());
    expect(seq()[0]).not.toBe(new Rng(12346).next());
  });

  it('fork не зсуває основний потік', () => {
    const a = new Rng(99);
    a.next();
    a.fork(7).next();
    const b = new Rng(99);
    b.next();
    expect(a.next()).toBe(b.next());
  });
});
