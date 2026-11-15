// Procedural score + lookahead sequencer + crossfading music director.
//
// Scores are generated bar by bar: score.bar(i) -> { len, events: [{ at, inst, args, dur, sustain }] }.
// A Sequencer turns bars into absolute times; players pull events whose start time falls
// inside [now, now + LOOKAHEAD) every ~25 ms (timer) or every frame (update()).
import { Fader, LOOKAHEAD } from './engine.js';
import {
  choirLayer, phraseLayer, organLayer, stringsLayer, timpaniLayer, rollLayer, taikoLayer, bellLayer, droneLayer,
} from './instruments.js';
import { NIUMO_INST } from './niumo_instruments.js';
import { NIUMO_SCORES, NIUMO_STATES, NIUMO_LOOPING } from './niumo_music.js';

// cathedral states, then the Flame Mountain (niumo) states (niumo_music.js)
export const MUSIC_STATES = ['off', 'opening', 'hymn', 'tension', 'phase1', 'phase2', 'finale', 'victory', 'defeat', ...NIUMO_STATES];
const LOOPING = new Set(['hymn', 'tension', 'phase1', 'phase2', 'finale', ...NIUMO_LOOPING]);
// states that cut the music instead of crossfading into it
const CUTS = new Set(['defeat', 'niumo_defeat']);
const INST = {
  choir: choirLayer, phrase: phraseLayer, organ: organLayer, strings: stringsLayer,
  timpani: timpaniLayer, roll: rollLayer, taiko: taikoLayer, bell: bellLayer, drone: droneLayer,
  ...NIUMO_INST,
};
const FILE_GAIN = 1;

const ev = (at, inst, args, dur = 0, sustain = false) => ({ at, inst, args, dur, sustain });

// ================================================================ battle (phase1 / phase2)
// 70 BPM, 4/4, 20 bars = 68.6 s loop. D minor with Phrygian bII (Eb).
// A (bars 0-7): pads + driving ostinato.  B (8-15): relative-major lift, choir melody.
// C (16-19): climax / turnaround back to A.
const BPM = 70, BEAT = 60 / BPM, BAR = 4 * BEAT;
const CH = {
  Dm: { v: [57, 62, 65, 69], bass: 38 },
  Eb: { v: [55, 58, 63, 67], bass: 39 },
  Bb: { v: [53, 58, 62, 65], bass: 34 },
  Gm: { v: [55, 58, 62, 67], bass: 43 },
  A: { v: [57, 61, 64, 69], bass: 33 },
  F: { v: [53, 57, 60, 65], bass: 41 },
  C: { v: [55, 60, 64, 67], bass: 36 },
};
const PROG = [
  'Dm', 'Dm', 'Bb', 'Eb', 'Dm', 'Gm', 'Eb', 'A',
  'F', 'C', 'Dm', 'Bb', 'Gm', 'Eb', 'Gm', 'A',
  'Dm', 'Eb', 'Dm', 'A',
];
// melodies: [midi, beats, vowel]; each spans 4 bars
const MEL = {
  A1: [[74, 3, 'a'], [77, 1, 'e'], [75, 2, 'a'], [74, 2, 'o'], [77, 4, 'a'], [79, 2, 'e'], [75, 2, 'o']],
  A2: [[74, 3, 'a'], [69, 1, 'o'], [70, 2, 'a'], [74, 2, 'e'], [75, 2, 'a'], [79, 2, 'o'], [76, 2, 'a'], [73, 2, 'a']],
  B1: [[69, 2, 'u'], [72, 2, 'e'], [67, 3, 'e'], [64, 1, 'a'], [65, 2, 'u'], [69, 2, 'e'], [74, 4, 'a']],
  B2: [[70, 2, 'e'], [69, 1, 'i'], [67, 1, 'o'], [65, 1, 'i'], [67, 1, 'e'], [70, 2, 'u'], [74, 2, 'a'], [72, 1, 'i'], [70, 1, 'u'], [69, 2, 'i'], [73, 2, 'a']],
  C: [[74, 4, 'a'], [75, 2, 'e'], [74, 2, 'a'], [69, 3, 'o'], [65, 1, 'u'], [64, 2, 'e'], [69, 2, 'a']],
};
const melNotes = (m, shift = 0) => m.map(([n, b, vw]) => [n + shift, b * BEAT, vw]);
const tuneTimp = (b) => (b < 36 ? b + 12 : b);

// I = 1 phase one, 2 phase two, 3 finale (phase two under a quarter health: everything of phase two plus a
// soprano descant, brass-like organ stabs, driving off-beat drums, the melody doubled from the first bar, more bells)
function battleBar(i, I) {
  const n = i % PROG.length, c = CH[PROG[n]];
  const sec = n < 8 ? 'A' : n < 16 ? 'B' : 'C';
  const E = [];
  const p2 = I >= 2, fin = I === 3;

  // choir pads (and the high choir in phase 2)
  E.push(ev(0, 'choir', {
    notes: c.v, vowel: !p2 && sec === 'A' ? 'u' : sec === 'B' ? 'o' : 'a', voices: 2,
    attack: p2 ? 0.45 : 0.9, release: 1.3, gain: 0.045, send: 0.55,
  }, BAR + 0.08, true));
  if (p2) {
    E.push(ev(0, 'choir', {
      notes: [c.v[2] + 12, c.v[3] + 12], vowel: 'a', voices: 2, vib: 22, attack: 0.5, release: 1.2,
      gain: 0.024, send: 0.65,
    }, BAR + 0.08, true));
  }
  if (fin) {
    // descant: sopranos hold the chord's top an octave up, a swell per bar
    E.push(ev(0, 'choir', {
      notes: [c.v[3] + 12, c.v[1] + 24], vowel: 'a', voices: 3, vib: 26, attack: 0.35, release: 1.0,
      gain: 0.032, send: 0.6, envelope: 'swell',
    }, BAR + 0.08, true));
    // brass-like stabs: full organ, short, on 1 and the "and" of 2
    for (const at of [0, 1.5]) {
      E.push(ev(at * BEAT, 'organ', {
        notes: c.v, reg: 'full', gain: at ? 0.04 : 0.055, attack: 0.015, release: 0.28, send: 0.45, chiff: 0.7,
      }, BEAT * (at ? 0.45 : 0.8)));
    }
  }

  // organ: manual chord an octave under the choir + pedal
  const og = p2 ? 0.065 : sec === 'A' ? 0.05 : sec === 'B' ? 0.068 : 0.08;
  E.push(ev(0, 'organ', {
    // 'full' sounds an octave down (16' foundation), so it is written an octave up: same pitches
    notes: c.v.map((m) => (p2 ? m : m - 12)), pedal: p2 ? c.bass + 12 : c.bass, reg: p2 ? 'full' : 'principal', gain: og,
    attack: p2 ? 0.06 : 0.12, release: 0.4, send: 0.6, chiff: 0.3,
  }, BAR, true));

  // low string ostinato (8ths in phase 1, 16ths with 3+3+3+3+2+2 accents in phase 2)
  if (!p2) {
    const P = [0, 0, 0, 0, 0, 0, 12, 0], A = [1, 0.5, 0.62, 0.92, 0.5, 0.62, 0.88, 0.55];
    for (let k = 0; k < 8; k++) {
      E.push(ev(k * BEAT / 2, 'strings', {
        notes: [c.bass + P[k], c.bass + P[k] + 12], accent: A[k], gain: 0.17, send: 0.3, pan: 0.18,
        bright: sec === 'A' ? 0.85 : 1,
      }, (BEAT / 2) * 0.82));
    }
  } else {
    const P = [0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 7, 0, 12, 0], ACC = new Set([0, 3, 6, 9, 12, 14]);
    for (let k = 0; k < 16; k++) {
      E.push(ev(k * BEAT / 4, 'strings', {
        notes: [c.bass + P[k], c.bass + P[k] + 12], accent: ACC.has(k) ? 1 : 0.58, gain: 0.15, send: 0.28,
        pan: 0.18, bright: 1.2,
      }, (BEAT / 4) * 0.85));
    }
  }

  // percussion
  const tp = tuneTimp(c.bass);
  const timp = (beat, gain, pan = -0.15) => E.push(ev(beat * BEAT, 'timpani', { midi: tp, gain: gain * 0.35, pan, send: 0.5 }));
  const taiko = (beat, gain, pitch = 1) => E.push(ev(beat * BEAT, 'taiko', { gain: gain * 0.6, pitch, pan: 0.1, send: 0.38 }));
  const roll = (from, to, g0, g1) => E.push(ev(from * BEAT, 'roll', { midi: tp, dur: (to - from) * BEAT, g0: g0 * 0.4, g1: g1 * 0.4, pan: -0.15, send: 0.5 }));
  const endOfPhrase = n % 4 === 3;
  if (!p2) {
    timp(0, n === 0 ? 0.5 : 0.38);
    if (sec === 'A') {
      if (n === 3 || n === 7) timp(2, 0.3);
      if (n === 7) roll(3, 4, 0.08, 0.36);
    } else {
      taiko(0, 0.42); taiko(2, 0.34); taiko(3.5, 0.24);
      if (sec === 'C') { timp(2, 0.32); taiko(1.5, 0.26); taiko(3, 0.3); }
      if (n === 15 || n === 19) roll(3, 4, 0.1, 0.4);
    }
  } else {
    timp(0, 0.45); timp(2, 0.34);
    taiko(0, 0.48, 0.92); taiko(1, 0.3); taiko(2, 0.42); taiko(2.5, 0.22); taiko(3, 0.3); taiko(3.5, 0.26);
    if (n % 4 === 0) taiko(0, 0.5, 0.62); // deep boom on phrase starts
    if (endOfPhrase) {
      roll(3, 4, 0.12, 0.42);
      for (let k = 0; k < 4; k++) taiko(3 + k * 0.25, 0.18 + k * 0.07, 1.1);
    }
    if (fin) {
      for (const at of [0.5, 1.5, 3]) taiko(at, 0.3, 1.18);   // off-beats push it forward
      for (const at of [1.75, 3.75]) taiko(at, 0.22, 1.32);   // 16th pickups
      timp(3, 0.34);
      if (n % 2 === 1 && !endOfPhrase) roll(3.25, 4, 0.06, 0.3);
    }
  }

  // bells
  if (!p2 ? n % 8 === 0 : fin ? n % 2 === 0 : n % 4 === 0) {
    E.push(ev(0, 'bell', { midi: n % 8 === 0 ? 62 : 57, gain: fin ? 0.11 : p2 ? 0.12 : 0.1, tau: 1.4, len: 7, send: 0.75, pan: -0.25 }));
  }

  // sung melodies (4-bar phrases)
  const mel = (m, args) => E.push(ev(0, 'phrase', {
    notes: melNotes(m, args.shift || 0), sex: args.sex || 'female', voices: 3, spread: 12, vib: 22, vibRate: 5.0,
    gain: args.gain, send: 0.65, glide: 0.08, breath: 0.04, attack: 0.25, release: 1.0, dip: 0.12, pan: args.pan || 0,
  }));
  const key = { 0: 'A1', 4: 'A2', 8: 'B1', 12: 'B2', 16: 'C' }[n];
  if (key && (p2 || sec !== 'A')) {
    mel(MEL[key], { gain: p2 ? 0.036 : 0.04 });
    if (p2 && (fin || sec !== 'A')) mel(MEL[key], { gain: 0.022, shift: -12, sex: 'male', pan: -0.2 });
  }
  return { len: BAR, events: E };
}

// ================================================================ hymn
const HYMN = [
  { rest: 2.4, notes: [[69, 1.6, 'a'], [70, 0.8, 'e'], [69, 0.8, 'a'], [67, 1.1, 'o'], [69, 2.8, 'a']] },
  { rest: 2.6, notes: [[65, 0.8, 'e'], [67, 0.8, 'i'], [69, 1.1, 'a'], [72, 1.1, 'o'], [70, 0.8, 'e'], [69, 1.6, 'a'], [67, 2.8, 'u']] },
  { rest: 2.6, notes: [[74, 1.7, 'a'], [72, 0.8, 'e'], [70, 0.8, 'i'], [69, 1.1, 'a'], [70, 0.8, 'o'], [72, 0.8, 'e'], [74, 3.2, 'a']] },
  { rest: 4.5, notes: [[72, 0.8, 'o'], [70, 0.8, 'e'], [69, 1.1, 'a'], [67, 0.8, 'i'], [65, 0.8, 'e'], [63, 1.6, 'o'], [62, 4.2, 'u']] },
];
const HYMN_STRETCH = 1.12;

function hymnBar(i) {
  const ph = HYMN[i % HYMN.length];
  const notes = ph.notes.map(([m, d, vw]) => [m, d * HYMN_STRETCH, vw]);
  const total = notes.reduce((s, n) => s + n[1], 0);
  return {
    len: total + ph.rest * HYMN_STRETCH,
    events: [
      ev(0.3, 'phrase', {
        notes, sex: 'female', voices: 1, vib: 36, vibRate: 5.4, gain: 0.036, dry: 0.45, send: 1.15,
        glide: 0.11, breath: 0.05, attack: 0.22, release: 1.1, dip: 0.2,
      }),
      // a barely-there ison (held drone note) under the line, as in Byzantine chant
      ev(0, 'choir', { notes: [50], vowel: 'u', voices: 2, gain: 0.011, attack: 2.5, release: 3, send: 0.9, dry: 0.6, breath: 0.03, vib: 8 }, total + 0.8, true),
    ],
  };
}

// ================================================================ tension
function tensionBar(i) {
  const k = i % 7;
  const E = [ev(0, 'drone', { midi: 26, gain: 0.028, fadeIn: 3, fadeOut: 3, send: 0.45 }, 12, true)];
  const bellAt = { 0: 5.0, 3: 3.5, 5: 6.5 }[k];
  if (bellAt != null) {
    E.push(ev(bellAt, 'bell', { midi: k === 3 ? 57 : 62, gain: 0.09, tau: 1.4, len: 7, send: 1.25, dry: 0.3, lp: 1700, bright: 0.6, pan: k === 3 ? 0.4 : -0.35 }));
  }
  return { len: 9, events: E };
}

// ================================================================ opening (the launch MV, one-shot, ~56 s)
// Synced to src/mv.js: candles (solo chant over the ison) -> the hall (choir enters) -> the wax knights (organ) ->
// the seven swords (Eb / A: the Phrygian sigh) -> the saint at prayer (full choir, the battle theme's first line) ->
// 33.1 s: silence, one dark bell ("God never answered") -> the door (a heartbeat on the timpani, a dark swell) ->
// 45 s: the title (boom, full organ, choir, bells) and a long tail.
function openingBar(i) {
  if (i > 0) return null;
  const E = [];
  const chant = (at, k) => {
    const ph = HYMN[k];
    E.push(ev(at, 'phrase', { notes: ph.notes.map(([m, d, vw]) => [m, d * HYMN_STRETCH, vw]), sex: 'female', voices: 1, vib: 36, vibRate: 5.4,
      gain: 0.04, dry: 0.5, send: 1.1, glide: 0.11, breath: 0.05, attack: 0.22, release: 1.1, dip: 0.2 }));
  };
  const pad = (at, dur, notes, vowel, gain = 0.03, attack = 2.2) =>
    E.push(ev(at, 'choir', { notes, vowel, voices: 2, gain, attack, release: 1.6, send: 0.75, breath: 0.05, vib: 14 }, dur, true));
  const org = (at, dur, notes, reg, gain, extra = {}) =>
    E.push(ev(at, 'organ', { notes, reg, gain, attack: 0.6, release: 1.2, send: 0.7, chiff: 0.12, ...extra }, dur));
  const bell = (at, midi, gain, extra = {}) => E.push(ev(at, 'bell', { midi, gain, tau: 1.5, len: 8, send: 0.8, ...extra }));
  const timp = (at, gain) => E.push(ev(at, 'timpani', { midi: 38, gain, send: 0.5, pan: -0.1 }));

  // 1 candles: the ison, then the solo voice
  E.push(ev(0, 'drone', { midi: 26, gain: 0.032, fadeIn: 4, fadeOut: 0.6, send: 0.5 }, 33.0, true));
  chant(1.2, 0);
  // 2 the hall: the choir breathes in under her
  pad(6.5, 6.6, [50, 57, 62, 65], 'u', 0.026);
  chant(10.0, 1);
  // 3 the wax knights: soft organ, a bell
  bell(13.0, 62, 0.08);
  org(13.0, 3.3, [46, 53, 58, 62], 'flute', 0.05); pad(13.0, 3.3, [46, 53, 58, 62], 'o', 0.026, 1.0);
  org(16.3, 3.2, [43, 55, 58, 62], 'flute', 0.05); pad(16.3, 3.2, [43, 55, 58, 62], 'o', 0.026, 1.0);
  // 4 the seven swords: the Phrygian Eb, then the dominant; a roll gathers
  pad(19.5, 3.2, [51, 58, 63, 67], 'o', 0.034, 1.2); org(19.5, 3.2, [51, 58, 63, 67], 'principal', 0.05, { pedal: 39 });
  pad(22.7, 3.3, [45, 57, 61, 64], 'a', 0.036, 1.0); org(22.7, 3.3, [45, 57, 61, 64], 'principal', 0.055, { pedal: 33 });
  E.push(ev(24.4, 'roll', { midi: 38, dur: 1.6, g0: 0.01, g1: 0.07, send: 0.5 }));
  // 5 the saint at prayer: full choir, the first line of the battle theme sung high
  timp(26.0, 0.12);
  pad(26.0, 3.5, [50, 57, 62, 65, 69], 'a', 0.046, 0.8); org(26.0, 3.5, [50, 57, 62, 65], 'principal', 0.075, { pedal: 38 });
  // the last chord before the silence stops short (the MV also ducks the reverb at 33.05 s)
  E.push(ev(29.5, 'choir', { notes: [46, 58, 62, 65], vowel: 'a', voices: 2, gain: 0.046, attack: 0.6, release: 0.35, send: 0.6, breath: 0.05, vib: 14 }, 3.5, true));
  org(29.5, 3.5, [46, 58, 62, 65], 'principal', 0.075, { pedal: 34, release: 0.3 });
  E.push(ev(26.3, 'phrase', { notes: [[74, 1.7, 'a'], [77, 0.6, 'e'], [75, 1.2, 'a'], [74, 2.9, 'o']], sex: 'female', voices: 3, spread: 12,
    vib: 22, vibRate: 5.0, gain: 0.04, send: 0.6, glide: 0.08, breath: 0.04, attack: 0.25, release: 0.3, dip: 0.12 }));
  // 6 silence. one dark bell: God never answered
  bell(34.6, 50, 0.16, { lp: 1500, bright: 0.5, tau: 2.2, len: 9 });
  // 7 the door: a heartbeat on the timpani, a low swell, a roll into the title
  for (const at of [38.4, 40.1, 41.7]) { timp(at, 0.16); timp(at + 0.34, 0.1); }
  E.push(ev(38.2, 'organ', { notes: [38, 39], pedal: 26, reg: 'dark', gain: 0.07, send: 0.7, chiff: 0, cutoff: 1300, envelope: 'swell', attack: 6.0, release: 0.4 }, 6.8));
  E.push(ev(39.6, 'choir', { notes: [38, 45, 50], vowel: 'u', voices: 3, gain: 0.034, send: 0.8, envelope: 'swell', attack: 5.0, release: 0.6, breath: 0.08 }, 5.4));
  E.push(ev(43.0, 'roll', { midi: 38, dur: 2.0, g0: 0.02, g1: 0.26, rate: 15, send: 0.55 }));
  // 8 the title
  E.push(ev(45.0, 'taiko', { gain: 0.62, pitch: 0.62, send: 0.4 }));
  timp(45.0, 0.42);
  E.push(ev(45.0, 'organ', { notes: [50, 57, 62, 65, 69], pedal: 38, reg: 'full', gain: 0.085, attack: 0.05, release: 3.5, send: 0.75, chiff: 0.5 }, 4.6));
  E.push(ev(45.0, 'choir', { notes: [62, 65, 69, 74], vowel: 'a', voices: 3, gain: 0.04, attack: 0.25, release: 3.0, send: 0.85, vib: 20 }, 4.4));
  bell(45.05, 62, 0.2); bell(48.2, 57, 0.11, { pan: 0.3 }); bell(51.4, 62, 0.08, { pan: -0.3 });
  E.push(ev(46.5, 'drone', { midi: 26, gain: 0.03, fadeIn: 2, fadeOut: 4, send: 0.6 }, 9.0, true));
  return { len: 56, events: E };
}

// ================================================================ victory / defeat (one-shots)
function victoryBar(i) {
  if (i > 0) return null;
  const org = (at, dur, notes, extra = {}) => ev(at, 'organ', { notes, reg: 'flute', gain: 0.075, attack: 0.35, release: 0.9, send: 0.7, chiff: 0.15, ...extra }, dur);
  const D = 9.2;
  return {
    len: 25,
    events: [
      org(0, 3.0, [46, 53, 58, 62, 65]), // Bb
      org(3.0, 2.8, [43, 55, 58, 62, 67]), // Gm
      org(5.8, 1.6, [45, 57, 62, 64, 69]), // A sus4
      org(7.4, 1.8, [45, 57, 61, 64, 69]), // A
      org(D, 9.0, [38, 50, 57, 62, 66, 69], { gain: 0.085, release: 4.5, attack: 0.5 }), // D major: Picardy third
      ev(D, 'choir', { notes: [62, 66, 69, 74], vowel: 'a', voices: 2, gain: 0.04, attack: 2.5, release: 4, send: 0.85 }, 8.5),
      ev(D, 'bell', { midi: 62, gain: 0.16, tau: 1.6, len: 8, send: 0.8 }),
      ev(D + 3.0, 'bell', { midi: 57, gain: 0.11, tau: 1.5, len: 7.5, send: 0.85, pan: 0.3 }),
      ev(D + 6.0, 'bell', { midi: 62, gain: 0.08, tau: 1.5, len: 7, send: 0.9, pan: -0.3 }),
    ],
  };
}

function defeatBar(i) {
  if (i > 0) return null;
  const sw = { envelope: 'swell', attack: 2.6, release: 4.2 };
  return {
    len: 10.5,
    events: [
      ev(0.1, 'organ', { notes: [45, 50], pedal: 38, reg: 'dark', gain: 0.13, send: 0.7, chiff: 0, cutoff: 1400, ...sw }, 3.2),
      ev(0.1, 'choir', { notes: [50, 51], vowel: 'u', voices: 3, gain: 0.05, send: 0.8, breath: 0.08, ...sw }, 3.2),
      ev(0.1, 'strings', { notes: [38, 39], gain: 0.06, accent: 1, bright: 0.6, send: 0.6, attack: 2.6, release: 3.5, pan: 0.2 }, 3.0),
      ev(0.1, 'roll', { midi: 38, dur: 2.9, g0: 0.004, g1: 0.07, rate: 11, tail: 0.9, send: 0.7 }),
    ],
  };
}

export const SCORES = {
  opening: { bar: openingBar },
  hymn: { bar: hymnBar },
  tension: { bar: tensionBar },
  phase1: { bar: (i) => battleBar(i, 1), grid: { beat: BEAT, beats: 4 } },
  phase2: { bar: (i) => battleBar(i, 2), grid: { beat: BEAT, beats: 4 } },
  finale: { bar: (i) => battleBar(i, 3), grid: { beat: BEAT, beats: 4 } },
  victory: { bar: victoryBar },
  defeat: { bar: defeatBar },
  ...NIUMO_SCORES,
};

/** Two scores share a beat grid (so a switch can continue on the same bar and beat). */
const sameGrid = (a, b) => !!a && !!b && Math.abs(a.beat - b.beat) < 1e-9 && a.beats === b.beats;

// ================================================================ sequencer
class Sequencer {
  constructor(score, t0, bar = 0, offset = 0) {
    this.score = score; this.t0 = t0; this.bar = bar; this.barStart = t0 - offset;
    this.queue = []; this.done = false;
  }
  _fill() {
    const b = this.score.bar(this.bar);
    if (!b) { this.done = true; return; }
    const items = [];
    for (const e of b.events) {
      let t = this.barStart + e.at, dur = e.dur, catchUp = false;
      if (t < this.t0 - 1e-6) { // starting mid-bar: re-enter long notes that are still sounding
        if (!e.sustain || t + dur < this.t0 + 0.4) continue;
        dur -= this.t0 - t; t = this.t0; catchUp = true;
      }
      items.push({ t, dur, e, catchUp });
    }
    items.sort((a, b2) => a.t - b2.t);
    for (const it of items) this.queue.push(it);
    this.barStart += b.len;
    this.bar++;
  }
  pump(now, horizon, play) {
    for (let guard = 0; guard < 4096; guard++) {
      if (!this.queue.length) {
        if (this.done || this.barStart >= horizon) return;
        this._fill();
        continue;
      }
      const it = this.queue[0];
      if (it.t >= horizon) return;
      this.queue.shift();
      if (it.t < now - 0.1) continue; // timer stalled (background tab): drop stale notes
      play(it, Math.max(it.t, now));
    }
  }
}

// ================================================================ players
class SynthPlayer {
  constructor(dir, state, score, { start, fade, bar = 0, offset = 0 }) {
    const eng = dir.eng, ctx = eng.ctx;
    this.kind = 'synth'; this.dir = dir; this.eng = eng; this.state = state; this.score = score;
    this.grid = score.grid || null;
    this.dry = ctx.createGain(); this.wet = ctx.createGain();
    this.dry.connect(eng.music.dry); this.wet.connect(eng.music.wet);
    this.fader = new Fader([this.dry.gain, this.wet.gain], 0);
    this.fader.to(1, start, fade, ctx.currentTime);
    this.voices = new Set();
    this.out = { dry: this.dry, wet: this.wet, owner: this.voices };
    this.seq = new Sequencer(score, start, bar, offset);
    this.gridT0 = start - offset; this.gridBar = bar;
    this.stopAt = Infinity; this.disposed = false; this.ending = false;
  }
  /** Next beat on this player's grid at or after t: { time, bar, offset }. */
  nextBeat(t) {
    const { beat, beats } = this.grid;
    const k = Math.max(0, Math.ceil((t - this.gridT0) / beat - 1e-6));
    const barsIn = Math.floor(k / beats);
    return { time: this.gridT0 + k * beat, bar: this.gridBar + barsIn, offset: (k - barsIn * beats) * beat };
  }
  pump(now, horizon) {
    if (this.disposed) return;
    this.seq.pump(now, Math.min(horizon, this.stopAt), (it, t) => this._play(it, t));
    if (this.seq.done && !this.ending && this.stopAt === Infinity) {
      this.ending = true;
      this.eng.at(this.seq.barStart + 0.5, () => this.dispose());
    }
  }
  _play(it, t) {
    const fn = INST[it.e.inst];
    if (!fn || (this.eng.mute && this.eng.mute.has(it.e.inst))) return; // eng.mute: test-only solo/mute hook
    const args = it.catchUp ? { ...it.e.args, attack: Math.min(it.e.args.attack ?? 0.3, 0.35) } : it.e.args;
    const v = this.eng.voice(this.out, t, { pool: 'music', tag: it.e.inst, pan: args.pan || 0 });
    try { fn(v, t, { ...args, dur: it.dur || args.dur || 0 }); } catch (err) { console.warn('[audio] music event failed:', it.e.inst, err); }
    v.commit();
  }
  stop(t, fade, now) {
    if (this.disposed || t + fade >= this.stopAt) return;
    this.fader.to(0, t, fade, now);
    this.stopAt = t + fade;
    this.eng.at(this.stopAt + 0.03, () => this.dispose());
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.eng.ctx.currentTime;
    for (const v of [...this.voices]) v.kill(now, 0.03);
    this.eng.at(now + 0.15, () => { try { this.dry.disconnect(); this.wet.disconnect(); } catch { /* ok */ } });
    this.dir._remove(this);
  }
}

/** Streams assets/audio/<state>.mp3 through a MediaElementAudioSourceNode. */
class FilePlayer {
  constructor(dir, state, url, { start, fade }) {
    const eng = dir.eng, ctx = eng.ctx;
    this.kind = 'file'; this.dir = dir; this.eng = eng; this.state = state; this.url = url;
    this.disposed = false; this.stopAt = Infinity;
    const el = new Audio();
    el.crossOrigin = 'anonymous'; el.preload = 'auto'; el.loop = LOOPING.has(state); el.src = url;
    this.el = el;
    this.src = ctx.createMediaElementSource(el);
    this.gain = ctx.createGain();
    this.src.connect(this.gain); this.gain.connect(eng.music.dry);
    this.fader = new Fader([this.gain.gain], 0);
    this.fader.to(FILE_GAIN, start, fade, ctx.currentTime);
    el.addEventListener('error', () => dir._fileFailed(this), { once: true });
    el.addEventListener('ended', () => { if (!el.loop) this.dispose(); }, { once: true });
    const p = el.play();
    if (p && p.catch) p.catch((err) => { if (!this.disposed) { console.warn('[audio] music file failed:', url, err && err.message); dir._fileFailed(this); } });
  }
  pump() {}
  stop(t, fade, now) {
    if (this.disposed || t + fade >= this.stopAt) return;
    this.fader.to(0, t, fade, now);
    this.stopAt = t + fade;
    this.eng.at(this.stopAt + 0.05, () => this.dispose());
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.el.pause(); } catch { /* ok */ }
    try { this.src.disconnect(); this.gain.disconnect(); } catch { /* ok */ }
    this.el.removeAttribute('src');
    try { this.el.load(); } catch { /* ok */ }
    this.dir._remove(this);
  }
}

// ================================================================ director
export class MusicDirector {
  constructor(eng, { files = false, urlFor = null } = {}) {
    this.eng = eng;
    this.state = 'off';
    this.current = null;
    this.players = new Set();
    this.files = {};
    this.urlFor = urlFor;
    this.pending = null;
    this.checking = files && urlFor ? this._checkFiles() : null;
  }

  async _checkFiles() {
    const probe = async (s) => {
      try {
        const url = this.urlFor(s);
        const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (r.ok && r.status !== 204) this.files[s] = url;   // 204: our dev server's "no such override"
      } catch { /* no file: use the synth */ }
    };
    const all = Promise.all(MUSIC_STATES.filter((s) => s !== 'off').map(probe));
    await Promise.race([all, new Promise((r) => setTimeout(r, 1500))]);
    this.checking = null;
    if (this.pending) { const { state, fade } = this.pending; this.pending = null; this.set(state, fade); }
  }

  set(state, fade = 2) {
    if (!MUSIC_STATES.includes(state)) { console.warn(`[audio] unknown music state "${state}"`); return; }
    if (this.checking) { this.pending = { state, fade }; return; }
    if (state === this.state) return;
    const now = this.eng.ctx.currentTime;
    fade = Math.max(0, Number.isFinite(+fade) ? +fade : 2);
    const old = this.current;
    let start = now + 0.03, bar = 0, offset = 0, outAt = now;
    const useFile = !!this.files[state];
    // phase1 <-> phase2: stay on the same bar/beat grid so the harmony continues seamlessly
    if (old && old.kind === 'synth' && old.grid && SCORES[state] && sameGrid(old.grid, SCORES[state].grid) && !useFile) {
      const pos = old.nextBeat(now + 0.05);
      start = pos.time; bar = pos.bar; offset = pos.offset; outAt = start;
    }
    // defeat "cuts" the music; everything else crossfades over `fade`
    const outFade = CUTS.has(state) ? Math.min(fade, 0.3) : fade;
    if (old) old.stop(outAt, Math.max(0.03, outFade), now);
    for (const p of this.players) if (p !== old && p.stopAt === Infinity) p.stop(now, 0.3, now);
    this.current = null;
    if (state !== 'off') {
      const inFade = CUTS.has(state) ? 0.05 : Math.max(0.03, fade);
      const p = useFile
        ? new FilePlayer(this, state, this.files[state], { start, fade: inFade })
        : new SynthPlayer(this, state, SCORES[state], { start, fade: inFade, bar, offset });
      this.players.add(p);
      this.current = p;
    }
    this.state = state;
    this.pump();
  }

  _fileFailed(p) {
    delete this.files[p.state];
    if (p.disposed || this.current !== p) { p.dispose(); return; }
    const now = this.eng.ctx.currentTime;
    p.dispose();
    const s = new SynthPlayer(this, p.state, SCORES[p.state], { start: now + 0.03, fade: 0.5 });
    this.players.add(s);
    this.current = s;
  }

  _remove(p) {
    this.players.delete(p);
    if (this.current === p) this.current = null;
  }

  pump() {
    const now = this.eng.ctx.currentTime;
    // background tabs throttle timers to ~1 Hz: schedule further ahead so the music keeps going
    const ahead = typeof document !== 'undefined' && document.hidden ? 1.4 : LOOKAHEAD;
    for (const p of [...this.players]) p.pump(now, now + ahead);
  }

  dispose() { for (const p of [...this.players]) p.dispose(); }
}
