// Мінімапа траси на canvas: контур, зони Override, машини в справжніх позиціях.
//
// Геометрію рахує сам браузер — контур траси це SVGPathElement, у якого
// є getPointAtLength(). Тому «де саме на колі зараз машина» — це один виклик,
// а не власний движок кривих.

import { shapeOf, type TrackShape } from '../data/trackShapes.ts';
import { COMPOUNDS } from '../sim/constants.ts';
import type { Driver, Team } from '../sim/types.ts';
import type { CarSample, RaceFrame } from './replay.ts';

const VIEW_W = 1000;
const VIEW_H = 600;

export class TrackMap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly svg: SVGSVGElement;
  private readonly pathEl: SVGPathElement;
  private shape: TrackShape = shapeOf('');
  private length = 0;
  private outline: { x: number; y: number }[] = [];
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d недоступний');
    this.ctx = ctx;

    // Прихований SVG живе в документі — без цього getPointAtLength не працює
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('width', '0');
    this.svg.setAttribute('height', '0');
    this.svg.style.position = 'absolute';
    this.svg.style.opacity = '0';
    this.svg.style.pointerEvents = 'none';
    this.pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.svg.appendChild(this.pathEl);
    document.body.appendChild(this.svg);
  }

  setTrack(trackId: string): void {
    this.shape = shapeOf(trackId);
    this.pathEl.setAttribute('d', this.shape.path);
    this.length = this.pathEl.getTotalLength();

    // Кешуємо контур один раз — перемальовувати його щокадру немає сенсу
    const steps = 400;
    this.outline = Array.from({ length: steps + 1 }, (_, i) => {
      const p = this.pathEl.getPointAtLength((i / steps) * this.length);
      return { x: p.x, y: p.y };
    });
  }

  /** Точка на трасі за часткою кола, з урахуванням зсуву стартової прямої. */
  private pointAt(fraction: number): { x: number; y: number } {
    const f = (((fraction + this.shape.start) % 1) + 1) % 1;
    const p = this.pathEl.getPointAtLength(f * this.length);
    return { x: p.x, y: p.y };
  }

  /** Нормаль до траси — щоб зсунути машину на піт-лейн або рознести дуель. */
  private normalAt(fraction: number): { x: number; y: number } {
    const f = (((fraction + this.shape.start) % 1) + 1) % 1;
    const d = 2 / this.length;
    const a = this.pathEl.getPointAtLength(((f - d + 1) % 1) * this.length);
    const b = this.pathEl.getPointAtLength(((f + d) % 1) * this.length);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  private fit(): { scale: number; ox: number; oy: number } {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pad = 26;
    const scale = Math.min((w - pad * 2) / VIEW_W, (h - pad * 2) / VIEW_H);
    return {
      scale,
      ox: (w - VIEW_W * scale) / 2,
      oy: (h - VIEW_H * scale) / 2,
    };
  }

  /** Підігнати буфер під розмір елемента й щільність пікселів. */
  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(320, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(240, Math.round(rect.height * dpr));
  }

  render(
    frame: RaceFrame,
    teams: Map<string, Team>,
    drivers: Map<string, Driver>,
    focusId: string | null,
    playerIds: ReadonlySet<string> = new Set(),
  ): void {
    const { ctx } = this;
    const { scale, ox, oy } = this.fit();

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    this.drawRibbon(frame);
    this.drawOverrideZones();
    this.drawStartLine();
    this.drawCars(frame, teams, drivers, focusId, scale, playerIds);

    ctx.restore();
  }

  private drawRibbon(frame: RaceFrame): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < this.outline.length; i++) {
      const p = this.outline[i]!;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();

    // Полотно траси
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 26;
    ctx.strokeStyle = '#20242c';
    ctx.stroke();

    ctx.lineWidth = 20;
    ctx.strokeStyle = frame.weather === 'dry' ? '#2f353f' : '#2a3444';
    ctx.stroke();

    // Мокра траса блищить
    if (frame.weather !== 'dry') {
      ctx.lineWidth = 6;
      ctx.strokeStyle = frame.weather === 'rain' ? '#3d5f8a' : '#334d6e';
      ctx.stroke();
    }

    // Під жовтими прапорами — тонка пунктирна облямівка, а не заливка:
    // широкий жовтий шар робив із траси брудну пляму
    if (frame.flag !== 'green') {
      ctx.save();
      ctx.setLineDash([14, 12]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 210, 63, 0.85)';
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawOverrideZones(): void {
    const { ctx } = this;
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(87, 227, 255, 0.5)';

    for (const [from, to] of this.shape.override) {
      ctx.beginPath();
      const steps = Math.max(4, Math.round((to - from) * 120));
      for (let i = 0; i <= steps; i++) {
        const f = from + ((to - from) * i) / steps;
        const p = this.pointAt(f - this.shape.start);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  private drawStartLine(): void {
    const { ctx } = this;
    const p = this.pointAt(0);
    const n = this.normalAt(0);
    ctx.beginPath();
    ctx.moveTo(p.x - n.x * 15, p.y - n.y * 15);
    ctx.lineTo(p.x + n.x * 15, p.y + n.y * 15);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  private drawCars(
    frame: RaceFrame,
    teams: Map<string, Team>,
    drivers: Map<string, Driver>,
    focusId: string | null,
    scale: number,
    playerIds: ReadonlySet<string>,
  ): void {
    const { ctx } = this;
    const draw = this.spreadForDisplay(frame);
    // Малюємо з хвоста, щоб лідер і машина гравця лягли зверху
    const order = [...frame.cars].sort((a, b) => a.progress - b.progress);
    const placed: { x: number; y: number }[] = [];
    const labels: { x: number; y: number }[] = [];

    for (const car of order) {
      if (car.status === 'dnf') continue;
      const team = teams.get(car.teamId);
      const driver = drivers.get(car.driverId);
      if (!team || !driver) continue;

      const pos = this.carPoint(car, draw.get(car.driverId) ?? car.fraction);
      const focused = car.driverId === focusId;
      const isMine = playerIds.has(car.driverId);
      const r = focused || isMine ? 10 : 8;

      // Ореол: навколо машини, за якою стежимо, і навколо своїх —
      // «де наша стратегія» має читатись з мапи одним поглядом
      if (focused || isMine) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = isMine ? 'rgba(87,227,255,0.20)' : 'rgba(255,255,255,0.14)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = car.inPit ? '#555b66' : team.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = focused || isMine ? '#ffffff' : 'rgba(0,0,0,0.55)';
      ctx.stroke();

      // Обідок кольору суміші — видно стратегію просто на мапі
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 3.5, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = COMPOUNDS[car.compound].color;
      ctx.stroke();

      // Підпис ставимо тільки якщо він не влізе в кашу з сусідами.
      // На старті пелотон стоїть щільно — там читається сама мапа, не імена.
      // Свої машини підписані ЗАВЖДИ.
      const crowded = placed.some((p) => Math.hypot(p.x - pos.x, p.y - pos.y) < 46);
      placed.push(pos);
      if (crowded && !focused && !isMine && car.position > 3) continue;

      // Якщо над машиною підпис зіткнеться з уже намальованим (топ-3 у
      // щільному поїзді) — перекидаємо його під машину
      let ly = pos.y - r - 12;
      if (labels.some((l) => Math.abs(l.x - pos.x) < 52 && Math.abs(l.y - ly) < 24)) {
        ly = pos.y + r + 13;
      }
      labels.push({ x: pos.x, y: ly });

      ctx.fillStyle = focused || isMine ? '#ffffff' : 'rgba(255,255,255,0.82)';
      ctx.font = `700 ${Math.round(13 / Math.max(0.35, scale) + 5)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(6,8,11,0.85)';
      ctx.strokeText(driver.short, pos.x, ly);
      ctx.fillText(driver.short, pos.x, ly);
    }
  }

  /**
   * Позиції для малювання, рознесені на мінімальну відстань.
   *
   * Гапи в 0.3 секунди — це чесно, але на контурі кільця 22 машини в такому
   * поїзді зливаються в одну пляму. Тому для картинки сусідів розсовуємо,
   * зберігаючи порядок. Цифри у вежі часів лишаються справжніми.
   */
  private spreadForDisplay(frame: RaceFrame): Map<string, number> {
    const minGap = 24 / Math.max(1, this.length);
    const out = new Map<string, number>();

    // Рахуємо на progress (кола + частка), а не на частці кола: progress
    // монотонно спадає вздовж пелотона й не має шва 1→0. Стара версія
    // працювала на fraction — і на стартовій лінії сусіди мінялись місцями,
    // формула відстані плуталась, і поїзд сейфті-кара злипався в одну пляму.
    let prev: number | null = null;
    for (const car of frame.cars) {
      if (car.status === 'dnf') continue;
      let p = car.progress;
      // Той, хто позаду, не може бути ближче за minGap до попереднього.
      // Кола різниці (круговані) дають prev − p ≫ minGap — їх не чіпаємо.
      if (prev !== null && prev - p < minGap) p = prev - minGap;
      out.set(car.driverId, ((p % 1) + 1) % 1);
      prev = p;
    }
    return out;
  }

  /** Де намалювати машину: на трасі, у піт-лейні або зсунутою в дуелі. */
  private carPoint(car: CarSample, fraction: number): { x: number; y: number } {
    const p = this.pointAt(fraction);
    if (!car.inPit) return p;
    const n = this.normalAt(fraction);
    return { x: p.x + n.x * 22, y: p.y + n.y * 22 };
  }

  destroy(): void {
    this.svg.remove();
  }
}
