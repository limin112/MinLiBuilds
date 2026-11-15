// Everything standing on the caldera floor: the half-buried altar the giant sits on (carved cloud-scroll frieze,
// corner posts with broken chains), steles with faded runes (two on stone tortoises), the stone gateway (pailou)
// whose left half lies in pieces, basalt column clusters (cover from the fire breath), a toppled bronze ding,
// rusted weapons and the bones of earlier challengers, rubble. All procedural; few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRockMaterial, patchVolcanoMaterial, sinkDepthMaterial } from './shared.js';
import {
  ALTAR, STELES, ARCHWAY, PILLAR_CLUSTERS, WALL_CLUSTERS, CHAIN_ANCHORS, CAULDRON, GIANT_SWORD, GIANT_SPEAR, RIBCAGES,
  BOUNDS, SPAWN, sampleField, propColliders,
} from './layout.js';
import { rng, vnoise, clamp } from './noise.js';

const UV_PLAIN = [0.0, 0.016];   // a texel of the carving maps with no carving

// ---------------------------------------------------------------------------------------------------------------
// geometry helpers

function merge(geos) {
  const list = [];
  for (const g of geos) {
    if (!g) continue;
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.normal) ng.computeVertexNormals();
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) ng.deleteAttribute(k);
    ng.morphAttributes = {};
    ng.clearGroups();
    list.push(ng);
  }
  const hasColor = list.some((g) => g.attributes.color);
  if (hasColor) for (const g of list) if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  const m = mergeGeometries(list, false);
  for (const g of geos) if (g) g.dispose();
  for (const g of list) g.dispose();
  m.computeBoundingSphere();
  return m;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function place(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ' } = {}) {
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, order)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}
/** Orient a geometry's +y axis from a to b (a box or cylinder lying between two points). */
function between(geo, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  geo.scale(1, len, 1);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}
function setUV(geo, u, v) {
  const n = geo.attributes.position.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = u; uv[i * 2 + 1] = v; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
/** Position-keyed radial noise displacement (no cracks between split faces), then flat normals. */
function weather(geo, amp, freq = 1.4, seed = 1) {
  if (geo.index) { const ng = geo.toNonIndexed(); geo.dispose(); geo = ng; }
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = vnoise(x * freq + z * 0.71 * freq, y * freq - z * 0.37 * freq + x * 0.13, seed) - 0.5
      + (vnoise(x * freq * 3.1, z * freq * 3.1 + y * 2.3, seed + 7) - 0.5) * 0.4;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    p.setXYZ(i, x + (dx / l) * n * amp, y + (dy / l) * n * amp, z + (dz / l) * n * amp);
  }
  geo.computeVertexNormals();
  return geo;
}
function vcolor(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// ---------------------------------------------------------------------------------------------------------------
// the altar

function buildAltar(ground, r) {
  const parts = [];
  const { hx, hz, x: ax, z: az, top } = ALTAR;
  const bot = -1.0;
  const BL = 2.35, DEPTH = 1.25, TILE = 2.4;
  // curb blocks: outer faces carry the frieze (uv runs along the edge, the band sits on the exposed height)
  const edges = [
    { a: [-hx, hz], b: [hx, hz], out: [0, 1] },
    { a: [hx, -hz], b: [-hx, -hz], out: [0, -1] },
    { a: [-hx, -hz], b: [-hx, hz], out: [-1, 0] },
    { a: [hx, hz], b: [hx, -hz], out: [1, 0] },
  ];
  for (const e of edges) {
    const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    const n = Math.round(L / BL);
    const len = L / n;
    const tx = (e.b[0] - e.a[0]) / L, tz = (e.b[1] - e.a[1]) / L;
    for (let k = 0; k < n; k++) {
      const corner = k === 0 || k === n - 1;
      if (!corner && r() < 0.06) continue;                       // a missing block here and there
      const t = (k + 0.5) * len;
      const sink = r() < 0.18 ? r.range(0.05, 0.22) : r.range(0, 0.03);
      const h = top - bot - sink + r.range(-0.02, 0.02);
      let g = new THREE.BoxGeometry(len - 0.06, h, DEPTH, 3, 2, 1);
      g = weather(g, 0.07, 1.6, 11 + k);
      const yaw = Math.atan2(-tz, tx);
      place(g, {
        x: ax + e.a[0] + tx * t - e.out[0] * (DEPTH / 2 - 0.02), y: bot + h / 2, z: az + e.a[1] + tz * t - e.out[1] * (DEPTH / 2 - 0.02),
        ry: yaw, rx: r.range(-0.012, 0.012), rz: r.range(-0.015, 0.015),
      });
      // frieze uv on the outward face
      const pos = g.attributes.position, nrm = g.attributes.normal;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const dot = nrm.getX(i) * e.out[0] + nrm.getZ(i) * e.out[1];
        if (dot > 0.7) {
          const along = (pos.getX(i) - (ax + e.a[0])) * tx + (pos.getZ(i) - (az + e.a[1])) * tz;
          uv[i * 2] = along / TILE;
          uv[i * 2 + 1] = (pos.getY(i) - 0.06) / 0.6;
        } else { uv[i * 2] = UV_PLAIN[0]; uv[i * 2 + 1] = UV_PLAIN[1]; }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      parts.push(g);
    }
  }
  // top slabs (a few missing, a few cracked and tilted)
  const S = 3.3;
  const nx = Math.round((hx * 2 - DEPTH * 2) / S), nz = Math.round((hz * 2 - DEPTH * 2) / S);
  const sx = (hx * 2 - DEPTH * 2) / nx, sz = (hz * 2 - DEPTH * 2) / nz;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (r() < 0.05) continue;
    let g = new THREE.BoxGeometry(sx - 0.05, 0.32, sz - 0.05, 2, 1, 2);
    g = weather(g, 0.035, 1.2, 101 + i * 13 + j);
    place(g, { x: ax - hx + DEPTH + (i + 0.5) * sx, y: top - 0.16 + r.range(-0.025, 0.012), z: az - hz + DEPTH + (j + 0.5) * sz, rx: r.range(-0.01, 0.01), rz: r.range(-0.01, 0.01) });
    parts.push(setUV(g, ...UV_PLAIN));
  }
  // corner posts with caps (the chain anchors at the front)
  for (const [px, pz] of [[-hx + 0.8, hz - 0.6], [hx - 0.8, hz - 0.6], [-hx + 0.8, -hz + 0.6], [hx - 0.8, -hz + 0.6]]) {
    const H = 3.4;
    let post = new THREE.BoxGeometry(1.3, H, 1.3, 1, 3, 1);
    post = weather(post, 0.06, 1.3, 201 + px);
    place(post, { x: ax + px, y: top + H / 2 - 0.05, z: az + pz, ry: r.range(-0.05, 0.05) });
    let cap = new THREE.BoxGeometry(1.7, 0.42, 1.7, 2, 1, 2);
    cap = weather(cap, 0.05, 1.5, 211 + px);
    place(cap, { x: ax + px, y: top + H + 0.12, z: az + pz, rz: r.range(-0.04, 0.04) });
    let base = new THREE.BoxGeometry(1.9, 0.5, 1.9);
    base = weather(base, 0.06, 1.4, 221 + px);
    place(base, { x: ax + px, y: top + 0.2, z: az + pz });
    for (const g of [post, cap, base]) parts.push(setUV(g, ...UV_PLAIN));
  }
  // fallen blocks at the broken corners
  for (let k = 0; k < 7; k++) {
    let g = new THREE.BoxGeometry(r.range(0.9, 1.8), r.range(0.5, 0.9), r.range(0.8, 1.3), 2, 1, 1);
    g = weather(g, 0.09, 1.7, 301 + k);
    const side = r.sign();
    const x = ax + side * (hx + r.range(0.8, 2.5)), z = az + r.range(-hz + 1, hz + 1.5);
    place(g, { x, y: ground.heightAt(x, z) + 0.2, z, rx: r.range(-0.4, 0.4), ry: r() * 6.3, rz: r.range(-0.4, 0.4) });
    parts.push(setUV(g, ...UV_PLAIN));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------------------------
// steles

function steleOutline(w, h, cut, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  if (cut > 0) {
    const yc = h * cut, k = 7;
    s.lineTo(w / 2, yc + r.range(-0.1, 0.3));
    for (let i = k - 1; i >= 1; i--) {
      const x = -w / 2 + (w * i) / k;
      s.lineTo(x, yc + r.range(-0.18, 0.18) + (x / w) * 0.35);
    }
    s.lineTo(-w / 2, yc + r.range(-0.25, 0.05));
  } else {
    const yh = h - w * 0.38;
    s.lineTo(w / 2, yh);
    s.quadraticCurveTo(w / 2, h, 0, h);
    s.quadraticCurveTo(-w / 2, h, -w / 2, yh);
  }
  s.lineTo(-w / 2, 0);
  return s;
}
function steleSlab(w, h, cut, r, thick = 0.38) {
  const g = new THREE.ExtrudeGeometry(steleOutline(w, h, cut, r), { depth: thick, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 1, curveSegments: 7 });
  g.translate(0, 0, -thick / 2);
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nz = n.getZ(i);
    if (Math.abs(nz) > 0.9) {
      const u = (p.getX(i) + w / 2) / w;
      uv[i * 2] = nz > 0 ? u : 1 - u;
      uv[i * 2 + 1] = p.getY(i) / h;
    } else { uv[i * 2] = 0.01; uv[i * 2 + 1] = 0.01; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return weather(g, 0.025, 2.0, Math.floor(r() * 1000));
}
function turtleBase(w, r) {
  const parts = [];
  const shell = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  place(shell, { y: 0.0, sx: w * 0.62 + 0.42, sy: 0.75, sz: 1.5 });
  parts.push(weather(shell, 0.05, 2.4, 41));
  const rim = new THREE.CylinderGeometry(w * 0.62 + 0.48, w * 0.62 + 0.52, 0.18, 14, 1);
  place(rim, { y: 0.05, sz: 1.5 / (w * 0.62 + 0.42) });
  parts.push(rim);
  const head = new THREE.SphereGeometry(0.3, 10, 7);
  place(head, { y: 0.32, z: 1.72, sx: 0.9, sy: 0.85, sz: 1.25, rx: -0.25 });
  parts.push(weather(head, 0.03, 4, 43));
  for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.SphereGeometry(0.24, 8, 6);
    place(leg, { x: lx * (w * 0.55 + 0.38), y: 0.08, z: lz * 1.05, sx: 1.2, sy: 0.7, sz: 1.4 });
    parts.push(leg);
  }
  const socket = new THREE.BoxGeometry(w + 0.25, 0.22, 0.62);
  place(socket, { y: 0.78 });
  parts.push(socket);
  for (const g of parts) setUV(g, 0.01, 0.01);
  void r;
  return { geo: merge(parts), top: 0.89 };
}
function blockBase(w) {
  let g = new THREE.BoxGeometry(w + 0.55, 0.55, 0.95, 2, 1, 1);
  g = weather(g, 0.05, 1.8, 51);
  place(g, { y: 0.22 });
  return { geo: setUV(g, 0.01, 0.01), top: 0.49 };
}

// ---------------------------------------------------------------------------------------------------------------
// the gateway (pailou)

/** A slab whose top follows y = f(u, v) over u, v in [-1, 1] (x = u * hx, z = v * hz), `thick` deep. */
function heightSlab(hx, hz, f, thick, nu = 18, nv = 8) {
  const pos = [];
  const P = (i, j, bottom) => {
    const u = (i / nu) * 2 - 1, v = (j / nv) * 2 - 1;
    return [u * hx * (1 + 0.05 * Math.abs(v)), f(u, v) - (bottom ? thick : 0), v * hz];
  };
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    quad(P(i, j, false), P(i, j + 1, false), P(i + 1, j + 1, false), P(i + 1, j, false));       // top
    quad(P(i, j, true), P(i + 1, j, true), P(i + 1, j + 1, true), P(i, j + 1, true));           // underside
  }
  for (let i = 0; i < nu; i++) {
    quad(P(i, 0, false), P(i + 1, 0, false), P(i + 1, 0, true), P(i, 0, true));
    quad(P(i, nv, false), P(i, nv, true), P(i + 1, nv, true), P(i + 1, nv, false));
  }
  for (let j = 0; j < nv; j++) {
    quad(P(0, j, false), P(0, j, true), P(0, j + 1, true), P(0, j + 1, false));
    quad(P(nu, j, false), P(nu, j + 1, false), P(nu, j + 1, true), P(nu, j, true));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Chinese hip roof: concave slopes, eaves curling up at the corners, a ridge with end ornaments, brackets below. */
function roofGeo(len, depth = 2.5, h = 1.0, lift = 0.5) {
  const f = (u, v) => {
    const au = Math.abs(u), av = Math.abs(v);
    const hip = Math.max(av, (au - 0.72) / 0.28);                // the short ends slope too (hip)
    const s = Math.pow(1 - Math.min(1, Math.max(av, hip * 0.9)), 1.7) * h;
    return s + lift * Math.pow(av, 2.4) * (0.25 + 0.75 * Math.pow(au, 5)) + lift * 0.6 * Math.pow(au, 6) * av;
  };
  const parts = [heightSlab(len / 2, depth / 2, f, 0.16)];
  const ridge = new THREE.BoxGeometry(len * 0.72, 0.26, 0.3);
  ridge.translate(0, h + 0.08, 0);
  parts.push(ridge);
  for (const sx of [-1, 1]) {      // ridge-end ornaments curling inwards
    const orn = new THREE.BoxGeometry(0.22, 0.62, 0.26);
    place(orn, { x: sx * len * 0.36, y: h + 0.33, rz: -sx * 0.35 });
    const tip = new THREE.BoxGeometry(0.34, 0.16, 0.22);
    place(tip, { x: sx * (len * 0.36 - 0.12), y: h + 0.64, rz: sx * 0.4 });
    parts.push(orn, tip);
  }
  for (let x = -len / 2 + 0.45; x <= len / 2 - 0.45; x += 0.62) {   // bracket sets (dougong) under the eaves
    for (const sz of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.24, 0.24, 0.62);
      place(b, { x, y: -0.15, z: sz * 0.42 });
      parts.push(b);
    }
  }
  return merge(parts);
}

function buildArchway(ground, r) {
  const standing = [], fallen = [];
  const { z: Z, height: H, post: PW } = ARCHWAY;
  const gy = (x, z) => ground.heightAt(x, z);
  const postGeo = (x, h, seed) => {
    let g = new THREE.BoxGeometry(PW, h, PW, 1, 4, 1);
    g = weather(g, 0.05, 1.6, seed);
    place(g, { x, y: gy(x, Z) + h / 2 - 0.2, z: Z });
    return g;
  };
  const plinth = (x, seed) => {
    let g = new THREE.BoxGeometry(1.5, 0.55, 1.75, 2, 1, 2);
    g = weather(g, 0.06, 1.5, seed);
    place(g, { x, y: gy(x, Z) + 0.12, z: Z });
    return g;
  };
  const drums = (x, list) => {
    for (const s of [-1, 1]) {
      const blk = new THREE.BoxGeometry(0.42, 0.55, 0.95);
      place(blk, { x, y: gy(x, Z) + 0.28, z: Z + s * 1.1 });
      const drum = new THREE.CylinderGeometry(0.55, 0.55, 0.34, 18);
      place(drum, { x, y: gy(x, Z) + 1.05, z: Z + s * 1.05, rz: Math.PI / 2 });
      list.push(weather(blk, 0.03, 2, 61 + x), weather(drum, 0.025, 2.5, 63 + x));
    }
  };
  // right half still stands: two posts, beams, plaque, roof
  for (const [x, seed] of [[3.2, 71], [9.6, 73]]) {
    standing.push(postGeo(x, H, seed), plinth(x, seed + 1));
    drums(x, standing);
  }
  const b1 = new THREE.BoxGeometry(6.4 + 1.2, 0.66, 0.62, 6, 1, 1);
  place(b1, { x: 6.4, y: 6.1, z: Z });
  const b2 = new THREE.BoxGeometry(6.4 + 1.6, 0.5, 0.52, 6, 1, 1);
  place(b2, { x: 6.4, y: 7.55, z: Z });
  const plaque = new THREE.BoxGeometry(2.9, 1.1, 0.34);
  place(plaque, { x: 6.4, y: 6.84, z: Z });
  // a heavy tiled hip roof with deep curling eaves and a second, smaller roof stacked above (重檐): from afar the
  // thin single lintel read like a torii; the mass of the roofs is what says pailou
  const roof = roofGeo(9.6, 3.6, 1.6, 0.8);
  place(roof, { x: 6.4, y: 7.8, z: Z });
  const lou = new THREE.BoxGeometry(2.6, 1.1, 1.3, 2, 1, 1);
  place(lou, { x: 6.4, y: 7.8 + 1.6 + 0.4, z: Z });
  const roofTop = roofGeo(4.6, 2.7, 1.25, 0.7);
  place(roofTop, { x: 6.4, y: 7.8 + 1.6 + 0.95, z: Z });
  standing.push(weather(b1, 0.04, 1.2, 81), weather(b2, 0.04, 1.2, 83), weather(plaque, 0.03, 2, 85), weather(roof, 0.05, 1.1, 87),
    weather(lou, 0.04, 1.5, 88), weather(roofTop, 0.05, 1.1, 86));
  // the broken stub of the central beam hanging off post 3.2
  const stub = new THREE.BoxGeometry(2.8, 0.7, 0.62, 3, 1, 1);
  stub.translate(-1.4, 0, 0);
  place(stub, { x: 3.2 - PW / 2, y: 7.0, z: Z, rz: 0.42 });
  standing.push(weather(stub, 0.06, 1.8, 89));
  // left half: a stump, the post broken in two lying towards the giant, the outer post toppled, beams and roof down
  standing.push(postGeo(-3.2, 2.1, 91), plinth(-3.2, 92), plinth(-9.6, 93));
  drums(-3.2, standing);
  const lie = (a, b, w, seed, roll = 0) => {
    const ya = gy(a[0], a[1]) + w * 0.42, yb = gy(b[0], b[1]) + w * 0.42;
    let g = new THREE.BoxGeometry(w, 1, w, 1, 3, 1);
    g.rotateY(roll);
    g = between(g, new THREE.Vector3(a[0], ya, a[1]), new THREE.Vector3(b[0], yb, b[1]));
    return weather(g, 0.05, 1.6, seed);
  };
  fallen.push(lie([-4.15, 26.7], [-6.2, 23.3], PW, 95, 0.2));
  fallen.push(lie([-6.55, 22.55], [-8.25, 19.75], PW, 96, 0.5));
  fallen.push(lie([-9.7, 29.6], [-14.6, 32.7], PW, 97, 0.1));
  fallen.push(lie([-9.5, 31.2], [-6.6, 31.5], 0.62, 98));
  fallen.push(lie([-6.1, 31.7], [-3.4, 32.4], 0.62, 99, 0.3));
  const roof2 = roofGeo(4.4, 2.3, 1.05);
  place(roof2, { x: -1.4, y: gy(-1.4, 24.6) + 0.15, z: 24.6, ry: 0.65, rz: 0.22, rx: 0.12 });
  fallen.push(weather(roof2, 0.06, 1.3, 101));
  for (let k = 0; k < 9; k++) {                  // rubble from the roof and beams
    let g = new THREE.BoxGeometry(r.range(0.3, 0.8), r.range(0.2, 0.45), r.range(0.3, 0.7), 1, 1, 1);
    g = weather(g, 0.06, 2.4, 111 + k);
    const x = r.range(-8, 1), z = Z + r.range(-5, 4);
    place(g, { x, y: gy(x, z) + 0.12, z, rx: r() * 3, ry: r() * 3, rz: r() * 3 });
    fallen.push(g);
  }
  for (const g of standing) setUV(g, ...UV_PLAIN);
  for (const g of fallen) setUV(g, ...UV_PLAIN);
  return merge(standing.concat(fallen));
}

// ---------------------------------------------------------------------------------------------------------------
// basalt columns

function basaltCluster(c, ground, r, out) {
  const rc = (c.r / Math.sqrt(c.n)) * 0.92;
  const pts = [];
  const sp = rc * 1.86;
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
    const x = (i + (j & 1) * 0.5) * sp, z = j * sp * 0.866;
    if (Math.hypot(x, z) <= c.r) pts.push([x + r.range(-0.08, 0.08) * rc, z + r.range(-0.08, 0.08) * rc]);
  }
  pts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  const n = Math.min(c.n, pts.length);
  for (let k = 0; k < n; k++) {
    const [ox, oz] = pts[k];
    const d = Math.hypot(ox, oz) / c.r;
    const broken = r() < 0.25;
    const H = (c.h[0] + (c.h[1] - c.h[0]) * Math.pow(1 - d, 0.6) * r.range(0.55, 1.0)) * (broken ? 0.45 : 1);
    // hexagonal prism with a chamfered, chipped crown and joint steps down the shaft (columnar jointing), then
    // weathered faces: from a box-like prism to a crafted basalt column
    const segs = Math.max(4, Math.round(H / 0.9));
    let g = new THREE.CylinderGeometry(rc * 0.97, rc * 1.03, H, 6, segs, false);
    const p0 = g.attributes.position;
    const tx = r.range(-0.35, 0.35), tz = r.range(-0.35, 0.35);
    const joints = Array.from({ length: segs + 1 }, () => 1 - (r() < 0.45 ? r.range(0.03, 0.08) : 0));
    for (let i = 0; i < p0.count; i++) {
      const y = p0.getY(i), rad = Math.hypot(p0.getX(i), p0.getZ(i));
      const ring = Math.round((y / H + 0.5) * segs);
      let k = joints[ring];
      if (y > H / 2 - 1e-4 && rad > 1e-4) k *= 0.84;                    // chamfered crown
      p0.setX(i, p0.getX(i) * k); p0.setZ(i, p0.getZ(i) * k);
      if (y > H / 2 - 1e-4) {
        const jag = broken ? r.range(-0.25, 0.25) * rc : 0;
        p0.setY(i, y + (p0.getX(i) * tx + p0.getZ(i) * tz) + jag + (rad > 1e-4 ? -0.06 * rc : 0.04 * rc));
      }
    }
    g = weather(g, rc * 0.05, 2.2 / rc, r.int(1, 999));
    const x = c.x + ox, z = c.z + oz;
    place(g, { x, y: ground.heightAt(x, z) + H / 2 - 0.35, z, ry: r() * Math.PI, rx: r.range(-0.035, 0.035), rz: r.range(-0.035, 0.035) });
    out.push(g);
  }
  // a couple of fallen column drums around the cluster
  const nf = r.int(1, 3);
  for (let k = 0; k < nf; k++) {
    const a = r() * Math.PI * 2, dd = c.r + r.range(0.8, 2.2);
    const x = c.x + Math.cos(a) * dd, z = c.z + Math.sin(a) * dd;
    const L = r.range(1.0, 2.6);
    let g = new THREE.CylinderGeometry(rc, rc, L, 6, 1).toNonIndexed();
    g.computeVertexNormals();
    place(g, { x, y: ground.heightAt(x, z) + rc * 0.8, z, rz: Math.PI / 2, ry: r() * Math.PI, order: 'YXZ' });
    out.push(g);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// weapons, bones, chains, rocks (instanced)

function swordGeo() {
  const blade = new THREE.BoxGeometry(0.062, 0.95, 0.014, 1, 6, 1);
  blade.translate(0, 0.475, 0);
  const p = blade.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = y < 0.22 ? y / 0.22 : 1;                 // the tip (in the ground) tapers to a point
    p.setX(i, p.getX(i) * (0.05 + 0.95 * Math.sqrt(k)));
    p.setZ(i, p.getZ(i) * (0.4 + 0.6 * k));
  }
  blade.computeVertexNormals();
  const guard = new THREE.BoxGeometry(0.27, 0.036, 0.055);
  guard.translate(0, 0.97, 0);
  const grip = new THREE.CylinderGeometry(0.017, 0.02, 0.21, 6);
  grip.translate(0, 1.09, 0);
  const pommel = new THREE.SphereGeometry(0.034, 6, 4);
  pommel.translate(0, 1.22, 0);
  return merge([blade, guard, grip, pommel]);
}
function spearGeo() {
  const shaft = new THREE.CylinderGeometry(0.02, 0.024, 2.3, 6);
  shaft.translate(0, 1.15, 0);
  const head = new THREE.ConeGeometry(0.05, 0.34, 4);
  head.scale(1, 1, 0.35);
  head.translate(0, 2.47, 0);
  const socket = new THREE.CylinderGeometry(0.028, 0.03, 0.12, 6);
  socket.translate(0, 2.27, 0);
  const side = new THREE.BoxGeometry(0.2, 0.05, 0.012);       // ji: a crescent side blade
  side.translate(0.1, 2.22, 0);
  return merge([shaft, head, socket, side]);
}
function shieldGeo() {
  const disc = new THREE.CylinderGeometry(0.36, 0.38, 0.045, 14);
  const boss = new THREE.SphereGeometry(0.09, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  boss.translate(0, 0.02, 0);
  return merge([disc, boss]);
}
function helmGeo() {
  const dome = new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const brim = new THREE.TorusGeometry(0.15, 0.02, 4, 12);
  brim.rotateX(Math.PI / 2);
  brim.translate(0, 0.03, 0);
  return merge([dome, brim]);
}
function skullGeo() {
  const cran = vcolor(place(new THREE.SphereGeometry(0.1, 10, 8), { sy: 1.1, sz: 1.25, y: 0.1 }), 1, 1, 1);
  const jaw = vcolor(place(new THREE.BoxGeometry(0.11, 0.045, 0.1), { y: 0.03, z: 0.07 }), 1, 1, 1);
  const parts = [cran, jaw];
  for (const s of [-1, 1]) parts.push(vcolor(place(new THREE.SphereGeometry(0.03, 6, 4), { x: s * 0.038, y: 0.1, z: 0.105 }), 0.06, 0.05, 0.045));
  parts.push(vcolor(place(new THREE.SphereGeometry(0.018, 5, 3), { y: 0.065, z: 0.122 }), 0.06, 0.05, 0.045));
  return merge(parts);
}
function longBoneGeo() {
  const shaft = vcolor(new THREE.CylinderGeometry(0.02, 0.024, 0.42, 6), 1, 1, 1);
  const parts = [shaft];
  for (const s of [-1, 1]) parts.push(vcolor(place(new THREE.SphereGeometry(0.038, 6, 4), { y: s * 0.21, sx: 1.3 }), 1, 1, 1));
  return merge(parts);
}
function ribGeo() {
  return vcolor(new THREE.TorusGeometry(0.17, 0.012, 4, 10, Math.PI * 0.85), 1, 1, 1);
}
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  return weather(g, 0.55, 1.1, seed);
}

// ---------------------------------------------------------------------------------------------------------------

export function createProps({ ground, masks, rockTex, runeTex, friezeTex, quality = 'high' }) {
  const r = rng(20251113);
  const group = new THREE.Group();
  group.name = 'volcano-props';
  const lavaR = (x, z) => sampleField(masks.mask, masks.res, x, z, 0);
  const lakeG = (x, z) => sampleField(masks.mask, masks.res, x, z, 1);
  const gy = (x, z) => ground.heightAt(x, z);
  const colliders = [];
  const sinkers = [];
  const dens = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;

  // --- materials ---
  const stone = createRockMaterial({ map: rockTex, scale: 0.42, tint: [1.55, 1.45, 1.35], bump: 1.0, ash: 0.75, scorch: 0.4, roughness: 0.9, name: 'volc-stone' });
  const frieze = createRockMaterial({ map: rockTex, scale: 0.42, tint: [1.55, 1.45, 1.35], bump: 1.0, ash: 0.75, scorch: 0.4, roughness: 0.9, name: 'volc-frieze', carve: { map: friezeTex, strength: 0.9 } });
  const runes = createRockMaterial({ map: rockTex, scale: 0.55, tint: [1.45, 1.38, 1.3], bump: 0.8, ash: 0.6, scorch: 0.3, roughness: 0.88, name: 'volc-runes', carve: { map: runeTex, strength: 1.0 } });
  const basalt = createRockMaterial({ map: rockTex, scale: 0.33, tint: [0.85, 0.82, 0.8], bump: 1.4, ash: 0.85, scorch: 0.6, roughness: 0.93, name: 'volc-basalt' });
  const basaltFar = createRockMaterial({ map: rockTex, scale: 0.25, tint: [0.55, 0.52, 0.5], bump: 1.0, ash: 0.6, scorch: 0.6, roughness: 0.95, name: 'volc-basalt-far' });
  const rocks = createRockMaterial({ map: rockTex, scale: 0.4, tint: [0.95, 0.9, 0.86], bump: 1.2, ash: 0.7, scorch: 0.6, roughness: 0.95, name: 'volc-rocks', sink: 2.6 });
  const iron = patchVolcanoMaterial(new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.78, metalness: 0.55 }), { ash: 0.3, key: 'volc-iron', sink: 2.6 });
  const ironBig = patchVolcanoMaterial(new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 0.8, metalness: 0.5 }), { ash: 0.45, key: 'volc-iron-big' });
  const bone = patchVolcanoMaterial(new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.85, metalness: 0, vertexColors: true }), { ash: 0.5, key: 'volc-bone', sink: 2.6 });
  const boneBig = patchVolcanoMaterial(new THREE.MeshStandardMaterial({ color: 0x7a7266, roughness: 0.88, metalness: 0 }), { ash: 0.7, key: 'volc-bone-big' });
  const bronze = patchVolcanoMaterial(new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.62, metalness: 0.7 }), { ash: 0.55, key: 'volc-bronze' });
  const mats = [stone, frieze, runes, basalt, basaltFar, rocks, iron, ironBig, bone, boneBig, bronze];

  // --- the altar ---
  const altar = new THREE.Mesh(buildAltar(ground, r), frieze);
  altar.name = 'altar';
  altar.castShadow = true; altar.receiveShadow = true;
  group.add(altar);

  // --- steles ---
  for (const [i, s] of STELES.entries()) {
    const rr = rng(500 + i);
    const base = s.base === 'turtle' ? turtleBase(s.w, rr) : blockBase(s.w);
    const parts = [base.geo];
    if (s.fallen) {
      // the slab lies face up in front of its empty socket
      const slab = steleSlab(s.w, s.h, 0, rr);
      place(slab, { rx: Math.PI / 2 - 0.05, y: 0.2, z: 0.62, ry: 0.25, order: 'YXZ' });
      parts.push(slab);
    } else {
      const slab = steleSlab(s.w, s.h, s.cut, rr);
      place(slab, { y: base.top - 0.04, rx: s.lean[0], rz: s.lean[1] });
      parts.push(slab);
      if (s.fallenTop) {
        const top = steleSlab(s.w, s.h * (1 - s.cut), 0, rr);
        place(top, { rx: Math.PI / 2 - 0.12, y: 0.2, x: 1.0, z: 0.9, ry: 0.7, order: 'YXZ' });
        parts.push(top);
      }
    }
    const mesh = new THREE.Mesh(merge(parts), runes);
    mesh.name = 'stele';
    mesh.position.set(s.x, gy(s.x, s.z) - 0.12, s.z);
    mesh.rotation.y = s.yaw;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    if (lakeG(s.x, s.z) > 0.3) sinkers.push(objectSinker(mesh, lakeG(s.x, s.z), 3.2, rr.range(-0.25, 0.25)));
  }

  // --- the gateway ---
  const arch = new THREE.Mesh(buildArchway(ground, r), stone);
  arch.name = 'archway';
  arch.castShadow = true; arch.receiveShadow = true;
  const archPivot = new THREE.Group();
  archPivot.position.set(0, 0, ARCHWAY.z);
  arch.position.set(0, 0, -ARCHWAY.z);
  archPivot.add(arch);
  group.add(archPivot);
  colliders.push({ x: -3.2, z: ARCHWAY.z, r: 0.75 }, { x: -9.6, z: ARCHWAY.z, r: 0.8 });
  sinkers.push(objectSinker(archPivot, Math.max(lakeG(0, ARCHWAY.z), lakeG(6, ARCHWAY.z)), 4.5, 0.09));

  // --- basalt columns ---
  const colGeos = [];
  for (const c of PILLAR_CLUSTERS) basaltCluster(c, ground, rng(700 + c.seed), colGeos);
  const columns = new THREE.Mesh(merge(colGeos), basalt);
  columns.name = 'basalt-columns';
  columns.castShadow = true; columns.receiveShadow = true;
  group.add(columns);
  const wallGeos = [];
  for (const c of WALL_CLUSTERS) basaltCluster(c, ground, rng(800 + c.seed), wallGeos);
  const wallCols = new THREE.Mesh(merge(wallGeos), basaltFar);
  wallCols.name = 'basalt-walls';
  wallCols.castShadow = false; wallCols.receiveShadow = true;
  group.add(wallCols);

  // --- the toppled ding ---
  {
    const prof = [[0.05, 0], [1.1, 0.06], [1.42, 0.35], [1.55, 0.95], [1.6, 1.42], [1.72, 1.5], [1.7, 1.58], [1.5, 1.55], [1.44, 1.0], [1.3, 0.4], [0.05, 0.18]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const parts = [new THREE.LatheGeometry(prof, 22)];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const leg = new THREE.CylinderGeometry(0.17, 0.22, 1.5, 7);
      place(leg, { x: Math.cos(a) * 0.95, y: -0.65, z: Math.sin(a) * 0.95 });
      parts.push(leg);
    }
    for (const s of [-1, 1]) {
      const ear = new THREE.TorusGeometry(0.34, 0.09, 5, 10, Math.PI);
      place(ear, { x: s * 1.2, y: 1.58, ry: Math.PI / 2 });
      parts.push(ear);
    }
    const band = new THREE.TorusGeometry(1.56, 0.06, 4, 28);
    place(band, { y: 1.18, rx: Math.PI / 2 });
    parts.push(band);
    const ding = new THREE.Mesh(weather(merge(parts), 0.04, 2.0, 901), bronze);
    ding.name = 'ding';
    ding.position.set(CAULDRON.x, gy(CAULDRON.x, CAULDRON.z) + 1.0, CAULDRON.z);
    ding.rotation.set(0, CAULDRON.yaw, 1.78, 'YXZ');
    ding.castShadow = true; ding.receiveShadow = true;
    group.add(ding);
  }

  // --- giant chains from the altar's front posts ---
  {
    const link = new THREE.TorusGeometry(0.5, 0.13, 6, 14);
    link.scale(1, 1.45, 1);
    const links = [];
    // Euler 'YZX': x tips the link (long axis y) over onto the chain direction, z rolls it upright, y is the heading
    const lay = (a, b, n, hang) => {
      // a: [x, y, z] start (post top or base), b: [x, z] end on the ground
      const dir = Math.atan2(b[0] - a[0], b[1] - a[2]);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[1] - a[2]) * t;
        const ground0 = gy(x, z) + 0.13;
        const y = hang ? Math.max(ground0, a[1] * (1 - t * 2.2)) : ground0;
        const hanging = hang && y > ground0 + 0.2;
        if (hanging) links.push({ x, y, z, rx: 0.25, ry: dir + (k % 2) * Math.PI / 2, rz: 0 });
        else links.push({ x, y: ground0 + (k % 2 ? 0.45 : 0), z, rx: Math.PI / 2, ry: dir, rz: k % 2 ? Math.PI / 2 : 0 });
      }
    };
    lay([CHAIN_ANCHORS[0].x + 0.6, 3.6, CHAIN_ANCHORS[0].z + 0.7], [-7.4, -13.2], 11, true);
    lay([CHAIN_ANCHORS[1].x - 0.6, 3.6, CHAIN_ANCHORS[1].z + 0.7], [17.8, -12.8], 10, true);
    lay([-17.6, 0, -15.2], [-21.2, -9.8], 5, false);
    const inst = new THREE.InstancedMesh(link, iron, links.length);
    inst.name = 'chains';
    links.forEach((l, i) => {
      _e.set(l.rx, l.ry, l.rz, 'YZX');
      _m.compose(_v.set(l.x, l.y, l.z), _q.setFromEuler(_e), _s.set(1, 1, 1));
      inst.setMatrixAt(i, _m);
    });
    inst.castShadow = true; inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }

  // --- the remains of earlier challengers: weapons and bones ---
  const all = propColliders().concat(colliders);
  const blocked = (x, z, m = 0.4) => {
    if (lavaR(x, z) > 0.12) return true;
    if (Math.abs(x - ALTAR.x) < ALTAR.hx + 0.6 && Math.abs(z - ALTAR.z) < ALTAR.hz + 0.6) return true;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 2.5) return true;
    return all.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + m);
  };
  const hotspots = [
    ...STELES.map((s) => [s.x, s.z, 4.5]), [0, -15, 9], [-7, -9, 6], [8, -8, 6], [GIANT_SWORD.x, GIANT_SWORD.z, 5],
    [-2, 12, 7], [3, 30, 6], [-14, 26, 5], [16, 14, 6], [-22, -6, 5], [24, -12, 5], [0, 4, 8],
  ];
  const spot = (rr) => {
    for (let tries = 0; tries < 40; tries++) {
      let x, z;
      if (rr() < 0.82) {
        const h = rr.pick(hotspots);
        const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * h[2];
        x = h[0] + Math.cos(a) * d; z = h[1] + Math.sin(a) * d;
      } else { x = rr.range(BOUNDS.minX + 2, BOUNDS.maxX - 2); z = rr.range(BOUNDS.minZ + 4, BOUNDS.maxZ - 2); }
      if (!blocked(x, z)) return [x, z];
    }
    return null;
  };
  const instanced = (geo, mat, count, fn, name, shadow = true) => {
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.name = name;
    let n = 0;
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const res = fn(i, col);
      if (!res) continue;
      inst.setMatrixAt(n, res);
      if (inst.instanceColor || col.r !== 1 || col.g !== 1 || col.b !== 1) inst.setColorAt(n, col);
      n++;
    }
    inst.count = n;
    inst.castShadow = shadow; inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.customDepthMaterial = sinkDepthMaterial(2.6);
    group.add(inst);
    return inst;
  };
  const rr = rng(4242);
  const stuck = (len, bury, maxLean) => (i, col) => {
    const p = spot(rr);
    if (!p) return null;
    const lean = rr.range(0.05, maxLean), dir = rr() * Math.PI * 2;
    _e.set(Math.cos(dir) * lean, rr() * Math.PI * 2, Math.sin(dir) * lean, 'YXZ');
    col.setRGB(rr.range(0.8, 1.15), rr.range(0.75, 1.05), rr.range(0.7, 1.0));
    return _m.compose(_v.set(p[0], gy(p[0], p[1]) - bury * len, p[1]), _q.setFromEuler(_e), _s.setScalar(rr.range(0.85, 1.15))).clone();
  };
  const lying = (h, scale = [0.85, 1.15]) => (i, col) => {
    const p = spot(rr);
    if (!p) return null;
    _e.set(rr.range(-0.25, 0.25) + (rr() < 0.5 ? Math.PI / 2 : 0), rr() * Math.PI * 2, rr.range(-0.3, 0.3), 'YXZ');
    const sc = rr.range(scale[0], scale[1]);
    col.setRGB(rr.range(0.75, 1.1), rr.range(0.72, 1.05), rr.range(0.68, 1.0));
    return _m.compose(_v.set(p[0], gy(p[0], p[1]) + h * sc, p[1]), _q.setFromEuler(_e), _s.setScalar(sc)).clone();
  };
  instanced(swordGeo(), iron, Math.round(46 * dens), stuck(1.2, 0.18, 0.55), 'swords');
  instanced(spearGeo(), iron, Math.round(30 * dens), stuck(2.4, 0.12, 0.7), 'spears');
  instanced(shieldGeo(), iron, Math.round(12 * dens), lying(0.03), 'shields');
  instanced(helmGeo(), iron, Math.round(12 * dens), lying(0.06), 'helmets');
  instanced(skullGeo(), bone, Math.round(30 * dens), (i, col) => {
    const p = spot(rr);
    if (!p) return null;
    _e.set(rr.range(-0.5, 0.3), rr() * Math.PI * 2, rr.range(-0.4, 0.4), 'YXZ');
    col.setRGB(rr.range(0.8, 1.05), rr.range(0.78, 1.0), rr.range(0.7, 0.92));
    return _m.compose(_v.set(p[0], gy(p[0], p[1]) - 0.02, p[1]), _q.setFromEuler(_e), _s.setScalar(rr.range(0.9, 1.1))).clone();
  }, 'skulls', false);
  instanced(longBoneGeo(), bone, Math.round(80 * dens), (i, col) => {
    const p = spot(rr);
    if (!p) return null;
    _e.set(Math.PI / 2 + rr.range(-0.2, 0.2), rr() * Math.PI * 2, 0, 'YXZ');
    col.setRGB(rr.range(0.8, 1.05), rr.range(0.78, 1.0), rr.range(0.7, 0.92));
    return _m.compose(_v.set(p[0], gy(p[0], p[1]) + 0.025, p[1]), _q.setFromEuler(_e), _s.setScalar(rr.range(0.8, 1.2))).clone();
  }, 'bones', false);
  instanced(ribGeo(), bone, Math.round(50 * dens), (i, col) => {
    const p = spot(rr);
    if (!p) return null;
    _e.set(Math.PI / 2 + rr.range(-0.3, 0.3), rr() * Math.PI * 2, rr.range(-0.3, 0.3), 'YXZ');
    col.setRGB(rr.range(0.8, 1.05), rr.range(0.78, 1.0), rr.range(0.7, 0.92));
    return _m.compose(_v.set(p[0], gy(p[0], p[1]) + 0.02, p[1]), _q.setFromEuler(_e), _s.setScalar(rr.range(0.8, 1.3))).clone();
  }, 'ribs', false);

  // giant weapons of giant challengers
  {
    const gs = new THREE.Mesh(swordGeo(), ironBig);
    gs.name = 'giant-sword';
    gs.scale.setScalar(6.2);
    gs.position.set(GIANT_SWORD.x, gy(GIANT_SWORD.x, GIANT_SWORD.z) - 1.4, GIANT_SWORD.z);
    gs.rotation.set(GIANT_SWORD.tilt * 0.4, GIANT_SWORD.yaw, GIANT_SWORD.tilt, 'YXZ');
    gs.castShadow = true; gs.receiveShadow = true;
    group.add(gs);
    if (lakeG(GIANT_SWORD.x, GIANT_SWORD.z) > 0.3) sinkers.push(objectSinker(gs, 1, 7, 0.2));
    const sp = new THREE.Mesh(spearGeo(), ironBig);
    sp.name = 'giant-spear';
    sp.scale.set(5, 3.3, 5);
    sp.position.set(GIANT_SPEAR.x, gy(GIANT_SPEAR.x, GIANT_SPEAR.z) - 0.6, GIANT_SPEAR.z);
    sp.rotation.set(GIANT_SPEAR.tilt, GIANT_SPEAR.yaw, 0.15, 'YXZ');
    sp.castShadow = true; sp.receiveShadow = true;
    group.add(sp);
  }

  // giant ribcages (a beast that came before)
  {
    const parts = [];
    for (const rc of RIBCAGES) {
      const L = 9 * rc.s;
      const dx = Math.sin(rc.yaw), dz = Math.cos(rc.yaw);
      for (let k = 0; k < 10; k++) {
        const t = k / 9 - 0.5;
        const x = rc.x + dx * t * L, z = rc.z + dz * t * L;
        const vert = new THREE.BoxGeometry(0.75 * rc.s, 0.55 * rc.s, 0.62 * rc.s);
        place(vert, { x, y: gy(x, z) + 0.15 + Math.sin(k * 0.4) * 0.2, z, ry: rc.yaw, rx: Math.sin(k) * 0.2 });
        parts.push(weather(vert, 0.06 * rc.s, 2, 1000 + k));
        if (k > 0 && k < 9) {
          const R = (3.4 - Math.abs(t) * 3.2) * rc.s;
          const rib = new THREE.TorusGeometry(R, 0.15 * rc.s, 5, 16, Math.PI * 0.93);
          place(rib, { x, y: gy(x, z) - R * 0.3, z, ry: rc.yaw + Math.PI / 2, rz: 0.1 + (k % 2) * 0.08 });
          parts.push(rib);
        }
      }
    }
    const cages = new THREE.Mesh(merge(parts), boneBig);
    cages.name = 'ribcages';
    cages.castShadow = true; cages.receiveShadow = true;
    group.add(cages);
  }

  // rubble and boulders
  {
    const variants = [rockGeo(1), rockGeo(2), rockGeo(3)];
    const rrk = rng(777);
    for (const [vi, geo] of variants.entries()) {
      const list = [];
      const nSmall = Math.round(70 * dens), nBig = 12;
      for (let k = 0; k < nSmall + nBig; k++) {
        const big = k >= nSmall;
        let x, z, ok = false;
        for (let t = 0; t < 30 && !ok; t++) {
          if (big) {
            const a = rrk() * Math.PI * 2, d = rrk.range(36, 60);
            x = Math.sin(a) * d; z = 3 + Math.cos(a) * d * 1.05;
          } else { x = rrk.range(-55, 55); z = rrk.range(-50, 58); }
          ok = lavaR(x, z) < 0.15 && !(Math.abs(x - ALTAR.x) < ALTAR.hx + 0.5 && Math.abs(z - ALTAR.z) < ALTAR.hz + 0.5)
            && Math.hypot(x - SPAWN.x, z - SPAWN.z) > 3 && !all.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + (big ? 2.5 : 0.3));
        }
        if (!ok) continue;
        const sc = big ? rrk.range(0.9, 2.6) : rrk.range(0.1, 0.42);
        const inside = x > BOUNDS.minX && x < BOUNDS.maxX && z > BOUNDS.minZ && z < BOUNDS.maxZ;
        if (big && inside && sc > 1.1) colliders.push({ x, z, r: sc * 0.9 });
        _e.set(rrk() * 3, rrk() * 6.3, rrk() * 3);
        list.push(_m.compose(_v.set(x, gy(x, z) + sc * 0.25, z), _q.setFromEuler(_e), _s.set(sc * rrk.range(0.8, 1.3), sc * rrk.range(0.5, 0.9), sc * rrk.range(0.8, 1.3))).clone());
      }
      const inst = new THREE.InstancedMesh(geo, rocks, list.length);
      inst.name = 'rocks-' + vi;
      list.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.castShadow = true; inst.receiveShadow = true;
      inst.customDepthMaterial = sinkDepthMaterial(2.6);
      inst.computeBoundingSphere();
      group.add(inst);
    }
  }

  void clamp;
  return {
    group, colliders, sinkers, materials: mats,
    update() {},
  };
}

/** A prop that sinks into the phase-two lake: drops and tilts with the collapse. */
function objectSinker(obj, amount, depth, tilt) {
  const y0 = obj.position.y, rx0 = obj.rotation.x, rz0 = obj.rotation.z;
  const k = clamp((amount - 0.3) / 0.5, 0, 1);
  return {
    object: obj,
    apply(collapse) {
      const s = collapse * k;
      obj.position.y = y0 - s * depth;
      obj.rotation.x = rx0 + s * tilt * 0.6;
      obj.rotation.z = rz0 + s * tilt;
    },
  };
}
