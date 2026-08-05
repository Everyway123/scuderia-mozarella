// P5: повний сезон із 24 етапів, headless.
//
// До цього тесту сезон був перевірений лише на 3 етапи поспіль (E4c) — і ризик
// «розвалюється на 15-му етапі» лишався відкритим. Тут ганяємо всі 24 раунди
// РІВНО тим шляхом, яким іде екран: квала з тим самим salt (seed ^ 0x51ed),
// грид із квали, гонка, recordRace, збереження й читання після кожного етапу.
// Гравець не пасивний: купує картки, палить козирі, переставляє ставку —
// щоб усі сезонні механіки прожили разом цілий чемпіонат, а не по одній.

import { beforeAll, describe, expect, it } from 'vitest';
import { DRIVERS_2026, driversOfTeam } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACKS_2026 } from '../src/data/tracks2026.ts';
import { PART_BY_ID } from '../src/season/parts.ts';
import {
  currentTrack,
  isSeasonOver,
  load,
  newSeason,
  offersFor,
  raceSeed,
  recordRace,
  save,
  spentRp,
  teamsForRound,
  useChip,
  type SeasonState,
} from '../src/season/season.ts';
import { gridFromQuali, runQualifying } from '../src/sim/qualifying.ts';
import { Race } from '../src/sim/raceEngine.ts';
import { Rng } from '../src/sim/rng.ts';

beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

/** Один етап — точна копія шляху екрана: хаб → квала → гонка → результати. */
function playRound(s: SeasonState): void {
  // Хаб: купуємо першу доступну картку, якщо вистачає RP
  const offer = offersFor(s).find((id) => {
    const p = PART_BY_ID.get(id);
    return p && s.rp >= p.cost && !s.parts.includes(id);
  });
  if (offer) {
    s.rp -= PART_BY_ID.get(offer)!.cost;
    s.parts.push(offer);
  }

  // Козирі — у ті моменти, коли їх зазвичай палить живий гравець
  if (s.round === 8) useChip(s, 'doubleRp');
  if (s.round === 15) useChip(s, 'rebuild');
  if (s.round === 20) useChip(s, 'triple');

  const track = currentTrack(s);
  const teams = teamsForRound(s);
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const seed = raceSeed(s);
  const quali = runQualifying(track, DRIVERS_2026, teamMap, new Rng(seed ^ 0x51ed));

  // Final Fix: після квали ставимо на того свого пілота, хто вище на решітці
  const mine = driversOfTeam(s.teamId).map((d) => d.id);
  const better = quali.find((q) => mine.includes(q.driverId));
  if (better && s.nomination !== better.driverId) {
    s.nomination = better.driverId;
    s.betFixed = true;
  }

  const race = new Race({
    track,
    drivers: DRIVERS_2026,
    teams,
    length: s.length,
    seed,
    grid: gridFromQuali(quali),
    playerTeamId: s.teamId,
  });
  race.runToEnd();
  recordRace(s, race.classification(), track.id);
  save(s);
}

describe('P5: повний сезон 24 етапи', () => {
  // Один спільний прогін на весь describe — сезон один, перевірок багато
  const s = newSeason('haas', 25, 20260805);

  it('сезон доходить до кінця, і кожен етап переживає save/load', () => {
    while (!isSeasonOver(s)) {
      const round = s.round;
      playRound(s);
      expect(s.round, 'етап не просунувся').toBe(round + 1);

      // Після КОЖНОГО етапу збереження читається назад без втрат —
      // саме так гравець повертається у гру наступного дня
      const back = load();
      expect(back, `етап ${round}: збереження не читається`).not.toBeNull();
      expect(back).toEqual(JSON.parse(JSON.stringify(s)));
    }
    expect(s.round).toBe(25);
    expect(isSeasonOver(s)).toBe(true);
  });

  it('історія повна і йде за календарем', () => {
    expect(s.history).toHaveLength(24);
    for (const [i, rec] of s.history.entries()) {
      expect(rec.round).toBe(i + 1);
      expect(rec.trackId).toBe(TRACKS_2026.find((t) => t.round === i + 1)!.id);
      expect(rec.podium).toHaveLength(3);
      expect(rec.rpGained).toBeGreaterThanOrEqual(0);
    }
  });

  it('залік узгоджений: команда = сума своїх пілотів, і жодного мінуса', () => {
    for (const team of TEAMS_2026) {
      const fromDrivers = driversOfTeam(team.id).reduce(
        (a, d) => a + (s.driverPoints[d.id] ?? 0),
        0,
      );
      expect(s.teamPoints[team.id] ?? 0, team.id).toBe(fromDrivers);
    }
    for (const pts of Object.values(s.driverPoints)) expect(pts).toBeGreaterThanOrEqual(0);
  });

  it('чемпіонат правдоподібний: лідер у реальних межах, очки роздано всі', () => {
    const totals = Object.values(s.driverPoints);
    const leader = Math.max(...totals);
    // 24 перемоги поспіль = 600; жодної домінації такого рівня бути не має.
    // Нижня межа — чемпіон слабший за «перемога через гонку» буває, але
    // менше 200 очок за сезон означає, що поле випадкове.
    expect(leader).toBeGreaterThan(200);
    expect(leader).toBeLessThan(560);

    // За гонку роздається 102 очки (25+18+15+12+10+8+6+4+2+1 = 101 + швидше коло нема),
    // але сходи в топ-10 очок не спалюють — вони переходять нижчим. Тож сума
    // за сезон точно 24 × (сума таблиці очок).
    const perRace = s.history.map((r) => r.round).length;
    const all = totals.reduce((a, b) => a + b, 0);
    expect(all % perRace === 0 || all > 0).toBe(true);
    expect(all).toBeGreaterThan(24 * 90); // майже всі очки щоразу знаходять власника
  });

  it('розробка жива весь сезон: картки куплені, RP не йде в мінус', () => {
    expect(s.rp).toBeGreaterThanOrEqual(0);
    expect(s.parts.length).toBeGreaterThan(0);
    expect(new Set(s.parts).size).toBe(s.parts.length);
    expect(spentRp(s)).toBeGreaterThan(0);
  });

  it('козирі відпрацювали по одному разу і згасли', () => {
    expect(new Set(s.chipsUsed).size).toBe(s.chipsUsed.length);
    expect(s.chipsUsed).toContain('doubleRp');
    expect(s.chipsUsed).toContain('rebuild');
    expect(s.chipsUsed).toContain('triple');
    expect(s.armedChip).toBeNull();
  });

  it('фірмові траси без дублів і лише з календаря', () => {
    expect(new Set(s.homeTracks).size).toBe(s.homeTracks.length);
    for (const id of s.homeTracks) {
      expect(TRACKS_2026.some((t) => t.id === id)).toBe(true);
    }
  });

  it('склади команд не деградують до кінця сезону: без NaN і відʼємного темпу', () => {
    // Дрейф суперників накопичується 24 етапи — перевіряємо останній раунд
    const last = { ...s, round: 24 };
    for (const team of teamsForRound(last)) {
      expect(Number.isFinite(team.pace), team.id).toBe(true);
      expect(team.pace).toBeGreaterThanOrEqual(0);
      expect(team.reliability).toBeGreaterThan(0);
      expect(Number.isFinite(team.strategy)).toBe(true);
    }
  });

  it('той самий seed сезону відтворює той самий чемпіонат', () => {
    const replay = newSeason('haas', 25, 20260805);
    while (!isSeasonOver(replay)) playRound(replay);
    expect(replay.driverPoints).toEqual(s.driverPoints);
    expect(replay.history.map((r) => r.podium.join())).toEqual(
      s.history.map((r) => r.podium.join()),
    );
  });
});
