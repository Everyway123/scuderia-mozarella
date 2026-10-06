// Дуелі за посиланням: кодування має пережити месенджери, розбір — будь-яке
// сміття з чужого URL, а порівняння — бути чесним і повним.

import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACK_BY_ID } from '../src/data/tracks2026.ts';
import {
  compareDuel,
  decodeDuel,
  duelFromHash,
  duelResult,
  duelUrl,
  encodeDuel,
  isoWeek,
  weeklyRace,
  type DuelChallenge,
} from '../src/online/duel.ts';
import { Race } from '../src/sim/raceEngine.ts';

const sample: DuelChallenge = {
  v: 1,
  trackId: 'monza',
  length: 25,
  seed: 777,
  teamId: 'haas',
  name: "Андрій ⚔️ <script>",
  result: { points: 12, bestPos: 4, time: 1234.567 },
};

describe('кодування виклику', () => {
  it('туди-назад без втрат, і URL-безпечно', () => {
    const enc = encodeDuel(sample);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/); // жодних +, /, = — живе в hash
    const back = decodeDuel(enc);
    expect(back).toEqual(sample);
  });

  it('посилання збирається і розбирається з hash', () => {
    const url = duelUrl(sample, 'https://example.com/game/');
    expect(url.startsWith('https://example.com/game/#duel=')).toBe(true);
    const hash = url.slice(url.indexOf('#'));
    expect(duelFromHash(hash)).toEqual(sample);
  });

  it('сміття з чужого URL не ламає гру', () => {
    expect(decodeDuel('!!!')).toBeNull();
    expect(decodeDuel('aGVsbG8')).toBeNull(); // валідний base64, не JSON-виклик
    expect(duelFromHash('#duel=')).toBeNull();
    expect(duelFromHash('')).toBeNull();
    // Неіснуюча траса, крива довжина, відсутній результат
    const bad = (patch: Partial<DuelChallenge>) =>
      decodeDuel(encodeDuel({ ...sample, ...patch } as DuelChallenge));
    expect(bad({ trackId: 'nurburgring' })).toBeNull();
    expect(bad({ length: 33 as 25 })).toBeNull();
    expect(bad({ result: undefined as unknown as DuelChallenge['result'] })).toBeNull();
    expect(bad({ v: 2 as 1 })).toBeNull();
  });

  it('задовге ім\'я обрізається', () => {
    const back = decodeDuel(encodeDuel({ ...sample, name: 'x'.repeat(200) }));
    expect(back!.name!.length).toBeLessThanOrEqual(24);
  });
});

describe('порівняння дуелі', () => {
  const r = (points: number, bestPos: number, time: number) => ({ points, bestPos, time });

  it('очки головні, далі позиція, далі час, далі нічия', () => {
    expect(compareDuel(r(10, 5, 100), r(8, 1, 50))).toBe('win');
    expect(compareDuel(r(8, 1, 50), r(10, 5, 100))).toBe('lose');
    expect(compareDuel(r(10, 3, 100), r(10, 5, 50))).toBe('win');
    expect(compareDuel(r(10, 3, 100), r(10, 3, 99))).toBe('lose');
    expect(compareDuel(r(10, 3, 100), r(10, 3, 100))).toBe('draw');
  });
});

describe('результат дуелі з класифікації', () => {
  it('рахує очки обох машин і найкращий фініш', () => {
    const race = new Race({
      track: TRACK_BY_ID.get('monza')!,
      drivers: DRIVERS_2026,
      teams: TEAMS_2026,
      length: 25,
      seed: 777,
      playerTeamId: 'mercedes',
    });
    race.runToEnd();
    const cls = race.classification();
    const res = duelResult('mercedes', cls);
    const mine = cls.filter((c) => c.team.id === 'mercedes');
    expect(res.points).toBe(mine.reduce((a, c) => a + c.points, 0));
    const finishers = mine.filter((c) => c.status !== 'dnf');
    if (finishers.length > 0) {
      expect(res.bestPos).toBe(Math.min(...finishers.map((c) => c.position)));
      expect(res.time).toBeGreaterThan(0);
    } else {
      expect(res.bestPos).toBe(99);
    }
  });

  it('детермінізм дуелі: той самий виклик — та сама гонка в суперника', () => {
    const run = () => {
      const race = new Race({
        track: TRACK_BY_ID.get(sample.trackId)!,
        drivers: DRIVERS_2026,
        teams: TEAMS_2026,
        length: sample.length,
        seed: sample.seed,
        playerTeamId: sample.teamId,
      });
      race.runToEnd();
      return JSON.stringify(duelResult(sample.teamId, race.classification()));
    };
    expect(run()).toBe(run());
  });
});

describe('гонка тижня', () => {
  it('той самий день — той самий всесвіт, інший тиждень — інший', () => {
    const a = weeklyRace(new Date('2026-10-06'));
    const b = weeklyRace(new Date('2026-10-08')); // той самий ISO-тиждень
    const c = weeklyRace(new Date('2026-10-13')); // наступний
    expect(a).toEqual(b);
    expect(c.seed).not.toBe(a.seed);
    expect(TRACK_BY_ID.has(a.trackId)).toBe(true);
  });

  it('ISO-тиждень рахується правильно на межах року', () => {
    expect(isoWeek(new Date('2026-01-01'))).toEqual({ year: 2026, week: 1 });
    expect(isoWeek(new Date('2027-01-01'))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(new Date('2025-12-29'))).toEqual({ year: 2026, week: 1 });
  });
});
