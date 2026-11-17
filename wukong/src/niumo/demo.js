// 火焰山 · 牛魔 — the demo player (?demo). A bot that plays the monkey through the real game: it never touches the
// monkey's or the bull's state, it only does what a player does — it pushes the stick (camera-relative, like a gamepad's
// left stick), holds Space to run, and presses / holds / releases the same actions the keys send (J light, K heavy,
// L guard, I fan, Space roll) into the game's NiumoInput. Everything it reacts to is something a player can see: the
// tell of each move (the hand's shadow, the line cracking open, the throat glowing, the rings on the ground, the staff
// coming round), where the weak points glow, his head on the ground.
//
// How it plays (a patient, skilled player, not a frame-perfect machine):
//   - reads the move he has started and its timing; rolls through slams, palms, grabs, stomps and bombs so the
//     invulnerable frames cover the blow; parries the sweeping staff when it is sure of the timing, else rolls;
//     walks out of the slam's line, the bomb rings, the javelin's ring, burning ground and lava
//   - when he breathes fire it stands in the sweep facing him and fans the stream back into his face (芭蕉扇)
//   - works one weak point at a time (knees while he sits, the hand he slaps down, the shins once he stands), from a
//     spot beside it that is not right in front of him (he grabs what lingers there), in short strings it can roll out
//     of; a charged smash (or the fan, then the smash) when he gives it a long opening
//   - when his head comes down it runs in and does 牵牛鼻子
// It drives the input only between the cinematics (main calls update() in the fight states).
import * as THREE from 'three';
import { segSeg } from '../combat.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a, b) => a + Math.random() * (b - a);
const hyp = Math.hypot;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

const ROLL_DIST = 3.8;             // the roll's root motion (moves_monkey.js)
const IFRAME = [0.04, 0.38];       // the roll's invulnerable frames
const ROLL_LEAD = 0.13;            // press the roll this long before the blow (its i-frames then cover it)
const REACH = 1.45;                // standing this far from a weak point's surface, the rod lands on it

export class DemoBot {
  constructor(G) {
    this.G = G;
    this.active = false;
    this.time = 0;
    this.stick = { x: 0, y: 0 };      // what input.move() returns while the bot plays
    this.run = false;
    this.dir = new THREE.Vector3(0, 0, -1);    // smoothed world direction of the stick
    this.mag = 0;
    this.goal = null; this.goalWhy = ''; this.goalT = 0; this.moving = false;
    this.held = new Set();
    this.heavy = null;                // { until } while K is held
    this.lastPress = -10; this.lastDodge = -10;
    this.plan = null;                 // the dodge decided for the current move: { at, kind: 'roll'|'parry', dir, done }
    this.planKey = '';
    this.prev = { tipAng: null, hornD: null, streamAng: null };
    this.target = null; this.targetT = 0;
    this.stats = { dmgDealt: 0, dmgTaken: 0, rolls: 0, parries: 0, fans: 0, reflects: 0, crits: 0, lights: 0, heavies: 0, deaths: 0, t: 0 };
    this.lastBullHp = null; this.lastMonkeyHp = null;
    this.log = [];
    this.debug = false;
    // the stick and the run button go through the game's own input object
    const inp = G.input;
    const rawMove = inp.move.bind(inp), rawSprint = inp.sprinting.bind(inp);
    inp.move = () => (this.active ? { x: this.stick.x, y: this.stick.y } : rawMove());
    inp.sprinting = () => (this.active ? this.run : rawSprint());
  }

  get monkey() { return this.G.monkey; }
  get bull() { return this.G.bull; }
  get arena() { return this.G.arena; }

  note(s) { this.log.push(`${this.time.toFixed(2)} ${s}`); if (this.log.length > 400) this.log.shift(); if (this.debug) console.log('[demo] ' + s); }

  // ---------------------------------------------------------------------------------------------- input

  press(a) { this.G.input.press(a); this.lastPress = this.time; this.coin = Math.random(); }
  hold(a) { if (!this.held.has(a)) { this.G.input.press(a); this.held.add(a); this.coin = Math.random(); } }
  release(a) { if (this.held.has(a)) { this.G.input.release(a); this.held.delete(a); } }
  releaseAll() {
    for (const a of [...this.held]) this.release(a);
    this.stick.x = this.stick.y = 0; this.run = false; this.mag = 0; this.heavy = null;
  }
  setActive(on) {
    if (on === this.active) return;
    if (!on) this.releaseAll();
    this.active = on;
  }

  /** Point the stick along world direction (x, z) with magnitude m (instant). */
  aim(x, z, m = 1) {
    const cam = this.G.cam, f = cam.forward(_a), r = cam.right(_b);
    const l = hyp(x, z) || 1;
    x /= l; z /= l;
    this.stick.x = (x * r.x + z * r.z) * m;
    this.stick.y = (x * f.x + z * f.z) * m;
  }

  // ---------------------------------------------------------------------------------------------- the world

  lava(x, z) { return this.arena.lavaAt ? this.arena.lavaAt(x, z) || 0 : 0; }
  inBounds(x, z, m = 1) { const b = this.arena.bounds; return !b || (x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m); }
  /** Inside a pillar, a stele, his body (r: our margin)? */
  solid(x, z, r = 0.5) {
    for (const c of this.arena.colliders || []) if (hyp(x - c.x, z - c.z) < c.r + r) return true;
    const b = this.bull;
    if (b && !b.dead && b.colliders) for (const c of b.colliders() || []) if (c.r > 0 && !c.staff && hyp(x - c.x, z - c.z) < c.r + r) return true;       // (the staff on the stone is what he walks up to and hits)
    return false;
  }
  /** Ground the monkey can stand on: no lava (with a margin), not in a body, inside the field. */
  standable(x, z, m = this.bull && this.bull.phase === 2 ? 1.1 : 0.8) {
    if (!this.inBounds(x, z, 1.5) || this.solid(x, z, 0.45)) return false;
    if (this.lava(x, z) > 0.15) return false;
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; if (this.lava(x + Math.cos(a) * m, z + Math.sin(a) * m) > 0.45) return false; }
    return true;
  }
  /** Inside a danger zone (the slam's line, bomb rings, burning ground, the javelin's ring) at time `when` from now? */
  inDanger(x, z, when = 0) {
    for (const d of this.dangers) {
      if (d.until !== undefined && d.until < this.time + when) continue;
      if (d.kind === 'circle') { if (hyp(x - d.x, z - d.z) < d.r) return d; }
      else if (d.kind === 'line') {
        const px = x - d.x, pz = z - d.z, along = px * d.dx + pz * d.dz, lat = Math.abs(-px * d.dz + pz * d.dx);
        if (along > d.from && along < d.to && lat < d.w) return d;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------- perception

  /** The bull's current move: { name, t (move time), speed, def, at } or null. */
  move() {
    const b = this.bull;
    if (!b || b.dead || !b.atk || !b.a.move || b.state !== 'attack') return null;
    const mv = b.a.move;
    return { name: b.atk.name, t: mv.t, speed: mv.speed || 1, def: b.atk.def, at: b.atk, mv };
  }
  /** Seconds (game time) from now until move-time T of the current move. */
  until(m, T) { return (T - m.t) / m.speed; }

  /**
   * What is coming, from his tells: the zones to keep out of (this.dangers) and, when a blow will land on the monkey
   * wherever he goes, the moment to roll (or parry) through it (this.plan).
   */
  perceive(dt) {
    const b = this.bull, M = this.monkey, P = M.pos;
    this.dangers = [];
    const m = this.move();
    const key = m ? m.name + ':' + m.at.t0 : '';
    if (key !== this.planKey) {
      this.planKey = key; this.prev.tipAng = null; this.prev.hornD = null; this.prev.streamAng = null; this.reflect = null;
      if (this.plan && (this.plan.done || this.plan.hitAt < this.time)) this.plan = null;
      this.parryMood = Math.random() < 0.65;
    }
    // lingering dangers that are not moves: burning ground, bombs in the air, the javelin, lava waves
    for (const f of b.groundFires || []) if (!f.out) this.dangers.push({ kind: 'circle', x: f.x, z: f.z, r: f.r * 0.9 + 0.6 });
    for (const h of b.hazards || []) {
      if (h.target && h.dur !== undefined && !h.done) {          // a lava bomb: its ring
        const left = h.dur - h.t;
        this.dangers.push({ kind: 'circle', x: h.target.x, z: h.target.z, r: 5.6, until: this.time + left + 0.1, land: left });
        if (left < 0.9 && hyp(P.x - h.target.x, P.z - h.target.z) < 5.0) this.wantRoll(left, 'bomb' + (h.target.x | 0), h.target, 'away');
      } else if (h.target && h.v0 && !h.stuck) {                // the thrown staff
        const land = h.T - h.t;
        this.dangers.push({ kind: 'circle', x: h.target.x, z: h.target.z, r: 6.4, until: this.time + land + 0.1, land });
        if (land < 1.2 && hyp(P.x - h.target.x, P.z - h.target.z) < 6) this.wantRoll(land, 'javelin', h.target, 'away');
      } else if (h.c && h.dur !== undefined && h.r !== undefined && h.hitSet && !h.hitSet.has('wave')) {   // a lava wave
        const d = hyp(P.x - h.c.x, P.z - h.c.z);
        if (d > h.r - 1) {
          // when will the crest reach him? r(f) = 3 + (max - 3)(1 - (1 - f)^1.6)
          const k = (d - 3) / (h.max - 3);
          if (k < 1) { const f = 1 - Math.pow(1 - k, 1 / 1.6); const tc = f * h.dur - h.t; if (tc > 0) this.wantRoll(tc, 'wave', h.c, 'away'); }
        }
      }
    }
    if (!m) return;
    const { name, def, at } = m;
    const t = m.t;
    const bx = b.pos.x, bz = b.pos.z;
    switch (name) {
      case 'sweep': {
        // the staff comes round low from his right: time it by the angle of the head of the staff around him
        const tip = b.staffTip, butt = b.staffButt;
        const ang = Math.atan2(tip.x - bx, tip.z - bz), mAng = Math.atan2(P.x - bx, P.z - bz);
        const rho = hyp(P.x - bx, P.z - bz);
        const reach = hyp(tip.x - bx, tip.z - bz) + 2;
        const [h0, h1] = def.hits[0];
        if (rho < reach + 1 && t > h0 - 0.1 && t < h1 + 0.05) {        // (the wind-up turns the staff the other way)
          let w = null;
          if (this.prev.tipAng !== null && dt > 0) w = wrap(ang - this.prev.tipAng) / dt;
          // how far the staff still has to turn to reach him (in its direction of travel)
          const dir = w !== null && Math.abs(w) > 0.6 ? Math.sign(w) : -1;    // right to left: his yaw grows toward his left
          let gap = wrap(mAng - ang) * dir; if (gap < -0.3) gap += TAU;
          const half = Math.atan2(2.2, Math.max(rho, 3));
          // only once the swing is really coming round (before that the angle says nothing about when)
          const ttc = w !== null && Math.abs(w) > 0.8 ? (gap - half) / Math.abs(w) : null;
          const low = Math.min(tip.y, butt.y) < 6;
          if (ttc !== null && (low || t > h0 - 0.05) && this.parried !== this.planKey) this.wantDodge(ttc, 'sweep', b.pos, 'side', true);
        }
        this.prev.tipAng = ang;
        break;
      }
      case 'slam': {
        // the line on the ground: keep out of it; once it is set, roll through the staff if still on it
        const f = b.lineDir(_a);
        const locked = !!at.lineLocked;
        this.dangers.push({ kind: 'line', x: bx, z: bz, dx: f.x, dz: f.z, from: 4, to: 64, w: locked ? 5.2 : 6.5, until: this.time + 4 });
        const px = P.x - bx, pz = P.z - bz, along = px * f.x + pz * f.z, lat = Math.abs(-px * f.z + pz * f.x);
        const staffT = def.hits[0][0] + 0.05;     // the staff can catch him from the start of its window
        if (t >= def.holdAt - 0.05 && !m.mv.holding) {
          if (along < 38 && lat < 3.4) this.wantRoll(this.until(m, staffT), 'slam', b.pos, 'side');
          // the eruption runs out along the line at 48 m/s from 10 m
          if (along > 6 && along < 62 && lat < 4.4) {
            const te = at.eruptAt !== undefined ? (at.eruptAt - t) / m.speed : this.until(m, def.eruptAt);
            this.wantRoll(te + Math.max(0, along - 10) / 48 - 0.02, 'erupt', null, 'line', f);
          }
        }
        break;
      }
      case 'palmL': case 'palmR': {
        const R = Math.max(4.2, b.hand[at.side].len * 1.35) + 0.9;
        const tg = at.target;
        if (tg && hyp(P.x - tg.x, P.z - tg.z) < R + 1.5) this.wantRoll(this.until(m, def.impactAt), 'palm', tg, 'side');
        break;
      }
      case 'grab': {
        const R = Math.max(3.6, b.hand.Left.len * 1.15) + 0.9;
        const tg = at.target;
        if (tg && hyp(P.x - tg.x, P.z - tg.z) < R + 1.5) this.wantRoll(this.until(m, def.catchAt), 'grab', tg, 'side');
        break;
      }
      case 'breath': this.perceiveBreath(m, dt); break;
      case 'stompL': case 'stompR': {
        const foot = b.bonePos(at.foot + 'Foot', _a);
        const d = hyp(P.x - foot.x, P.z - foot.z);
        if (t >= def.tellAt) {
          this.dangers.push({ kind: 'circle', x: foot.x, z: foot.z, r: 9, until: this.time + this.until(m, def.impactAt) + 0.05 });
          // close: roll in toward the hoof (the i-frames then cover the stamp and the lava ring leaving it)
          if (d < 9.5) this.wantRoll(this.until(m, def.impactAt), 'stomp', foot, 'toward');
          else if (d < 40) {
            const k = (d - 3) / 37, f = 1 - Math.pow(1 - k, 1 / 1.6);
            this.wantRoll(this.until(m, def.impactAt) + f * 1.9, 'wave', foot, 'away');
          }
        }
        break;
      }
      case 'horn': {
        // the head comes round low: time it by how fast the horns close on him
        const [h0, h1] = def.hits[0];
        if (t > h0 - 0.4 && t < h1) {
          const L = _a, R = _b;
          b.hornTips(L, R);
          const head = b.bonePos('Head', _c);
          const lo = _d.set(P.x, P.y + 0.35, P.z), hi = new THREE.Vector3(P.x, P.y + 1.25, P.z);
          const reach = b.headSize * 0.55 + 0.45;
          const dist = Math.min(segSeg(head, L, lo, hi).dist, segSeg(head, R, lo, hi).dist) - reach;
          let ttc = this.until(m, h0) + 0.15;
          if (this.prev.hornD !== null && dt > 0) {
            const v = (this.prev.hornD - dist) / dt;
            if (v > 2) ttc = dist / v;
            else if (t > h0 && dist > 8) ttc = 9;
          }
          if (dist < 14 || t < h0) this.wantDodge(ttc, 'horn', head, 'away', false);
          this.prev.hornD = dist;
        }
        break;
      }
      case 'throw': {
        const tg = at.target;
        if (tg) this.dangers.push({ kind: 'circle', x: tg.x, z: tg.z, r: 6.4, until: this.time + this.until(m, def.releaseAt) + 1.3 });
        break;
      }
      case 'meteor': break;
    }
  }

  /** 吐火: plan to stand in the sweep and fan it back; without the mana, keep out of the sweep. */
  perceiveBreath(m, dt) {
    const b = this.bull, M = this.monkey, P = M.pos, at = m.at;
    const bx = b.pos.x, bz = b.pos.z;
    const rho = hyp(P.x - bx, P.z - bz), mAng = Math.atan2(P.x - bx, P.z - bz);
    const canFan = M.mp >= M.T.fanCost + 0.5 && M.st > 12;
    // the fan needs room (far out, the stream narrow in the angle it sweeps): close in, step out of the sweep instead
    if (!this.reflect) this.reflect = { want: canFan && rho > 21.5, fired: false };
    const R = this.reflect;
    if (this.debugBreath && (!R.lastNote || this.time - R.lastNote > 0.4)) { R.lastNote = this.time; this.note(`breath t ${m.t.toFixed(2)} rho ${rho.toFixed(1)} rel ${wrap(mAng - b.yaw).toFixed(2)} want ${R.want} stream ${at.fireDir ? Math.atan2(at.fireDir.x, at.fireDir.z).toFixed(2) : '-'} st ${M.state}`); }
    if (!at.breathing || at.reflected) {
      if (at.reflected) { if (!R.counted) { R.counted = true; this.stats.reflects++; this.note('his fire blown back into his face'); } return; }
      return;                                    // drawing breath: the positioning is done in choose()
    }
    const s = Math.atan2(at.fireDir.x, at.fireDir.z);
    if (R.fired && !R.checked && M.a.move && M.a.move.name === 'fan' && M.a.move.t >= 0.42) {
      R.checked = true;
      const toB = Math.atan2(bx - P.x, bz - P.z);
      this.note(`fan release: yaw off ${wrap(M.yaw - toB).toFixed(2)} stream off ${wrap(mAng - s).toFixed(2)} rho ${rho.toFixed(1)}`);
    }
    let w = null;
    if (this.prev.streamAng !== null && dt > 0) w = wrap(s - this.prev.streamAng) / dt;
    this.prev.streamAng = s;
    const off = wrap(mAng - s);                   // where he stands relative to the stream
    const lat = rho * Math.sin(Math.abs(off));
    const near = b.legLen * 0.75;
    const inReach = rho * Math.cos(off) > near - 6 && rho < 56;
    // the fan, released 0.43 s after the press, must meet the stream inside ±0.35 rad and before it touches him (3.6 m)
    if (R.want && !R.fired && w !== null && Math.abs(w) > 0.1 && Math.sign(off) === Math.sign(w) && canFan) {
      const offAtRelease = Math.abs(off) - Math.abs(w) * 0.45;
      const hitOff = Math.asin(Math.min(1, 3.9 / Math.max(rho, 4)));
      if (offAtRelease < 0.27 && offAtRelease > hitOff - 0.03 && (M.canAct() || M.inCancelWindow())) {
        this.aim(bx - P.x, bz - P.z, 0.25);
        this.release('block');
        this.press('fan'); R.fired = true; this.stats.fans++;
        this.note(`fan into the fire (off ${off.toFixed(2)} w ${w.toFixed(2)})`);
      }
    }
    // the fan did not come in time: roll through the stream as it reaches him
    if (inReach && w !== null && Math.abs(w) > 0.1 && Math.sign(off) === Math.sign(w) && (!R.want || R.fired)) {
      const ttc = (lat - 3.6) / (Math.abs(w) * Math.max(rho, 4));
      if (!R.fired || ttc < 0.3) this.wantRoll(ttc + 0.05, 'fire', b.pos, 'out');
    }
  }

  /** A blow will land on him in `ttc` s unless he gets out of the way: roll (and parry when `parry` and sure). */
  wantDodge(ttc, why, from, how, parry = false) {
    if (parry && this.parryOk(why) && ttc < 0.6 && ttc > -0.02) {
      const p = this.plan;
      if (!p || (p.why === why && !p.done) || p.done) {
        if (!(p && p.done && p.why === why)) this.plan = { kind: 'parry', at: this.time + Math.max(0, ttc - 0.08), hitAt: this.time + ttc, why, from: from && from.clone(), how };
      }
      return;
    }
    this.wantRoll(ttc, why, from, how);
  }
  parryOk(why) {
    // parry the staff when the monkey is free to raise his rod and faces the blow's side; otherwise roll
    const M = this.monkey;
    if (why !== 'sweep' || !(this.parryMood || this.forceParry)) return false;
    return M.canAct() || (M.a.move && M.a.move.name === 'blockHit');
  }
  wantRoll(ttc, why, from, how, lineDir = null) {
    if (!(ttc > -0.05) || ttc > 3) return;
    // a roll already made covers this blow (its i-frames reach it): no second roll
    const hitAt = this.time + ttc;
    if (this.lastRoll && hitAt > this.lastRoll + IFRAME[0] && hitAt < this.lastRoll + IFRAME[1] - 0.02) return;
    const at = this.time + ttc - ROLL_LEAD + rand(-0.015, 0.015);
    if (this.plan && this.plan.why === why && Math.abs(this.plan.hitAt - (this.time + ttc)) < 0.2) { this.plan.at = Math.min(this.plan.at, at); this.plan.hitAt = this.time + ttc; return; }
    if (this.plan && !this.plan.done && this.plan.at < at) return;          // an earlier dodge comes first
    this.plan = { kind: 'roll', at, hitAt: this.time + ttc, why, from: from ? from.clone() : null, how, lineDir: lineDir && lineDir.clone() };
  }

  /** The roll's direction: the preferred one if it lands on rock and out of the danger zones, else the best other. */
  rollDir(plan) {
    const P = this.monkey.pos, b = this.bull;
    let want = null;
    const away = from => { const x = P.x - from.x, z = P.z - from.z, l = hyp(x, z) || 1; return [x / l, z / l]; };
    if (plan.how === 'line' && plan.lineDir) {
      const f = plan.lineDir, px = P.x - b.pos.x, pz = P.z - b.pos.z, side = Math.sign(-px * f.z + pz * f.x) || 1;
      want = [-f.z * side, f.x * side];
    } else if (plan.how === 'away' && plan.from) want = away(plan.from);
    else if (plan.how === 'toward' && plan.from) { const [x, z] = away(plan.from); want = [-x, -z]; }
    else if (plan.how === 'out' && plan.from) {
      // across the fire stream, away from where it is going
      const [ax, az] = away(plan.from); want = [-az, ax];
      const s = this.prev.streamAng;
      if (s !== null) { const mAng = Math.atan2(P.x - b.pos.x, P.z - b.pos.z); if (wrap(mAng - s) < 0) want = [az, -ax]; }
    } else if (plan.from) {
      // sideways across the blow, toward the side that keeps him close to his target
      const [ax, az] = away(plan.from);
      const side = this.sideToward();
      want = [-az * side, ax * side];
    } else want = [Math.sin(this.monkey.yaw), Math.cos(this.monkey.yaw)];
    const base = Math.atan2(want[0], want[1]);
    let best = null, bs = -Infinity;
    for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
      const a = base + da, x = Math.sin(a), z = Math.cos(a);
      let s = -Math.abs(da) * 1.2;
      const ex = P.x + x * ROLL_DIST, ez = P.z + z * ROLL_DIST, mx = P.x + x * 1.9, mz = P.z + z * 1.9;
      if (!this.inBounds(ex, ez, 1)) s -= 20;
      if (this.lava(ex, ez) > 0.2 || this.lava(mx, mz) > 0.45) s -= 30;
      for (let i = 0; i < 4; i++) { const a2 = i / 4 * TAU; if (this.lava(ex + Math.cos(a2) * 0.9, ez + Math.sin(a2) * 0.9) > 0.45) { s -= 8; break; } }
      if (this.solid(ex, ez, 0.2)) s -= 4;
      if (this.inDanger(ex, ez, 0.5)) s -= 6;
      if (s > bs) { bs = s; best = [x, z]; }
    }
    return best;
  }
  /** +1 / -1: which side of the blow the target lies on (a roll that way ends near the work). */
  sideToward() {
    const P = this.monkey.pos, g = this.goal;
    if (!g || !this.plan || !this.plan.from) return Math.random() < 0.5 ? 1 : -1;
    const f = this.plan.from, ax = P.x - f.x, az = P.z - f.z;
    const s = Math.sign((g.x - P.x) * -az + (g.z - P.z) * ax);
    return s || 1;
  }

  // ---------------------------------------------------------------------------------------------- choosing

  /** The weak point to work on now: { part, zone, pri } or null. */
  pickTarget() {
    const b = this.bull, M = this.monkey;
    if (!b || b.dead) return null;
    const zones = b.hurtZones() || [];
    const zone = part => zones.find(z => z.part === part);
    const W = b.weak || {};
    const cands = [];
    const P = M.pos;
    for (const part of ['handL', 'handR', 'kneeL', 'kneeR']) {
      const w = W[part], z = zone(part);
      if (!w || !w.active || !z) continue;
      const low = Math.min(z.a.y, z.b.y) - z.r < 2.1;            // the rod can reach it
      if (!low) continue;
      let pri = 0;
      if (part.startsWith('hand')) { if (!w.resting && !(b.atk?.name === 'slam' && b.atk.resting)) continue; pri += 6; }     // (a palm on the ground, or both hands on the staff after the slam)
      if (!w.broken) pri += 3 + (1 - w.hp / w.max) * 6;          // finish what is cracked (two broken bring him down)
      if (w.exposedT > 0) pri += 1.5;
      const d = hyp(z.b.x - P.x, z.b.z - P.z);
      pri -= d * 0.18;
      if (this.target && this.target.part === part) pri += 1.5;   // stay on it
      if ((this.blocked?.[part] || 0) > this.time) pri -= 8;      // could not get there a moment ago
      cands.push({ part, zone: z, pri, w });
    }
    // (his staff lying after the opening blow is no longer a target: 2026-11-17 user wants the bull himself hit)
    cands.sort((p, q) => q.pri - p.pri);
    return cands[0] || null;
  }

  /** Lowest point of a zone's axis, and the horizontal radius of the zone at the rod's height there. */
  zoneFoot(z) {
    const lo = z.a.y < z.b.y ? z.a : z.b, hi = lo === z.a ? z.b : z.a;
    // walk up from the low end until the axis is at ~1.3 m (where the rod sweeps)
    const p = _c.copy(lo);
    const dy = hi.y - lo.y;
    if (lo.y < 1.3 && dy > 1e-3) p.lerpVectors(lo, hi, clamp((1.3 - lo.y) / dy, 0, 1));
    const rr = Math.sqrt(Math.max(0, z.r * z.r - Math.max(0, p.y - 1.4) ** 2));
    return { x: p.x, z: p.z, y: p.y, rr };
  }

  /** Where to stand to work zone z: beside it, out of his body and the lava, not right in front of him. */
  spotFor(z) {
    const b = this.bull, P = this.monkey.pos;
    const f = this.zoneFoot(z);
    let best = null, bs = Infinity;
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * TAU;
      for (const extra of [REACH - 0.25, REACH + 0.2]) {
        const r = f.rr + extra;
        const x = f.x + Math.sin(a) * r, zz = f.z + Math.cos(a) * r;
        if (!this.standable(x, zz)) continue;
        if (this.inDanger(x, zz, 0)) continue;
        let s = hyp(x - P.x, zz - P.z) * 0.6;
        // a spot across lava (the crack his staff opened lies between them now that he faces the monkey squarely) is
        // a long way round: take the near side of the work when there is one
        if (!this.clearLine(P.x, P.z, x, zz)) s += 14;
        if (b.phase === 1) {
          const rel = Math.abs(b.relAngle({ x, z: zz }));
          if (rel < 0.55) s += 9;                  // he grabs what lingers in front of him
          if (rel < 0.95) s += 2;                  // and the slam's line cannot turn past ±1 rad
        }
        // nearer to his centre = more of his moves reach; a little farther out is calmer
        const db = hyp(x - b.pos.x, zz - b.pos.z);
        s += Math.max(0, 9 - db) * 0.4;
        if (this.goal && this.goalWhy === 'work' && hyp(x - this.goal.x, zz - this.goal.z) < 0.8) s -= 1.5;    // keep the spot
        if (s < bs) { bs = s; best = { x, z: zz }; }
      }
    }
    return best;
  }

  /** In range of zone z right now (the rod, swung from where he stands, reaches its surface)? */
  inRange(z) {
    const P = this.monkey.pos;
    const lo = _a.set(P.x, P.y + 0.4, P.z), hi = _b.set(P.x, P.y + 2.1, P.z);
    const d = segSeg(lo, hi, z.a, z.b).dist - z.r;
    return d < REACH + 0.25;
  }

  /** Seconds before something lands that he must be free to dodge (Infinity when nothing is coming). */
  freeTime() {
    let t = Infinity;
    if (this.plan && !this.plan.done) t = Math.min(t, this.plan.at - this.time);
    const m = this.move(), b = this.bull;
    if (m) {
      // a move whose blow does not need a dodge where he stands still makes him wary while it is in the air
      const end = m.def.impactAt ?? m.def.catchAt ?? (m.def.hits && m.def.hits[0][1]) ?? (m.def.breath && m.def.breath[1]) ?? m.def.releaseAt;
      if (end !== undefined && m.t < end && !(m.def.restAt !== undefined && m.t >= m.def.restAt)) t = Math.min(t, Math.max(0.6, this.until(m, end)));
    } else if (b.state === 'idle') {
      // he is between moves: a tell will come, and every move gives at least a second
      t = Math.min(t, 1.0);
    }
    return t;
  }

  // ---------------------------------------------------------------------------------------------- acting

  update(dt) {
    const G = this.G, M = this.monkey, b = this.bull;
    if (!this.active || dt <= 0) return;
    this.time += dt;
    this.stats.t += dt;
    // what he did to us / we did to him (for the tests and the report)
    if (this.lastBullHp !== null && b.hp < this.lastBullHp && b.phase >= 1) {
      this.stats.dmgDealt += this.lastBullHp - b.hp;
      if (this.time - this.lastPress < 0.7) this.stats.landed = (this.stats.landed || 0) + 1;
    }
    if (this.lastMonkeyHp !== null && M.hp < this.lastMonkeyHp) {
      this.stats.dmgTaken += this.lastMonkeyHp - M.hp;
      let extra = '';
      if (b.atk && b.atk.name === 'sweep') {
        _a.set(M.pos.x, M.pos.y + 0.8, M.pos.z); segSeg(b.staffButt, b.staffTip, _a, _a, _b, _c);
        const toS = Math.atan2(_b.x - M.pos.x, _b.z - M.pos.z);
        extra = ` yaw-off ${wrap(toS - M.yaw).toFixed(2)} staffY ${_b.y.toFixed(1)} parryAgo ${(M.time - M.parryT).toFixed(2)} st ${M.a.move ? M.a.move.name : M.state}`;
      }
      const lv = this.lava(M.pos.x, M.pos.z);
      if (lv > 0.5) { this.stats.burn = (this.stats.burn || 0) + (this.lastMonkeyHp - M.hp); if (!this.burnNoteT || this.time - this.burnNoteT > 1) { this.burnNoteT = this.time; this.note(`burning at (${M.pos.x.toFixed(1)}, ${M.pos.z.toFixed(1)}) ${M.state} goal ${this.goalWhy}`); } }
      else this.note(`hurt ${(this.lastMonkeyHp - M.hp).toFixed(0)} (${b.atk ? b.atk.name : b.state})${extra}`);
    }
    this.lastBullHp = b.hp; this.lastMonkeyHp = M.hp;
    if (M.dead && !this.deadNoted) { this.deadNoted = true; this.stats.deaths++; this.note(`died at (${M.pos.x.toFixed(1)}, ${M.pos.z.toFixed(1)}) lava ${this.lava(M.pos.x, M.pos.z).toFixed(2)} ${b.atk ? b.atk.name : b.state}`); }
    if (!M.dead) this.deadNoted = false;
    if (M.dead || b.dead || M.state === 'held') { this.releaseAll(); return; }

    if (M.giant) { this.duel(dt); return; }      // 法相天地: a different, simpler fight

    this.perceive(dt);
    const free = M.canAct() || M.inCancelWindow();

    // 1. the dodge, when its moment comes
    const p = this.plan;
    if (p && !p.done && p.kind === 'parry' && this.time >= p.at - 0.3 && this.time < p.at && M.canAct()) {
      // turn the rod toward the side the staff comes from (a guard only stops what it faces)
      _a.set(M.pos.x, M.pos.y + 0.8, M.pos.z);
      segSeg(b.staffButt, b.staffTip, _a, _a, _b, _c);          // _b: the point of the staff nearest to him
      const fx = _b.x - M.pos.x, fz = _b.z - M.pos.z, bx = b.pos.x - M.pos.x, bz = b.pos.z - M.pos.z;
      const l1 = hyp(fx, fz) || 1, l2 = hyp(bx, bz) || 1;
      this.aim(fx / l1 + bx / l2 * 0.6, fz / l1 + bz / l2 * 0.6, 0.3);
      this.run = false;
      return;
    }
    if (p && !p.done && this.time >= p.at) {
      if (p.kind === 'parry') {
        if (M.canAct()) {
          this.release('heavy'); this.heavy = null;
          const from = p.from || b.pos;
          this.aim(from.x - M.pos.x, from.z - M.pos.z, 0.15);
          this.press('block'); this.parryRelease = this.time + 0.12; this.stats.parries++; this.parried = this.planKey;
          p.done = true; this.lastDodge = this.time;
          this.note(`parry ${p.why}`);
        } else if (this.time > p.at + 0.06) { p.kind = 'roll'; }
      } else if (free && M.st > 2) {
        if (this.heavy) { this.release('heavy'); this.heavy = null; }
        this.release('block');
        const d = this.rollDir(p);
        this.aim(d[0], d[1], 1);
        this.press('roll');
        p.done = true; this.lastDodge = this.time; this.lastRoll = this.time; this.stats.rolls++;
        this.note(`roll ${p.why} (${(p.hitAt - this.time).toFixed(2)} before)`);
        this.mag = 1; this.dir.set(d[0], 0, d[1]);
        return;
      } else if (this.time > p.hitAt + 0.1) p.done = true;
    }
    if (this.parryRelease && this.time >= this.parryRelease) { this.release('block'); this.parryRelease = 0; }

    // 2. a charged smash in progress: let it go when charged enough (or when a dodge is near)
    if (this.heavy) {
      const charged = M.charge >= this.heavy.charge || this.time >= this.heavy.until || this.freeTime() < 0.75;
      this.aimAtTarget(0.25);
      if (charged || !(M.a.move && M.a.move.name === 'heavy')) { this.release('heavy'); this.heavy = null; this.note(`smash (charge ${M.charge.toFixed(2)})`); }
      return;
    }

    // 3. the execution
    if (b.state === 'down') { this.goCrit(dt, free); return; }
    this.downSeen = false;

    // 4. standing in lava (pushed by a hoof, a roll that ended badly): out of it before anything else
    if (this.lava(M.pos.x, M.pos.z) > 0.3) { this.leaveLava(dt, free); return; }
    // 5. what to do now
    this.choose(dt, free);
  }

  /**
   * The duel of the giants: walk up to him, hit him; guard his sweep (the rod raised toward him just before it lands),
   * step out from under his overhead blow.
   */
  duel(dt) {
    const M = this.monkey, b = this.bull;
    const dx = b.pos.x - M.pos.x, dz = b.pos.z - M.pos.z, d = hyp(dx, dz) || 1;
    const at = b.state === 'attack' ? b.atk : null, mv = b.a && b.a.move, t = mv ? mv.t : 0;
    const free = M.canAct() || M.inCancelWindow();
    this.run = false;
    const dodge = (x, z, why, key) => {
      if (this.duelRolled === key || !(free || M.state === 'attack') || M.st <= 2) return false;
      this.duelRolled = key;
      if (this.duelGuard) { this.duelGuard = false; this.release('block'); }
      this.aim(x, z, 1); this.G.input.release('roll'); this.press('roll'); this.stats.rolls++; this.lastRoll = this.time;      // (released first: two steps in a row are two presses)
      this.note(why);
      return true;
    };
    // what the ground and the sky are doing (they outlive the blow that made them)
    for (const h of b.hazards || []) {
      if (h.duel && h.hitSet && h.t > 0.3 && !h.hitSet.has('wave')) {           // 震地's ring of fire: step through it as it arrives
        const cr = hyp(M.pos.x - h.c.x, M.pos.z - h.c.z), gap = cr - h.r;
        if (gap > -4 && gap < 13 && dodge(dx / d, dz / d, 'step through the wave', h)) return;
      } else if (h.k > 1 && h.target && !h.done) {                  // 火雨: out of the ring that is about to land
        const mx = M.pos.x - h.target.x, mz = M.pos.z - h.target.z, md = hyp(mx, mz) || 1, left = h.dur - h.t;
        if (md < 4.2 * h.k + 4 && left < 1.3) {
          if (left < 0.5 && dodge(mx / md, mz / md, 'step out of the fire', h)) return;
          if (this.duelGuard) { this.duelGuard = false; this.release('block'); }
          this.aim(mx / md, mz / md, 1); return;
        }
      }
    }
    if (at && mv && (at.name === 'sweep2' || at.name === 'combo2')) {
      const hs = at.def.hits;
      if (t > hs[0][0] - 0.4 && t < hs[hs.length - 1][1] + 0.05) {
        if (!this.duelGuard) { this.duelGuard = true; this.stats.parries++; this.note('guard ' + at.name); }
        this.aim(dx / d, dz / d, 0.12); this.hold('block');
        return;
      }
    }
    if (this.duelGuard) { this.duelGuard = false; this.release('block'); }
    if (at && mv && (at.name === 'slam2' || at.name === 'quake') && !at.fired.has('impact') && t > at.def.impactAt - 0.34 && dodge(-dz / d, dx / d, 'step out of slam2', at)) return;
    if (at && mv && (at.name === 'stompL' || at.name === 'stompR') && !at.fired.has('impact') && d < 26 && t > at.def.impactAt - 0.5 && dodge(-dx / d, -dz / d, 'step back from the hoof', at)) return;
    if (at && mv && at.name === 'charge' && t >= at.def.runAt - 0.1 && !at.stopped && !at.hit.has('c') && (d - 17) / 56 < 0.3 && dodge(-dz / d, dx / d, 'step out of the charge', at)) return;
    // 锤地's burning ground: out of it, away from its middle (and the fan, if it is to hand, puts it out)
    for (const f of b.groundFires || []) {
      if (f.out || f.r < 12) continue;
      const fx = M.pos.x - f.x, fz = M.pos.z - f.z, fd = hyp(fx, fz) || 1;
      if (fd < f.r * 0.95) { this.aim(fx / fd, fz / fd, 1); this.note('out of the burning ground'); return; }
    }
    // 现真身: the fire he wears is blown out with the fan before the rod goes back to work
    if (b.armored && free && M.mp >= M.T.fanCost && d < 60 && this.time - (this.lastFan || -9) > 1.5) {
      this.lastFan = this.time; this.aim(dx / d, dz / d, 0.12); this.press('fan'); this.stats.fans++; this.note('fan: blow his fire out'); return;
    }
    // 金身: a blow on the gold only throws him back - and the white bull comes the moment it fades: get away, square on
    if (b.goldT > 0) { if (d < 70) this.aim(-dx / d, -dz / d, 1); else this.aim(dx / d, dz / d, 0); this.note('gold: keep off'); return; }
    if (d > 25) { this.aim(dx / d, dz / d, 1); return; }
    this.aim(dx / d, dz / d, 0.12);
    if (free && M.st > 16 && this.time - this.lastPress > 0.34) {
      this.press('light'); this.release('light'); this.stats.lights++; this.lastPress = this.time;
    }
  }

  goCrit(dt, free) {
    const M = this.monkey, b = this.bull;
    if (!this.downSeen) { this.downSeen = true; this.note('he is down'); }
    if (M.canExecute && M.canExecute(b) && free) {
      this.aim(0, 0, 0); this.stick.x = this.stick.y = 0;
      this.press('light'); this.stats.crits++;
      this.note('牵牛鼻子');
      return;
    }
    const anchor = b.critAnchor ? b.critAnchor() : null;
    const g = anchor ? anchor.pos : b.noseRing(new THREE.Vector3());
    this.setGoal(g.x, g.z, 'crit');
    this.steer(dt, 0.6, true);
  }

  choose(dt, free) {
    const M = this.monkey, b = this.bull, P = M.pos;
    const m = this.move();
    // breath: stand in the sweep, far enough out, facing him (perceiveBreath presses the fan)
    if (m && m.name === 'breath' && !m.at.reflected) {
      const R = this.reflect;
      if (R && R.want && !R.fired) {
        const rho = hyp(P.x - b.pos.x, P.z - b.pos.z);
        // far enough out that no weak point is within the fan's pull (14 m): the gust then goes where the stick says
        const wantR = clamp(rho, 27, 33);
        const a = Math.atan2(P.x - b.pos.x, P.z - b.pos.z);
        const rel = clamp(wrap(a - b.yaw), -0.55, 0.55);        // inside the sweep (about ±50° around his front)
        const gx = b.pos.x + Math.sin(b.yaw + rel) * wantR, gz = b.pos.z + Math.cos(b.yaw + rel) * wantR;
        if (m.t < m.def.breath[0] - 0.2) { this.setGoal(gx, gz, 'reflect'); this.steer(dt, 0.8, true); }
        else { this.run = false; this.mag = 0.22; this.dir.set(b.pos.x - P.x, 0, b.pos.z - P.z).normalize(); this.applyStick(); }    // face him, a slow step in
        return;
      }
      // no mana: get out of the sweep, to his side
      const a = Math.atan2(P.x - b.pos.x, P.z - b.pos.z), rel = wrap(a - b.yaw);
      // (the stream swings about ±67° round his front and is ~±13° wide: out past ~85°)
      const side = Math.sign(rel) || 1, ga = b.yaw + side * 1.55, r = clamp(hyp(P.x - b.pos.x, P.z - b.pos.z), 13, 19);
      this.setGoal(b.pos.x + Math.sin(ga) * r, b.pos.z + Math.cos(ga) * r, 'evade');
      this.steer(dt, 0.6, true);
      return;
    }
    // inside a danger zone: walk out of it (the shortest way to standable ground outside)
    const dz = this.inDanger(P.x, P.z, 0);
    if (dz) {
      const out = this.exitFrom(dz);
      if (out) { this.setGoal(out.x, out.z, 'evade'); this.steer(dt, 0.3, true); return; }
    }
    // the work: a weak point, from a spot beside it
    if (!this.target || this.time - this.targetT > 0.6 || !this.validTarget(this.target)) { this.target = this.pickTarget(); this.targetT = this.time; }
    const T = this.target;
    if (!T) {
      this.dbg = { part: null, why: 'wait' };
      // nothing to hit (his hands high, standing far off): wait at a calm distance, out of the lava
      const spot = this.waitSpot();
      if (spot) { this.setGoal(spot.x, spot.z, 'wait'); this.steer(dt, 0.8, false); } else this.stop(dt);
      return;
    }
    const z = T.zone;
    const inR = this.inRange(z);
    const ft = this.freeTime();
    this.dbg = { part: T.part, inR, ft: +ft.toFixed(2), goal: this.goal && [+this.goal.x.toFixed(1), +this.goal.z.toFixed(1)], why: this.goalWhy };
    if (inR) {
      this.stop(dt);
      if (free) this.attack(z, T, ft);
      return;
    }
    if (!this.goal || this.goalWhy !== 'work' || this.time - this.goalT > 0.45 || this.inDanger(this.goal.x, this.goal.z) || !this.standable(this.goal.x, this.goal.z)) {
      const s = this.spotFor(z);
      if (s) this.setGoal(s.x, s.z, 'work');
    }
    if (this.goal) {
      // no closer for 3.5 s (lava, his feet in the way): try the other weak point for a while
      const dg = hyp(this.goal.x - P.x, this.goal.z - P.z);
      if (!this.prog || this.prog.part !== T.part || dg < this.prog.best - 1) this.prog = { part: T.part, best: dg, t: this.time };
      else if (this.time - this.prog.t > 3.5) { (this.blocked || (this.blocked = {}))[T.part] = this.time + 6; this.prog = null; this.target = null; this.note(`no way to ${T.part}`); }
      this.steer(dt, 0.35, ft > 1.2 && dg > 9);
    }
  }

  validTarget(T) {
    if (T.part === 'staff') return this.bull.phase === 1 && T.zone.r > 0;
    const w = this.bull.weak?.[T.part];
    if (!w || !w.active) return false;
    if (T.part.startsWith('hand') && !w.resting) return false;
    return true;
  }

  attack(z, T, ft) {
    if (this.bull.goldT > 0) return;          // (金身: the blow would only rebound)
    const M = this.monkey;
    const mv = M.a.move, name = mv ? mv.name : null;
    if (this.time - this.lastPress < 0.08) return;
    const st = M.st;
    // the fan on a fresh crack when there is mana to spare (it leaves the crack exposed: the next blows hurt more)
    if (!name && ft > 2.4 && M.mp > 78 && T.w && !T.w.broken && T.w.exposedT <= 0 && st > 40 && Math.random() < 0.5 && this.time - (this.lastFan || -9) > 6) {
      this.aimAtZone(z, 0.25); this.press('fan'); this.lastFan = this.time; this.stats.fans++; this.note(`fan ${T.part}`); this.afterFan = true; return;
    }
    // the iron staff smash is what cracks the lava: charged when he gives a long opening (always after the fan),
    // a quick smash in a shorter one; the light string fills the gaps
    const smash = !name && st > 34 && (ft > 1.9 || (this.afterFan && ft > 1.5) || (ft > 1.25 && (this.coin ?? 0.5) < 0.6));
    if (smash) {
      const hold = ft > 1.9 || this.afterFan ? clamp(ft - 1.0, 0.35, 1.0) : 0;
      this.aimAtZone(z, 0.25);
      this.hold('heavy'); this.lastPress = this.time;
      this.heavy = { until: this.time + 0.34 + hold, charge: hold >= 0.99 ? 0.999 : Math.max(0.01, hold) };
      this.afterFan = false; this.stats.heavies++;
      this.note(`charge ${T.part} (free ${ft.toFixed(1)})`);
      return;
    }
    // the staff string: light, light, light — never into the long finisher unless he gives the time
    const nextCancel = !name ? 0.33 : name === 'light1' ? 0.33 : name === 'light2' ? 0.46 : 1.02;
    if (ft < nextCancel + 0.2) return;
    if (st < 26) return;                                 // keep a roll's worth
    if (name === 'light3' && ft < 1.5) return;
    if (name && !M.inCancelWindow()) return;
    this.aimAtZone(z, 0.25);
    this.press('light'); this.release('light'); this.stats.lights++;
    this.afterFan = false;
  }

  aimAtZone(z, m) { const f = this.zoneFoot(z), P = this.monkey.pos; this.aim(f.x - P.x, f.z - P.z, m); }
  aimAtTarget(m) { if (this.target) this.aimAtZone(this.target.zone, m); }

  /** In the lava: straight for the nearest rock — a roll when it is within one (the roll's i-frames do not burn). */
  leaveLava(dt, free) {
    const M = this.monkey, P = M.pos;
    let best = null;
    for (let r = 0.5; r <= 8 && !best; r += 0.5) {
      let bl = Infinity;
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * TAU, x = P.x + Math.sin(a) * r, z = P.z + Math.cos(a) * r;
        const l = this.lava(x, z);
        if (l < 0.12 && !this.solid(x, z, 0.3) && this.inBounds(x, z, 1) && l < bl) { bl = l; best = { x, z, r, a }; }
      }
    }
    if (!best) { this.stop(dt); return; }
    if (free && best.r < ROLL_DIST + 0.3 && M.st > 16 && this.time - (this.lastRoll || -9) > 0.5) {
      this.aim(Math.sin(best.a), Math.cos(best.a), 1); this.press('roll'); this.lastRoll = this.time; this.stats.rolls++;
      this.note('roll out of the lava'); return;
    }
    this.dir.set(Math.sin(best.a), 0, Math.cos(best.a)); this.mag = 1; this.applyStick(); this.run = M.st > 5;
  }

  /** The nearest standable point out of a danger zone. */
  exitFrom(d) {
    const P = this.monkey.pos;
    let best = null, bs = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      for (const r of [2, 3.5, 5, 7, 9]) {
        const x = P.x + Math.sin(a) * r, z = P.z + Math.cos(a) * r;
        if (!this.standable(x, z) || this.inDanger(x, z, 0)) continue;
        const s = r + (this.goal ? hyp(x - this.goal.x, z - this.goal.z) * 0.15 : 0);
        if (s < bs) { bs = s; best = { x, z }; }
        break;
      }
    }
    void d;
    return best;
  }

  /** A calm place to wait: ~20 m from him, to the side, on rock. */
  waitSpot() {
    const b = this.bull, P = this.monkey.pos;
    let best = null, bs = Infinity;
    for (let i = 0; i < 24; i++) {
      const a = b.yaw + (i / 24 - 0.5) * 2.6;
      for (const r of [14, 18, 22]) {
        const x = b.pos.x + Math.sin(a) * r, z = b.pos.z + Math.cos(a) * r;
        if (!this.standable(x, z) || this.inDanger(x, z)) continue;
        const s = hyp(x - P.x, z - P.z) + Math.abs(r - 18) * 0.3;
        if (s < bs) { bs = s; best = { x, z }; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------- the way round the lava

  /** Walkable cells (1 m) of the field for the current arena phase: rock, not lava, not a pillar. Built once a phase. */
  navGrid() {
    const phase = this.G.arenaPhase ?? 1;
    if (this.nav && this.nav.phase === phase) return this.nav;
    const b = this.arena.bounds || { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
    const x0 = Math.floor(b.minX), z0 = Math.floor(b.minZ), nx = Math.ceil(b.maxX) - x0 + 1, nz = Math.ceil(b.maxZ) - z0 + 1;
    const ok = new Uint8Array(nx * nz), gy = new Float32Array(nx * nz);
    const cols = (this.arena.colliders || []).filter(c => !c.staff);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i, z = z0 + j, k = j * nx + i;
      gy[k] = this.arena.groundY ? this.arena.groundY(x, z) || 0 : 0;
      if (!this.inBounds(x, z, 1.2) || this.lava(x, z) > 0.22) continue;
      let hit = false;
      for (const c of cols) if (hyp(x - c.x, z - c.z) < c.r + 0.45) { hit = true; break; }
      if (!hit) ok[k] = 1;
    }
    this.nav = { phase, x0, z0, nx, nz, ok, gy, dist: new Int32Array(nx * nz), goalK: -1, builtT: -9 };
    return this.nav;
  }
  cell(N, x, z) { const i = Math.round(x - N.x0), j = Math.round(z - N.z0); return i < 0 || j < 0 || i >= N.nx || j >= N.nz ? -1 : j * N.nx + i; }
  /** A straight walk from (x0, z0) to (x1, z1) crosses no lava / pillar? */
  clearLine(x0, z0, x1, z1) {
    const L = hyp(x1 - x0, z1 - z0), n = Math.ceil(L / 0.5);
    const b = this.bull, body = b && !b.dead && b.colliders ? (b.colliders() || []).filter(c => c.r > 0 && !c.staff) : [];
    for (let i = 1; i <= n; i++) {
      const f = i / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
      if (this.lava(x, z) > 0.2) return false;
      // a little to either side too: he does not walk a tightrope along the lava's edge
      const L1 = L || 1, nx = -(z1 - z0) / L1 * 0.45, nz = (x1 - x0) / L1 * 0.45;
      if (this.lava(x + nx, z + nz) > 0.4 || this.lava(x - nx, z - nz) > 0.4) return false;
      for (const c of this.arena.colliders || []) if (hyp(x - c.x, z - c.z) < c.r + 0.3) return false;
      for (const c of body) if (hyp(x - c.x, z - c.z) < c.r + 0.3) return false;
    }
    return true;
  }
  /** The next point to walk to on the way to (gx, gz): the goal itself when the way is clear, else along the grid. */
  waypoint(gx, gz) {
    const P = this.monkey.pos;
    if (this.clearLine(P.x, P.z, gx, gz)) return { x: gx, z: gz };
    const N = this.navGrid();
    const gk = this.cell(N, gx, gz), mk = this.cell(N, P.x, P.z);
    if (gk < 0 || mk < 0) return { x: gx, z: gz };
    if (N.goalK !== gk || this.time - N.builtT > 0.5) {
      // breadth-first distance from the goal over walkable cells (8-connected; no big steps)
      const D = N.dist; D.fill(-1);
      // his feet / knees / hands on the ground block the way as well (they move: taken at the time of the search)
      const b = this.bull, body = [];
      if (b && !b.dead && b.colliders) for (const c of b.colliders() || []) if (c.r > 0 && !c.staff) body.push({ x: c.x, z: c.z, rr: (c.r + 0.5) ** 2 });
      const q = new Int32Array(N.nx * N.nz); let h = 0, t = 0;
      D[gk] = 0; q[t++] = gk;
      while (h < t) {
        const k = q[h++], i = k % N.nx, j = (k - i) / N.nx;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= N.nx || jj >= N.nz) continue;
          const kk = jj * N.nx + ii;
          if (D[kk] >= 0 || !N.ok[kk] || Math.abs(N.gy[kk] - N.gy[k]) > 1.8) continue;
          if (body.length) { const x = N.x0 + ii, z = N.z0 + jj; let hit = false; for (const c of body) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.rr) { hit = true; break; } if (hit) continue; }
          D[kk] = D[k] + 1; q[t++] = kk;
        }
      }
      N.goalK = gk; N.builtT = this.time;
    }
    const D = N.dist;
    // from his cell, downhill toward the goal; aim at the farthest cell on that way he can walk to straight
    let k = mk;
    if (D[k] < 0) {   // standing on a cell the grid does not like (an edge): the nearest one it does
      let best = -1, bd = Infinity;
      for (let r = 1; r <= 3 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const kk = k + dj * N.nx + di; if (kk >= 0 && kk < D.length && D[kk] >= 0 && D[kk] < bd) { bd = D[kk]; best = kk; }
      }
      if (best < 0) return { x: gx, z: gz };
      k = best;
    }
    let wp = k;
    for (let s = 0; s < 10 && D[k] > 0; s++) {
      const i = k % N.nx, j = (k - i) / N.nx;
      let nk = k;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N.nx || jj >= N.nz) continue;
        const kk = jj * N.nx + ii;
        if (D[kk] >= 0 && D[kk] < D[nk]) nk = kk;
      }
      if (nk === k) break;
      k = nk;
      const x = N.x0 + (k % N.nx), z = N.z0 + Math.floor(k / N.nx);
      if (this.clearLine(P.x, P.z, x, z)) wp = k; else if (s > 2) break;
    }
    return { x: N.x0 + (wp % N.nx), z: N.z0 + Math.floor(wp / N.nx) };
  }

  // ---------------------------------------------------------------------------------------------- moving

  setGoal(x, z, why) {
    if (!this.goal || this.goalWhy !== why || hyp(x - this.goal.x, z - this.goal.z) > 0.3) this.goalT = this.time;
    this.goal = { x, z }; this.goalWhy = why;
  }
  stop(dt) {
    this.mag += (0 - this.mag) * (1 - Math.exp(-14 * dt));
    if (this.mag < 0.05) this.mag = 0;
    this.applyStick();
    this.run = false;
    this.moving = false;
  }
  applyStick() { this.aim(this.dir.x, this.dir.z, this.mag); }

  /** Walk / run to the goal, round lava, bodies and danger zones; stop within `tol`. */
  steer(dt, tol, allowRun) {
    const M = this.monkey, P = M.pos, g = this.goal;
    if (!g) { this.stop(dt); return; }
    const d = hyp(g.x - P.x, g.z - P.z);
    // hysteresis: stop inside tol, start again only past tol + 0.6
    if (d < tol || (!this.moving && d < tol + 0.6)) { this.stop(dt); return; }
    this.moving = true;
    const w = this.waypoint(g.x, g.z);
    const base = Math.atan2(w.x - P.x, w.z - P.z);
    let pick = base, bs = -Infinity;
    for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4]) {
      const a = base + da;
      let s = -Math.abs(da) * 2;
      for (const k of [0.8, 1.8, 3.0]) {
        if (k > d + 0.5) break;
        const x = P.x + Math.sin(a) * k, z = P.z + Math.cos(a) * k;
        if (this.lava(x, z) > 0.3) { s -= 12 / k; }
        if (this.solid(x, z, 0.35)) s -= 6 / k;
        if (this.inDanger(x, z, 0) && !this.inDanger(P.x, P.z, 0)) s -= 5 / k;
        if (!this.inBounds(x, z, 1)) s -= 10;
      }
      if (s > bs) { bs = s; pick = a; }
      if (s > -0.01) break;
    }
    // turn the stick smoothly (a thumb, not a switch)
    const cur = Math.atan2(this.dir.x, this.dir.z);
    const turn = clamp(wrap(pick - cur), -9 * dt, 9 * dt);
    const na = this.mag < 0.1 ? pick : cur + turn;
    this.dir.set(Math.sin(na), 0, Math.cos(na));
    const want = d > 2.2 ? 1 : 0.55;
    this.mag += (want - this.mag) * (1 - Math.exp(-10 * dt));
    this.applyStick();
    this.run = !!allowRun && d > 7 && M.st > 55 && this.freeTime() > 1.4;
  }
}
