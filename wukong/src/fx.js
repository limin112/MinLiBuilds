// Visual effects: particles, sword trails, shockwaves, light pillars, glints, flash lights, material flashes.
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3();

// ------------------------------------------------------------------ particles

const PARTICLE_VS = /* glsl */`
  attribute float aSize; attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const PARTICLE_FS = /* glsl */`
  varying vec4 vColor;
  uniform float uSoft;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = smoothstep(1.0, uSoft, d);
    if (a <= 0.003 || vColor.a <= 0.003) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }`;

class Particles {
  constructor(scene, { max = 3000, additive = true, soft = 0.0 } = {}) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(p, v, color, { size = 0.05, life = 0.6, drag = 1.5, grav = -9.8, alpha = 1, grow = 0 } = {}) {
    let i = this.n;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b, alpha], i * 4);
    this.size[i] = this.size0[i] = size;
    this.life[i] = life; this.age[i] = 0; this.drag[i] = drag; this.grav[i] = grav; this.alpha0[i] = alpha; this.grow[i] = grow;
  }

  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        n--;
        const j = n;
        if (i !== j) {
          for (const [arr, w] of [[this.pos, 3], [this.vel, 3], [this.col, 4]]) arr.copyWithin(i * w, j * w, j * w + w);
          for (const arr of [this.size, this.life, this.age, this.drag, this.grav, this.alpha0, this.size0, this.grow]) arr[i] = arr[j];
          i--;
        }
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      const b = i * 3;
      this.vel[b] *= k; this.vel[b + 1] = this.vel[b + 1] * k + this.grav[i] * dt; this.vel[b + 2] *= k;
      this.pos[b] += this.vel[b] * dt; this.pos[b + 1] += this.vel[b + 1] * dt; this.pos[b + 2] += this.vel[b + 2] * dt;
      if (this.pos[b + 1] < 0.02 && this.grav[i] < 0) { this.pos[b + 1] = 0.02; this.vel[b + 1] *= -0.2; this.vel[b] *= 0.5; this.vel[b + 2] *= 0.5; }
      const f = this.age[i] / this.life[i];
      this.col[i * 4 + 3] = this.alpha0[i] * (1 - f) * (1 - f * 0.3);
      this.size[i] = this.size0[i] * (1 + this.grow[i] * f);
    }
    this.n = n;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = g.attributes.aColor.needsUpdate = g.attributes.aSize.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ sword trail

class Trail {
  constructor(scene, { color = new THREE.Color(1, 0.9, 0.6), samples = 22, life = 0.16, opacity = 0.85 } = {}) {
    this.samples = samples;
    this.life = life;
    this.pts = [];                         // {base, tip, t}
    this.active = false;
    this.opacity = opacity;
    const g = new THREE.BufferGeometry();
    this.posArr = new Float32Array(samples * 2 * 3);
    this.alphaArr = new Float32Array(samples * 2);
    this.uvArr = new Float32Array(samples * 2 * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uvArr, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < samples - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uOpacity: { value: opacity } },
      vertexShader: `attribute float aAlpha; varying float vA; varying vec2 vUv;
        void main(){ vA = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; varying vec2 vUv;
        void main(){ float edge = smoothstep(0.0, 0.35, vUv.y) * (0.35 + 0.65 * vUv.y);
          float a = vA * edge * uOpacity; if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * (0.6 + 0.8 * vUv.y), a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  push(base, tip, now) {
    const last = this.pts[this.pts.length - 1];
    if (last && this.pts.length >= 2) {
      // subdivide fast swings with a quadratic through the last two samples
      const prev = this.pts[this.pts.length - 2];
      const gap = last.tip.distanceTo(tip);
      const steps = Math.min(3, Math.floor(gap / 0.15));
      for (let s = 1; s <= steps; s++) {
        const u = s / (steps + 1);
        const q = (a, b, c) => new THREE.Vector3(
          catmull(prev[a].x, last[a].x, b.x, b.x + (b.x - last[a].x), u),
          catmull(prev[a].y, last[a].y, b.y, b.y + (b.y - last[a].y), u),
          catmull(prev[a].z, last[a].z, b.z, b.z + (b.z - last[a].z), u));
        this.pts.push({ base: q('base', base), tip: q('tip', tip), t: last.t + (now - last.t) * u });
      }
    }
    this.pts.push({ base: base.clone(), tip: tip.clone(), t: now });
    while (this.pts.length > this.samples) this.pts.shift();
  }

  update(now) {
    while (this.pts.length && now - this.pts[0].t > this.life) this.pts.shift();
    const n = this.pts.length;
    for (let i = 0; i < this.samples; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const k = i * 2;
      if (!p) { this.alphaArr[k] = this.alphaArr[k + 1] = 0; continue; }
      this.posArr.set([p.base.x, p.base.y, p.base.z], k * 3);
      this.posArr.set([p.tip.x, p.tip.y, p.tip.z], (k + 1) * 3);
      const a = i < n ? Math.max(0, 1 - (now - p.t) / this.life) * (i / Math.max(1, n - 1)) : 0;
      this.alphaArr[k] = this.alphaArr[k + 1] = a;
      this.uvArr.set([i / (this.samples - 1), 0, i / (this.samples - 1), 1], k * 2);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.aAlpha.needsUpdate = g.attributes.uv.needsUpdate = true;
  }
}
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// ------------------------------------------------------------------ textures

function starTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.15, 'rgba(255,245,220,0.8)'); grd.addColorStop(1, 'rgba(255,230,180,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[128, 5], [5, 128], [70, 3], [3, 70]]) {
    const lg = g.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2);
    g.fillStyle = 'rgba(255,250,235,0.9)';
    g.save(); g.translate(64, 64); if (w === 70) g.rotate(Math.PI / 4);
    g.beginPath(); g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill(); g.restore();
    void lg;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ------------------------------------------------------------------ FX facade

export class FX {
  constructor(scene, { arena = null } = {}) {
    this.scene = scene;
    this.arena = arena;
    this.add = new Particles(scene, { max: 4000, additive: true, soft: 0.0 });
    this.alpha = new Particles(scene, { max: 2500, additive: false, soft: 0.35 });
    this.trails = [];
    this.timed = [];          // {update(dt) -> bool alive}
    this.now = 0;
    this.star = starTexture();
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffe6b0, 0, 8, 2);
      l.userData.t = 0; scene.add(l); this.lights.push(l);
    }
    this.flashes = [];        // material flashes
  }

  trail(opts) { const t = new Trail(this.scene, opts); this.trails.push(t); return t; }

  light(pos, color = 0xffe6b0, intensity = 30, dur = 0.25, dist = 9) {
    const l = this.lights.reduce((a, b) => (a.userData.t < b.userData.t ? a : b));
    l.position.copy(pos); l.color.set(color); l.distance = dist;
    l.userData = { t: dur, dur, peak: intensity };
    l.intensity = intensity;
  }

  /** Sparks when the player's blade bites into the saint: gold sparks + soft light motes. */
  hitSpark(pos, dir, heavy = false) {
    const n = heavy ? 70 : 40;
    const gold = new THREE.Color(1.0, 0.78, 0.38), white = new THREE.Color(1.2, 1.1, 0.95);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(3, heavy ? 11 : 8));
      v.addScaledVector(dir, rand(2, 6));
      this.add.emit(pos, v, Math.random() < 0.3 ? white : gold, { size: rand(0.02, 0.05), life: rand(0.18, 0.5), drag: 3, grav: -14 });
    }
    for (let i = 0; i < (heavy ? 26 : 14); i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1, 1)).multiplyScalar(rand(0.3, 1.2));
      this.add.emit(pos, v, new THREE.Color(1.0, 0.85, 0.55), { size: rand(0.12, 0.3), life: rand(0.6, 1.4), drag: 1.2, grav: 0.4, alpha: 0.6, grow: 0.6 });
    }
    // a hot flash at the contact
    this.add.emit(pos, new THREE.Vector3(), new THREE.Color(1.6, 1.4, 1.1), { size: heavy ? 1.6 : 1.0, life: 0.09, grav: 0, alpha: 1 });
    this.light(pos, 0xffd9a0, heavy ? 60 : 35, 0.16, 10);
  }

  /** Dark blood + mail sparks when the heroine is struck. */
  bloodHit(pos, dir, heavy = false) {
    const blood = new THREE.Color(0.25, 0.02, 0.02);
    for (let i = 0; i < (heavy ? 60 : 34); i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 5)).addScaledVector(dir, rand(1, 4));
      this.alpha.emit(pos, v, blood, { size: rand(0.03, 0.07), life: rand(0.35, 0.8), drag: 1.5, grav: -12, alpha: 0.95 });
    }
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).multiplyScalar(rand(2, 6)).addScaledVector(dir, 3);
      this.add.emit(pos, v, new THREE.Color(1.0, 0.7, 0.4), { size: 0.025, life: rand(0.1, 0.3), drag: 3, grav: -12 });
    }
  }

  splash(pos, strength = 1) {
    const c = new THREE.Color(0.7, 0.78, 0.85);
    const n = Math.floor(10 + 26 * strength);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0.5, 2.6) * strength;
      const v = new THREE.Vector3(Math.cos(a) * r, rand(1.2, 3.8) * Math.sqrt(strength), Math.sin(a) * r);
      this.alpha.emit(_v.set(pos.x, 0.08, pos.z), v, c, { size: rand(0.025, 0.06) * (0.7 + strength * 0.4), life: rand(0.35, 0.8), drag: 0.8, grav: -11, alpha: 0.55 });
    }
    this.arena?.ripple?.(pos.x, pos.z, Math.min(2, 0.4 + strength * 0.6));
  }

  dust(pos, radius = 2, n = 40) {
    const c = new THREE.Color(0.55, 0.52, 0.48);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      this.alpha.emit(new THREE.Vector3(pos.x + Math.cos(a) * r, 0.15 + Math.random() * 0.4, pos.z + Math.sin(a) * r),
        new THREE.Vector3(Math.cos(a) * rand(0.5, 2), rand(0.4, 1.6), Math.sin(a) * rand(0.5, 2)), c,
        { size: rand(0.3, 0.8), life: rand(0.8, 1.8), drag: 1.6, grav: 0.2, alpha: 0.18, grow: 1.4 });
    }
  }

  /** Hardened wax chunks breaking off (phase change / rising). */
  wax(pos, radius = 1.5, n = 60) {
    const c = new THREE.Color(0.92, 0.88, 0.78);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.5, 2.5), rand(-1, 1)).multiplyScalar(rand(0.8, 3));
      const p = new THREE.Vector3(pos.x + rand(-radius, radius), pos.y + rand(0, radius), pos.z + rand(-radius, radius));
      this.alpha.emit(p, v, c, { size: rand(0.05, 0.14), life: rand(0.8, 1.6), drag: 0.5, grav: -9.8, alpha: 1 });
    }
  }

  /** A wisp of smoke (and a dying ember) from each snuffed candle. */
  smoke(points) {
    if (!points || !points.length) return;
    const grey = new THREE.Color(0.42, 0.43, 0.46), ember = new THREE.Color(1.0, 0.5, 0.18);
    for (const p of points.slice(0, 48)) {
      const at = new THREE.Vector3(p.x, p.y, p.z);
      this.alpha.emit(at, new THREE.Vector3(rand(-0.04, 0.04), rand(0.22, 0.45), rand(-0.04, 0.04)), grey,
        { size: rand(0.05, 0.09), life: rand(1.4, 2.4), drag: 0.5, grav: 0.2, alpha: 0.2, grow: 2.6 });
      this.add.emit(at, new THREE.Vector3(rand(-0.1, 0.1), rand(0.1, 0.4), rand(-0.1, 0.1)), ember,
        { size: 0.015, life: rand(0.2, 0.45), drag: 1, grav: 0.3, alpha: 0.9 });
    }
  }

  /** Snuff / knock the floor candles around a point and smoke them (arena permitting). */
  candles(x, z, radius, opts) {
    const hit = this.arena?.disturbCandles?.(x, z, radius, opts);
    if (hit && hit.length) this.smoke(hit);
    return hit ? hit.length : 0;
  }

  /** Rising light motes around a point (holy aura). */
  motes(pos, radius = 2, n = 20, color = new THREE.Color(1.0, 0.86, 0.6)) {
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(pos.x + rand(-radius, radius), pos.y + rand(0, radius * 1.5), pos.z + rand(-radius, radius));
      this.add.emit(p, new THREE.Vector3(rand(-0.2, 0.2), rand(0.3, 1.2), rand(-0.2, 0.2)), color, { size: rand(0.05, 0.14), life: rand(1.2, 2.6), drag: 0.4, grav: 0.15, alpha: 0.8 });
    }
  }

  /** Attack telegraph: a star glint at a world position. */
  glint(pos, size = 1.2, dur = 0.35, color = 0xffffff) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.star, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    s.position.copy(pos); s.renderOrder = 9;
    this.scene.add(s);
    let t = 0;
    this.timed.push({ update: dt => {
      t += dt; const f = t / dur;
      const k = Math.sin(Math.min(1, f) * Math.PI);
      s.scale.setScalar(size * (0.4 + 1.4 * k)); s.material.opacity = k; s.material.rotation = f * 0.8;
      if (f >= 1) { this.scene.remove(s); s.material.dispose(); return false; }
      return true;
    } });
  }

  /** Expanding ring on the water. */
  shockwave(pos, radius = 4, dur = 0.55, color = new THREE.Color(1.0, 0.9, 0.7)) {
    const geo = new THREE.RingGeometry(0.85, 1.0, 96, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uColor: { value: color } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uT; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float a = (1.0 - uT) * (1.0 - uT); gl_FragColor = vec4(uColor * 1.6, a * 0.9); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, 0.1, pos.z);
    m.renderOrder = 4;
    this.scene.add(m);
    let t = 0;
    this.timed.push({ update: dt => {
      t += dt; const f = Math.min(1, t / dur);
      const r = 0.3 + radius * (1 - Math.pow(1 - f, 2.5));
      m.scale.set(r, 1, r); mat.uniforms.uT.value = f;
      if (f >= 1) { this.scene.remove(m); geo.dispose(); mat.dispose(); return false; }
      return true;
    } });
    this.arena?.ripple?.(pos.x, pos.z, 2.0);
    this.candles(pos.x, pos.z, radius, { knock: true, knockRadius: radius * 0.4 });
  }

  /**
   * Danger-zone warning on the floor: a thin gold rim at `radius` whose inside fills from the centre out over `dur`
   * (the blow lands as the fill reaches the rim), then fades. `posRef` is followed every frame (e.g. the boss position).
   */
  warnRing(posRef, radius = 7, dur = 1.2, color = new THREE.Color(1.0, 0.82, 0.48)) {
    const geo = new THREE.CircleGeometry(1, 96); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uOut: { value: 0 }, uColor: { value: color } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uT; uniform float uOut; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0;
          float rim = smoothstep(0.955, 0.985, d) * (1.0 - smoothstep(0.985, 1.0, d));
          float front = uT * uT;                                      // accelerating fill
          float fill = smoothstep(front, front - 0.06, d) * 0.12 + smoothstep(0.05, 0.0, abs(d - front)) * 0.35 * step(0.02, front);
          float a = (rim * (0.35 + 0.65 * uT) + fill) * (1.0 - uOut);
          gl_FragColor = vec4(uColor * 1.3, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(radius, 1, radius); m.renderOrder = 4;
    m.position.set(posRef.x, 0.12, posRef.z);
    this.scene.add(m);
    let t = 0;
    this.timed.push({ update: dt => {
      t += dt;
      m.position.set(posRef.x, 0.12, posRef.z);
      mat.uniforms.uT.value = Math.min(1, t / dur);
      mat.uniforms.uOut.value = Math.max(0, (t - dur) / 0.3);
      if (t >= dur + 0.3) { this.scene.remove(m); geo.dispose(); mat.dispose(); return false; }
      return true;
    } });
  }

  /** Telegraph circle that fills over `dur`, then a pillar of light. Returns a promise-like handle. */
  pillar(pos, radius = 1.6, dur = 1.0, onBlast = null) {
    const ringGeo = new THREE.CircleGeometry(radius, 64); ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uT; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0; float rim = smoothstep(0.86, 0.97, d) * (1.0 - smoothstep(0.97, 1.0, d));
          float fill = step(d, uT) * 0.22; float a = rim * 0.9 + fill;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * 1.4, a * (0.5 + 0.5 * uT)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(pos.x, 0.11, pos.z);
    this.scene.add(ring);
    const beamGeo = new THREE.CylinderGeometry(radius * 0.9, radius * 1.05, 40, 32, 1, true); beamGeo.translate(0, 20, 0);
    // the column of light; when it comes down on (or right beside) the camera it thins out instead of whiting out the screen
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uTime: { value: 0 }, uC: { value: new THREE.Vector2(pos.x, pos.z) }, uR: { value: radius } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uT; uniform float uTime; uniform vec2 uC; uniform float uR; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        void main(){ float streak = 0.6 + 0.4 * sin(vUv.x * 40.0 + uTime * 9.0) * sin(vUv.y * 6.0 - uTime * 20.0);
          float fade = (1.0 - uT) * smoothstep(1.0, 0.2, vUv.y);
          // a tube of light: bright where we look along its skin, clear through its middle
          float rim = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW)));
          float tube = 0.18 + 0.82 * rim * rim;
          // anything this big right at the lens turns the dark hall milky even at a few percent: fade it out completely
          float near = smoothstep(uR + 0.6, uR + 6.0, distance(cameraPosition.xz, uC));
          gl_FragColor = vec4(vec3(1.0, 0.92, 0.75) * 1.25 * streak * tube, fade * near); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(pos.x, 0, pos.z); beam.visible = false;
    this.scene.add(beam);
    let t = 0, blasted = false;
    const blastDur = 0.55;
    this.timed.push({ update: dt => {
      t += dt;
      if (t < dur) { ringMat.uniforms.uT.value = t / dur; return true; }
      if (!blasted) {
        blasted = true; ring.visible = false; beam.visible = true;
        this.light(new THREE.Vector3(pos.x, 2, pos.z), 0xfff0d0, 55, 0.35, 16);
        this.motes(new THREE.Vector3(pos.x, 0, pos.z), radius, 30);
        this.splash(pos, 1.6);
        this.candles(pos.x, pos.z, radius * 1.15, { knock: true, knockRadius: radius * 0.7 });
        onBlast?.();
      }
      const f = (t - dur) / blastDur;
      beamMat.uniforms.uT.value = Math.min(1, f); beamMat.uniforms.uTime.value = t;
      beam.scale.set(1 + f * 0.25, 1, 1 + f * 0.25);
      if (f >= 1) { for (const o of [ring, beam]) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); } return false; }
      return true;
    } });
  }

  /** Flash a character's materials (emissive) for impact readability. */
  flashMesh(root, color = new THREE.Color(1, 0.95, 0.85), dur = 0.12, strength = 1.6) {
    const mats = [];
    root.traverse(o => { if (o.isMesh && o.material && 'emissive' in o.material) mats.push(o.material); });
    for (const m of mats) {
      if (!m.userData.baseEmissive) m.userData.baseEmissive = { c: m.emissive.clone(), i: m.emissiveIntensity };
    }
    this.flashes.push({ mats, t: 0, dur, color, strength });
  }

  update(dt) {
    this.now += dt;
    this.add.update(dt);
    this.alpha.update(dt);
    for (const t of this.trails) t.update(this.now);
    this.timed = this.timed.filter(o => o.update(dt));
    for (const l of this.lights) {
      if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = l.userData.peak * Math.max(0, l.userData.t / l.userData.dur); }
      else l.intensity = 0;
    }
    this.flashes = this.flashes.filter(f => {
      f.t += dt;
      const k = Math.max(0, 1 - f.t / f.dur);
      for (const m of f.mats) {
        const b = m.userData.baseEmissive;
        m.emissive.copy(b.c).lerp(f.color, k);
        m.emissiveIntensity = b.i + f.strength * k;
      }
      return f.t < f.dur;
    });
  }
}
