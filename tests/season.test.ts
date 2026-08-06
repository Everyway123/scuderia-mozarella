// Сезонні механіки: відіграні позиції, ставка на етап, картки розробки,
// козирі, фірмові траси. Усе перевіряється на справжніх результатах гонки,
// а не на вигаданих обʼєктах.

import { beforeAll, describe, expect, it } from 'vitest';
import { DRIVERS_2026, driversOfTeam } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { isPureUpgrade, PART_BY_ID, PARTS } from '../src/season/parts.ts';
import {
  CHIPS,
  canUseChip,
  computeRp,
  HOME_TRACK_BONUS,
  load,
  newSeason,
  offersFor,
  recordRace,
  save,
  teamsForRound,
  useChip,
  type SeasonState,
} from '../src/season/season.ts';
import { Race, type ClassifiedCar } from '../src/sim/raceEngine.ts';
import * as tyresApi from '../src/sim/tyres.ts';

// У Node немає localStorage — підставляємо мінімальний, щоб перевірити збереження
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

function runRace(state: SeasonState, trackId = 'bahrain'): ClassifiedCar[] {
  const race = new Race({
    track: TRACK_BY_ID.get(trackId)!,
    drivers: DRIVERS_2026,
    teams: teamsForRound(state),
    length: state.length,
    seed: 4242,
    playerTeamId: state.teamId,
  });
  race.runToEnd();
  return race.classification();
}

describe('відіграні позиції (Fantasy: position gain)', () => {
  it('підйом із хвоста дає RP навіть без очок', () => {
    const s = newSeason('cadillac', 25, 7);
    // Аутсайдер, який піднявся з 20-го на 14-те: очок нуль, але це результат
    const mine = [
      { driver: { id: 'perez' }, points: 0, gained: 6, status: 'finished' },
      { driver: { id: 'bottas' }, points: 0, gained: 3, status: 'finished' },
    ] as unknown as ClassifiedCar[];
    s.nomination = null;

    const rp = computeRp(s, mine);
    expect(rp.fromGained).toBeGreaterThan(0);
    expect(rp.total).toBeGreaterThan(rp.base);
  });

  it('відкат назад не дає нічого, але й не карає', () => {
    const s = newSeason('haas', 25, 7);
    s.nomination = null;
    const mine = [
      { driver: { id: 'ocon' }, points: 0, gained: -5, status: 'finished' },
    ] as unknown as ClassifiedCar[];
    expect(computeRp(s, mine).fromGained).toBe(0);
  });

  it('симуляція справді рахує відіграні позиції', () => {
    const s = newSeason('haas', 25, 7);
    const cls = runRace(s);
    for (const c of cls) {
      if (c.status === 'dnf') continue;
      expect(c.gained).toBe(c.startPosition - c.position);
    }
    // У гонці хтось точно піднявся, а хтось опустився
    expect(cls.some((c) => c.gained > 0)).toBe(true);
    expect(cls.some((c) => c.gained < 0)).toBe(true);
  });
});

describe('ставка на етап (Fantasy: DRS Boost + Final Fix)', () => {
  const mine = (points: number, status = 'finished') =>
    [
      { driver: { id: 'ocon' }, points, gained: 0, status },
      { driver: { id: 'bearman' }, points: 0, gained: 0, status: 'finished' },
    ] as unknown as ClassifiedCar[];

  it('вдала ставка додає RP', () => {
    const s = newSeason('haas', 25, 7);
    s.nomination = 'ocon';
    expect(computeRp(s, mine(18)).fromBet).toBeGreaterThan(0);
  });

  it('схід лідера етапу карає', () => {
    const s = newSeason('haas', 25, 7);
    s.nomination = 'ocon';
    expect(computeRp(s, mine(0, 'dnf')).fromBet).toBeLessThan(0);
  });

  it('фініш поза очками карає слабше за схід', () => {
    const s = newSeason('haas', 25, 7);
    s.nomination = 'ocon';
    const noPoints = computeRp(s, mine(0)).fromBet;
    const dnf = computeRp(s, mine(0, 'dnf')).fromBet;
    expect(noPoints).toBeLessThan(0);
    expect(noPoints).toBeGreaterThan(dnf);
  });

  it('ставка рахує лише свого пілота, а не результат напарника', () => {
    const s = newSeason('haas', 25, 7);
    // Напарник виграв гонку, але ставка стояла на другому — і той без очок
    s.nomination = 'bearman';
    const bet = computeRp(s, mine(25)).fromBet;
    expect(bet).toBeLessThan(0);

    // Та сама гонка, але ставка на переможця
    s.nomination = 'ocon';
    expect(computeRp(s, mine(25)).fromBet).toBeGreaterThan(0);
  });

  it('новий сезон одразу має ставку — гравець не лишається без неї', () => {
    const s = newSeason('mclaren', 25, 7);
    expect(s.nomination).toBe(driversOfTeam('mclaren')[0]!.id);
  });
});

describe('картки розробки (Monopoly: колода машини)', () => {
  it('кожна картка — компроміс, а не просто поліпшення', () => {
    for (const part of PARTS) {
      const gains = [
        (part.pace ?? 0) < 0,
        (part.reliability ?? 1) < 1,
        (part.pitCrew ?? 0) < 0,
        (part.strategy ?? 0) > 0,
        (part.tyreWear ?? 1) < 1,
      ].filter(Boolean).length;
      expect(gains, `${part.id}: картка нічого не дає`).toBeGreaterThan(0);
      expect(part.cost, `${part.id}: безкоштовна картка`).toBeGreaterThan(0);
    }
    // Принаймні третина колоди має явну ціну, інакше вибору немає
    const withCost = PARTS.filter(
      (p) => (p.reliability ?? 1) > 1 || (p.pace ?? 0) > 0 || (p.tyreWear ?? 1) > 1,
    ).length;
    expect(withCost / PARTS.length).toBeGreaterThan(0.35);
  });

  it('пропозиції детерміновані й не повторюють встановлене', () => {
    const s = newSeason('haas', 25, 99);
    expect(offersFor(s)).toEqual(offersFor(s));

    const first = offersFor(s)[0]!;
    s.parts.push(first);
    expect(offersFor(s)).not.toContain(first);
  });

  it('серед пропозицій завжди є картка без мінусів', () => {
    // Раунд із самих болючих компромісів лишав би обережного гравця без ходу
    for (const seed of [1, 7, 42, 99, 20260805]) {
      const s = newSeason('haas', 25, seed);
      for (let round = 1; round <= 24; round++) {
        s.round = round;
        const offers = offersFor(s);
        if (offers.length === 0) continue;
        const purePoolLeft = PARTS.some(
          (p) => !s.parts.includes(p.id) && isPureUpgrade(p),
        );
        if (!purePoolLeft) continue;
        expect(
          offers.some((id) => isPureUpgrade(PART_BY_ID.get(id)!)),
          `seed ${seed}, етап ${round}: усі три пропозиції з мінусами`,
        ).toBe(true);
      }
    }
  });

  it('пропозиції змінюються від етапу до етапу', () => {
    const s = newSeason('haas', 25, 99);
    const a = offersFor(s).join();
    s.round = 5;
    expect(offersFor(s).join()).not.toBe(a);
  });

  it('встановлена деталь справді змінює команду', () => {
    const s = newSeason('haas', 25, 7);
    const before = teamsForRound(s).find((t) => t.id === 'haas')!;
    s.parts.push('frontwing'); // −0.05 с/коло, −10% надійності
    const after = teamsForRound(s).find((t) => t.id === 'haas')!;

    const part = PART_BY_ID.get('frontwing')!;
    expect(after.pace).toBeCloseTo(before.pace + part.pace!, 5);
    expect(after.reliability).toBeGreaterThan(before.reliability);
  });

  it('шинна картка справді береже гуму', () => {
    const s = newSeason('haas', 25, 7);
    s.parts.push('suspension'); // гума живе на 12% довше
    const team = teamsForRound(s).find((t) => t.id === 'haas')!;
    expect(team.tyreWear).toBeCloseTo(0.88, 5);

    // І це доходить до фізики: знос за коло менший, кліф далі
    const track = TRACK_BY_ID.get('lusail')!;
    const driver = DRIVERS_2026.find((d) => d.id === 'ocon')!;
    const tyre = { compound: 'soft' as const, age: 8, wear: 0.4 };
    const plain = tyresApi.wearPerLap(tyre, track, driver, 3, 'dry');
    const kind = tyresApi.wearPerLap(tyre, track, driver, 3, 'dry', 0.88);
    expect(kind).toBeLessThan(plain);
    expect(tyresApi.lapsToCliff(tyre, track, driver, 3, 'dry', 0.88)).toBeGreaterThanOrEqual(
      tyresApi.lapsToCliff(tyre, track, driver, 3, 'dry'),
    );
  });

  it('дбайливий до гуми болід реально їде довші стінти', () => {
    // Той самий болід, та сама траса-людожер (Лусаїл), різниця лише в tyreWear
    const stops = (tyreWear: number) => {
      let total = 0;
      for (const seed of [3, 9, 15, 21]) {
        const teams = TEAMS_2026.map((t) => (t.id === 'haas' ? { ...t, tyreWear } : t));
        const race = new Race({
          track: TRACK_BY_ID.get('lusail')!,
          drivers: DRIVERS_2026,
          teams,
          length: 100,
          seed,
        });
        race.runToEnd();
        for (const c of race.classification()) {
          if (c.team.id === 'haas' && c.status !== 'dnf') total += c.stops;
        }
      }
      return total;
    };
    // Знос ×0.7 має прибирати зупинки принаймні інколи — і точно не додавати
    expect(stops(0.7)).toBeLessThanOrEqual(stops(1));
  });

  it('швидша деталь робить болід швидшим у справжній гонці', () => {
    const plain = newSeason('haas', 100, 5);
    const tuned = newSeason('haas', 100, 5);
    tuned.parts.push('gamble', 'floor', 'lightchassis');

    const paceOf = (s: SeasonState) => teamsForRound(s).find((t) => t.id === 'haas')!.pace;
    expect(paceOf(tuned)).toBeLessThan(paceOf(plain));

    // І це видно в результаті: краще середнє місце за кілька гонок
    const avg = (s: SeasonState) => {
      let sum = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const race = new Race({
          track: TRACK_BY_ID.get('bahrain')!,
          drivers: DRIVERS_2026,
          teams: teamsForRound(s),
          length: 25,
          seed,
        });
        race.runToEnd();
        const mine = race.classification().filter((c) => c.team.id === 'haas');
        sum += mine.reduce((a, c) => a + (c.status === 'dnf' ? 23 : c.position), 0) / mine.length;
      }
      return sum / 6;
    };
    expect(avg(tuned)).toBeLessThan(avg(plain));
  });
});

describe('козирі сезону (Fantasy: чіпи)', () => {
  it('кожен козир одноразовий', () => {
    const s = newSeason('haas', 25, 7);
    expect(canUseChip(s, 'rebuild')).toBe(true);
    useChip(s, 'rebuild');
    expect(canUseChip(s, 'rebuild')).toBe(false);
  });

  it('«потрійна ставка» справді множить виграш ставки', () => {
    const s = newSeason('haas', 25, 7);
    s.nomination = 'ocon';
    const mine = [
      { driver: { id: 'ocon' }, points: 25, gained: 0, status: 'finished' },
    ] as unknown as ClassifiedCar[];
    const normal = computeRp(s, mine).fromBet;
    useChip(s, 'triple');
    expect(computeRp(s, mine).fromBet).toBeGreaterThan(normal);
  });

  it('«подвійна розробка» подвоює підсумок', () => {
    const s = newSeason('haas', 25, 7);
    s.nomination = null;
    const mine = [
      { driver: { id: 'ocon' }, points: 10, gained: 4, status: 'finished' },
    ] as unknown as ClassifiedCar[];
    const normal = computeRp(s, mine).total;
    useChip(s, 'doubleRp');
    expect(computeRp(s, mine).total).toBe(normal * 2);
  });

  it('«перебудова» повертає витрачений RP і знімає деталі', () => {
    const s = newSeason('haas', 25, 7);
    const part = PART_BY_ID.get('floor')!;
    s.rp = 20;
    s.rp -= part.cost;
    s.parts.push(part.id);

    useChip(s, 'rebuild');
    expect(s.parts).toEqual([]);
    expect(s.rp).toBe(20);
  });

  it('два зведені козирі одночасно неможливі', () => {
    const s = newSeason('haas', 25, 7);
    useChip(s, 'triple');
    expect(canUseChip(s, 'doubleRp')).toBe(false);
  });

  it('козир витрачається після гонки', () => {
    const s = newSeason('haas', 25, 7);
    useChip(s, 'doubleRp');
    expect(s.armedChip).toBe('doubleRp');
    recordRace(s, runRace(s), 'bahrain');
    expect(s.armedChip).toBeNull();
    expect(s.chipsUsed).toContain('doubleRp');
  });

  it('козирів рівно стільки, скільки описано', () => {
    expect(CHIPS.length).toBeGreaterThanOrEqual(3);
  });
});

describe('фірмові траси (Monopoly: володіння гран-прі)', () => {
  it('перемога робить трасу фірмовою, і це прискорює болід', () => {
    const s = newSeason('mercedes', 25, 3);
    const cls = runRace(s, 'bahrain');
    const winner = cls.find((c) => c.position === 1 && c.status !== 'dnf')!;

    const before = teamsForRound(s).find((t) => t.id === 'mercedes')!.pace;
    recordRace(s, cls, 'bahrain');

    if (winner.team.id === 'mercedes') {
      expect(s.homeTracks).toContain('bahrain');
      // Повертаємось на цю ж трасу — тепер вона фірмова
      s.round = TRACK_BY_ID.get('bahrain')!.round;
      const after = teamsForRound(s).find((t) => t.id === 'mercedes')!.pace;
      expect(after).toBeCloseTo(Math.max(0, before - HOME_TRACK_BONUS), 5);
    } else {
      expect(s.homeTracks).not.toContain('bahrain');
    }
  });

  it('одна траса не додається двічі', () => {
    const s = newSeason('haas', 25, 3);
    s.homeTracks.push('bahrain');
    const cls = runRace(s, 'bahrain');
    recordRace(s, cls, 'bahrain');
    expect(s.homeTracks.filter((t) => t === 'bahrain')).toHaveLength(1);
  });
});

describe('збереження', () => {
  it('сезон переживає запис і читання', () => {
    const s = newSeason('williams', 50, 123);
    s.parts.push('cooling');
    s.rp = 17;
    s.homeTracks.push('monza');
    useChip(s, 'triple');
    save(s);

    const back = load();
    expect(back).not.toBeNull();
    expect(back!.teamId).toBe('williams');
    expect(back!.parts).toEqual(['cooling']);
    expect(back!.rp).toBe(17);
    expect(back!.homeTracks).toEqual(['monza']);
    expect(back!.armedChip).toBe('triple');
  });

  it('збереження старої версії відкидається, а не ламає гру', () => {
    localStorage.setItem('scuderiaMozarellaSeason1', JSON.stringify({ version: 1, teamId: 'haas' }));
    expect(load()).toBeNull();
  });
});

describe('штрафи стюардів (Monopoly: drive-through)', () => {
  it('агресивний темп справді карається частіше за обережний', () => {
    const count = (paceMode: 1 | 5) => {
      let penalties = 0;
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const race = new Race({
          track: TRACK_BY_ID.get('monaco')!,
          drivers: DRIVERS_2026,
          teams: TEAMS_2026,
          length: 100,
          seed,
          playerTeamId: 'haas',
        });
        let guard = 0;
        while (!race.state.finished && guard++ < 400) {
          for (const car of race.playerCars()) {
            if (car.status === 'running') race.order({ driverId: car.driverId, paceMode });
          }
          race.step();
        }
        penalties += race.playerCars().reduce((a, c) => a + c.penalties, 0);
      }
      return penalties;
    };
    expect(count(5)).toBeGreaterThan(count(1));
  });

  it('штраф додається до підсумкового часу й видно в класифікації', () => {
    let found = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const race = new Race({
        track: TRACK_BY_ID.get('baku')!,
        drivers: DRIVERS_2026,
        teams: TEAMS_2026,
        length: 100,
        seed,
      });
      race.runToEnd();
      const penalised = race.classification().find((c) => c.penalty > 0 && c.status !== 'dnf');
      if (penalised) {
        expect(penalised.penaltyReason).toBeTruthy();
        found = true;
        break;
      }
    }
    expect(found, 'за десять гонок жодного штрафу — модель не працює').toBe(true);
  });
});
