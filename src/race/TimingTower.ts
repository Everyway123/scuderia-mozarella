// Вежа часів — головний прилад гонки.
//
// Рядки створюються один раз і рухаються трансформом, а не перебудовою списку.
// Тому обгін видно як плавну перестановку, а не як миготіння — це та деталь,
// через яку таблиця відчувається живою трансляцією.

import { COMPOUNDS } from '../sim/constants.ts';
import type { Driver, Team } from '../sim/types.ts';
import type { CarSample, RaceFrame } from './replay.ts';

const ROW_H = 30;

interface Row {
  el: HTMLDivElement;
  pos: HTMLSpanElement;
  name: HTMLSpanElement;
  tyre: HTMLSpanElement;
  age: HTMLSpanElement;
  wear: HTMLDivElement;
  gap: HTMLSpanElement;
  battery: HTMLDivElement;
  index: number;
}

export class TimingTower {
  private readonly rows = new Map<string, Row>();
  private focusId: string | null = null;
  private readonly host: HTMLElement;
  private readonly teams: Map<string, Team>;
  private readonly drivers: Map<string, Driver>;
  private players = new Set<string>();

  constructor(host: HTMLElement, teams: Map<string, Team>, drivers: Map<string, Driver>) {
    this.host = host;
    this.teams = teams;
    this.drivers = drivers;
  }

  /** Машини гравця — їхні рядки підсвічуються, щоб «своїх» було видно одразу. */
  setPlayers(driverIds: string[]): void {
    this.players = new Set(driverIds);
  }

  setFocus(driverId: string | null): void {
    this.focusId = driverId;
  }

  /**
   * На прискоренні плавна перестановка не встигає: рядки їдуть 0.35 с,
   * а порядок міняється щокадру — виходить каша з накладених рядків.
   * Тому на 4× і вище рядки просто перестрибують.
   */
  setAnimated(on: boolean): void {
    this.host.classList.toggle('no-anim', !on);
  }

  private createRow(car: CarSample): Row {
    const team = this.teams.get(car.teamId)!;
    const driver = this.drivers.get(car.driverId)!;

    const el = document.createElement('div');
    el.className = 'tt-row';
    if (this.players.has(car.driverId)) el.classList.add('mine');
    el.style.setProperty('--team', team.color);

    const pos = document.createElement('span');
    pos.className = 'tt-pos';

    const bar = document.createElement('span');
    bar.className = 'tt-bar';

    const name = document.createElement('span');
    name.className = 'tt-name';
    name.textContent = driver.short;

    const tyre = document.createElement('span');
    tyre.className = 'tt-tyre';

    const age = document.createElement('span');
    age.className = 'tt-age';

    // Живий знос гуми — і суперників теж: рахувати чужі комплекти й ловити
    // момент чужого піта — це і є гра в стратегію (уклін Motorsport Manager)
    const wearWrap = document.createElement('div');
    wearWrap.className = 'tt-wear';
    const wear = document.createElement('div');
    wear.className = 'tt-wear-fill';
    wearWrap.appendChild(wear);

    const gap = document.createElement('span');
    gap.className = 'tt-gap';

    const batWrap = document.createElement('div');
    batWrap.className = 'tt-bat';
    const battery = document.createElement('div');
    battery.className = 'tt-bat-fill';
    batWrap.appendChild(battery);

    el.append(pos, bar, name, tyre, age, wearWrap, gap, batWrap);
    el.addEventListener('click', () => {
      this.focusId = this.focusId === car.driverId ? null : car.driverId;
    });
    this.host.appendChild(el);

    return { el, pos, name, tyre, age, wear, gap, battery, index: -1 };
  }

  get focus(): string | null {
    return this.focusId;
  }

  render(frame: RaceFrame): void {
    this.host.style.height = `${frame.cars.length * ROW_H}px`;

    frame.cars.forEach((car, i) => {
      let row = this.rows.get(car.driverId);
      if (!row) {
        row = this.createRow(car);
        this.rows.set(car.driverId, row);
      }

      if (row.index !== i) {
        row.el.style.transform = `translateY(${i * ROW_H}px)`;
        row.index = i;
      }

      const dnf = car.status === 'dnf';
      row.el.classList.toggle('is-out', dnf);
      row.el.classList.toggle('is-pit', car.inPit);
      row.el.classList.toggle('is-focus', car.driverId === this.focusId);

      row.pos.textContent = dnf ? '—' : String(car.position);

      const spec = COMPOUNDS[car.compound];
      row.tyre.textContent = spec.label.slice(0, 1).toUpperCase();
      row.tyre.style.color = spec.color;
      row.tyre.style.borderColor = spec.color;
      // Гума за кліфом блимає — це той момент, заради якого дивляться таблицю
      row.tyre.classList.toggle('is-cliff', car.tyreWear > spec.cliff);

      row.age.textContent = dnf ? '' : String(car.tyreAge);

      // Знос у лайві: зелений — свіжа, жовтий — підходить до кліфа, червоний — за ним
      const wearPct = Math.max(0, Math.min(100, car.tyreWear * 100));
      row.wear.style.width = dnf ? '0%' : `${wearPct}%`;
      row.wear.style.background =
        car.tyreWear > spec.cliff ? '#ff4d4d' : car.tyreWear > spec.cliff * 0.75 ? '#ffd23f' : '#39ff88';

      // «У ПІТАХ» замість інтервалу — щоб чужий заїзд було видно одним оком
      row.gap.classList.toggle('in-pit', car.pitting && !dnf);
      if (dnf) row.gap.textContent = 'СХІД';
      else if (car.pitting) row.gap.textContent = 'У ПІТАХ';
      else if (car.position === 1) row.gap.textContent = 'ЛІДЕР';
      else if (car.interval === null) row.gap.textContent = '—';
      else row.gap.textContent = `+${car.interval.toFixed(3)}`;

      const pct = Math.max(0, Math.min(100, (car.energyMJ / 4) * 100));
      row.battery.style.width = `${pct}%`;
      row.battery.style.background = pct < 22 ? '#ff4d4d' : pct < 50 ? '#ffd23f' : '#57e3ff';
    });
  }
}
