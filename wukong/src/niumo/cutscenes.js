// 火焰山 · 牛魔 cutscenes and the cinematic helpers shared with the opening MV (src/niumo/mv.js).
//
//   (the walk-in and the awakening are part of the opening cinematic: src/niumo/mv.js)
//   CollapseScene  (~10.5) 山崩 at half health: he roars at the sky, the mountain behind him splits and the lava comes
//                          up, he plants his hands and tears himself out of the rock; the camera climbs from his hooves
//                          to the burning sky, his head lost in smoke. The arena turns into a lava lake (setPhase 2).
//                          Spoken: 牛魔王「坐了一千年……也该站起来，看看这天了。」 孙悟空「站起来好。倒下去，才响。」
//   EndingScene    (~26 s) he topples into the lava lake and sinks like a mountain; the volcano dies (setPhase 3); it
//                          rains for the first time in a thousand years; the monkey sits on the one horn still above
//                          the lake, rain on the golden mask; 孙悟空「大哥……下雨了。」; card 火焰山 · 熄.
//
//   VoiceLines             the spoken lines (assets/audio/voice/*.m4a from tools/gen_voice.sh), played through Web Audio
//                          on the AudioSystem's context (the bull slowed down, darkened and put in a cavern; the monkey
//                          dry and bright), the music ducked under them, the subtitle in sync. One line at a time.
//
// The bull is driven only through its contract (pos / yaw / phase / update / lockTargets / hurtZones) plus optional
// cinematic hooks it may implement: setEyes(k), roar(). Anything else (eye glow, the fall, the sinking) is done here
// on the character the main module loaded (char.bones / char.root), so the scenes work with any BullKing.
import * as THREE from 'three';
import { ease, PoseTrack } from '../pose.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
function noise1(t, seed) { return Math.sin(t * 1.9 + seed) * 0.5 + Math.sin(t * 4.3 + seed * 1.7) * 0.3 + Math.sin(t * 9.1 + seed * 2.3) * 0.2; }

// ------------------------------------------------------------------ anchors on the bull

/**
 * World anchors on the bull, read from the character the main module loaded (Mixamo-style bone names).
 * F / R / U: the bull's facing, right and up (from its root); at(r, u, f): a point in that frame from its feet.
 */
export function bullFrame(bull, char) {
  const root = char.root, q = new THREE.Quaternion();
  const F = V(0, 0, 1), R = V(-1, 0, 0), U = V(0, 1, 0);
  const H = char.height || 40;
  const bones = char.bones || {};
  const frame = () => {
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(q);
    F.set(0, 0, 1).applyQuaternion(q); F.y = 0; F.normalize();
    R.crossVectors(F, U).normalize();
    return f;
  };
  const bone = (name, out = new THREE.Vector3()) => {
    const b = bones[name];
    return b ? b.getWorldPosition(out) : null;
  };
  const pick = (...names) => { for (const n of names) { const p = bone(n); if (p) return p; } return null; };
  const at = (r, u, fw, out = new THREE.Vector3()) => out.copy(root.position).addScaledVector(R, r).addScaledVector(U, u).addScaledVector(F, fw);
  const zone = part => {
    const z = (bull.hurtZones ? bull.hurtZones() : []).find(x => x.part === part);
    return z ? z.a.clone().lerp(z.b, 0.5) : null;
  };
  const f = {
    F, R, U, H, root, frame, bone, at,
    head: () => pick('Head', 'Neck') || at(0, H * 0.53, H * 0.04),
    chest: () => pick('Spine2', 'Spine1') || at(0, H * 0.4, 0),
    hips: () => pick('Hips') || at(0, H * 0.1, 0),
    shoulder: side => pick(side + 'Shoulder', side + 'Arm') || at(side === 'Left' ? -H * 0.15 : H * 0.15, H * 0.44, 0),
    hand: side => zone(side === 'Left' ? 'handL' : 'handR') || pick(side + 'Hand') || at(side === 'Left' ? -H * 0.15 : H * 0.15, H * 0.15, H * 0.2),
    knee: side => zone(side === 'Left' ? 'kneeL' : 'kneeR') || pick(side + 'Leg') || at(side === 'Left' ? -H * 0.2 : H * 0.2, H * 0.12, H * 0.2),
    foot: side => pick(side + 'ToeBase', side + 'Foot') || at(side === 'Left' ? -H * 0.1 : H * 0.1, 0.5, H * 0.08),
    /** The knee nearest to a point. */
    nearKnee: p => { const a = f.knee('Left'), b = f.knee('Right'); return a.distanceToSquared(p) < b.distanceToSquared(p) ? a : b; },
  };
  return frame();
}

/**
 * Nearest walkable spot to (x, z) that is not lava (arena.lavaAt < 0.25) and inside the bounds. collapsed: where the
 * floor will still be rock once phase two's collapse is over (asked before it happens).
 */
export function safeSpot(arena, x, z, collapsed = false) {
  if (typeof arena.safeSpot === 'function') return collapsed ? arena.safeSpot(x, z, 30, 1) : arena.safeSpot(x, z);
  const b = arena.bounds, lava = arena.lavaAt || (() => 0);
  const ok = (px, pz) => px > b.minX + 1 && px < b.maxX - 1 && pz > b.minZ + 1 && pz < b.maxZ - 1 && lava(px, pz) < 0.25;
  if (ok(x, z)) return { x, z };
  for (let r = 2; r <= 40; r += 2) {
    const n = Math.max(8, Math.round(r * 2));
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

// ------------------------------------------------------------------ camera shots

/**
 * A list of shots { t0, t1, dur?, from: { pos, look, fov }, to: {...}, e, ap, blur, shake, roll } where pos / look may be
 * Vector3s or functions (re-evaluated every frame, so a shot can follow a moving bone). apply() places the camera.
 */
export class ShotTrack {
  constructor(shots) { this.shots = shots; this.kick = 0; this.time = 0; }
  at(t) { return this.shots.find(s => t >= s.t0 && t < s.t1) || this.shots[this.shots.length - 1]; }
  /** Add a jolt to the handheld shake (decays over ~0.6 s). */
  jolt(k) { this.kick = Math.min(1.5, this.kick + k); }
  apply(camera, t, dt = 0) {
    const shot = this.at(t);
    this.time += dt;
    this.kick = Math.max(0, this.kick - dt * 1.8);
    // shot.dur: the planned length of an open-ended shot (one that runs until something else ends it)
    const f = (ease[shot.e] || ease.linear)(clamp01((t - shot.t0) / (shot.dur ?? (shot.t1 - shot.t0))));
    const val = v => (typeof v === 'function' ? v(f) : v);
    const pos = val(shot.from.pos).clone().lerp(val(shot.to.pos), f);
    const look = val(shot.from.look).clone().lerp(val(shot.to.look), f);
    const s = (shot.shake || 0) + this.kick * this.kick;
    const dist = pos.distanceTo(look);
    if (s > 0) {
      const tt = this.time;
      pos.x += noise1(tt * 2, 1) * 0.05 * s * Math.max(1, dist * 0.05); pos.y += noise1(tt * 2, 2) * 0.04 * s * Math.max(1, dist * 0.05);
      look.x += noise1(tt * 2.6, 3) * 0.06 * s * Math.max(1, dist * 0.04); look.y += noise1(tt * 2.6, 4) * 0.05 * s * Math.max(1, dist * 0.04);
    }
    camera.position.copy(pos);
    camera.lookAt(look);
    if (shot.roll || s > 0.3) camera.rotateZ((shot.roll || 0) + noise1(this.time * 3, 5) * 0.01 * s);
    const fov = shot.from.fov + (shot.to.fov - shot.from.fov) * f;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return { shot, f, pos, look, dist, index: this.shots.indexOf(shot) };
  }
}

// ------------------------------------------------------------------ eyes

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.18)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * Two dark-red points deep in the eye sockets (used when the BullKing has no setEyes of its own). Positioned in the
 * head's frame each update(); `offset` = [side, up, forward] in fractions of the bull's standing height.
 */
export class EyeGlow {
  constructor(scene, char, { offset = [0.016, 0.006, 0.03] } = {}) {
    this.scene = scene; this.char = char; this.offset = offset; this.k = 0; this.shown = 0;
    this.tex = glowTexture();
    const mk = (size, color, opacity) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false }));
      s.scale.setScalar(size); s.renderOrder = 7; s.visible = false; scene.add(s); return s;
    };
    const H = char.height || 40;
    // small and deep red: embers at the back of the sockets, not lamps
    this.parts = [-1, 1].map(() => ({ core: mk(H * 0.0042, new THREE.Color(2.3, 0.3, 0.06), 1), halo: mk(H * 0.019, new THREE.Color(0.55, 0.05, 0.012), 0.4) }));
    this.q = new THREE.Quaternion(); this.F = V(0, 0, 1); this.R = V(); this.U = V(0, 1, 0); this.p = V();
  }
  set(k) { this.k = clamp01(k); }
  update(dt = 0.016, time = 0) {
    this.shown += (this.k - this.shown) * (1 - Math.exp(-6 * dt));
    const on = this.shown > 0.01;
    for (const e of this.parts) { e.core.visible = e.halo.visible = on; }
    if (!on) return;
    const head = this.char.bones && this.char.bones.Head;
    if (!head) return;
    const H = this.char.height || 40, [sx, uy, fz] = this.offset;
    // the head's facing: the root's forward tipped by the head's own pitch
    head.getWorldQuaternion(this.q);
    this.U.set(0, 1, 0).applyQuaternion(this.q);
    this.char.root.getWorldQuaternion(this.q);
    this.F.set(0, 0, 1).applyQuaternion(this.q);
    this.R.crossVectors(this.F, this.U).normalize();
    this.F.crossVectors(this.U, this.R).normalize();
    head.getWorldPosition(this.p);
    const flick = 0.92 + 0.08 * Math.sin(time * 7.3) * Math.sin(time * 3.1);
    this.parts.forEach((e, i) => {
      const side = i ? 1 : -1;
      const at = this.p.clone().addScaledVector(this.R, side * sx * H).addScaledVector(this.U, uy * H).addScaledVector(this.F, fz * H);
      e.core.position.copy(at); e.halo.position.copy(at).addScaledVector(this.F, H * 0.004);
      e.core.material.opacity = this.shown * flick;
      e.halo.material.opacity = 0.4 * this.shown * this.shown * flick;
    });
  }
  dispose() {
    for (const e of this.parts) for (const s of [e.core, e.halo]) { this.scene.remove(s); s.material.dispose(); }
    this.tex.dispose();
  }
}

// ------------------------------------------------------------------ ash in the lens

/** Falling ash (and a few embers) in a box that follows a point: for the close shots, where the arena's own ash is too sparse. */
export class AshFall {
  constructor(scene, { count = 700, box = [14, 9, 14], ember = 0.04, size = 1.0 } = {}) {
    this.scene = scene; this.box = box; this.n = count; this.center = V();
    this.wind = V(0.35, 0, 0.1);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 4), sz = new Float32Array(count);
    this.seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      this.seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      const hot = Math.random() < ember;
      // warm grey flakes in the evening light (pale enough not to read as black dots against the sky); a few embers still alive
      if (hot) col.set([2.0, 0.48, 0.1, 0.9], i * 4);
      else { const g = 0.3 + Math.random() * 0.16; col.set([g * 1.1, g, g * 0.9, 0.42], i * 4); }
      sz[i] = (hot ? 0.016 : 0.02 + Math.random() * 0.028) * size;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: innerHeight * 0.9 }, uFade: { value: 1 } },
      // capped size and a fade right at the lens: a flake drifting through the camera never becomes a grey moon
      vertexShader: `attribute float aSize; attribute vec4 aColor; varying vec4 vC; uniform float uScale;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
          vC.a *= smoothstep(0.9, 2.6, d);
          gl_PointSize = min(aSize * uScale / max(0.2, d), 6.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; uniform float uFade;
        void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(c)) * vC.a * uFade; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 6;
    scene.add(this.points);
    this.t = 0;
    this.update(0);
  }
  update(dt) {
    this.t += dt;
    const p = this.points.geometry.attributes.position.array, [bx, by, bz] = this.box, s = this.seed, t = this.t;
    for (let i = 0; i < this.n; i++) {
      const o = i * 4, fall = 0.35 + s[o + 3] * 0.5;
      const y = ((s[o + 1] * by - t * fall) % by + by) % by;
      const x = ((s[o] * bx + t * this.wind.x + Math.sin(t * 0.9 + i) * 0.25) % bx + bx) % bx;
      const z = ((s[o + 2] * bz + t * this.wind.z + Math.cos(t * 0.7 + i) * 0.25) % bz + bz) % bz;
      p[i * 3] = this.center.x + x - bx / 2; p[i * 3 + 1] = this.center.y + y - by / 2; p[i * 3 + 2] = this.center.z + z - bz / 2;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
  set visible(v) { this.points.visible = v; }
  dispose() { this.scene.remove(this.points); this.points.geometry.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------ the horns (for the last shot)

/**
 * Find the two horn tips on the bull's mesh: among the vertices skinned (mostly) to the head, the ones furthest up and
 * out on either side, kept in the head bone's frame so they follow it. world(i) returns tip i in world space.
 */
export function hornTips(char) {
  const mesh = char.mesh, bones = char.bones || {};
  const head = bones.Head;
  if (!mesh || !head || !mesh.skeleton) return null;
  const sk = mesh.skeleton, hi = sk.bones.indexOf(head);
  if (hi < 0) return null;
  const headish = new Set();
  sk.bones.forEach((b, i) => { if (b === head || /HeadTop|Head_?End|Horn|Ear/i.test(b.name)) headish.add(i); });
  const geo = mesh.geometry, P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  const toLocal = new THREE.Matrix4().multiplyMatrices(sk.boneInverses[hi], mesh.bindMatrix);
  const v = V(), best = [{ s: -Infinity, p: V() }, { s: -Infinity, p: V() }];
  const step = P.count > 200000 ? 3 : 1;
  for (let i = 0; i < P.count; i += step) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (headish.has(SI.getComponent(i, k))) w += SW.getComponent(i, k);
    if (w < 0.55) continue;
    v.fromBufferAttribute(P, i).applyMatrix4(toLocal);
    const side = v.x >= 0 ? 1 : 0;
    const score = v.y + Math.abs(v.x) * 0.9;
    if (score > best[side].s) { best[side].s = score; best[side].p.copy(v); }
  }
  if (!isFinite(best[0].s) || !isFinite(best[1].s)) return null;
  return {
    local: best.map(b => b.p.clone()),
    world(i, out = new THREE.Vector3()) { head.updateMatrixWorld(true); return out.copy(this.local[i]).applyMatrix4(head.matrixWorld); },
  };
}

/**
 * Horn tips on separate meshes that ride on the head (bull.js gives its stand-in model a bronze-banded pair in
 * bull.headParts): per mesh, the vertex furthest from the group's origin, kept in the group's frame.
 */
export function hornTipsFromGroup(group) {
  if (!group) return null;
  const tips = [], v = V();
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  group.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const P = o.geometry.attributes.position, toGroup = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    let best = null, bd = -1;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(toGroup);
      const d = v.lengthSq();
      if (d > bd) { bd = d; best = v.clone(); }
    }
    if (best) tips.push({ local: best, len: Math.sqrt(bd) });
  });
  // the horns are the two longest reaches (a ring or a band is shorter)
  tips.sort((a, b) => b.len - a.len);
  const two = tips.slice(0, 2);
  if (two.length < 2) return null;
  return {
    local: two.map(t => t.local),
    world(i, out = new THREE.Vector3()) { group.updateMatrixWorld(true); return out.copy(this.local[i]).applyMatrix4(group.matrixWorld); },
  };
}

// ------------------------------------------------------------------ spoken lines

/**
 * How each speaker is played. The lines are acted by a neural voice (tools/gen_voice.mjs) and are left almost as they
 * are: the bull a touch slower and darker with the air of the caldera around him, the monkey nearly dry. (rate < 1
 * lowers the pitch and slows the line; lp / shelf darken it; drive adds grit; wet / ir is a generated reverb.)
 */
export const VOICE_STYLE = {
  // 牛魔王: a mountain talking - the voice comes up out of the caldera and off its walls (a long dark tail, two
  // slow echoes: echo = [seconds, feedback, level]), a little lower than recorded
  bull: { name: '牛魔王', rate: 1.0, lp: 5200, shelf: 6, drive: 0, wet: 0.5, ir: 4.6, echo: [0.37, 0.42, 0.34], gain: 1.5, duck: 0.6 },
  monkey: { name: '孙悟空', rate: 1.0, lp: 12000, shelf: 0, drive: 0, wet: 0.09, ir: 1.2, gain: 1.35, duck: 0.5 },
};

/** Seconds of a buffer up to the end of the speech (the TTS leaves a tail of silence). */
function speechEnd(buf) {
  const d = buf.getChannelData(0);
  for (let i = d.length - 1; i > 0; i -= 32) if (Math.abs(d[i]) > 0.012) return Math.min(buf.duration, i / buf.sampleRate + 0.08);
  return buf.duration;
}

/** A stereo cave impulse response: decaying noise, darker as it rings. */
function caveIR(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds), ir = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n, k = 0.5 - 0.42 * x;                         // the one-pole closes as it decays
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.pow(1 - x, 2.4) * (i < 0.012 * ctx.sampleRate ? i / (0.012 * ctx.sampleRate) : 1);
    }
  }
  return ir;
}

/**
 * The spoken lines. load() fetches the manifest (assets/audio/voice/voice.json) and, once the AudioSystem has a
 * context (after unlock), decodes every line. play(id) starts a line (stopping any other: lines never overlap), shows
 * its subtitle and ducks the music while it lasts; busy is true until it has finished. Without audio (or a file that
 * failed to decode) the subtitle still runs for the line's length, so the cinematic timing stays the same.
 */
export class VoiceLines {
  constructor(audio, ui, { base = 'assets/audio/voice/' } = {}) {
    Object.assign(this, { audio, ui, base });
    this.lines = {}; this.buffers = {}; this.cur = null; this.log = []; this.chains = {}; this.duckT = 0;
    this.manifest = null; this.decoding = null;
  }
  loadManifest() {
    return this.manifest || (this.manifest = fetch(this.base + 'voice.json').then(r => (r.ok ? r.json() : { lines: {} }))
      .then(j => { this.lines = j.lines || {}; }).catch(() => { this.lines = {}; }));
  }
  /** Manifest + decode (call after audio.unlock()). */
  load() {
    if (this.decoding) return this.decoding;
    const ctx = this.audio.context;
    if (!ctx) return this.loadManifest();
    this.decoding = this.loadManifest().then(() => Promise.all(Object.entries(this.lines).map(async ([id, l]) => {
      try {
        const ab = await (await fetch(this.base + l.file)).arrayBuffer();
        const buf = await ctx.decodeAudioData(ab);
        this.buffers[id] = { buf, end: speechEnd(buf) };
      } catch (e) { console.info(`[niumo] voice ${id}: not decoded (${e && e.message}), subtitle only`); }
    })));
    return this.decoding;
  }
  get decoded() { return Object.keys(this.buffers).length; }
  style(id) { return VOICE_STYLE[this.lines[id]?.speaker] || VOICE_STYLE.monkey; }
  /** How long a line runs in the game (after its playback rate). */
  duration(id) {
    const l = this.lines[id], b = this.buffers[id], st = this.style(id);
    if (b) return b.end / st.rate;
    return l ? (l.duration * 0.88) / st.rate : 0;
  }
  text(id) { return this.lines[id]?.text || ''; }
  /** The effect chain of a speaker (built once), into the engine's master (limiter, master volume). */
  chain(speaker) {
    if (this.chains[speaker]) return this.chains[speaker];
    const ctx = this.audio.context, st = VOICE_STYLE[speaker] || VOICE_STYLE.monkey;
    const eng = this.audio._eng;
    const dest = (eng && eng.masterIn) || ctx.destination;
    const input = ctx.createGain();
    const shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 180; shelf.gain.value = st.shelf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = speaker === 'bull' ? 45 : 110;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = st.lp; lp.Q.value = 0.5;
    let last = lp;
    input.connect(hp); hp.connect(shelf); shelf.connect(lp);
    if (st.drive > 0) {
      const ws = ctx.createWaveShaper(), n = 1024, curve = new Float32Array(n), k = 1 + st.drive * 6;
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
      ws.curve = curve; lp.connect(ws); last = ws;
    }
    const out = ctx.createGain(); out.gain.value = st.gain;
    const dry = ctx.createGain(); dry.gain.value = 1;
    const conv = ctx.createConvolver(); conv.buffer = caveIR(ctx, st.ir);
    const wet = ctx.createGain(); wet.gain.value = st.wet;
    last.connect(dry); dry.connect(out);
    last.connect(conv); conv.connect(wet); wet.connect(out);
    if (st.echo) {
      // the far wall answers: a darkened repeat that feeds itself (and the reverb, so it sinks into the valley)
      const [time, fb, level] = st.echo;
      const d = ctx.createDelay(2); d.delayTime.value = time;
      const f = ctx.createGain(); f.gain.value = fb;
      const dark = ctx.createBiquadFilter(); dark.type = 'lowpass'; dark.frequency.value = 1800;
      const e = ctx.createGain(); e.gain.value = level;
      last.connect(d); d.connect(dark); dark.connect(f); f.connect(d);
      dark.connect(e); e.connect(out); dark.connect(conv);
    }
    out.connect(dest);
    return (this.chains[speaker] = { input, out });
  }
  /** Start a line now (any line still playing is cut). Returns its handle. */
  play(id) {
    this.stop();
    const l = this.lines[id];
    if (!l) return null;
    const st = this.style(id), b = this.buffers[id], ctx = this.audio.context;
    const h = { id, speaker: l.speaker, text: l.text, dur: this.duration(id), t: 0, audible: false, done: false };
    if (b && ctx && ctx.state !== 'closed') {
      try {
        const src = ctx.createBufferSource();
        src.buffer = b.buf; src.playbackRate.value = st.rate;
        src.connect(this.chain(l.speaker).input);
        src.start();
        src.onended = () => src.disconnect();
        h.src = src; h.t0 = ctx.currentTime; h.audible = ctx.state === 'running';
      } catch (e) { console.info('[niumo] voice play failed', e); }
    }
    this.ui.speak?.(st.name, l.text, l.speaker, l.en || '');
    this.cur = h; this.duckT = 0;
    this.log.push({ id, speaker: l.speaker, dur: +h.dur.toFixed(2), audible: h.audible, at: +(performance.now() / 1000).toFixed(2) });
    this.update(0);
    return h;
  }
  /** A battle shout over the action: no subtitle, no ducking, never cuts a spoken line (ids flagged shout in the manifest). */
  shout(id, { gain = 0.8, rate = 1 } = {}) {
    const b = this.buffers[id], ctx = this.audio.context;
    if (!b || !ctx || ctx.state !== 'running' || this.cur) return false;
    try {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = b.buf; src.playbackRate.value = rate; g.gain.value = gain;
      src.connect(g); g.connect(this.chain('monkey').input);
      src.start();
      src.onended = () => { src.disconnect(); g.disconnect(); };
      return true;
    } catch { return false; }
  }
  get busy() { return !!this.cur; }
  /** Cut the current line (a skip). */
  stop() {
    const h = this.cur;
    if (!h) return;
    try { h.src?.stop(); } catch { /* already stopped */ }
    this.finish(h);
  }
  finish(h) {
    h.done = true;
    if (this.cur === h) { this.cur = null; this.ui.speak?.('', ''); }
  }
  update(dt) {
    const h = this.cur;
    if (!h) return;
    const ctx = this.audio.context;
    h.t = h.src && ctx ? ctx.currentTime - h.t0 : h.t + dt;
    if (h.t >= h.dur) { this.finish(h); return; }
    // hold the music down under the voice (short ducks, renewed)
    if ((this.duckT -= dt) <= 0) { this.duckT = 0.25; this.audio.duck?.(this.style(h.id).duck, 0.9); }
  }
}

// ------------------------------------------------------------------ the monkey's cinematic poses and moves

const k = (t, o) => ({ t, ...o });
// 扛着铁棒: the rod over the right shoulder, the long end behind; the free arm keeps most of the walk's own swing
const CARRY = {
  armR: { at: [0.1, -0.2, 0.46], pole: [0.75, -0.65, 0.0] }, blade: [0.12, 0.5, -0.86], grip: 1,
  armL: { at: [-0.14, -0.9, 0.1], pole: [-0.5, -0.4, -0.6], w: 0.3 },
  spine: [3, 0, 0], head: [2, 0, 0], hips: [0, 0, 0],
};
// the rod planted upright beside him, the fist high on it; chin up at the giant
const PLANT = {
  armR: { at: [0.3, -0.56, 0.3], pole: [0.8, -0.4, -0.3] }, blade: [0.04, 1, 0.03], grip: 1,
  armL: { at: [-0.16, -0.92, 0.04], pole: [-0.5, -0.4, -0.6], w: 0.8 },
  head: [-24, 0, 0], spine: [-6, 0, 0], hips: [0, 0, 0],
};
// the same, the head a little to one side: listening, unimpressed
const PLANT_TILT = { ...PLANT, head: [-20, -10, 9], spine: [-4, -6, 2] };
// 「来拿。」: the rod levelled up at the giant's face, the free hand back, chin up
const POINT = {
  armR: { at: [0.18, 0.12, 0.84], pole: [0.7, -0.6, 0.0] }, blade: [0.04, 0.42, 0.9], grip: 1,
  armL: { at: [-0.24, -0.8, -0.16], pole: [-0.6, -0.3, -0.6], w: 1 },
  head: [-16, 0, 0], spine: [-4, -10, 0], hips: [0, -0.05, 0.03],
};
// low guard: weight down, the rod along the forearm toward his shins, the open left hand forward
const STANCE = {
  hips: [0, -0.2, -0.02], spine: [14, -20, 0], head: [-18, 16, 0],
  armR: { at: [0.34, -0.5, 0.08], pole: [0.7, -0.5, -0.3] }, blade: [-0.2, 0.22, 0.95], grip: 1,
  armL: { at: [-0.16, -0.16, 0.72], pole: [-0.7, -0.5, -0.2], hand: [0, 0.6, 0.6], w: 1 }, gripL: 0,
};
// after the leap: one knee and one hand on the stone, the rod swept out behind, eyes on the giant
const SKID = {
  pivot: { roll: 0, pitch: 0, y: 0 }, hips: [0, -0.44, -0.04], spine: [30, 10, 0], head: [-30, -8, 0],
  legL: { at: [-0.3, -0.52, 0.34], pole: [-0.3, 0.2, 1] }, legR: { at: [0.26, -0.62, -0.52], pole: [0.2, -0.2, 1] },
  armL: { at: [-0.2, -0.9, 0.36], pole: [-0.7, -0.2, -0.4], hand: [0, -0.3, 1], w: 1 }, gripL: 0.85,   // a loose fist on the knee (the model's open fingers splay like a claw)
  armR: { at: [0.56, -0.22, -0.36], pole: [0.6, -0.5, -0.4] }, blade: [0.6, 0.28, -0.75], grip: 1,
};
// sitting on the horn: thighs forward, shins hanging, the staff across the lap, face lifted a little to the rain
const SIT = {
  hips: [0, -0.52, -0.1], spine: [12, 0, 0], head: [-14, 0, 0],
  legL: { at: [-0.16, -0.6, 0.52], pole: [0, 0.3, 1] }, legR: { at: [0.14, -0.8, 0.34], pole: [0, 0.3, 1] },
  armR: { at: [0.1, -0.6, 0.52], pole: [0.6, -0.6, -0.2] }, armL: { at: [-0.08, -0.64, 0.48], pole: [-0.6, -0.6, -0.2] },
  blade: [-0.97, -0.14, 0.18], grip: 1, gripL: 0.6,
};
const HOLD = 1e4;      // a pose held until the scene moves on
export const CINE_MOVES = {
  cineCarry: { blendIn: 0.35, blendOut: 0.3, keys: [k(0, CARRY), k(HOLD, CARRY)] },
  cineSit: { blendIn: 0.01, blendOut: 0.01, keys: [k(0, SIT), k(HOLD, SIT)] },
  cineLookUp: { blendIn: 0.6, blendOut: 0.3, keys: [k(0, PLANT), k(HOLD, PLANT)] },
  cineTilt: { blendIn: 0.5, blendOut: 0.4, keys: [k(0, PLANT), k(1.1, { ease: 'inOut', ...PLANT_TILT }), k(HOLD, PLANT_TILT)] },
  // 一棒问山: he stops, swings the rod off his shoulder and brings its foot down on the stone (impactAt), then stands by it
  cineKnock: {
    blendIn: 0.2, blendOut: 0.3, impactAt: 0.62,
    keys: [
      k(0, CARRY),
      k(0.4, { ease: 'windup', armR: { at: [0.3, 0.5, 0.36], pole: [0.8, -0.2, -0.4] }, blade: [0.05, 1, 0.1], spine: [-8, 10, 0], head: [-12, 0, 0],
        armL: { at: [-0.2, -0.86, -0.06], pole: [-0.5, -0.4, -0.6], w: 0.8 } }),
      k(0.62, { ease: 'in', armR: { at: [0.3, -0.62, 0.3], pole: [0.8, -0.4, -0.3] }, blade: [0.04, 1, 0.03], spine: [10, 0, 0], head: [-6, 0, 0], hips: [0, -0.08, 0.01] }),
      k(0.8, { ease: 'out', spine: [6, 0, 0], hips: [0, -0.05, 0] }),
      k(1.9, { ease: 'inOut', ...PLANT }),
      k(HOLD, PLANT),
    ],
  },
  // 「这回不借。来拿。」: the rod comes off the ground, wheels once at his side and stops dead, levelled at the giant
  cinePoint: {
    blendIn: 0.12, blendOut: 0.4, snapAt: 0.78,
    keys: [
      k(0, PLANT),
      k(0.2, { ease: 'out', armR: { at: [0.36, -0.34, 0.3], pole: [0.75, -0.5, -0.3] }, blade: [0.3, 0.9, -0.32], spine: [-4, 8, 0] }),
      k(0.36, { ease: 'linear', armR: { at: [0.4, -0.3, 0.2], pole: [0.75, -0.5, -0.3] }, blade: [0.42, 0.0, -0.9], spine: [0, 16, 0], head: [-18, -8, 0] }),
      k(0.5, { ease: 'linear', blade: [0.3, -0.92, -0.25], hips: [0, -0.06, 0] }),
      k(0.62, { ease: 'linear', armR: { at: [0.3, -0.2, 0.5], pole: [0.7, -0.6, -0.2] }, blade: [0.12, -0.5, 0.86], spine: [2, 6, 0] }),
      k(0.78, { ease: 'snap', ...POINT }),
      k(0.95, { ease: 'out', armR: { at: [0.18, 0.1, 0.82], pole: [0.7, -0.6, 0.0] }, blade: [0.04, 0.4, 0.91] }),
      k(HOLD, POINT),
    ],
  },
  // 「骨头正痒。」: he sinks into the low guard
  cineStance: { blendIn: 0.3, blendOut: 0.25, keys: [k(0, POINT), k(0.7, { ease: 'inOut', ...STANCE }), k(HOLD, STANCE)] },
  // the leap out from under the staff: a sideways aerial (the scene moves the root and sets the roll's sign), landing
  // low with a hand down (the skid)
  cineDodge: {
    blendIn: 0.05, blendOut: 0.3, airFrom: 0.14, landAt: 0.74,
    keys: [
      k(0, { ...STANCE, pivot: { roll: 0, pitch: 0, y: 0 } }),
      k(0.14, { ease: 'out', hips: [0, -0.34, 0], spine: [26, -8, 0], head: [-10, 10, 0],
        armR: { at: [0.4, -0.4, 0.1], pole: [0.7, -0.5, -0.3] }, blade: [0.5, 0.5, -0.7], armL: { at: [-0.3, -0.4, 0.3], pole: [-0.7, -0.5, -0.2], w: 1 } }),
      k(0.3, { ease: 'out', pivot: { roll: 70, pitch: 0, y: 0 }, hips: [0, 0, 0], spine: [18, 0, 0], head: [6, 0, 0],
        legL: { at: [-0.1, -0.5, 0.32], pole: [0, 0, 1] }, legR: { at: [0.1, -0.56, 0.12], pole: [0, 0, 1] },
        armR: { at: [0.5, 0.1, 0.1], pole: [0.6, -0.5, -0.4] }, blade: [0.7, 0.6, -0.4], armL: { at: [-0.5, 0.2, 0.2], pole: [-0.6, -0.5, -0.3], w: 1 } }),
      k(0.5, { ease: 'linear', pivot: { roll: 215, pitch: 0, y: 0 } }),
      k(0.66, { ease: 'linear', pivot: { roll: 320, pitch: 0, y: 0 },
        legL: { at: [-0.2, -0.7, 0.2], pole: [-0.2, 0, 1] }, legR: { at: [0.2, -0.8, -0.2], pole: [0.2, 0, 1] } }),
      k(0.78, { ease: 'out', ...SKID, pivot: { roll: 360, pitch: 0, y: 0 } }),
      k(HOLD, { ...SKID, pivot: { roll: 360, pitch: 0, y: 0 } }),
    ],
  },
  // 「法相天地！」: the rod thrust at the sky, the free arm thrown wide, the head back
  cineSummon: {
    blendIn: 0.25, blendOut: 0.4,
    keys: [
      k(0, PLANT),
      k(0.45, { ease: 'out', hips: [0, -0.1, 0], spine: [10, 0, 0], head: [-6, 0, 0], armR: { at: [0.3, -0.3, 0.4], pole: [0.8, -0.4, -0.3] }, blade: [0.1, 0.9, 0.3] }),
      k(0.8, { ease: 'snap', hips: [0, 0, 0], spine: [-12, 0, 0], head: [-34, 0, 0], armR: { at: [0.16, 0.92, 0.06], pole: [0.8, 0.1, -0.5] }, blade: [0.0, 1, 0.02],
        armL: { at: [-0.72, -0.2, 0.1], pole: [-0.5, -0.6, -0.5], hand: [-0.6, 0.6, 0.3], w: 1 }, gripL: 0 }),
      k(HOLD, {}),
    ],
  },
  // out of the skid, up into the fighting stance
  cineRise: { blendIn: 0.01, blendOut: 0.5, keys: [k(0, SKID), k(0.9, { ease: 'inOut', ...STANCE, legL: { at: [-0.1, -0.95, 0.06], pole: [0, 0, 1], w: 0 }, legR: { at: [0.1, -0.95, -0.06], pole: [0, 0, 1], w: 0 } }), k(HOLD, STANCE)] },
};
for (const mv of Object.values(CINE_MOVES)) mv.track_ = new PoseTrack(mv.keys, {});

// the bull's cinematic moves (lent to his actor the same way; SEAT comes from his own library)
/** The seated roar that answers the monkey: the head goes back, the chest opens, the free hand claws the air. */
export function bullCineMoves(SEAT) {
  const m = {
    cineRoar: {
      blendIn: 0.25, blendOut: 0.6, roarAt: 0.55,
      keys: [
        k(0, SEAT),
        k(0.5, { ease: 'windup', spine: [20, 0, 0], head: [22, 0, 0] }),
        k(1.05, { ease: 'out', spine: [-18, 0, 0], head: [-42, 0, 0],
          armL: { at: [-0.7, 0.1, 0.4], pole: [-0.6, -0.5, -0.6], hand: [-0.2, 0.6, 0.6] }, gripL: 0.6 }),
        k(2.3, { ease: 'linear', spine: [-20, 0, 2], head: [-46, 4, 0] }),
        k(3.0, { ease: 'inOut', ...SEAT }),
      ],
    },
  };
  for (const mv of Object.values(m)) mv.track_ = new PoseTrack(mv.keys, {});
  return m;
}

/** Let an actor use cinematic moves (its own library stays underneath); returns the restore function. */
export function lendCineMoves(actor, moves = CINE_MOVES) {
  const own = actor.lib;
  actor.lib = Object.assign(Object.create(own || null), moves);
  return () => { if (actor.move && actor.move.name in moves) actor.stopMove(); actor.lib = own; };
}
/** Hold a cinematic pose or play a cinematic move once and stay on its last pose (starts it if it is not the current one). */
export function holdPose(actor, name) {
  if (!actor.move || actor.move.name !== name) { actor.stopMove(); actor.startMove(name); }
  if (actor.move.t > 60) actor.move.t = 60;
  return actor.move;
}
/** Where the right fist holds the rod (fraction of its length from the foot): the cinematics slide it like the fight does. */
export function setStaffSlide(staff, slide) {
  const ud = staff && staff.userData;
  if (!ud) return;
  ud.gripFrac = slide;
  if (ud.inner && ud.baseGf !== undefined) ud.inner.position.y = ud.baseY - (slide - ud.baseGf) * ud.length;
}
const baseClip = (actor, ...names) => names.find(n => actor.actions[n]) || Object.keys(actor.actions)[0];

// ------------------------------------------------------------------ shared scene plumbing

class Scene {
  constructor(o) {
    Object.assign(this, o);
    this.t = 0; this.done = false; this.running = true; this.fired = new Set();
    this.bf = bullFrame(this.bull, this.G.chars.bull);
    this.dof = null; this.post = {}; this.black = 0;
    this.restoreMoves = lendCineMoves(this.actor);
    this.ui.letterbox(true);
    this.ui.setHint('Enter 跳过');
  }
  once(key, at, fn) { if (this.t >= at && !this.fired.has(key)) { this.fired.add(key); fn(); } }
  /** Debug (tools/cine_shot.mjs): run silently up to time t of the scene. */
  seek(t) {
    this.seeking = true;
    for (let i = 0; i < 6000 && this.t < t && !this.done; i++) this.update(1 / 30);
    this.seeking = false;
  }
  setEyes(k) { this.G.setEyes(k); }
  /**
   * The scene's spoken lines, this.script = [{ id, at }]: each starts at `at` at the earliest, and never before the
   * line before it has finished (plus a breath). talking is true until the last one has been spoken.
   */
  speak(t) {
    const v = this.G.voice, sc = this.script;
    if (!v || !sc) return;
    this.si = this.si || 0;
    if (this.seeking) { while (sc[this.si] && t >= sc[this.si].at) this.said = sc[this.si++].id; return; }
    if (v.busy) { this.quietT = 0; return; }
    this.quietT = (this.quietT ?? 1) + (t - (this.lastT ?? t));
    this.lastT = t;
    const next = sc[this.si];
    if (next && t >= next.at && this.quietT >= 0.35) { v.play(next.id); this.said = next.id; this.si++; this.quietT = 0; }
  }
  get talking() { return !!this.script && ((this.si || 0) < this.script.length || !!this.G.voice?.busy); }
  hush() { if (this.script && this.G.voice?.cur && this.script.some(l => l.id === this.G.voice.cur.id)) this.G.voice.stop(); }
  shake(k) { this.track?.jolt(k); this.arena.shake?.(k); }
  dofFor(info, ap = 0.002) {
    const s = info.shot;
    this.dof = { focus: s.focus ? (typeof s.focus === 'function' ? s.focus() : s.focus) : info.dist, aperture: s.ap ?? ap, maxblur: s.blur ?? 0.01 };
  }
  end(skipped) {
    if (this.done) return;
    this.done = true; this.running = false;
    if (skipped) this.hush();
    this.restoreMoves();
    this.ui.letterbox(false);
    this.ui.setHint('');
    this.dof = null; this.post = {}; this.black = 0;
    this.onDone?.(skipped);
  }
}

/** Push the monkey out of the giant's body circles (bull.colliders(): body, knees / feet, resting hands). */
function clearOfBull(monkey, bull) {
  const circles = typeof bull.colliders === 'function' ? bull.colliders() : [];
  for (let pass = 0; pass < 3; pass++) {
    for (const c of circles) {
      const dx = monkey.pos.x - c.x, dz = monkey.pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + 0.6;
      if (d < m) { const nx = d > 1e-4 ? dx / d : 0, nz = d > 1e-4 ? dz / d : 1; monkey.pos.x = c.x + nx * m; monkey.pos.z = c.z + nz * m; }
    }
  }
}

// ------------------------------------------------------------------ 山崩

export class CollapseScene extends Scene {
  // 山崩. The beats follow bull.js's own 'rise' move (it plays its own sounds and bursts): the roar ~0.6 s, the hands
  // come down ~3.6 s, the legs are drawn out of the rock, the deep squat, standing tall ~8.6 s. This scene adds the
  // monkey's place in it, the camera, the mountain splitting behind him (the arena's phase two), its lava fountains, the
  // music change:
  //   1  ROAR     low in front: the gold face goes back against the sky
  //   2  SPLIT    from the ground behind the monkey: the mountain behind the giant opens, fire goes up, he bends
  //   3  HAND     a hand the size of a house pressed into the stone as he tears his legs out of the rock
  //   4  RISE     from the hooves up, as he stands: forty metres of him against the evening
  //   5  ANSWER   behind the monkey, the standing giant over him; then the gold mask, close: 「倒下去，才响。」
  //   6  SWEEP    the answer to that: he drops into a crouch and takes the staff across the floor; the last of it in
  //               slow motion, the staff a wall coming at the monkey
  //   7  FLUNG    it takes him: he is thrown the width of the field and ploughs into the ash
  //   8  DOWN     from the ground behind the fallen monkey, the giant over him: 「响的，是你。」
  //   9  RISE     the gold mask comes up off the stone; he plants the rod: 「论大小，俺老孙也会。」
  //  10  法相天地  the rod goes up at the sky and he grows, the camera falling back and up to keep him: thirty metres
  //  11  FACE     the two of them in profile across the lake of fire, the low sun between them. The fight is theirs.
  constructor(o) {
    super(o);
    const { bf } = this;
    const F = bf.F.clone(), R = bf.R.clone(), seat = this.bull.pos.clone();
    // the monkey's place for the scene: back out of reach of the hands and the hooves, on rock that will still be
    // there when the floor has gone (the first shot is on the giant: nobody sees him step back)
    const m = this.monkey.pos, away = V(m.x - seat.x, 0, m.z - seat.z);
    if (away.dot(F) < 6 || away.lengthSq() < 1) away.copy(F).multiplyScalar(26).addScaledVector(R, away.dot(R) * 0.5);
    const dist = Math.max(27, Math.min(34, away.length()));
    away.normalize().multiplyScalar(dist);
    const p = safeSpot(this.arena, seat.x + away.x, seat.z + away.z, true);
    this.mpos = V(p.x, this.arena.groundY ? this.arena.groundY(p.x, p.z) : m.y, p.z);
    const keep = { hp: this.monkey.hp, st: this.monkey.st, mp: this.monkey.mp };
    this.monkey.reset?.({ x: this.mpos.x, z: this.mpos.z, yaw: Math.atan2(seat.x - this.mpos.x, seat.z - this.mpos.z) });
    Object.assign(this.monkey, keep);                 // (reset() is only for the footing: his wounds stay)
    const head = () => bf.head();
    // the hand on the monkey's side, seen from his side of it
    const hSide = V(this.mpos.x - seat.x, 0, this.mpos.z - seat.z).dot(R) > 0 ? 'Right' : 'Left';
    const hand = () => bf.hand(hSide);
    const foot = () => bf.foot('Left');
    const mHead = () => this.actor.bonePos('Head', V());
    const H = bf.H;
    this.duration = 10.6;
    const lerp = THREE.MathUtils.lerp, OPEN = 1e9;
    // 4: from the hoof up to the gold face, as he stands
    const climb = f => {
      const fo = foot(), hd = head();
      const lookY = lerp(fo.y + 1.5, hd.y + H * 0.04, ease.inOut(f));
      return V(lerp(fo.x, hd.x, f), lookY, lerp(fo.z, hd.z, f));
    };
    this.track = new ShotTrack([
      // 1 he throws his head back and roars at the sky
      { t0: 0, t1: 2.5, e: 'out', ap: 0.0006, shake: 0.4,
        from: { pos: seat.clone().addScaledVector(F, 27).addScaledVector(R, -6).setY(1.8), look: () => head().addScaledVector(bf.U, -2), fov: 36 },
        to: { pos: seat.clone().addScaledVector(F, 25).addScaledVector(R, -5).setY(1.6), look: () => head(), fov: 31 } },
      // 2 from the ground behind the monkey: the mountain behind the giant splits, the lava comes up; he bends and plants his hands
      { t0: 2.5, t1: 4.8, e: 'linear', ap: 0.0006, shake: 0.6, focus: () => this.camera.position.distanceTo(this.mpos) + 2,
        from: { pos: () => this.behind(3.6, 1.2, 0.42), look: () => this.mpos.clone().lerp(seat, 0.75).setY(6.5), fov: 62 },
        to: { pos: () => this.behind(3.1, 1.05, 0.38), look: () => this.mpos.clone().lerp(seat, 0.75).setY(8.5), fov: 66 } },
      // 3 a longer lens past the monkey: the hands pressed into the stone, the legs coming out of the rock
      { t0: 4.8, t1: 7.0, e: 'inOut', ap: 0.0014, shake: 0.5, focus: () => this.camera.position.distanceTo(hand()),
        from: { pos: () => this.behind(8.5, -2.6, 1.5), look: () => hand().lerp(head(), 0.3), fov: 36 },
        to: { pos: () => this.behind(7.5, -2.3, 1.3), look: () => hand().lerp(head(), 0.42), fov: 39 } },
      // 4 from the hooves to the gold face against the evening: he stands
      { t0: 7.0, t1: 10.6, e: 'linear', ap: 0.0004, shake: 0.25,
        from: { pos: () => foot().addScaledVector(F, 28).addScaledVector(R, -9).setY(1.2), look: () => climb(0), fov: 50 },
        to: { pos: () => foot().addScaledVector(F, 33).addScaledVector(R, -10).setY(2.6), look: () => climb(1), fov: 58 } },
      // 5a the monkey, low behind him: the standing giant towers over him
      { t0: 10.6, t1: 12.9, e: 'out', ap: 0.0012, blur: 0.009, focus: () => this.camera.position.distanceTo(this.mpos) + 0.4,
        from: { pos: () => this.behind(3.0, 0.9, 0.45), look: () => this.reactLook(0), fov: 58 },
        to: { pos: () => this.behind(2.5, 0.9, 0.55), look: () => this.reactLook(1), fov: 54 } },
      // 5b the gold mask, close and from below, the sky behind it (「站起来好。倒下去，才响。」)
      { name: 'answer', t0: 12.9, t1: 1e9, dur: 4.5, e: 'out', ap: 0.004, blur: 0.013, focus: () => this.camera.position.distanceTo(mHead()),
        from: { pos: () => this.front(1.9, -1.15, 0.8), look: () => mHead().add(V(0, -0.06, 0)), fov: 30 },
        to: { pos: () => this.front(1.55, -0.95, 0.88), look: () => mHead().add(V(0, -0.03, 0)), fov: 25 } },
      // 6 the sweep: on the ground on the far side of him, the staff coming across the floor like a wall
      { name: 'sweep', t0: OPEN, t1: OPEN, e: 'out', ap: 0.0006, shake: 0.3, focus: () => this.camera.position.distanceTo(this.mpos) + 1,
        from: { pos: () => this.mpos.clone().addScaledVector(this.toBull(), -4.6).addScaledVector(this.fl, 2.6).add(V(0, 0.55, 0)), look: () => this.mpos.clone().addScaledVector(this.toBull(), 7).addScaledVector(this.fl, -5).add(V(0, 4.2, 0)), fov: 64 },
        to: { pos: () => this.mpos.clone().addScaledVector(this.toBull(), -3.6).addScaledVector(this.fl, 2.2).add(V(0, 0.45, 0)), look: () => this.mpos.clone().addScaledVector(this.toBull(), 6).addScaledVector(this.fl, -3).add(V(0, 3.0, 0)), fov: 60 } },
      // 7 thrown: side on to his flight, the giant beyond
      { name: 'flung', t0: OPEN, t1: OPEN, e: 'out', ap: 0.0008, shake: 0.5,
        from: { pos: () => this.flyCam(0), look: () => this.actor.root.position.clone().add(V(0, 0.9, 0)), fov: 46 },
        to: { pos: () => this.flyCam(1), look: () => this.actor.root.position.clone().add(V(0, 0.7, 0)), fov: 40 } },
      // 8 down: from the ground behind the fallen monkey, the giant over him
      { name: 'down', t0: OPEN, t1: OPEN, e: 'inOut', ap: 0.0012, blur: 0.01, shake: 0.06, focus: () => this.camera.position.distanceTo(this.mpos) + 0.3,
        from: { pos: () => this.behind(2.9, 0.9, 0.34), look: () => this.mpos.clone().lerp(head(), 0.2), fov: 56 },
        to: { pos: () => this.behind(2.4, 0.7, 0.3), look: () => this.mpos.clone().lerp(head(), 0.24), fov: 52 } },
      // 9 he gets up: the gold mask, close, coming up off the stone
      { name: 'rise', t0: OPEN, t1: OPEN, e: 'inOut', ap: 0.004, blur: 0.013, focus: () => this.camera.position.distanceTo(mHead()),
        from: { pos: () => this.front(1.7, 1.0, 0.3), look: () => mHead().add(V(0, -0.05, 0)), fov: 32 },
        to: { pos: () => this.front(1.5, 0.8, 0.62), look: () => mHead().add(V(0, -0.03, 0)), fov: 27 } },
      // 10 法相天地: the camera falls back and up with him as he grows
      { name: 'grow', t0: OPEN, t1: OPEN, e: 'linear', ap: 0.0003, shake: 0.45,
        from: { pos: () => this.growCam(), look: () => this.mpos.clone().add(V(0, 1.5 * this.monkey.S * 0.6, 0)), fov: 36 },
        to: { pos: () => this.growCam(), look: () => this.mpos.clone().add(V(0, 1.5 * this.monkey.S * 0.6, 0)), fov: 46 } },
      // 11 the two of them in profile, the sun between them
      { name: 'face', t0: OPEN, t1: OPEN, e: 'out', ap: 0.0002, shake: 0.1,
        from: { pos: () => this.faceCam(0), look: () => this.mpos.clone().lerp(this.bull.pos, 0.5).setY(18), fov: 60 },
        to: { pos: () => this.faceCam(1), look: () => this.mpos.clone().lerp(this.bull.pos, 0.5).setY(19), fov: 60 } },
    ]);
    // where the sweep throws him: toward the giant's left (the way the staff travels) and away, onto rock that will stand
    // (the place he lands is where the next three shots are staged: open ground, nothing standing between it and the giant)
    {
      const b = this.arena.bounds, cols = this.arena.colliders || [], lava = this.arena.lavaAt || (() => 0);
      const base = R.clone().multiplyScalar(-0.82).addScaledVector(F, 0.5).normalize(), ba = Math.atan2(base.x, base.z);
      const bp = this.bull.pos.clone().addScaledVector(F, 0.5 * (this.bull.legLen || 15));      // where he will stand
      let best = null;
      for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.9, 1.2, -0.9]) for (const dist of [17, 14, 20, 11]) {
        const dir = V(Math.sin(ba + da), 0, Math.cos(ba + da)), q = this.mpos.clone().addScaledVector(dir, dist), end = q.clone().addScaledVector(dir, 2.6);
        if (b && (end.x < b.minX + 5 || end.x > b.maxX - 5 || end.z < b.minZ + 5 || end.z > b.maxZ - 5)) continue;
        if (lava(end.x, end.z, 1) > 0.2 || lava(q.x, q.z, 1) > 0.2) continue;
        const toB = bp.clone().sub(end).setY(0), L = toB.length();
        if (L < 20) continue;
        toB.normalize();
        // clear of the standing stones around it, and along the first stretch of the line to the giant
        let clear = 99;
        for (const k of cols) {
          const rel = V(k.x - end.x, 0, k.z - end.z), along = THREE.MathUtils.clamp(rel.dot(toB), -3, 14);
          clear = Math.min(clear, rel.addScaledVector(toB, -along).length() - k.r);
        }
        const score = Math.min(clear, 6) - Math.abs(da) * 1.5 - Math.abs(dist - 17) * 0.1;
        if (!best || score > best.score) best = { score, dir, q };
      }
      if (best) { this.fl = best.dir; this.land = best.q.setY(0); }
      else { this.fl = base; const sp = safeSpot(this.arena, this.mpos.x + base.x * 14, this.mpos.z + base.z * 14, true); this.land = V(sp.x, 0, sp.z); }
    }
    this.from = this.mpos.clone();
    this.act = null; this.at = 0; this.rate = 1;
    const ud = this.G.staffs.monkey.userData;
    this.slide0 = ud.baseGf ?? ud.gripFrac ?? 0.3; this.slide = this.slide0;
    this.actor.playBase(baseClip(this.actor, 'idle'), { fade: 0.3 });
    holdPose(this.actor, 'cineStance');
    // 牛魔王 as he tears himself out of the rock; the monkey answers when he stands
    this.script = [{ id: 'p1', at: 4.7 }, { id: 'p2', at: 10.9 }];
  }
  toBull() { return V(this.bull.pos.x - this.mpos.x, 0, this.bull.pos.z - this.mpos.z).normalize(); }
  /** A point behind the monkey (away from the giant): back, to his right, up. */
  behind(back, side, up) {
    const d = this.toBull(), s = V(-d.z, 0, d.x);
    return this.mpos.clone().addScaledVector(d, -back).addScaledVector(s, side).setY(this.mpos.y + up);
  }
  /** A point in front of him, toward the giant. */
  front(fwd, side, up) {
    const d = this.toBull(), s = V(-d.z, 0, d.x);
    return this.mpos.clone().addScaledVector(d, fwd).addScaledVector(s, side).setY(this.mpos.y + up);
  }
  reactLook(f) {
    // a fixed tilt up past him (the giant is close and enormous: aiming at his head would lose the monkey)
    return this.mpos.clone().addScaledVector(this.toBull(), 8).setY(this.mpos.y + 1.3 + THREE.MathUtils.lerp(3.6, 4.6, f));
  }
  shot(name) { return this.track.shots.find(s => s.name === name); }
  /** Cut to a named shot now, for `dur` seconds (the one running ends here). */
  cutTo(name, dur) {
    const cur = this.track.at(this.t), s = this.shot(name);
    if (!s || cur === s) return;
    if (cur.t1 > this.t) cur.t1 = this.t;
    s.t0 = this.t; s.t1 = 1e9; s.dur = dur;
  }
  groundAt(p) { return this.arena.groundY ? this.arena.groundY(p.x, p.z) : 0; }
  /** Side on to his flight, on the side away from the giant (so the giant stands behind it). */
  flyCam(f) {
    const mid = this.from.clone().lerp(this.land, 0.55), perp = V(this.fl.z, 0, -this.fl.x);
    if (perp.dot(this.bf.F) < 0) perp.negate();
    return mid.addScaledVector(perp, THREE.MathUtils.lerp(10.5, 9, f)).addScaledVector(this.fl, THREE.MathUtils.lerp(-2, 3, f)).setY(this.groundAt(mid) + THREE.MathUtils.lerp(4.6, 3.6, f));
  }
  /** In front of him and to one side, at a distance and a height that grow with him. */
  growCam() {
    const S = this.monkey.S, d = this.toBull(), s = V(-d.z, 0, d.x);
    const dir = d.clone().multiplyScalar(0.72).addScaledVector(s, 0.69).normalize();
    const p = this.mpos.clone().addScaledVector(dir, 2.4 + 2.3 * (S - 1));
    const b = this.arena.cameraBlockers?.bounds;
    if (b) { p.x = THREE.MathUtils.clamp(p.x, b.minX + 1, b.maxX - 1); p.z = THREE.MathUtils.clamp(p.z, b.minZ + 1, b.maxZ - 1); }
    return p.setY(this.mpos.y + 0.5 + 0.56 * (S - 1));
  }
  /** Square on to the line between them, on the side of the caldera with the more room; { pos, fov } to hold them both. */
  faceShot() {
    if (this.faceS) return this.faceS;
    const mid = this.mpos.clone().lerp(this.bull.pos, 0.5), d = this.toBull(), perp = V(-d.z, 0, d.x);
    const sep = Math.hypot(this.bull.pos.x - this.mpos.x, this.bull.pos.z - this.mpos.z);
    const b = this.arena.cameraBlockers?.bounds;
    const at = sgn => {
      const p = mid.clone().addScaledVector(perp, sgn * 60);
      if (b) { p.x = THREE.MathUtils.clamp(p.x, b.minX + 1, b.maxX - 1); p.z = THREE.MathUtils.clamp(p.z, b.minZ + 1, b.maxZ - 1); }
      return { p, dist: Math.abs(p.clone().sub(mid).dot(perp)) };
    };
    const a = at(1), z = at(-1), pick = a.dist >= z.dist ? a : z;
    const hfov = 2 * Math.atan((sep / 2 + 24) / Math.max(pick.dist, 10));
    const fov = THREE.MathUtils.clamp(2 * Math.atan(Math.tan(hfov / 2) / (this.camera.aspect || 1.78)) * 180 / Math.PI, 42, 84);
    return (this.faceS = { pos: pick.p, fov, mid });
  }
  faceCam(f) { const s = this.faceShot(); return s.pos.clone().lerp(s.mid, 0.04 * f).setY(THREE.MathUtils.lerp(7, 9, f)); }
  /** A spoken line outside the scene's own script (the second half's lines are tied to its action). */
  say(id) {
    const v = this.G.voice;
    this.said = id;
    if (this.seeking || !v) return 2.2;
    v.play(id);
    return v.duration(id) || 2.2;
  }
  go(act) { this.act = act; this.at = 0; }

  /** The second half: the sweep, the fall, 法相天地 (see the header). Returns the pose the monkey holds. */
  second(dt, wdt) {
    const t = this.t, bull = this.bull, a = this.actor, fx = this.G.fx, M = this.monkey;
    const v = this.G.voice;
    this.at += dt;
    this.rate = 1;
    if (!this.act) {
      // when he has had his word (「倒下去，才响。」) and a breath after it
      const answered = (this.said === 'p2' && !(v && v.busy)) || this.seeking;
      if (t >= 13.4 && ((answered && (this.quietT ?? 0) > 0.45) || t > 19)) {
        this.go('sweep');
        this.cutTo('sweep', 2.6);
        bull.aimYaw = THREE.MathUtils.clamp(bull.relAngle(this.mpos), -1, 1);
        bull.playMove('sweepLow', { aim: true, speed: 1.6 });          // (2026-11-16 user: the sweep has to come faster)
        this.audio.play('staff_swing', { pos: this.bf.head(), volume: 0.9, pitch: 0.4 });
      }
      return this.said === 'p2' && this.answerT !== undefined && t - this.answerT > 0.35 ? 'cinePoint' : 'cineStance';
    }
    const mv = bull.a.move, bt = mv && mv.name === 'sweepLow' ? mv.t : 99;
    switch (this.act) {
      case 'sweep': {
        const hitAt = (mv && mv.def.contactAt) || 1.62;
        if (bt > hitAt - 0.2) this.rate = 0.5;                       // only the very end slows, and not by much
        if (bt >= hitAt - 0.03 || this.at > 6) {
          // it takes him
          this.go('fly'); this.cutTo('flung', 1.9);
          a.stopMove(); a.startMove('knockdown');
          this.audio.play('staff_hit_heavy', { pos: this.mpos, volume: 1, pitch: 0.6 });
          this.audio.play('player_hurt', { pos: this.mpos, volume: 0.9 });
          this.G.flash = Math.max(this.G.flash, 0.22); this.G.aberr = 1; this.G.hurt = 0.8;
          this.shake(1.0);
          fx.dust?.(this.mpos.clone(), 2.2, 40);
          fx.hitSpark?.(this.mpos.clone().add(V(0, 0.9, 0)), this.fl, true);
        }
        return 'cineStance';
      }
      case 'fly': {
        const dur = 1.05, u = clamp01(this.at / dur);
        this.rate = THREE.MathUtils.lerp(0.55, 1, smooth(0.03, 0.25, this.at));
        if (u < 1) {
          this.mpos.copy(this.from).lerp(this.land, u);
          this.mpos.y = THREE.MathUtils.lerp(this.groundAt(this.from), this.groundAt(this.land), u) + 4 * 4.2 * u * (1 - u);
          this.spin = u * Math.PI * 3;
        } else {
          this.once('landed', 0, () => {
            this.shake(0.8); this.audio.play('bull_slam', { pos: this.land, volume: 0.6, pitch: 1.5 });
            fx.dust?.(this.land.clone(), 2.6, 46); this.arena.eruption?.(this.land.x, this.land.z, 0.35);
          });
          const k = ease.out(clamp01((this.at - dur) / 0.7));
          this.mpos.copy(this.land).addScaledVector(this.fl, 2.6 * k); this.mpos.y = this.groundAt(this.mpos);
          this.spin = 0;
          if ((this.skidAcc = (this.skidAcc || 0) + dt) > 0.05 && k < 0.95) { this.skidAcc = 0; fx.dust?.(this.mpos.clone(), 0.8, 6); }
          if (this.at > dur + 1.1) { this.go('down'); this.cutTo('down', 4.2); this.lineEnd = 0.5 + this.say('p3') + 0.5; }
        }
        return null;                                                 // (the knock-down move, held on the ground below)
      }
      case 'down':
        if (this.at >= (this.lineEnd || 3) && !(v && v.busy && !this.seeking)) {
          this.go('rise'); this.cutTo('rise', 4.6);
          this.lineT = null;
        }
        return null;
      case 'rise': {
        // he comes up off the stone, plants the rod, says it; the last of the line is the shout
        if (this.lineT === null && this.at > 1.0) { this.lineT = this.at; this.lineDur = this.say('p4'); }
        const shout = this.lineT !== null && this.at - this.lineT > this.lineDur * 0.66;
        if (shout || this.at > 9) {
          this.go('grow'); this.cutTo('grow', 3.4);
          this.audio.play('phase_shift', { pos: this.mpos, volume: 1 });
          this.audio.play('bell', { pos: this.mpos, volume: 0.8, pitch: 0.7 });
          this.G.flash = Math.max(this.G.flash, 0.3);
          fx.shockwave?.(this.mpos.clone(), 26, 1.2, new THREE.Color(1.0, 0.8, 0.4));
          this.shake(0.9);
        }
        return this.at < 1.3 ? null : 'cineLookUp';
      }
      case 'grow': {
        const dur = 3.0, u = clamp01((this.at - 0.35) / dur), S = 1 + (M.T0.giant - 1) * ease.inOut(u);
        if (M.S !== S) M.setGiant(S);
        this.mpos.y = THREE.MathUtils.lerp(this.groundAt(this.mpos), M.giantY(), u);
        // gold pours off him as he rises; the floor answers
        if ((this.goldAcc = (this.goldAcc || 0) + dt) > 0.03 && u < 1) {
          this.goldAcc = 0;
          const H = 1.5 * S;
          for (let i = 0; i < 7; i++) {
            const ang = Math.random() * Math.PI * 2, r = H * rand(0.15, 0.5);
            fx.add.emit(V(this.mpos.x + Math.cos(ang) * r, this.mpos.y + H * rand(0, 1), this.mpos.z + Math.sin(ang) * r),
              V(Math.cos(ang) * rand(0.5, 2), H * rand(0.2, 0.6), Math.sin(ang) * rand(0.5, 2)), new THREE.Color(1.6, 1.05, 0.35),
              { size: H * rand(0.012, 0.035), life: rand(0.8, 1.6), drag: 0.6, grav: 0.5, alpha: 0.85 });
          }
          if (Math.random() < 0.3) this.arena.shake?.(0.3);
        }
        fx.light?.(this.mpos.clone().add(V(0, 1.5 * S * 0.6, 0)), 0xffc060, 60 + 40 * S, 0.1, 30 + 6 * S);
        this.once('grown', 0.35 + dur, () => {
          this.G.flash = Math.max(this.G.flash, 0.2); this.shake(1.2);
          fx.shockwave?.(this.mpos.clone(), 60, 1.4, new THREE.Color(1.0, 0.75, 0.35));
          this.audio.play('bull_stomp', { pos: this.mpos, volume: 1, pitch: 0.7 });
          this.arena.eruption?.(this.mpos.x + 8, this.mpos.z, 0.8); this.arena.eruption?.(this.mpos.x - 8, this.mpos.z + 5, 0.8);
        });
        this.glow = u < 1 ? Math.sin(u * Math.PI) : 0;
        if (this.at > 0.35 + dur + 0.5) {
          this.go('face'); this.cutTo('face', 2.8);
          { const fs = this.faceShot(), sh = this.shot('face'); sh.from.fov = fs.fov + 2; sh.to.fov = fs.fov; }
          this.audio.play('bull_roar', { pos: this.bf.head(), volume: 1, pitch: 0.7 });
          this.glow = 0;
        }
        return u >= 1 ? 'cinePoint' : 'cineSummon';
      }
      case 'face':
        if (this.at > 2.8) this.finish(false);
        return 'cineStance';
    }
    void wdt;
    return 'cineStance';
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    const t = this.t, bf = this.bf, fx = this.G.fx, arena = this.arena;
    const wdt = dt * this.rate;                                       // the world's time (the camera keeps real time)
    if (this.rate < 0.999) { this.G.slowmo = this.rate; this.G.slowmoT = 0.12; }
    // the bull plays its own stand-up, then the sweep (blind to the monkey: the scene moves him)
    this.bull.update(wdt, this.G.ghost);
    bf.frame();
    // the monkey: he holds his ground and has his word; then the second half moves him
    if (this.said === 'p2') this.once('answer', 0, () => { this.answerT = t; this.audio.play('staff_swing', { pos: this.mpos, volume: 0.6, pitch: 1.1 }); });
    const v = this.G.voice;
    this.quietT = v && v.busy ? 0 : (this.quietT ?? 0) + dt;
    const pose = this.second(dt, wdt);
    if (this.done) return;
    const root = this.actor.root;
    root.visible = true; this.G.staffs.monkey.visible = true;
    root.position.copy(this.mpos);
    root.rotation.set(0, Math.atan2(this.bull.pos.x - this.mpos.x, this.bull.pos.z - this.mpos.z), 0);
    if (this.spin) root.rotateX(-this.spin);                           // tumbling through the air
    this.monkey.pos.copy(this.mpos);
    if (pose) holdPose(this.actor, pose);
    else {
      // thrown, then lying where he fell: the knock-down held on the ground until he gets up
      const mv = this.actor.move;
      if (mv && mv.name === 'knockdown' && this.act !== 'rise' && mv.t > 0.9) mv.t = 0.9;
      if (!mv && this.act === 'rise') holdPose(this.actor, 'cineLookUp');
    }
    const planted = pose === 'cineLookUp' || pose === 'cineSummon';
    this.slide = (this.slide ?? 0.3) + ((planted && pose === 'cineLookUp' ? 0.44 : this.slide0 ?? 0.3) - (this.slide ?? 0.3)) * (1 - Math.exp(-7 * wdt));
    setStaffSlide(this.G.staffs.monkey, this.slide);
    this.actor.update(wdt);
    const behind = (r, f) => bf.at(r, 0, f);
    this.once('crack', 2.5, () => {
      arena.setPhase(2);
      this.music?.('niumo_phase2', 0.5);
      this.audio.play('rock_crack', { pos: behind(0, -26), volume: 0.9, pitch: 0.55 });
      this.shake(0.9);
    });
    // the split mountain throws up lava behind him
    [[2.7, -8, -22, 1.2], [3.05, 10, -26, 1.0], [3.5, -2, -34, 1.6], [4.2, 16, -18, 0.9], [4.7, -16, -28, 1.2]].forEach(([at, r, f, s], i) => {
      this.once('erupt' + i, at, () => {
        const p = behind(r, f);
        arena.eruption?.(p.x, p.z, s);
        if (i % 2 === 0) this.audio.play('lava_burst', { pos: p, volume: 0.85, pitch: 0.8 + i * 0.05 });
        this.shake(0.45);
      });
    });
    this.once('flash', 3.45, () => { this.G.flash = Math.max(this.G.flash, 0.2); });
    // the dust of a mountain coming apart drifts across him as he stands, lit by the low sun
    if (t > 6.6 && t < 10.2 && (this.smokeAcc = (this.smokeAcc || 0) + dt) > 0.07) {
      this.smokeAcc = 0;
      const c = bf.chest();
      for (let i = 0; i < 2; i++) {
        fx.alpha.emit(c.clone().add(V(rand(-12, 12), rand(-10, 6), rand(-8, 8))), V(rand(-1, 1), rand(0.5, 2), rand(-1, 1)),
          new THREE.Color(0.42, 0.29, 0.21), { size: rand(7, 13), life: rand(2.5, 4), drag: 0.4, grav: 0.2, alpha: 0.07, grow: 1.5 });
      }
    }
    this.speak(t);
    const g = this.glow || 0;
    this.post = { warm: 0.1 * smooth(2.5, 4, t) + 0.25 * g, exposure: 1 + 0.06 * smooth(2.5, 4.5, t) + 0.25 * g, bloom: 0.45 * g };
    const info = this.track.apply(this.camera, t, dt);
    this.dofFor(info, 0.0006);
    if (this.act === 'grow' || this.act === 'face') this.dof = null;
    this.audio.setListener({ position: info.pos, forward: info.look.clone().sub(info.pos).normalize() });
  }
  finish(skipped) {
    if (this.done) return;
    // skipped: the floor is gone at once and he is on his feet
    if (skipped) {
      this.arena.setPhase(2, { instant: true }); if (!this.fired.has('crack')) this.music?.('niumo_phase2', 0.4);
      // he finishes standing up at once (blind to the monkey): the fight resumes with him on his feet, in phase two
      for (let i = 0; i < 200 && this.bull.state === 'transition'; i++) this.bull.update(0.1, this.G.ghost);
    }
    // 法相天地: he stands where the sweep threw him (or would have), at the giant's scale, whole again
    const M = this.monkey;
    if (this.act === null || this.act === 'sweep') this.mpos.copy(this.land).addScaledVector(this.fl, 2.6);
    this.actor.root.rotation.set(0, 0, 0);
    this.actor.stopMove();
    setStaffSlide(this.G.staffs.monkey, this.slide0 ?? 0.3);
    M.setGiant();
    M.reset?.({ x: this.mpos.x, z: this.mpos.z, yaw: Math.atan2(this.bull.pos.x - this.mpos.x, this.bull.pos.z - this.mpos.z) });
    clearOfBull(M, this.bull);
    this.G.slowmo = 1; this.G.slowmoT = 0;
    // (if he was skipped in the middle of the sweep, the bull lets it go)
    if (this.bull.a.move && this.bull.a.move.name === 'sweepLow') this.bull.a.stopMove();
    this.G.cam.cut?.();
    this.end(skipped);
  }
  skip() { this.finish(true); }
}

// ------------------------------------------------------------------ ending

export class EndingScene extends Scene {
  // bull.js plays its own death (to its knees, a last roar, toppling back into the lake, sinking until only the horns
  // break the surface, the fire going out of him). When the bull does not animate a death of its own, this scene
  // topples and sinks the body itself. Either way it then kills the volcano, brings the rain and seats the monkey on
  // the highest horn tip above the lake for the last shot.
  constructor(o) {
    super(o);
    const { bf } = this;
    this.ui.setHint('');
    const root = bf.root;
    this.root0 = { pos: root.position.clone(), order: root.rotation.order, rx: root.rotation.x, rz: root.rotation.z };
    this.seat = this.bull.pos.clone();
    const F = bf.F.clone(), R = bf.R.clone(), seat = this.seat;
    this.F = F; this.R = R;
    this.horns = hornTipsFromGroup(this.bull.headParts) || hornTips(this.G.chars.bull);
    this.head0 = bf.head().y - this.root0.pos.y;
    this.selfFall = null;            // does the bull animate its own death? (decided in the first 1.3 s)
    this.fall = { tilt: 0, roll: 0, sink: 0, t0: 1.3 };
    this.finalSink = null;
    this.duration = 27;
    // 法相天地 does not end with the blow: the monkey is still a giant, and stays one. Where he stands for the whole
    // scene: where the last blow left him, never nearer than a rod's length to the body that is going down.
    const S = this.monkey.S || 1, H = 1.5 * S;
    this.mS = S;
    const D = V(this.monkey.pos.x - seat.x, 0, this.monkey.pos.z - seat.z);
    const dist = Math.max(D.length(), 1.15 * H + 2);
    if (D.lengthSq() < 1e-4) D.copy(F); D.normalize();
    const mPos = this.mPos = seat.clone().addScaledVector(D, dist); mPos.y = this.monkey.pos.y;
    this.mYaw = Math.atan2(-D.x, -D.z);
    const mid = seat.clone().lerp(mPos, 0.5);
    // the side of the pair the lens works from: the one with more floor behind it
    let side = V(D.z, 0, -D.x);
    const room = p => { const b = this.arena.bounds; return b ? Math.min(p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z) : 0; };
    if (room(mid.clone().addScaledVector(side, -30)) > room(mid.clone().addScaledVector(side, 30))) side.negate();
    this.side = side;
    const at = (base, d, sd, y) => {       // a point by the pair (along monkey <- bull, to the lens side), y above the ground there
      const p = base.clone().addScaledVector(D, d).addScaledVector(side, sd);
      p.y = (this.arena.groundY ? Math.max(this.arena.groundY(p.x, p.z), this.arena.lavaY ?? -1e9) : 0) + y;
      return p;
    };
    const mTop = f => mPos.clone().setY(mPos.y + H * f);
    const mHead = () => this.actor.bonePos('Head', V());
    const mFocus = () => this.camera.position.distanceTo(mHead());
    this.track = new ShotTrack([
      // 1 the blow has landed. Two giants in profile, from the caldera floor: one still in his stance, one going down
      { t0: 0, t1: 6.2, e: 'out', ap: 0.0003, shake: 0.2,
        from: { pos: at(mid, 0, 1.75 * H, 2.2), look: mid.clone().setY(mPos.y + H * 0.62), fov: 50 },
        to: { pos: at(mid, 0.1 * H, 1.6 * H, 3.0), look: mid.clone().addScaledVector(D, -0.25 * H).setY(mPos.y + H * 0.36), fov: 53 } },
      // 2 the volcano dies: from above the rim, the pair small in the lake, the plumes going out behind them
      { t0: 6.2, t1: 11.0, e: 'linear', ap: 0.00004, blur: 0.004, focus: mFocus,
        from: { pos: mid.clone().addScaledVector(D, 3.0 * H).addScaledVector(side, 1.4 * H).setY(mPos.y + 1.9 * H), look: seat.clone().addScaledVector(D, -1.2 * H).setY(mPos.y + 0.4 * H), fov: 46 },
        to: { pos: mid.clone().addScaledVector(D, 2.75 * H).addScaledVector(side, 1.2 * H).setY(mPos.y + 1.7 * H), look: seat.clone().addScaledVector(D, -1.2 * H).setY(mPos.y + 0.5 * H), fov: 44 } },
      // 3 the first rain: from under him, up past the golden mask into the falling drops - and he looks up into it
      { t0: 11.0, t1: 15.4, e: 'inOut', ap: 0.00008, blur: 0.005, focus: mFocus,
        from: { pos: at(mPos, 0.75 * H, 0.45 * H, 2.4), look: mTop(2.6).addScaledVector(D, -0.4 * H), fov: 46 },
        to: { pos: at(mPos, 0.8 * H, 0.5 * H, 3.2), look: () => mHead().add(V(0, 0.02 * H, 0)), fov: 40 } },
      // 4 the last picture: from behind his shoulder, far and low. The giant by his planted rod, the horns of the
      //   other one breaking the grey lake beyond him, the dead mountain, the rain. A slow push; the card sits left.
      { t0: 15.4, t1: 1e9, e: 'out', ap: 0.00008, blur: 0.006, focus: mFocus,
        from: { pos: at(mPos, 1.9 * H, 0.95 * H, 3.2), look: mid.clone().addScaledVector(side, 0.66 * H).setY(mPos.y + H * 0.52), fov: 40 },
        to: { pos: at(mPos, 1.7 * H, 0.85 * H, 3.6), look: mid.clone().addScaledVector(side, 0.6 * H).setY(mPos.y + H * 0.55), fov: 36 } },
    ]);
    this.G.slowmo = 0.45; this.G.slowmoT = 2.2;
    this.audio.setMusic('off', { fade: 1.2 });
    // his last words as he goes down (they carry over the dying volcano); then the monkey's, to the drowned giant,
    // as the rain comes down on the mask
    this.script = [{ id: 'e0', at: 1.3 }, { id: 'e1', at: 17.2 }];
  }
  /** Our own fall (only when the bull has none): applied on top of whatever the bull module set this frame. */
  applyFall() {
    const root = this.bf.root;
    root.rotation.order = 'YXZ';
    root.rotation.x = this.root0.rx - this.fall.tilt;
    root.rotation.z = this.root0.rz + this.fall.roll;
    root.position.y = this.root0.pos.y - this.fall.sink;
    root.updateMatrixWorld(true);
  }
  hornWorld() {
    if (this.horns) {
      const a = this.horns.world(0), b = this.horns.world(1);
      return a.y > b.y ? a : b;
    }
    return this.bf.head().addScaledVector(this.bf.U, this.bf.H * 0.08);
  }
  lakeY() { const g = this.arena.groundY ? this.arena.groundY(this.seat.x, this.seat.z) : 0; return Math.min(g, this.arena.lavaY ?? g); }
  update(dt) {
    if (this.done) { this.hold(dt); return; }
    this.t += dt;
    const t = this.t, bf = this.bf, fx = this.G.fx, arena = this.arena;
    // the bull's own death runs on its update; we watch whether it moves the body
    if (this.selfFall !== false) this.bull.update(dt, this.G.ghost);
    if (this.selfFall === null) {
      const root = bf.root, dropped = (this.root0.pos.y + this.head0) - bf.head().y;
      if (dropped > this.head0 * 0.05 || root.position.y < this.root0.pos.y - 0.3 || Math.abs(this.G.chars.bull.pivot.rotation.x) > 0.02) this.selfFall = true;
      else if (t >= this.fall.t0) this.selfFall = false;
    }
    if (this.selfFall === false) {
      const u = t - this.fall.t0;
      this.fall.tilt = THREE.MathUtils.degToRad(26) * ease.in(smooth(0, 2.8, u));
      this.fall.roll = THREE.MathUtils.degToRad(20) * ease.in(smooth(0.1, 2.9, u));
      if (this.finalSink === null && u >= 2.9) {
        // sink until only the higher horn's tip stands above the lake
        const save = this.fall.sink; this.fall.sink = 0; this.applyFall();
        this.finalSink = Math.max(4, this.hornWorld().y - this.lakeY() - 2.4);
        this.fall.sink = save;
      }
      const sinkTo = this.finalSink ?? 12;
      this.fall.sink = THREE.MathUtils.lerp(0, 6, ease.in(smooth(0.5, 2.9, u))) + (sinkTo - 6) * ease.inOut(smooth(2.9, 11, u));
      this.applyFall();
      this.setEyes(1 - smooth(1.6, 3.8, t));
      this.once('impact', this.fall.t0 + 2.7, () => {
        this.audio.play('lava_burst', { pos: this.seat, volume: 1.0, pitch: 0.6 });
        this.audio.play('bull_slam', { pos: this.seat, volume: 1.0, pitch: 0.6 });
        this.splash();
      });
    } else if (this.selfFall) {
      this.once('impact', 3.5, () => this.splash());       // bull.js's own lava_burst lands here
    }
    this.once('dying', 6.0, () => {
      arena.setPhase(3);
      this.music?.('niumo_ending', 4);
    });
    this.once('rain', 10.5, () => this.audio.play('rain', { volume: 0.9 }));
    // steam off the cooling lake where he went under
    if (t > 6 && t < 24 && (this.steamAcc = (this.steamAcc || 0) + dt) > 0.06) {
      this.steamAcc = 0;
      const k = 1 - smooth(14, 24, t);
      for (let i = 0; i < 3; i++) {
        const p = bf.at(rand(-16, 16), 0.5, rand(-22, 10));
        fx.alpha.emit(p, V(rand(-0.3, 0.3), rand(1.2, 3.2), rand(-0.3, 0.3)), new THREE.Color(0.5, 0.5, 0.52),
          { size: rand(4, 9), life: rand(3, 5), drag: 0.3, grav: 0.4, alpha: 0.22 * k, grow: 1.6 });
      }
    }
    this.standMonkey(dt, t);
    this.speak(t);
    this.once('card', 20.4, () => this.ui.card_('火焰山 · 熄', 'ending', 3600, '八 百 里 火 焰 · 千 年 来 第 一 场 雨<i>The Flame Mountain is out — the first rain in a thousand years</i>'));
    if (t > 11) this.rainOnMask(dt);
    this.post = { warm: -0.1 * smooth(6, 11, t), desat: 0.08 * smooth(6, 12, t) };
    const info = this.track.apply(this.camera, t, dt);
    this.dofFor(info, 0.0006);
    this.audio.setListener({ position: info.pos, forward: info.look.clone().sub(info.pos).normalize() });
    if (t >= this.duration) {
      this.running = false; this.done = true;
      this.onDone?.(false);
    }
  }
  splash() {
    const bf = this.bf;
    for (const [r, f, s] of [[0, -12, 1.6], [-12, -6, 1.1], [12, -8, 1.1], [-6, 4, 0.8], [8, 6, 0.8]]) {
      const p = bf.at(r, 0, f); this.arena.eruption?.(p.x, p.z, s);
    }
    this.shake(1.0); this.G.flash = Math.max(this.G.flash, 0.12);
  }
  rainOnMask(dt) {
    if ((this.dropAcc = (this.dropAcc || 0) + dt) < 0.05) return;
    this.dropAcc = 0;
    const k = this.mS || 1;
    const h = this.actor.bonePos('Head', V()).add(V(rand(-0.08, 0.08) * k, rand(0.02, 0.12) * k, rand(-0.08, 0.08) * k));
    for (let i = 0; i < 2; i++) this.G.fx.add.emit(h, V(rand(-0.6, 0.6) * k, rand(0.2, 0.9) * k, rand(-0.6, 0.6) * k), new THREE.Color(0.5, 0.55, 0.62), { size: 0.012 * k, life: 0.18, drag: 2, grav: -9 * k, alpha: 0.6 });
  }
  /**
   * The monkey through the scene, a giant still: in his stance while the bull goes down, then the rod comes to the
   * ground beside him and he stands by it, the mask lifted into the rain.
   */
  standMonkey(dt, t) {
    const a = this.actor, root = a.root;
    if (!root.visible) { root.visible = true; this.G.staffs.monkey.visible = true; }
    // the highest horn tip stands clear of the lake (whoever sank the body): it is what is left of him in the last picture
    if (t >= 14.9) {
      const horn = this.hornWorld(), lake = this.lakeY(), bullRoot = this.bf.root;
      if (horn.y < lake + 2.5) { bullRoot.position.y += lake + 3 - horn.y; bullRoot.updateMatrixWorld(true); }
    }
    root.position.copy(this.mPos); root.rotation.y = this.mYaw;
    holdPose(a, t < 5.4 ? 'cineStance' : 'cineLookUp');
    if (a.move.name === 'cineStance' && a.move.t < 0.7) a.move.t = 0.7;       // (already in the stance, not arriving in it)
    a.playBase(baseClip(a, 'idle'), { fade: 0.4 });
    root.updateMatrixWorld(true);
    a.update(dt);
    this.monkey.pos.copy(root.position);
  }
  /** After the card: hold the last shot (slow drift) until the player retries. */
  hold(dt) {
    this.t += dt;
    if (this.selfFall) this.bull.update(dt, this.G.ghost);
    else this.applyFall();
    this.standMonkey(dt, this.t);
    this.rainOnMask(dt);
    const info = this.track.apply(this.camera, Math.min(this.t, 40), dt);
    this.dofFor(info, 0.0006);
  }
  skip() {
    if (this.done || this.t >= 15.4) return;
    // jump to the last shot: the fall complete, the volcano dead, the rain on
    this.fired.add('impact');
    if (!this.fired.has('dying')) { this.fired.add('dying'); this.arena.setPhase(3, { instant: true }); this.music?.('niumo_ending', 1.5); }
    if (!this.fired.has('rain')) { this.fired.add('rain'); this.audio.play('rain', { volume: 0.9 }); }
    this.setEyes(0);
    if (this.selfFall) { for (let i = 0; i < 80 && this.t < 15.4; i++) { this.bull.update(0.2, this.G.ghost); this.t += 0.2; } }
    else {
      this.selfFall = false;
      this.fall.tilt = THREE.MathUtils.degToRad(26); this.fall.roll = THREE.MathUtils.degToRad(20); this.fall.sink = 0; this.applyFall();
      this.finalSink = Math.max(4, this.hornWorld().y - this.lakeY() - 2.4);
      this.fall.sink = this.finalSink; this.applyFall();
    }
    this.hush(); this.si = Math.max(this.si || 0, 1);       // (his last words are not said late)
    this.t = 15.4;
    this.ui.card_('火焰山 · 熄', 'ending', 3600, '八 百 里 火 焰 · 千 年 来 第 一 场 雨<i>The Flame Mountain is out — the first rain in a thousand years</i>');
    this.fired.add('card');
    this.G.slowmo = 1; this.G.slowmoT = 0;
  }
  /** Retry: give the body back to the bull module. */
  dispose() {
    this.hush();
    const nk = this.bull.look?.uniforms?.bkNearK; if (nk) nk.value = 1;
    const root = this.bf.root;
    root.rotation.order = this.root0.order; root.rotation.x = this.root0.rx; root.rotation.z = this.root0.rz;
    root.position.y = this.root0.pos.y;
    this.actor.root.visible = true; this.G.staffs.monkey.visible = true;
    this.restoreMoves();
    this.ui.clearCard();
    this.ui.letterbox(false);
  }
}
