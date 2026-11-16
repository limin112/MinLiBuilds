// 牛魔王 move library: keyframed procedural poses (src/pose.js format) plus the gameplay timing read by bull.js.
// Vectors are [right, up, forward] in character space. Arm targets are relative to the shoulder in arm lengths, leg
// targets relative to the hip joint in leg lengths, `hips` is an offset in leg lengths. `blade` is the staff
// direction (grip -> head). Keys inherit every field of the previous key, so the first key of each move carries the
// whole resting pose: while a move plays at full weight nothing else holds the legs or the free arm.
//
// Timing fields (seconds at speed 1) read by bull.js:
//   hits      [[t0, t1, info]]        staff / horn contact windows
//   tellAt    the tell fires (glow, sound, ground mark)
//   holdAt    the move may wait here (delayed slam); bull.js decides for how long
//   impactAt  the blow lands
//   restAt / restEnd   the hand lies on the ground (the punish window)
//   breath    [t0, t1] the fire stream
//   openAt / openEnd   the head lies on the ground (execution window)
//   aim       true: the upper body turns toward the player (bull.js rotates the arm targets and twists the spine)
//   track     [t0, t1] the aim follows the player during this window, then stays
//   ikL / ikR [t0, t1, t2, t3]  a world-space hand target (palm, grab) fades in t0->t1, holds, fades out t2->t3
//   moveRoot  [[t0, t1, legLengths, ease]] the root slides forward (standing up)
import { PoseTrack } from '../pose.js';

const k = (t, o) => ({ t, ...o });

// ------------------------------------------------------------------------------------------------ seated (phase one)

// Sitting cross-legged on the altar, the old god asleep: the hips drop onto the seat, the knees fall out to the
// sides, the feet tuck in front of the pelvis (the right shin crosses in front of the left one). The left hand
// rests on the left knee with its back up (a weak point), the right fist holds the staff upright beside the right knee.
export const SEAT = {
  hips: [0, -1.06, -0.06], hipsTurn: [4, 0, 0],
  legL: { at: [0.14, -0.04, 0.16], pole: [-1, 0.45, 0.55] },
  legR: { at: [-0.14, -0.02, 0.30], pole: [1, 0.45, 0.55] },
  spine: [12, 0, 0], head: [14, 0, 0],
  armL: { at: [-0.42, -0.62, 0.62], pole: [-0.5, -0.1, -0.85], hand: [-0.15, -0.45, 1] },
  armR: { at: [0.58, -0.56, 0.5], pole: [0.55, -0.1, -0.85] },
  blade: [0.03, 1, 0.02], grip: 1, gripL: 0.35,
};
// asleep before the fight: deeper bow, the head sunk on the chest
export const SEAT_SLEEP = { ...SEAT, spine: [16, 0, 0], head: [30, 0, 0] };

// ------------------------------------------------------------------------------------------------ standing (phase two)

// standing in the lava lake; the staff carried at his right side, pointing up and forward
export const STAND = {
  armR: { at: [0.32, -0.82, 0.38], pole: [0.6, -0.3, -0.7], w: 0.9 },
  armL: { at: [-0.3, -0.86, 0.2], pole: [-0.6, -0.3, -0.7], w: 0.75 },
  blade: [0.18, 0.62, 0.76], grip: 1, gripL: 0.5, spine: [6, 0, 0], head: [10, 0, 0],
};
export const STAND_EMPTY = { ...STAND, armR: { at: [0.28, -0.86, 0.22], pole: [0.6, -0.3, -0.7], w: 0.8 }, blade: null, grip: 0.6 };

// ------------------------------------------------------------------------------------------------ moves

export const BULL = {
  seat: SEAT,
  stand: STAND,

  // 横扫: the staff rises to his right, lava drips from it; then a low forehand sweep across the field, right to left
  sweep: {
    tellAt: 0.25, hits: [[1.34, 1.86, { dmg: 34, kind: 'heavy', blockable: true }]], aim: true, track: [0, 0.9],
    keys: [
      k(0, SEAT),
      k(0.95, { ease: 'windup', armR: { at: [0.8, 0.12, -0.28], pole: [0.25, -0.9, -0.3] }, blade: [0.6, 0.42, -0.68],
        spine: [-2, 30, 0], head: [8, -24, 0], armL: { at: [-0.42, -0.6, 0.6], pole: [-0.5, -0.1, -0.85], hand: [-0.15, -0.45, 1] } }),
      k(1.28, { ease: 'linear', spine: [-4, 36, 0], blade: [0.56, 0.48, -0.68] }),
      k(1.42, { ease: 'in', armR: { at: [0.8, -0.5, 0.3], pole: [0.35, -0.9, 0] }, blade: [0.93, -0.16, 0.33], spine: [14, 26, 0], head: [12, -10, 0] }),
      k(1.56, { ease: 'linear', armR: { at: [0.28, -0.52, 0.8], pole: [0.35, -0.9, 0] }, blade: [0.12, -0.2, 0.97], spine: [22, 0, 0], head: [14, 0, 0] }),
      k(1.70, { ease: 'linear', armR: { at: [-0.3, -0.46, 0.8], pole: [0.15, -0.9, 0.1] }, blade: [-0.76, -0.17, 0.62], spine: [20, -22, 0] }),
      k(1.88, { ease: 'out', armR: { at: [-0.55, -0.28, 0.48], pole: [0.1, -0.9, 0.2] }, blade: [-0.96, 0.02, -0.12], spine: [12, -34, 0], head: [10, 14, 0] }),
      k(2.35, { ease: 'inOut', armR: { at: [-0.45, -0.34, 0.52], pole: [0.15, -0.9, 0.1] }, blade: [-0.9, 0.2, 0.2], spine: [12, -26, 0] }),
      k(3.2, { ease: 'inOut', ...SEAT }),
    ],
  },

  // 砸棍: both hands lift the staff over his head and hold it there (for a random beat), then it comes down along a
  // line toward the player; the ground splits along that line and erupts a moment later
  slam: {
    tellAt: 0.5, holdAt: 1.2, impactAt: 1.7, hits: [[1.58, 1.74, { dmg: 40, kind: 'heavy', blockable: false }]],
    eruptAt: 2.15, restAt: 2.6, aim: true, track: [0, 1.2],
    keys: [
      k(0, SEAT),
      k(1.2, { ease: 'windup', armR: { at: [0.18, 0.86, -0.08], pole: [0.75, 0.1, -0.6] }, armL: { twoHand: true },
        blade: [0.0, 0.5, -0.86], spine: [-14, 0, 0], head: [-6, 0, 0], gripL: 1 }),
      k(1.48, { ease: 'in', armR: { at: [0.1, 0.35, 0.85], pole: [0.75, -0.3, -0.5] }, blade: [0.0, 0.72, 0.69], spine: [8, 0, 0], head: [4, 0, 0] }),
      k(1.7, { ease: 'snap', armR: { at: [0.08, -0.62, 0.74], pole: [0.7, -0.6, -0.2] }, blade: [0.0, -0.08, 1.0], spine: [34, 0, 0], head: [18, 0, 0] }),
      k(1.95, { ease: 'out', spine: [37, 0, 0], head: [20, 0, 0] }),
      k(2.8, { ease: 'linear', spine: [35, 0, 0] }),
      k(3.8, { ease: 'inOut', ...SEAT, armL: SEAT.armL, gripL: SEAT.gripL }),
    ],
  },

  // 拍掌 (left hand): the hand rises, its shadow grows on the ground for two seconds, then it slaps down and rests there
  // for two seconds, back up (the lava crack on the back of the hand is the target)
  palmL: {
    tellAt: 0.05, impactAt: 2.05, restAt: 2.1, restEnd: 4.1, aim: true, track: [0, 1.4], ikL: [1.86, 2.05, 4.1, 4.7],
    keys: [
      k(0, SEAT),
      k(0.7, { ease: 'windup', armL: { at: [-0.5, 0.5, 0.5], pole: [-0.75, -0.25, -0.5], hand: [-0.1, 0.25, 1] }, gripL: 0,
        spine: [-6, 0, -8], head: [8, 8, 0] }),
      k(1.85, { ease: 'linear', armL: { at: [-0.46, 0.6, 0.52], pole: [-0.75, -0.25, -0.5], hand: [-0.1, 0.3, 1] }, spine: [-8, 0, -9] }),
      k(2.05, { ease: 'snap', armL: { at: [-0.3, -0.62, 0.72], pole: [-0.7, 0.2, -0.4], hand: [0, -0.2, 1] }, spine: [34, 0, 6], head: [14, 0, 0] }),
      k(2.3, { ease: 'out', spine: [36, 0, 6] }),
      k(4.1, { ease: 'linear', spine: [34, 0, 5], head: [16, 0, 0] }),
      k(4.9, { ease: 'inOut', ...SEAT }),
    ],
  },

  // 拍掌 (right hand): he drives the staff into the ground beside his right knee and lets go, then the same slap
  palmR: {
    tellAt: 0.75, plantAt: 0.55, impactAt: 2.75, restAt: 2.8, restEnd: 4.8, regripAt: 5.75, aim: true, track: [0.6, 2.1], ikR: [2.56, 2.75, 4.8, 5.4],
    keys: [
      k(0, SEAT),
      k(0.5, { ease: 'inOut', armR: { at: [0.6, -0.66, 0.5], pole: [0.55, -0.1, -0.85] }, spine: [16, 0, 0] }),
      k(1.4, { ease: 'windup', armR: { at: [0.5, 0.5, 0.5], pole: [0.75, -0.25, -0.5], hand: [0.1, 0.25, 1] }, grip: 0,
        spine: [-6, 0, 8], head: [8, -8, 0], blade: null }),
      k(2.55, { ease: 'linear', armR: { at: [0.46, 0.6, 0.52], pole: [0.75, -0.25, -0.5], hand: [0.1, 0.3, 1] }, spine: [-8, 0, 9] }),
      k(2.75, { ease: 'snap', armR: { at: [0.3, -0.62, 0.72], pole: [0.7, 0.2, -0.4], hand: [0, -0.2, 1] }, spine: [34, 0, -6], head: [14, 0, 0] }),
      k(3.0, { ease: 'out', spine: [36, 0, -6] }),
      k(4.8, { ease: 'linear', spine: [34, 0, -5], head: [16, 0, 0] }),
      k(5.75, { ease: 'inOut', armR: { at: [0.58, -0.56, 0.5], pole: [0.55, -0.1, -0.85] }, grip: 0.2, spine: [14, 0, 0], head: [14, 0, 0] }),
      k(6.1, { ease: 'inOut', ...SEAT }),
    ],
  },

  // 吐火: he rears back and draws breath (the throat glows), then breathes a stream of fire that sweeps the field
  breath: {
    tellAt: 0.1, breath: [1.5, 4.4], aim: false,
    keys: [
      k(0, SEAT),
      k(1.15, { ease: 'inOut', spine: [-12, 0, 0], head: [-26, 0, 0], armL: { at: [-0.5, -0.55, 0.55], pole: [-0.5, -0.1, -0.85], hand: [-0.15, -0.45, 1] } }),
      k(1.5, { ease: 'snap', spine: [18, 34, 0], head: [24, 16, 0] }),
      k(4.4, { ease: 'linear', spine: [18, -34, 0], head: [24, -16, 0] }),
      k(5.0, { ease: 'out', spine: [12, -30, 0], head: [12, -10, 0] }),
      k(5.8, { ease: 'inOut', ...SEAT }),
    ],
  },

  // 抓: the left hand pulls back, then lunges for the player; a miss slaps the ground (a short punish window)
  grab: {
    tellAt: 0.05, catchAt: 1.02, restAt: 1.08, restEnd: 2.2, aim: true, track: [0, 0.82], ikL: [0.8, 1.0, 2.2, 2.8],
    keys: [
      k(0, SEAT),
      k(0.6, { ease: 'windup', armL: { at: [-0.62, 0.22, 0.0], pole: [-0.6, -0.4, -0.6], hand: [-0.3, 0.2, 1] }, gripL: 0,
        spine: [-6, -16, 0], head: [2, 12, 0] }),
      k(0.8, { ease: 'linear', spine: [-8, -18, 0] }),
      k(1.0, { ease: 'snap', armL: { at: [-0.25, -0.6, 0.76], pole: [-0.7, 0.2, -0.4], hand: [0, -0.2, 1] }, spine: [36, 0, 4], head: [18, 0, 0] }),
      k(2.2, { ease: 'linear', spine: [34, 0, 4], gripL: 0.15 }),
      k(3.0, { ease: 'inOut', ...SEAT }),
    ],
  },
  // caught: lift the monkey to his face, squeeze, then hurl him down onto the stone
  grabSlam: {
    liftAt: 0.7, slamAt: 1.95, releaseAt: 1.95, ikL: [0, 0.01, 0.0, 0.0],
    keys: [
      k(0, { ...SEAT, armL: { at: [-0.25, -0.6, 0.76], pole: [-0.7, 0.2, -0.4], hand: [0, -0.2, 1] }, gripL: 1, spine: [34, 0, 4], head: [18, 0, 0] }),
      k(0.7, { ease: 'inOut', armL: { at: [-0.12, 0.1, 0.9], pole: [-0.8, -0.3, -0.3], hand: [0.4, 0.4, 0.8] }, spine: [2, -8, 0], head: [-2, 10, 0] }),
      k(1.35, { ease: 'linear', armL: { at: [-0.1, 0.16, 0.9], pole: [-0.8, -0.3, -0.3], hand: [0.45, 0.45, 0.8] }, head: [-4, 12, 0] }),
      k(1.65, { ease: 'windup', armL: { at: [-0.4, 0.72, 0.36], pole: [-0.8, 0.0, -0.5], hand: [0, 1, 0.2] }, spine: [-8, -6, 0] }),
      k(1.95, { ease: 'snap', armL: { at: [-0.25, -0.62, 0.74], pole: [-0.7, 0.2, -0.4], hand: [0, -0.3, 1] }, spine: [36, 0, 4], head: [20, 0, 0], gripL: 0 }),
      k(2.7, { ease: 'linear', spine: [34, 0, 4] }),
      k(3.5, { ease: 'inOut', ...SEAT }),
    ],
  },

  // poise broken / his own fire blown back into his face: he rears back, a hand to his face
  flinch: {
    blendIn: 0.05,
    keys: [
      k(0, SEAT),
      k(0.22, { ease: 'out', spine: [-16, 6, 8], head: [-24, 10, 0], armL: { at: [-0.1, 0.35, 0.6], pole: [-0.8, -0.3, -0.4], hand: [0.3, 0.6, 0.6] } }),
      k(0.9, { ease: 'inOut', spine: [-10, 4, 5], head: [-14, 6, 0] }),
      k(1.7, { ease: 'inOut', ...SEAT }),
    ],
  },

  // two lava cracks broken: he rears up roaring, then folds over until his forehead strikes the ground, hands
  // braced on the stone, and stays down (the 牵牛鼻子 execution window)
  down: {
    impactAt: 1.55, openAt: 1.6, openEnd: 6.8, blendIn: 0.05,
    keys: [
      k(0, SEAT),
      k(0.5, { ease: 'out', spine: [-18, 0, 0], head: [-30, 0, 0], armL: { at: [-0.62, 0.0, 0.3], pole: [-0.6, -0.5, -0.6] },
        armR: { at: [0.62, 0.0, 0.3], pole: [0.6, -0.5, -0.6] }, blade: [0.25, 0.9, 0.3] }),
      k(1.55, { ease: 'in', hipsTurn: [38, 0, 0], spine: [56, 0, 0], head: [36, 0, 0],
        armL: { at: [-0.5, -0.72, 0.42], pole: [-0.7, 0.3, -0.5], hand: [-0.2, -0.3, 1] }, gripL: 0,
        armR: { at: [0.5, -0.72, 0.42], pole: [0.7, 0.3, -0.5] }, blade: [0.35, 0.35, 0.87] }),
      k(1.8, { ease: 'out', spine: [54, 0, 0], head: [32, 0, 0] }),
      k(6.8, { ease: 'linear', spine: [55, 0, 2], head: [34, 0, 0] }),
      k(8.4, { ease: 'inOut', ...SEAT }),
    ],
  },

  // ------------------------------------------------------------------------------------------- transition (山崩)
  // ~10 s: he roars at the sky, plants both hands, draws his legs out of the mountain and rises to his full height.
  // The root slides forward (moveRoot) so the feet stay planted while the hips travel over them.
  rise: {
    roarAt: 0.6, pushAt: 3.6, standAt: 8.6, blendIn: 0.0001, blendOut: 0.6,
    moveRoot: [[5.6, 8.6, 0.5, 'inOut']],
    keys: [
      k(0, SEAT),
      // the roar
      k(1.4, { ease: 'out', spine: [-22, 0, 0], head: [-46, 0, 0], armL: { at: [-0.75, 0.35, 0.25], pole: [-0.6, -0.5, -0.6] },
        armR: { at: [0.75, 0.35, 0.25], pole: [0.6, -0.5, -0.6] }, blade: [0.4, 0.9, 0.15], gripL: 0.2 }),
      k(2.6, { ease: 'linear', spine: [-24, 0, 0], head: [-50, 0, 0] }),
      // hands to the ground, draw the feet out in front, knees up
      k(3.8, { ease: 'inOut', spine: [22, 0, 0], head: [10, 0, 0], hipsTurn: [10, 0, 0],
        armL: { at: [-0.42, -0.86, 0.22], pole: [-0.7, 0.2, -0.5], hand: [-0.2, -0.3, 1] }, gripL: 0,
        armR: { at: [0.42, -0.86, 0.22], pole: [0.7, 0.2, -0.5] }, blade: [0.25, 0.85, 0.45] }),
      k(5.6, { ease: 'inOut', hips: [0, -1.06, -0.04],
        legL: { at: [-0.1, 0.06, 0.47], pole: [-0.25, 1, 0.35] }, legR: { at: [0.1, 0.06, 0.47], pole: [0.25, 1, 0.35] } }),
      // push up over the feet into a deep squat (the root starts to slide forward under him)
      k(7.2, { ease: 'inOut', hips: [0, -0.55, 0.1], hipsTurn: [18, 0, 0], spine: [26, 0, 0], head: [6, 0, 0],
        legL: { at: [-0.1, -0.44, 0.12], pole: [-0.2, 0.2, 1] }, legR: { at: [0.1, -0.44, 0.12], pole: [0.2, 0.2, 1] },
        armL: { at: [-0.35, -0.7, 0.4], pole: [-0.7, -0.1, -0.5] }, armR: { at: [0.35, -0.7, 0.4], pole: [0.7, -0.1, -0.5] } }),
      // stand tall
      k(8.6, { ease: 'inOut', hips: [0, 0, 0], hipsTurn: [0, 0, 0], spine: [-6, 0, 0], head: [-8, 0, 0],
        legL: { at: [-0.016, -0.99, -0.04], pole: [0, 0, 1], w: 1 }, legR: { at: [0.016, -0.99, -0.04], pole: [0, 0, 1], w: 1 },
        ...STAND, armL: STAND.armL }),
      k(9.8, { ease: 'inOut', spine: [-8, 0, 0], head: [-14, 0, 0],
        legL: { at: [-0.016, -0.99, -0.04], pole: [0, 0, 1], w: 0 }, legR: { at: [0.016, -0.99, -0.04], pole: [0, 0, 1], w: 0 } }),
      k(10.4, { ease: 'inOut', ...STAND }),
    ],
  },

  // ------------------------------------------------------------------------------------------------ phase two

  // 踏地 (right / left hoof): the leg lifts, embers rain from the hoof; it stamps down and a ring of lava rolls out
  stompR: {
    tellAt: 0.2, impactAt: 1.5, foot: 'Right',
    keys: [
      k(0, STAND),
      k(1.05, { ease: 'windup', hips: [0.03, -0.05, -0.03], legR: { at: [0.06, -0.5, 0.36], pole: [0.1, 0.2, 1] }, spine: [-8, 0, -4], head: [8, 0, 0],
        armL: { at: [-0.75, -0.2, 0.25], pole: [-0.6, -0.5, -0.6], w: 1 } }),
      k(1.32, { ease: 'linear', legR: { at: [0.06, -0.47, 0.38], pole: [0.1, 0.2, 1] }, spine: [-10, 0, -5] }),
      k(1.5, { ease: 'snap', hips: [0.02, -0.14, 0.05], legR: { at: [0.07, -0.88, 0.18], pole: [0, 0, 1] }, spine: [16, 0, 0], head: [16, 0, 0] }),
      k(2.3, { ease: 'out', hips: [0.02, -0.12, 0.04] }),
      k(3.1, { ease: 'inOut', ...STAND, hips: [0, 0, 0], legR: { at: [0.07, -0.95, 0.12], pole: [0, 0, 1], w: 0 } }),
    ],
  },
  stompL: {
    tellAt: 0.2, impactAt: 1.5, foot: 'Left',
    keys: [
      k(0, STAND),
      k(1.05, { ease: 'windup', hips: [-0.03, -0.05, -0.03], legL: { at: [-0.06, -0.5, 0.36], pole: [-0.1, 0.2, 1] }, spine: [-8, 0, 4], head: [8, 0, 0],
        armR: { at: [0.75, -0.2, 0.25], pole: [0.6, -0.5, -0.6], w: 1 } }),
      k(1.32, { ease: 'linear', legL: { at: [-0.06, -0.47, 0.38], pole: [-0.1, 0.2, 1] }, spine: [-10, 0, 5] }),
      k(1.5, { ease: 'snap', hips: [-0.02, -0.14, 0.05], legL: { at: [-0.07, -0.88, 0.18], pole: [0, 0, 1] }, spine: [16, 0, 0], head: [16, 0, 0] }),
      k(2.3, { ease: 'out', hips: [-0.02, -0.12, 0.04] }),
      k(3.1, { ease: 'inOut', ...STAND, hips: [0, 0, 0], legL: { at: [-0.07, -0.95, 0.12], pole: [0, 0, 1], w: 0 } }),
    ],
  },

  // 角扫: he drops into a crouch and bows until the horns skim the rocks, sweeps them right to left, stays low a moment
  horn: {
    tellAt: 0.3, hits: [[1.5, 2.05, { dmg: 36, kind: 'heavy', blockable: false }]], restEnd: 3.2,
    keys: [
      k(0, STAND),
      k(1.25, { ease: 'windup', hips: [0, -0.52, -0.1], hipsTurn: [34, 0, 0], spine: [44, 40, 0], head: [28, 28, 0],
        armL: { at: [-0.45, -0.78, 0.4], pole: [-0.7, 0.2, -0.5], w: 1 }, armR: { at: [0.5, -0.6, 0.2], pole: [0.7, -0.2, -0.6], w: 1 } }),
      k(1.48, { ease: 'linear', spine: [46, 46, 0], head: [30, 32, 0] }),
      k(2.05, { ease: 'inOut', spine: [50, -40, 0], head: [30, -30, 0] }),
      k(3.2, { ease: 'linear', spine: [48, -36, 0], head: [28, -26, 0] }),
      k(4.3, { ease: 'inOut', ...STAND, hips: [0, 0, 0], hipsTurn: [0, 0, 0] }),
    ],
  },

  // 火雨: he roars at the sky with both arms raised; the volcano answers with a rain of lava bombs
  meteor: {
    tellAt: 0.3, rain: [1.4, 5.0],
    keys: [
      k(0, STAND),
      k(1.2, { ease: 'inOut', spine: [-18, 0, 0], head: [-44, 0, 0], armL: { at: [-0.6, 0.62, 0.22], pole: [-0.7, -0.4, -0.5], w: 1 },
        armR: { at: [0.6, 0.62, 0.22], pole: [0.7, -0.4, -0.5], w: 1 }, blade: [0.3, 0.9, 0.3], gripL: 0.1 }),
      k(4.6, { ease: 'linear', spine: [-20, 0, 0], head: [-46, 0, 0] }),
      k(5.6, { ease: 'inOut', ...STAND }),
    ],
  },

  // 掷棍: the staff drawn back over his shoulder like a javelin, the left hand points; he hurls it and it sticks in the ground
  throw: {
    tellAt: 0.3, releaseAt: 1.56, aim: true, track: [0, 1.4],
    keys: [
      k(0, STAND),
      k(1.35, { ease: 'windup', armR: { at: [0.5, 0.45, -0.5], pole: [0.6, -0.6, -0.5], w: 1 }, blade: [0.02, 0.22, 0.98],
        armL: { at: [-0.25, 0.1, 0.95], pole: [-0.7, -0.4, -0.3], w: 1 }, spine: [-8, -32, 0], head: [2, 28, 0] }),
      k(1.48, { ease: 'linear', spine: [-9, -36, 0] }),
      k(1.6, { ease: 'snap', armR: { at: [0.12, 0.18, 0.96], pole: [0.6, -0.6, -0.3], w: 1 }, blade: [0.0, -0.1, 1.0], spine: [12, 18, 0], head: [8, 0, 0],
        armL: { at: [-0.5, -0.4, -0.3], pole: [-0.6, -0.5, 0.2], w: 1 } }),
      k(2.4, { ease: 'out', spine: [10, 14, 0] }),
      k(3.2, { ease: 'inOut', ...STAND_EMPTY }),
    ],
  },

  // ------------------------------------------------------------------------------------------------ the duel
  // Phase two against the monkey grown to his own scale (法相天地): two blows, each with one answer.
  // 横扫: the staff drawn back to his right, then level across the monkey's chest. Guard it (or parry it).
  sweep2: {
    tellAt: 0.25, hits: [[1.3, 1.84, { dmg: 18, kind: 'heavy', blockable: true }]], aim: true, track: [0, 1.0],
    keys: [
      k(0, STAND),
      k(0.9, { ease: 'windup', hips: [0, -0.06, 0], armR: { at: [0.85, -0.25, -0.3], pole: [0.3, -0.9, -0.3], w: 1 }, blade: [0.75, 0.1, -0.65],
        spine: [0, 34, 0], head: [4, -22, 0], armL: { at: [-0.4, -0.5, 0.5], pole: [-0.6, -0.4, -0.5], w: 1 } }),
      k(1.2, { ease: 'linear', spine: [-2, 38, 0] }),
      k(1.34, { ease: 'in', armR: { at: [0.8, -0.5, 0.3], pole: [0.35, -0.9, 0], w: 1 }, blade: [0.95, -0.2, 0.25], spine: [8, 24, 0] }),
      k(1.48, { ease: 'linear', armR: { at: [0.25, -0.5, 0.85], pole: [0.35, -0.9, 0], w: 1 }, blade: [0.1, -0.25, 0.96], spine: [14, 0, 0], head: [10, 0, 0] }),
      k(1.62, { ease: 'linear', armR: { at: [-0.35, -0.45, 0.8], pole: [0.15, -0.9, 0.1], w: 1 }, blade: [-0.8, -0.2, 0.56], spine: [12, -24, 0] }),
      k(1.8, { ease: 'out', armR: { at: [-0.55, -0.3, 0.45], pole: [0.1, -0.9, 0.2], w: 1 }, blade: [-0.96, -0.05, -0.1], spine: [8, -34, 0], head: [6, 14, 0] }),
      k(2.5, { ease: 'inOut', armR: { at: [-0.45, -0.4, 0.5], pole: [0.15, -0.9, 0.1], w: 1 }, blade: [-0.9, 0.1, 0.3], spine: [10, -24, 0] }),
      k(3.3, { ease: 'inOut', ...STAND, hips: [0, 0, 0] }),
    ],
  },
  // 砸棍: both hands take the staff over his head, it hangs there a beat, then comes straight down. Step out from under it.
  slam2: {
    tellAt: 0.3, holdAt: 1.1, impactAt: 1.6, hits: [[1.42, 1.66, { dmg: 24, kind: 'heavy', blockable: false }]], aim: true, track: [0, 1.1],
    keys: [
      k(0, STAND),
      k(1.1, { ease: 'windup', armR: { at: [0.18, 0.86, -0.08], pole: [0.75, 0.1, -0.6], w: 1 }, armL: { twoHand: true },
        blade: [0.0, 0.5, -0.86], spine: [-14, 0, 0], head: [-6, 0, 0], gripL: 1 }),
      k(1.38, { ease: 'in', armR: { at: [0.1, 0.35, 0.85], pole: [0.75, -0.3, -0.5], w: 1 }, blade: [0.0, 0.72, 0.69], spine: [8, 0, 0], head: [4, 0, 0] }),
      k(1.6, { ease: 'snap', hips: [0, -0.12, 0.03], armR: { at: [0.08, -0.7, 0.6], pole: [0.7, -0.6, -0.2], w: 1 }, blade: [0.0, -0.7, 0.71], spine: [30, 0, 0], head: [16, 0, 0] }),
      k(1.9, { ease: 'out', spine: [33, 0, 0] }),
      k(2.9, { ease: 'linear', spine: [31, 0, 0] }),
      k(3.8, { ease: 'inOut', ...STAND, armL: STAND.armL, gripL: STAND.gripL, hips: [0, 0, 0] }),
    ],
  },
  // 连扫: the same sweep, and the staff comes straight back the other way. Keep the guard up for both.
  combo2: {
    tellAt: 0.25, hits: [[1.3, 1.84, { dmg: 15, kind: 'heavy', blockable: true }], [2.42, 2.92, { dmg: 15, kind: 'heavy', blockable: true }]], aim: true, track: [0, 1.0],
    keys: [
      k(0, STAND),
      k(0.9, { ease: 'windup', hips: [0, -0.06, 0], armR: { at: [0.85, -0.25, -0.3], pole: [0.3, -0.9, -0.3], w: 1 }, blade: [0.75, 0.1, -0.65],
        spine: [0, 34, 0], head: [4, -22, 0], armL: { at: [-0.4, -0.5, 0.5], pole: [-0.6, -0.4, -0.5], w: 1 } }),
      k(1.2, { ease: 'linear', spine: [-2, 38, 0] }),
      k(1.34, { ease: 'in', armR: { at: [0.8, -0.5, 0.3], pole: [0.35, -0.9, 0], w: 1 }, blade: [0.95, -0.2, 0.25], spine: [8, 24, 0] }),
      k(1.48, { ease: 'linear', armR: { at: [0.25, -0.5, 0.85], pole: [0.35, -0.9, 0], w: 1 }, blade: [0.1, -0.25, 0.96], spine: [14, 0, 0], head: [10, 0, 0] }),
      k(1.62, { ease: 'linear', armR: { at: [-0.35, -0.45, 0.8], pole: [0.15, -0.9, 0.1], w: 1 }, blade: [-0.8, -0.2, 0.56], spine: [12, -24, 0] }),
      k(1.8, { ease: 'out', armR: { at: [-0.55, -0.3, 0.45], pole: [0.1, -0.9, 0.2], w: 1 }, blade: [-0.96, -0.05, -0.1], spine: [8, -34, 0], head: [6, 14, 0] }),
      k(2.3, { ease: 'inOut', armR: { at: [-0.62, -0.22, 0.3], pole: [0.1, -0.9, 0.2], w: 1 }, blade: [-0.9, 0.12, -0.42], spine: [2, -42, 0], head: [4, 22, 0] }),
      k(2.46, { ease: 'in', armR: { at: [-0.35, -0.45, 0.8], pole: [0.15, -0.9, 0.1], w: 1 }, blade: [-0.8, -0.2, 0.56], spine: [10, -24, 0] }),
      k(2.6, { ease: 'linear', armR: { at: [0.25, -0.5, 0.85], pole: [0.35, -0.9, 0], w: 1 }, blade: [0.1, -0.25, 0.96], spine: [14, 0, 0], head: [10, 0, 0] }),
      k(2.74, { ease: 'linear', armR: { at: [0.8, -0.5, 0.3], pole: [0.35, -0.9, 0], w: 1 }, blade: [0.95, -0.2, 0.25], spine: [8, 24, 0] }),
      k(2.94, { ease: 'out', armR: { at: [0.85, -0.3, -0.2], pole: [0.3, -0.9, -0.3], w: 1 }, blade: [0.8, 0.0, -0.6], spine: [4, 36, 0], head: [4, -16, 0] }),
      k(3.7, { ease: 'inOut', armR: { at: [0.7, -0.4, 0.1], pole: [0.4, -0.9, -0.2], w: 1 }, blade: [0.7, 0.2, -0.2], spine: [8, 24, 0] }),
      k(4.5, { ease: 'inOut', ...STAND, hips: [0, 0, 0] }),
    ],
  },
  // 冲撞: the bull he is. He bows until the horns point at the monkey, paws the ground, and runs him down in a
  // straight line (bull.js moves him from runAt to runEnd), then skids to a stop with his back half turned.
  charge: {
    tellAt: 0.2, runAt: 1.55, runEnd: 3.6,      // (the run is the white bull's: bull.js syncBeast)
    keys: [
      k(0, STAND),
      k(1.0, { ease: 'windup', hips: [0, -0.2, -0.1], hipsTurn: [26, 0, 0], spine: [36, 0, 0], head: [22, 0, 0],
        armL: { at: [-0.55, -0.55, -0.3], pole: [-0.7, -0.2, -0.6], w: 1 }, armR: { at: [0.6, -0.5, -0.35], pole: [0.7, -0.3, -0.6], w: 1 }, blade: [0.25, 0.25, -0.93] }),
      k(1.55, { ease: 'linear', hips: [0, -0.24, -0.12], spine: [40, 0, 0], head: [26, 0, 0] }),
      k(3.6, { ease: 'linear', hips: [0, -0.22, 0.02], spine: [42, 0, 0], head: [24, 0, 0] }),
      k(4.0, { ease: 'out', hips: [0, -0.3, -0.12], hipsTurn: [10, 0, 0], spine: [20, -14, 0], head: [10, 0, 0],
        armL: { at: [-0.6, -0.4, 0.4], pole: [-0.7, -0.3, -0.5], w: 1 }, armR: { at: [0.5, -0.6, 0.3], pole: [0.7, -0.3, -0.5], w: 1 }, blade: [0.2, 0.7, 0.68] }),
      k(4.75, { ease: 'linear', hips: [0, -0.26, -0.1], spine: [22, -12, 0] }),
      k(5.65, { ease: 'inOut', ...STAND, hips: [0, 0, 0], hipsTurn: [0, 0, 0] }),
    ],
  },

  // the cinematic's sweep (山崩): he drops into a crouch and takes the staff across the floor itself, where a monkey
  // of a man's height stands (contactAt: the staff points straight ahead)
  sweepLow: {
    tellAt: 0.3, contactAt: 1.62, aim: true, track: [0, 1.2],
    keys: [
      k(0, STAND),
      k(1.0, { ease: 'windup', hips: [0, -0.3, -0.04], hipsTurn: [16, 0, 0], spine: [26, 36, 0], head: [10, -26, 0],
        armR: { at: [0.8, -0.6, -0.25], pole: [0.3, -0.9, -0.3], w: 1 }, blade: [0.72, -0.2, -0.66], armL: { at: [-0.5, -0.5, 0.4], pole: [-0.6, -0.4, -0.5], w: 1 } }),
      k(1.3, { ease: 'linear', spine: [26, 40, 0] }),
      k(1.46, { ease: 'in', armR: { at: [0.78, -0.8, 0.3], pole: [0.35, -0.9, 0], w: 1 }, blade: [0.9, -0.4, 0.2], spine: [34, 24, 0] }),
      k(1.62, { ease: 'linear', armR: { at: [0.25, -0.85, 0.75], pole: [0.35, -0.9, 0], w: 1 }, blade: [0.1, -0.42, 0.9], spine: [40, 0, 0], head: [14, 0, 0] }),
      k(1.78, { ease: 'linear', armR: { at: [-0.35, -0.8, 0.7], pole: [0.15, -0.9, 0.1], w: 1 }, blade: [-0.76, -0.4, 0.5], spine: [36, -24, 0] }),
      k(1.98, { ease: 'out', armR: { at: [-0.55, -0.6, 0.4], pole: [0.1, -0.9, 0.2], w: 1 }, blade: [-0.93, -0.2, -0.1], spine: [26, -36, 0], head: [8, 16, 0] }),
      k(2.8, { ease: 'inOut', spine: [20, -28, 0] }),
      k(3.8, { ease: 'inOut', ...STAND, hips: [0, 0, 0], hipsTurn: [0, 0, 0] }),
    ],
  },

  flinch2: {
    blendIn: 0.05,
    keys: [
      k(0, STAND),
      k(0.22, { ease: 'out', spine: [-12, 6, 6], head: [-18, 8, 0], hips: [0, -0.03, -0.04] }),
      k(1.4, { ease: 'inOut', ...STAND, hips: [0, 0, 0] }),
    ],
  },

  // 僵直: a heavy blow that lands while he is not swinging rocks him for a moment
  hit2: {
    blendIn: 0.04,
    keys: [
      k(0, STAND),
      k(0.14, { ease: 'out', spine: [-12, 10, 6], head: [-18, 10, 0], hips: [0, -0.04, -0.06], armL: { at: [-0.6, -0.5, 0.1], pole: [-0.6, -0.3, -0.7], w: 1 } }),
      k(0.5, { ease: 'inOut', spine: [2, 4, 2], head: [-4, 4, 0] }),
      k(0.8, { ease: 'inOut', ...STAND, hips: [0, 0, 0] }),
    ],
  },
  // 架势崩: his posture breaks. He reels back, sags over the staff with his head hanging, and stays there - the opening
  reel: {
    blendIn: 0.05, openAt: 0.5, openEnd: 2.9, moveRoot: [[0.0, 0.7, -0.3, 'out']],
    keys: [
      k(0, STAND),
      k(0.28, { ease: 'out', spine: [-24, 12, 8], head: [-28, 12, 0], hips: [0, -0.06, -0.1],
        armL: { at: [-0.85, -0.05, 0.1], pole: [-0.6, -0.3, -0.7], w: 1 }, armR: { at: [0.8, -0.3, -0.15], pole: [0.6, -0.3, -0.7], w: 1 }, blade: [0.5, 0.6, -0.6] }),
      k(1.0, { ease: 'inOut', hips: [0, -0.4, 0.02], hipsTurn: [12, 0, 0], spine: [34, -8, 0], head: [28, 0, 0],
        armL: { at: [-0.35, -0.8, 0.45], pole: [-0.7, -0.3, -0.5], w: 1 }, armR: { at: [0.35, -0.4, 0.6], pole: [0.7, -0.5, -0.3], w: 1 }, blade: [0.02, 0.98, 0.15] }),
      k(1.9, { ease: 'inOut', spine: [38, -4, 0], head: [32, 6, 0], hips: [0, -0.43, 0.02] }),
      k(2.7, { ease: 'inOut', spine: [34, -6, 0], head: [26, -4, 0], hips: [0, -0.4, 0.02] }),
      k(3.5, { ease: 'inOut', ...STAND, hips: [0, 0, 0], hipsTurn: [0, 0, 0] }),
    ],
  },

  // both knees broken: he drops onto his knees, then pitches forward onto his forearms until his chin is on the
  // ground, the face still turned at the monkey — the ring through his nose hangs within reach, in front of him
  kneel: {
    impactAt: 2.3, openAt: 2.5, openEnd: 7.4, blendIn: 0.05,
    keys: [
      k(0, STAND),
      k(0.7, { ease: 'in', hips: [0, -0.36, -0.02], spine: [16, 0, 0], head: [14, 0, 0],
        legL: { at: [-0.08, -0.62, 0.2], pole: [0, -0.2, 1] }, legR: { at: [0.08, -0.62, 0.2], pole: [0, -0.2, 1] } }),
      k(1.5, { ease: 'in', hips: [0, -0.74, -0.18], hipsTurn: [10, 0, 0], spine: [20, 0, 0], head: [10, 0, 0],
        legL: { at: [-0.1, -0.3, -0.56], pole: [0, -0.4, 1] }, legR: { at: [0.1, -0.3, -0.56], pole: [0, -0.4, 1] },
        armL: { at: [-0.4, -0.5, 0.6], pole: [-0.7, 0.2, -0.5], w: 1 }, armR: { at: [0.4, -0.5, 0.6], pole: [0.7, 0.2, -0.5], w: 1 } }),
      k(2.3, { ease: 'in', hips: [0, -0.74, -0.3], hipsTurn: [80, 0, 0], spine: [28, 0, 0], head: [-62, 0, 0],
        armL: { at: [-0.38, -0.78, 0.45], pole: [-0.7, 0.3, -0.6], hand: [-0.1, -0.2, 1], w: 1 }, gripL: 0,
        armR: { at: [0.38, -0.78, 0.45], pole: [0.7, 0.3, -0.6], w: 1 } }),
      k(2.6, { ease: 'out', spine: [31, 0, 0], head: [-58, 0, 0] }),
      k(7.4, { ease: 'linear', spine: [30, 0, 2], head: [-60, 0, 0] }),
      k(8.6, { ease: 'inOut', hips: [0, -0.36, -0.02], hipsTurn: [0, 0, 0], spine: [16, 0, 0], head: [10, 0, 0],
        legL: { at: [-0.08, -0.62, 0.2], pole: [0, -0.2, 1] }, legR: { at: [0.08, -0.62, 0.2], pole: [0, -0.2, 1] }, ...STAND, armL: STAND.armL }),
      k(9.6, { ease: 'inOut', ...STAND, hips: [0, 0, 0], legL: { at: [-0.016, -0.99, -0.04], pole: [0, 0, 1], w: 0 }, legR: { at: [0.016, -0.99, -0.04], pole: [0, 0, 1], w: 0 } }),
    ],
  },

  // death: down onto his knees, then he topples backward into the lava lake (bull.js sinks the root); holds the last pose
  death: {
    blendIn: 0.05, holdAt: 11.5,
    keys: [
      k(0, STAND),
      k(1.4, { ease: 'in', hips: [0, -0.74, -0.18], spine: [18, 0, 0], head: [20, 0, 0],
        legL: { at: [-0.1, -0.3, -0.56], pole: [0, -0.4, 1] }, legR: { at: [0.1, -0.3, -0.56], pole: [0, -0.4, 1] },
        armL: { at: [-0.3, -0.9, 0.1], pole: [-0.7, 0.2, -0.5], w: 1 }, armR: { at: [0.3, -0.9, 0.1], pole: [0.7, 0.2, -0.5], w: 1 }, blade: null }),
      k(3.2, { ease: 'inOut', spine: [-10, 0, 0], head: [-36, 0, 0], armL: { at: [-0.7, 0.3, 0.2], pole: [-0.7, -0.4, -0.5], w: 1 },
        armR: { at: [0.7, 0.3, 0.2], pole: [0.7, -0.4, -0.5], w: 1 } }),
      k(5.2, { ease: 'inOut', pivot: { pitch: -62 }, spine: [-14, 0, 0], head: [-30, 12, 0] }),
      k(12, { ease: 'linear', pivot: { pitch: -70 }, head: [-26, 18, 0] }),
    ],
  },
};

// phase-one moves start and end in the seat; this list is what the AI may pick from while seated
export const SEATED_ATTACKS = ['sweep', 'slam', 'palmL', 'palmR', 'breath', 'grab'];
export const STANDING_ATTACKS = ['stompL', 'stompR', 'horn', 'meteor', 'throw'];
// 锤地: the overhead slam taken into the air (bull.js lifts and carries him); where it lands the ground burns
BULL.quake = { ...BULL.slam2, tellAt: 0.2, hits: [[1.42, 1.66, { dmg: 26, kind: 'heavy', blockable: false }]] };
export const DUEL_ATTACKS = ['sweep2', 'slam2', 'combo2', 'stompL', 'stompR', 'meteor', 'charge', 'quake'];

export function buildBullTracks(lib = BULL) {
  for (const [name, mv] of Object.entries(lib)) if (mv && mv.keys) mv.track_ = new PoseTrack(mv.keys, { name });
  return lib;
}
buildBullTracks(BULL);
