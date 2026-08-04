// Обгін — не арифметика, а подія.
// Швидша машина не «протікає» крізь повільнішу: вона мусить її проїхати,
// і на Монако це майже неможливо навіть із перевагою в секунду.

import { DEFENCE_COST, FAILED_ATTACK_COST } from './constants.ts';
import type { Rng } from './rng.ts';
import type { CarState, Driver, Track } from './types.ts';

export interface DuelInput {
  attacker: CarState;
  defender: CarState;
  attackerDriver: Driver;
  defenderDriver: Driver;
  /** Наскільки атакувальник швидший цього кола, с (додатне = швидший). */
  paceDelta: number;
  track: Track;
  /** Чи активований Override. */
  override: boolean;
  rng: Rng;
}

export interface DuelResult {
  passed: boolean;
  /** Штраф часу атакувальнику, с. */
  attackerCost: number;
  /** Штраф часу тому, хто захищався, с. */
  defenderCost: number;
  probability: number;
}

/**
 * Імовірність обгону:
 *   база траси × сигмоїда переваги в темпі × навички обох × бонус Override
 */
export function duel(input: DuelInput): DuelResult {
  const { attacker, defender, attackerDriver, defenderDriver, paceDelta, track, override, rng } =
    input;

  // Сигмоїда: перевага 0.3 с — це ще нічого, 1.5 с — це вже майже неминуче
  const paceFactor = 1 / (1 + Math.exp(-(paceDelta - 0.35) * 2.6));

  const skill = 0.55 + 0.9 * attackerDriver.overtaking - 0.55 * defenderDriver.defending;
  const overrideBonus = override ? 1.75 : 1;

  // Свіжа гума проти мертвої — окремий, дуже відчутний важіль
  const tyreEdge = 1 + Math.max(0, defender.tyre.wear - attacker.tyre.wear) * 0.85;

  // Хто відчайдушніший, той частіше пробує
  const aggression = 0.85 + 0.35 * attackerDriver.aggression;

  // Калібровано на ~35–50 обгонів за гонку. Вище — і пелотон перетворюється
  // на карусель, у якій позиція нічого не варта.
  let p = track.overtaking * 0.85 * paceFactor * skill * overrideBonus * tyreEdge * aggression;
  p = Math.max(0, Math.min(0.6, p));

  const passed = rng.chance(p);

  if (passed) {
    return { passed: true, attackerCost: 0, defenderCost: DEFENCE_COST * 0.5, probability: p };
  }

  // Невдала спроба коштує обом — саме тому «сидіти в хвості» це втрата гонки
  const desperation = 1 + attacker.stuckLaps * 0.12;
  return {
    passed: false,
    attackerCost: FAILED_ATTACK_COST * desperation,
    defenderCost: DEFENCE_COST,
    probability: p,
  };
}

/**
 * Андеркат: чи вигідно заїхати зараз, щоб проїхати суперника в боксах,
 * замість того щоб битися на трасі. Використовує і ШІ, і підказка гравцю.
 */
export function undercutGain(
  freshLapAdvantage: number,
  gapToRival: number,
  pitLoss: number,
): number {
  // Скільки кіл потрібно, щоб відіграти піт-лос свіжою гумою
  const lapsNeeded = pitLoss / Math.max(0.15, freshLapAdvantage);
  return freshLapAdvantage * lapsNeeded - pitLoss - gapToRival;
}
