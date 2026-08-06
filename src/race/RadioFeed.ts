// Командне радіо й плашки подій — те, що перетворює таблицю на трансляцію.
//
// Події вже породжує симуляція; тут вони перекладаються з мови движка
// («overtake», «pit») на мову боксів («Проходить Норріса!», «Бокси підтверджено»).

import type { Race } from '../sim/raceEngine.ts';
import type { RaceEvent } from '../sim/types.ts';
import { sound } from './sound.ts';

const KIND_ICON: Record<string, string> = {
  overtake: '⚔',
  pit: '🔧',
  dnf: '💥',
  'safety-car': '🟡',
  'safety-car-end': '🟢',
  'fastest-lap': '⚡',
  weather: '🌧',
  radio: '📻',
  'flat-spot': '⚠',
  start: '🚦',
};

/** Події, які варті великої плашки поверх мапи. */
const BANNER_KINDS = new Set(['overtake', 'fastest-lap', 'safety-car', 'dnf', 'weather']);

export interface Banner {
  text: string;
  kind: string;
  until: number;
}

export class RadioFeed {
  private readonly host: HTMLElement;
  private readonly bannerHost: HTMLElement;
  private readonly race: Race;
  private shown = 0;
  private banner: Banner | null = null;
  /** Тротлінг звуку: останній програш загалом і по типу події. */
  private lastSoundAt = 0;
  private readonly lastKindAt = new Map<string, number>();

  constructor(host: HTMLElement, bannerHost: HTMLElement, race: Race) {
    this.host = host;
    this.bannerHost = bannerHost;
    this.race = race;
  }

  /** Показати всі події до вказаного кола включно. */
  update(lap: number, now: number): void {
    const events = this.race.state.events;

    // Скільки подій наздоганяємо цим кадром. Велика пачка — це перемотка
    // («до фінішу», прискорення) — там звук перетворився б на кашу
    let pending = 0;
    for (let i = this.shown; i < events.length && events[i]!.lap <= lap; i++) pending++;
    const silent = pending > 6;

    while (this.shown < events.length) {
      const e = events[this.shown]!;
      if (e.lap > lap) break;
      this.shown++;
      this.push(e, now, silent);
    }

    if (this.banner && now > this.banner.until) {
      this.banner = null;
      this.bannerHost.innerHTML = '';
      this.bannerHost.classList.remove('on');
    }
  }

  /** Озвучити подію — з тротлінгом, щоб трансляція звучала, а не тріщала. */
  private playFor(e: RaceEvent, mine: boolean): void {
    const t = performance.now() / 1000;
    if (t - this.lastSoundAt < 0.12) return;
    if (t - (this.lastKindAt.get(e.kind) ?? -9) < 1.2) return;

    let played = true;
    switch (e.kind) {
      case 'start': sound.startLights(); break;
      case 'safety-car': sound.safetyCar(); break;
      case 'safety-car-end': sound.green(); break;
      case 'weather': sound.rain(); break;
      case 'dnf': sound.dnf(); break;
      case 'fastest-lap': sound.fastest(); break;
      // Дрібніші події звучать лише коли стосуються НАШИХ машин —
      // інакше 22 боліди перетворюють ефір на суцільний писк
      case 'overtake': mine ? sound.overtake() : (played = false); break;
      case 'pit': mine ? sound.pit() : (played = false); break;
      case 'penalty': mine ? sound.penalty() : (played = false); break;
      case 'radio':
      case 'flat-spot': mine ? sound.radio() : (played = false); break;
      default: played = false;
    }
    if (played) {
      this.lastSoundAt = t;
      this.lastKindAt.set(e.kind, t);
    }
  }

  private push(e: RaceEvent, now: number, silent = false): void {
    const mine = e.driverId ? this.race.playerCars().some((c) => c.driverId === e.driverId) : false;

    if (!silent) this.playFor(e, mine);

    const row = document.createElement('div');
    row.className = `rf-row${mine ? ' mine' : ''}`;
    row.innerHTML = `<span class="rf-lap">${e.lap}</span><span class="rf-icon">${KIND_ICON[e.kind] ?? '·'}</span><span class="rf-text"></span>`;
    row.querySelector('.rf-text')!.textContent = e.text;
    this.host.appendChild(row);

    // Стрічка не має рости нескінченно — тримаємо останні 60 рядків
    while (this.host.childElementCount > 60) this.host.firstElementChild?.remove();
    this.host.scrollTop = this.host.scrollHeight;

    // Велика плашка — тільки для подій, які в трансляції показали б крупно,
    // і тільки якщо вони стосуються нас або лідера гонки
    if (BANNER_KINDS.has(e.kind) && (mine || e.kind !== 'overtake')) {
      this.banner = { text: e.text, kind: e.kind, until: now + 2.6 };
      this.bannerHost.className = `banner on ${e.kind}`;
      this.bannerHost.innerHTML = `<span>${KIND_ICON[e.kind] ?? ''}</span><b></b>`;
      this.bannerHost.querySelector('b')!.textContent = e.text;
    }
  }

  /** Власне повідомлення від імені боксів — для реакцій на дії гравця. */
  say(text: string, lap: number): void {
    this.push({ lap, kind: 'radio', text }, 0);
  }

  reset(): void {
    this.shown = 0;
    this.host.innerHTML = '';
    this.bannerHost.innerHTML = '';
    this.bannerHost.classList.remove('on');
  }
}
