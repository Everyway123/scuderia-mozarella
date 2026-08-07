// Типи симуляції. Жодного DOM — цей шар має працювати в Node так само, як у браузері.

export type CompoundId = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';

/** 1 — берегти шини, 3 — норма, 5 — спалити все. */
export type PaceMode = 1 | 2 | 3 | 4 | 5;

/** Профіль гібрида 2026: копити енергію, тримати баланс чи розгортати. */
export type EnergyMode = 'recover' | 'balance' | 'deploy';

export type CarStatus = 'running' | 'pitting' | 'dnf' | 'finished';

export type RaceLength = 25 | 50 | 100;

export type WeatherState = 'dry' | 'light-rain' | 'rain';

export type FlagState = 'green' | 'vsc' | 'safety-car';

export interface Team {
  id: string;
  name: string;
  short: string;
  color: string;
  accent: string;
  /** Дефіцит темпу боліда в секундах на коло. 0 = еталон грида. */
  pace: number;
  /** Множник базової ймовірності сходу. 1.0 = середня надійність. */
  reliability: number;
  /** Середній час стоянки в боксах, с. */
  pitCrew: number;
  /** Розкид часу стоянки (sd), с. */
  pitCrewSd: number;
  /**
   * Якість роботи стратега команди, 0..1. Слабші команди пізніше реагують на
   * сейфті-кар і кліф гуми. Саме тут гравець додає цінність: його рішення
   * миттєві, а рішення штатного інженера — ні.
   */
  strategy: number;
  /**
   * Множник зносу гуми боліда. 1 (або відсутній) — нейтральний,
   * <1 — болід береже гуму. Сюди цілять шинні картки розробки.
   */
  tyreWear?: number;
}

export interface Driver {
  id: string;
  name: string;
  short: string;
  number: number;
  teamId: string;
  /** Дефіцит темпу пілота в секундах на коло. 0 = еталон. */
  pace: number;
  /** 0..1 — стабільність, менше помилок і менший шум часу кола. */
  consistency: number;
  /** 0..1 — вміння берегти гуму. */
  tyreManagement: number;
  /** 0..1 — атака в бою за позицію. */
  overtaking: number;
  /** 0..1 — захист позиції. */
  defending: number;
  /** 0..1 — дощ. */
  wet: number;
  /** 0..1 — схильність ризикувати: більше обгонів, більше помилок. */
  aggression: number;
}

export interface Track {
  id: string;
  name: string;
  country: string;
  round: number;
  /** Кіл у повній гонці. */
  laps: number;
  /** Базовий час кола в гоночному темпі, с. */
  baseLap: number;
  /** Втрата на піт-стоп без часу стоянки, с. */
  pitLoss: number;
  /** 0..1 — наскільки легко тут обганяти. Монако 0.02, Монца 0.32. */
  overtaking: number;
  /** Множник зносу гуми. */
  tyreWear: number;
  /** Паливо на все коло, кг. */
  fuelPerLap: number;
  /** Скільки МДж рекуперації дає коло — довгі гальмування = більше енергії. */
  harvestMJ: number;
  /** Імовірність сейфті-кара за гонку. */
  safetyCar: number;
  /** Базова ймовірність дощу. */
  rainChance: number;
  street: boolean;
  /**
   * Скільки справжніх кіл «коштує» одне коло цієї гонки.
   * 1 — повна дистанція; 4 — гонка на 25%, де кожне коло стиснуте вчетверо.
   * Задається движком, у даних трас завжди 1.
   */
  compression?: number;
}

export interface TyreState {
  compound: CompoundId;
  /** Кіл на цьому комплекті. */
  age: number;
  /** 0..1 — вироблений ресурс. За 1.0 гума мертва. */
  wear: number;
}

export interface CarState {
  driverId: string;
  teamId: string;
  status: CarStatus;
  /** Сумарний час від старту, с. */
  totalTime: number;
  /** Пройдено кіл. */
  lap: number;
  position: number;
  /** Позиція на старті — потрібна, щоб рахувати відіграні місця. */
  startPosition: number;
  tyre: TyreState;
  fuelKg: number;
  /** Заряд батареї, МДж. */
  energyMJ: number;
  /** Скільки активацій Override лишилось. */
  overrideLeft: number;
  /** Override увімкнений на це коло. */
  overrideArmed: boolean;
  /** Чи керує Override гравець вручну. Поки false — вмикається автоматично. */
  manualOverride: boolean;
  paceMode: PaceMode;
  energyMode: EnergyMode;
  stops: number;
  /** Які суміші вже використані — для правила двох сумішей. */
  compoundsUsed: CompoundId[];
  /** Наказ заїхати в бокси на наступному колі. */
  pitRequest: CompoundId | null;
  /** Час останнього кола, с. */
  lastLap: number;
  bestLap: number;
  /** Скільки кіл поспіль не може проїхати суперника. */
  stuckLaps: number;
  dnfReason: string | null;
  /** Післягоночний штраф, с: правило двох сумішей, стюарди. */
  penalty: number;
  penaltyReason: string | null;
  /** Скільки разів отримував увагу стюардів — для радіо й розбору. */
  penalties: number;
  /** Кіл на гумі, що не відповідає погоді — для післягоночного розбору. */
  wrongTyreLaps: number;
  /** Оцінка втрачених на цій гумі секунд — та сама математика, що в моделі кола. */
  wrongTyreLoss: number;
  /** Скільки пітів зроблено під жовтими прапорами — дешеві вікна. */
  scPits: number;
  /** Скільки секунд зекономили дешеві піти проти зелених. */
  flagSaved: number;
  isPlayer: boolean;
  /**
   * Чи планує піт-стопи ШІ. Для машин гравця темп, енергія й Override завжди його,
   * а стратегію за замовчуванням веде ШІ — інакше новачок просто не заїде в бокси
   * й помре на мертвій гумі. Вимикається кнопкою «вручну».
   */
  autoStrategy: boolean;
  /**
   * Чи взяв гравець темп під ручне керування. Поки false — темпом керує той
   * самий контролер, що й у суперників. Інакше гравець, який нічого не чіпає,
   * отримував би свідомо гіршу машину, ніж та сама машина під ШІ.
   */
  manualPace: boolean;
}

export interface RaceEvent {
  lap: number;
  kind:
    | 'overtake'
    | 'pit'
    | 'dnf'
    | 'safety-car'
    | 'safety-car-end'
    | 'fastest-lap'
    | 'weather'
    | 'radio'
    | 'flat-spot'
    | 'penalty'
    | 'start';
  driverId?: string;
  otherId?: string;
  text: string;
}

export interface RaceState {
  trackId: string;
  totalLaps: number;
  lap: number;
  cars: CarState[];
  weather: WeatherState;
  flag: FlagState;
  /** Скільки кіл ще діє сейфті-кар. */
  flagLapsLeft: number;
  trackEvolution: number;
  events: RaceEvent[];
  fastestLap: { driverId: string; time: number } | null;
  finished: boolean;
}

/** Рішення гравця, що подаються в движок перед кроком кола. */
export interface PitwallOrder {
  driverId: string;
  paceMode?: PaceMode;
  energyMode?: EnergyMode;
  pit?: CompoundId | null;
  override?: boolean;
  autoStrategy?: boolean;
  /** Повернути темп під керування інженера. */
  autoPace?: boolean;
}
