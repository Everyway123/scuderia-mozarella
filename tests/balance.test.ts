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
    expect(r.wins.size).toBeGreaterThanOrEqual(3);
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

// ---------------------------------------------------------------------------
// Калібрування ПО КОЖНІЙ ТРАСІ.
//
// Середнє по календарю — оманливе: воно однаково задоволене і правильною
// моделлю, і такою, де в Монако 60 обгонів, а в Монці 5. Тому кожна траса
// має власний профіль, і перевіряється саме він.
// ---------------------------------------------------------------------------

interface TrackProfile {
  /** Обгонів за гонку: [мін, макс]. */
  overtakes: [number, number];
  /** Піт-стопів на машину: [мін, макс]. */
  stops: [number, number];
  /** Гонок із опадами, %: [мін, макс]. */
  rain: [number, number];
}

/**
 * Очікування взяті з характеру справжніх етапів:
 * Монако не обганяють і зупиняються раз, Бахрейн їсть гуму,
 * у Сахарі не буває дощу, а Сільверстоун мокрий щодругий раз.
 */
const PROFILES: Record<string, TrackProfile> = {
  monaco: { overtakes: [0, 18], stops: [1.0, 1.9], rain: [5, 35] },
  hungaroring: { overtakes: [8, 35], stops: [1.5, 2.6], rain: [8, 35] },
  singapore: { overtakes: [15, 45], stops: [1.2, 2.3], rain: [18, 48] },
  zandvoort: { overtakes: [18, 48], stops: [1.4, 2.6], rain: [25, 55] },
  suzuka: { overtakes: [18, 48], stops: [1.2, 2.3], rain: [20, 50] },
  monza: { overtakes: [30, 62], stops: [1.1, 1.9], rain: [10, 38] },
  bahrain: { overtakes: [25, 58], stops: [1.6, 2.7], rain: [0, 15] },
  interlagos: { overtakes: [30, 62], stops: [1.8, 3.0], rain: [25, 55] },
  spielberg: { overtakes: [32, 65], stops: [1.8, 3.0], rain: [22, 52] },
  baku: { overtakes: [28, 58], stops: [1.0, 1.9], rain: [3, 25] },
  vegas: { overtakes: [25, 55], stops: [1.0, 1.9], rain: [0, 22] },
  jeddah: { overtakes: [18, 48], stops: [1.0, 1.9], rain: [0, 12] },
  spa: { overtakes: [25, 58], stops: [1.1, 2.0], rain: [32, 62] },
  silverstone: { overtakes: [28, 58], stops: [1.3, 2.4], rain: [40, 72] },
  barcelona: { overtakes: [22, 52], stops: [1.8, 3.0], rain: [0, 15] },
  lusail: { overtakes: [18, 48], stops: [1.6, 2.7], rain: [0, 12] },
  yasmarina: { overtakes: [25, 55], stops: [1.0, 2.0], rain: [0, 12] },
};

function profileOf(trackId: string, races: number) {
  const track = TRACK_BY_ID.get(trackId)!;
  let overtakes = 0;
  let dnfs = 0;
  let safetyCars = 0;
  let stops = 0;
  let finishers = 0;
  let wet = 0;

  for (let i = 0; i < races; i++) {
    const race = new Race({
      track,
      drivers: DRIVERS_2026,
      teams: TEAMS_2026,
      length: 100,
      seed: i * 9173 + track.round,
    });
    race.runToEnd();
    for (const e of race.state.events) {
      if (e.kind === 'overtake') overtakes++;
      else if (e.kind === 'dnf') dnfs++;
      else if (e.kind === 'safety-car') safetyCars++;
    }
    if (race.state.events.some((e) => e.kind === 'weather')) wet++;
    for (const c of race.classification()) {
      if (c.status !== 'dnf') {
        stops += c.stops;
        finishers++;
      }
    }
  }

  return {
    overtakes: overtakes / races,
    dnfs: dnfs / races,
    safetyCars: safetyCars / races,
    stops: stops / Math.max(1, finishers),
    rain: (wet / races) * 100,
  };
}

describe('калібрування по кожній трасі', () => {
  const RACES = 24;
  const measured = new Map<string, ReturnType<typeof profileOf>>();
  for (const track of TRACKS_2026) measured.set(track.id, profileOf(track.id, RACES));

  for (const [trackId, expected] of Object.entries(PROFILES)) {
    const track = TRACK_BY_ID.get(trackId)!;
    it(`${track.name}: обгони, заїзди й дощ у своєму діапазоні`, () => {
      const m = measured.get(trackId)!;
      expect(m.overtakes, 'обгонів за гонку').toBeGreaterThanOrEqual(expected.overtakes[0]);
      expect(m.overtakes, 'обгонів за гонку').toBeLessThanOrEqual(expected.overtakes[1]);
      expect(m.stops, 'піт-стопів на машину').toBeGreaterThanOrEqual(expected.stops[0]);
      expect(m.stops, 'піт-стопів на машину').toBeLessThanOrEqual(expected.stops[1]);
      expect(m.rain, 'гонок із опадами, %').toBeGreaterThanOrEqual(expected.rain[0]);
      expect(m.rain, 'гонок із опадами, %').toBeLessThanOrEqual(expected.rain[1]);
    });
  }

  it('характер трас упорядкований, а не випадковий', () => {
    const ot = (id: string) => measured.get(id)!.overtakes;
    // Монако — найважча траса календаря для обгону, і це має бути видно
    expect(ot('monaco')).toBeLessThan(ot('hungaroring'));
    expect(ot('hungaroring')).toBeLessThan(ot('monza'));
    expect(ot('monaco')).toBeLessThan(ot('spielberg') / 3);

    const st = (id: string) => measured.get(id)!.stops;
    // Знос гуми теж має розрізняти траси
    expect(st('bahrain')).toBeGreaterThan(st('monaco'));
    expect(st('barcelona')).toBeGreaterThan(st('vegas'));
    expect(st('spielberg')).toBeGreaterThan(st('baku'));
  });

  it('сходи однакові на всіх трасах — вони не залежать від кількості кіл', () => {
    // Монако має 78 кіл, Спа — 44. Раніше ризик задавався на коло, і Монако
    // видавало вдвічі більше сходів просто через довший список кіл.
    for (const track of TRACKS_2026) {
      const m = measured.get(track.id)!;
      expect(m.dnfs, `${track.name}: сходів за гонку`).toBeGreaterThan(0.8);
      expect(m.dnfs, `${track.name}: сходів за гонку`).toBeLessThan(3.6);
    }
    const all = TRACKS_2026.map((t) => measured.get(t.id)!.dnfs);
    // Розкид між найспокійнішою і найжорсткішою трасою — у межах розумного
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(1.6);
  });

  it('сейфті-кар частіший на вуличних трасах', () => {
    const street = TRACKS_2026.filter((t) => t.street);
    const permanent = TRACKS_2026.filter((t) => !t.street);
    const avg = (list: typeof street) =>
      list.reduce((a, t) => a + measured.get(t.id)!.safetyCars, 0) / list.length;
    expect(avg(street)).toBeGreaterThan(avg(permanent));
    for (const track of TRACKS_2026) {
      expect(measured.get(track.id)!.safetyCars, `${track.name}: SC`).toBeLessThan(1.1);
    }
  });
});
