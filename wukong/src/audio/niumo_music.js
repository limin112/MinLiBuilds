// Scores for the Flame Mountain (niumo) scene. Same format as music.js: score.bar(i) ->
// { len, events: [{ at, inst, args, dur, sustain }] } (null ends a one-shot).
//
// Language: the opening and the ambience are decayed myth (low throat chant, war drums, sinking opera gongs, a far
// temple bell, a suona's cry). The fight is the other tradition of this story: the 1980s television-fantasy sound, a
// drum machine and a synth bass sequence, an analog synth lead with glides and tape echo, sequencer arpeggios and
// electronic sweeps (2026-11-16 user: 「用云宫迅音的电子音」 - the sound of that score, not its tune), with pipa, a woman's
// voice and the suona (our own tune, yu mode on A).
// The ending moves to D (D F G A C) with rain and a guqin.

export const NIUMO_BPM = 68;
const BEAT = 60 / NIUMO_BPM, BAR = 4 * BEAT;
const FORM = 24;

const ev = (at, inst, args, dur = 0, sustain = false) => ({ at, inst, args, dur, sustain });
const B = (beats) => beats * BEAT;

/** Small deterministic PRNG per bar index (scores must not depend on the engine's PRNG order). */
function barRng(i, salt = 0) {
  let a = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Timeline of the opening cinematic (seconds from setMusic('niumo_opening')), for src/niumo/mv.js. Every cut of the
 * prologue lands on a drum or gong (`hits`); `title` is the big hit (the title card); `eyes` the gong as his eyes
 * open; from `parley` the score is a quiet bed under the spoken lines (their length is not fixed: the cinematic runs
 * on its own clock from there and closes with the roar and the first bar of 'niumo_phase1').
 */
export const NIUMO_CUES = {
  bpm: NIUMO_BPM, beat: BEAT, bar: BAR,
  opening: {
    black: 0, ash: 2.6, caldera: 5.4, breath: 9.0, knee: 12.0, suona: 12.5, title: 17.4, eyes: 21.8, parley: 23.0, end: 55.4,
    hits: [5.4, 7.2, 9.0, 12.0, 13.9, 15.2, 16.15, 16.85, 17.4, 20.0, 21.8],
  },
};

// ================================================================ the fight (niumo_phase1 / niumo_phase2)
// In the manner of the 1980s television fantasy scores (electronic rhythm section under Chinese melody instruments);
// every note here is our own. 136 BPM written as double time over the 68 BPM grid: one grid bar = two fast bars, so
// phase 1 <-> phase 2 still switch seamlessly on the beat. 24 grid bars = 48 fast bars = 84.7 s:
//   intro (fast bars 0-7)   the syndrum riff, the bass sequence joining
//   A     (8-23)            the theme, 16 bars: phase 1 on the pipa, phase 2 on the synth brass
//   B     (24-31)           the pipa runs in sixteenths
//   C     (32-39)           half time: a woman's wordless voice over the sequence
//   D     (40-47)           the second half of the theme with everything (brass in octaves, suona, choir)
// A yu-mode pentatonic on A (A C D E G).
const Q = BEAT / 2;                    // a quarter note at 136
const CHORD = {
  Am: { root: 45, ch: [57, 60, 64] }, C: { root: 48, ch: [60, 64, 67] }, G: { root: 43, ch: [55, 59, 62] },
  F: { root: 41, ch: [53, 57, 60] }, Em: { root: 40, ch: [52, 55, 59] }, E: { root: 40, ch: [52, 56, 59] },
};
const FPROG = [
  'Am', 'Am', 'Am', 'Am', 'Am', 'Am', 'Am', 'Am',
  'Am', 'Am', 'C', 'G', 'Am', 'F', 'G', 'Am', 'F', 'G', 'Em', 'Am', 'F', 'G', 'Am', 'Am',
  'Am', 'Am', 'F', 'F', 'G', 'G', 'Am', 'E',
  'F', 'F', 'G', 'G', 'C', 'C', 'Am', 'Am',
  'F', 'G', 'Em', 'Am', 'F', 'G', 'Am', 'Am',
];
// the theme: 16 fast bars of [midi | null, quarters]
const TUNE = [
  [[76, 1.5], [74, 0.5], [76, 1], [79, 1]], [[81, 2], [76, 1], [79, 0.5], [76, 0.5]],
  [[74, 1.5], [72, 0.5], [74, 1], [76, 1]], [[74, 3], [null, 1]],
  [[76, 1.5], [74, 0.5], [76, 1], [79, 1]], [[81, 2], [84, 1], [81, 1]],
  [[79, 1], [76, 0.5], [74, 0.5], [76, 1], [79, 1]], [[81, 3], [null, 1]],
  [[84, 1.5], [81, 0.5], [84, 1], [86, 1]], [[88, 2], [86, 1], [84, 1]],
  [[86, 1], [84, 0.5], [81, 0.5], [79, 1], [76, 1]], [[81, 2], [79, 1], [76, 1]],
  [[81, 1], [84, 1], [81, 0.5], [79, 0.5], [76, 1]], [[79, 1.5], [81, 0.5], [79, 1], [74, 1]],
  [[76, 0.5], [79, 0.5], [81, 1], [76, 0.5], [79, 0.5], [81, 1]], [[81, 4]],
];
// the voice in C: 8 fast bars of [midi, quarters, vowel]
const SONG = [
  [[69, 3, 'a'], [72, 1, 'a']], [[74, 2, 'a'], [72, 1, 'o'], [69, 1, 'a']],
  [[67, 3, 'a'], [69, 1, 'a']], [[74, 4, 'a']],
  [[76, 3, 'a'], [74, 1, 'a']], [[72, 2, 'o'], [74, 1, 'a'], [76, 1, 'a']],
  [[79, 2, 'a'], [76, 2, 'a']], [[81, 4, 'a']],
];
const PENT = [];                        // the scale across the keyboard
for (let o = 3; o <= 8; o++) for (const d of [9, 12, 14, 16, 19]) PENT.push(12 * o + d);
const RUN = [0, -1, -2, -1, -2, -3, -4, -3, -4, -5, -6, -5, -4, -3, -2, -1];
const RUN_TOP = [81, 84, 81, 84, 79, 86, 81, 88];   // the top note of each bar of B
const RIFF = [
  [[0, 69], [0.75, 69], [1.5, 64], [2, 69], [2.75, 72], [3.5, 64]],
  [[0, 69], [0.75, 69], [1.5, 72], [2, 76], [2.5, 72], [3, 69], [3.5, 64]],
];
const FILL = [[2, 76], [2.25, 76], [2.5, 72], [2.75, 72], [3, 69], [3.25, 69], [3.5, 64], [3.75, 64]];

function battleBar(i, I) {
  const n = i % FORM, p2 = I >= 2;
  const E = [];
  for (let k = 0; k < 2; k++) {
    const fb = 2 * n + k, off = k * 4 * Q, c = CHORD[FPROG[fb]];
    const sec = fb < 8 ? 'I' : fb < 24 ? 'A' : fb < 32 ? 'B' : fb < 40 ? 'C' : 'D';
    const lastOf = fb === 7 || fb === 23 || fb === 31 || fb === 39 || fb === 47;
    // ---- drums
    const kick = [], snare = [], hat = [], tom = [];
    const K = (b, g = 1) => kick.push([b * Q, g]), S = (b, g = 1) => snare.push([b * Q, g]), H = (b, g = 1, o = 0) => hat.push([b * Q, g, o]);
    const T = (list, g = 1) => { for (const [b, m] of list) tom.push([b * Q, m, g]); };
    if (sec === 'I') {
      T(RIFF[fb % 2], p2 ? 1 : 0.9);
      for (let e = 0; e < 8; e++) H(e / 2, e % 2 ? 0.8 : 0.5);
      if (fb >= 4) { K(0); K(2, 0.8); if (p2) { S(1, 0.7); S(3, 0.8); } }
    } else if (sec === 'C') {
      K(0); S(2, 0.9); if (p2) K(3.5, 0.6);
      for (let e = 0; e < (p2 ? 8 : 4); e++) H(p2 ? e / 2 : e, 0.6);
    } else {
      K(0); K(2, 0.9); S(1, p2 ? 1 : 0.6); S(3, p2 ? 1 : 0.7);
      if (p2) { K(1.5, 0.7); for (let e = 0; e < 16; e++) H(e / 4, e % 4 === 2 ? 0.9 : e % 2 ? 0.35 : 0.6, e === 14 ? 1 : 0); }
      else for (let e = 0; e < 4; e++) H(e + 0.5, 0.8);
      if (sec === 'B' && p2) T(RIFF[fb % 2], 0.55);
    }
    if (lastOf) { T(FILL, 0.9); S(3.5, 0.8); S(3.75, 0.9); }
    // (one event per quarter, so that a switch in the middle of a bar picks the drums up on the next beat)
    for (let qi = 0; qi < 4; qi++) {
      const cut = (list) => list.filter((h) => Math.floor(h[0] / Q + 1e-6) === qi).map((h) => [h[0] - qi * Q, ...h.slice(1)]);
      const part = { kick: cut(kick), snare: cut(snare), hat: cut(hat), tom: cut(tom) };
      if (part.kick.length + part.snare.length + part.hat.length + part.tom.length) E.push(ev(off + qi * Q, 'kit', { ...part, gain: p2 ? 0.825 : 0.693, send: 0.14 }));
    }
    // ---- the bass sequence
    if (fb >= 4 || p2) {
      const r = c.root, e8 = Q / 2;
      const notes = sec === 'C'
        ? [[r, Q, 1], [r + 7, Q, 0.8], [r + 12, Q, 0.9], [r + 7, Q, 0.8]]
        : [[r, e8, 1.1], [r + 12, e8, 0.8], [r, e8, 0.9], [r + 12, e8, 0.8], [r, e8, 1], [r + 12, e8, 0.8], [r + 7, e8, 0.9], [r + 12, e8, 0.8]];
      const per = notes.length / 4;
      for (let qi = 0; qi < 4; qi++) E.push(ev(off + qi * Q, 'sbass', { notes: notes.slice(qi * per, (qi + 1) * per), gain: sec === 'C' ? 0.124 : 0.148, cutoff: p2 ? 1700 : 1300 }));
    }
    // ---- harmony: low strings under everything but the intro; the choir opens up in D
    if (sec !== 'I') E.push(ev(off, 'strings', { notes: [c.ch[0] - 12, c.ch[2] - 12], gain: p2 ? 0.049 : 0.04, bright: 0.8, attack: 0.05, release: 0.2, send: 0.35 }, 4 * Q - 0.05));
    if (sec === 'D' || (p2 && sec === 'A' && fb >= 16)) {
      E.push(ev(off, 'choir', { notes: c.ch, vowel: 'a', voices: 2, spread: 12, vib: 14, attack: 0.25, release: 0.5, gain: p2 ? 0.043 : 0.03, send: 0.55, breath: 0.04 }, 4 * Q, true));
    }
    // ---- melody
    const secs = (bar, shift = 0) => bar.map(([m, d, x]) => [m == null ? null : m + shift, d * Q, x]);
    if (sec === 'A' || sec === 'D') {
      const bar = TUNE[sec === 'A' ? fb - 8 : fb - 32];
      // the theme on the analog synth lead: gliding between the notes, scooping into the long ones, tape echo
      const lead = secs(bar).map(([m, d], j, a) => [m, d, 1, { scoop: m != null && d >= 2 * Q - 1e-6 ? 2 : 0, glide: j && a[j - 1][0] != null && Math.abs(m - a[j - 1][0]) > 4 ? 0.07 : 0.04 }]);
      E.push(ev(off, 'slead', { notes: lead, gain: p2 ? 0.092 : 0.066, bright: p2 ? 1.05 : 0.8, vib: p2 ? 30 : 24, echoTime: 1.5 * Q, echoMix: p2 ? 0.34 : 0.28, send: 0.32, pan: -0.06 }));
      if (p2 && sec === 'D') E.push(ev(off, 'brass', { notes: secs(bar, -12).map(([m, d]) => [m, d, 1]), gain: 0.04, bright: 0.8, send: 0.32, pan: -0.12 }));
      if (!p2) E.push(ev(off, 'pluck', { notes: secs(bar, -12).map(([m, d]) => [m, d, 1, d >= 2 * Q - 1e-6 ? Q / 4 : 0]), gain: 0.085, send: 0.25, pan: 0.14 }));
      if (p2 && sec === 'D') E.push(ev(off, 'suona', { notes: secs(bar).map(([m, d]) => [m, d, d > 1.5 * Q ? { vib: 1.1 } : {}]), gain: 0.036, send: 0.4, pan: 0.16, vib: 30 }));
      if (p2 && sec === 'A') {       // the pipa answers in the gaps: the chord, broken, on the off-beats
        E.push(ev(off, 'pluck', { notes: [[null, Q / 2], [c.ch[2] + 12, Q / 2, 0.8], [null, Q], [null, Q / 2], [c.ch[1] + 12, Q / 2, 0.7], [c.ch[2] + 12, Q / 2, 0.8], [null, Q / 2]], gain: 0.074, send: 0.25, pan: 0.2 }));
      }
    } else if (sec === 'B') {
      const top = PENT.indexOf(RUN_TOP[fb - 24]);
      E.push(ev(off, 'pluck', { notes: RUN.map((d, j) => [PENT[top + d], Q / 4, j % 4 === 0 ? 1.15 : 0.85]), gain: p2 ? 0.124 : 0.116, send: 0.22, pan: 0.12 }));
      if (p2) E.push(ev(off, 'brass', { notes: [[c.ch[2] + 12, Q * 0.5, 1.1], [null, Q * 2], [c.ch[2] + 12, Q * 0.5, 1], [null, Q]], gain: 0.059, send: 0.3, pan: -0.1 }));
    } else if (sec === 'C') {
      E.push(ev(off, 'phrase', { notes: secs(SONG[fb - 32]), sex: 'female', voices: 2, spread: 9, vib: 26, gain: p2 ? 0.083 : 0.069, send: 0.7, glide: 0.07, breath: 0.04, attack: 0.14, release: 0.5, dip: 0.12, pan: 0.05 }));
      const a = c.ch.map((m) => m + 12);
      E.push(ev(off, 'pluck', { notes: [a[0], a[1], a[2], a[1], a[0], a[1], a[2], a[1]].map((m, j) => [m, Q / 2, j % 4 === 0 ? 0.9 : 0.65]), gain: 0.066, send: 0.3, pan: -0.15 }));
    }
    // ---- the sequencer arpeggio (intro, under the theme in phase 2, over the voice): chord tones in sixteenths, echoed
    const arpOn = (sec === 'I' && (fb >= 2 || p2)) || (p2 && sec === 'A') || sec === 'C';
    if (arpOn) {
      const up = sec === 'C' ? 12 : 0, a = [c.ch[0] + up, c.ch[1] + up, c.ch[2] + up, c.ch[0] + 12 + up];
      const order = [0, 1, 2, 3, 2, 1, 2, 3], g = sec === 'I' ? (p2 ? 0.05 : 0.042) : sec === 'C' ? 0.026 : 0.03;
      for (let qi = 0; qi < 4; qi++) {
        const ns = [0, 1, 2, 3].map((j) => [a[order[(qi * 4 + j) % 8]], Q / 4, j === 0 ? 1 : 0.7]);
        E.push(ev(off + qi * Q, 'arp', { notes: ns, gain: g, bright: sec === 'C' ? 0.7 : 1, echoTime: 1.5 * Q, send: 0.25, pan: qi % 2 ? 0.25 : -0.25 }));
      }
    }
    // ---- electronic sweeps: a rising whoosh into each new section, a zap as the theme comes in
    if (fb === 7 || fb === 23 || fb === 31 || fb === 39) E.push(ev(off + 2 * Q, 'zap', { kind: 'rise', from: 45, to: 93, dur: 2 * Q - 0.02, gain: p2 ? 0.05 : 0.038, send: 0.4 }));
    if ((fb === 8 || fb === 40) && k === 0) E.push(ev(off, 'zap', { kind: 'laser', from: 96, to: 52, dur: 0.5, gain: p2 ? 0.045 : 0.034, send: 0.45, pan: 0.2 }));
    if (p2 && sec === 'B' && fb % 4 === 0) E.push(ev(off, 'zap', { kind: 'laser', from: 93, to: 57, dur: 0.35, gain: 0.03, send: 0.45, pan: -0.2 }));
    // ---- the Chinese percussion marks the sections
    if (k === 0) {
      if (fb === 8 || fb === 40) { E.push(ev(0, 'gong', { kind: 'daluo', gain: p2 ? 0.34 : 0.26, rate: 0.95, send: 0.5, pan: 0.08 })); E.push(ev(0, 'cymbal', { kind: 'crash', gain: p2 ? 0.26 : 0.18, send: 0.4, pan: 0.18 })); }
      if (fb === 24 || fb === 32) E.push(ev(0, 'cymbal', { kind: 'crash', gain: 0.18, send: 0.4, pan: -0.15 }));
      if (p2 && (sec === 'D' || fb === 8 || fb === 16 || fb === 24)) E.push(ev(0, 'wardrum', { kind: 'big', gain: 0.5, send: 0.3, rate: 1, len: 1.2, pan: -0.12 }));
    }
  }
  return { len: BAR, events: E };
}

// ================================================================ opening (the merged opening cinematic, one-shot)
// One continuous piece from the click to the fight (src/niumo/mv.js):
// 0 black: wind and a burning plain | 2.6 ash | 5.4 the caldera: the big gong sinks, the monks gather | 9 the mountain
// breathes | 12 the walk in under his knee: the suona's lonely cry over a quickening heartbeat, the swell | 17.4 THE
// TITLE: drums, tam-tam, cymbal, choir (the loudest moment) | 21.8 the eyes open: bell, sinking gong, drum | 23 the parley: a held breath of a bed (a low chant, lava, wind, a far drum now and
// then) under the spoken lines, fading out by ~48 s. The roar and the first bar of 'niumo_phase1' close it in the game.
function openingBar(i) {
  if (i > 0) return null;
  const C = NIUMO_CUES.opening, E = [];
  const drum = (at, kind, g, x = {}) => E.push(ev(at, 'wardrum', { kind, gain: g, send: x.send ?? 0.5, rate: x.rate ?? 1, pan: x.pan ?? -0.05, len: x.len ?? 0 }));
  const T = C.title;
  // 1 black -> ash: the wind carries the whole piece (and dies under the parley)
  E.push(ev(0, 'wind', {
    gain: 0.21, gust: 0.75, send: 0.25,
    levels: [[0, 0], [1.2, 0.75], [3.6, 1], [5.4, 0.45], [11.4, 0.32], [16, 0.4], [16.8, 0.1], [17.6, 0], [19, 0.3], [22.4, 0.42],
      [33.4, 0.36], [41.4, 0.26], [46.4, 0.1], [49.4, 0.03], [53.4, 0]],
  }, 53.4));
  E.push(ev(0.2, 'fire', { gain: 0.085, crackle: 0.65, lp: 3800, send: 0.35, levels: [[0, 0], [1.8, 1], [4.4, 0.6], [5.8, 0]] }, 5.8));
  E.push(ev(2.2, 'lava', { gain: 0.06, activity: 0.25, send: 0.35, levels: [[0, 0], [2, 0.7], [4, 1], [6.4, 1.1], [9, 0]] }, 9));
  E.push(ev(C.caldera + 0.02, 'tbell', { midi: 33, gain: 0.15, lp: 1500, send: 0.95, pan: -0.2 }));
  // 3 the caldera: the gong falls, the far drum, the monks gather
  E.push(ev(C.caldera, 'gong', { kind: 'daluo', gain: 0.22, rate: 0.8, send: 0.7 }));
  drum(C.caldera, 'big', 0.42, { send: 0.65 });
  drum(C.caldera + 1.8, 'big', 0.22, { send: 0.75, rate: 0.97 });
  E.push(ev(C.caldera + 0.3, 'monk', {
    midi: 33, voices: 4, gain: 0.016, growl: 0.4, send: 0.55, attack: 2.6, release: 0.6,
    vowels: [[0, 'u'], [2.5, 'o'], [5, 'a'], [8, 'o']], overtones: [[0, 8], [2, 9], [3.6, 8], [5.4, 10], [7, 8], [8.6, 7]],
  }, 10.0));
  E.push(ev(C.caldera + 1.5, 'choir', { notes: [45, 52], vowel: 'u', voices: 2, gain: 0.018, attack: 3, release: 0.6, send: 0.7, breath: 0.05, vib: 8 }, 5.6));
  // 4 the mountain breathes: in, a held beat, out
  drum(C.breath, 'big', 0.45, { send: 0.55 });
  E.push(ev(C.breath + 0.2, 'breath', { inhale: 1.4, hold: 0.25, exhale: 1.6, gain: 0.11, send: 0.5 }));
  E.push(ev(C.breath - 0.4, 'lava', { gain: 0.08, activity: 0.7, send: 0.35, levels: [[0, 0], [0.8, 0.8], [3.4, 1], [6, 0.7], [8.4, 0.5], [9, 0]] }, 9));
  // 5 the walk in under his knee: a drum, a choked cymbal; the suona's cry over a quickening heartbeat
  drum(C.knee, 'big', 0.6);
  E.push(ev(C.knee, 'cymbal', { kind: 'choke', gain: 0.12, send: 0.5, pan: 0.2 }));
  for (const [at, g] of [[13.9, 0.22], [15.2, 0.27], [16.15, 0.32], [16.85, 0.36]]) drum(at, 'big', g, { send: 0.6 });
  E.push(ev(C.knee + 0.5, 'suona', {
    notes: [[76, 0.7, { scoop: 3 }], [81, 1.5, { scoop: 2, vib: 1.1 }], [79, 0.35], [81, 0.35], [84, 1.1, { vib: 1.25, sob: 0.5 }], [81, 1.2, { fall: 5, vib: 1 }]],
    gain: 0.06, send: 0.6, pan: 0.1, vib: 34,
  }));
  // the swell into the title
  E.push(ev(T - 7.5, 'gong', { kind: 'tamtamRev', gain: 0.3, send: 0.5 }));
  E.push(ev(T - 3.2, 'cymbal', { kind: 'crashRev', gain: 0.28, send: 0.45, pan: -0.15 }));
  E.push(ev(T - 5.0, 'droll', { kind: 'mid', dur: 4.85, hz0: 5, hz1: 17, g0: 0.02, g1: 0.25, send: 0.35 }));
  E.push(ev(T - 5.6, 'monk', {
    midi: 33, voices: 5, gain: 0.028, growl: 0.6, send: 0.5, envelope: 'swell', attack: 5.4, release: 0.12,
    vowels: [[0, 'u'], [2.4, 'o'], [4.4, 'a']], overtones: [[0, 6], [2, 8], [3.6, 10], [4.9, 12]],
  }, 5.45));
  E.push(ev(T - 4.6, 'choir', { notes: [45, 52, 57], vowel: 'o', vowelTo: 'a', morph: 4, voices: 3, gain: 0.046, envelope: 'swell', attack: 4.45, release: 0.12, send: 0.6, breath: 0.06, vib: 12 }, 4.45));
  // 6 the title
  drum(T, 'big', 0.95, { rate: 0.9, send: 0.45, pan: -0.15 });
  drum(T + 0.004, 'big', 0.75, { rate: 0.8, send: 0.45, pan: 0.18 });
  drum(T, 'edge', 0.45, { send: 0.4 });
  drum(T + 0.01, 'mid', 0.4, { send: 0.4, pan: 0.25 });
  E.push(ev(T, 'gong', { kind: 'tamtam', gain: 0.52, send: 0.6 }));
  E.push(ev(T, 'gong', { kind: 'daluo', gain: 0.36, rate: 0.75, send: 0.6, pan: -0.15 }));
  E.push(ev(T, 'cymbal', { kind: 'crash', gain: 0.42, send: 0.5, pan: 0.2 }));
  E.push(ev(T, 'boom', { f0: 62, f1: 26, glide: 0.5, tau: 0.75, gain: 0.5, send: 0.25 }));
  E.push(ev(T + 0.02, 'tbell', { midi: 33, gain: 0.26, send: 0.8 }));
  E.push(ev(T, 'choir', { notes: [45, 52, 57, 64, 69], vowel: 'a', voices: 3, gain: 0.06, attack: 0.05, release: 2.4, send: 0.75, vib: 14, breath: 0.06 }, 1.6));
  E.push(ev(T, 'lava', { gain: 0.1, activity: 0.5, send: 0.35, levels: [[0, 0.9], [3, 0.5], [4.4, 0.3]] }, 4.4));
  drum(T + 2.6, 'big', 0.26, { send: 0.75 });
  // 7 the eyes open: the bell, the sinking gong, one drum (well under the title)
  E.push(ev(C.eyes, 'tbell', { midi: 28, gain: 0.2, send: 0.85 }));
  E.push(ev(C.eyes, 'gong', { kind: 'daluo', gain: 0.2, rate: 0.66, send: 0.7 }));
  drum(C.eyes, 'big', 0.4, { rate: 0.9, send: 0.55 });
  E.push(ev(C.eyes, 'boom', { f0: 50, f1: 30, glide: 0.6, tau: 0.6, gain: 0.12, send: 0.3 }));
  // 8 the parley: a bed for the spoken lines (low, dark, no melody), fading out toward the end
  const P = C.parley;
  E.push(ev(P - 0.6, 'monk', {
    midi: 33, voices: 3, gain: 0.013, growl: 0.35, send: 0.65, attack: 3.5, release: 3.2,
    vowels: [[0, 'u'], [7, 'o'], [14, 'u'], [19, 'o']], overtones: [[0, 6], [5, 7], [9, 6], [13, 8], [18, 6]],
  }, 24));
  E.push(ev(P + 3, 'choir', { notes: [45, 52], vowel: 'u', voices: 2, gain: 0.009, attack: 5, release: 4, send: 0.75, breath: 0.04, vib: 7 }, 18));
  E.push(ev(P - 1, 'lava', { gain: 0.07, activity: 0.45, send: 0.35, levels: [[0, 0], [3, 0.8], [14, 0.9], [21, 0.55], [25, 0.15], [27, 0]] }, 27));
  // the mountain's heartbeat, far off, now and then
  for (const [at, g] of [[P + 6.2, 0.16], [P + 13.4, 0.15], [P + 19.6, 0.1]]) drum(at, 'big', g, { send: 0.85, rate: 0.94 });
  E.push(ev(P + 9.6, 'tbell', { midi: 28, gain: 0.06, lp: 1100, send: 1.0, pan: 0.3 }));
  return { len: C.end, events: E };
}

// ================================================================ ambient (title, approach, waiting)
// wind and lava, a far monk on alternate cycles, one temple bell, a few scattered far drums
function ambientBar(i) {
  const r = barRng(i, 3), L = 26, E = [];
  E.push(ev(0, 'wind', { gain: 0.045, gust: 0.55, fadeIn: 2, fadeOut: 2, send: 0.25 }, L + 2, true));
  E.push(ev(0, 'lava', { gain: 0.028, activity: 0.3, fadeIn: 2, fadeOut: 2, send: 0.35 }, L + 2, true));
  if (i % 2 === 1) E.push(ev(r() * 6, 'fire', { gain: 0.03, crackle: 0.5, lp: 2600, fadeIn: 3, fadeOut: 3, send: 0.4 }, 12));
  if (i % 2 === 0) {
    E.push(ev(2.5 + r() * 3, 'monk', {
      midi: 33, voices: 2, gain: 0.02, growl: 0.2, send: 0.8, attack: 3, release: 3,
      vowels: [[0, 'u'], [5, 'o'], [9, 'u']], overtones: [[0, 8], [4, 7], [7, 6], [9.5, 8]],
    }, 12));
  }
  E.push(ev(7 + r() * 11, 'tbell', { midi: r() < 0.5 ? 33 : 28, gain: 0.065, lp: 1200, send: 1.0, pan: r() * 0.8 - 0.4 }));
  const hits = 1 + Math.floor(r() * 3);
  for (let k = 0; k < hits; k++) E.push(ev(1 + r() * (L - 3), 'wardrum', { kind: 'big', gain: 0.045 + r() * 0.045, rate: 0.94 + r() * 0.06, send: 0.85, pan: r() * 1.2 - 0.6 }));
  return { len: L, events: E };
}

// ================================================================ ending (rain and a guqin)
// D yu mode (D F G A C). Each 48 s cycle: the rain bed (equal-power overlap), a guqin phrase set, a far bell.
// [seconds, midi, args]   h: harmonic (泛音)   s: slides [[after, semitones, glide]]   v: vibrato (cents)
const QIN = [
  [ // cycle 0: the rain settles, then the open strings, harmonics, a melody with slides, the low D again
    [6.0, 38, { dur: 6, gain: 0.26 }], [8.6, 45, { dur: 5, gain: 0.19 }],
    [10.8, 62, { h: 1, gain: 0.13 }], [11.6, 57, { h: 1, gain: 0.11 }],
    [13.2, 48, { dur: 3, gain: 0.2, s: [[0.35, 2, 0.28]], v: 12 }],
    [16.0, 48, { dur: 3, gain: 0.18, s: [[0.45, -3, 0.5]] }],
    [19.0, 53, { dur: 2, gain: 0.17 }], [20.6, 55, { dur: 1.4, gain: 0.16 }], [21.6, 57, { dur: 3, gain: 0.18, v: 22 }],
    [24.5, 60, { dur: 2.6, gain: 0.17, s: [[0.6, -3, 0.6]] }], [27.0, 55, { dur: 2, gain: 0.15 }], [28.8, 50, { dur: 6, gain: 0.2, v: 14 }],
    [33.5, 62, { h: 1, gain: 0.11 }], [34.3, 69, { h: 1, gain: 0.1 }], [35.0, 74, { h: 1, gain: 0.09 }], [35.9, 72, { h: 1, gain: 0.09 }],
    [36.6, 69, { h: 1, gain: 0.1 }], [37.6, 67, { h: 1, gain: 0.1 }], [38.8, 69, { h: 1, gain: 0.11 }],
    [41.0, 38, { dur: 6, gain: 0.24 }], [41.03, 45, { dur: 6, gain: 0.17 }],
  ],
  [ // cycle 1: the middle register, rising slides, then the low strings
    [4.0, 45, { dur: 3, gain: 0.18 }], [6.0, 50, { dur: 2.4, gain: 0.18, s: [[0.5, 3, 0.4]] }],
    [8.5, 55, { dur: 2, gain: 0.16 }], [10.0, 57, { dur: 3, gain: 0.17, v: 20 }],
    [12.5, 55, { dur: 2.5, gain: 0.15, s: [[0.5, -2, 0.45]] }], [15.0, 50, { dur: 5, gain: 0.19, v: 12 }],
    [20.0, 57, { h: 1, gain: 0.11 }], [20.9, 62, { h: 1, gain: 0.1 }], [21.7, 67, { h: 1, gain: 0.1 }], [22.6, 69, { h: 1, gain: 0.11 }],
    [26.0, 48, { dur: 3, gain: 0.19, s: [[0.4, 2, 0.3]], v: 14 }], [30.0, 41, { dur: 3, gain: 0.17 }], [31.2, 45, { dur: 3, gain: 0.16 }],
    [34.0, 38, { dur: 7, gain: 0.25 }],
  ],
  [ // cycle 2: almost nothing; harmonics like drops in the rain, one low D
    [8.0, 74, { h: 1, gain: 0.09 }], [9.1, 69, { h: 1, gain: 0.09 }], [10.6, 62, { h: 1, gain: 0.1 }],
    [21.0, 50, { dur: 4, gain: 0.16, v: 10 }], [24.0, 45, { dur: 4, gain: 0.15, s: [[0.5, -2, 0.6]] }],
    [36.0, 38, { dur: 7, gain: 0.22 }], [36.03, 50, { dur: 6, gain: 0.12 }],
  ],
];
export const NIUMO_GUQIN_NOTES = [...new Set(QIN.flat().filter(([, , a]) => !a.h).map(([, m]) => m))];

function endingBar(i) {
  const L = 48, E = [], first = i === 0;
  E.push(ev(0, 'rain', { gain: 0.3, fadeIn: first ? 5 : 3, fadeOut: 3, close: 0.6, low: 0.5, sizzle: first ? 1 : 0, sizzleFade: 22, send: 0.25 }, L + 3, true));
  if (first) E.push(ev(0, 'lava', { gain: 0.07, activity: 0.2, send: 0.35, levels: [[0, 0.7], [2, 1], [8, 0.5], [20, 0]] }, 20));
  for (const [at, midi, a] of QIN[i % QIN.length]) {
    E.push(ev(at, 'guqin', {
      midi, harmonic: !!a.h, dur: a.dur ?? 3, gain: a.gain, slides: a.s || null, vib: a.v || 0, send: 0.55,
      pan: (midi - 52) * 0.012, tau: a.h ? 1.4 : 1.3,
    }));
  }
  if (i % 2 === 0) E.push(ev(31.5, 'tbell', { midi: 38, gain: 0.09, lp: 1000, send: 1.0, pan: -0.35 }));
  return { len: L, events: E };
}

// ================================================================ defeat (one-shot)
function defeatBar(i) {
  if (i > 0) return null;
  return {
    len: 11,
    events: [
      ev(1.10, 'gong', { kind: 'daluo', gain: 0.4, rate: 0.72, send: 0.6, len: 6.2 }),
      ev(1.10, 'wardrum', { kind: 'big', gain: 0.5, rate: 0.88, send: 0.45 }),
      ev(1.10, 'boom', { f0: 50, f1: 26, glide: 0.8, tau: 0.6, gain: 0.3, send: 0.2 }),
      ev(1.35, 'monk', {
        midi: 33, voices: 3, gain: 0.05, growl: 0.35, send: 0.6, attack: 0.5, release: 2.0,
        vowels: [[0, 'o'], [1.5, 'u']], overtones: [[0, 8], [1.8, 6]], glide: { at: 0.8, to: -5, time: 2.6 },
      }, 3.3),
      ev(1.45, 'tbell', { midi: 28, gain: 0.18, lp: 1100, send: 0.85, len: 6.0 }),
    ],
  };
}

const GRID = { beat: BEAT, beats: 4 };
export const NIUMO_SCORES = {
  niumo_opening: { bar: openingBar },
  niumo_ambient: { bar: ambientBar },
  niumo_phase1: { bar: (i) => battleBar(i, 1), grid: GRID },
  niumo_phase2: { bar: (i) => battleBar(i, 2), grid: GRID },
  niumo_ending: { bar: endingBar },
  niumo_defeat: { bar: defeatBar },
};
export const NIUMO_STATES = Object.keys(NIUMO_SCORES);
export const NIUMO_LOOPING = ['niumo_ambient', 'niumo_phase1', 'niumo_phase2', 'niumo_ending'];
