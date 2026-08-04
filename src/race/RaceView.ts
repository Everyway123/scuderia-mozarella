// Екран гонки: годинник, мапа, вежа часів, шапка з колом і погодою.
//
// Годинник іде в секундах гонки, а не кадрах. Симуляція прораховується
// на кілька кіл наперед — тому прискорення чи перемотка нічого не ламають.

import { TRACK_BY_ID } from '../data/tracks2026.ts';
import { fmt, Race } from '../sim/raceEngine.ts';
import type { Driver, RaceLength, Team, Track } from '../sim/types.ts';
import { RaceReplay } from './replay.ts';
import { TimingTower } from './TimingTower.ts';
import { TrackMap } from './TrackMap.ts';

/** Скільки реального часу має тривати гонка на кожній довжині, с. */
const TARGET_DURATION: Record<RaceLength, number> = {
  25: 180,
  50: 420,
  100: 900,
};

const SPEEDS = [1, 2, 4, 8];

export interface RaceViewOptions {
  track: Track;
  drivers: Driver[];
  teams: Team[];
  length: RaceLength;
  seed: number;
  grid?: string[];
  onFinish: (race: Race) => void;
}

export class RaceView {
  private readonly race: Race;
  private readonly replay: RaceReplay;
  private readonly map: TrackMap;
  private readonly tower: TimingTower;
  private readonly teamMap: Map<string, Team>;
  private readonly driverMap: Map<string, Driver>;

  private simTime = 0;
  private baseSpeed: number;
  private speedIndex = 0;
  private playing = true;
  private lastFrame = 0;
  private raf = 0;
  private done = false;

  private readonly el: HTMLElement;
  private readonly lapEl: HTMLElement;
  private readonly flagEl: HTMLElement;
  private readonly weatherEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly opts: RaceViewOptions;

  constructor(host: HTMLElement, opts: RaceViewOptions) {
    this.opts = opts;
    this.teamMap = new Map(opts.teams.map((t) => [t.id, t]));
    this.driverMap = new Map(opts.drivers.map((d) => [d.id, d]));

    this.race = new Race({
      track: opts.track,
      drivers: opts.drivers,
      teams: opts.teams,
      length: opts.length,
      seed: opts.seed,
      grid: opts.grid,
    });
    this.replay = new RaceReplay(this.race);

    // Темп відтворення підбирається так, щоб гонка вклалась у цільову тривалість
    const estimate = opts.track.baseLap * this.race.totalLaps * 1.06;
    this.baseSpeed = estimate / TARGET_DURATION[opts.length];

    host.innerHTML = TEMPLATE;
    this.el = host;
    this.lapEl = host.querySelector('#lapCount')!;
    this.flagEl = host.querySelector('#flagState')!;
    this.weatherEl = host.querySelector('#weather')!;
    this.clockEl = host.querySelector('#raceClock')!;
    this.playBtn = host.querySelector('#playBtn')!;
    this.speedBtn = host.querySelector('#speedBtn')!;

    const canvas = host.querySelector<HTMLCanvasElement>('#trackCanvas')!;
    this.map = new TrackMap(canvas);
    this.map.setTrack(opts.track.id);

    this.tower = new TimingTower(
      host.querySelector<HTMLElement>('#tower')!,
      this.teamMap,
      this.driverMap,
    );

    host.querySelector('#trackName')!.textContent = opts.track.name;
    host.querySelector('#trackCountry')!.textContent = opts.track.country;

    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.speedBtn.addEventListener('click', () => this.cycleSpeed());
    host.querySelector('#skipBtn')!.addEventListener('click', () => this.skipToEnd());

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);

    this.map.resize();
    this.replay.ensureUpTo(60);
    this.lastFrame = performance.now();
    this.loop();
  }

  private onResize(): void {
    this.map.resize();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePlay();
    } else if (e.code === 'ArrowRight') {
      this.cycleSpeed();
    }
  }

  private togglePlay(): void {
    this.playing = !this.playing;
    this.playBtn.textContent = this.playing ? '⏸' : '▶';
  }

  private cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
    const speed = SPEEDS[this.speedIndex]!;
    this.speedBtn.textContent = `${speed}×`;
    this.tower.setAnimated(speed <= 2);
  }

  private skipToEnd(): void {
    this.replay.ensureUpTo(Number.MAX_SAFE_INTEGER);
    this.simTime = this.replay.totalRaceTime();
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.playing && !this.done) {
      this.simTime += dt * this.baseSpeed * SPEEDS[this.speedIndex]!;
      // Тримаємо буфер попереду картинки, щоб прискорення не впиралось у симуляцію
      this.replay.ensureUpTo(this.simTime + this.opts.track.baseLap * 3);
    }

    const total = this.replay.finished ? this.replay.totalRaceTime() : Infinity;
    if (this.simTime >= total) {
      this.simTime = total;
      if (!this.done) {
        this.done = true;
        this.playing = false;
        this.playBtn.textContent = '▶';
        this.el.querySelector('#flagState')!.textContent = '🏁 ФІНІШ';
        this.opts.onFinish(this.race);
      }
    }

    const frame = this.replay.sample(this.simTime);
    this.map.render(frame, this.teamMap, this.driverMap, this.tower.focus);
    this.tower.render(frame);

    this.lapEl.textContent = `${frame.leaderLap} / ${frame.totalLaps}`;
    this.clockEl.textContent = fmt(this.simTime);
    if (!this.done) {
      this.flagEl.textContent =
        frame.flag === 'safety-car'
          ? '🟡 СЕЙФТІ-КАР'
          : frame.flag === 'vsc'
            ? '🟡 VSC'
            : '🟢 ЗЕЛЕНИЙ';
      this.flagEl.className = frame.flag === 'green' ? 'flag green' : 'flag yellow';
    }
    this.weatherEl.textContent =
      frame.weather === 'dry' ? '☀️ суха' : frame.weather === 'light-rain' ? '🌦 дощ' : '🌧 злива';

    this.raf = requestAnimationFrame(this.loop);
  };

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.map.destroy();
  }
}

export function trackOrDefault(id: string): Track {
  return TRACK_BY_ID.get(id) ?? TRACK_BY_ID.get('bahrain')!;
}

const TEMPLATE = `
<div class="race-shell">
  <header class="race-head">
    <div class="race-title">
      <b id="trackName"></b><span id="trackCountry"></span>
    </div>
    <div class="race-meta">
      <span class="chip">коло <b id="lapCount">0 / 0</b></span>
      <span class="chip" id="weather">☀️ суха</span>
      <span class="flag green" id="flagState">🟢 ЗЕЛЕНИЙ</span>
      <span class="chip mono" id="raceClock">0.000</span>
    </div>
    <div class="race-ctrl">
      <button class="btn" id="playBtn">⏸</button>
      <button class="btn" id="speedBtn">1×</button>
      <button class="btn" id="skipBtn">⏭ до фінішу</button>
    </div>
  </header>

  <div class="race-body">
    <aside class="tower-wrap">
      <div class="tower-head"><span>ПОЗ</span><span>ПІЛОТ</span><span>ІНТЕРВАЛ</span></div>
      <div class="tower" id="tower"></div>
    </aside>
    <main class="map-wrap">
      <canvas id="trackCanvas"></canvas>
    </main>
  </div>
</div>
`;
