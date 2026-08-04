// Командне радіо й плашки подій — те, що перетворює таблицю на трансляцію.
//
// Події вже породжує симуляція; тут вони перекладаються з мови движка
// («overtake», «pit») на мову боксів («Проходить Норріса!», «Бокси підтверджено»).

import type { Race } from '../sim/raceEngine.ts';
import type { RaceEvent } from '../sim/types.ts';

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

  constructor(host: HTMLElement, bannerHost: HTMLElement, race: Race) {
    this.host = host;
    this.bannerHost = bannerHost;
    this.race = race;
  }

  /** Показати всі події до вказаного кола включно. */
  update(lap: number, now: number): void {
    const events = this.race.state.events;
    while (this.shown < events.length) {
      const e = events[this.shown]!;
      if (e.lap > lap) break;
      this.shown++;
      this.push(e, now);
    }

    if (this.banner && now > this.banner.until) {
      this.banner = null;
      this.bannerHost.innerHTML = '';
      this.bannerHost.classList.remove('on');
    }
  }

  private push(e: RaceEvent, now: number): void {
    const mine = e.driverId ? this.race.playerCars().some((c) => c.driverId === e.driverId) : false;

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
