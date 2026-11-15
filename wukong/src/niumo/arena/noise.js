// CPU-side noise and small math helpers for the volcano arena (deterministic, seedable, no dependencies).
// The same fields feed the terrain mesh, the lava masks (textures) and the gameplay queries
// (groundY / lavaAt), so everything that is drawn and everything that is tested agree.

/** Deterministic PRNG (mulberry32) with helpers (same algorithm as src/arena/util.js). */
export function rng(seed = 1) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.sign = () => (f() < 0.5 ? -1 : 1);
  f.gauss = () => (f() + f() + f() + f() - 2) * 0.8660254;
  return f;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Integer lattice hash -> [0, 1). */
export function hash2(ix, iz, seed = 0) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function vnoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise in [0, 1]. */
export function fbm(x, z, oct = 4, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(x * f + o * 17.31, z * f - o * 9.73, seed + o * 101);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

/** Ridged fractal noise in [0, 1] (sharp crests: rims, cliffs). */
export function ridged(x, z, oct = 4, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    const n = 1 - Math.abs(vnoise(x * f + o * 31.7, z * f + o * 7.1, seed + o * 57) * 2 - 1);
    sum += amp * n * n;
    norm += amp; amp *= 0.5; f *= 2.1;
  }
  return sum / norm;
}

/** Tileable value noise on a period-P lattice (for textures). */
export function tnoise(x, z, period, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const m = (i) => ((i % period) + period) % period;
  const x0 = m(ix), x1 = m(ix + 1), z0 = m(iz), z1 = m(iz + 1);
  const a = hash2(x0, z0, seed), b = hash2(x1, z0, seed), c = hash2(x0, z1, seed), d = hash2(x1, z1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fbm over a texture of `size` pixels with base period `period` cells. */
export function tfbm(px, py, size, period, oct = 4, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0, p = period;
  for (let o = 0; o < oct; o++) {
    sum += amp * tnoise((px / size) * p, (py / size) * p, p, seed + o * 131);
    norm += amp; amp *= 0.5; p *= 2;
  }
  return sum / norm;
}

/** Shortest signed angle difference a - b in (-PI, PI]. */
export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Centripetal-ish Catmull-Rom resampling of a 2D polyline [[x, z, w], ...] into `perSeg` points per span. */
export function catmull(points, perSeg = 8) {
  const out = [];
  const n = points.length;
  const P = (i) => points[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      const q = [];
      for (let k = 0; k < p1.length; k++) {
        q.push(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
          + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
      }
      out.push(q);
    }
  }
  out.push(points[n - 1].slice());
  return out;
}
