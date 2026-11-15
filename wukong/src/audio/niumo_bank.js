// Procedural sample bank for the Flame Mountain (niumo) scene: war drums, opera gongs, tam-tam,
// cymbals, a deep temple bell, a wooden fish, guqin strings (extended Karplus-Strong), rain, fire
// and lava textures, plus the caldera impulse response and the suona wavetable.
//
// Everything is computed in JS into AudioBuffers, lazily per category, each category with its own
// seeded PRNG (results never depend on access order). bank.warm() pre-generates the lot in idle
// ticks. Nothing here touches the engine's main PRNG, so the cathedral scene is unaffected.
import { Rng, TAU, clamp, mtof } from './dsp.js';

// ---------------------------------------------------------------- small JS DSP kit
/** RBJ biquad coefficients [b0, b1, b2, a1, a2] (normalised). bandpass = constant 0 dB peak. */
function bq(type, f, Q, gainDb, sr) {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr, cw = Math.cos(w), sw = Math.sin(w);
  const A = Math.pow(10, gainDb / 40), al = sw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; } // peaking
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function filt(d, c, from = 0, to = d.length) {
  const [b0, b1, b2, a1, a2] = c;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = from; i < to; i++) {
    const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
  }
  return d;
}

function peakOf(d) { let m = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; } return m; }
function normalize(d, target = 0.9) { const m = peakOf(d); if (m > 0) { const s = target / m; for (let i = 0; i < d.length; i++) d[i] *= s; } return d; }
function fadeOut(d, sr, sec) { const f = Math.min(d.length, Math.floor(sec * sr)); for (let i = 0; i < f; i++) d[d.length - 1 - i] *= i / f; return d; }
function fadeIn(d, sr, sec) { const f = Math.min(d.length, Math.floor(sec * sr)); for (let i = 0; i < f; i++) d[i] *= i / f; return d; }
/** tanh saturation normalised to the same peak. */
function saturate(d, k) { normalize(d, 1); const tk = Math.tanh(k); for (let i = 0; i < d.length; i++) d[i] = Math.tanh(k * d[i]) / tk; return d; }
/** One-pole DC blocker (~fc Hz). */
function dcBlock(d, sr, fc = 18) {
  const a = Math.exp((-TAU * fc) / sr);
  let px = 0, py = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i]; py = a * (py + x - px); px = x; d[i] = py; }
  return d;
}

/** Seamless loop: the overflow past `len` is crossfaded (equal power) into the head. */
function loopify(gen, len, x) {
  const out = new Float32Array(len);
  out.set(gen.subarray(0, len));
  for (let i = 0; i < x; i++) {
    const a = i / x;
    out[i] = gen[len + i] * Math.cos(a * Math.PI * 0.5) + gen[i] * Math.sin(a * Math.PI * 0.5);
  }
  return out;
}

/**
 * Add one decaying sinusoidal mode into d (rotation oscillator, coefficients updated every 32 samples):
 *   f(t) = f * (1 + glide * e^(-t/glideT))          (pitch droop: tension falls as the vibration dies)
 *   a(t) = amp * ramp(attack) * (1 - e^(-t/rise)) * e^(-t/tau) * (1 + beatAmp cos(2 pi beat t)) / (1 + beatAmp)
 * rise > 0 gives a delayed swell ("bloom", energy flowing up into the high modes of a gong).
 */
function partial(d, sr, {
  f, amp, tau, start = 0, attack = 0.0015, rise = 0, glide = 0, glideT = 0.3, beat = 0, beatAmp = 0, phase = 0,
}) {
  const s0 = Math.floor(start * sr);
  const n = Math.min(d.length - s0, Math.ceil((tau * 7 + rise * 2 + attack) * sr));
  if (n <= 0 || f <= 0) return;
  const lim = sr * 0.45, B = 32, ba = beatAmp > 0 ? 1 / (1 + beatAmp) : 1;
  const ampAt = (tm) => {
    let a = amp * Math.exp(-tm / tau);
    if (tm < attack) a *= tm / attack;
    if (rise > 0) a *= 1 - Math.exp(-tm / rise);
    if (beatAmp > 0) a *= (1 + beatAmp * Math.cos(TAU * beat * tm)) * ba;
    return a;
  };
  let x = Math.cos(phase), y = Math.sin(phase);
  for (let i0 = 0; i0 < n; i0 += B) {
    const tm = (i0 + B * 0.5) / sr;
    const fr = glide ? f * (1 + glide * Math.exp(-tm / glideT)) : f;
    const i1 = Math.min(i0 + B, n);
    if (fr >= lim) continue;
    const w = (TAU * fr) / sr, c = Math.cos(w), sn = Math.sin(w);
    const a0 = ampAt(i0 / sr), a1 = ampAt(i1 / sr), da = (a1 - a0) / (i1 - i0);
    let a = a0;
    for (let i = i0; i < i1; i++) {
      const nx = x * c - y * sn; y = x * sn + y * c; x = nx;
      d[s0 + i] += y * a; a += da;
    }
    const r = 1 / Math.sqrt(x * x + y * y); x *= r; y *= r;
  }
}

/** Filtered noise burst added into d: linear attack, exponential decay, then the given biquads. */
function burst(d, sr, rng, { at = 0, attack = 0.0005, tau = 0.01, amp = 1, filters = [] }) {
  const s = Math.floor(at * sr), n = Math.min(d.length - s, Math.ceil((attack + tau * 7) * sr));
  if (n <= 0) return;
  const tmp = new Float32Array(n), na = Math.max(1, Math.floor(attack * sr)), dec = Math.exp(-1 / (tau * sr));
  let e = 1;
  for (let i = 0; i < n; i++) { const a = i < na ? i / na : (e *= dec); tmp[i] = (rng.float() * 2 - 1) * a; }
  for (const c of filters) filt(tmp, c);
  for (let i = 0; i < n; i++) d[s + i] += amp * tmp[i];
}

/** Resonant noise grain (constant-peak bandpass ringing): drops, ticks, wood. */
function grain(d, s, sr, amp, fc, Q, tau, rng) {
  fc = Math.min(fc, sr * 0.45);
  const w = (TAU * fc) / sr, alpha = Math.sin(w) / (2 * Q), a0 = 1 + alpha;
  const b0 = alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let y1 = 0, y2 = 0, x1 = 0, x2 = 0;
  const ringT = Q / (Math.PI * fc);
  const n = Math.min(d.length - s, Math.floor((tau * 6 + ringT * 6.5) * sr));
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

/** Rising-pitch decaying sine: a bubble / drop. */
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

const logRand = (rng, lo, hi) => Math.exp(rng.range(Math.log(lo), Math.log(hi)));

// ---------------------------------------------------------------- war drums (战鼓 / 堂鼓)
// Ideal circular membrane modes [ratio, amp when struck in the centre, amp when struck near the edge, decay factor].
const MEMBRANE = [
  [1.0, 1.0, 0.5, 1.0], [1.594, 0.1, 0.5, 0.55], [2.136, 0.07, 0.42, 0.45], [2.296, 0.3, 0.2, 0.5],
  [2.653, 0.05, 0.3, 0.4], [2.918, 0.1, 0.18, 0.36], [3.156, 0.04, 0.2, 0.32], [3.6, 0.08, 0.1, 0.3],
];

function genDrum(sr, rng, { f0, dur, edge = false, tau0 = 0.5, glide = 0.45, stick = 0.5, shell = 340, drive = 1.6 }) {
  const d = new Float32Array(Math.floor(dur * sr));
  for (const [r, ac, ae, tm] of MEMBRANE) {
    partial(d, sr, {
      f: f0 * r * rng.range(0.992, 1.008), amp: (edge ? ae : ac) * rng.range(0.85, 1.15), tau: tau0 * tm,
      glide: glide * (edge ? 0.45 : 1) * rng.range(0.9, 1.1), glideT: 0.042 * rng.range(0.85, 1.15), attack: 0.0012,
    });
  }
  // the heavy stick on cowhide: a dull broadband slap, plus the wooden shell answering
  burst(d, sr, rng, { attack: 0.0004, tau: edge ? 0.006 : 0.0045, amp: stick * (edge ? 0.6 : 0.42), filters: [bq('lowpass', edge ? 4200 : 2600, 0.7, 0, sr)] });
  burst(d, sr, rng, { attack: 0.001, tau: 0.035, amp: 0.55, filters: [bq('bandpass', shell * rng.range(0.94, 1.06), 2.2, 0, sr)] });
  // skin buzz in the low mids
  burst(d, sr, rng, { attack: 0.002, tau: 0.06, amp: 0.4, filters: [bq('bandpass', f0 * 3.1, 1.3, 0, sr)] });
  dcBlock(d, sr, 16);
  saturate(d, drive);
  return fadeOut(normalize(d, 0.9), sr, 0.06);
}

/** The drum's wooden rim (鼓边): a dry knock. */
function genRim(sr, rng) {
  const d = new Float32Array(Math.floor(0.5 * sr));
  for (const [f, q, tau, a] of [[870, 14, 0.04, 1], [1630, 12, 0.025, 0.6], [2780, 10, 0.014, 0.45], [4100, 8, 0.008, 0.25]]) {
    grain(d, 0, sr, a * 2.2, f * rng.range(0.95, 1.05), q, tau * rng.range(0.8, 1.2) * 0.25, rng);
  }
  burst(d, sr, rng, { attack: 0.0002, tau: 0.0015, amp: 0.6, filters: [bq('highpass', 1800, 0.7, 0, sr)] });
  return fadeOut(normalize(dcBlock(d, sr, 40), 0.9), sr, 0.05);
}

/** Wooden fish (木鱼): a hollow, pitched temple knock. */
function genMuyu(sr, rng, f = 420) {
  const d = new Float32Array(Math.floor(0.55 * sr));
  const k = rng.range(0.97, 1.03);
  partial(d, sr, { f: f * k, amp: 1, tau: 0.075, attack: 0.0008 });
  partial(d, sr, { f: f * 2.71 * k, amp: 0.35, tau: 0.03, attack: 0.0006 });
  partial(d, sr, { f: f * 4.93 * k, amp: 0.12, tau: 0.012, attack: 0.0005 });
  burst(d, sr, rng, { attack: 0.0002, tau: 0.002, amp: 0.5, filters: [bq('bandpass', 2600, 0.8, 0, sr)] });
  return fadeOut(normalize(dcBlock(d, sr, 40), 0.9), sr, 0.05);
}

// ---------------------------------------------------------------- gongs
/** Big opera gong (大锣): a clear fundamental whose pitch droops a few semitones as it rings. */
function genDaluo(sr, rng, { f0 = 176, dur = 6.5, droop = 0.17, droopT = 0.4 }) {
  const d = new Float32Array(Math.floor(dur * sr));
  const R = [1, 1.46, 1.94, 2.37, 2.82, 3.27, 3.71, 4.22, 4.73, 5.31, 5.92, 6.55, 7.3, 8.1, 8.95, 9.9];
  R.forEach((r, k) => {
    partial(d, sr, {
      f: f0 * r * rng.range(0.99, 1.01), amp: (k === 0 ? 1 : 0.72 / Math.pow(k + 1, 0.5)) * rng.range(0.7, 1.2),
      tau: 3.6 / (1 + 0.3 * k), glide: droop * rng.range(0.9, 1.1), glideT: droopT * rng.range(0.85, 1.15), attack: 0.002,
      beat: rng.range(0.4, 2.4), beatAmp: k < 6 ? 0.28 : 0, phase: 0,
    });
  });
  // the crash of the strike: a short cloud of high modes
  for (let k = 0; k < 26; k++) {
    partial(d, sr, { f: logRand(rng, 1400, 7600), amp: rng.range(0.04, 0.14), tau: rng.range(0.06, 0.32), glide: 0.04, glideT: 0.2, attack: 0.001 });
  }
  burst(d, sr, rng, { attack: 0.0008, tau: 0.007, amp: 0.35, filters: [bq('lowpass', 1500, 0.7, 0, sr)] }); // padded beater
  dcBlock(d, sr, 20);
  saturate(d, 1.15);
  return fadeOut(normalize(d, 0.9), sr, 0.5);
}

/** Tam-tam (抄锣): no clear pitch; struck hard, the high modes "bloom" up after the hit and shimmer for seconds. */
function genTamtam(sr, rng, { dur = 9, hard = true }) {
  const d = new Float32Array(Math.floor(dur * sr));
  for (let k = 0; k < 16; k++) { // the dark rumble
    partial(d, sr, { f: logRand(rng, 42, 330), amp: rng.range(0.22, 0.55) * (hard ? 1 : 1.3), tau: rng.range(2.4, 4.2), attack: 0.004, beat: rng.range(0.2, 1.5), beatAmp: 0.3 });
  }
  for (let k = 0; k < 22; k++) { // the body
    partial(d, sr, { f: logRand(rng, 330, 1600), amp: rng.range(0.25, 0.6) * (hard ? 1 : 0.55), tau: rng.range(1.4, 3.2), rise: rng.range(0.02, 0.25), attack: 0.003 });
  }
  const hi = hard ? 44 : 10;
  for (let k = 0; k < hi; k++) { // the bloom: energy flows up into the high modes over the first second
    const f = logRand(rng, 1600, Math.min(11000, sr * 0.42));
    const u = Math.log(f / 1600) / Math.log(11000 / 1600);
    partial(d, sr, { f, amp: rng.range(0.3, 0.75) * (hard ? 1 : 0.35), tau: rng.range(0.9, 2.4) * (1 - 0.4 * u), rise: 0.15 + 0.8 * u * rng.range(0.6, 1.2), attack: 0.003 });
  }
  burst(d, sr, rng, { attack: 0.002, tau: 0.02, amp: hard ? 0.4 : 0.25, filters: [bq('lowpass', 900, 0.7, 0, sr)] }); // soft beater
  dcBlock(d, sr, 20);
  return fadeOut(normalize(d, 0.9), sr, 0.8);
}

// ---------------------------------------------------------------- cymbals (铙钹)
function genCymbal(sr, rng, { dur = 3.6, choke = false }) {
  const d = new Float32Array(Math.floor(dur * sr));
  for (let k = 0; k < 12; k++) { // the "honk" of the raised dome, typical of Chinese cymbals
    partial(d, sr, { f: logRand(rng, 360, 980), amp: rng.range(0.25, 0.6), tau: rng.range(0.5, 1.3), attack: 0.0008, beat: rng.range(1, 6), beatAmp: 0.35 });
  }
  for (let k = 0; k < 56; k++) {
    const f = logRand(rng, 980, Math.min(15000, sr * 0.43));
    const u = Math.log(f / 980) / Math.log(15000 / 980);
    partial(d, sr, { f, amp: rng.range(0.15, 0.45) * (0.6 + 0.8 * Math.sin(Math.PI * Math.min(1, u * 1.2))), tau: rng.range(0.5, 1.6) * (1.25 - 0.8 * u), rise: u > 0.5 ? rng.range(0, 0.05) : 0, attack: 0.0006 });
  }
  burst(d, sr, rng, { attack: 0.0003, tau: 0.03, amp: 0.7, filters: [bq('highpass', 2500, 0.7, 0, sr)] });
  if (choke) { // a hand damps the plates right after the hit
    const s = Math.floor(rng.range(0.09, 0.14) * sr), dec = Math.exp(-1 / (0.035 * sr));
    let e = 1;
    for (let i = s; i < d.length; i++) { e *= dec; d[i] *= e; }
  }
  dcBlock(d, sr, 60);
  return fadeOut(normalize(d, 0.9), sr, choke ? 0.05 : 0.4);
}

/** Reversed copy (a swell into a hit), starting from silence. */
function reversed(src, sr, len) {
  const n = Math.min(src.length, Math.floor(len * sr)), d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = src[n - 1 - i];
  return fadeOut(fadeIn(d, sr, 0.25), sr, 0.004);
}

// ---------------------------------------------------------------- deep temple bell (梵钟)
// Struck from outside with a wooden log: a soft thump, a long hum and the slow "wow" of beating mode pairs.
// [ratio, amp, tau (s), beat (Hz)]
const TBELL = [
  [1.0, 1.0, 7.5, 0.33], [2.0, 0.55, 5.2, 0.78], [2.64, 0.5, 4.2, 1.15], [3.22, 0.34, 3.4, 0], [4.06, 0.42, 2.8, 1.6],
  [4.98, 0.22, 2.1, 0], [5.92, 0.26, 1.7, 2.1], [6.83, 0.13, 1.3, 0], [8.1, 0.12, 1.0, 2.7], [9.42, 0.08, 0.7, 0],
  [10.9, 0.06, 0.5, 0], [12.6, 0.05, 0.35, 0],
];
export const TBELL_F0 = 55; // A1 hum

function genTempleBell(sr, rng, dur = 12) {
  const d = new Float32Array(Math.floor(dur * sr));
  for (const [r, a, tau, beat] of TBELL) {
    partial(d, sr, { f: TBELL_F0 * r * rng.range(0.997, 1.003), amp: a * rng.range(0.85, 1.15), tau: tau * rng.range(0.9, 1.1), attack: 0.004, beat, beatAmp: beat ? 0.42 : 0 });
  }
  // the log's dull thump and a brief strike tone that lets small speakers hear the hit
  burst(d, sr, rng, { attack: 0.002, tau: 0.03, amp: 0.55, filters: [bq('lowpass', 520, 0.7, 0, sr)] });
  for (let k = 0; k < 8; k++) partial(d, sr, { f: logRand(rng, 700, 2400), amp: rng.range(0.03, 0.08), tau: rng.range(0.12, 0.4), attack: 0.002 });
  dcBlock(d, sr, 15);
  return fadeOut(normalize(d, 0.9), sr, 1.2);
}

// ---------------------------------------------------------------- guqin (extended Karplus-Strong)
/**
 * A plucked silk-steel string: delay line + one-zero loop lowpass (S = brightness damping) + first-order
 * allpass for exact tuning; excitation = lowpassed noise with a pick-position comb (plucked near the bridge),
 * then the long wooden body (three resonances) and a gentle top cut. Slides are done at playback time
 * with playbackRate, which moves every partial together exactly like a sliding left-hand finger.
 */
function genGuqin(sr, rng, midi, { dur, t60 = null, S = 0.32, pick = 0.12, soft = 0.55 } = {}) {
  const f0 = mtof(midi);
  const n = Math.floor(dur * sr), d = new Float32Array(n);
  const P = sr / f0, Ltot = P - S;
  const L = Math.max(2, Math.floor(Ltot - 0.2)), frac = Ltot - L;
  const C = (1 - frac) / (1 + frac);
  const T60 = t60 ?? clamp(9.5 * Math.pow(65.4 / f0, 0.55), 1.6, 10);
  const rho = Math.pow(10, -3 / (f0 * T60));
  // excitation
  const exc = new Float32Array(L);
  let lp = 0;
  for (let i = 0; i < L; i++) { lp += soft * ((rng.float() * 2 - 1) - lp); exc[i] = lp; }
  const pk = Math.max(1, Math.round(pick * L));
  for (let i = L - 1; i >= pk; i--) exc[i] -= exc[i - pk];
  // loop
  const ring = new Float32Array(L);
  let idx = 0, prev = 0, ax = 0, ay = 0;
  for (let i = 0; i < n; i++) {
    const yD = ring[idx];
    const l = (1 - S) * yD + S * prev; prev = yD;
    const ap = C * l + ax - C * ay; ax = l; ay = ap;
    const y = (i < L ? exc[i] : 0) + rho * ap;
    ring[idx] = y; idx = idx + 1 === L ? 0 : idx + 1;
    d[i] = y;
  }
  filt(d, bq('peaking', 105, 1.4, 5, sr));
  filt(d, bq('peaking', 245, 2.0, 4, sr));
  filt(d, bq('peaking', 520, 2.2, 2, sr));
  filt(d, bq('lowpass', 5200, 0.6, 0, sr));
  dcBlock(d, sr, 25);
  fadeIn(d, sr, 0.0008);
  return fadeOut(normalize(d, 0.9), sr, 0.25);
}

// ---------------------------------------------------------------- rain, fire, lava textures
function genRainLoop(sr, rng, { sec = 7, rate = 260, close = false }) {
  const len = Math.floor(sec * sr), X = Math.floor(0.25 * sr), d = new Float32Array(len + X);
  const total = len + X, count = Math.floor(rate * (total / sr));
  for (let k = 0; k < count; k++) {
    const s = Math.floor(rng.float() * (total - 1));
    const a = close ? rng.range(0.25, 1) : rng.range(0.05, 0.4) * (rng.chance(0.08) ? 2.5 : 1);
    const u = rng.float();
    if (close) {
      if (u < 0.4) grain(d, s, sr, a * 2.6, rng.range(1800, 6500), rng.range(1.5, 4), rng.range(0.0015, 0.006), rng);        // tick on stone
      else if (u < 0.7) bubble(d, s, sr, a * 0.6, rng.range(600, 2600), rng.range(0.4, 1.8), rng.range(0.006, 0.025));      // plip in a puddle
      else if (u < 0.85) { const f = rng.range(2400, 5200); partial(d, sr, { f, amp: a * 0.18, tau: rng.range(0.03, 0.12), start: s / sr, attack: 0.0004 }); partial(d, sr, { f: f * 2.76, amp: a * 0.07, tau: 0.03, start: s / sr, attack: 0.0004 }); } // on bronze / the mask
      else grain(d, s, sr, a * 1.8, rng.range(500, 1400), rng.range(1.2, 2.5), rng.range(0.004, 0.012), rng);              // heavy drop
    } else if (u < 0.6) grain(d, s, sr, a * 2.2, rng.range(2500, 9000), rng.range(0.8, 2.5), rng.range(0.0008, 0.004), rng);
    else bubble(d, s, sr, a * 0.45, rng.range(900, 4200), rng.range(0.3, 1.4), rng.range(0.003, 0.012));
  }
  const out = loopify(dcBlock(d, sr, 120), len, X);
  return normalize(out, 0.9);
}

function genFireLoop(sr, rng, { sec = 5 }) {
  const len = Math.floor(sec * sr), X = Math.floor(0.2 * sr), d = new Float32Array(len + X);
  let t = 0;
  const dur = (len + X) / sr;
  while (t < dur - 0.05) {
    const s = Math.floor(t * sr);
    if (rng.chance(0.12)) { // a pop: resin bursting
      grain(d, s, sr, rng.range(1.5, 3.5), rng.range(500, 1600), rng.range(1.2, 3), rng.range(0.003, 0.009), rng);
      if (s + 2 < d.length) { const sg = rng.sign(); d[s] += 0.7 * sg; d[s + 1] -= 0.4 * sg; }
    } else grain(d, s, sr, rng.range(0.3, 1.4), rng.range(1500, 7000), rng.range(1.5, 4), rng.range(0.0008, 0.003), rng);
    t += rng.chance(0.3) ? rng.range(0.03, 0.16) : rng.range(0.002, 0.02);
  }
  return normalize(loopify(dcBlock(d, sr, 200), len, X), 0.9);
}

/** A viscous lava bubble bursting: a low gloop rising in pitch, the pop, a sizzle. */
function genBlorp(sr, rng) {
  const d = new Float32Array(Math.floor(1.3 * sr));
  const f0 = rng.range(38, 75), tau = rng.range(0.1, 0.2);
  bubble(d, 0, sr, 1.0, f0, rng.range(0.8, 1.6), tau);
  bubble(d, 0, sr, 0.35, f0 * 2.03, rng.range(0.8, 1.6), tau * 0.6);
  const pop = tau * rng.range(1.6, 2.6);
  burst(d, sr, rng, { at: pop, attack: 0.001, tau: 0.012, amp: 0.55, filters: [bq('bandpass', rng.range(300, 700), 1.2, 0, sr)] });
  burst(d, sr, rng, { at: pop + 0.005, attack: 0.02, tau: 0.12, amp: 0.12, filters: [bq('highpass', 2500, 0.7, 0, sr)] });
  dcBlock(d, sr, 20);
  return fadeOut(normalize(d, 0.9), sr, 0.1);
}

// ---------------------------------------------------------------- caldera impulse response
/**
 * Stereo IR of a vast volcanic caldera: no ceiling, so the field is sparser and darker than the
 * cathedral; a few smeared echoes come back from the rock walls at different distances and sides,
 * then a diffuse tail (RT60 ~2.8 s) that loses its highs fast. Unit energy per channel, like
 * cathedralIR, so send levels mean the same thing in both spaces.
 */
export function calderaIR(ctx, rng, { seconds = 4.2, rt60 = 2.8, predelay = 0.022, sideHz = 260 } = {}) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(predelay * sr), decayK = -6.907755 / (rt60 * sr);
  const diffuse = () => {
    const d = new Float32Array(len);
    let l1 = 0, l2 = 0;
    for (let i = pre; i < len; i++) {
      const n = i - pre, tt = n / sr;
      const fc = 420 + 6800 * Math.exp(-tt / 0.42);
      const a = 1 - Math.exp((-TAU * fc) / sr);
      l1 += a * ((rng.float() * 2 - 1) - l1);
      l2 += a * (l1 - l2);
      const build = tt < 0.2 ? Math.sin((tt / 0.2) * Math.PI * 0.5) : 1;
      d[i] = l2 * Math.exp(decayK * n) * build * 0.3;
    }
    return d;
  };
  const M = diffuse(), S = diffuse();
  const ah = Math.exp((-TAU * sideHz) / sr);
  for (let pass = 0; pass < 2; pass++) {
    let px = 0, py = 0;
    for (let i = 0; i < len; i++) { const x = S[i]; py = ah * (py + x - px); px = x; S[i] = py; }
  }
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  for (let i = 0; i < len; i++) { ch[0][i] = M[i] + S[i]; ch[1][i] = M[i] - S[i]; }
  // energy of the diffuse field, to scale the echoes against it
  let eDiff = 0;
  for (let i = 0; i < len; i++) eDiff += ch[0][i] * ch[0][i];
  // smeared wall echoes: [time s, relative energy, lowpass Hz, pan -1..1]
  const ECHO = [[0.012, 0.05, 6000, 0.2], [0.031, 0.04, 5000, -0.4], [0.19, 0.07, 3600, -0.55], [0.33, 0.055, 2600, 0.6],
    [0.52, 0.04, 1900, -0.15], [0.78, 0.025, 1400, 0.35], [1.12, 0.014, 1000, -0.45]];
  for (const [tt, energy, lp, pan] of ECHO) {
    const m = Math.floor(0.03 * sr), e = new Float32Array(m);
    for (let i = 0; i < m; i++) e[i] = (rng.float() * 2 - 1) * Math.exp(-i / (0.008 * sr));
    filt(e, bq('lowpass', lp, 0.7, 0, sr)); filt(e, bq('highpass', 120, 0.7, 0, sr));
    let ee = 0; for (let i = 0; i < m; i++) ee += e[i] * e[i];
    const g = Math.sqrt((energy * eDiff) / Math.max(ee, 1e-12));
    const s = pre + Math.floor(tt * sr);
    const gl = g * Math.sqrt(0.5 * (1 - pan)) * 1.414, gr = g * Math.sqrt(0.5 * (1 + pan)) * 1.414;
    for (let i = 0; i < m && s + i < len; i++) { ch[0][s + i] += e[i] * gl; ch[1][s + i] += e[i] * gr; }
  }
  for (const d of ch) { const fo = Math.floor(0.3 * sr); for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo; }
  let e = 0;
  for (const d of ch) for (let i = 0; i < len; i++) e += d[i] * d[i];
  const s = 1 / Math.sqrt(e / 2 || 1);
  for (const d of ch) for (let i = 0; i < len; i++) d[i] *= s;
  return buf;
}

// ---------------------------------------------------------------- wavetables
/** PeriodicWave from harmonic amplitudes (Schroeder phases, peak-normalised), with its RMS. */
export function harmonicWave(ctx, amps) {
  const N = amps.length - 1;
  const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  for (let k = 1; k <= N; k++) { const ph = (Math.PI * k * k) / N; real[k] = amps[k] * Math.sin(ph); imag[k] = amps[k] * Math.cos(ph); }
  const M = 2048;
  let peak = 1e-9;
  for (let i = 0; i < M; i++) {
    let x = 0;
    for (let k = 1; k <= N; k++) { const a = (TAU * k * i) / M; x += real[k] * Math.cos(a) + imag[k] * Math.sin(a); }
    peak = Math.max(peak, Math.abs(x));
  }
  const s = 0.98 / peak;
  let pow = 0;
  for (let k = 1; k <= N; k++) { real[k] *= s; imag[k] *= s; pow += 0.5 * (amps[k] * s) ** 2; }
  return { wave: ctx.createPeriodicWave(real, imag, { disableNormalization: true }), rms: Math.sqrt(pow) };
}

/** Suona: a conical double reed with a metal bell; very bright, strongest around the 3rd-4th harmonic. */
export function makeSuonaWave(ctx) {
  const a = new Float32Array(41);
  const low = [0, 0.5, 0.82, 1.0, 0.92];
  for (let k = 1; k <= 40; k++) a[k] = k <= 4 ? low[k] : 0.92 * Math.pow(4 / k, 0.78) * (k % 2 ? 1 : 0.88);
  return harmonicWave(ctx, a);
}

// ---------------------------------------------------------------- the bank
export const GUQIN_RATE = 32000;

/**
 * Lazily generated buffers. bank.drum.big etc. are arrays of variants; bank.guqin(midi) returns the
 * string buffer for that note (generated and cached on first use).
 */
export function makeNiumoBank(ctx, seed) {
  const SR = ctx.sampleRate, LOW = Math.min(SR, 32000);
  const mk = (sr, data) => { const b = ctx.createBuffer(1, data.length, sr); b.getChannelData(0).set(data); return b; };
  const n = (k, fn) => Array.from({ length: k }, (_, i) => fn(i));
  const salt = (i) => ((seed ^ 0x5eed1e55) + Math.imul(0x85ebca6b, i + 1)) >>> 0;
  const gens = {
    drum: (rng) => ({
      big: n(3, () => mk(SR, genDrum(SR, rng, { f0: 57, dur: 3.0, tau0: 0.5, glide: 0.45, shell: 330 }))),
      edge: n(2, () => mk(SR, genDrum(SR, rng, { f0: 57, dur: 2.2, edge: true, tau0: 0.36, glide: 0.4, shell: 360, stick: 0.8 }))),
      mid: n(3, () => mk(SR, genDrum(SR, rng, { f0: 96, dur: 1.6, tau0: 0.24, glide: 0.35, shell: 470, stick: 0.65, drive: 1.9 }))),
      rim: n(3, () => mk(SR, genRim(SR, rng))),
    }),
    gong: (rng) => {
      const tam = genTamtam(LOW, rng, { dur: 9, hard: true });
      return {
        daluo: n(2, () => mk(SR, genDaluo(SR, rng, { f0: 176 }))),
        tamtam: [mk(LOW, tam)],
        tamtamSoft: [mk(LOW, genTamtam(LOW, rng, { dur: 7, hard: false }))],
        tamtamRev: [mk(LOW, reversed(tam, LOW, 7.5))],
      };
    },
    cymbal: (rng) => {
      const c0 = genCymbal(SR, rng, { dur: 3.6 });
      return {
        crash: [mk(SR, c0), mk(SR, genCymbal(SR, rng, { dur: 3.6 }))],
        choke: n(2, () => mk(SR, genCymbal(SR, rng, { dur: 0.7, choke: true }))),
        crashRev: [mk(SR, reversed(c0, SR, 3.2))],
      };
    },
    tbell: (rng) => n(2, () => mk(LOW, genTempleBell(LOW, rng, 12))),
    muyu: (rng) => n(3, () => mk(SR, genMuyu(SR, rng, 420))),
    rain: (rng) => ({
      bed: n(2, () => mk(SR, genRainLoop(SR, rng, { sec: 7, rate: 300 }))),
      close: n(2, () => mk(SR, genRainLoop(SR, rng, { sec: 7, rate: 26, close: true }))),
    }),
    fire: (rng) => n(2, () => mk(SR, genFireLoop(SR, rng, { sec: 5 }))),
    blorp: (rng) => n(5, () => mk(LOW, genBlorp(LOW, rng))),
  };
  const bank = {};
  Object.keys(gens).forEach((key, i) => {
    Object.defineProperty(bank, key, {
      configurable: true, enumerable: true,
      get() {
        const value = gens[key](new Rng(salt(i)));
        Object.defineProperty(bank, key, { value, enumerable: true });
        return value;
      },
    });
  });
  const strings = new Map();
  Object.defineProperty(bank, 'guqin', {
    value(midi) {
      const m = Math.round(midi);
      if (!strings.has(m)) {
        const rng = new Rng(((seed ^ 0x6a09e667) + Math.imul(m, 0x27d4eb2d)) >>> 0);
        const dur = clamp(7.5 * Math.pow(mtof(36) / mtof(m), 0.45), 2.2, 7.5);
        strings.set(m, mk(GUQIN_RATE, genGuqin(GUQIN_RATE, rng, m, { dur })));
      }
      return strings.get(m);
    },
  });
  Object.defineProperty(bank, 'warm', {
    /** Pre-generate everything in idle ticks (most urgent first); `notes` = guqin notes to prepare. */
    value(notes = []) {
      const jobs = ['drum', 'gong', 'tbell', 'cymbal', 'muyu', 'fire', 'blorp', 'rain'].map((k) => () => void bank[k]);
      for (const m of notes) jobs.push(() => bank.guqin(m));
      const step = () => { const j = jobs.shift(); if (j) { j(); setTimeout(step, 0); } };
      setTimeout(step, 0);
    },
  });
  return bank;
}
