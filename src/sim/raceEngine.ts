// Движок гонки. Чиста функція (state, orders, rng) → state.
// Жодного DOM, жодного таймера — тому гонку на 57 кіл можна прорахувати
// за мілісекунди в тестах і прогнати 5000 разів для балансу.

import {
  BATTERY_MAX,
  COMPOUNDS,
  FUEL_MARGIN_KG,
  MIN_GAP,
  OVERRIDE_PER_RACE,
  OVERRIDE_WINDOW,
  POINTS,
  STEWARD_PENALTY,
  TWO_COMPOUND_PENALTY,
} from './constants.ts';
import { computeLap, fuelBurn, startingFuel } from './lapModel.ts';
import {
  checkDnf,
  checkMistake,
  checkSafetyCar,
  checkStewards,
  forecast,
  pitStopTime,
  planWeather,
} from './incidents.ts';
import { duel } from './overtaking.ts';
import { Rng } from './rng.ts';
import {
  advanceBrain,
  createBrain,
  decidePace,
  decidePit,
  planForDriver,
  type AiBrain,
} from './strategyAI.ts';
import { ageTyre, freshTyre } from './tyres.ts';
import type {
  CarState,
  CompoundId,
  Driver,
  PitwallOrder,
  RaceEvent,
  RaceLength,
  RaceState,
  Team,
  Track,
  WeatherState,
} from './types.ts';

/**
 * Регулятор довжини гонки — це стиснення часу, а не обрізання дистанції.
 * Одне коло скороченої гонки «коштує» кілька справжніх: гума й паливо
 * витрачаються пропорційно швидше.
 *
 * Без цього спринт вироджується в «поставив харди й доїхав»: піт-стоп коштує
 * ті самі 20 секунд, а відігравати їх нема на чому. Зі стисненням гумова
 * історія повної гонки повністю зберігається — і гравцю є що вирішувати.
 */
/** Еталонна дистанція, до якої нормуються ризики «на гонку». */
export const REFERENCE_LAPS = 57;

export function compressTrack(track: Track, totalLaps: number): Track {
  const c = track.laps / totalLaps;
  if (c <= 1) return { ...track, compression: 1 };
  return {
    ...track,
    compression: c,
    // Паливо теж витрачається за c справжніх кіл, тож ефект маси
    // від старту до фінішу лишається тим самим
    fuelPerLap: track.fuelPerLap * c,
  };
}

export interface RaceSetup {
  track: Track;
  drivers: Driver[];
  teams: Team[];
  length: RaceLength;
  seed: number;
  /** Стартова решітка — id пілотів у порядку позицій. Немає — беремо порядок drivers. */
  grid?: string[];
  /** Команда гравця — під його керуванням обидві її машини. */
  playerTeamId?: string;
}

export class Race {
  readonly track: Track;
  readonly totalLaps: number;
  readonly state: RaceState;

  private readonly drivers = new Map<string, Driver>();
  private readonly teams = new Map<string, Team>();
  private readonly brains = new Map<string, AiBrain>();
  private readonly rng: Rng;
  private readonly seed: number;
  private readonly playerTeamId: string | null;
  /** Погода розписана наперед — гравець бачить її лише через прогноз. */
  private readonly weatherScript: WeatherState[];
  /** Чи була гонка мокрою — від цього залежить, чи діє правило двох сумішей. */
  private everWet = false;
  /** Хто цього кола не проїхав суперника — у них вищий шанс уваги стюардів. */
  private readonly failedDuels = new Set<string>();

  constructor(setup: RaceSetup) {
    this.rng = new Rng(setup.seed);
    this.seed = setup.seed;
    this.playerTeamId = setup.playerTeamId ?? null;

    for (const d of setup.drivers) this.drivers.set(d.id, d);
    for (const t of setup.teams) this.teams.set(t.id, t);

    this.totalLaps = Math.max(5, Math.round((setup.track.laps * setup.length) / 100));
    this.track = compressTrack(setup.track, this.totalLaps);

    this.weatherScript = planWeather(this.track, this.totalLaps, this.rng);

    const order = setup.grid ?? setup.drivers.map((d) => d.id);
    const cars = order.map((id, i) => this.createCar(id, i + 1, setup.length));

    this.state = {
      trackId: this.track.id,
      totalLaps: this.totalLaps,
      lap: 0,
      cars,
      weather: 'dry',
      flag: 'green',
      flagLapsLeft: 0,
      trackEvolution: 0,
      events: [
        {
          lap: 0,
          kind: 'start',
          text: `${this.track.name}: ${this.totalLaps} кіл, старт!`,
        },
      ],
      fastestLap: null,
      finished: false,
    };

    // Стратегія планується один раз перед стартом — далі ШІ на неї реагує
    const pitLossTotal = this.track.pitLoss;
    for (const car of cars) {
      const driver = this.drivers.get(car.driverId)!;
      const plan = planForDriver(this.track, this.totalLaps, driver, pitLossTotal, this.rng);
      this.brains.set(car.driverId, createBrain(plan, this.rng));
      // Стартова гума — з плану
      const first = plan.stints[0]?.compound ?? 'medium';
      car.tyre = freshTyre(first);
      car.compoundsUsed = [first];
    }
  }

  private createCar(driverId: string, position: number, _length: RaceLength): CarState {
    const driver = this.drivers.get(driverId)!;
    const laps = this.totalLaps;
    return {
      driverId,
      teamId: driver.teamId,
      status: 'running',
      totalTime: 0,
      lap: 0,
      position,
      startPosition: position,
      tyre: freshTyre('medium'),
      fuelKg: startingFuel(this.track, laps, FUEL_MARGIN_KG),
      energyMJ: BATTERY_MAX,
      overrideLeft: Math.max(2, Math.round((OVERRIDE_PER_RACE * laps) / this.track.laps)),
      overrideArmed: false,
      manualOverride: false,
      paceMode: 3,
      energyMode: 'balance',
      stops: 0,
      compoundsUsed: [],
      pitRequest: null,
      lastLap: 0,
      bestLap: Infinity,
      stuckLaps: 0,
      dnfReason: null,
      penalty: 0,
      penaltyReason: null,
      penalties: 0,
      isPlayer: driver.teamId === this.playerTeamId,
      autoStrategy: true,
      manualPace: false,
    };
  }

  /**
   * Правило двох сумішей. Досі воно існувало лише в голові стратега ШІ —
   * і це робило «взагалі не заїжджати в бокси» найкращою стратегією гонки.
   * Тепер за нього платять, як у житті: штраф до підсумкового часу.
   */
  private applyRulePenalties(): void {
    if (this.everWet) return; // у мокру гонку правило не діє

    for (const car of this.state.cars) {
      if (car.status === 'dnf') continue;
      const dry = new Set(
        car.compoundsUsed.filter((c) => c === 'soft' || c === 'medium' || c === 'hard'),
      );
      if (dry.size >= 2) continue;
      car.penalty += TWO_COMPOUND_PENALTY;
      car.penaltyReason = 'не виконано правило двох сумішей';
      car.totalTime += TWO_COMPOUND_PENALTY;
      this.log('radio', `${this.drivers.get(car.driverId)!.short}: +30 с — одна суміш за гонку`);
    }
  }

  /** Стартова затримка: реакція на світлофор + місце на решітці. */
  private applyStartSpread(): void {
    for (const car of this.state.cars) {
      const driver = this.drivers.get(car.driverId)!;
      // Реальний пелотон перетинає лінію після першого кола розтягнутим
      // на 12–18 секунд. 0.32 с на позицію давало вдвічі щільніший старт,
      // і далі весь пелотон півгонки їхав одним «поїздом».
      const gridLoss = (car.position - 1) * 0.62;
      const reaction = this.rng.gauss(0.25, 0.18 * (1.4 - driver.consistency));
      car.totalTime += gridLoss + Math.max(0, reaction);
    }
    this.resort();
  }

  /**
   * Наказ гравця. Діє з наступного прорахованого кола — рівно як на справжньому
   * пітволі: сказав по радіо, пілот виконує на наступному колі.
   */
  order(o: PitwallOrder): void {
    const car = this.state.cars.find((c) => c.driverId === o.driverId);
    if (!car || car.status === 'dnf') return;
    if (o.paceMode !== undefined) {
      car.paceMode = o.paceMode;
      car.manualPace = true;
    }
    if (o.autoPace) car.manualPace = false;
    if (o.energyMode !== undefined) car.energyMode = o.energyMode;
    if (o.pit !== undefined) car.pitRequest = o.pit;
    if (o.override !== undefined) {
      car.overrideArmed = o.override;
      car.manualOverride = true;
    }
    if (o.autoStrategy !== undefined) car.autoStrategy = o.autoStrategy;
  }

  /** Машини гравця — для панелі пітволу. */
  playerCars(): CarState[] {
    return this.state.cars.filter((c) => c.isPlayer);
  }

  driver(id: string): Driver | undefined {
    return this.drivers.get(id);
  }

  team(id: string): Team | undefined {
    return this.teams.get(id);
  }

  /**
   * Відкласти плановий заїзд. Це відповідь гравця на питання «тягнемо ще?» —
   * без неї варіант «тягнемо» був би порожнім: ШІ все одно заїхав би цього кола.
   */
  delayPit(driverId: string, laps: number): void {
    const brain = this.brains.get(driverId);
    if (brain && Number.isFinite(brain.nextPitLap)) brain.nextPitLap += laps;
  }

  /**
   * Прогноз погоди, який бачить гравець: правда з weatherScript, розмита тим
   * сильніше, чим далі коло. Це і є інформаційна перевага гравця — ШІ прогноз
   * не читає, він реагує лише на краплі на візорі (wrongTyre у decidePit).
   *
   * RNG навмисно окремий і детермінований від (seed, коло): повторний виклик
   * на тому ж колі дає той самий прогноз, а головний потік симуляції не
   * зсувається ні на один тік — на зсувах уже чотири рази ламались E2E-seed'и.
   */
  weatherForecast(horizon = 6): { lap: number; chance: number }[] {
    const rng = new Rng((this.seed ^ (this.state.lap * 2654435761)) >>> 0);
    return forecast(this.weatherScript, this.state.lap, horizon, rng);
  }

  /** Що радить стратег для цієї машини — те саме, з чим бореться гравець. */
  advice(driverId: string): { nextPitLap: number; stops: number; nextCompound: CompoundId | null } | null {
    const brain = this.brains.get(driverId);
    if (!brain) return null;
    return {
      nextPitLap: brain.nextPitLap,
      stops: brain.plan.stops,
      nextCompound: brain.plan.stints[brain.stintIndex + 1]?.compound ?? null,
    };
  }

  /** Один крок = одне коло для всього пелотона. */
  step(): void {
    if (this.state.finished) return;

    const s = this.state;
    s.lap += 1;
    if (s.lap === 1) this.applyStartSpread();

    s.trackEvolution = Math.min(1, s.lap / Math.max(1, s.totalLaps * 0.6));

    // Погода змінюється до кола, щоб рішення про гуму мало сенс
    const before = s.weather;
    s.weather = this.weatherScript[s.lap] ?? 'dry';
    if (s.weather !== 'dry') this.everWet = true;
    if (s.weather !== before) {
      this.log(
        'weather',
        s.weather === 'dry'
          ? 'Траса підсихає — час на суху гуму'
          : s.weather === 'light-rain'
            ? 'Пішов дощ, краплі на візорі'
            : 'Злива! Траса пливе',
      );
    }

    const running = s.cars.filter((c) => c.status !== 'dnf' && c.status !== 'finished');
    running.sort((a, b) => a.totalTime - b.totalTime);

    // Гапи на початок кола — на них спираються Override, брудне повітря й ШІ
    const gaps = new Map<string, number>();
    for (let i = 0; i < running.length; i++) {
      const car = running[i]!;
      gaps.set(car.driverId, i === 0 ? Infinity : car.totalTime - running[i - 1]!.totalTime);
    }

    // 1. Рішення ШІ.
    //    Машини гравця теж проходять через стратега, але лише по піт-стопах
    //    і тільки поки ввімкнена автостратегія. Темп, енергію та Override
    //    для них задає гравець — це і є його важелі.
    const pitReasons = new Map<string, string>();
    for (const car of running) {
      const driver = this.drivers.get(car.driverId)!;
      const team = this.teams.get(car.teamId)!;
      const brain = this.brains.get(car.driverId)!;
      const gapAhead = gaps.get(car.driverId) ?? Infinity;

      // Темп веде контролер, поки гравець не взяв його на себе — так пасивна
      // гра дає рівно те саме, що й машина під ШІ, а не гіршу
      if (!car.isPlayer || !car.manualPace) {
        car.paceMode = decidePace(car, s, gapAhead, brain);
      }
      // Override теж автоматичний, поки гравець не взяв його на себе:
      // інакше пасивна гра означала б добровільну відмову від важеля
      if (!car.isPlayer || !car.manualOverride) {
        car.overrideArmed = gapAhead <= OVERRIDE_WINDOW;
      }

      // Наказ гравця має пріоритет над будь-яким планом
      if (car.pitRequest) {
        pitReasons.set(car.driverId, 'наказ');
        continue;
      }
      if (car.isPlayer && !car.autoStrategy) continue;

      const decision = decidePit(car, brain, s, this.track, driver, team.strategy, this.rng);
      car.pitRequest = decision?.compound ?? null;
      if (decision) pitReasons.set(car.driverId, decision.reason);
    }

    // 2. Чисті часи кола
    const lapTimes = new Map<string, number>();
    const pittedThisLap = new Set<string>();
    for (const car of running) {
      const driver = this.drivers.get(car.driverId)!;
      const team = this.teams.get(car.teamId)!;
      const gapAhead = gaps.get(car.driverId) ?? Infinity;

      const result = computeLap(car, {
        track: this.track,
        driver,
        team,
        weather: s.weather,
        flag: s.flag,
        evolution: s.trackEvolution,
        gapAhead,
        rng: this.rng,
      });

      car.energyMJ = result.battery;
      if (result.overrideUsed) car.overrideLeft -= 1;
      if (result.flatBattery && car.isPlayer) {
        this.log('radio', 'Батарея на нулі, немає розгортання!', car.driverId);
      }

      let time = result.time;

      // Дрібні помилки
      const mistake = checkMistake(car, driver, gapAhead < 0.8, this.rng, this.track.compression ?? 1);
      if (mistake) {
        time += mistake.cost;
        this.log('flat-spot', `${driver.short}: ${mistake.text}`, car.driverId);
      }

      // Піт-стоп
      if (car.pitRequest) {
        const stationary = pitStopTime(team, this.rng);
        // Під сейфті-каром піт коштує вдвічі дешевше — це і є те саме вікно
        // Під сейфті-каром пелотон повзе, тож проїзд піт-лейну коштує помітно
        // менше часу відносно суперників — саме тому вікно й цінне
        const lossMult = s.flag === 'safety-car' ? 0.35 : s.flag === 'vsc' ? 0.6 : 1;
        time += this.track.pitLoss * lossMult + stationary;

        const compound = car.pitRequest;
        car.tyre = freshTyre(compound);
        if (!car.compoundsUsed.includes(compound)) car.compoundsUsed.push(compound);
        car.stops += 1;
        car.pitRequest = null;
        car.status = 'running';
        pittedThisLap.add(car.driverId);

        const brain = this.brains.get(car.driverId);
        if (brain) advanceBrain(brain, car, s, this.rng);

        const why = pitReasons.get(car.driverId) ?? 'наказ';
        this.log(
          'pit',
          `${driver.short} у боксах [${why}] — ${COMPOUNDS[compound].label}, стоянка ${stationary.toFixed(2)}`,
          car.driverId,
        );
      } else {
        ageTyre(car.tyre, this.track, driver, car.paceMode, s.weather);
      }

      car.fuelKg = Math.max(0, car.fuelKg - fuelBurn(this.track, s.flag));
      lapTimes.set(car.driverId, time);
    }

    // 3. Розв'язання позицій: швидший не «протікає» крізь повільнішого
    this.resolvePositions(running, lapTimes, gaps, pittedThisLap);

    // 4. Застосування часу
    for (const car of running) {
      const t = lapTimes.get(car.driverId)!;
      car.totalTime += t;
      car.lastLap = t;
      car.lap += 1;
      if (s.flag === 'green' && t < car.bestLap) car.bestLap = t;
    }

    // 4.5 Стюарди. Перевіряємо після боротьби, бо невдала спроба обгону —
    //     головна причина уваги стюардів.
    for (const car of running) {
      if (car.status === 'dnf') continue;
      const driver = this.drivers.get(car.driverId)!;
      const reason = checkStewards(
        car,
        driver,
        this.failedDuels.has(car.driverId),
        s.totalLaps,
        REFERENCE_LAPS,
        this.rng,
      );
      if (!reason) continue;
      car.penalty += STEWARD_PENALTY;
      car.penalties += 1;
      car.penaltyReason = reason;
      car.totalTime += STEWARD_PENALTY;
      this.log('penalty', `${driver.short}: +5 с — ${reason}`, car.driverId);
    }
    this.failedDuels.clear();

    // 5. Найшвидше коло
    for (const car of running) {
      if (s.flag !== 'green') break;
      if (!s.fastestLap || car.lastLap < s.fastestLap.time) {
        s.fastestLap = { driverId: car.driverId, time: car.lastLap };
        this.log(
          'fastest-lap',
          `${this.drivers.get(car.driverId)!.short} — найшвидше коло ${fmt(car.lastLap)}`,
          car.driverId,
        );
      }
    }

    // 6. Сходи
    for (const car of running) {
      const team = this.teams.get(car.teamId)!;
      const driver = this.drivers.get(car.driverId)!;
      const reason = checkDnf(car, team, driver, this.rng, s.totalLaps);
      if (reason) {
        car.status = 'dnf';
        car.dnfReason = reason;
        this.log('dnf', `${driver.short} сходить: ${reason}`, car.driverId);
        // Сход часто тягне за собою сейфті-кар
        if (this.rng.chance(0.1) && s.flag === 'green') this.deploySafetyCar(4);
      }
    }

    // 7. Прапори
    if (s.flagLapsLeft > 0) {
      s.flagLapsLeft -= 1;
      if (s.flagLapsLeft === 0) {
        s.flag = 'green';
        this.log('safety-car-end', 'Сейфті-кар заїжджає — зелений прапор!');
      }
    } else {
      const scLaps = checkSafetyCar(s, this.track, this.rng);
      if (scLaps > 0) this.deploySafetyCar(scLaps);
    }

    this.resort();

    // 8. Фініш
    if (s.lap >= s.totalLaps) {
      for (const car of s.cars) if (car.status === 'running') car.status = 'finished';
      this.applyRulePenalties();
      this.resort();
      s.finished = true;
    }
  }

  /**
   * Ключове місце всієї симуляції: якщо швидша машина мала б обійти повільнішу
   * за чистим часом кола — це ще не обгін. Це спроба.
   */
  private resolvePositions(
    running: CarState[],
    lapTimes: Map<string, number>,
    gaps: Map<string, number>,
    pitted: Set<string>,
  ): void {
    for (let i = 1; i < running.length; i++) {
      const attacker = running[i]!;
      const defender = running[i - 1]!;

      // Той, хто щойно проїхав піт-лейн, ні з ким на трасі не бореться
      if (pitted.has(attacker.driverId) || pitted.has(defender.driverId)) continue;

      const aTime = attacker.totalTime + lapTimes.get(attacker.driverId)!;
      const dTime = defender.totalTime + lapTimes.get(defender.driverId)!;
      const gapAtEnd = aTime - dTime;

      if (gapAtEnd >= MIN_GAP) {
        attacker.stuckLaps = 0;
        continue;
      }

      const gapStart = gaps.get(attacker.driverId) ?? Infinity;
      if (gapStart > 2.5) continue; // здалеку не обганяють

      const paceDelta =
        lapTimes.get(defender.driverId)! - lapTimes.get(attacker.driverId)!;

      const result = duel({
        attacker,
        defender,
        attackerDriver: this.drivers.get(attacker.driverId)!,
        defenderDriver: this.drivers.get(defender.driverId)!,
        paceDelta,
        track: this.track,
        override: attacker.overrideArmed && attacker.overrideLeft >= 0,
        rng: this.rng,
      });

      if (result.passed) {
        lapTimes.set(attacker.driverId, lapTimes.get(attacker.driverId)! + result.attackerCost);
        lapTimes.set(
          defender.driverId,
          lapTimes.get(defender.driverId)! + result.defenderCost + MIN_GAP,
        );
        attacker.stuckLaps = 0;
        this.log(
          'overtake',
          `${this.drivers.get(attacker.driverId)!.short} проходить ${this.drivers.get(defender.driverId)!.short}!`,
          attacker.driverId,
          defender.driverId,
        );
      } else {
        // Не проїхав — упирається в задній дифузор і втрачає час
        const held = dTime + MIN_GAP - attacker.totalTime + result.attackerCost;
        lapTimes.set(attacker.driverId, held);
        lapTimes.set(defender.driverId, lapTimes.get(defender.driverId)! + result.defenderCost);
        attacker.stuckLaps += 1;
        this.failedDuels.add(attacker.driverId);

        if (attacker.stuckLaps === 3 && attacker.isPlayer) {
          this.log(
            'radio',
            'Я його не проїду на трасі. Потрібен андеркат.',
            attacker.driverId,
          );
        }
      }
    }
  }

  private deploySafetyCar(laps: number): void {
    this.state.flag = 'safety-car';
    this.state.flagLapsLeft = laps;
    // Пелотон збирається — це і є драма сейфті-кара.
    // Інтервал 1.8 с, а не 0.9: у справжній Ф1 двадцять машин за сейфті-каром
    // розтягнуті приблизно на 40 секунд траси. З надто щільним пелотоном
    // піт-стоп під SC відкидав на півтора десятка позицій — і головне рішення
    // гонки перетворювалось на самогубство замість вигоди.
    const running = this.state.cars
      .filter((c) => c.status === 'running')
      .sort((a, b) => a.totalTime - b.totalTime);
    const leader = running[0];
    if (leader) {
      running.forEach((car, i) => {
        car.totalTime = leader.totalTime + i * 1.8;
      });
    }
    this.log('safety-car', 'СЕЙФТІ-КАР НА ТРАСІ — вікно для піту відкрите!');
  }

  private resort(): void {
    const order = [...this.state.cars].sort((a, b) => {
      if (a.status === 'dnf' && b.status !== 'dnf') return 1;
      if (b.status === 'dnf' && a.status !== 'dnf') return -1;
      if (a.lap !== b.lap) return b.lap - a.lap;
      return a.totalTime - b.totalTime;
    });
    order.forEach((car, i) => {
      car.position = i + 1;
    });
  }

  private log(kind: RaceEvent['kind'], text: string, driverId?: string, otherId?: string): void {
    this.state.events.push({ lap: this.state.lap, kind, text, driverId, otherId });
  }

  /** Прорахувати гонку до кінця (для headless-тестів і швидкої симуляції). */
  runToEnd(): RaceState {
    let guard = 0;
    while (!this.state.finished && guard++ < 500) this.step();
    return this.state;
  }

  classification(): ClassifiedCar[] {
    const order = [...this.state.cars].sort((a, b) => a.position - b.position);
    const leader = order.find((c) => c.status !== 'dnf');
    return order.map((car, i) => {
      const driver = this.drivers.get(car.driverId)!;
      const team = this.teams.get(car.teamId)!;
      const fl = this.state.fastestLap?.driverId === car.driverId;
      return {
        position: i + 1,
        driver,
        team,
        status: car.status,
        totalTime: car.totalTime,
        gap: car.status === 'dnf' || !leader ? null : car.totalTime - leader.totalTime,
        stops: car.stops,
        bestLap: car.bestLap === Infinity ? null : car.bestLap,
        compounds: car.compoundsUsed,
        dnfReason: car.dnfReason,
        penalty: car.penalty,
        penaltyReason: car.penaltyReason,
        startPosition: car.startPosition,
        gained: car.status === 'dnf' ? 0 : car.startPosition - (i + 1),
        points:
          car.status === 'dnf' ? 0 : (POINTS[i] ?? 0) + (fl && i < 10 ? 1 : 0),
        fastestLap: fl,
      };
    });
  }
}

export interface ClassifiedCar {
  position: number;
  driver: Driver;
  team: Team;
  status: CarState['status'];
  totalTime: number;
  gap: number | null;
  stops: number;
  bestLap: number | null;
  compounds: CompoundId[];
  dnfReason: string | null;
  penalty: number;
  penaltyReason: string | null;
  /** Позиція на старті. */
  startPosition: number;
  /** Відіграні місця: додатне — піднявся, відʼємне — відкотився. */
  gained: number;
  points: number;
  fastestLap: boolean;
}

export function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}
