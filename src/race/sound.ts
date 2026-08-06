// Звук трансляції: усе генерується на льоту з осциляторів і шуму —
// нуль ассетів, як у «Сталевому Ангарі». Кожен звук — коротка подія-сигнал,
// а не фонова каша: радіо-сквелч, гайковерт, стартові вогні, клаксон SC.

const KEY = 'smSound';

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = localStorage.getItem(KEY) !== '0';

function ensure(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null; // без аудіо гра лишається грою
  }
}

function noise(): AudioBuffer {
  const c = ctx!;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function beep(
  freq: number,
  dur: number,
  type: OscillatorType = 'square',
  vol = 0.05,
  freqEnd?: number,
  delay = 0,
): void {
  const c = ensure();
  if (!c || !enabled) return;
  try {
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  } catch {
    /* аудіо — прикраса, не функція */
  }
}

function burst(
  dur: number,
  filterType: BiquadFilterType,
  filterFreq: number,
  vol: number,
  delay = 0,
): void {
  const c = ensure();
  if (!c || !enabled) return;
  try {
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = noise();
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(c.destination);
    src.start(t);
    src.stop(t + dur);
  } catch {
    /* тиша — теж ок */
  }
}

export const sound = {
  get on(): boolean {
    return enabled;
  },

  toggle(): boolean {
    enabled = !enabled;
    try {
      localStorage.setItem(KEY, enabled ? '1' : '0');
    } catch {
      /* приватний режим */
    }
    if (enabled) beep(880, 0.07, 'sine', 0.05);
    return enabled;
  },

  /** П'ять червоних вогнів — і старт. Іконічний ритуал Ф1. */
  startLights(): void {
    for (let i = 0; i < 5; i++) beep(440, 0.09, 'square', 0.045, undefined, i * 0.42);
    beep(880, 0.5, 'square', 0.06, undefined, 5 * 0.42);
    burst(0.5, 'lowpass', 500, 0.06, 5 * 0.42);
  },

  /** Сквелч командного радіо перед повідомленням. */
  radio(): void {
    burst(0.04, 'highpass', 2400, 0.03);
    beep(1250, 0.05, 'triangle', 0.035, undefined, 0.05);
  },

  /** Піт-стоп: черга пневмогайковерта і металевий дзвін. */
  pit(): void {
    for (let i = 0; i < 3; i++) burst(0.05, 'bandpass', 3200, 0.05, i * 0.07);
    beep(1900, 0.1, 'triangle', 0.03, undefined, 0.24);
  },

  /** Обгін — короткий висхідний стінг. */
  overtake(): void {
    beep(520, 0.1, 'sawtooth', 0.035, 880);
    beep(1040, 0.12, 'triangle', 0.03, undefined, 0.09);
  },

  /** Сейфті-кар: двотонний клаксон тривоги. */
  safetyCar(): void {
    beep(620, 0.16, 'square', 0.05);
    beep(465, 0.2, 'square', 0.05, undefined, 0.17);
    beep(620, 0.16, 'square', 0.04, undefined, 0.4);
    beep(465, 0.2, 'square', 0.04, undefined, 0.57);
  },

  /** Зелений прапор — рестарт. */
  green(): void {
    beep(660, 0.08, 'square', 0.045);
    beep(990, 0.14, 'square', 0.045, undefined, 0.09);
  },

  /** Дощ пішов: м'яка шумова хвиля. */
  rain(): void {
    burst(0.9, 'lowpass', 900, 0.045);
    beep(392, 0.35, 'sine', 0.03, 330);
  },

  /** Схід: мотор глохне. */
  dnf(): void {
    beep(220, 0.55, 'sawtooth', 0.05, 45);
    burst(0.35, 'lowpass', 380, 0.06, 0.1);
  },

  /** Штраф стюардів — неприємний зумер. */
  penalty(): void {
    beep(310, 0.22, 'square', 0.045, 260);
  },

  /** Найшвидше коло — фіолетовий сектор. */
  fastest(): void {
    beep(784, 0.08, 'sine', 0.04);
    beep(988, 0.08, 'sine', 0.04, undefined, 0.08);
    beep(1319, 0.16, 'sine', 0.045, undefined, 0.16);
  },

  /** Момент рішення: дзвінок уваги, гра стала на паузу. */
  prompt(): void {
    beep(1047, 0.09, 'triangle', 0.05);
    beep(1568, 0.13, 'triangle', 0.04, undefined, 0.1);
  },

  /** Клітчастий прапор. */
  finish(): void {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => beep(f, 0.14, 'square', 0.045, undefined, i * 0.13));
    beep(1319, 0.4, 'square', 0.05, undefined, seq.length * 0.13);
  },
};
