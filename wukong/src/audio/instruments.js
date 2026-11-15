// Musical instruments, built as layers inside a Voice. Used by the music scores and by
// the bigger SFX (pillar charge, phase shift, boss death, bell).
import {
  adEnv, asrEnv, swellEnv, mtof, qToDb, vowelFormants, formantPower, FORMANT_BW,
} from './dsp.js';
import { noiseHit } from './layers.js';

/**
 * Formant choir: several detuned glottal oscillators per note with independent delayed
 * vibrato, through a 4-resonator vocal-tract cascade (Klatt style: resonant lowpass biquads
 * at F1..F4). Low notes use male formants, high notes female ones (one bank per group).
 * Output is power-normalised so `gain` is roughly the RMS of the layer.
 */
export function choirLayer(v, t, {
  notes, dur, vowel = 'a', vowelTo = null, morph = 0, voices = 2, spread = 11, vib = 16, vibRate = 5.2,
  attack = 0.6, release = 1.2, gain = 0.05, send = 0.5, dry = 1, breath = 0.05, glide = null,
  envelope = 'asr', spreadPan = 0.25,
}) {
  const eng = v.eng, rng = eng.rng, sr = eng.sr, W = eng.waves.glottal;
  const end = t + dur, stop = end + release * 1.8 + 0.05;
  const env = v.gain(0);
  if (envelope === 'swell') swellEnv(env.gain, t, gain, attack, Math.max(0, dur - attack), release);
  else asrEnv(env.gain, t, gain, attack, dur, release);
  const groups = [[notes.filter((m) => m < 55), 'male', -spreadPan], [notes.filter((m) => m >= 55), 'female', spreadPan]];
  const gFrom = glide ? glide.from ?? 1 : 1, gTo = glide ? glide.to ?? 1 : 1;
  for (const [grp, sex, pan] of groups) {
    if (!grp.length) continue;
    const sum = v.gain(1);
    const f0max = mtof(Math.max(...grp)) * Math.max(gFrom, gTo);
    const F = vowelFormants(sex, vowel, f0max);
    const F2 = vowelTo ? vowelFormants(sex, vowelTo, f0max) : null;
    let power = 0;
    for (const m of grp) {
      const f = mtof(m);
      const lfo = v.osc('sine', vibRate * rng.range(0.88, 1.12), t, stop);
      const depth = v.gain(0);
      depth.gain.setValueAtTime(vib * 0.2, t);
      depth.gain.linearRampToValueAtTime(vib, t + Math.min(1.2, dur * 0.5 + 0.2));
      lfo.connect(depth);
      for (let k = 0; k < voices; k++) {
        const o = v.osc(W, f * gFrom, t, stop);
        o.detune.value = (k - (voices - 1) / 2) * spread + rng.range(-4, 4);
        depth.connect(o.detune);
        if (glide) {
          o.frequency.setValueAtTime(f * gFrom, t);
          o.frequency.exponentialRampToValueAtTime(f * gTo, t + glide.time);
        }
        o.connect(sum);
      }
      const fm = f * Math.sqrt(gFrom * gTo);
      const pw = formantPower(fm, W.amps, F, sr);
      power += voices * (F2 ? 0.5 * (pw + formantPower(fm, W.amps, F2, sr)) : pw);
    }
    if (breath > 0) {
      const n = v.noise('pink', t, stop);
      const ng = v.gain(breath * Math.sqrt(grp.length * voices));
      n.connect(ng); ng.connect(sum);
    }
    let node = sum;
    for (let k = 0; k < 4; k++) {
      const bq = v.biquad('lowpass', F[k], qToDb(F[k] / FORMANT_BW[k]));
      if (F2) {
        const tm = t + (morph || dur);
        bq.frequency.setValueAtTime(F[k], t);
        bq.frequency.linearRampToValueAtTime(F2[k], tm);
        bq.Q.setValueAtTime(qToDb(F[k] / FORMANT_BW[k]), t);
        bq.Q.linearRampToValueAtTime(qToDb(F2[k] / FORMANT_BW[k]), tm);
      }
      node.connect(bq); node = bq;
    }
    const norm = v.gain(1 / Math.sqrt(power));
    node.connect(norm);
    if (pan) { const p = v.panner(pan); norm.connect(p); p.connect(env); } else norm.connect(env);
  }
  v.out(env, send, dry);
}

/**
 * A sung legato phrase on one (or a few unison) voices: portamento between notes, per-note
 * vowels, delayed vibrato, slow pitch drift, articulation dips and swells on long notes.
 * notes: [[midi, seconds, vowel], ...]
 */
export function phraseLayer(v, t, {
  notes, sex = 'female', voices = 1, spread = 0, vib = 34, vibRate = 5.3, gain = 0.05, send = 0.8, dry = 1,
  glide = 0.09, breath = 0.04, attack = 0.16, release = 0.8, dip = 0.18,
}) {
  const eng = v.eng, rng = eng.rng, sr = eng.sr, W = eng.waves.glottal;
  let total = 0;
  for (const n of notes) total += n[1];
  const end = t + total, stop = end + release * 1.8 + 0.05;
  const sum = v.gain(1);
  const lfo = v.osc('sine', vibRate * rng.range(0.95, 1.05), t, stop);
  const depth = v.gain(0);
  lfo.connect(depth);
  const drift = v.osc('sine', rng.range(0.17, 0.31), t, stop);
  const driftG = v.gain(6);
  drift.connect(driftG);
  const oscs = [];
  for (let k = 0; k < voices; k++) {
    const o = v.osc(W, mtof(notes[0][0]), t, stop);
    o.detune.value = (k - (voices - 1) / 2) * spread + (voices > 1 ? rng.range(-3, 3) : 0);
    depth.connect(o.detune); driftG.connect(o.detune);
    o.connect(sum); oscs.push(o);
  }
  if (breath > 0) {
    const n = v.noise('pink', t, stop);
    const ng = v.gain(breath * Math.sqrt(voices));
    n.connect(ng); ng.connect(sum);
  }
  const bqs = [];
  let node = sum;
  for (let k = 0; k < 4; k++) { const bq = v.biquad('lowpass', 1000, 10); node.connect(bq); node = bq; bqs.push(bq); }
  const env = v.gain(0);
  node.connect(env);
  env.gain.setValueAtTime(0, t);
  depth.gain.setValueAtTime(0, t);
  let tn = t;
  notes.forEach(([m, d, vow], i) => {
    const f = mtof(m);
    const F = vowelFormants(sex, vow || 'a', f);
    const lvl = gain / Math.sqrt(formantPower(f, W.amps, F, sr) * voices);
    for (const o of oscs) {
      if (i === 0) {
        o.frequency.setValueAtTime(f * 0.985, t);
        o.frequency.setTargetAtTime(f, t + 0.02, 0.05);
      } else {
        o.frequency.setTargetAtTime(f, tn - glide * 0.5, glide / 3);
      }
    }
    for (let k = 0; k < 4; k++) {
      const q = qToDb(F[k] / FORMANT_BW[k]);
      if (i === 0) { bqs[k].frequency.setValueAtTime(F[k], t); bqs[k].Q.setValueAtTime(q, t); } else {
        bqs[k].frequency.setTargetAtTime(F[k], tn - 0.04, 0.035);
        bqs[k].Q.setTargetAtTime(q, tn - 0.04, 0.035);
      }
    }
    depth.gain.setTargetAtTime(vib * 0.15, tn, 0.04);
    depth.gain.setTargetAtTime(vib, tn + Math.min(0.35, d * 0.4), Math.min(0.25, d * 0.3));
    if (i === 0) env.gain.linearRampToValueAtTime(lvl, t + attack);
    else {
      env.gain.setTargetAtTime(lvl * (1 - dip), tn - 0.05, 0.02);
      env.gain.setTargetAtTime(lvl, tn + 0.03, 0.05);
    }
    if (d > 1.4) {
      env.gain.setTargetAtTime(lvl * 1.12, tn + d * 0.3, d * 0.25);
      env.gain.setTargetAtTime(lvl * 0.9, tn + d * 0.7, d * 0.2);
    }
    tn += d;
  });
  env.gain.setTargetAtTime(0, end - 0.05, release / 4);
  v.out(env, send, dry);
}

/**
 * Pipe organ: one additive PeriodicWave per registration (all drawbar ranks in one
 * oscillator) plus a slightly detuned second rank per note, pipe-speech filter opening and
 * a breathy chiff at the onset.
 */
export function organLayer(v, t, {
  notes, dur, reg = 'principal', gain = 0.05, attack = 0.08, release = 0.35, send = 0.6, dry = 1,
  chiff = 0.25, pedal = null, envelope = 'asr', cutoff = 5200,
}) {
  const eng = v.eng, rng = eng.rng;
  const W = eng.waves[reg] || eng.waves.principal;
  const end = t + dur, stop = end + release * 1.8 + 0.05;
  const lp = v.biquad('lowpass', cutoff, -3);
  lp.frequency.setValueAtTime(Math.min(cutoff, 900), t);
  lp.frequency.exponentialRampToValueAtTime(v.fclamp(cutoff), t + 0.12);
  const env = v.gain(0);
  if (envelope === 'swell') swellEnv(env.gain, t, gain, attack, Math.max(0, dur - attack), release);
  else asrEnv(env.gain, t, gain, attack, dur, release);
  lp.connect(env);
  const all = pedal != null ? [...notes, pedal] : notes;
  const per = 0.5 / Math.sqrt(all.length) / W.rms;
  for (const m of all) {
    const f = mtof(m) * W.octave;
    const a = v.osc(W, f, t, stop);
    a.detune.value = rng.range(-2, 2);
    const b = v.osc(W, f, t, stop);
    b.detune.value = rng.range(3, 6) * rng.sign();
    const ga = v.gain(per), gb = v.gain(per * 0.45);
    a.connect(ga); b.connect(gb); ga.connect(lp); gb.connect(lp);
  }
  if (chiff > 0) {
    noiseHit(v, t, {
      type: 'bandpass', f: Math.min(mtof(Math.max(...notes)) * 3, 7000), Q: 2.5, attack: 0.004,
      tau: 0.028, gain: chiff * gain * 1.5, send: send * 0.5, dry,
    });
  }
  v.out(env, send, dry);
}

/** Low strings (cellos + basses): detuned saws, bowed-attack filter envelope. */
export function stringsLayer(v, t, {
  notes, dur, gain = 0.05, accent = 1, bright = 1, send = 0.3, dry = 1, attack = 0.012, release = 0.09,
}) {
  const rng = v.eng.rng;
  const stop = t + dur + release * 2.2 + 0.02;
  const lp = v.biquad('lowpass', 400, 4);
  const top = v.fclamp(2600 * bright * (0.65 + 0.35 * accent));
  lp.frequency.setValueAtTime(v.fclamp(320 * bright), t);
  lp.frequency.exponentialRampToValueAtTime(top, t + 0.028);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, top * 0.42), t + Math.max(0.06, dur * 0.85));
  const env = v.gain(0);
  const pk = gain * accent / Math.sqrt(notes.length);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(pk, t + attack);
  env.gain.setTargetAtTime(pk * 0.55, t + attack, 0.07);
  env.gain.setTargetAtTime(0, t + dur, release / 3);
  for (const m of notes) {
    const f = mtof(m);
    for (const d of [-7, 6]) {
      const o = v.osc('sawtooth', f, t, stop);
      o.detune.value = d + rng.range(-2, 2);
      o.connect(lp);
    }
  }
  lp.connect(env);
  v.out(env, send, dry);
}

/** Timpani: inharmonic membrane modes with a tension pitch drop and a felt-mallet thump. */
export function timpaniLayer(v, t, { midi = 38, gain = 0.4, send = 0.45, tau = 0.65, dry = 1 }) {
  const f = mtof(midi);
  const sum = v.gain(gain);
  const modes = [[1, 1, 1], [1.504, 0.42, 0.55], [1.742, 0.22, 0.4], [2.0, 0.26, 0.42], [2.44, 0.15, 0.3], [2.9, 0.08, 0.22]];
  for (const [r, a, tm] of modes) {
    const tt = tau * tm, end = t + tt * 6;
    const o = v.osc('sine', f * r * 1.03, t, end);
    o.frequency.setValueAtTime(f * r * 1.03, t);
    o.frequency.exponentialRampToValueAtTime(f * r, t + 0.12);
    const g = v.gain(0);
    adEnv(g.gain, t, a, 0.003, tt);
    o.connect(g); g.connect(sum);
  }
  v.out(sum, send, dry);
  noiseHit(v, t, { kind: 'pink', type: 'lowpass', f: 1100, Q: 0, attack: 0.002, tau: 0.018, gain: gain * 0.9, send: send * 0.6, dry });
}

/**
 * Timpani roll as one voice: membrane modes under a sawtooth tremolo (one decaying stroke per
 * cycle) with an exponential crescendo from g0 to g1 over `dur`, then the drum rings out.
 */
export function rollLayer(v, t, { midi = 38, dur = 0.86, g0 = 0.03, g1 = 0.2, rate = 13, tail = 0.5, send = 0.5, dry = 1 }) {
  const f = mtof(midi), end = t + dur, stop = end + tail * 6;
  const env = v.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(Math.max(g0, 1e-4), t + 0.01);
  env.gain.exponentialRampToValueAtTime(Math.max(g1, 2e-4), end);
  env.gain.setTargetAtTime(0, end, tail);
  const trem = v.gain(0.5);
  const lfo = v.osc('sawtooth', rate * v.eng.rng.range(0.95, 1.05), t, stop);
  const depth = v.gain(-0.45); // inverted ramp: stroke, then decay, every cycle
  depth.gain.setValueAtTime(-0.45, end);
  depth.gain.linearRampToValueAtTime(0, end + 0.06);
  const soft = v.biquad('lowpass', 220, -3); // ~1.5 ms mallet attack instead of a hard step (no clicks)
  lfo.connect(soft); soft.connect(depth); depth.connect(trem.gain);
  for (const [r, a] of [[1, 1], [1.504, 0.4], [2.0, 0.24]]) {
    const o = v.osc('sine', f * r, t, stop);
    const g = v.gain(a);
    o.connect(g); g.connect(trem);
  }
  const n = v.noise('pink', t, end + 0.1);
  const nl = v.biquad('lowpass', 900, -3);
  const ng = v.gain(0.6);
  ng.gain.setValueAtTime(0.6, end);
  ng.gain.linearRampToValueAtTime(0, end + 0.05);
  n.connect(nl); nl.connect(ng); ng.connect(trem);
  trem.connect(env);
  v.out(env, send, dry);
}

/** Taiko: skin slap + deep body with a fast pitch drop. */
export function taikoLayer(v, t, { gain = 0.5, pitch = 1, send = 0.35, dry = 1 }) {
  const f = 64 * pitch;
  const sum = v.gain(gain);
  const o = v.osc('sine', f * 2.1, t, t + 1.05);
  o.frequency.setValueAtTime(f * 2.1, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  const g = v.gain(0);
  adEnv(g.gain, t, 1, 0.002, 0.17);
  o.connect(g); g.connect(sum);
  const o2 = v.osc('sine', f * 1.62, t, t + 0.6);
  const g2 = v.gain(0);
  adEnv(g2.gain, t, 0.3, 0.002, 0.06);
  o2.connect(g2); g2.connect(sum);
  v.out(sum, send, dry);
  noiseHit(v, t, { kind: 'pink', type: 'lowpass', f: 1500 * pitch, Q: 0, attack: 0.001, tau: 0.014, gain: gain * 0.7, send: send * 0.5, dry });
  noiseHit(v, t, { kind: 'brown', type: 'bandpass', f: 170 * pitch, Q: 1.2, attack: 0.003, tau: 0.07, gain: gain * 0.9, send, dry });
}

// Church bell partials relative to the nominal (strike) pitch: hum, prime, tierce (minor
// third), quint, nominal, then upper partials. [ratio, amplitude, decay multiplier, beat Hz]
const BELL = [
  [0.25, 0.5, 3.0, 0.21], [0.5, 0.42, 2.0, 0.37], [0.6, 0.45, 1.6, 0], [0.75, 0.2, 1.2, 0],
  [1.0, 0.85, 1.0, 0.61], [1.25, 0.28, 0.65, 0], [1.335, 0.16, 0.55, 0], [1.5, 0.22, 0.45, 0],
  [2.0, 0.14, 0.32, 0], [2.52, 0.08, 0.24, 0], [3.03, 0.05, 0.18, 0],
];

/** Cathedral bell toll. midi = nominal (strike) note. */
export function bellLayer(v, t, {
  midi = 62, gain = 0.3, tau = 1.6, len = 8, send = 0.6, dry = 1, bright = 1, lp = 0,
}) {
  const fN = mtof(midi);
  const sum = v.gain(gain / 1.6);
  let node = sum;
  if (lp) { const f = v.biquad('lowpass', lp, -3); sum.connect(f); node = f; }
  const end = t + len;
  for (const [r, a, tm, beat] of BELL) {
    const fr = fN * r;
    if (fr > v.eng.nyq) continue;
    const amp = a * (r > 1.1 ? bright : 1);
    const tt = Math.min(tau * tm, len / 4);
    const g = v.gain(0);
    adEnv(g.gain, t, amp, 0.002, tt);
    g.gain.setTargetAtTime(0, end - 1.2, 0.2);
    const o = v.osc('sine', fr, t, end);
    o.connect(g);
    if (beat) { const o2 = v.osc('sine', fr + beat, t, end); const g2 = v.gain(0.55); o2.connect(g2); g2.connect(g); }
    g.connect(sum);
  }
  noiseHit(v, t, { type: 'bandpass', f: Math.min(2600 * bright, 8000), Q: 1.4, attack: 0.001, tau: 0.012, gain: gain * 0.35, send: send * 0.5, dry });
  v.out(node, send, dry);
}

/** Very low drone segment with slow filter breathing (for the tension state). */
export function droneLayer(v, t, { midi = 26, dur = 12, gain = 0.06, fadeIn = 3, fadeOut = 3, send = 0.5, dry = 1 }) {
  const eng = v.eng, rng = eng.rng;
  const f = mtof(midi), end = t + dur;
  const env = v.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + fadeIn);
  env.gain.setValueAtTime(gain, end - fadeOut);
  env.gain.linearRampToValueAtTime(0, end);
  const mix = v.gain(1);
  const add = (type, fr, g) => { const o = v.osc(type, fr, t, end + 0.02); const gg = v.gain(g); o.connect(gg); gg.connect(mix); return o; };
  add('sine', f, 0.55);
  add('sine', f * 2, 0.3).detune.value = 3;
  add('sine', f * 3, 0.07).detune.value = -4;
  const saw = v.osc('sawtooth', f * 2, t, end + 0.02);
  saw.detune.value = -6;
  const lp = v.biquad('lowpass', 150, 6);
  const lfo = v.osc('sine', rng.range(0.05, 0.09), t, end + 0.02);
  const lg = v.gain(60);
  lfo.connect(lg); lg.connect(lp.frequency);
  const sg = v.gain(0.35);
  saw.connect(lp); lp.connect(sg); sg.connect(mix);
  const air = v.noise('brown', t, end + 0.02);
  const alp = v.biquad('lowpass', 320, -3);
  const ag = v.gain(0.22);
  air.connect(alp); alp.connect(ag); ag.connect(mix);
  mix.connect(env);
  v.out(env, send, dry);
}
