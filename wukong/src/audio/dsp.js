// Pure DSP helpers for the procedural audio system: math, seeded PRNG, envelope helpers,
// formant tables, PeriodicWave builders, procedurally generated sample buffers and the
// cathedral impulse response. Nothing in here is downloaded; every sound is computed.

export const TAU = Math.PI * 2;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (d) => Math.pow(10, d / 20);
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
/** Web Audio lowpass/highpass biquads take Q as a resonance in dB. */
export const qToDb = (q) => 20 * Math.log10(Math.max(q, 1e-3));

// ---------------------------------------------------------------- PRNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = (Math.random() * 4294967296) >>> 0) { this.next = mulberry32(seed); }
  float() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  /** x scaled by a uniform factor in [1-amt, 1+amt]. */
  vary(x, amt = 0.05) { return x * (1 + (this.next() * 2 - 1) * amt); }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  chance(p) { return this.next() < p; }
}

// ---------------------------------------------------------------- envelopes (AudioParam)
/** 0 -> peak (linear, `attack` s) then exponential decay (time-constant `tau`). Returns ~-60 dB time. */
export function adEnv(param, t, peak, attack, tau) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, Math.max(tau, 1e-3));
  return t + attack + tau * 7;
}

/** Attack to peak, hold until t+hold, exponential release. Returns ~-60 dB time. */
export function asrEnv(param, t, peak, attack, hold, release) {
  const h = Math.max(hold, attack);
  const r = Math.max(release, 0.01);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setValueAtTime(peak, t + h);
  param.setTargetAtTime(0, t + h, r / 4);
  return t + h + r * 1.8;
}

/** Exponential crescendo from `floor`*peak (audible from the start) to peak over `rise`, hold, release. */
export function swellEnv(param, t, peak, rise, hold, release, floor = 0.02) {
  const r = Math.max(release, 0.01), pk = Math.max(peak, 0.0002);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(pk * floor, t + 0.02);
  param.exponentialRampToValueAtTime(pk, t + Math.max(rise, 0.03));
  param.setValueAtTime(pk, t + Math.max(rise, 0.03) + hold);
  param.setTargetAtTime(0, t + Math.max(rise, 0.03) + hold, r / 4);
  return t + rise + hold + r * 1.8;
}

// ---------------------------------------------------------------- formants
// Vowel formant centre frequencies F1..F4 (Hz), roughly Peterson & Barney, slightly "covered"
// (darker) for a sacred choral colour.
export const VOWELS = {
  female: {
    a: [850, 1220, 2810, 3800], e: [600, 2000, 2900, 3800], i: [330, 2550, 3150, 3900],
    o: [560, 900, 2700, 3700], u: [380, 820, 2650, 3700],
  },
  male: {
    a: [720, 1090, 2440, 3300], e: [520, 1800, 2480, 3300], i: [290, 2250, 2950, 3400],
    o: [500, 820, 2400, 3300], u: [330, 760, 2250, 3200],
  },
};
export const FORMANT_BW = [95, 115, 170, 260];

/** |H(f)| of a Web Audio lowpass biquad (cutoff fc, Q in dB). */
export function lowpassMag(f, fc, qDb, sr) {
  const w0 = (TAU * fc) / sr, cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Math.pow(10, qDb / 20));
  const b0 = (1 - cw) / 2, b1 = 1 - cw, b2 = b0, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  const w = (TAU * f) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** Formant frequencies for a vowel, with F1 raised to track high fundamentals (singer's formant tuning). */
export function vowelFormants(sex, vowel, f0max) {
  const F = (VOWELS[sex] || VOWELS.female)[vowel] || VOWELS.female.a;
  const out = F.slice();
  out[0] = Math.max(out[0], f0max * 1.08);
  if (out[1] < out[0] * 1.25) out[1] = out[0] * 1.25;
  return out;
}

/** Mean power of one source voice (harmonic amplitudes `amps`) through the 4-pole formant cascade. */
export function formantPower(f0, amps, F, sr) {
  let p = 0;
  const lim = sr * 0.45;
  const qs = F.map((fc, k) => qToDb(fc / FORMANT_BW[k]));
  for (let n = 1; n < amps.length; n++) {
    const f = n * f0;
    if (f >= lim) break;
    let m = amps[n];
    for (let k = 0; k < F.length; k++) m *= lowpassMag(f, F[k], qs[k], sr);
    p += 0.5 * m * m;
  }
  return Math.max(p, 1e-9);
}

// ---------------------------------------------------------------- wavetables
function buildWave(ctx, amps) {
  const N = amps.length - 1;
  const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    const ph = (Math.PI * n * n) / N; // Schroeder phases: low crest factor
    real[n] = amps[n] * Math.sin(ph);
    imag[n] = amps[n] * Math.cos(ph);
  }
  // Normalise the time-domain peak ourselves so harmonic amplitudes stay known.
  const M = 2048;
  let peak = 1e-9;
  const cosT = new Float32Array(M), sinT = new Float32Array(M);
  for (let i = 0; i < M; i++) { cosT[i] = Math.cos((TAU * i) / M); sinT[i] = Math.sin((TAU * i) / M); }
  for (let i = 0; i < M; i++) {
    let x = 0;
    for (let n = 1; n <= N; n++) {
      const k = (n * i) % M;
      x += real[n] * cosT[k] + imag[n] * sinT[k];
    }
    if (Math.abs(x) > peak) peak = Math.abs(x);
  }
  const s = 0.98 / peak;
  const scaled = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) { real[n] *= s; imag[n] *= s; scaled[n] = amps[n] * s; }
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  let pow = 0;
  for (let n = 1; n <= N; n++) pow += 0.5 * scaled[n] * scaled[n];
  return { wave, amps: scaled, rms: Math.sqrt(pow) };
}

const PIPE = [0, 1, 0.42, 0.24, 0.13, 0.09, 0.06, 0.045, 0.03, 0.02, 0.015]; // open principal pipe
const STOPPED = [0, 1, 0.03, 0.22, 0.02, 0.07, 0.01, 0.03]; // stopped flute (odd harmonics)

function addRank(amps, harm, level, spec = PIPE) {
  for (let k = 1; k < spec.length; k++) {
    const n = harm * k;
    if (n < amps.length) amps[n] += level * spec[k];
  }
}

export function makeWaves(ctx) {
  // Glottal-ish source: -6 dB/oct (saw-like) with extra tilt above the 16th harmonic.
  const g = new Float32Array(97);
  for (let n = 1; n <= 96; n++) g[n] = (1 / n) * (n > 16 ? Math.pow(16 / n, 0.45) : 1);

  // Principal chorus 8' 4' 2 2/3' 2' (oscillator at 8' pitch).
  const pr = new Float32Array(41);
  addRank(pr, 1, 1.0); addRank(pr, 2, 0.55); addRank(pr, 3, 0.16, STOPPED); addRank(pr, 4, 0.3);

  // Full organ (oscillator at 16' pitch): 16' bourdon, 8', 4', 2 2/3', 2', tierce, larigot, 1', mixture, trumpet 8'.
  const fu = new Float32Array(65);
  addRank(fu, 1, 0.55, STOPPED); addRank(fu, 2, 1.0); addRank(fu, 4, 0.75); addRank(fu, 6, 0.35);
  addRank(fu, 8, 0.55); addRank(fu, 10, 0.16); addRank(fu, 12, 0.3); addRank(fu, 16, 0.32);
  addRank(fu, 24, 0.2); addRank(fu, 32, 0.16);
  for (let k = 1; 2 * k < fu.length; k++) fu[2 * k] += 0.42 / Math.pow(k, 0.65); // trumpet

  // Soft flutes 8' + 4' (victory).
  const fl = new Float32Array(17);
  addRank(fl, 1, 1.0, STOPPED); addRank(fl, 2, 0.32, [0, 1, 0.12, 0.05]);

  // Dark: 16' bourdon + 8' + soft 16' reed (defeat swell), oscillator at 16'.
  const dk = new Float32Array(41);
  addRank(dk, 1, 1.0, STOPPED); addRank(dk, 2, 0.5);
  for (let k = 1; k < dk.length; k++) dk[k] += 0.22 / Math.pow(k, 1.05);

  return {
    glottal: buildWave(ctx, g),
    principal: { ...buildWave(ctx, pr), octave: 1 },
    full: { ...buildWave(ctx, fu), octave: 0.5 },
    flute: { ...buildWave(ctx, fl), octave: 1 },
    dark: { ...buildWave(ctx, dk), octave: 0.5 },
  };
}

// ---------------------------------------------------------------- noise loops
function rmsOf(d) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); }
function scaleTo(d, target, mode = 'rms') {
  let m = 0;
  if (mode === 'rms') m = rmsOf(d);
  else for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) { const s = target / m; for (let i = 0; i < d.length; i++) d[i] *= s; }
}

/** Seamless loop: generate len+X samples, crossfade the overflow into the head. */
function loopify(gen, len, x) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = gen[i];
  for (let i = 0; i < x; i++) {
    const a = i / x;
    out[i] = gen[len + i] * Math.cos(a * Math.PI * 0.5) + gen[i] * Math.sin(a * Math.PI * 0.5);
  }
  return out;
}

export function makeNoise(ctx, rng) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 2.0), X = Math.floor(sr * 0.05), L = len + X;
  const w = new Float32Array(L), p = new Float32Array(L), b = new Float32Array(L);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < L; i++) {
    const x = rng.float() * 2 - 1;
    w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02; b[i] = br;
  }
  const mk = (src, rms) => {
    const d = loopify(src, len, X);
    scaleTo(d, rms);
    const buf = ctx.createBuffer(1, len, sr);
    buf.getChannelData(0).set(d);
    return buf;
  };
  return { white: mk(w, 0.5), pink: mk(p, 0.5), brown: mk(b, 0.5) };
}

// ---------------------------------------------------------------- procedural sample bank
/** Resonant noise burst (constant-peak bandpass) added into d at sample s. */
function grain(d, s, sr, amp, fc, Q, tau, rng) {
  fc = Math.min(fc, sr * 0.45);
  const w = (TAU * fc) / sr, alpha = Math.sin(w) / (2 * Q), a0 = 1 + alpha;
  const b0 = alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let y1 = 0, y2 = 0, x1 = 0, x2 = 0;
  // run until both the excitation and the resonator's own ringing have died away (~-55 dB)
  const ring = Q / (Math.PI * fc);
  const n = Math.min(d.length - s, Math.floor((tau * 6 + ring * 6.5) * sr));
  const dec = Math.exp(-1 / (tau * sr));
  let env = 1;
  for (let i = 0; i < n; i++) {
    const x = (rng.float() * 2 - 1) * env;
    env *= dec;
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    d[s + i] += amp * y;
  }
}

/** Sum of decaying sines (metallic / glassy ping); partial j decays (1 + 0.6 j) times faster. */
function ping(d, s, sr, amp, freqs, gains, tau) {
  for (let j = 0; j < freqs.length; j++) {
    if (freqs[j] > sr * 0.45) continue;
    const tj = tau / (1 + j * 0.6);
    const n = Math.min(d.length - s, Math.floor(tj * 6.5 * sr));
    // damped sine by recursion: y[i] = A r^i sin(w i)
    const r = Math.exp(-1 / (tj * sr)), w = (TAU * freqs[j]) / sr;
    const c = 2 * r * Math.cos(w), r2 = r * r;
    let y0 = 0, y1 = amp * gains[j] * r * Math.sin(w);
    for (let i = 1; i < n; i++) {
      d[s + i] += i < 8 ? (y1 * i) / 8 : y1;
      const y = c * y1 - r2 * y0;
      y0 = y1; y1 = y;
    }
  }
}

/** Rising-pitch decaying sine: a bubble. */
function bubble(d, s, sr, amp, f0, rise, tau) {
  const n = Math.min(d.length - s, Math.floor(tau * 6 * sr));
  const dec = Math.exp(-1 / (tau * sr)), w0 = (TAU * f0) / sr, dw = (w0 * rise) / (tau * sr);
  let ph = 0, env = amp;
  for (let i = 0; i < n; i++) {
    ph += w0 + dw * i;
    d[s + i] += env * Math.sin(ph) * (i < 24 ? i / 24 : 1);
    env *= dec;
  }
}

const expTime = (rng, mean, cap) => Math.min(cap, -mean * Math.log(1 - rng.float() * 0.999));

function genDrops(d, sr, rng, { count, mean, fLo, fHi }) {
  const dur = d.length / sr;
  for (let k = 0; k < count; k++) {
    const t0 = k < 3 ? rng.range(0, 0.03) : expTime(rng, mean, dur * 0.85);
    const s = Math.floor(t0 * sr);
    const amp = rng.range(0.3, 1) * Math.exp(-t0 / (mean * 2.5));
    if (rng.chance(0.55)) bubble(d, s, sr, amp * 0.7, rng.range(fLo, fHi), rng.range(0.3, 1.6), rng.range(0.006, 0.03));
    else grain(d, s, sr, amp * 2.2, rng.range(1600, 7500), rng.range(1.2, 3.5), rng.range(0.002, 0.012), rng);
  }
}

function genCrackle(d, sr, rng, { events, fLo, fHi, Q, tau, gapLong }) {
  const dur = d.length / sr;
  let t = rng.range(0, 0.01);
  for (let k = 0; k < events && t < dur * 0.9; k++) {
    const s = Math.floor(t * sr);
    const amp = rng.range(0.25, 1) * Math.exp(-t / (dur * 0.55));
    grain(d, s, sr, amp * 3, rng.range(fLo, fHi), Q * rng.range(0.6, 1.4), tau * rng.range(0.5, 1.6), rng);
    const sg = rng.sign();
    if (s + 2 < d.length) { d[s] += amp * 0.9 * sg; d[s + 1] -= amp * 0.5 * sg; }
    t += rng.chance(0.25) ? rng.range(gapLong * 0.4, gapLong) : rng.range(0.0015, 0.012);
  }
}

function genChain(d, sr, rng, count) {
  const dur = d.length / sr;
  for (let k = 0; k < count; k++) {
    const t0 = expTime(rng, dur * 0.22, dur * 0.85);
    const f1 = rng.range(3200, 9000);
    ping(d, Math.floor(t0 * sr), sr, rng.range(0.2, 1) * Math.exp(-t0 / (dur * 0.4)),
      [f1, f1 * rng.range(1.35, 2.4)], [1, 0.5], rng.range(0.003, 0.014));
  }
}

function genGlass(d, sr, rng, count) {
  const dur = d.length / sr;
  // the initial crash: bright decaying noise (first difference = highpass)
  let prev = 0;
  for (let i = 0; i < Math.floor(0.12 * sr); i++) {
    const x = rng.float() * 2 - 1;
    d[i] += (x - prev) * 0.55 * Math.exp(-i / (0.03 * sr));
    prev = x;
  }
  for (let k = 0; k < count; k++) {
    const t0 = k < 8 ? rng.range(0, 0.05) : expTime(rng, 0.22, dur * 0.85);
    const f = rng.range(2000, 10500);
    ping(d, Math.floor(t0 * sr), sr, rng.range(0.15, 0.7) * Math.exp(-t0 / 0.6),
      [f, f * rng.range(2.2, 2.45), f * rng.range(3.7, 4.1)], [1, 0.45, 0.25], rng.range(0.025, 0.18));
  }
}

function genCloth(d, sr, rng, count) {
  const dur = d.length / sr;
  for (let k = 0; k < count; k++) {
    const u = rng.float();
    const t0 = dur * 0.8 * Math.sqrt(u) * (1 - 0.5 * rng.float()); // denser early-middle
    const env = Math.sin(Math.PI * Math.min(1, t0 / (dur * 0.8)));
    grain(d, Math.floor(t0 * sr), sr, (0.3 + env) * rng.range(0.3, 1), rng.range(900, 5200), rng.range(0.6, 1.4), rng.range(0.004, 0.03), rng);
  }
}

function genDebris(d, sr, rng, count) {
  const dur = d.length / sr;
  let t = rng.range(0.0, 0.02);
  for (let k = 0; k < count && t < dur * 0.9; k++) {
    const amp = rng.range(0.3, 1) * Math.exp(-t / 0.55);
    grain(d, Math.floor(t * sr), sr, amp * 4, rng.range(500, 3600), rng.range(5, 14), rng.range(0.003, 0.012), rng);
    t += rng.range(0.008, 0.09) * (1 + k * 0.06);
  }
}

function genGrit(d, sr, rng) {
  let env = 0.5;
  for (let i = 0; i < d.length; i++) {
    if ((i & 63) === 0) env = clamp(env + (rng.float() - 0.5) * 0.25, 0.15, 1);
    let x = (rng.float() * 2 - 1) * 0.3;
    if (rng.float() < 0.006) x += (rng.float() * 2 - 1) * 2.4;
    d[i] = x * env;
  }
}

/**
 * Procedural one-shot buffers (water drops, crackles, chainmail, glass, cloth, debris, grit).
 * Each category is generated lazily on first access with its own seeded PRNG (so the result
 * does not depend on access order); bank.warm() pre-generates everything in idle ticks.
 */
export function makeSampleBank(ctx, seed) {
  const sr = ctx.sampleRate;
  const mk = (sec, fn) => {
    const len = Math.floor(sec * sr);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    fn(d, sr);
    scaleTo(d, 0.9, 'peak');
    // gentle fade-out on the last 30 ms
    const f = Math.floor(0.03 * sr);
    for (let i = 0; i < f; i++) d[len - 1 - i] *= i / f;
    return buf;
  };
  const n = (k, fn) => Array.from({ length: k }, fn);
  const gens = {
    drops: (rng) => n(3, () => mk(1.3, (d) => genDrops(d, sr, rng, { count: 46, mean: 0.16, fLo: 450, fHi: 2400 }))),
    dropsBig: (rng) => n(2, () => mk(2.2, (d) => genDrops(d, sr, rng, { count: 120, mean: 0.42, fLo: 300, fHi: 2000 }))),
    wax: (rng) => n(3, () => mk(0.55, (d) => genCrackle(d, sr, rng, { events: 34, fLo: 1800, fHi: 6500, Q: 4, tau: 0.0025, gapLong: 0.07 }))),
    stone: (rng) => n(2, () => mk(0.9, (d) => genCrackle(d, sr, rng, { events: 60, fLo: 500, fHi: 3200, Q: 2.2, tau: 0.004, gapLong: 0.05 }))),
    chain: (rng) => n(3, () => mk(0.45, (d) => genChain(d, sr, rng, 85))),
    glass: (rng) => n(2, () => mk(1.6, (d) => genGlass(d, sr, rng, 60))),
    cloth: (rng) => n(2, () => mk(0.65, (d) => genCloth(d, sr, rng, 150))),
    debris: (rng) => n(2, () => mk(1.6, (d) => genDebris(d, sr, rng, 32))),
    grit: (rng) => [mk(1.8, (d) => genGrit(d, sr, rng))],
  };
  const bank = {};
  Object.keys(gens).forEach((key, i) => {
    Object.defineProperty(bank, key, {
      configurable: true, enumerable: true,
      get() {
        const value = gens[key](new Rng((seed + Math.imul(0x9e3779b1, i + 1)) >>> 0));
        Object.defineProperty(bank, key, { value, enumerable: true });
        return value;
      },
    });
  });
  Object.defineProperty(bank, 'warm', {
    value() {
      const keys = Object.keys(gens);
      const step = () => { const k = keys.shift(); if (k) { void bank[k]; setTimeout(step, 0); } };
      setTimeout(step, 0);
    },
  });
  return bank;
}

// ---------------------------------------------------------------- cathedral impulse response
/**
 * Stereo cathedral IR: pre-delay, sparse early reflections, then decorrelated noise with an
 * exponential decay whose spectrum darkens over time (high frequencies die first). Unit energy
 * per channel so that send levels map directly to wet/dry ratios.
 */
export function cathedralIR(ctx, rng, { seconds = 5.2, rt60 = 4.6, predelay = 0.032, sideHz = 300 } = {}) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(predelay * sr);
  const decayK = -6.907755 / (rt60 * sr);
  const diffuse = () => {
    const d = new Float32Array(len);
    let l1 = 0, l2 = 0;
    for (let i = pre; i < len; i++) {
      const n = i - pre, tt = n / sr;
      const fc = 700 + 9800 * Math.exp(-tt / 0.75);
      const a = 1 - Math.exp((-TAU * fc) / sr);
      l1 += a * ((rng.float() * 2 - 1) - l1);
      l2 += a * (l1 - l2);
      const build = tt < 0.12 ? Math.sin((tt / 0.12) * Math.PI * 0.5) : 1;
      // lows keep the full rt60 decay; the darkening lowpass makes the highs die sooner
      d[i] = l2 * Math.exp(decayK * n) * build * 0.35;
    }
    return d;
  };
  // Mid/side: the side signal is high-passed, so the low end of the tail is identical in
  // both channels (no random L/R bass imbalance) while the highs are fully decorrelated.
  const M = diffuse(), S = diffuse();
  const ah = Math.exp((-TAU * sideHz) / sr);
  for (let pass = 0; pass < 2; pass++) {
    let px = 0, py = 0;
    for (let i = 0; i < len; i++) { const x = S[i]; py = ah * (py + x - px); px = x; S[i] = py; }
  }
  const chans = [buf.getChannelData(0), buf.getChannelData(1)];
  for (let i = 0; i < len; i++) { chans[0][i] = M[i] + S[i]; chans[1][i] = M[i] - S[i]; }
  for (const d of chans) {
    // early reflections off distant stone (stereo-decorrelated)
    for (let k = 0; k < 18; k++) {
      const tt = 0.008 + rng.float() * 0.13;
      const s = pre + Math.floor(tt * sr);
      const amp = rng.range(0.4, 1) * Math.exp(-tt / 0.09) * 0.3 * rng.sign();
      for (let j = 0; j < 40 && s + j < len; j++) d[s + j] += amp * Math.exp(-j / 7) * (j & 1 ? -0.4 : 1);
    }
    const fo = Math.floor(0.3 * sr);
    for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
  }
  // unit energy per channel (one common scale keeps the L/R balance exact)
  let e = 0;
  for (const d of chans) for (let i = 0; i < len; i++) e += d[i] * d[i];
  const s = 1 / Math.sqrt(e / 2 || 1);
  for (const d of chans) for (let i = 0; i < len; i++) d[i] *= s;
  return buf;
}

/** Soft-clip curve for the final safety stage. Input domain [-1,1] represents [-2,2]. */
export function softClipCurve(n = 8193, knee = 0.75, ceiling = 0.985) {
  const c = new Float32Array(n), span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const ax = Math.abs(x);
    c[i] = Math.sign(x) * (ax <= knee ? ax : knee + span * Math.tanh((ax - knee) / span));
  }
  return c;
}
