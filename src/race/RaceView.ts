// Екран гонки: годинник, мапа, вежа часів, пітвол, радіо, моменти рішення.
//
// Годинник іде в секундах гонки. Симуляція прораховується рівно до поточної
// миті й ні на коло далі — інакше наказ гравця застосувався б у вже
// порахованому майбутньому. Одне коло затримки — це і є радіо на пітволі.

import { fmt, Race } from '../sim/raceEngine.ts';
import type { CompoundId, Driver, RaceLength, Team, Track } from '../sim/types.ts';
import { PitwallPanel } from './PitwallPanel.ts';
import { RadioFeed } from './RadioFeed.ts';
import { RaceReplay } from './replay.ts';
import { TimingTower } from './TimingTower.ts';
import { TrackMap } from './TrackMap.ts';

/** Скільки реального часу має тривати гонка на кожній довжині, с. */
const TARGET_DURATION: Record<RaceLength, number> = {
  25: 210,
  50: 420,
  100: 840,
};

const SPEEDS = [1, 2, 4, 8];

/** Скільки реальних секунд дається на рішення. */
const PROMPT_SECONDS = 9;

interface Prompt {
  id: string;
  title: string;
  sub: string;
  actions: { label: string; act: () => void; primary?: boolean }[];
}

export interface RaceViewOptions {
  track: Track;
  drivers: Driver[];
  teams: Team[];
  length: RaceLength;
  seed: number;
  grid?: string[];
  playerTeamId?: string;
  onFinish: (race: Race) => void;
}

export class RaceView {
  readonly race: Race;
  private readonly replay: RaceReplay;
  private readonly map: TrackMap;
  private readonly tower: TimingTower;
  private readonly pitwall: PitwallPanel;
  private readonly radio: RadioFeed;
  private readonly teamMap: Map<string, Team>;
  private readonly driverMap: Map<string, Driver>;

  private simTime = 0;
  private readonly baseSpeed: number;
  private speedIndex = 0;
  private playing = true;
  private lastFrame = 0;
  private raf = 0;
  private done = false;

  /** Скільки разів гру зупиняли питанням — критерій G2. */
  promptCount = 0;
  private prompt: Prompt | null = null;
  private promptLeft = 0;
  private readonly firedPrompts = new Set<string>();
  private lastOverridePromptLap = -99;
  private overridePrompts = 0;


  private readonly lapEl: HTMLElement;
  private readonly flagEl: HTMLElement;
  private readonly weatherEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly promptEl: HTMLElement;
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
      playerTeamId: opts.playerTeamId,
    });
    this.replay = new RaceReplay(this.race);

    const estimate = opts.track.baseLap * this.race.totalLaps * 1.06;
    this.baseSpeed = estimate / TARGET_DURATION[opts.length];

    host.innerHTML = TEMPLATE;

    const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
    this.lapEl = q('#lapCount');
    this.flagEl = q('#flagState');
    this.weatherEl = q('#weather');
    this.clockEl = q('#raceClock');
    this.playBtn = q<HTMLButtonElement>('#playBtn');
    this.speedBtn = q<HTMLButtonElement>('#speedBtn');
    this.promptEl = q('#prompt');

    this.map = new TrackMap(q<HTMLCanvasElement>('#trackCanvas'));
    this.map.setTrack(opts.track.id);
    this.tower = new TimingTower(q('#tower'), this.teamMap, this.driverMap);
    this.pitwall = new PitwallPanel(q('#pitwall'), this.race);
    this.radio = new RadioFeed(q('#radio'), q('#banner'), this.race);

    q('#trackName').textContent = opts.track.name;
    q('#trackCountry').textContent = opts.track.country;

    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.speedBtn.addEventListener('click', () => this.cycleSpeed());
    q('#skipBtn').addEventListener('click', () => this.skipToEnd());

    this.onResize = this.onResize.bind(this);
    this.onKey = this.onKey.bind(this);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);

    this.map.resize();
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
    this.dismissPrompt();
    this.replay.ensureUpTo(Number.MAX_SAFE_INTEGER);
    this.simTime = this.replay.totalRaceTime();
  }

  // ---- Моменти рішення ------------------------------------------------

  /**
   * Гра зупиняється й питає лише коли рішення справді є. Порожні питання
   * знецінюють важливі — тому кожен тип спрацьовує обмежену кількість разів.
   */
  private checkPrompts(lap: number): void {
    if (this.prompt || this.done || this.race.playerCars().length === 0) return;
    const alive = this.race.playerCars().filter((c) => c.status !== 'dnf');
    if (alive.length === 0) return;

    const state = this.race.state;
    const compound = this.pitwall.suggestedCompound(this.replay.sample(this.simTime));

    // 1. Сейфті-кар — заїзд коштує вдвічі дешевше. Найдорожче вікно гонки.
    if (state.flag !== 'green' && !this.firedPrompts.has(`sc-${lap}`)) {
      this.firedPrompts.add(`sc-${lap}`);
      this.ask({
        id: 'sc',
        title: '🟡 СЕЙФТІ-КАР',
        sub: 'Вікно піту відкрите: заїзд зараз коштує вдвічі дешевше',
        actions: [
          {
            label: `Обидві в бокси (${compound})`,
            primary: true,
            act: () => this.pitwall.pitBoth(compound),
          },
          ...alive.map((c) => ({
            label: `Тільки ${this.driverMap.get(c.driverId)!.short}`,
            act: () => this.race.order({ driverId: c.driverId, pit: compound }),
          })),
          { label: 'Лишаємось на трасі', act: () => {} },
        ],
      });
      return;
    }

    // 2. Погода змінилась — не та гума коштує секунди на колі
    const weatherKey = `w-${state.weather}`;
    if (state.weather !== 'dry' && !this.firedPrompts.has(weatherKey)) {
      this.firedPrompts.add(weatherKey);
      this.ask({
        id: 'rain',
        title: state.weather === 'rain' ? '🌧 ЗЛИВА' : '🌦 ПІШОВ ДОЩ',
        sub: 'Суха гума на мокрій трасі втрачає секунди щокола',
        actions: [
          {
            label: `Обидві на ${compound}`,
            primary: true,
            act: () => this.pitwall.pitBoth(compound),
          },
          { label: 'Чекаємо, може підсохне', act: () => {} },
        ],
      });
      return;
    }

    // 3. Гума за кліфом — далі буде тільки гірше
    for (const car of alive) {
      const key = `cliff-${car.driverId}-${car.stops}`;
      if (this.firedPrompts.has(key)) continue;
      const spec = car.tyre;
      if (spec.wear <= 0.78) continue;
      this.firedPrompts.add(key);
      const short = this.driverMap.get(car.driverId)!.short;
      this.ask({
        id: 'cliff',
        title: `⚠ ${short}: ГУМА ЗАКІНЧУЄТЬСЯ`,
        sub: `Знос ${Math.round(spec.wear * 100)}% — за кліфом темп впаде різко`,
        actions: [
          {
            label: `У бокси (${compound})`,
            primary: true,
            act: () => this.race.order({ driverId: car.driverId, pit: compound }),
          },
          {
            label: 'Берегти й тягнути',
            act: () => this.race.order({ driverId: car.driverId, paceMode: 1 }),
          },
        ],
      });
      return;
    }

    // 4. Суперник у зоні Override — момент для атаки.
    //    На перших колах пелотон і так їде щільно, тож питати там немає сенсу:
    //    це був би спам, який знецінює справді важливі зупинки.
    if (lap >= 4 && this.overridePrompts < 2 && lap - this.lastOverridePromptLap >= 5) {
      const frame = this.replay.sample(this.simTime);
      for (const car of alive) {
        const s = frame.cars.find((c) => c.driverId === car.driverId);
        if (!s || s.interval === null || s.interval > 0.8) continue;
        if (car.overrideLeft <= 0 || car.energyMJ < 0.5) continue;
        this.overridePrompts++;
        this.lastOverridePromptLap = lap;
        const short = this.driverMap.get(car.driverId)!.short;
        const rival = frame.cars.find((c) => c.position === s.position - 1);
        const rivalShort = rival ? this.driverMap.get(rival.driverId)?.short ?? '' : '';
        this.ask({
          id: 'override',
          title: `⚡ ${short}: ${s.interval.toFixed(1)} ДО ${rivalShort}`,
          sub: `Override дає 0.55 с на колі. Лишилось ${car.overrideLeft} активацій`,
          actions: [
            {
              label: 'Атакувати',
              primary: true,
              act: () =>
                this.race.order({ driverId: car.driverId, override: true, paceMode: 4 }),
            },
            { label: 'Берегти енергію', act: () => {} },
          ],
        });
        return;
      }
    }
  }

  private ask(p: Prompt): void {
    this.prompt = p;
    this.promptLeft = PROMPT_SECONDS;
    this.promptCount++;
    this.playing = false;
    this.playBtn.textContent = '▶';

    this.promptEl.className = 'prompt on';
    // Стабільний гачок для E2E: заголовок може мінятись («ЗЛИВА» / «ПІШОВ ДОЩ»),
    // а вид рішення — ні
    this.promptEl.dataset.kind = p.id;
    this.promptEl.innerHTML = `
      <div class="prompt-title"></div>
      <div class="prompt-sub"></div>
      <div class="prompt-actions"></div>
      <div class="prompt-timer"><div id="promptBar"></div></div>`;
    this.promptEl.querySelector('.prompt-title')!.textContent = p.title;
    this.promptEl.querySelector('.prompt-sub')!.textContent = p.sub;

    const acts = this.promptEl.querySelector('.prompt-actions')!;
    p.actions.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = `btn${a.primary ? ' primary' : ''}`;
      b.dataset.act = String(i);
      b.textContent = a.label;
      b.addEventListener('click', () => {
        a.act();
        this.dismissPrompt();
        this.playing = true;
        this.playBtn.textContent = '⏸';
      });
      acts.appendChild(b);
    });
  }

  private dismissPrompt(): void {
    this.prompt = null;
    this.promptEl.className = 'prompt';
    delete this.promptEl.dataset.kind;
    this.promptEl.innerHTML = '';
  }

  // ---- Головний цикл --------------------------------------------------

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // Час на роздуми йде навіть коли гонка стоїть — рішення мусить бути швидким
    if (this.prompt) {
      this.promptLeft -= dt;
      const bar = this.promptEl.querySelector<HTMLElement>('#promptBar');
      if (bar) bar.style.width = `${Math.max(0, (this.promptLeft / PROMPT_SECONDS) * 100)}%`;
      if (this.promptLeft <= 0) {
        this.dismissPrompt();
        this.playing = true;
        this.playBtn.textContent = '⏸';
      }
    }

    if (this.playing && !this.done && !this.prompt) {
      this.simTime += dt * this.baseSpeed * SPEEDS[this.speedIndex]!;
      // Рахуємо рівно до поточної миті: наказ гравця має встигнути
      // на наступне коло, а не потрапити в уже прораховане майбутнє
      this.replay.ensureUpTo(this.simTime);
    }

    const total = this.replay.finished ? this.replay.totalRaceTime() : Infinity;
    if (this.simTime >= total) {
      this.simTime = total;
      if (!this.done) {
        this.done = true;
        this.playing = false;
        this.dismissPrompt();
        this.playBtn.textContent = '▶';
        this.flagEl.textContent = '🏁 ФІНІШ';
        this.opts.onFinish(this.race);
      }
    }

    const frame = this.replay.sample(this.simTime);
    this.map.render(frame, this.teamMap, this.driverMap, this.tower.focus);
    this.tower.render(frame);
    this.pitwall.render(frame);
    this.radio.update(frame.leaderLap, this.simTime);

    if (!this.done && !this.prompt) this.checkPrompts(frame.leaderLap);

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

  /** Для тестів і швидкого проходження: дограти без анімації. */
  finishNow(): void {
    this.skipToEnd();
  }

  pitBoth(compound: CompoundId): void {
    this.pitwall.pitBoth(compound);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.map.destroy();
  }
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
      <div class="banner" id="banner"></div>
      <div class="prompt" id="prompt"></div>
      <div class="radio" id="radio"></div>
    </main>

    <aside class="pitwall" id="pitwall"></aside>
  </div>
</div>
`;
