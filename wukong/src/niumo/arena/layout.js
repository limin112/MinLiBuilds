// 火焰山 caldera layout: one source of truth for the ground shape, the lava (rivers, the moat behind the
// altar, the phase-two collapse seams) and where every prop stands.
// Coordinates: metres, +y up. The seated giant is at SEAT (z = -30, facing +z); the player enters at SPAWN
// (z = +40, facing -z). The walkable floor is a rounded caldera bowl; the walls rise outside BOUNDS.
//
// Lava is described by a top-down mask (RGBA8, MASK.res^2 over MASK.size metres):
//   R  rivers / moat / sink pools (always present)          -> lavaAt, terrain carve, lava shading
//   G  collapse seams + outer lava lake (phase two only)    -> scaled by the collapse amount
//   BA flow direction (x, z) * 0.5 + 0.5, length = speed factor
// The same bytes are uploaded to the GPU and sampled bilinearly on the CPU, so what burns is what glows.
import { smooth, clamp, lerp, fbm, ridged, vnoise, angDiff, catmull, rng } from './noise.js';

export const SEAT = { x: 0, z: -30, yaw: 0 };
export const SPAWN = { x: 0, z: 40, yaw: Math.PI };
export const BOUNDS = { minX: -40, maxX: 40, minZ: -42, maxZ: 48 };
// the giants' duel uses the whole pit (the walls of the caldera stand about 75 m out)
export const DUEL_BOUNDS = { minX: -64, maxX: 64, minZ: -66, maxZ: 62 };
// ... and for the duel the caldera itself is drawn this many times wider: 320 x 320 m to fight in, sixteen times the prologue's floor
export const DUEL_SCALE = 2.5;
export const CAM_BOUNDS = { minX: -45, maxX: 45, minZ: -44, maxZ: 54 };
export const LAVA_Y = -0.42;   // river / moat surface
export const SEAM_Y = -0.66;   // phase-two seams and lake (the plates are left standing above it)
export const ALTAR = { x: 0, z: -30, hx: 14, hz: 11, top: 0.7 };
export const FLOOR = { cx: 0, cz: 3, rx: 58, rz: 61 };
export const MASK = { x0: -72, z0: -76, size: 144, res: 768 };
export const GLOW = { res: 256 };
export const GRID = { cx: 0, cz: 2, half: 142, a: 0.36 };
export const COLLAPSE_C = { x: 0, z: -5 };   // centre of the phase-two plates
export const LAKE_R = 32.5;                   // beyond this (noisy) radius the phase-two floor is lava lake

// --- rivers: [x, z, half width] control points, from the moat towards the spawn corners ------------------------
const RIVER_A = [
  [-13.5, -49.5, 1.6], [-17.5, -41, 2.0], [-20.6, -31, 2.25], [-22.9, -19, 2.45], [-25.2, -6, 2.65],
  [-27.4, 7, 2.85], [-30.2, 19, 3.0], [-34.2, 30.5, 3.1], [-40.5, 40.5, 3.3], [-49.5, 49.5, 3.5], [-58.5, 55.5, 3.7],
];
const RIVER_B = [
  [14.5, -50.5, 1.5], [18.8, -41.5, 1.8], [21.9, -31, 2.05], [23.7, -18, 2.25], [25.1, -5, 2.45],
  [27.6, 8, 2.6], [29.6, 20, 2.75], [33.4, 31.5, 2.9], [39.6, 41.5, 3.1], [48.5, 50, 3.3], [57.5, 55.5, 3.6],
];
export const RIVERS = [RIVER_A, RIVER_B].map((pts) => catmull(pts, 10));
// pools: ellipses { x, z, rx, rz, flow: 'out'|'still' }
export const POOLS = [
  { x: 0.5, z: -51, rx: 16.8, rz: 5.0, flow: 'out' },     // the moat behind the altar, fed by the falls
  { x: -60, z: 56.5, rx: 8, rz: 6.5, flow: 'still' },
  { x: 58.5, z: 56.5, rx: 8, rz: 6.5, flow: 'still' },
];
// crusted-over crossings (lava cold enough to walk on)
export const BRIDGES = [{ x: -28.9, z: 13.2, r: 2.7 }, { x: 25.9, z: 1.2, r: 2.5 }];

// --- phase-two plates (Voronoi sites); seams open along the cell edges, the outside becomes a lava lake ---------
export const PLATE_SITES = [
  [0, -3], [-13, -13], [12.5, -14.5], [-16, 7.5], [15.5, 6.5], [-5.5, 18], [9, 19.5], [0, -30], [-22.5, -29], [22.5, -30],
];
// land bridges across seams (pairs of site indices; the bridge sits on their shared edge) + explicit spots
const BRIDGE_PAIRS = [[0, 1], [0, 4], [1, 3], [2, 4], [5, 6], [0, 6], [3, 5], [1, 8], [2, 9]];
const BRIDGE_SPOTS = [[-6.5, -16.6, 2.4], [6.5, -16.8, 2.4]];      // central plate <-> altar plate
const LAKE_ISLES = [[-37, -4, 3.2], [36, -10, 2.8], [-31, 27, 2.6], [30, 30, 3.0], [-41, 16, 2.2], [42, 12, 2.4], [-18, 36, 2.4], [17, 37, 2.2]];

// --- lava falls down the back cliff into the moat (always), and the phase-two fissure ---------------------------
export const FALLS = [
  { x: -8.8, width: 1.5, phase2: false, seed: 3 },
  { x: 10.6, width: 2.0, phase2: false, seed: 7 },
  { x: 1.4, width: 5.5, phase2: true, seed: 11 },   // the mountain splits behind him
  { x: -15.5, width: 2.2, phase2: true, seed: 17 },
  { x: 17.5, width: 1.8, phase2: true, seed: 23 },
];

// ------------------------------------------------------------------------------------------------------------------
// Ground shape

/** Domain-warped superellipse distance: 1 at the foot of the caldera walls. */
export function floorD(x, z) {
  const wx = (fbm(x * 0.011 + 3.1, z * 0.011 - 1.7, 3, 11) - 0.5) * 0.2;
  const wz = (fbm(x * 0.011 - 5.3, z * 0.011 + 2.9, 3, 12) - 0.5) * 0.2;
  const dx = Math.abs(x / FLOOR.rx + wx), dz = Math.abs((z - FLOOR.cz) / FLOOR.rz + wz);
  return Math.pow(dx ** 2.5 + dz ** 2.5, 0.4);
}

/** Rim height of the caldera wall by azimuth (0 = behind the spawn, PI = behind the seat). */
function rimHeight(x, z) {
  const ang = Math.atan2(x, z - FLOOR.cz);
  const back = Math.exp(-((angDiff(ang, Math.PI) / 0.5) ** 2));       // low notch behind the giant's head
  const side = Math.sin(ang) ** 2;
  const front = Math.exp(-((ang / 0.7) ** 2));
  return 20 + 9 * side - 9 * back - 3 * front + (fbm(Math.cos(ang) * 3 + 7, Math.sin(ang) * 3 - 2, 3, 21) - 0.5) * 12;
}

/** Height of the bare ground before the lava carves it. */
export function baseHeight(x, z) {
  const d = floorD(x, z);
  // floor: soft undulation, a little rougher towards the walls
  let h = (fbm(x * 0.045, z * 0.045, 4, 1) - 0.5) * 0.34 + (vnoise(x * 0.33, z * 0.33, 2) - 0.5) * 0.06;
  h += 1.7 * smooth(0.84, 1.02, d) ** 2;
  if (d > 1.0) {
    const rim = rimHeight(x, z);
    const cliff = smooth(1.0, 1.3, d), up = smooth(1.28, 1.85, d), down = smooth(1.95, 2.4, d);
    const crag = ridged(x * 0.035, z * 0.035, 4, 31);
    const strata = (fbm(x * 0.09, z * 0.09, 3, 41) - 0.5);
    h += rim * (cliff * 0.74 + up * 0.26 - down * 0.55) * (0.82 + 0.36 * crag) + strata * 3.5 * cliff;
    // basalt benches: the cliff steps in terraces here and there
    const bench = smooth(0.45, 0.7, fbm(x * 0.02 + 9, z * 0.02 - 4, 2, 51));
    h -= bench * 2.5 * smooth(1.05, 1.15, d) * (1 - smooth(1.2, 1.35, d));
  }
  // the mountain at his back: a steep scarp right behind the moat that the falls pour over (it splits in phase two)
  const scarp = Math.exp(-((x / 36) ** 2)) * smooth(-57.5, -64, z + (fbm(x * 0.08, 3, 2, 55) - 0.5) * 3);
  h += scarp * (13 + (ridged(x * 0.06, z * 0.06, 3, 57) - 0.5) * 6) * (1 - 0.35 * smooth(-90, -120, z));
  // the altar: buried plateau (hidden under the altar blocks) and a ramp of ash in front of it
  const ax = Math.abs(x - ALTAR.x), az = z - ALTAR.z;
  const inX = 1 - smooth(ALTAR.hx - 0.6, ALTAR.hx + 0.9, ax);
  const inZ = (1 - smooth(ALTAR.hz - 0.6, ALTAR.hz + 0.9, az)) * smooth(-ALTAR.hz - 0.9, -ALTAR.hz + 0.6, az);
  h = Math.max(h, lerp(h, ALTAR.top - 0.12, inX * inZ));
  // ash drift ramp burying the front steps (centre), shallower towards the corners
  const rampW = 1 - smooth(ALTAR.hx - 3.5, ALTAR.hx + 0.5, ax);
  const ramp = (1 - smooth(ALTAR.z + ALTAR.hz, ALTAR.z + ALTAR.hz + 5.8, z)) * smooth(ALTAR.z + ALTAR.hz - 1.5, ALTAR.z + ALTAR.hz - 0.2, z);
  h = Math.max(h, (ALTAR.top + 0.05) * ramp * rampW + (fbm(x * 0.3, z * 0.3, 2, 61) - 0.5) * 0.08 * ramp);
  // drifts piled against the altar's flanks
  const flank = Math.exp(-(((ax - ALTAR.hx - 0.6) / 1.4) ** 2)) * inZ;
  h += flank * 0.3 * fbm(x * 0.2, z * 0.2, 2, 71);
  return h;
}

// ------------------------------------------------------------------------------------------------------------------
// Lava masks

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return [Math.sqrt(qx * qx + qz * qz), t];
}

/** Build the lava mask (MASK.res^2 RGBA8) and the blurred glow map (GLOW.res^2 RGBA8). */
export function buildMasks() {
  const R = MASK.res, S = MASK.size / R;
  const N = R * R;
  const sdRiver = new Float32Array(N).fill(1e9);
  const flowX = new Float32Array(N), flowZ = new Float32Array(N), flowK = new Float32Array(N);
  const tx = (x) => (x - MASK.x0) / S - 0.5, tz = (z) => (z - MASK.z0) / S - 0.5;
  const cx = (i) => MASK.x0 + (i + 0.5) * S, cz = (j) => MASK.z0 + (j + 0.5) * S;
  const SOFT = 0.75, WOB = 0.65;

  // rivers: rasterise each segment into its bounding box
  for (const river of RIVERS) {
    for (let s = 0; s < river.length - 1; s++) {
      const [ax, az, aw] = river[s], [bx, bz, bw] = river[s + 1];
      const m = Math.max(aw, bw) + SOFT + WOB + 1.2;
      const i0 = Math.max(0, Math.floor(tx(Math.min(ax, bx) - m))), i1 = Math.min(R - 1, Math.ceil(tx(Math.max(ax, bx) + m)));
      const j0 = Math.max(0, Math.floor(tz(Math.min(az, bz) - m))), j1 = Math.min(R - 1, Math.ceil(tz(Math.max(az, bz) + m)));
      let fx = bx - ax, fz = bz - az;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = cx(i), z = cz(j);
          const [d, t] = segDist(x, z, ax, az, bx, bz);
          const sd = d - lerp(aw, bw, t);
          const k = j * R + i;
          if (sd < sdRiver[k]) { sdRiver[k] = sd; flowX[k] = fx; flowZ[k] = fz; flowK[k] = 1; }
        }
      }
    }
  }
  // pools
  for (const p of POOLS) {
    const m = Math.max(p.rx, p.rz) + SOFT + WOB + 1.5;
    const i0 = Math.max(0, Math.floor(tx(p.x - m))), i1 = Math.min(R - 1, Math.ceil(tx(p.x + m)));
    const j0 = Math.max(0, Math.floor(tz(p.z - m))), j1 = Math.min(R - 1, Math.ceil(tz(p.z + m)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = cx(i), z = cz(j);
        const ex = (x - p.x) / p.rx, ez = (z - p.z) / p.rz;
        const sd = (Math.hypot(ex, ez) - 1) * Math.min(p.rx, p.rz);
        const k = j * R + i;
        if (sd < sdRiver[k]) {
          // blend the flow with the river that leaves the pool instead of overriding it
          const w = sdRiver[k] < 3 ? 0.5 : 1;
          let fx = 0, fz = 0, sp = 0.25;
          if (p.flow === 'out') { fx = clamp((x - p.x) / p.rx, -1, 1); fz = -0.15 * fx * Math.sign(x - p.x); sp = 0.55; }
          else { fx = -(z - p.z) / p.rz * 0.6; fz = (x - p.x) / p.rx * 0.6; }
          flowX[k] = lerp(flowX[k], fx, w); flowZ[k] = lerp(flowZ[k], fz, w); flowK[k] = lerp(flowK[k], sp, w);
          sdRiver[k] = sd;
        }
      }
    }
  }

  // phase-two plates: distance to the nearest Voronoi edge
  const sites = PLATE_SITES;
  const bridges = BRIDGE_SPOTS.slice();
  for (const [a, b] of BRIDGE_PAIRS) bridges.push([(sites[a][0] + sites[b][0]) / 2, (sites[a][1] + sites[b][1]) / 2, 2.3]);
  for (const b of BRIDGES) bridges.push([b.x, b.z, b.r + 0.6]);

  // smooth noise fields on a coarse grid (4 texels), bilinearly expanded: the per-texel cost stays low
  const C = R / 4 + 1, CS = S * 4;
  const coarse = (fn) => {
    const a = new Float32Array(C * C);
    for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) a[j * C + i] = fn(MASK.x0 + i * CS, MASK.z0 + j * CS);
    return a;
  };
  const cWob = coarse((x, z) => (fbm(x * 0.21, z * 0.21, 3, 81) - 0.5) * 2 * WOB);
  const cHw = coarse((x, z) => 1.35 + (fbm(x * 0.13 + 4, z * 0.13 - 2, 3, 91) - 0.5) * 1.1);
  const cLake = coarse((x, z) => (fbm(x * 0.05, z * 0.05, 3, 93) - 0.5) * 9);
  const at = (arr, x, z) => {
    const u = (x - MASK.x0) / CS, v = (z - MASK.z0) / CS;
    const i0 = clamp(Math.floor(u), 0, C - 2), j0 = clamp(Math.floor(v), 0, C - 2);
    const fu = u - i0, fv = v - j0;
    const a = arr[j0 * C + i0], b = arr[j0 * C + i0 + 1], c = arr[(j0 + 1) * C + i0], d = arr[(j0 + 1) * C + i0 + 1];
    return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
  };

  // seam field (signed distance to the plate edges / lake, before the edge noise) and its flow, on the coarse grid:
  // the field is piecewise linear, so interpolating it loses nothing that matters
  const cSeam = new Float32Array(C * C), cSx = new Float32Array(C * C), cSz = new Float32Array(C * C);
  for (let cj = 0; cj < C; cj++) {
    for (let ci = 0; ci < C; ci++) {
      const x = MASK.x0 + ci * CS, z = MASK.z0 + cj * CS, ck = cj * C + ci;
      let ia = 0, best = 1e9;
      for (let s = 0; s < sites.length; s++) {
        const d2 = (x - sites[s][0]) ** 2 + (z - sites[s][1]) ** 2;
        if (d2 < best) { best = d2; ia = s; }
      }
      let edge = 1e9, eb = 0;
      for (let s = 0; s < sites.length; s++) {
        if (s === ia) continue;
        const len = Math.hypot(sites[s][0] - sites[ia][0], sites[s][1] - sites[ia][1]);
        const e = ((x - sites[s][0]) ** 2 + (z - sites[s][1]) ** 2 - best) / (2 * len);
        if (e < edge) { edge = e; eb = s; }
      }
      let sd = edge - cHw[ck];
      const dc = Math.hypot(x - COLLAPSE_C.x, z - COLLAPSE_C.z);
      const lake = LAKE_R + cLake[ck] - dc;
      const inAltar = Math.abs(x - ALTAR.x) < ALTAR.hx + 2.5 && z < ALTAR.z + ALTAR.hz + 1.5 && z > ALTAR.z - ALTAR.hz - 4;
      sd = Math.min(sd, inAltar ? 1e9 : lake);
      if (sd < 2.5) {
        for (const [bx, bz, br] of bridges) {
          const dx = x - bx, dz = z - bz;
          if (dx * dx + dz * dz > br * br) continue;
          const d = Math.sqrt(dx * dx + dz * dz) / br;
          sd = Math.max(sd, 1.4 * (1 - d * d));
        }
        for (const [ix, iz, ir] of LAKE_ISLES) {
          const d = Math.hypot(x - ix, z - iz);
          if (d < ir + 2) sd = Math.max(sd, ir - d + (vnoise(x * 0.5, z * 0.5, 95) - 0.5) * 1.4);
        }
      }
      cSeam[ck] = Math.min(sd, 4);
      // flow: seams drift along their edge away from the centre; the lake drifts outwards
      if (lake < sd + 0.5) {
        cSx[ck] = (x - COLLAPSE_C.x) / (dc || 1) * 0.3; cSz[ck] = (z - COLLAPSE_C.z) / (dc || 1) * 0.3;
      } else {
        let ex = -(sites[eb][1] - sites[ia][1]), ez = sites[eb][0] - sites[ia][0];
        const el = Math.hypot(ex, ez) || 1;
        ex /= el; ez /= el;
        if (ex * (x - COLLAPSE_C.x) + ez * (z - COLLAPSE_C.z) < 0) { ex = -ex; ez = -ez; }
        cSx[ck] = ex * 0.45; cSz[ck] = ez * 0.45;
      }
    }
  }

  const mask = new Uint8Array(N * 4);
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < R; i++) {
      const k = j * R + i;
      const x = cx(i), z = cz(j);
      const wob = at(cWob, x, z) + (vnoise(x * 1.1, z * 1.1, 83) - 0.5) * 0.18;
      let r = sdRiver[k] < 4 ? smooth(SOFT, -SOFT, sdRiver[k] + wob) : 0;
      if (r > 0) for (const b of BRIDGES) {
        const dx = x - b.x, dz = z - b.z;
        if (dx * dx + dz * dz < b.r * b.r) r *= 1 - 0.66 * smooth(1, 0.4, Math.sqrt(dx * dx + dz * dz) / b.r);
      }
      let g = smooth(SOFT, -SOFT, at(cSeam, x, z) + wob * 0.6);
      if (Math.abs(x - ALTAR.x) < ALTAR.hx + 0.8 && Math.abs(z - ALTAR.z) < ALTAR.hz + 0.8) g = 0;
      // rivers lead the flow where both are present
      const rw = smooth(0.0, 0.3, r);
      const fx = lerp(at(cSx, x, z), flowX[k] * flowK[k], rw), fz = lerp(at(cSz, x, z), flowZ[k] * flowK[k], rw);
      mask[k * 4] = Math.round(clamp(r, 0, 1) * 255);
      mask[k * 4 + 1] = Math.round(clamp(g, 0, 1) * 255);
      mask[k * 4 + 2] = Math.round(clamp(fx * 0.5 + 0.5, 0, 1) * 255);
      mask[k * 4 + 3] = Math.round(clamp(fz * 0.5 + 0.5, 0, 1) * 255);
    }
  }

  // glow map: downsample, add the tall sources (falls / fissure), blur
  const G = GLOW.res, f = R / G;
  const ch = [new Float32Array(G * G), new Float32Array(G * G), new Float32Array(G * G), new Float32Array(G * G)];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      let a = 0, b = 0;
      for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) {
        const k = ((j * f + v) * R + (i * f + u)) * 4;
        a += mask[k]; b += mask[k + 1];
      }
      ch[0][j * G + i] = a / (f * f * 255);
      ch[1][j * G + i] = b / (f * f * 255);
    }
  }
  const GS = MASK.size / G;
  // the giant's own heat: the ground around the altar glows from below (lighting only, it does not burn)
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = MASK.x0 + (i + 0.5) * GS, z = MASK.z0 + (j + 0.5) * GS;
    const dx = Math.max(0, Math.abs(x - ALTAR.x) - ALTAR.hx), dz = Math.max(0, Math.abs(z - ALTAR.z) - ALTAR.hz);
    const d = Math.hypot(dx, dz);
    const front = z > ALTAR.z ? 1 : 0.6;
    ch[0][j * G + i] = Math.max(ch[0][j * G + i], 0.42 * front * Math.exp(-(d * d) / 30));
  }
  for (const fall of FALLS) {
    const c = fall.phase2 ? ch[3] : ch[2];
    for (let z = -77; z <= -54; z += GS * 0.5) {
      const x = fall.x + (vnoise(z * 0.15, fall.seed, 5) - 0.5) * 2.5;
      const i = Math.round((x - MASK.x0) / GS - 0.5), j = Math.round((z - MASK.z0) / GS - 0.5);
      for (let du = -2; du <= 2; du++) {
        const ii = i + du;
        if (ii < 0 || ii >= G || j < 0 || j >= G) continue;
        c[j * G + ii] = Math.max(c[j * G + ii], clamp(fall.width / 3, 0.4, 1) * (1 - Math.abs(du) * 0.2));
      }
    }
  }
  // three box passes (running sums) approximate a Gaussian of the given sigma (in texels)
  const box = (src, dst, r, horiz) => {
    const w = 2 * r + 1;
    for (let o = 0; o < G; o++) {
      const idx = (t) => (horiz ? o * G + clamp(t, 0, G - 1) : clamp(t, 0, G - 1) * G + o);
      let acc = 0;
      for (let t = -r - 1; t < r; t++) acc += src[idx(t)];
      for (let t = 0; t < G; t++) {
        acc += src[idx(t + r)] - src[idx(t - r - 1)];
        dst[horiz ? o * G + t : t * G + o] = acc / w;
      }
    }
  };
  const blur = (src, sigma) => {
    const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5));
    let a = Float32Array.from(src), b = new Float32Array(G * G);
    for (let pass = 0; pass < 3; pass++) { box(a, b, r, true); box(b, a, r, false); }
    return a;
  };
  const glow = new Uint8Array(G * G * 4);
  for (let c = 0; c < 4; c++) {
    const near = blur(ch[c], 3.2 / GS), far = blur(ch[c], 9 / GS);
    for (let k = 0; k < G * G; k++) glow[k * 4 + c] = Math.round(clamp(near[k] * 1.25 + far[k] * 1.1, 0, 1) * 255);
  }
  return { mask, glow, res: R, gres: G };
}

/** Bilinear sample of one channel of an RGBA8 field covering the MASK rect, as the GPU does (texel centres). */
export function sampleField(data, res, x, z, c) {
  const u = (x - MASK.x0) / MASK.size * res - 0.5, v = (z - MASK.z0) / MASK.size * res - 0.5;
  const i0 = Math.floor(u), j0 = Math.floor(v);
  const fu = u - i0, fv = v - j0;
  const I = (i) => clamp(i, 0, res - 1);
  const a = data[(I(j0) * res + I(i0)) * 4 + c], b = data[(I(j0) * res + I(i0 + 1)) * 4 + c];
  const d = data[(I(j0 + 1) * res + I(i0)) * 4 + c], e = data[(I(j0 + 1) * res + I(i0 + 1)) * 4 + c];
  return ((a + (b - a) * fu) * (1 - fv) + (d + (e - d) * fu) * fv) / 255;
}

// ------------------------------------------------------------------------------------------------------------------
// Terrain grid (denser in the middle) and exact ground queries

export function gridCoord(u) { return GRID.half * (GRID.a * u + (1 - GRID.a) * u * u * u); }

/**
 * Sample the ground on an n x n grid. Returns per-vertex base heights (lava carved), the phase-two sink weights
 * and query helpers that interpolate exactly like the rendered triangles.
 */
export function buildGround(n, masks) {
  const xs = new Float32Array(n), zs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    xs[i] = GRID.cx + gridCoord(u);
    zs[i] = GRID.cz + gridCoord(u);
  }
  const h = new Float32Array(n * n), sink = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = xs[i], z = zs[j];
      let y = baseHeight(x, z);
      const inMask = x > MASK.x0 && x < MASK.x0 + MASK.size && z > MASK.z0 && z < MASK.z0 + MASK.size;
      if (inMask) {
        const r = sampleField(masks.mask, masks.res, x, z, 0);
        y = lerp(y, LAVA_Y, smooth(0.18, 0.78, r));
        const g = sampleField(masks.mask, masks.res, x, z, 1);
        sink[j * n + i] = smooth(0.15, 0.75, g);
      }
      h[j * n + i] = y;
    }
  }
  const findCell = (arr, v) => {
    if (v <= arr[0]) return 0;
    if (v >= arr[n - 1]) return n - 2;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid] <= v) lo = mid; else hi = mid; }
    return lo;
  };
  const vertexY = (i, j, collapse) => {
    const k = j * n + i;
    return collapse > 0 ? lerp(h[k], SEAM_Y, collapse * sink[k]) : h[k];
  };
  // triangles per cell: (i,j)-(i,j+1)-(i+1,j) and (i+1,j)-(i,j+1)-(i+1,j+1) (see terrain.js)
  function heightAt(x, z, collapse = 0) {
    const i = findCell(xs, x), j = findCell(zs, z);
    const fu = clamp((x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1), fv = clamp((z - zs[j]) / (zs[j + 1] - zs[j]), 0, 1);
    const y00 = vertexY(i, j, collapse), y10 = vertexY(i + 1, j, collapse), y01 = vertexY(i, j + 1, collapse), y11 = vertexY(i + 1, j + 1, collapse);
    if (fu + fv <= 1) return y00 + (y10 - y00) * fu + (y01 - y00) * fv;
    return y11 + (y01 - y11) * (1 - fu) + (y10 - y11) * (1 - fv);
  }
  return { n, xs, zs, h, sink, heightAt };
}

// ------------------------------------------------------------------------------------------------------------------
// Props (positions shared by the meshes and the colliders)

// basalt column clusters standing on the phase-two plates (cover from the fire breath)
export const PILLAR_CLUSTERS = [
  { x: -12.6, z: -12.2, r: 2.1, n: 7, h: [3.2, 7.5], seed: 1 },
  { x: 12.2, z: -13.8, r: 2.3, n: 8, h: [3.0, 8.4], seed: 2 },
  { x: -16.4, z: 8.4, r: 1.9, n: 6, h: [2.4, 6.2], seed: 3 },
  { x: 15.8, z: 6.0, r: 2.0, n: 7, h: [2.8, 7.0], seed: 4 },
  { x: -6.0, z: 18.6, r: 1.6, n: 5, h: [2.2, 5.2], seed: 5 },
  { x: 9.8, z: 20.4, r: 1.8, n: 6, h: [2.6, 6.4], seed: 6 },
];
// big decorative clusters at the foot of the walls (outside the walkable rectangle, no colliders)
export const WALL_CLUSTERS = [
  { x: -47, z: -30, r: 5.5, n: 18, h: [6, 15], seed: 21 }, { x: 47, z: -36, r: 6, n: 20, h: [7, 17], seed: 22 },
  { x: -51, z: 8, r: 4.5, n: 14, h: [5, 12], seed: 23 }, { x: 52, z: 14, r: 5, n: 15, h: [5, 13], seed: 24 },
  { x: -30, z: -52, r: 4.8, n: 15, h: [6, 14], seed: 25 }, { x: 31, z: -53, r: 5.2, n: 16, h: [6, 16], seed: 26 },
  { x: -44, z: 36, r: 4.2, n: 12, h: [4, 10], seed: 27 }, { x: 44, z: 34, r: 4.4, n: 13, h: [4, 11], seed: 28 },
  { x: -20, z: 58, r: 4.2, n: 12, h: [5, 11], seed: 29 }, { x: 24, z: 57, r: 4.5, n: 13, h: [5, 12], seed: 30 },
  { x: -40, z: -46, r: 3.8, n: 10, h: [5, 11], seed: 31 }, { x: 41, z: -46, r: 3.6, n: 10, h: [5, 12], seed: 32 },
];
// steles: { x, z, yaw, w, h, lean, broken: 0..1 cut height, base: 'turtle'|'block', fallen }
export const STELES = [
  { x: -18.2, z: -20.2, yaw: 0.35, w: 1.3, h: 3.6, lean: [0.05, -0.03], cut: 0.0, base: 'turtle' },
  { x: 18.6, z: -21.4, yaw: -0.3, w: 1.25, h: 3.4, lean: [-0.08, 0.02], cut: 0.62, base: 'turtle' },
  { x: 4.2, z: 3.4, yaw: 0.7, w: 1.1, h: 2.9, lean: [0.0, 0.0], cut: 0.42, base: 'block', fallenTop: true },
  { x: -21.4, z: 19.6, yaw: 0.2, w: 1.0, h: 2.7, lean: [0.12, 0.06], cut: 0.0, base: 'block' },
  { x: 20.2, z: 23.8, yaw: -0.5, w: 1.1, h: 2.8, lean: [-0.05, 0.1], cut: 0.7, base: 'block' },
  { x: -3.6, z: 31.4, yaw: 0.1, w: 0.95, h: 2.4, lean: [0.18, -0.05], cut: 0.0, base: 'block' },
  { x: 28.5, z: -15.5, yaw: -0.9, w: 1.0, h: 2.5, lean: [0.0, 0.0], cut: 0, base: 'block', fallen: true },
];
// the stone gateway (pailou) the player enters through; the left half lies in pieces
export const ARCHWAY = { z: 28.6, posts: [-9.6, -3.2, 3.2, 9.6], height: 8.6, post: 0.86 };
// giant chains from the altar's front corners
export const CHAIN_ANCHORS = [{ x: -13.2, z: -19.6 }, { x: 13.2, z: -19.6 }];
export const CAULDRON = { x: 9.6, z: -16.2, yaw: 0.9 };
export const GIANT_SWORD = { x: 6.6, z: 23.6, yaw: -0.4, tilt: 0.28 };
export const GIANT_SPEAR = { x: -9.2, z: 6.4, yaw: 0.9, tilt: 0.5 };
export const RIBCAGES = [{ x: -34.5, z: -8, yaw: 1.2, s: 1.0 }, { x: 34.8, z: -24, yaw: -0.6, s: 0.85 }];

/** Collision circles of everything solid inside the walkable area. */
export function propColliders() {
  const out = [];
  for (const c of PILLAR_CLUSTERS) out.push({ x: c.x, z: c.z, r: c.r, kind: 'pillar' });
  for (const s of STELES) {
    if (s.fallen) continue;
    out.push({ x: s.x, z: s.z, r: s.base === 'turtle' ? 1.35 : 0.85, kind: 'stele' });
  }
  for (const x of [3.2, 9.6]) out.push({ x, z: ARCHWAY.z, r: 0.95, kind: 'archway' });
  // the fallen left posts and roof: chains of circles
  for (const p of FALLEN_ARCH_PIECES) out.push({ x: p.x, z: p.z, r: p.r, kind: 'archway' });
  for (const a of CHAIN_ANCHORS) out.push({ x: a.x, z: a.z, r: 1.0, kind: 'anchor' });
  out.push({ x: CAULDRON.x, z: CAULDRON.z, r: 1.7, kind: 'cauldron' });
  out.push({ x: GIANT_SWORD.x, z: GIANT_SWORD.z, r: 0.6, kind: 'sword' });
  return out;
}
// fallen archway pieces (positions and rough footprints; meshes are built in props.js)
export const FALLEN_ARCH_PIECES = [
  { x: -4.9, z: 25.6, r: 0.75 }, { x: -6.6, z: 22.7, r: 0.75 }, { x: -8.3, z: 19.8, r: 0.7 },   // post -3.2, broken in two
  { x: -10.2, z: 30.6, r: 0.8 }, { x: -12.8, z: 31.9, r: 0.8 },                                // post -9.6, toppled sideways
  { x: -1.4, z: 24.6, r: 1.1 },                                                                 // roof block
];

/** Sanity checks for the hand-placed layout (used by the test page; returns a list of problems). */
export function checkLayout(masks, ground) {
  const issues = [];
  const lava = (x, z) => Math.max(sampleField(masks.mask, masks.res, x, z, 0), sampleField(masks.mask, masks.res, x, z, 1));
  for (const c of propColliders()) {
    const v = lava(c.x, c.z);
    if (v > 0.25 && c.kind !== 'archway') issues.push(`${c.kind} at (${c.x}, ${c.z}) stands in lava (${v.toFixed(2)})`);
  }
  const sp = sampleField(masks.mask, masks.res, SPAWN.x, SPAWN.z, 0);
  if (sp > 0.05) issues.push('spawn in lava');
  void ground; void rng;
  return issues;
}
