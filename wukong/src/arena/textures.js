// Procedural textures: fallbacks for the stone / rose-window art plus small helper textures
// (tileable noise, banner cloth, wood, stained glass) and the rose-window transmission mask.
import * as THREE from 'three';
import { rng } from './util.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finishColorTexture(tex, renderer, wrap = THREE.RepeatWrapping) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = wrap;
  tex.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Configure an externally supplied albedo texture for world-space tiling. */
export function configureAlbedo(tex, renderer, wrap = THREE.MirroredRepeatWrapping) {
  if (!tex) return null;
  return finishColorTexture(tex, renderer, wrap);
}

// --------------------------------------------------------------------------------------------
// Tileable value-noise fbm in a DataTexture. R: low freq, G: mid, B: high, A: very low (macro).
export function makeNoiseTexture(size = 256, seed = 1337) {
  const data = new Uint8Array(size * size * 4);
  const lattices = new Map();
  const lattice = (period, s) => {
    const key = period * 1000 + s;
    if (!lattices.has(key)) {
      const r = rng(s * 7919 + period);
      const g = new Float32Array(period * period);
      for (let i = 0; i < g.length; i++) g[i] = r();
      lattices.set(key, g);
    }
    return lattices.get(key);
  };
  const vnoise = (period, s, x, y) => {
    const g = lattice(period, s);
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (base, oct, s, px, py) => {
    let sum = 0, amp = 0.5, norm = 0, p = base;
    for (let o = 0; o < oct; o++) {
      sum += amp * vnoise(p, s + o, (px / size) * p, (py / size) * p);
      norm += amp; amp *= 0.5; p *= 2;
    }
    return sum / norm;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.round(fbm(4, 5, seed, x, y) * 255);
      data[i + 1] = Math.round(fbm(16, 4, seed + 11, x, y) * 255);
      data[i + 2] = Math.round(fbm(64, 2, seed + 23, x, y) * 255);
      data[i + 3] = Math.round(fbm(2, 3, seed + 37, x, y) * 255);
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

// --------------------------------------------------------------------------------------------
function speckle(g, x, y, w, h, r, n, dark = true) {
  for (let i = 0; i < n; i++) {
    const a = r.range(0.02, 0.09);
    g.fillStyle = dark ? `rgba(20,18,16,${a})` : `rgba(255,252,240,${a})`;
    const s = r.range(0.6, 2.4);
    g.fillRect(x + r() * w, y + r() * h, s, s);
  }
}

function crack(g, x, y, len, r) {
  g.strokeStyle = `rgba(25,22,20,${r.range(0.35, 0.7)})`;
  g.lineWidth = r.range(0.7, 1.6);
  g.beginPath();
  g.moveTo(x, y);
  let a = r() * Math.PI * 2;
  for (let i = 0; i < 8; i++) {
    a += r.range(-0.7, 0.7);
    x += Math.cos(a) * len / 8; y += Math.sin(a) * len / 8;
    g.lineTo(x, y);
  }
  g.stroke();
}

/** Draw `fn(dx, dy)` at the 9 wrap offsets so blocks crossing an edge tile seamlessly. */
function wrapped(size, fn) {
  for (const dy of [-size, 0, size]) for (const dx of [-size, 0, size]) fn(dx, dy);
}

/** Running-bond slab pattern; rows: number of courses, wRange: block width range (fraction of size). */
function masonryCanvas({ size, rows, wRange, base, vary, grout, seed, streaks = 0, cracks = 0.4 }) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = grout;
  g.fillRect(0, 0, size, size);
  const rowH = size / rows;
  const gw = Math.max(2, size / 300);
  for (let row = 0; row < rows; row++) {
    const y0 = row * rowH;
    let x = r() * size;
    const end = x + size;
    while (x < end - 1) {
      let w = r.range(wRange[0], wRange[1]) * size;
      if (end - (x + w) < wRange[0] * size * 0.6) w = end - x;
      const tone = 1 + r.range(-vary, vary);
      const col = base.map((v) => Math.round(Math.min(255, v * tone)));
      const bx = x, bw = w;
      wrapped(size, (dx, dy) => {
        const X = bx + dx + gw, Y = y0 + dy + gw, W = bw - gw * 2, H = rowH - gw * 2;
        if (X > size || Y > size || X + W < 0 || Y + H < 0) return;
        g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        g.fillRect(X, Y, W, H);
        // soft inner bevel: lighter top-left, darker bottom-right
        const grd = g.createLinearGradient(X, Y, X, Y + H);
        grd.addColorStop(0, 'rgba(255,255,255,0.06)');
        grd.addColorStop(0.15, 'rgba(255,255,255,0)');
        grd.addColorStop(0.85, 'rgba(0,0,0,0)');
        grd.addColorStop(1, 'rgba(0,0,0,0.14)');
        g.fillStyle = grd;
        g.fillRect(X, Y, W, H);
      });
      // blotches + speckle + cracks (drawn with wrap as well)
      const blotches = r.int(1, 4);
      for (let k = 0; k < blotches; k++) {
        const cx = bx + r() * bw, cy = y0 + r() * rowH, rad = r.range(0.2, 0.7) * rowH;
        const dark = r() < 0.6;
        wrapped(size, (dx, dy) => {
          const grd = g.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, rad);
          grd.addColorStop(0, dark ? 'rgba(30,28,24,0.12)' : 'rgba(255,250,235,0.07)');
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd;
          g.fillRect(cx + dx - rad, cy + dy - rad, rad * 2, rad * 2);
        });
      }
      if (r() < cracks) {
        const cx = bx + r() * bw, cy = y0 + r() * rowH, len = r.range(0.3, 0.9) * rowH;
        const cs = r.int(1, 1e9); // same seed for every wrapped copy so they match
        wrapped(size, (dx, dy) => crack(g, cx + dx, cy + dy, len, rng(cs)));
      }
      x += w;
    }
  }
  const sr = rng(seed + 99);
  speckle(g, 0, 0, size, size, sr, size * 6, true);
  speckle(g, 0, 0, size, size, sr, size * 3, false);
  for (let i = 0; i < streaks; i++) {
    const x = sr() * size, w = sr.range(4, 26) * size / 1024, y = sr() * size, h = sr.range(0.15, 0.6) * size;
    wrapped(size, (dx, dy) => {
      const grd = g.createLinearGradient(0, y + dy, 0, y + dy + h);
      grd.addColorStop(0, `rgba(25,24,22,${sr.range(0.08, 0.2)})`);
      grd.addColorStop(1, 'rgba(25,24,22,0)');
      g.fillStyle = grd;
      g.fillRect(x + dx, y + dy, w, h);
    });
  }
  return c;
}

export function makeStoneFloorTexture(renderer, size = 1024) {
  const c = masonryCanvas({ size, rows: 4, wRange: [0.22, 0.42], base: [142, 139, 132], vary: 0.08, grout: '#4b4844', seed: 7, cracks: 0.5 });
  return finishColorTexture(new THREE.CanvasTexture(c), renderer);
}

export function makeStoneWallTexture(renderer, size = 1024) {
  const c = masonryCanvas({ size, rows: 10, wRange: [0.2, 0.45], base: [150, 143, 130], vary: 0.07, grout: '#5a544b', seed: 11, streaks: 70, cracks: 0.15 });
  return finishColorTexture(new THREE.CanvasTexture(c), renderer);
}

// --------------------------------------------------------------------------------------------
/** Procedural stained-glass rose window (radial tracery, 12 petals, blue outer ring). */
export function makeRoseWindowTexture(renderer, size = 1024) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(5);
  const C = size / 2;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const stone = '#6d655c';
  const lead = 'rgba(22,18,16,0.95)';
  const R = size * 0.49;
  // stone disc
  g.fillStyle = stone;
  g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fill();

  const glassFill = (path, colA, colB) => {
    g.save();
    g.clip(path);
    const bb = size;
    g.fillStyle = colA;
    g.fillRect(0, 0, bb, bb);
    // mottled glass
    for (let i = 0; i < 260; i++) {
      g.fillStyle = r() < 0.5 ? colB : 'rgba(255,255,255,0.10)';
      g.globalAlpha = r.range(0.15, 0.4);
      const x = r() * bb, y = r() * bb, s = r.range(6, 30) * size / 1024;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // lead lines (quarries)
    g.strokeStyle = lead;
    g.lineWidth = 2.2 * size / 1024;
    const step = 34 * size / 1024;
    for (let k = -bb; k < bb * 2; k += step) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + bb * 0.6, bb); g.stroke();
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k - bb * 0.6, bb); g.stroke();
    }
    g.restore();
    g.strokeStyle = lead; g.lineWidth = 4 * size / 1024; g.stroke(path);
  };

  // outer ring of small roundels (blue)
  const nOuter = 24;
  for (let i = 0; i < nOuter; i++) {
    const a = (i / nOuter) * Math.PI * 2;
    const p = new Path2D();
    p.arc(C + Math.cos(a) * R * 0.88, C + Math.sin(a) * R * 0.88, R * 0.085, 0, Math.PI * 2);
    glassFill(p, i % 2 ? '#2b4c9e' : '#3157a8', '#18306e');
  }
  // 12 petals (pointed lancets radiating outwards)
  const nPet = 12;
  for (let i = 0; i < nPet; i++) {
    const a = (i / nPet) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const r0 = R * 0.34, r1 = R * 0.76, hw = R * 0.115;
    const pt = (rad, side) => [C + ca * rad - sa * side, C + sa * rad + ca * side];
    const p = new Path2D();
    const [x0, y0] = pt(r0, -hw * 0.6), [x1, y1] = pt(r0, hw * 0.6);
    p.moveTo(x0, y0);
    const [x2, y2] = pt(r1 - hw * 1.2, -hw);
    p.lineTo(x2, y2);
    const [xa, ya] = pt(r1, 0);
    const [c1x, c1y] = pt(r1 - hw * 0.3, -hw);
    p.quadraticCurveTo(c1x, c1y, xa, ya);
    const [c2x, c2y] = pt(r1 - hw * 0.3, hw);
    const [x3, y3] = pt(r1 - hw * 1.2, hw);
    p.quadraticCurveTo(c2x, c2y, x3, y3);
    p.lineTo(x1, y1);
    p.closePath();
    glassFill(p, i % 2 ? '#efe7cf' : '#e9cf7c', i % 2 ? '#d8c690' : '#c99a35');
  }
  // trefoils between petals
  for (let i = 0; i < nPet; i++) {
    const a = ((i + 0.5) / nPet) * Math.PI * 2;
    const p = new Path2D();
    p.arc(C + Math.cos(a) * R * 0.7, C + Math.sin(a) * R * 0.7, R * 0.06, 0, Math.PI * 2);
    glassFill(p, '#e8d48a', '#b98a2a');
  }
  // centre medallion with rays
  const pc = new Path2D();
  pc.arc(C, C, R * 0.27, 0, Math.PI * 2);
  glassFill(pc, '#f4ecd2', '#e2c67a');
  g.save();
  g.clip(pc);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.strokeStyle = lead; g.lineWidth = 3 * size / 1024;
    g.beginPath(); g.moveTo(C, C); g.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R); g.stroke();
  }
  g.fillStyle = '#fff6dc';
  g.beginPath(); g.arc(C, C, R * 0.07, 0, Math.PI * 2); g.fill();
  g.restore();
  // stone tracery rings
  g.strokeStyle = stone;
  for (const [rad, w] of [[0.275, 14], [0.33, 10], [0.78, 12], [0.97, 16]]) {
    g.lineWidth = w * size / 1024;
    g.beginPath(); g.arc(C, C, R * rad, 0, Math.PI * 2); g.stroke();
  }
  return finishColorTexture(new THREE.CanvasTexture(c), renderer, THREE.ClampToEdgeWrapping);
}

// --------------------------------------------------------------------------------------------
/** sRGB glass mask (1 = stained glass, 0 = stone tracery / lead) — mirrors the GLSL version. */
export function glassMask(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = (mx - mn) / (mx + 1e-3);
  const bright = smooth(0.6, 0.78, lum);
  const blue = smooth(0.06, 0.2, b - Math.max(r, g)) * smooth(0.08, 0.2, b);
  const gold = smooth(0.48, 0.62, lum) * smooth(0.35, 0.55, sat) * (g >= b ? 1 : 0);
  return Math.min(1, Math.max(bright, blue, gold));
}

export const GLSL_GLASS_MASK = /* glsl */`
float arenaGlassMask(vec3 linearRGB) {
  vec3 c = pow(max(linearRGB, vec3(0.0)), vec3(1.0 / 2.2));
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / (mx + 1e-3);
  float bright = smoothstep(0.6, 0.78, lum);
  float blue = smoothstep(0.06, 0.2, c.b - max(c.r, c.g)) * smoothstep(0.08, 0.2, c.b);
  float gold = smoothstep(0.48, 0.62, lum) * smoothstep(0.35, 0.55, sat) * step(c.b, c.g);
  return clamp(max(bright, max(blue, gold)), 0.0, 1.0);
}
`;

/**
 * Light transmission of the rose window: rgb = glass colour (sRGB) * mask, a = mask.
 * Mipmapped so the volumetric beam can sample a blurred version cheaply.
 */
export function makeTransmissionTexture(image, size = 256) {
  const c = canvas(size);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const inside = smooth(0.5, 0.485, Math.hypot(dx, dy));
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const m = glassMask(r, gg, b) * inside;
      // boost colour a bit (glass is brighter than the painted albedo suggests)
      d[i] = Math.min(255, Math.round(r * m * 255 * 1.05));
      d[i + 1] = Math.min(255, Math.round(gg * m * 255 * 1.05));
      d[i + 2] = Math.min(255, Math.round(b * m * 255 * 1.05));
      d[i + 3] = Math.round(m * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  return tex;
}

// --------------------------------------------------------------------------------------------
/** Torn cream banner with a gold emblem (sword in a halo, seven tears). Alpha = cloth. */
export function makeBannerTexture(renderer, w = 256, h = 1024, seed = 3) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const r = rng(seed);
  // cloth silhouette with swallow-tail + ragged bottom
  const outline = new Path2D();
  outline.moveTo(0, 0);
  outline.lineTo(w, 0);
  const bottomY = h * 0.9;
  let y = 0;
  // right edge (slightly ragged lower down)
  for (y = 0; y < bottomY; y += h / 40) outline.lineTo(w - (y > h * 0.55 ? r.range(0, w * 0.06) : 0), y);
  // ragged swallowtail bottom from right to left
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = w * (1 - t);
    const tail = Math.abs(t - 0.5) * 2; // 0 in the middle, 1 at the sides
    const yy = bottomY - h * 0.13 * (1 - tail) + r.range(-h * 0.035, h * 0.045) + (r() < 0.15 ? -r.range(0, h * 0.12) : 0);
    outline.lineTo(x, Math.min(h - 2, yy + h * 0.06 * tail));
  }
  for (y = bottomY; y > 0; y -= h / 40) outline.lineTo(y > h * 0.5 ? r.range(0, w * 0.06) : 0, y);
  outline.closePath();
  g.save();
  g.clip(outline);
  // base cloth with vertical folds
  for (let x = 0; x < w; x++) {
    const f = 0.82 + 0.1 * Math.sin(x / w * Math.PI * 7.0 + 0.6) + 0.05 * Math.sin(x / w * Math.PI * 19.0);
    g.fillStyle = `rgb(${Math.round(222 * f)},${Math.round(210 * f)},${Math.round(184 * f)})`;
    g.fillRect(x, 0, 1, h);
  }
  // ageing: darker towards the bottom, stains
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(60,45,25,0.15)');
  grd.addColorStop(0.5, 'rgba(60,45,25,0.0)');
  grd.addColorStop(1, 'rgba(50,38,22,0.45)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = r() * w, yy = r() * h, rad = r.range(6, 40);
    const s = g.createRadialGradient(x, yy, 0, x, yy, rad);
    s.addColorStop(0, `rgba(70,52,30,${r.range(0.05, 0.2)})`);
    s.addColorStop(1, 'rgba(70,52,30,0)');
    g.fillStyle = s; g.fillRect(x - rad, yy - rad, rad * 2, rad * 2);
  }
  // gold border
  const gold = '#b8892e';
  g.strokeStyle = gold; g.lineWidth = 5;
  g.strokeRect(14, 14, w - 28, h * 0.86);
  g.lineWidth = 2;
  g.strokeRect(24, 24, w - 48, h * 0.84);
  // emblem: halo, downward sword, seven tears
  const cx = w / 2, cy = h * 0.3;
  g.strokeStyle = gold; g.fillStyle = gold;
  g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cy, w * 0.3, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, w * 0.34, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * w * 0.36, cy + Math.sin(a) * w * 0.36);
    g.lineTo(cx + Math.cos(a) * w * 0.44, cy + Math.sin(a) * w * 0.44);
    g.stroke();
  }
  // sword (pointing down)
  g.beginPath();
  g.moveTo(cx - 7, cy - w * 0.42); g.lineTo(cx + 7, cy - w * 0.42);
  g.lineTo(cx + 7, cy + w * 0.3); g.lineTo(cx, cy + w * 0.5); g.lineTo(cx - 7, cy + w * 0.3);
  g.closePath(); g.fill();
  g.fillRect(cx - w * 0.2, cy - w * 0.3, w * 0.4, 10); // cross guard
  g.beginPath(); g.arc(cx, cy - w * 0.47, 9, 0, Math.PI * 2); g.fill(); // pommel
  for (let i = 0; i < 7; i++) {
    const tx = cx + (i - 3) * w * 0.1, ty = cy + w * 0.62 + Math.abs(i - 3) * -6;
    g.beginPath(); g.moveTo(tx, ty - 12); g.quadraticCurveTo(tx + 7, ty + 4, tx, ty + 8); g.quadraticCurveTo(tx - 7, ty + 4, tx, ty - 12); g.fill();
  }
  // fine weave noise
  for (let i = 0; i < w * h * 0.05; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    g.fillRect(r() * w, r() * h, 1, 2);
  }
  g.restore();
  // holes
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) {
    const x = r.range(0.1, 0.9) * w, yy = r.range(0.4, 0.85) * h, rad = r.range(4, 16);
    g.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2, rr = rad * r.range(0.5, 1.3);
      if (k === 0) g.moveTo(x + Math.cos(a) * rr, yy + Math.sin(a) * rr); else g.lineTo(x + Math.cos(a) * rr, yy + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
  tex.needsUpdate = true;
  return tex;
}

/** Dark oak with grain (tileable horizontally). */
export function makeWoodTexture(renderer, size = 512) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(21);
  g.fillStyle = '#3a2a1c';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 160; i++) {
    const y = r() * size, amp = r.range(2, 9), f = r.range(1, 3), ph = r() * 6.28;
    g.strokeStyle = r() < 0.5 ? `rgba(20,12,6,${r.range(0.2, 0.5)})` : `rgba(110,80,50,${r.range(0.08, 0.2)})`;
    g.lineWidth = r.range(0.6, 2.5);
    g.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const yy = y + Math.sin((x / size) * Math.PI * 2 * f + ph) * amp;
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  for (let i = 0; i < 8; i++) { // knots
    const x = r() * size, y = r() * size;
    const s = g.createRadialGradient(x, y, 0, x, y, r.range(5, 14));
    s.addColorStop(0, 'rgba(15,8,4,0.8)'); s.addColorStop(1, 'rgba(15,8,4,0)');
    g.fillStyle = s; g.fillRect(x - 20, y - 20, 40, 40);
  }
  return finishColorTexture(new THREE.CanvasTexture(c), renderer);
}

/**
 * Stained glass for lancets: quarry (diamond) glazing with muted colours, a border band and a
 * central medallion. Alpha 0 = broken pane (shader discards, the sky shows through).
 */
export function makeLancetGlassTexture(renderer, w = 256, h = 768, seed = 9, broken = 0.12) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const r = rng(seed);
  const palette = ['#7d8fa3', '#8a9aa6', '#6f7f95', '#9aa3a0', '#a0a7b4', '#5e6f8c', '#b39b62', '#8d4b3c', '#6c7d6a'];
  const dx = w / 6, dy = dx * 1.6;
  g.fillStyle = '#202020';
  g.fillRect(0, 0, w, h);
  for (let j = -1; j < h / dy * 2 + 2; j++) {
    for (let i = -1; i < w / dx + 2; i++) {
      const cx = i * dx + (j % 2 ? dx / 2 : 0), cy = j * dy / 2;
      let col = palette[r() < 0.82 ? r.int(0, 5) : r.int(6, 8)];
      const isBroken = r() < broken;
      g.beginPath();
      g.moveTo(cx, cy - dy / 2); g.lineTo(cx + dx / 2, cy); g.lineTo(cx, cy + dy / 2); g.lineTo(cx - dx / 2, cy); g.closePath();
      if (isBroken) { g.save(); g.globalCompositeOperation = 'destination-out'; g.fill(); g.restore(); continue; }
      g.fillStyle = col; g.fill();
      g.strokeStyle = 'rgba(15,15,15,0.95)'; g.lineWidth = 2.5; g.stroke();
    }
  }
  // border band
  g.strokeStyle = '#151515'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.strokeStyle = '#7a6a3a'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
  // medallion
  const my = h * 0.45;
  g.fillStyle = '#c9b77a'; g.beginPath(); g.arc(w / 2, my, w * 0.28, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#151515'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#8a3a30'; g.beginPath(); g.arc(w / 2, my, w * 0.12, 0, Math.PI * 2); g.fill(); g.stroke();
  // grime
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${r.range(0.05, 0.25)})`;
    const s = r.range(2, 12);
    g.fillRect(r() * w, r() * h, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// --------------------------------------------------------------------------------------------
/**
 * Floor inlay (mandala) around the saint's kneeling spot, drawn to channels with additive
 * compositing: R = pale marble inlay lines, G = dark grooves outlining them, B = brass rings.
 * The texture spans 2 * extent metres; the shader maps world xz into it.
 */
export function makeMandalaTexture(size = 2048, extent = 10.6) {
  const c = canvas(size);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  const s = size / (2 * extent); // px per metre
  const C = size / 2;
  const R = 'rgb(255,0,0)', G = 'rgb(0,255,0)', B = 'rgb(0,0,255)';
  const ring = (r, w, col) => { g.strokeStyle = col; g.lineWidth = w * s; g.beginPath(); g.arc(C, C, r * s, 0, Math.PI * 2); g.stroke(); };
  const ringAt = (x, y, r, w, col) => { g.strokeStyle = col; g.lineWidth = w * s; g.beginPath(); g.arc(C + x * s, C + y * s, r * s, 0, Math.PI * 2); g.stroke(); };
  const path = (pts, w, col, close = false) => {
    g.strokeStyle = col; g.lineWidth = w * s; g.lineJoin = 'round'; g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(C + x * s, C + y * s) : g.moveTo(C + x * s, C + y * s)));
    if (close) g.closePath();
    g.stroke();
  };
  // every element: a wide dark groove (G) under a narrow pale inlay line (R)
  const both = (fn, w) => { fn(w * 2.4, G); fn(w, R); };
  // outer bands
  both((w, col) => ring(10.0, w, col), 0.16);
  ring(10.0, 0.07, B);
  both((w, col) => ring(9.55, w, col), 0.06);
  // interlaced roundels between the outer bands
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    both((w, col) => ringAt(Math.cos(a) * 8.85, Math.sin(a) * 8.85, 0.66, w, col), 0.06);
  }
  both((w, col) => ring(8.15, w, col), 0.08);
  // eight large interlocking circles
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    both((w, col) => ringAt(Math.cos(a) * 5.55, Math.sin(a) * 5.55, 2.45, w, col), 0.09);
  }
  // twelve lancet petals
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (rad, side) => [ca * rad - sa * side, sa * rad + ca * side];
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const rad = 3.1 + t * 4.9;
      const half = 0.55 * Math.sin(Math.PI * Math.pow(t, 0.8));
      pts.push(P(rad, half));
    }
    for (let k = 16; k >= 0; k--) {
      const t = k / 16;
      const rad = 3.1 + t * 4.9;
      const half = 0.55 * Math.sin(Math.PI * Math.pow(t, 0.8));
      pts.push(P(rad, -half));
    }
    both((w, col) => path(pts, w, col, true), 0.06);
    // radial spokes between the petals
    const b = a + Math.PI / 12;
    both((w, col) => path([[Math.cos(b) * 3.1, Math.sin(b) * 3.1], [Math.cos(b) * 8.15, Math.sin(b) * 8.15]], w, col), 0.035);
  }
  // inner rings + eight-pointed star + centre disc
  both((w, col) => ring(3.05, w, col), 0.12);
  ring(3.05, 0.05, B);
  both((w, col) => ring(2.65, w, col), 0.05);
  const star = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rad = i % 2 ? 1.05 : 2.45;
    star.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  both((w, col) => path(star, w, col, true), 0.06);
  both((w, col) => ring(0.85, w, col), 0.07);
  g.fillStyle = 'rgb(90,0,0)';
  g.beginPath(); g.arc(C, C, 0.8 * s, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.userData.extent = extent;
  return tex;
}

/**
 * Warm light from the candles, splatted top-down into a small texture covering the floor
 * (R channel, linear). Lets every cluster pool light on the water / pier bases for free.
 */
export function makeCandleLightMap(candles, rect, metresPerPx = 0.25) {
  const w = Math.ceil((rect.x1 - rect.x0) / metresPerPx), h = Math.ceil((rect.z1 - rect.z0) / metresPerPx);
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  for (const k of candles) {
    const px = (k.x - rect.x0) / metresPerPx, pz = (k.z - rect.z0) / metresPerPx;
    const rad = (1.1 + k.h * 1.5) / metresPerPx;
    const grd = g.createRadialGradient(px, pz, 0, px, pz, rad);
    const a = 0.16 * (k.weight ?? 1);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.35, `rgba(255,255,255,${a * 0.45})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(px - rad, pz - rad, rad * 2, rad * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false; // row 0 = rect.z0
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}
