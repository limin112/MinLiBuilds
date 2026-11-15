// Procedural audio for the cathedral boss fight and the Flame Mountain (niumo) scene. Everything is
// synthesised with the Web Audio API (no audio files needed). Optional override: if
// assets/audio/<state>.mp3 exists, it is streamed for that music state instead of the synth.
//
// Contract (ARCHITECTURE.md):
//   const audio = new AudioSystem();
//   await audio.unlock();                       // from the first user gesture
//   audio.setMusic('phase1', { fade: 2 });      // 'off'|'hymn'|'tension'|'phase1'|'phase2'|'finale'|'victory'|'defeat'
//   audio.play('hit_flesh', { volume, pitch, pos: {x,y,z}, delay });
//   audio.setListener({ position, forward });   // every frame
//   audio.duck(0.5, 1); audio.setVolumes({ master, music, sfx }); audio.update(dt);
//
// Flame Mountain (docs/niumo_architecture.md §4), additive:
//   music: 'niumo_opening' (~55 s one-shot, cues in NIUMO_CUES.opening) | 'niumo_ambient' (title/approach) |
//          'niumo_phase1' | 'niumo_phase2' (same beat grid: the switch continues on the next beat) |
//          'niumo_ending' (rain + guqin, loops) | 'niumo_defeat' (cuts the music)
//   sfx:   staff_swing, staff_hit, staff_hit_heavy, bull_roar, bull_stomp, bull_slam, fire_breath (stop() ends it),
//          fan_wind, lava_burst, rock_crack, rain
//   The first niumo_* music state switches the reverb to the open 'caldera' space (or call setSpace()).
//   musicTime() / musicBeat() expose the music clock so cutscenes can cut on the drums.
//
// Test hook: new AudioSystem({ context: new OfflineAudioContext(...), seed }) renders the same
// graph offline (no timer, no file probing); drive the music with update() between suspends.
import { AudioEngine, isOfflineContext } from './audio/engine.js';
import { MusicDirector, MUSIC_STATES } from './audio/music.js';
import { SFX, SFX_NAMES, SFX_LIMITS, SFX_DUCK, SFX_DURATION, SFX_REF } from './audio/sfx.js';
import { NIUMO_CUES, NIUMO_GUQIN_NOTES } from './audio/niumo_music.js';

export { SFX_NAMES, MUSIC_STATES, SFX_DURATION, NIUMO_CUES };

const TIMER_MS = 25;

export class AudioSystem {
  /**
   * @param {object} [opts]
   * @param {BaseAudioContext} [opts.context]  use this context (e.g. OfflineAudioContext) instead of creating one
   * @param {number} [opts.seed]               PRNG seed (deterministic renders)
   * @param {boolean} [opts.timer]             run the 25 ms scheduler timer (default: true unless offline)
   * @param {boolean} [opts.musicFiles]        probe assets/audio/<state>.mp3 at unlock (default: true unless offline)
   * @param {(state:string)=>string} [opts.musicUrl]  override the music file URL pattern
   * @param {'cathedral'|'caldera'} [opts.space]      reverb space (default: cathedral; niumo_* music picks caldera)
   */
  constructor(opts = {}) {
    this._opts = { ...opts };
    this._eng = null;
    this._dir = null;
    this._ready = false;
    this._unlocking = null;
    this._timer = 0;
    this._vol = { master: 1, music: 1, sfx: 1 };
    this._listener = { position: { x: 0, y: 1.6, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
    this._wantMusic = null;
    this._warned = new Set();
    this._lastResume = 0;
    this._space = opts.space || null;
    this._spaceExplicit = !!opts.space;
  }

  get ready() { return this._ready && !!this._eng && this._eng.ctx.state !== 'closed'; }

  /** The underlying BaseAudioContext (null before unlock). */
  get context() { return this._eng ? this._eng.ctx : null; }

  /** Current music state ('off' before anything is set). */
  get musicState() { return this._dir ? this._dir.state : this._wantMusic ? this._wantMusic.state : 'off'; }

  async unlock() {
    if (!this._unlocking) this._unlocking = this._doUnlock();
    return this._unlocking;
  }

  async _doUnlock() {
    let ctx = this._opts.context || null;
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { console.warn('[audio] Web Audio API not available; audio disabled'); return false; }
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (err) {
        console.warn('[audio] could not create an AudioContext:', err); return false;
      }
      this._ownsContext = true;
    }
    const offline = isOfflineContext(ctx);
    // Everything up to the first await runs synchronously inside the user gesture.
    let resumed = null;
    if (!offline) {
      if (ctx.state !== 'running') resumed = ctx.resume().catch(() => {});
      try { // iOS: a silent buffer started inside the gesture unlocks output
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination); s.onended = () => s.disconnect(); s.start();
      } catch { /* ignore */ }
    }
    try {
      this._eng = new AudioEngine(ctx, { seed: this._opts.seed });
    } catch (err) {
      console.warn('[audio] could not build the audio graph; audio disabled:', err);
      this._eng = null;
      if (this._ownsContext) ctx.close().catch(() => {});
      return false;
    }
    this._eng.setVolumes(this._vol);
    this._eng.setListener(this._listener.position, this._listener.forward);
    // (the override files only ever exist on a developer's machine: a deployed site is not probed for them)
    const files = this._opts.musicFiles ?? (!offline && typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname));
    const urlFor = this._opts.musicUrl || ((s) => new URL(`../assets/audio/${s}.mp3`, import.meta.url).href);
    this._dir = new MusicDirector(this._eng, { files, urlFor });
    if (this._opts.timer ?? !offline) this._timer = setInterval(() => this._tick(), TIMER_MS);
    if (!offline) this._eng.bank.warm(); // generate the procedural one-shot buffers off the gesture path
    if (this._space && this._space !== 'cathedral') this._enterSpace(this._space, 0);
    this._ready = true;
    if (this._wantMusic) {
      const { state, fade } = this._wantMusic;
      this._wantMusic = null;
      this._dir.set(state, fade);
    }
    if (resumed) await Promise.race([resumed, new Promise((r) => setTimeout(r, 600))]);
    return true;
  }

  setMusic(state, { fade = 2 } = {}) {
    // the Flame Mountain scene sounds in the open caldera unless a space was chosen explicitly
    if (!this._spaceExplicit && typeof state === 'string' && state.startsWith('niumo_') && this._space !== 'caldera') {
      this._space = 'caldera';
      if (this._eng) this._enterSpace('caldera', Math.min(1, Math.max(0, +fade || 0)));
    }
    if (!this._dir) { this._wantMusic = { state, fade }; return; }
    this._dir.set(state, fade);
  }

  /** Reverb space: 'cathedral' (default) or 'caldera' (Flame Mountain). Crossfades over `fade` seconds. */
  setSpace(name, { fade = 1.5 } = {}) {
    this._space = name;
    this._spaceExplicit = true;
    if (this._eng) this._enterSpace(name, fade);
  }

  _enterSpace(name, fade) {
    this._eng.setSpace(name, fade);
    if (name === 'caldera' && !this._eng.offline && !this._warmedNiumo) { // the scene's buffers, in idle ticks
      this._warmedNiumo = true;
      this._eng.nbank.warm(NIUMO_GUQIN_NOTES);
    }
  }

  /** Seconds since the current music state started (null when no music is playing). */
  musicTime() {
    const p = this._dir && this._dir.current;
    if (!p) return null;
    if (p.kind === 'file') return p.el ? p.el.currentTime : null;
    return this._eng.ctx.currentTime - p.seq.t0;
  }

  /** Beat grid of the current fight music: { bpm, beat, bar, beatInBar, sinceBeat, toNextBeat } (null otherwise). */
  musicBeat() {
    const p = this._dir && this._dir.current;
    if (!p || p.kind !== 'synth' || !p.grid) return null;
    const { beat, beats } = p.grid, k = (this._eng.ctx.currentTime - p.gridT0) / beat, kb = Math.floor(k);
    return {
      bpm: 60 / beat, beat, bar: p.gridBar + Math.floor(kb / beats), beatInBar: ((kb % beats) + beats) % beats,
      sinceBeat: (k - kb) * beat, toNextBeat: (kb + 1 - k) * beat,
    };
  }

  /**
   * Fire a one-shot SFX. Returns a small handle { name, pitch, stop(fade) } or null.
   * pos: world position {x,y,z} for panning / distance attenuation (null = 2D).
   */
  play(name, { volume = 1, pitch = 1, pos = null, delay = 0 } = {}) {
    if (!this.ready) return null;
    const recipe = SFX[name];
    if (!recipe) {
      if (!this._warned.has(name)) { this._warned.add(name); console.warn(`[audio] unknown sfx "${name}"`); }
      return null;
    }
    const eng = this._eng, ctx = eng.ctx, rng = eng.rng;
    const t = ctx.currentTime + Math.max(0, +delay || 0) + 0.004;
    const vol = Math.max(0, Number.isFinite(+volume) ? +volume : 1);
    const sp = pos ? eng.spatial(pos, SFX_REF[name]) : null;
    const v = eng.voice(eng.sfxOut, t, {
      pool: 'sfx', tag: name,
      gain: vol * (sp ? sp.att : 1), wetGain: vol * (sp ? sp.wet : 1),
      pan: sp ? sp.pan : 0, lp: sp ? sp.lp : 0,
    });
    const p = Math.max(0.05, Number.isFinite(+pitch) ? +pitch : 1) * rng.vary(1, 0.05);
    const ts = rng.vary(1, 0.05);
    try { recipe(v, t, { p, ts, rng, eng }); } catch (err) { console.warn(`[audio] sfx "${name}" failed:`, err); }
    v.commit({ maxSame: SFX_LIMITS[name] ?? Infinity });
    const dk = SFX_DUCK[name], loud = vol * (sp ? sp.att : 1);
    if (dk && loud > 0.2) eng.duck(dk[0] * Math.min(1, loud), dk[1], t);
    return { name, pitch: p, timeScale: ts, stop: (fade = 0.08) => v.kill(ctx.currentTime, fade) };
  }

  setListener({ position, forward } = {}) {
    if (position) this._listener.position = { x: +position.x || 0, y: +position.y || 0, z: +position.z || 0 };
    if (forward) this._listener.forward = { x: +forward.x || 0, y: +forward.y || 0, z: +forward.z || 0 };
    if (this._eng) this._eng.setListener(position, forward);
  }

  duck(amount = 0.5, seconds = 1) {
    if (this._eng) this._eng.duck(amount, seconds);
  }

  /** Muffle the music (0 = open, 1 = heavy lowpass): low health, slow motion. */
  setMuffle(k = 0) {
    if (this._eng) this._eng.setMusicMuffle(k);
  }

  setVolumes({ master, music, sfx } = {}) {
    const ok = (x) => x != null && Number.isFinite(+x);
    if (ok(master)) this._vol.master = +master;
    if (ok(music)) this._vol.music = +music;
    if (ok(sfx)) this._vol.sfx = +sfx;
    if (this._eng) this._eng.setVolumes(this._vol);
  }

  update(dt) { // eslint-disable-line no-unused-vars
    if (!this._ready) return;
    const ctx = this._eng.ctx;
    if (!this._eng.offline && (ctx.state === 'suspended' || ctx.state === 'interrupted') && performance.now() - this._lastResume > 1000) {
      this._lastResume = performance.now();
      ctx.resume().catch(() => {});
    }
    this._tick();
  }

  _tick() {
    if (this._dir) this._dir.pump();
  }

  /** Debug / test counters. */
  stats() {
    if (!this._eng) return null;
    const e = this._eng;
    return {
      contextState: e.ctx.state,
      music: this._dir.state,
      musicPlayers: this._dir.players.size,
      musicSource: this._dir.current ? this._dir.current.kind : null,
      voices: { music: e.pools.music.active, sfx: e.pools.sfx.active },
      created: e.stats.created, disposed: e.stats.disposed, live: e.stats.created - e.stats.disposed,
      stolen: e.stats.stolen,
    };
  }

  /** Stop everything and release the context (only closes contexts it created). */
  async close() {
    clearInterval(this._timer);
    this._timer = 0;
    this._ready = false;
    if (this._dir) this._dir.dispose();
    if (this._eng && this._ownsContext && this._eng.ctx.state !== 'closed') {
      try { await this._eng.ctx.close(); } catch { /* ignore */ }
    }
  }
}

export default AudioSystem;
