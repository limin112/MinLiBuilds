// Character "look": patches the built-in PBR materials of the fighters (and their swords) so that metal reads as
// metal and the figures read against the hall:
//   - metal is decided in the shader: the Tripo metal maps are nearly empty, so grey, not-too-dark texels become
//     steel / silver and saturated yellow texels become gold (per preset), then roughness is remapped;
//   - a Fresnel edge of light (cool for the knight, cool -> gold for the saint in phase two);
//   - the saint's ivory holds a little light of its own;
//   - a key light that only lights the fighters, from over the camera's left shoulder, following the camera;
//   - wet and glossy below the water line; a hit flash; a dissolve with a burning gold edge.
// Everything stays a MeshStandardMaterial (patched in onBeforeCompile), so the hall's lights, shadows and the
// environment map still reach it.
import * as THREE from 'three';

const PRESETS = {
  heroine: {
    rim: [0.5, 0.66, 1.0], rimK: 0.62, rimPow: 2.6, self: [0, 0, 0], selfK: 0,
    metal: [0.2, 0.62], steelK: 1.0, steelSat: [0.17, 0.1], steelLum: [0.2, 0.12], goldK: 0,
    rough: [0.85, 0.0], steelRough: 0.48, goldRough: 0.3, plain: [0.0, 1.2], steel: [0.42, 0.47, 0.56],
    wet: [0.36, 0.3, 1.0], key: 0.6, keyCol: [0.8, 0.88, 1.0], env: 1.8, normal: 1.0, height: 1.7,
  },
  bossAged: {
    rim: [0.78, 0.86, 1.0], rimK: 0.45, rimPow: 3.2, self: [0.95, 0.93, 0.88], selfK: 0.32,
    metal: [0.5, 1.0], steelK: 0.9, steelSat: [0.1, 0.08], steelLum: [0.42, 0.12], goldK: 1.0,
    rough: [0.85, 0.0], steelRough: 0.3, goldRough: 0.34, plain: [0.06, 1.0], steel: [0.72, 0.72, 0.7],
    wet: [0.75, 0.7, 1.0], key: 1.5, keyCol: [0.82, 0.9, 1.0], env: 1.1, normal: 0.8, height: 5.1,
  },
  // phase one: ivory and silver, warm-white edge, a soft light of her own; gold only in the trim
  bossHoly: {
    rim: [1.0, 0.93, 0.8], rimK: 0.5, rimPow: 3.4, self: [1.0, 0.95, 0.86], selfK: 0.05, goldGlow: 0.18,
    metal: [0.25, 0.7], steelK: 0.55, steelSat: [0.1, 0.08], steelLum: [0.45, 0.12], goldK: 1.0,
    rough: [0.8, 0.0], steelRough: 0.42, goldRough: 0.3, plain: [0.12, 0.78], steel: [0.78, 0.77, 0.75],
    wet: [0.75, 0.7, 1.0], key: 0.95, keyCol: [1.0, 0.95, 0.86], env: 0.95, normal: 0.85, height: 5.1,
  },
  bossPure: {
    rim: [1.0, 0.8, 0.48], rimK: 0.75, rimPow: 3.0, self: [1.0, 0.9, 0.72], selfK: 0.12, goldGlow: 0.4,
    metal: [0.25, 0.7], steelK: 0.9, steelSat: [0.1, 0.08], steelLum: [0.45, 0.12], goldK: 1.0,
    rough: [0.8, 0.0], steelRough: 0.26, goldRough: 0.28, plain: [0.12, 0.86], steel: [0.74, 0.74, 0.77],
    wet: [0.75, 0.7, 1.0], key: 1.6, keyCol: [1.0, 0.86, 0.6], env: 1.1, normal: 0.8, height: 5.1,
  },
  blade: {
    rim: [0.55, 0.7, 1.0], rimK: 0.5, rimPow: 3.0, self: [0, 0, 0], selfK: 0,
    metal: [0.2, 0.6], steelK: 1.0, steelSat: [0.26, 0.12], steelLum: [0.1, 0.1], goldK: 0,
    rough: [0.7, 0.0], steelRough: 0.3, goldRough: 0.3, plain: [0.0, 1.1], steel: [0.5, 0.53, 0.6],
    wet: [0, 0.1, 0], key: 0.7, keyCol: [0.85, 0.9, 1.0], env: 1.8, normal: 1.0, height: 1.2,
  },
  holyBlade: {
    rim: [0.9, 0.85, 0.7], rimK: 0.36, rimPow: 3.2, self: [1.0, 0.95, 0.85], selfK: 0.06,
    metal: [0.2, 0.6], steelK: 1.0, steelSat: [0.16, 0.1], steelLum: [0.3, 0.12], goldK: 1.0,
    rough: [0.7, 0.0], steelRough: 0.22, goldRough: 0.26, plain: [0.1, 1.1], steel: [0.78, 0.8, 0.84],
    wet: [0, 0.1, 0], key: 1.2, keyCol: [0.9, 0.92, 1.0], env: 1.3, normal: 1.0, height: 3.9,
  },
};

const PARS = /* glsl */`
uniform vec4 lkA;   // rim strength, rim power, self strength, gold glow
uniform vec4 lkB;   // wet line (world y), wet fade, wet amount, feet y
uniform vec4 lkC;   // flash, dissolve, roughness mul, roughness add
uniform vec4 lkD;   // metal map lo, metal map hi, steel amount, gold amount
uniform vec4 lkE;   // steel: max saturation, softness, min lightness, softness
uniform vec4 lkF;   // plain desaturation, plain gain, steel roughness, gold roughness
uniform vec3 lkRim; uniform vec3 lkSelf; uniform vec3 lkGold; uniform vec3 lkFlash; uniform vec3 lkSteel;
uniform vec3 lkKeyDir; uniform vec3 lkKeyCol; uniform float lkHeight;
float lkGoldM = 0.0; float lkSteelM = 0.0; float lkEdge = 0.0; vec3 lkWP;
float lkHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float lkNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( lkHash( i ), lkHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( lkHash( i + vec3( 0, 1, 0 ) ), lkHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( lkHash( i + vec3( 0, 0, 1 ) ), lkHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( lkHash( i + vec3( 0, 1, 1 ) ), lkHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`;

const CLIP = /* glsl */`
  lkWP = ( - vViewPosition - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );   // world position
  if ( lkC.y > 0.001 ) {
    float lkN = lkNoise( lkWP * 5.0 ) * 0.65 + lkNoise( lkWP * 21.0 ) * 0.35;
    float lkH = clamp( ( lkWP.y - lkB.w ) / max( lkHeight, 0.1 ), 0.0, 1.0 );
    float lkCut = lkC.y * 1.18 - 0.09 + 0.22 * lkC.y * lkH;
    if ( lkN < lkCut ) discard;
    lkEdge = 1.0 - smoothstep( 0.0, 0.07, lkN - lkCut );
  }`;

const SURFACE = /* glsl */`
  {
    vec3 lkc = diffuseColor.rgb;
    vec3 lks = sqrt( max( lkc, vec3( 0.0 ) ) );                          // roughly perceptual
    float lkMx = max( lks.r, max( lks.g, lks.b ) ), lkMn = min( lks.r, min( lks.g, lks.b ) );
    float lkSat = ( lkMx - lkMn ) / max( lkMx, 1e-3 );
    float lkL = dot( lks, vec3( 0.2126, 0.7152, 0.0722 ) );
    lkGoldM = lkD.w * smoothstep( 0.34, 0.6, lkSat ) * step( lks.b, lks.r * 0.92 ) * smoothstep( 0.22, 0.4, lkL );
    lkSteelM = lkD.z * ( 1.0 - smoothstep( lkE.x, lkE.x + lkE.y, lkSat ) ) * smoothstep( lkE.z, lkE.z + lkE.w, lkL ) * ( 1.0 - lkGoldM );
    float lkMap = clamp( ( metalnessFactor - lkD.x ) / max( lkD.y - lkD.x, 1e-3 ), 0.0, 1.0 );
    float lkMetal = max( lkMap, max( lkGoldM, lkSteelM ) );
    float lkR = clamp( roughnessFactor * lkC.z + lkC.w, 0.06, 1.0 );
    lkR = mix( lkR, lkF.z, lkSteelM );
    lkR = mix( lkR, lkF.w, lkGoldM );
    vec3 lkPlain = mix( lkc, vec3( dot( lkc, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * vec3( 1.0, 0.985, 0.95 ), lkF.x ) * lkF.y;
    vec3 lkSteelC = lkSteel * ( 0.55 + 1.6 * lkL );
    vec3 lkGoldC = vec3( 1.0, 0.72, 0.32 ) * ( 0.35 + 0.9 * lkL );
    vec3 lkCol = mix( lkPlain, lkc * 1.4, lkMap );
    lkCol = mix( lkCol, lkSteelC, lkSteelM );
    lkCol = mix( lkCol, lkGoldC, lkGoldM );
    diffuseColor.rgb = lkCol;
    metalnessFactor = lkMetal;
    roughnessFactor = lkR;
    float lkWl = lkWP.y + 0.04 * sin( lkWP.x * 9.0 + lkWP.z * 7.0 );
    float lkWk = lkB.z * ( 1.0 - smoothstep( lkB.x, lkB.x + lkB.y, lkWl ) );
    diffuseColor.rgb *= 1.0 - 0.4 * lkWk;
    roughnessFactor = mix( roughnessFactor, min( roughnessFactor, 0.15 ), lkWk );
  }`;

const LIGHT = /* glsl */`
  {
    vec3 lkV = normalize( vViewPosition );
    float lkNdV = clamp( dot( normal, lkV ), 0.0, 1.0 );
    float lkFres = pow( 1.0 - lkNdV, lkA.y );
    float lkBack = clamp( dot( normal, vec3( 0.0, 0.66, - 0.75 ) ) * 0.5 + 0.6, 0.0, 1.0 );
    totalEmissiveRadiance += lkRim * ( lkFres * lkBack * lkA.x );
    vec3 lkNW = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
    totalEmissiveRadiance += diffuseColor.rgb * lkSelf * ( lkA.z * ( 0.6 + 0.4 * lkNW.y ) * ( 1.0 - 0.75 * metalnessFactor ) );
    // key light for the fighters only
    vec3 lkLd = normalize( ( viewMatrix * vec4( lkKeyDir, 0.0 ) ).xyz );
    float lkNdL = clamp( dot( normal, lkLd ), 0.0, 1.0 );
    vec3 lkHv = normalize( lkLd + lkV );
    float lkNdH = clamp( dot( normal, lkHv ), 0.0, 1.0 );
    float lka = max( roughnessFactor * roughnessFactor, 0.004 );
    float lka2 = lka * lka, lkdd = lkNdH * lkNdH * ( lka2 - 1.0 ) + 1.0;
    float lkDist = lka2 / ( 3.14159 * lkdd * lkdd );
    vec3 lkF0 = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
    vec3 lkFr = lkF0 + ( 1.0 - lkF0 ) * pow( 1.0 - clamp( dot( lkHv, lkV ), 0.0, 1.0 ), 5.0 );
    vec3 lkSpec = min( lkFr * lkDist * 0.25 / max( lkNdV, 0.15 ), vec3( 8.0 ) );
    vec3 lkDiff = diffuseColor.rgb * ( 1.0 - metalnessFactor ) * 0.318;
    totalEmissiveRadiance += ( lkDiff + lkSpec ) * lkNdL * lkKeyCol;
    float lkH = clamp( ( lkWP.y - lkB.w ) / max( lkHeight, 0.1 ), 0.0, 1.0 );
    totalEmissiveRadiance += lkGold * ( lkA.w * ( lkGoldM + 0.05 ) * ( 1.0 - 0.45 * lkH ) * ( 0.5 + 0.5 * lkFres ) );
    totalEmissiveRadiance += lkFlash * ( lkC.x * ( 0.35 + 0.65 * lkFres ) );
    totalEmissiveRadiance += lkGold * ( lkEdge * 6.0 );
  }`;

function inject(src, include, code) {
  const tag = `#include <${include}>`;
  if (!src.includes(tag)) { console.warn('look: missing ' + tag); return src; }
  return src.replace(tag, tag + '\n' + code);
}

const looks = [];
const v3 = a => new THREE.Vector3(...a);

/**
 * Apply a look preset to every standard material under `root` (materials are cloned per root).
 * Returns { uniforms, set(presetName), flash, dissolve, glow, gold, rimK } handle.
 */
export function applyLook(root, presetName) {
  const P = PRESETS[presetName];
  const u = {
    lkA: { value: new THREE.Vector4() }, lkB: { value: new THREE.Vector4() }, lkC: { value: new THREE.Vector4() },
    lkD: { value: new THREE.Vector4() }, lkE: { value: new THREE.Vector4() }, lkF: { value: new THREE.Vector4() },
    lkRim: { value: new THREE.Vector3() }, lkSelf: { value: new THREE.Vector3() }, lkGold: { value: new THREE.Vector3(1.0, 0.72, 0.34) },
    lkFlash: { value: new THREE.Vector3(3.0, 2.8, 2.4) }, lkSteel: { value: new THREE.Vector3() },
    lkKeyDir: { value: new THREE.Vector3(0, 0.8, 0.6) }, lkKeyCol: { value: new THREE.Vector3() }, lkHeight: { value: 1.7 },
  };
  const look = { root, uniforms: u, preset: null, keyK: 1, flashK: 0, dissolveK: 0, rimMul: 1 };
  look.set = name => {
    const p = PRESETS[name]; look.preset = p; look.name = name;
    u.lkA.value.set(p.rimK, p.rimPow, p.selfK, p.goldGlow || 0);
    u.lkB.value.set(0.06 + p.wet[0], p.wet[1], p.wet[2], 0);
    u.lkC.value.set(look.flashK, look.dissolveK, p.rough[0], p.rough[1]);
    u.lkD.value.set(p.metal[0], p.metal[1], p.steelK, p.goldK);
    u.lkE.value.set(p.steelSat[0], p.steelSat[1], p.steelLum[0], p.steelLum[1]);
    u.lkF.value.set(p.plain[0], p.plain[1], p.steelRough, p.goldRough);
    u.lkRim.value.copy(v3(p.rim)); u.lkSelf.value.copy(v3(p.self)); u.lkSteel.value.copy(v3(p.steel));
    u.lkKeyCol.value.copy(v3(p.keyCol)).multiplyScalar(p.key * look.keyK);
    u.lkHeight.value = p.height;
  };
  look.set(presetName);
  const seen = new Map();
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const patch = m => {
      if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return m;
      if (seen.has(m)) return seen.get(m);
      const c = m.clone();
      c.envMapIntensity = P.env;
      if (c.normalScale) c.normalScale.multiplyScalar(P.normal);
      c.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, u);
        let f = shader.fragmentShader;
        f = f.replace('void main() {', PARS + '\nvoid main() {');
        f = inject(f, 'clipping_planes_fragment', CLIP);
        f = inject(f, 'metalnessmap_fragment', SURFACE);
        f = inject(f, 'emissivemap_fragment', LIGHT);
        shader.fragmentShader = f;
      };
      c.customProgramCacheKey = () => 'look-v1';
      seen.set(m, c);
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(patch) : patch(o.material);
  });
  Object.defineProperties(look, {
    flash: { get() { return u.lkC.value.x; }, set(v) { u.lkC.value.x = v; } },
    dissolve: { get() { return u.lkC.value.y; }, set(v) { u.lkC.value.y = v; } },
    // extra inner light on top of the preset's own (0 = preset)
    glow: { get() { return u.lkA.value.z - look.preset.selfK; }, set(v) { u.lkA.value.z = look.preset.selfK + v; } },
  });
  looks.push(look);
  root.userData.look = look;
  return look;
}

const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _back = new THREE.Vector3(), _key = new THREE.Vector3();

/** Once a frame: aim the fighters' key from over the camera's left shoulder; keep the feet height current. */
export function updateLooks(camera) {
  const e = camera.matrixWorld.elements;
  _right.set(e[0], 0, e[2]).normalize();
  _back.set(e[8], 0, e[10]);
  if (_back.lengthSq() < 1e-6) _back.set(0, 0, 1); else _back.normalize();
  _up.set(0, 1, 0);
  _key.set(0, 0, 0).addScaledVector(_back, 0.55).addScaledVector(_right, -0.5).addScaledVector(_up, 0.75).normalize();
  for (const l of looks) {
    l.uniforms.lkKeyDir.value.copy(_key);
    l.uniforms.lkB.value.w = l.root.getWorldPosition(_up).y;
    _up.set(0, 1, 0);
  }
}

export { PRESETS as LOOK_PRESETS };
