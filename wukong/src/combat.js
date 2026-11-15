// Geometry helpers for hit detection: swept blade segments vs capsules, circles, push-apart.
import * as THREE from 'three';

const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** Closest points between segments p1-q1 and p2-q2. Returns { dist, c1, c2 }. */
export function segSeg(p1, q1, p2, q2, c1 = new THREE.Vector3(), c2 = new THREE.Vector3()) {
  const d1 = _u.subVectors(q1, p1), d2 = _v.subVectors(q2, p2), r = _w.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return { dist: c1.distanceTo(c2), c1, c2 };
}

/**
 * Sweep a blade from (prevBase, prevTip) to (base, tip) in `steps` sub-steps against capsules [{a, b, r}].
 * Returns { point, capsule } of the first contact or null.
 */
export function sweepBlade(prevBase, prevTip, base, tip, capsules, bladeRadius = 0.06, steps = 5) {
  const pb = new THREE.Vector3(), pt = new THREE.Vector3();
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    pb.lerpVectors(prevBase, base, f);
    pt.lerpVectors(prevTip, tip, f);
    for (const cap of capsules) {
      const res = segSeg(pb, pt, cap.a, cap.b);
      if (res.dist <= cap.r + bladeRadius) {
        // contact point on the capsule surface toward the blade
        const point = res.c2.clone().add(res.c1.clone().sub(res.c2).setLength(Math.min(cap.r, res.c1.distanceTo(res.c2))));
        return { point, capsule: cap };
      }
    }
  }
  return null;
}

export function horizDist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

/** Signed angle (radians) from facing yaw to the direction toward `to`. */
export function angleTo(fromPos, yaw, to) {
  const t = Math.atan2(to.x - fromPos.x, to.z - fromPos.z);
  return Math.atan2(Math.sin(t - yaw), Math.cos(t - yaw));
}

/** Push two circles apart on the XZ plane (mass ratio k: share of the push taken by `a`). */
export function separate(a, ra, b, rb, k = 0.5) {
  const dx = a.x - b.x, dz = a.z - b.z;
  const d = Math.hypot(dx, dz), min = ra + rb;
  if (d >= min || d < 1e-6) return false;
  const push = (min - d);
  const nx = dx / d, nz = dz / d;
  a.x += nx * push * k; a.z += nz * push * k;
  b.x -= nx * push * (1 - k); b.z -= nz * push * (1 - k);
  return true;
}

export function clampToArena(p, arena, r = 0.4) {
  const b = arena.bounds;
  p.x = THREE.MathUtils.clamp(p.x, b.minX + r, b.maxX - r);
  p.z = THREE.MathUtils.clamp(p.z, b.minZ + r, b.maxZ - r);
  for (const c of arena.colliders || []) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
    if (d < m && d > 1e-6) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
  }
}

export const yawLerp = (a, b, maxStep) => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + THREE.MathUtils.clamp(d, -maxStep, maxStep);
};
