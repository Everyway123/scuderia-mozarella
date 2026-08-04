// Міст між симуляцією і картинкою.
//
// Движок рахує гонку по колах — це дає точність і швидкість. Але на екрані
// машини мають їхати плавно. Цей шар накопичує знімок стану на кінець кожного
// кола і вміє відповісти на питання «де всі були на секунді T» — інтерполяцією
// між знімками. Симуляція про існування цього файлу не знає.

import type { Race } from '../sim/raceEngine.ts';
import type { CarStatus, CompoundId, FlagState, WeatherState } from '../sim/types.ts';

export interface LapSnapshot {
  /** Сумарний час від старту на кінець цього кола, с. */
  time: number;
  lapTime: number;
  compound: CompoundId;
  tyreAge: number;
  tyreWear: number;
  stops: number;
  energyMJ: number;
  status: CarStatus;
  /** Чи проїхав піт-лейн саме на цьому колі. */
  pitted: boolean;
}

export interface CarSample {
  driverId: string;
  teamId: string;
  /** Скільки кіл пройдено плюс частка поточного. Головна величина для порядку. */
  progress: number;
  /** Частка поточного кола, 0..1 — позиція на контурі траси. */
  fraction: number;
  lap: number;
  status: CarStatus;
  inPit: boolean;
  compound: CompoundId;
  tyreAge: number;
  tyreWear: number;
  stops: number;
  energyMJ: number;
  lastLap: number;
  /** Позиція в цю мить, 1..N. */
  position: number;
  /** Відставання від лідера, с. null для лідера й тих, хто зійшов. */
  gapToLeader: number | null;
  /** Інтервал до машини попереду, с. */
  interval: number | null;
}

export interface RaceFrame {
  simTime: number;
  leaderLap: number;
  totalLaps: number;
  weather: WeatherState;
  flag: FlagState;
  cars: CarSample[];
  finished: boolean;
}

/**
 * Наскільки треба випередити суперника в частках кола, щоб порядок змінився.
 * ~0.2 с на типовому колі — менше цього це шум інтерполяції, а не обгін.
 */
const ORDER_EPS = 0.0025;

export class RaceReplay {
  private readonly snaps = new Map<string, LapSnapshot[]>();
  private prevStops = new Map<string, number>();
  private readonly race: Race;
  /** Порядок із попереднього кадру — основа гістерезису. */
  private lastOrder: string[] = [];

  constructor(race: Race) {
    this.race = race;
    for (const car of race.state.cars) {
      this.snaps.set(car.driverId, []);
      this.prevStops.set(car.driverId, 0);
    }
  }

  /** Скільки секунд гонки вже прораховано для всіх, хто ще їде. */
  get bufferedUntil(): number {
    let min = Infinity;
    for (const car of this.race.state.cars) {
      if (car.status === 'dnf') continue;
      const list = this.snaps.get(car.driverId)!;
      min = Math.min(min, list.length ? list[list.length - 1]!.time : 0);
    }
    return min === Infinity ? Number.MAX_VALUE : min;
  }

  get finished(): boolean {
    return this.race.state.finished;
  }

  get totalLaps(): number {
    return this.race.state.totalLaps;
  }

  /** Прорахувати гонку вперед, поки всі не матимуть даних щонайменше до simTime. */
  ensureUpTo(simTime: number): void {
    let guard = 0;
    while (!this.race.state.finished && this.bufferedUntil < simTime && guard++ < 400) {
      this.race.step();
      this.capture();
    }
  }

  /** Знімок стану після щойно зробленого кроку. */
  private capture(): void {
    for (const car of this.race.state.cars) {
      const list = this.snaps.get(car.driverId)!;
      // Той, хто вже зійшов, більше не пише знімків
      if (list.length && list[list.length - 1]!.status === 'dnf') continue;

      const prev = this.prevStops.get(car.driverId) ?? 0;
      list.push({
        time: car.totalTime,
        lapTime: car.lastLap,
        compound: car.tyre.compound,
        tyreAge: car.tyre.age,
        tyreWear: car.tyre.wear,
        stops: car.stops,
        energyMJ: car.energyMJ,
        status: car.status,
        pitted: car.stops > prev,
      });
      this.prevStops.set(car.driverId, car.stops);
    }
  }

  /** Загальний час гонки — скільки триває найдовший заїзд. */
  totalRaceTime(): number {
    let max = 0;
    for (const list of this.snaps.values()) {
      const last = list[list.length - 1];
      if (last && last.status !== 'dnf') max = Math.max(max, last.time);
    }
    return max;
  }

  /**
   * Індекс кола, яке машина проїжджає в момент T, і частка цього кола.
   * Повертає null, якщо машина на той момент уже зійшла або ще не стартувала.
   */
  private locate(driverId: string, t: number): { lapIndex: number; fraction: number } | null {
    const list = this.snaps.get(driverId);
    if (!list || list.length === 0) return null;

    // Перше коло, яке закінчується пізніше за T — саме його машина зараз їде
    let i = 0;
    while (i < list.length && list[i]!.time <= t) i++;

    // Зійшов або фінішував — лишається там, де його застали
    if (i >= list.length) return { lapIndex: list.length - 1, fraction: 1 };

    const start = i === 0 ? 0 : list[i - 1]!.time;
    const end = list[i]!.time;
    const span = Math.max(1e-6, end - start);
    return { lapIndex: i, fraction: Math.max(0, Math.min(1, (t - start) / span)) };
  }

  /** Коли машина була в цій точці дистанції. Потрібно для чесних гапів. */
  private timeAtProgress(driverId: string, progress: number): number | null {
    const list = this.snaps.get(driverId);
    if (!list || list.length === 0) return null;

    const lapIndex = Math.floor(progress);
    const frac = progress - lapIndex;
    if (lapIndex >= list.length) return null;

    const start = lapIndex === 0 ? 0 : list[lapIndex - 1]!.time;
    const end = list[lapIndex]!.time;
    return start + frac * (end - start);
  }

  /** Стан усіх машин у момент T. Це те, що малює екран. */
  sample(simTime: number): RaceFrame {
    const cars: CarSample[] = [];

    for (const car of this.race.state.cars) {
      const loc = this.locate(car.driverId, simTime);
      if (!loc) continue;
      const list = this.snaps.get(car.driverId)!;
      const snap = list[loc.lapIndex]!;

      cars.push({
        driverId: car.driverId,
        teamId: car.teamId,
        progress: loc.lapIndex + loc.fraction,
        fraction: loc.fraction,
        lap: loc.lapIndex + 1,
        status: snap.status,
        // Піт-лейн проїжджається наприкінці кола — так це читається на мінімапі
        inPit: snap.pitted && loc.fraction > 0.72,
        compound: snap.compound,
        tyreAge: snap.tyreAge,
        tyreWear: snap.tyreWear,
        stops: snap.stops,
        energyMJ: snap.energyMJ,
        lastLap: snap.lapTime,
        position: 0,
        gapToLeader: null,
        interval: null,
      });
    }

    // Порядок — за пройденою дистанцією, а не за часом кола.
    // Саме тому позиції на екрані міняються посеред кола, як у житті.
    //
    // Але з гістерезисом: різниця менша за ORDER_EPS не міняє порядок.
    // Без цього під сейфті-каром, де пелотон стоїть у 0.9 с, вежа безперервно
    // смикається — і жоден справжній обгін у цьому шумі не видно.
    const alive = cars.filter((c) => c.status !== 'dnf');
    const dead = cars.filter((c) => c.status === 'dnf');
    const prev = new Map(this.lastOrder.map((id, i) => [id, i]));
    const bucket = (c: CarSample) => Math.round(c.progress / ORDER_EPS);
    alive.sort(
      (a, b) =>
        bucket(b) - bucket(a) ||
        (prev.get(a.driverId) ?? 99) - (prev.get(b.driverId) ?? 99),
    );
    this.lastOrder = alive.map((c) => c.driverId);
    alive.forEach((c, i) => {
      c.position = i + 1;
    });
    dead.forEach((c, i) => {
      c.position = alive.length + i + 1;
    });

    const leader = alive[0];
    if (leader) {
      for (const c of alive) {
        if (c === leader) continue;
        // Коли лідер був там, де зараз ця машина — різниця й є гап
        const leaderWasHere = this.timeAtProgress(leader.driverId, c.progress);
        c.gapToLeader = leaderWasHere === null ? null : Math.max(0, simTime - leaderWasHere);
      }
      for (let i = 1; i < alive.length; i++) {
        const me = alive[i]!;
        const ahead = alive[i - 1]!;
        const aheadWasHere = this.timeAtProgress(ahead.driverId, me.progress);
        me.interval = aheadWasHere === null ? null : Math.max(0, simTime - aheadWasHere);
      }
    }

    return {
      simTime,
      leaderLap: Math.min(this.race.state.totalLaps, leader ? Math.floor(leader.progress) + 1 : 1),
      totalLaps: this.race.state.totalLaps,
      weather: this.race.state.weather,
      flag: this.race.state.flag,
      cars: [...alive, ...dead],
      finished: this.race.state.finished,
    };
  }

  /** Події гонки до вказаного кола — для стрічки радіо в M4. */
  eventsUpToLap(lap: number) {
    return this.race.state.events.filter((e) => e.lap <= lap);
  }
}
