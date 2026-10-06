// Командні накази і вибір стартової гуми — нові важелі гравця.
// Накази тестуються на мінімальному гриді з двох машин однієї команди:
// там умови «машини поруч» виконуються завжди, і тест перевіряє механіку,
// а не везіння конкретного seed.

import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { Race } from '../src/sim/raceEngine.ts';
import type { Driver, Team } from '../src/sim/types.ts';

const team: Team = {
  id: 'mia',
  name: 'Mia Racing',
  short: 'MIA',
  color: '#fff',
  accent: '#000',
  pace: 0.2,
  reliability: 0.05, // сходи тут не предмет тесту
  pitCrew: 2.4,
  pitCrewSd: 0.2,
  strategy: 0.9,
};

function driver(id: string, pace: number): Driver {
  return {
    id,
    name: id,
    short: id.slice(0, 3).toUpperCase(),
    number: 1,
    teamId: 'mia',
    pace,
    consistency: 0.9,
    tyreManagement: 0.8,
    overtaking: 0.8,
    defending: 0.5,
    wet: 0.7,
    aggression: 0.5,
    age: 28,
  };
}

function duoRace(grid: [string, string], paces: [number, number], order?: 'hold' | 'swap', seed = 11) {
  const drivers = [driver(grid[0], paces[0]), driver(grid[1], paces[1])];
  const race = new Race({
    track: TRACK_BY_ID.get('monza')!, // обгони легкі — без наказу швидший проходить
    drivers,
    teams: [team],
    length: 50,
    seed,
    grid: [...grid],
    playerTeamId: 'mia',
  });
  if (order) race.setTeamOrder(order);
  return race;
}

describe('командний наказ «тримати позиції»', () => {
  it('швидший напарник позаду не проходить — фінішний порядок = стартовий', () => {
    for (const seed of [3, 11, 42]) {
      const race = duoRace(['slow', 'fast'], [0.8, 0.0], 'hold', seed);
      race.runToEnd();
      const top = race.classification().filter((c) => c.status !== 'dnf');
      if (top.length < 2) continue; // схід — не про цей тест
      expect(top[0]!.driver.id).toBe('slow');
      // І між напарниками не було жодного обгону
      const swaps = race.state.events.filter(
        (e) => e.kind === 'overtake' && e.driverId === 'fast' && e.otherId === 'slow',
      );
      expect(swaps.length).toBe(0);
    }
  });

  it('без наказу той самий всесвіт закінчується обгоном — hold справді щось міняє', () => {
    let passed = 0;
    for (const seed of [3, 11, 42]) {
      const race = duoRace(['slow', 'fast'], [0.8, 0.0], undefined, seed);
      race.runToEnd();
      const top = race.classification().filter((c) => c.status !== 'dnf');
      if (top.length === 2 && top[0]!.driver.id === 'fast') passed++;
    }
    expect(passed).toBeGreaterThanOrEqual(2);
  });
});

describe('командний наказ «пропустити напарника»', () => {
  it('позиції міняються, наказ знімається сам, подія в ефірі', () => {
    const race = duoRace(['first', 'second'], [0.3, 0.3], undefined, 7);
    for (let i = 0; i < 5; i++) race.step();
    const leaderBefore = [...race.state.cars].sort((a, b) => a.position - b.position)[0]!.driverId;

    race.setTeamOrder('swap');
    let guard = 0;
    while (race.teamOrder() === 'swap' && !race.state.finished && guard++ < 30) race.step();

    expect(race.teamOrder()).toBe('free');
    const executed = race.state.events.find((e) => e.text.includes('Командний наказ виконано'));
    expect(executed).toBeTruthy();
    const leaderAfter = [...race.state.cars].sort((a, b) => a.position - b.position)[0]!.driverId;
    expect(leaderAfter).not.toBe(leaderBefore);
  });
});

describe('стартова гума', () => {
  it('вибір гравця застосовується і перепланованій стратегії вірить ШІ', () => {
    const track = TRACK_BY_ID.get('bahrain')!;
    // Якою була б стартова суміш за планом — щоб обрати іншу
    const base = new Race({
      track,
      drivers: DRIVERS_2026,
      teams: TEAMS_2026,
      length: 50,
      seed: 99,
      playerTeamId: 'williams',
    });
    const carBase = base.state.cars.find((c) => c.driverId === 'albon')!;
    const other = carBase.tyre.compound === 'soft' ? 'hard' : 'soft';

    const race = new Race({
      track,
      drivers: DRIVERS_2026,
      teams: TEAMS_2026,
      length: 50,
      seed: 99,
      playerTeamId: 'williams',
      startTyres: { albon: other },
    });
    const car = race.state.cars.find((c) => c.driverId === 'albon')!;
    expect(car.tyre.compound).toBe(other);
    expect(car.compoundsUsed).toEqual([other]);
    // План інженера починається з обраної суміші
    expect(race.advice('albon')).toBeTruthy();
    race.runToEnd();
    const cls = race.classification().find((c) => c.driver.id === 'albon')!;
    // Правило двох сумішей живе: у суху гонку фінішує без 30-секундного штрафу
    if (cls.status !== 'dnf' && !race.state.events.some((e) => e.kind === 'weather')) {
      expect(cls.penaltyReason).not.toBe('не виконано правило двох сумішей');
    }
  });

  it('гонка з вибором гуми лишається детермінованою', () => {
    const run = () => {
      const race = new Race({
        track: TRACK_BY_ID.get('monza')!,
        drivers: DRIVERS_2026,
        teams: TEAMS_2026,
        length: 50,
        seed: 123,
        playerTeamId: 'haas',
        startTyres: { ocon: 'soft', bearman: 'hard' },
      });
      race.runToEnd();
      return race
        .classification()
        .map((c) => `${c.position}:${c.driver.id}:${c.totalTime.toFixed(6)}`)
        .join('|');
    };
    expect(run()).toBe(run());
  });
});
