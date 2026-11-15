// Air of the caldera:
//  - ash falling like snow (camera-centred wrap volume; flakes near the lava catch its glow),
//  - embers rising from the lava (and from the seams once the floor has given way),
//  - rain streaks for the ending, smoke / steam / dust puffs (one instanced ring buffer),
//  - eruption bursts: ballistic lava blobs that splat and cool, glowing scorch decals,
//  - rocks falling from the rim when the scene shakes.
// Motion lives in the vertex shaders; the CPU only writes newly spawned slots.
import * as THREE from 'three';
import { VOLCANO } from './shared.js';
import { sampleField, MASK, BOUNDS, FLOOR } from './layout.js';
import { rng } from './noise.js';

const FOG_FADE = /* glsl */`
float fogFade(vec3 p) {
  float d = distance(p, cameraPosition);
  return exp(-vFogDensity * d * 0.85);
}
`;

export function createParticles({ ground, masks, noise, quality = 'high', density = 1, falls = [] }) {
  const group = new THREE.Group();
  group.name = 'volcano-particles';
  const r = rng(616);
  const lavaR = (x, z) => sampleField(masks.mask, masks.res, x, z, 0);
  const lavaG = (x, z) => sampleField(masks.mask, masks.res, x, z, 1);
  const gy = (x, z) => ground.heightAt(x, z);
  const K = Math.max(0.2, density);
  const shared = (k) => VOLCANO[k];

  // lava sample points (for embers / smoke / steam): rivers + moat, and the phase-two seams separately
  const riverPts = [], seamPts = [];
  for (let tries = 0; tries < 60000 && (riverPts.length < 1400 || seamPts.length < 800); tries++) {
    const x = MASK.x0 + r() * MASK.size, z = MASK.z0 + r() * MASK.size;
    const R = lavaR(x, z);
    if (R > 0.62 && riverPts.length < 1400) riverPts.push([x, z]);
    else if (R < 0.2 && lavaG(x, z) > 0.7 && seamPts.length < 800 && Math.hypot(x, z + 5) < 45) seamPts.push([x, z]);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // ash
  const nAsh = Math.round(4200 * K);
  const ASH_BOX = new THREE.Vector3(56, 28, 56);
  const aPos = new Float32Array(nAsh * 3), aSeed = new Float32Array(nAsh * 4);
  for (let i = 0; i < nAsh; i++) {
    aPos.set([r(), r(), r()], i * 3);
    aSeed.set([r(), r(), r(), r()], i * 4);
  }
  const ashGeo = new THREE.BufferGeometry();
  ashGeo.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
  ashGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  ashGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const ashU = {
    uTime: { value: 0 }, uBox: { value: ASH_BOX }, uFall: { value: 1 }, uWind: { value: new THREE.Vector2(0.35, 0.18) },
    uIntensity: { value: 1 }, uViewportH: { value: 720 }, uBoost: { value: 0 },
    vGlowMap: shared('vGlowMap'), vMaskRect: shared('vMaskRect'), vGlowCol: shared('vGlowCol'), vFogDensity: shared('vFogDensity'),
    vFogCol: shared('vFogCol'), vSeamGlow: shared('vSeamGlow'),
  };
  const ashMat = new THREE.ShaderMaterial({
    name: 'volc-ash',
    uniforms: ashU,
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime; uniform vec3 uBox; uniform float uFall; uniform vec2 uWind; uniform float uViewportH; uniform float uBoost;
      uniform sampler2D vGlowMap; uniform vec4 vMaskRect; uniform vec3 vGlowCol; uniform float vFogDensity; uniform float vSeamGlow;
      varying float vAlpha; varying vec3 vCol; varying float vSpin;
      ${FOG_FADE}
      void main() {
        float t = uTime;
        vec3 p = position * uBox;
        float sp = (0.32 + aSeed.x * 0.45) * uFall * (1.0 + uBoost);
        p.y -= t * sp;
        p.x += t * uWind.x * (0.6 + aSeed.y * 0.8) + sin(t * (0.25 + aSeed.z * 0.5) + aSeed.w * 6.28) * 0.7;
        p.z += t * uWind.y * (0.6 + aSeed.y * 0.8) + cos(t * (0.2 + aSeed.y * 0.4) + aSeed.z * 6.28) * 0.7;
        vec3 lo = vec3(cameraPosition.x - uBox.x * 0.5, cameraPosition.y - 7.0, cameraPosition.z - uBox.z * 0.5);
        p = lo + mod(p - lo, uBox);
        vec4 g = texture2D(vGlowMap, (p.xz - vMaskRect.xy) * vMaskRect.zw);
        float warm = (g.r + g.g * vSeamGlow) * exp(-max(p.y, 0.0) * 0.12);
        vCol = vec3(0.26, 0.225, 0.2) + vGlowCol * warm * 0.16;
        vSpin = 0.3 + 0.7 * abs(sin(t * (1.2 + aSeed.w * 2.5) + aSeed.z * 9.0));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float size = 0.022 + aSeed.w * 0.035;
        float px = size * projectionMatrix[1][1] * 0.5 * uViewportH / max(-mv.z, 0.05);
        float cl = clamp(px, 1.2, 7.0);
        vAlpha = clamp(px * px / (cl * cl), 0.0, 1.0) * smoothstep(0.4, 1.6, -mv.z) * fogFade(p) * smoothstep(-0.2, 0.4, p.y);
        gl_PointSize = cl;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity;
      varying float vAlpha; varying vec3 vCol; varying float vSpin;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        c.y /= max(vSpin, 0.2);
        float q = length(c) * 2.0;
        float a = 1.0 - smoothstep(0.5, 1.0, q);
        gl_FragColor = vec4(vCol * uIntensity, a * vAlpha * 0.85 * min(uIntensity, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const ash = new THREE.Points(ashGeo, ashMat);
  ash.name = 'ash';
  ash.frustumCulled = false;
  ash.renderOrder = 4;
  group.add(ash);

  // ---------------------------------------------------------------------------------------------------------------
  // embers
  const nEmb = Math.round(1100 * K), nSeamEmb = Math.round(500 * K);
  const eTotal = nEmb + nSeamEmb;
  const ePos = new Float32Array(eTotal * 3), eSeed = new Float32Array(eTotal * 4), eKind = new Float32Array(eTotal);
  for (let i = 0; i < eTotal; i++) {
    const seam = i >= nEmb;
    const pts = seam ? seamPts : riverPts;
    const p = pts.length ? pts[Math.floor(r() * pts.length)] : [0, -50];
    ePos.set([p[0], seam ? -0.6 : -0.4, p[1]], i * 3);
    eSeed.set([r(), r(), r(), r()], i * 4);
    eKind[i] = seam ? 1 : 0;
  }
  // a dense cloud at the foot of every fall
  for (const f of falls) {
    for (let k = 0; k < 40 && f.bottom; k++) {
      const i = Math.floor(r() * nEmb);
      ePos.set([f.bottom.x + r.range(-2, 2), -0.3, f.bottom.z + r.range(-1, 1)], i * 3);
      eKind[i] = f.phase2 ? 2 : 0;
    }
  }
  const embGeo = new THREE.BufferGeometry();
  embGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  embGeo.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 4));
  embGeo.setAttribute('aKind', new THREE.BufferAttribute(eKind, 1));
  embGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 10, -5), 120);
  const embU = {
    uTime: { value: 0 }, uIntensity: { value: 0.7 }, uSeam: { value: 0 }, uFalls2: { value: 0 }, uViewportH: { value: 720 },
    uWind: { value: new THREE.Vector2(0.35, 0.18) }, vFogDensity: shared('vFogDensity'),
    uCol: { value: new THREE.Color(1.0, 0.3, 0.05) },
  };
  const embMat = new THREE.ShaderMaterial({
    name: 'volc-embers',
    uniforms: embU,
    vertexShader: /* glsl */`
      attribute vec4 aSeed; attribute float aKind;
      uniform float uTime; uniform float uIntensity; uniform float uSeam; uniform float uFalls2; uniform float uViewportH; uniform vec2 uWind;
      uniform float vFogDensity;
      varying float vBright;
      ${FOG_FADE}
      void main() {
        float life = 4.0 + aSeed.x * 6.0;
        float ph = fract(uTime / life + aSeed.y);
        float rise = (3.0 + aSeed.z * 16.0) * ph;
        vec3 p = position;
        p.y += rise + 0.2;
        float sw = ph * (2.0 + aSeed.w * 3.0);
        p.x += sin(uTime * (0.8 + aSeed.w) + aSeed.x * 20.0) * 0.4 * sw + uWind.x * rise * 0.6;
        p.z += cos(uTime * (0.7 + aSeed.z) + aSeed.y * 20.0) * 0.4 * sw + uWind.y * rise * 0.6;
        float gate = aKind < 0.5 ? 1.0 : (aKind < 1.5 ? uSeam : uFalls2);
        float flick = 0.6 + 0.4 * sin(uTime * (9.0 + aSeed.w * 14.0) + aSeed.x * 50.0);
        vBright = pow(1.0 - ph, 1.6) * smoothstep(0.0, 0.05, ph) * flick * uIntensity * gate * fogFade(p);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float size = 0.03 + aSeed.w * 0.035;
        float px = size * projectionMatrix[1][1] * 0.5 * uViewportH / max(-mv.z, 0.05);
        float cl = clamp(px, 1.0, 6.0);
        vBright *= clamp(px * px / (cl * cl), 0.15, 1.0);
        gl_PointSize = cl * (vBright > 0.002 ? 1.0 : 0.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol;
      varying float vBright;
      void main() {
        float q = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-q * q * 3.0) * (1.0 - smoothstep(0.7, 1.0, q));
        vec3 c = mix(uCol, vec3(1.0, 0.6, 0.2), smoothstep(0.6, 1.0, vBright)) * vBright * a * 4.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
  });
  const embers = new THREE.Points(embGeo, embMat);
  embers.name = 'embers';
  embers.frustumCulled = false;
  embers.renderOrder = 5;
  group.add(embers);

  // ---------------------------------------------------------------------------------------------------------------
  // rain streaks (instanced quads, camera-centred wrap volume)
  const nRain = Math.round((quality === 'low' ? 4000 : 9000) * K);
  const RAIN_BOX = new THREE.Vector3(40, 26, 40);
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const rainGeo = new THREE.InstancedBufferGeometry();
  rainGeo.index = quad.index;
  rainGeo.setAttribute('position', quad.attributes.position);
  const rOff = new Float32Array(nRain * 4);
  for (let i = 0; i < nRain; i++) rOff.set([r(), r(), r(), r()], i * 4);
  rainGeo.setAttribute('aOff', new THREE.InstancedBufferAttribute(rOff, 4));
  rainGeo.instanceCount = nRain;
  rainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const rainU = {
    uTime: { value: 0 }, uBox: { value: RAIN_BOX }, uRain: { value: 0 }, uWind: { value: new THREE.Vector2(1.2, 0.5) },
    uViewportH: { value: 720 }, vFogDensity: shared('vFogDensity'),
  };
  const rainMat = new THREE.ShaderMaterial({
    name: 'volc-rain',
    uniforms: rainU,
    vertexShader: /* glsl */`
      attribute vec4 aOff;
      uniform float uTime; uniform vec3 uBox; uniform float uRain; uniform vec2 uWind; uniform float uViewportH;
      uniform float vFogDensity;
      varying float vA; varying float vAlong;
      ${FOG_FADE}
      void main() {
        float speed = 9.0 + aOff.w * 4.0;
        vec3 vel = vec3(uWind.x, -speed, uWind.y);
        vec3 p = aOff.xyz * uBox + vel * uTime;
        vec3 lo = vec3(cameraPosition.x - uBox.x * 0.5, cameraPosition.y - 8.0, cameraPosition.z - uBox.z * 0.5);
        p = lo + mod(p - lo, uBox);
        vec3 tail = p - vel * 0.055;
        vec4 a = viewMatrix * vec4(p, 1.0), b = viewMatrix * vec4(tail, 1.0);
        vec2 dir = normalize((b.xy / max(-b.z, 0.05)) - (a.xy / max(-a.z, 0.05)) + 1e-5);
        vec3 side = vec3(-dir.y, dir.x, 0.0);
        vec4 q = mix(a, b, position.y);
        float wpx = 1.1;                                  // width in pixels
        float w = wpx * max(-q.z, 0.05) / (projectionMatrix[1][1] * 0.5 * uViewportH);
        q.xyz += side * position.x * w;
        vAlong = position.y;
        vA = uRain * fogFade(p) * smoothstep(0.5, 2.5, -a.z) * step(-0.4, p.y) * (0.6 + 0.4 * aOff.w);
        gl_Position = projectionMatrix * q;
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vAlong;
      void main() {
        float a = vA * (1.0 - vAlong) * 0.32;
        gl_FragColor = vec4(vec3(0.28, 0.3, 0.33), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const rain = new THREE.Mesh(rainGeo, rainMat);
  rain.name = 'rain';
  rain.frustumCulled = false;
  rain.renderOrder = 6;
  rain.visible = false;
  group.add(rain);

  // ---------------------------------------------------------------------------------------------------------------
  // puffs: smoke over the lava, steam in the rain, dust from falling rocks (ring buffer of billboards)
  const NP = Math.round((quality === 'low' ? 160 : 320) * Math.min(1, K + 0.2));
  const pGeo = new THREE.InstancedBufferGeometry();
  const pq = new THREE.PlaneGeometry(1, 1);
  pGeo.index = pq.index;
  pGeo.setAttribute('position', pq.attributes.position);
  pGeo.setAttribute('uv', pq.attributes.uv);
  const pP0 = new Float32Array(NP * 4), pVel = new Float32Array(NP * 4), pT = new Float32Array(NP * 4), pCol = new Float32Array(NP * 4);
  for (let i = 0; i < NP; i++) pT[i * 4] = -1e4;
  const aP0 = new THREE.InstancedBufferAttribute(pP0, 4), aVel = new THREE.InstancedBufferAttribute(pVel, 4);
  const aT = new THREE.InstancedBufferAttribute(pT, 4), aCol = new THREE.InstancedBufferAttribute(pCol, 4);
  for (const a of [aP0, aVel, aT, aCol]) a.setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute('aP0', aP0); pGeo.setAttribute('aVel', aVel); pGeo.setAttribute('aT', aT); pGeo.setAttribute('aCol', aCol);
  pGeo.instanceCount = NP;
  pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const puffU = {
    uTime: { value: 0 }, uNoise: { value: noise },
    vGlowMap: shared('vGlowMap'), vMaskRect: shared('vMaskRect'), vGlowCol: shared('vGlowCol'), vFogDensity: shared('vFogDensity'),
    vFogCol: shared('vFogCol'), vSeamGlow: shared('vSeamGlow'),
  };
  const puffMat = new THREE.ShaderMaterial({
    name: 'volc-puffs',
    uniforms: puffU,
    vertexShader: /* glsl */`
      attribute vec4 aP0; attribute vec4 aVel; attribute vec4 aT; attribute vec4 aCol;
      uniform float uTime; uniform sampler2D vGlowMap; uniform vec4 vMaskRect; uniform vec3 vGlowCol; uniform float vFogDensity;
      uniform float vSeamGlow; uniform vec3 vFogCol;
      varying vec2 vUv; varying float vA; varying vec3 vC; varying float vSeed; varying float vAge;
      void main() {
        float age = uTime - aT.x;
        float life = aT.y;
        float k = age / life;
        vAge = k;
        vec3 p = aP0.xyz + aVel.xyz * age + vec3(0.0, aVel.w * age * age * 0.5, 0.0);
        float size = mix(aT.z, aT.w, 1.0 - pow(1.0 - clamp(k, 0.0, 1.0), 2.0));
        vec4 g = texture2D(vGlowMap, (p.xz - vMaskRect.xy) * vMaskRect.zw);
        float warm = (g.r + g.g * vSeamGlow + g.b * 0.5) * exp(-max(p.y, 0.0) * 0.08);
        vC = aCol.rgb + vGlowCol * warm * 0.05 * (1.0 - k * 0.5);
        float fog = 1.0 - exp(-vFogDensity * distance(p, cameraPosition) * 0.85);
        vC = mix(vC, vFogCol, fog);
        vA = aCol.a * smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.55, 1.0, k)) * step(0.0, age) * step(age, life);
        vSeed = aP0.w;
        vUv = uv;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float rot = aP0.w * 6.28 + age * 0.08 * (aP0.w - 0.5);
        vec2 c = vec2(cos(rot), sin(rot));
        vec2 q = vec2(position.x * c.x - position.y * c.y, position.x * c.y + position.y * c.x) * size;
        vec3 wp = p + right * q.x + up * q.y;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vA *= smoothstep(0.5, 3.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uTime;
      varying vec2 vUv; varying float vA; varying vec3 vC; varying float vSeed; varying float vAge;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        vec2 nuv = vUv * 0.45 + vec2(vSeed * 7.3, vSeed * 3.1) + vec2(0.0, -vAge * 0.15);
        float n = texture2D(uNoise, nuv).r * 0.65 + texture2D(uNoise, nuv * 2.2 + 0.3).g * 0.35;
        float a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.9) * vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vC * (0.75 + 0.5 * n), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const puffs = new THREE.Mesh(pGeo, puffMat);
  puffs.name = 'puffs';
  puffs.frustumCulled = false;
  puffs.renderOrder = 3;
  group.add(puffs);
  let pNext = 0, pMin = NP, pMax = -1;
  let clock = 0;
  function puff(x, y, z, { vx = 0, vy = 1, vz = 0, acc = 0, life = 8, s0 = 1, s1 = 5, col = [0.03, 0.026, 0.024], alpha = 0.4 } = {}) {
    const i = pNext;
    pNext = (pNext + 1) % NP;
    pP0.set([x, y, z, r()], i * 4);
    pVel.set([vx, vy, vz, acc], i * 4);
    pT.set([clock, life, s0, s1], i * 4);
    pCol.set([col[0], col[1], col[2], alpha], i * 4);
    pMin = Math.min(pMin, i); pMax = Math.max(pMax, i);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // eruption bursts: lava blobs (points), cooling on the ground
  const NB = quality === 'low' ? 512 : 1024;
  const bP0 = new Float32Array(NB * 4), bV = new Float32Array(NB * 4), bT = new Float32Array(NB * 4);
  for (let i = 0; i < NB; i++) bT[i * 4] = -1e4;
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NB * 3), 3));
  const abP0 = new THREE.BufferAttribute(bP0, 4), abV = new THREE.BufferAttribute(bV, 4), abT = new THREE.BufferAttribute(bT, 4);
  for (const a of [abP0, abV, abT]) a.setUsage(THREE.DynamicDrawUsage);
  bGeo.setAttribute('aP0', abP0); bGeo.setAttribute('aV', abV); bGeo.setAttribute('aT', abT);
  bGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const burstU = { uTime: { value: 0 }, uViewportH: { value: 720 }, vFogDensity: shared('vFogDensity') };
  const burstMat = new THREE.ShaderMaterial({
    name: 'volc-bursts',
    uniforms: burstU,
    vertexShader: /* glsl */`
      attribute vec4 aP0; attribute vec4 aV; attribute vec4 aT;
      uniform float uTime; uniform float uViewportH; uniform float vFogDensity;
      varying float vHeat; varying float vA;
      ${FOG_FADE}
      void main() {
        float age = uTime - aT.x;
        float life = aT.y;
        vec3 p = aP0.xyz + aV.xyz * age + vec3(0.0, -9.8 * 0.5 * age * age, 0.0);
        float landed = step(p.y, aP0.w);
        // after landing it stays where it hit (approximate landing point) and cools
        float tl = (aV.y + sqrt(max(aV.y * aV.y + 2.0 * 9.8 * (aP0.y - aP0.w), 0.0))) / 9.8;
        vec3 hit = aP0.xyz + aV.xyz * tl + vec3(0.0, -4.9 * tl * tl, 0.0);
        hit.y = aP0.w + 0.04;
        p = mix(p, hit, landed);
        float cool = landed > 0.5 ? clamp((age - tl) / max(life - tl, 0.1), 0.0, 1.0) : 0.0;
        vHeat = (1.0 - cool) * (landed > 0.5 ? 0.55 : 1.0);
        vA = step(0.0, age) * step(age, life) * fogFade(p);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float size = aT.z * (landed > 0.5 ? 1.6 : 1.0);
        float px = size * projectionMatrix[1][1] * 0.5 * uViewportH / max(-mv.z, 0.05);
        gl_PointSize = clamp(px, 1.5, 28.0) * (vA > 0.0 ? 1.0 : 0.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vHeat; varying float vA;
      void main() {
        float q = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-q * q * 2.5) * (1.0 - smoothstep(0.8, 1.0, q));
        vec3 hot = vec3(1.0, 0.55, 0.16) * 6.0, warm = vec3(0.9, 0.12, 0.02) * 1.6, cold = vec3(0.04, 0.02, 0.015);
        vec3 c = vHeat > 0.5 ? mix(warm, hot, (vHeat - 0.5) * 2.0) : mix(cold, warm, vHeat * 2.0);
        gl_FragColor = vec4(c * a * vA, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
  });
  const bursts = new THREE.Points(bGeo, burstMat);
  bursts.name = 'bursts';
  bursts.frustumCulled = false;
  bursts.renderOrder = 7;
  group.add(bursts);
  let bNext = 0, bMin = NB, bMax = -1;

  // scorch decals (glowing splash spots that cool)
  const ND = 10;
  const dGeo = new THREE.InstancedBufferGeometry();
  const dq = new THREE.PlaneGeometry(1, 1);
  dq.rotateX(-Math.PI / 2);
  dGeo.index = dq.index;
  dGeo.setAttribute('position', dq.attributes.position);
  dGeo.setAttribute('uv', dq.attributes.uv);
  const dData = new Float32Array(ND * 4).fill(0);
  for (let i = 0; i < ND; i++) dData[i * 4 + 3] = -1e4;
  const dAttr = new THREE.InstancedBufferAttribute(dData, 4);
  dAttr.setUsage(THREE.DynamicDrawUsage);
  dGeo.setAttribute('aD', dAttr);
  const dData2 = new Float32Array(ND * 2).fill(1);
  const dAttr2 = new THREE.InstancedBufferAttribute(dData2, 2);
  dAttr2.setUsage(THREE.DynamicDrawUsage);
  dGeo.setAttribute('aD2', dAttr2);
  dGeo.instanceCount = ND;
  dGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const decalMat = new THREE.ShaderMaterial({
    name: 'volc-scorch',
    uniforms: { uTime: { value: 0 }, uNoise: { value: noise }, vFogDensity: shared('vFogDensity') },
    vertexShader: /* glsl */`
      attribute vec4 aD; attribute vec2 aD2;
      uniform float uTime; uniform float vFogDensity;
      varying vec2 vUv; varying float vK; varying float vSeed;
      ${FOG_FADE}
      void main() {
        float age = uTime - aD.w;
        vK = (age >= 0.0 && age < 3.5) ? 1.0 - age / 3.5 : 0.0;
        vSeed = aD2.y;
        vUv = uv;
        vec3 p = vec3(aD.x, aD.y + 0.06, aD.z) + position * aD2.x;
        vK *= fogFade(p);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise;
      varying vec2 vUv; varying float vK; varying float vSeed;
      void main() {
        if (vK <= 0.0) discard;
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float n = texture2D(uNoise, vUv * 0.7 + vSeed).g;
        float crack = 1.0 - smoothstep(0.0, 0.08, abs(texture2D(uNoise, vUv * 1.3 + vSeed * 2.0).r - 0.5));
        float spot = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.6);
        float heat = vK * vK;
        vec3 col = vec3(1.0, 0.25, 0.04) * (spot * 0.6 + crack * spot * 1.6) * heat * 2.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const decals = new THREE.Mesh(dGeo, decalMat);
  decals.name = 'scorch-decals';
  decals.frustumCulled = false;
  decals.renderOrder = 2;
  group.add(decals);
  let dNext = 0;

  // ---------------------------------------------------------------------------------------------------------------
  // falling rocks (shake)
  const NR = 36;
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x1c1816, roughness: 0.95, metalness: 0 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, NR);
  rocks.name = 'falling-rocks';
  rocks.castShadow = true;
  rocks.frustumCulled = false;
  const rockState = Array.from({ length: NR }, () => ({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), ax: new THREE.Vector3(1, 0, 0), ang: 0, w: 0, s: 1, rest: 0, bounced: 0 }));
  const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < NR; i++) rocks.setMatrixAt(i, hideM);
  group.add(rocks);
  let rNext = 0;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

  function dust(x, y, z, k = 1) {
    const n = Math.round(2 + k * 3);
    for (let i = 0; i < n; i++) {
      puff(x + r.range(-0.6, 0.6) * k, y + 0.3, z + r.range(-0.6, 0.6) * k, {
        vx: r.range(-1, 1), vy: r.range(0.4, 1.2), vz: r.range(-1, 1), acc: -0.08, life: r.range(2.5, 4.5),
        s0: 0.8 * k, s1: r.range(2.5, 4.5) * k, col: [0.21, 0.175, 0.15], alpha: 0.34,
      });
    }
  }

  function shake(k = 1) {
    const n = Math.round(3 + k * 7);
    for (let i = 0; i < n; i++) {
      const st = rockState[rNext];
      rNext = (rNext + 1) % NR;
      const fromWall = k < 0.6 || r() < 0.65;      // a light tremor only shakes stones off the rim; the sky throws them in a real quake
      let x, z, y;
      if (fromWall) {
        const a = r() * Math.PI * 2;
        x = Math.sin(a) * FLOOR.rx * 1.08; z = FLOOR.cz + Math.cos(a) * FLOOR.rz * 1.08;
        y = gy(x, z) + r.range(4, 12);
        st.v.set(-Math.sin(a) * r.range(3, 7), r.range(0, 2), -Math.cos(a) * r.range(3, 7));
      } else {
        x = r.range(BOUNDS.minX, BOUNDS.maxX); z = r.range(BOUNDS.minZ, BOUNDS.maxZ);
        y = r.range(22, 34);
        st.v.set(r.range(-1, 1), -r.range(0, 3), r.range(-1, 1));
      }
      st.on = true; st.p.set(x, y, z); st.s = r.range(0.25, 0.75) * (0.7 + 0.3 * Math.min(k, 2));
      st.ax.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize(); st.ang = r() * 6; st.w = r.range(2, 7);
      st.rest = 0; st.bounced = 0;
      if (fromWall && r() < 0.6) {           // dust sliding off the cliff
        puff(x, y, z, { vx: st.v.x * 0.3, vy: -1.2, vz: st.v.z * 0.3, acc: 0, life: r.range(4, 6), s0: 2, s1: 7, col: [0.19, 0.16, 0.14], alpha: 0.28 });
      }
    }
    ashBoost = Math.min(2, ashBoost + 0.6 * k);
  }
  let ashBoost = 0;

  function eruption(x, y, z, k = 1) {
    const n = Math.round(50 * k * Math.min(1.5, K + 0.3));
    for (let i = 0; i < n; i++) {
      const j = bNext;
      bNext = (bNext + 1) % NB;
      const a = r() * Math.PI * 2, hs = r.range(1, 5.5) * Math.sqrt(k), vs = r.range(4, 11) * Math.sqrt(k);
      bP0.set([x + r.range(-0.4, 0.4), y + 0.2, z + r.range(-0.4, 0.4), y], j * 4);
      bV.set([Math.cos(a) * hs, vs, Math.sin(a) * hs, 0], j * 4);
      bT.set([clock, r.range(2.2, 4.5), r.range(0.06, 0.16) * (0.7 + 0.3 * k), 0], j * 4);
      bMin = Math.min(bMin, j); bMax = Math.max(bMax, j);
    }
    // smoke and a scorch spot
    for (let i = 0; i < 4 + 3 * k; i++) {
      puff(x + r.range(-1, 1), y + 0.6, z + r.range(-1, 1), {
        vx: r.range(-0.6, 0.6), vy: r.range(1.5, 3.5), vz: r.range(-0.6, 0.6), acc: -0.15, life: r.range(4, 7),
        s0: 1.2, s1: r.range(4, 7) * Math.sqrt(k), col: [0.022, 0.018, 0.016], alpha: 0.55,
      });
    }
    const d = dNext;
    dNext = (dNext + 1) % ND;
    dData.set([x, y, z, clock], d * 4);
    dData2.set([3 + 2.5 * k, r()], d * 2);
    dAttr.needsUpdate = true; dAttr2.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------------------------------
  let smokeAcc = 0, steamAcc = 0, fissAcc = 0;
  function update(time, dt, camera, s) {
    clock = time;
    ashBoost = Math.max(0, ashBoost - dt * 0.6);
    const vh = s.viewportH || 720;
    ashU.uTime.value = time; ashU.uIntensity.value = s.ash; ashU.uViewportH.value = vh; ashU.uBoost.value = ashBoost;
    ash.visible = s.ash > 0.01;
    embU.uTime.value = time; embU.uIntensity.value = s.embers * (0.6 + 0.6 * s.heat); embU.uViewportH.value = vh;
    embU.uSeam.value = s.collapse; embU.uFalls2.value = s.reveal2;
    embers.visible = s.embers > 0.01;
    rainU.uTime.value = time; rainU.uRain.value = s.rain; rainU.uViewportH.value = vh;
    rain.visible = s.rain > 0.01;
    puffU.uTime.value = time;
    burstU.uTime.value = time; burstU.uViewportH.value = vh;
    decalMat.uniforms.uTime.value = time;

    // continuous smoke (dark, over the lava) and steam (white, in the rain); more over the seams once open
    const pts = () => (s.collapse > 0.5 && r() < 0.45 && seamPts.length ? seamPts : riverPts);
    smokeAcc += dt * s.smoke * 3.2 * Math.min(1, K + 0.3);
    while (smokeAcc > 1 && riverPts.length) {
      smokeAcc -= 1;
      const p = r.pick(pts());
      puff(p[0], 0.4, p[1], { vx: 0.35 + r.range(-0.2, 0.2), vy: r.range(0.5, 1.1), vz: 0.18 + r.range(-0.2, 0.2), acc: 0.02, life: r.range(9, 14), s0: 1.5, s1: r.range(5, 9), col: [0.018, 0.016, 0.015], alpha: 0.28 });
    }
    steamAcc += dt * s.steam * 14 * Math.min(1, K + 0.3);
    while (steamAcc > 1 && riverPts.length) {
      steamAcc -= 1;
      const p = r.pick(pts());
      puff(p[0], 0.2, p[1], { vx: 0.6 + r.range(-0.3, 0.3), vy: r.range(1.0, 2.2), vz: 0.25 + r.range(-0.3, 0.3), acc: 0.05, life: r.range(6, 10), s0: 1.2, s1: r.range(4, 8), col: [0.11, 0.115, 0.12], alpha: 0.33 });
    }
    // phase two: the split mountain spits lava now and then
    if (s.reveal2 > 0.5 && s.heat > 0.5) {
      fissAcc += dt * 0.9;
      while (fissAcc > 1) {
        fissAcc -= 1;
        const x = r.range(-6, 9), z = r.range(-66, -60);
        eruption(x, gy(x, z) + r.range(2, 8), z, r.range(0.6, 1.2));
      }
    }

    // rocks
    let dirty = false;
    for (let i = 0; i < NR; i++) {
      const st = rockState[i];
      if (!st.on) continue;
      dirty = true;
      if (st.rest > 0) {
        st.rest += dt;
        const f = Math.max(0, 1 - Math.max(0, st.rest - 4) / 1.5);
        if (f <= 0) { st.on = false; rocks.setMatrixAt(i, hideM); continue; }
        _s.setScalar(st.s * f);
      } else {
        st.v.y -= 9.8 * dt;
        st.p.addScaledVector(st.v, dt);
        st.ang += st.w * dt;
        const g = gy(st.p.x, st.p.z) + st.s * 0.6;
        if (st.p.y <= g) {
          st.p.y = g;
          const inLava = lavaR(st.p.x, st.p.z) > 0.5;
          if (inLava) { eruption(st.p.x, g, st.p.z, 0.25); st.on = false; rocks.setMatrixAt(i, hideM); continue; }
          if (st.v.y < -4 && st.bounced < 2) {
            dust(st.p.x, g, st.p.z, Math.min(1.5, st.s * 2));
            st.v.set(st.v.x * 0.5, -st.v.y * 0.28, st.v.z * 0.5);
            st.bounced++;
            st.w *= 0.5;
          } else { st.rest = 1e-3; st.v.set(0, 0, 0); }
        }
        _s.setScalar(st.s);
      }
      _q.setFromAxisAngle(st.ax, st.ang);
      _m.compose(st.p, _q, _s);
      rocks.setMatrixAt(i, _m);
    }
    if (dirty) rocks.instanceMatrix.needsUpdate = true;

    // upload the slots written this frame
    if (pMax >= 0) {
      for (const a of [aP0, aVel, aT, aCol]) { a.clearUpdateRanges(); a.addUpdateRange(pMin * 4, (pMax - pMin + 1) * 4); a.needsUpdate = true; }
      pMin = NP; pMax = -1;
    }
    if (bMax >= 0) {
      for (const a of [abP0, abV, abT]) { a.clearUpdateRanges(); a.addUpdateRange(bMin * 4, (bMax - bMin + 1) * 4); a.needsUpdate = true; }
      bMin = NB; bMax = -1;
    }
    void camera;
  }

  function dispose() {
    for (const o of [ash, embers, rain, puffs, bursts, decals, rocks]) { o.geometry.dispose(); o.material.dispose(); }
    quad.dispose(); pq.dispose(); dq.dispose();
  }

  return { group, update, eruption, shake, dust, puff, dispose, riverPts, seamPts };
}
