// SFX recipes for the Flame Mountain (niumo) scene. Same contract as sfx.js: each recipe builds a layered
// sound inside one Voice; x = { p: pitch factor (incl. the ±5% per-call variation), ts: timing factor, rng, eng }.
// Merged into SFX / SFX_NAMES / SFX_LIMITS / SFX_DUCK / SFX_DURATION / SFX_REF by sfx.js.
import { thud, whoosh, noiseHit, ring, sample, shimmer } from './layers.js';
import { gongLayer, wardrumLayer, rainLayer } from './niumo_instruments.js';
import { mtof, qToDb, vowelFormants, formantPower, FORMANT_BW } from './dsp.js';

export const NIUMO_SFX_NAMES = [
  'staff_swing', 'staff_hit', 'staff_hit_heavy', 'bull_roar', 'bull_stomp', 'bull_slam', 'fire_breath',
  'fan_wind', 'lava_burst', 'rock_crack', 'rain',
];

export const NIUMO_SFX_LIMITS = {
  staff_swing: 3, staff_hit: 4, staff_hit_heavy: 2, bull_roar: 1, bull_stomp: 3, bull_slam: 2, fire_breath: 1,
  fan_wind: 2, lava_burst: 4, rock_crack: 4, rain: 3,
};

export const NIUMO_SFX_DUCK = {
  bull_roar: [0.4, 3.2], bull_slam: [0.3, 1.0], bull_stomp: [0.2, 0.8], staff_hit_heavy: [0.15, 0.5], lava_burst: [0.12, 0.6],
};

export const NIUMO_SFX_DURATION = {
  staff_swing: 0.42, staff_hit: 0.7, staff_hit_heavy: 1.4, bull_roar: 4.2, bull_stomp: 2.2, bull_slam: 2.8,
  fire_breath: 3.6, fan_wind: 1.6, lava_burst: 2.2, rock_crack: 1.6, rain: 10,
};

/** Reference distance (m) for distance attenuation: the bull is ~22-40 m tall, his sounds carry across the caldera. */
export const NIUMO_SFX_REF = {
  bull_roar: 30, bull_stomp: 22, bull_slam: 22, fire_breath: 16, lava_burst: 10, rock_crack: 10,
};

const scaleAll = (arr, k) => arr.map((x) => x * k);

/**
 * The bull king's voice: a giant's throat (formants scaled down), a rough glottal source with a sub-octave
 * (period doubling), jitter and a fast amplitude rattle, through a driven vocal tract; a bellowing upper
 * layer, the air rushing out, a sub you feel, and his bronze head humming like a gong.
 */
function roar(v, t, { p, ts, rng, eng }) {
  const W = eng.waves.glottal, sr = eng.sr;
  const D = 4.0 * ts, tA = t + 0.15 * ts, tP = t + 1.15 * ts, tH = t + 2.6 * ts, tE = t + D, stop = tE + 0.5;
  const f0 = 47 * p;
  const env = v.gain(0);
  const E = env.gain;
  E.setValueAtTime(0, t);
  E.linearRampToValueAtTime(0.8, tA);            // the bark that opens it
  E.linearRampToValueAtTime(0.62, tA + 0.22 * ts);
  E.linearRampToValueAtTime(1.0, tP);             // swelling to full voice
  E.linearRampToValueAtTime(0.88, tH);
  E.setTargetAtTime(0, tH, 0.36 * ts);
  // pitch contour in cents, shared by every voiced layer
  const pc = v.constant(0, t, stop);
  const P = pc.offset;
  P.setValueAtTime(-380, t);
  P.linearRampToValueAtTime(0, tA + 0.25 * ts);
  P.linearRampToValueAtTime(170, tP);
  P.linearRampToValueAtTime(90, tH);
  P.linearRampToValueAtTime(-560, tE);
  const jit = v.noise('brown', t, stop);
  const jl = v.biquad('lowpass', 38, 0);
  const jg = v.gain(70);
  jit.connect(jl); jl.connect(jg);
  // voiced source
  const src = v.gain(1);
  for (const [mul, det, g] of [[1, -6, 1], [1, 7, 0.8], [0.5, 0, 0.55]]) {
    const o = v.osc(W, f0 * mul, t, stop);
    o.detune.value = det;
    pc.connect(o.detune); jg.connect(o.detune);
    const og = v.gain(g);
    o.connect(og); og.connect(src);
  }
  const breathy = v.noise('pink', t, stop);
  const bg = v.gain(0.06);
  breathy.connect(bg); bg.connect(src);
  // the rattle: fast amplitude modulation, the growl of a monster rather than a cow
  const rat = v.gain(0.62);
  const rl = v.osc('sine', 31 * p, t, stop);
  const rg = v.gain(0.38);
  rl.connect(rg); rg.connect(rat.gain);
  src.connect(rat);
  // a giant's vocal tract: formants scaled down, opening o -> a, closing to u as he runs out of breath
  const K = 0.64;
  const Fo = vowelFormants('male', 'o', f0).map((f) => f * K), Fa = vowelFormants('male', 'a', f0).map((f) => f * K), Fu = vowelFormants('male', 'u', f0).map((f) => f * K);
  let node = rat;
  for (let k = 0; k < 4; k++) {
    const b = v.biquad('lowpass', Fo[k], qToDb(Fo[k] / (FORMANT_BW[k] * 1.4)));
    b.frequency.setValueAtTime(Fo[k], t);
    b.frequency.linearRampToValueAtTime(Fa[k], tA + 0.35 * ts);
    b.frequency.setValueAtTime(Fa[k], tH);
    b.frequency.linearRampToValueAtTime(Fu[k], tE);
    node.connect(b); node = b;
  }
  const pw = formantPower(f0, W.amps, Fa, sr) * 2.2;
  const norm = v.gain(0.42 / Math.sqrt(pw));
  const sh = v.shaper(eng.driveCurve(3.2));
  const post = v.biquad('lowpass', 2600, 0);
  const vg = v.gain(0.42);
  node.connect(norm); norm.connect(sh); sh.connect(post); post.connect(vg); vg.connect(env);
  // the bellow above it: a second, higher voice with a steeper contour
  const b2 = v.osc(W, f0 * 2.6, t, stop);
  pc.connect(b2.detune); jg.connect(b2.detune);
  const c2 = v.constant(0, t, stop);
  c2.offset.setValueAtTime(-200, t); c2.offset.linearRampToValueAtTime(260, tP); c2.offset.linearRampToValueAtTime(-300, tE);
  c2.connect(b2.detune);
  const F2 = vowelFormants('male', 'a', f0 * 2.6).map((f) => f * 0.8);
  let n2 = b2;
  for (let k = 0; k < 3; k++) { const b = v.biquad('lowpass', F2[k], qToDb(F2[k] / FORMANT_BW[k])); n2.connect(b); n2 = b; }
  const g2 = v.gain(0.16 / Math.sqrt(formantPower(f0 * 2.6, W.amps, F2, sr)));
  const s2 = v.shaper(eng.driveCurve(2));
  n2.connect(g2); g2.connect(s2);
  const g2o = v.gain(0.2);
  s2.connect(g2o); g2o.connect(env);
  // air rushing out of the throat
  const air = v.noise('pink', t, stop);
  const ab = v.biquad('bandpass', 380 * p, 0.7);
  ab.frequency.setValueAtTime(380 * p, t);
  ab.frequency.exponentialRampToValueAtTime(1150 * p, tP);
  ab.frequency.exponentialRampToValueAtTime(420 * p, tE);
  const ag = v.gain(0.32);
  air.connect(ab); ab.connect(ag); ag.connect(env);
  // the sub
  const sub = v.osc('sine', 31 * p, t, stop);
  pc.connect(sub.detune);
  const sg = v.gain(0.42);
  sub.connect(sg); sg.connect(env);
  v.out(env, 0.4);
  // his bronze head hums with it; embers fly at the end
  gongLayer(v, tA, { kind: 'tamtamSoft', gain: 0.14, rate: 0.82 * p, send: 0.6, len: 4.2 * ts });
  sample(v, tH, rng.pick(eng.nbank.fire), { rate: 0.85 * p, gain: 0.1, send: 0.3, len: 1.6, offset: rng.range(0, 3) });
}

/** A roaring jet of flame that sweeps across the arena (handle.stop() ends it early). */
function fireJet(v, t, { p, ts, rng, eng }) {
  const D = 3.4 * ts, tI = t + 0.18 * ts, tR = t + D - 0.6 * ts, end = t + D, stop = end + 0.1, dir = rng.sign();
  noiseHit(v, t, { kind: 'pink', type: 'lowpass', f: 250 * p, f1: 2600 * p, sweep: 0.2 * ts, Q: 0.8, attack: 0.02, tau: 0.12, gain: 0.6, send: 0.25 });
  thud(v, t + 0.02, { f0: 85 * p, f1: 40 * p, glide: 0.2, tau: 0.16, gain: 0.55, send: 0.2, drive: 1.5 });
  const env = v.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.85, tI);
  env.gain.linearRampToValueAtTime(1, t + 0.7 * ts);
  env.gain.setValueAtTime(1, tR);
  env.gain.linearRampToValueAtTime(0, end);
  const pan = v.panner(-0.5 * dir);
  pan.pan.setValueAtTime(-0.5 * dir, t);
  pan.pan.linearRampToValueAtTime(0.5 * dir, end);
  env.connect(pan);
  const layer = (kind, type, f, Q, g, flutterHz, flutter) => {
    const n = v.noise(kind, t, stop);
    const b = v.biquad(type, f * p, Q);
    const gg = v.gain(g);
    if (flutterHz) {
      const l = v.osc('sine', flutterHz * rng.range(0.9, 1.1), t, stop);
      const lg = v.gain(g * flutter);
      l.connect(lg); lg.connect(gg.gain);
    }
    n.connect(b); b.connect(gg); gg.connect(env);
  };
  layer('brown', 'bandpass', 260, 0.6, 1.05, 11, 0.25);   // the roar of the combustion
  layer('pink', 'bandpass', 900, 0.7, 0.42, 7, 0.3);      // turbulence
  layer('white', 'highpass', 3200, 0.7, 0.07, 0, 0);      // hiss of the jet
  layer('brown', 'lowpass', 140, 0, 0.55, 3, 0.2);        // the pressure
  const buf = rng.pick(eng.nbank.fire);
  const cr = v.buffer(buf, t + 0.1, { loop: true, stop, offset: rng.range(0, buf.duration * 0.8) });
  const ch = v.biquad('highpass', 900, 0.7);
  const cg = v.gain(0.45);
  cr.connect(ch); ch.connect(cg); cg.connect(env);
  v.out(pan, 0.35);
  sample(v, tR + 0.2, rng.pick(eng.nbank.fire), { rate: 0.95 * p, gain: 0.16, send: 0.3, len: 1.0, offset: rng.range(0, 3), type: 'highpass', f: 1200 });
}

export const NIUMO_SFX = {
  // the iron staff cutting the air: heavier and rounder than a blade, its golden hoops faintly singing
  staff_swing(v, t, { p, ts, rng }) {
    const dir = rng.sign(), d = 0.4 * ts;
    whoosh(v, t, { dur: d, f0: 170 * p, f1: 950 * p, f2: 260 * p, peakAt: 0.5, Q: 1.0, gain: 1.05, kind: 'pink', send: 0.14, pan0: -0.35 * dir, pan1: 0.35 * dir });
    whoosh(v, t + 0.03 * ts, { dur: d * 0.85, f0: 800 * p, f1: 2400 * p, f2: 1000 * p, peakAt: 0.52, Q: 5, gain: 0.16, send: 0.06 });
    noiseHit(v, t + d * 0.5, { kind: 'brown', type: 'lowpass', f: 230 * p, Q: 0, attack: 0.03, tau: 0.06, gain: 0.35 });
    ring(v, t + d * 0.45, { f: 3150 * p, ratios: [1, 1.41, 2.03], amps: [0.5, 0.3, 0.2], taus: [0.08, 0.06, 0.04], gain: 0.025, send: 0.2 });
  },

  // iron on bronze and basalt: a heavy knock, a short clank, grit and a few embers
  staff_hit(v, t, { p, ts, rng, eng }) {
    noiseHit(v, t, { type: 'highpass', f: 2200 * p, Q: 0, tau: 0.005, gain: 0.55, send: 0.1 });
    thud(v, t, { f0: 165 * p, f1: 72 * p, glide: 0.05 * ts, tau: 0.075 * ts, gain: 0.72, send: 0.14, drive: 1.6 });
    noiseHit(v, t, { kind: 'pink', type: 'lowpass', f: 1300 * p, Q: 0, tau: 0.03 * ts, gain: 0.45, send: 0.1 });
    ring(v, t + 0.002, {
      f: rng.range(430, 500) * p, ratios: [1, 1.58, 2.24, 2.92, 3.71, 4.6], amps: [0.5, 0.42, 0.32, 0.24, 0.16, 0.1],
      taus: scaleAll([0.26, 0.2, 0.15, 0.11, 0.08, 0.05], ts), gain: 0.3, send: 0.35, beat: 2.4,
    });
    sample(v, t + 0.003, rng.pick(eng.bank.stone), { rate: 1.25 * p, gain: 0.2, send: 0.15, len: 0.3 });
    sample(v, t + 0.01, rng.pick(eng.nbank.fire), { rate: 1.3 * p, gain: 0.16, send: 0.2, len: 0.35, offset: rng.range(0, 3), type: 'highpass', f: 1500 });
  },

  // the charged smash: a deep boom, the bronze answering like a gong, rock giving way, a spray of embers
  staff_hit_heavy(v, t, { p, ts, rng, eng }) {
    noiseHit(v, t, { type: 'highpass', f: 1600 * p, Q: 0, tau: 0.008, gain: 0.6, send: 0.2 });
    thud(v, t, { f0: 120 * p, f1: 42 * p, glide: 0.09 * ts, tau: 0.16 * ts, gain: 0.9, send: 0.2, drive: 2.4 });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 420 * p, Q: 0, tau: 0.09 * ts, gain: 0.65, send: 0.2 });
    gongLayer(v, t + 0.004, { kind: 'daluo', gain: 0.2, rate: 1.55 * p, send: 0.5, len: 1.4 * ts });
    ring(v, t + 0.003, {
      f: rng.range(300, 340) * p, ratios: [1, 1.52, 2.11, 2.69, 3.33, 4.1], amps: [0.5, 0.42, 0.34, 0.26, 0.2, 0.14],
      taus: scaleAll([0.42, 0.33, 0.25, 0.19, 0.14, 0.1], ts), gain: 0.26, send: 0.5, beat: 1.6,
    });
    sample(v, t + 0.01, rng.pick(eng.bank.debris), { rate: 0.95 * p, gain: 0.28, send: 0.3 });
    sample(v, t, rng.pick(eng.bank.stone), { rate: 0.9 * p, gain: 0.32, send: 0.25, len: 0.5 });
    sample(v, t + 0.02, rng.pick(eng.nbank.fire), { rate: 1.1 * p, gain: 0.22, send: 0.3, len: 0.8, offset: rng.range(0, 3), type: 'highpass', f: 1200 });
  },

  bull_roar: roar,

  // a hoof the size of a house comes down on rock
  bull_stomp(v, t, { p, ts, rng, eng }) {
    thud(v, t, { f0: 58 * p, f1: 24 * p, glide: 0.32 * ts, tau: 0.48 * ts, gain: 0.95, send: 0.35, drive: 2.6 });
    thud(v, t, { f0: 128 * p, f1: 48 * p, glide: 0.18, tau: 0.2, gain: 0.55, send: 0.3 });
    noiseHit(v, t, { type: 'highpass', f: 1300 * p, Q: 0, tau: 0.01, gain: 0.5, send: 0.3 });
    sample(v, t + 0.002, rng.pick(eng.bank.stone), { rate: 0.7 * p, gain: 0.5, send: 0.35 });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 170 * p, Q: 0, attack: 0.006, tau: 0.42 * ts, gain: 0.95, send: 0.4 });
    noiseHit(v, t + 0.02, { type: 'lowpass', f: 5000 * p, f1: 500 * p, sweep: 0.8 * ts, Q: 0, attack: 0.01, tau: 0.28 * ts, gain: 0.32, send: 0.45 });
    sample(v, t + 0.22 * ts, rng.pick(eng.bank.debris), { rate: 0.8 * p, gain: 0.34, send: 0.35 });
    wardrumLayer(v, t, { kind: 'big', gain: 0.3, rate: 0.62 * p, send: 0.3 });
  },

  // the iron club slammed into the ground: boom, the bar rings, stone splits, the crust breaks and gloops
  bull_slam(v, t, { p, ts, rng, eng }) {
    noiseHit(v, t, { type: 'highpass', f: 1400 * p, Q: 0, tau: 0.009, gain: 0.7, send: 0.3 });
    thud(v, t, { f0: 66 * p, f1: 25 * p, glide: 0.38 * ts, tau: 0.5 * ts, gain: 0.95, send: 0.35, drive: 2.8 });
    thud(v, t, { f0: 140 * p, f1: 52 * p, glide: 0.16, tau: 0.2, gain: 0.5, send: 0.3 });
    ring(v, t + 0.003, {
      f: rng.range(118, 132) * p, ratios: [1, 2.756, 5.404, 8.933, 13.34], amps: [0.6, 0.45, 0.3, 0.2, 0.12],
      taus: scaleAll([0.9, 0.6, 0.42, 0.3, 0.2], ts), gain: 0.3, send: 0.55, beat: 1.2,
    });
    sample(v, t + 0.003, rng.pick(eng.bank.stone), { rate: 0.78 * p, gain: 0.55, send: 0.35 });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 200 * p, Q: 0, attack: 0.004, tau: 0.4 * ts, gain: 0.9, send: 0.45 });
    noiseHit(v, t + 0.01, { type: 'lowpass', f: 6500 * p, f1: 600 * p, sweep: 1.0 * ts, Q: 0, attack: 0.008, tau: 0.32 * ts, gain: 0.4, send: 0.45 });
    sample(v, t + 0.28 * ts, rng.pick(eng.bank.debris), { rate: 0.9 * p, gain: 0.36, send: 0.35 });
    sample(v, t + 0.12 * ts, rng.pick(eng.nbank.blorp), { rate: 0.8 * p, gain: 0.35, send: 0.3 });
  },

  fire_breath: fireJet,

  // the banana-leaf fan: a great gust, the push of air, the leaf itself, a swirl, a breath of old magic
  fan_wind(v, t, { p, ts, rng, eng }) {
    const dir = rng.sign();
    whoosh(v, t, { dur: 1.1 * ts, f0: 180 * p, f1: 1300 * p, f2: 280 * p, peakAt: 0.32, Q: 0.75, gain: 1.15, kind: 'pink', send: 0.3, pan0: -0.25 * dir, pan1: 0.25 * dir });
    whoosh(v, t + 0.12 * ts, { dur: 1.3 * ts, f0: 500 * p, f1: 2600 * p, f2: 700 * p, peakAt: 0.4, Q: 1.6, gain: 0.35, send: 0.35, pan0: 0.5 * dir, pan1: -0.6 * dir });
    noiseHit(v, t + 0.05, { kind: 'brown', type: 'lowpass', f: 140 * p, Q: 0, attack: 0.08, tau: 0.22 * ts, gain: 0.7, send: 0.2 });
    sample(v, t, rng.pick(eng.bank.cloth), { rate: 0.7 * p, gain: 0.32, send: 0.15 });
    shimmer(v, t + 0.1, { freqs: [mtof(81) * p, mtof(86) * p, mtof(88) * p], rate: 9, depth: 0.6, rise: 0.25, tau: 0.35 * ts, gain: 0.018, send: 0.8 });
  },

  // lava forcing up through a crack: a deep gloop, the gas bursting, molten splatter and a hiss
  lava_burst(v, t, { p, ts, rng, eng }) {
    thud(v, t, { f0: 95 * p, f1: 34 * p, glide: 0.25 * ts, tau: 0.3 * ts, gain: 0.75, send: 0.3, drive: 1.8 });
    noiseHit(v, t + 0.01, { kind: 'pink', type: 'bandpass', f: 700 * p, f1: 220 * p, sweep: 0.3 * ts, Q: 0.7, attack: 0.006, tau: 0.16 * ts, gain: 0.75, send: 0.35 });
    noiseHit(v, t + 0.03, { type: 'highpass', f: 2600 * p, Q: 0, attack: 0.02, tau: 0.38 * ts, gain: 0.2, send: 0.35 });
    for (let k = 0; k < 3; k++) sample(v, t + rng.range(0.02, 0.25) * ts, rng.pick(eng.nbank.blorp), { rate: rng.range(0.7, 1.2) * p, gain: 0.42, send: 0.3 });
    sample(v, t + 0.12 * ts, rng.pick(eng.bank.dropsBig), { rate: 0.42 * p, gain: 0.35, send: 0.35, type: 'lowpass', f: 2200 });
    sample(v, t + 0.05, rng.pick(eng.nbank.fire), { rate: 0.9 * p, gain: 0.28, send: 0.3, len: 1.4, offset: rng.range(0, 3) });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 130 * p, Q: 0, attack: 0.02, tau: 0.5 * ts, gain: 0.6, send: 0.3 });
  },

  // basalt splitting: the crack, a grinding creak, a thump, debris
  rock_crack(v, t, { p, ts, rng, eng }) {
    noiseHit(v, t, { type: 'highpass', f: 3000 * p, Q: 0, tau: 0.004, gain: 0.6, send: 0.2 });
    sample(v, t, rng.pick(eng.bank.stone), { rate: 1.0 * p, gain: 0.55, send: 0.3 });
    const src = v.buffer(eng.bank.grit[0], t + 0.02, { stop: t + 0.6 * ts, offset: rng.range(0, 1.0) });
    const env = v.gain(0);
    env.gain.setValueAtTime(0, t + 0.02);
    env.gain.linearRampToValueAtTime(0.9, t + 0.06);
    env.gain.setTargetAtTime(0, t + 0.2 * ts, 0.1 * ts);
    [420, 760, 1340].forEach((f, i) => {
      const b = v.biquad('bandpass', f * p, 6);
      const g = v.gain([2.2, 1.6, 1.0][i]);
      src.connect(b); b.connect(g); g.connect(env);
    });
    v.out(env, 0.3);
    thud(v, t, { f0: 95 * p, f1: 44 * p, glide: 0.06, tau: 0.1, gain: 0.55, send: 0.2, drive: 1.5 });
    sample(v, t + 0.12 * ts, rng.pick(eng.bank.debris), { rate: 1.1 * p, gain: 0.3, send: 0.3 });
  },

  // ~10 s of rain on stone and bronze (first drops hiss on the hot rock). Overlapping calls ~8 s apart
  // crossfade seamlessly; the niumo_ending music state carries its own endless rain bed.
  rain(v, t, { ts }) {
    rainLayer(v, t, { dur: 10 * ts, gain: 0.42, fadeIn: 2 * ts, fadeOut: 2 * ts, close: 0.9, low: 0.4, sizzle: 0.6, sizzleFade: 4, send: 0.2 });
  },
};
