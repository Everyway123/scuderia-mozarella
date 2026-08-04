// Баланс — головний тест проєкту. Тут перевіряється не «чи працює код»,
// а «чи цікаво в це грати»: чи корелює результат із темпом боліда,
// але не настільки, щоб гонку можна було не дивитись.

import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { Race } from '../src/sim/raceEngine.ts';
import type { RaceLength } from '../src/sim/types.ts';

function sweep(length: RaceLength, seedsPerTrack: number) {
  const wins = new Map<string, number>();
  const avgPos = new Map<string, number[]>();
  let races = 0;
  let overtakes = 0;
  let dnfs = 0;
  let safetyCars = 0;
  let stops = 0;
  let finishers = 0;

  for (const track of TRACKS_2026) {
    for (let seed = 1; seed <= seedsPerTrack; seed++) {
      const race = new Race({
        track,
        drivers: DRIVERS_2026,
        teams: TEAMS_2026,
        length,
        seed: seed * 7919 + track.round,
      });
      race.runToEnd();
      races++;

      for (const e of race.state.events) {
        if (e.kind === 'overtake') overtakes++;
        else if (e.kind === 'dnf') dnfs++;
        else if (e.kind === 'safety-car') safetyCars++;
      }

      const cls = race.classification();
      const winner = cls.find((c) => c.status !== 'dnf');
      if (winner) wins.set(winner.team.id, (wins.get(winner.team.id) ?? 0) + 1);

      for (const c of cls) {
        if (!avgPos.has(c.team.id)) avgPos.set(c.team.id, []);
        avgPos.get(c.team.id)!.push(c.position);
        if (c.status !== 'dnf') {
          stops += c.stops;
          finishers++;
        }
      }
    }
  }

  return { wins, avgPos, races, overtakes, dnfs, safetyCars, stops, finishers };
}

describe('баланс сезону', () => {
  const r = sweep(100, 5);

  it('швидший болід виграє частіше, але не завжди', () => {
    const top = [...TEAMS_2026].sort((a, b) => a.pace - b.pace)[0]!;
    const share = (r.wins.get(top.id) ?? 0) / r.races;
    // Домінування в 90% — це не гонки, а календар. Нижче 15% — темп нічого не значить.
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.75);
  });

  it('середня позиція корелює з темпом боліда', () => {
    const ranked = [...TEAMS_2026].sort((a, b) => a.pace - b.pace);
    const mean = (id: string) => {
      const xs = r.avgPos.get(id) ?? [];
      return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    };
    // Найшвидша команда мусить бути помітно попереду найповільнішої
    expect(mean(ranked[0]!.id)).toBeLessThan(mean(ranked.at(-1)!.id) - 6);
    // І топ-3 мають бути попереду нижньої трійки
    const topMean = ranked.slice(0, 3).reduce((a, t) => a + mean(t.id), 0) / 3;
    const botMean = ranked.slice(-3).reduce((a, t) => a + mean(t.id), 0) / 3;
    expect(topMean).toBeLessThan(botMean);
  });

  it('виграє не одна команда', () => {
    expect(r.wins.size).toBeGreaterThanOrEqual(4);
  });

  it('обгонів за гонку — як у справжній Ф1, а не карусель', () => {
    const per = r.overtakes / r.races;
    expect(per).toBeGreaterThan(20);
    expect(per).toBeLessThan(75);
  });

  it('сходів 1–3 за гонку', () => {
    const per = r.dnfs / r.races;
    expect(per).toBeGreaterThan(0.5);
    expect(per).toBeLessThan(3.5);
  });

  it('сейфті-кар не на кожній гонці', () => {
    const per = r.safetyCars / r.races;
    expect(per).toBeGreaterThan(0.15);
    expect(per).toBeLessThan(1.0);
  });

  it('піт-стопів на машину 1–3', () => {
    const per = r.stops / r.finishers;
    expect(per).toBeGreaterThan(1.0);
    expect(per).toBeLessThan(3.0);
  });
});

describe('короткі гонки лишаються гонками', () => {
  for (const length of [25, 50] as RaceLength[]) {
    it(`${length}% дистанції: є стратегія і є боротьба`, () => {
      const r2 = sweep(length, 2);
      expect(r2.stops / r2.finishers).toBeGreaterThan(0.9);
      expect(r2.overtakes / r2.races).toBeGreaterThan(5);
      expect(r2.wins.size).toBeGreaterThanOrEqual(2);
    });
  }

  it('спринт справді коротший за повну гонку', () => {
    const track = TRACK_BY_ID.get('silverstone')!;
    const short = new Race({
      track,
      drivers: DRIVERS_2026,
      teams: TEAMS_2026,
      length: 25,
      seed: 11,
    });
    const full = new Race({
      track,
      drivers: DRIVERS_2026,
      teams: TEAMS_2026,
      length: 100,
      seed: 11,
    });
    short.runToEnd();
    full.runToEnd();
    const t = (race: Race) => race.classification()[0]!.totalTime;
    expect(t(short)).toBeLessThan(t(full) * 0.35);
  });
});
