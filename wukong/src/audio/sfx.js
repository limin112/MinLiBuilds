// SFX recipes. Each recipe builds a layered sound (transient + body + tail) inside one Voice.
// x = { p: pitch factor (already includes the per-call ±5% variation), ts: timing factor
// (±5%), rng, eng }.
import { thud, whoosh, noiseHit, ring, sample, sparkle, shimmer, splash, st } from './layers.js';
import { choirLayer, organLayer, bellLayer } from './instruments.js';
import { adEnv } from './dsp.js';
import {
  NIUMO_SFX, NIUMO_SFX_NAMES, NIUMO_SFX_LIMITS, NIUMO_SFX_DUCK, NIUMO_SFX_DURATION, NIUMO_SFX_REF,
} from './niumo_sfx.js';

export const SFX_NAMES = [
  'swing_light', 'swing_heavy', 'hit_flesh', 'hit_heavy', 'player_hurt', 'roll', 'step_water',
  'boss_step', 'boss_swing', 'boss_slam', 'sword_glint', 'sword_fly', 'sword_impact', 'pillar_charge',
  'pillar_blast', 'heal', 'lockon', 'ui', 'wax_crack', 'sword_draw', 'phase_shift', 'stagger',
  'boss_death', 'player_death', 'bell', 'block', 'parry', 'critical', 'heartbeat',
  ...NIUMO_SFX_NAMES, // Flame Mountain scene (niumo_sfx.js)
];

/** Max simultaneous instances per name (oldest is stolen). */
export const SFX_LIMITS = {
  swing_light: 3, swing_heavy: 3, hit_flesh: 4, hit_heavy: 3, player_hurt: 2, roll: 2, step_water: 4,
  boss_step: 3, boss_swing: 2, boss_slam: 2, sword_glint: 7, sword_fly: 7, sword_impact: 7,
  pillar_charge: 4, pillar_blast: 4, heal: 2, lockon: 2, ui: 3, wax_crack: 4, sword_draw: 2,
  phase_shift: 1, stagger: 2, boss_death: 1, player_death: 1, bell: 3, block: 3, parry: 2, critical: 1, heartbeat: 1,
  ...NIUMO_SFX_LIMITS,
};

/** Automatic music ducking for the biggest sounds: [amount, seconds]. */
export const SFX_DUCK = {
  boss_slam: [0.35, 1.0], pillar_blast: [0.3, 0.9], phase_shift: [0.55, 3.0], stagger: [0.25, 0.8],
  boss_death: [0.45, 4.0], critical: [0.5, 1.6], parry: [0.2, 0.5],
  ...NIUMO_SFX_DUCK,
};

/** Nominal length of each sound in seconds (before the reverb tail). */
export const SFX_DURATION = {
  swing_light: 0.32, swing_heavy: 0.55, hit_flesh: 0.6, hit_heavy: 1.0, player_hurt: 0.5, roll: 0.75,
  step_water: 0.3, boss_step: 1.4, boss_swing: 1.1, boss_slam: 2.5, sword_glint: 1.0, sword_fly: 0.85,
  sword_impact: 1.2, pillar_charge: 1.2, pillar_blast: 2.0, heal: 1.5, lockon: 0.08, ui: 0.12,
  wax_crack: 0.55, sword_draw: 1.6, phase_shift: 3.2, stagger: 2.2, boss_death: 5.5, player_death: 4.0,
  bell: 8.0, block: 0.6, parry: 2.0, critical: 3.0, heartbeat: 0.5,
  ...NIUMO_SFX_DURATION,
};

/** Reference distance (m) for distance attenuation per SFX; names not listed use the default 4 m. */
export const SFX_REF = { ...NIUMO_SFX_REF };

const CHIME = [86, 88, 93, 98, 100]; // D6 E6 A6 D7 E7: open, "holy" intervals
const pickChime = (rng, n) => Array.from({ length: n }, () => rng.pick(CHIME)).sort((a, b) => a - b);
const scaleAll = (arr, k) => arr.map((x) => x * k);

export const SFX = {
  swing_light(v, t, { p, ts, rng }) {
    const dir = rng.sign();
    whoosh(v, t, { dur: 0.3 * ts, f0: 450 * p, f1: 2300 * p, f2: 900 * p, peakAt: 0.42, Q: 1.4, gain: 0.9, send: 0.12, pan0: -0.25 * dir, pan1: 0.3 * dir });
    whoosh(v, t + 0.02 * ts, { dur: 0.24 * ts, f0: 1400 * p, f1: 4200 * p, f2: 2000 * p, peakAt: 0.45, Q: 5, gain: 0.22, send: 0.05 });
    noiseHit(v, t, { type: 'bandpass', f: 2600 * p, Q: 1.2, tau: 0.008, gain: 0.08 });
  },

  swing_heavy(v, t, { p, ts, rng }) {
    const dir = rng.sign();
    whoosh(v, t, { dur: 0.5 * ts, f0: 220 * p, f1: 1300 * p, f2: 380 * p, peakAt: 0.48, Q: 1.1, gain: 1.1, kind: 'pink', send: 0.18, pan0: -0.35 * dir, pan1: 0.35 * dir });
    whoosh(v, t + 0.04 * ts, { dur: 0.42 * ts, f0: 700 * p, f1: 2800 * p, f2: 1100 * p, peakAt: 0.5, Q: 2.2, gain: 0.5, send: 0.1 });
    noiseHit(v, t + 0.22 * ts, { kind: 'brown', type: 'lowpass', f: 260 * p, Q: 0, attack: 0.03, tau: 0.07, gain: 0.45 });
  },

  // the player's sword on the armoured saint: armour thud + metal ring + faint holy sparkle
  hit_flesh(v, t, { p, ts, rng }) {
    noiseHit(v, t, { type: 'highpass', f: 2500 * p, Q: 0, tau: 0.004, gain: 0.6, send: 0.1 });
    thud(v, t, { f0: 210 * p, f1: 115 * p, glide: 0.05 * ts, tau: 0.065 * ts, gain: 0.6, send: 0.12 });
    noiseHit(v, t, { kind: 'pink', type: 'lowpass', f: 1100 * p, Q: 0, tau: 0.035 * ts, gain: 0.5, send: 0.1 });
    ring(v, t + 0.002, {
      f: rng.range(760, 900) * p, ratios: [1, 1.47, 2.09, 2.56, 3.39, 4.8], amps: [0.5, 0.36, 0.3, 0.2, 0.14, 0.1],
      taus: scaleAll([0.16, 0.13, 0.1, 0.08, 0.06, 0.04], ts), gain: 0.4, send: 0.3, beat: 3,
    });
    sparkle(v, t + 0.03 * ts, { notes: pickChime(rng, 2).map((m) => m + st(p)), gap: 0.045 * ts, tau: 0.3, gain: 0.045, send: 0.9 });
  },

  hit_heavy(v, t, { p, ts, rng, eng }) {
    noiseHit(v, t, { type: 'highpass', f: 1800 * p, Q: 0, tau: 0.006, gain: 0.6, send: 0.15 });
    thud(v, t, { f0: 130 * p, f1: 55 * p, glide: 0.07 * ts, tau: 0.12 * ts, gain: 0.85, send: 0.15, drive: 2 });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 500 * p, Q: 0, tau: 0.06 * ts, gain: 0.6, send: 0.15 });
    ring(v, t + 0.003, {
      f: rng.range(480, 560) * p, ratios: [1, 1.52, 2.11, 2.69, 3.33, 4.1, 5.3], amps: [0.5, 0.42, 0.34, 0.26, 0.2, 0.14, 0.1],
      taus: scaleAll([0.32, 0.26, 0.2, 0.16, 0.12, 0.09, 0.06], ts), gain: 0.34, send: 0.45, beat: 2.2,
    });
    sample(v, t, rng.pick(eng.bank.stone), { rate: 1.4 * p, gain: 0.16, send: 0.2, len: 0.25 });
    sparkle(v, t + 0.04 * ts, { notes: pickChime(rng, 3).map((m) => m + st(p)), gap: 0.05 * ts, tau: 0.45, gain: 0.045, send: 1.0 });
  },

  // mail-and-armour impact on the heroine (no voice)
  player_hurt(v, t, { p, ts, rng, eng }) {
    thud(v, t, { f0: 150 * p, f1: 78 * p, glide: 0.06, tau: 0.08 * ts, gain: 0.62, send: 0.1 });
    noiseHit(v, t, { kind: 'pink', type: 'lowpass', f: 1300 * p, Q: 0, tau: 0.05 * ts, gain: 0.55, send: 0.1 });
    sample(v, t + 0.004, rng.pick(eng.bank.chain), { rate: rng.range(0.9, 1.1) * p, gain: 0.62, send: 0.15 });
    ring(v, t + 0.002, {
      f: rng.range(1150, 1400) * p, ratios: [1, 1.61, 2.31, 3.17], amps: [0.5, 0.35, 0.25, 0.15],
      taus: scaleAll([0.07, 0.055, 0.04, 0.03], ts), gain: 0.3, send: 0.15,
    });
  },

  roll(v, t, { p, ts, rng, eng }) {
    sample(v, t, rng.pick(eng.bank.cloth), { rate: rng.range(0.9, 1.1) * p, gain: 0.26, send: 0.08 });
    splash(v, t + 0.08 * ts, { size: 0.9, p, gain: 0.32, send: 0.12 });
    thud(v, t + 0.12 * ts, { f0: 110 * p, f1: 60 * p, glide: 0.05, tau: 0.07, gain: 0.3, send: 0.05 });
    splash(v, t + 0.42 * ts, { size: 0.55, p: p * 1.08, gain: 0.22, send: 0.1 });
    sample(v, t + 0.1 * ts, rng.pick(eng.bank.chain), { rate: 0.8 * p, gain: 0.12, send: 0.05 });
  },

  step_water(v, t, { p, ts, rng, eng }) {
    noiseHit(v, t, { kind: 'pink', type: 'lowpass', f: 420 * p, Q: 0, tau: 0.02 * ts, gain: 0.32 });
    noiseHit(v, t + 0.006, { type: 'bandpass', f: 2000 * p, f1: 1100 * p, sweep: 0.06, Q: 0.8, attack: 0.003, tau: 0.035 * ts, gain: 0.3, send: 0.08 });
    sample(v, t + 0.01, rng.pick(eng.bank.drops), { rate: rng.range(1.1, 1.4) * p, gain: 0.24, send: 0.08, len: 0.22 * ts, offset: rng.range(0, 0.08) });
  },

  // giant footstep: deep thud + big splash + stone rumble
  boss_step(v, t, { p, ts }) {
    thud(v, t, { f0: 75 * p, f1: 32 * p, glide: 0.14 * ts, tau: 0.3 * ts, gain: 0.95, send: 0.25, drive: 1.5 });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 220 * p, Q: 0, attack: 0.004, tau: 0.16 * ts, gain: 0.85, send: 0.3 });
    splash(v, t + 0.012, { size: 2.2, p, gain: 0.55, send: 0.3 });
    noiseHit(v, t + 0.01, { kind: 'brown', type: 'lowpass', f: 120 * p, Q: 0, attack: 0.05, tau: 0.35 * ts, gain: 0.35, send: 0.3 });
  },

  boss_swing(v, t, { p, ts, rng }) {
    const dir = rng.sign(), peak = 0.55 * ts;
    whoosh(v, t, { dur: 1.0 * ts, f0: 110 * p, f1: 650 * p, f2: 180 * p, peakAt: 0.55, Q: 0.9, kind: 'pink', gain: 1.3, send: 0.3, pan0: -0.5 * dir, pan1: 0.5 * dir });
    whoosh(v, t + 0.08 * ts, { dur: 0.85 * ts, f0: 300 * p, f1: 1500 * p, f2: 500 * p, peakAt: 0.55, Q: 1.6, gain: 0.5, send: 0.2 });
    // the huge blade's resonant hum
    const o = v.osc('sawtooth', 48 * p, t, t + 1.1 * ts);
    const lp = v.biquad('lowpass', 320 * p, 2);
    const g = v.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + peak);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05 * ts);
    o.connect(lp); lp.connect(g); v.out(g, 0.2);
    noiseHit(v, t + 0.5 * ts, { kind: 'brown', type: 'lowpass', f: 160 * p, Q: 0, attack: 0.06, tau: 0.15, gain: 0.5, send: 0.2 });
  },

  // massive boom + stone crack + water burst
  boss_slam(v, t, { p, ts, rng, eng }) {
    noiseHit(v, t, { type: 'highpass', f: 1500 * p, Q: 0, tau: 0.008, gain: 0.7, send: 0.3 });
    sample(v, t + 0.003, rng.pick(eng.bank.stone), { rate: 0.85 * p, gain: 0.5, send: 0.35 });
    thud(v, t, { f0: 62 * p, f1: 27 * p, glide: 0.35 * ts, tau: 0.45 * ts, gain: 0.95, send: 0.35, drive: 2.5 });
    thud(v, t, { f0: 110 * p, f1: 45 * p, glide: 0.2, tau: 0.22, gain: 0.55, send: 0.3 });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 200 * p, Q: 0, attack: 0.004, tau: 0.35 * ts, gain: 0.95, send: 0.4 });
    noiseHit(v, t + 0.01, { type: 'lowpass', f: 7000 * p, f1: 700 * p, sweep: 0.9 * ts, Q: 0, attack: 0.008, tau: 0.3 * ts, gain: 0.45, send: 0.45 });
    splash(v, t + 0.02, { size: 3, p, gain: 0.6, send: 0.4 });
    sample(v, t + 0.35 * ts, rng.pick(eng.bank.dropsBig), { rate: 0.75 * p, gain: 0.32, send: 0.4 });
    sample(v, t + 0.25 * ts, rng.pick(eng.bank.debris), { rate: p, gain: 0.3, send: 0.3 });
  },

  // bright high "shing": attack telegraph
  sword_glint(v, t, { p, ts }) {
    noiseHit(v, t, { type: 'highpass', f: 6000 * p, Q: 0, tau: 0.012, gain: 0.22, send: 0.3 });
    ring(v, t + 0.004, {
      f: 2650 * p, ratios: [1, 1.5, 2.13, 2.88, 3.62], amps: [0.6, 0.45, 0.35, 0.25, 0.15],
      taus: scaleAll([0.32, 0.26, 0.2, 0.15, 0.1], ts), gain: 0.3, send: 0.55, beat: 4,
    });
    const n = v.noise('white', t, t + 0.5 * ts);
    const bp = v.biquad('bandpass', 3000 * p, 8);
    bp.frequency.setValueAtTime(v.fclamp(3000 * p), t);
    bp.frequency.exponentialRampToValueAtTime(v.fclamp(9500 * p), t + 0.25 * ts);
    const g = v.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.16 * ts);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48 * ts);
    n.connect(bp); bp.connect(g); v.out(g, 0.4);
    shimmer(v, t + 0.03, { freqs: [5274 * p, 7040 * p], rate: 17, rise: 0.08, tau: 0.25 * ts, gain: 0.07, send: 0.6 });
  },

  // flying sword: doppler whoosh + whistle
  sword_fly(v, t, { p, ts, rng }) {
    const dir = rng.sign(), d = 0.8 * ts;
    whoosh(v, t, { dur: d, f0: 600 * p, f1: 1900 * p, f2: 500 * p, peakAt: 0.5, Q: 2.5, gain: 1.0, send: 0.22, pan0: -0.4 * dir, pan1: 0.4 * dir });
    whoosh(v, t, { dur: d, f0: 200 * p, f1: 700 * p, f2: 200 * p, peakAt: 0.5, Q: 1, kind: 'pink', gain: 0.45, send: 0.15 });
    const o = v.osc('sine', 1650 * p, t, t + d + 0.05);
    o.frequency.setValueAtTime(1650 * p, t);
    o.frequency.linearRampToValueAtTime(1550 * p, t + d * 0.5);
    o.frequency.exponentialRampToValueAtTime(1150 * p, t + d);
    const g = v.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + d * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); v.out(g, 0.2);
  },

  // blade plunging into stone under water
  sword_impact(v, t, { p, ts, rng, eng }) {
    noiseHit(v, t, { type: 'highpass', f: 3000 * p, Q: 0, tau: 0.005, gain: 0.55, send: 0.2 });
    ring(v, t, {
      f: rng.range(1800, 2100) * p, ratios: [1, 1.38, 2.05, 2.7], amps: [0.5, 0.4, 0.3, 0.2],
      taus: scaleAll([0.18, 0.14, 0.1, 0.07], ts), gain: 0.24, send: 0.35,
    });
    sample(v, t + 0.002, rng.pick(eng.bank.stone), { rate: 1.15 * p, gain: 0.45, send: 0.3, len: 0.5 });
    thud(v, t, { f0: 110 * p, f1: 48 * p, glide: 0.08, tau: 0.1 * ts, gain: 0.75, send: 0.2 });
    splash(v, t + 0.015, { size: 1.4, p, gain: 0.45, send: 0.3 });
    // the embedded blade quivering
    const o = v.osc('sine', 420 * p, t + 0.03, t + 1.2 * ts);
    const am = v.gain(0.5);
    const lfo = v.osc('sine', 27, t + 0.03, t + 1.2 * ts);
    const lg = v.gain(0.5);
    lfo.connect(lg); lg.connect(am.gain);
    const g = v.gain(0);
    adEnv(g.gain, t + 0.03, 0.06, 0.004, 0.16 * ts);
    o.connect(am); am.connect(g); v.out(g, 0.3);
  },

  // rising shimmering choir swell (~1.2 s) leading into pillar_blast
  pillar_charge(v, t, { p, ts }) {
    const dur = 1.2 * ts, s = st(p);
    choirLayer(v, t, {
      notes: [62, 69, 74, 77].map((m) => m + s), dur, vowel: 'o', vowelTo: 'a', voices: 2, attack: dur, release: 0.1,
      gain: 0.14, send: 0.6, glide: { from: 0.84, to: 1, time: dur }, envelope: 'swell', vib: 25, breath: 0.08,
    });
    shimmer(v, t, { freqs: [1174.7 * p, 1760 * p, 2349.3 * p], rate: 13, rise: dur, tau: 0.04, gain: 0.07, send: 0.7 });
    const n = v.noise('white', t, t + dur + 0.2);
    const bp = v.biquad('bandpass', 800 * p, 3);
    bp.frequency.setValueAtTime(v.fclamp(800 * p), t);
    bp.frequency.exponentialRampToValueAtTime(v.fclamp(6500 * p), t + dur);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45 * 0.02, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.45, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.03);
    n.connect(bp); bp.connect(g); v.out(g, 0.5);
  },

  // bright explosion of light: airy blast + sub-bass + radiant D-major chime
  pillar_blast(v, t, { p, ts }) {
    noiseHit(v, t, { type: 'bandpass', f: 9000 * p, f1: 2200 * p, sweep: 0.6 * ts, Q: 0.6, attack: 0.004, tau: 0.38 * ts, gain: 1.0, send: 0.5 });
    noiseHit(v, t, { type: 'highpass', f: 4000 * p, Q: 0, attack: 0.002, tau: 0.08, gain: 0.45, send: 0.3 });
    thud(v, t, { f0: 52 * p, f1: 30 * p, glide: 0.3 * ts, tau: 0.42 * ts, gain: 0.85, send: 0.25, drive: 1.5 });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 300 * p, Q: 0, attack: 0.005, tau: 0.25 * ts, gain: 0.65, send: 0.35 });
    sparkle(v, t + 0.01, { notes: [86, 90, 93, 98].map((m) => m + st(p)), gap: 0.012, tau: 0.6 * ts, gain: 0.05, send: 1.0, partials: [[1, 1], [2, 0.25], [3.01, 0.1]] });
  },

  // soft glassy chime
  heal(v, t, { p, ts }) {
    sparkle(v, t, { notes: [86, 90, 93, 98].map((m) => m + st(p)), gap: 0.075 * ts, tau: 0.5 * ts, gain: 0.07, send: 0.65, partials: [[1, 1], [2.76, 0.22], [5.4, 0.07]] });
    const n = v.noise('white', t, t + 1.6 * ts);
    const bp = v.biquad('bandpass', 4200 * p, 1);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.35 * ts);
    g.gain.setTargetAtTime(0, t + 0.35 * ts, 0.22 * ts);
    n.connect(bp); bp.connect(g); v.out(g, 0.6);
    const o = v.osc('sine', 587.3 * p, t, t + 1.6 * ts);
    const og = v.gain(0);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.05, t + 0.2 * ts);
    og.gain.setTargetAtTime(0, t + 0.3 * ts, 0.25 * ts);
    o.connect(og); v.out(og, 0.5);
  },

  lockon(v, t, { p }) {
    const tick = (tt, f, gain, tau) => { const o = v.osc('sine', f, tt, tt + tau * 8); const g = v.gain(0); adEnv(g.gain, tt, gain, 0.001, tau); o.connect(g); v.out(g, 0.04); };
    tick(t, 2200 * p, 0.3, 0.012);
    tick(t + 0.035, 3300 * p, 0.17, 0.01);
    noiseHit(v, t, { type: 'highpass', f: 5000 * p, Q: 0, tau: 0.002, gain: 0.08 });
  },

  ui(v, t, { p }) {
    const o = v.osc('triangle', 880 * p, t, t + 0.25);
    o.frequency.setValueAtTime(880 * p, t);
    o.frequency.exponentialRampToValueAtTime(990 * p, t + 0.03);
    const g = v.gain(0);
    adEnv(g.gain, t, 0.42, 0.002, 0.035);
    o.connect(g); v.out(g, 0.05);
    const o2 = v.osc('sine', 1760 * p, t, t + 0.2);
    const g2 = v.gain(0);
    adEnv(g2.gain, t, 0.06, 0.002, 0.02);
    o2.connect(g2); v.out(g2, 0.05);
  },

  // crisp cracking (wax knights)
  wax_crack(v, t, { p, rng, eng }) {
    sample(v, t, rng.pick(eng.bank.wax), { rate: rng.range(0.9, 1.15) * p, gain: 0.6, send: 0.2 });
    noiseHit(v, t, { type: 'highpass', f: 2500 * p, Q: 0, tau: 0.003, gain: 0.4, send: 0.1 });
    noiseHit(v, t + 0.01, { type: 'bandpass', f: 520 * p, Q: 9, attack: 0.02, tau: 0.08, gain: 0.5, send: 0.1 });
  },

  // long metallic scrape that ends in a ring
  sword_draw(v, t, { p, ts, rng, eng }) {
    const dur = 0.95 * ts;
    noiseHit(v, t, { type: 'bandpass', f: 3800 * p, Q: 2, tau: 0.006, gain: 0.3, send: 0.15 }); // leaves the scabbard mouth
    const src = v.buffer(eng.bank.grit[0], t, { stop: t + dur + 0.05, offset: rng.range(0, 0.6) });
    const env = v.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.03);
    env.gain.linearRampToValueAtTime(0.8, t + dur * 0.8);
    env.gain.linearRampToValueAtTime(0, t + dur);
    // blade resonances excited by the gritty friction, sliding up as the contact point moves
    [2300, 3650, 5900, 8100].forEach((f, i) => {
      const bp = v.biquad('bandpass', f * p, 14);
      bp.frequency.setValueAtTime(v.fclamp(f * p), t);
      bp.frequency.exponentialRampToValueAtTime(v.fclamp(f * p * 1.18), t + dur);
      const g = v.gain([9, 7, 5, 3.5][i]);
      src.connect(bp); bp.connect(g); g.connect(env);
    });
    // broadband friction hiss
    const hiss = v.noise('white', t, t + dur + 0.05);
    const hb = v.biquad('bandpass', 5200 * p, 1.5);
    const hg = v.gain(0.1);
    hiss.connect(hb); hb.connect(hg); hg.connect(env);
    v.out(env, 0.35);
    ring(v, t + dur * 0.92, {
      f: 1450 * p, ratios: [1, 2.41, 3.93, 5.6, 7.3], amps: [0.5, 0.4, 0.3, 0.2, 0.12],
      taus: scaleAll([0.5, 0.42, 0.33, 0.25, 0.18], ts), gain: 0.25, send: 0.45, beat: 2.5,
    });
    noiseHit(v, t + dur * 0.92, { type: 'highpass', f: 4500 * p, Q: 0, tau: 0.01, gain: 0.22, send: 0.2 });
  },

  // ~3 s: rising choir roar + full-organ chord + glass shatter
  phase_shift(v, t, { p, ts, rng, eng }) {
    const rise = 2.0 * ts, hit = t + rise, s = st(p);
    choirLayer(v, t, {
      notes: [38, 45, 50, 57, 62, 65].map((m) => m + s), dur: rise + 0.3, vowel: 'o', vowelTo: 'a', voices: 2,
      attack: rise, release: 0.9, gain: 0.17, send: 0.7, glide: { from: 0.7, to: 1, time: rise }, envelope: 'swell',
      vib: 30, breath: 0.12,
    });
    const n = v.noise('pink', t, hit + 1.5);
    const bp = v.biquad('bandpass', 250 * p, 1.4);
    bp.frequency.setValueAtTime(v.fclamp(250 * p), t);
    bp.frequency.exponentialRampToValueAtTime(v.fclamp(1600 * p), hit);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55 * 0.02, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.55, hit);
    g.gain.setTargetAtTime(0, hit, 0.3);
    n.connect(bp); bp.connect(g); v.out(g, 0.5);
    organLayer(v, hit, { notes: [50, 57, 62, 65, 69, 74].map((m) => m + s), pedal: 38 + s, dur: 0.9, reg: 'full', gain: 0.3, attack: 0.04, release: 0.8, send: 0.7, chiff: 0.4 });
    sample(v, hit, rng.pick(eng.bank.glass), { rate: rng.range(0.95, 1.05) * p, gain: 0.5, send: 0.5 });
    noiseHit(v, hit, { type: 'highpass', f: 3500 * p, Q: 0, tau: 0.05, gain: 0.4, send: 0.4 });
    thud(v, hit, { f0: 70 * p, f1: 30 * p, glide: 0.4, tau: 0.4, gain: 0.8, send: 0.3, drive: 2 });
  },

  // heavy metal clang with reverb
  stagger(v, t, { p, ts, rng }) {
    noiseHit(v, t, { type: 'bandpass', f: 2500 * p, Q: 0.8, tau: 0.006, gain: 0.6, send: 0.3 });
    ring(v, t + 0.002, {
      f: rng.range(185, 205) * p, ratios: [1, 2.71, 3.95, 5.33, 6.82, 8.6, 10.3],
      amps: [0.55, 0.5, 0.4, 0.32, 0.22, 0.15, 0.1], taus: scaleAll([0.65, 0.5, 0.4, 0.3, 0.22, 0.16, 0.12], ts),
      gain: 0.45, send: 0.75, beat: 1.7,
    });
    thud(v, t, { f0: 130 * p, f1: 70 * p, glide: 0.06, tau: 0.12, gain: 0.65, send: 0.3 });
  },

  // ~5 s: descending choir sigh + bell toll, fading
  boss_death(v, t, { p, ts }) {
    const s = st(p);
    choirLayer(v, t + 0.05, {
      notes: [50, 57, 62, 65, 69].map((m) => m + s), dur: 3.6 * ts, vowel: 'a', vowelTo: 'u', voices: 2,
      attack: 0.7, release: 1.6, gain: 0.13, send: 0.85, glide: { from: 1, to: 0.89, time: 4.2 * ts }, vib: 18, breath: 0.1,
    });
    bellLayer(v, t + 0.25 * ts, { midi: 62 + s, gain: 0.32, tau: 1.3, len: 5.2, send: 0.6 });
    thud(v, t, { f0: 60 * p, f1: 32 * p, glide: 0.5, tau: 0.6, gain: 0.5, send: 0.3 });
  },

  // low thump + dissonant fade
  player_death(v, t, { p, ts, rng, eng }) {
    thud(v, t, { f0: 85 * p, f1: 38 * p, glide: 0.25, tau: 0.25 * ts, gain: 0.85, send: 0.2, drive: 1.5 });
    noiseHit(v, t, { kind: 'brown', type: 'lowpass', f: 300 * p, Q: 0, tau: 0.15, gain: 0.55, send: 0.2 });
    sample(v, t + 0.05, rng.pick(eng.bank.chain), { rate: 0.75 * p, gain: 0.25, send: 0.2 });
    const end = t + 0.9 + 0.75 * ts * 7;
    const lp = v.biquad('lowpass', 900 * p, 3);
    lp.frequency.setValueAtTime(v.fclamp(900 * p), t);
    lp.frequency.exponentialRampToValueAtTime(v.fclamp(260 * p), end);
    const env = v.gain(0);
    env.gain.setValueAtTime(0, t + 0.05);
    env.gain.linearRampToValueAtTime(0.13, t + 0.45);
    env.gain.setTargetAtTime(0, t + 0.9, 0.75 * ts);
    for (const m of [38, 39, 45, 46]) {
      const o = v.osc('sawtooth', 440 * Math.pow(2, (m + st(p) - 69) / 12), t, end);
      o.detune.setValueAtTime(rng.range(-5, 5), t);
      o.detune.linearRampToValueAtTime(-70 + rng.range(-10, 10), end);
      o.connect(lp);
    }
    lp.connect(env); v.out(env, 0.5);
  },

  bell(v, t, { p, ts }) {
    bellLayer(v, t, { midi: 62 + st(p), gain: 0.42, tau: 1.6 * ts, len: 8.5, send: 0.6 });
  },

  // her blade caught on the knight's guard: a dull clank, a short ring, the jolt in the arm
  block(v, t, { p, ts, rng }) {
    noiseHit(v, t, { type: 'bandpass', f: 1700 * p, Q: 0.9, tau: 0.012, gain: 0.75, send: 0.15 });
    noiseHit(v, t + 0.004, { kind: 'pink', type: 'highpass', f: 4200 * p, Q: 0, tau: 0.03, gain: 0.18, send: 0.1 });
    ring(v, t + 0.002, {
      f: rng.range(520, 580) * p, ratios: [1, 2.32, 3.86, 5.1, 6.9], amps: [0.5, 0.42, 0.3, 0.2, 0.12],
      taus: scaleAll([0.3, 0.22, 0.16, 0.12, 0.08], ts), gain: 0.3, send: 0.35, beat: 3,
    });
    thud(v, t, { f0: 170 * p, f1: 90 * p, glide: 0.04, tau: 0.09, gain: 0.6, send: 0.15 });
  },

  // a perfect guard: a bright singing ring that hangs in the nave + a spray of chimes
  parry(v, t, { p, ts, rng }) {
    noiseHit(v, t, { type: 'highpass', f: 3600 * p, Q: 0, tau: 0.006, gain: 0.6, send: 0.3 });
    thud(v, t, { f0: 210 * p, f1: 110 * p, glide: 0.03, tau: 0.06, gain: 0.5, send: 0.2 });
    ring(v, t + 0.002, {
      f: rng.range(1180, 1240) * p, ratios: [1, 2.02, 2.76, 4.07, 5.4], amps: [0.6, 0.32, 0.42, 0.22, 0.14],
      taus: scaleAll([0.85, 0.6, 0.5, 0.34, 0.24], ts), gain: 0.3, send: 0.6, beat: 2.4,
    });
    ring(v, t + 0.002, { f: 2950 * p, ratios: [1, 1.5, 2.13], amps: [0.5, 0.3, 0.2], taus: scaleAll([0.5, 0.35, 0.25], ts), gain: 0.12, send: 0.6, beat: 5 });
    sparkle(v, t + 0.05, { notes: [93, 98, 100].map((m) => m + st(p)), gap: 0.05 * ts, tau: 0.6 * ts, gain: 0.06, send: 0.75, partials: [[1, 1], [2.76, 0.2]] });
  },

  // the execution: armour gives, a deep boom, the blade rings inside her, and the choir answers
  critical(v, t, { p, ts, rng }) {
    const s = st(p);
    noiseHit(v, t, { kind: 'pink', type: 'bandpass', f: 950 * p, f1: 420 * p, sweep: 0.12, Q: 0.7, tau: 0.05, gain: 0.85, send: 0.25 });
    noiseHit(v, t, { type: 'highpass', f: 3000 * p, Q: 0, tau: 0.01, gain: 0.45, send: 0.3 });
    thud(v, t, { f0: 92 * p, f1: 36 * p, glide: 0.3 * ts, tau: 0.5 * ts, gain: 1.05, send: 0.4, drive: 1.5 });
    ring(v, t + 0.004, {
      f: rng.range(300, 320) * p, ratios: [1, 2.71, 3.95, 5.33, 6.82], amps: [0.55, 0.5, 0.38, 0.26, 0.16],
      taus: scaleAll([1.1, 0.8, 0.6, 0.42, 0.3], ts), gain: 0.32, send: 0.8, beat: 1.4,
    });
    choirLayer(v, t + 0.06, {
      notes: [38, 45, 50, 57, 62, 69].map((m) => m + s), dur: 1.0 * ts, vowel: 'a', vowelTo: 'o', voices: 2,
      attack: 0.07, release: 1.8, gain: 0.15, send: 0.85, vib: 18, breath: 0.1,
    });
    bellLayer(v, t + 0.1 * ts, { midi: 50 + s, gain: 0.3, tau: 1.4, len: 5, send: 0.7 });
  },

  // low-health pulse: lub-dub, felt more than heard
  heartbeat(v, t, { p }) {
    thud(v, t, { f0: 62 * p, f1: 40 * p, glide: 0.05, attack: 0.006, tau: 0.09, gain: 0.85, send: 0.02 });
    thud(v, t + 0.24, { f0: 54 * p, f1: 36 * p, glide: 0.05, attack: 0.006, tau: 0.11, gain: 0.6, send: 0.02 });
  },

  ...NIUMO_SFX, // Flame Mountain scene
};
