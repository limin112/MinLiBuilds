// Runtime for an animated character: base locomotion clips + procedural move layer + held sword.
import * as THREE from 'three';
import { Rig, ease } from './pose.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _jAx = new THREE.Vector3(), _jQ = new THREE.Quaternion(), _UP = new THREE.Vector3(0, 1, 0);
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _fc = new THREE.Vector3(), _fd = new THREE.Vector3();
const _fe = new THREE.Vector3(), _ff = new THREE.Vector3(), _fg = new THREE.Vector3(), _fh = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const _hp0 = new THREE.Vector3(), _hp1 = new THREE.Vector3(), _hp2 = new THREE.Vector3(), _hp3 = new THREE.Vector3();
const _wu = new THREE.Vector3(), _wv = new THREE.Vector3(), _wp = new THREE.Vector3(), _wq = new THREE.Vector3(), _wt = new THREE.Vector3();
const FIST = 1;                          // rig.curl amount of a fist closed on the rod
const _ha = new THREE.Vector3(), _hb = new THREE.Vector3(), _hn = new THREE.Vector3(), _hx = new THREE.Vector3();
/** Centre of the curled middle finger's arc (circumcentre of its three joints): the hole of the fist. */
function hollow(j1, j2, j3, out) {
  const a = j1.getWorldPosition(out), ab = j2.getWorldPosition(_ha).sub(a), ac = j3.getWorldPosition(_hb).sub(a);
  const n = _hn.crossVectors(ab, ac), nn = n.lengthSq();
  if (nn < 1e-12) return out.addScaledVector(ab, 0.5);
  _hx.crossVectors(n, ab).multiplyScalar(ac.lengthSq()).add(_ha.crossVectors(ac, n).multiplyScalar(ab.lengthSq()));
  return out.addScaledVector(_hx, 1 / (2 * nn));
}

export class Actor {
  /**
   * @param char    result of loadCharacter()
   * @param lib     move library (HEROINE / BOSS)
   * @param hold    overlay pose applied under locomotion (sword hold)
   * @param sword   Group from loadBlade() or null
   */
  constructor(char, { lib, hold = null, sword = null, scene = null, fist = false }) {
    this.char = char;
    this.fist = fist;                  // close the hands around the held rod (fistOn) instead of trusting the poses' hands
    this.root = char.root;
    this.lib = lib;
    this.hold = hold;
    this.holdW = hold ? 1 : 0;
    this.rig = new Rig(char);
    this.mixer = new THREE.AnimationMixer(char.model);
    this.actions = {};
    for (const [name, clip] of Object.entries(char.clips)) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      this.actions[name] = a;
    }
    this.baseName = null;
    this.move = null;
    this.sword = sword;
    if (sword && scene) scene.add(sword);
    this.bladeDir = new THREE.Vector3(0, -0.4, 0.9).normalize();
    this.bladeLocal = null;            // blade direction in the right-hand bone frame (calibrated on first frame)
    this.grip = new THREE.Vector3();
    this.bladeBase = new THREE.Vector3();
    this.bladeTip = new THREE.Vector3();
    this.prevBase = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.timeScale = 1;
    this.frozen = 0;                   // hitstop seconds remaining (animation frozen)
    this.lastPose = null;
    this.moveW = 0;
    this.planted = null;
    this.extra = null;               // extra overlay pose under moves (e.g. strafing twist)
    this.extraW = 0;
    this.joltDir = new THREE.Vector3(0, 0, 1); this.joltAmp = 0; this.joltT = 0; this.shiver = 0; this.shiverAt = 0;
    this.guard = null;               // guard overlay (blocking), also steers the blade
    this.guardW = 0;
  }

  /** Natural forward speed of a locomotion clip in m/s (from its removed root motion). */
  clipSpeed(name) {
    const c = this.char.clips[name];
    return c?.userData?.rootSpeed ? c.userData.rootSpeed * this.char.scale : 0;
  }

  playBase(name, { fade = 0.25, timeScale = 1, once = false } = {}) {
    const next = this.actions[name];
    if (!next) return;
    next.setEffectiveTimeScale(timeScale);
    if (this.baseName === name) return;
    const prev = this.actions[this.baseName];
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (prev) next.crossFadeFrom(prev, fade, true);
    this.baseName = name;
  }

  setBaseTimeScale(s) { this.actions[this.baseName]?.setEffectiveTimeScale(s); }

  startMove(name, { speed = 1, onEvent = null } = {}) {
    const def = this.lib[name];
    if (!def) throw new Error('unknown move ' + name);
    this.move = { name, def, t: 0, speed, hold: 0, onEvent, fired: new Set(), done: false };
    return this.move;
  }

  stopMove() {
    this.move = null;
    this.rig.resetPivot();
  }

  /** Current move time (seconds) or -1. */
  get moveTime() { return this.move ? this.move.t : -1; }

  inWindow(win) { const t = this.moveTime; return t >= win[0] && t <= win[1]; }

  update(dt) {
    let adt = dt * this.timeScale;
    if (this.frozen > 0) { this.frozen -= dt; adt = 0; }
    // AnimationMixer only writes a bone when its animated value changed since the last frame, so with frozen time
    // (hitstop) or constant tracks the previous frame's procedural edits would survive and stack up. Put every bone
    // back to last frame's pure animation pose first, then let the mixer update, then snapshot the new pure pose.
    const bones = this.char.skeleton ? this.char.skeleton.bones : [];
    if (this.animPose) {
      for (let i = 0; i < bones.length; i++) {
        const b = bones[i], o = i * 10, a = this.animPose;
        b.position.set(a[o], a[o + 1], a[o + 2]); b.quaternion.set(a[o + 3], a[o + 4], a[o + 5], a[o + 6]); b.scale.set(a[o + 7], a[o + 8], a[o + 9]);
      }
    } else this.animPose = new Float32Array(bones.length * 10);
    this.mixer.update(adt);
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i], o = i * 10, a = this.animPose;
      a[o] = b.position.x; a[o + 1] = b.position.y; a[o + 2] = b.position.z;
      a[o + 3] = b.quaternion.x; a[o + 4] = b.quaternion.y; a[o + 5] = b.quaternion.z; a[o + 6] = b.quaternion.w;
      a[o + 7] = b.scale.x; a[o + 8] = b.scale.y; a[o + 9] = b.scale.z;
    }
    this.rig.resetPivot();
    this.rig.curled.Left = this.rig.curled.Right = 0;
    this.char.root.updateMatrixWorld(true);

    let pose = null, W = 0;
    const mv = this.move;
    if (mv) {
      const def = mv.def;
      const holdAt = def.holdAt ?? def.chargeAt;
      if (mv.holding && holdAt !== undefined && mv.t >= holdAt) {
        mv.hold += adt;
      } else {
        mv.t += adt * mv.speed;
      }
      const dur = def.track_.duration;
      const bi = def.blendIn ?? 0.08, bo = def.blendOut ?? 0.16;
      W = Math.min(1, mv.t / bi) * Math.min(1, Math.max(0, (dur - mv.t) / bo));
      W = ease.inOut(THREE.MathUtils.clamp(W, 0, 1));
      pose = def.track_.evaluate(mv.t);
      if (mv.t >= dur) { mv.done = true; }
    }
    this.moveW = W;
    this.lastPose = pose;

    // capture foot positions from the base animation for 'plant' legs
    this.planted = { Left: this.rig.footWorld('Left'), Right: this.rig.footWorld('Right') };

    if (this.hold && this.holdW > 0 && W < 1) this.rig.apply(this.hold, this.holdW * (1 - W));
    if (this.extra && this.extraW > 0.001 && W < 1) this.rig.apply(this.extra, this.extraW * (1 - W));
    if (this.guard && this.guardW > 0.001 && W < 1) this.rig.apply(this.guard, this.guardW * (1 - W));
    // blade direction requested by the pose (character space) - needed before the two-handed left arm IK
    const poseBlade = pose && pose.blade ? this.rig.dir(pose.blade, new THREE.Vector3()).normalize() : null;
    if (pose && W > 0) {
      const p = pose.armL && pose.armL.twoHand ? this.twoHandPose(pose, poseBlade) : pose;
      this.rig.apply(p, W, this.planted);
    }
    let bladeTarget = poseBlade, bladeW = W;
    if (this.guard && this.guardW > 0.01 && this.guard.blade && (!poseBlade || W < 0.5)) {
      bladeTarget = this.rig.dir(this.guard.blade, new THREE.Vector3()).normalize();
      bladeW = Math.max(W, this.guardW * (1 - W));
    }
    this.applyJolt(adt);
    this.updateBlade(bladeTarget, bladeW);
    if (mv && mv.done) this.stopMove();
  }

  /**
   * A blow lands: the body shivers in place while the hitstop holds time, then the torso bends away from the blow
   * and springs back - on top of whatever move is playing, so even a hyper-armoured attack visibly takes the hit.
   * @param dir   world direction the blow travels (away from the attacker)
   * @param bend  peak torso bend, radians
   * @param shiver hitstop vibration, fraction of the character's height
   */
  jolt(dir, bend = 0.08, shiver = 0.012) {
    this.joltDir.set(dir.x, 0, dir.z);
    if (this.joltDir.lengthSq() < 1e-6) this.joltDir.copy(this.rig.F).negate();
    this.joltDir.normalize();
    this.joltAmp = bend; this.joltT = 0;
    this.shiver = shiver; this.shiverAt = performance.now();
  }

  applyJolt(adt) {
    const b = this.rig.b;
    if (this.shiver > 0) {
      const age = (performance.now() - this.shiverAt) / 1000;
      if (adt > 0 || age > 0.4) this.shiver = 0;          // only while time is frozen
      else {
        const k = this.shiver * this.char.height * Math.max(0, 1 - age / 0.4);
        const s = Math.sin(age * 2 * Math.PI * 34), c = Math.cos(age * 2 * Math.PI * 23);
        this.char.pivot.position.x += k * s; this.char.pivot.position.z += k * 0.6 * c;
        this.char.pivot.updateMatrixWorld(true);
      }
    }
    if (this.joltAmp > 0) {
      this.joltT += adt;
      if (this.joltT > 0.55) { this.joltAmp = 0; return; }
      const x = this.joltT / 0.075, a = this.joltAmp * x * Math.exp(1 - x);     // peaks after 75 ms, gone by ~0.5 s
      if (a < 1e-4) return;
      _jAx.crossVectors(_UP, this.joltDir).normalize();                      // + angle tips the chest along the blow
      const sp = b.Spine1 || b.Spine, sp2 = b.Spine2, head = b.Head;
      if (sp) this.rig.rotateWorld(sp, _jQ.setFromAxisAngle(_jAx, a * 0.6));
      if (sp2) this.rig.rotateWorld(sp2, _jQ.setFromAxisAngle(_jAx, a * 0.5));
      if (head) this.rig.rotateWorld(head, _jQ.setFromAxisAngle(_jAx, -a * 0.35)); // the head lags behind
    }
  }

  /** Replace armL.twoHand with an explicit target just below the right hand on the grip. */
  twoHandPose(pose, bladeDir) {
    // the right arm is solved first inside apply(); approximate the right-hand target here
    const sh = this.rig.b.RightArm.getWorldPosition(new THREE.Vector3());
    const rTarget = sh.add(this.rig.dir(pose.armR.at, new THREE.Vector3()).multiplyScalar(this.rig.armLen.Right));
    const spacing = 0.1 * (this.char.height / 1.7);
    const lTarget = rTarget.clone().addScaledVector(bladeDir || this.bladeDir, -spacing);
    const lsh = this.rig.b.LeftArm.getWorldPosition(new THREE.Vector3());
    const rel = lTarget.sub(lsh).divideScalar(this.rig.armLen.Left);
    // world -> character space [r,u,f]
    const at = [rel.dot(this.rig.R), rel.dot(this.rig.U), rel.dot(this.rig.F)];
    return { ...pose, armL: { at, pole: [-0.7, -0.5, -0.4] }, gripL: 1 };
  }

  updateBlade(poseBlade, W) {
    const hand = this.rig.b.RightHand, mid = this.rig.b.RightHandMiddle1;
    if (!hand) return;
    hand.getWorldPosition(_v);
    mid.getWorldPosition(_v2);
    this.grip.copy(_v).lerp(_v2, 0.85);
    hand.getWorldQuaternion(_q);
    if (!this.bladeLocal) {
      // calibrate: the hold pose's blade direction expressed in the hand frame
      const d = this.hold?.blade ? this.rig.dir(this.hold.blade, new THREE.Vector3()).normalize() : this.rig.F.clone();
      this.bladeLocal = d.applyQuaternion(_q.clone().invert());
    }
    const handDir = this.bladeLocal.clone().applyQuaternion(_q).normalize();
    if (poseBlade && W > 0) {
      const qa = new THREE.Quaternion().setFromUnitVectors(handDir, poseBlade);
      const qb = new THREE.Quaternion().slerp(qa, W);
      this.bladeDir.copy(handDir).applyQuaternion(qb).normalize();
    } else {
      this.bladeDir.copy(handDir);
    }
    if (this.fist && this.sword && this.sword.visible !== false) {
      if (this.fistOn('Right', this.bladeDir, 1, _fh)) {
        this.grip.copy(_fh);
        this.wrapHand('Right', this.bladeDir, this.grip, 1);
      }
      this.fistLeft();
    }
    if (this.sword) {
      const y = this.bladeDir;
      const x = new THREE.Vector3().crossVectors(y, this.rig.U);
      if (x.lengthSq() < 1e-6) x.crossVectors(y, this.rig.F);
      x.normalize();
      const z = new THREE.Vector3().crossVectors(x, y).normalize();
      _m.makeBasis(x, y, z);
      this.sword.quaternion.setFromRotationMatrix(_m);
      this.sword.position.copy(this.grip);
      this.sword.updateMatrixWorld(true);
      const L = this.sword.userData.length || 1;
      const gf = this.sword.userData.gripFrac || 0.12;
      this.prevBase.copy(this.bladeBase);
      this.prevTip.copy(this.bladeTip);
      this.bladeBase.copy(this.grip).addScaledVector(y, L * (0.16 - gf + 0.06));
      this.bladeTip.copy(this.grip).addScaledVector(y, L * (1 - gf));
    }
  }

  /**
   * Turn a hand so the rod runs across the palm - the knuckle line along `dir`, the index side toward the head end -
   * close the fist around it, and return the middle of the fist's hollow, where the rod has to pass.
   * (The poses aim the hand along the rod; on their own the rod came out of the fingertips through an open hand.)
   */
  fistOn(side, dir, w, out) {
    const B = this.rig.b, hand = B[side + 'Hand'], i1 = B[side + 'HandIndex1'], p1 = B[side + 'HandPinky1'];
    const m1 = B[side + 'HandMiddle1'], m2 = B[side + 'HandMiddle2'], m3 = B[side + 'HandMiddle3'];
    if (!hand || !i1 || !p1 || !m1 || !m2 || !m3 || w <= 0) return null;
    const k = _fa.subVectors(i1.getWorldPosition(_fb), p1.getWorldPosition(_fc)).normalize();
    this.rig.rotateWorld(hand, _fq.setFromUnitVectors(k, dir), w);
    this.straightenWrist(side, dir, w);
    // which way round the fist sits on the rod: the thumb's side of the hand toward the body and downward. Facing
    // out or up it read as a hand put on backwards (2026-11-16 user, picking from the variants): turn the fist over
    // about the rod - the rod then lies across the palm with the fingers closing up over it
    if (w > 0.5) {
      const th = this.palmDir(side, _wt), want = this.rig.dir(side === 'Right' ? [-1, -1, 0] : [1, -1, 0], _wq);
      if (th.dot(want) < 0) this.rig.rotateWorld(hand, _fq.setFromAxisAngle(dir, Math.PI), 1);
    }
    const more = w * FIST - this.rig.curled[side];
    if (more > 0.02) this.rig.curl(side, more, 1);
    // the rod's axis: one rod-and-finger radius in from the middle knuckle, on the palm side. Which side of the hand
    // that is gets read once from the generic curl; after that it comes from the hand's own frame, so a hand whose
    // fingers are already wrapped (the left fist is closed twice a frame in the fight) still lands in the same place
    const k1 = m1.getWorldPosition(_fb), pn = _fc.subVectors(k1, hand.getWorldPosition(_fd)).normalize();
    pn.crossVectors(dir, pn).normalize();
    const ps = this._palmSide || (this._palmSide = {});
    if (ps[side] === undefined) ps[side] = Math.sign(hollow(m1, m2, m3, out).sub(k1).dot(pn)) || 1;
    return out.copy(k1).addScaledVector(pn, ps[side] * this.wrapR());
  }

  /**
   * With the knuckles along the rod the hand can still roll about it; roll it until the back of the hand runs on
   * from the forearm (the wrist as straight as the rod allows). Left to the shortest turn it twisted the wrist and
   * folded the hand under, the rod seeming to go through the palm.
   */
  straightenWrist(side, dir, w) {
    const B = this.rig.b, hand = B[side + 'Hand'], fore = B[side + 'ForeArm'], m1 = B[side + 'HandMiddle1'];
    if (!fore || !m1) return;
    const hp = hand.getWorldPosition(_fd);
    const fo = _fe.subVectors(hp, fore.getWorldPosition(_fa)), fd = _ff.subVectors(m1.getWorldPosition(_fb), hp);
    fo.addScaledVector(dir, -fo.dot(dir)); fd.addScaledVector(dir, -fd.dot(dir));
    if (fo.lengthSq() < 1e-10 || fd.lengthSq() < 1e-10) return;
    fo.normalize(); fd.normalize();
    const ang = Math.atan2(_fc.crossVectors(fd, fo).dot(dir), fd.dot(fo));
    this.rig.rotateWorld(hand, _fq.setFromAxisAngle(dir, ang), w);
  }

  /** The thumb's side of the hand: off the plane of the hand, toward the thumb. */
  palmDir(side, out) {
    const B = this.rig.b, h = B[side + 'Hand'].getWorldPosition(_hp0);
    const fd = _hp1.subVectors(B[side + 'HandMiddle1'].getWorldPosition(_hp1), h);
    const k = _hp2.subVectors(B[side + 'HandIndex1'].getWorldPosition(_hp2), B[side + 'HandPinky1'].getWorldPosition(_hp3));
    out.crossVectors(fd, k).normalize();
    if (B[side + 'HandThumb2'].getWorldPosition(_hp3).sub(h).dot(out) < 0) out.negate();
    return out;
  }

  /** Where the rod's axis sits in a hand already turned along it (see fistOn). */
  palmAxis(side, out) {
    const B = this.rig.b, k1 = B[side + 'HandMiddle1'].getWorldPosition(_fb);
    const pn = _fc.subVectors(k1, B[side + 'Hand'].getWorldPosition(_fd)).normalize();
    pn.crossVectors(this.bladeDir, pn).normalize();
    return out.copy(k1).addScaledVector(pn, (this._palmSide?.[side] || 1) * this.wrapR());
  }

  /** Radius the finger bones run round the rod at: the rod's own plus half a finger. */
  wrapR() { return (this.sword.userData.radius || 0.029) * (this.sword.scale.x || 1) * 1.42; }

  /**
   * Lay every finger round the rod, joint by joint: each knuckle turns about the rod's direction until the next joint
   * sits one wrapR() from its axis - so the fingers close on it instead of hooking past it or sinking into it.
   * The thumb goes round the same way. axisAt: a point on the rod's axis.
   */
  wrapHand(side, dir, axisAt, w = 1) {
    if (w <= 0.01) return;
    const B = this.rig.b, R = this.wrapR();
    const u = _wu.set(1, 0, 0);
    if (Math.abs(u.dot(dir)) > 0.9) u.set(0, 1, 0);
    u.addScaledVector(dir, -u.dot(dir)).normalize();
    const v = _wv.crossVectors(dir, u);
    const P = (b, o) => { const p = b.getWorldPosition(_wp).sub(axisAt); o.x = p.dot(u); o.y = p.dot(v); return o; };
    const c = { x: 0, y: 0 }, q = { x: 0, y: 0 };
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
      for (let i = 1; i <= 3; i++) {
        const bone = B[side + 'Hand' + f + i], child = B[side + 'Hand' + f + (i + 1)];
        if (!bone || !child) break;
        // square the segment across the rod first: the model's fingers fan out, and a fanned hand never reads as a fist
        const bp = bone.getWorldPosition(_wq), seg = child.getWorldPosition(_wp).sub(bp), len = seg.length();
        if (f !== 'Thumb' && len > 1e-6) {
          const along = seg.dot(dir) / len;
          if (Math.abs(along) > 0.02) {
            _wt.copy(seg).addScaledVector(dir, -seg.dot(dir)).normalize();
            seg.normalize();
            this.rig.rotateWorld(bone, _fq.setFromUnitVectors(seg, _wt), w);
          }
        }
        P(bone, c); P(child, q);
        const rx = q.x - c.x, ry = q.y - c.y, r = Math.hypot(rx, ry), d = Math.hypot(c.x, c.y);
        if (r < 1e-6 || d < 1e-6) continue;
        // the outer joints pull in tighter and the tips sink just under the rod's skin: the fingers are long for a
        // rod this thick, and laid on its surface they stopped half way round, the tips showing on the far side
        const Ri = R * (i === 1 ? 1 : i === 2 ? 0.86 : 0.55);
        const ca = THREE.MathUtils.clamp((r * r + d * d - Ri * Ri) / (2 * r * d), -1, 1);
        const base = Math.atan2(-c.y, -c.x), al = Math.acos(ca), phi = Math.atan2(ry, rx);
        const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
        const d1 = wrap(base + al - phi), d2 = wrap(base - al - phi);
        const delta = Math.abs(d1) < Math.abs(d2) ? d1 : d2;
        this.rig.rotateWorld(bone, _fq.setFromAxisAngle(dir, delta * w), 1);
      }
    }
  }

  /** Closest point of the held rod to p. */
  onRod(p, out) {
    const ud = this.sword.userData, L = (ud.length || 1) * (this.sword.scale.y || 1), gf = ud.gripFrac ?? 0.3;
    const s = THREE.MathUtils.clamp(_fa.subVectors(p, this.grip).dot(this.bladeDir), -L * gf, L * (1 - gf));
    return out.copy(this.grip).addScaledVector(this.bladeDir, s);
  }

  /**
   * The left fist onto the rod wherever a pose brought the left hand to it (two-handed blows, the guard, the
   * cinematics): close it the same way and carry the arm the last few centimetres so the rod goes through the fist.
   * @param force weight to use instead of judging it from how near the hand already is (0 = judge)
   */
  fistLeft(force = 0) {
    const B = this.rig.b, hand = B.LeftHand, mid = B.LeftHandMiddle1;
    if (!this.fist || !this.sword || !hand || !mid || !B.LeftArm || !B.LeftForeArm) return;
    const hp = hand.getWorldPosition(_fd), mp = mid.getWorldPosition(_fe);
    const hl = hp.distanceTo(mp) || 0.1;
    const near = this.onRod(mp, _ff).distanceTo(mp);
    const w = force || 1 - THREE.MathUtils.smoothstep(near, 1.1 * hl, 2.2 * hl);
    if (w < 0.01) return;
    const hol = this.fistOn('Left', this.bladeDir, w, _fh);
    if (!hol) return;
    // carry the hand by the gap between the hollow and the rod, keeping the elbow on its side; the arm's IK turns the
    // hand a little, so turn it back along the rod and repeat (three passes close the gap to a few millimetres)
    const sh = B.LeftArm.getWorldPosition(_fb), el = B.LeftForeArm.getWorldPosition(_fc);
    const pole = el.sub(sh.add(hand.getWorldPosition(_fd)).multiplyScalar(0.5)).normalize().clone();
    for (let i = 0; i < 3; i++) {
      if (i) this.palmAxis('Left', hol);
      const gap = this.onRod(hol, _ff).sub(hol).multiplyScalar(w);
      if (gap.lengthSq() < 1e-6) break;
      hand.getWorldPosition(_fd).add(gap);
      this.rig.ik(B.LeftArm, B.LeftForeArm, B.LeftHand, _fd, pole, 1);
      const k = _fa.subVectors(B.LeftHandIndex1.getWorldPosition(_fb), B.LeftHandPinky1.getWorldPosition(_fc)).normalize();
      this.rig.rotateWorld(hand, _fq.setFromUnitVectors(k, this.bladeDir), w);
      this.straightenWrist('Left', this.bladeDir, w);
    }
    this.wrapHand('Left', this.bladeDir, this.onRod(hand.getWorldPosition(_fd), _fg), w);
  }

  /** World position of a bone (by short Mixamo name). */
  bonePos(name, out = new THREE.Vector3()) { return this.rig.b[name].getWorldPosition(out); }
}
