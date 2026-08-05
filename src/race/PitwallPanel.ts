// Пітвол: те, заради чого існує гра.
//
// Три важелі на машину — темп, енергія, Override — плюс піт-стоп із вибором
// суміші. Усе працює з затримкою в одне коло, як справжнє радіо: сказав зараз,
// пілот виконав на наступному колі.

import { COMPOUNDS, DRY_COMPOUNDS, ENERGY_LABEL, PACE_LABEL } from '../sim/constants.ts';
import type { Race } from '../sim/raceEngine.ts';
import { lapsToCliff } from '../sim/tyres.ts';
import type { CompoundId, EnergyMode, PaceMode } from '../sim/types.ts';
import type { RaceFrame } from './replay.ts';

const PACE_MODES: PaceMode[] = [1, 2, 3, 4, 5];
const ENERGY_MODES: EnergyMode[] = ['recover', 'balance', 'deploy'];

interface CardRefs {
  root: HTMLElement;
  pos: HTMLElement;
  gap: HTMLElement;
  tyre: HTMLElement;
  wearFill: HTMLElement;
  cliff: HTMLElement;
  bat: HTMLElement;
  batFill: HTMLElement;
  lastLap: HTMLElement;
  advice: HTMLElement;
  paceBtns: HTMLButtonElement[];
  energyBtns: HTMLButtonElement[];
  autoPaceBtn: HTMLButtonElement;
  overrideBtn: HTMLButtonElement;
  autoBtn: HTMLButtonElement;
  pitBtns: HTMLButtonElement[];
}

export class PitwallPanel {
  private readonly cards = new Map<string, CardRefs>();
  private readonly host: HTMLElement;
  private readonly race: Race;
  private forecastCells: HTMLElement | null = null;
  private forecastLap = -1;

  constructor(host: HTMLElement, race: Race) {
    this.host = host;
    this.race = race;
    this.build();
  }

  private build(): void {
    const cars = this.race.playerCars();
    if (cars.length === 0) {
      this.host.innerHTML = '<div class="pw-empty">Спостерігач: команда не обрана</div>';
      return;
    }

    const team = this.race.team(cars[0]!.teamId);
    this.host.innerHTML = `<div class="pw-head" style="--team:${team?.color ?? '#888'}">
      <b>ПІТВОЛ</b><span>${team?.name ?? ''}</span></div>
      <div class="pw-forecast" data-test="forecast" title="Прогноз: шанс дощу на наступні кола">
        <span class="pw-lbl">РАДАР</span><div class="fc-cells"></div>
      </div>`;
    this.forecastCells = this.host.querySelector('.fc-cells');

    for (const car of cars) {
      const driver = this.race.driver(car.driverId)!;
      const el = document.createElement('div');
      el.className = 'pw-card';
      el.dataset.driver = car.driverId;
      el.innerHTML = `
        <div class="pw-name">
          <span class="pw-num">${driver.number}</span>
          <b>${driver.name}</b>
          <span class="pw-pos" data-f="pos">—</span>
        </div>
        <div class="pw-strip">
          <span class="pw-tyre" data-f="tyre">—</span>
          <div class="pw-wear"><div data-f="wearFill"></div></div>
          <span class="pw-cliff" data-f="cliff"></span>
        </div>
        <div class="pw-strip">
          <span class="pw-lbl">⚡</span>
          <div class="pw-bat" data-f="bat"><div data-f="batFill"></div></div>
          <span class="pw-gap" data-f="gap">—</span>
          <span class="pw-lap mono" data-f="lastLap"></span>
        </div>

        <div class="pw-row" data-g="pace">
          <span class="pw-lbl">ТЕМП</span>
          <button class="pw-seg auto" data-f="autoPace" title="Віддати темп інженеру">А</button>
          ${PACE_MODES.map(
            (m) =>
              `<button class="pw-seg" data-pace="${m}" title="${PACE_LABEL[m]}">${m}</button>`,
          ).join('')}
        </div>
        <div class="pw-hint" data-f="paceHint">${PACE_LABEL[3]}</div>

        <div class="pw-row" data-g="energy">
          <span class="pw-lbl">ЕНЕРГІЯ</span>
          ${ENERGY_MODES.map(
            (m) =>
              `<button class="pw-seg wide" data-energy="${m}">${ENERGY_LABEL[m].slice(0, 4)}</button>`,
          ).join('')}
        </div>

        <div class="pw-row">
          <button class="pw-act override" data-f="override">⚡ OVERRIDE</button>
          <button class="pw-act auto on" data-f="auto">СТРАТЕГІЯ: АВТО</button>
        </div>

        <div class="pw-row pits">
          <span class="pw-lbl">БОКСИ</span>
          ${(['soft', 'medium', 'hard', 'inter', 'wet'] as CompoundId[])
            .map(
              (c) =>
                `<button class="pw-pit" data-pit="${c}" style="--c:${COMPOUNDS[c].color}" title="${COMPOUNDS[c].label}">${COMPOUNDS[c].label.slice(0, 1).toUpperCase()}</button>`,
            )
            .join('')}
        </div>
        <div class="pw-advice" data-f="advice"></div>
      `;
      this.host.appendChild(el);

      const q = <T extends HTMLElement>(f: string) => el.querySelector<T>(`[data-f="${f}"]`)!;
      const refs: CardRefs = {
        root: el,
        pos: q('pos'),
        gap: q('gap'),
        tyre: q('tyre'),
        wearFill: q('wearFill'),
        cliff: q('cliff'),
        bat: q('bat'),
        batFill: q('batFill'),
        lastLap: q('lastLap'),
        advice: q('advice'),
        paceBtns: [...el.querySelectorAll<HTMLButtonElement>('[data-pace]')],
        energyBtns: [...el.querySelectorAll<HTMLButtonElement>('[data-energy]')],
        autoPaceBtn: q<HTMLButtonElement>('autoPace'),
        overrideBtn: q<HTMLButtonElement>('override'),
        autoBtn: q<HTMLButtonElement>('auto'),
        pitBtns: [...el.querySelectorAll<HTMLButtonElement>('[data-pit]')],
      };
      this.cards.set(car.driverId, refs);
      this.wire(car.driverId, refs, el);
    }
  }

  private wire(driverId: string, refs: CardRefs, el: HTMLElement): void {
    for (const btn of refs.paceBtns) {
      btn.addEventListener('click', () => {
        const mode = Number(btn.dataset.pace) as PaceMode;
        this.race.order({ driverId, paceMode: mode });
        el.querySelector('[data-f="paceHint"]')!.textContent = PACE_LABEL[mode];
      });
    }
    for (const btn of refs.energyBtns) {
      btn.addEventListener('click', () => {
        this.race.order({ driverId, energyMode: btn.dataset.energy as EnergyMode });
      });
    }
    refs.autoPaceBtn.addEventListener('click', () => {
      this.race.order({ driverId, autoPace: true, override: false });
      el.querySelector('[data-f="paceHint"]')!.textContent = 'темпом керує інженер';
    });
    refs.overrideBtn.addEventListener('click', () => {
      const car = this.race.playerCars().find((c) => c.driverId === driverId);
      this.race.order({ driverId, override: !car?.overrideArmed });
    });
    refs.autoBtn.addEventListener('click', () => {
      const car = this.race.playerCars().find((c) => c.driverId === driverId);
      this.race.order({ driverId, autoStrategy: !car?.autoStrategy });
    });
    for (const btn of refs.pitBtns) {
      btn.addEventListener('click', () => {
        const compound = btn.dataset.pit as CompoundId;
        const car = this.race.playerCars().find((c) => c.driverId === driverId);
        // Повторний клік по тій самій суміші скасовує наказ
        const cancel = car?.pitRequest === compound;
        this.race.order({ driverId, pit: cancel ? null : compound });
      });
    }
  }

  /**
   * Радар погоди: шанс дощу на наступні кола. Це інформаційна перевага
   * гравця — ШІ прогноз не читає. Перемальовуємо лише коли коло змінилось:
   * прогноз детермінований від (seed, коло), тож частіше немає сенсу.
   */
  private renderForecast(): void {
    if (!this.forecastCells) return;
    const lap = this.race.state.lap;
    if (lap === this.forecastLap) return;
    this.forecastLap = lap;

    const fc = this.race.weatherForecast(6);
    this.forecastCells.innerHTML = fc
      .map((f) => {
        const level = f.chance >= 0.7 ? 'wet' : f.chance >= 0.4 ? 'maybe' : 'dry';
        const icon = level === 'wet' ? '🌧' : level === 'maybe' ? '🌥' : '☀';
        return `<span class="fc-cell ${level}" title="коло ${f.lap}: дощ ${Math.round(f.chance * 100)}%">${icon}</span>`;
      })
      .join('');
  }

  /** Наказати обом машинам заїхати — використовується у вікні сейфті-кара. */
  pitBoth(compound: CompoundId): void {
    for (const car of this.race.playerCars()) {
      if (car.status === 'dnf') continue;
      this.race.order({ driverId: car.driverId, pit: compound });
    }
  }

  /** Яку суміш логічно ставити зараз — для кнопок швидкого рішення. */
  suggestedCompound(frame: RaceFrame): CompoundId {
    if (frame.weather === 'rain') return 'wet';
    if (frame.weather === 'light-rain') return 'inter';
    const car = this.race.playerCars()[0];
    const advice = car ? this.race.advice(car.driverId) : null;
    if (advice?.nextCompound) return advice.nextCompound;
    const used = new Set(car?.compoundsUsed ?? []);
    return DRY_COMPOUNDS.find((c) => !used.has(c)) ?? 'medium';
  }

  render(frame: RaceFrame): void {
    this.renderForecast();
    for (const [driverId, refs] of this.cards) {
      const car = this.race.playerCars().find((c) => c.driverId === driverId);
      const sample = frame.cars.find((c) => c.driverId === driverId);
      if (!car || !sample) continue;

      const dnf = sample.status === 'dnf';
      refs.root.classList.toggle('is-out', dnf);
      refs.pos.textContent = dnf ? 'СХІД' : `P${sample.position}`;

      const spec = COMPOUNDS[sample.compound];
      refs.tyre.textContent = `${spec.label} ${sample.tyreAge}`;
      refs.tyre.style.color = spec.color;
      refs.wearFill.style.width = `${Math.min(100, sample.tyreWear * 100)}%`;
      refs.wearFill.style.background =
        sample.tyreWear > spec.cliff ? '#ff4d4d' : sample.tyreWear > spec.cliff * 0.75 ? '#ffd23f' : '#39ff88';

      const driver = this.race.driver(driverId)!;
      const toCliff = lapsToCliff(
        { compound: sample.compound, age: sample.tyreAge, wear: sample.tyreWear },
        this.race.track,
        driver,
        car.paceMode,
        frame.weather,
      );
      refs.cliff.textContent = sample.tyreWear > spec.cliff ? 'КЛІФ!' : `${toCliff} кіл`;
      refs.cliff.classList.toggle('bad', sample.tyreWear > spec.cliff);

      const pct = Math.max(0, Math.min(100, (sample.energyMJ / 4) * 100));
      refs.batFill.style.width = `${pct}%`;
      refs.batFill.style.background = pct < 22 ? '#ff4d4d' : pct < 50 ? '#ffd23f' : '#57e3ff';

      refs.gap.textContent =
        sample.interval === null ? 'лідер' : `+${sample.interval.toFixed(2)} до P${sample.position - 1}`;
      refs.lastLap.textContent = sample.lastLap ? sample.lastLap.toFixed(2) : '';

      for (const b of refs.paceBtns)
        b.classList.toggle('on', car.manualPace && Number(b.dataset.pace) === car.paceMode);
      refs.autoPaceBtn.classList.toggle('on', !car.manualPace);
      for (const b of refs.energyBtns) b.classList.toggle('on', b.dataset.energy === car.energyMode);

      // Override доступний лише в межах секунди від суперника — правило 2026
      const canOverride = (sample.interval ?? 99) <= 1.0 && car.overrideLeft > 0 && sample.energyMJ >= 0.5;
      refs.overrideBtn.disabled = dnf || !canOverride;
      refs.overrideBtn.classList.toggle('on', car.overrideArmed && canOverride);
      refs.overrideBtn.textContent = `⚡ OVERRIDE ×${car.overrideLeft}`;

      refs.autoBtn.classList.toggle('on', car.autoStrategy);
      refs.autoBtn.textContent = car.autoStrategy ? 'СТРАТЕГІЯ: АВТО' : 'СТРАТЕГІЯ: ВРУЧНУ';

      for (const b of refs.pitBtns) {
        b.classList.toggle('on', car.pitRequest === b.dataset.pit);
        b.disabled = dnf;
      }

      const advice = this.race.advice(driverId);
      if (dnf) refs.advice.textContent = '';
      else if (car.pitRequest)
        refs.advice.textContent = `→ бокси наступного кола: ${COMPOUNDS[car.pitRequest].label}`;
      else if (advice && Number.isFinite(advice.nextPitLap))
        refs.advice.textContent = `стратег: піт на колі ${advice.nextPitLap}${advice.nextCompound ? `, ${COMPOUNDS[advice.nextCompound].label}` : ''} (${advice.stops}-стоп)`;
      else refs.advice.textContent = 'стратег: до фінішу без заїздів';
    }
  }
}
