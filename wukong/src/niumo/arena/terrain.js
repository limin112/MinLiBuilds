// The caldera: one heightfield mesh (denser in the middle) with a single material that draws
//  - grey ash over the floor with plates of black crust, split by a network of thin glowing cracks,
//  - basalt cliffs with ash on the ledges,
//  - the lava itself where the mask says so: black crust plates drifting with the flow (two-phase flow map),
//    glowing only in the cracks and along the flowing edges, a cold walkable crust band at the banks,
//  - the phase-two collapse (seams sink and fill with fresh lava; the vertex shader lowers them),
//  - the split mountain behind the giant, and the rain (wet, darker, puddles with ripples).
// The lava falls down the scarp behind the altar are separate ribbons (createLavaFalls).
import * as THREE from 'three';
import { GLSL_VOLC_PARS, GLSL_VOLC_VERT_PARS, GLSL_VOLC_VERT, VOLCANO } from './shared.js';
import { SEAM_Y, LAVA_Y, MASK, FALLS, ALTAR } from './layout.js';
import { vnoise, rng } from './noise.js';

export function buildTerrainGeometry(ground) {
  const { n, xs, zs, h, sink } = ground;
  const pos = new Float32Array(n * n * 3), nrm = new Float32Array(n * n * 3), nrm2 = new Float32Array(n * n * 3);
  const aSink = new Float32Array(n * n);
  const Y = (i, j, c) => {
    const k = j * n + i;
    return c ? h[k] + (SEAM_Y - h[k]) * sink[k] : h[k];
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = xs[i]; pos[k * 3 + 1] = h[k]; pos[k * 3 + 2] = zs[j];
      aSink[k] = sink[k];
      for (const [arr, c] of [[nrm, false], [nrm2, true]]) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
        const dx = (Y(i1, j, c) - Y(i0, j, c)) / (xs[i1] - xs[i0]);
        const dz = (Y(i, j1, c) - Y(i, j0, c)) / (zs[j1] - zs[j0]);
        const l = Math.hypot(dx, 1, dz);
        arr[k * 3] = -dx / l; arr[k * 3 + 1] = 1 / l; arr[k * 3 + 2] = -dz / l;
      }
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = j * n + i + 1, c = (j + 1) * n + i, d = (j + 1) * n + i + 1;
      // (i,j)-(i,j+1)-(i+1,j) and (i+1,j)-(i,j+1)-(i+1,j+1): matches layout.buildGround().heightAt
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('normal2', new THREE.BufferAttribute(nrm2, 3));
  geo.setAttribute('aSink', new THREE.BufferAttribute(aSink, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

const TERRAIN_PARS = /* glsl */`
uniform sampler2D tMask; uniform sampler2D tCrack; uniform sampler2D tRock; uniform sampler2D tAsh;
uniform sampler2D tCrust; uniform float uHasCrust;
uniform float uCollapse; uniform float uHeat; uniform float uSeamHeat; uniform float uSeamPre; uniform float uVeins;
uniform vec3 uLavaCol; uniform vec3 uLavaHot; uniform float uRain; uniform float uFlow;
float tLava = 0.0; float tLavaVis = 0.0; vec3 tEmit = vec3(0.0); vec2 tDH = vec2(0.0); float tRough = 0.9;
float tLum = 0.3; float tPuddle = 0.0;
vec3 tTri(sampler2D t, vec3 p, vec3 bl) {
  return texture2D(t, p.zy + vec2(0.31, 0.0)).rgb * bl.x + texture2D(t, p.xz + vec2(0.0, 0.17)).rgb * bl.y + texture2D(t, p.xy).rgb * bl.z;
}
`;

const TERRAIN_MAP = /* glsl */`
{
  vec3 P = vVolcP;
  vec3 nW = normalize(vVolcN);
  vec2 muv = (P.xz - vMaskRect.xy) * vMaskRect.zw;
  float inM = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  vec4 M = texture2D(tMask, clamp(muv, 0.0, 1.0)) * vec4(inM, inM, 1.0, 1.0);
  vGl = volcGlowAt(P.xz);
  float foot = max(length(dFdx(P)), length(dFdy(P)));
  float detail = smoothstep(0.08, 0.02, foot);       // fade derivative bump with distance
  float n1 = texture2D(vNoise, P.xz * 0.031).r, n2 = texture2D(vNoise, P.xz * 0.11 + 0.3).g, n3 = texture2D(vNoise, P.xz * 0.006).a;

  // ---- ground: ash floor with crust plates, basalt on the slopes ----
  vec3 bl = pow(abs(nW), vec3(4.0)); bl /= (bl.x + bl.y + bl.z + 1e-5);
  vec3 rock = tTri(tRock, P * 0.2, bl);
  vec3 ash = texture2D(tAsh, P.xz * 0.24).rgb;
  vec4 cv = texture2D(tCrack, P.xz * 0.085 + vec2(0.5, 0.21) + (vec2(n1, n2) - 0.5) * 0.06);   // floor crack network
  float slope = nW.y;
  // bare black crust in irregular patches (edges follow the crack network), ash everywhere else
  float patchN = n1 * 0.62 + texture2D(vNoise, P.xz * 0.072 + 0.17).b * 0.38;
  float plate = smoothstep(0.45, 0.53, patchN + (cv.g - 0.5) * 0.08);
  float ashT = smoothstep(0.78, 0.93, slope + (n2 - 0.5) * 0.25);     // ash lies on flat ground / ledges
  float heat = smoothstep(0.2, 0.75, vGl.r + vGl.g * uCollapse);
  ashT *= 1.0 - plate * 0.8;
  ashT *= 1.0 - heat * 0.85;                                          // blown / melted away near the lava
  ashT *= 1.0 - vWet * 0.35;
  vec3 crustFloor = rock * vec3(0.55, 0.52, 0.5);
  vec3 g = mix(rock * 0.8, ash * 0.62, ashT);
  g = mix(g, crustFloor, plate * smoothstep(0.85, 0.95, slope) * (1.0 - heat));
  g *= mix(0.78, 1.12, n3);                                             // large-scale tone drift
  g *= 1.0 - heat * 0.35;                                               // scorched near the lava
  // cliffs: darker with height (smoke staining), vertical streaks
  float cliff = 1.0 - smoothstep(0.55, 0.8, slope);
  float streak = texture2D(vNoise, vec2((P.x + P.z) * 0.07, P.y * 0.01)).b;
  g *= mix(1.0, 0.65 + 0.5 * streak, cliff * 0.7);
  g *= mix(1.0, 0.7, smoothstep(6.0, 30.0, P.y));
  tLum = dot(g, vec3(0.299, 0.587, 0.114));
  float hgt = tLum * 1.4;
  tRough = mix(0.88, 0.97, ashT);

  // ---- glowing crack network in the floor (decoration: thin, does not burn) ----
  {
    // cracks glow in the crust patches, near the lava and around the giant; the ash only shows a faint few
    float region = plate * (0.6 + 0.4 * smoothstep(0.35, 0.65, n3)) + heat * 0.7 + 0.22;
    // the ground around the seated giant breathes with his heat
    float dS = length((P.xz - vec2(${ALTAR.x.toFixed(1)}, ${ALTAR.z.toFixed(1)})) * vec2(0.8, 1.0));
    region += smoothstep(34.0, 10.0, dS) * 0.6;
    float pre = smoothstep(0.35, 0.95, M.g) * uSeamPre;                 // the floor cracks before it gives way
    region = clamp(region + pre * 1.5, 0.0, 1.8) * smoothstep(0.8, 0.95, slope) * (1.0 - smoothstep(0.2, 0.45, max(M.r, M.g * uCollapse)));
    float w = 0.018 + 0.035 * pre + 0.01 * region;                      // half-cell units (0.84 m): 1.5 .. 5 cm
    float aa = smoothstep(0.5, 2.5, foot / (w * 0.84));
    float vein = mix(1.0 - smoothstep(w * 0.3, w, cv.r), 1.6 * w, aa);
    float br = 0.5 + 0.5 * sin(vTime * 0.6 + cv.g * 37.0 + n2 * 6.0);
    float along = smoothstep(0.35, 0.7, texture2D(vNoise, P.xz * 0.21 + cv.g * 0.5).r);   // broken, not continuous
    float vv = vein * clamp(region, 0.0, 1.5) * along * (0.5 + 0.5 * br);
    tEmit += mix(uLavaCol, uLavaHot, 0.15 + 0.4 * pre) * vv * (uVeins + pre * 2.5);
    // dark grooves along the network (crust patches), fine cracks on the bare crust
    float groove = (1.0 - smoothstep(0.0, w * 2.5, cv.r)) * (1.0 - aa) * (0.25 + 0.75 * plate);
    float fineG = (1.0 - smoothstep(0.0, 0.05, cv.b)) * plate * (1.0 - smoothstep(0.02, 0.06, foot));
    g *= 1.0 - groove * 0.4 - fineG * 0.35;
    hgt -= groove * 0.6 + fineG * 0.4;
  }

  // ---- lava ----
  float lavaG = M.g * uCollapse;
  tLava = max(M.r, lavaG);
  if (tLava > 0.18) {
    float seam = step(M.r, lavaG);
    vec2 fl = (M.ba * 2.0 - 1.0);
    float ph = vTime / 7.0 + n2 * 0.8;
    float t0 = fract(ph), t1 = fract(ph + 0.5);
    float wA = 1.0 - abs(2.0 * t0 - 1.0), wB = 1.0 - wA;
    vec2 base = P.xz / 17.0;
    vec2 adv = fl * uFlow * 7.0 / 17.0;
    vec4 cA = texture2D(tCrack, base - adv * (t0 - 0.5));
    vec4 cB = texture2D(tCrack, base - adv * (t1 - 0.5) + vec2(0.37, 0.61));
    float hot = mix(uHeat, uSeamHeat, seam);
    float T = hot * (0.55 + 0.45 * smoothstep(0.55, 1.0, tLava));
    // slow breathing of the heat across the surface
    float breath = 0.6 + 0.4 * sin(vTime * 0.45 + n1 * 9.0 + P.x * 0.07 - P.z * 0.05);
    float wc = 0.026 + 0.058 * T * breath;
    // thin lines fade to their average coverage once a pixel is wider than the crack (no aliasing, no vanishing)
    float aa = smoothstep(0.5, 2.5, foot / (wc * 1.21));
    float crA = 1.0 - smoothstep(wc * 0.3, wc, cA.r), crB = 1.0 - smoothstep(wc * 0.3, wc, cB.r);
    float coreA = 1.0 - smoothstep(0.0, wc * 0.45, cA.r), coreB = 1.0 - smoothstep(0.0, wc * 0.45, cB.r);
    float smA = 1.0 - smoothstep(0.0, 0.07, cA.b), smB = 1.0 - smoothstep(0.0, 0.07, cB.b);
    float crack = mix(crA * wA + crB * wB, 1.6 * wc, aa);
    float core = mix(coreA * wA + coreB * wB, 0.7 * wc, aa);
    float fine = mix(smA * wA + smB * wB, 0.12, smoothstep(0.02, 0.08, foot)) * smoothstep(0.4, 0.9, T);
    float vis = smoothstep(0.44, 0.56, tLava + (cA.a - 0.5) * 0.08);   // hot lava (burns)
    float band = smoothstep(0.2, 0.3, tLava) * (1.0 - vis);              // cold crust at the banks (walkable)
    float edge = smoothstep(0.44, 0.52, tLava) * (1.0 - smoothstep(0.52, 0.8, tLava));
    edge *= 0.45 + 0.55 * smoothstep(0.3, 0.7, texture2D(vNoise, P.xz * 0.27 + fl * vTime * 0.04).r);
    tLavaVis = vis;
    // crust colour: black, plate to plate variation, a dusting of ash on cold plates
    float pid = cA.g * wA + cB.g * wB;
    vec3 crust = vec3(0.03, 0.026, 0.024) * (0.75 + 0.5 * pid);
    float plateH = mix(smoothstep(0.0, 0.3, cA.r), smoothstep(0.0, 0.3, cB.r), wB);
    #ifdef HAS_CRUST_MAP
      // the artist's crust: dark ropy plates; its own thin orange cracks become fine emissive cracks
      vec2 cu = P.xz / 6.5;
      vec2 cadv = fl * uFlow * 7.0 / 6.5;
      vec3 ca = texture2D(tCrust, cu - cadv * (t0 - 0.5)).rgb * wA + texture2D(tCrust, cu - cadv * (t1 - 0.5) + vec2(0.37, 0.61)).rgb * wB;
      float red = smoothstep(0.03, 0.16, ca.r - ca.b);
      crust = mix(crust, ca * (1.0 - red * 0.85) * vec3(0.95, 0.92, 0.9), 0.8);
      fine = max(fine * 0.6, mix(red, 0.08, smoothstep(0.01, 0.05, foot)) * smoothstep(0.25, 0.8, T));
      plateH = mix(plateH, dot(ca, vec3(0.33)) * 4.0, 0.5);
    #endif
    crust = mix(crust, vAshCol * 0.55, (1.0 - T) * 0.35 * plateH * (0.5 + 0.5 * n2));
    float lavaAmt = max(vis, band);
    g = mix(g, crust, lavaAmt);
    tRough = mix(tRough, 0.78 + 0.12 * plateH, lavaAmt);
    hgt = mix(hgt, plateH * 1.5 + cA.a * 0.4, lavaAmt);
    vec3 lc = mix(uLavaCol, uLavaHot, clamp(core * T * 1.2, 0.0, 1.0));
    float glowA = (crack * (0.55 + 0.75 * core) + fine * 0.45) * vis * T;
    glowA += edge * T * 1.1;
    glowA += vis * T * 0.05 * (1.0 - smoothstep(0.0, 0.25, mix(cA.r, cB.r, wB)));   // heat bleeding into the crust
    tEmit += lc * glowA * 2.2;
  }

  // ---- the mountain splits behind him (phase two; a faint hint before) ----
  if (vFissure > 0.001 && P.z < -54.0) {
    vec4 cf = texture2D(tCrack, vec2(P.x / 13.0, P.y / 9.0) + vec2(0.13, 0.41));
    float zone = exp(-pow((P.x - 1.4) / 10.0, 2.0)) * smoothstep(-55.5, -59.0, P.z) * (1.0 - smoothstep(14.0, 24.0, P.y));
    float fw = 0.04 + 0.12 * zone * vFissure;
    float fis = (1.0 - smoothstep(fw * 0.3, fw, cf.r)) * zone;
    tEmit += mix(uLavaCol, uLavaHot, 0.6) * fis * vFissure * 4.0;
    g *= 1.0 - fis * 0.5;
  }

  // ---- rain: darker, glossy, puddles in the flat low spots ----
  vWetF = vWet * (0.45 + 0.55 * smoothstep(0.3, 0.95, slope));
  tPuddle = vWet * smoothstep(0.62, 0.72, n1 * 0.7 + (1.0 - n2) * 0.45) * smoothstep(0.93, 0.98, slope) * (1.0 - tLavaVis);
  g *= mix(1.0, 0.45, vWetF);
  g *= 1.0 - tPuddle * 0.35;
  tRough = mix(tRough, mix(0.6, 0.25, smoothstep(0.75, 0.95, slope)), vWetF * 0.85);   // wet cliffs stay matte: no icy sheets
  tRough = mix(tRough, 0.04, tPuddle);
  hgt *= 1.0 - tPuddle;
  tDH = vec2(dFdx(hgt), dFdy(hgt)) * 0.9 * detail;
  // rain rings on the puddles / wet ground
  if (uRain > 0.01) {
    vec2 q = P.xz * 1.3;
    vec2 rr = vec2(texture2D(vNoise, q * 0.5 + vec2(0.0, vTime * 1.7)).r, texture2D(vNoise, q * 0.5 + vec2(vTime * 1.3, 0.37)).g) - 0.5;
    tDH += rr * 0.06 * uRain * (0.3 + tPuddle) * detail;
  }
  diffuseColor.rgb *= g;
}
`;

export function createTerrain({ ground, maskTex, crackTex, rockTex, ashTex, crustTex = null, quality = 'high' }) {
  const geo = buildTerrainGeometry(ground);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.3 });
  mat.name = 'volc-terrain';
  const uniforms = {
    tMask: { value: maskTex }, tCrack: { value: crackTex }, tRock: { value: rockTex }, tAsh: { value: ashTex },
    tCrust: { value: crustTex }, uHasCrust: { value: crustTex ? 1 : 0 },
    uCollapse: { value: 0 }, uHeat: { value: 0.8 }, uSeamHeat: { value: 1.2 }, uSeamPre: { value: 0 }, uVeins: { value: 0.6 },
    uLavaCol: { value: new THREE.Color(0.85, 0.11, 0.015) }, uLavaHot: { value: new THREE.Color(1.0, 0.38, 0.06) },
    uRain: { value: 0 }, uFlow: { value: 0.35 },
  };
  if (crustTex) mat.defines = { HAS_CRUST_MAP: '' };
  mat.onBeforeCompile = (shader) => {
    for (const [k, v] of Object.entries(VOLCANO)) shader.uniforms[k] = v;
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_VOLC_VERT_PARS + 'attribute float aSink; attribute vec3 normal2; uniform float uCollapse;\n')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(mix(normal, normal2, uCollapse * aSink));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif')
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);\ntransformed.y = mix(transformed.y, ${SEAM_Y.toFixed(3)}, uCollapse * aSink);`)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + GLSL_VOLC_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_VOLC_PARS + TERRAIN_PARS)
      .replace('#include <map_fragment>', TERRAIN_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = volcPerturb(-vViewPosition, normal, tDH, faceDirection);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEmit;')
      .replace('#include <aomap_fragment>', /* glsl */`
        {
          vec3 wN = inverseTransformDirection(normal, viewMatrix);
          reflectedLight.indirectDiffuse += volcanoUnderlight(vVolcP, wN, vGl) * BRDF_Lambert(material.diffuseColor) * (1.0 - tLavaVis * 0.7);
        }
        #include <aomap_fragment>`)
      .replace('#include <fog_fragment>', '#ifdef USE_FOG\ngl_FragColor.rgb = volcanoFog(gl_FragColor.rgb, vVolcP);\n#endif');
  };
  mat.customProgramCacheKey = () => 'volc-terrain-v1' + (crustTex ? '-c' : '');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'volcano-terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  void quality;
  return { mesh, uniforms, material: mat, geometry: geo };
}

// --------------------------------------------------------------------------------------------------------------
// Lava falls: ribbons hugging the scarp behind the moat. Phase-two falls are revealed from the top.

export function createLavaFalls({ ground, noise }) {
  const group = new THREE.Group();
  group.name = 'lava-falls';
  const falls = [];
  const fallMat = (phase2) => new THREE.ShaderMaterial({
    name: 'lava-fall',
    uniforms: {
      uTime: { value: 0 }, uHeat: { value: 1 }, uReveal: { value: phase2 ? 0 : 1 }, uLen: { value: 1 }, uNoise: { value: noise },
      uLavaCol: { value: new THREE.Color(0.85, 0.11, 0.015) }, uLavaHot: { value: new THREE.Color(1.0, 0.42, 0.08) },
      ...Object.fromEntries(['vFogCol', 'vFogDensity', 'vFogFall', 'vFogGlowCol', 'vSunDir', 'vSunCol', 'vGlowMap', 'vMaskRect', 'vSeamGlow', 'vFissure', 'vTime', 'vNoise'].map((k) => [k, VOLCANO[k]])),
      ...Object.fromEntries(['vGlowCol', 'vFallCol', 'vWet', 'vAshCol'].map((k) => [k, VOLCANO[k]])),
    },
    vertexShader: /* glsl */`
      varying vec2 vUv2; varying vec3 vVolcP; varying vec3 vVolcN;
      void main() {
        vUv2 = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vVolcP = w.xyz; vVolcN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_VOLC_PARS}
      varying vec2 vUv2;
      uniform float uTime; uniform float uHeat; uniform float uReveal; uniform float uLen; uniform sampler2D uNoise;
      uniform vec3 uLavaCol; uniform vec3 uLavaHot;
      void main() {
        float u = vUv2.x, v = vUv2.y;                 // v: metres from the top of the fall
        if (v > uReveal * uLen) discard;
        float across = 1.0 - abs(u * 2.0 - 1.0);
        float s1 = texture2D(uNoise, vec2(u * 0.35, v * 0.05 - uTime * 0.21)).r;
        float s2 = texture2D(uNoise, vec2(u * 0.9 + 0.3, v * 0.11 - uTime * 0.37)).g;
        float s3 = texture2D(uNoise, vec2(u * 2.1 + 0.7, v * 0.3 - uTime * 0.6)).b;
        float body = smoothstep(0.0, 0.35, across + (s1 - 0.5) * 0.5);
        if (body < 0.02) discard;
        // black crust skins tear and stream down; the molten streaks between them glow
        float crust = smoothstep(0.42, 0.62, s2 * 0.7 + s3 * 0.4);
        float streak = smoothstep(0.35, 0.75, s1) * (1.0 - crust);
        float T = uHeat * (0.5 + 0.5 * across);
        vec3 col = vec3(0.03, 0.025, 0.022) * crust;
        col += mix(uLavaCol, uLavaHot, streak * T) * (streak * 1.6 + (1.0 - crust) * 0.35) * T * 2.0;
        col *= smoothstep(0.0, 0.25, body);
        gl_FragColor = vec4(col, 1.0);
        gl_FragColor.rgb = volcanoFog(gl_FragColor.rgb, vVolcP);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  for (const f of FALLS) {
    const r = rng(f.seed * 13 + 1);
    // path: from the scarp's top down to the moat, sampled along z; x wanders a little
    const pts = [];
    for (let z = -67.5; z <= -53.6; z += 0.35) {
      const x = f.x + (vnoise(z * 0.18, f.seed, 3) - 0.5) * 1.6;
      const y = ground.heightAt(x, z);
      pts.push(new THREE.Vector3(x, y, z));
    }
    // keep the part that is on the slope (and a short run-out into the moat)
    const top = pts.findIndex((p, i) => i > 0 && p.y < pts[0].y - 0.3) - 1;
    const path = pts.slice(Math.max(0, top));
    const pos = [], uv = [], nrm = [], idx = [];
    let len = 0;
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const prev = path[Math.max(0, i - 1)], next = path[Math.min(path.length - 1, i + 1)];
      const t = next.clone().sub(prev).normalize();
      const side = new THREE.Vector3(1, 0, 0);
      const nn = side.clone().cross(t).normalize();          // outward from the slope
      if (nn.z < 0) nn.negate();
      if (i > 0) len += p.distanceTo(path[i - 1]);
      const w = f.width * (0.8 + 0.4 * r()) * (1 + 0.6 * Math.min(1, i / path.length) ** 2);
      for (const s of [-1, 1]) {
        const q = p.clone().addScaledVector(side, s * w * 0.5).addScaledVector(nn, 0.18 + 0.12 * Math.sin(i * 0.7));
        pos.push(q.x, q.y, q.z);
        nrm.push(nn.x, nn.y, nn.z);
        uv.push(s < 0 ? 0 : 1, len);
      }
      if (i > 0) {
        const a = (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = fallMat(f.phase2);
    mat.uniforms.uLen.value = len;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'lava-fall';
    mesh.visible = !f.phase2;
    group.add(mesh);
    falls.push({ mesh, mat, phase2: f.phase2, len, bottom: path[path.length - 1].clone(), top: path[0].clone(), x: f.x, width: f.width });
  }
  return {
    group, falls,
    update(time, { heat = 1, reveal2 = 0 }) {
      for (const f of falls) {
        f.mat.uniforms.uTime.value = time;
        f.mat.uniforms.uHeat.value = heat * (f.phase2 ? 1.25 : 1);
        if (f.phase2) {
          f.mat.uniforms.uReveal.value = reveal2;
          f.mesh.visible = reveal2 > 0.001;
        }
      }
    },
  };
}

void LAVA_Y; void MASK;
