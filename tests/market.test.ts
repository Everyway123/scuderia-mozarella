// Ринок пілотів: детермінізм, цілісність грида, ціни й вимоги зірок,
// кар'єрний дрейф форми. Все — на справжніх даних, без моків.

import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import {
  applyOffseason,
  canSign,
  effectivePace,
  emptyMarket,
  freeAgents,
  marketDrivers,
  minConstructorRank,
  signingCost,
  teamOf,
  type MarketState,
} from '../src/season/market.ts';

/** Інваріант грида: у кожній команді рівно два пілоти, всі 22 при ділі. */
function assertGridIntact(market: MarketState): void {
  const seats = new Map<string, number>();
  for (const d of marketDrivers(market)) {
    seats.set(d.teamId, (seats.get(d.teamId) ?? 0) + 1);
  }
  expect(seats.size).toBe(TEAMS_2026.length);
  for (const team of TEAMS_2026) {
    expect(seats.get(team.id), `${team.id}: місць не 2`).toBe(2);
  }
}

describe('вільні агенти', () => {
  it('детерміновані від seed і не містять пілотів гравця', () => {
    const m = emptyMarket();
    const a = freeAgents(m, 42, 'haas');
    const b = freeAgents(m, 42, 'haas');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a.length).toBeLessThanOrEqual(7);
    for (const id of a) expect(teamOf(m, id)).not.toBe('haas');
  });

  it('різні міжсезоння — різний ринок', () => {
    const m0 = emptyMarket();
    const m1: MarketState = { ...emptyMarket(), seasonsPlayed: 1 };
    expect(freeAgents(m0, 42, 'haas')).not.toEqual(freeAgents(m1, 42, 'haas'));
  });
});

describe('ціни й вимоги', () => {
  it('швидший пілот дорожчий, межі 3..16 RP', () => {
    const m = emptyMarket();
    const sorted = [...DRIVERS_2026].sort((a, b) => a.pace - b.pace);
    const best = signingCost(m, sorted[0]!.id);
    const worst = signingCost(m, sorted[sorted.length - 1]!.id);
    expect(best).toBeGreaterThan(worst);
    for (const d of DRIVERS_2026) {
      const c = signingCost(m, d.id);
      expect(c).toBeGreaterThanOrEqual(3);
      expect(c).toBeLessThanOrEqual(16);
    }
  });

  it('зірка не йде в хвіст пелотона, середняк — куди завгодно', () => {
    const m = emptyMarket();
    // Еталон грида вимагає топ-4
    expect(minConstructorRank(m, 'verstappen')).toBe(4);
    expect(canSign(m, 'verstappen', 9, 99).ok).toBe(false);
    expect(canSign(m, 'verstappen', 3, 99).ok).toBe(true);
    // Найповільніші — без вимог
    const slowest = [...DRIVERS_2026].sort((a, b) => b.pace - a.pace)[0]!;
    expect(minConstructorRank(m, slowest.id)).toBeNull();
  });

  it('без RP підпис неможливий, і причина людська', () => {
    const m = emptyMarket();
    const res = canSign(m, 'verstappen', 1, 2);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('RP');
  });
});

describe('міжсезоння', () => {
  it('підпис — чесний обмін місцями, грид цілий', () => {
    const m = emptyMarket();
    const free = freeAgents(m, 7, 'haas');
    const hireId = free[0]!;
    const fromTeam = teamOf(m, hireId);
    const { market: next, news } = applyOffseason(m, 7, 'haas', {
      hireId,
      replaceId: 'ocon',
    });

    expect(teamOf(next, hireId)).toBe('haas');
    expect(teamOf(next, 'ocon')).toBe(fromTeam);
    assertGridIntact(next);
    expect(news.some((n) => n.includes('переходить'))).toBe(true);
  });

  it('без підпису грид теж живе (ШІ-обміни) і лишається цілим', () => {
    for (const seed of [1, 7, 42, 99]) {
      const { market: next } = applyOffseason(emptyMarket(), seed, 'haas', null);
      assertGridIntact(next);
      expect(next.seasonsPlayed).toBe(1);
    }
  });

  it('детерміновано: той самий seed — те саме міжсезоння', () => {
    const a = applyOffseason(emptyMarket(), 42, 'haas', null);
    const b = applyOffseason(emptyMarket(), 42, 'haas', null);
    expect(a.market).toEqual(b.market);
    expect(a.news).toEqual(b.news);
  });

  it('п\'ять сезонів поспіль: інваріанти тримаються, дрейф обмежений', () => {
    let m = emptyMarket();
    for (let i = 0; i < 5; i++) {
      m = applyOffseason(m, 20260805, 'williams', null).market;
      assertGridIntact(m);
    }
    expect(m.seasonsPlayed).toBe(5);
    for (const d of DRIVERS_2026) {
      const drift = m.paceDrift[d.id] ?? 0;
      expect(drift).toBeGreaterThanOrEqual(-0.25);
      expect(drift).toBeLessThanOrEqual(0.3);
      // Ефективний темп ніколи не від'ємний
      expect(effectivePace(m, d.id)).toBeGreaterThanOrEqual(0);
    }
    // Вік іде вперед
    const ham = marketDrivers(m).find((d) => d.id === 'hamilton')!;
    expect(ham.age).toBe(DRIVERS_2026.find((d) => d.id === 'hamilton')!.age + 5);
  });

  it('кар\'єрний напрямок: молодь у середньому росте, ветерани здають', () => {
    // Усереднюємо по багатьох seed — окремий сезон стохастичний
    let youngSum = 0;
    let vetSum = 0;
    const seeds = Array.from({ length: 30 }, (_, i) => i * 13 + 1);
    for (const seed of seeds) {
      let m = emptyMarket();
      for (let i = 0; i < 3; i++) m = applyOffseason(m, seed, 'haas', null).market;
      youngSum += m.paceDrift['antonelli'] ?? 0; // 19 років
      vetSum += m.paceDrift['alonso'] ?? 0; // 44 роки
    }
    expect(youngSum / seeds.length).toBeLessThan(-0.04);
    expect(vetSum / seeds.length).toBeGreaterThan(0.06);
  });
});
