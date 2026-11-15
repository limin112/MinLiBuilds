// Instruments for the Flame Mountain (niumo) scene, built as layers inside a Voice (same contract as
// instruments.js): war drums, gongs, cymbals, a deep temple bell, a wooden fish, Tibetan-style throat
// chant, a suona-like reed lead, a guqin-like plucked string, and the environment beds (wind, fire,
// lava, rain, the mountain breathing). Percussion and strings play buffers from eng.nbank
// (niumo_bank.js); voices and beds are node graphs so they can bend, breathe and sustain.
import { adEnv, mtof, qToDb, vowelFormants, formantPower, FORMANT_BW, clamp } from './dsp.js';
import { noiseHit, sample } from './layers.js';
import { makeSuonaWave, TBELL_F0 } from './niumo_bank.js';

const semis = (s) => Math.pow(2, s / 12);
const pickIn = (rng, arr) => arr[Math.floor(rng.float() * arr.length) % arr.length];

/** Level automation shared by the beds: fade in, a list of [seconds, multiplier] breakpoints, fade out. */
function bedEnvelope(param, t, dur, gain, fadeIn, fadeOut, levels) {
  const end = t + dur;
  param.setValueAtTime(0, t);
  if (levels && levels.length) {
    for (const [at, k] of levels) if (at >= 0 && at <= dur) param.linearRampToValueAtTime(Math.max(0, gain * k), t + at);
  } else {
    param.linearRampToValueAtTime(gain, t + Math.max(0.02, fadeIn));
    param.setValueAtTime(gain, Math.max(t + fadeIn, end - fadeOut));
  }
  param.linearRampToValueAtTime(0, end);
}

/** Equal-power fades (sin / cos) so overlapping segments of a noise bed keep a constant level.
 *  (Curves start a hair after t: a value curve may not share its start time with another event, and the
 *  param's initial value set at creation is one.) */
function equalPowerFades(param, t, dur, gain, fadeIn, fadeOut) {
  const N = 24, fi = new Float32Array(N), fo = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = i / (N - 1); fi[i] = gain * Math.sin(a * Math.PI * 0.5); fo[i] = gain * Math.cos(a * Math.PI * 0.5); }
  const t0 = t + 0.003;
  fadeIn = clamp(fadeIn, 0.02, dur * 0.5 - 0.01); fadeOut = clamp(fadeOut, 0.02, dur * 0.5 - 0.01);
  param.setValueCurveAtTime(fi, t0, fadeIn);
  param.setValueCurveAtTime(fo, t + dur - fadeOut, fadeOut);
}

// ================================================================ percussion (buffers)
/** War drum: kind 'big' (centre), 'edge', 'mid' (smaller tanggu), 'rim' (wooden rim knock). len > 0 damps it. */
export function wardrumLayer(v, t, { kind = 'big', gain = 0.5, rate = 1, send = 0.3, dry = 1, len = 0 }) {
  const rng = v.eng.rng;
  const buf = pickIn(rng, v.eng.nbank.drum[kind] || v.eng.nbank.drum.big);
  sample(v, t, buf, { rate: rate * rng.range(0.985, 1.015), gain, send, dry, len });
}

/** Drum roll: alternating strokes accelerating from hz0 to hz1 with an exponential crescendo g0 -> g1. */
export function drumRollLayer(v, t, { kind = 'mid', dur = 2, hz0 = 7, hz1 = 15, g0 = 0.04, g1 = 0.35, send = 0.3, dry = 1, rate = 1 }) {
  const rng = v.eng.rng, bufs = v.eng.nbank.drum[kind] || v.eng.nbank.drum.mid;
  let tt = 0, k = 0;
  while (tt < dur) {
    const u = tt / dur, hz = hz0 + (hz1 - hz0) * u;
    const g = g0 * Math.pow(g1 / Math.max(g0, 1e-4), u) * (k % 2 ? 0.86 : 1) * rng.range(0.9, 1.1);
    sample(v, t + tt + rng.range(-0.004, 0.004), pickIn(rng, bufs), { rate: rate * rng.range(0.98, 1.02) * (k % 2 ? 1.02 : 1), gain: g, send, dry, len: Math.min(0.9, 2.4 / hz) });
    tt += 1 / hz; k++;
  }
}

/** Gongs: 'daluo' (big opera gong, pitch droops), 'tamtam' (bloom), 'tamtamSoft', 'tamtamRev' (reversed swell). */
export function gongLayer(v, t, { kind = 'daluo', gain = 0.4, rate = 1, send = 0.5, dry = 1, len = 0, lp = 0 }) {
  const rng = v.eng.rng, set = v.eng.nbank.gong[kind] || v.eng.nbank.gong.daluo;
  const buf = pickIn(rng, set);
  const r = rate * (kind === 'tamtamRev' ? 1 : rng.range(0.985, 1.015));
  if (lp) sample(v, t, buf, { rate: r, gain, send, dry, len, type: 'lowpass', f: lp, Q: 0.6 });
  else sample(v, t, buf, { rate: r, gain, send, dry, len });
}

/** Cymbals (铙钹): 'crash', 'choke', 'crashRev' (reversed swell). */
export function cymbalLayer(v, t, { kind = 'crash', gain = 0.3, rate = 1, send = 0.4, dry = 1, len = 0 }) {
  const rng = v.eng.rng, set = v.eng.nbank.cymbal[kind] || v.eng.nbank.cymbal.crash;
  sample(v, t, pickIn(rng, set), { rate: rate * (kind === 'crashRev' ? 1 : rng.range(0.97, 1.03)), gain, send, dry, len });
}

/** Deep temple bell (梵钟), hum tuned to `midi`; lp darkens it (distance). */
export function templeBellLayer(v, t, { midi = 33, gain = 0.3, send = 0.7, dry = 1, lp = 0, len = 0 }) {
  const rng = v.eng.rng, buf = pickIn(rng, v.eng.nbank.tbell);
  const rate = mtof(midi) / TBELL_F0;
  if (lp) sample(v, t, buf, { rate, gain, send, dry, len, type: 'lowpass', f: lp, Q: 0.6 });
  else sample(v, t, buf, { rate, gain, send, dry, len });
}

/** Wooden fish (木鱼): the monks' steady pulse. */
export function muyuLayer(v, t, { gain = 0.15, rate = 1, send = 0.45, dry = 1 }) {
  const rng = v.eng.rng;
  sample(v, t, pickIn(rng, v.eng.nbank.muyu), { rate: rate * rng.range(0.99, 1.01), gain: gain * rng.range(0.9, 1.08), send, dry });
}

/** Sub boom under the biggest hits (felt more than heard): a sine falling from f0 to f1. */
export function boomLayer(v, t, { f0 = 62, f1 = 30, glide = 0.4, tau = 0.5, gain = 0.4, send = 0.2, dry = 1 }) {
  const o = v.osc('sine', f0, t, t + tau * 7 + 0.01);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  const g = v.gain(0);
  adEnv(g.gain, t, gain, 0.004, tau);
  o.connect(g);
  v.out(g, send, dry);
}

// ================================================================ voices
/**
 * Throat chant (Tibetan-style low monk drone): several very low glottal voices with their own wobble,
 * an optional sub-octave "growl" (period doubling, kargyraa-like), a male vocal-tract cascade with
 * vowel changes, and a sharp resonant peak tuned to one harmonic of the fundamental that sings a
 * slow overtone melody above the drone.
 *   vowels: [[seconds, vowel], ...]   overtones: [[seconds, harmonic number], ...]
 *   glide: { at, to (semitones), time } bends the whole choir (e.g. sinking a fourth)
 */
export function monkLayer(v, t, {
  midi = 33, dur = 8, voices = 3, spread = 9, gain = 0.05, send = 0.55, dry = 1, vowel = 'o', vowels = null,
  overtone = 0, overtones = null, otGain = 19, otQ = 24, growl = 0.3, attack = 1.4, release = 1.6, breath = 0.03,
  envelope = 'asr', glide = null,
}) {
  const eng = v.eng, rng = eng.rng, sr = eng.sr, W = eng.waves.glottal;
  const f0 = mtof(midi), end = t + dur, stop = end + release * 1.8 + 0.05;
  const sum = v.gain(1);
  const drift = v.osc('sine', rng.range(0.07, 0.15), t, stop);
  const dg = v.gain(5);
  drift.connect(dg);
  const bend = (o, f) => {
    if (!glide) return;
    o.frequency.setValueAtTime(f, t + glide.at);
    o.frequency.exponentialRampToValueAtTime(f * semis(glide.to), t + glide.at + glide.time);
  };
  for (let k = 0; k < voices; k++) {
    const det = (k - (voices - 1) / 2) * spread + rng.range(-3, 3);
    const o = v.osc(W, f0, t, stop);
    o.detune.value = det;
    dg.connect(o.detune);
    const w = v.osc('sine', rng.range(0.18, 0.45), t, stop);
    const wg = v.gain(rng.range(2, 5));
    w.connect(wg); wg.connect(o.detune);
    o.connect(sum);
    bend(o, f0);
    if (growl > 0) {
      const s = v.osc(W, f0 / 2, t, stop);
      s.detune.value = det;
      dg.connect(s.detune); wg.connect(s.detune);
      const sg = v.gain(growl);
      s.connect(sg); sg.connect(sum);
      bend(s, f0 / 2);
    }
  }
  if (breath > 0) {
    const n = v.noise('pink', t, stop);
    const ng = v.gain(breath * Math.sqrt(voices));
    n.connect(ng); ng.connect(sum);
  }
  const vl = vowels && vowels.length ? vowels : [[0, vowel]];
  const F0 = vowelFormants('male', vl[0][1], f0);
  let node = sum;
  const bqs = [];
  for (let k = 0; k < 4; k++) {
    const b = v.biquad('lowpass', F0[k], qToDb(F0[k] / FORMANT_BW[k]));
    node.connect(b); node = b; bqs.push(b);
  }
  for (const [at, vw] of vl.slice(1)) {
    const F = vowelFormants('male', vw, f0);
    for (let k = 0; k < 4; k++) {
      bqs[k].frequency.setTargetAtTime(F[k], t + at, 0.18);
      bqs[k].Q.setTargetAtTime(qToDb(F[k] / FORMANT_BW[k]), t + at, 0.18);
    }
  }
  const ots = overtones && overtones.length ? overtones : overtone ? [[0, overtone]] : null;
  if (ots) {
    const pk = v.biquad('peaking', f0 * ots[0][1], otQ, otGain);
    for (const [at, h] of ots.slice(1)) pk.frequency.setTargetAtTime(v.fclamp(f0 * h * (glide && at > glide.at ? semis(glide.to) : 1)), t + at, 0.14);
    node.connect(pk); node = pk;
  }
  // keep the drone's weight in its harmonics, not in sub-bass (headroom, and small speakers can't play 55 Hz anyway)
  const hp = v.biquad('highpass', 62, 0.6);
  node.connect(hp); node = hp;
  const hpMag = (f) => 1 / Math.sqrt(1 + Math.pow(62 / f, 4));
  const pw = voices * formantPower(f0, W.amps.map((a, k) => a * hpMag(Math.max(1, k) * f0)), F0, sr) * (1 + growl * growl * 0.5);
  const norm = v.gain(1 / Math.sqrt(pw));
  node.connect(norm);
  const env = v.gain(0);
  if (envelope === 'swell') {
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain * 0.02, t + 0.05);
    env.gain.exponentialRampToValueAtTime(gain, t + Math.max(0.1, attack));
    env.gain.setValueAtTime(gain, Math.max(t + attack, end));
  } else {
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.setValueAtTime(gain, Math.max(t + attack, end));
  }
  env.gain.setTargetAtTime(0, Math.max(t + attack, end), release / 4);
  norm.connect(env);
  v.out(env, send, dry);
}

/**
 * Suona-like reed lead: very bright, nasal, slightly unstable; it scoops into notes, wails with a delayed,
 * widening vibrato, sobs, and falls off the ends of phrases. Used sparingly, like a cry.
 * notes: [[midi | null (rest), seconds, { scoop, fall, vib, acc, sob, legato }], ...]
 */
export function suonaLayer(v, t, {
  notes, gain = 0.05, send = 0.45, dry = 1, vib = 34, vibRate = 5.7, bright = 1, breath = 0.035,
  attack = 0.05, release = 0.3, drive = 1.7, transpose = 0,
}) {
  const eng = v.eng, rng = eng.rng;
  if (!eng._suonaWave) eng._suonaWave = makeSuonaWave(eng.ctx);
  const SW = eng._suonaWave;
  let total = 0;
  for (const n of notes) total += n[1];
  const end = t + total, stop = end + release * 2 + 0.1;
  const first = notes.find((n) => n[0] != null);
  if (!first) return;
  const o = v.osc(SW.wave, mtof(first[0] + transpose), t, stop);
  // reed instability: slow random detune + a little faster jitter
  const jit = v.noise('brown', t, stop);
  const jl = v.biquad('lowpass', 14, 0);
  const jg = v.gain(26);
  jit.connect(jl); jl.connect(jg); jg.connect(o.detune);
  const lfo = v.osc('sine', vibRate * rng.range(0.96, 1.04), t, stop);
  const depth = v.gain(0);
  lfo.connect(depth); depth.connect(o.detune);
  // tone: drive -> body/nasal resonances -> dynamic top
  const pre = v.gain(0.55 / SW.rms);
  const sh = v.shaper(eng.driveCurve(drive));
  const hp = v.biquad('highpass', 300, 0.7);
  const nasal = v.biquad('peaking', 1250, 1.4, 7);
  const edge = v.biquad('peaking', 2950, 2.2, 5);
  const lp = v.biquad('lowpass', 5000, 0.5);
  o.connect(pre); pre.connect(sh); sh.connect(hp); hp.connect(nasal); nasal.connect(edge); edge.connect(lp);
  const env = v.gain(0);
  lp.connect(env);
  if (breath > 0) {
    const n = v.noise('white', t, stop);
    const nb = v.biquad('bandpass', 3300, 0.9);
    const ng = v.gain(breath);
    n.connect(nb); nb.connect(ng); ng.connect(env);
  }
  const F = o.frequency, E = env.gain, D = depth.gain, Det = o.detune;
  E.setValueAtTime(0, t); D.setValueAtTime(0, t); Det.setValueAtTime(0, t);
  lp.frequency.setValueAtTime(3600, t);
  let tn = t, prev = null, fell = false, fEnd = t;
  notes.forEach(([m, d, op = {}]) => {
    if (m == null) { // rest
      E.setTargetAtTime(0, tn, 0.035);
      prev = null; fell = false; tn += d; return;
    }
    const f = mtof(m + transpose), lvl = gain * (op.acc ?? 1);
    const scoop = op.scoop ?? (prev == null || fell ? 0.6 : 0);
    const tS = Math.min(clamp(0.07 + scoop * 0.03, 0.07, 0.24), d * 0.6);
    if (prev == null || fell) { // a fresh attack (also after a fall: the fall's ramp owns the pitch until tn)
      F.setValueAtTime(f * semis(-scoop), tn);
      F.exponentialRampToValueAtTime(f, tn + tS);
      E.setTargetAtTime(lvl, tn, attack / 2.5);
      fEnd = tn + tS;
    } else if (op.legato === false || m === prev) { // tongued: a short gap, then the scoop
      E.setTargetAtTime(lvl * 0.15, tn - 0.05, 0.012);
      F.setValueAtTime(f * semis(-Math.max(scoop, 0.3)), tn);
      F.exponentialRampToValueAtTime(f, tn + tS);
      E.setTargetAtTime(lvl, tn + 0.005, 0.02);
      fEnd = tn + tS;
    } else { // slur: a portamento, slower when it is marked as a slide (never before the last ramp has ended)
      F.setTargetAtTime(f, Math.max(tn - 0.02, fEnd + 0.001), scoop ? 0.07 : 0.03);
      E.setTargetAtTime(lvl, tn, 0.05);
    }
    // vibrato: none on the attack, then it blooms and widens on long notes
    const vd = vib * (op.vib ?? 1);
    D.setTargetAtTime(vd * 0.08, tn, 0.03);
    D.setTargetAtTime(vd, tn + Math.min(0.32, d * 0.35), Math.min(0.22, d * 0.25));
    if (d > 1.2) D.setTargetAtTime(vd * 1.45, tn + d * 0.55, d * 0.2);
    lp.frequency.setTargetAtTime(3600 + 5200 * bright * Math.min(1.4, op.acc ?? 1), tn, 0.06);
    if (d > 1.0) E.setTargetAtTime(lvl * 1.18, tn + d * 0.3, d * 0.25); // the long note swells
    if (op.sob) { // a sob: the reed catches, pitch and level dip, then recover
      const ts = tn + d * (typeof op.sob === 'number' ? op.sob : 0.55);
      E.setTargetAtTime(lvl * 0.3, ts, 0.012); E.setTargetAtTime(lvl * 1.1, ts + 0.07, 0.03);
      Det.setTargetAtTime(-90, ts, 0.012); Det.setTargetAtTime(0, ts + 0.06, 0.03);
    }
    if (op.fall) { // the wail falls away at the end of the note
      const tf = Math.min(d * 0.65, 0.3 + op.fall * 0.07), t0 = tn + d - tf;
      F.setValueAtTime(f, Math.max(t0, fEnd + 0.001));
      F.exponentialRampToValueAtTime(f * semis(-op.fall), tn + d);
      fEnd = tn + d;
      E.setTargetAtTime(lvl * 0.12, t0 + tf * 0.25, tf * 0.4);
      lp.frequency.setTargetAtTime(2600, t0, tf * 0.5);
    }
    fell = !!op.fall;
    prev = m; tn += d;
  });
  E.setTargetAtTime(0, end - 0.02, release / 4);
  v.out(env, send, dry);
}

/**
 * Guqin-like plucked string. Open/stopped notes play a Karplus-Strong buffer; slides move playbackRate
 * (every partial moves together, as under a sliding finger) and add the squeak of the finger on the
 * wound string; yin/nao vibrato is a slow rate wobble. harmonic: true plays a flageolet (泛音).
 *   slides: [[seconds after the pluck, target semitones relative to midi, glide seconds], ...]
 */
export function guqinLayer(v, t, {
  midi, dur = 4, gain = 0.2, send = 0.5, dry = 1, harmonic = false, slides = null, vib = 0, vibRate = 4.2,
  vibAt = 0.5, squeak = 1, release = 0.5, tau = 1.3,
}) {
  const eng = v.eng, rng = eng.rng;
  let out;
  if (harmonic) {
    const f = mtof(midi), sum = v.gain(gain * 0.85);
    for (const [r, a, tm] of [[1, 1, 1], [2, 0.1, 0.55], [3, 0.035, 0.35]]) {
      const fr = f * r;
      if (fr > eng.nyq) continue;
      const o = v.osc('sine', fr, t, t + tau * tm * 7 + 0.02);
      o.detune.value = rng.range(-2, 2);
      const g = v.gain(0);
      adEnv(g.gain, t, a, 0.002, tau * tm);
      o.connect(g); g.connect(sum);
    }
    noiseHit(v, t, { type: 'bandpass', f: 2800, Q: 1.2, attack: 0.0006, tau: 0.004, gain: gain * 0.12, send: send * 0.5, dry });
    out = sum;
  } else {
    const buf = eng.nbank.guqin(midi);
    const end = t + dur, stop = Math.min(t + buf.duration, end + release * 2.5);
    const src = v.buffer(buf, t, { stop });
    const pr = src.playbackRate;
    pr.setValueAtTime(1.0035, t);
    pr.setTargetAtTime(1, t + 0.002, 0.05);
    let cur = 0;
    for (const [at, to, len] of slides || []) {
      const t0 = t + at, t1 = t0 + Math.max(0.03, len);
      pr.setValueAtTime(semis(cur), t0);
      pr.exponentialRampToValueAtTime(semis(to), t1);
      if (squeak > 0) { // finger sliding on the wound string
        const n = v.noise('white', t0, t1 + 0.12);
        const bp = v.biquad('bandpass', 2400 + 120 * Math.abs(to - cur), 1.3);
        const g = v.gain(0);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain * 0.07 * squeak * Math.min(1.5, Math.abs(to - cur) / 2 + 0.4), t0 + (t1 - t0) * 0.4);
        g.gain.linearRampToValueAtTime(0, t1 + 0.1);
        n.connect(bp); bp.connect(g);
        v.out(g, send * 0.6, dry);
      }
      cur = to;
    }
    if (vib > 0) {
      const lfo = v.osc('sine', vibRate * rng.range(0.92, 1.08), t, stop);
      const dg = v.gain(0);
      const depth = semis(cur) * (Math.pow(2, vib / 1200) - 1);
      dg.gain.setValueAtTime(0, t);
      dg.gain.setValueAtTime(0, t + vibAt);
      dg.gain.linearRampToValueAtTime(depth, t + vibAt + 0.4);
      dg.gain.setTargetAtTime(depth * 0.3, t + vibAt + 1.2, 0.8); // yin: it narrows as the note dies
      lfo.connect(dg); dg.connect(pr);
    }
    const g = v.gain(gain);
    g.gain.setValueAtTime(gain, end);
    g.gain.setTargetAtTime(0, end, release / 4);
    src.connect(g);
    out = g;
  }
  v.out(out, send, dry);
}

// ================================================================ environment beds
/** Wind over burnt rock: gusting band of noise, a thin whistle in the cracks, a low push. */
export function windLayer(v, t, {
  dur = 12, gain = 0.2, fadeIn = 1.5, fadeOut = 2, gust = 0.6, levels = null, send = 0.2, dry = 1, bright = 1,
}) {
  const eng = v.eng, rng = eng.rng, end = t + dur;
  const env = v.gain(0);
  bedEnvelope(env.gain, t, dur, gain, fadeIn, fadeOut, levels);
  const step = 0.25, N = Math.max(2, Math.ceil(dur / step) + 1);
  const tc = t + 0.003, dc = Math.max(0.05, dur - 0.006); // value curves must not share a start time with another event
  const gustCurve = () => { // smoothed random walk in 0..1
    const c = new Float32Array(N);
    let x = rng.float(), vel = 0;
    for (let i = 0; i < N; i++) { vel = vel * 0.86 + (rng.float() - 0.5) * 0.11; x = clamp(x + vel, 0, 1); if (x === 0 || x === 1) vel *= -0.5; c[i] = x; }
    return c;
  };
  for (const pan of [-0.55, 0.55]) {
    const c = gustCurve();
    const n = v.noise('pink', t, end + 0.05);
    const bp = v.biquad('bandpass', 500, 0.9);
    const fc = c.map((x) => (300 + 900 * x * bright));
    bp.frequency.setValueCurveAtTime(fc, tc, dc);
    const g = v.gain(0);
    g.gain.setValueCurveAtTime(c.map((x) => 0.5 * (0.32 + gust * x * x * 1.3)), tc, dc);
    const p = v.panner(pan);
    n.connect(bp); bp.connect(g); g.connect(p); p.connect(env);
    // whistle through the cracks, riding the same gusts
    const w = v.noise('white', t, end + 0.05);
    const wb = v.biquad('bandpass', 900, 24);
    wb.frequency.setValueCurveAtTime(c.map((x) => 650 + 950 * x), tc, dc);
    const wg = v.gain(0);
    wg.gain.setValueCurveAtTime(c.map((x) => 0.5 * gust * x * x * x), tc, dc);
    w.connect(wb); wb.connect(wg); wg.connect(p);
  }
  const lo = v.noise('brown', t, end + 0.05);
  const ll = v.biquad('lowpass', 210, 0);
  const lg = v.gain(0.35);
  lo.connect(ll); ll.connect(lg); lg.connect(env);
  v.out(env, send, dry);
}

/** The burning plain far away: a low roar and a crackle loop. */
export function fireLayer(v, t, { dur = 10, gain = 0.15, fadeIn = 1.5, fadeOut = 2, levels = null, send = 0.25, dry = 1, crackle = 0.5, lp = 0 }) {
  const eng = v.eng, rng = eng.rng, end = t + dur;
  const env = v.gain(0);
  bedEnvelope(env.gain, t, dur, gain, fadeIn, fadeOut, levels);
  let tail = env;
  if (lp) { const f = v.biquad('lowpass', lp, 0); env.connect(f); tail = f; }
  const n = v.noise('brown', t, end + 0.05);
  const bp = v.biquad('bandpass', 240, 0.6);
  const rg = v.gain(0.9);
  const fl = v.osc('sine', rng.range(5.5, 8.5), t, end + 0.05);
  const flg = v.gain(0.18);
  fl.connect(flg); flg.connect(rg.gain);
  n.connect(bp); bp.connect(rg); rg.connect(env);
  if (crackle > 0) {
    const buf = pickIn(rng, eng.nbank.fire);
    const s = v.buffer(buf, t, { loop: true, stop: end + 0.05, offset: rng.range(0, buf.duration * 0.8) });
    const hp = v.biquad('highpass', 700, 0.7);
    const cg = v.gain(crackle * 0.35);
    s.connect(hp); hp.connect(cg); cg.connect(env);
  }
  v.out(tail, send, dry);
}

/** Molten rock: a deep rumble that breathes, viscous bubbles bursting, the crust ticking, a gas hiss. */
export function lavaLayer(v, t, {
  dur = 12, gain = 0.2, fadeIn = 2, fadeOut = 2, activity = 0.5, levels = null, send = 0.3, dry = 1,
}) {
  const eng = v.eng, rng = eng.rng, end = t + dur;
  const env = v.gain(0);
  bedEnvelope(env.gain, t, dur, gain, fadeIn, fadeOut, levels);
  const n = v.noise('brown', t, end + 0.05);
  const lp = v.biquad('lowpass', 105, 3);
  const hp = v.biquad('highpass', 32, 0.7);
  n.connect(hp);
  const rg = v.gain(1.1);
  const br = v.osc('sine', rng.range(0.06, 0.1), t, end + 0.05);
  const bg = v.gain(0.35);
  br.connect(bg); bg.connect(rg.gain);
  hp.connect(lp); lp.connect(rg); rg.connect(env);
  const hs = v.noise('white', t, end + 0.05);
  const hh = v.biquad('highpass', 2600, 0.7);
  const hg = v.gain(0.025 * activity);
  hs.connect(hh); hh.connect(hg); hg.connect(env);
  const count = Math.floor(dur * activity * 0.8);
  for (let k = 0; k < count; k++) {
    const at = rng.range(0.3, Math.max(0.4, dur - 1.2));
    const buf = pickIn(rng, eng.nbank.blorp);
    const s = v.buffer(buf, t + at, { rate: rng.range(0.7, 1.25) });
    const g = v.gain(rng.range(0.25, 0.8) * 0.55);
    const p = v.panner(rng.range(-0.7, 0.7));
    s.connect(g); g.connect(p); p.connect(env);
  }
  const cracks = Math.floor(dur * activity * 0.25);
  for (let k = 0; k < cracks; k++) {
    const at = rng.range(0.5, Math.max(0.6, dur - 1.5));
    const buf = pickIn(rng, eng.bank.stone);
    const s = v.buffer(buf, t + at, { rate: rng.range(0.45, 0.7), stop: t + at + 0.9 });
    const g = v.gain(rng.range(0.04, 0.12));
    const bp = v.biquad('lowpass', 1800, 0);
    s.connect(bp); bp.connect(g); g.connect(env);
  }
  v.out(env, send, dry);
}

/**
 * Rain: a wash of noise, a dense drop texture, close drops on stone and bronze, the low patter on the lake,
 * and (sizzle > 0) the hiss of rain landing on cooling lava, which dies away over sizzleFade seconds.
 * Equal-power fades, so overlapping segments make an endless bed.
 */
export function rainLayer(v, t, {
  dur = 10, gain = 0.25, fadeIn = 2, fadeOut = 2, close = 0.5, wash = 1, low = 0.5, sizzle = 0, sizzleFade = 10,
  send = 0.25, dry = 1, swell = 0.12,
}) {
  const eng = v.eng, rng = eng.rng, B = eng.nbank.rain, end = t + dur;
  const env = v.gain(0);
  equalPowerFades(env.gain, t, dur, gain, fadeIn, fadeOut);
  const mod = v.gain(1 - swell); // slow changes in intensity
  for (const hz of [rng.range(0.05, 0.08), rng.range(0.11, 0.17)]) {
    const l = v.osc('sine', hz, t, end + 0.05);
    const lg = v.gain(swell * 0.5);
    l.connect(lg); lg.connect(mod.gain);
  }
  mod.connect(env);
  const w = v.noise('pink', t, end + 0.05);
  const whp = v.biquad('highpass', 520, 0.7);
  const wpk = v.biquad('peaking', 4300, 0.8, 4);
  const wlp = v.biquad('lowpass', 10500, 0.5);
  const wg = v.gain(0.42 * wash);
  w.connect(whp); whp.connect(wpk); wpk.connect(wlp); wlp.connect(wg); wg.connect(mod);
  B.bed.forEach((buf, i) => {
    const s = v.buffer(buf, t, { loop: true, stop: end + 0.05, offset: rng.range(0, buf.duration * 0.9) });
    const g = v.gain(0.3);
    const p = v.panner(i ? 0.6 : -0.6);
    s.connect(g); g.connect(p); p.connect(mod);
  });
  if (close > 0) {
    B.close.forEach((buf, i) => {
      const s = v.buffer(buf, t, { loop: true, stop: end + 0.05, offset: rng.range(0, buf.duration * 0.9), rate: rng.range(0.95, 1.05) });
      const g = v.gain(0.28 * close);
      const p = v.panner(i ? 0.35 : -0.35);
      s.connect(g); g.connect(p); p.connect(mod);
    });
  }
  if (low > 0) {
    const n = v.noise('brown', t, end + 0.05);
    const l = v.biquad('lowpass', 170, 0);
    const g = v.gain(0.4 * low);
    n.connect(l); l.connect(g); g.connect(mod);
  }
  if (sizzle > 0) {
    const n = v.noise('white', t, Math.min(end, t + sizzleFade + 0.5) + 0.05);
    const h = v.biquad('highpass', 3800, 0.7);
    const pk = v.biquad('peaking', 7000, 1, 5);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * sizzle, t + Math.min(1.5, sizzleFade * 0.2));
    g.gain.setTargetAtTime(0, t + Math.min(1.5, sizzleFade * 0.2), sizzleFade / 4);
    const fl = v.osc('sine', 13, t, Math.min(end, t + sizzleFade + 0.5) + 0.05); // crackly flutter of steam
    const flg = v.gain(0.12 * sizzle);
    fl.connect(flg); flg.connect(g.gain);
    n.connect(h); h.connect(pk); pk.connect(g); g.connect(env);
  }
  v.out(env, send, dry);
}

/** The mountain breathing: air drawn through a vast throat, a held beat, then a long low sigh. */
export function breathLayer(v, t, { inhale = 3, hold = 0.4, exhale = 3.4, gain = 0.25, send = 0.5, dry = 1, pitch = 1 }) {
  const eng = v.eng, W = eng.waves.glottal;
  const tIn = t + inhale, tOut = tIn + hold, end = tOut + exhale;
  const env = v.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain * 0.04, t + 0.1);
  env.gain.exponentialRampToValueAtTime(gain * 0.62, tIn);
  env.gain.linearRampToValueAtTime(gain * 0.55, tOut);
  env.gain.linearRampToValueAtTime(gain, tOut + exhale * 0.22);
  env.gain.setTargetAtTime(0, tOut + exhale * 0.3, exhale * 0.25);
  const n = v.noise('pink', t, end + 1);
  const n2 = v.noise('brown', t, end + 1);
  const n2h = v.biquad('highpass', 45, 0.7);
  const n2g = v.gain(0.8);
  n2.connect(n2h); n2h.connect(n2g);
  const lp = v.biquad('lowpass', 180 * pitch, 1.5);
  lp.frequency.setValueAtTime(180 * pitch, t);
  lp.frequency.exponentialRampToValueAtTime(700 * pitch, tIn);
  lp.frequency.setValueAtTime(760 * pitch, tOut);
  lp.frequency.exponentialRampToValueAtTime(140 * pitch, end);
  const fo = v.biquad('peaking', 420 * pitch, 2.2, 6); // the "o" of the throat
  n.connect(lp); n2g.connect(lp); lp.connect(fo); fo.connect(env);
  // a voiced groan under the sigh
  const o = v.osc(W, 41 * pitch, tOut, end + 1);
  o.frequency.setValueAtTime(41 * pitch, tOut);
  o.frequency.exponentialRampToValueAtTime(33 * pitch, end);
  const og = v.gain(0);
  og.gain.setValueAtTime(0, tOut);
  og.gain.linearRampToValueAtTime(0.5, tOut + exhale * 0.3);
  og.gain.linearRampToValueAtTime(0, end);
  const ol = v.biquad('lowpass', 480 * pitch, 3);
  o.connect(ol); ol.connect(og); og.connect(env);
  const sub = v.osc('sine', 48 * pitch, t, end + 1);
  const sg = v.gain(0.22);
  sub.connect(sg); sg.connect(env);
  v.out(env, send, dry);
}

// ================================================================ the 1980s television-fantasy band (the fight music)
// An electronic rhythm section under Chinese melody instruments: synth drums, a sequenced synth bass, a synth brass
// lead, a pipa-like pluck. Each layer plays a whole phrase from one small node graph (times in seconds from t).

/** Drum machine. kick / snare / hat: [[at, level, (hat) open]], tom: [[at, midi, level]] (a syndrum: the pitch falls). */
export function kitLayer(v, t, { kick = [], snare = [], hat = [], tom = [], gain = 1, send = 0.12, dry = 1 }) {
  const all = [...kick, ...snare, ...hat, ...tom];
  if (!all.length) return;
  const stop = t + Math.max(...all.map((h) => h[0])) + 0.8;
  const sum = v.gain(gain);
  if (kick.length) {
    const o = v.osc('sine', 48, t, stop), g = v.gain(0);
    o.connect(g); g.connect(sum);
    for (const [at, a = 1] of kick) {
      const s = t + at;
      o.frequency.setValueAtTime(170, s); o.frequency.exponentialRampToValueAtTime(47, s + 0.085);
      g.gain.setTargetAtTime(0.55 * a, s, 0.0015); g.gain.setTargetAtTime(0, s + 0.03, 0.075);
    }
  }
  if (snare.length) {
    const n = v.noise('white', t, stop), bp = v.biquad('bandpass', 2100, 0.55), hp = v.biquad('highpass', 500, 0.7), g = v.gain(0);
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(sum);
    const o = v.osc('triangle', 190, t, stop), og = v.gain(0);
    o.connect(og); og.connect(sum);
    for (const [at, a = 1] of snare) {
      const s = t + at;
      g.gain.setTargetAtTime(0.5 * a, s, 0.001); g.gain.setTargetAtTime(0, s + 0.012, 0.06);
      o.frequency.setValueAtTime(240, s); o.frequency.exponentialRampToValueAtTime(175, s + 0.05);
      og.gain.setTargetAtTime(0.22 * a, s, 0.001); og.gain.setTargetAtTime(0, s + 0.01, 0.035);
    }
  }
  if (hat.length) {
    const n = v.noise('white', t, stop), hp = v.biquad('highpass', 7200, 0.9), g = v.gain(0);
    n.connect(hp); hp.connect(g); g.connect(sum);
    for (const [at, a = 1, open = 0] of hat) {
      const s = t + at;
      g.gain.setTargetAtTime(0.16 * a, s, 0.0008); g.gain.setTargetAtTime(0, s + 0.004, open ? 0.07 : 0.014);
    }
  }
  if (tom.length) {
    const o = v.osc('sine', 200, t, stop), g = v.gain(0), o2 = v.osc('triangle', 200, t, stop), g2 = v.gain(0.25);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(sum);
    for (const [at, midi, a = 1] of tom) {
      const s = t + at, f = mtof(midi);
      for (const q of [o, o2]) { q.frequency.setValueAtTime(f * 2.3, s); q.frequency.exponentialRampToValueAtTime(f, s + 0.13); }
      g.gain.setTargetAtTime(0.34 * a, s, 0.0015); g.gain.setTargetAtTime(0, s + 0.03, 0.085);
    }
  }
  v.out(sum, send, dry);
}

/** Sequenced synth bass: saw + square through a resonant low-pass that snaps shut on every note. notes: [[midi, seconds, accent]]. */
export function synthBassLayer(v, t, { notes, gain = 0.1, cutoff = 1500, send = 0.05, dry = 1 }) {
  let total = 0;
  for (const n of notes) total += n[1];
  const stop = t + total + 0.12;
  const f0 = mtof(notes[0][0]);
  const o1 = v.osc('sawtooth', f0, t, stop), o2 = v.osc('square', f0 / 2, t, stop), sub = v.gain(0.45);
  const lp = v.biquad('lowpass', 300, 5), env = v.gain(0);
  o1.connect(lp); o2.connect(sub); sub.connect(lp); lp.connect(env);
  let tn = t;
  for (const [m, d, acc = 1] of notes) {
    const f = mtof(m);
    o1.frequency.setValueAtTime(f, tn); o2.frequency.setValueAtTime(f / 2, tn);
    lp.frequency.setValueAtTime(v.fclamp(cutoff * (0.7 + 0.5 * acc)), tn);
    lp.frequency.exponentialRampToValueAtTime(230, tn + Math.min(d * 0.9, 0.17));
    env.gain.setTargetAtTime(gain * acc, tn, 0.003);
    env.gain.setTargetAtTime(gain * 0.12, tn + d * 0.72, 0.015);
    tn += d;
  }
  env.gain.setTargetAtTime(0, tn, 0.02);
  v.out(env, send, dry);
}

/** Synth brass lead: three detuned saws, the filter "blowing open" on each note, a delayed vibrato on the long ones.
 *  notes: [[midi | null (rest), seconds, accent]]. */
export function brassLayer(v, t, { notes, gain = 0.05, bright = 1, vib = 14, vibRate = 5.4, send = 0.3, dry = 1, octave = 0 }) {
  let total = 0;
  for (const n of notes) total += n[1];
  const first = notes.find((n) => n[0] != null);
  if (!first) return;
  const stop = t + total + 0.5;
  const lp = v.biquad('lowpass', 600, 1.6), env = v.gain(0);
  const lfo = v.osc('sine', vibRate, t, stop), depth = v.gain(0);
  lfo.connect(depth);
  const oscs = [];
  const dets = octave ? [-9, 0, 8, 1200 * octave] : [-9, 0, 8];
  dets.forEach((d, i) => {
    const o = v.osc('sawtooth', mtof(first[0]), t, stop), g = v.gain(i === 3 ? 0.35 : 1 / 3);
    o.detune.value = d; depth.connect(o.detune);
    o.connect(g); g.connect(lp); oscs.push(o);
  });
  lp.connect(env);
  let tn = t, prev = null;
  for (const [m, d, acc = 1] of notes) {
    if (m == null) { env.gain.setTargetAtTime(0, tn, 0.03); prev = null; tn += d; continue; }
    const f = mtof(m), lvl = gain * acc;
    for (const o of oscs) { if (prev == null) o.frequency.setValueAtTime(f, tn); else o.frequency.setTargetAtTime(f, tn, 0.008); }
    const top = v.fclamp(3600 * bright * (0.75 + 0.35 * acc));
    lp.frequency.setValueAtTime(v.fclamp(520 * bright), tn);
    lp.frequency.exponentialRampToValueAtTime(top, tn + 0.045);
    lp.frequency.setTargetAtTime(top * 0.55, tn + 0.06, Math.max(0.08, d * 0.4));
    env.gain.setTargetAtTime(lvl * 0.25, tn - 0.012, 0.006);       // tongued
    env.gain.setTargetAtTime(lvl, tn, 0.012);
    depth.gain.setTargetAtTime(0, tn, 0.02);
    if (d > 0.4) depth.gain.setTargetAtTime(vib, tn + 0.22, 0.15);
    prev = m; tn += d;
  }
  env.gain.setTargetAtTime(0, tn - 0.02, 0.06);
  v.out(env, send, dry);
}

/** Pipa-like pluck: a bright string that twangs into pitch and dies fast; `trem` (seconds) re-plucks a long note (轮指).
 *  notes: [[midi | null, seconds, accent, trem]]. */
export function pluckLayer(v, t, { notes, gain = 0.06, bright = 1, send = 0.22, dry = 1 }) {
  let total = 0;
  for (const n of notes) total += n[1];
  const first = notes.find((n) => n[0] != null);
  if (!first) return;
  const stop = t + total + 0.6;
  const o1 = v.osc('sawtooth', mtof(first[0]), t, stop), o2 = v.osc('triangle', mtof(first[0]), t, stop), g1 = v.gain(0.45);
  const lp = v.biquad('lowpass', 900, 2.2), body = v.biquad('peaking', 1900, 1.2, 5), env = v.gain(0);
  o1.connect(g1); g1.connect(lp); o2.connect(lp); lp.connect(body); body.connect(env);
  const pick = (s, f, lvl, tau) => {
    for (const o of [o1, o2]) { o.frequency.setValueAtTime(f * 1.014, s); o.frequency.exponentialRampToValueAtTime(f, s + 0.022); }
    lp.frequency.setValueAtTime(v.fclamp(5200 * bright), s);
    lp.frequency.exponentialRampToValueAtTime(v.fclamp(Math.max(700, f * 1.6)), s + 0.07);
    env.gain.setTargetAtTime(lvl, s, 0.0012);
    env.gain.setTargetAtTime(0, s + 0.006, tau);
  };
  let tn = t;
  for (const [m, d, acc = 1, trem = 0] of notes) {
    if (m != null) {
      const f = mtof(m);
      if (trem > 0) for (let s = 0, i = 0; s < d - 0.01; s += trem, i++) pick(tn + s, f, gain * acc * (i ? 0.8 : 1), trem * 0.55);
      else pick(tn, f, gain * acc, Math.min(0.22, Math.max(0.05, d * 0.7)));
    }
    tn += d;
  }
  v.out(env, send, dry);
}

export const NIUMO_INST = {
  kit: kitLayer, sbass: synthBassLayer, brass: brassLayer, pluck: pluckLayer,
  wardrum: wardrumLayer, droll: drumRollLayer, gong: gongLayer, cymbal: cymbalLayer, tbell: templeBellLayer,
  muyu: muyuLayer, boom: boomLayer, monk: monkLayer, suona: suonaLayer, guqin: guqinLayer,
  wind: windLayer, fire: fireLayer, lava: lavaLayer, rain: rainLayer, breath: breathLayer,
};
