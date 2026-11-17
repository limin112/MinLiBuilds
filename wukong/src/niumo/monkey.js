// 孙悟空, five hundred years after the Mountain of Five Elements: movement, stamina, mana, the iron staff (three-hit
// combo + spinning finisher, charged smash, running leap), guard and parry, rolls with i-frames, the banana-leaf fan,
// the 牵牛鼻子 execution, hit reactions, being caught in a giant's fist, ledges, lava, death.
//
// Contract (docs/niumo_architecture.md §3):
//   new Monkey({ actor, fx, audio, cam, input, arena, staff })
//   pos, yaw, hp, st, mp, dead, state, events;  update(dt, boss);  takeHit({ dmg, from, kind, blockable }) -> true |
//   'block' | 'parry' | false;  reset(spawn)
// Also: maxHp / maxSt / maxMp, charge (0..1), lockTarget ({ part, pos } - the weak point his attacks go for),
//   canExecute(boss), grab(handFn) / release({ dmg, vel, slam }) for the giant's grab, setCarry(on), god.
// Events (monkey.events, drained by main): hit {hitstop, heavy, part, full}, hurt {kind, hitstop}, block, parry,
//   guardbreak, critical {point}, dead, fan {origin, dir, range, angle, parts}, impact {point, strength},
//   charge-full, burn, grabbed, landed.
// What the boss sees (all optional except the contract): hurtZones(), lockTargets() (entries with open === false are
//   skipped), takeHit({ ..., part, charge, full, kind }), criticalOpen(monkey), takeCritical({ dmg, point, dir, from }),
//   noseRing() / critAnchor() (the ring the execution seizes; else the head target), fanned({ from, dir, range, angle })
//   (blows his fire back, puts out burning ground, exposes cracks; else onFan(...) and a light takeHit per weak point),
//   colliders() -> [{ x, z, r }] (else his hurt zones are solid), onGrabbed / onReleased hooks are ours: a takeHit with
//   kind 'grab' puts the monkey in his fist (state 'held': the boss moves monkey.pos), boss calls monkey.onReleased(boss,
//   { slam }) to drop him. The boss draws the staff's hit sparks itself unless boss.hitFx === false.
// The arena: bounds, colliders, groundY(x, z), lavaAt(x, z), and optionally fanGust(origin, dir, range, angle), shake(k).
import * as THREE from 'three';
import { ease, PoseTrack } from '../pose.js';
import { clampToArena, yawLerp, segSeg } from '../combat.js';
import { loadCharacter, loadBlade, loadGLTF } from '../assets.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Actor } from '../actor.js';
import { applyLook, LOOK_PRESETS } from '../look.js';
import { MONKEY, MONKEY_HOLD, MONKEY_STANCE, MONKEY_BLOCK, MONKEY_CARRY, COMBO, ATTACKS } from './moves_monkey.js';

export { MONKEY, MONKEY_HOLD };

const DEG = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _UP = new THREE.Vector3(0, 1, 0);

export const MONKEY_TUNING = {
  height: 1.5, radius: 0.32,
  maxHp: 100, maxSt: 100, maxMp: 100,
  walkSpeed: 1.7, runSpeed: 4.3, sprintSpeed: 6.7, sprintCost: 12,
  stRegen: 70, stDelay: 0.35, stDelayEmpty: 0.8,
  mpRegen: 2.5, mpPerHit: 5, mpPerParry: 12, fanCost: 34,
  baseDmg: 20, critMult: 20,     // execution: 400
  parryWindow: 0.3,           // s after pressing L in which a blow is parried
  comboGrace: 0.3,            // s after a combo hit ends in which J still continues the string
  staffRadius: 0.1,           // hit radius around the rod (m)
  lockRange: 18, critRange: 9,
  fanRange: 13, fanAngle: 34 * DEG,
  lavaDps: 32,
  stepUp: 0.45, vaultMax: 2.2, gravity: 24,
  // 法相天地: his size in phase two (times his own 1.5 m: a little smaller than the standing bull), how fast a giant
  // walks / runs / sprints (m/s), how far his moves carry him and how high they lift him (times the size), the pace of
  // his moves, and the level he stands on (he wades through whatever is on the floor)
  giant: 20, giantWalk: 14, giantRun: 40, giantBack: 50, giantSprint: 56, giantStep: 0.3, giantLift: 0.5, giantPace: 0.85, giantStaff: 1.3,
};

// ------------------------------------------------------------------ sound: niumo names first, cathedral stand-ins

let KNOWN = null;
import('../audio/sfx.js').then(m => { KNOWN = new Set([...(m.SFX_NAMES || []), ...Object.keys(m.SFX || {})]); }).catch(() => { KNOWN = new Set(); });

// ------------------------------------------------------------------ geometry

/**
 * Sweep the whole rod (butt..tip) from its previous to its current placement against capsules [{ part, a, b, r }].
 * The first sub-step with contact wins; within it a weak point beats 'body'. Returns { point, part, zone } or null.
 */
export function sweepStaff(pb0, pt0, pb1, pt1, zones, radius = 0.1, steps = 6) {
  if (!zones || !zones.length) return null;
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    A.lerpVectors(pb0, pb1, f); B.lerpVectors(pt0, pt1, f);
    let best = null, pri = -1, depth = 0;
    for (const z of zones) {
      const res = segSeg(A, B, z.a, z.b, _c1, _c2);
      const d = z.r + radius - res.dist;
      if (d < 0) continue;
      const p = z.part === 'body' ? 0 : 1;
      if (p > pri || (p === pri && d > depth)) { pri = p; depth = d; best = { zone: z, c1: _c1.clone(), c2: _c2.clone(), dist: res.dist }; }
    }
    if (best) {
      const toRod = best.c1.clone().sub(best.c2);
      const point = best.c2.clone().add(toRod.setLength(Math.min(best.zone.r, best.dist)));
      return { point, part: best.zone.part, zone: best.zone };
    }
  }
  return null;
}

/** Does a sphere (c, r) touch the cone with apex `origin`, unit axis `dir`, length `range`, half-angle `halfAngle`? */
export function coneHitsSphere(origin, dir, range, halfAngle, c, r = 0) {
  const vx = c.x - origin.x, vy = c.y - origin.y, vz = c.z - origin.z;
  const along = vx * dir.x + vy * dir.y + vz * dir.z;
  if (along < -r || along > range + r) return false;
  if (along < 0) return vx * vx + vy * vy + vz * vz <= r * r;
  const perp = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - along * along));
  return perp * Math.cos(halfAngle) - along * Math.sin(halfAngle) <= r;
}

/** Does capsule { a, b, r } touch the cone? (sampled along its axis) */
export function coneHitsCapsule(origin, dir, range, halfAngle, cap) {
  const p = new THREE.Vector3();
  for (let i = 0; i <= 8; i++) {
    p.lerpVectors(cap.a, cap.b, i / 8);
    if (coneHitsSphere(origin, dir, range, halfAngle, p, cap.r)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ props

function canvasTex(w, h, draw, { srgb = true, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 4;
  return t;
}
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

let STAFF_TEX = null;
function staffTextures() {
  if (STAFF_TEX) return STAFF_TEX;
  const R = seeded(7);
  // hammered black iron: dimples, a few rust blooms, scratches
  const dimples = [];
  for (let i = 0; i < 260; i++) dimples.push([R() * 128, R() * 512, 3 + R() * 7, 0.5 + R() * 0.5]);
  const ironCol = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#34312d'; g.fillRect(0, 0, w, h);
    for (const [x, y, r, k] of dimples) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(22,20,18,${0.55 * k})`); gr.addColorStop(0.7, `rgba(30,28,25,${0.3 * k})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 9; i++) {       // rust in the pits
      const x = R() * w, y = R() * h, r = 6 + R() * 18;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(74,36,22,0.5)'); gr.addColorStop(1, 'rgba(60,30,20,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = 'rgba(80,74,66,0.35)'; g.lineWidth = 0.6;
    for (let i = 0; i < 40; i++) { const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + R() * 10 - 5, y + 8 + R() * 30); g.stroke(); }
  }, { repeat: [1, 3] });
  const ironBump = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (const [x, y, r] of dimples) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(40,40,40,0.9)'); gr.addColorStop(0.8, 'rgba(110,110,110,0.4)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2); g.fill();
    }
  }, { srgb: false, repeat: [1, 3] });
  // worn gold bands, engraved with waves below and clouds above; grime in the cuts
  const engrave = (g, w, h, colLine, colHi, lw) => {
    g.lineWidth = lw; g.lineCap = 'round';
    for (let row = 0; row < 3; row++) {      // waves
      const y0 = h * (0.78 - row * 0.09);
      for (let x = -20; x < w + 20; x += 22) {
        g.strokeStyle = colLine; g.beginPath(); g.arc(x + (row % 2) * 11, y0, 10, Math.PI, 0); g.stroke();
        g.strokeStyle = colHi; g.beginPath(); g.arc(x + (row % 2) * 11 + 1, y0 - 1, 10, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
      }
    }
    for (let i = 0; i < 5; i++) {             // cloud spirals
      const cx = (i + 0.5) * w / 5, cy = h * 0.32 + (i % 2) * 10;
      g.strokeStyle = colLine; g.beginPath();
      for (let a = 0; a < Math.PI * 3.2; a += 0.2) { const r = 2 + a * 2.1; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.75); }
      g.stroke();
    }
    g.strokeStyle = colLine; g.lineWidth = lw * 1.5;
    for (const y of [h * 0.06, h * 0.94]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  };
  const bandCol = canvasTex(256, 96, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#6a5228'); gr.addColorStop(0.5, '#8c6e36'); gr.addColorStop(1, '#634c25');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    engrave(g, w, h, 'rgba(34,27,16,0.9)', 'rgba(150,124,72,0.55)', 2);
    for (let i = 0; i < 26; i++) {       // tarnish and ash
      const x = R() * w, y = R() * h, r = 4 + R() * 16;
      const t = g.createRadialGradient(x, y, 0, x, y, r);
      t.addColorStop(0, R() < 0.5 ? 'rgba(46,38,24,0.55)' : 'rgba(70,64,56,0.4)'); t.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = t; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, { repeat: [2, 1] });
  const bandBump = canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
    engrave(g, w, h, 'rgba(20,20,20,1)', 'rgba(160,160,160,0)', 2.4);
  }, { srgb: false, repeat: [2, 1] });
  // the real staff's rod (with the Tripo hoops): red-black, like the stub under the hoop - the same dimples, darker red
  const redIronCol = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#3b1714'; g.fillRect(0, 0, w, h);
    for (const [x, y, r, k] of dimples) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(18,6,5,${0.55 * k})`); gr.addColorStop(0.7, `rgba(30,10,8,${0.3 * k})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 14; i++) {      // lighter red where it is polished by the hands
      const x = R() * w, y = R() * h, r = 8 + R() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(110,34,26,0.35)'); gr.addColorStop(1, 'rgba(90,30,22,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, { repeat: [1, 3] });
  STAFF_TEX = { ironCol, ironBump, bandCol, bandBump, redIronCol };
  return STAFF_TEX;
}

/**
 * The procedural 金箍棒: ONE solid round rod of hammered black iron with a worn gold band at each end (engraved with
 * waves and clouds, grime in the cuts, raised rings at the lip and the middle, a domed end cap). Same frame as
 * loadBlade(): a holder Group whose +Y runs from the grip (origin) to the head end; the rod's butt is at
 * -length * gripFrac. (The Tripo niumo_staff.glb read as two parallel bars - a ladder - so this is the staff now.)
 */
export function createStaff({ length = 1.9, gripFrac = 0.3, radius = 0.029, cap = null } = {}) {
  const T = staffTextures();
  const iron = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.ironCol, bumpMap: T.ironBump, bumpScale: 1.2, roughness: 0.42, metalness: 0.7,
    envMapIntensity: 1.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.bandCol, bumpMap: T.bandBump, bumpScale: 2.2, roughness: 0.36, metalness: 1.0,
    envMapIntensity: 1.6, emissive: new THREE.Color(0.85, 0.38, 0.1), emissiveIntensity: 0 });
  const band = 0.15, rb = radius * 1.22, seg = 28;
  const inner = new THREE.Group();
  if (cap) return finishStaff(capStaff(inner, cap, { length, radius, seg }), { length, gripFrac, gold: null });
  // the iron, very slightly swollen in the middle so it reads as forged, not as a pipe
  const pts = [];
  const shaftLen = length - band * 2 + 0.01;
  for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(new THREE.Vector2(radius * (0.97 + 0.03 * Math.sin(u * Math.PI)), u * shaftLen)); }
  const shaftGeo = new THREE.LatheGeometry(pts, seg);
  shaftGeo.translate(0, band - 0.005, 0);
  const shaft = new THREE.Mesh(shaftGeo, iron);
  inner.add(shaft);
  for (const end of [0, 1]) {
    const s = end ? -1 : 1;                       // +1: the band grows up from the butt, -1: down from the head
    const y0 = end ? length : 0;                  // outer end of the band
    const b = new THREE.Mesh(new THREE.CylinderGeometry(rb, rb, band, seg, 1, true), gold);
    b.position.y = y0 + s * band / 2; inner.add(b);
    for (const [f, r, t] of [[1, rb * 1.06, 0.0065], [0.5, rb * 1.02, 0.004], [0.06, rb * 1.04, 0.005]]) {   // raised rings
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, seg), gold);
      ring.rotation.x = Math.PI / 2; ring.position.y = y0 + s * band * f; inner.add(ring);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(rb, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    cap.scale.y = 0.32; cap.position.y = y0; if (!end) cap.rotation.x = Math.PI; inner.add(cap);
  }
  gold.userData.staffGold = true;
  return finishStaff(inner, { length, gripFrac });
}

function finishStaff(inner, { length, gripFrac }) {
  inner.position.y = -length * gripFrac;
  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const holder = new THREE.Group();
  holder.add(inner);
  holder.name = 'jingubang';
  // the fighters' rim and key light, so the dark rod reads against the dark ground (the look clones the materials)
  applyLook(holder, 'niumoStaff');
  const goldMats = new Set();
  holder.traverse(o => { if (o.isMesh && o.material.userData.staffGold) goldMats.add(o.material); });
  holder.userData = { length, gripFrac, bladeLength: length * (1 - gripFrac), procedural: true, goldMats: [...goldMats] };
  return holder;
}

/**
 * The real 如意金箍棒 (2026-11-17 user: "要真正的如意金箍棒"): the Tripo end piece (assets/models/niumo_jgb_cap.glb,
 * concept hunxi concept/niumo_w_jgb_cap.png - a gold hoop in high relief, a coiling dragon among clouds, a domed cap
 * with a cloud medallion, over a short stub of red-black iron) at both ends, the stub scaled to the rod's radius; between
 * the two stubs the rod itself, the same red-black hammered iron. Builds into `inner` (rod +Y from butt 0 to head).
 */
function capStaff(inner, capScene, { length, radius, seg }) {
  // measure the piece: its axis is the file's +Y (dome up); the stub is the bottom quarter
  capScene.updateMatrixWorld(true);
  const pts = [];
  capScene.traverse(o => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 2) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone());
  });
  const box = new THREE.Box3().setFromPoints(pts), c = box.getCenter(new THREE.Vector3()), h = box.max.y - box.min.y;
  let stubR = 0;
  for (const q of pts) if (q.y < box.min.y + h * 0.2) stubR = Math.max(stubR, Math.hypot(q.x - c.x, q.z - c.z));
  const k = radius / (stubR || 1), Hc = h * k;
  const T = staffTextures();
  const iron = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.redIronCol, bumpMap: T.ironBump, bumpScale: 1.1, roughness: 0.4, metalness: 0.55,
    envMapIntensity: 1.3 });
  const shaftLen = length - Hc * 2 + 0.004;
  const shaftGeo = new THREE.CylinderGeometry(radius * 0.995, radius * 0.995, shaftLen, seg, 1, true).translate(0, Hc - 0.002 + shaftLen / 2, 0);
  inner.add(new THREE.Mesh(shaftGeo, iron));
  for (const end of [0, 1]) {
    const piece = capScene.clone(true);
    piece.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      // (it glows with the heat of a blow like the old bands did: the glow follows the gold of the texture)
      o.material.emissive = new THREE.Color(0.85, 0.38, 0.1); o.material.emissiveIntensity = 0; o.material.emissiveMap = o.material.map;
      o.material.envMapIntensity = 1.6; o.material.userData.staffGold = true;
    });
    const g = new THREE.Group(); g.add(piece);
    piece.position.set(-c.x, -c.y, -c.z);          // centred on its own middle
    g.scale.setScalar(k);
    if (end) g.position.y = length - Hc / 2;     // head: dome up
    else { g.rotation.x = Math.PI; g.position.y = Hc / 2; }   // butt: dome down
    inner.add(g);
  }
  return inner;
}

/** The banana-leaf fan (芭蕉扇): a big dry leaf, dark and scorched, on a bronze handle. +Y from the grip to the tip. */
export function createFan() {
  const R = seeded(31);
  const tex = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h * 0.55, 10, w / 2, h * 0.55, w * 0.62);
    gr.addColorStop(0, '#39351f'); gr.addColorStop(0.7, '#2a2616'); gr.addColorStop(1, '#17130b');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(96,86,54,0.75)'; g.lineWidth = 3;             // midrib
    g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
    g.lineWidth = 1.1;
    for (let y = h - 14; y > 8; y -= 7) {                                 // parallel veins
      g.strokeStyle = `rgba(78,70,44,${0.35 + R() * 0.25})`;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + s * w * 0.25, y - 10, w / 2 + s * w * 0.5, y - 26); g.stroke(); }
    }
    for (let i = 0; i < 14; i++) {                                        // scorch and tears near the rim
      const a = R() * Math.PI * 2, rr = w * (0.36 + R() * 0.14), x = w / 2 + Math.cos(a) * rr, y = h * 0.55 + Math.sin(a) * rr, r = 6 + R() * 20;
      const t = g.createRadialGradient(x, y, 0, x, y, r);
      t.addColorStop(0, 'rgba(10,7,4,0.85)'); t.addColorStop(1, 'rgba(10,7,4,0)');
      g.fillStyle = t; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.15, 0.02, 0.29, 0.16, 0.28, 0.37);
  s.bezierCurveTo(0.27, 0.54, 0.13, 0.64, 0, 0.66);
  s.bezierCurveTo(-0.13, 0.64, -0.27, 0.54, -0.28, 0.37);
  s.bezierCurveTo(-0.29, 0.16, -0.15, 0.02, 0, 0);
  const geo = new THREE.ShapeGeometry(s, 18);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), ax = Math.abs(x) / 0.28;
    p.setZ(i, 0.06 * ax * ax + 0.012 * Math.sin(y * 34 + x * 9) * ax);   // cupped, the dry edge rippled
    uv.setXY(i, x / 0.6 + 0.5, y / 0.66);
  }
  geo.computeVertexNormals();
  const leaf = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.88, metalness: 0 }));
  leaf.position.y = 0.13;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.017, 0.27, 10), new THREE.MeshStandardMaterial({ color: 0x4d3c22, roughness: 0.5, metalness: 0.85 }));
  handle.position.y = 0.0;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x3e1410, roughness: 0.9 }));
  cord.position.y = -0.07;
  const g = new THREE.Group();
  g.add(leaf, handle, cord);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.name = 'bajiaoshan';
  return g;
}

// ------------------------------------------------------------------ looks (added at runtime; look.js untouched)

if (!LOOK_PRESETS.niumoStaff) {
  // the iron staff: no recolouring (the textures are already iron and worn gold), only the rim and the fighters' key
  LOOK_PRESETS.niumoStaff = {
    rim: [0.5, 0.56, 0.72], rimK: 0.32, rimPow: 3.0, self: [0, 0, 0], selfK: 0,
    metal: [0.0, 1.0], steelK: 0, steelSat: [0.17, 0.1], steelLum: [0.2, 0.12], goldK: 0,
    rough: [1.0, 0.0], steelRough: 0.4, goldRough: 0.36, plain: [0.0, 1.0], steel: [0.4, 0.4, 0.4],
    wet: [-20, 0.1, 0], key: 0.8, keyCol: [1.0, 0.82, 0.62], env: 1.3, normal: 1.0, height: 1.9,
  };
}

if (!LOOK_PRESETS.niumoMonkey) {
  // tarnished gold mail, old bronze and the gold mask under the evening sky: a warm rim from the low sun, and a key of
  // his own strong enough to read him inside the giant's shadow
  LOOK_PRESETS.niumoMonkey = {
    rim: [1.0, 0.76, 0.5], rimK: 0.6, rimPow: 2.7, self: [0, 0, 0], selfK: 0,
    metal: [0.2, 0.62], steelK: 0.45, steelSat: [0.17, 0.1], steelLum: [0.2, 0.12], goldK: 0.9,
    rough: [0.85, 0.06], steelRough: 0.48, goldRough: 0.4, plain: [0.04, 1.05], steel: [0.36, 0.35, 0.34],
    wet: [-20, 0.1, 0], key: 1.25, keyCol: [1.0, 0.86, 0.7], env: 1.25, normal: 1.0, height: 1.5,
  };
}

/** The monkey's look: the black-and-gold preset (the crimson cape is in the model's own texture). Idempotent. */
export function dressMonkey(char) {
  const model = char && (char.model || char.root);
  // monkey10 (concept/niumo_w_monkey10_front.png, 2026-11-17): the first monkey's body under a smooth, plain, full-face
  // gold mask with empty eye slits. polishMask makes the mask mirror gold up to the circlet - no eyes set in it (the
  // old painted eyes stood out of the face); keepFaceSkin keeps the reddish fur out of the look's gold-by-colour test.
  if (model && !model.userData.look) { applyLook(model, 'niumoMonkey'); polishMask(model, { eyes: false, top: true }); keepFaceSkin(model); capeHem(model); }
}

/**
 * His face is skin and fur, not gold. The look preset turns every warm, saturated, light colour into polished gold
 * (right for the armour's trim), and the tan face and the light brown crown of fur fell into that range: the new,
 * unmasked head rendered as a gold mask. Everything skinned to the head and neck is kept out of that colour test; the
 * gold circlet stays metal through the model's own metalness map.
 */
function keepFaceSkin(model) {
  model.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si || !sw || g.attributes.lkSkin) return;
    const names = mesh.skeleton.bones.map(b => b.name.replace(/^mixamorig:?/, ''));
    const head = new Set(['Head', 'HeadTop_End', 'Neck', 'LeftEye', 'RightEye'].map(n => names.indexOf(n)).filter(i => i >= 0));
    const skin = new Float32Array(si.count);
    for (let v = 0; v < si.count; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (head.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
      skin[v] = Math.min(1, Math.max(0, (w - 0.3) / 0.4));
    }
    const mk = g.attributes.lkMask;          // polishMask's mask area stays gold
    if (mk) for (let v = 0; v < si.count; v++) skin[v] *= 1 - Math.min(1, mk.getX(v) * 1.6);
    g.setAttribute('lkSkin', new THREE.BufferAttribute(skin, 1));
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m || m.userData.skinKept) continue;
      m.userData.skinKept = true;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, r) => {
        prev?.(shader, r);
        shader.vertexShader = 'attribute float lkSkin;\nvarying float vLkSkin;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLkSkin = lkSkin;');
        shader.fragmentShader = 'varying float vLkSkin;\n' + shader.fragmentShader.replace('lkGoldM = lkD.w *', 'lkGoldM = ( 1.0 - vLkSkin ) * lkD.w *');
      };
      const key = mk ? 'look-v1-mask-skin' : 'look-v1-skin';
      m.customProgramCacheKey = () => key;
      m.needsUpdate = true;
    }
  });
}

/**
 * The cape's hem (2026-11-17 user: "披风要帅气一些，现在破烂"): the model's crimson cape ends in long torn tatters. Below a
 * clean, gently curved line (lowest at his back's middle, rising to the sides) the cape's cloth is cut away, and a
 * narrow band of gold edges it. Bind space of this model: +X forward, +Y up, feet at 0, height ~1; the cape is the red
 * cloth behind him (x < -0.085 at the hem's height), the test by colour keeps his boots and trousers whole.
 */
const CAPE = { hem: 0.2, rise: 2.4, back: -0.085, trim: 0.007 };
function capeHem(model) {
  model.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m || m.userData.capeHem) continue;
      m.userData.capeHem = true;
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.() || 'look';
      m.onBeforeCompile = (shader, r) => {
        prev?.(shader, r);
        shader.vertexShader = 'varying vec3 vCapeP;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_SKINNING
  vCapeP = ( bindMatrix * vec4( position, 1.0 ) ).xyz;
#else
  vCapeP = position;
#endif`);
        shader.fragmentShader = 'varying vec3 vCapeP;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec3 cr = diffuseColor.rgb;
    float red = step( cr.g * 1.5 + 0.015, cr.r ) * step( cr.b * 1.3 + 0.01, cr.r );
    float hem = ${CAPE.hem.toFixed(3)} + ${CAPE.rise.toFixed(3)} * vCapeP.z * vCapeP.z;
    float cloth = red * step( vCapeP.x, ${CAPE.back.toFixed(3)} ) * step( vCapeP.y, hem + 0.12 );
    if ( cloth > 0.5 && vCapeP.y < hem ) discard;
    float trim = cloth * ( 1.0 - smoothstep( ${CAPE.trim.toFixed(3)}, ${(CAPE.trim * 1.6).toFixed(3)}, vCapeP.y - hem ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.56, 0.22 ), trim );
  }`);
      };
      m.customProgramCacheKey = () => prevKey + '-cape';
      m.needsUpdate = true;
    }
  });
}

/** Which way the bind pose faces (the generated rigs are not all exported facing +Z): from the foot to the toe. */
function bindForward(mesh) {
  const sk = mesh.skeleton, names = sk.bones.map(b => b.name.replace(/^mixamorig:?/, ''));
  const at = n => { const i = names.indexOf(n); return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[i]).invert()); };
  const a = at('LeftFoot'), b = at('LeftToeBase');
  const f = a && b ? b.sub(a).setY(0) : new THREE.Vector3(0, 0, 1);
  return f.lengthSq() > 1e-10 ? f.normalize() : new THREE.Vector3(0, 0, 1);
}

/** Where the mask's eye openings sit, in head heights (Head -> HeadTop_End) from the head joint: [across, up]; and their size. */
export const MASK_EYES = { x: 0.078, y: 0.21, w: 0.046, h: 0.021, tilt: 0.2, iris: 0.0115 };

/**
 * 火眼金睛. The model's mask has no eyes (two shut creases): cut him eye openings - a dark almond laid on the surface,
 * found by casting a ray at the bind-pose face - and put a coal in each: a small ember-gold iris that the bloom turns
 * into a glint. They ride the head bone.
 */
function addMaskEyes(mesh, headBone, hi, ti) {
  const E = MASK_EYES, sk = mesh.skeleton;
  const bindOf = i => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[i]).invert());
  const hp = bindOf(hi), size = ti >= 0 ? bindOf(ti).distanceTo(hp) : 0.2;
  const F = bindForward(mesh), R = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), F).normalize();
  const still = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  still.matrixAutoUpdate = false; still.matrix.copy(mesh.bindMatrix); still.matrixWorld.copy(mesh.bindMatrix);
  const ray = new THREE.Raycaster();
  const group = new THREE.Group(); group.name = 'mask-eyes'; group.matrixAutoUpdate = false;
  group.matrix.copy(sk.boneInverses[hi]);            // children are placed in bind space
  const dark = new THREE.MeshBasicMaterial({ color: 0x050302, transparent: true, opacity: 0.96, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const fire = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.95, 0.16), toneMapped: false });
  const core = new THREE.MeshBasicMaterial({ color: 0x120804 });
  for (const sgn of [-1, 1]) {
    const from = hp.clone().addScaledVector(R, sgn * E.x * size).addScaledVector(F, size * 3); from.y += E.y * size;
    ray.set(from, F.clone().negate());
    const hit = ray.intersectObject(still, false)[0];
    if (!hit) continue;
    const n = hit.face ? hit.face.normal.clone().transformDirection(mesh.bindMatrix) : F.clone();
    if (n.dot(F) < 0) n.negate();
    n.lerp(F.clone().addScaledVector(R, sgn * 0.25), 0.6).normalize();
    const eye = new THREE.Group();
    eye.position.copy(hit.point).addScaledVector(n, size * 0.012);
    eye.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize(), new THREE.Vector3().crossVectors(n, new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize()), n));
    const socket = new THREE.Mesh(new THREE.CircleGeometry(1, 28), dark);
    socket.scale.set(E.w * size, E.h * size, 1); socket.rotation.z = -sgn * E.tilt; socket.renderOrder = 2;
    const iris = new THREE.Mesh(new THREE.CircleGeometry(E.iris * size, 20), fire);
    iris.position.z = size * 0.004; iris.renderOrder = 3; iris.material.depthWrite = false;
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(E.iris * size * 0.42, 14), core);
    pupil.position.z = size * 0.008; pupil.renderOrder = 4;
    eye.add(socket, iris, pupil);
    group.add(eye);
  }
  headBone.add(group);
  return group;
}

/**
 * The gold mask. The generated model paints its face gold with the light baked in, which reads as a painted face, not
 * as metal. Mark the front of the head (vertices skinned to the head bone, forward of it) and render what is gold
 * there as real polished gold: full metal, smooth, one even colour that takes its light and shade from the sky it
 * mirrors instead of from the paint. Hair, ears, eye sockets and neck keep the model's own surface.
 */
// the top of the mask (the circlet) above the head bone, in head sizes: the fur above it keeps its own colour
const MASK_TOP = 0.42, MASK_SIDE = 0.33;
export function polishMask(model, { eyes = true, top = false } = {}) {
  const meshes = [];
  model.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
    if (!si || !sw || g.attributes.lkMask) continue;
    const bones = mesh.skeleton.bones, names = bones.map(b => b.name.replace(/^mixamorig:?/, ''));
    const hi = names.indexOf('Head'), ti = names.indexOf('HeadTop_End'), ni = names.indexOf('Neck');
    const mask = new Float32Array(pos.count);
    if (hi >= 0) {
      const bind = i => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]).invert());
      const hp = bind(hi), size = ti >= 0 ? bind(ti).distanceTo(hp) : ni >= 0 ? bind(ni).distanceTo(hp) * 2 : 0.2;
      const headish = new Set([hi, ti].filter(i => i >= 0));
      const F = bindForward(mesh);
      const Sd = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
      const p = new THREE.Vector3(), ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      for (let v = 0; v < pos.count; v++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (headish.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
        if (w < 0.5) continue;
        p.fromBufferAttribute(pos, v).applyMatrix4(mesh.bindMatrix).sub(hp);
        // (side: the face is ~0.3 head-sizes to either side of the middle; past that is an ear - 2026-11-17 user: the ear
        // turned gold - which the forward test let in on one side)
        mask[v] = ss(0.02, 0.22, p.dot(F) / size) * ss(-0.25, 0.0, p.y / size) * (top ? 1 - ss(MASK_TOP - 0.08, MASK_TOP, p.y / size) : 1) * ss(0.5, 0.8, w)
          * (1 - ss(MASK_SIDE - 0.05, MASK_SIDE + 0.03, Math.abs(p.dot(Sd)) / size));
      }
    }
    g.setAttribute('lkMask', new THREE.BufferAttribute(mask, 1));
    if (eyes && hi >= 0 && !bones[hi].getObjectByName('mask-eyes')) addMaskEyes(mesh, bones[hi], hi, ti >= 0 ? ti : -1);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m || m.userData.maskPolished) continue;
      m.userData.maskPolished = true;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, r) => {
        prev?.(shader, r);
        shader.vertexShader = 'attribute float lkMask;\nvarying float vLkMask;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLkMask = lkMask;');
        const end = 'roughnessFactor = mix( roughnessFactor, min( roughnessFactor, 0.15 ), lkWk );\n  }';
        shader.fragmentShader = 'varying float vLkMask;\n' + shader.fragmentShader.replace(end, end + `
  {
    float mkM = vLkMask * smoothstep( 0.08, 0.35, lkGoldM );
    float mkL = clamp( dot( diffuseColor.rgb, vec3( 0.3, 0.6, 0.1 ) ), 0.0, 1.0 );
    vec3 mkGold = vec3( 1.0, 0.74, 0.32 ) * ( 0.5 + 0.34 * smoothstep( 0.12, 0.6, mkL ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, mkGold, mkM );
    metalnessFactor = mix( metalnessFactor, 1.0, mkM );
    roughnessFactor = mix( roughnessFactor, 0.42 + 0.1 * lkNoise( lkWP * 140.0 / max( lkHeight, 0.1 ) ), mkM );
  }`);
      };
      m.customProgramCacheKey = () => 'look-v1-mask';
      m.needsUpdate = true;
    }
  }
}

/**
 * The monkey's hands hang right against his wide cape, so the auto-rig gives cape cloth some forearm / hand weight and
 * the cloth tears into long spikes whenever an arm moves. Anatomically a forearm or hand influence only ever blends
 * with the upper arm (elbow) or with each other (wrist): strip it from vertices whose strongest other bone is anything
 * else (shoulder, spine, hips, thigh = cape and skirt), and hand weight that skips the forearm. Renormalised; returns
 * the number of vertices changed. Runs once per mesh (instances from loadCharacter() own their geometry).
 */
export function fixCapeWeights(mesh) {
  if (!mesh || !mesh.isSkinnedMesh || mesh.userData.capeFixed !== undefined) return mesh ? mesh.userData.capeFixed || 0 : 0;
  const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const names = mesh.skeleton.bones.map(b => b.name.replace(/^mixamorig:?/, ''));
  const kind = names.map(n => /^(Left|Right)ForeArm/.test(n) ? 'fore' : /^(Left|Right)Hand/.test(n) ? 'hand' : /^(Left|Right)Arm$/.test(n) ? 'upper' : 'other');
  let changed = 0;
  for (let v = 0; v < si.count; v++) {
    let wf = 0, wh = 0, best = -1, bw = 0;
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(v, k), w = sw.getComponent(v, k);
      if (w <= 0) continue;
      if (kind[b] === 'fore') wf += w; else if (kind[b] === 'hand') wh += w; else if (w > bw) { bw = w; best = b; }
    }
    if (wf + wh <= 0 || wf + wh >= 0.98) continue;
    const stripAll = best >= 0 && kind[best] === 'other' && bw > (wf + wh) * 0.6;
    const stripHand = !stripAll && wh > 0 && wh < 0.5 && wf < 0.05;
    if (!stripAll && !stripHand) continue;
    let rest = 0;
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(v, k);
      if (kind[b] === 'hand' || (stripAll && kind[b] === 'fore')) sw.setComponent(v, k, 0);
      else rest += sw.getComponent(v, k);
    }
    if (rest > 1e-4) for (let k = 0; k < 4; k++) sw.setComponent(v, k, sw.getComponent(v, k) / rest);
    changed++;
  }
  sw.needsUpdate = true;
  mesh.userData.capeFixed = changed;
  return changed;
}

/**
 * The shared loader's arm-weight cleaning (loadCharacter's cleanArms, default on) uses a fixed radius in file units that
 * is smaller than the monkey's gold bracers: it hands thousands of bracer / sleeve vertices to the hips and they tear
 * into spikes whenever an arm moves. Load him with { cleanArms: false } (then fixCapeWeights() is all he needs). If he
 * was loaded with the cleaning anyway, put the original weights back from the glTF (cached by the loader) and fix the
 * cape instead. Resolves to true when the weights were restored.
 */
export async function healMonkeyWeights(char, url = new URL('../../assets/models/niumo_monkey.glb', import.meta.url).href) {
  const mesh = char && char.mesh;
  if (!mesh || !mesh.userData.cleanedVertices || mesh.userData.healed) return false;
  mesh.userData.healed = 'pending';
  try {
    const gltf = await loadGLTF(url);
    const n = mesh.geometry.attributes.position.count;
    let src = null;
    gltf.scene.traverse(o => { if (!src && o.isSkinnedMesh && o.geometry.attributes.position.count === n) src = o; });
    const gw = mesh.geometry.attributes.skinWeight, gi = mesh.geometry.attributes.skinIndex;
    const sw = src && src.geometry.attributes.skinWeight, si = src && src.geometry.attributes.skinIndex;
    if (!sw || sw.array.length !== gw.array.length || si.array.length !== gi.array.length) { mesh.userData.healed = false; return false; }
    gw.array.set(sw.array); gi.array.set(si.array);
    gw.needsUpdate = gi.needsUpdate = true;
    mesh.userData.capeFixed = undefined;
    fixCapeWeights(mesh);
    mesh.userData.cleanedVertices = 0;
    mesh.userData.healed = true;
    return true;
  } catch { mesh.userData.healed = false; return false; }
}

/** Prepare any staff (procedural or loaded) for sliding grips, growth and the charge glow. */
function prepStaff(staff) {
  const ud = staff.userData;
  if (ud.prepped) return;
  ud.prepped = true;
  ud.length = ud.length || 1.9;
  ud.gripFrac = ud.gripFrac ?? 0.3;
  ud.baseGf = ud.gripFrac;
  ud.inner = staff.children[0] || null;
  ud.baseY = ud.inner ? ud.inner.position.y : 0;
  if (!ud.goldMats) {
    // gold-ish materials of a loaded or foreign staff glow with the charge
    const mats = new Set();
    staff.traverse(o => {
      if (!o.isMesh || !o.material) return;
      for (const m of [].concat(o.material)) {
        if (!m.color || !('emissive' in m)) continue;
        const hsl = {}; m.color.getHSL(hsl);
        if (hsl.s > 0.25 && hsl.h > 0.06 && hsl.h < 0.17) mats.add(m);
      }
    });
    if (!mats.size) staff.traverse(o => { if (o.isMesh && o.material && 'emissive' in o.material) mats.add(o.material); });
    ud.goldMats = [...mats];
  }
  for (const m of ud.goldMats) { if (m.emissive && m.emissive.r + m.emissive.g + m.emissive.b < 0.01) m.emissive.setRGB(0.85, 0.38, 0.1); m.emissiveIntensity = 0; }
}

// ------------------------------------------------------------------ loading

/**
 * Load the monkey (assets/models/niumo_monkey.glb, 1.5 m) and his staff: createStaff() with the Tripo hoop ends
 * (assets/models/niumo_jgb_cap.glb) on a red-black rod (a whole Tripo staff came out as two parallel bars: a long thin
 * rod is too thin for image-to-3D, the chunky end piece is not).
 */
export async function loadMonkeyAssets({ base = 'assets/models/', height = 1.5, mobile = false } = {}) {
  const m = mobile ? '_m' : '';           // (phones: the same models with smaller textures)
  const url = base + `niumo_monkey${m}.glb`;
  const [char, cap] = await Promise.all([
    loadCharacter(url, { height }),
    // the 金箍棒's hoops (a missing file falls back to the procedural bands)
    loadGLTF(base + `niumo_jgb_cap${m}.glb`).then(g => g.scene).catch(() => null),
  ]);
  char.url = url;
  fixCapeWeights(char.mesh); dressMonkey(char);
  // (a phone: no normal map - the only character that has one, and the first suspect for the white blotches an iPhone
  // showed on him, 2026-11-17; the detail is lost at a phone's size anyway)
  if (mobile) char.model.traverse(o => { if (o.isMesh && o.material && o.material.normalMap) { o.material.normalMap = null; o.material.needsUpdate = true; } });
  return { char, staff: createStaff({ cap }) };
}

export function createMonkeyActor(char, staff, scene) {
  return new Actor(char, { lib: MONKEY, hold: MONKEY_HOLD, sword: staff, scene, fist: true });
}

// ------------------------------------------------------------------ the controller

const ROLLS = new Set(['roll', 'rollB', 'rollL', 'rollR', 'backflip', 'jindou']);
const MOVE_STATES = new Set(['attack', 'roll', 'hurt', 'knockdown', 'blockHit', 'parry', 'fan', 'critical', 'land', 'vault', 'fall']);
const k0 = o => ({ t: 0, ...o });

export class Monkey {
  constructor({ actor, fx, audio, cam, input, arena, staff = null, trail = null, tuning = null }) {
    this.a = actor;
    this.root = actor.root;
    this.fx = fx; this.audio = audio; this.cam = cam; this.input = input; this.arena = arena || {};
    this.T = { ...MONKEY_TUNING, ...(tuning || {}) };
    this.staff = staff || actor.sword;
    if (this.staff) prepStaff(this.staff);
    this.scene = fx && fx.scene ? fx.scene : null;
    const model = actor.char && actor.char.model;
    if (actor.char && actor.char.mesh) {
      if (actor.char.mesh.userData.cleanedVertices) this.healed = healMonkeyWeights(actor.char, actor.char.url || undefined);     // async, see above
      else fixCapeWeights(actor.char.mesh);
    }
    if (model) dressMonkey(actor.char);

    // stance overlays: ready <-> guard, ready <-> carried on the shoulder
    this.guardTrack = new PoseTrack([k0(MONKEY_STANCE), { t: 1, ease: 'linear', ...MONKEY_BLOCK }]);
    this.carryTrack = new PoseTrack([k0(MONKEY_STANCE), { t: 1, ease: 'linear', ...MONKEY_CARRY }]);
    this.carryW = 0; this.carry = null;          // null: automatic (carried while there is no enemy)

    this.fan = createFan(); this.fan.visible = false;
    if (this.scene) this.scene.add(this.fan);
    this.trail = trail || (fx && fx.trail ? fx.trail({ color: new THREE.Color(0.62, 0.5, 0.36), life: 0.12, opacity: 0.3, samples: 20 }) : null);

    this.hp = this.T.maxHp; this.st = this.T.maxSt; this.mp = this.T.maxMp;
    this.state = 'idle';
    this.yaw = Math.PI; this.speed = 0;
    this.dead = false; this.god = false;
    this.events = [];
    this.time = 0;
    this.stDelay = 0;
    this.charge = 0; this.chargeFull = false; this.glow = 0;
    this.lastAttack = null; this.lastAttackEnd = -10;
    this.blocking = false; this.guardW = 0; this.parryT = -10;
    this.lockTarget = null; this._lock = { part: null, pos: new THREE.Vector3() };
    this.baseY = 0; this.liftY = 0; this.spinOff = 0;
    this.airborne = false; this.vy = 0; this.fallFrom = 0; this.thrown = null; this.airT = 0;
    this.vault = null;
    this.heldBy = null; this.heldT = 0;
    this.ringPos = null; this.ringW = 0; this.critStand = null;
    this.burnT = 0; this.footAcc = 0; this.footSide = 0;
    this.twist = 0; this.sprintW = 0; this.sprintingNow = false;
    this.collideBoss = true;
    this.lavaDamage = true;
    this.S = 1;                 // size: 1, or T.giant in 法相天地
    this.T0 = { ...this.T };
    this.seg = { butt: new THREE.Vector3(), tip: new THREE.Vector3(), pbutt: new THREE.Vector3(), ptip: new THREE.Vector3(), valid: false };
    this.lastX = this.root.position.x; this.lastZ = this.root.position.z;
    this.boss = null;
  }

  get pos() { return this.root.position; }
  get maxHp() { return this.T.maxHp; }
  get maxSt() { return this.T.maxSt; }
  get maxMp() { return this.T.maxMp; }

  // ------------------------------------------------------------------ 法相天地

  /**
   * His size: 1 (the 1.5 m monkey) or any multiple of it (T.giant in phase two; the cinematic grows him through the
   * values in between). A giant keeps every move he has, carried further and a little slower; his rod grows with him;
   * he walks on the level of the lake and nothing on the floor (pillars, steles, lava, ledges) stops or burns him —
   * only the walls of the caldera and the bull do.
   */
  setGiant(size = this.T0.giant) {
    const S = Math.max(1, size || 1), T0 = this.T0, rig = this.a.rig, k = S / this.S;
    this.root.scale.setScalar(S);
    for (const side of ['Left', 'Right']) { rig.armLen[side] *= k; rig.legLen[side] *= k; }
    rig.hipsRestY *= k; rig.h *= k;
    const g = S > 1;
    this.T = { ...T0, radius: T0.radius * S, staffRadius: T0.staffRadius * (g ? S * T0.giantStaff : 1), lockRange: T0.lockRange * S, fanRange: T0.fanRange * S,
      walkSpeed: g ? THREE.MathUtils.lerp(T0.walkSpeed, T0.giantWalk, (S - 1) / (T0.giant - 1)) : T0.walkSpeed,
      runSpeed: g ? THREE.MathUtils.lerp(T0.runSpeed, T0.giantRun, (S - 1) / (T0.giant - 1)) : T0.runSpeed,
      sprintSpeed: g ? THREE.MathUtils.lerp(T0.sprintSpeed, T0.giantSprint, (S - 1) / (T0.giant - 1)) : T0.sprintSpeed };
    this.S = S;
    if (g) { this.airborne = false; this.vy = 0; this.vault = null; this.thrown = null; this.throwVel = null; if (this.fan) this.fan.visible = false; }
    this.sizeStaff();
    this.seg.valid = false;
    this.root.updateMatrixWorld(true);
  }
  get giant() { return this.S > 1.001; }
  /** The level a giant stands on: the lake's (he wades through the floor's plates and seams alike). */
  giantY() { return this.arena.lavaY ?? 0; }
  /** The rod at his size (and the finisher's stretch). */
  sizeStaff(grow = 1) { if (this.staff) this.staff.scale.set(this.S, grow * this.S, this.S); }

  // ------------------------------------------------------------------ helpers

  sfx(names, opts) {
    const a = this.audio;
    if (!a || !a.play || !KNOWN) return null;
    for (const n of names) if (KNOWN.has(n)) return a.play(n, opts);
    return null;
  }
  ground(x, z) { const g = this.arena.groundY; return g ? g.call(this.arena, x, z) || 0 : 0; }
  canAct() { return !this.dead && !this.airborne && (this.state === 'idle' || this.state === 'move'); }
  inCancelWindow() { const mv = this.a.move; return !!(mv && mv.def.cancel !== undefined && mv.t >= mv.def.cancel); }
  invulnerable() {
    const mv = this.a.move;
    if (this.dodgeSafe) return true;          // (the opening bullet time: a roll in it is safe until the staff has landed)
    return !!(mv && mv.def.iframes && mv.t >= mv.def.iframes[0] && mv.t <= mv.def.iframes[1]);
  }
  /** (a giant's blows and steps cost a little less) */
  spend(n) {
    this.st -= this.giant ? n * 0.75 : n;
    this.stDelay = this.st <= 0 ? this.T.stDelayEmpty : this.T.stDelay;
  }

  /** World-space wish direction from WASD relative to the camera, magnitude 0..1. */
  wishDir(out) {
    const m = this.input.move();
    this.cam.forward(_f); this.cam.right(_r);
    out.set(0, 0, 0).addScaledVector(_r, m.x).addScaledVector(_f, m.y);
    const l = Math.hypot(out.x, out.z);
    if (l > 1e-6) out.multiplyScalar(1 / l);
    return Math.min(1, Math.hypot(m.x, m.y));
  }

  startMove(name, opts = {}) {
    const mv = this.a.startMove(name, this.giant && opts.speed === undefined ? { ...opts, speed: this.T.giantPace } : opts);
    this.state = ATTACKS.has(name) ? 'attack' : ROLLS.has(name) ? 'roll' : name;
    mv.landed = new Set(); this.moveYaw = null;
    if (ATTACKS.has(name)) this.stepIn(mv);
    return mv;
  }

  /**
   * The step into a blow: when the weak point he is aimed at lies a little beyond the rod's reach, straight ahead, the
   * move's own step forward stretches (up to 1.2 m more) so the rod lands on it instead of in the air.
   */
  stepIn(mv) {
    const lt = this.lockTarget, boss = this.boss;
    if (!lt || !boss || !boss.hurtZones) return;
    const zone = (boss.hurtZones() || []).find(z => z.part === lt.part);
    const root = (mv.def.moveRoot || []).reduce((s, r) => s + Math.max(0, r[2]), 0);
    if (!zone || root <= 0) return;
    const S = this.S, lo = _a.set(this.pos.x, this.pos.y + 0.4 * S, this.pos.z), hi = _b.set(this.pos.x, this.pos.y + 2.0 * S, this.pos.z);
    const res = segSeg(lo, hi, zone.a, zone.b, _c1, _c2);
    const toT = Math.atan2(_c2.x - this.pos.x, _c2.z - this.pos.z);
    if (Math.abs(wrap(toT - this.yaw)) > 0.6) return;
    const extra = this.giant ? 0 : clamp(res.dist - zone.r - 1.1 - root, 0, 1.2);
    if (extra > 0) mv.rootScale = (root + extra) / root;
  }

  setCarry(on) { this.carry = on === null || on === undefined ? null : !!on; }

  /** The weak point his attacks go for: the nearest one that is not the body (sticky, so it does not flicker). */
  pickLock(boss) {
    if (!boss || boss.dead || boss.dormant || boss.ghost || !boss.lockTargets) { this.lockTarget = null; return; }
    const list = boss.lockTargets() || [];
    if (this.giant) {          // 法相天地: no weak points to look for, the bull himself
      const t = list.find(q => q.part === 'body');
      if (!t) { this.lockTarget = null; return; }
      this._lock.part = 'body'; this._lock.pos.copy(t.pos);
      this.lockTarget = this._lock;
      return;
    }
    let best = null, bd = Infinity, cur = null, cd = Infinity;
    for (const t of list) {
      if (t.part === 'body' || t.enabled === false || t.open === false) continue;
      const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) + Math.max(0, t.pos.y - this.pos.y - 3.5) * 0.5;
      if (d < bd) { bd = d; best = t; }
      if (this.lockTarget && t.part === this.lockTarget.part) { cur = t; cd = d; }
    }
    if (cur && best !== cur && cd < bd * 1.25 + 0.75) { best = cur; bd = cd; }
    if (!best || bd > this.T.lockRange) { this.lockTarget = null; return; }
    this._lock.part = best.part; this._lock.pos.copy(best.pos);
    this.lockTarget = this._lock;
  }

  /** Snap the facing at the start of an attack: the stick, pulled onto the lock target when it is close to it. */
  faceTarget(maxAngle) {
    const m = this.wishDir(_v);
    let want = m > 0.2 ? Math.atan2(_v.x, _v.z) : null;
    const lt = this.lockTarget;
    if (lt) {
      const d = Math.hypot(lt.pos.x - this.pos.x, lt.pos.z - this.pos.z);
      const toT = Math.atan2(lt.pos.x - this.pos.x, lt.pos.z - this.pos.z);
      if (d < 14 * this.S && d > 0.3) {
        if (want === null) { if (Math.abs(wrap(toT - this.yaw)) < maxAngle) want = toT; }
        else if (Math.abs(wrap(toT - want)) < 0.9) want = toT;
      }
    }
    if (want !== null) this.yaw = want;
  }

  ringPoint(boss) {
    if (!boss) return null;
    if (boss.noseRing) { const r = boss.noseRing(this._ring || (this._ring = new THREE.Vector3())); if (r) return r; }
    const t = boss.lockTargets ? (boss.lockTargets() || []).find(q => q.part === 'head') : null;
    return t ? t.pos : null;
  }

  /** True when J now would be 牵牛鼻子 (his head is down and the ring is within a dash). */
  canExecute(boss) {
    if (this.giant || !boss || boss.dead || this.dead || !boss.criticalOpen || !boss.criticalOpen(this)) return false;
    const r = this.ringPoint(boss);
    return !!r && Math.hypot(r.x - this.pos.x, r.z - this.pos.z) < this.T.critRange;
  }

  // ------------------------------------------------------------------ actions

  tryActions(boss) {
    const inp = this.input, T = this.T;
    if (this.dead || this.airborne || this.state === 'held') return;
    const free = this.canAct();
    const cancel = this.inCancelWindow() && ['attack', 'roll', 'hurt', 'blockHit', 'parry', 'fan', 'land', 'vault'].includes(this.state);
    const dodgeNow = this.giant && this.state === 'attack' && inp.peek('roll', 0.3) && this.st > 0;      // (a giant may always step out)
    if (!free && !cancel && !dodgeNow) return;
    const mvName = this.a.move ? this.a.move.name : null;

    if (inp.peek('roll', 0.3) && this.st > 0) {
      inp.take('roll', 0.3);
      const m = this.wishDir(_v);
      // four rolls along the ground (2026-11-16 user): locked on, the keys pick front / back / left / right relative to
      // the enemy and he keeps facing him (the side rolls travel along moveYaw); no key is the back roll. Not locked,
      // he turns the way the keys point and rolls forward.
      let name = 'rollB', stepYaw = null;
      const lt = this.lockTarget;
      const face = lt ? Math.atan2(lt.pos.x - this.pos.x, lt.pos.z - this.pos.z) : this.yaw;
      if (m > 0.2) {
        const want = Math.atan2(_v.x, _v.z), rel = wrap(want - face);
        if (!lt || Math.abs(rel) < Math.PI / 4) { name = 'roll'; this.yaw = lt ? face : want; }
        else if (Math.abs(rel) > 3 * Math.PI / 4) { name = 'rollB'; this.yaw = face; }
        else {
          // right of the facing is (-cos, 0, sin) of the yaw (forward x up)
          name = _v.x * -Math.cos(face) + _v.z * Math.sin(face) > 0 ? 'rollR' : 'rollL';
          this.yaw = face; stepYaw = face + (name === 'rollR' ? -Math.PI / 2 : Math.PI / 2);
        }
      } else this.yaw = face;
      this.spend(MONKEY[name].stamina);
      this.startMove(name);
      this.state = 'roll'; this.moveYaw = stepYaw;
      this.charge = 0;
      this.sfx(['monkey_roll', 'roll_ash', 'swing_light'], { pos: this.pos, volume: 0.45, pitch: 0.62 });
      this.fx.dust?.(this.pos, 0.6, 8);
      return;
    }
    // 牵牛鼻子
    if (inp.peek('light', 0.35) && this.canExecute(boss)) {
      inp.take('light', 0.35); inp.take('heavy', 0.3);
      this.beginCritical(boss);
      return;
    }
    // J out of a full run: the leaping smash
    if (inp.peek('light', 0.35) && free && this.state === 'move' && this.sprintingNow && this.speed > (this.giant ? this.T.sprintSpeed * 0.8 : 5.2) && this.st > 0) {
      inp.take('light', 0.35);
      this.faceTarget(Math.PI * 0.5);
      this.spend(MONKEY.runAttack.stamina);
      this.startMove('runAttack');
      this.lastAttack = 'runAttack';
      return;
    }
    if (inp.peek('heavy', 0.3) && this.st > 0) {
      inp.take('heavy', 0.3);
      this.faceTarget(Math.PI);
      this.spend(MONKEY.heavy.stamina);
      const mv = this.startMove('heavy');
      mv.holding = true;
      this.charge = 0; this.chargeFull = false;
      this.lastAttack = 'heavy';
      return;
    }
    if (inp.peek('light', 0.35) && this.st > 0) {
      inp.take('light', 0.35);
      let prev = null;
      if (this.state === 'attack' && mvName && COMBO.includes(mvName)) prev = mvName;
      else if (free && COMBO.includes(this.lastAttack) && this.time - this.lastAttackEnd < T.comboGrace) prev = this.lastAttack;
      const i = prev ? COMBO.indexOf(prev) : -1;
      const next = COMBO[(i + 1) % COMBO.length];
      this.faceTarget(Math.PI * 0.5);
      this.spend(MONKEY[next].stamina);
      this.startMove(next);
      this.lastAttack = next;
      return;
    }
    if (inp.peek('fan', 0.3)) {
      inp.take('fan', 0.3);
      if (this.mp < T.fanCost) {
        this.sfx(['ui'], { volume: 0.4, pitch: 0.7 });
        this.events.push({ type: 'fan-empty' });
        return;
      }
      this.mp -= T.fanCost;
      this.faceTarget(Math.PI * 0.6);
      this.spend(MONKEY.fan.stamina);
      this.startMove('fan');
    }
  }

  beginCritical(boss) {
    const ring = this.ringPoint(boss).clone();
    const g = this.ground(ring.x, ring.z);
    const toMe = _v.set(this.pos.x - ring.x, 0, this.pos.z - ring.z);
    const anchor = boss.critAnchor ? boss.critAnchor() : null;
    if (anchor && anchor.pos) toMe.set(anchor.pos.x - ring.x, 0, anchor.pos.z - ring.z);
    if (toMe.lengthSq() < 1e-4) toMe.set(Math.sin(boss.yaw || 0), 0, Math.cos(boss.yaw || 0));
    toMe.normalize();
    // always the outer side of the ring (in front of his face, away from his body): never wedged between head and chest
    if (boss.pos) {
      const ox = ring.x - boss.pos.x, oz = ring.z - boss.pos.z;
      if (toMe.x * ox + toMe.z * oz < 0 && Math.hypot(ox, oz) > 1) toMe.set(ox, 0, oz).normalize();
    }
    this.ringPos = ring;
    this.critStand = new THREE.Vector3(ring.x + toMe.x * 0.5, this.ground(ring.x + toMe.x * 0.5, ring.z + toMe.z * 0.5), ring.z + toMe.z * 0.5);
    this.critLift = clamp(ring.y - g - 1.3, 0, 3.4);
    this.critFrom = this.pos.clone();
    this.critDist = Math.hypot(this.critStand.x - this.pos.x, this.critStand.z - this.pos.z);
    this.yaw = Math.atan2(ring.x - this.pos.x, ring.z - this.pos.z);
    this.blocking = false; this.charge = 0;
    this.startMove('critical');
    this.state = 'critical';
    this.sfx(['staff_swing', 'swing_heavy'], { pos: this.pos, pitch: 0.85 });
    this.events.push({ type: 'critical-start' });
  }

  // ------------------------------------------------------------------ taking hits

  takeHit({ dmg = 10, from = null, kind = 'heavy', blockable = false } = {}) {
    if (this.dead || this.state === 'held') return false;
    if (this.invulnerable()) return false;
    from = from || this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
    if (kind === 'grab') {
      if (!this.grab(null)) return false;
      // the squeeze now, the rest when he is slammed down
      this.hp -= dmg * 0.4;
      if (this.god) this.hp = Math.max(this.hp, 1);
      this.grabPending = dmg * 0.6;
      this.fx.flashMesh?.(this.a.char.model, new THREE.Color(1, 0.3, 0.25), 0.14, 0.8);
      this.events.push({ type: 'hurt', kind: 'grab', hitstop: 0.12 });
      if (this.hp <= 0) { this.hp = Math.max(this.hp, 0.5); }      // he dies on the stone, not in the fist
      return true;
    }
    // (法相天地: he is locked on the bull, and what he guards against is the bull - wherever along the staff it lands)
    const src = this.giant && this.boss && this.boss.pos ? this.boss.pos : from;
    const toward = Math.atan2(src.x - this.pos.x, src.z - this.pos.z);
    // a blow that comes down on him from above (a giant's staff passing over his head: the contact point sits on top of
    // him, its horizontal direction is noise) meets the raised rod whichever way he faces
    const overhead = Math.hypot(from.x - this.pos.x, from.z - this.pos.z) < 0.8 * this.S && from.y > this.pos.y + 0.9 * this.S;
    const facing = overhead || Math.abs(wrap(toward - this.yaw)) < 1.4;
    if (blockable && facing) {
      if (this.time - this.parryT <= this.T.parryWindow) return this.parry(dmg, from);
      if (this.blocking && this.guardW > 0.4) return this.block(dmg, from, kind);
    }
    this.hurt(dmg, from, kind);
    return true;
  }

  hurt(dmg, from, kind = 'heavy') {
    this.hp -= dmg;
    if (this.god) this.hp = Math.max(this.hp, 1);
    const light = kind === 'light';
    const dir = _v.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (dir.lengthSq() < 1e-6) dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    dir.normalize();
    const chest = this.a.bonePos('Spine2', new THREE.Vector3());
    this.fx.bloodHit?.(chest, dir, !light);
    this.fx.flashMesh?.(this.a.char.model, new THREE.Color(1, 0.3, 0.25), 0.14, 0.8);
    this.a.jolt(dir, light ? 0.12 : 0.18, 0.018);
    this.sfx(['player_hurt'], { pos: this.pos, volume: light ? 0.8 : 1 });
    this.cam.addTrauma?.(light ? 0.45 : 0.75);
    this.cam.punch?.(dir, light ? 0.18 : 0.32);
    this.input.rumble?.(light ? 0.5 : 1.0, 0.6, light ? 140 : 260);
    this.events.push({ type: 'hurt', kind, hitstop: light ? 0.09 : 0.14 });
    this.charge = 0; this.blocking = false;
    if (this.hp <= 0) { this.die(from); return; }
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.startMove(light || this.giant ? 'hurt' : 'knockdown');      // (a giant staggers, he is not thrown)
  }

  /** 金身: his blow rang off the bull's gold body and came back into his arms - no harm done to either, but he reels. */
  recoil(point) {
    if (this.dead || this.state === 'held' || this.state === 'critical') return false;
    const p = point || this.seg.tip.clone();
    const dir = _v.set(this.pos.x - p.x, 0, this.pos.z - p.z);
    if (dir.lengthSq() < 1e-6) dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    dir.normalize();
    this.fx.hitSpark?.(p, dir.clone(), true);
    this.fx.light?.(p, 0xffd27a, 80, 0.3, 12 * this.S);
    this.sfx(['parry'], { pos: p, pitch: 0.7 });
    this.sfx(['block'], { pos: p, pitch: 0.6, volume: 1 });
    this.a.jolt(dir, 0.16, 0.016);
    this.cam.addTrauma?.(0.5); this.cam.punch?.(dir, 0.25);
    this.input.rumble?.(0.8, 0.6, 220);
    this.charge = 0; this.blocking = false;
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.startMove('recoil');
    this.state = 'hurt';
    this.events.push({ type: 'recoil', hitstop: 0.14 });
    return true;
  }

  parry(dmg, from) {
    const spark = this.seg.butt.clone().lerp(this.seg.tip, 0.5);
    const dir = new THREE.Vector3(from.x - this.pos.x, 0, from.z - this.pos.z).normalize();
    this.fx.hitSpark?.(spark, dir, true);
    this.fx.light?.(spark, 0xffd8a0, 60, 0.25, 9);
    this.sfx(['parry'], { pos: spark });
    this.sfx(['stagger'], { pos: spark, volume: 0.4, pitch: 1.35 });
    this.cam.addTrauma?.(0.3); this.cam.zoomPunch?.(3);
    this.input.rumble?.(0.9, 0.5, 160);
    this.mp = Math.min(this.T.maxMp, this.mp + this.T.mpPerParry);
    this.parryT = -10;                       // one blow per press
    this.events.push({ type: 'parry', point: spark });
    this.yaw = Math.atan2(dir.x, dir.z);
    this.startMove('parry');
    return 'parry';
  }

  block(dmg, from, kind) {
    const T = this.T;
    const dir = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z).normalize();
    const spark = this.seg.butt.clone().lerp(this.seg.tip, 0.5);
    this.st -= dmg * (this.giant ? 1.2 : 1.7); this.stDelay = T.stDelay * 1.4;
    this.a.jolt(dir, 0.1, 0.014);
    this.fx.hitSpark?.(spark, dir.clone().negate(), false);
    this.sfx(['block'], { pos: spark, pitch: 0.9 + Math.random() * 0.1 });
    this.cam.addTrauma?.(0.22); this.cam.punch?.(dir, 0.12);
    this.input.rumble?.(0.5, 0.4, 110);
    if (this.st <= 0) {                       // guard broken
      this.st = 0; this.blocking = false; this.guardW = 0;
      this.hp -= dmg * 0.5;
      if (this.god) this.hp = Math.max(this.hp, 1);
      this.sfx(['player_hurt'], { pos: this.pos });
      this.events.push({ type: 'guardbreak', hitstop: 0.12 });
      if (this.hp <= 0) { this.die(from); return true; }
      this.startMove('knockdown');
      return true;
    }
    this.hp -= dmg * 0.12;
    if (this.god) this.hp = Math.max(this.hp, 1);
    if (this.hp <= 0) { this.die(from); return true; }
    this.events.push({ type: 'block', hitstop: 0.06 });
    this.startMove('blockHit');
    return 'block';
  }

  die(from) {
    this.dead = true; this.state = 'dead'; this.hp = 0;
    this.blocking = false; this.charge = 0; this.ringPos = null;
    if (from) this.yaw = Math.atan2(this.pos.x - from.x, this.pos.z - from.z);     // he falls away from the blow
    this.a.stopMove();
    const mv = this.startMove('death');
    mv.holding = true;
    this.state = 'dead';
    this.sfx(['player_death'], {});
    this.events.push({ type: 'dead' });
  }

  /** Caught in a giant's fist. handFn() -> world point the monkey's chest follows (or null: the boss moves monkey.pos). */
  grab(handFn = null) {
    if (this.dead || this.state === 'held' || this.invulnerable()) return false;
    this.a.stopMove();
    const mv = this.startMove('held');
    mv.holding = true;
    this.state = 'held';
    this.heldBy = typeof handFn === 'function' ? handFn : null;
    this.heldT = 0;
    this.blocking = false; this.charge = 0; this.airborne = false; this.vy = 0; this.liftY = 0;
    this.sfx(['player_hurt'], { pos: this.pos, volume: 0.8 });
    this.cam.addTrauma?.(0.35);
    this.events.push({ type: 'grabbed' });
    return true;
  }

  /** The boss's grab protocol (bull.js): it holds monkey.pos itself, then drops him. */
  onGrabbed() { }
  onReleased(boss, { slam = true } = {}) { this.release({ dmg: this.grabPending || 0, from: boss ? boss.pos : null, slam }); }

  /** Let go of him: thrown (vel) or slammed down; `dmg` lands with him. */
  release({ dmg = 0, from = null, vel = null, slam = true } = {}) {
    if (this.state !== 'held') return;
    this.a.stopMove();
    this.state = 'idle';
    this.heldBy = null; this.grabPending = 0;
    this.baseY = this.pos.y;                       // wherever the fist (or the boss) left him
    this.airborne = true; this.airT = 0; this.fallFrom = this.baseY;
    this.vy = vel ? vel.y : slam ? -16 : 0;
    this.throwVel = vel ? new THREE.Vector3(vel.x, 0, vel.z) : new THREE.Vector3();
    this.thrown = { dmg, from: from ? from.clone() : null, slam };
    const mv = this.startMove('fall');
    mv.holding = true;
    this.state = 'fall';
  }

  // ------------------------------------------------------------------ update

  update(dt, boss) {
    const a = this.a;
    this.boss = boss || null;
    if (dt <= 0) { this.prepActor(0, boss); a.update(0); this.afterActor(0, boss, a.move); return; }
    this.time += dt;
    // teleported (reset, cutscene): stand on the ground where he is now
    if (Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ) > 1.5 && this.state !== 'held') {
      this.baseY = this.giant ? this.giantY() : this.ground(this.pos.x, this.pos.z); this.airborne = false; this.vy = 0; this.seg.valid = false;
    }
    this.pickLock(boss);
    if (this.state !== 'held') this.tryActions(boss);
    this.updateGuard(dt);
    this.regen(dt);
    const x0 = this.pos.x, z0 = this.pos.z;
    const mv = a.move;
    this.spinOff = 0; this.liftY = 0;
    if (this.state === 'held') this.updateHeld(dt);
    else if (mv) this.updateMove(dt, mv, boss);
    else if (!this.dead) this.locomotion(dt, boss);
    this.vertical(dt, x0, z0);
    if (!this.dead && this.state !== 'held') this.hazards(dt);
    if (this.state !== 'held' && !(mv && mv.name === 'critical')) this.collide(boss);
    this.syncRoot();
    this.prepActor(dt, boss);
    a.update(dt);
    // a move held at its hold point (K charging, the fall, the fist) waits exactly there, not one frame past it
    const am = a.move;
    if (am && am.holding) { const h = am.def.holdAt ?? am.def.chargeAt; if (h !== undefined && am.t > h) am.t = h; }
    if (!a.move && MOVE_STATES.has(this.state)) {
      if (this.state === 'attack' && this.lastAttack) this.lastAttackEnd = this.time;
      this.state = 'idle';
    }
    this.afterActor(dt, boss, mv);
    this.lastX = this.pos.x; this.lastZ = this.pos.z;
  }

  updateGuard(dt) {
    const inp = this.input, a = this.a;
    const mvName = a.move ? a.move.name : null;
    // 法相天地 is the simple fight: the guard (like the dodge) answers at once, out of any blow of his own
    if (this.giant && this.state === 'attack' && !this.dead && (inp.isHeld('block') || inp.peek('block', 0.25))) { a.stopMove(); this.state = 'idle'; this.charge = 0; }
    const canGuard = this.canAct() || mvName === 'blockHit' || mvName === 'parry';
    if (canGuard && inp.peek('block', 0.25)) {
      inp.take('block', 0.25);
      this.parryT = this.time;
    }
    const want = inp.isHeld('block') && !this.dead && this.state !== 'held';
    if (want && canGuard) { if (!this.blocking) this.blocking = true; }
    else this.blocking = false;
    const flick = this.time - this.parryT < 0.24;        // a tapped L still raises the rod for the parry
    this.guardW += ((this.blocking || flick ? 1 : 0) - this.guardW) * damp(16, dt);
  }

  regen(dt) {
    const T = this.T;
    if (this.stDelay > 0) this.stDelay -= dt;
    else if (this.state !== 'attack' && this.state !== 'roll' && !this.sprintingNow) {
      this.st = Math.min(T.maxSt, this.st + T.stRegen * dt * (this.blocking ? 0.4 : 1));
    }
    if (!this.dead) this.mp = Math.min(T.maxMp, this.mp + T.mpRegen * dt);
  }

  rootMotion(def, ta, tb, scale = 1) {
    if (!def.moveRoot || tb <= ta) return;
    for (const [t0, t1, dist, e] of def.moveRoot) {
      const u0 = clamp((ta - t0) / (t1 - t0), 0, 1), u1 = clamp((tb - t0) / (t1 - t0), 0, 1);
      if (u0 === u1) continue;
      const f = ease[e || 'out'];
      const step = dist * (f(u1) - f(u0)) * scale * (this.giant ? this.S * this.T.giantStep : 1);
      const y = this.moveYaw ?? this.yaw;
      this.pos.x += Math.sin(y) * step; this.pos.z += Math.cos(y) * step;
    }
  }

  updateMove(dt, mv, boss) {
    const def = mv.def;
    this.sprintingNow = false;
    // K held: wait at the top of the wind-up and gather power
    if (mv.name === 'heavy') {
      if (mv.holding && (!this.input.isHeld('heavy') || mv.hold >= def.chargeMax)) mv.holding = false;
      this.charge = mv.t >= def.chargeAt - 1e-4 ? clamp(mv.hold / def.chargeMax, 0, 1) : 0;
    }
    const holdAt = def.holdAt ?? def.chargeAt;
    const frozen = mv.holding && holdAt !== undefined && mv.t >= holdAt;
    const t0 = mv.t, t1 = frozen ? mv.t : mv.t + dt * mv.speed;
    this.rootMotion(def, t0, t1, mv.rootScale || 1);
    this.poseOffsets(def, t1);
    // turn toward the target during the wind-up (and while charging); free turning with the keys when nothing is near
    const lt = this.lockTarget;
    if (def.track && t0 >= def.track[0] && t0 <= def.track[1]) {
      // the lock pulls the blow round to the weak point - unless the stick points well away from it (the player aims
      // elsewhere: the fan at his face, a blow at the other hand)
      const wish = this.wishDir(_v), wishYaw = Math.atan2(_v.x, _v.z);
      const toLock = lt ? Math.atan2(lt.pos.x - this.pos.x, lt.pos.z - this.pos.z) : 0;
      const overridden = wish > 0.2 && lt && Math.abs(wrap(toLock - wishYaw)) > 0.9;
      if (lt && !overridden && Math.hypot(lt.pos.x - this.pos.x, lt.pos.z - this.pos.z) < 14 * this.S) {
        this.yaw = yawLerp(this.yaw, toLock, def.track[2] * DEG * dt);
      } else if (wish > 0.2) this.yaw = yawLerp(this.yaw, wishYaw, def.track[2] * (overridden ? 1 : 0.5) * DEG * dt);
    }
    if (mv.name === 'critical') this.criticalMotion(dt, t1, boss);
  }

  /** Whole-body turn (spin) and hop (lift) of a move at time t. */
  poseOffsets(def, t) {
    if (def.spin) for (const [s0, s1, deg, e] of def.spin) {
      const u = clamp((t - s0) / (s1 - s0), 0, 1);
      if (u > 0 && u < 1) this.spinOff += deg * DEG * (ease[e || 'inOut'])(u);
    }
    if (def.lift) {
      const [l0, l1, h] = def.lift, u = clamp((t - l0) / (l1 - l0), 0, 1);
      this.liftY = h * 4 * u * (1 - u) * (this.giant ? this.S * this.T.giantLift : 1);
    }
  }

  /** Pose him deterministically at time t of a move (pose sheets, test screenshots). No gameplay side effects. */
  previewPose(name, t, boss = null) {
    const a = this.a;
    a.stopMove();
    const mv = this.startMove(name);
    mv.t = t; mv.holding = false;
    this.spinOff = 0; this.liftY = 0; this.ringW = 0;
    if (name === 'critical' && boss && this.ringPoint(boss)) {
      const keep = this.events.length;
      this.beginCritical(boss);
      this.events.length = keep;
      a.move.t = t;
      this.pos.x = this.critStand.x; this.pos.z = this.critStand.z;
      this.criticalMotion(1, t, boss);
    }
    this.poseOffsets(mv.def, t);
    this.syncRoot();
    this.prepActor(0, boss);
    a.update(0);
    this.afterActor(0, boss, a.move || mv);
    return mv;
  }

  criticalMotion(dt, t, boss) {
    if (!this.critStand) return;
    // follow the ring if the head moves
    if (boss && boss.noseRing) { const r = boss.noseRing(); if (r) this.ringPos.copy(r); }
    const ring = this.ringPos;
    if (t < 0.34) {               // the dash (a leap when it is far)
      const k = 1 - Math.exp(-14 * dt);
      this.pos.x += (this.critStand.x - this.pos.x) * k; this.pos.z += (this.critStand.z - this.pos.z) * k;
      if (this.critDist > 3) this.liftY = Math.max(this.liftY, Math.min(1.2, this.critDist * 0.12) * Math.sin(Math.PI * clamp(t / 0.34, 0, 1)));
    }
    this.yaw = Math.atan2(ring.x - this.pos.x, ring.z - this.pos.z);
    // haul up on the ring, hang there for the blow, drop
    const L = this.critLift || 0;
    let u = 0;
    if (t >= 0.36 && t < 0.62) u = ease.out((t - 0.36) / 0.26);
    else if (t >= 0.62 && t < 1.28) u = 1;
    else if (t >= 1.28 && t < 1.52) u = 1 - ease.in((t - 1.28) / 0.24);
    this.liftY = Math.max(this.liftY, L * u);
    // the left fist on the ring
    if (t < 0.28) this.ringW = 0;
    else if (t < 0.38) this.ringW = (t - 0.28) / 0.1;
    else if (t < 1.3) this.ringW = 1;
    else if (t < 1.42) this.ringW = 1 - (t - 1.3) / 0.12;
    else this.ringW = 0;
  }

  locomotion(dt, boss) {
    const T = this.T, a = this.a;
    const wish = this.wishDir(_v);
    const sprint = wish > 0.3 && this.input.sprinting() && this.st > 0 && !this.blocking;
    this.sprintingNow = sprint;
    let target = wish < 0.05 ? 0 : wish < 0.6 && !this.giant ? T.walkSpeed : T.runSpeed;
    if (this.blocking) target = Math.min(target, T.walkSpeed * 0.8);
    if (this.giant && this.backpedal && target > 0 && !this.blocking) target = this.T0.giantBack;       // (backing off a giant's blow is the fastest he moves)
    if (sprint) { target = T.sprintSpeed; this.st -= T.sprintCost * dt; this.stDelay = T.stDelay; }
    this.speed += (target - this.speed) * damp(target > this.speed ? 10 : 14, dt);
    let twist = 0;
    this.backpedal = false;
    const lt = this.lockTarget;
    // (a giant is locked on: standing still he turns back to the bull too - after a tumble, when the bull circles him)
    if (this.giant && lt && wish <= 0.05) this.yaw = yawLerp(this.yaw, Math.atan2(lt.pos.x - this.pos.x, lt.pos.z - this.pos.z), 12 * dt);
    if (wish > 0.05) {
      const want = Math.atan2(_v.x, _v.z);
      if ((this.blocking || this.giant) && lt) {       // (a giant stays locked even at a sprint)
        // guarding (and a giant, always: he is locked on the bull): keep the rod toward the target and side-step
        this.yaw = yawLerp(this.yaw, Math.atan2(lt.pos.x - this.pos.x, lt.pos.z - this.pos.z), 12 * dt);
        const rel = wrap(want - this.yaw);
        if (Math.abs(rel) > 1.95) { this.backpedal = true; twist = rel - Math.sign(rel) * Math.PI; }
        else twist = clamp(rel, -1.05, 1.05);
      } else this.yaw = yawLerp(this.yaw, want, 12 * dt);
      this.pos.x += Math.sin(want) * this.speed * dt;
      this.pos.z += Math.cos(want) * this.speed * dt;
      this.state = 'move';
    } else {
      this.pos.x += Math.sin(this.yaw) * this.speed * dt * 0.3;
      this.pos.z += Math.cos(this.yaw) * this.speed * dt * 0.3;
      this.state = 'idle';
    }
    this.twist += (twist - this.twist) * damp(10, dt);
    this.sprintW += ((sprint ? 1 : 0) - this.sprintW) * damp(6, dt);
    const tw = this.twist / DEG;
    a.extra = { hipsTurn: [0, tw, 0], spine: [10 * this.sprintW, -tw * 0.8, 0], head: [-6 * this.sprintW, 0, 0] };
    a.extraW = Math.min(1, Math.max(Math.abs(this.twist) * 3, this.sprintW));
    this.updateLocomotionAnim();
    this.footsteps(dt);
  }

  updateLocomotionAnim() {
    const a = this.a;
    if (this.speed < 0.15 * this.S) { a.playBase('idle', { fade: 0.25 }); return; }
    // (a giant runs whichever way he goes - sideways, backwards - with his face to the bull)
    const useRun = this.giant ? this.speed > this.T.runSpeed * 0.6 : this.speed > 2.6 && !this.backpedal;
    const name = useRun && a.actions.run ? 'run' : 'walk';
    const natural = a.clipSpeed(name) || (useRun ? 4 : 1.2);
    a.playBase(name, { fade: 0.22 });
    // a giant's legs keep a runner's cadence (his strides are not twenty times longer: the ground slides a little)
    const rate = this.giant ? clamp(this.speed / this.T.runSpeed, 0.6, 1.3) * (useRun ? 1 : 1.3) : clamp(this.speed / (natural * this.S), 0.55, 1.7);
    a.setBaseTimeScale(rate * (this.backpedal ? -1 : 1));
  }

  footsteps(dt) {
    if (this.giant) {       // a giant's tread: the ground answers
      if (this.speed < 2) { this.footAcc = 0; return; }
      // (by the clock, not the distance: at a run he covers 50 m a second, and a footfall every 11 m shook the lens
      // four times a second - it read as dropped frames)
      this.footAcc += dt;
      if (this.footAcc < 0.36) return;
      this.footAcc -= 0.36; this.footSide ^= 1;
      const foot = this.a.bonePos(this.footSide ? 'LeftFoot' : 'RightFoot', new THREE.Vector3());
      foot.y = this.ground(foot.x, foot.z);
      this.fx.dust?.(foot, 3.5, 16);
      this.sfx(['bull_stomp', 'boss_step'], { pos: foot, volume: 0.4, pitch: 1.25 });
      return;
    }
    if (this.speed < 0.4) { this.footAcc = 0; return; }
    const stride = this.speed > 2.6 ? 1.05 : 0.7;
    this.footAcc += this.speed * dt;
    if (this.footAcc < stride) return;
    this.footAcc -= stride;
    this.footSide ^= 1;
    const foot = this.a.bonePos(this.footSide ? 'LeftFoot' : 'RightFoot', new THREE.Vector3());
    if (this.speed > 3.5) this.fx.dust?.(foot, 0.22, this.speed > 5.5 ? 4 : 2);
    this.sfx(['step_ash', 'step_stone'], { pos: foot, volume: this.speed > 4.5 ? 0.9 : 0.6 });
  }

  updateHeld(dt) {
    this.heldT += dt;
    if (this.heldBy) {
      const p = this.heldBy();
      if (p) this.pos.set(p.x, p.y - 0.85, p.z);
    }
    this.baseY = this.pos.y;
    if (this.heldT > 7) this.release({ dmg: 0, slam: false });     // safety: never stuck in a fist
  }

  vertical(dt, x0, z0) {
    const T = this.T, a = this.a;
    if (this.state === 'held') return;
    if (this.giant) { this.baseY += (this.giantY() - this.baseY) * damp(8, dt); this.airborne = false; this.vault = null; return; }
    if (this.vault) {
      const v = this.vault;
      v.t += dt;
      const u = clamp(v.t / v.dur, 0, 1);
      this.baseY = v.y0 + (v.y1 - v.y0) * ease.out(u);
      if (u >= 1) this.vault = null;
    } else if (this.airborne) {
      this.airT += dt;
      this.vy -= T.gravity * dt;
      this.baseY += this.vy * dt;
      if (this.throwVel) { this.pos.x += this.throwVel.x * dt; this.pos.z += this.throwVel.z * dt; this.throwVel.multiplyScalar(Math.exp(-0.6 * dt)); }
      const g = this.ground(this.pos.x, this.pos.z);
      if (!a.move && this.airT > 0.25 && !this.dead) { const mv = this.startMove('fall'); mv.holding = true; }
      if (this.baseY <= g) this.land(g);
    } else {
      const g = this.ground(this.pos.x, this.pos.z), dy = g - this.baseY;
      if (dy > T.stepUp) {
        const ok = dy <= T.vaultMax && !this.dead && this.speed > 1 && (this.state === 'move' || this.state === 'roll' || this.state === 'idle');
        if (ok) {
          this.vault = { y0: this.baseY, y1: g, t: 0, dur: 0.24 };
          if (!a.move) this.startMove('vault');
          this.sfx(['swing_light'], { pos: this.pos, volume: 0.3, pitch: 0.6 });
        } else { this.pos.x = x0; this.pos.z = z0; this.speed *= 0.5; }
      } else if (dy < -0.45) {
        this.airborne = true; this.vy = 0; this.airT = 0; this.fallFrom = this.baseY; this.throwVel = null;
      } else this.baseY += dy * damp(20, dt);
    }
  }

  land(g) {
    const T = this.T, a = this.a;
    const h = this.fallFrom - g;
    this.baseY = g; this.airborne = false; this.vy = 0; this.throwVel = null;
    if (a.move && a.move.name === 'fall') a.stopMove();
    if (this.state === 'fall') this.state = 'idle';
    this.fx.dust?.(this.pos, h > 2 ? 1.4 : 0.6, h > 2 ? 22 : 8);
    if (this.thrown) {
      const th = this.thrown; this.thrown = null;
      this.cam.addTrauma?.(0.6);
      this.sfx(['bull_slam', 'boss_slam'], { pos: this.pos, volume: 0.45, pitch: 1.4 });
      if (th.dmg > 0) {
        if (!this.dead) this.hurt(th.dmg, th.from || this.pos.clone().add(new THREE.Vector3(0, 0, 1)), 'heavy');
      } else if (!this.dead) this.startMove('knockdown');
    } else if (h > 2.2 && !this.dead) {
      this.startMove('land');
      this.cam.addTrauma?.(Math.min(0.4, h * 0.05));
    }
    this.events.push({ type: 'landed', height: h });
    void T;
  }

  hazards(dt) {
    const T = this.T;
    if (this.giant || !this.lavaDamage || !this.arena.lavaAt || this.airborne || this.liftY > 0.25) return;
    const lv = this.arena.lavaAt(this.pos.x, this.pos.z) || 0;
    if (lv <= 0.5 || this.invulnerable()) { this.burnT = 0; return; }
    const k = (lv - 0.5) * 2;
    this.hp -= T.lavaDps * k * dt;
    if (this.god) this.hp = Math.max(this.hp, 1);
    this.burnT -= dt;
    if (this.burnT <= 0) {
      this.burnT = 0.45;
      const ember = new THREE.Color(1.0, 0.42, 0.12);
      for (let i = 0; i < 10; i++) this.fx.add?.emit(new THREE.Vector3(this.pos.x + rand(-0.3, 0.3), this.pos.y + rand(0, 0.6), this.pos.z + rand(-0.3, 0.3)),
        new THREE.Vector3(rand(-0.4, 0.4), rand(0.8, 2.2), rand(-0.4, 0.4)), ember, { size: rand(0.02, 0.05), life: rand(0.4, 0.9), drag: 1, grav: 0.6, alpha: 0.9 });
      this.fx.flashMesh?.(this.a.char.model, new THREE.Color(1, 0.4, 0.15), 0.2, 0.5);
      this.sfx(['player_hurt'], { pos: this.pos, volume: 0.45, pitch: 1.1 });
      this.events.push({ type: 'burn', hitstop: 0 });
    }
    if (this.hp <= 0) this.die(null);
  }

  /** Pillars and steles (arena), the giant's limbs (his hurt zones as solid capsules). */
  collide(boss) {
    const T = this.T;
    if (this.giant && this.arena.bounds) {       // only the walls of the caldera hold a giant
      const b = this.arena.duelBounds || this.arena.bounds, r = T.radius * 0.6;
      this.pos.x = clamp(this.pos.x, b.minX + r, b.maxX - r); this.pos.z = clamp(this.pos.z, b.minZ + r, b.maxZ - r);
      this.arena.pitClamp?.(this.pos, 0.9);        // (the pit is round: the rectangle's corners are cliff)
    } else if (this.arena.bounds) clampToArena(this.pos, this.arena, T.radius);
    if (!this.collideBoss || !boss || boss.dead) return;
    if (boss.colliders) {
      for (const c of boss.colliders() || []) {
        if (!c.r) continue;
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + T.radius;
        if (d < m && d > 1e-6) { this.pos.x = c.x + dx / d * m; this.pos.z = c.z + dz / d * m; }
      }
      return;
    }
    if (!boss.hurtZones) return;
    const zones = boss.hurtZones();
    if (!zones) return;
    const lo = _a.set(this.pos.x, this.pos.y + 0.25 * this.S, this.pos.z), hi = _b.set(this.pos.x, this.pos.y + 1.35 * this.S, this.pos.z);
    for (const z of zones) {
      const res = segSeg(lo, hi, z.a, z.b, _c1, _c2);
      const min = z.r + T.radius;
      if (res.dist >= min) continue;
      let dx = _c1.x - _c2.x, dz = _c1.z - _c2.z, h = Math.hypot(dx, dz);
      if (h < 1e-4) { dx = this.pos.x - (z.a.x + z.b.x) / 2; dz = this.pos.z - (z.a.z + z.b.z) / 2; h = Math.hypot(dx, dz) || 1; }
      const push = min - res.dist;
      this.pos.x += dx / h * push; this.pos.z += dz / h * push;
      lo.x = hi.x = this.pos.x; lo.z = hi.z = this.pos.z;
    }
  }

  syncRoot() {
    this.pos.y = this.baseY + this.liftY;
    this.root.rotation.y = this.yaw + this.spinOff;
    this.root.updateMatrixWorld(true);
  }

  /** Stance overlay for the actor: ready / carried / guard, and the sprint lean. */
  prepActor(dt, boss) {
    const a = this.a;
    const wantCarry = this.carry === null ? !boss && this.state !== 'attack' && !this.dead : this.carry;
    const carryGoal = wantCarry && this.guardW < 0.05 ? 1 : 0;
    this.carryW += (carryGoal - this.carryW) * (dt > 0 ? damp(carryGoal ? 3 : 9, dt) : 0);
    const bw = Math.min(this.guardW, 1 - this.carryW);
    a.guard = bw > 0.001 || this.carryW < 0.001 ? this.guardTrack.evaluate(bw) : this.carryTrack.evaluate(this.carryW);
    a.guardW = this.dead ? 0 : 1;
    if (a.move && dt > 0) { a.extraW *= 1 - damp(10, dt); this.sprintW = 0; this.twist = 0; }
  }

  // ------------------------------------------------------------------ after the pose: the rod, the left hand, the fan

  staffVal(name, dflt) {
    const a = this.a, gp = a.guard, mp = a.lastPose, W = a.move ? a.moveW : 0;
    let v = gp && typeof gp[name] === 'number' ? dflt + (gp[name] - dflt) * Math.min(1, a.guardW) : dflt;
    if (mp && W > 0 && typeof mp[name] === 'number') v += (mp[name] - v) * W;
    return v;
  }

  /**
   * 拖影 (2026-11-17 user: "翻滚时无敌有拖影"): through a roll or a step, every few hundredths of a second a glowing
   * copy of him is left behind in that pose and fades. A small pool of copies (cloned once; each spawn copies the
   * live pose onto one), drawn additive, no shadows.
   */
  ghostTrail(dt, mv) {
    const on = mv && !this.dead && mv.def.iframes && (ROLLS.has(mv.name) || /^dodge/.test(mv.name)) && mv.t <= mv.def.iframes[1];
    const root = this.a?.char?.root;
    if (!root || !root.parent) return;
    if (!this._trail) {
      if (!on) return;
      const pool = [];
      for (let i = 0; i < 6; i++) {
        // (clone() deep-copies userData through JSON, and the look keeps a circular reference there: set it aside)
        const saved = []; root.traverse(o => { saved.push([o, o.userData]); o.userData = {}; });
        let g;
        try { g = SkeletonUtils.clone(root); } finally { for (const [o, u] of saved) o.userData = u; }
        const pairs = [], live = [], copy = [];
        root.traverse(o => live.push(o)); g.traverse(o => copy.push(o));
        for (let k = 0; k < Math.min(live.length, copy.length); k++) pairs.push([live[k], copy[k]]);
        const mats = [];
        g.traverse(o => {
          if (o.isLight || o.isSprite || o.isPoints) { o.visible = false; return; }
          if (!o.isMesh) return;
          o.material = new THREE.MeshBasicMaterial({ color: 0xffc977, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
          o.castShadow = o.receiveShadow = false; o.frustumCulled = false; mats.push(o.material);
        });
        g.visible = false; root.parent.add(g);
        pool.push({ g, pairs, mats, t: 1, life: 0.3 });
      }
      this._trail = { pool, next: 0, cd: 0 };
    }
    const T = this._trail;
    if (on && (T.cd -= dt) <= 0) {
      T.cd = 0.045;
      const q = T.pool[T.next]; T.next = (T.next + 1) % T.pool.length;
      for (const [a, b] of q.pairs) { b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); b.visible = a.visible; }
      q.g.visible = true; q.t = 0;
    }
    if (!on) T.cd = 0;
    for (const q of T.pool) {
      if (!q.g.visible) continue;
      q.t += dt;
      const a = Math.max(0, 1 - q.t / q.life) * 0.32;
      for (const m of q.mats) m.opacity = a;
      if (a <= 0) q.g.visible = false;
    }
  }

  afterActor(dt, boss, mv) {
    // a tumble turns him about his hips, and with the tuck that put his head and back under the floor for a few
    // frames (a giant vanished into the lake): carry the whole body up so that nothing of his trunk goes below it
    if (mv && ROLLS.has(mv.name) && !mv.def.air && this.a.char.pivot) {
      // ... and in the middle of a ground roll the ball sits ON the floor: whichever is lowest (trunk, head, a foot or
      // a hand) is brought down to it as well as up, so he never floats a hand's breadth above the rock
      const pv = this.a.char.pivot, S = this.S, P = (n, v) => this.a.bonePos(n, v).y;
      const trunk = Math.min(P('Hips', _a), P('Head', _b), P('Spine2', _c1)) - (this.pos.y + 0.13 * S);
      const limbs = Math.min(P('LeftFoot', _a), P('RightFoot', _b), P('LeftHand', _c1), P('RightHand', _c2)) - (this.pos.y + 0.05 * S);
      let d = -Math.min(trunk, limbs);
      if (d < 0) { const t = mv.t; d *= Math.max(0, Math.min(1, (t - 0.01) / 0.05)) * Math.max(0, Math.min(1, (0.56 - t) / 0.1)); }
      if (Math.abs(d) > 1e-4) { pv.position.y += d / S; pv.updateMatrixWorld(true); this.a.grip.y += d; }   // (the fist moved with him)
    }
    this.ghostTrail(dt, mv);
    this.updateStaff(mv);
    this.leftHand();
    this.updateFan();
    if (mv && dt > 0 && !this.dead) {
      this.moveEvents(mv, boss);
      this.checkHits(mv, boss);
    }
    if (mv && dt > 0 && mv.name === 'critical' && !this.dead) this.criticalEvents(mv, boss);
    this.updateTrail(mv);
    this.chargeFx(dt, mv);
  }

  updateStaff(mv) {
    const s = this.staff, a = this.a;
    if (!s) return;
    const ud = s.userData;
    const slide = clamp(this.staffVal('slide', ud.baseGf), 0.05, 0.6);
    const grow = clamp(this.staffVal('grow', 1), 0.5, 2.5);
    ud.gripFrac = slide;
    if (ud.inner) ud.inner.position.y = ud.baseY - (slide - ud.baseGf) * ud.length;
    s.scale.set(this.S, grow * this.S, this.S);
    // rolls and falls: the rod turns with the body
    const pose = a.lastPose;
    if (mv && mv.def.pivotBlade && pose && pose.pblade && a.move) {
      const pb = pose.pblade;
      a.char.pivot.getWorldQuaternion(_q);
      const d = _v.set(-pb[0], pb[1], pb[2]).normalize().applyQuaternion(_q);
      d.lerp(a.bladeDir, 1 - a.moveW).normalize();
      a.bladeDir.copy(d);
      const x = _f.crossVectors(d, a.rig.U);
      if (x.lengthSq() < 1e-6) x.crossVectors(d, a.rig.F);
      x.normalize();
      const z = _r.crossVectors(x, d).normalize();
      _m.makeBasis(x, d, z);
      s.quaternion.setFromRotationMatrix(_m);
      s.position.copy(a.grip);
    }
    s.updateMatrixWorld(true);
    const seg = this.seg, L = ud.length * grow * this.S, dir = a.bladeDir, g = a.grip;
    seg.pbutt.copy(seg.butt); seg.ptip.copy(seg.tip);
    seg.butt.copy(g).addScaledVector(dir, -L * slide);
    seg.tip.copy(g).addScaledVector(dir, L * (1 - slide));
    if (!seg.valid) { seg.pbutt.copy(seg.butt); seg.ptip.copy(seg.tip); seg.valid = true; }
  }

  /** Left fist onto the rod (two-handed blows, the guard) or onto the giant's nose ring (the execution). */
  leftHand() {
    const a = this.a, rig = a.rig, B = rig.b;
    if (!B.LeftArm || !B.LeftForeArm || !B.LeftHand) return;
    let w = 0;
    const target = _a;
    if (this.ringW > 0.001 && this.ringPos && a.move && a.move.name === 'critical') {
      w = this.ringW; target.copy(this.ringPos);
    } else {
      w = clamp(this.staffVal('lhand', 0), 0, 1);
      if (w < 0.01 || !this.staff) return;
      const at = this.staffVal('lhAt', -0.34) * (this.staff.scale.y || 1);
      target.copy(a.grip).addScaledVector(a.bladeDir, at);
    }
    if (w < 0.01) return;
    // the wrist sits a few centimetres short of the palm
    const sh = B.LeftArm.getWorldPosition(_b);
    const toT = _c1.subVectors(target, sh);
    const len = toT.length();
    if (len > 1e-4) target.addScaledVector(toT, -0.055 * (a.char.height / 1.5) / len);
    rig.frame();
    const pole = rig.dir([-0.6, -0.65, -0.3], _c2);
    rig.ik(B.LeftArm, B.LeftForeArm, B.LeftHand, target, pole, w);
    if (this.ringW > 0.001 && a.move && a.move.name === 'critical') {
      if (w - rig.curled.Left > 0.05) rig.curl('Left', w - rig.curled.Left, 1);
    } else a.fistLeft(w);            // on the rod: the knuckles along it, the fist closed round it
  }

  updateFan() {
    const v = clamp(this.staffVal('fan', 0), 0, 1);
    const fan = this.fan;
    if (v < 0.01 || this.dead) { fan.visible = false; return; }
    const B = this.a.rig.b;
    const hand = B.LeftHand.getWorldPosition(_a), fore = B.LeftForeArm.getWorldPosition(_b), mid = B.LeftHandMiddle1 ? B.LeftHandMiddle1.getWorldPosition(_c1) : hand;
    const y = _v.subVectors(hand, fore).normalize();
    const z = _f.crossVectors(_UP, y);
    if (z.lengthSq() < 1e-4) z.copy(this.a.rig.F);
    z.normalize();
    const x = _r.crossVectors(y, z).normalize();
    _m.makeBasis(x, y, z);
    fan.quaternion.setFromRotationMatrix(_m);
    fan.position.copy(hand).lerp(mid, 0.75);
    fan.scale.setScalar(ease.out(v) * (this.giant ? this.S : 1));
    fan.visible = true;
  }

  // ------------------------------------------------------------------ move events and hits

  moveEvents(mv, boss) {
    const def = mv.def, t = mv.t;
    if (def.hits) def.hits.forEach(([t0], i) => {
      const key = 'sw' + i;
      if (mv.fired.has(key) || t < t0 - 0.06) return;
      mv.fired.add(key);
      const heavy = mv.name === 'heavy' || mv.name === 'light3' || mv.name === 'runAttack' || (mv.name === 'finisher' && i === 1);
      const p = heavy ? 0.82 + (mv.name === 'heavy' ? -0.08 * this.charge : 0) : 1 + (COMBO.indexOf(mv.name) % 3) * 0.05;
      this.sfx(['staff_swing', heavy ? 'swing_heavy' : 'swing_light'], { pos: this.seg.tip, pitch: p, volume: heavy ? 1 : 0.85 });
    });
    if (def.impactAt !== undefined && !mv.fired.has('impact') && t >= def.impactAt) { mv.fired.add('impact'); this.groundImpact(mv, boss); }
    if (def.fanAt !== undefined && !mv.fired.has('fan') && t >= def.fanAt) { mv.fired.add('fan'); this.releaseFan(boss); }
    if (def.lift && !mv.fired.has('landing') && t >= def.lift[1]) { mv.fired.add('landing'); this.fx.dust?.(this.pos, 0.7, 10); }
  }

  checkHits(mv, boss) {
    const def = mv.def;
    if (!def.hits || !boss || boss.dead || !boss.hurtZones || !this.seg.valid) return;
    const t = mv.t;
    for (let i = 0; i < def.hits.length; i++) {
      const [t0, t1, info] = def.hits[i];
      if (mv.landed.has(i) || t < t0 || t > t1) continue;
      const s = this.seg;
      const hit = sweepStaff(s.pbutt, s.ptip, s.butt, s.tip, boss.hurtZones(), this.T.staffRadius);
      if (!hit) continue;
      mv.landed.add(i);
      this.landHit(mv, info, hit, boss);
      return;
    }
  }

  landHit(mv, info, hit, boss) {
    const T = this.T;
    const heavyMove = mv.name === 'heavy';
    const charge = heavyMove ? this.charge : 0, full = heavyMove && this.charge >= 0.999;
    const mult = 1 + charge * 0.8 + (full ? 0.4 : 0);
    const heavy = !!info.heavy || full;
    const dir = new THREE.Vector3().subVectors(this.seg.tip, this.seg.ptip);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    dir.normalize();
    boss.takeHit({ dmg: T.baseDmg * info.dmg * mult, poise: info.poise * mult, point: hit.point, dir, heavy, from: this.pos.clone(),
      part: hit.part, charge, full, kind: mv.name });
    if (boss.hitFx === false) this.hitFx(hit.point, dir, heavy, hit.part);
    this.mp = Math.min(T.maxMp, this.mp + T.mpPerHit);
    this.events.push({ type: 'hit', hitstop: info.hitstop * (full ? 1.5 : 1) * (boss.staggered ? 1.3 : 1), heavy, part: hit.part, full, move: mv.name });
  }

  hitFx(point, dir, heavy, part) {
    const fx = this.fx;
    fx.hitSpark?.(point, dir, heavy);
    if (part && part !== 'body') {             // a lava crack: embers spill out
      const ember = new THREE.Color(1.0, 0.36, 0.08);
      for (let i = 0; i < (heavy ? 30 : 16); i++) {
        const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, heavy ? 6 : 4)).addScaledVector(dir, -1.5);
        fx.add?.emit(point, v, ember, { size: rand(0.02, 0.06), life: rand(0.35, 0.9), drag: 2, grav: -6, alpha: 0.95 });
      }
      fx.light?.(point, 0xff6a2a, heavy ? 30 : 16, 0.22, 8);
    } else fx.dust?.(point, 0.5, heavy ? 12 : 6);
    this.sfx([heavy ? 'staff_hit_heavy' : 'staff_hit', heavy ? 'hit_heavy' : 'block'], { pos: point, pitch: heavy ? 0.9 : 0.75 + Math.random() * 0.1, volume: heavy ? 1 : 0.8 });
  }

  groundImpact(mv, boss) {
    const tip = this.seg.tip, g = this.ground(tip.x, tip.z);
    if (tip.y - g > 1.2) return;
    const p = new THREE.Vector3(tip.x, g, tip.z);
    const heavyMove = mv.name === 'heavy';
    const full = heavyMove && this.charge >= 0.999;
    const big = heavyMove || mv.name === 'runAttack';
    const fx = this.fx;
    fx.dust?.(p, big ? 1.4 : 0.7, big ? (full ? 40 : 24) : 10);
    fx.shockwave?.(p, full ? 3.6 : big ? 2.3 : 1.1, 0.42, new THREE.Color(0.32, 0.18, 0.09));
    fx.light?.(new THREE.Vector3(p.x, p.y + 0.4, p.z), 0xff7a3a, full ? 34 : big ? 16 : 7, 0.18, 6);
    const chip = new THREE.Color(0.9, 0.42, 0.14);
    for (let i = 0; i < (full ? 26 : big ? 12 : 5); i++) {
      fx.add?.emit(new THREE.Vector3(p.x, p.y + 0.05, p.z), new THREE.Vector3(rand(-2, 2), rand(1.5, 4.5), rand(-2, 2)), chip,
        { size: rand(0.015, 0.04), life: rand(0.3, 0.7), drag: 1.2, grav: -12, alpha: 0.9 });
    }
    this.cam.addTrauma?.(full ? 0.5 : big ? 0.3 : 0.14);
    if (full) { this.cam.zoomPunch?.(2.5); this.arena.shake?.(0.35); }
    this.sfx(['rock_crack', 'wax_crack'], { pos: p, volume: full ? 1 : big ? 0.8 : 0.5, pitch: big ? 0.7 : 0.9 });
    this.events.push({ type: 'impact', point: p.clone(), strength: full ? 1 : big ? 0.6 : 0.3 });
    // the blast catches what the rod itself missed (a hand flat on the stone)
    if (!boss || boss.dead || !boss.hurtZones || !mv.def.hits || mv.landed.size) return;
    const R = full ? 2.4 : big ? 1.4 : 0.7;
    let best = null, bp = -1;
    for (const z of boss.hurtZones()) {
      const res = segSeg(p, p, z.a, z.b, _c1, _c2);
      if (res.dist - z.r > R) continue;
      const pr = z.part === 'body' ? 0 : 1;
      if (pr > bp) { bp = pr; best = { zone: z, point: _c2.clone().add(_c1.clone().sub(_c2).setLength(Math.min(z.r, res.dist))), part: z.part }; }
    }
    if (!best) return;
    mv.landed.add(0);
    this.landHit(mv, mv.def.hits[0][2], best, boss);
  }

  /** 芭蕉扇: a cone of wind from the chest along the facing. */
  releaseFan(boss) {
    const T = this.T;
    const dir = new THREE.Vector3(Math.sin(this.yaw), Math.sin(8 * DEG), Math.cos(this.yaw)).normalize();
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + 1.0 * this.S, this.pos.z).addScaledVector(dir, 0.3 * this.S);
    const range = this.giant ? T.fanRange * 0.45 : T.fanRange, angle = T.fanAngle * (this.giant ? 1.25 : 1);
    const parts = [];
    let result = null;
    if (boss && !boss.dead && boss.hurtZones) {
      for (const z of boss.hurtZones()) if (z.part !== 'body' && !parts.includes(z.part) && coneHitsCapsule(origin, dir, range, angle, z)) parts.push(z.part);
    }
    if (boss && !boss.dead && boss.fanned) {
      result = boss.fanned({ from: origin.clone(), dir: new THREE.Vector3(dir.x, 0, dir.z).normalize(), range, angle }) || null;
    } else if (boss && !boss.dead) {
      // a boss without its own gust handling: the weak points in the cone are knocked off balance
      for (const z of boss.hurtZones ? boss.hurtZones() : []) {
        if (!parts.includes(z.part)) continue;
        boss.takeHit?.({ dmg: T.baseDmg * 0.25, poise: 30, point: z.a.clone().lerp(z.b, 0.5), dir: dir.clone(), heavy: false, from: this.pos.clone(), part: z.part, kind: 'fan', fan: true });
      }
      boss.onFan?.({ origin: origin.clone(), dir: dir.clone(), range, angle, from: this });
    }
    this.arena.fanGust?.(origin.clone(), dir.clone(), range, angle);
    this.windFx(origin, dir, range, angle);
    if (this.giant && this.fx.alpha) {        // a giant's gust: a wall of pale ash thrown across the caldera
      const side = new THREE.Vector3(-dir.z, 0, dir.x), pale = new THREE.Color(0.66, 0.64, 0.6);
      for (let i = 0; i < 46; i++) {
        const a = (Math.random() * 2 - 1) * angle, v = dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
        this.fx.alpha.emit(origin.clone().addScaledVector(v, 4 + Math.random() * 18).add(new THREE.Vector3(0, (Math.random() - 0.5) * 16, 0)), v.multiplyScalar(70 + Math.random() * 60),
          pale, { size: 5 + Math.random() * 9, life: 0.5 + Math.random() * 0.5, drag: 1.2, grav: 0, alpha: 0.28, grow: 1.6 });
      }
    }
    this.sfx(['fan_wind', 'swing_heavy'], { pos: origin, pitch: 0.55, volume: 1 });
    this.cam.addTrauma?.(0.22); this.cam.zoomPunch?.(2);
    this.events.push({ type: 'fan', origin: origin.clone(), dir: dir.clone(), range, angle, parts, reflected: !!result?.reflected, armor: !!result?.armor, extinguished: result?.extinguished || 0, exposed: result?.exposed || [] });
  }

  windFx(origin, dir, range, angle) {
    const fx = this.fx;
    if (!fx.alpha) return;
    const ash = new THREE.Color(0.42, 0.39, 0.36), pale = new THREE.Color(0.62, 0.6, 0.56), ember = new THREE.Color(1.0, 0.45, 0.15);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i < 140; i++) {
      const a = rand(-angle, angle) * 0.95, el = rand(-0.35, 0.5) * angle;
      const d = dir.clone().applyAxisAngle(_UP, a);
      d.y += el; d.normalize();
      const p = origin.clone().addScaledVector(d, rand(0.2, 1.5)).addScaledVector(side, rand(-0.2, 0.2));
      const sp = rand(9, 17);
      fx.alpha.emit(p, d.multiplyScalar(sp), Math.random() < 0.5 ? ash : pale,
        { size: rand(0.18, 0.5), life: rand(0.5, 1.0) * range / 13, drag: 1.3, grav: 0.3, alpha: rand(0.1, 0.22), grow: 2.4 });
    }
    for (let i = 0; i < 30; i++) {
      const d = dir.clone().applyAxisAngle(_UP, rand(-angle, angle)); d.y += rand(-0.1, 0.25); d.normalize();
      fx.add?.emit(origin.clone().addScaledVector(d, rand(0.5, 2)), d.multiplyScalar(rand(8, 14)), ember, { size: rand(0.015, 0.035), life: rand(0.4, 0.9), drag: 1.5, grav: 0.4, alpha: 0.8 });
    }
    // the ground ash swept along the cone floor
    for (let i = 1; i <= 5; i++) {
      const p = origin.clone().addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), i * range / 6);
      p.y = this.ground(p.x, p.z);
      fx.dust?.(p, 0.6 + i * 0.35, 8);
    }
  }

  criticalEvents(mv, boss) {
    const def = mv.def, t = mv.t;
    if (!mv.fired.has('grab') && t >= def.grabAt) {
      mv.fired.add('grab');
      this.sfx(['ring_grab', 'block'], { pos: this.ringPos || this.pos, pitch: 0.55, volume: 0.9 });
      this.cam.addTrauma?.(0.15);
      boss?.onCriticalGrab?.(this);
    }
    if (!mv.fired.has('crit') && t >= def.hitAt) {
      mv.fired.add('crit');
      const point = this.seg.tip.clone();
      const dir = new THREE.Vector3().subVectors(this.seg.tip, this.seg.ptip);
      if (dir.lengthSq() < 1e-6) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      dir.normalize();
      boss?.takeCritical?.({ dmg: this.T.baseDmg * this.T.critMult, point, dir, from: this.pos.clone() });
      if (boss && boss.hitFx === false) {
        this.fx.hitSpark?.(point, dir, true); this.fx.hitSpark?.(point, dir.clone().negate(), true);
        this.hitFx(point, dir, true, 'head');
      }
      this.fx.dust?.(point, 1.2, 20);
      this.cam.addTrauma?.(0.6); this.cam.zoomPunch?.(5);
      this.input.rumble?.(1, 0.8, 300);
      this.events.push({ type: 'critical', point });
    }
  }

  updateTrail(mv) {
    if (!this.trail || !mv || !mv.def.hits || !this.seg.valid) return;
    const t = mv.t;
    if (!mv.def.hits.some(h => t >= h[0] - 0.05 && t <= h[1] + 0.04)) return;
    _v.copy(this.seg.butt).lerp(this.seg.tip, 0.45);
    this.trail.push(_v, this.seg.tip, this.fx.now);
  }

  chargeFx(dt, mv) {
    const charging = mv && mv.name === 'heavy' && mv.holding && mv.t >= mv.def.chargeAt - 1e-4 && !this.dead;
    const want = charging ? 0.12 + this.charge * 0.9 : 0;
    this.glow += (want - this.glow) * (dt > 0 ? damp(charging ? 10 : 4, dt) : 0);
    const mats = this.staff && this.staff.userData.goldMats;
    if (mats) for (const m of mats) m.emissiveIntensity = this.glow * 1.3;
    const fx = this.fx, s = this.seg;
    // full charge (also on the frame the hold runs out and the smash starts by itself)
    if (mv && mv.name === 'heavy' && dt > 0 && this.charge >= 0.999 && !this.chargeFull && !this.dead) {
      this.chargeFull = true;
      fx.glint?.(s.tip.clone(), 0.8, 0.35, 0xffc890);
      this.sfx(['charge_full', 'block'], { pos: s.tip, pitch: 1.6, volume: 0.4 });
      this.cam.zoomPunch?.(1.5);
      this.events.push({ type: 'charge-full' });
    }
    if (!charging || dt <= 0) return;
    const ember = new THREE.Color(1.0, 0.5, 0.16);
    if (Math.random() < 0.3 + this.charge * 0.6) {
      const end = Math.random() < 0.5 ? s.tip : s.butt;
      const off = new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.35, 0.7));
      fx.add?.emit(end.clone().add(off), off.clone().multiplyScalar(-2.2), ember, { size: rand(0.015, 0.035), life: 0.3, drag: 0.5, grav: 0, alpha: 0.85 });
    }
  }

  // ------------------------------------------------------------------ reset

  reset(spawn) {
    const T = this.T, a = this.a;
    this.hp = T.maxHp; this.st = T.maxSt; this.mp = T.maxMp;
    this.dead = false; this.state = 'idle';
    a.stopMove(); a.playBase('idle', { fade: 0 });
    a.extra = null; a.extraW = 0;
    const g = this.giant ? this.giantY() : this.ground(spawn.x, spawn.z);
    this.baseY = g; this.liftY = 0; this.spinOff = 0;
    this.airborne = false; this.vy = 0; this.thrown = null; this.throwVel = null; this.vault = null;
    this.heldBy = null; this.ringPos = null; this.ringW = 0; this.critStand = null; this.grabPending = 0;
    this.pos.set(spawn.x, g, spawn.z);
    if (spawn.yaw !== undefined) this.yaw = spawn.yaw;
    this.root.rotation.y = this.yaw;
    this.speed = 0; this.charge = 0; this.chargeFull = false; this.glow = 0;
    this.blocking = false; this.guardW = 0; this.parryT = -10;
    this.lastAttack = null; this.lastAttackEnd = -10;
    this.twist = 0; this.sprintW = 0; this.sprintingNow = false; this.carryW = this.carry === false ? 0 : this.carryW;
    this.events.length = 0;
    this.seg.valid = false;
    this.lastX = spawn.x; this.lastZ = spawn.z;
    this.fan.visible = false;
    if (this.staff) { this.sizeStaff(); for (const m of this.staff.userData.goldMats || []) m.emissiveIntensity = 0; }
    this.root.updateMatrixWorld(true);
  }
}
