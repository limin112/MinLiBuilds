// 火焰山 · 牛魔 — the opening cinematic 「一棒问山」: ONE continuous piece from the click to the fight (skippable: Enter / Esc).
//
//   prologue (on the score's clock, every cut on a drum or gong of 'niumo_opening'):
//    0    回目卡 on black, only wind and fire: 第一回　火焰山千年不熄　美猴王一棒问山
//    2.6  STEP     the scorched ground, ash settling; a boot comes down in front of the lens and walks on, toward a
//                  mountain that is only a blur yet                     「八百里火焰，四周围寸草不生。」
//    5.4  RIDGE    long lens: the silhouette with the rod on his shoulder walks across the disc of the low sun
//   10    REVEAL   close behind his shoulder; the camera lifts over it and the caldera opens, and at its end that
//                  "mountain" (key art A); the focus goes from him to it       「人说，那不是山。」
//   13.6  BREATH   the mountain's shoulder and the gold mask against the sky: it breathes out, ash slides off it
//   16.6  WALK     low and far in front of him, a long lens: boots, cape, then up to the gold mask as he comes on
//   19.4  KNEE     on the ground behind him, looking up past him at the giant (key art B); he stops
//   22    THE TITLE (the big hit): he brings the foot of the rod down on the stone — 一棒问山 — a ring of ash runs
//                  out from it; wide and high behind him, 火焰山 · 牛魔 on the left
//   26.4  EYES     the gold face; two lava-coloured points open (the gong)
//   parley (on its own clock: each beat waits for its spoken line — tools/gen_voice.sh, cutscenes.js VoiceLines):
//    牛魔王「……五百年。压在山下的七弟，也爬出来了。」          the face, telephoto, the eyes still opening
//    孙悟空「平天大圣好定力。一坐千年，连火都坐倦了。」        the gold mask, close; his head tips to one side
//    牛魔王「又来借扇？上回钻我妻的肚子——这回，钻哪儿？」      over his shoulder, up at the giant
//    孙悟空「这回不借。来拿。」                                 low beside him; on 来拿 the rod wheels once and levels at the giant
//    牛魔王「红孩儿的账，铁扇的账……今日一并算。」              wide in profile: the speck and the mountain
//    孙悟空「正好。俺老孙压了五百年，骨头正痒。」              low behind him, pushing in; he sinks into his guard
//   finale (driven by the bull's own moves):
//    ROAR    he throws his head back; fire goes up behind him; the fight music's first bar lands on it
//    RAISE   from the ground behind the monkey: the iron staff goes up against the sky
//    STRIKE  slow motion, side on: the staff comes down like a falling tower; the monkey is already in the air,
//            a sideways aerial out from under it; stone and lava go up where he stood
//    SKID    in front of him, low: he lands on a knee and a hand and slides, the rod swept out behind, the fallen
//            staff a wall behind him
//    SETTLE  he rises into his guard; the camera comes round behind him to exactly where the fight camera starts —
//            the giant's staff still lies on the stone: the fight is on.
//
// Cut times are MV_CUES (seconds); the audio build exports the same as NIUMO_CUES.opening and main.js passes them in.
// seek(t) (debug, tools/cine_shot.mjs) fast-forwards to a moment of the cinematic, silently.
import * as THREE from 'three';
import { ease } from '../pose.js';
import { ShotTrack, AshFall, bullFrame, lendCineMoves, bullCineMoves, holdPose, setStaffSlide, safeSpot } from './cutscenes.js';
import { SEAT } from './moves_bull.js';

export const MV_CUES = {
  card: 0,         // chapter card on black (wind, the burning plain)
  ash: 2.6,        // ash on the scorched earth, his first step (fades in from black)
  caldera: 5.4,    // the caldera and the mountain (the gong)
  breath: 9.0,     // the shoulder: it breathes (a drum)
  knee: 12.0,      // the walk in (drum, choked cymbal, the suona, a quickening heartbeat)
  title: 17.4,     // THE TITLE: the rod strikes the stone (drums, tam-tam, cymbal, choir)
  eyes: 21.8,      // the eyes open (bell, sinking gong, drum)
  parley: 23.0,    // the spoken lines begin (the score is a quiet bed from here)
  end: 55.4,
};
/** The spoken exchange, in order (ids of assets/audio/voice/voice.json). */
export const PARLEY = ['b1', 'm1', 'b2', 'm2', 'b3', 'm3'];

/** The audio build's cue sheet (audio.js NIUMO_CUES.opening) mapped onto these shots. */
export function cuesFromScore(op) {
  if (!op || typeof op.parley !== 'number' || typeof op.title !== 'number') return null;
  const c = { ...MV_CUES };
  for (const k of Object.keys(MV_CUES)) if (typeof op[k] === 'number') c[k] = op[k];
  c.card = 0;
  return c;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * The splash screen's camera behind the click-to-start: wide over the caldera from behind the spawn — the seated giant
 * in the upper right, the dark on the left.
 */
export function titleCamera(camera, arena, time) {
  const S = arena.bullSeat || { x: 0, z: -30, yaw: 0 }, P = arena.playerSpawn || { x: 0, z: 40 };
  const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
  const rx = -fz, rz = fx;
  const a = Math.sin(time * 0.045);
  const back = 12 + a * 0.6, side = -1 + a * 0.4;
  const x = P.x + fx * back + rx * side, z = P.z + fz * back + rz * side;
  const gy = arena.groundY ? Math.max(0, arena.groundY(x, z)) : 0;
  camera.position.set(x, gy + 2.4 + a * 0.1, z);
  camera.lookAt(S.x + rx * 10, 9, S.z + rz * 10);
  if (Math.abs(camera.fov - 32) > 0.01) { camera.fov = 32; camera.updateProjectionMatrix(); }
}

// ------------------------------------------------------------------ set pieces (built for the MV, removed after)

// ------------------------------------------------------------------ the cinematic

const WALK = 1.15;      // m/s: the heavy, unhurried walk of the whole prologue

export class OpeningMV {
  /**
   * voice: VoiceLines; fightPose(): { pos, look, fov } of the fight camera's first frame with the monkey where he stands
   * now (main.js); onDone(skipped): the fight begins.
   */
  constructor({ G, camera, scene, bull, monkey, actor, audio, arena, fx, ui, voice, cues, bullTick, fightPose, onDone }) {
    Object.assign(this, { G, camera, scene, bull, monkey, actor, audio, arena, fx, ui, voice, bullTick, fightPose, onDone });
    const c = this.c = { ...MV_CUES, ...(cues || {}) };
    this.t = 0; this.done = false; this.fired = new Set();
    this.dof = null; this.post = {}; this.black = 1;
    this.rate = 1;                       // time dilation of the world (the strike)
    this.bf = bullFrame(bull, G.chars.bull);
    const bf = this.bf;
    const S = arena.bullSeat || { x: 0, z: -30, yaw: 0 }, P = arena.playerSpawn || { x: 0, z: 40 };
    this.S = S; this.P = P;
    this.F = bf.F.clone(); this.R = bf.R.clone();
    this.restoreMoves = lendCineMoves(actor);
    this.restoreBull = bull.a ? lendCineMoves(bull.a, bullCineMoves(SEAT)) : () => {};
    this.staff = G.staffs.monkey;
    this.slide0 = this.staff.userData.baseGf ?? this.staff.userData.gripFrac ?? 0.3;
    this.slide = this.slide0;
    this.titleEl = document.getElementById('title');
    this.ground = (x, z) => (arena.groundY ? Math.max(0, arena.groundY(x, z)) : 0);
    // set pieces
    this.ash = new AshFall(scene, { count: 900, box: [16, 10, 16], ember: 0.06 });
    this.ash.visible = false;
    // where things happen: he walks straight up the caldera at the giant and stops a staff's fall in front of him, a
    // little to the side away from the giant's iron staff (which stands in the frame like a pillar). That is where he
    // talks, where the staff comes down, and next to where the fight starts.
    const bstaff = G.staffs.bull, seatV = V(S.x, 0, S.z);
    this.staffSide = bstaff && bstaff.visible !== false ? Math.sign(bstaff.position.clone().sub(seatV).dot(this.R)) || 1 : 1;
    const st = safeSpot(arena, S.x + this.F.x * 20 - this.R.x * this.staffSide * 2, S.z + this.F.z * 20 - this.R.z * this.staffSide * 2);
    this.stand = V(st.x, this.ground(st.x, st.z), st.z);
    this.d = V(S.x - this.stand.x, 0, S.z - this.stand.z).normalize();          // from where he stands to the seat
    this.side = V(-this.d.z, 0, this.d.x);
    this.stopAt = c.title - 0.62 - 0.2;                                         // the walk ends; the knock lands on the title hit
    this.walkFrom = this.stand.clone().addScaledVector(this.d, -WALK * (this.stopAt - c.knee));
    this.walkFrom.y = this.ground(this.walkFrom.x, this.walkFrom.z);
    // the leap out from under the staff: sideways, to whichever side has rock to land on (the open side first)
    const pickLanding = sgn => {
      const q = this.stand.clone().addScaledVector(this.side, sgn * 5.6).addScaledVector(this.d, -0.4);
      const lava = arena.lavaAt ? arena.lavaAt(q.x, q.z) || 0 : 0, b = arena.bounds;
      const inB = !b || (q.x > b.minX + 2 && q.x < b.maxX - 2 && q.z > b.minZ + 2 && q.z < b.maxZ - 2);
      const rest = q.clone().addScaledVector(this.d, -1.7);
      const clear = Math.min(...(arena.colliders || []).map(k => Math.min(Math.hypot(k.x - q.x, k.z - q.z), Math.hypot(k.x - rest.x, k.z - rest.z)) - k.r), 99);
      return { q, ok: inB && lava < 0.25 && clear > 2.5, sgn };
    };
    const open = Math.sign(this.side.dot(this.R)) * -this.staffSide || 1;
    const land = [pickLanding(open), pickLanding(-open)].find(l => l.ok) || pickLanding(open);
    this.dodgeSgn = land.sgn;
    this.landAt = land.q; this.landAt.y = this.ground(land.q.x, land.q.z);
    this.restAt = this.landAt.clone().addScaledVector(this.d, -1.7).addScaledVector(this.side, land.sgn * 0.5);
    this.restAt.y = this.ground(this.restAt.x, this.restAt.z);
    this.lines = [
      [c.ash + 0.5, c.caldera + 1.3, '八百里火焰，四周围寸草不生。', 'Eight hundred li of fire. Nothing grows.'],
      [c.caldera + 1.7, c.breath - 0.1, '人说，那不是山。', 'They say that is no mountain.'],
    ];
    this.track = this.buildShots();
    // the parley: one beat per line; then the finale, whose beats end on the bull's own clock (see finale())
    this.beats = [
      ...PARLEY.map((id, i) => ({ line: id, shot: i === 0 ? 'eyes' : id, pre: i === 0 ? 0.3 : 0.28, post: id === 'm3' ? 0.7 : 0.4 })),
      { name: 'roar', shot: 'roar', fixed: 2.5 },
      { name: 'raise', shot: 'raise', fixed: 2.4, open: true },
      { name: 'strike', shot: 'strike', fixed: 4.0, open: true },
      { name: 'skid', shot: 'skid', fixed: 1.7 },
      { name: 'settle', shot: 'settle', fixed: 2.2 },
    ];
    this.bi = -1;
    // what the giant aims his staff at: the monkey's place, not the monkey (nothing here can hurt him)
    this.mark = { pos: this.stand.clone(), yaw: 0, speed: 0, dead: false, hp: 1, maxHp: 1, events: [], takeHit: () => false, canAct: () => false };
    ui.letterbox(true);
    ui.showChapter(false);
    ui.setHint('Enter 跳过');
    audio.setMusic('niumo_opening', { fade: 0.05 });
    voice?.load();
  }

  mPos() { return this.actor.root.position; }
  mHead() { return this.actor.bonePos ? this.actor.bonePos('Head', V()) : this.mPos().clone().setY(this.mPos().y + 1.35); }
  /** The gold face, a little in front of the head bone. */
  face() {
    const e = this.bull.eyeSprites;
    if (e && e[0] && e[1]) return e[0].position.clone().lerp(e[1].position, 0.5);
    return this.bf.head().addScaledVector(this.bf.F, this.bf.H * 0.02);
  }

  buildShots() {
    const c = this.c, bf = this.bf, F = this.F, R = this.R, S = this.S, P = this.P;
    const seat = V(S.x, 0, S.z);
    const head = () => bf.head();
    const mPos = () => this.mPos();
    const stand = this.stand, d = this.d, side = this.side;
    const lerp = THREE.MathUtils.lerp;
    const at = (o, fd, fs, y) => () => V(o.x + d.x * fd + side.x * fs, o.y + y, o.z + d.z * fd + side.z * fs);
    const gP = k => this.ground(P.x + F.x * k, P.z + F.z * k);
    // the reveal: from close behind his right shoulder, up and back, the caldera opening over it
    const toSeat = V(S.x - P.x, 0, S.z - P.z).normalize(), pSide = V(-toSeat.z, 0, toSeat.x);
    const camR = f => V(P.x, gP(0), P.z).addScaledVector(toSeat, -lerp(1.25, 3.6, f)).addScaledVector(pSide, lerp(0.42, 0.9, f)).add(V(0, lerp(1.46, 2.25, f), 0));
    // key art B: on the ground a few steps behind him as he walks in, looking up past him at the giant
    const wSide = side.clone().multiplyScalar(Math.sign(side.dot(R)) * -this.staffSide || 1);   // the side away from his staff
    const camB = back => () => mPos().clone().addScaledVector(d, -back).addScaledVector(wSide, 0.75).setY(this.ground(mPos().x, mPos().z) + 0.28);
    const lookB = up => () => mPos().clone().addScaledVector(d, 20).setY(up);
    // the title: behind him and above, the giant right of centre (the title sits on the left)
    const tRight = side.clone();
    const camT = (back, h, s) => () => stand.clone().addScaledVector(d, -back).addScaledVector(tRight, s).setY(stand.y + h);
    const lookT = y => seat.clone().setY(y).addScaledVector(tRight, -9);
    const away = -this.staffSide;
    const mHead = () => this.mHead();
    const focusM = () => this.camera.position.distanceTo(this.mHead()) + 0.1;
    const focusB = () => this.camera.position.distanceTo(this.face());
    // the strike, side on: the camera on the side he leaps to, a little behind him, low; the staff falls across the frame
    const sg = this.dodgeSgn;
    const OPEN = 1e9;
    const stepCam = { pos: V(P.x + 0.4, gP(-2.2) + 0.13, P.z - 2.2), look: V(P.x + 0.46, gP(-2.2) + 0.52, P.z - 9) };
    return new ShotTrack([
      // the chapter card on black (the camera already rests on the first frame)
      { name: 'card', t0: -1, t1: c.ash, e: 'linear', ap: 0.006, from: { ...stepCam, fov: 40 }, to: { ...stepCam, fov: 40 } },
      // the scorched ground, ash settling; a boot comes down right in front of the lens and walks on toward the blur
      // (the focus rides on his legs as he walks away - 2026-11-17 user: the focus belongs on the monkey in the foreground,
      // the fixed 1.0 -> 2.6 m pull fell behind him and left everything soft; the mountain is the blur)
      { name: 'step', t0: c.ash, t1: c.caldera, e: 'linear', ap: 0.012, blur: 0.02, shake: 0.03,
        focus: () => { const p = mPos(); return Math.max(0.6, this.camera.position.distanceTo(new THREE.Vector3(p.x, p.y + 0.45, p.z))); },
        from: { ...stepCam, fov: 40 },
        to: { pos: stepCam.pos.clone().add(V(-0.04, 0.02, -0.18)), look: stepCam.look.clone().add(V(0, 0.22, 0)), fov: 38 } },
      // the reveal (key art A): over his shoulder; the focus leaves him for the mountain
      { name: 'caldera', t0: c.caldera, t1: c.breath, e: 'inOut', ap: 0.004, blur: 0.012, shake: 0.03,
        focus: f => lerp(1.4, 70, smooth(0.25, 0.7, f)),
        from: { pos: f => camR(f), look: seat.clone().setY(7.6), fov: 34 },
        to: { pos: f => camR(f), look: seat.clone().setY(9.0), fov: 31 } },
      // the shoulder of the mountain and the gold mask against the sky: it breathes out, ash slides off it
      { name: 'breath', t0: c.breath, t1: c.knee, e: 'inOut', ap: 0.0009,
        from: { pos: () => bf.shoulder('Left').addScaledVector(F, 21).addScaledVector(R, -11).addScaledVector(bf.U, -7.5), look: () => bf.shoulder('Left').lerp(head(), 0.42), fov: 24 },
        to: { pos: () => bf.shoulder('Left').addScaledVector(F, 19.6).addScaledVector(R, -10).addScaledVector(bf.U, -7.0), look: () => bf.shoulder('Left').lerp(head(), 0.5), fov: 22 } },
      // the walk: far in front of him on the ground, a long lens; boots and cape first, then up to the gold mask
      { name: 'walk', t0: c.knee, t1: c.knee + 2.8, e: 'inOut', ap: 0.0032, blur: 0.014, shake: 0.05,
        focus: () => this.camera.position.distanceTo(mPos()),
        from: { pos: () => this.walkFrom.clone().addScaledVector(d, 9.5).addScaledVector(side, 0.5).setY(this.walkFrom.y + 0.22), look: () => mPos().clone().add(V(0, 0.2, 0)), fov: 15 },
        to: { pos: () => this.walkFrom.clone().addScaledVector(d, 9.5).addScaledVector(side, 0.5).setY(this.walkFrom.y + 0.3), look: () => mHead().add(V(0, -0.12, 0)), fov: 13.5 } },
      // under the giant (key art B): low behind the monkey as he walks in and stops
      { name: 'knee', t0: c.knee + 2.8, t1: c.title, e: 'out', ap: 0.0007, shake: 0.1, focus: () => this.camera.position.distanceTo(mPos()) + 0.5,
        from: { pos: camB(2.7), look: lookB(6.0), fov: 60 },
        to: { pos: camB(2.1), look: lookB(8.6), fov: 56 } },
      // THE TITLE on the big hit: the rod strikes; high and wide behind him, the ring of ash running out, the giant right of centre
      { name: 'title', t0: c.title, t1: c.eyes, e: 'out', ap: 0.0003, shake: 0.05,
        from: { pos: camT(22, 2.4, -2), look: lookT(6.6), fov: 40 },
        to: { pos: camT(29, 4.4, -3), look: lookT(7.8), fov: 38 } },
      // the gold face, telephoto from low and far in front; the eyes open; 牛魔王 speaks first
      { name: 'eyes', t0: c.eyes, t1: OPEN, dur: 9, e: 'linear', ap: 0.0016, blur: 0.012,
        from: { pos: () => seat.clone().addScaledVector(F, 32).addScaledVector(R, away * 3).setY(head().y * 0.6), look: () => this.face(), fov: 24 },
        to: { pos: () => seat.clone().addScaledVector(F, 29.5).addScaledVector(R, away * 2.5).setY(head().y * 0.62), look: () => this.face(), fov: 17 } },
      // 孙悟空: the gold mask, close and a little low, the caldera soft behind him
      { name: 'm1', t0: OPEN, t1: OPEN, e: 'inOut', ap: 0.0045, blur: 0.014, focus: focusM,
        from: { pos: at(stand, 1.7, sg * -0.95, 1.16), look: () => mHead().addScaledVector(side, sg * -0.1).add(V(0, -0.03, 0)), fov: 25 },
        to: { pos: at(stand, 1.45, sg * -0.7, 1.2), look: () => mHead().addScaledVector(side, sg * -0.06).add(V(0, -0.02, 0)), fov: 22 } },
      // 牛魔王: over the monkey's shoulder, up at the giant (the monkey a soft dark shape in the corner)
      { name: 'b2', t0: OPEN, t1: OPEN, e: 'inOut', ap: 0.0011, blur: 0.012, focus: focusB,
        from: { pos: at(stand, -1.15, 0.38, 0.5), look: () => mHead().lerp(this.face(), 0.6), fov: 40 },
        to: { pos: at(stand, -0.95, 0.32, 0.46), look: () => mHead().lerp(this.face(), 0.63), fov: 36 } },
      // 孙悟空「这回不借。来拿。」: low beside him; the rod wheels and levels on 来拿
      { name: 'm2', t0: OPEN, t1: OPEN, e: 'out', ap: 0.0026, blur: 0.012, focus: focusM,
        from: { pos: at(stand, 1.1, sg * -1.7, 0.32), look: () => mPos().clone().addScaledVector(d, 0.3).setY(mPos().y + 1.04), fov: 42 },
        to: { pos: at(stand, 1.2, sg * -1.35, 0.25), look: () => mPos().clone().addScaledVector(d, 0.45).setY(mPos().y + 1.12), fov: 37 } },
      // 牛魔王: high and wide behind him — the speck on the cracked floor, the mountain that talks (a slow crane down)
      { name: 'b3', t0: OPEN, t1: OPEN, e: 'inOut', ap: 0.0003,
        from: { pos: () => this.twoShot(0), look: () => this.twoLook(0.3), fov: 66 },
        to: { pos: () => this.twoShot(1), look: () => this.twoLook(0.32), fov: 62 } },
      // 孙悟空: low behind him, pushing in; the giant towers over the rod
      { name: 'm3', t0: OPEN, t1: OPEN, e: 'inOut', ap: 0.0009, blur: 0.01, focus: focusM,
        from: { pos: at(stand, -2.7, sg * 0.75, 0.5), look: () => mHead().lerp(head(), 0.1), fov: 56 },
        to: { pos: at(stand, -1.9, sg * 0.6, 0.42), look: () => mHead().lerp(head(), 0.12), fov: 52 } },
      // the roar: low in front, the monkey a speck before him, fire going up behind
      { name: 'roar', t0: OPEN, t1: OPEN, e: 'out', ap: 0.0005, shake: 0.7,
        from: { pos: seat.clone().addScaledVector(F, 36).addScaledVector(R, away * 5).setY(1.4), look: () => head().addScaledVector(bf.U, 2), fov: 44 },
        to: { pos: seat.clone().addScaledVector(F, 38).addScaledVector(R, away * 5.5).setY(1.2), look: () => head().addScaledVector(bf.U, 4), fov: 47 } },
      // the staff goes up: low and wide from the far side, the speck and the giant in profile, tilting up after the staff
      { name: 'raise', t0: OPEN, t1: OPEN, e: 'out', ap: 0.0003, shake: 0.25,
        from: { pos: at(stand, -3.0, sg * -11, 0.8), look: () => stand.clone().lerp(seat, 0.8).setY(11), fov: 60 },
        to: { pos: at(stand, -3.6, sg * -11.6, 0.7), look: () => stand.clone().lerp(seat, 0.85).setY(16.5), fov: 66 } },
      // the strike: side on from where he will land, low; slow motion
      { name: 'strike', t0: OPEN, t1: OPEN, e: 'linear', ap: 0.0006, shake: 0.12,
        from: { pos: at(stand, -1.6, sg * 7.9, 0.32), look: () => stand.clone().addScaledVector(d, 3).addScaledVector(side, sg * 1.5).setY(stand.y + 2.6), fov: 58 },
        to: { pos: at(stand, -1.4, sg * 7.5, 0.28), look: () => stand.clone().addScaledVector(d, 1.5).addScaledVector(side, sg * 3.2).setY(stand.y + 1.5), fov: 54 } },
      // bullet time: under him as he turns over in the air, the staff filling the sky behind him
      { name: 'hero', t0: OPEN, t1: OPEN, e: 'linear', ap: 0.002, blur: 0.012, shake: 0.05, focus: () => this.camera.position.distanceTo(mPos()) + 0.6,
        from: { pos: () => mPos().clone().addScaledVector(side, sg * 2.6).addScaledVector(d, -1.4).setY(stand.y + 0.35), look: () => mPos().clone().add(V(0, 0.75, 0)), fov: 52 },
        to: { pos: () => mPos().clone().addScaledVector(side, sg * 2.0).addScaledVector(d, -1.0).setY(stand.y + 0.3), look: () => mPos().clone().add(V(0, 0.75, 0)), fov: 46 } },
      // the skid: in front of him, low, the fallen staff a wall behind him
      { name: 'skid', t0: OPEN, t1: OPEN, e: 'out', ap: 0.003, blur: 0.012, shake: 0.2, focus: focusM,
        from: { pos: () => this.restAt.clone().addScaledVector(d, 2.2).addScaledVector(side, sg * 2.3).setY(this.restAt.y + 0.36), look: () => mHead().add(V(0, -0.2, 0)), fov: 40 },
        to: { pos: () => this.restAt.clone().addScaledVector(d, 1.9).addScaledVector(side, sg * 1.7).setY(this.restAt.y + 0.42), look: () => mHead().add(V(0, -0.1, 0)), fov: 35 } },
      // round behind the monkey, into the fight camera's first frame
      { name: 'settle', t0: OPEN, t1: OPEN, e: 'inOut', ap: 0.0004,
        from: { pos: () => this.restAt.clone().addScaledVector(d, -4.2).addScaledVector(side, sg * 2.6).setY(this.restAt.y + 1.2), look: () => mHead().lerp(head(), 0.3), fov: 42 },
        to: { pos: () => this.fightCam.pos.clone(), look: () => this.fightCam.look.clone(), fov: 40 } },
    ]);
  }

  shot(name) { return this.track.shots.find(s => s.name === name); }
  /** Cut to a named shot inside the current beat (the one running ends here). */
  cutShot(name, dur) {
    const cur = this.track.at(this.t), s = this.shot(name);
    if (!s || cur === s) return;
    cur.t1 = this.t;
    if (name === 'strike') {      // back to the shot the beat started on: it carries on from where its move has got to
      const k = (this.t - s.t0) / Math.max(s.dur || 1, 1e-3);
      s.t0 = this.t - k * dur;
    } else s.t0 = this.t;
    s.t1 = 1e9; s.dur = dur;
  }
  /** The monkey's own key light (look.js), 0..1. */
  setKey(k) {
    const look = this.G.chars.monkey?.model?.userData.look;
    if (!look || look.keyK === k) return;
    look.keyK = k;
    if (look.preset && look.uniforms.lkKeyCol) look.uniforms.lkKeyCol.value.fromArray(look.preset.keyCol).multiplyScalar(look.preset.key * k);
  }
  /** High behind the monkey, a little toward the giant's centre line (the b3 wide). */
  twoShot(f) {
    const inward = this.R.clone().multiplyScalar(-this.staffSide);
    return this.stand.clone().addScaledVector(this.d, -THREE.MathUtils.lerp(16, 14, f)).addScaledVector(inward, THREE.MathUtils.lerp(6, 5.5, f))
      .setY(this.stand.y + THREE.MathUtils.lerp(6, 5, f));
  }
  twoLook(k) { return this.mPos().clone().setY(this.mPos().y + 1).lerp(this.face(), k).addScaledVector(this.R, -this.staffSide * 5); }
  once(key, at, fn) { if (this.t >= at && !this.fired.has(key)) { this.fired.add(key); fn(); } }

  /** Put the monkey somewhere (or hide him) for the current shot. pose: a cinematic move to hold / play (null: none). */
  placeMonkey(pos, yaw, { walk = false, visible = true, pose = 'cineCarry', speed = WALK, slide = this.slide0 } = {}) {
    const a = this.actor;
    a.root.visible = visible; this.staff.visible = visible;
    if (!visible) return;
    a.root.position.copy(pos); a.root.rotation.y = yaw;
    this.monkey.pos.copy(pos);
    const clip = walk ? (a.actions.walk ? 'walk' : 'idle') : (a.actions.idle ? 'idle' : Object.keys(a.actions)[0]);
    a.playBase(clip, { fade: 0.35 });
    if (walk && a.actions.walk) a.setBaseTimeScale(THREE.MathUtils.clamp(speed / (a.clipSpeed('walk') || 1.2), 0.5, 1.6));
    else a.setBaseTimeScale?.(0.8);
    if (pose) holdPose(a, pose);
    else if (a.move && a.move.name?.startsWith('cine')) a.stopMove();
    this.slideWant = slide;
  }

  /**
   * The prologue runs on the score's clock (audio.musicTime() since 'niumo_opening' started), so every cut stays on its
   * drum even when frames drop; from the parley on (and without audio, and after a seek) it runs on the frame clock.
   */
  clock(dt) {
    if (this.t < this.c.parley && !this.free) {
      const mt = this.audio.musicState === 'niumo_opening' && this.audio.musicTime ? this.audio.musicTime() : null;
      if (mt !== null && mt !== undefined && isFinite(mt)) { this.synced = true; return Math.max(this.t, mt); }
      this.waitAudio = (this.waitAudio || 0) + dt;
      return this.synced || this.waitAudio > 1 ? this.t + dt : 0;
    }
    return this.t + dt;
  }

  /** Debug: run silently up to time t (seconds from the start) and carry on from there on the frame clock. */
  seek(t) {
    this.free = true; this.seeking = true;
    for (let i = 0; i < 6000 && this.t < t && !this.done; i++) this.update(1 / 30);
    this.seeking = false;
  }

  /** Debug: run silently to `after` seconds into the named beat (a line id, or roar / raise / strike / skid / settle). */
  seekBeat(name, after = 0) {
    this.free = true; this.seeking = true;
    const i = this.beats.findIndex(b => (b.line || b.name) === name);
    for (let n = 0; n < 9000 && !this.done && (this.bi < i || (this.bi === i && this.bt < after)); n++) this.update(1 / 60);
    this.seeking = false;
  }

  // -------------------------------------------------------------- the parley and the finale (event-driven beats)

  startBeat(i) {
    const prev = this.beats[this.bi], b = this.beats[i];
    this.bi = i; this.bt = 0;
    if (!b) return;
    b.started = true;
    const s = this.shot(b.shot);
    b.dur = b.line ? b.pre + (this.voice ? this.voice.duration(b.line) : 3) + b.post : b.fixed;
    if (prev && prev.shot !== b.shot) { const ps = this.shot(prev.shot); if (ps) ps.t1 = this.t; }
    if (s) {
      if (s.t0 > this.t) { s.t0 = this.t; s.t1 = 1e9; s.dur = b.dur; }      // a new shot for this beat
      else s.dur = this.t - s.t0 + b.dur;                                     // the shot already running (the face)
    }
    if (b.name === 'roar') this.roar();
    if (b.name === 'raise') this.raise();
    if (b.name === 'strike') this.strike();
    if (b.name === 'skid') this.skid();
    if (b.name === 'settle') this.settle();
  }

  updateBeats(dt) {
    if (this.bi < 0) { if (this.t >= this.c.parley) this.startBeat(0); else return; }
    const b = this.beats[this.bi];
    if (!b) return;
    this.bt += dt;
    if (b.line && !b.spoken && this.bt >= b.pre) {
      b.spoken = true;
      if (!this.seeking) { this.voice?.play(b.line); b.heard = this.voice?.cur; }
      // his voice comes out of a mountain: the ground hums, ash shakes off his brow
      if (this.voice?.lines[b.line]?.speaker === 'bull') {
        this.track.jolt(0.18); this.arena.shake?.(0.12);
        this.fx.motes?.(this.bf.head(), 3, 14, new THREE.Color(0.55, 0.22, 0.08));
      }
    }
    const talking = b.heard && !b.heard.done;
    // the finale's open beats end when the staff says so (finale()), with their fixed length as a safety net
    const over = b.open ? (b.over || this.bt >= b.dur + 2) : this.bt >= b.dur;
    if (over && !talking) {
      if (this.bi + 1 < this.beats.length) this.startBeat(this.bi + 1);
      else this.finish(false);
    }
  }

  roar() {
    const bf = this.bf;
    // he wakes (bull.js roars itself) — the AI stays blind to the monkey: the cinematic feeds him the ghost
    if (this.bull.state === 'dormant') this.bull.wake?.({ opening: false });      // (the opening blow is ours to stage)
    if (this.bull.a?.lib?.cineRoar) { this.bull.a.stopMove(); this.bull.a.startMove('cineRoar'); }
    this.audio.play('bull_roar', { pos: bf.head(), volume: 1, pitch: 0.6 });
    // the fight music's first downbeat (big drum, gong) lands on the roar
    this.audio.setMusic('niumo_phase1', { fade: 0.2 });
    this.track.jolt(0.9);
    this.G.flash = Math.max(this.G.flash, 0.12);
    for (const [r, f, s] of [[-14, -16, 1.4], [12, -20, 1.2], [0, -30, 1.8]]) { const p = bf.at(r, 0, f); this.arena.eruption?.(p.x, p.z, s); }
    this.arena.shake?.(0.8);
    this.roarT = this.t;
  }

  /** The giant's staff goes up over the monkey's place (bull.js's own slam; a bull with openingSlam() stages it itself). */
  raise() {
    const b = this.bull;
    this.mark.pos.copy(this.stand);
    if (typeof b.openingSlam === 'function') b.openingSlam({ target: this.stand, hold: 0.45, rest: 9.5 });   // it lies there well into the fight
    else if (b.forceAttack?.('slam', this.mark) && b.atk) b.atk.holdFor = 0.45;
    this.slam = b.atk && b.atk.name === 'slam' ? b.atk : null;
    this.slamOn = true;
    this.audio.play('staff_swing', { pos: this.bf.head(), volume: 0.8, pitch: 0.4 });
  }

  /** Slow motion: the staff falls; he is already leaving the ground. */
  strike() {
    const a = this.actor;
    a.stopMove();
    const mv = a.startMove('cineDodge');
    if (this.rollSign() < 0) {       // the aerial turns toward the side he leaps to
      const tr = mv.def.track_;
      mv.def = { ...mv.def, track_: { duration: tr.duration, evaluate: t => { const p = tr.evaluate(t); return p.pivot ? { ...p, pivot: { ...p.pivot, roll: -(p.pivot.roll || 0) } } : p; } } };
    }
    this.dodge = mv;
    this.audio.play('roll', { pos: this.stand, volume: 0.7 });
    this.fx.dust?.(this.stand.clone(), 0.7, 12);
  }
  rollSign() { return Math.sign(this.side.clone().multiplyScalar(this.dodgeSgn).dot(this.actor.rig.R)) || 1; }

  skid() {
    this.skidT = 0;
    this.audio.play('boss_step', { pos: this.landAt, volume: 0.55, pitch: 1.7 });
    this.track.jolt(0.3);
  }

  settle() {
    // the monkey takes his place for the fight; the camera comes down to where the fight camera will start
    const a = this.actor;
    this.monkey.reset?.({ x: this.restAt.x, z: this.restAt.z, yaw: this.standYaw(this.restAt) });
    a.startMove('cineRise');
    const keepRoot = a.root.position.clone();
    this.fightCam = this.fightPose?.() || { pos: this.restAt.clone().addScaledVector(this.d, -4.5).setY(this.restAt.y + 2.2), look: this.bf.head(), fov: 50 };
    a.root.position.copy(keepRoot);
    const s = this.shot('settle');
    s.to.fov = this.fightCam.fov || 50;
    this.ui.letterbox(false);
    this.ui.setHint('');
  }

  standYaw(p = this.stand) { return Math.atan2(this.S.x - p.x, this.S.z - p.z); }

  /** The finale on the bull's clock: when the staff is up, when it lands, where the monkey is in his leap. */
  finale(dt, beat) {
    const b = this.bull, a = this.actor, mv = b.a?.move, name = beat.name;
    const slamT = this.slam && mv && b.atk === this.slam ? mv.t : null;
    const def = this.slam?.def || {};
    const impactAt = def.impactAt ?? 1.7, holdAt = def.holdAt ?? 1.2;
    const landed = this.slam ? this.slam.fired?.has('impact') : this.bt > 1.4;
    if (name === 'raise') {
      // cut as the staff starts to fall
      beat.over = slamT === null ? this.bt >= 1.9 : (slamT > holdAt + 0.02 && !mv.holding) || this.bt > 4;
      this.rate = 1;
    } else if (name === 'strike') {
      // bullet time: the world all but stops while he is upside down in the air (the hero shot), then lets go
      const dt_ = a.move?.name === 'cineDodge' ? a.move.t : 0, mid = dt_ > 0.3 && dt_ < 0.54;
      if (mid && !this.heroOn) { this.heroOn = true; this.cutShot('hero', 1.6); this.G.aberr = 0.7; this.audio.play('sword_glint', { pos: this.stand, volume: 0.5, pitch: 0.6 }); }
      if (!mid && this.heroOn && !this.heroOff) { this.heroOff = true; this.cutShot('strike', 2.5); }
      if (mid) this.rate = 0.09;
      else if (!landed) this.rate = 0.22;
      else { this.hitT = (this.hitT || 0) + dt; this.rate = THREE.MathUtils.lerp(0.22, 0.75, smooth(0.05, 0.8, this.hitT)); }
      this.once('impact-cam', landed ? 0 : 1e9, () => { this.track.jolt(1.2); this.G.flash = Math.max(this.G.flash, 0.1); this.G.aberr = 1; });
      const dm = this.dodge?.def || {};
      beat.over = (a.move?.name === 'cineDodge' && a.move.t >= (dm.landAt ?? 0.74)) || this.bt > 6;
    } else if (name === 'skid') {
      this.rate = THREE.MathUtils.lerp(0.75, 1, smooth(0, 0.6, this.bt));
    } else this.rate = 1;
    void impactAt;
  }

  /** Where the monkey is during the finale. */
  finaleMonkey(dt, beat) {
    const a = this.actor, name = beat.name, yaw = this.standYaw();
    if (name === 'roar' || name === 'raise') { this.placeMonkey(this.stand, yaw, { pose: 'cineStance' }); return; }
    a.root.visible = true; this.staff.visible = true;
    a.playBase('idle', { fade: 0.2 });
    if (name === 'strike') {
      const dm = this.dodge?.def || {}, t = a.move?.name === 'cineDodge' ? a.move.t : 0;
      const u = clamp01((t - (dm.airFrom ?? 0.14)) / ((dm.landAt ?? 0.74) - (dm.airFrom ?? 0.14)));
      const p = this.stand.clone().lerp(this.landAt, ease.out(u) * 0.35 + u * 0.65);
      p.y = THREE.MathUtils.lerp(this.stand.y, this.landAt.y, u) + 4 * 1.25 * u * (1 - u);
      a.root.position.copy(p);
    } else if (name === 'skid') {
      this.skidT += dt;
      const u = ease.out(clamp01(this.skidT / 0.85));
      a.root.position.copy(this.landAt).lerp(this.restAt, u);
      if (u < 0.9 && (this.skidAcc = (this.skidAcc || 0) + dt) > 0.05) { this.skidAcc = 0; this.fx.dust?.(a.root.position.clone(), 0.5, 5); }
    } else a.root.position.copy(this.restAt);
    a.root.rotation.y = this.standYaw(a.root.position);
    this.monkey.pos.copy(a.root.position);
    this.slideWant = this.slide0;
  }

  update(dt) {
    if (this.done) return;
    const prev = this.t;
    this.t = this.clock(dt);
    dt = Math.max(0, Math.min(0.25, this.t - prev));
    const t = this.t, c = this.c, bf = this.bf, fx = this.fx;
    this.updateBeats(dt);
    if (this.done) return;
    const beat = this.beats[this.bi];
    const fin = beat && beat.name;                       // in the finale
    if (fin) this.finale(dt, beat); else this.rate = 1;
    const wdt = dt * this.rate;                          // the world's time (the camera keeps real time)
    if (this.rate < 0.999) { this.G.slowmo = this.rate; this.G.slowmoT = 0.12; }
    // ---- the giant
    if (this.slamOn) {
      // his staff is in the air: he sees the monkey's place until it lands, then nothing (no second blow before the fight)
      const landed = !this.slam || this.slam.fired?.has('impact') || this.bull.atk !== this.slam;
      this.bull.update(wdt, landed ? this.G.ghost : this.mark);
    } else this.bullTick(wdt);
    bf.frame();
    // ---- the chapter card on black
    this.once('card-on', 0.3, () => this.ui.showChapter(true));
    this.once('card-off', c.ash - 0.2, () => this.ui.showChapter(false));
    this.black = t < c.ash ? 1 : 1 - smooth(c.ash, c.ash + 1.4, t);
    // ---- the title card on the big hit
    this.once('title-on', c.title, () => { this.titleEl?.classList.remove('hide'); this.titleEl?.classList.add('nomenu'); this.G.flash = Math.max(this.G.flash, 0.08); this.track.jolt(0.45); });
    this.once('title-off', c.eyes - 0.9, () => this.titleEl?.classList.add('hide'));
    // ---- cast
    const shot = this.track.at(t), name = shot.name;
    this.shotName = name;
    const yaw = this.standYaw();
    if (name === 'card' || name === 'step') {     // his boots pass the lens, walking at the mountain
      const P = this.P, u = t - c.ash + 0.25;
      const p = V(P.x + 0.74 - 0.03 * u, 0, P.z - 1.3 - WALK * u);
      p.y = this.ground(p.x, p.z);
      this.placeMonkey(p, Math.atan2(-0.03, -1), { walk: true, visible: t > c.ash - 0.3 });
    } else if (name === 'caldera') {    // standing at the rim, looking at the mountain
      this.placeMonkey(V(this.P.x, this.ground(this.P.x, this.P.z), this.P.z), Math.atan2(this.S.x - this.P.x, this.S.z - this.P.z));
    } else if (name === 'walk' || name === 'knee' || name === 'title') {   // the walk in, the stop, the knock
      const f = clamp01((t - c.knee) / (this.stopAt - c.knee));
      const p = this.walkFrom.clone().lerp(this.stand, f);
      p.y = this.ground(p.x, p.z);
      const knock = t >= c.title - 0.62;
      this.placeMonkey(p, yaw, { walk: f < 1, pose: knock ? 'cineKnock' : 'cineCarry', slide: knock ? 0.44 : this.slide0 });
    } else if (fin) {
      this.finaleMonkey(wdt, beat);
    } else if (beat && this.bi >= 0) {  // the parley: he stands his ground
      const line = beat.line, said = this.bt - beat.pre;
      const pose = line === 'm1' ? 'cineTilt' : line === 'b1' || line === 'b2' ? (this.bi < 1 ? 'cineKnock' : 'cineLookUp')
        : line === 'm2' ? (said > 0.95 ? 'cinePoint' : 'cineLookUp') : line === 'b3' ? 'cinePoint' : (said > 1.3 ? 'cineStance' : 'cinePoint');
      if (pose === 'cinePoint') {
        this.once('wheel', 0, () => this.audio.play('staff_swing', { pos: this.stand, volume: 0.6, pitch: 1.1 }));
        const mv = this.actor.move;
        if (mv && mv.name === 'cinePoint' && mv.t >= 0.78) this.once('point', 0, () => { this.track.jolt(0.3); this.audio.play('staff_swing', { pos: this.stand, volume: 0.5, pitch: 0.7 }); fx.dust?.(this.stand.clone(), 0.9, 16); });
      }
      const planted = pose === 'cineLookUp' || pose === 'cineTilt' || pose === 'cineKnock';
      this.placeMonkey(this.stand, yaw, { pose, slide: planted ? 0.44 : this.slide0 });
    } else if (name === 'eyes') {
      this.placeMonkey(this.stand, yaw, { pose: 'cineKnock', slide: 0.44 });
    } else this.placeMonkey(null, 0, { visible: false });
    // the fist slides along the rod between the carry and the planted rod
    this.slide += ((this.slideWant ?? this.slide0) - this.slide) * (1 - Math.exp(-7 * wdt));
    setStaffSlide(this.staff, this.slide);
    if (this.actor.root.visible) this.actor.update(wdt);
    // ---- the knock: the foot of the rod strikes the stone on the title hit; a ring of ash runs out from it
    this.once('knock', c.title - 0.02, () => {
      const p = this.stand.clone().addScaledVector(this.actor.rig.R, 0.3).addScaledVector(this.d, 0.3);
      this.audio.play('staff_hit_heavy', { pos: p, volume: 1, pitch: 0.7 });
      fx.shockwave?.(p, 16, 1.5, new THREE.Color(1.0, 0.62, 0.3));
      fx.dust?.(p, 1.6, 46);
      this.knockT = t; this.knockP = p;
      this.arena.shake?.(0.35);
    });
    if (this.knockT !== undefined && t - this.knockT < 1.6 && (this.ringAcc = (this.ringAcc || 0) + dt) > 0.035) {
      // the ash on the floor lifts as the ring passes
      this.ringAcc = 0;
      const r = 1 + (t - this.knockT) * 9.5, k = 1 - (t - this.knockT) / 1.6;
      for (let i = 0; i < 16 * k; i++) {
        const a = Math.random() * Math.PI * 2, p = V(this.knockP.x + Math.cos(a) * r, 0, this.knockP.z + Math.sin(a) * r);
        p.y = this.ground(p.x, p.z) + 0.15;
        fx.alpha.emit(p, V(Math.cos(a) * rand(1.5, 3.5), rand(0.4, 1.4), Math.sin(a) * rand(1.5, 3.5)), new THREE.Color(0.2, 0.15, 0.12),
          { size: rand(0.5, 1.3), life: rand(1.0, 2.0), drag: 1.4, grav: 0.1, alpha: 0.3 * k, grow: 1.5 });
      }
    }
    // ---- set pieces
    const ashShot = ['card', 'step', 'walk', 'knee', 'eyes', 'm1', 'm2', 'm3', 'skid'].includes(name);
    this.ash.visible = ashShot;
    if (ashShot) { this.ash.center.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(V()), 5); this.ash.update(wdt); }
    // ---- beats of the score
    // the mountain breathes out; ash slides off the shoulder in a slow fall
    if (name === 'breath' && (this.slideAcc = (this.slideAcc || 0) + dt) > 0.04) {
      this.slideAcc = 0;
      const sh = bf.shoulder('Left'), k = 0.5 + 0.5 * Math.sin((t - c.breath) / (c.knee - c.breath) * Math.PI);
      for (let i = 0; i < 4 * k; i++) {
        const p = sh.clone().add(V(rand(-2.5, 2.5), rand(1.5, 3), rand(-2, 2)));
        const v = this.R.clone().multiplyScalar(-rand(0.3, 1.0)).add(V(rand(-0.2, 0.2), rand(-0.9, -0.2), rand(-0.3, 0.3)));
        fx.alpha.emit(p, v, new THREE.Color(0.2, 0.19, 0.18), { size: rand(0.15, 0.55), life: rand(2.2, 3.6), drag: 0.35, grav: -1.1, alpha: 0.6, grow: 0.8 });
      }
    }
    // the eyes open with the gong, and stay open
    this.G.setEyes(smooth(c.eyes + 0.5, c.eyes + 2.4, t));
    this.once('brow-dust', c.eyes + 0.8, () => fx.motes(bf.head(), 2.2, 18, new THREE.Color(0.8, 0.28, 0.08)));
    // the head comes up a little with every line (bull.js lifts it the rest of the way when he wakes on the roar)
    if ('wakeK' in this.bull && this.bull.state === 'dormant') {
      const want = this.bi < 0 ? 0 : Math.min(0.75, 0.2 + this.bi * 0.11);
      this.bull.wakeK += (want - this.bull.wakeK) * (1 - Math.exp(-0.9 * dt));
    }
    // the roar: fire goes up behind him
    if (this.roarT !== undefined && t - this.roarT < 3.5 && (this.fireAcc = (this.fireAcc || 0) + dt) > 0.03) {
      this.fireAcc = 0;
      const k = 1 - smooth(this.roarT + 1.5, this.roarT + 3.5, t);
      for (let i = 0; i < 6 * k; i++) {
        const p = bf.at(rand(-24, 24), rand(0, 6), rand(-34, -14));
        fx.add.emit(p, V(rand(-2, 2), rand(14, 34), rand(-2, 2)), new THREE.Color(2.2, 0.55, 0.12), { size: rand(0.3, 0.9), life: rand(1.2, 2.4), drag: 0.25, grav: -3, alpha: 0.9 });
      }
    }
    // ---- narration (the prologue); the spoken lines show their own subtitles
    if (this.bi < 0) {
      const line = this.lines.find(([a, z]) => t >= a && t < z);
      this.ui.narrate(line ? line[2] : '', line ? line[3] : '');
    }
    // the fight camera frames what the giant is doing, and that changes while the staff settles on the stone: keep
    // the last shot's landing place current, so it ends exactly where the fight camera starts
    const landing = name === 'settle' && beat && this.bt > beat.dur - 0.4;          // the last moments: every frame
    if (name === 'settle' && this.fightCam && this.fightPose && ((this.poseAcc = (this.poseAcc || 0) + dt) > 0.2 || landing)) {
      this.poseAcc = 0;
      const keep = this.actor.root.position.clone();
      this.fightWant = this.fightPose();
      this.actor.root.position.copy(keep);
    }
    if (this.fightWant) {
      const k = 1 - Math.exp(-(landing ? 30 : 8) * dt);
      this.fightCam.pos.lerp(this.fightWant.pos, k); this.fightCam.look.lerp(this.fightWant.look, k);
      this.fightCam.fov += ((this.fightWant.fov || this.fightCam.fov) - this.fightCam.fov) * k;
      const s = this.shot('settle'); if (s) s.to.fov = this.fightCam.fov;
    }
    // ---- camera
    const info = this.track.apply(this.camera, t, dt);
    const settleK = name === 'settle' ? smooth(0.2, 0.85, this.bt / (beat?.dur || 1)) : 0;
    this.dof = settleK >= 0.999 ? null : { focus: shot.focus ? shot.focus(info.f) : info.dist, aperture: (shot.ap ?? 0.001) * (1 - settleK), maxblur: shot.blur ?? 0.01 };
    this.audio.setListener({ position: info.pos, forward: info.look.clone().sub(info.pos).normalize() });
    this.post = { warm: 0, vignette: name === 'm1' || name === 'b2' ? 0.12 : 0, bloom: 0 };
  }

  skip() { if (!this.done) this.finish(true); }

  finish(skipped = false) {
    if (this.done) return;
    this.done = true;
    if (skipped) this.voice?.stop();
    this.black = 0; this.dof = null; this.post = {};
    this.ash.dispose();
    this.restoreMoves();
    // (the bull keeps the lent moves' library only if one is still playing; his own moves are untouched)
    if (!this.bull.a?.move || !/^cine/.test(this.bull.a.move.name)) this.restoreBull(); else { this.bull.a.stopMove(); this.restoreBull(); }
    setStaffSlide(this.staff, this.slide0);
    this.actor.root.visible = true; this.staff.visible = true;
    this.actor.setBaseTimeScale?.(1);
    this.G.slowmo = 1; this.G.slowmoT = 0;
    this.setKey(1);
    this.ui.narrate(''); this.ui.showChapter(false); this.ui.letterbox(false); this.ui.setHint('');
    this.titleEl?.classList.add('hide');
    this.G.setEyes(1);
    const at = this.fired.has('landed') || this.bi >= this.beats.findIndex(b => b.name === 'skid') ? this.restAt : this.stand;
    this.monkey.reset?.({ x: at.x, z: at.z, yaw: this.standYaw(at) });
    this.onDone?.(skipped);
  }
}
