// Generic synthesis layers. Each builds nodes inside a Voice (v) starting at time t and
// routes them to the voice output with an optional reverb send. Recipes in sfx.js and the
// instruments in instruments.js are composed from these.
import { adEnv, mtof } from './dsp.js';

/** Semitone shift equivalent to a pitch factor. */
export const st = (p) => 12 * Math.log2(p);

/** Filtered noise burst with optional frequency sweep. */
export function noiseHit(v, t, {
  kind = 'white', type = 'bandpass', f = 1000, f1 = 0, sweep = 0.1, Q = 1,
  attack = 0.002, tau = 0.05, gain = 0.5, send = 0, dry = 1, rate = 1,
} = {}) {
  const end = t + attack + tau * 7;
  const src = v.noise(kind, t, end, rate);
  const flt = v.biquad(type, f, Q);
  if (f1) {
    flt.frequency.setValueAtTime(v.fclamp(f), t);
    flt.frequency.exponentialRampToValueAtTime(v.fclamp(f1), t + sweep);
  }
  const g = v.gain(0);
  adEnv(g.gain, t, gain, attack, tau);
  src.connect(flt); flt.connect(g);
  v.out(g, send, dry);
  return g;
}

/** Band-passed noise sweep with a swelling envelope: sword / body whooshes. */
export function whoosh(v, t, {
  dur = 0.4, f0 = 400, f1 = 2000, f2 = 800, peakAt = 0.45, Q = 1.5, gain = 0.5,
  kind = 'white', send = 0.15, pan0 = 0, pan1 = 0, rate = 1,
} = {}) {
  const tp = t + dur * peakAt, end = t + dur;
  const src = v.noise(kind, t, end + 0.02, rate);
  const bp = v.biquad('bandpass', f0, Q);
  bp.frequency.setValueAtTime(v.fclamp(f0), t);
  bp.frequency.exponentialRampToValueAtTime(v.fclamp(f1), tp);
  bp.frequency.exponentialRampToValueAtTime(v.fclamp(f2), end);
  const g = v.gain(0);
  // starts ~-30 dB under the peak (audible right away), swells exponentially to the peak
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain * 0.03, t + 0.012);
  g.gain.exponentialRampToValueAtTime(gain, tp);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(bp); bp.connect(g);
  let node = g;
  if (pan0 || pan1) {
    const p = v.panner(pan0);
    p.pan.setValueAtTime(pan0, t);
    p.pan.linearRampToValueAtTime(pan1, end);
    g.connect(p); node = p;
  }
  v.out(node, send);
}

/** Pitched body thump with a downward glide (optionally saturated for small speakers). */
export function thud(v, t, {
  f0 = 120, f1 = 50, glide = 0.08, attack = 0.002, tau = 0.12, gain = 0.8, send = 0.1,
  type = 'sine', drive = 0,
} = {}) {
  const end = t + attack + tau * 7;
  const o = v.osc(type, f0, t, end);
  o.frequency.setValueAtTime(v.fclamp(f0), t);
  o.frequency.exponentialRampToValueAtTime(v.fclamp(f1), t + glide);
  const g = v.gain(0);
  adEnv(g.gain, t, gain, attack, tau);
  o.connect(g);
  let node = g;
  if (drive > 0) { const sh = v.shaper(v.eng.driveCurve(drive)); g.connect(sh); node = sh; }
  v.out(node, send);
}

/** Bank of decaying sine modes: metal plates, blades, armour. `beat` adds detuned doublets. */
export function ring(v, t, {
  f = 1000, ratios = [1], amps = [1], taus = [0.3], gain = 0.3, send = 0.3, attack = 0.0015,
  beat = 0, dry = 1,
} = {}) {
  const sum = v.gain(gain);
  for (let i = 0; i < ratios.length; i++) {
    const fr = f * ratios[i];
    if (fr > v.eng.nyq) continue;
    const tau = taus[i] ?? taus[taus.length - 1];
    const end = t + attack + tau * 7;
    const g = v.gain(0);
    adEnv(g.gain, t, amps[i] ?? 0.1, attack, tau);
    const o = v.osc('sine', fr, t, end);
    o.connect(g);
    if (beat && i < 3) {
      const o2 = v.osc('sine', fr + beat * (i + 1), t, end);
      const g2 = v.gain(0.6); o2.connect(g2); g2.connect(g);
    }
    g.connect(sum);
  }
  v.out(sum, send, dry);
}

/** Play a procedural buffer (optionally filtered / truncated with a fade). */
export function sample(v, t, buf, {
  rate = 1, gain = 0.5, send = 0.2, dry = 1, type = null, f = 1000, Q = 0.7, offset = 0, len = 0,
} = {}) {
  const full = (buf.duration - offset) / rate;
  const dur = len ? Math.min(len, full) : full;
  const s = v.buffer(buf, t, { rate, offset, stop: t + dur + 0.005 });
  const g = v.gain(gain);
  if (offset > 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.003); } // no click mid-buffer
  if (len && len < full) {
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
  }
  let node = s;
  if (type) { const flt = v.biquad(type, f, Q); s.connect(flt); node = flt; }
  node.connect(g);
  v.out(g, send, dry);
}

/** Bright bell-like sine pings (holy chimes, glass). notes = MIDI numbers. */
export function sparkle(v, t, {
  notes = [86, 93], gap = 0.04, tau = 0.35, gain = 0.05, send = 0.8, dry = 1,
  partials = [[1, 1], [2.76, 0.15]], attack = 0.002,
} = {}) {
  const sum = v.gain(gain);
  notes.forEach((m, i) => {
    const f = mtof(m), ti = t + i * gap;
    for (const [r, a] of partials) {
      const fr = f * r;
      if (fr > v.eng.nyq) continue;
      const tt = tau / Math.sqrt(r);
      const o = v.osc('sine', fr, ti, ti + attack + tt * 7);
      const g = v.gain(0);
      adEnv(g.gain, ti, a, attack, tt);
      o.connect(g); g.connect(sum);
    }
  });
  v.out(sum, send, dry);
}

/** Tremolo-modulated high sines (shimmering light). Crescendo over `rise`, then decay `tau`. */
export function shimmer(v, t, {
  freqs = [5000], rate = 14, depth = 0.8, rise = 0.05, tau = 0.3, gain = 0.05, send = 0.6,
} = {}) {
  const end = t + rise + tau * 7;
  const env = v.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain * (rise > 0.1 ? 0.02 : 0.3), t + Math.min(0.02, rise * 0.5));
  env.gain.exponentialRampToValueAtTime(gain, t + rise);
  env.gain.setTargetAtTime(0, t + rise, tau);
  const trem = v.gain(1 - depth / 2);
  const lfo = v.osc('sine', rate, t, end);
  const lg = v.gain(depth / 2);
  lfo.connect(lg); lg.connect(trem.gain);
  for (const f of freqs) {
    if (f > v.eng.nyq) continue;
    const o = v.osc('sine', f, t, end);
    o.detune.value = v.eng.rng.range(-6, 6);
    o.connect(trem);
  }
  trem.connect(env);
  v.out(env, send);
}

/** Water: impact wash + droplets/bubbles (+ low slosh for big ones). size ~0.5 (step) .. 3 (slam). */
export function splash(v, t, { size = 1, p = 1, gain = 0.5, send = 0.15 } = {}) {
  const eng = v.eng, rng = eng.rng;
  noiseHit(v, t, {
    type: 'bandpass', f: (1900 * p) / Math.sqrt(size), f1: (850 * p) / size, sweep: 0.12 * size,
    Q: 0.7, attack: 0.004, tau: 0.045 * size, gain: gain * 0.9, send,
  });
  const big = size > 1.6;
  const buf = rng.pick(big ? eng.bank.dropsBig : eng.bank.drops);
  sample(v, t + 0.006, buf, {
    rate: p * rng.range(0.92, 1.12) * (big ? 0.9 : size < 0.8 ? 1.25 : 1.05),
    gain: gain * 0.75, send, len: Math.min(buf.duration, 0.22 + 0.42 * size),
  });
  if (size >= 1) {
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 380 * p, Q: 2, attack: 0.01, tau: 0.08 * size, gain: gain * 0.6, send });
  }
}
