// Procedural posing for Mixamo-spec skeletons, layered on top of AnimationMixer output.
//
// Poses are authored in CHARACTER SPACE with components [r, u, f] = (right, up, forward), so they do not depend
// on per-bone local axes. Arms/legs are driven by two-bone IK toward targets expressed relative to the shoulder /
// hip joint in units of the limb's length; the spine/neck by rotations about character axes; the whole body by
// the character's `pivot` group (rolls, knockdowns).
import * as THREE from 'three';

const DEG = Math.PI / 180;
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _rwD = new THREE.Quaternion(), _rwT = new THREE.Quaternion(), _rwP = new THREE.Quaternion(), _rwW = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export const ease = {
  linear: t => t,
  in: t => t * t,
  out: t => 1 - (1 - t) * (1 - t),
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  snap: t => 1 - Math.pow(1 - t, 4),          // fast strike that decelerates
  windup: t => t * t * (3 - 2 * t),           // smoothstep
  back: t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }, // overshoot
};

export class Rig {
  constructor(char) {
    this.char = char;
    this.root = char.root;
    this.pivot = char.pivot;
    this.b = char.bones;
    this.h = char.height;
    char.root.updateMatrixWorld(true);
    const len = (a, b) => this.b[a].getWorldPosition(_a).distanceTo(this.b[b].getWorldPosition(_b));
    this.armLen = { Left: len('LeftArm', 'LeftForeArm') + len('LeftForeArm', 'LeftHand'),
                    Right: len('RightArm', 'RightForeArm') + len('RightForeArm', 'RightHand') };
    this.legLen = { Left: len('LeftUpLeg', 'LeftLeg') + len('LeftLeg', 'LeftFoot'),
                    Right: len('RightUpLeg', 'RightLeg') + len('RightLeg', 'RightFoot') };
    this.hipsRestY = this.b.Hips.getWorldPosition(_a).y - this.root.getWorldPosition(_b).y;
    // character axes in world space, refreshed by frame()
    this.R = new THREE.Vector3(); this.U = new THREE.Vector3(); this.F = new THREE.Vector3();
    this.frame();
    this.gripCurl = 0;
  }

  /** Refresh the character axes from the root's world orientation (+Z forward). */
  frame() {
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_q);
    this.F.set(0, 0, 1).applyQuaternion(_q);
    this.U.set(0, 1, 0).applyQuaternion(_q);
    this.R.crossVectors(this.F, this.U).normalize(); // forward x up = right
    return this;
  }

  /** [r,u,f] -> world direction (not normalized). */
  dir(v, out = new THREE.Vector3()) {
    return out.set(0, 0, 0).addScaledVector(this.R, v[0]).addScaledVector(this.U, v[1]).addScaledVector(this.F, v[2]);
  }

  /** Apply a world-space rotation delta to a bone (keeping its children attached), with weight. */
  rotateWorld(bone, delta, w = 1) {
    if (w <= 0) return;
    const d = _rwD.copy(delta);
    if (w < 1) d.slerpQuaternions(_qi, _rwT.copy(d), w);
    bone.parent.getWorldQuaternion(_rwP);
    bone.getWorldQuaternion(_rwW);
    _rwW.premultiply(d);                      // new world rotation
    bone.quaternion.copy(_rwP.invert().multiply(_rwW));
    bone.updateMatrixWorld(true);
  }

  /** Rotate a bone about a character-space axis. */
  turn(bone, axis, angle, w = 1) {
    if (!angle || w <= 0) return;
    const ax = this.dir(axis, new THREE.Vector3()).normalize();
    this.rotateWorld(bone, new THREE.Quaternion().setFromAxisAngle(ax, angle), w);
  }

  /** Rotate `bone` so the segment bone->child points along world direction `target`. */
  aim(bone, child, target, w = 1) {
    if (w <= 0) return;
    const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    const to = target.clone().normalize();
    if (from.dot(to) > 0.99999) return;
    this.rotateWorld(bone, new THREE.Quaternion().setFromUnitVectors(from, to), w);
  }

  /** Two-bone IK: upper->lower->end reaches `target` (world), bending toward world direction `pole`. */
  ik(upper, lower, end, target, pole, w = 1) {
    if (w <= 0) return;
    const a = upper.getWorldPosition(new THREE.Vector3());
    const bPos = lower.getWorldPosition(new THREE.Vector3());
    const l1 = a.distanceTo(bPos);
    const l2 = bPos.distanceTo(end.getWorldPosition(new THREE.Vector3()));
    const dir = target.clone().sub(a);
    let d = dir.length();
    dir.normalize();
    d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const n = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0).addScaledVector(dir, -dir.y);
    n.normalize();
    const elbow = a.clone().addScaledVector(dir, l1 * cosA).addScaledVector(n, l1 * sinA);
    const reach = a.clone().addScaledVector(dir, d);
    this.aim(upper, lower, elbow.sub(a), w);
    this.aim(lower, end, reach.sub(lower.getWorldPosition(new THREE.Vector3())), w);
  }

  /** Close the fingers around a grip (0 open .. 1 fist) for one hand. */
  curl(side, amount, w = 1) {
    if (amount <= 0 || w <= 0) return;
    const hand = this.b[side + 'Hand'];
    const thumb = this.b[side + 'HandThumb1'];
    const mid = this.b[side + 'HandMiddle1'];
    if (!thumb || !mid) return;
    const fingerDir = mid.getWorldPosition(_a).sub(hand.getWorldPosition(_b)).normalize();
    const thumbDir = thumb.getWorldPosition(_c).sub(_b).normalize();
    // palm normal points away from the back of the hand; curl axis bends fingers toward the palm
    const axis = new THREE.Vector3().crossVectors(fingerDir, thumbDir).normalize();
    if (side === 'Left') axis.negate();
    const rot = new THREE.Quaternion();
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
      for (let i = 1; i <= 3; i++) {
        const bone = this.b[side + 'Hand' + f + i];
        if (bone) this.rotateWorld(bone, rot.setFromAxisAngle(axis, amount * (i === 1 ? 1.15 : 1.0)), w);
      }
    }
  }

  // ------------------------------------------------------------------ pose application

  /**
   * Apply an evaluated pose with global weight W. The pose fields are optional:
   *   pivot: { pitch, roll, yaw (deg), y (fraction of height), z }   whole-body transform about the hips
   *   hips: [r,u,f] offset in leg lengths; hipsTurn: [pitch, yaw, roll] deg
   *   spine: [pitch(+forward), yaw(+toward right), roll(+lean right)] deg, spread over Spine/Spine1/Spine2
   *   head: [pitch, yaw, roll] deg over Neck/Head
   *   armR/armL: { at: [r,u,f] hand target from the shoulder in arm lengths, pole: [r,u,f] }
   *   legR/legL: { at: [r,u,f] foot target from the hip joint in leg lengths, pole } | 'plant'
   *   grip: 0..1 (right hand fist), gripL: 0..1
   *   w: { arms, legs, spine } optional per-group weights (0..1)
   */
  apply(p, W = 1, planted = null) {
    if (!p || W <= 0.0001) return;
    const g = p.w || {};
    this.frame();
    // whole body
    if (p.pivot) {
      const pv = p.pivot;
      this.pivot.position.set(0, (pv.y || 0) * this.h * W, (pv.z || 0) * this.h * W);
      this.pivot.rotation.set((pv.pitch || 0) * DEG * W, (pv.yaw || 0) * DEG * W, (pv.roll || 0) * DEG * W);
      // rotate about the hips height instead of the feet
      const hy = this.hipsRestY * 0.85;
      const off = new THREE.Vector3(0, hy, 0).applyEuler(this.pivot.rotation);
      this.pivot.position.add(new THREE.Vector3(0, hy, 0).sub(off));
      this.pivot.updateMatrixWorld(true);
      this.frame();
    }
    const B = this.b;
    if (p.hips) {
      const L = (this.legLen.Left + this.legLen.Right) / 2;
      const target = B.Hips.getWorldPosition(new THREE.Vector3()).add(this.dir(p.hips).multiplyScalar(L * W));
      const parent = B.Hips.parent;
      parent.updateMatrixWorld(true);
      parent.worldToLocal(target);
      B.Hips.position.copy(target);
      B.Hips.updateMatrixWorld(true);
    }
    if (p.hipsTurn) {
      const [pt, yw, rl] = p.hipsTurn;
      this.turn(B.Hips, [-1, 0, 0], pt * DEG, W);
      this.turn(B.Hips, [0, -1, 0], yw * DEG, W);
      this.turn(B.Hips, [0, 0, 1], rl * DEG, W);
    }
    const ws = (g.spine ?? 1) * W;
    if (p.spine) {
      const [pt, yw, rl] = p.spine;
      for (const [name, k] of [['Spine', 0.3], ['Spine1', 0.35], ['Spine2', 0.35]]) {
        this.turn(B[name], [-1, 0, 0], pt * k * DEG, ws);
        this.turn(B[name], [0, -1, 0], yw * k * DEG, ws);
        this.turn(B[name], [0, 0, 1], rl * k * DEG, ws);
      }
    }
    if (p.head) {
      const [pt, yw, rl] = p.head;
      for (const [name, k] of [['Neck', 0.4], ['Head', 0.6]]) {
        this.turn(B[name], [-1, 0, 0], pt * k * DEG, ws);
        this.turn(B[name], [0, -1, 0], yw * k * DEG, ws);
        this.turn(B[name], [0, 0, 1], rl * k * DEG, ws);
      }
    }
    const wa = (g.arms ?? 1) * W;
    for (const side of ['Right', 'Left']) {
      const arm = p['arm' + side[0]];
      if (!arm || wa <= 0) continue;
      const sh = B[side + 'Arm'].getWorldPosition(new THREE.Vector3());
      const tgt = sh.add(this.dir(arm.at).multiplyScalar(this.armLen[side]));
      const pole = this.dir(arm.pole || (side === 'Right' ? [0.4, -0.5, -0.5] : [-0.4, -0.5, -0.5]));
      this.ik(B[side + 'Arm'], B[side + 'ForeArm'], B[side + 'Hand'], tgt, pole, wa * (arm.w ?? 1));
      if (arm.hand) this.aim(B[side + 'Hand'], B[side + 'HandMiddle1'], this.dir(arm.hand), wa * (arm.w ?? 1));
    }
    if (p.grip) this.curl('Right', p.grip, W);
    if (p.gripL) this.curl('Left', p.gripL, W);
    const wl = (g.legs ?? 1) * W;
    const rolling = p.pivot && Math.abs(p.pivot.pitch || 0) % 360 > 1;
    const autoPlant = p.hips && planted && !rolling && (p.hips[0] || p.hips[1] || p.hips[2]);
    for (const side of ['Left', 'Right']) {
      const leg = p['leg' + side[0]] || (autoPlant ? 'plant' : null);
      if (!leg || wl <= 0) continue;
      let tgt;
      if (leg === 'plant') {
        if (!planted || !planted[side]) continue;
        tgt = planted[side].clone();
      } else {
        const hip = B[side + 'UpLeg'].getWorldPosition(new THREE.Vector3());
        tgt = hip.add(this.dir(leg.at).multiplyScalar(this.legLen[side]));
      }
      const pole = this.dir(leg.pole || [0, 0, 1]);
      this.ik(B[side + 'UpLeg'], B[side + 'Leg'], B[side + 'Foot'], tgt, pole, wl * (leg.w ?? 1));
    }
  }

  resetPivot() {
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
  }

  footWorld(side, out = new THREE.Vector3()) { return this.b[side + 'Foot'].getWorldPosition(out); }
}

// ------------------------------------------------------------------ keyframed pose tracks

const lerpArr = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function lerpVal(a, b, t) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return lerpArr(a, b, t);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    return t < 0.5 ? a : b;   // null / booleans / strings / mismatched types step at the midpoint
  }
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = lerpVal(a[k], b[k], t);
  return out;
}

/**
 * A pose track: keys [{ t, ease?, ...poseFields }] sorted by t (seconds). Fields missing from a key inherit
 * the previous key's value. evaluate(time) returns the interpolated pose object.
 */
export class PoseTrack {
  constructor(keys, { name = '' } = {}) {
    this.name = name;
    this.keys = [];
    let prev = {};
    for (const k of keys) {
      const full = { ...prev, ...k };
      this.keys.push(full);
      prev = full;
    }
    this.duration = this.keys[this.keys.length - 1].t;
  }

  evaluate(time) {
    const k = this.keys;
    if (time <= k[0].t) return k[0];
    for (let i = 1; i < k.length; i++) {
      if (time <= k[i].t) {
        const a = k[i - 1], b = k[i];
        const span = b.t - a.t || 1e-6;
        const f = (ease[b.ease] || ease.inOut)((time - a.t) / span);
        return lerpVal(a, b, f);
      }
    }
    return k[k.length - 1];
  }
}

export function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
