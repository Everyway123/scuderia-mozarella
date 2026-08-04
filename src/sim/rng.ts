// Детермінований генератор випадкових чисел.
// Уся випадковість гри проходить через нього — гонка з тим самим seed
// відтворюється побайтово. Без цього неможливі ні тести, ні «переграти гонку».

export class Rng {
  private s: number;

  constructor(seed: number) {
    // mulberry32 погано стартує з малих seed — розганяємо змішуванням
    this.s = (seed >>> 0) || 0x9e3779b9;
    for (let i = 0; i < 4; i++) this.next();
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Нормальний розподіл (Box–Muller). Помилки пілотів і шум часу кола — звідси. */
  gauss(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** true з імовірністю p */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Дочірній потік — щоб окрема підсистема не зсувала послідовність решти. */
  fork(salt: number): Rng {
    return new Rng((this.s ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
  }
}
