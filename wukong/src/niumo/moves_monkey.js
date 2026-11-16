// 孙悟空 move library: keyframed procedural poses (src/pose.js format, same as src/moves.js) plus gameplay timing.
// Vectors are [right, up, forward] in character space. Arm targets are relative to the shoulder in arm lengths, leg
// targets relative to the hip joint in leg lengths, `hips` is an offset in leg lengths. `blade` is the staff direction
// (grip -> head end). The staff is a 1.9 m iron rod held like the sword (grip frame +Y from grip to tip), but the
// hands slide along it, so the poses carry a few extra numeric fields that PoseTrack interpolates and monkey.js reads:
//   slide   where the right hand grips the rod: fraction of its length from the butt end (0.12 = far end, 0.38 = middle)
//   lhand   0..1 weight of the left hand on the rod (solved by monkey.js after the pose, onto the real rod)
//   lhAt    where the left hand grips: meters along the rod from the right hand (- toward the butt, + toward the head)
//   grow    rod length multiplier (如意: the rod lengthens for the finisher's thrust)
//   fan     0..1 the banana-leaf fan in the left hand (scale in / out)
//   pblade  rod direction in the BODY frame (follows rolls and falls through the pivot) for moves with pivotBlade
//
// Move fields (as in src/moves.js):
//   keys      pose keyframes (seconds)
//   hits      [[t0, t1, { dmg, poise, hitstop, heavy }]]  active windows of the rod (each window can land once)
//   cancel    time after which the next action may start (combos, rolls)
//   iframes   [t0, t1] invulnerability
//   moveRoot  [[t0, t1, meters, ease?]] displacement along the facing
//   track     [t0, t1, deg/s] turning toward the lock target allowed in this window
//   blendIn / blendOut  seconds
// Monkey-only fields read by monkey.js:
//   spin      [[t0, t1, degrees, ease]]  the whole body turns (root yaw offset; 360 ends where it started)
//   lift      [t0, t1, meters]  a hop: the root leaves the ground on a parabola
//   impactAt  the rod head strikes the ground (dust, a ring, a small area hit)
//   chargeAt / chargeMax  K held: the pose waits at chargeAt for up to chargeMax seconds
//   fanAt     the fan's gust is released
//   grabAt / hitAt   execution: the nose ring is seized / the rod lands on the brow
//   holdAt    the pose freezes here while the move's `holding` flag is set (death, held in a giant's fist, falling)
//   pivotBlade  the rod follows the body through the pivot (rolls, falls): uses `pblade`
//   stamina   cost
import { PoseTrack } from '../pose.js';

const k = (t, o) => ({ t, ...o });

// --------------------------------------------------------------------------------------------- stances (overlays)

// Ready stance under the locomotion clips: right fist low at the hip, the rod angled forward and up across the
// body toward the enemy, the left arm free to swing. Monkey.js applies it as the actor's guard overlay at full weight
// and blends it into the block below, so every field the block uses is present here too (weights at 0).
export const MONKEY_STANCE = {
  armR: { at: [0.16, -0.64, 0.4], pole: [0.6, -0.45, -0.45], w: 0.8 },
  armL: { at: [-0.12, -0.78, 0.2], pole: [-0.6, -0.4, -0.4], w: 0 },
  blade: [-0.14, 0.45, 0.88], grip: 1, gripL: 0,
  spine: [-6, 0, 0], head: [-3, 0, 0], hips: [0, 0, 0],      // chest up, chin level: upright, not stooped
  slide: 0.38, lhand: 0, lhAt: -0.34,
};

// Guard (L held): the rod level across the chest, both fists wide apart on it - the classic staff block.
export const MONKEY_BLOCK = {
  armR: { at: [0.32, -0.3, 0.58], pole: [0.7, -0.55, -0.2], w: 1 },
  armL: { at: [-0.32, -0.26, 0.6], pole: [-0.7, -0.55, -0.2], w: 1 },
  blade: [-0.97, 0.2, 0.1], grip: 1, gripL: 1,
  spine: [8, 0, 0], head: [6, 0, 0], hips: [0, -0.06, -0.02],
  slide: 0.37, lhand: 1, lhAt: 0.6,
};

// Carried on the right shoulder, the head of the rod behind (walking in, the opening MV): 扛着铁棒.
export const MONKEY_CARRY = {
  armR: { at: [0.1, -0.08, 0.42], pole: [0.75, -0.5, -0.25], w: 0.9 },
  armL: { at: [-0.12, -0.78, 0.2], pole: [-0.6, -0.4, -0.4], w: 0 },
  blade: [0.36, 0.42, -0.83], grip: 1, gripL: 0,
  spine: [-2, 0, 0], head: [-2, 0, 0], hips: [0, 0, 0],
  slide: 0.3, lhand: 0, lhAt: -0.34,
};

// The actor's `hold`: only the rod direction (it calibrates the rod in the fist); the stance above does the posing.
export const MONKEY_HOLD = { blade: MONKEY_STANCE.blade };

// first / last key of the attacks: the stance at full arm weight
const G = { ...MONKEY_STANCE, armR: { ...MONKEY_STANCE.armR, w: 1 }, armL: { at: [-0.14, -0.8, 0.16], pole: [-0.6, -0.4, -0.4], w: 1 } };
// the rod held two-handed near its butt for long sweeping blows
const TWO = { slide: 0.2, lhand: 1, lhAt: -0.3, gripL: 1 };

// end poses of each combo hit (the next hit starts from them)
const L1_END = { armR: { at: [-0.5, -0.42, 0.42], pole: [0.3, -0.8, 0.2] }, blade: [-0.78, -0.18, -0.6], spine: [10, -42, -4], head: [0, 14, 0], hips: [0, -0.1, 0.05] };
const L2_END = { armR: { at: [0.52, 0.4, 0.3], pole: [0.6, -0.4, -0.5] }, blade: [0.45, 0.8, -0.4], spine: [-10, 32, 5], head: [-4, -12, 0], hips: [0, -0.04, 0.03] };
const L3_END = { armR: { at: [0.02, -0.46, 0.8], pole: [0.5, -0.7, -0.2] }, blade: [0.0, -0.76, 0.65], spine: [30, 0, 0], head: [8, 0, 0], hips: [0, -0.16, 0.1] };

// leg shapes
const LUNGE = { legL: { at: [-0.06, -0.8, 0.42], pole: [0, 0, 1] }, legR: { at: [0.1, -0.84, -0.4], pole: [0, 0, 1] } };
const LEGS_FREE = { legL: { at: [-0.08, -0.97, 0.02], pole: [0, 0, 1], w: 0 }, legR: { at: [0.08, -0.97, -0.02], pole: [0, 0, 1], w: 0 } };
const TUCK = { legL: { at: [-0.08, -0.5, 0.32], pole: [0, 0, 1] }, legR: { at: [0.08, -0.56, 0.12], pole: [0, 0, 1] } };

export const MONKEY = {
  stance: MONKEY_STANCE,
  block: MONKEY_BLOCK,

  // ------------------------------------------------------------------ 三段棍法 (J J J), then the finisher (4th J)
  // 1: two-handed sweep from the right, level, through the front to the left
  light1: {
    hits: [[0.11, 0.25, { dmg: 1.0, poise: 10, hitstop: 0.07 }]],
    cancel: 0.33, moveRoot: [[0.02, 0.22, 0.55, 'out']], track: [0, 0.1, 720], stamina: 12, blendIn: 0.05,
    keys: [
      k(0, G),
      k(0.085, { ease: 'windup', ...TWO, armR: { at: [0.62, -0.14, -0.1], pole: [0.5, -0.6, -0.5] }, armL: { at: [0.12, -0.4, 0.3], pole: [-0.6, -0.5, -0.3] },
        blade: [0.74, 0.1, -0.66], spine: [-4, 38, 4], head: [0, -20, 0], hips: [0, -0.06, -0.02] }),
      k(0.155, { ease: 'snap', armR: { at: [0.22, -0.3, 0.84], pole: [0.5, -0.7, -0.2] }, blade: [0.08, -0.06, 1.0], spine: [6, 0, 0], head: [0, 0, 0], hips: [0, -0.1, 0.04] }),
      k(0.22, { ease: 'linear', armR: { at: [-0.4, -0.34, 0.66], pole: [0.3, -0.8, 0.1] }, blade: [-0.86, -0.1, 0.5], spine: [10, -30, -3], head: [0, 12, 0] }),
      k(0.3, { ease: 'out', ...L1_END }),
      k(0.46, { ease: 'out', spine: [8, -38, -3] }),
      k(0.74, { ease: 'inOut', ...G }),
    ],
  },
  // 2: backhand, rising from low left to high right
  light2: {
    hits: [[0.1, 0.24, { dmg: 1.0, poise: 10, hitstop: 0.07 }]],
    cancel: 0.33, moveRoot: [[0.02, 0.22, 0.5, 'out']], track: [0, 0.1, 720], stamina: 12, blendIn: 0.04,
    keys: [
      k(0, { ...G, ...TWO, ...L1_END }),
      k(0.08, { ease: 'windup', armR: { at: [-0.48, -0.62, 0.3], pole: [0.3, -0.9, 0] }, blade: [-0.62, -0.62, 0.48],
        spine: [16, -40, -6], head: [6, 14, 0], hips: [0, -0.14, 0] }),
      k(0.15, { ease: 'snap', armR: { at: [0.1, -0.26, 0.88], pole: [0.5, -0.7, -0.2] }, blade: [0.12, 0.3, 0.95], spine: [4, 0, 0], head: [0, 0, 0], hips: [0, -0.08, 0.04] }),
      k(0.22, { ease: 'linear', armR: { at: [0.5, 0.18, 0.6], pole: [0.6, -0.5, -0.4] }, blade: [0.62, 0.68, 0.38], spine: [-6, 24, 4], head: [-4, -10, 0] }),
      k(0.3, { ease: 'out', ...L2_END }),
      k(0.45, { ease: 'out', spine: [-8, 28, 4] }),
      k(0.74, { ease: 'inOut', ...G }),
    ],
  },
  // 3: over the head and straight down, a step in; the head of the rod cracks the ground
  light3: {
    hits: [[0.16, 0.31, { dmg: 1.35, poise: 18, hitstop: 0.095 }]], impactAt: 0.26,
    cancel: 0.46, moveRoot: [[0.04, 0.27, 0.85, 'out']], track: [0, 0.14, 600], stamina: 15, blendIn: 0.04,
    keys: [
      k(0, { ...G, ...TWO, ...L2_END }),
      k(0.13, { ease: 'windup', armR: { at: [0.12, 0.9, -0.1], pole: [0.8, 0.1, -0.5] }, blade: [0.05, 0.35, -0.94],
        spine: [-16, 8, 0], head: [-10, 0, 0], hips: [0, 0.02, -0.04], slide: 0.16, lhAt: -0.26 }),
      k(0.22, { ease: 'snap', armR: { at: [0.03, -0.1, 0.95], pole: [0.6, -0.6, -0.2] }, blade: [0.0, -0.42, 0.9], spine: [26, 0, 0], head: [8, 0, 0], hips: [0, -0.14, 0.08] }),
      k(0.29, { ease: 'out', ...L3_END }),
      k(0.5, { ease: 'out', spine: [28, 0, 0] }),
      k(0.9, { ease: 'inOut', ...G }),
    ],
  },
  // 4: 旋风 - one hand at the very end of the rod, a full turn that sweeps everything around him, then the rod
  // lengthens (如意) for a driving thrust
  finisher: {
    hits: [[0.17, 0.5, { dmg: 0.9, poise: 12, hitstop: 0.06 }], [0.66, 0.82, { dmg: 1.7, poise: 26, hitstop: 0.11, heavy: true }]],
    spin: [[0.13, 0.5, 360, 'inOut']],
    cancel: 1.02, moveRoot: [[0.12, 0.5, 0.8, 'linear'], [0.62, 0.76, 1.1, 'out']], track: [0, 0.13, 600], stamina: 22, blendIn: 0.04,
    keys: [
      k(0, { ...G, ...TWO, ...L3_END }),
      k(0.12, { ease: 'windup', armR: { at: [0.62, -0.22, -0.06], pole: [0.4, -0.7, -0.5] }, blade: [0.86, 0.0, -0.5],
        spine: [6, 40, 0], head: [0, -16, 0], hips: [0, -0.12, 0], slide: 0.1, lhand: 0, gripL: 0,
        armL: { at: [-0.5, -0.4, 0.3], pole: [-0.6, -0.4, -0.4] } }),
      k(0.2, { ease: 'out', armR: { at: [0.64, -0.2, 0.6], pole: [0.4, -0.8, -0.3] }, blade: [0.8, 0.04, 0.6], spine: [4, 22, 0], head: [0, -8, 0] }),
      k(0.48, { ease: 'linear', spine: [4, 20, 0] }),
      k(0.6, { ease: 'windup', armR: { at: [0.34, -0.32, -0.24], pole: [0.6, -0.6, -0.4] }, blade: [0.0, 0.03, 1.0],
        spine: [0, 30, 0], head: [0, -18, 0], hips: [0, -0.12, -0.06], slide: 0.3, lhand: 1, lhAt: -0.42, gripL: 1, grow: 1,
        armL: { at: [0.05, -0.4, 0.35], pole: [-0.6, -0.5, -0.3] } }),
      k(0.7, { ease: 'snap', armR: { at: [0.06, -0.08, 0.99], pole: [0.6, -0.6, -0.3] }, blade: [0.0, 0.04, 1.0],
        spine: [12, -14, 0], head: [-4, 10, 0], hips: [0, -0.2, 0.15], grow: 1.6, ...LUNGE }),
      k(0.86, { ease: 'linear', grow: 1.6, spine: [13, -14, 0] }),
      k(1.02, { ease: 'out', grow: 1.0, armR: { at: [0.08, -0.32, 0.86], pole: [0.6, -0.6, -0.3] }, spine: [10, -8, 0], hips: [0, -0.14, 0.1] }),
      k(1.4, { ease: 'inOut', ...G, ...LEGS_FREE }),
    ],
  },

  // ------------------------------------------------------------------ 重击 (K): hold to charge, release to smash
  heavy: {
    hits: [[0.42, 0.56, { dmg: 2.2, poise: 36, hitstop: 0.13, heavy: true }]], impactAt: 0.52,
    chargeAt: 0.34, chargeMax: 1.0,
    cancel: 0.86, moveRoot: [[0.36, 0.54, 1.0, 'out']], track: [0, 0.4, 420], stamina: 26, blendIn: 0.06,
    keys: [
      k(0, G),
      k(0.34, { ease: 'windup', armR: { at: [0.08, 0.92, -0.14], pole: [0.8, 0.1, -0.5] }, blade: [0.04, 0.22, -0.97],
        spine: [-18, 10, 0], head: [-14, 0, 0], hips: [0, -0.05, -0.05], slide: 0.14, lhand: 1, lhAt: -0.22, gripL: 1,
        armL: { at: [0.1, 0.8, -0.1], pole: [-0.8, 0.1, -0.5] } }),
      k(0.47, { ease: 'snap', armR: { at: [0.02, -0.12, 0.95], pole: [0.6, -0.6, -0.2] }, blade: [0.0, -0.48, 0.88],
        spine: [30, 0, 0], head: [10, 0, 0], hips: [0, -0.18, 0.12] }),
      k(0.55, { ease: 'out', armR: { at: [0.02, -0.46, 0.8], pole: [0.5, -0.7, -0.2] }, blade: [0.0, -0.82, 0.57], spine: [36, 0, 0], hips: [0, -0.2, 0.12] }),
      k(0.9, { ease: 'linear', spine: [33, 0, 0] }),
      k(1.3, { ease: 'inOut', ...G }),
    ],
  },
  // J out of a full run: a leap that comes down with both hands on the rod
  runAttack: {
    hits: [[0.28, 0.44, { dmg: 1.5, poise: 22, hitstop: 0.1, heavy: true }]], impactAt: 0.4, lift: [0.02, 0.4, 0.8],
    cancel: 0.7, moveRoot: [[0.0, 0.4, 3.4, 'out']], track: [0, 0.2, 600], stamina: 20, blendIn: 0.05,
    keys: [
      k(0, G),
      k(0.18, { ease: 'out', armR: { at: [0.1, 0.9, -0.12], pole: [0.8, 0.1, -0.5] }, blade: [0.05, 0.4, -0.92],
        spine: [-14, 6, 0], head: [-10, 0, 0], slide: 0.16, lhand: 1, lhAt: -0.24, gripL: 1, ...TUCK }),
      k(0.36, { ease: 'snap', armR: { at: [0.02, -0.15, 0.95], pole: [0.6, -0.6, -0.2] }, blade: [0.0, -0.5, 0.86], spine: [28, 0, 0],
        hips: [0, -0.14, 0.08], legL: { at: [-0.06, -0.82, 0.3], pole: [0, 0, 1] }, legR: { at: [0.1, -0.85, -0.25], pole: [0, 0, 1] } }),
      k(0.44, { ease: 'out', armR: { at: [0.02, -0.45, 0.8], pole: [0.5, -0.7, -0.2] }, blade: [0.0, -0.8, 0.6], spine: [34, 0, 0], hips: [0, -0.2, 0.1] }),
      k(0.7, { ease: 'linear', spine: [30, 0, 0] }),
      k(1.0, { ease: 'inOut', ...G, ...LEGS_FREE }),
    ],
  },

  // ------------------------------------------------------------------ evasion (Space tap)
  // a combat roll ALONG THE GROUND (2026-11-16 user: the old one, a somersault turning about his standing hip height,
  // "is not a real roll"): he drops and dives forward onto his hands, balls up - chin down, knees to the chest, the rod
  // along his back - and rolls over his shoulder with the ball's centre a third of a metre off the floor, then comes up
  // out of a crouch. (pivot.y lowers the whole turning body; afterActor keeps every bone above the floor.)
  roll: {
    iframes: [0.04, 0.4], cancel: 0.5, moveRoot: [[0.02, 0.5, 3.6, 'inOut']], stamina: 16, blendIn: 0.03, blendOut: 0.12, pivotBlade: true,
    keys: [
      k(0, { ...G, bodyFrame: true, pivot: { pitch: 0, y: 0, roll: 0 }, pblade: [0.25, 0.75, -0.6] }),
      // the dive: low, the chest over the knee, both hands reaching for the floor ahead, the back leg pushing
      k(0.08, { ease: 'out', bodyFrame: true, pivot: { pitch: 38, y: -0.1, roll: 6 }, hips: [0, -0.32, 0.1], spine: [55, 0, 0], head: [42, 0, 0],
        armR: { at: [0.16, -0.62, 0.5], pole: [0.6, -0.2, -0.5] }, armL: { at: [-0.16, -0.62, 0.52], pole: [-0.6, -0.2, -0.5] }, lhand: 0, gripL: 0.6,
        legL: { at: [-0.07, -0.55, 0.36], pole: [0, 0, 1] }, legR: { at: [0.07, -0.86, -0.22], pole: [0, 0, 1] }, pblade: [0.2, 0.55, -0.81] }),
      // balled up and over the shoulder, close to the ground
      k(0.17, { ease: 'linear', bodyFrame: true, pivot: { pitch: 120, y: -0.24, roll: 14 }, hips: [0, -0.2, 0.06], spine: [72, 0, 0], head: [52, 0, 0],
        armR: { at: [0.16, -0.36, 0.38], pole: [0.6, -0.5, -0.4] }, armL: { at: [-0.16, -0.38, 0.4], pole: [-0.6, -0.5, -0.4] },
        legL: { at: [-0.07, -0.26, 0.46], pole: [0, 0, 1] }, legR: { at: [0.07, -0.3, 0.42], pole: [0, 0, 1] } }),
      k(0.29, { ease: 'linear', bodyFrame: true, pivot: { pitch: 245, y: -0.26, roll: 12 } }),
      // the feet come round under him
      k(0.39, { ease: 'out', bodyFrame: true, pivot: { pitch: 330, y: -0.16, roll: 4 }, spine: [50, 0, 0], head: [26, 0, 0],
        legL: { at: [-0.07, -0.5, 0.3], pole: [0, 0, 1] }, legR: { at: [0.07, -0.44, 0.16], pole: [0, 0, 1] } }),
      // on his feet in a crouch, rising
      k(0.5, { ease: 'out', bodyFrame: true, pivot: { pitch: 360, y: -0.06, roll: 0 }, hips: [0, -0.3, 0.05], spine: [28, 0, 0], head: [10, 0, 0],
        armR: { at: [0.22, -0.5, 0.4], pole: [0.6, -0.5, -0.3] }, armL: { at: [-0.2, -0.55, 0.32], pole: [-0.6, -0.5, -0.3] },
        legL: { at: [-0.09, -0.7, 0.2], pole: [0, 0, 1] }, legR: { at: [0.09, -0.68, 0.02], pole: [0, 0, 1] }, pblade: [0.25, 0.75, -0.6] }),
      k(0.68, { ease: 'inOut', ...G, bodyFrame: true, pivot: { pitch: 360, y: 0, roll: 0 }, ...LEGS_FREE, pblade: [-0.14, 0.45, 0.88] }),
    ],
  },
  // the same ground roll backward (2026-11-16 user: front, back, left and right all roll along the ground): he sits
  // back into a ball - chin down, knees up - goes over his shoulders and comes up on his feet facing the same way
  rollB: {
    iframes: [0.04, 0.4], cancel: 0.5, moveRoot: [[0.02, 0.5, -3.2, 'inOut']], stamina: 16, blendIn: 0.03, blendOut: 0.12, pivotBlade: true,
    keys: [
      k(0, { ...G, bodyFrame: true, pivot: { pitch: 0, y: 0, roll: 0 }, pblade: [0.25, 0.75, -0.6] }),
      k(0.08, { ease: 'out', bodyFrame: true, pivot: { pitch: -28, y: -0.16, roll: 0 }, hips: [0, -0.42, -0.1], spine: [42, 0, 0], head: [40, 0, 0],
        armR: { at: [0.18, -0.42, 0.42], pole: [0.6, -0.5, -0.4] }, armL: { at: [-0.18, -0.42, 0.42], pole: [-0.6, -0.5, -0.4] }, lhand: 0, gripL: 0.6,
        legL: { at: [-0.08, -0.42, 0.36], pole: [0, 0, 1] }, legR: { at: [0.08, -0.42, 0.34], pole: [0, 0, 1] }, pblade: [0.2, 0.55, -0.81] }),
      k(0.17, { ease: 'linear', bodyFrame: true, pivot: { pitch: -120, y: -0.25, roll: -6 }, hips: [0, -0.2, 0.04], spine: [70, 0, 0], head: [50, 0, 0],
        armR: { at: [0.16, -0.36, 0.38], pole: [0.6, -0.5, -0.4] }, armL: { at: [-0.16, -0.38, 0.4], pole: [-0.6, -0.5, -0.4] },
        legL: { at: [-0.07, -0.26, 0.46], pole: [0, 0, 1] }, legR: { at: [0.07, -0.3, 0.42], pole: [0, 0, 1] } }),
      k(0.29, { ease: 'linear', bodyFrame: true, pivot: { pitch: -245, y: -0.26, roll: -6 } }),
      // the feet come over his head and down behind him
      k(0.39, { ease: 'out', bodyFrame: true, pivot: { pitch: -330, y: -0.16, roll: -2 }, spine: [46, 0, 0], head: [22, 0, 0],
        legL: { at: [-0.08, -0.48, 0.12], pole: [0, 0, 1] }, legR: { at: [0.08, -0.5, 0.02], pole: [0, 0, 1] } }),
      k(0.5, { ease: 'out', bodyFrame: true, pivot: { pitch: -360, y: -0.06, roll: 0 }, hips: [0, -0.3, 0.02], spine: [26, 0, 0], head: [8, 0, 0],
        armR: { at: [0.22, -0.5, 0.4], pole: [0.6, -0.5, -0.3] }, armL: { at: [-0.2, -0.55, 0.32], pole: [-0.6, -0.5, -0.3] },
        legL: { at: [-0.09, -0.7, 0.16], pole: [0, 0, 1] }, legR: { at: [0.09, -0.68, -0.02], pole: [0, 0, 1] }, pblade: [0.25, 0.75, -0.6] }),
      k(0.68, { ease: 'inOut', ...G, bodyFrame: true, pivot: { pitch: -360, y: 0, roll: 0 }, ...LEGS_FREE, pblade: [-0.14, 0.45, 0.88] }),
    ],
  },
  // sideways along the ground, still facing the enemy: down onto the shoulder on that side, balled up, over the back
  // and up again (rollR to his right, rollL to his left; monkey.js moves him that way with moveYaw)
  ...Object.fromEntries([['rollR', 1], ['rollL', -1]].map(([name, s]) => [name, {
    iframes: [0.04, 0.4], cancel: 0.5, moveRoot: [[0.02, 0.5, 3.4, 'inOut']], stamina: 16, blendIn: 0.03, blendOut: 0.12, pivotBlade: true, side: s,
    keys: [
      k(0, { ...G, bodyFrame: true, pivot: { pitch: 0, y: 0, roll: 0 }, pblade: [0.25, 0.75, -0.6] }),
      k(0.08, { ease: 'out', bodyFrame: true, pivot: { pitch: 8, y: -0.14, roll: s * 34 }, hips: [s * 0.08, -0.36, 0.04], spine: [46, 0, 0], head: [36, 0, 0],
        armR: { at: [0.18, -0.42, 0.42], pole: [0.6, -0.5, -0.4] }, armL: { at: [-0.18, -0.42, 0.42], pole: [-0.6, -0.5, -0.4] }, lhand: 0, gripL: 0.6,
        legL: { at: [-0.08, -0.45, 0.34], pole: [0, 0, 1] }, legR: { at: [0.08, -0.45, 0.32], pole: [0, 0, 1] }, pblade: [0.2, 0.55, -0.81] }),
      k(0.17, { ease: 'linear', bodyFrame: true, pivot: { pitch: 10, y: -0.25, roll: s * 120 }, hips: [0, -0.2, 0.04], spine: [70, 0, 0], head: [50, 0, 0],
        armR: { at: [0.16, -0.36, 0.38], pole: [0.6, -0.5, -0.4] }, armL: { at: [-0.16, -0.38, 0.4], pole: [-0.6, -0.5, -0.4] },
        legL: { at: [-0.07, -0.26, 0.46], pole: [0, 0, 1] }, legR: { at: [0.07, -0.3, 0.42], pole: [0, 0, 1] } }),
      k(0.29, { ease: 'linear', bodyFrame: true, pivot: { pitch: 10, y: -0.26, roll: s * 245 } }),
      k(0.39, { ease: 'out', bodyFrame: true, pivot: { pitch: 6, y: -0.16, roll: s * 330 }, spine: [48, 0, 0], head: [24, 0, 0],
        legL: { at: [-0.1, -0.5, 0.24], pole: [0, 0, 1] }, legR: { at: [0.1, -0.48, 0.14], pole: [0, 0, 1] } }),
      k(0.5, { ease: 'out', bodyFrame: true, pivot: { pitch: 0, y: -0.06, roll: s * 360 }, hips: [0, -0.3, 0.03], spine: [26, 0, 0], head: [8, 0, 0],
        armR: { at: [0.22, -0.5, 0.4], pole: [0.6, -0.5, -0.3] }, armL: { at: [-0.2, -0.55, 0.32], pole: [-0.6, -0.5, -0.3] },
        legL: { at: [-0.12, -0.7, 0.12], pole: [0, 0, 1] }, legR: { at: [0.12, -0.68, 0.02], pole: [0, 0, 1] }, pblade: [0.25, 0.75, -0.6] }),
      k(0.68, { ease: 'inOut', ...G, bodyFrame: true, pivot: { pitch: 0, y: 0, roll: s * 360 }, ...LEGS_FREE, pblade: [-0.14, 0.45, 0.88] }),
    ],
  }])),
  // 法相天地: a giant does not tumble. A quick step (闪步) in any direction, low and leaning into it, the rod still
  // toward the enemy: x = to his right (+) / left (-), z = forward (+) / back (-). monkey.js picks the variant.
  ...Object.fromEntries([['dodgeF', 0, 1], ['dodgeB', 0, -1], ['dodgeL', -1, 0], ['dodgeR', 1, 0]].map(([name, x, z]) => {
    const lead = { at: [x * 0.3, -0.58, 0.05 + z * 0.3], pole: [x * 0.3, 0, 1] }, trail = { at: [-x * 0.62, -0.7, -z * 0.6 - 0.02], pole: [-x * 0.2, 0, 1] };
    const leftLeads = x < 0 || (x === 0 && z > 0);
    return [name, {
      iframes: [0.02, 0.4], cancel: 0.44, moveRoot: [[0.0, 0.36, 2.7, 'out']], stamina: 14, blendIn: 0.04, blendOut: 0.14, step: [x, z],
      keys: [
        k(0, G),
        k(0.1, { ease: 'out', hips: [x * 0.1, -0.3, z * 0.08], spine: [14 + z * 12, 0, -x * 18], head: [2 - z * 8, 0, x * 8],
          armR: { at: [0.3, -0.5, 0.42], pole: [0.6, -0.5, -0.3] }, armL: { at: [-0.34, -0.5, 0.3], pole: [-0.6, -0.5, -0.3] }, blade: [-0.3 - x * 0.2, 0.5, 0.8],
          legL: leftLeads ? lead : trail, legR: leftLeads ? trail : lead }),
        k(0.3, { ease: 'linear', hips: [x * 0.06, -0.26, z * 0.05], spine: [12 + z * 8, 0, -x * 12] }),
        k(0.44, { ease: 'out', hips: [0, -0.16, 0.02], spine: [10, 0, 0], head: [2, 0, 0],
          legL: { at: [-0.12, -0.8, 0.06], pole: [0, 0, 1] }, legR: { at: [0.12, -0.8, -0.06], pole: [0, 0, 1] } }),
        k(0.62, { ease: 'inOut', ...G, hips: [0, 0, 0], ...LEGS_FREE }),
      ],
    }];
  })),
  // no direction held: a back handspring away from the enemy
  backflip: {
    iframes: [0.04, 0.36], cancel: 0.5, moveRoot: [[0.0, 0.46, -3.0, 'out']], lift: [0.04, 0.42, 0.55], stamina: 16,
    blendIn: 0.03, blendOut: 0.12, pivotBlade: true,
    keys: [
      k(0, { ...G, pivot: { pitch: 0 }, pblade: [-0.14, 0.45, 0.88] }),
      k(0.06, { ease: 'out', pivot: { pitch: -20 }, hips: [0, -0.18, -0.02], spine: [-20, 0, 0], head: [-26, 0, 0],
        armR: { at: [0.25, 0.3, 0.2], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.25, 0.3, 0.2], pole: [-0.6, -0.4, -0.4] }, lhand: 0, pblade: [0.1, 0.95, -0.3] }),
      k(0.2, { ease: 'linear', pivot: { pitch: -150 }, ...TUCK }),
      k(0.34, { ease: 'linear', pivot: { pitch: -300 } }),
      k(0.44, { ease: 'out', pivot: { pitch: -360 }, hips: [0, -0.18, 0.02], spine: [16, 0, 0], head: [6, 0, 0],
        legL: { at: [-0.08, -0.74, 0.12], pole: [0, 0, 1] }, legR: { at: [0.08, -0.76, -0.05], pole: [0, 0, 1] }, pblade: [-0.1, 0.5, 0.86] }),
      k(0.62, { ease: 'inOut', ...G, pivot: { pitch: -360 }, ...LEGS_FREE, pblade: [-0.14, 0.45, 0.88] }),
    ],
  },

  // ------------------------------------------------------------------ guard (L)
  blockHit: {
    cancel: 0.22, moveRoot: [[0.0, 0.16, -0.6, 'out']], blendIn: 0.02, blendOut: 0.12,
    keys: [
      k(0, MONKEY_BLOCK),
      k(0.06, { ease: 'out', ...MONKEY_BLOCK, spine: [-6, -12, 0], head: [-8, 8, 0], hips: [0, -0.12, -0.08] }),
      k(0.34, { ease: 'inOut', ...MONKEY_BLOCK }),
    ],
  },
  // perfect guard: the rod snaps the blow aside and comes back ready
  parry: {
    cancel: 0.16, moveRoot: [[0.0, 0.1, -0.25, 'out']], blendIn: 0.02, blendOut: 0.14,
    keys: [
      k(0, MONKEY_BLOCK),
      k(0.05, { ease: 'snap', armR: { at: [0.38, 0.06, 0.5], pole: [0.7, -0.5, -0.3] }, armL: { at: [-0.2, 0.1, 0.6], pole: [-0.7, -0.5, -0.2] },
        blade: [-0.66, 0.72, 0.2], spine: [-4, 18, 0], head: [-4, -6, 0], hips: [0, -0.1, -0.04], lhAt: 0.5 }),
      k(0.2, { ease: 'out', spine: [0, 12, 0] }),
      k(0.42, { ease: 'inOut', ...G, ...LEGS_FREE }),
    ],
  },

  // ------------------------------------------------------------------ 芭蕉扇 (I): a wide swing that sends a gust forward
  fan: {
    fanAt: 0.43, cancel: 0.9, stamina: 8, blendIn: 0.06, track: [0, 0.32, 360], moveRoot: [[0.3, 0.48, 0.35, 'out']],
    keys: [
      k(0, { ...G, fan: 0 }),
      k(0.14, { ease: 'out', fan: 1, armL: { at: [-0.64, 0.28, -0.24], pole: [-0.5, -0.6, -0.4] },
        armR: { at: [0.36, -0.64, -0.14], pole: [0.6, -0.4, -0.4] }, blade: [0.24, -0.36, -0.9], slide: 0.3,
        spine: [-6, -30, -4], head: [-4, 18, 0], hips: [0, -0.04, -0.04] }),
      k(0.33, { ease: 'windup', armL: { at: [-0.7, 0.42, -0.34], pole: [-0.5, -0.5, -0.5] }, spine: [-10, -44, -6], head: [-6, 26, 0], hips: [0, -0.08, -0.05] }),
      k(0.43, { ease: 'snap', armL: { at: [-0.04, 0.14, 0.95], pole: [-0.6, -0.6, -0.2] }, spine: [8, 0, 0], head: [0, 0, 0], hips: [0, -0.13, 0.07] }),
      k(0.51, { ease: 'out', armL: { at: [0.55, 0.0, 0.62], pole: [-0.4, -0.8, 0.2] }, spine: [12, 30, 4], head: [2, -12, 0] }),
      k(0.78, { ease: 'out', spine: [10, 26, 3] }),
      k(0.96, { ease: 'inOut', fan: 0 }),
      k(1.2, { ease: 'inOut', ...G, fan: 0 }),
    ],
  },

  // ------------------------------------------------------------------ 牵牛鼻子: execution on the bowed head
  // dash in, seize the iron nose ring with the left hand, haul up on it, swing the rod over and down onto the brow,
  // hang a beat, let go and drop back. monkey.js drives the dash, the lift and the left hand onto the real ring.
  critical: {
    iframes: [0, 2.05], cancel: 1.95, grabAt: 0.36, hitAt: 0.92, blendIn: 0.05, blendOut: 0.2,
    moveRoot: [[1.52, 1.8, -1.1, 'out']],
    keys: [
      k(0, G),
      k(0.2, { ease: 'out', hips: [0, -0.14, 0.08], spine: [20, 0, 0], head: [-8, 0, 0],
        armR: { at: [0.42, -0.5, -0.3], pole: [0.6, -0.5, -0.4] }, blade: [0.3, -0.3, -0.9],
        armL: { at: [-0.1, 0.1, 0.92], pole: [-0.6, -0.5, -0.3] }, gripL: 0 }),
      k(0.36, { ease: 'out', armL: { at: [-0.04, 0.6, 0.76], pole: [-0.7, -0.4, -0.3] }, gripL: 1, spine: [-6, -8, 0], head: [-18, 0, 0], hips: [0, -0.04, 0.02] }),
      k(0.6, { ease: 'out', armR: { at: [0.3, 0.85, -0.36], pole: [0.8, 0.1, -0.5] }, blade: [0.15, 0.55, -0.82], slide: 0.2,
        spine: [-14, 18, 0], head: [-24, 0, 0], ...TUCK }),
      k(0.82, { ease: 'windup', armR: { at: [0.2, 0.95, -0.2], pole: [0.8, 0.1, -0.5] }, blade: [0.05, 0.22, -0.97], spine: [-20, 14, 0] }),
      k(0.92, { ease: 'snap', armR: { at: [0.06, 0.45, 0.85], pole: [0.7, -0.3, -0.3] }, blade: [0.0, 0.6, 0.8], spine: [12, -6, 0], head: [-14, 0, 0] }),
      k(1.22, { ease: 'linear', spine: [13, -6, 0] }),
      k(1.48, { ease: 'out', armR: { at: [0.24, -0.42, 0.5], pole: [0.6, -0.5, -0.3] }, blade: [0.2, -0.4, 0.9], spine: [20, 0, 0], head: [6, 0, 0],
        armL: { at: [-0.3, -0.5, 0.4], pole: [-0.6, -0.5, -0.3] }, gripL: 0, hips: [0, -0.16, 0.04], ...LEGS_FREE }),
      k(2.05, { ease: 'inOut', ...G }),
    ],
  },

  // ------------------------------------------------------------------ hit reactions
  hurt: {
    cancel: 0.36, moveRoot: [[0.0, 0.2, -0.45, 'out']], blendIn: 0.03,
    keys: [
      k(0, G),
      k(0.07, { ease: 'out', spine: [-16, 10, -6], head: [-20, 6, 0], hips: [0, -0.04, -0.06],
        armR: { at: [0.42, -0.45, 0.2], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.45, -0.4, 0.25], pole: [-0.6, -0.4, -0.4] }, blade: [0.3, 0.6, 0.74] }),
      k(0.42, { ease: 'inOut', ...G }),
    ],
  },
  // 金身: the staff rings off the gold and the blow comes back into his own arms - staff flung up, he reels back, numb
  recoil: {
    cancel: 1.05, moveRoot: [[0.0, 0.35, -0.9, 'out']], blendIn: 0.03,
    keys: [
      k(0, G),
      k(0.08, { ease: 'out', spine: [-22, 6, -4], head: [-24, 4, 0], hips: [0, -0.05, -0.1],
        armR: { at: [0.36, 0.1, 0.25], pole: [0.6, -0.3, -0.5] }, armL: { at: [-0.34, 0.05, 0.3], pole: [-0.6, -0.3, -0.5] }, blade: [0.2, 0.95, 0.2] }),
      k(0.45, { ease: 'inOut', spine: [-10, 14, -8], head: [-6, 10, 0], hips: [0, -0.12, -0.08],
        armR: { at: [0.42, -0.4, 0.15], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.4, -0.5, 0.1], pole: [-0.6, -0.4, -0.4] }, blade: [0.4, 0.5, 0.76] }),
      k(0.8, { ease: 'inOut', spine: [12, -6, 4], head: [10, -4, 0], hips: [0, -0.14, 0],
        armR: { at: [0.4, -0.5, 0.25], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.4, -0.55, 0.15], pole: [-0.6, -0.4, -0.4] }, blade: [0.3, 0.4, 0.86] }),
      k(1.15, { ease: 'inOut', ...G }),
    ],
  },
  // a giant's blow: thrown back off his feet, down on his back, then up again
  knockdown: {
    iframes: [0.22, 1.4], cancel: 1.5, moveRoot: [[0.0, 0.45, -2.6, 'out']], lift: [0.0, 0.42, 0.5], blendIn: 0.03, pivotBlade: true,
    keys: [
      k(0, { ...G, pivot: { pitch: 0, y: 0 }, pblade: [-0.14, 0.45, 0.88] }),
      k(0.12, { ease: 'out', pivot: { pitch: -25, y: 0 }, spine: [-25, 0, 0], head: [-25, 0, 0], lhand: 0,
        armR: { at: [0.5, -0.1, 0.1], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.5, -0.1, 0.1], pole: [-0.6, -0.4, -0.4] }, pblade: [0.6, 0.3, 0.74] }),
      k(0.4, { ease: 'in', pivot: { pitch: -86, y: -0.3 }, spine: [-5, 0, 0], head: [12, 0, 0],
        legL: { at: [-0.1, -0.85, 0.35], pole: [0, 0, 1] }, legR: { at: [0.1, -0.9, 0.2], pole: [0, 0, 1] }, pblade: [0.85, 0.1, 0.5] }),
      k(0.95, { ease: 'linear', pivot: { pitch: -84, y: -0.3 } }),
      k(1.25, { ease: 'inOut', pivot: { pitch: -15, y: -0.06 }, hips: [0, -0.22, 0.06], spine: [30, 0, 0], head: [10, 0, 0],
        legL: { at: [-0.06, -0.6, 0.35], pole: [0, 0, 1] }, legR: { at: [0.06, -0.7, 0.1], pole: [0, 0, 1] }, pblade: [0.3, -0.2, 0.93] }),
      k(1.55, { ease: 'inOut', ...G, pivot: { pitch: 0, y: 0 }, ...LEGS_FREE, pblade: [-0.14, 0.45, 0.88] }),
    ],
  },
  // in a giant's fist: struggling, the rod jammed against the fingers (holds while held)
  held: {
    holdAt: 0.5, blendIn: 0.1, pivotBlade: true,
    keys: [
      k(0, { ...G, pivot: { pitch: 0 }, pblade: [-0.14, 0.45, 0.88] }),
      k(0.5, { ease: 'out', spine: [-10, 14, 6], head: [-22, -10, 0], hips: [0, 0.04, 0],
        armR: { at: [0.5, 0.35, 0.4], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.4, 0.2, 0.5], pole: [-0.6, -0.4, -0.4] }, lhand: 0,
        legL: { at: [-0.12, -0.9, 0.12], pole: [0, 0, 1] }, legR: { at: [0.12, -0.8, -0.2], pole: [0, 0, 1] }, pblade: [0.5, 0.8, 0.3] }),
      k(1.2, { ease: 'linear' }),
    ],
  },
  // falling from a height (holds until he lands)
  fall: {
    holdAt: 0.3, blendIn: 0.15,
    keys: [
      k(0, G),
      k(0.3, { ease: 'out', armR: { at: [0.45, 0.1, 0.3], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.5, 0.15, 0.25], pole: [-0.6, -0.4, -0.4] },
        blade: [0.3, 0.7, 0.65], spine: [6, 0, 0], head: [10, 0, 0], ...TUCK }),
      k(0.6, { ease: 'linear' }),
    ],
  },
  // landing from a height: absorb in a crouch
  land: {
    cancel: 0.22, blendIn: 0.02, blendOut: 0.15,
    keys: [
      k(0, { ...G, hips: [0, -0.3, 0.04], spine: [24, 0, 0], head: [10, 0, 0] }),
      k(0.12, { ease: 'out', hips: [0, -0.34, 0.05], spine: [26, 0, 0] }),
      k(0.42, { ease: 'inOut', ...G }),
    ],
  },
  // a quick hop up onto a ledge (monkey.js raises the root to the new ground)
  vault: {
    cancel: 0.3, blendIn: 0.03, blendOut: 0.12,
    keys: [
      k(0, G),
      k(0.12, { ease: 'out', hips: [0, -0.08, 0.06], spine: [18, 0, 0], ...TUCK }),
      k(0.36, { ease: 'inOut', ...G, ...LEGS_FREE }),
    ],
  },
  // death: the knees give, he folds forward onto the stone (holds)
  death: {
    holdAt: 1.65, blendIn: 0.05, pivotBlade: true,
    keys: [
      k(0, { ...G, pivot: { pitch: 0, y: 0 }, pblade: [-0.14, 0.45, 0.88] }),
      k(0.25, { ease: 'out', spine: [-14, 10, 0], head: [-20, 0, 0], hips: [0, -0.05, -0.05], lhand: 0,
        armR: { at: [0.4, -0.5, 0.1], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.4, -0.6, 0.1], pole: [-0.6, -0.4, -0.4] }, pblade: [0.4, -0.3, 0.86] }),
      k(0.75, { ease: 'inOut', hips: [0, -0.45, 0.05], spine: [30, 0, 0], head: [25, 0, 0],
        legL: { at: [-0.1, -0.5, -0.45], pole: [0, -0.3, 1] }, legR: { at: [0.1, -0.5, -0.45], pole: [0, -0.3, 1] },
        armR: { at: [0.2, -0.75, 0.3], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.2, -0.75, 0.3], pole: [-0.6, -0.4, -0.4] }, pblade: [0.6, -0.55, 0.58] }),
      k(1.3, { ease: 'in', pivot: { pitch: 78, y: -0.26 }, spine: [8, 0, 0], head: [-10, 20, 0],
        armR: { at: [0.5, 0.0, 0.5], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.45, 0.1, 0.5], pole: [-0.6, -0.4, -0.4] }, pblade: [0.95, 0.0, 0.3] }),
      k(1.65, { ease: 'out', pivot: { pitch: 80, y: -0.27 } }),
      k(2.2, { ease: 'linear', pivot: { pitch: 80, y: -0.27 } }),
    ],
  },
};

// attack moves: light combo order, and which ones are attacks (for state bookkeeping)
export const COMBO = ['light1', 'light2', 'light3', 'finisher'];
export const ATTACKS = new Set(['light1', 'light2', 'light3', 'finisher', 'heavy', 'runAttack']);

for (const [name, mv] of Object.entries(MONKEY)) {
  if (mv && mv.keys) mv.track_ = new PoseTrack(mv.keys, { name });
}
