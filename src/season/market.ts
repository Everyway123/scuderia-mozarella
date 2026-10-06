// Ринок пілотів і контракти — рух грида між сезонами.
//
// Філософія та сама, що й у всієї гри: одне справжнє рішення, а не Excel.
// У міжсезоння кілька пілотів стають вільними агентами; гравець може підписати
// ОДНОГО замість одного зі своїх (простий обмін місцями), зірки не йдуть в
// аутсайдерів, ціна платиться очками розробки наступного сезону. Форма
// дрейфує з віком: молодь росте, ветерани здають. Усе детерміновано від seed —
// перезавантаження не перетасує ринок.

import { DRIVERS_2026 } from '../data/drivers2026.ts';
import { TEAMS_2026 } from '../data/teams2026.ts';
import type { Driver, Team } from '../sim/types.ts';
import { Rng } from '../sim/rng.ts';

export interface MarketState {
  /** Хто в якій команді зараз. Порожньо = базовий грид 2026. */
  assignments: Record<string, string>;
  /** Накопичений дрейф темпу відносно бази, с/коло. Мінус — швидше. */
  paceDrift: Record<string, number>;
  /**
   * Епохи команд: накопичений дрейф темпу БОЛІДІВ відносно бази 2026,
   * с/коло. Мінус — швидше. Без нього ієрархія грида вічна, і кар'єра
   * впирається у стелю: аутсайдера неможливо вивести в чемпіони.
   */
  teamDrift: Record<string, number>;
  /** Скільки повних сезонів уже позаду (0 — граємо 2026-й). */
  seasonsPlayed: number;
}

export function emptyMarket(): MarketState {
  return { assignments: {}, paceDrift: {}, teamDrift: {}, seasonsPlayed: 0 };
}

/** Команда пілота з урахуванням трансферів. */
export function teamOf(market: MarketState, driverId: string): string {
  return market.assignments[driverId] ?? DRIVERS_2026.find((d) => d.id === driverId)!.teamId;
}

/**
 * Пілоти з урахуванням ринку: команда, дрейф форми, актуальний вік.
 * Це те, що сезон подає в гонку замість сирих даних 2026 року.
 */
export function marketDrivers(market: MarketState): Driver[] {
  return DRIVERS_2026.map((d) => ({
    ...d,
    teamId: teamOf(market, d.id),
    pace: Math.max(0, d.pace + (market.paceDrift[d.id] ?? 0)),
    age: d.age + market.seasonsPlayed,
  }));
}

export function marketDriversOfTeam(market: MarketState, teamId: string): Driver[] {
  return marketDrivers(market).filter((d) => d.teamId === teamId);
}

/**
 * Команди з урахуванням епох: база 2026 + накопичений дрейф болідів.
 * Це те, що сезон подає в гонку замість сирих TEAMS_2026.
 */
export function marketTeams(market: MarketState): Team[] {
  return TEAMS_2026.map((t) => ({
    ...t,
    pace: Math.max(0, t.pace + (market.teamDrift?.[t.id] ?? 0)),
  }));
}

/** На скільки сезонів припадає один цикл технічного регламенту. */
export const REGULATION_CYCLE = 3;

/** Чи буде сезон після цього міжсезоння першим за новим регламентом. */
export function isRegulationSeason(seasonsPlayed: number): boolean {
  return seasonsPlayed > 0 && seasonsPlayed % REGULATION_CYCLE === 0;
}

/** Ефективний темп пілота (база + дрейф) — основа ціни. */
export function effectivePace(market: MarketState, driverId: string): number {
  const d = DRIVERS_2026.find((x) => x.id === driverId)!;
  return Math.max(0, d.pace + (market.paceDrift[driverId] ?? 0));
}

/**
 * Ціна підпису в RP наступного сезону. Швидший — дорожчий:
 * еталон грида ≈ 16 RP (два сезони розробки), робочий середняк ≈ 8,
 * аутсайдер ≈ 4. Стеля свідомо болюча — зірка з'їдає весь ранній прогрес.
 */
export function signingCost(market: MarketState, driverId: string): number {
  const pace = effectivePace(market, driverId);
  return Math.max(3, Math.min(16, Math.round(16 - pace * 27)));
}

/**
 * Куди зірка взагалі готова йти. Вимога — місце команди в кубку
 * конструкторів МИНУЛОГО сезону: еталони не підписуються в хвіст пелотона.
 * null — без вимог.
 */
export function minConstructorRank(market: MarketState, driverId: string): number | null {
  const pace = effectivePace(market, driverId);
  if (pace < 0.12) return 4;
  if (pace < 0.24) return 7;
  return null;
}

/**
 * Вільні агенти цього міжсезоння: 4–7 пілотів, детерміновано від seed.
 * Пілоти команди гравця на ринок не потрапляють — своїх ти не втрачаєш,
 * гра лишається про надбання, а не про страх (свідоме спрощення v1).
 */
export function freeAgents(market: MarketState, seed: number, playerTeamId: string): string[] {
  const rng = new Rng((seed ^ (market.seasonsPlayed * 7919 + 13)) >>> 0);
  const pool = DRIVERS_2026.filter((d) => teamOf(market, d.id) !== playerTeamId).map((d) => d.id);

  // Тасування Фішера–Єйтса на власному RNG
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const count = 4 + Math.floor(rng.next() * 4); // 4..7
  return pool.slice(0, count).sort((a, b) => signingCost(market, b) - signingCost(market, a));
}

export interface SigningCheck {
  ok: boolean;
  reason: string | null;
}

/** Чи може гравець підписати цього пілота. */
export function canSign(
  market: MarketState,
  driverId: string,
  constructorRank: number,
  rpAvailable: number,
): SigningCheck {
  const minRank = minConstructorRank(market, driverId);
  if (minRank !== null && constructorRank > minRank) {
    return { ok: false, reason: `вимагає команду з топ-${minRank} кубка (у тебе ${constructorRank}-е)` };
  }
  const cost = signingCost(market, driverId);
  if (cost > rpAvailable) {
    return { ok: false, reason: `коштує ${cost} RP — стільки немає` };
  }
  return { ok: true, reason: null };
}

export interface OffseasonResult {
  market: MarketState;
  /** Людські рядки про те, що сталося: трансфери, форма. */
  news: string[];
}

/**
 * Прожити міжсезоння: старіння форми, підпис гравця (якщо є) простим обміном
 * місцями, і 1–2 обміни між ШІ-командами, щоб грид жив і без гравця.
 * Все детерміновано: (seed, seasonsPlayed) → той самий ринок.
 */
export function applyOffseason(
  market: MarketState,
  seed: number,
  playerTeamId: string,
  signing: { hireId: string; replaceId: string } | null,
  driverName: (id: string) => string = (id) => id,
): OffseasonResult {
  const rng = new Rng((seed ^ ((market.seasonsPlayed + 1) * 104729 + 7)) >>> 0);
  const next: MarketState = {
    assignments: { ...market.assignments },
    paceDrift: { ...market.paceDrift },
    teamDrift: { ...(market.teamDrift ?? {}) },
    seasonsPlayed: market.seasonsPlayed + 1,
  };
  const news: string[] = [];

  // 1. Форма: молодь росте, пік тримає, ветерани здають. Кроки маленькі —
  //    кар'єра відчувається на дистанції сезонів, а не ламає баланс за один.
  for (const d of DRIVERS_2026) {
    const age = d.age + market.seasonsPlayed;
    const step =
      age < 24 ? rng.gauss(-0.03, 0.015) : age < 32 ? rng.gauss(0, 0.01) : age < 38 ? rng.gauss(0.015, 0.01) : rng.gauss(0.035, 0.015);
    const total = Math.max(-0.25, Math.min(0.3, (next.paceDrift[d.id] ?? 0) + step));
    next.paceDrift[d.id] = Number(total.toFixed(3));
  }

  // 2. Підпис гравця: простий обмін місцями — заміщений їде туди,
  //    звідки прийшов новий. Жодних дір у гриді.
  if (signing) {
    const fromTeam = teamOf(market, signing.hireId);
    next.assignments[signing.hireId] = playerTeamId;
    next.assignments[signing.replaceId] = fromTeam;
    news.push(`🤝 ${driverName(signing.hireId)} переходить до тебе; ${driverName(signing.replaceId)} їде у зворотному напрямку.`);
  }

  // 3. Рух серед ШІ-команд: 1–2 обміни між вільними агентами, яких не взяв
  //    гравець. Це шум історії, а не оптимізація — і саме тому чесний.
  const aiFree = freeAgents(market, seed, playerTeamId).filter(
    (id) => id !== signing?.hireId && teamOf(next, id) !== playerTeamId,
  );
  const swaps = aiFree.length >= 2 ? 1 + (rng.chance(0.5) ? 1 : 0) : 0;
  for (let s = 0; s < swaps && aiFree.length >= 2; s++) {
    const a = aiFree.splice(Math.floor(rng.next() * aiFree.length), 1)[0]!;
    const b = aiFree.splice(Math.floor(rng.next() * aiFree.length), 1)[0]!;
    const ta = teamOf(next, a);
    const tb = teamOf(next, b);
    if (ta === tb) continue;
    next.assignments[a] = tb;
    next.assignments[b] = ta;
    news.push(`🔁 ${driverName(a)} і ${driverName(b)} міняються командами.`);
  }

  // 4. Головні рухи форми — у стрічку новин
  const moved = DRIVERS_2026.map((d) => ({
    id: d.id,
    delta: (next.paceDrift[d.id] ?? 0) - (market.paceDrift[d.id] ?? 0),
  })).sort((a, b) => a.delta - b.delta);
  const riser = moved[0]!;
  const fader = moved[moved.length - 1]!;
  if (riser.delta < -0.02) news.push(`📈 ${driverName(riser.id)} додає — форма росте.`);
  if (fader.delta > 0.02) news.push(`📉 ${driverName(fader.id)} вже не той — роки беруть своє.`);

  // 5. Епохи команд: боліди теж живуть. Щосезону темп дрейфує з м'яким
  //    притяганням до середини грида (чемпіон розслабляється, аутсайдер
  //    наздоганяє), а кожен REGULATION_CYCLE-й сезон — новий технічний
  //    регламент: кроки різко більші, ієрархія перетасовується.
  //    Саме це робить кар'єру довгою грою: вічних чемпіонів більше немає.
  //    Кроки рахуються ПІСЛЯ всіх попередніх draw'ів — щоб додавання епох
  //    не зсунуло детермінований ринок пілотів у старих кар'єрах.
  const regulation = isRegulationSeason(next.seasonsPlayed);
  if (regulation) {
    news.push('🏭 Новий технічний регламент! Боліди малюють з нуля — ієрархія грида під питанням.');
  }
  const teamSteps: { id: string; step: number }[] = [];
  for (const t of TEAMS_2026) {
    const current = t.pace + (next.teamDrift[t.id] ?? 0);
    // Притягання до середини грида: хто попереду еталона середняка — здає,
    // хто позаду — підтягується. У регламентний сезон усе втричі різкіше.
    const pull = (0.35 - current) * (regulation ? 0.12 : 0.04);
    const step = rng.gauss(pull, regulation ? 0.09 : 0.025);
    const total = Math.max(-0.5, Math.min(0.6, (next.teamDrift[t.id] ?? 0) + step));
    teamSteps.push({ id: t.id, step: total - (next.teamDrift[t.id] ?? 0) });
    next.teamDrift[t.id] = Number(total.toFixed(3));
  }
  teamSteps.sort((a, b) => a.step - b.step);
  const teamName = (id: string) => TEAMS_2026.find((t) => t.id === id)!.name;
  const tRiser = teamSteps[0]!;
  const tFader = teamSteps[teamSteps.length - 1]!;
  if (tRiser.step < -0.04) news.push(`🚀 ${teamName(tRiser.id)}: новий болід вдався — темп помітно росте.`);
  if (tFader.step > 0.04) news.push(`🐌 ${teamName(tFader.id)}: розробка провалена, болід втрачає темп.`);

  return { market: next, news };
}
