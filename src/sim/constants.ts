// Калібрувальні константи моделі. Це єдине місце, де крутити баланс.
// Числа звірені з реальними даними Ф1 — джерела в коментарях.

import type { CompoundId, EnergyMode, PaceMode } from './types.ts';

/** Ефект маси палива: с на коло за кг. Стандартна оцінка ~0.03. */
export const FUEL_EFFECT = 0.03;

/** Запас палива понад розрахунок — на прогрівне коло і фініш. */
export const FUEL_MARGIN_KG = 1.5;

export interface CompoundSpec {
  id: CompoundId;
  label: string;
  /** Дельта темпу відносно софта на свіжій гумі, с. Хард на 0.3–0.6 повільніший за софт. */
  offset: number;
  /** Скільки секунд на коло додає кожне коло віку (лінійна складова зносу). */
  degPerLap: number;
  /** Скільки кіл живе комплект на еталонній трасі. */
  lifeLaps: number;
  /** Частка ресурсу, після якої починається кліф. */
  cliff: number;
  /** Максимальна втрата від кліфа при повністю мертвій гумі, с. */
  cliffLoss: number;
  color: string;
}

/**
 * Кліфи — головний драматичний момент гонки (урок Motorsport Manager:
 * софт падає різко, хард здувається плавно).
 */
export const COMPOUNDS: Record<CompoundId, CompoundSpec> = {
  soft: {
    id: 'soft',
    label: 'софт',
    offset: 0,
    degPerLap: 0.162,
    lifeLaps: 21,
    cliff: 0.72,
    cliffLoss: 3.2,
    color: '#ff2d55',
  },
  medium: {
    id: 'medium',
    label: 'медіум',
    offset: 0.35,
    degPerLap: 0.099,
    lifeLaps: 33,
    cliff: 0.8,
    cliffLoss: 2.6,
    color: '#ffd23f',
  },
  hard: {
    id: 'hard',
    label: 'хард',
    offset: 0.65,
    degPerLap: 0.063,
    lifeLaps: 46,
    cliff: 0.88,
    cliffLoss: 2.0,
    color: '#f2f2f2',
  },
  inter: {
    id: 'inter',
    label: 'інтер',
    offset: 3.4,
    degPerLap: 0.05,
    lifeLaps: 30,
    cliff: 0.82,
    cliffLoss: 2.4,
    color: '#39ff88',
  },
  wet: {
    id: 'wet',
    label: 'дощ',
    offset: 6.5,
    degPerLap: 0.04,
    lifeLaps: 34,
    cliff: 0.85,
    cliffLoss: 2.2,
    color: '#3aa0ff',
  },
};

export const DRY_COMPOUNDS: CompoundId[] = ['soft', 'medium', 'hard'];

/** Скільки секунд на коло дає кожен режим темпу (мінус = швидше). */
export const PACE_TIME: Record<PaceMode, number> = {
  1: +0.5, // берегти шини
  2: +0.25, // спокійно
  3: 0, // норма
  4: -0.25, // атака
  5: -0.5, // спалити все
};

/** Множник зносу гуми від режиму темпу. Ось той самий зв'язок «темп → знос». */
export const PACE_WEAR: Record<PaceMode, number> = {
  1: 0.68,
  2: 0.84,
  3: 1.0,
  4: 1.35,
  5: 1.8,
};

/** Множник ризику сходу від режиму темпу. «Спалити все» реально ламає мотори. */
export const PACE_RISK: Record<PaceMode, number> = {
  1: 0.7,
  2: 0.85,
  3: 1.0,
  4: 1.35,
  5: 2.1,
};

export const PACE_LABEL: Record<PaceMode, string> = {
  1: 'Берегти шини',
  2: 'Спокійно',
  3: 'Норма',
  4: 'Атака',
  5: 'Спалити все',
};

// ---- Гібрид 2026 ----
// MGU-K: 120 кВт → 350 кВт, рекуперація ~8.5 МДж за коло, Override 0.5 МДж.

/** Ємність накопичувача, МДж. */
export const BATTERY_MAX = 4.0;

/** Скільки МДж витрачає коло в кожному профілі (проти рекуперації траси). */
export const ENERGY_SPEND: Record<EnergyMode, number> = {
  recover: 0.55,
  balance: 0.95,
  deploy: 1.45,
};

/** Скільки часу на коло дає профіль (мінус = швидше). */
export const ENERGY_TIME: Record<EnergyMode, number> = {
  recover: +0.2,
  balance: 0,
  deploy: -0.25,
};

export const ENERGY_LABEL: Record<EnergyMode, string> = {
  recover: 'Рекуперація',
  balance: 'Баланс',
  deploy: 'Розгортання',
};

/** Витрата на одну активацію Override, МДж. */
export const OVERRIDE_COST = 0.5;

/** Виграш часу від Override на коло, с. */
export const OVERRIDE_GAIN = 0.55;

/** Скільки активацій Override на повну гонку. */
export const OVERRIDE_PER_RACE = 8;

/** Гап, у межах якого Override дозволений (регламент 2026: 1 секунда). */
export const OVERRIDE_WINDOW = 1.0;

/** Штраф порожньої батареї — без заряду болід просто повільний. */
export const FLAT_BATTERY_PENALTY = 0.9;

// ---- Взаємодія машин ----

/** Втрата від брудного повітря при гапі < OVERRIDE_WINDOW. 2026 регламент його зменшив. */
export const DIRTY_AIR = 0.22;

/** Мінімальний гап між машинами на лінії, с. Ближче — це вже обгін. */
export const MIN_GAP = 0.35;

/** Скільки часу коштує невдала спроба обгону атакувальнику. */
export const FAILED_ATTACK_COST = 0.15;

/** Скільки часу коштує захист позиції тому, хто попереду. */
export const DEFENCE_COST = 0.1;

// ---- Випадковість ----

/**
 * Імовірність сходу на пілота ЗА ГОНКУ (не за коло).
 *
 * За коло вона була помилкою: у Монако 78 кіл, у Спа 44 — і Монако видавало
 * удвічі більше сходів просто через довший календарний список кіл. Реальні
 * гонки Ф1 однакові за дистанцією, тож і базовий ризик має бути однаковий.
 */
export const DNF_PER_RACE = 0.06;

/** Наскільки евакуація гуми з траси прискорює коло до кінця гонки, с. */
export const TRACK_EVOLUTION = 0.45;

/** Шум часу кола для ідеально стабільного пілота (sd, с). */
export const LAP_NOISE_MIN = 0.06;

/** Шум часу кола для найнестабільнішого (sd, с). */
export const LAP_NOISE_MAX = 0.28;

// ---- Сейфті-кар ----

/** Наскільки повільніші кола під SC. */
export const SC_LAP_FACTOR = 1.4;

/** Наскільки повільніші кола під VSC. */
export const VSC_LAP_FACTOR = 1.25;

export const SC_MIN_LAPS = 3;
export const SC_MAX_LAPS = 5;

// ---- Погода ----

export const WET_PENALTY: Record<string, number> = {
  dry: 0,
  'light-rain': 2.2,
  rain: 5.5,
};

/** Очки за позиції 1..10. */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/**
 * Штраф за невиконане правило двох сумішей, с.
 * Без нього «взагалі не заїжджати в бокси» була найкращою стратегією гонки:
 * піт коштує 20 с, а порушення не коштувало нічого.
 */
export const TWO_COMPOUND_PENALTY = 30;

/**
 * Скільки секунд «коштує» втрата позиції на трасі за один зайвий піт-стоп
 * там, де обганяти майже неможливо.
 *
 * Без цього планувальник рахував лише чистий час і виходило, що двостоп
 * оптимальний на 19 із 24 трас. У житті це не так саме тому, що після
 * заїзду треба ще когось проїхати: у Монако це неможливо, у Монці — легко.
 */
export const POSITION_LOSS_MAX = 13;

/** Вище цього фактора обгону втрата позиції вже не лякає. */
export const POSITION_LOSS_FREE = 0.3;

// ---- Стюарди ----
// У моделі не було штрафів узагалі, тож режим «Атака» коштував лише гуми.
// Це робило агресію безризиковою, а отже — просто оптимальною для ШІ.

/** Часовий штраф за порушення, с. */
export const STEWARD_PENALTY = 5;

/** Базова ймовірність привернути увагу стюардів за коло у режимі «Норма». */
export const STEWARD_BASE = 0.0003;

/** Наскільки режим темпу множить ризик штрафу. */
export const STEWARD_PACE_RISK: Record<PaceMode, number> = {
  1: 0.2,
  2: 0.5,
  3: 1,
  4: 2.4,
  5: 4.5,
};

/** Додатковий ризик на колі з невдалою спробою обгону. */
export const STEWARD_DUEL_RISK = 3.2;
