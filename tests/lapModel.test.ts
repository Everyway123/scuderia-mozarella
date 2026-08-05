// Модель кола має давати часи, схожі на реальні, і реагувати в правильний бік
// на кожен важіль. Це страховка від «покрутив константу — зламав фізику».

import { describe, expect, it } from 'vitest';
import { DRIVER_BY_ID } from '../src/data/drivers2026.ts';
import { TEAM_BY_ID } from '../src/data/teams2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { COMPOUNDS, FUEL_EFFECT } from '../src/sim/constants.ts';
import { computeLap } from '../src/sim/lapModel.ts';
import { Rng } from '../src/sim/rng.ts';
import { freshTyre, tyreDelta, wearPerLap } from '../src/sim/tyres.ts';
import type { CarState, Track } from '../src/sim/types.ts';

function car(overrides: Partial<CarState> = {}): CarState {
  return {
    driverId: 'verstappen',
    teamId: 'redbull',
    status: 'running',
    totalTime: 0,
    lap: 10,
    position: 1,
    startPosition: 1,
    tyre: freshTyre('medium'),
    fuelKg: 40,
    energyMJ: 4,
    overrideLeft: 8,
    overrideArmed: false,
    manualOverride: false,
    paceMode: 3,
    energyMode: 'balance',
    stops: 0,
    compoundsUsed: ['medium'],
    pitRequest: null,
    lastLap: 0,
    bestLap: Infinity,
    stuckLaps: 0,
    dnfReason: null,
    penalty: 0,
    penaltyReason: null,
    penalties: 0,
    wrongTyreLaps: 0,
    isPlayer: false,
    autoStrategy: true,
    manualPace: false,
    ...overrides,
  };
}

function lap(c: CarState, track: Track, seed = 1, gapAhead = Infinity): number {
  return computeLap(c, {
    track,
    driver: DRIVER_BY_ID.get(c.driverId)!,
    team: TEAM_BY_ID.get(c.teamId)!,
    weather: 'dry',
    flag: 'green',
    evolution: 0.5,
    gapAhead,
    rng: new Rng(seed),
  }).time;
}

describe('модель кола', () => {
  it('часи в межах ±6% від базового кола траси', () => {
    for (const track of TRACKS_2026) {
      const t = lap(car(), track);
      expect(t).toBeGreaterThan(track.baseLap * 0.94);
      expect(t).toBeLessThan(track.baseLap * 1.06);
    }
  });

  it('повний бак повільніший за порожній рівно на k_fuel × кг', () => {
    const track = TRACK_BY_ID.get('monza')!;
    const heavy = lap(car({ fuelKg: 70 }), track, 5);
    const light = lap(car({ fuelKg: 0 }), track, 5);
    expect(heavy - light).toBeCloseTo(70 * FUEL_EFFECT, 5);
  });

  it('атака швидша за збереження шин', () => {
    const track = TRACK_BY_ID.get('barcelona')!;
    expect(lap(car({ paceMode: 5 }), track, 3)).toBeLessThan(lap(car({ paceMode: 1 }), track, 3));
  });

  it('розгортання енергії швидше за рекуперацію', () => {
    const track = TRACK_BY_ID.get('monza')!;
    expect(lap(car({ energyMode: 'deploy' }), track, 3)).toBeLessThan(
      lap(car({ energyMode: 'recover' }), track, 3),
    );
  });

  it('Override працює лише в межах секунди від суперника', () => {
    const track = TRACK_BY_ID.get('monza')!;
    const inRange = lap(car({ overrideArmed: true }), track, 3, 0.6);
    const outOfRange = lap(car({ overrideArmed: true }), track, 3, 3.0);
    // поза зоною немає ні Override, ні брудного повітря — тож порівнюємо з ним же без зони
    const plain = lap(car({ overrideArmed: false }), track, 3, 0.6);
    expect(inRange).toBeLessThan(plain);
    expect(outOfRange).toBeGreaterThan(inRange);
  });

  it('порожня батарея карає темп', () => {
    const track = TRACK_BY_ID.get('baku')!;
    expect(lap(car({ energyMJ: 0, energyMode: 'deploy' }), track, 3)).toBeGreaterThan(
      lap(car({ energyMJ: 4, energyMode: 'deploy' }), track, 3),
    );
  });

  it('брудне повітря коштує часу', () => {
    const track = TRACK_BY_ID.get('hungaroring')!;
    expect(lap(car(), track, 3, 0.5)).toBeGreaterThan(lap(car(), track, 3, 5));
  });
});

describe('гума', () => {
  it('свіжий софт швидший за свіжий хард', () => {
    const track = TRACK_BY_ID.get('silverstone')!;
    const d = DRIVER_BY_ID.get('verstappen')!;
    expect(tyreDelta(freshTyre('soft'), track, d)).toBeLessThan(
      tyreDelta(freshTyre('hard'), track, d),
    );
  });

  it('софт зношується швидше за хард', () => {
    const track = TRACK_BY_ID.get('silverstone')!;
    const d = DRIVER_BY_ID.get('verstappen')!;
    expect(wearPerLap(freshTyre('soft'), track, d, 3, 'dry')).toBeGreaterThan(
      wearPerLap(freshTyre('hard'), track, d, 3, 'dry'),
    );
  });

  it('кліф різко додає втрати', () => {
    const track = TRACK_BY_ID.get('bahrain')!;
    const spec = COMPOUNDS.soft;
    const d = DRIVER_BY_ID.get('verstappen')!;
    const before = tyreDelta({ compound: 'soft', age: 15, wear: spec.cliff - 0.02 }, track, d);
    const after = tyreDelta({ compound: 'soft', age: 15, wear: 1 }, track, d);
    expect(after - before).toBeGreaterThan(2.5);
  });

  it('пілот, що береже гуму, зношує її повільніше', () => {
    const track = TRACK_BY_ID.get('bahrain')!;
    const good = DRIVER_BY_ID.get('alonso')!; // tyreManagement 0.95
    const bad = DRIVER_BY_ID.get('stroll')!; // 0.65
    expect(wearPerLap(freshTyre('medium'), track, good, 3, 'dry')).toBeLessThan(
      wearPerLap(freshTyre('medium'), track, bad, 3, 'dry'),
    );
  });

  it('суха гума в дощ горить кратно швидше', () => {
    const track = TRACK_BY_ID.get('spa')!;
    const d = DRIVER_BY_ID.get('verstappen')!;
    const dry = wearPerLap(freshTyre('medium'), track, d, 3, 'dry');
    const wet = wearPerLap(freshTyre('medium'), track, d, 3, 'rain');
    expect(wet / dry).toBeGreaterThan(2.5);
  });
});
