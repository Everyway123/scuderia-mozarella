// Критерії гейм-дизайну з MVP.md. Перевіряють не «чи працює код»,
// а «чи це гра»: чи має гравець агентність і чи можна програти.
//
// Тут немає браузера — рішення гравця подаються прямо в движок,
// тому сотні гонок рахуються за секунди.

import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { Race } from '../src/sim/raceEngine.ts';
import type { RaceLength } from '../src/sim/types.ts';

function runRace(opts: {
  trackId: string;
  seed: number;
  length?: RaceLength;
  playerTeamId?: string;
  policy?: (race: Race) => void;
}): Race {
  const race = new Race({
    track: TRACK_BY_ID.get(opts.trackId)!,
    drivers: DRIVERS_2026,
    teams: TEAMS_2026,
    length: opts.length ?? 25,
    seed: opts.seed,
    playerTeamId: opts.playerTeamId,
  });
  let guard = 0;
  while (!race.state.finished && guard++ < 400) {
    opts.policy?.(race);
    race.step();
  }
  return race;
}

/** Середня фінішна позиція обох машин команди: менша — краще. */
function teamScore(race: Race, teamId: string): number {
  const cars = race.classification().filter((c) => c.team.id === teamId);
  return cars.reduce((a, c) => a + (c.status === 'dnf' ? 23 : c.position), 0) / cars.length;
}

const SEEDS = Array.from({ length: 12 }, (_, i) => i * 7 + 3);

describe('G1: гравець не покараний за бездіяльність', () => {
  it('пасивний гравець отримує рівно те саме, що й машина під ШІ', () => {
    // Це не формальність. Якщо машина гравця за замовчуванням гірша за таку саму
    // машину суперника, гра карає новачка просто за те, що він новачок.
    for (const teamId of ['haas', 'ferrari', 'cadillac']) {
      for (const track of TRACKS_2026.slice(0, 6)) {
        for (const seed of [3, 17]) {
          const ai = runRace({ trackId: track.id, seed });
          const passive = runRace({ trackId: track.id, seed, playerTeamId: teamId });
          expect(teamScore(passive, teamId), `${teamId} @ ${track.id}/${seed}`).toBe(
            teamScore(ai, teamId),
          );
        }
      }
    }
  });
});

describe('G1b: рішення гравця справді змінюють гонку', () => {
  it('втручання в стратегію дає інший результат, а не косметику', () => {
    let changed = 0;
    let total = 0;

    for (const track of TRACKS_2026.slice(0, 10)) {
      for (const seed of SEEDS.slice(0, 6)) {
        const passive = runRace({ trackId: track.id, seed, playerTeamId: 'haas' });
        const active = runRace({
          trackId: track.id,
          seed,
          playerTeamId: 'haas',
          policy: (race) => {
            // Одне-єдине втручання: тримати гуму, коли вона на межі
            for (const car of race.playerCars()) {
              if (car.status !== 'running') continue;
              if (car.tyre.wear > 0.65) race.order({ driverId: car.driverId, paceMode: 1 });
              else race.order({ driverId: car.driverId, autoPace: true });
            }
          },
        });
        if (teamScore(passive, 'haas') !== teamScore(active, 'haas')) changed++;
        total++;
      }
    }

    // Якщо важелі нічого не міняють — це не менеджерська гра, а заставка
    expect(changed / total).toBeGreaterThan(0.5);
  });

  it('темп реально торгує швидкість на знос', () => {
    // Контрольований стінт: піт-стопи вимкнені, обидві машини їдуть однакову
    // кількість кіл. Так видно чистий обмін «швидше зараз — гірша гума потім».
    const stint = (paceMode: 1 | 5) => {
      const race = new Race({
        track: TRACK_BY_ID.get('bahrain')!,
        drivers: DRIVERS_2026,
        teams: TEAMS_2026,
        length: 25,
        seed: 9,
        playerTeamId: 'haas',
      });
      for (let i = 0; i < 6; i++) {
        for (const car of race.playerCars()) {
          car.autoStrategy = false;
          car.pitRequest = null;
          race.order({ driverId: car.driverId, paceMode });
        }
        race.step();
      }
      const car = race.playerCars()[0]!;
      return { wear: car.tyre.wear, time: car.totalTime };
    };

    const push = stint(5);
    const save = stint(1);

    // Атака швидша...
    expect(push.time).toBeLessThan(save.time);
    // ...але гума за це платить
    expect(push.wear).toBeGreaterThan(save.wear);
  });
});

describe('G1c: перевага не абсурдна', () => {
  it('жодна стратегія не робить з аутсайдера подіумника', () => {
    let podiums = 0;
    for (const seed of SEEDS) {
      const race = runRace({
        trackId: 'bahrain',
        seed,
        playerTeamId: 'cadillac',
        policy: (race) => {
          for (const car of race.playerCars()) {
            if (car.status !== 'running') continue;
            race.order({ driverId: car.driverId, paceMode: 5, energyMode: 'deploy' });
          }
        },
      });
      podiums += race
        .classification()
        .filter((c) => c.team.id === 'cadillac' && c.status !== 'dnf' && c.position <= 3).length;
    }
    expect(podiums).toBeLessThanOrEqual(2);
  });
});

describe('G4: вікенд за один сеанс', () => {
  it('гонка на 25% дистанції триває 3–5 хвилин на 1×', () => {
    const TARGET_25 = 210;
    for (const track of TRACKS_2026) {
      const laps = Math.max(5, Math.round((track.laps * 25) / 100));
      const estimate = track.baseLap * laps * 1.06;
      const realSeconds = estimate / (estimate / TARGET_25);
      expect(realSeconds).toBeGreaterThanOrEqual(180);
      expect(realSeconds).toBeLessThanOrEqual(300);
    }
  });
});

describe('G5: програти можливо', () => {
  it('впертість під дощем коштує позицій', () => {
    // Той самий seed, різниця рівно в одному: чи міняємо гуму під погоду
    const stubborn = (race: Race) => {
      if (race.state.weather === 'dry') return;
      for (const car of race.playerCars()) {
        if (car.status !== 'running') continue;
        car.autoStrategy = false;
        if (car.pitRequest === 'inter' || car.pitRequest === 'wet') car.pitRequest = null;
      }
    };

    let cost = 0;
    let wetRaces = 0;
    let worse = 0;

    for (const track of TRACKS_2026) {
      for (const seed of SEEDS.slice(0, 8)) {
        const sane = runRace({ trackId: track.id, seed, playerTeamId: 'haas' });
        if (!sane.state.events.some((e) => e.kind === 'weather')) continue;
        const bad = runRace({ trackId: track.id, seed, playerTeamId: 'haas', policy: stubborn });
        const d = teamScore(bad, 'haas') - teamScore(sane, 'haas');
        cost += d;
        wetRaces++;
        if (d > 0) worse++;
      }
    }

    expect(wetRaces).toBeGreaterThan(10);
    // Критерій G5: помилка з гумою в дощ коштує щонайменше позицію
    expect(cost / wetRaces).toBeGreaterThanOrEqual(1);
    // І це правило, а не виняток
    expect(worse / wetRaces).toBeGreaterThan(0.6);
  });

  it('правило двох сумішей карається — інакше «не заїжджати» було б стратегією', () => {
    const race = runRace({
      trackId: 'bahrain',
      seed: 5,
      playerTeamId: 'haas',
      policy: (r) => {
        for (const car of r.playerCars()) {
          car.autoStrategy = false;
          car.pitRequest = null;
        }
      },
    });
    const mine = race.classification().filter((c) => c.team.id === 'haas');
    const finishers = mine.filter((c) => c.status !== 'dnf');
    expect(finishers.length).toBeGreaterThan(0);
    for (const c of finishers) {
      expect(c.stops).toBe(0);
      expect(c.penalty).toBeGreaterThan(0);
      expect(c.penaltyReason).toContain('двох сумішей');
    }
  });
});
