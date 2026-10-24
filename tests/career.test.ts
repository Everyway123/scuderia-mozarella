// Трофейна кімната: підсумок сезону, сумарні цифри, міграції сейвів.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  careerTotals,
  load,
  newSeason,
  summarizeSeason,
  type SeasonSummary,
} from '../src/season/season.ts';

// У Node немає localStorage — мінімальна підміна для тестів load()
const store = new Map<string, string>();
beforeEach(() => store.clear());
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

describe('підсумок сезону', () => {
  it('рахує рік, місце, перемоги й титули з історії та заліків', () => {
    const s = newSeason('haas', 25, 7);
    s.teamPoints = { haas: 300, mercedes: 200 };
    s.driverPoints = { ocon: 180, russell: 120 };
    s.history.push(
      { round: 1, trackId: 'melbourne', podium: ['ocon'], bestPosition: 1, pointsScored: 25, rpGained: 10, betPaid: true },
      { round: 2, trackId: 'shanghai', podium: [], bestPosition: 3, pointsScored: 15, rpGained: 8, betPaid: false },
      { round: 3, trackId: 'suzuka', podium: [], bestPosition: 11, pointsScored: 0, rpGained: 3, betPaid: false },
      { round: 4, trackId: 'bahrain', podium: [], bestPosition: 0, pointsScored: 0, rpGained: 3, betPaid: false },
    );
    const sum = summarizeSeason(s);
    expect(sum.year).toBe(2026);
    expect(sum.pos).toBe(1);
    expect(sum.points).toBe(300);
    expect(sum.wins).toBe(1);
    expect(sum.podiums).toBe(2);
    expect(sum.bestFinish).toBe(1);
    expect(sum.constructorsTitle).toBe(true);
    expect(sum.driversTitle).toBe(true); // ocon (haas) очолює залік пілотів
  });

  it('другий сезон кар\'єри має наступний рік', () => {
    const s = newSeason('haas', 25, 7);
    s.market.seasonsPlayed = 2;
    expect(summarizeSeason(s).year).toBe(2028);
  });
});

describe('сумарні цифри кар\'єри', () => {
  const season = (patch: Partial<SeasonSummary>): SeasonSummary => ({
    year: 2026,
    pos: 5,
    points: 80,
    wins: 1,
    podiums: 3,
    bestFinish: 1,
    constructorsTitle: false,
    driversTitle: false,
    ...patch,
  });

  it('додає сезони і рахує титули', () => {
    const t = careerTotals([
      season({ pos: 3 }),
      season({ pos: 1, constructorsTitle: true, driversTitle: true, wins: 6, points: 400 }),
    ]);
    expect(t.seasons).toBe(2);
    expect(t.titles).toBe(1);
    expect(t.driversTitles).toBe(1);
    expect(t.wins).toBe(7);
    expect(t.podiums).toBe(6);
    expect(t.points).toBe(480);
    expect(t.bestPos).toBe(1);
  });

  it('порожня кар\'єра — нулі', () => {
    expect(careerTotals([])).toEqual({
      seasons: 0, titles: 0, driversTitles: 0, wins: 0, podiums: 0, points: 0, bestPos: 0,
    });
  });
});

describe('міграції сейвів до v5', () => {
  it('v4 отримує порожню трофейну кімнату', () => {
    const s = newSeason('williams', 25, 1);
    const v4 = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    v4['version'] = 4;
    delete v4['career'];
    localStorage.setItem('scuderiaMozarellaSeason1', JSON.stringify(v4));
    const back = load();
    expect(back).not.toBeNull();
    expect(back!.version).toBe(5);
    expect(back!.career).toEqual([]);
  });

  it('v3 проходить увесь ланцюжок: teamDrift і career', () => {
    const s = newSeason('williams', 25, 1);
    const v3 = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    v3['version'] = 3;
    delete (v3['market'] as Record<string, unknown>)['teamDrift'];
    delete v3['career'];
    localStorage.setItem('scuderiaMozarellaSeason1', JSON.stringify(v3));
    const back = load();
    expect(back).not.toBeNull();
    expect(back!.version).toBe(5);
    expect(back!.market.teamDrift).toEqual({});
    expect(back!.career).toEqual([]);
  });

  it('кар\'єра переживає перехід між сезонами', () => {
    const s = newSeason('haas', 25, 7);
    s.teamPoints = { haas: 50, mercedes: 300 };
    const next = newSeason('haas', 25, 8, s.market, [...s.career, summarizeSeason(s)]);
    expect(next.career.length).toBe(1);
    expect(next.career[0]!.pos).toBe(2);
  });
});
