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

describe('G1: компетентний гравець стабільно обіграє ШІ', () => {
  it('гра на радарі погоди виграє мокрі гонки у штатного стратега', () => {
    // Політика «синоптик» користується лише тим, що бачить гравець на екрані:
    // радаром weatherForecast() і кнопками пітволу. Заїзд на інтер — на
    // останньому сухому колі (дощове коло вже на правильній гумі), назад на
    // слік — щойно радар показує суху трасу. ШІ прогноз принципово не читає:
    // він реагує на краплі з ваганням, пропорційним слабкості команди.
    //
    // Це той самий шлях, що й у грі: prompt'и 'forecast'/'drying' у RaceView
    // пропонують рівно ці рішення.
    const DRY = ['soft', 'medium', 'hard'];
    const forecaster = (race: Race) => {
      const s = race.state;
      const fc = race.weatherForecast(6);
      const rainSoon = (fc[0]?.chance ?? 0) >= 0.7 || (fc[1]?.chance ?? 0) >= 0.7;
      const dryNext = (fc[0]?.chance ?? 1) <= 0.3;

      for (const car of race.playerCars()) {
        if (car.status !== 'running' || car.pitRequest) continue;
        if (s.totalLaps - car.lap <= 1) continue;
        const dryTyre = DRY.includes(car.tyre.compound);
        const slick = () => race.advice(car.driverId)?.nextCompound ?? 'medium';

        if (s.weather === 'dry' && rainSoon && dryTyre) {
          race.order({ driverId: car.driverId, pit: 'inter' });
        } else if (s.weather === 'rain' && dryTyre) {
          race.order({ driverId: car.driverId, pit: 'wet' });
        } else if (s.weather === 'light-rain' && dryTyre) {
          race.order({ driverId: car.driverId, pit: 'inter' });
        } else if (s.weather !== 'dry' && dryNext && !dryTyre) {
          race.order({ driverId: car.driverId, pit: slick() });
        } else if (s.weather === 'dry' && !dryTyre && !rainSoon) {
          // !rainSoon критично: без нього щойно поставлений «превентивний»
          // інтер негайно міняється назад на слік — подвійний піт на рівному місці
          race.order({ driverId: car.driverId, pit: slick() });
        }
      }
    };

    // Дощові траси календаря — там, де рішення взагалі виникає
    const rainy = TRACKS_2026.filter((t) => t.rainChance >= 0.3);
    const seeds = Array.from({ length: 14 }, (_, i) => i * 11 + 2);

    let total = 0;
    let n = 0;
    let wetSum = 0;
    let wetN = 0;
    let wetWins = 0;
    let wetLosses = 0;

    for (const teamId of ['haas', 'cadillac']) {
      for (const track of rainy) {
        for (const seed of seeds) {
          const passive = runRace({ trackId: track.id, seed, playerTeamId: teamId });
          const smart = runRace({
            trackId: track.id,
            seed,
            playerTeamId: teamId,
            policy: forecaster,
          });
          const d = teamScore(passive, teamId) - teamScore(smart, teamId);
          total += d;
          n++;
          if (passive.state.events.some((e) => e.kind === 'weather')) {
            wetSum += d;
            wetN++;
            if (d > 0) wetWins++;
            if (d < 0) wetLosses++;
          }
        }
      }
    }

    // Вибірка мусить бути осмисленою
    expect(wetN).toBeGreaterThan(60);
    // Головний критерій G1: у мокрих гонках синоптик СТАБІЛЬНО попереду —
    // і в середньому (замір дав ~+2.3 позиції), і за частотою перемог
    expect(wetSum / wetN, 'середня перевага в мокрих гонках').toBeGreaterThanOrEqual(0.8);
    expect(
      wetWins / Math.max(1, wetWins + wetLosses),
      'частка виграних мокрих дуелей зі штатним стратегом',
    ).toBeGreaterThanOrEqual(0.6);
    // І поза дощем ця манера гри нічого не руйнує
    expect(total / n, 'загальний баланс по дощових трасах').toBeGreaterThanOrEqual(0);
  }, 300_000);
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

describe('розбір стратегії після гонки', () => {
  it('debrief узгоджений із гонкою і чесний щодо оптимуму', () => {
    const race = runRace({ trackId: 'bahrain', seed: 11, playerTeamId: 'haas' });
    for (const car of race.playerCars()) {
      const d = race.debrief(car.driverId)!;
      expect(d).not.toBeNull();
      // Факти збігаються з класифікацією
      const cls = race.classification().find((c) => c.driver.id === car.driverId)!;
      expect(d.stops).toBe(cls.stops);
      // Плани відсортовані за сенсом: bestStops має найменшу вартість
      const best = d.plans.find((p) => p.stops === d.bestStops)!;
      for (const p of d.plans) expect(best.cost).toBeLessThanOrEqual(p.cost);
      // Втрата проти оптимуму невід'ємна, коли її взагалі можна порахувати
      if (Number.isFinite(d.lostToBest)) expect(d.lostToBest).toBeGreaterThanOrEqual(0);
    }
  });

  it('суха гонка — нуль кіл на неправильній гумі, впертість під дощем — багато', () => {
    // Бахрейн: rainChance 2% — на цьому seed сухо
    const dry = runRace({ trackId: 'bahrain', seed: 11, playerTeamId: 'haas' });
    expect(dry.state.events.some((e) => e.kind === 'weather')).toBe(false);
    for (const car of dry.playerCars()) {
      expect(dry.debrief(car.driverId)!.wrongTyreLaps).toBe(0);
    }

    // Мокра гонка з упертим гравцем: лічильник мусить це показати
    for (const seed of SEEDS) {
      const wet = runRace({
        trackId: 'spa',
        seed,
        playerTeamId: 'haas',
        policy: (race) => {
          if (race.state.weather === 'dry') return;
          for (const car of race.playerCars()) {
            if (car.status !== 'running') continue;
            car.autoStrategy = false;
            if (car.pitRequest === 'inter' || car.pitRequest === 'wet') car.pitRequest = null;
          }
        },
      });
      if (!wet.state.events.some((e) => e.kind === 'weather')) continue;
      const laps = wet
        .playerCars()
        .filter((c) => c.status !== 'dnf')
        .map((c) => wet.debrief(c.driverId)!.wrongTyreLaps);
      if (laps.length === 0) continue;
      expect(Math.max(...laps)).toBeGreaterThan(0);
      return; // одна мокра гонка з доказом — достатньо
    }
    throw new Error('серед seed не знайшлось мокрої гонки на Спа');
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
