// Audio engine: mixing graph, voice management, spatialisation and ducking.
// Works on any BaseAudioContext (AudioContext for the game, OfflineAudioContext for tests).
//
//   music players ─dry─► musicDuck(dry) ─► musicVol ─┐
//                 └wet─► musicDuck(wet) ─► musicVol ─┼─► reverbIn ─► Convolver ─► reverbOut ─┐
//   sfx voices ───dry─► sfxVol ──────────────────────┼───────────────────────────────────────┤
//              └──wet─► sfxVol ──────────────────────┘                                       ▼
//                                     masterIn ─► compressor(limiter) ─► trim ─► softclip ─► masterVol ─► out
import {
  Rng, clamp, makeNoise, makeSampleBank, makeWaves, cathedralIR, softClipCurve,
} from './dsp.js';
import { makeNiumoBank, calderaIR } from './niumo_bank.js';

export const LOOKAHEAD = 0.15; // seconds of music scheduled ahead of ctx.currentTime

// Master limiter. DynamicsCompressorNode applies an automatic make-up gain of
// (1/curve(0 dBFS))^0.6; COMP_TRIM cancels it so the chain is unity gain below threshold
// (value measured with test/audio_check.mjs, see "calibration" in its output).
const COMP = { threshold: -4, knee: 2, ratio: 16, attack: 0.002, release: 0.16 };
const COMP_TRIM = 0.803;

// Internal mix trims (user volumes multiply these).
const MIX = { music: 0.72, sfx: 1.0, reverb: 0.9 };

export const isOfflineContext = (ctx) =>
  typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

// ---------------------------------------------------------------- Fader
/** Piecewise-linear automation shared by several AudioParams, with a JS-side model of its value. */
export class Fader {
  constructor(params, v0 = 0) {
    this.params = params;
    this.pts = [[0, v0]];
    for (const p of params) p.value = v0;
  }
  valueAt(t) {
    const p = this.pts;
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) {
        const [t0, v0] = p[i - 1], [t1, v1] = p[i];
        return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
      }
    }
    return p[p.length - 1][1];
  }
  /** Replace the trajectory from `now` on with the given future points [[t, v], ...]. */
  set(now, pts) {
    const v0 = this.valueAt(now);
    const all = [[now, v0], ...pts.filter(([t]) => t > now)];
    for (const p of this.params) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(v0, now);
      for (let i = 1; i < all.length; i++) p.linearRampToValueAtTime(all[i][1], all[i][0]);
    }
    this.pts = all;
  }
  /** Keep the current trajectory until `t`, then ramp linearly to `target` over `dur`. */
  to(target, t, dur, now) {
    t = Math.max(t, now);
    const keep = this.pts.filter(([tt]) => tt > now && tt < t);
    this.set(now, [...keep, [t, this.valueAt(t)], [t + Math.max(dur, 0.005), target]]);
  }
}

// ---------------------------------------------------------------- voices
/** Polyphony limiter. Voices are counted over their scheduled [t0, end) window, so it also
 *  works for notes scheduled ahead of time; the oldest voice is stolen with a short fade. */
export class VoicePool {
  constructor(eng, max) { this.eng = eng; this.max = max; this.list = []; }
  admit(v, maxSame = Infinity) {
    const t = v.t0;
    let list = this.list.filter((x) => !x.disposed && x.end > t && x.killedAt > t);
    if (maxSame < Infinity) {
      const same = list.filter((x) => x.tag === v.tag);
      for (let i = 0; i <= same.length - maxSame; i++) { same[i].kill(t); this.eng.stats.stolen++; }
      list = list.filter((x) => x.killedAt > t);
    }
    while (list.length >= this.max) { list.shift().kill(t); this.eng.stats.stolen++; }
    list.push(v);
    this.list = list;
  }
  remove(v) { const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1); }
  get active() {
    const now = this.eng.ctx.currentTime;
    return this.list.filter((x) => !x.disposed && x.end > now && x.t0 <= now + LOOKAHEAD).length;
  }
}

/**
 * One sounding event (a note, a chord or a whole layered SFX). Owns every node it creates;
 * when the last of its sources has ended, all nodes are disconnected (no leaks). `kill()`
 * fades it out quickly and stops its sources (used for voice stealing and music stops).
 */
export class Voice {
  constructor(eng, out, t0, { pool = 'sfx', tag = '', gain = 1, wetGain = gain, pan = 0, lp = 0 } = {}) {
    this.eng = eng; this.ctx = eng.ctx; this.t0 = t0; this.end = t0; this.tag = tag;
    this.nodes = []; this.srcs = []; this.live = 0;
    this.disposed = false; this.killedAt = Infinity; this.counted = false;
    this.pool = eng.pools[pool] || null; this.owner = out.owner || null;
    this.dryLevel = gain; this.wetLevel = wetGain;
    this.dry = this.gain(gain);
    this.wet = this.gain(wetGain);
    let tail = this.dry;
    if (lp > 0) { const f = this.biquad('lowpass', lp, -3); tail.connect(f); tail = f; }
    if (pan) { const p = this.panner(pan); tail.connect(p); tail = p; }
    tail.connect(out.dry);
    this.wet.connect(out.wet);
    this._onEnded = () => { if (--this.live <= 0) this.dispose(); };
  }
  fclamp(f) { return clamp(f, 10, this.eng.nyq); }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; this.nodes.push(g); return g; }
  biquad(type, freq, Q = 0.7071, gainDb = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = this.fclamp(freq); b.Q.value = Q; b.gain.value = gainDb;
    this.nodes.push(b); return b;
  }
  panner(pan = 0) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); this.nodes.push(p); return p; }
  shaper(curve) { const s = this.ctx.createWaveShaper(); s.curve = curve; this.nodes.push(s); return s; }
  osc(type, freq, t, stop) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type.wave || type);
    o.frequency.value = clamp(freq, 0.01, this.eng.nyq);
    this._src(o, t, stop);
    return o;
  }
  noise(kind, t, stop, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.eng.noise[kind] || this.eng.noise.white;
    s.loop = true; s.playbackRate.value = rate;
    this._src(s, t, stop, this.eng.rng.float() * s.buffer.duration * 0.9);
    return s;
  }
  buffer(buf, t, { rate = 1, stop, offset = 0, loop = false } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = loop; s.playbackRate.value = rate;
    this._src(s, t, stop ?? t + (buf.duration - offset) / rate + 0.01, offset);
    return s;
  }
  constant(value, t, stop) {
    const c = this.ctx.createConstantSource(); c.offset.value = value; this._src(c, t, stop); return c;
  }
  _src(node, t, stop, offset) {
    t = Math.max(t, 0);
    stop = Math.max(stop, t + 0.002);
    node.onended = this._onEnded;
    if (offset !== undefined) node.start(t, offset); else node.start(t);
    node.stop(stop);
    node._stopAt = stop;
    this.srcs.push(node); this.live++;
    if (stop > this.end) this.end = stop;
  }
  /** Route `node` to the voice output (dry level `dry`) plus a reverb send of `send`. */
  out(node, send = 0, dry = 1) {
    if (dry === 1) node.connect(this.dry);
    else if (dry > 0) { const g = this.gain(dry); node.connect(g); g.connect(this.dry); }
    if (send > 0) { const g = this.gain(send); node.connect(g); g.connect(this.wet); }
  }
  commit({ maxSame = Infinity } = {}) {
    if (!this.live) { this.dispose(); return this; }
    this.counted = true;
    this.eng.stats.created++;
    if (this.pool) this.pool.admit(this, maxSame);
    if (this.owner) this.owner.add(this);
    return this;
  }
  kill(t, fade = 0.04) {
    if (this.disposed) return;
    t = Math.max(t, this.ctx.currentTime);
    if (t >= this.killedAt) return;
    this.killedAt = t;
    for (const [g, lvl] of [[this.dry, this.dryLevel], [this.wet, this.wetLevel]]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(lvl, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
    }
    const stopAt = t + fade + 0.01;
    for (const s of this.srcs) {
      if (s._stopAt > stopAt) { try { s.stop(stopAt); s._stopAt = stopAt; } catch { /* already stopped */ } }
    }
    this.end = Math.min(this.end, stopAt);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.srcs) { s.onended = null; try { s.disconnect(); } catch { /* ok */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* ok */ } }
    this.srcs.length = 0; this.nodes.length = 0;
    if (this.pool) this.pool.remove(this);
    if (this.owner) this.owner.delete(this);
    if (this.counted) this.eng.stats.disposed++;
  }
}

// ---------------------------------------------------------------- engine
export class AudioEngine {
  constructor(ctx, { seed } = {}) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.nyq = ctx.sampleRate * 0.45;
    this.seed = Number.isFinite(seed) ? seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    this.rng = new Rng(this.seed);
    this.offline = isOfflineContext(ctx);
    this.stats = { created: 0, disposed: 0, stolen: 0 };
    this.pools = { music: new VoicePool(this, 72), sfx: new VoicePool(this, 32) };
    this.listener = { px: 0, py: 1.6, pz: 0, fx: 0, fz: -1 };
    this._curves = new Map();
    this.waves = makeWaves(ctx);
    this.noise = makeNoise(ctx, this.rng);
    this.bank = makeSampleBank(ctx, this.seed); // lazy; warmed in idle ticks after unlock
    this.nbank = makeNiumoBank(ctx, this.seed); // Flame Mountain buffers: lazy, own PRNGs, nothing generated until used
    this.space = 'cathedral';
    this._build();
  }

  _build() {
    const ctx = this.ctx;
    const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // master: limiter + safety soft clip (guarantees |out| < 0.99 at master volume <= 1)
    this.masterIn = G(1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = COMP.threshold; comp.knee.value = COMP.knee; comp.ratio.value = COMP.ratio;
    comp.attack.value = COMP.attack; comp.release.value = COMP.release;
    this.comp = comp;
    this.compTrim = G(COMP_TRIM);
    const clipPre = G(0.5);
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve(); clip.oversample = 'none';
    this.masterVol = G(1);
    this.masterIn.connect(comp); comp.connect(this.compTrim); this.compTrim.connect(clipPre);
    clipPre.connect(clip); clip.connect(this.masterVol); this.masterVol.connect(ctx.destination);
    this.output = this.masterVol;

    // one shared cathedral reverb
    this.revIn = G(1);
    this.conv = ctx.createConvolver();
    this.conv.normalize = false;
    this.conv.buffer = cathedralIR(ctx, this.rng);
    this.revOut = G(MIX.reverb);
    this.revIn.connect(this.conv); this.conv.connect(this.revOut); this.revOut.connect(this.masterIn);

    // music bus: duck stage (automated) then user volume
    this.music = { dry: G(1), wet: G(1) };
    this.musicVolD = G(MIX.music); this.musicVolW = G(MIX.music);
    // muffle stage (low health, slow motion): one lowpass on each music path, opened fully by default
    this.musicLP = [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
    for (const f of this.musicLP) { f.type = 'lowpass'; f.frequency.value = this.nyq; f.Q.value = 0.5; }
    this._muffle = 0;
    this.music.dry.connect(this.musicVolD); this.musicVolD.connect(this.musicLP[0]); this.musicLP[0].connect(this.masterIn);
    this.music.wet.connect(this.musicVolW); this.musicVolW.connect(this.musicLP[1]); this.musicLP[1].connect(this.revIn);
    this.duckFader = new Fader([this.music.dry.gain, this.music.wet.gain], 1);

    // sfx bus
    this.sfxVolD = G(MIX.sfx); this.sfxVolW = G(MIX.sfx);
    this.sfxVolD.connect(this.masterIn); this.sfxVolW.connect(this.revIn);
    this.sfxOut = { dry: this.sfxVolD, wet: this.sfxVolW };

    // silent sink that keeps timer sources pulled by the graph
    this.sink = G(0); this.sink.connect(ctx.destination);
  }

  voice(out, t, opts) { return new Voice(this, out, t, opts); }

  /**
   * Switch the shared reverb to another acoustic space: 'cathedral' (default) or 'caldera' (the Flame
   * Mountain: open, darker, echoes off the rock walls). Reverb inputs crossfade over `fade` s and the old
   * tail rings out. Nothing in the cathedral graph changes until the first switch.
   */
  setSpace(name, fade = 1.5) {
    if (name !== 'cathedral' && name !== 'caldera') { console.warn(`[audio] unknown space "${name}"`); return; }
    if (name === this.space) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (!this._spaces) { // split the reverb input into one send per space
      this.revIn.disconnect(this.conv);
      const send = ctx.createGain();
      this.revIn.connect(send); send.connect(this.conv);
      this._spaces = { cathedral: { conv: this.conv, send, fader: new Fader([send.gain], 1), on: true } };
    }
    if (!this._spaces[name]) {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = calderaIR(ctx, new Rng((this.seed ^ 0x0ca1de7a) >>> 0));
      const send = ctx.createGain();
      this.revIn.connect(send); send.connect(conv); conv.connect(this.revOut);
      this._spaces[name] = { conv, send, fader: new Fader([send.gain], 0), on: true };
    }
    fade = Math.max(0, +fade || 0);
    for (const [k, s] of Object.entries(this._spaces)) {
      if (k === name && !s.on) { s.send.connect(s.conv); s.on = true; }
      const target = k === name ? 1 : 0;
      if (fade < 0.005) { // switch now (e.g. before anything has played)
        s.send.gain.cancelScheduledValues(now);
        s.send.gain.setValueAtTime(target, now);
        s.fader.pts = [[now, target]];
      } else s.fader.to(target, now, fade, now);
    }
    this.space = name;
    // once its tail has rung out, an unused space stops listening (its convolver goes idle)
    const token = (this._spaceToken = (this._spaceToken || 0) + 1);
    this.at(now + fade + 5.5, () => {
      if (token !== this._spaceToken) return;
      for (const [k, s] of Object.entries(this._spaces)) {
        if (k !== this.space && s.on) { try { s.send.disconnect(s.conv); } catch { /* ok */ } s.on = false; }
      }
    });
  }

  /** Call fn when the audio clock reaches `time` (works for realtime and offline contexts). */
  at(time, fn) {
    const s = this.ctx.createConstantSource();
    s.offset.value = 0;
    s.connect(this.sink);
    s.onended = () => { try { s.disconnect(); } catch { /* ok */ } fn(); };
    const now = this.ctx.currentTime;
    s.start(now);
    s.stop(Math.max(time, now + 0.003));
  }

  driveCurve(k) {
    const key = Math.round(k * 10);
    if (!this._curves.has(key)) {
      const n = 1025, c = new Float32Array(n), tk = Math.tanh(k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / tk; }
      this._curves.set(key, c);
    }
    return this._curves.get(key);
  }

  setVolumes({ master, music, sfx }) {
    const now = this.ctx.currentTime;
    const ramp = (param, v) => param.setTargetAtTime(v, now, 0.04);
    if (master != null) ramp(this.masterVol.gain, clamp(master, 0, 1));
    if (music != null) { const v = clamp(music, 0, 1.5) * MIX.music; ramp(this.musicVolD.gain, v); ramp(this.musicVolW.gain, v); }
    if (sfx != null) { const v = clamp(sfx, 0, 1.5) * MIX.sfx; ramp(this.sfxVolD.gain, v); ramp(this.sfxVolW.gain, v); }
  }

  /** Lower the music bus by `amount` (0..1) for about `seconds`; overlapping ducks combine (deepest wins). */
  /** 0 = open, 1 = heavily muffled music (lowpass ~600 Hz); glides over ~0.25 s. */
  setMusicMuffle(k) {
    k = clamp(+k || 0, 0, 1);
    if (Math.abs(k - this._muffle) < 0.01) return;
    this._muffle = k;
    const f = Math.exp(Math.log(this.nyq) * (1 - k) + Math.log(600) * k), now = this.ctx.currentTime;
    for (const lp of this.musicLP) { lp.frequency.cancelScheduledValues(now); lp.frequency.setTargetAtTime(f, now, 0.12); }
  }

  duck(amount = 0.5, seconds = 1, at = this.ctx.currentTime) {
    const now = this.ctx.currentTime;
    const t = Math.max(at, now);
    const level = 1 - clamp(amount, 0, 1);
    const attack = 0.04, hold = Math.max(0, seconds * 0.4), release = Math.max(0.25, seconds * 0.6);
    const mine = [[t, 1], [t + attack, level], [t + attack + hold, level], [t + attack + hold + release, 1]];
    const mineAt = (x) => {
      if (x <= t) return 1;
      for (let i = 1; i < mine.length; i++) {
        if (x <= mine[i][0]) { const [t0, v0] = mine[i - 1], [t1, v1] = mine[i]; return v0 + ((v1 - v0) * (x - t0)) / (t1 - t0); }
      }
      return 1;
    };
    const times = [...new Set([...mine.map((p) => p[0]), ...this.duckFader.pts.map((p) => p[0])])]
      .filter((x) => x > now).sort((a, b) => a - b);
    const pts = times.map((x) => [x, Math.min(mineAt(x), this.duckFader.valueAt(x))]);
    // drop interior points of flat segments so repeated ducks don't pile up automation events
    const lean = pts.filter((p, i) => i === 0 || i === pts.length - 1 || !(pts[i - 1][1] === p[1] && pts[i + 1][1] === p[1]));
    this.duckFader.set(now, lean);
  }

  setListener(position, forward) {
    const L = this.listener;
    if (position) { L.px = +position.x || 0; L.py = +position.y || 0; L.pz = +position.z || 0; }
    if (forward) {
      const fx = +forward.x || 0, fz = +forward.z || 0, l = Math.hypot(fx, fz);
      if (l > 1e-6) { L.fx = fx / l; L.fz = fz / l; }
    }
  }

  /** Stereo pan, distance gain (inverse model, ref 4 m), reverb ratio and air/rear filtering for a world position. */
  spatial(pos, ref = 4) {
    const L = this.listener;
    const dx = (+pos.x || 0) - L.px, dy = (+pos.y || 0) - L.py, dz = (+pos.z || 0) - L.pz;
    const d = Math.hypot(dx, dy, dz), hd = Math.hypot(dx, dz);
    const att = ref / (ref + Math.max(0, d - ref));
    let pan = 0, front = 1;
    if (hd > 1e-4) {
      pan = (dx * -L.fz + dz * L.fx) / hd; // right = (-fz, 0, fx)
      front = (dx * L.fx + dz * L.fz) / hd;
    }
    pan *= 0.85 * Math.min(1, hd / 1.5);
    let lp = 20000 / (1 + d / 35);
    if (front < -0.3) lp = Math.min(lp, 7000 + 9000 * (1 + front));
    return { att, pan, wet: Math.sqrt(att), lp: lp < 15000 ? lp : 0, dist: d };
  }
}
