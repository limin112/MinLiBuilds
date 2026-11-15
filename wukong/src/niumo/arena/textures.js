// Textures for the volcano arena: the artist's photo textures (assets/textures/tex_niumo_*.png) when present,
// procedural fallbacks otherwise, and the data textures the shaders need (crack network, rune carving, frieze).
import * as THREE from 'three';
import { tfbm, tnoise, hash2, smooth, clamp, rng } from './noise.js';

// resolved against this module, so any page (game/niumo.html, game/test/*.html) finds them
const TEX_DIR = new URL('../../../assets/textures/', import.meta.url).href;
export const EXTERNAL = {
  basalt: TEX_DIR + 'tex_niumo_basalt.png',
  ash: TEX_DIR + 'tex_niumo_ash.png',
  crust: TEX_DIR + 'tex_niumo_lavacrust.png',
};

function finishColor(tex, renderer, wrap = THREE.RepeatWrapping) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = wrap;
  tex.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Load one optional texture; resolves to null when it is missing or broken. */
export function loadOptional(url) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (t) => resolve(t), undefined, () => resolve(null));
  });
}

/**
 * Resolve the artist textures. `given` (optional) maps names to preloaded THREE.Textures (or null to force the
 * fallback); anything not given is loaded from EXTERNAL.
 */
export async function loadArenaTextures(given = {}) {
  const out = {};
  await Promise.all(Object.entries(EXTERNAL).map(async ([k, url]) => {
    if (k in given) { out[k] = given[k] || null; return; }
    out[k] = await loadOptional(url);
  }));
  return out;
}

export function configureExternal(tex, renderer) {
  return tex ? finishColor(tex, renderer) : null;
}

// --------------------------------------------------------------------------------------------------------------
// Tileable Voronoi with exact distance to the cell borders (two-pass, Inigo Quilez)

function voronoiTiler(cells, seed) {
  const pts = new Float32Array(cells * cells * 2);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    pts[(j * cells + i) * 2] = 0.1 + 0.8 * hash2(i, j, seed);
    pts[(j * cells + i) * 2 + 1] = 0.1 + 0.8 * hash2(i, j, seed + 77);
  }
  const wrap = (v) => ((v % cells) + cells) % cells;
  /** u, v in cell units. Returns [borderDist, cellId(0..1)]. */
  return (u, v) => {
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    let md = 8, mrx = 0, mry = 0, mgx = 0, mgy = 0;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const k = (wrap(iv + y) * cells + wrap(iu + x)) * 2;
      const rx = x + pts[k] - fu, ry = y + pts[k + 1] - fv;
      const d = rx * rx + ry * ry;
      if (d < md) { md = d; mrx = rx; mry = ry; mgx = x; mgy = y; }
    }
    let bd = 8;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      const gx = mgx + x, gy = mgy + y;
      const k = (wrap(iv + gy) * cells + wrap(iu + gx)) * 2;
      const rx = gx + pts[k] - fu, ry = gy + pts[k + 1] - fv;
      const dx = rx - mrx, dy = ry - mry;
      const l2 = dx * dx + dy * dy;
      if (l2 > 1e-5) bd = Math.min(bd, ((mrx + rx) * 0.5 * dx + (mry + ry) * 0.5 * dy) / Math.sqrt(l2));
    }
    return [bd, hash2(wrap(iu + mgx), wrap(iv + mgy), seed + 5)];
  };
}

/**
 * Crack network data texture (linear RGBA8, tileable):
 *  R  distance to the plate borders (big plates), scaled so 1.0 = 0.5 cell
 *  G  plate id (random per plate)
 *  B  distance to the borders of small sub-plates (fine cracks)
 *  A  surface relief noise
 */
export function makeCrackTexture(size = 512, seed = 7) {
  const big = voronoiTiler(7, seed), small = voronoiTiler(19, seed + 31);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // warp the lookups a little so the borders are not straight
      const wu = (tfbm(x, y, size, 6, 3, seed + 1) - 0.5) * 0.18, wv = (tfbm(x + 97, y + 31, size, 6, 3, seed + 2) - 0.5) * 0.18;
      const [bd, id] = big((u + wu * 0.4) * 7, (v + wv * 0.4) * 7);
      const [sd] = small((u + wu) * 19, (v + wv) * 19);
      const relief = tfbm(x, y, size, 16, 4, seed + 3);
      const k = (y * size + x) * 4;
      data[k] = Math.round(clamp(bd * 2, 0, 1) * 255);
      data[k + 1] = Math.round(id * 255);
      data[k + 2] = Math.round(clamp(sd * 2, 0, 1) * 255);
      data[k + 3] = Math.round(relief * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function dataToTexture(data, size, renderer) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  return finishColor(tex, renderer);
}

/** Procedural basalt albedo (fallback for tex_niumo_basalt): charcoal, pitted, fractured, rust-stained. */
export function makeBasaltTexture(renderer, size = 512, seed = 3) {
  const fr = voronoiTiler(9, seed + 9);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n1 = tfbm(x, y, size, 4, 4, seed), n2 = tfbm(x, y, size, 24, 3, seed + 1);
    const pit = tnoise((x / size) * 96, (y / size) * 96, 96, seed + 2);
    const [bd] = fr((x / size) * 9 + (n1 - 0.5) * 0.6, (y / size) * 9 + (n2 - 0.5) * 0.6);
    let l = 0.17 + 0.09 * (n1 - 0.5) * 2 + 0.05 * (n2 - 0.5) * 2;
    l *= 1 - 0.55 * smooth(0.72, 0.86, pit);                  // gas-bubble pits
    l *= 1 - 0.6 * (1 - smooth(0.0, 0.035, bd));               // fractures
    l += 0.05 * smooth(0.6, 0.8, tfbm(x, y, size, 12, 2, seed + 4)); // ash dust in the low spots
    const rust = smooth(0.6, 0.78, tfbm(x + 33, y, size, 8, 3, seed + 5)) * 0.35;
    const k = (y * size + x) * 4;
    const r = l * (1 + rust * 0.9), g = l * (1 - rust * 0.15), b = l * (0.94 - rust * 0.35);
    data[k] = Math.round(clamp(Math.pow(r, 1 / 2.2), 0, 1) * 255);
    data[k + 1] = Math.round(clamp(Math.pow(g, 1 / 2.2), 0, 1) * 255);
    data[k + 2] = Math.round(clamp(Math.pow(b, 1 / 2.2), 0, 1) * 255);
    data[k + 3] = 255;
  }
  return dataToTexture(data, size, renderer);
}

/** Procedural ash ground albedo (fallback for tex_niumo_ash): soft grey ash, black cinders, faint ripples. */
export function makeAshTexture(renderer, size = 512, seed = 5) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n1 = tfbm(x, y, size, 5, 4, seed), n2 = tfbm(x, y, size, 32, 3, seed + 1);
    const cinder = tnoise((x / size) * 128, (y / size) * 128, 128, seed + 2);
    const ripple = Math.sin(((x / size) * 2 + (y / size) * 9 + n1 * 1.6) * Math.PI * 2 * 3) * 0.5 + 0.5;
    let l = 0.3 + 0.07 * (n1 - 0.5) * 2 + 0.04 * (n2 - 0.5) * 2 + 0.02 * ripple;
    l *= 1 - 0.75 * smooth(0.8, 0.9, cinder);
    const k = (y * size + x) * 4;
    data[k] = Math.round(clamp(Math.pow(l * 1.02, 1 / 2.2), 0, 1) * 255);
    data[k + 1] = Math.round(clamp(Math.pow(l * 0.98, 1 / 2.2), 0, 1) * 255);
    data[k + 2] = Math.round(clamp(Math.pow(l * 0.95, 1 / 2.2), 0, 1) * 255);
    data[k + 3] = 255;
  }
  return dataToTexture(data, size, renderer);
}

/**
 * Carved rune columns for the steles (linear, R = carving depth 0..1, G = erosion / fading, B = rim wear).
 * Glyphs are original abstract stroke clusters, not any real script.
 */
export function makeRuneTexture(w = 256, h = 512, seed = 9) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  // border frame
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 5;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.lineWidth = 2;
  g.strokeRect(24, 24, w - 48, h - 48);
  // header: a round seal-like emblem
  g.lineWidth = 4;
  g.beginPath(); g.arc(w / 2, 62, 26, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(w / 2 - 15, 62); g.lineTo(w / 2 + 15, 62); g.moveTo(w / 2, 47); g.lineTo(w / 2, 77); g.stroke();
  // glyph columns
  const cols = 4, rows = 9, cw = (w - 64) / cols, rh = (h - 140) / rows;
  g.lineCap = 'round';
  for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
    if (r() < 0.08) continue;
    const x0 = 32 + ci * cw + cw * 0.18, y0 = 112 + ri * rh + rh * 0.12, gw = cw * 0.64, gh = rh * 0.76;
    g.lineWidth = r.range(2.6, 4.2);
    const strokes = r.int(3, 6);
    g.beginPath();
    for (let s = 0; s < strokes; s++) {
      const kind = r.int(0, 4);
      const ax = x0 + r() * gw, ay = y0 + r() * gh;
      if (kind === 0) { g.moveTo(x0 + r() * gw * 0.3, ay); g.lineTo(x0 + gw * (0.7 + r() * 0.3), ay); }
      else if (kind === 1) { g.moveTo(ax, y0 + r() * gh * 0.3); g.lineTo(ax, y0 + gh * (0.7 + r() * 0.3)); }
      else if (kind === 2) { g.moveTo(ax, ay); g.lineTo(ax + (r() - 0.5) * gw * 0.8, ay + gh * 0.4); }
      else if (kind === 3) { g.moveTo(ax + 2, ay); g.arc(ax, ay, 2, 0, Math.PI * 2); }
      else { g.moveTo(ax, ay); g.quadraticCurveTo(ax + gw * 0.4, ay - gh * 0.2, ax + gw * 0.3, ay + gh * 0.4); }
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke();
  }
  const img = g.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4, ks = ((h - 1 - y) * w + x) * 4;   // flip: row 0 = bottom
    const carve = img[ks] / 255;
    const erosion = tfbm(x, y, 256, 6, 4, seed + 3);
    const fade = smooth(0.38, 0.7, erosion);
    data[k] = Math.round(carve * (1 - fade * 0.85) * 255);
    data[k + 1] = Math.round(erosion * 255);
    data[k + 2] = Math.round(tfbm(x, y, 256, 24, 3, seed + 4) * 255);
    data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  // a soft carving: blur by sampling the mip chain slightly (done in the shader); keep data as is
  tex.needsUpdate = true;
  return tex;
}

/** Cloud-scroll frieze for the altar's flanks (linear, R = relief height), tiles horizontally. */
export function makeFriezeTexture(w = 512, h = 128, seed = 13) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  // borders
  g.lineWidth = 7;
  g.beginPath(); g.moveTo(0, 10); g.lineTo(w, 10); g.moveTo(0, h - 10); g.lineTo(w, h - 10); g.stroke();
  // repeating double spirals (cloud scrolls), 4 per tile
  const n = 4, cw = w / n;
  g.lineWidth = 6;
  for (let i = 0; i < n; i++) {
    const cx = cw * i + cw / 2, cy = h / 2;
    for (const dir of [-1, 1]) {
      g.beginPath();
      for (let t = 0; t <= 1; t += 0.02) {
        const a = t * Math.PI * 3.2, rr = 30 * (1 - t * 0.85);
        const x = cx + dir * (cw * 0.2) + Math.cos(a) * rr * dir, y = cy + Math.sin(a) * rr;
        if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.beginPath(); g.moveTo(cx - cw * 0.2, cy + 30); g.quadraticCurveTo(cx, cy + 44, cx + cw * 0.2, cy + 30); g.stroke();
  }
  const img = g.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4, ks = ((h - 1 - y) * w + x) * 4;
    data[k] = img[ks];
    data[k + 1] = Math.round(tfbm(x, y, 128, 8, 3, seed) * 255);
    data[k + 2] = 0;
    data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Upload an RGBA8 field (mask / glow) as a linear data texture. */
export function fieldTexture(data, res, { mipmaps = false } = {}) {
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mipmaps;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
