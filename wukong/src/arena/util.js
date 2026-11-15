// Small shared helpers for the arena modules: seeded RNG, geometry merging, gothic arch outlines.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Deterministic PRNG (mulberry32) with a few convenience helpers. */
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
  f.gauss = () => (f() + f() + f() + f() - 2) * 0.8660254; // ~N(0, 1) (Irwin-Hall)
  return f;
}

/**
 * Merge geometries into one non-indexed geometry that keeps exactly `attrs`.
 * Missing uv attributes are zero-filled, missing normals are computed.
 */
export function mergeGeos(geos, attrs = ['position', 'normal']) {
  const list = [];
  for (const g of geos) {
    if (!g) continue;
    const ng = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(ng.attributes)) if (!attrs.includes(name)) ng.deleteAttribute(name);
    if (attrs.includes('normal') && !ng.attributes.normal) ng.computeVertexNormals();
    if (attrs.includes('uv') && !ng.attributes.uv) {
      ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    }
    ng.morphAttributes = {};
    ng.clearGroups();
    list.push(ng);
  }
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  for (const g of geos) if (g) g.dispose();
  return merged;
}

/**
 * Two-centred (gothic) arch from the left springing (-a, 0) over the apex (0, h) to (a, 0).
 * h > a*sqrt(3) gives a lancet, h == a a round arch. Returns [[u, v], ...] (2*seg+1 points).
 */
export function pointedArch(a, h, seg = 12) {
  const c = (h * h - a * a) / (2 * a);
  const R = a + c;
  const phi = Math.atan2(h, -c);
  const left = [];
  for (let i = 0; i <= seg; i++) {
    const th = Math.PI + (phi - Math.PI) * (i / seg);
    left.push([c + R * Math.cos(th), R * Math.sin(th)]);
  }
  left[seg] = [0, h];
  const pts = left.slice();
  for (let i = seg - 1; i >= 0; i--) pts.push([-left[i][0], left[i][1]]);
  return pts;
}

/** Height of a two-centred vault profile (half span a, rise h) at offset x from the centre line. */
export function pointedArchHeight(a, h, x) {
  const c = (h * h - a * a) / (2 * a);
  const R = a + c;
  const ax = Math.min(Math.abs(x), a);
  return Math.sqrt(Math.max(0, R * R - (ax + c) * (ax + c)));
}

/**
 * Closed lancet-window outline as a THREE.Path (for shape holes) or THREE.Shape.
 * cx: centre u, y0: sill height, hw: half width, straight: straight jamb height, rise: arch rise.
 */
export function lancetPath(cx, y0, hw, straight, rise, seg = 10, ShapeClass = THREE.Path) {
  const p = new ShapeClass();
  p.moveTo(cx - hw, y0);
  p.lineTo(cx + hw, y0);
  p.lineTo(cx + hw, y0 + straight);
  const arch = pointedArch(hw, rise, seg);
  for (let i = arch.length - 2; i >= 1; i--) p.lineTo(cx + arch[i][0], y0 + straight + arch[i][1]);
  p.lineTo(cx - hw, y0 + straight);
  p.lineTo(cx - hw, y0);
  return p;
}

/** Circle as a THREE.Path. */
export function circlePath(cx, cy, r, seg = 48, ShapeClass = THREE.Path) {
  const p = new ShapeClass();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  }
  return p;
}

/**
 * Extrude a 2D shape that lives in a wall plane.
 * plane 'x': shape u -> world z, v -> world y, extruded along -x from xFace (faces both ways).
 * plane 'z': shape u -> world x, v -> world y, extruded along -z from zFace.
 */
export function extrudeWall(shape, depth, plane, face) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1, steps: 1 });
  if (plane === 'x') {
    // local (u, v, d) -> world (-d, v, u) via rotateY(-90deg), then shift.
    g.rotateY(-Math.PI / 2);
    g.translate(face, 0, 0);
  } else {
    // local (u, v, d) -> world (u, v, -d)? ExtrudeGeometry extrudes +z; flip to -z by rotating 180deg about y
    // would mirror u, so instead translate so the slab spans [face - depth, face].
    g.translate(0, 0, face - depth);
  }
  return g;
}

/** Dispose every geometry / material / texture owned by an object tree. */
export function disposeTree(root, keep = new Set()) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const v of Object.values(m)) if (v && v.isTexture && !keep.has(v) && !seen.has(v)) { seen.add(v); v.dispose(); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) {
        const v = u && u.value;
        if (v && v.isTexture && !keep.has(v) && !seen.has(v)) { seen.add(v); v.dispose(); }
      }
      m.dispose();
    }
    if (o.customDepthMaterial && !seen.has(o.customDepthMaterial)) { seen.add(o.customDepthMaterial); o.customDepthMaterial.dispose(); }
    if (o.isInstancedMesh) o.dispose();
  });
}

/** GLSL snippet: interleaved gradient noise (per-pixel jitter). */
export const GLSL_IGN = /* glsl */`
float arenaIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
