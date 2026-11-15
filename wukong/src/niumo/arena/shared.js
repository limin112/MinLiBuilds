// Shared shading for everything the volcano arena owns:
//  - warm underlight from the lava, read from a blurred top-down glow map (direction from its gradient), so the
//    rivers light the banks, pillars and steles beside them without dozens of point lights;
//  - height fog (dense smoke near the floor, thinner up the walls) that glows over the lava and towards the
//    eruption behind the giant;
//  - ash settling on upward faces, wetness for the closing rain;
//  - a triplanar rock material (basalt / weathered stone) and a patcher for plain PBR props (iron, bone, bronze).
import * as THREE from 'three';
import { MASK, LAVA_Y } from './layout.js';

/** Uniform objects shared by every arena material (updated once per frame by arena.js). */
export const VOLCANO = {
  vGlowMap: { value: null },
  vMaskRect: { value: new THREE.Vector4(MASK.x0, MASK.z0, 1 / MASK.size, 1 / MASK.size) },
  vGlowCol: { value: new THREE.Color(0, 0, 0) },      // river / moat light
  vSeamGlow: { value: 0 },                             // collapse amount (phase-two seams light up)
  vFallCol: { value: new THREE.Color(0, 0, 0) },      // lava falls (tall sources)
  vFissure: { value: 0 },                              // the split mountain (phase two)
  vFogCol: { value: new THREE.Color(0.02, 0.01, 0.008) },
  vFogDensity: { value: 0.012 },
  vFogFall: { value: 0.05 },
  vFogGlowCol: { value: new THREE.Color(0, 0, 0) },
  vSunDir: { value: new THREE.Vector3(0.2, 0.15, -1).normalize() },
  vSunCol: { value: new THREE.Color(0, 0, 0) },
  vWet: { value: 0 },
  vTime: { value: 0 },
  vNoise: { value: null },
  vAshCol: { value: new THREE.Color(0.13, 0.124, 0.118) },   // dark, dirty ash: must not read as pale paper under the sky light
  vMask: { value: null },                              // lava mask (G = phase-two seams / lake)
  vCollapse: { value: 0 },
};

// Props standing where the floor gives way slide under the lava with it (per instance, or per vertex).
export const GLSL_SINK_PARS = /* glsl */`
uniform sampler2D vMask; uniform float vCollapse; uniform vec4 vMaskRect;
`;
export function glslSink(depth = 2.2, perVertex = false) {
  return /* glsl */`
  {
    mat4 sm = modelMatrix;
    #ifdef USE_INSTANCING
      sm = modelMatrix * instanceMatrix;
    #endif
    vec3 so = (sm * vec4(${perVertex ? 'transformed' : 'vec3(0.0)'}, 1.0)).xyz;
    float sg = textureLod(vMask, (so.xz - vMaskRect.xy) * vMaskRect.zw, 0.0).g;
    float sd = vCollapse * smoothstep(0.3, 0.75, sg) * ${depth.toFixed(2)};
    if (sd > 0.0) transformed += inverse(mat3(sm)) * vec3(0.0, -sd, 0.0);
  }`;
}

/** Depth material for shadows of sinking props (so their shadows go under with them). */
export function sinkDepthMaterial(depth = 2.2, perVertex = false) {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.vMask = VOLCANO.vMask;
    shader.uniforms.vCollapse = VOLCANO.vCollapse;
    shader.uniforms.vMaskRect = VOLCANO.vMaskRect;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_SINK_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + glslSink(depth, perVertex));
  };
  m.customProgramCacheKey = () => 'volc-sink-depth-' + depth + (perVertex ? 'v' : 'o');
  return m;
}

export const GLSL_VOLC_PARS = /* glsl */`
uniform sampler2D vGlowMap; uniform vec4 vMaskRect;
uniform vec3 vGlowCol; uniform float vSeamGlow; uniform vec3 vFallCol; uniform float vFissure;
uniform vec3 vFogCol; uniform float vFogDensity; uniform float vFogFall; uniform vec3 vFogGlowCol;
uniform vec3 vSunDir; uniform vec3 vSunCol; uniform float vWet; uniform float vTime; uniform sampler2D vNoise;
uniform vec3 vAshCol;
varying vec3 vVolcP;
varying vec3 vVolcN;
vec4 vGl = vec4(0.0);
float vWetF = 0.0;
vec4 volcGlowAt(vec2 xz) { return texture2D(vGlowMap, (xz - vMaskRect.xy) * vMaskRect.zw); }
// irradiance from the lava at p (world) for a surface with world normal n
vec3 volcanoUnderlight(vec3 p, vec3 n, vec4 g) {
  const float e = 1.5;
  vec4 gx = volcGlowAt(p.xz + vec2(e, 0.0)), gz = volcGlowAt(p.xz + vec2(0.0, e));
  float low = g.r + g.g * vSeamGlow;
  vec2 gradL = vec2(gx.r - g.r + (gx.g - g.g) * vSeamGlow, gz.r - g.r + (gz.g - g.g) * vSeamGlow);
  vec2 gradT = vec2(gx.b - g.b + (gx.a - g.a) * vFissure, gz.b - g.b + (gz.a - g.a) * vFissure);
  vec3 dl = normalize(vec3(gradL.x * 9.0, -0.45, gradL.y * 9.0));
  vec3 dt = normalize(vec3(gradT.x * 9.0, -0.05, gradT.y * 9.0) + vec3(0.0, 0.0, -0.3));
  float hl = max(p.y - ${LAVA_Y.toFixed(2)}, 0.0);
  float fall = 1.0 / (1.0 + hl * hl * 0.035);
  vec3 E = vGlowCol * low * fall * (0.22 + 0.78 * max(dot(n, -dl), 0.0));
  E += (vFallCol * g.b + vFallCol * 2.5 * g.a * vFissure) * (0.2 + 0.8 * max(dot(n, -dt), 0.0));
  return E;
}
vec3 volcanoFog(vec3 col, vec3 p) {
  vec3 c = cameraPosition;
  vec3 d = p - c;
  float L = length(d);
  float k = vFogFall;
  float y0 = max(c.y, -1.0), y1 = max(p.y, -1.0);
  float dy = y1 - y0;
  float avg = abs(dy) > 0.05 ? (exp(-k * y0) - exp(-k * y1)) / (k * dy) : exp(-k * y0);
  // smoke drifting through: thicker and thinner patches along the far half of the ray
  vec2 sp = mix(c.xz, p.xz, 0.7) * 0.012 + vec2(vTime * 0.004, vTime * 0.0025);
  float smoke = texture2D(vNoise, sp).r * 0.7 + texture2D(vNoise, sp * 2.3 + 0.37).g * 0.3;
  float od = vFogDensity * L * avg * (0.55 + 0.9 * smoke);
  float f = 1.0 - exp(-od);
  vec4 g = volcGlowAt(mix(c.xz, p.xz, 0.6));
  vec3 fc = vFogCol + vFogGlowCol * ((g.r + g.g * vSeamGlow) * exp(-max(y1, 0.0) * 0.03) + (g.b + g.a * vFissure * 2.0) * 0.7);
  float mu = max(dot(d / max(L, 1e-3), vSunDir), 0.0);
  fc += vSunCol * (pow(mu, 10.0) * 0.7 + mu * mu * 0.18);
  return mix(col, fc, f);
}
// screen-space bump: perturb the (view space) normal by a height gradient (no tangents needed)
vec3 volcPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

export const GLSL_VOLC_VERT_PARS = /* glsl */`
varying vec3 vVolcP;
varying vec3 vVolcN;
`;
export const GLSL_VOLC_VERT = /* glsl */`
{
  vec4 vw = vec4(transformed, 1.0);
  vec3 vn = objectNormal;
  #ifdef USE_INSTANCING
    vw = instanceMatrix * vw;
    vn = mat3(instanceMatrix) * vn;
  #endif
  vw = modelMatrix * vw;
  vVolcP = vw.xyz;
  vVolcN = normalize(mat3(modelMatrix) * vn);
}
`;

const UNDERLIGHT_APPLY = /* glsl */`
{
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  reflectedLight.indirectDiffuse += volcanoUnderlight(vVolcP, wN, vGl) * BRDF_Lambert(material.diffuseColor);
}
#include <aomap_fragment>
`;
const FOG_APPLY = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = volcanoFog(gl_FragColor.rgb, vVolcP);
#endif
`;

function bindShared(shader) {
  for (const [k, v] of Object.entries(VOLCANO)) shader.uniforms[k] = v;
}

function chain(mat, key, fn) {
  const prev = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : null;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    fn(shader);
  };
  mat.customProgramCacheKey = () => key;
}

/**
 * Plain PBR props (iron, bone, bronze, cloth): world varyings, ash dusting on top, wetness, lava underlight, fog.
 * ash: 0..1 coverage of upward faces; wet: how much the rain darkens / glosses it.
 */
export function patchVolcanoMaterial(mat, { ash = 0.4, wet = 1, key = 'volc-prop', sink = 0, sinkPerVertex = false } = {}) {
  const u = { pAsh: { value: ash }, pWet: { value: wet } };
  mat.userData.volc = u;
  chain(mat, key + '-v3' + (sink ? '-s' + sink + (sinkPerVertex ? 'v' : '') : ''), (shader) => {
    bindShared(shader);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_VOLC_VERT_PARS + (sink ? GLSL_SINK_PARS : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (sink ? glslSink(sink, sinkPerVertex) : ''))
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + GLSL_VOLC_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_VOLC_PARS + 'uniform float pAsh; uniform float pWet;\n')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        {
          vec3 n = normalize(vVolcN);
          vGl = volcGlowAt(vVolcP.xz);
          float an = texture2D(vNoise, vVolcP.xz * 0.37 + vVolcP.y * 0.11).g;
          float af = smoothstep(0.45, 0.9, n.y + (an - 0.5) * 0.6) * pAsh * (1.0 - smoothstep(0.3, 0.8, vGl.r) * 0.7) * (1.0 - vWet * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, vAshCol * (0.8 + 0.4 * an), af);
          vWetF = vWet * pWet * (0.55 + 0.45 * smoothstep(-0.2, 0.8, n.y));
          diffuseColor.rgb *= mix(1.0, 0.5, vWetF);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.22, vWetF * 0.85);')
      .replace('#include <aomap_fragment>', UNDERLIGHT_APPLY)
      .replace('#include <fog_fragment>', FOG_APPLY);
  });
  return mat;
}

/**
 * Triplanar rock / worked stone in world space. Options:
 *  map, scale (uv per metre), tint, roughness, bump, ash (top coverage), scorch (darkening near lava),
 *  carve: { map, strength } uv-mapped carving (runes / frieze) in the geometry's uv, R channel = depth
 */
export function createRockMaterial({
  map, scale = 0.25, tint = [1, 1, 1], roughness = 0.92, roughVar = 0.5, bump = 1.2, ash = 0.6, scorch = 0.6,
  macro = 0.25, carve = null, color = 0xffffff, name = 'volc-rock', side = THREE.FrontSide, envMapIntensity = 0.35,
  sink = 0, sinkPerVertex = false,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side, envMapIntensity });
  mat.name = name;
  const u = {
    rkMap: { value: map }, rkScale: { value: scale }, rkTint: { value: new THREE.Vector3(...tint) },
    rkBump: { value: bump }, rkAsh: { value: ash }, rkScorch: { value: scorch }, rkMacro: { value: macro },
    rkRoughVar: { value: roughVar },
    rkCarve: { value: carve ? carve.map : null }, rkCarveK: { value: carve ? carve.strength : 0 },
  };
  mat.userData.rock = u;
  const useCarve = !!carve;
  if (useCarve && !mat.defines) mat.defines = {};
  if (useCarve) { mat.defines.ROCK_CARVE = ''; mat.defines.USE_UV = ''; }
  chain(mat, `${name}-rock-v4${useCarve ? '-c' : ''}${sink ? '-s' + sink + (sinkPerVertex ? 'v' : '') : ''}`, (shader) => {
    bindShared(shader);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_VOLC_VERT_PARS + (sink ? GLSL_SINK_PARS : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (sink ? glslSink(sink, sinkPerVertex) : ''))
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + GLSL_VOLC_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_VOLC_PARS + /* glsl */`
        uniform sampler2D rkMap; uniform float rkScale; uniform vec3 rkTint; uniform float rkBump; uniform float rkAsh;
        uniform float rkScorch; uniform float rkMacro; uniform float rkRoughVar;
        uniform sampler2D rkCarve; uniform float rkCarveK;
        float rkLum = 0.5; vec2 rkDH = vec2(0.0);
      `)
      .replace('#include <map_fragment>', /* glsl */`
        {
          vec3 nW = normalize(vVolcN);
          vec3 bl = pow(abs(nW), vec3(4.0));
          bl /= (bl.x + bl.y + bl.z + 1e-5);
          vec3 tp = vVolcP * rkScale;
          vec3 c = texture2D(rkMap, tp.zy + vec2(0.31, 0.0)).rgb * bl.x
                 + texture2D(rkMap, tp.xz + vec2(0.0, 0.17)).rgb * bl.y
                 + texture2D(rkMap, tp.xy).rgb * bl.z;
          rkLum = dot(c, vec3(0.299, 0.587, 0.114));
          float foot = max(length(dFdx(vVolcP)), length(dFdy(vVolcP)));
          float h = rkLum;
          #ifdef ROCK_CARVE
            vec4 cv = texture2D(rkCarve, vUv);
            h -= cv.r * rkCarveK;
            c *= 1.0 - cv.r * 0.45 * rkCarveK;
          #endif
          rkDH = vec2(dFdx(h), dFdy(h)) * rkBump * smoothstep(0.05, 0.012, foot);
          c *= rkTint;
          float m1 = texture2D(vNoise, vVolcP.xz * 0.013 + vec2(vVolcP.y * 0.005, 0.0)).a;
          float m2 = texture2D(vNoise, vVolcP.zx * 0.051 + vec2(0.0, vVolcP.y * 0.037)).r;
          c *= mix(1.0 - rkMacro, 1.0 + rkMacro * 0.6, smoothstep(0.25, 0.75, m1 * 0.6 + m2 * 0.4));
          vGl = volcGlowAt(vVolcP.xz);
          float heat = smoothstep(0.25, 0.85, vGl.r + vGl.g * vSeamGlow);
          c *= 1.0 - heat * rkScorch * 0.45;
          float an = texture2D(vNoise, vVolcP.xz * 0.23 + vVolcP.y * 0.07).g;
          float af = smoothstep(0.62, 0.92, nW.y + (an - 0.5) * 0.5) * rkAsh * (1.0 - heat * 0.8) * (1.0 - vWet * 0.6);
          c = mix(c, vAshCol * (0.75 + 0.5 * an), af);
          vWetF = vWet * (0.5 + 0.5 * smoothstep(-0.2, 0.8, nW.y));
          c *= mix(1.0, 0.48, vWetF);
          diffuseColor.rgb *= c;
        }
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = clamp(roughness * (1.0 + rkRoughVar * (0.5 - rkLum)), 0.05, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.2, vWetF * 0.9);
      `)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = volcPerturb(-vViewPosition, normal, rkDH, faceDirection);')
      .replace('#include <aomap_fragment>', UNDERLIGHT_APPLY)
      .replace('#include <fog_fragment>', FOG_APPLY);
  });
  return mat;
}
