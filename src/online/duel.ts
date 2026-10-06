// Онлайн без сервера: дуелі за посиланням і гонка тижня.
//
// Хостинг у нас статичний, зате симуляція детермінована — і це дає чесний
// асинхронний мультиплеєр: виклик кодує (траса, довжина, seed, команда) і
// результат автора прямо в URL. Суперник відкриває посилання, грає ТУ САМУ
// гонку за ТУ САМУ команду — однакові боліди, однакові сейфті-кари, однаковий
// дощ. Різниця в результаті — це різниця рішень на пітволі, більше нічого.

import { TRACKS_2026 } from '../data/tracks2026.ts';
import type { ClassifiedCar } from '../sim/raceEngine.ts';
import type { RaceLength } from '../sim/types.ts';

/** Результат команди в дуелі: очки двох машин, найкращий фініш, час лідера. */
export interface DuelResult {
  /** Сума очок обох машин (включно з бонусом за найшвидше коло). */
  points: number;
  /** Найкраща позиція на фініші; 99 — подвійний схід. */
  bestPos: number;
  /** Час найкращої машини, с (округлено до тисячних); Infinity → 999999. */
  time: number;
}

export interface DuelChallenge {
  v: 1;
  trackId: string;
  length: RaceLength;
  seed: number;
  teamId: string;
  /** Ім'я автора виклику — просто для рядка «Виклик від …». */
  name?: string;
  result: DuelResult;
}

/** Витягнути результат дуелі з класифікації гонки. */
export function duelResult(teamId: string, classification: ClassifiedCar[]): DuelResult {
  const mine = classification.filter((c) => c.team.id === teamId);
  const finishers = mine.filter((c) => c.status !== 'dnf');
  return {
    points: mine.reduce((a, c) => a + c.points, 0),
    bestPos: finishers.length > 0 ? Math.min(...finishers.map((c) => c.position)) : 99,
    time:
      finishers.length > 0
        ? Number(Math.min(...finishers.map((c) => c.totalTime)).toFixed(3))
        : 999999,
  };
}

/**
 * Хто виграв дуель. Очки — головне (це валюта чемпіонату), далі найкраща
 * позиція, далі час лідера: за повної рівності рахунку швидший — переможець.
 */
export function compareDuel(mine: DuelResult, theirs: DuelResult): 'win' | 'lose' | 'draw' {
  if (mine.points !== theirs.points) return mine.points > theirs.points ? 'win' : 'lose';
  if (mine.bestPos !== theirs.bestPos) return mine.bestPos < theirs.bestPos ? 'win' : 'lose';
  if (mine.time !== theirs.time) return mine.time < theirs.time ? 'win' : 'lose';
  return 'draw';
}

// ---- Кодування в URL ---------------------------------------------------

/** base64url без '='-хвоста: і в hash, і в месенджерах живе без екранування. */
function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeDuel(ch: DuelChallenge): string {
  return b64encode(JSON.stringify(ch));
}

/** Розбір виклику з чужого посилання — на вхід не можна покладатись ніяк. */
export function decodeDuel(payload: string): DuelChallenge | null {
  const raw = b64decode(payload);
  if (!raw) return null;
  try {
    const ch = JSON.parse(raw) as DuelChallenge;
    if (ch.v !== 1) return null;
    if (!TRACKS_2026.some((t) => t.id === ch.trackId)) return null;
    if (ch.length !== 25 && ch.length !== 50 && ch.length !== 100) return null;
    if (!Number.isFinite(ch.seed)) return null;
    if (typeof ch.teamId !== 'string' || !ch.teamId) return null;
    const r = ch.result;
    if (!r || !Number.isFinite(r.points) || !Number.isFinite(r.bestPos) || !Number.isFinite(r.time))
      return null;
    if (ch.name !== undefined && typeof ch.name !== 'string') return null;
    // Ім'я піде в DOM — обрізаємо до розумного й лишаємо текстом
    if (ch.name) ch.name = ch.name.slice(0, 24);
    return ch;
  } catch {
    return null;
  }
}

/** Повне посилання-виклик від поточної адреси гри. */
export function duelUrl(ch: DuelChallenge, base: string): string {
  return `${base}#duel=${encodeDuel(ch)}`;
}

/** Виклик із location.hash, якщо він там є. */
export function duelFromHash(hash: string): DuelChallenge | null {
  const m = /#duel=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? decodeDuel(m[1]!) : null;
}

// ---- Гонка тижня -------------------------------------------------------

/** ISO-номер тижня — однаковий у Києві й у Токіо. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/**
 * Гонка тижня: весь світ цього тижня грає один і той самий етап з одним
 * seed. Жодного сервера — спільний всесвіт задається календарем.
 */
export function weeklyRace(date = new Date()): {
  trackId: string;
  seed: number;
  year: number;
  week: number;
} {
  const { year, week } = isoWeek(date);
  const track = TRACKS_2026[(year * 7 + week) % TRACKS_2026.length]!;
  return { trackId: track.id, seed: (year * 100 + week) ^ 0x5eed, year, week };
}
