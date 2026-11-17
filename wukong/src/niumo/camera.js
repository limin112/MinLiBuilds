// AutoCam: the keyboard-only cinematic camera of 火焰山 · 牛魔.
//
// No stick, no mouse needed. Every frame it frames two things together: the monkey (small, in the lower third of the
// picture) and the giant's part that matters right now - the hand that is about to slam, the knee he is working on,
// the head when it comes down - and solves distance, height and tilt so both fit: a low camera that looks up at the
// giant, pulling back (and widening a little) when the threat is high or the blow is big. It sits behind the monkey
// on the line from that part through him, so W always walks toward the threat and A / D circle it.
//
// Focus choice (first that applies):
//   1. the boss's own word: boss.threat() -> { part, pos, radius, big } (bull.js: the part about to strike; 'body' = no
//      particular threat), or boss.camHint = { focus: part | Vector3, pull: 0..1 }, boss.focusPart = part,
//      or a lockTargets() entry flagged { focus: true } / { threat: n }
//   2. the weak point the monkey's attacks are aimed at (monkey.lockTarget)
//   3. the nearest weak point (any target that is not 'body')
//   4. the boss asleep (boss.dormant): the giant as a whole, a looming low-angle walk-in shot
//   5. no boss: a chase camera behind the monkey
// Big attacks: boss.camHint.pull, or cam.pullBack(k, seconds) from anyone (main, the boss).
// Collision: arena.cameraBlockers ({ circles, bounds }) and moving bodies (cam.bodies = () => [{ x, z, r, top }], else
// the boss's colliders() circles), like the shared CameraRig; never below arena.groundY + 0.35.
// Shared CameraRig API: addTrauma(a), punch(dir, m), zoomPunch(deg), forward(out), right(out), snapBehind(pos, yaw),
// locked / lockPoint / lockTarget (the reticle), shakeScale.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const _seg = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Vector3();

function noise1(t, seed) {
  return Math.sin(t * 13.1 + seed) * 0.5 + Math.sin(t * 27.7 + seed * 1.7) * 0.3 + Math.sin(t * 51.3 + seed * 2.3) * 0.2;
}

/** Entry parameter (0..1) of the segment a + s*d into the vertical circle (x, z, r), or 1 when it does not enter. */
function enterCircle(a, d, x, z, r) {
  const ox = a.x - x, oz = a.z - z;
  const A = d.x * d.x + d.z * d.z, B = 2 * (d.x * ox + d.z * oz), Cc = ox * ox + oz * oz - r * r;
  if (Cc <= 0 || A < 1e-9) return 1;
  const disc = B * B - 4 * A * Cc;
  if (disc < 0) return 1;
  const s = (-B - Math.sqrt(disc)) / (2 * A);
  return s >= 0 && s < 1 ? s : 1;
}

export class AutoCam {
  constructor(camera, { bounds = null, arena = null, blockers = null, fov = null } = {}) {
    this.cam = camera;
    this.arena = arena;
    this.bounds = bounds || arena?.bounds || null;
    this.blockers = blockers || arena?.cameraBlockers || null;
    this.bodies = null;                 // () => [{ x, z, r, top }]
    this.groundY = arena?.groundY ? (x, z) => arena.groundY(x, z) : null;

    // framing (tunable)
    this.fovBase = fov || camera.fov || 50;
    this.minDist = 4.4; this.maxDist = 18;
    this.close = 0;                     // 0..1: the focus (a hand, a knee) is right beside him
    this.critW = 0; this.critSide = 0;  // the side-on shot of 牵牛鼻子
    this.side = 0.5;                    // over the right shoulder: the monkey sits a little left of centre
    this.subjectH = 0.9;                // framing point above his feet (a 1.5 m monkey)
    this.headH = 1.6;
    this.screenY = -0.42;               // his middle in the lower third (NDC, -1 = bottom edge)
    this.topMargin = 0.86;              // the focus part stays below this
    this.bottomMargin = -0.92;          // his feet stay above this

    // state
    this.yaw = Math.PI; this.yawGoal = Math.PI; this.pitch = 0;
    this.dist = 6; this.camH = 1.3; this.fov = this.fovBase;
    this.S = new THREE.Vector3();       // smoothed subject (his feet)
    this.F = new THREE.Vector3();       // smoothed focus point
    this.Fr = 1.5;                      // focus radius (framing margin)
    this.focusW = 0;                    // 0 chase .. 1 framing a focus
    this.focus = null;                  // { part, pos } currently framed
    this.lockTarget = null;             // { part, pos } the weak point his attacks go for (main draws the reticle on it)
    this.locked = false; this.lockPoint = null;
    this.pull = 0; this.pullGoal = 0; this.pullT = 0;
    this.trauma = 0; this.shakeScale = 1;
    this.kick = new THREE.Vector3(); this.kickVel = new THREE.Vector3();
    this.fovPunch = 0;
    this.nudgeYaw = 0; this.nudgePitch = 0; this.nudgeT = 0;
    this.time = 0;
    this.initialized = false;
    this.clipS = 1;
    this.pos = new THREE.Vector3();
    this.boss = null;
    this.info = { dist: 0, pitch: 0, fov: 0, focus: null, feasible: true };
    this._focus = { part: null, pos: new THREE.Vector3(), big: false };
    this._lock = { part: null, pos: new THREE.Vector3() };
  }

  // ------------------------------------------------------------------ shared CameraRig API

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }
  /** Impulse that shoves the camera along `dir` (world) by roughly `amount` meters. */
  punch(dir, amount = 0.2) { this.kickVel.addScaledVector(dir, amount * 18); }
  zoomPunch(deg = 3) { this.fovPunch = Math.max(this.fovPunch, deg); }
  /** Pull back for a big attack: k 0..1 held for `seconds`, then eases back in. */
  pullBack(k = 1, seconds = 1.5) { this.pullGoal = Math.max(this.pullGoal, k); this.pullT = Math.max(this.pullT, seconds); }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  setLock(fn) { this.lockPoint = fn; this.locked = !!fn; }

  snapBehind(pos, yaw) {
    this.yaw = this.yawGoal = yaw;
    this.nudgeYaw = this.nudgePitch = 0;
    if (pos) this.S.copy(pos);
    this.initialized = false;
  }
  /** Jump straight to the solved framing next frame (after teleports / cutscenes). */
  cut() { this.initialized = false; }

  // ------------------------------------------------------------------ focus

  pickFocus(monkey, boss) {
    const f = this._focus;
    if (!boss || boss.dead || boss.ghost) return null;
    const list = boss.lockTargets ? boss.lockTargets() || [] : [];
    const mp = monkey ? monkey.pos : this.S;
    if (boss.dormant) {
      // asleep: the whole giant, seen from below as he looms up
      let top = null;
      for (const t of list) if (!top || t.pos.y > top.pos.y) top = t;
      f.part = 'giant'; f.big = true;
      f.pos.set(boss.pos.x, Math.max(10, top ? top.pos.y * 0.85 : 14), boss.pos.z);
      return f;
    }
    if (!list.length) return null;
    let pick = null;
    // the boss names its threat (bull.js threat()): frame that part; its radius says how much around it matters
    const th = boss.threat ? boss.threat() : null;
    if (th && th.part && th.part !== 'body' && th.pos) {
      f.part = th.part; f.pos.copy(th.pos); f.big = !!th.big;
      f.r = clamp((th.radius || 4) * 0.3, 1.5, 9);
      return f;
    }
    const hint = boss.camHint || null;
    const want = hint && hint.focus !== undefined ? hint.focus : boss.focusPart;
    if (want && want.isVector3) { f.part = 'hint'; f.pos.copy(want); f.big = !!hint?.big; f.r = 2; return f; }
    if (want) pick = list.find(t => t.part === want) || null;
    if (want && !pick && typeof want === 'string' && boss.hurtZones) {
      // a part the boss names but does not offer as a target right now (his head, high up): frame its hurt zone
      const z = (boss.hurtZones() || []).find(q => q.part === want);
      if (z) { f.part = want; f.pos.copy(z.a).lerp(z.b, 0.5); f.big = !!(hint && hint.big); f.r = Math.max(1.6, z.r); return f; }
    }
    if (!pick) {
      let best = 0;
      for (const t of list) { const th = t.focus ? 1 : t.threat || 0; if (th > best) { best = th; pick = t; } }
    }
    if (!pick && monkey && monkey.lockTarget) pick = list.find(t => t.part === monkey.lockTarget.part) || null;
    if (!pick) {
      let bd = Infinity;
      for (const t of list) {
        if (t.part === 'body' || t.open === false) continue;
        const d = Math.hypot(t.pos.x - mp.x, t.pos.z - mp.z);
        if (d < bd) { bd = d; pick = t; }
      }
    }
    if (!pick) pick = list[0];
    f.part = pick.part; f.pos.copy(pick.pos); f.big = !!(hint && hint.big);
    f.r = pick.r || (pick.part === 'head' ? 2.4 : 1.6);
    return f;
  }

  pickLock(monkey, boss) {
    if (!boss || boss.dead || boss.dormant || boss.ghost) return null;
    if (monkey && 'lockTarget' in monkey) return monkey.lockTarget || null;
    const list = boss.lockTargets ? boss.lockTargets() || [] : [];
    const mp = monkey ? monkey.pos : this.S;
    let best = null, bd = Infinity;
    for (const t of list) {
      if (t.part === 'body' || t.open === false) continue;
      const d = Math.hypot(t.pos.x - mp.x, t.pos.z - mp.z);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return null;
    this._lock.part = best.part; this._lock.pos.copy(best.pos);
    return this._lock;
  }

  // ------------------------------------------------------------------ framing

  ground(x, z) { return this.groundY ? this.groundY(x, z) : 0; }

  /** Camera height above his feet: low under a high focus (look up at the giant), higher over a low, near one. */
  heightFor(d, hF) {
    const base = 0.7 + 0.95 * (1 - smooth(1.5, 9, hF));
    return base + Math.max(0, d - this.minDist) * 0.16 + this.close * 1.1;
  }

  /** Elevation of world point X seen from C along the camera's horizontal forward f. */
  static elev(C, X, f) {
    const along = (X.x - C.x) * f.x + (X.z - C.z) * f.z;
    return Math.atan2(X.y - C.y, Math.max(along, 0.6));
  }

  /** Camera position for distance d (into out). */
  place(out, S, d, fwd, rgt, hF) {
    const side = this.side + this.close * 0.8;
    out.set(S.x - fwd.x * d + rgt.x * side, S.y + this.heightFor(d, hF), S.z - fwd.z * d + rgt.z * side);
    return out;
  }

  /** Pitch that puts his middle at screenY, raised to keep the focus top in (capped by his feet). */
  pitchFor(C, S, F, fr, fwd, fov, useFocus) {
    const t = Math.tan(fov * DEG / 2);
    const sc = _v.set(S.x, S.y + this.subjectH, S.z), sf = _w.set(S.x, S.y + 0.05, S.z);
    const thC = AutoCam.elev(C, sc, fwd) - Math.atan(this.screenY * t);
    const thMax = AutoCam.elev(C, sf, fwd) - Math.atan(this.bottomMargin * t);
    if (!useFocus) return { pitch: Math.min(thC, thMax), ok: true };
    const ft = _c.set(F.x, F.y + fr, F.z);
    const thF = AutoCam.elev(C, ft, fwd) - Math.atan(this.topMargin * t);
    const want = Math.max(thC, thF);
    return { pitch: Math.min(want, thMax), ok: thF <= thMax + 1e-4 };
  }

  update(dt, subject, boss = null, look = null) {
    // CameraRig-style call: update(dt, pos, look)
    let monkey = subject;
    if (subject && subject.isVector3) { look = boss && boss.dx !== undefined ? boss : look; boss = this.boss; monkey = { pos: subject }; }
    else if (boss) this.boss = boss;
    const P = monkey.pos;
    this.time += dt;
    if (monkey.S > 1.5) return this.updateDuel(dt, monkey, boss);
    if (this.duelOn) { this.duelOn = false; this.initialized = false; }
    if (!this.initialized) this.S.copy(P);
    this.S.x += (P.x - this.S.x) * damp(12, dt);
    this.S.z += (P.z - this.S.z) * damp(12, dt);
    this.S.y += (P.y - this.S.y) * damp(6, dt);           // hops and drops: the frame follows a little behind

    // focus (the threat) and lock (his aim)
    const fc = this.pickFocus(monkey, boss);
    const lk = this.pickLock(monkey, boss);
    this.lockTarget = lk;
    if (fc) {
      if (!this.focus || this.focus.part !== fc.part) this.focusSwitchT = 0;
      if (!this.initialized || this.focusW < 0.01) this.F.copy(fc.pos);
      else this.F.lerp(fc.pos, damp(fc.part === (this.focus && this.focus.part) ? 6 : 2.6, dt));
      this.Fr += ((fc.r || 1.6) - this.Fr) * damp(3, dt);
      this.focus = fc;
    } else this.focus = null;
    this.focusW += ((fc ? 1 : 0) - this.focusW) * damp(fc ? 2.5 : 1.5, dt);
    this.locked = !!fc;
    this.lockPoint = fc ? () => this.F : null;

    // heading: from the focus through the monkey (hold it when he stands right under the focus)
    const S = this.S;
    if (fc) {
      const hx = this.F.x - S.x, hz = this.F.z - S.z, h = Math.hypot(hx, hz);
      const w = smooth(1.8, 5.5, h) * (fc.big && boss && boss.dormant ? 0.6 : 1);
      if (h > 0.3) this.yawGoal += wrap(Math.atan2(hx, hz) - this.yawGoal) * w;
    } else if (monkey.speed !== undefined && monkey.yaw !== undefined) {
      // chase: swing in behind him while he runs away from the lens, never while he runs toward it
      const rel = wrap(monkey.yaw - this.yawGoal);
      const ahead = Math.max(0, Math.cos(rel));
      this.yawGoal += clamp(rel, -1, 1) * Math.min(1, monkey.speed / 5) * ahead * 1.6 * dt;
    }
    // optional mouse nudge (pointer-locked): an offset that drifts back to the automatic framing
    if (look && (look.dx || look.dy)) {
      this.nudgeYaw = clamp(this.nudgeYaw - look.dx, -0.7, 0.7);
      this.nudgePitch = clamp(this.nudgePitch - look.dy, -0.35, 0.35);
      this.nudgeT = 1.6;
    } else if ((this.nudgeT -= dt) <= 0) {
      this.nudgeYaw *= 1 - damp(1.6, dt); this.nudgePitch *= 1 - damp(1.6, dt);
    }
    const yawWant = this.yawGoal + this.nudgeYaw;
    if (!this.initialized) this.yaw = yawWant;
    else this.yaw += wrap(yawWant - this.yaw) * damp(3.4, dt);
    this.yaw = wrap(this.yaw); this.yawGoal = wrap(this.yawGoal);

    // big attacks: pull back
    if (boss && boss.camHint && boss.camHint.pull) this.pullBack(boss.camHint.pull, 0.2);
    if (this.focus && this.focus.big && !(boss && boss.dormant)) this.pullBack(0.75, 0.25);
    if (this.pullT > 0) this.pullT -= dt; else this.pullGoal = 0;
    this.pull += (this.pullGoal - this.pull) * damp(this.pullGoal > this.pull ? 3 : 0.9, dt);

    // solve the distance that fits him and the focus, then the tilt for the (smoothed) distance actually used
    const fwd = this.forward(new THREE.Vector3()), rgt = this.right(new THREE.Vector3());
    const useFocus = this.focusW > 0.05;
    const hF = useFocus ? this.F.y - S.y : 1;
    const fovGoalBase = this.fovBase + this.pull * 6;
    const C = new THREE.Vector3();
    let dGoal = this.maxDist, feasible = false;
    // working right under one of his limbs: stand off higher, wider and a little to the side, so the hand or knee
    // fills a part of the frame instead of all of it and the monkey stays clear of it
    {
      const h = fc && useFocus && fc.part !== 'giant' ? Math.hypot(this.F.x - S.x, this.F.z - S.z) : 99;
      const want = 1 - smooth(5, 13, h);
      this.close += (want - this.close) * (this.initialized ? damp(2, dt) : 1);
    }
    const dMin = this.minDist + this.close * 2.0;
    for (let d = dMin; d <= this.maxDist + 1e-3; d += 0.6) {
      const fov = fovGoalBase + clamp((d - 8) * 0.7, 0, 7);
      this.place(C, S, d, fwd, rgt, hF);
      if (this.pitchFor(C, S, this.F, this.Fr, fwd, fov, useFocus).ok) { dGoal = d; feasible = true; break; }
    }
    // a focus far overhead (his head, 15-20 m up): stand off a little more, so the giant reads as a shape, not a wall
    if (useFocus) dGoal += smooth(7, 16, hF) * 1.6;
    dGoal = THREE.MathUtils.lerp(this.minDist + 1.2, dGoal, this.focusW) + this.pull * 5.5;
    if (!this.initialized) this.dist = dGoal;
    else this.dist += (dGoal - this.dist) * damp(dGoal > this.dist ? 2.4 : 1.0, dt);
    const fovGoal = fovGoalBase + clamp((this.dist - 8) * 0.7, 0, 7);
    this.fov += (fovGoal - this.fov) * (this.initialized ? damp(2.5, dt) : 1);

    const pos = this.place(this.pos, S, this.dist, fwd, rgt, hF);
    pos.y += this.pull * 1.0;
    const sol = this.pitchFor(pos, S, this.F, this.Fr, fwd, this.fov, useFocus);
    const pitchGoal = clamp(sol.pitch + this.nudgePitch, -0.6, 1.05);
    if (!this.initialized) this.pitch = pitchGoal;
    else this.pitch += (pitchGoal - this.pitch) * damp(4.5, dt);

    // collision: in front of pillars / steles / walls / bodies, at once; ease back out when clear
    const target = _v.set(S.x, S.y + this.subjectH + 0.2, S.z);
    if (this.blockers || this.bodies || (this.boss && this.boss.colliders)) {
      // the arena (pillars, steles) may push the camera all the way in; his own body only down to 3.5 m from the
      // monkey - nearer than that his limbs dither out (bull.js) instead of the lens ending up on the monkey's head
      const full = pos.distanceTo(target);
      const sArena = this.clearance(target, pos, false);
      let s = this.clearance(target, pos, true);
      if (s * full < 3.5) s = Math.min(sArena, Math.max(s, 3.5 / Math.max(full, 1e-3)));
      this.clipS = !this.initialized || s < this.clipS ? s : this.clipS + (s - this.clipS) * damp(4.5, dt);
      pos.sub(target).multiplyScalar(this.clipS).add(target);
    } else if (this.bounds) {
      const b = this.bounds;
      pos.x = clamp(pos.x, b.minX - 6, b.maxX + 6);
      pos.z = clamp(pos.z, b.minZ - 6, b.maxZ + 6);
    }
    pos.y = Math.max(pos.y, this.ground(pos.x, pos.z) + 0.35);
    this.initialized = true;

    // kick spring + shake
    this.kickVel.addScaledVector(this.kick, -220 * dt);
    this.kickVel.multiplyScalar(Math.exp(-16 * dt));
    this.kick.addScaledVector(this.kickVel, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma * this.shakeScale, t = this.time;
    const cam = this.cam;
    cam.position.copy(pos).addScaledVector(this.kick, this.shakeScale);
    cam.position.x += noise1(t, 1) * 0.22 * sh + noise1(t * 0.23, 7) * 0.012;      // + a breath of hand-held drift
    cam.position.y += noise1(t, 2) * 0.18 * sh + noise1(t * 0.19, 8) * 0.01;
    cam.position.z += noise1(t, 3) * 0.22 * sh;
    const cp = Math.cos(this.pitch);
    _w.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    // 牵牛鼻子: the auto framing would sit on the line from his head through the monkey - inside the giant. Cut to a
    // side-on shot instead, low, from a little ahead of him: the monkey hauling on the ring under the bowed head.
    const crit = monkey && monkey.a && monkey.a.move && monkey.a.move.name === 'critical' && boss && !boss.dead && monkey.ringPos;
    this.critW += ((crit ? 1 : 0) - this.critW) * damp(crit ? 6 : 2.5, dt);
    if (this.critW > 0.002 && (crit || this.critPos)) {
      if (crit) {
        // from the side of his body and a little ahead (his bowed head and the ring can be anywhere under it), low
        const r = monkey.ringPos, fx = Math.sin(boss.yaw || 0), fz = Math.cos(boss.yaw || 0);
        if (!this.critSide) this.critSide = Math.sign((pos.x - P.x) * fz - (pos.z - P.z) * fx) || 1;
        const sx = fz * this.critSide, sz = -fx * this.critSide;
        this.critPos = (this.critPos || new THREE.Vector3()).set(P.x + sx * 15 + fx * 7, Math.max(r.y, P.y) + 3.2, P.z + sz * 15 + fz * 7);
        this.critPos.y = Math.max(this.critPos.y, this.ground(this.critPos.x, this.critPos.z) + 0.6);
        this.critLook = (this.critLook || new THREE.Vector3()).set((r.x + P.x) / 2, (r.y + P.y) / 2 + 0.8, (r.z + P.z) / 2);
      } else this.critSide = 0;
      const k = this.critW * this.critW * (3 - 2 * this.critW);
      cam.position.lerp(this.critPos, k);
      _c.copy(this.critLook).sub(cam.position).normalize();
      _w.lerp(_c, k).normalize();
    }
    cam.lookAt(_c.copy(cam.position).add(_w));
    cam.rotateZ(noise1(t, 4) * 0.045 * sh);
    this.fovPunch = Math.max(0, this.fovPunch - dt * 18);
    const fov = this.fov - this.fovPunch;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    const inf = this.info;
    inf.dist = this.dist; inf.pitch = this.pitch; inf.fov = this.fov; inf.focus = this.focus ? this.focus.part : null; inf.feasible = feasible;
    inf.pull = this.pull;
  }

  /** The boss's own collision circles (a seated giant's hips, knees, feet, a hand on the ground) as camera bodies. */
  /**
   * 法相天地: two giants in the caldera. The camera stands well back behind the monkey's shoulder and high (about his
   * chest), on the line from the bull through him (so W still walks at the bull and A / D circle him), looking at the
   * space between their chests; it stays inside the caldera's walls and ignores everything that stands on its floor.
   */
  updateDuel(dt, monkey, boss) {
    const P = monkey.pos, H = 1.5 * monkey.S, first = !this.duelOn || !this.initialized;
    this.duelOn = true; this.initialized = true;
    const bp = boss && !boss.dead && !boss.ghost ? boss.pos : null;
    // locked on, the way a souls camera is: the lens is tied to him (his steps never leave it behind) and swings
    // round him to keep the bull beyond his shoulder
    this.lockTarget = bp ? monkey.lockTarget || null : null; this.focus = null; this.locked = !!this.lockTarget; this.lockPoint = null;
    const S = this.S;
    if (first) S.copy(P);
    // rigid in plan: he never slides in the frame, however fast he runs (a damped follow lags by speed x frame time,
    // which at 50 m/s shows every uneven frame as a jolt)
    else { S.x = P.x; S.z = P.z; S.y += (P.y - S.y) * damp(8, dt); }
    let d = this.duelD || 30;
    if (bp) {
      const hx = bp.x - S.x, hz = bp.z - S.z, dn = Math.hypot(hx, hz);
      if (dn > H * 0.25) this.yawGoal = Math.atan2(hx, hz);
      d = first ? dn : d + (dn - d) * damp(5, dt);
    }
    this.duelD = d;
    this.yaw = first ? this.yawGoal : wrap(this.yaw + wrap(this.yawGoal - this.yaw) * damp(9, dt));
    const fwd = this.forward(new THREE.Vector3()), rgt = this.right(new THREE.Vector3());
    if (this.pullT > 0) this.pullT -= dt; else this.pullGoal = 0;
    this.pull += (this.pullGoal - this.pull) * damp(this.pullGoal > this.pull ? 3 : 0.9, dt);
    // well back and above his head, off his right shoulder: he stands in the lower left of the picture, the bull
    // whole beyond him
    const back = clamp(H * 1.5 + d * 0.25, H * 1.6, H * 2.3) + this.pull * 8;
    let ox = -fwd.x * back + rgt.x * H * 0.85, oz = -fwd.z * back + rgt.z * H * 0.85;
    // backed up to the edge of the pit the lens would stand inside the caldera's wall (2026-11-17 user: 后退到边缘，视角会
    // 遮挡): it comes in closer instead - never past the floor's edge plus a little - and rises as it does
    let squeeze = 0;
    const pitD = this.arena?.pitD;
    if (pitD) {
      // the furthest point along the offset still low on the cliff (the walls rise from pitD 1 outwards; this high, the
      // lens clears their foot, and the lift below takes it over what rock there is)
      let s = 1;
      if (pitD(S.x + ox, S.z + oz) > 1.15) {
        s = 0.25;
        for (let i = 19; i >= 5; i--) { const f = i / 20; if (pitD(S.x + ox * f, S.z + oz * f) <= 1.15) { s = f; break; } }
      }
      squeeze = 1 - s;
    }
    this.duelSqueeze = first ? squeeze : (this.duelSqueeze || 0) + (squeeze - (this.duelSqueeze || 0)) * damp(squeeze > (this.duelSqueeze || 0) ? 10 : 2.5, dt);
    ox *= 1 - this.duelSqueeze; oz *= 1 - this.duelSqueeze;
    // at this height the lens is above the caldera's rim: it may stand out over the walls (the floor is only 80 m
    // across, two giants fill it), it only has to clear the rock under it
    const pos = this.pos.set(S.x + ox, S.y + H * 0.95 + this.pull * 3 + this.duelSqueeze * H * 0.8, S.z + oz);
    let top = -1e9;
    for (let i = 0; i <= 4; i++) top = Math.max(top, this.ground(S.x + ox * (0.4 + i * 0.15), S.z + oz * (0.4 + i * 0.15)));
    const lostWant = Math.max(0, top + 7 - pos.y);
    this.duelLift = first ? lostWant : (this.duelLift || 0) + (lostWant - (this.duelLift || 0)) * damp(lostWant > (this.duelLift || 0) ? 8 : 2, dt);
    const lost = this.duelLift;
    pos.y += lost;
    const look = (this.duelLook || (this.duelLook = new THREE.Vector3())).copy(S).addScaledVector(fwd, clamp(d * 0.55, H * 0.5, 60)); look.y = S.y + H * 0.7;
    // squeezed against the wall the lens rides up over him: it looks down past him at the bull, not over his head
    if (this.duelSqueeze > 0.01) { const q = this.duelSqueeze; look.addScaledVector(fwd, -clamp(d * 0.55, H * 0.5, 60) * q * 0.55); look.y -= H * 0.75 * q; }
    // against a wall the lens cannot stand back: whatever happens he stays in the picture (aim between him and that point)
    {
      const cx = S.x - pos.x, cz = S.z - pos.z, lx = look.x - pos.x, lz = look.z - pos.z;
      const off = Math.abs(wrap(Math.atan2(cx, cz) - Math.atan2(lx, lz))), lim = this.fov * DEG * 0.5 * 1.25;      // (the horizontal half-angle is about 1.6x the vertical one)
      if (off > lim) look.lerp(_v.set(S.x, look.y, S.z), clamp((off - lim) / Math.max(off, 1e-3) * 1.2, 0, 1));
    }
    const fovGoal = 56 + this.pull * 5;
    this.fov = first ? fovGoal : this.fov + (fovGoal - this.fov) * damp(2.5, dt);
    // kick spring + shake (at the giants' scale)
    this.kickVel.addScaledVector(this.kick, -220 * dt);
    this.kickVel.multiplyScalar(Math.exp(-16 * dt));
    this.kick.addScaledVector(this.kickVel, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma * this.shakeScale, t = this.time, cam = this.cam;
    cam.position.copy(pos).addScaledVector(this.kick, this.shakeScale * 4);
    cam.position.x += noise1(t, 1) * 1.1 * sh + noise1(t * 0.23, 7) * 0.05;
    cam.position.y += noise1(t, 2) * 0.9 * sh + noise1(t * 0.19, 8) * 0.04;
    cam.position.z += noise1(t, 3) * 1.1 * sh;
    cam.lookAt(look);
    cam.rotateZ(noise1(t, 4) * 0.03 * sh);
    this.fovPunch = Math.max(0, this.fovPunch - dt * 18);
    const fov = this.fov - this.fovPunch;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.dist = back;
    this.info.dist = back; this.info.fov = fov; this.info.focus = 'duel'; this.info.feasible = true;
    return this.info;
  }

  bossBodies() {
    const b = this.boss;
    if (!b || b.dead || !b.colliders) return null;
    const list = b.colliders() || [];
    const out = this._bodies || (this._bodies = []);
    out.length = 0;
    for (const c of list) if (c.r > 0) out.push({ x: c.x, z: c.z, r: c.r, top: c.top ?? 14 });
    return out;
  }

  /** How far (0..1) along target -> pos the camera can sit without entering a blocker. */
  clearance(target, pos, withBodies = true) {
    const d = _seg.subVectors(pos, target);
    let s = 1;
    const bl = this.blockers;
    if (bl) {
      // thin props (broken steles, planted weapons, posts) never yank the camera in an open arena; big rocks/pillars do
      if (bl.circles) for (const c of bl.circles) if (c.r >= 1.5) s = Math.min(s, enterCircle(target, d, c.x, c.z, c.r + 0.35));
      const b = bl.bounds;
      if (b) {
        if (pos.x > b.maxX && d.x > 1e-6) s = Math.min(s, (b.maxX - target.x) / d.x);
        if (pos.x < b.minX && d.x < -1e-6) s = Math.min(s, (b.minX - target.x) / d.x);
        if (pos.z > b.maxZ && d.z > 1e-6) s = Math.min(s, (b.maxZ - target.z) / d.z);
        if (pos.z < b.minZ && d.z < -1e-6) s = Math.min(s, (b.minZ - target.z) / d.z);
      }
    }
    const bodies = !withBodies ? null : this.bodies ? this.bodies() : this.bossBodies();
    if (bodies) {
      for (const o of bodies) {
        const e = enterCircle(target, d, o.x, o.z, o.r + 0.3);
        if (e < 1 && target.y + d.y * e < o.top) s = Math.min(s, e);
      }
    }
    return Math.max(0.12, s);
  }
}
