// Runtime for an animated character: base locomotion clips + procedural move layer + held sword.
import * as THREE from 'three';
import { Rig, ease } from './pose.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _jAx = new THREE.Vector3(), _jQ = new THREE.Quaternion(), _UP = new THREE.Vector3(0, 1, 0);

export class Actor {
  /**
   * @param char    result of loadCharacter()
   * @param lib     move library (HEROINE / BOSS)
   * @param hold    overlay pose applied under locomotion (sword hold)
   * @param sword   Group from loadBlade() or null
   */
  constructor(char, { lib, hold = null, sword = null, scene = null }) {
    this.char = char;
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

  /** World position of a bone (by short Mixamo name). */
  bonePos(name, out = new THREE.Vector3()) { return this.rig.b[name].getWorldPosition(out); }
}
