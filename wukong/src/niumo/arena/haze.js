// Air and depth of the caldera, all cheap camera-facing sheets (no depth texture, no extra passes):
//  - light shafts: dim warm beams fanning up out of the moat glow behind the giant, through the smoke (a halo that
//    keeps his silhouette readable against the dark mountain), plus a few low beams from the rivers;
//  - smoke columns: tall billowing plumes from the rim and the distant cones, lit red from below;
//  - distant ridges: three rings of jagged mountain silhouettes outside the caldera, each paler and redder with
//    distance (aerial perspective), a few with dying lava streaks, so the sky has layers in front of it;
//  - drifting low haze banks over the floor at the far end (soft, fade near the camera).
// Everything takes its colours from the shared VOLCANO fog / glow uniforms, so phase changes follow on their own.
import * as THREE from 'three';
import { VOLCANO } from './shared.js';
import { SUN } from './sky.js';
import { rng, fbm } from './noise.js';

const BEAM_VS = /* glsl */`
  attribute vec4 aBeam;          // x: seed, y: length, z: width, w: strength
  attribute vec3 aDir;           // beam axis (unit)
  varying vec2 vUv; varying float vSeed; varying float vK; varying float vFade; varying vec3 vW;
  void main() {
    vUv = uv; vSeed = aBeam.x; vK = aBeam.w;
    vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 axis = aDir;
    vec3 toCam = normalize(cameraPosition - base);
    vec3 side = normalize(cross(axis, toCam));
    float w = aBeam.z * (0.35 + 0.65 * uv.y);                  // beams widen as they rise
    vec3 p = base + axis * (uv.y * aBeam.y) + side * ((uv.x - 0.5) * w);
    vW = p;
    // looking down the axis the sheet degenerates: fade it
    vFade = smoothstep(0.98, 0.8, abs(dot(axis, normalize(cameraPosition - p))));
    vFade *= smoothstep(6.0, 22.0, distance(cameraPosition, p));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const BEAM_FS = /* glsl */`
  uniform sampler2D uNoise; uniform float uTime; uniform vec3 uCol; uniform float uK;
  varying vec2 vUv; varying float vSeed; varying float vK; varying float vFade; varying vec3 vW;
  void main() {
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    across = across * across * (3.0 - 2.0 * across);
    float along = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
    // streaks running along the beam, smoke drifting through it
    float st = texture2D(uNoise, vec2(vUv.x * 1.3 + vSeed, vUv.y * 0.12 + vSeed * 0.7)).r;
    float sm = texture2D(uNoise, vec2(vUv.x * 0.6 + vSeed * 1.7 + uTime * 0.006, vUv.y * 0.8 - uTime * 0.02)).g;
    float k = across * across * along * (0.3 + 0.9 * st * st) * (0.25 + 0.9 * sm) * vK * vFade * uK;
    gl_FragColor = vec4(uCol * k, 1.0);
  }`;

const SMOKE_VS = /* glsl */`
  attribute vec4 aCol;           // x: seed, y: height, z: width, w: distance tint
  varying vec2 vUv; varying float vSeed; varying float vFar; varying vec3 vW;
  void main() {
    vUv = uv; vSeed = aCol.x; vFar = aCol.w;
    vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = cameraPosition - base; toCam.y = 0.0; toCam = normalize(toCam);
    vec3 side = vec3(toCam.z, 0.0, -toCam.x);
    float bend = uv.y * uv.y * aCol.y * 0.35;                    // plumes lean with the high wind
    vec3 p = base + vec3(0.0, uv.y * aCol.y, 0.0) + side * ((uv.x - 0.5) * aCol.z * (0.3 + 1.6 * uv.y)) + vec3(bend, 0.0, bend * 0.3);
    vW = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const SMOKE_FS = /* glsl */`
  uniform sampler2D uNoise; uniform float uTime; uniform vec3 uFog; uniform vec3 uGlow; uniform float uK;
  uniform vec3 uSunDir; uniform vec3 uSun;
  varying vec2 vUv; varying float vSeed; varying float vFar; varying vec3 vW;
  float fbm2(vec2 p) { return texture2D(uNoise, p).r * 0.55 + texture2D(uNoise, p * 2.1 + 0.3).g * 0.3 + texture2D(uNoise, p * 4.3 + 0.7).b * 0.15; }
  void main() {
    float x = (vUv.x - 0.5) * 2.0;
    float t = uTime * 0.012;
    float n = fbm2(vec2(vUv.x * 0.9 + vSeed, vUv.y * 1.6 - t * (1.0 + vSeed * 0.3)));
    float n2 = fbm2(vec2(vUv.x * 2.2 - vSeed, vUv.y * 3.4 - t * 2.1));
    float edge = 1.0 - smoothstep(0.25 + 0.5 * n, 1.0, abs(x) + (n2 - 0.5) * 0.5);
    float a = edge * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y + (n - 0.5) * 0.3));
    a *= smoothstep(0.25, 0.6, n * 0.7 + n2 * 0.5);
    // dark smoke, red-lit from the crater at its foot, fading into the fog with distance
    vec3 c = vec3(0.05, 0.042, 0.048) * (0.6 + 0.8 * n2);
    c += uGlow * exp(-vUv.y * 6.0) * (0.6 + 0.6 * n);
    c = mix(c, uFog * 1.1, vFar);
    // the low sun: the flank that faces it glows, the thin edges burn when it stands behind the column
    vec3 vd = normalize(vW - cameraPosition);
    float mu = max(dot(vd, uSunDir), 0.0);
    vec3 sideV = normalize(cross(vec3(0.0, 1.0, 0.0), vd));
    float facing = clamp(x * sign(dot(sideV, uSunDir)) * 0.7 + 0.35, 0.0, 1.0);
    c += uSun * (0.16 * facing * (0.5 + 0.5 * n2) + a * (1.0 - a) * 4.0 * (1.6 * pow(mu, 8.0) + 0.12));
    gl_FragColor = vec4(c, a * uK * (0.92 - vFar * 0.35));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const RIDGE_VS = /* glsl */`
  attribute float aTop;          // 1 on the crest, 0 at the foot
  attribute float aLayer;        // 0 near .. 1 far
  varying float vTop; varying float vLayer; varying vec3 vW;
  void main() {
    vTop = aTop; vLayer = aLayer;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const RIDGE_FS = /* glsl */`
  uniform sampler2D uNoise; uniform float uTime; uniform vec3 uFog; uniform vec3 uGlow; uniform vec3 uSunDir;
  uniform vec3 uSun; uniform float uLava; uniform float uRain;
  varying float vTop; varying float vLayer; varying vec3 vW;
  void main() {
    vec3 d = normalize(vW - cameraPosition);
    float mu = max(dot(d, uSunDir), 0.0);
    // silhouettes: near black, each layer further into the smoke (paler, redder towards the glow)
    vec3 rock = vec3(0.007, 0.006, 0.0058);
    vec3 air = uFog * (1.1 + 1.2 * vLayer) + uSun * (0.6 * pow(mu, 6.0) + 0.25 * mu * mu) * (0.4 + vLayer);
    vec3 c = mix(rock, air, 0.18 + 0.7 * vLayer);
    // a breath of glow on the crests facing the main volcano, haze pooling at the feet
    c += uGlow * 0.35 * pow(vTop, 6.0) * (0.3 + 0.7 * mu) * (1.0 - vLayer * 0.5);
    c = mix(c, air * 1.15, (1.0 - vTop) * 0.45);
    // dying lava streaks on the nearer slopes
    float s = texture2D(uNoise, vec2(atan(vW.x, -vW.z) * 9.0, vW.y * 0.004)).r;
    float streak = smoothstep(0.82, 0.9, s) * smoothstep(0.25, 0.6, vTop) * (1.0 - smoothstep(0.85, 1.0, vTop)) * (1.0 - vLayer);
    c += vec3(0.6, 0.08, 0.015) * streak * uLava * (0.7 + 0.3 * sin(uTime * 0.7 + s * 30.0));
    c = mix(c, air * 1.2, uRain * (0.55 + 0.4 * vLayer));       // the rain swallows the far mountains
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function buildRidges(noiseSeed = 5) {
  // three rings round the caldera, open towards nothing (full circle), jagged crests from ridged noise
  const layers = [
    { r: 230, h: 46, var: 30, seg: 220, seed: 11 },
    { r: 380, h: 70, var: 45, seg: 200, seed: 23 },
    { r: 620, h: 105, var: 60, seg: 180, seed: 37 },
  ];
  const pos = [], top = [], lay = [], idx = [];
  let base = 0;
  layers.forEach((L, li) => {
    for (let i = 0; i <= L.seg; i++) {
      const a = (i / L.seg) * Math.PI * 2;
      const cx = Math.sin(a), cz = -Math.cos(a);
      // crest: broad massifs + sharp ridges; keep a low saddle straight ahead of the spawn view (behind the giant
      // the dome's great volcano must show through)
      const u = Math.cos(a) * 2.2 + 7 * li, v = Math.sin(a) * 2.2 - 3 * li;
      const big = fbm(u, v, 3, L.seed);
      const sharp = 1 - Math.abs(fbm(u * 3.1, v * 3.1, 3, L.seed + 1) * 2 - 1);
      const behind = Math.exp(-((Math.atan2(Math.sin(a - 0.32), Math.cos(a - 0.32)) / 0.32) ** 2));
      const sunGap = Math.exp(-((Math.atan2(Math.sin(a - SUN.az), Math.cos(a - SUN.az)) / 0.3) ** 2));   // and under the sun
      const h = Math.max(6, L.h + (big - 0.5) * 2 * L.var + sharp * L.var * 0.45) * (1 - 0.55 * behind) * (1 - 0.6 * sunGap);
      const r = L.r * (1 + (fbm(u * 0.7, v * 0.7, 2, L.seed + 5) - 0.5) * 0.25);
      pos.push(cx * r, -25, cz * r - 10, cx * r, h, cz * r - 10);
      top.push(0, 1); lay.push(li / 2, li / 2);
      if (i < L.seg) {
        const k = base + i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    base += (L.seg + 1) * 2;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(lay, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  void noiseSeed;
  return g;
}

export function createHaze({ noise, quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'volcano-haze';
  const r = rng(4242);
  const owned = [];

  // ---- light shafts ----------------------------------------------------------------------------------------------
  const beams = [];
  // the halo behind him: from the moat and the falls, fanning up and slightly towards the arena
  for (const [x, lean, w, k] of [[-17, -0.42, 22, 0.5], [-8, -0.2, 15, 0.8], [-1, -0.04, 26, 0.45], [6, 0.16, 13, 0.9], [14, 0.33, 20, 0.6], [22, 0.5, 16, 0.4]]) {
    beams.push({ p: [x + (r() - 0.5) * 2, 2, -56 + r() * 3], d: [Math.sin(lean), 1, 0.18 + r() * 0.12], len: 60 + r() * 35, w, k });
  }
  // low, long beams from the rivers through the smoke on either side
  for (const [x, z, lx] of [[-24, -14, -0.25], [-27, 8, -0.3], [24, -12, 0.25], [27, 10, 0.3]]) {
    beams.push({ p: [x, -0.5, z], d: [lx, 1, 0], len: 26 + r() * 10, w: 7 + r() * 4, k: 0.25 + r() * 0.15 });
  }
  const beamGeo = new THREE.PlaneGeometry(1, 1, 1, 6);
  beamGeo.translate(0.5, 0.5, 0);                // uv == position in [0,1]
  const nB = beams.length;
  const aBeam = new Float32Array(nB * 4), aDir = new Float32Array(nB * 3);
  const beamMat = new THREE.ShaderMaterial({
    name: 'volcano-beams', vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
    uniforms: { uNoise: { value: noise }, uTime: { value: 0 }, uCol: { value: new THREE.Color(0.09, 0.022, 0.006) }, uK: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const beamMesh = new THREE.InstancedMesh(beamGeo, beamMat, nB);
  const m4 = new THREE.Matrix4();
  beams.forEach((b, i) => {
    m4.makeTranslation(...b.p);
    beamMesh.setMatrixAt(i, m4);
    aBeam.set([r() * 10, b.len, b.w, b.k], i * 4);
    const d = new THREE.Vector3(...b.d).normalize();
    aDir.set([d.x, d.y, d.z], i * 3);
  });
  beamGeo.setAttribute('aBeam', new THREE.InstancedBufferAttribute(aBeam, 4));
  beamGeo.setAttribute('aDir', new THREE.InstancedBufferAttribute(aDir, 3));
  beamMesh.frustumCulled = false;
  beamMesh.renderOrder = 5;
  beamMesh.name = 'volcano-beams';
  group.add(beamMesh);
  owned.push(beamGeo, beamMat);

  // ---- smoke columns ---------------------------------------------------------------------------------------------
  const cols = [
    // [x, z, height, width, far]
    [-78, -118, 190, 34, 0.15], [96, -132, 230, 40, 0.2], [-150, -40, 160, 30, 0.22], [160, 10, 150, 28, 0.25],
    [-330, -470, 420, 90, 0.55], [380, -420, 380, 80, 0.55], [-560, -160, 360, 90, 0.7], [120, -760, 520, 120, 0.72],
  ];
  if (quality === 'low') cols.length = 4;
  const smokeGeo = new THREE.PlaneGeometry(1, 1, 1, 8);
  smokeGeo.translate(0.5, 0.5, 0);
  const aCol = new Float32Array(cols.length * 4);
  const smokeMat = new THREE.ShaderMaterial({
    name: 'volcano-smoke-columns', vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS,
    uniforms: { uNoise: { value: noise }, uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uK: { value: 1 },
      uSunDir: VOLCANO.vSunDir, uSun: { value: new THREE.Color() } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, cols.length);
  cols.forEach((c, i) => {
    m4.makeTranslation(c[0], 8, c[1]);
    smokeMesh.setMatrixAt(i, m4);
    aCol.set([r() * 10, c[2], c[3], c[4]], i * 4);
  });
  smokeGeo.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 4));
  smokeMesh.frustumCulled = false;
  smokeMesh.renderOrder = 4;
  smokeMesh.name = 'volcano-smoke-columns';
  group.add(smokeMesh);
  owned.push(smokeGeo, smokeMat);

  // ---- distant ridges --------------------------------------------------------------------------------------------
  const ridgeGeo = buildRidges();
  const ridgeMat = new THREE.ShaderMaterial({
    name: 'volcano-ridges', vertexShader: RIDGE_VS, fragmentShader: RIDGE_FS,
    uniforms: {
      uNoise: { value: noise }, uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
      uSunDir: VOLCANO.vSunDir, uSun: { value: new THREE.Color() }, uLava: { value: 1 }, uRain: { value: 0 },
    },
    side: THREE.DoubleSide, fog: false,
  });
  const ridges = new THREE.Mesh(ridgeGeo, ridgeMat);
  ridges.name = 'volcano-ridges';
  ridges.frustumCulled = false;
  group.add(ridges);
  owned.push(ridgeGeo, ridgeMat);

  const tmp = new THREE.Color();
  return {
    mesh: group,
    update(time, s = {}) {
      const k = s.strength ?? 1;
      const heat = s.heat ?? 0.7;
      const rain = s.rain ?? 0;
      beamMat.uniforms.uTime.value = time;
      beamMat.uniforms.uK.value = k * (0.6 + 0.6 * heat) * (1 - rain * 0.9) * (1 + (s.erupt || 0) * 0.8);
      beamMat.uniforms.uCol.value.setRGB(0.09, 0.022, 0.006).lerp(tmp.setRGB(0.16, 0.05, 0.014), s.erupt || 0);
      smokeMat.uniforms.uTime.value = time;
      smokeMat.uniforms.uFog.value.copy(VOLCANO.vFogCol.value);
      smokeMat.uniforms.uGlow.value.copy(VOLCANO.vFogGlowCol.value).multiplyScalar(1.4);
      smokeMat.uniforms.uK.value = 1 - rain * 0.85;
      smokeMat.uniforms.uSun.value.copy(VOLCANO.vSunCol.value);
      ridgeMat.uniforms.uTime.value = time;
      ridgeMat.uniforms.uFog.value.copy(VOLCANO.vFogCol.value);
      ridgeMat.uniforms.uGlow.value.copy(VOLCANO.vFogGlowCol.value);
      ridgeMat.uniforms.uSun.value.copy(VOLCANO.vSunCol.value);
      ridgeMat.uniforms.uLava.value = heat * (1 - rain);
      ridgeMat.uniforms.uRain.value = rain;
    },
    dispose() { for (const o of owned) o.dispose(); },
  };
}
