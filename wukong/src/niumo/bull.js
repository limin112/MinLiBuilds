// 牛魔王 — the seated giant of the burning mountain (phase one: 坐山) who rises to his full height (phase two: 现出原身).
//
//   const char = await loadBullCharacter();                      // assets/models/niumo_bull.glb
//   const bull = new BullKing({ char, scene, fx, audio, arena, cam, staff });   // staff optional (procedural if null)
//   bull.wake();                       // after the wake cutscene
//   bull.update(dt, player);           // every frame (after the player)
//   bull.hurtZones() / lockTargets() / takeHit() / criticalOpen() / takeCritical()   (docs/niumo_architecture.md §2)
//
// Extras for the camera / main / monkey: threat(), colliders(), noseRing(), critAnchor(), fanned(), groundFires,
// events (damage, weakBreak, stagger, down, critical {stage:'open'|'hit'}, phase2, transition-end, dead, attack, hitPlayer, grab, reflect).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Actor } from '../actor.js';
import { ease } from '../pose.js';
import { loadCharacter, loadGLTF } from '../assets.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { sweepBlade, segSeg, horizDist, yawLerp } from '../combat.js';
import { BULL, SEAT, SEAT_SLEEP, STAND, STAND_EMPTY } from './moves_bull.js';

const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _p = new THREE.Vector3(), _e = new THREE.Vector3(), _ha = new THREE.Vector3(), _hb = new THREE.Vector3(), _hc = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const SWEEPS = new Set(['sweep', 'sweep2', 'combo2']);

// Sound names come from the audio module; anything it does not know yet falls back to an older sound (never warns).
const SFX_KNOWN = await import('../audio.js').then(m => new Set(m.SFX_NAMES || [])).catch(() => null);

export const BULL_TUNING = {
  height: 40, maxHp: 3600, poiseMax: 320, poiseRegen: 30,
  weakHp: 170, kneeHp2: 200, regrow: 24,
  // the seated phase is a prologue: this many blows of the staff (or health down to preludeHp) and he stands up
  preludeHits: 6, preludeHp: 0.9, openingRest: 6.5, openingDelay: 0.7,
  bodyMul: 0.3, weakMul: 1.0, brokenMul: 1.15, headMul: 1.5, heavyWeakMul: 1.6, exposedMul: 1.5,
  staffLength: 30, staffGrip: 0.15, staffRadius: 0.78,
  sweepStaff: 1.6,               // 横扫: the staff grows this much for the sweep (length and girth)
  reflectDmg: 150, grabDmg: 42, fireDmg: 30, firePatchDmg: 7, eruptDmg: 26, waveDmg: 30, meteorDmg: 28,
  turn2: 22, walk2: 3.0,
  // the duel (phase two against the monkey at his own scale): every blow of the rod counts this much, his poise is
  // short, he turns and walks faster and keeps the monkey at the staff's length
  duelMul: 2.3, duelHead: 1.3, duelPoise: 135, duelTurn: 70, duelWalk: 16, duelReach: 27,
  // ... a heavy blow that finds him not swinging rocks him (僵直, at most once every flinchCd seconds); a broken
  // posture (架势崩) leaves him sagging and taking reelMul; below enrageAt of his health he calls the fire down (火雨)
  // and from then on fights faster, with the charge
  flinchCd: 3.2, reelMul: 1.4, enrageAt: 0.5, duelMeteorDmg: 15, duelWaveDmg: 17, duelCrushDmg: 22, chargeDmg: 26, chargeSpeed: 60, chargeCd: 18,
  // 金身: every goldStep of his health lost he turns to gold for goldSec: blows do nothing, and the striker reels (僵直)
  goldStep: 0.1, goldSec: 3, goldChargeLead: 0.35,      // (组合技: the gold ends, the white bull runs this soon after)
  // 现原形: the charge is run as a great white bull this long (nose to tail, m) whose stride is played this fast
  beastLen: 4.7, beastStride: 0.7, beastSpeed: 1.45,
  // ... and how hard he presses: seconds between blows (calm / enraged), and how often a sweep runs straight on into the slam
  duelRest: [1.0, 1.9], rageRest: [0.45, 1.1], chainP: 0.25, rageChainP: 0.45,
  // 现真身 (under enrageAt): he wears the fire - blows count armorMul (his defence up by half) until the banana-leaf fan
  // blows it out for armorDown s (a parry, for armorParry s). 锤地: the leap leaves quakeR m of burning ground for
  // quakeLife s, which costs fieldDmg every fieldTick s to stand in
  armorMul: 1 / 1.5, armorDown: 9, armorParry: 4, quakeR: 30, quakeLife: 9, fieldDmg: 12, fieldTick: 0.5, quakeJump: 0.3,
  press: 0.15, wade: 1.1,        // hooves: pressed this far into rock / sunk this far into the lava lake (m)
  hoofPitch: 16,                 // standing: the hoof's point lies this many degrees below its ankle
  groundIn: [5.4, 6.8],          // rise: the feet take his weight over this stretch of the move (s)
  seatHipsUp: 0.12,              // seated: hips this many leg lengths above the seat
  eye: [0.4, 0.2, 0.16, 0.08],   // eye glow: forward, up, sideways, size (head sizes)
};

// ------------------------------------------------------------------------------------------------ look (shader patch)

const BK_VERT_PARS = /* glsl */`varying vec3 vBkBind; varying vec3 vBkWorld; varying vec3 vBkNrm;`;
const BK_VERT = /* glsl */`
#ifdef USE_SKINNING
  vBkBind = ( bindMatrix * vec4( position, 1.0 ) ).xyz;
#else
  vBkBind = position;
#endif
  vBkWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vBkNrm = normalize( mat3( modelMatrix ) * objectNormal );`;

const BK_PARS = /* glsl */`
uniform float bkTime;
uniform float bkNearK;
uniform vec4 bkA;   // ember veins, lava texels, lava under-light, ash
uniform vec4 bkB;   // rim, bind units -> meters, ground y, albedo gain
uniform vec4 bkC;   // 金身 (gold body, 0..1), unused, cooling (death), unused
uniform vec3 bkRimCol; uniform vec3 bkLavaCol; uniform vec3 bkUnderCol;
uniform vec4 bkWA[4]; uniform vec4 bkWB[4]; uniform vec4 bkWC[4];
varying vec3 vBkBind; varying vec3 vBkWorld; varying vec3 vBkNrm;
float bkLavaM = 0.0; float bkBronzeM = 0.0; float bkAshM = 0.0;
float bkPatina = 0.0; float bkBurn = 0.0; float bkLum = 0.0;
float bkVein = 0.0; float bkHalo = 0.0;
vec3 bkH3( vec3 p ) { p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) ); return fract( sin( p ) * 43758.5453 ); }
float bkHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float bkNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( bkHash( i ), bkHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( bkHash( i + vec3( 0, 1, 0 ) ), bkHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( bkHash( i + vec3( 0, 0, 1 ) ), bkHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( bkHash( i + vec3( 0, 1, 1 ) ), bkHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// distance to the nearest cell border: cooled crust broken into plates
float bkCells( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); float d1 = 8.0, d2 = 8.0;
  for ( int z = -1; z <= 1; z ++ ) for ( int y = -1; y <= 1; y ++ ) for ( int k = -1; k <= 1; k ++ ) {
    vec3 g = vec3( float( k ), float( y ), float( z ) ); vec3 r = g + bkH3( i + g ) - f; float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
  }
  return sqrt( d2 ) - sqrt( d1 );
}`;

const BK_EMIT = /* glsl */`
  {
    vec3 pm = vBkBind * bkB.y;
    float cool = 1.0 - bkC.z;
    float breathe = 0.72 + 0.28 * sin( bkTime * 0.8 + pm.y * 0.12 );
    float crawl = 0.65 + 0.35 * bkNoise( pm * 0.45 + vec3( 0.0, -bkTime * 0.35, 0.0 ) );   // heat creeping along the cracks
    totalEmissiveRadiance += bkLavaCol * ( bkVein * bkA.x * breathe * crawl * cool * ( 1.0 - bkAshM ) );
    totalEmissiveRadiance += bkLavaCol * ( bkHalo * bkA.x * 0.06 * breathe * cool );
    totalEmissiveRadiance += bkLavaCol * ( bkLavaM * bkA.y * breathe * cool );
    vec3 wn = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );     // shading normal (normal-mapped), world
    vec3 vdir = normalize( vViewPosition );
    float ndv = clamp( dot( normal, vdir ), 0.0, 1.0 );
    // trust the fake lighting only where the shading normal agrees with the real surface (stretched cloth flaps of
    // the seated pose carry broken normals: they lit up as pale sheets)
    vec3 ngv = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
    ngv *= sign( dot( ngv, vdir ) );
    float trust = smoothstep( 0.05, 0.45, dot( normal, ngv ) );
    // the lava floor lights him from below and from the rivers in front: a soft warm fill that models the form
    float h = max( vBkWorld.y - bkB.z, 0.0 );
    float under = pow( clamp( -wn.y * 0.55 + wn.z * 0.35 + 0.32, 0.0, 1.0 ), 1.6 ) * exp( -h * 0.05 );
    float diffK = 1.0 - metalnessFactor * 0.75;
    totalEmissiveRadiance += diffuseColor.rgb * bkUnderCol * ( under * bkA.z * diffK * trust );
    // bronze catches the glow as a dull warm sheen on the planes that face down / forward
    totalEmissiveRadiance += diffuseColor.rgb * bkUnderCol * ( metalnessFactor * under * 0.35 * bkA.z * ( 1.0 - roughnessFactor * 0.6 ) * trust );
    // rims: a cold edge of smoke-veiled sky on the top of the silhouette, a dim ember edge underneath
    float fres = pow( 1.0 - ndv, 3.0 ) * trust;
    float up = clamp( wn.y * 0.7 + 0.45, 0.0, 1.0 );
    totalEmissiveRadiance += bkRimCol * ( fres * bkB.x * up );
    totalEmissiveRadiance += bkUnderCol * ( fres * bkB.x * 0.35 * ( 1.0 - up ) * cool );
    // 金身: a golden radiance, a bright halo on the silhouette and bands of light running up his body
    if ( bkC.x > 0.001 ) {
      float band = smoothstep( 0.82, 1.0, sin( pm.y * 0.3 - bkTime * 7.0 ) );
      float glint = smoothstep( 0.92, 1.0, bkNoise( pm * 1.3 + vec3( bkTime * 2.0 ) ) );
      totalEmissiveRadiance += vec3( 1.0, 0.72, 0.28 ) * bkC.x * ( 0.04 + 0.35 * band + 0.9 * glint + 0.55 * pow( 1.0 - ndv, 3.0 ) );
    }
    // the four lava cracks (hand backs, knees)
    for ( int i = 0; i < 4; i ++ ) {
      vec4 wa = bkWA[ i ], wb = bkWB[ i ], wc = bkWC[ i ];
      if ( wb.w <= 0.001 && wc.y < 0.5 ) continue;
      vec3 ab = wb.xyz - wa.xyz;
      float t = clamp( dot( vBkBind - wa.xyz, ab ) / max( dot( ab, ab ), 1e-8 ), 0.0, 1.0 );
      float d = length( vBkBind - ( wa.xyz + ab * t ) ) / max( wa.w, 1e-6 );
      if ( d >= 1.0 ) continue;
      // a wound, not a decal: fine cracks, dense at the heart of it, thinning out and breaking up toward the rim
      float m = 1.0 - smoothstep( 0.2, 1.0, d ); m *= m;
      float dmg = wc.x, broken = wc.y, flash = wc.z;
      float edge = bkCells( pm * ( 1.75 + dmg * 0.5 ) + float( i ) * 7.3 );
      float crack = 1.0 - smoothstep( 0.0, 0.03 + 0.1 * dmg, edge );
      crack *= mix( 1.0, smoothstep( 0.3, 0.62, bkNoise( pm * 0.8 + float( i ) * 3.1 ) ), smoothstep( 0.15, 0.7, d ) * ( 1.0 - dmg ) );
      float pulse = 0.82 + 0.18 * sin( bkTime * ( 2.4 + dmg * 3.0 ) + float( i ) * 1.7 );
      vec3 col = mix( bkLavaCol, vec3( 1.0, 0.5, 0.14 ), clamp( dmg * 0.7 + flash * 0.6, 0.0, 1.0 ) );
      float core = broken * ( 1.0 - smoothstep( 0.0, 0.6, d ) );
      totalEmissiveRadiance += col * ( crack * m * wb.w * pulse + flash * m * 0.8 ) * cool;
      totalEmissiveRadiance += vec3( 1.0, 0.36, 0.08 ) * core * ( 0.4 + 0.8 * wc.w ) * cool;
      diffuseColor.rgb *= 1.0 - 0.6 * core;
    }
  }`;

// The white bull (niumo_w_bull_a6: pale scarred hide, monk robe, gold mask / bracers / horn tips): the model's own
// texture is kept; gold texels are found by hue and turned into polished metal that mirrors the lava; no basalt, no
// cracks, no ash. Same uniforms and the same weak-point / rim / under-light pass (BK_EMIT) as the basalt look.
const BK_MAP_W = /* glsl */`
  {
    vec3 c = diffuseColor.rgb;
    vec3 s = sqrt( max( c, vec3( 0.0 ) ) );
    float mx = max( s.r, max( s.g, s.b ) ), mn = min( s.r, min( s.g, s.b ) );
    float dl = mx - mn;
    float sat = dl / max( mx, 1e-3 );
    float hue = 0.0;
    if ( dl > 1e-4 ) {
      if ( mx == s.r ) hue = mod( ( s.g - s.b ) / dl, 6.0 ) / 6.0;
      else if ( mx == s.g ) hue = ( ( s.b - s.r ) / dl + 2.0 ) / 6.0;
      else hue = ( ( s.r - s.g ) / dl + 4.0 ) / 6.0;
    }
    float L = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) );
    bkLum = L;
    // gold: yellow-orange hue, saturated, not dark (the robe's rust red sits below hue 0.06, the hide is unsaturated)
    bkBronzeM = smoothstep( 0.055, 0.075, hue ) * ( 1.0 - smoothstep( 0.16, 0.19, hue ) )
              * smoothstep( 0.32, 0.5, sat ) * smoothstep( 0.3, 0.48, mx );
    bkLavaM = 0.0; bkAshM = 0.0; bkVein = 0.0; bkHalo = 0.0; bkPatina = 0.0; bkBurn = 0.0;
    // the texture's own shading (engraving, folds) stays as relief in the gold
    vec3 gold = vec3( 1.0, 0.72, 0.34 ) * ( 0.35 + 0.95 * smoothstep( 0.25, 0.85, L ) );
    // hide and cloth: the sculpt's colours, a touch darker and warmer so the pale hide does not glare in the dark
    float lk = dot( c, vec3( 0.3, 0.59, 0.11 ) );
    vec3 keep = mix( vec3( lk ), c, 0.85 ) * bkB.w;
    // 金身: all of him turns to polished gold
    bkBronzeM = max( bkBronzeM, bkC.x );
    diffuseColor.rgb = mix( keep, mix( gold, vec3( 1.0, 0.74, 0.32 ) * ( 0.55 + 0.6 * L ), bkC.x ), bkBronzeM );
  }`;

const BK_METAL_W = /* glsl */`
  {
    metalnessFactor = mix( metalnessFactor * 0.1, 1.0, bkBronzeM );
    roughnessFactor = mix( max( roughnessFactor, 0.7 ), 0.2 + ( 1.0 - bkLum ) * 0.22, bkBronzeM );
  }`;

// image-based light: the gold mirrors the lava and the sky in full; hide and cloth only take a little of it
const BK_IBL_W = /* glsl */`
  radiance *= mix( 0.25, 2.2, bkBronzeM );
  iblIrradiance *= mix( 0.55, 1.0, bkBronzeM );`;

function injectAfter(src, include, code) {
  const tag = `#include <${include}>`;
  if (!src.includes(tag)) { console.warn('bull look: missing ' + tag); return src; }
  return src.replace(tag, tag + '\n' + code);
}

/**
 * The white bull's look (docs/niumo_style.md): the model's own texture, polished gold (mask, bracers, horn tips) that
 * mirrors the lava, under-light from the lava, a cold rim, near-lens dither, and the four lava-crack weak points
 * (uniform-driven, see updateWeakUniforms).
 */
export function applyBullLook(char, { bindToMeters = char.scale } = {}) {
  const u = {
    bkTime: { value: 0 },
    bkNearK: { value: 1 },        // near-lens dither on (1) / off (0: the close shots of the cinematics)
    bkA: { value: new THREE.Vector4(0.55, 0.75, 0.4, 0.6) },     // ember veins, lava texels, under-light, ash
    bkB: { value: new THREE.Vector4(0.14, bindToMeters, 0, 0.62) },     // rim, bind units -> meters, ground y, albedo gain
    bkC: { value: new THREE.Vector4(0, 0, 0, 0) },                     // .z: cooling (death)
    bkRimCol: { value: new THREE.Color(0.24, 0.25, 0.3) },
    bkLavaCol: { value: new THREE.Color(0.8, 0.12, 0.022) },
    bkUnderCol: { value: new THREE.Color(1.0, 0.34, 0.1) },
    bkWA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    bkWB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    bkWC: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
  };
  const seen = new Map();
  const patch = m => {
    if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return m;
    if (seen.has(m)) return seen.get(m);
    const c = m.clone();
    c.envMapIntensity = 1.0;
    c.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, u);
      let v = shader.vertexShader;
      v = v.replace('void main() {', BK_VERT_PARS + '\nvoid main() {');
      v = injectAfter(v, 'skinning_vertex', BK_VERT);
      shader.vertexShader = v;
      let f = shader.fragmentShader;
      f = f.replace('void main() {', BK_PARS + '\nvoid main() {');
      // a giant's limb right in front of the lens dithers away instead of swallowing the frame (or the camera)
      f = injectAfter(f, 'clipping_planes_fragment', `{
        float bkNear = max( 1.0 - bkNearK, smoothstep( 2.5, 6.0, distance( vBkWorld, cameraPosition ) ) );
        if ( bkNear < 0.999 ) {
          vec2 q = mod( floor( gl_FragCoord.xy ), 4.0 );
          float th = ( mod( q.x * 4.0 + q.y * 9.0 + q.x * q.y * 3.0, 16.0 ) + 0.5 ) / 16.0;
          if ( bkNear < th ) discard;
        }
      }`);
      f = injectAfter(f, 'map_fragment', BK_MAP_W);
      f = injectAfter(f, 'metalnessmap_fragment', BK_METAL_W);
      f = injectAfter(f, 'emissivemap_fragment', BK_EMIT);
      f = injectAfter(f, 'lights_fragment_maps', BK_IBL_W);
      shader.fragmentShader = f;
    };
    c.customProgramCacheKey = () => 'niumo-bull-w1';
    seen.set(m, c);
    return c;
  };
  char.model.traverse(o => {
    if (!o.isMesh || !o.material) return;
    o.material = Array.isArray(o.material) ? o.material.map(patch) : patch(o.material);
  });
  return { uniforms: u };
}

// ------------------------------------------------------------------------------------------------ the staff

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, n, colors, rMin, rMax, alpha = [0.2, 0.6]) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.globalAlpha = rand(alpha[0], alpha[1]);
    g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, rand(rMin, rMax), rand(rMin, rMax) * rand(0.5, 2.5), Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

/**
 * 混铁棍: black iron shaft with riveted bronze bands (rusted, green with patina), a bronze butt cap, and a head
 * crusted with congealed lava. Returns a Group whose +Y runs from the grip (origin) to the head, like loadBlade().
 */
export function makeBullStaff({ length = BULL_TUNING.staffLength, gripFrac = BULL_TUNING.staffGrip, radius = BULL_TUNING.staffRadius } = {}) {
  const ironTex = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#1b1917'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 260, ['#2a2622', '#121110', '#3a2416', '#4a2a14'], 3, 22, [0.15, 0.5]);
    g.globalAlpha = 0.35;
    for (let i = 0; i < 70; i++) { g.strokeStyle = Math.random() < 0.5 ? '#5a3418' : '#0c0b0a'; g.lineWidth = rand(0.5, 2.5); const x = Math.random() * w; g.beginPath(); g.moveTo(x, Math.random() * h); g.lineTo(x + rand(-6, 6), Math.random() * h); g.stroke(); }
    g.globalAlpha = 1;
    speckle(g, w, h, 120, ['#070606'], 1, 4, [0.5, 0.9]);
  }, [2, length / 5]);
  const bronzeTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#3b2a14'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 140, ['#26432f', '#335a45', '#1d140a', '#4c3418'], 2, 12, [0.25, 0.7]);
    g.fillStyle = 'rgba(10,8,5,0.6)'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
  }, [3, 1]);
  const crustTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff7a2a'; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let x = Math.random() * w, y = Math.random() * h; g.lineWidth = rand(1, 4); g.globalAlpha = rand(0.4, 1);
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += rand(-26, 26); y += rand(-26, 26); g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
  });
  const iron = new THREE.MeshStandardMaterial({ map: ironTex, color: 0xffffff, roughness: 0.82, metalness: 0.55, envMapIntensity: 0.4 });
  const bronze = new THREE.MeshStandardMaterial({ map: bronzeTex, color: 0xffffff, roughness: 0.58, metalness: 0.8, envMapIntensity: 0.5 });
  const crust = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.95, metalness: 0.0, emissive: new THREE.Color(1.0, 0.3, 0.06),
    emissiveMap: crustTex, emissiveIntensity: 0.25 });

  const holder = new THREE.Group();
  const inner = new THREE.Group(); inner.position.y = -length * gripFrac; holder.add(inner);   // inner: butt at y=0

  // shaft: slightly swollen in the middle, dented
  const shaftGeo = new THREE.CylinderGeometry(radius * 0.92, radius, length, 28, 60, false);
  const p = shaftGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const fr = y * 0.13 - Math.floor(y * 0.13);                   // dents every ~8 m
    const k = 1 + 0.035 * Math.sin(y * 0.9 + a * 3) * Math.sin(y * 0.37 + a * 5) + 0.05 * Math.exp(-fr * 9) * Math.sin(a * 7 + y);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  shaftGeo.computeVertexNormals();
  shaftGeo.translate(0, length / 2, 0);
  const shaft = new THREE.Mesh(shaftGeo, iron);
  inner.add(shaft);

  // bronze bands with rims, and rivets
  const bands = [], rivetPos = [];
  const at = [0.03, 0.09, 0.3, 0.36, 0.58, 0.64, 0.83, 0.88];
  for (const f of at) {
    const y = f * length, br = radius * 1.14, bw = radius * 1.15;
    bands.push(new THREE.CylinderGeometry(br, br, bw, 28, 1, false).translate(0, y, 0));
    for (const s of [-1, 1]) bands.push(new THREE.TorusGeometry(br * 1.02, radius * 0.07, 6, 28).rotateX(Math.PI / 2).translate(0, y + s * bw * 0.5, 0));
    for (let r = 0; r < 2; r++) for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + r * 0.31;
      rivetPos.push(new THREE.Vector3(Math.cos(a) * br * 1.01, y + (r ? 0.26 : -0.26) * bw, Math.sin(a) * br * 1.01));
    }
  }
  // butt cap
  bands.push(new THREE.CylinderGeometry(radius * 1.22, radius * 1.05, radius * 1.6, 24, 1).translate(0, radius * 0.8, 0));
  bands.push(new THREE.ConeGeometry(radius * 1.05, radius * 1.2, 24, 1).rotateX(Math.PI).translate(0, -radius * 0.6, 0));
  const bandMesh = new THREE.Mesh(mergeGeometries(bands.map(g => g.toNonIndexed())), bronze);
  inner.add(bandMesh);
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(radius * 0.16, 8, 5), bronze, rivetPos.length);
  rivetPos.forEach((v, i) => { _m.makeTranslation(v.x, v.y, v.z); rivets.setMatrixAt(i, _m); });
  inner.add(rivets);

  // the head: a lump of congealed lava around the last bronze band
  const headGeo = new THREE.IcosahedronGeometry(radius * 1.9, 3);
  const hp = headGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    _v.fromBufferAttribute(hp, i);
    const n = 1 + 0.18 * Math.sin(_v.x * 3.1 + _v.y * 1.7) * Math.cos(_v.z * 2.3 - _v.y) + 0.12 * Math.sin(_v.x * 7 + _v.z * 5);
    _v.multiplyScalar(n); _v.y *= 1.7; hp.setXYZ(i, _v.x, _v.y, _v.z);
  }
  headGeo.computeVertexNormals();
  const head = new THREE.Mesh(headGeo, crust);
  head.position.y = length - radius * 2.3;
  inner.add(head);
  for (const o of [shaft, bandMesh, rivets, head]) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  holder.userData = { length, gripFrac, bladeLength: length * (1 - gripFrac), radius, crust };
  holder.name = 'bullStaff';
  return holder;
}

// ------------------------------------------------------------------------------------------------ loading

/**
 * Load the bull: assets/models/niumo_bull.glb (standing A-pose, Mixamo rig). Returns loadCharacter()'s result plus { url }.
 */
// (mobile: the '_m' files - the same models with smaller textures, 2026-11-17: a phone's GPU memory, and the download)
export async function loadBullCharacter({ base = 'assets/models/', height = BULL_TUNING.height, mobile = false } = {}) {
  const url = base + (mobile ? 'niumo_bull_m.glb' : 'niumo_bull.glb');
  // (cleanArms off: the generic cleaner sends a hand vertex beyond the middle finger's line - his thumbs - wholly to the
  // hips, and seated those thumbs stretched down to his lap as strips; keepHandsOnArms does this model's cleaning)
  const char = await loadCharacter(url, { height, cleanArms: false });
  if (char.mesh) char.mesh.geometry = char.mesh.geometry.clone();        // (our own copy: the edits below stay ours)
  char.url = url;
  if (char.mesh) char.droppedChains = dropWristChains(char.mesh);
  if (char.mesh) char.handFixed = keepHandsOnArms(char.mesh);
  return char;
}

/**
 * His arms' weights (2026-11-17 user, the "布条" at his hands): in the file his hands hang beside his thighs and robe, so
 * the auto-rig mixed arm and body there. Seated, with the hands up on the staff, mixed vertices stretched into strips.
 * By the forearm or hand, a vertex goes wholly with what it mostly belongs to (the arm, or the thigh / robe beside it);
 * away from the arm, it lets the arm go. Vertices wholly on the arm are not touched. Returns the vertices changed.
 */
function keepHandsOnArms(mesh) {
  const geo = mesh.geometry, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, pos = geo.attributes.position;
  if (!si || !sw) return 0;
  const bones = mesh.skeleton.bones, names = bones.map(b => b.name.replace(/^mixamorig:?/, ''));
  const arm = names.map(n => /^(Left|Right)(Arm|ForeArm|Hand)/.test(n)), low = names.map(n => /^(Left|Right)(ForeArm|Hand)/.test(n));
  const bind = i => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]).invert());
  const segs = [];
  for (const sd of ['Left', 'Right']) {
    const fa = names.indexOf(sd + 'ForeArm'), h = names.indexOf(sd + 'Hand'), tip = names.indexOf(sd + 'HandMiddle3') >= 0 ? names.indexOf(sd + 'HandMiddle3') : names.indexOf(sd + 'HandMiddle2');
    if (fa >= 0 && h >= 0) segs.push([bind(fa), bind(h)]);
    if (h >= 0) { const a = bind(h), b = tip >= 0 ? bind(tip) : a.clone().add(a.clone().sub(bind(fa)).multiplyScalar(0.6)); segs.push([a, b]); }
  }
  if (!segs.length) return 0;
  const sp = names.indexOf('Spine1'), chest = sp >= 0 ? bind(sp).y : Infinity;
  const hb = new THREE.Box3().setFromBufferAttribute(pos), H = hb.max.y - hb.min.y || 1, R = 0.07 * H;
  const p = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
  const dist = (q, a, b) => { ab.subVectors(b, a); ap.subVectors(q, a); const t = clamp(ap.dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0, 1); return ap.sub(ab.multiplyScalar(t)).length(); };
  let n = 0;
  for (let v = 0; v < pos.count; v++) {
    let wa = 0, wo = 0, wl = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k), b = si.getComponent(v, k); if (w <= 0) continue;
      if (arm[b]) wa += w; else wo += w;
      if (low[b]) wl += w;
    }
    if (wo <= 0 || wl <= 0) continue;
    p.fromBufferAttribute(pos, v).applyMatrix4(mesh.bindMatrix);
    let d = Infinity; for (const [a, b] of segs) d = Math.min(d, dist(p, a, b));
    let keep;
    if (d <= R) keep = wa >= wo ? arm : arm.map(x => !x);       // by the hand: wholly the arm, or wholly the body beside it
    else if (p.y < chest) keep = low.map(x => !x);              // the robe / belly away from the arm: lets the forearm and hand go
    else continue;
    let rest = 0;
    for (let k = 0; k < 4; k++) { const b = si.getComponent(v, k); if (!keep[b]) sw.setComponent(v, k, 0); else rest += sw.getComponent(v, k); }
    if (rest <= 1e-6) continue;
    for (let k = 0; k < 4; k++) sw.setComponent(v, k, sw.getComponent(v, k) / rest);
    n++;
  }
  sw.needsUpdate = true;
  return n;
}

/**
 * The chains hanging from his wrist cuffs (2026-11-17 user: "手部有一些布条 应该去掉"): each link is its own little
 * island of the mesh, out at the wrists, half-way up; skinned to the hand they stretched into dark strips as he moved.
 * Their triangles are collapsed. (loadCharacter has already cloned the geometry.) Returns the islands dropped.
 */
function dropWristChains(mesh) {
  const geo = mesh.geometry, pos = geo.attributes.position, index = geo.index;
  if (!index) return 0;
  const n = pos.count, ix = index.array;
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const seen = new Map();                 // (uv seams split vertices: weld by position)
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (seen.has(k)) join(i, seen.get(k)); else seen.set(k, i);
  }
  for (let t = 0; t < ix.length; t += 3) { join(ix[t], ix[t + 1]); join(ix[t], ix[t + 2]); }
  mesh.updateMatrixWorld(true);
  const m = new THREE.Matrix4().copy(mesh.matrixWorld), v = new THREE.Vector3(), all = new THREE.Box3(), isl = new Map();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m); all.expandByPoint(v);
    const r = find(i); let c = isl.get(r);
    if (!c) isl.set(r, c = { n: 0, s: new THREE.Vector3() });
    c.n++; c.s.add(v);
  }
  const ctr = all.getCenter(new THREE.Vector3()), size = all.getSize(new THREE.Vector3()), half = Math.max(size.x, size.z) / 2;
  const drop = new Set();
  for (const [r, c] of isl) {
    c.s.multiplyScalar(1 / c.n);
    const out = Math.hypot(c.s.x - ctr.x, c.s.z - ctr.z) / half, up = (c.s.y - all.min.y) / size.y;
    if (c.n < 120 && out > 0.55 && up > 0.35 && up < 0.57) drop.add(r);
  }
  if (!drop.size) return 0;
  for (let t = 0; t < ix.length; t += 3) if (drop.has(find(ix[t]))) ix[t + 1] = ix[t + 2] = ix[t];
  index.needsUpdate = true;
  return drop.size;
}

/**
 * His true form for the charge: assets/models/niumo_whitebull.glb (a great white bull, Tripo quadruped rig, one walk
 * clip, unused: the gallop is procedural, see BullKing.gallop). Faces +Z in the file. Returns { root, model, bones,
 * rest, len, height } (len: nose-to-tail at scale 1) or null.
 */
export async function loadWhiteBull({ base = 'assets/models/', mobile = false } = {}) {
  try {
    const gltf = await loadGLTF(base + (mobile ? 'niumo_whitebull_m.glb' : 'niumo_whitebull.glb'));
    const model = SkeletonUtils.clone(gltf.scene);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material) { o.material = o.material.clone(); o.material.envMapIntensity = 1.2; } } });
    const bones = {};
    model.traverse(o => { if (o.isBone) bones[o.name.replace(/^tripo:?:?/, '')] = o; });
    // the file stands him a little askew (head and tail ~20° off +Z): turn him so the line tail -> head runs along +Z,
    // or he charges crabwise
    model.updateMatrixWorld(true);
    const hd = bones.Head_1 || bones.Head_0, tl = bones.Spine_0;
    if (hd && tl) {
      const d = hd.getWorldPosition(new THREE.Vector3()).sub(tl.getWorldPosition(new THREE.Vector3()));
      model.rotation.y = -Math.atan2(d.x, d.z);
      model.updateMatrixWorld(true);
    }
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
    const pivot = new THREE.Group(); pivot.add(model);
    model.position.set(0, 0, 0);
    pivot.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const root = new THREE.Group(); root.add(pivot); root.visible = false;
    const rest = new Map();
    for (const bn of Object.values(bones)) rest.set(bn, bn.quaternion.clone());
    const out = { root, model, bones, rest, len: size.z || 1, height: size.y || 1 };
    out.hoofRest = 0; out.hoofRest = hoofLift(out);          // (at scale 1, root at 0)
    return out;
  } catch (e) { console.info('white bull: not loaded', e?.message || e); return null; }
}

/**
 * The white bull's gallop, procedural (the model only came with a walk): a rotary gallop - hind legs, then forelegs,
 * each pair a beat apart - the legs swinging about his side axis, the lower joints folding on the way forward, the
 * back flexing, the head pumping, the tail streaming. b: loadWhiteBull()'s result; ph: the stride's phase (radians);
 * k: 0..1 how hard he runs; ax: his left, in world space.
 */
const HOOVES = ['0_Left_Limb_3', '0_Right_Limb_3', '1_Left_Limb_3', '1_Right_Limb_3'];
/** How far the lowest hoof sits above its height in the standing pose (m, world): what the body must sink to stay grounded. */
export function hoofLift(b) {
  b.root.updateMatrixWorld(true);
  let lo = Infinity;
  for (const n of HOOVES) { const bn = b.bones[n]; if (bn) lo = Math.min(lo, bn.getWorldPosition(_hc).y); }
  if (lo === Infinity) return 0;
  return lo - b.root.position.y - (b.hoofRest || 0) * b.root.scale.y;
}
export function gallopPose(b, ph, k, ax) {
  const B = b.bones;
  for (const [bn, q] of b.rest) bn.quaternion.copy(q);
  const turn = (name, ang) => {
    const bn = B[name]; if (!bn || !ang) return;
    bn.parent.updateWorldMatrix(true, false);
    const pw = bn.parent.getWorldQuaternion(_q);
    // L' = Pw^-1 * R(world) * Pw * L
    const r = new THREE.Quaternion().setFromAxisAngle(ax, ang);
    bn.quaternion.premultiply(pw).premultiply(r).premultiply(pw.invert());
  };
  const D = Math.PI / 180, legs = [
    // [chain, phase offset, front?]
    ['1_Left_Limb', 0, false], ['1_Right_Limb', 0.55, false], ['0_Left_Limb', Math.PI, true], ['0_Right_Limb', Math.PI + 0.55, true],
  ];
  b.root.updateMatrixWorld(true);
  turn('Spine_0', 5 * D * k * Math.sin(ph));
  turn('Spine_2', -6 * D * k * Math.sin(ph + 0.5));
  turn('Spine_4', 5 * D * k * Math.sin(ph + 1.0));
  turn('Head_0', -10 * D * k * Math.sin(ph + 1.6) - 8 * D * k);      // head low, horns first, pumping
  for (const [c, off, front] of legs) {
    const p = ph + off, sw = Math.sin(p), fold = Math.max(0, Math.sin(p + 1.3));
    turn(c + '_0', (front ? 30 : 28) * D * k * sw);                  // the whole leg swings
    turn(c + '_1', (front ? 8 : -10) * D * k * sw);
    turn(c + '_2', (front ? 55 : -50) * D * k * fold);               // fold on the way forward (knee back, hock forward)
    turn(c + '_3', (front ? -30 : 30) * D * k * fold);
  }
  // the tail streams up and back
  for (const [i, n] of ['bone_31', 'bone_32', 'bone_33', 'bone_34'].entries()) turn(n, (14 + 4 * i) * D * k + 4 * D * k * Math.sin(ph * 2 + i));
}

// ------------------------------------------------------------------------------------------------ scaled effects

const C = {
  lava: new THREE.Color(1.0, 0.36, 0.07), ember: new THREE.Color(1.0, 0.5, 0.16), hot: new THREE.Color(1.15, 0.72, 0.32),
  deep: new THREE.Color(0.7, 0.12, 0.02), smoke: new THREE.Color(0.16, 0.135, 0.12), ash: new THREE.Color(0.3, 0.26, 0.225),
  stone: new THREE.Color(0.2, 0.175, 0.155), fire: new THREE.Color(1.0, 0.42, 0.1), fireCore: new THREE.Color(1.1, 0.68, 0.26),
  // the dust a blow throws up: warm ash in the evening light, some of it catching the sun (particles are unlit: these are their final colours)
  dust: new THREE.Color(0.25, 0.21, 0.18), dustLit: new THREE.Color(0.42, 0.27, 0.17),
  gold: new THREE.Color(1.3, 0.95, 0.45),
};

/** Effects at the bull's scale, on the shared FX particle pools. */
const STAFF_CIRCLES = 16;
const GOLD_BONES = ['Spine2', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];
const ARMOR_BONES = ['Spine2', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'Head', 'Hips', 'LeftUpLeg', 'RightUpLeg', 'Spine'];

class BullFX {
  constructor(fx) { this.fx = fx; }
  get add() { return this.fx.add; }
  get alpha() { return this.fx.alpha; }
  embers(p, n = 10, { spread = 1, up = 2, size = [0.12, 0.35], life = [1.2, 2.6], color = C.ember } = {}) {
    p = _p.copy(p);
    for (let i = 0; i < n; i++) {
      this.add.emit(_v.set(p.x + rand(-spread, spread), p.y + rand(-spread, spread) * 0.5, p.z + rand(-spread, spread)),
        _w.set(rand(-1, 1) * up * 0.4, rand(0.3, 1) * up, rand(-1, 1) * up * 0.4), color,
        { size: rand(size[0], size[1]), life: rand(life[0], life[1]), drag: 0.6, grav: 0.6, alpha: 0.9 });
    }
  }
  drip(p, n = 3) {
    p = _p.copy(p);
    for (let i = 0; i < n; i++) {
      this.add.emit(_v.set(p.x + rand(-0.5, 0.5), p.y, p.z + rand(-0.5, 0.5)), _w.set(rand(-0.4, 0.4), rand(-1, 0), rand(-0.4, 0.4)), C.lava,
        { size: rand(0.35, 0.7), life: rand(0.9, 1.6), drag: 0.1, grav: -14, alpha: 1 });
    }
  }
  smoke(p, n = 6, { size = [4, 9], spread = 2, rise = 2.5, life = [2.5, 4.5], alpha = 0.32, color = C.smoke, grow = 1.6 } = {}) {
    p = _p.copy(p);
    for (let i = 0; i < n; i++) {
      this.alpha.emit(_v.set(p.x + rand(-spread, spread), p.y + rand(0, spread * 0.5), p.z + rand(-spread, spread)),
        _w.set(rand(-0.6, 0.6), rand(0.4, 1) * rise, rand(-0.6, 0.6)), color,
        { size: rand(size[0], size[1]), life: rand(life[0], life[1]), drag: 0.5, grav: 0.3, alpha, grow });
    }
  }
  debris(p, n = 30, speed = 9, size = [0.2, 0.7]) {
    p = _p.copy(p);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.alpha.emit(_v.set(p.x, p.y + 0.3, p.z), _w.set(Math.cos(a) * rand(0.3, 1) * speed, rand(0.5, 1.4) * speed, Math.sin(a) * rand(0.3, 1) * speed),
        Math.random() < 0.5 ? C.stone : C.ash, { size: rand(size[0], size[1]), life: rand(0.8, 1.6), drag: 0.4, grav: -22, alpha: 0.95 });
    }
  }
  dustRing(p, radius = 6, n = 40) {
    p = _p.copy(p);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * rand(0.3, 1);
      const lit = Math.random() < 0.35;
      this.alpha.emit(_v.set(p.x + Math.cos(a) * r, p.y + rand(0.2, 1.2), p.z + Math.sin(a) * r),
        _w.set(Math.cos(a) * rand(2, 6), rand(0.5, 2.5), Math.sin(a) * rand(2, 6)), lit ? C.dustLit : C.dust,
        { size: rand(2.5, 6), life: rand(1.6, 3), drag: 1.2, grav: 0.15, alpha: lit ? 0.22 : 0.3, grow: 1.8 });
    }
  }
  /** Lava bursting out of a crack: spatter, embers, smoke, a short hot light. */
  burst(p, k = 1, dir = UP) {
    p = _e.copy(p);
    // (additive: a few dozen overlapping drops already burn white, so fewer, smaller, deeper red ones)
    for (let i = 0; i < 30 * k; i++) {
      const v = _w.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(4, 13) * Math.sqrt(k)).addScaledVector(dir, rand(2, 6));
      this.add.emit(p, v, Math.random() < 0.12 ? C.hot : Math.random() < 0.5 ? C.lava : C.deep, { size: rand(0.25, 0.7) * k, life: rand(0.6, 1.4), drag: 0.5, grav: -16, alpha: 0.75 });
    }
    this.embers(p, 12 * k, { spread: 1.5 * k, up: 5 });
    this.smoke(p, 5 * k, { size: [3, 7], rise: 4 });
    this.add.emit(p, _w.set(0, 0, 0), C.lava, { size: 4.5 * k, life: 0.16, grav: 0, alpha: 0.7 });
    this.fx.light(p, 0xff5a1c, 70 * k, 0.5, 34);
  }
  /** Chips of basalt and a few sparks: a blow that lands on the rock skin. */
  stoneHit(p, dir, heavy) {
    for (let i = 0; i < (heavy ? 26 : 14); i++) {
      const v = _w.set(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7)).addScaledVector(dir, -rand(1, 4));
      this.alpha.emit(p, v, Math.random() < 0.6 ? C.stone : C.ash, { size: rand(0.06, 0.2), life: rand(0.4, 0.9), drag: 1, grav: -14, alpha: 0.95 });
    }
    for (let i = 0; i < (heavy ? 22 : 10); i++) {
      const v = _w.set(rand(-1, 1), rand(-0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(4, 10)).addScaledVector(dir, -2);
      this.add.emit(p, v, C.hot, { size: rand(0.03, 0.07), life: rand(0.15, 0.4), drag: 2.5, grav: -12 });
    }
    this.alpha.emit(p, _w.set(0, 0.5, 0), C.dust, { size: heavy ? 2.2 : 1.4, life: 0.8, grav: 0.1, alpha: 0.35, grow: 1.5 });
    this.fx.light(p, 0xffb070, heavy ? 30 : 16, 0.12, 8);
  }
  /** A blow between giants: sparks and slag you can see from the far wall, a white flash at the point of contact. */
  giantHit(p, dir, heavy) {
    for (let i = 0; i < (heavy ? 46 : 24); i++) {
      const v = _w.set(rand(-1, 1), rand(-0.3, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(22, 70)).addScaledVector(dir, rand(10, 34));
      this.add.emit(p, v, Math.random() < 0.4 ? C.hot : C.lava, { size: rand(0.6, 1.7), life: rand(0.35, 0.9), drag: 1.3, grav: -42, alpha: 1 });
    }
    for (let i = 0; i < (heavy ? 16 : 7); i++) {
      const v = _w.set(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(14, 40)).addScaledVector(dir, rand(8, 24));
      this.alpha.emit(p, v, Math.random() < 0.6 ? C.stone : C.ash, { size: rand(0.7, 1.9), life: rand(0.7, 1.4), drag: 0.8, grav: -38, alpha: 0.95 });
    }
    this.add.emit(p, _w.set(0, 0, 0), C.hot, { size: heavy ? 11 : 7, life: 0.07, grav: 0, alpha: 0.9 });
    this.alpha.emit(p, _w.set(dir.x * 6, 3, dir.z * 6), C.dust, { size: heavy ? 22 : 13, life: 1.1, grav: 0.1, alpha: 0.3, grow: 1.6 });
    this.fx.light(p, 0xffa050, heavy ? 900 : 500, 0.2, 90);
  }
  /** A blow into a lava crack: hot spatter. */
  lavaHit(p, dir, heavy) {
    for (let i = 0; i < (heavy ? 40 : 24); i++) {
      const v = _w.set(rand(-1, 1), rand(0, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9)).addScaledVector(dir, -rand(1, 5));
      this.add.emit(p, v, Math.random() < 0.35 ? C.hot : C.lava, { size: rand(0.06, 0.18), life: rand(0.3, 0.8), drag: 1.2, grav: -14, alpha: 1 });
    }
    this.embers(p, heavy ? 14 : 8, { spread: 0.5, up: 3 });
    this.add.emit(p, _w.set(0, 0, 0), C.lava, { size: heavy ? 2.6 : 1.7, life: 0.1, grav: 0, alpha: 0.85 });
    this.fx.light(p, 0xff7a30, heavy ? 60 : 36, 0.18, 14);
  }
}

// ------------------------------------------------------------------------------------------------ ground marks

const MARK_VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Every mark fades to nothing well inside its quad (edge(uv)), so no straight edge of the decal ever shows: the warnings
// read as heat and cracks in the stone, not as squares laid on it.
const MARK_COMMON = /* glsl */`
  float mkH(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float mkN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mkH(i), mkH(i + vec2(1, 0)), f.x), mix(mkH(i + vec2(0, 1)), mkH(i + vec2(1, 1)), f.x), f.y); }
  float edge(vec2 uv){ vec2 q = abs(uv - 0.5); return smoothstep(0.5, 0.4, max(q.x, q.y)); }
  // thin branching cracks: bright where two noise layers cross their mid level
  float cracks(vec2 p){ float a = abs(mkN(p) - 0.5), b = abs(mkN(p * 2.3 + 7.1) - 0.5);
    return smoothstep(0.045, 0.0, a) * 0.8 + smoothstep(0.03, 0.0, b) * 0.45; }
  const vec3 EMBER = vec3(1.0, 0.27, 0.05);`;
const MARK_FS = {
  // the hand's shadow: dark, with a smouldering edge (premultiplied: rgb adds, alpha darkens)
  hand: /* glsl */`uniform sampler2D uMask; uniform float uDark; uniform float uGlow; uniform float uTime; varying vec2 vUv;
    ${MARK_COMMON}
    void main(){ float m = texture2D(uMask, vUv).r * edge(vUv);
      float rim = smoothstep(0.06, 0.4, m) * (1.0 - smoothstep(0.4, 0.9, m));
      float fl = 0.75 + 0.25 * sin(uTime * 11.0 + vUv.y * 23.0 + vUv.x * 7.0);
      float cr = cracks(vUv * 9.0) * smoothstep(0.35, 0.8, m);
      gl_FragColor = vec4(EMBER * (rim * fl + cr * 0.5 * uGlow) * uGlow, m * uDark); }`,
  // a crack that opens along the slam line (uProg reveals it from near to far)
  line: /* glsl */`uniform float uGlow; uniform float uProg; uniform float uTime; uniform float uLen; uniform float uW; uniform float uDark; varying vec2 vUv;
    ${MARK_COMMON}
    float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
    float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
    void main(){ float y = vUv.y * uLen;
      float off = (n1(y * 0.3) - 0.5) * 1.1 + (n1(y * 1.6 + 4.0) - 0.5) * 0.4;
      float x = (vUv.x - 0.5) * uW - off;
      float core = 1.0 - smoothstep(0.03, 0.12 + 0.3 * uGlow, abs(x));
      // side cracks branching off the main split
      float side = cracks(vec2(x * 0.9, y * 0.35)) * (1.0 - smoothstep(0.4, uW * 0.42, abs(x)));
      float halo = 1.0 - smoothstep(0.2, uW * 0.42, abs(x));
      float front = smoothstep(uProg * uLen + 1.5, uProg * uLen - 1.5, y) * smoothstep(0.0, 2.0, y) * smoothstep(uLen, uLen - 4.0, y);
      float ex = smoothstep(0.5, 0.36, abs(vUv.x - 0.5));
      float fl = 0.7 + 0.3 * sin(uTime * 8.0 + y * 0.7);
      gl_FragColor = vec4(EMBER * (core * 1.4 + side * 0.5 + halo * 0.08) * uGlow * front * fl * ex, (halo * 0.3 + uDark * 0.3) * front * ex); }`,
  // a lava bomb's / a stomp's landing: the ground scorches dark inside the circle and splits into glowing cracks,
  // its burning edge brightening toward the moment of impact
  ring: /* glsl */`uniform float uT; uniform float uFade; uniform float uTime; varying vec2 vUv;
    ${MARK_COMMON}
    void main(){ vec2 c = vUv - 0.5; float d = length(c) * 2.0; float ang = atan(c.y, c.x);
      float wob = (mkN(vec2(ang * 3.0, 1.7)) - 0.5) * 0.08;
      float rim = smoothstep(0.075, 0.0, abs(d - 0.92 - wob)) * (0.6 + 0.4 * mkN(vec2(ang * 9.0, uTime * 0.7)));
      float inside = 1.0 - smoothstep(0.88, 0.98, d + wob);
      float reveal = 1.0 - smoothstep(uT - 0.12, uT, d);
      float cr = cracks(vec2(ang * 2.2, d * 3.2) + 3.0) * inside * reveal;
      float k = (1.0 - uFade) * (0.85 + 0.15 * sin(uTime * 12.0)) * edge(vUv);
      gl_FragColor = vec4(EMBER * (rim * (0.25 + 0.75 * uT) + cr * (0.25 + 0.9 * uT)) * k, (inside * reveal * 0.32 + rim * 0.15) * k); }`,
  // burning ground left by the breath
  fire: /* glsl */`uniform float uT; uniform float uTime; uniform float uFade; uniform float uBig; varying vec2 vUv;
    ${MARK_COMMON}
    void main(){ vec2 c = vUv - 0.5; float d = length(c) * 2.0;
      float body = 1.0 - smoothstep(0.3, 0.85, d + 0.22 * (mkN(vUv * 6.0 + uTime * 0.6) - 0.5));
      float flame = mkN(vUv * 9.0 + vec2(0.0, -uTime * 2.2)) * mkN(vUv * 4.0 - uTime * 0.7);
      float k = body * (1.0 - uFade) * edge(vUv);
      // (uBig: 锤地's field on a floor that is already lava - white-hot, with a hard bright edge, so it reads at a glance)
      float ring = smoothstep(0.66, 0.74, d) * (1.0 - smoothstep(0.76, 0.84, d)) * (1.0 - uFade) * uBig;
      vec3 col = mix(vec3(1.0, 0.31, 0.06) * (0.18 + 1.2 * flame), vec3(1.25, 0.62, 0.16) * (0.3 + 1.0 * flame), uBig);
      gl_FragColor = vec4(col * k + vec3(1.3, 0.5, 0.1) * ring, min(1.0, k * (0.5 + 0.25 * uBig) + ring * 0.7)); }`,
};
const PREMULT = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation };

function handMaskTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.filter = 'blur(7px)';
  g.fillStyle = '#fff';
  // palm toward the bottom of the canvas (the wrist, near him), fingers toward the top (away from him)
  g.beginPath(); g.ellipse(S * 0.5, S * 0.64, S * 0.2, S * 0.2, 0, 0, Math.PI * 2); g.fill();
  const finger = (x, y, len, w, a) => { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, -len / 2, w, len / 2, 0, 0, Math.PI * 2); g.fill(); g.restore(); };
  finger(S * 0.37, S * 0.5, S * 0.3, S * 0.05, -0.18);
  finger(S * 0.46, S * 0.46, S * 0.36, S * 0.052, -0.05);
  finger(S * 0.55, S * 0.47, S * 0.34, S * 0.05, 0.07);
  finger(S * 0.63, S * 0.52, S * 0.27, S * 0.045, 0.2);
  finger(S * 0.31, S * 0.72, S * 0.24, S * 0.05, -1.0);
  g.fillRect(S * 0.38, S * 0.7, S * 0.24, S * 0.28);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
  return t;
}
let HAND_MASK = null;

/** A decal lying on the ground (conforms to arena.groundY), drawn with one of MARK_FS. */
class GroundMark {
  constructor(scene, arena, kind, { w = 10, l = 10, segs = 16, uniforms = {} } = {}) {
    this.scene = scene; this.arena = arena; this.w = w; this.l = l; this.segs = segs;
    this.geo = new THREE.PlaneGeometry(1, 1, segs, segs);
    this.base = this.geo.attributes.position.array.slice();       // local grid (x, y in [-0.5, 0.5])
    this.u = { uTime: { value: 0 }, ...uniforms };
    this.mat = new THREE.ShaderMaterial({ vertexShader: MARK_VS, fragmentShader: MARK_FS[kind], uniforms: this.u,
      transparent: true, depthWrite: false, ...PREMULT, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.x = 0; this.z = 0; this.yaw = 0;
  }
  /** Center (x, z), yaw (local +y of the decal points along yaw), size w x l. */
  place(x, z, yaw = this.yaw, w = this.w, l = this.l) {
    this.x = x; this.z = z; this.yaw = yaw; this.w = w; this.l = l;
    const p = this.geo.attributes.position, b = this.base;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;       // forward, right on the ground
    const gy = this.arena?.groundY;
    for (let i = 0; i < p.count; i++) {
      const u = b[i * 3] * w, v = b[i * 3 + 1] * l;
      const X = x + rx * u + fx * v, Z = z + rz * u + fz * v;
      p.setXYZ(i, X, (gy ? gy(X, Z) : 0) + 0.12, Z);
    }
    p.needsUpdate = true;
    this.geo.computeBoundingSphere();
    return this;
  }
  remove() { this.scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); this.dead = true; }
}

// ------------------------------------------------------------------------------------------------ the bull

const PARTS = ['handL', 'handR', 'kneeL', 'kneeR'];

export class BullKing {
  constructor({ char, scene, fx, audio, arena, cam, staff = null, beast = null }) {
    this.T = { ...BULL_TUNING };
    this.char = char; this.scene = scene; this.fx = fx; this.audio = audio; this.arena = arena; this.cam = cam;
    if (!char.root.parent) scene.add(char.root);
    this.staff = staff || makeBullStaff();
    this.beast = beast; this.beastOn = false;          // 现原形: the white bull he becomes for the charge
    if (beast && !beast.root.parent) scene.add(beast.root);
    if (!this.staff.userData.length) this.staff.userData = { ...this.staff.userData, length: this.T.staffLength, gripFrac: this.T.staffGrip };
    // (the fist closes round the rod at its own radius: Actor.fistOn / wrapHand)
    if (!this.staff.userData.radius) this.staff.userData.radius = this.T.staffRadius;
    this.bfx = new BullFX(fx);
    this.B = char.bones;
    this.pos = new THREE.Vector3(); this.yaw = 0;
    char.root.updateMatrixWorld(true);
    this.centerClips();
    this.calibrate();           // before the first pose: bind-pose frames of the head and hands
    this.prepareCloth();
    this.a = new Actor(char, { lib: BULL, hold: SEAT_SLEEP, sword: this.staff, scene, fist: true });
    this.rig = this.a.rig;
    this.a.playBase('idle', { fade: 0 });
    this.a.setBaseTimeScale(0.55);
    this.look = applyBullLook(char, { bindToMeters: this.bindToMeters });
    this.maxHp = this.T.maxHp;
    this.events = [];
    this.time = 0;
    this.holdPose = { ...SEAT, spine: [...SEAT.spine], head: [...SEAT.head] };
    this.zones = []; this.locks = [];
    this.weak = {};
    for (const p of PARTS) this.weak[p] = { part: p, hp: this.T.weakHp, max: this.T.weakHp, broken: false, active: true, flash: 0, glow: 0.5, regrowT: 0, exposedT: 0, burst: 0, pos: new THREE.Vector3() };
    this.hazards = []; this.marks = []; this.groundFires = [];
    this.staffButt = new THREE.Vector3(); this.staffTip = new THREE.Vector3(); this.prevButt = new THREE.Vector3(); this.prevTip = new THREE.Vector3();
    this.makeEyes();
    this.reset();
  }

  // --------------------------------------------------------------------------------------------- setup

  /**
   * Keep the hips over the root: every clip's Hips position track is centred on the rest pose, and the sideways sway of
   * the idles (a few metres at this scale) is damped to a slow weight shift. The walk keeps its stride.
   */
  centerClips() {
    const rest = this.B.Hips.position.clone();
    for (const [name, clip] of Object.entries(this.char.clips)) {
      const tr = clip.tracks.find(t => /Hips\.position$/.test(t.name));
      if (!tr) continue;
      const v = tr.values, n = v.length / 3, k = /walk|run/.test(name) ? 1 : 0.15;
      let mx = 0, mz = 0;
      for (let i = 0; i < n; i++) { mx += v[i * 3]; mz += v[i * 3 + 2]; }
      mx /= n; mz /= n;
      for (let i = 0; i < n; i++) { v[i * 3] = rest.x + (v[i * 3] - mx) * k; v[i * 3 + 2] = rest.z + (v[i * 3 + 2] - mz) * k; }
    }
  }

  /**
   * Cloth that hangs off the legs (a robe, the loincloth plates) is skinned to the thighs and shins; folded into the
   * seat, it would swing out with them like flat wings. Vertices weighted to a leg bone but lying well away from that
   * limb hand part of that weight to the hips while he sits (setClothRelax 1), and get it back as he stands (0).
   */
  prepareCloth() {
    const mesh = this.char.mesh, geo = mesh?.geometry;
    if (!geo?.attributes.skinWeight || !geo.attributes.skinIndex) return;
    // plain (de-interleaved, float) copies we can rewrite cheaply
    const plain = (attr, Type) => {
      const a = new Type(attr.count * 4);
      for (let i = 0; i < attr.count; i++) for (let k = 0; k < 4; k++) a[i * 4 + k] = attr.getComponent(i, k);
      return new THREE.BufferAttribute(a, 4);
    };
    geo.setAttribute('skinIndex', plain(geo.attributes.skinIndex, Uint16Array));
    geo.setAttribute('skinWeight', plain(geo.attributes.skinWeight, Float32Array));
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, pos = geo.attributes.position;
    const bones = mesh.skeleton.bones, name = b => b.name.replace(/^mixamorig:?/, '');
    const bindPos = {};
    bones.forEach((b, i) => { _m.copy(mesh.skeleton.boneInverses[i]).invert(); bindPos[name(b)] = new THREE.Vector3().setFromMatrixPosition(_m); });
    const index = n => bones.findIndex(b => name(b) === n);
    const hipsI = index('Hips');
    if (hipsI < 0) return;
    const segs = {};
    for (const s of ['Left', 'Right']) {
      const toe = bindPos[s + 'ToeBase'] || bindPos[s + 'Foot'];
      segs[index(s + 'UpLeg')] = [bindPos[s + 'UpLeg'], bindPos[s + 'Leg']];
      segs[index(s + 'Leg')] = [bindPos[s + 'Leg'], bindPos[s + 'Foot']];
      segs[index(s + 'Foot')] = [bindPos[s + 'Foot'], toe];
      if (bindPos[s + 'ToeBase']) segs[index(s + 'ToeBase')] = [bindPos[s + 'ToeBase'], bindPos[s + 'Toe_End'] || bindPos[s + 'ToeBase']];
    }
    const n = pos.count, p = new THREE.Vector3(), a = new THREE.Vector3(), d = new Float32Array(n * 4);
    const dist = (q, A, B) => { const ab = a.subVectors(B, A); const t = clamp(_v.subVectors(q, A).dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0, 1); return _w.copy(A).addScaledVector(ab, t).distanceTo(q); };
    // per leg bone: how far its own skin lies from the bone (a low percentile of its dominant vertices)
    const near = {};
    for (let v = 0; v < n; v++) {
      p.fromBufferAttribute(pos, v).applyMatrix4(mesh.bindMatrix);
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) {
        const bi = si.getComponent(v, k), w = sw.getComponent(v, k);
        d[v * 4 + k] = segs[bi] ? dist(p, segs[bi][0], segs[bi][1]) : 0;
        if (w > bw) { bw = w; best = bi; }
      }
      if (segs[best]) (near[best] || (near[best] = [])).push(d[v * 4 + [0, 1, 2, 3].find(k => si.getComponent(v, k) === best)]);
    }
    const rSkin = {};
    for (const [bi, list] of Object.entries(near)) { list.sort((x, y) => x - y); rSkin[bi] = list[Math.floor(list.length * 0.3)] || 0; }
    const orig = new Float32Array(sw.array), relaxed = new Float32Array(sw.array), idx = si.array;
    let moved = 0;
    for (let v = 0; v < n; v++) {
      let give = 0, hasHips = -1;
      const f = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const bi = si.getComponent(v, k), w = sw.getComponent(v, k);
        if (bi === hipsI) hasHips = k;
        if (!segs[bi] || w <= 0) continue;
        const r = Math.max(rSkin[bi] || 0, 1e-6);
        f[k] = smooth(r * 1.25, r * 2.1, d[v * 4 + k]) * 0.85;
        give += w * f[k];
      }
      if (give < 0.02) continue;
      moved++;
      if (hasHips < 0) {
        // make room for the hips: drop the weakest influence (its weight goes to the others in both versions)
        let lo = 0;
        for (let k = 1; k < 4; k++) if (sw.getComponent(v, k) < sw.getComponent(v, lo)) lo = k;
        const wl = orig[v * 4 + lo], rest = 1 - wl;
        for (let k = 0; k < 4; k++) orig[v * 4 + k] = k === lo ? 0 : orig[v * 4 + k] / Math.max(rest, 1e-6);
        idx[v * 4 + lo] = hipsI; hasHips = lo; f[lo] = 0;
        give = 0;
        for (let k = 0; k < 4; k++) give += orig[v * 4 + k] * f[k];
      }
      for (let k = 0; k < 4; k++) relaxed[v * 4 + k] = k === hasHips ? orig[v * 4 + k] + give : orig[v * 4 + k] * (1 - f[k]);
    }
    si.needsUpdate = true;
    this.cloth = { sw, orig, relaxed, k: -1, moved };
  }

  /** 0 = the model's own skinning, 1 = cloth hangs from the hips (seated). */
  setClothRelax(k) {
    const c = this.cloth;
    if (!c || Math.abs(c.k - k) < 1e-3) return;
    c.k = k;
    const out = c.sw.array, o = c.orig, r = c.relaxed;
    for (let i = 0; i < out.length; i++) out[i] = o[i] + (r[i] - o[i]) * k;
    c.sw.needsUpdate = true;
  }

  /** Bind-pose measurements: limb sizes, the head frame, the backs of the hands, bind-space anchors for the cracks. */
  calibrate() {
    const B = this.B, mesh = this.char.mesh, root = this.char.root;
    const wp = n => B[n].getWorldPosition(new THREE.Vector3());
    const F = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    const U = UP.clone(), R = new THREE.Vector3().crossVectors(F, U).normalize();
    // bind space (skeleton space) positions
    const bind = {};
    mesh.skeleton.bones.forEach((b, i) => {
      _m.copy(mesh.skeleton.boneInverses[i]).invert();
      bind[b.name.replace(/^mixamorig:?/, '')] = new THREE.Vector3().setFromMatrixPosition(_m);
    });
    this.bindToMeters = wp('Hips').distanceTo(wp('Head')) / Math.max(1e-6, bind.Hips.distanceTo(bind.Head));
    const headTop = B.HeadTop_End ? wp('HeadTop_End') : wp('Head').addScaledVector(U, 3);
    this.headSize = wp('Head').distanceTo(headTop);
    const local = (bone, dir) => dir.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    this.headF = local(B.Head, F); this.headU = local(B.Head, U); this.headR = local(B.Head, R);
    this.hand = {};
    for (const s of ['Left', 'Right']) {
      const h = wp(s + 'Hand'), m1 = wp(s + 'HandMiddle1'), tipBone = B[s + 'HandMiddle4'] ? s + 'HandMiddle4' : s + 'HandMiddle3';
      const tip = B[tipBone] ? wp(tipBone) : m1.clone().add(m1.clone().sub(h));
      const len = h.distanceTo(tip);
      const axis = m1.clone().sub(h).normalize();
      const side = wp(s + 'HandIndex1').sub(wp(s + 'HandPinky1')).normalize();
      let back = new THREE.Vector3().crossVectors(axis, side).normalize();
      const out = h.clone().sub(wp('Spine2')); out.y = 0;
      if (back.dot(out) < 0) back.negate();            // A-pose: the back of the hand faces away from the body
      this.hand[s] = { len, back: local(B[s + 'Hand'], back), bindC: bind[s + 'Hand'].clone().lerp(bind[s + 'HandMiddle1'], 0.75), bindR: (len * 0.42) / this.bindToMeters };
    }
    this.legLen = (wp('LeftUpLeg').distanceTo(wp('LeftLeg')) + wp('LeftLeg').distanceTo(wp('LeftFoot')));
    this.armLen = (wp('LeftArm').distanceTo(wp('LeftForeArm')) + wp('LeftForeArm').distanceTo(wp('LeftHand')));
    // sit the hips down onto the seat whatever the model's leg / hip proportions (the white bull's hip bone sits high
    // above long hooves: the fixed drop of the old model left him floating with his knees out of reach)
    const hipsY = wp('Hips').y - this.char.root.getWorldPosition(new THREE.Vector3()).y;   // rest hips height above the soles
    if (hipsY > 0 && this.legLen > 0) {
      const drop = (hipsY - BULL_TUNING.seatHipsUp * this.legLen) / this.legLen;
      if (drop > SEAT.hips[1] * -1) SEAT.hips[1] = -drop;        // shared by every seated pose (SEAT, SEAT_SLEEP, holdPose)
    }
    // the hooves: the skin that belongs to the toe bone (the hoof proper, not the robe or the hair that the foot also
    // carries), kept in its bone's frame — what he actually stands on — and the hoof's point, in the foot bone's frame
    this.soles = { Left: [], Right: [] }; this.hoofTip = {};
    {
      const geo = mesh.geometry, P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
      const sk = mesh.skeleton, bn = sk.bones.map(b => b.name.replace(/^mixamorig:?/, ''));
      const cand = { Left: [], Right: [] }, p = new THREE.Vector3();
      for (let v = 0; v < P.count; v++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (SW.getComponent(v, k) > SW.getComponent(v, best)) best = k;
        if (SW.getComponent(v, best) < 0.55) continue;
        const bi = SI.getComponent(v, best), m = /^(Left|Right)(ToeBase|Toe_End)$/.exec(bn[bi]);
        if (!m) continue;
        p.fromBufferAttribute(P, v).applyMatrix4(mesh.bindMatrix);
        const toe = bind[m[1] + 'ToeBase'], foot = bind[m[1] + 'Foot'];
        if (p.distanceTo(toe) > foot.distanceTo(toe) * 2.2) continue;         // (a stray strand of cloth)
        cand[m[1]].push({ p: p.clone(), bi });
      }
      for (const s of ['Left', 'Right']) {
        const list = cand[s], foot = bind[s + 'Foot'], fi = sk.bones.indexOf(B[s + 'Foot']);
        if (!list.length || fi < 0) continue;
        const step = Math.max(1, Math.floor(list.length / 90));
        for (let i = 0; i < list.length; i += step) {
          const c = list[i];
          this.soles[s].push({ bone: sk.bones[c.bi], local: c.p.clone().applyMatrix4(sk.boneInverses[c.bi]) });
        }
        let tip = list[0];
        for (const c of list) if (c.p.distanceToSquared(foot) > tip.p.distanceToSquared(foot)) tip = c;
        this.hoofTip[s] = tip.p.clone().applyMatrix4(sk.boneInverses[fi]);
      }
    }
    this.knee = {};
    const toBind = this.char.model.getWorldQuaternion(new THREE.Quaternion()).invert();
    const Fb = F.clone().applyQuaternion(toBind).normalize();
    for (const s of ['Left', 'Right']) {
      const k = bind[s + 'Leg'], f = bind[s + 'Foot'], t = bind[s + 'UpLeg'];
      const fwd = Fb.clone().multiplyScalar(0.05 * this.legLen / this.bindToMeters);
      // phase one: the kneecap; phase two: the crack runs from the knee down the shin to the ankle
      this.knee[s] = { a1: k.clone().lerp(t, 0.08).add(fwd), b1: k.clone().lerp(f, 0.12).add(fwd), r1: (0.14 * this.legLen) / this.bindToMeters,
        a2: k.clone().lerp(f, 0.5).add(fwd), b2: f.clone().lerp(bind[s + 'ToeBase'] || f, 0.75), r2: (0.15 * this.legLen) / this.bindToMeters };
    }
  }

  makeEyes() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,120,60,1)'); grd.addColorStop(0.3, 'rgba(200,40,8,0.8)'); grd.addColorStop(1, 'rgba(90,6,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.eyeMats = []; this.eyeSprites = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1, 0.5, 0.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
      const s = new THREE.Sprite(m); s.renderOrder = 8; this.scene.add(s);
      this.eyeMats.push(m); this.eyeSprites.push(s);
    }
    this.eyes = 0; this.eyesWant = 0;
    // the throat glow while he draws breath
    this.mouthGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1, 0.55, 0.25), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.mouthGlow.renderOrder = 8; this.scene.add(this.mouthGlow);
  }

  /** Back to the seat, asleep, full health (retry). */
  reset(seat = this.arena?.bullSeat) {
    seat = seat || { x: 0, z: -30, yaw: 0 };
    const gy = seat.y ?? (this.arena?.groundY ? this.arena.groundY(seat.x, seat.z) : 0);
    this.seat = { x: seat.x, z: seat.z, yaw: seat.yaw ?? 0, y: gy };
    this.pos.set(seat.x, gy, seat.z); this.yaw = this.seat.yaw;
    this.hp = this.maxHp; this.phase = 1; this.dead = false; this.state = 'dormant'; this.invulnerable = true;
    this.poise = 0; this.poiseT = 0; this.cooldown = 2; this.cds = { sweep: 0, slam: 0, palm: 0, breath: 6, grab: 4, stomp: 0, horn: 0, quake: 5, meteor: 8, throw: 12 };
    this.lastAttack = ''; this.atk = null; this.frontT = 0; this.brokenCount = 0; this.downT = 0; this.critTaken = false;
    this.timeline = []; this.deathT = 0; this.sink = 0; this.aimYaw = 0; this.aimWant = 0; this.mirror = false;
    this.lookYaw = 0; this.lookPitch = 0; this.wakeK = 0; this.eyes = 0; this.eyesWant = 0; this.autoAttack = true;
    this.hasStaff = true; this.staffMode = 'hand'; this.staffBlend = 1; this.a.sword = this.staff; this.staff.visible = true;
    this.ik = { Left: null, Right: null }; this.carry = null; this.critYank = 0; this.thrown = null;
    this.lift = 0; this.liftW = 0; this.preludeHits = 0; this.openingT = -1; this.duel = false; this.enraged = false; this.flinchT = 0; this.reeling = false; this.chain = null; this.chainQ = []; this.armor = false; this.armorDownT = 0; this.jumpY = 0;
    this.goldT = 0; this.goldK = 0; this.goldNext = 1 - this.T.goldStep; this.goldPending = false;
    if (this.beastOn) this.setBeast(false, true);
    for (const p of PARTS) this.resetWeak(p, 1);
    for (const h of this.hazards) h.remove?.(); this.hazards = [];
    for (const m of this.marks) m.remove(); this.marks = [];
    for (const f of this.groundFires) f.mark.remove(); this.groundFires = [];
    if (this.stuckCollider && this.arena?.colliders) { const i = this.arena.colliders.indexOf(this.stuckCollider); if (i >= 0) this.arena.colliders.splice(i, 1); }
    this.stuckCollider = null;
    this.a.stopMove(); this.a.hold = this.holdPose; this.a.holdW = 1;
    this.look.uniforms.bkC.value.z = 0; this.look.uniforms.bkC.value.x = 0;
    this.setClothRelax(1);
    this.syncRoot();
    this.a.update(0);
    this.afterPose(0);
    this.updateZones();
  }

  resetWeak(p, phase) {
    const w = this.weak[p];
    const knee = p.startsWith('knee');
    w.max = phase === 2 && knee ? this.T.kneeHp2 : this.T.weakHp;
    w.hp = w.max; w.broken = false; w.flash = 0; w.burst = 0; w.regrowT = 0; w.exposedT = 0;
    w.active = phase === 1 || knee;
  }

  /** The wake cutscene ends: eyes open, the fight begins. */
  wake({ opening = true } = {}) {
    if (this.dead) return;
    this.state = 'idle'; this.invulnerable = false; this.eyesWant = 1; this.cooldown = 2.2;
    this.say('bull_roar', { volume: 0.7, pitch: 0.8 }, 'boss_death');
    // seated, his first move is always the opening blow (unless the cinematic has already played it)
    if (opening && this.phase === 1 && this.T.openingRest > 0) this.openingT = this.T.openingDelay;
  }

  /**
   * The opening blow of the fight (also the last beat of the opening cinematic): seated, he brings the staff down at
   * `target` (a ground point; default: the player, else straight ahead), and then leaves it lying where it fell with
   * both hands on it for `rest` seconds — the first thing the monkey gets to hit. Works from the dormant state (it
   * wakes him: eyes open, he can be hurt). Timeline from the call, in seconds: 0.5 the staff is overhead (ground line
   * shows), ~2.0 it lands (OPENING_SLAM.impact), ~2.45 the ground erupts along the line, ~2.9 the staff lies still
   * (OPENING_SLAM.rest) and stays for `rest` s, then 1.2 s back into the seat. Returns false when it cannot start.
   */
  openingSlam({ target = null, rest = this.T.openingRest, hold = 0.3 } = {}) {
    if (this.dead || this.phase !== 1 || this.state === 'transition') return false;
    this.cancelAttack();
    this.invulnerable = false; this.eyesWant = 1; this.openingT = -1; this.wakeK = Math.max(this.wakeK, 0.6);
    const p = this.player && !this.player.dead && !this.player.ghost ? this.player.pos : null;
    const at = (target || p || this.pos.clone().addScaledVector(this.fwd(_v), this.legLen * 1.6)).clone();
    this.startAttack('slam', { pos: at });
    this.atk.holdFor = hold; this.atk.restFor = rest; this.atk.opening = true; this.atk.aimAt = at;
    return true;
  }

  hurtZones() { return this.zones; }
  lockTargets() { return this.locks; }

  /** The iron ring through his nose (world). */
  noseRing(out = new THREE.Vector3()) {
    const hs = this.headSize, head = this.bonePos('Head', out);
    return head.addScaledVector(this.headAxis('F', _ha), 0.62 * hs).addScaledVector(this.headAxis('U', _hb), -0.62 * hs);
  }

  /** Where the monkey stands for 牵牛鼻子, and the ring he grabs. */
  critAnchor() {
    const ring = this.noseRing(new THREE.Vector3());
    const f = this.headAxis('F', new THREE.Vector3()); f.y = 0; if (f.lengthSq() < 1e-6) f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); f.normalize();
    const stand = ring.clone().addScaledVector(f, 2.2); stand.y = this.groundAt(stand.x, stand.z);
    return { ring, pos: stand, yaw: Math.atan2(-f.x, -f.z) };
  }

  /** Circles the player must not walk through (body, knees / feet, hands resting on the ground). */
  colliders() { return this.bodyCircles || []; }

  /** What the camera should frame: the part that is about to strike, and whether to pull back. */
  threat() {
    const t = this._threat || (this._threat = { part: 'body', pos: new THREE.Vector3(), radius: 14, big: false });
    t.big = false; t.radius = 14; t.part = 'body';
    this.bonePos('Spine2', t.pos);
    const at = this.atk;
    if (this.state === 'attack' && at) {
      const n = at.name;
      // (the staff lying still after the slam is not framed: 2026-11-17 user: the lock is on the bull himself, not his staff)
      if (n === 'slam' && at.resting) { /* body */ }
      else if (n === 'sweep' || n === 'slam') { t.part = 'staff'; t.pos.copy(this.staffButt).lerp(this.staffTip, 0.55); t.big = true; t.radius = 26; }
      else if (n === 'palmL' || n === 'palmR' || n === 'grab' || n === 'grabSlam') { t.part = n === 'palmR' ? 'handR' : 'handL'; this.bonePos(n === 'palmR' ? 'RightHand' : 'LeftHand', t.pos); t.radius = 10; }
      else if (n === 'breath') { t.part = 'head'; if (at.fireTarget) t.pos.copy(at.fireTarget); t.big = true; t.radius = 30; }
      else if (n === 'stompL' || n === 'stompR') { t.part = n === 'stompL' ? 'kneeL' : 'kneeR'; this.bonePos(n === 'stompL' ? 'LeftFoot' : 'RightFoot', t.pos); t.big = true; t.radius = 30; }
      else if (n === 'horn') { t.part = 'head'; this.bonePos('Head', t.pos); t.big = true; t.radius = 22; }
      else if (n === 'meteor') { t.part = 'sky'; t.pos.set(this.pos.x, 20, this.pos.z).addScaledVector(this.fwd(_v), 25); t.big = true; t.radius = 40; }
      else if (n === 'combo2' || n === 'charge') { t.big = true; }
      else if (n === 'throw') { t.part = 'staff'; t.pos.copy(at.target || this.staffTip); t.big = true; t.radius = 24; }
    } else if (this.state === 'down') { t.part = 'head'; this.bonePos('Head', t.pos); t.radius = 10; }
    return t;
  }

  /** The AI may start this attack right now (tests, cutscenes). */
  forceAttack(name, player = this.player) {
    if (this.dead || !BULL[name]) return false;
    this.cancelAttack();
    this.startAttack(name, player);
    return true;
  }

  // --------------------------------------------------------------------------------------------- helpers

  say(name, opts = {}, ...fallbacks) {
    if (!this.audio?.play) return;
    const pick = !SFX_KNOWN ? name : [name, ...fallbacks].find(n => SFX_KNOWN.has(n));
    if (pick) this.audio.play(pick, { pos: opts.pos || this.pos, volume: opts.volume ?? 1, pitch: opts.pitch ?? 1, delay: opts.delay || 0 });
  }

  bonePos(name, out = new THREE.Vector3()) { return this.B[name].getWorldPosition(out); }
  headAxis(which, out = new THREE.Vector3()) {
    this.B.Head.getWorldQuaternion(_q);
    return out.copy(which === 'F' ? this.headF : which === 'U' ? this.headU : this.headR).applyQuaternion(_q);
  }
  fwd(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }
  groundAt(x, z) { return this.arena?.groundY ? this.arena.groundY(x, z) : 0; }
  /** Angle of p from his facing, positive toward his right (radians). */
  relAngle(p) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const f = this.fwd(_v), r = this.right(_w);
    return Math.atan2(dx * r.x + dz * r.z, dx * f.x + dz * f.z);
  }
  playerCapsule(player) {
    const c = this._pcap || (this._pcap = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.45 });
    const S = player.S || 1;        // (法相天地: a monkey of his own scale)
    c.a.set(player.pos.x, player.pos.y + 0.35 * S, player.pos.z); c.b.set(player.pos.x, player.pos.y + 1.25 * S, player.pos.z); c.r = 0.45 * S;
    return c;
  }
  /** True when an arena collider stands between (x0, z0) and (x1, z1) on the ground. */
  occluded(x0, z0, x1, z1) {
    const cols = this.arena?.colliders || [];
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
    if (L2 < 1e-6) return false;
    for (const c of cols) {
      const t = ((c.x - x0) * dx + (c.z - z0) * dz) / L2;
      if (t <= 0.02 || t >= 0.98) continue;
      const px = x0 + dx * t - c.x, pz = z0 + dz * t - c.z;
      if (px * px + pz * pz < c.r * c.r) return true;
    }
    return false;
  }
  hitPlayer(player, info, from, name) {
    if (!player || player.dead) return false;
    const r = player.takeHit({ dmg: info.dmg, from: from.clone ? from.clone() : from, kind: info.kind || 'heavy', blockable: !!info.blockable });
    if (r === 'parry') this.parried(from);
    else if (r) this.events.push({ type: 'hitPlayer', name, result: r });
    return r;
  }

  // --------------------------------------------------------------------------------------------- damage

  takeHit({ dmg = 0, poise = 0, point, dir, heavy = false, from, part, fan = false } = {}) {
    if (this.dead) return;
    point = point || this.bonePos('Spine2');
    dir = dir || new THREE.Vector3(0, 0, -1);
    if (!part) part = this.partAt(point);
    const w = this.weak[part];
    if (this.invulnerable || this.state === 'dormant') {
      this.bfx.stoneHit(point, dir, false);
      this.say('staff_hit', { pos: point, volume: 0.6 }, 'block');
      return;
    }
    if (this.goldT > 0) { this.goldRebound(point, fan); return; }
    let mul = this.T.bodyMul, lava = false;
    if (this.duel) { mul = this.T.duelMul * (part === 'head' ? this.T.duelHead : 1) * (this.reeling ? this.T.reelMul : 1); lava = true; if (this.armored) mul *= this.T.armorMul; }      // giant against giant: every blow tells (less through the fire he wears)
    else if (w && w.active) {
      lava = true;
      if (!w.broken) {
        const k = (heavy ? this.T.heavyWeakMul : 1) * (w.exposedT > 0 ? this.T.exposedMul : 1);
        w.hp -= dmg * k; w.flash = 1;
        mul = this.T.weakMul * (w.exposedT > 0 ? this.T.exposedMul : 1);
        if (w.hp <= 0) this.breakWeak(part, point);
      } else mul = this.T.brokenMul;
    } else if (part === 'head') { mul = this.state === 'down' ? this.T.headMul : this.T.bodyMul * 2; lava = this.state === 'down'; }
    let total = dmg * mul;
    if (this.phase === 1) {
      // the prologue: every blow of the staff counts toward getting him on his feet; his health barely moves
      if (!fan && this.state !== 'transition') this.preludeHits++;
      total = Math.min(total, Math.max(0, this.hp - this.maxHp * (this.T.preludeHp - 0.02)));
    }
    this.hp -= total;
    while (this.phase >= 2 && this.hp > 0 && this.hp <= this.maxHp * this.goldNext + 1e-6) { this.goldNext -= this.T.goldStep; this.goldPending = true; }
    const armored = this.armored;
    this.events.push({ type: 'damage', amount: total, part, weak: !!(w && w.active), armored, prelude: this.phase === 1 ? this.preludeHits : undefined });
    if (armored) this.bfx.stoneHit(point, dir, heavy);
    if (this.duel) {
      // at the giants' scale: a blow you can see from across the caldera, and feel in him
      this.bfx.giantHit(point, dir, heavy);
      if (heavy) { this.fx.shockwave(point, 15, 0.4, new THREE.Color(1.0, 0.6, 0.25)); this.say('bull_slam', { pos: point, volume: 0.5, pitch: 1.5 }, 'boss_step'); }
      const push = heavy ? 1.6 : 0.5;
      if (from) { const ax = this.pos.x - from.x, az = this.pos.z - from.z, al = Math.hypot(ax, az) || 1; this.pos.x += ax / al * push; this.pos.z += az / al * push; this.keepIn(); }
    }
    if (lava) { if (!this.duel) this.bfx.lavaHit(point, dir, heavy); this.say(heavy ? 'staff_hit_heavy' : 'staff_hit', { pos: point }, heavy ? 'hit_heavy' : 'hit_flesh'); }
    else { this.bfx.stoneHit(point, dir, heavy); this.say(heavy ? 'staff_hit_heavy' : 'staff_hit', { pos: point, pitch: part === 'staff' ? 1.25 : 0.8 }, 'block'); }
    if (part === 'staff') this.staffGlow = Math.max(this.staffGlow || 0, heavy ? 1 : 0.6);
    this.fx.flashMesh(this.char.model, new THREE.Color(1, 0.4, 0.15), heavy ? 0.14 : 0.08, lava ? (heavy ? 0.1 : 0.05) : 0.025);
    const away = from ? new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z) : dir.clone();
    this.a.jolt(away, this.duel ? (heavy ? 0.075 : 0.04) : lava ? (heavy ? 0.035 : 0.02) : 0.008, this.duel ? (heavy ? 0.004 : 0.002) : heavy ? 0.0016 : 0.001);
    this.cam?.addTrauma(heavy ? 0.22 : 0.1);
    if (heavy) this.cam?.zoomPunch?.(1.5);
    if (this.state !== 'down' && this.state !== 'transition' && this.state !== 'stagger') {
      this.poise += poise * (armored ? 0.5 : lava ? 1.4 : 0.6); this.poiseT = 3;
      if (this.poise >= (this.duel ? this.T.duelPoise : this.T.poiseMax)) this.stagger();
      else if (this.duel && heavy && this.hp > 0 && !armored) this.flinch();
    }
    this.checkThresholds();
  }

  /** 现真身: is the fire he wears up? (It is down for a while after the fan or a parry, and while his posture is broken.) */
  get armored() { return !!(this.duel && this.armor && this.armorDownT <= 0 && !this.reeling && !this.dead); }
  /** Blow the fire off him for `sec` seconds. Returns true when it was up. */
  breakArmor(sec = this.T.armorDown) {
    if (!this.duel || !this.armor || this.dead) return false;
    const was = this.armorDownT <= 0;
    this.armorDownT = Math.max(this.armorDownT, sec);
    if (!was) return false;
    const c = this.bonePos('Spine2');
    this.bfx.smoke(c, 26, { size: [10, 22], spread: 12, rise: 9, life: [1.6, 3.2], alpha: 0.4, color: C.ash });
    this.fx.shockwave(c, 34, 0.6, new THREE.Color(0.75, 0.8, 0.85));
    this.say('rock_crack', { pitch: 0.6, volume: 1 }, 'wax_crack');
    this.flinchT = 0; this.flinch();
    this.events.push({ type: 'armorBreak', sec });
    return true;
  }
  /** The duel's walls (wider than the prologue's: giants use the whole pit). */
  get bnd() { return (this.duel && this.arena?.duelBounds) || this.arena?.bounds; }

  /** Rocked or reeling: the monkey's blows bite a little longer. */
  get staggered() { return this.state === 'stagger'; }
  /** His posture, 0..1 (the duel's second bar): full = it breaks. */
  get posture() { return this.reeling ? 1 : clamp(this.poise / (this.duel ? this.T.duelPoise : this.T.poiseMax), 0, 1); }

  /** Keep him inside the caldera (pushed by blows, carried by his own charge). Returns true when a wall stopped him. */
  keepIn(margin = 14) {
    const b = this.bnd;
    if (!b) return false;
    const x = clamp(this.pos.x, b.minX + margin, b.maxX - margin), z = clamp(this.pos.z, b.minZ + margin, b.maxZ - margin);
    let hit = x !== this.pos.x || z !== this.pos.z;
    this.pos.x = x; this.pos.z = z;
    // the duel's pit is round: its corners are cliff (margin m short of the cliff's foot, the pit is ~145 m in radius)
    if (this.duel && this.arena?.pitClamp?.(this.pos, 1 - margin / 145)) hit = true;
    return hit;
  }

  /**
   * 僵直 (the duel): a heavy blow rocks him - when he stands idle, is still gathering a blow (before its tell is over) or
   * is recovering from one. A swing already on its way is not stopped (he has that much armour). Rate-limited.
   */
  flinch() {
    if (this.dead || this.flinchT > 0 || this.state === 'down' || this.state === 'transition' || this.state === 'stagger') return false;
    if (this.state === 'attack') {
      const at = this.atk, mv = this.a.move, def = at && at.def;
      if (!at || !mv) return false;
      const t = mv.t, last = def.hits ? def.hits[def.hits.length - 1][1] : def.impactAt ?? def.runEnd ?? (def.rain ? def.rain[1] : 0);
      const first = def.hits ? def.hits[0][0] : def.impactAt ?? def.runAt ?? (def.rain ? def.rain[0] : 0);
      if (at.name === 'meteor' ? t < first : !(t < first * 0.45 || t > last + 0.15)) return false;
    }
    this.cancelAttack();
    this.state = 'stagger'; this.reeling = false; this.flinchT = this.T.flinchCd;
    this.playMove('hit2');
    this.say('bull_roar', { pitch: 1.25, volume: 0.45 }, 'stagger');
    this.events.push({ type: 'flinch' });
    return true;
  }

  partAt(p) {
    let best = 'body', bd = Infinity;
    for (const z of this.zones) {
      const d = segSeg(z.a, z.b, p, p).dist - z.r;
      if (d < bd) { bd = d; best = z.part; }
    }
    return best;
  }

  checkThresholds() {
    if (this.hp <= 0) { this.die(); return true; }
    if (this.phase === 1 && this.state !== 'transition' && (this.preludeHits >= this.T.preludeHits || this.hp <= this.maxHp * this.T.preludeHp)) { this.startTransition(); return true; }
    return false;
  }

  breakWeak(part, point) {
    const w = this.weak[part];
    w.broken = true; w.hp = 0; w.burst = 1; w.flash = 1; w.regrowT = this.T.regrow;
    const p = point ? point.clone() : w.pos.clone();
    this.bfx.burst(w.pos.clone().lerp(p, 0.3), 1.0);
    this.arena?.shake?.(0.3);
    this.say('lava_burst', { pos: p }, 'pillar_blast');
    this.say('rock_crack', { pos: p, delay: 0.05 }, 'wax_crack');
    this.cam?.addTrauma(0.45); this.cam?.zoomPunch?.(3);
    this.events.push({ type: 'weakBreak', part });
    this.brokenCount++;
    // a broken hand on the ground is snatched back
    const at = this.atk;
    if (at && this.a.move && (part === 'handL' || part === 'handR')) {
      const side = part === 'handL' ? 'palmL' : 'palmR';
      if ((at.name === side || (at.name === 'grab' && part === 'handL')) && this.a.move.def.restEnd && this.a.move.t < this.a.move.def.restEnd) this.a.move.t = this.a.move.def.restEnd;
    }
    if (this.phase === 2 && this.weak.kneeL.broken && this.weak.kneeR.broken && this.state !== 'down') this.goDown();
  }

  /** Two cracks broken: he folds over, head to the ground — the execution window. */
  goDown() {
    this.cancelAttack();
    this.state = 'down'; this.critTaken = false; this.downOpen = false;
    const name = this.phase === 1 ? 'down' : 'kneel';
    this.playMove(name);
    this.say('bull_roar', { pitch: 0.7, volume: 1 }, 'boss_death');
    this.events.push({ type: 'down' });
    this.cam?.addTrauma(0.5);
  }

  criticalOpen(player) {
    if (this.dead || this.state !== 'down' || this.critTaken || !this.downOpen || !player) return false;
    const ring = this.noseRing(_v);
    return Math.hypot(player.pos.x - ring.x, player.pos.z - ring.z) < 7.5;
  }

  /** 牵牛鼻子: the monkey hauls on the nose ring and brings his staff down on the bull's forehead. */
  takeCritical({ dmg = 400, from, point } = {}) {
    if (this.dead) return;
    this.critTaken = true;
    this.hp -= dmg;
    const ring = this.noseRing(new THREE.Vector3());
    const brow = this.bonePos('Head').addScaledVector(this.headAxis('F', _v), 0.45 * this.headSize).addScaledVector(this.headAxis('U', _w), 0.15 * this.headSize);
    const p = point || brow;
    this.events.push({ type: 'damage', amount: dmg, part: 'head', weak: true });
    this.events.push({ type: 'critical', stage: 'hit', amount: dmg });
    this.bfx.burst(p, 0.8);
    this.bfx.lavaHit(ring, new THREE.Vector3(0, -1, 0), true);
    this.fx.flashMesh(this.char.model, new THREE.Color(1, 0.4, 0.15), 0.3, 0.14);
    this.say('critical', { pos: p });
    this.say('staff_hit_heavy', { pos: p, pitch: 0.8 }, 'hit_heavy');
    this.say('bull_roar', { pos: p, pitch: 0.65, delay: 0.25 }, 'stagger');
    this.cam?.addTrauma(0.8); this.cam?.zoomPunch?.(6);
    const away = from ? new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z) : this.fwd(new THREE.Vector3()).negate();
    this.a.jolt(away, 0.06, 0.003);
    this.critYank = 1;
    if (this.hp <= 0) { this.die(); return; }
    // he stays down a moment longer, then rises
    const mv = this.a.move;
    if (mv && mv.def.openEnd) mv.t = Math.max(mv.t, mv.def.openEnd - 0.8);
  }

  parried(from) {
    this.poise += 90; this.poiseT = 3;
    this.a.jolt(new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z), 0.03, 0.001);
    this.cam?.addTrauma(0.2);
    if (this.atk) this.atk.parried = true;
    this.chainQ.length = 0;
    this.breakArmor(this.T.armorParry);
    if (this.atk && this.a.move && (this.atk.name === 'sweep' || this.atk.name === 'sweep2' || this.atk.name === 'combo2')) this.a.move.speed = 0.45;       // the staff rebounds, the swing dies
    if (this.poise >= (this.duel ? this.T.duelPoise : this.T.poiseMax)) this.stagger();
  }

  /** 金身: a health threshold passed; he turns to gold as soon as he is on his feet and free (not down, rocked or in a cutscene). */
  tickGold(dt) {
    if (this.goldPending && !this.dead && this.phase >= 2 && (this.state === 'idle' || this.state === 'attack')) {
      this.goldPending = false; this.goldT = this.T.goldSec;
      const c = this.bonePos('Spine2');
      this.fx.shockwave(c, this.duel ? 40 : 14, 0.6, new THREE.Color(1.0, 0.78, 0.3));
      this.say('critical', { pos: c, pitch: 1.4, volume: 0.7 });
      this.say('bull_roar', { pos: c, pitch: 0.9, volume: 0.6, delay: 0.1 }, 'stagger');
      this.cam?.addTrauma(0.3);
      this.events.push({ type: 'gold' });
    }
    if (this.goldT > 0) {
      this.goldT -= dt;
      if (this.goldT <= 0) { this.goldT = 0; this.events.push({ type: 'goldEnd' }); this.goldCharge(); }
      if (Math.random() < dt * 30) {
        const q = this.bonePos(GOLD_BONES[(Math.random() * GOLD_BONES.length) | 0], _v), r = this.duel ? 3 : 1;
        this.bfx.add.emit(_w.set(q.x + rand(-r, r), q.y + rand(-r, r), q.z + rand(-r, r)), _p.set(rand(-1, 1), rand(2, 6) * (this.duel ? 2 : 1), rand(-1, 1)), C.gold, { size: rand(0.6, 1.4) * (this.duel ? 3 : 1), life: rand(0.4, 0.9), drag: 0.6, grav: -1, alpha: 0.8, grow: 0.6 });
      }
    }
    this.goldK += ((this.goldT > 0 ? 1 : 0) - this.goldK) * Math.min(1, dt * (this.goldT > 0 ? 8 : 4));
    this.look.uniforms.bkC.value.x = this.goldK;
  }

  /**
   * 组合技 (2026-11-17 user): the gold falls from him and at once he is the white bull, already lined up - the 3 s of
   * gold are the monkey's warning to get away (or to be ready to step aside).
   */
  goldCharge() {
    const p = this.player;
    if (this.dead || !this.duel || !this.beast || !p || p.dead || p.ghost || !(this.state === 'idle' || this.state === 'attack')) return false;
    this.yaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    this.forceAttack('charge', p);
    const mv = this.a.move, at = this.atk;
    if (mv && at) { mv.t = Math.max(mv.t, at.def.runAt - this.T.goldChargeLead); at.fired.add('tell'); at.combo = true; }
    this.cds.horn = this.T.chargeCd;
    this.say('bull_roar', { pitch: 0.6, volume: 1 }, 'stagger'); this.eyeFlare = 1;
    this.events.push({ type: 'goldCharge' });
    return true;
  }

  /** 金身: blows ring off the gold - he takes nothing, and the one who struck him reels back (僵直). */
  goldRebound(point, fan = false) {
    const p = point || this.bonePos('Spine2');
    this.goldK = 1;
    this.fx.shockwave(p, this.duel ? 18 : 6, 0.3, new THREE.Color(1.0, 0.85, 0.4));
    this.say('staff_hit', { pos: p, pitch: 1.6, volume: 1 }, 'block');
    this.cam?.addTrauma(0.3);
    if (!fan && this.player && !this.player.dead) this.player.recoil?.(p);
    this.events.push({ type: 'goldRebound' });
  }

  stagger() {
    if (this.dead || this.state === 'down' || this.state === 'transition') return;
    this.cancelAttack();
    this.poise = 0;
    this.state = 'stagger'; this.reeling = this.duel;
    this.playMove(this.phase === 1 ? 'flinch' : this.duel ? 'reel' : 'flinch2');
    this.say('bull_roar', { pitch: this.duel ? 0.8 : 1.1, volume: this.duel ? 1 : 0.6 }, 'stagger');
    this.events.push({ type: 'stagger', reel: this.duel });
    this.cam?.addTrauma(this.duel ? 0.5 : 0.25);
    if (this.duel) { this.flinchT = this.T.flinchCd; this.say('rock_crack', { pitch: 0.7 }, 'wax_crack'); this.bfx.giantHit(this.bonePos('Spine2'), this.fwd(new THREE.Vector3()), true); }
  }

  /**
   * The monkey's banana-leaf fan: { from: Vector3, dir: Vector3 (horizontal), range = 14, angle = 0.6 rad half-width }.
   * Blows his fire back into his face, puts out burning ground, and leaves lava cracks in the gust exposed for 3 s.
   * Returns { reflected, extinguished, exposed: [parts] }.
   */
  fanned({ from, dir, range = 14, angle = 0.6 } = {}) {
    const out = { reflected: false, extinguished: 0, exposed: [], armor: false };
    if (!from || !dir || this.dead) return out;
    const d = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const inCone = (x, z, extra = 0) => {
      const dx = x - from.x, dz = z - from.z, L = Math.hypot(dx, dz);
      if (L > range + extra) return false;
      return L < 1e-3 || (dx * d.x + dz * d.z) / L > Math.cos(angle);
    };
    if (inCone(this.pos.x, this.pos.z, 12) && this.breakArmor()) out.armor = true;
    for (const f of this.groundFires) if (!f.out && inCone(f.x, f.z, f.r)) { f.out = true; f.t = Math.max(f.t, f.life - 0.6); out.extinguished++; this.bfx.smoke(new THREE.Vector3(f.x, 0.5, f.z), 3, { size: [2, 4], rise: 3, alpha: 0.25, color: C.ash }); }
    const at = this.atk;
    if (at && at.name === 'breath' && at.breathing && !at.reflected) {
      // facing the bull and standing in (or right at the edge of) the stream
      const toBull = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z).normalize();
      const streamDir = at.fireDir ? Math.atan2(at.fireDir.x, at.fireDir.z) : 0;
      const toFan = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      const off = Math.abs(Math.atan2(Math.sin(toFan - streamDir), Math.cos(toFan - streamDir)));
      if (toBull.dot(d) > 0.6 && off < 0.35) { this.reflectFire(from); out.reflected = true; }
    }
    for (const p of PARTS) {
      const w = this.weak[p];
      if (w.active && !w.broken && inCone(w.pos.x, w.pos.z, 2) && w.pos.y - (from.y || 0) < 6) { w.exposedT = 3; out.exposed.push(p); }
    }
    return out;
  }

  reflectFire(from) {
    const at = this.atk;
    at.reflected = true; at.breathing = false;
    const head = this.bonePos('Head');
    // the stream folds back onto his own face
    for (let i = 0; i < 120; i++) {
      const s = new THREE.Vector3(from.x, from.y + 1.2, from.z).lerp(head, Math.random() * 0.9);
      const v = new THREE.Vector3().subVectors(head, from).normalize().multiplyScalar(rand(18, 30)).add(_w.set(rand(-3, 3), rand(-2, 4), rand(-3, 3)));
      this.bfx.add.emit(s, v, Math.random() < 0.15 ? C.fireCore : C.fire, { size: rand(1.2, 3.5), life: rand(0.4, 0.9), drag: 0.6, grav: 2, alpha: 0.4, grow: 1.5 });
    }
    this.bfx.burst(head, 1.2);
    this.hp -= this.T.reflectDmg;
    this.events.push({ type: 'damage', amount: this.T.reflectDmg, part: 'head', weak: true });
    this.events.push({ type: 'reflect' });
    this.say('fire_breath', { pos: head, pitch: 1.3, volume: 0.8 }, 'pillar_blast');
    this.say('bull_roar', { pos: head, pitch: 1.15 }, 'stagger');
    this.cam?.addTrauma(0.4);
    if (this.checkThresholds()) return;
    this.poise = 0;
    this.stagger();
  }

  // --------------------------------------------------------------------------------------------- phases

  startTransition() {
    this.cancelAttack();
    this.state = 'transition'; this.invulnerable = true;
    this.events.push({ type: 'phase2' });
    this.playMove('rise');
    const mv = this.a.move;
    this.transition = { t: 0, rootFrom: this.pos.clone() };
    this.run([
      [mv.def.roarAt, () => { this.say('bull_roar', { volume: 1.2, pitch: 0.62 }, 'boss_death'); this.cam?.addTrauma(0.5); this.arena?.shake?.(0.8); this.eyesWant = 1.6; }],
      [1.2, () => { this.arena?.eruption?.(this.pos.x, this.pos.z - 8, 1.6); this.bfx.burst(this.bonePos('Spine2'), 1.4); }],
      [mv.def.pushAt - mv.def.roarAt - 1.2, () => {
        for (const s of ['Left', 'Right']) { const h = this.bonePos(s + 'Hand'); h.y = this.groundAt(h.x, h.z); this.bfx.debris(h, 40, 10); this.bfx.dustRing(h, 8, 30); }
        this.say('bull_slam', { pitch: 0.7 }, 'boss_slam'); this.say('rock_crack', { pitch: 0.6, delay: 0.2 }, 'wax_crack');
        this.cam?.addTrauma(0.6); this.arena?.shake?.(1);
      }],
      [2.0, () => { this.say('rock_crack', { pitch: 0.5 }, 'wax_crack'); this.bfx.smoke(this.pos, 14, { size: [8, 16], spread: 10, rise: 4, alpha: 0.35 }); this.arena?.shake?.(0.8); }],
      [mv.def.standAt - mv.def.pushAt - 2.0, () => { this.a.hold = this.standHold(); this.say('bull_roar', { volume: 1.1, pitch: 0.7 }, 'phase_shift'); this.cam?.addTrauma(0.5); }],
    ]);
  }

  standHold() { return this.hasStaff ? STAND : STAND_EMPTY; }

  endTransition() {
    this.phase = 2; this.state = 'idle'; this.invulnerable = false; this.cooldown = 1.6;
    this.a.hold = this.standHold(); this.a.setBaseTimeScale(0.6);
    this.brokenCount = 0;
    for (const p of PARTS) this.resetWeak(p, 2);
    this.events.push({ type: 'transition-end' });
  }

  die() {
    if (this.dead) return;
    this.cancelAttack();
    this.dead = true; this.hp = 0; this.state = 'dead'; this.invulnerable = true; this.deathT = 0;
    this.events.push({ type: 'dead' });
    this.say('bull_roar', { volume: 1.2, pitch: 0.55 }, 'boss_death');
    this.timeline = [];
    if (this.phase === 2) this.playMove('death');
    this.cam?.addTrauma(0.6);
  }

  run(steps) {
    let t = 0;
    this.timeline = steps.map(([d, fn]) => ({ at: (t += d), fn, done: false }));
    this.timelineT = 0;
  }

  // --------------------------------------------------------------------------------------------- moves

  playMove(name, { speed = 1, aim = false } = {}) {
    const def = BULL[name];
    this.a.startMove(name, { speed });
    const mv = this.a.move;
    const self = this, track = def.track_;
    mv.def = { ...def, track_: { duration: track.duration, evaluate: t => self.aimPose(track.evaluate(t), aim) } };
    if (def.holdAt !== undefined) mv.holding = true;
    return mv;
  }

  /** Turn an authored (forward-facing) pose toward aimYaw: rotate arm targets / staff, twist the spine and head. */
  aimPose(p, aim) {
    const a = aim ? this.aimYaw : 0, mir = this.mirror;
    if (Math.abs(a) < 1e-4 && !mir) return p;
    const q = { ...p };
    if (mir) {
      if (p.spine) q.spine = [p.spine[0], -p.spine[1], -p.spine[2]];
      if (p.head) q.head = [p.head[0], -p.head[1], -p.head[2]];
    }
    if (Math.abs(a) > 1e-4) {
      const c = Math.cos(a), s = Math.sin(a);
      const rot = v => v && [v[0] * c + v[2] * s, v[1], v[2] * c - v[0] * s];
      for (const side of ['armL', 'armR']) {
        const arm = p[side];
        if (!arm || arm.twoHand) continue;
        q[side] = { ...arm, at: rot(arm.at), pole: arm.pole && rot(arm.pole), hand: arm.hand && rot(arm.hand) };
      }
      if (p.blade) q.blade = rot(p.blade);
      const deg = a / DEG, sp = q.spine || [0, 0, 0], hd = q.head || [0, 0, 0];
      q.spine = [sp[0], sp[1] + deg * 0.72, sp[2]];
      q.head = [hd[0], hd[1] + deg * 0.28, hd[2]];
    }
    return q;
  }

  cancelAttack() {
    const at = this.atk;
    if (at) {
      for (const m of at.marks || []) m.remove();
      if (this.carry) this.releaseCarry(false);
    }
    this.ik.Left = this.ik.Right = null;
    this.atk = null; this.mirror = false; this.jumpY = 0;
    this.weak.handL.resting = this.weak.handR.resting = false;
    this.mouthGlow.material.opacity = 0;
    if (this.staffMode === 'planted') this.regripStaff();
    if (this.a.move && this.state === 'attack') this.a.stopMove();
  }

  // --------------------------------------------------------------------------------------------- AI

  chooseAttack(player) {
    const d = horizDist(this.pos, player.pos), ang = this.relAngle(player.pos), aa = Math.abs(ang);
    const cd = this.cds, w = [];
    if (this.phase === 1) {
      const reach = this.legLen * 0.95;     // what his hands can reach on the ground in front of him
      // the prologue: only the staff and the palms (each leaves something lying on the ground to hit); the fire
      // breath and the grab stay in the library (forceAttack) but he no longer picks them
      if (d < reach * 1.15 && aa < 1.25 && cd.palm <= 0) w.push([ang < -0.1 ? 'palmL' : ang > 0.1 ? 'palmR' : (Math.random() < 0.65 ? 'palmL' : 'palmR'), 4]);
      if (cd.sweep <= 0 && aa < 1.6) w.push(['sweep', d > 12 ? 2.5 : 1.5]);
      if (cd.slam <= 0 && aa < 1.0 && d > 9) w.push(['slam', d > 18 ? 3.5 : 2]);
    } else if (this.duel) {
      // the duel: staff work up close, the ground and the sky when the monkey keeps away; after the rage, the charge
      const rage = this.enraged;
      if (cd.sweep <= 0 && aa < 1.3 && d < 44) { w.push(['sweep2', rage ? 1.6 : 3]); w.push(['combo2', rage ? 2.6 : 1.4]); }
      if (cd.slam <= 0 && aa < 0.9 && d < 40) w.push(['slam2', 2.4]);
      if (cd.stomp <= 0) w.push([ang > 0 ? 'stompR' : 'stompL', d < 30 ? 2 : 1.2]);
      if (rage && cd.meteor <= 0) w.push(['meteor', d > 40 ? 3 : 1.6]);
      if (cd.horn <= 0 && aa < 0.7 && d > (rage ? 28 : 40)) w.push(['charge', d > 60 ? 2.4 : rage ? 1.6 : 1]);      // (not his answer to every gap: it chained into itself)
      // 连击 then 锤地: two blows (four once he has changed) and the leap; or the leap alone, to close on a monkey who keeps away
      if (cd.quake <= 0 && aa < 1.3 && d < 50) w.push(['pattern', rage ? 3.4 : 2.2]);
      if (cd.quake <= 0 && d > 30) w.push(['quake', 2]);
    } else {
      if (cd.stomp <= 0 && d < 34) w.push([ang > 0 ? 'stompR' : 'stompL', d < 16 ? 4 : 2.5]);
      if (cd.horn <= 0 && aa < 0.9 && d > 8 && d < 30) w.push(['horn', 3]);
      if (cd.meteor <= 0) w.push(['meteor', d > 20 ? 3 : 1.5]);
      if (this.hasStaff && cd.throw <= 0 && d > 16) w.push(['throw', 3]);
    }
    const c = w.filter(([n]) => !(n === this.lastAttack && Math.random() < 0.65));
    const list = c.length ? c : w;
    const sum = list.reduce((s, [, x]) => s + x, 0);
    if (!sum) return null;
    let r = Math.random() * sum;
    let pick = list[list.length - 1][0];
    for (const [n, x] of list) if ((r -= x) <= 0) { pick = n; break; }
    if (pick === 'pattern') { this.chainQ = this.enraged ? ['combo2', 'quake'] : ['quake']; cd.quake = 16; return 'combo2'; }
    return pick;
  }

  startAttack(name, player) {
    const def = BULL[name];
    this.lastAttack = name;
    this.state = 'attack';
    const at = this.atk = { name, def, hit: new Set(), marks: [], fired: new Set(), t0: this.time };
    this.mirror = false;
    this.aimYaw = def.aim ? clamp(this.relAngle(player.pos), -1.0, 1.0) : 0;
    const speed = this.phase === 2 ? (this.duel && this.enraged ? 1.26 : this.duel ? 1.12 : 1.08) : 1;
    const mv = this.playMove(name, { aim: !!def.aim, speed });
    const big = ['sweep', 'slam', 'breath', 'stompL', 'stompR', 'horn', 'meteor', 'throw', 'sweep2', 'slam2', 'combo2', 'charge', 'quake'].includes(name);
    this.events.push({ type: 'attack', name, big });
    const cd = this.cds;
    switch (name) {
      case 'sweep': cd.sweep = 6; break;
      case 'sweep2': cd.sweep = 3.5; break;
      case 'combo2': cd.sweep = 5; break;
      case 'charge': cd.horn = this.T.chargeCd; at.dist = 0; break;
      case 'slam2': cd.slam = 4.5; at.holdFor = rand(0.15, 0.85); break;
      case 'quake': {
        cd.quake = 16; cd.slam = Math.max(cd.slam, 3); at.holdFor = 0;
        const d = horizDist(this.pos, player.pos), go = clamp(d - 24, 0, 34);
        at.from = this.pos.clone(); at.to = this.pos.clone();
        if (d > 1) { at.to.x += (player.pos.x - this.pos.x) / d * go; at.to.z += (player.pos.z - this.pos.z) / d * go; }
        break;
      }
      case 'slam': cd.slam = 6; at.holdFor = rand(0.25, 1.3); at.line = this.makeSlamLine(); break;
      case 'palmL': case 'palmR': {
        cd.palm = 5;
        at.side = name === 'palmL' ? 'Left' : 'Right';
        at.target = new THREE.Vector3(); this.palmTarget(player, at.side, at.target);
        if (!HAND_MASK) HAND_MASK = handMaskTexture();
        const L = this.hand[at.side].len * 2.6;
        at.shadow = new GroundMark(this.scene, this.arena, 'hand', { w: L * 0.95, l: L, uniforms: { uMask: { value: HAND_MASK }, uDark: { value: 0 }, uGlow: { value: 0 } } });
        at.marks.push(at.shadow);
        break;
      }
      case 'breath': cd.breath = 15; this.mirror = Math.random() < 0.5; this.aimYaw = 0; at.fireDir = new THREE.Vector3(); at.fireTarget = new THREE.Vector3(); at.patchT = 0; break;
      case 'grab': cd.grab = 10; cd.palm = Math.max(cd.palm, 2.5); this.frontT = 0; at.side = 'Left'; at.target = new THREE.Vector3(); this.palmTarget(player, 'Left', at.target, true); break;
      case 'stompL': case 'stompR': cd.stomp = this.duel ? 9 : 5.5; at.foot = def.foot; break;
      case 'horn': cd.horn = 7; break;
      case 'meteor': cd.meteor = this.duel ? 20 : 22; at.spawned = 0; at.next = 0; break;
      case 'throw': cd.throw = 1e9; at.target = new THREE.Vector3(); this.throwTarget(player, at.target); at.mark = new GroundMark(this.scene, this.arena, 'ring', { w: 9, l: 9, uniforms: { uT: { value: 0 }, uFade: { value: 0 } } }); at.marks.push(at.mark); break;
    }
    void mv;
  }

  /** Ground point the palm (or grab) lands on: the player's position, clamped to what the arm can reach. */
  palmTarget(player, side, out, grab = false) {
    const f = this.fwd(_v), r = this.right(_w);
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    let fwd = dx * f.x + dz * f.z, lat = dx * r.x + dz * r.z;
    const L = this.legLen;
    fwd = clamp(fwd, L * 0.5, L * (grab ? 0.92 : 0.86));
    const sideSign = side === 'Left' ? -1 : 1;
    lat = clamp(lat, sideSign < 0 ? -L * 0.62 : -L * 0.12, sideSign < 0 ? L * 0.12 : L * 0.62);
    out.set(this.pos.x + f.x * fwd + r.x * lat, 0, this.pos.z + f.z * fwd + r.z * lat);
    out.y = this.groundAt(out.x, out.z);
    return out;
  }

  throwTarget(player, out) {
    const lead = player.speed ? Math.min(6, player.speed * 0.6) : 0;
    out.set(player.pos.x + Math.sin(player.yaw || 0) * lead, 0, player.pos.z + Math.cos(player.yaw || 0) * lead);
    const b = this.arena?.bounds;
    if (b) { out.x = clamp(out.x, b.minX + 3, b.maxX - 3); out.z = clamp(out.z, b.minZ + 3, b.maxZ - 3); }
    out.y = this.groundAt(out.x, out.z);
    return out;
  }

  makeSlamLine() {
    const len = 58;
    const m = new GroundMark(this.scene, this.arena, 'line', { w: 7, l: len, segs: 24,
      uniforms: { uGlow: { value: 0 }, uProg: { value: 0 }, uLen: { value: len }, uW: { value: 7 }, uDark: { value: 0 } } });
    this.atk.marks.push(m);
    return m;
  }

  update(dt, player) {
    this.player = player;
    // the duel: phase two against the monkey grown to his own scale (the cinematics' stand-ins do not change it)
    if (player && !player.ghost && player.S !== undefined) {
      const duel = this.phase === 2 && player.S > 1.5;
      if (duel !== !!this.duel) { this.duel = duel; if (duel) for (const p of PARTS) { this.weak[p].active = false; this.weak[p].broken = false; } }
    }
    if (dt <= 0) { this.syncRoot(); this.a.update(0); this.afterPose(0); this.updateZones(); return; }
    this.time += dt;
    for (const k in this.cds) this.cds[k] -= dt;
    if (this.timeline.length) {
      this.timelineT += dt;
      for (const s of this.timeline) if (!s.done && this.timelineT >= s.at) { s.done = true; s.fn(); }
      if (this.timeline.every(s => s.done)) this.timeline = [];
    }
    if (this.poiseT > 0) this.poiseT -= dt; else this.poise = Math.max(0, this.poise - this.T.poiseRegen * dt);
    if (this.flinchT > 0) this.flinchT -= dt;
    if (this.armorDownT > 0) { this.armorDownT -= dt; if (this.armorDownT <= 0 && this.armor && !this.dead) { this.events.push({ type: 'armorUp' }); this.eyeFlare = 1; this.fx.shockwave(this.bonePos('Spine2'), 26, 0.5, new THREE.Color(1.0, 0.45, 0.1)); this.say('fire_breath', { volume: 0.5, pitch: 0.7 }, 'pillar_charge'); } }
    if (this.armored) {         // the fire he wears: it climbs off his shoulders, arms and back
      for (const bn of ARMOR_BONES) if (Math.random() < dt * 12) {
        const q = this.bonePos(bn, _v);
        this.bfx.add.emit(_w.set(q.x + rand(-2.4, 2.4), q.y + rand(-2, 2), q.z + rand(-2.4, 2.4)), _p.set(rand(-1.5, 1.5), rand(7, 14), rand(-1.5, 1.5)), Math.random() < 0.3 ? C.fireCore : C.fire, { size: rand(3.5, 7), life: rand(0.5, 0.95), drag: 0.5, grav: -2, alpha: 0.42, grow: 1.3 });
      }
    }
    // the duel's second half: under enrageAt he roars the mountain awake - the fire comes down, and he fights faster
    if (this.duel && !this.enraged && !this.dead && this.state === 'idle' && this.autoAttack && player && !player.dead && this.hp <= this.maxHp * this.T.enrageAt) {
      this.enraged = true; this.cds.meteor = 0; this.armor = true; this.armorDownT = 0;
      this.startAttack('meteor', player);
      this.events.push({ type: 'enrage' });
      this.eyeFlare = 1; this.fx.shockwave(this.pos.clone().setY(this.groundAt(this.pos.x, this.pos.z) + 1), 60, 0.9, new THREE.Color(1.0, 0.4, 0.1));
    }
    this.tickGold(dt);
    this.tickWeak(dt);
    // lingering in front of him invites the grab
    if (player && !player.dead && this.phase === 1) {
      const d = horizDist(this.pos, player.pos), aa = Math.abs(this.relAngle(player.pos));
      if (aa < 0.5 && d < this.legLen * 1.2) this.frontT += dt; else this.frontT = Math.max(0, this.frontT - dt * 1.5);
    }
    const mv = this.a.move;
    switch (this.state) {
      case 'idle': this.tickIdle(dt, player); break;
      case 'attack': if (!mv && !this.atk?.waitEnd) this.endAttack(); break;
      case 'stagger': if (mv && mv.def.moveRoot) { this.rootMotion(mv, dt); this.keepIn(); } if (!mv) { this.state = 'idle'; this.cooldown = this.reeling ? 0.5 : 0.35; this.reeling = false; } break;
      case 'down': this.tickDown(dt, player, mv); break;
      case 'transition': if (mv && mv.def.moveRoot) this.rootMotion(mv, dt); if (!mv) this.endTransition(); break;
      case 'dead': this.tickDeath(dt); break;
    }
    if (this.state === 'attack' && mv && this.atk?.def.track && this.atk.def.aim && player) {
      const [t0, t1] = this.atk.def.track;
      if (mv.t >= t0 && mv.t <= t1) this.aimYaw = yawLerp(this.aimYaw, clamp(this.relAngle(this.atk.aimAt || player.pos), -1.0, 1.0), 40 * DEG * dt);
    }
    this.composeHold(dt, player);
    this.updateCloth(dt);
    this.syncRoot();
    this.a.update(dt);
    this.afterPose(dt);
    this.updateZones();
    if (this.state === 'attack' && this.atk && this.a.move) this.tickAttack(dt, player, this.a.move);
    else if (this.state === 'attack' && this.atk && !this.a.move) this.endAttack();
    this.tickHazards(dt, player);
    this.ambient(dt);
    this.look.uniforms.bkTime.value = this.time;
  }

  tickIdle(dt, player) {
    if (!player || player.dead) return;
    if (this.phase === 2) {
      const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      const diff = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      const d = horizDist(this.pos, player.pos);
      let speed = 0;
      if (Math.abs(diff) > (this.duel ? 0.08 : 0.25)) this.yaw = yawLerp(this.yaw, want, (this.duel ? this.T.duelTurn : this.T.turn2) * DEG * dt);
      if (this.duel ? d > this.T.duelReach + 4 && Math.abs(diff) < 0.6 : d > 36) { speed = this.duel ? this.T.duelWalk : this.T.walk2; this.pos.x += Math.sin(this.yaw) * speed * dt; this.pos.z += Math.cos(this.yaw) * speed * dt; }
      const moving = speed > 0 || Math.abs(diff) > 0.25;
      if (moving) {
        this.a.playBase('walk', { fade: 0.6 });
        const nat = this.a.clipSpeed('walk') || 30;
        this.a.setBaseTimeScale(clamp((speed || 2.2) / nat, 0.05, 0.6));
        this.stepAcc = (this.stepAcc || 0) + dt;
        if (this.stepAcc > 1.6) { this.stepAcc = 0; this.footfall(Math.random() < 0.5 ? 'Left' : 'Right', 0.5); }
      } else { this.a.playBase('idle', { fade: 0.8 }); this.a.setBaseTimeScale(0.6); }
    }
    if (!this.autoAttack) return;
    if (this.openingT >= 0 && this.phase === 1) {
      if ((this.openingT -= dt) < 0) this.openingSlam();
      return;
    }
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      const atk = this.chain && this.duel ? this.chain : this.chooseAttack(player);
      this.chain = null;
      if (atk) this.startAttack(atk, player);
    }
  }

  endAttack() {
    const at = this.atk;
    if (at) for (const m of at.marks) if (!m.keep) m.remove();
    this.ik.Left = this.ik.Right = null;
    if (this.staffMode === 'planted') this.regripStaff();
    this.atk = null; this.mirror = false;
    this.weak.handL.resting = this.weak.handR.resting = false;
    this.mouthGlow.material.opacity = 0;
    if (this.state === 'attack') {
      this.state = 'idle';
      this.cooldown = this.phase === 1 ? rand(1.3, 2.4) : this.duel ? rand(...(this.enraged ? this.T.rageRest : this.T.duelRest)) : rand(0.8, 1.6);
      // 连招: out of a sweep he may go straight on into the overhead slam (the guard that held the sweep does not hold that)
      if (this.duel && at && this.chainQ.length && !at.parried) { this.chain = this.chainQ.shift(); this.cooldown = 0.1; }
      else if (this.duel && at && (at.name === 'sweep2' || at.name === 'combo2') && !at.parried && Math.random() < (this.enraged ? this.T.rageChainP : this.T.chainP)) { this.chain = 'slam2'; this.cooldown = 0.12; }
      if (at && at.parried) this.chainQ.length = 0;
    }
  }

  tickDown(dt, player, mv) {
    if (!mv) {
      this.state = 'idle'; this.cooldown = 1.5; this.brokenCount = 0; this.downOpen = false;
      if (this.phase === 2) for (const p of ['kneeL', 'kneeR']) { const w = this.weak[p]; if (w.broken) w.regrowT = Math.min(w.regrowT, 4); }
      if (this.checkThresholds()) return;
      return;
    }
    const def = mv.def;
    if (!mv.fired.has('impact') && mv.t >= def.impactAt) {
      mv.fired.add('impact');
      const head = this.bonePos('Head'); head.y = this.groundAt(head.x, head.z);
      this.bfx.debris(head, 50, 11); this.bfx.dustRing(head, 9, 40);
      this.say('bull_slam', { pos: head, pitch: 0.75 }, 'boss_slam');
      this.cam?.addTrauma(0.7); this.arena?.shake?.(0.9);
    }
    const open = mv.t >= def.openAt && mv.t <= def.openEnd;
    if (open && !this.downOpen) { this.downOpen = true; this.events.push({ type: 'critical', stage: 'open' }); }
    if (!open) this.downOpen = false;
    if (open && Math.random() < dt * 3) { const r = this.noseRing(_v); this.bfx.smoke(r, 1, { size: [2, 4], rise: 1.5, alpha: 0.2 }); }
  }

  tickDeath(dt) {
    this.deathT += dt;
    const k = smooth(2, 10, this.deathT);
    this.look.uniforms.bkC.value.z = k;          // the fire goes out of him
    this.eyesWant = 0;
    if (this.phase === 2) {
      // he sinks into the lava lake until only the horns and the top of the head break the surface
      this.sink = smooth(4.5, 13, this.deathT) * this.legLen * 0.62;
      if (Math.random() < dt * 6 && this.deathT > 4 && this.deathT < 13) this.bfx.smoke(this.bonePos('Hips').setY(this.groundAt(this.pos.x, this.pos.z)), 2, { size: [8, 14], spread: 12, rise: 3 });
    }
    if (this.deathT > 3.5 && !this.deathSettled) { this.deathSettled = true; this.say('lava_burst', { pitch: 0.5, volume: 1.2 }, 'pillar_blast'); this.arena?.shake?.(1); this.cam?.addTrauma(0.6); }
  }

  rootMotion(mv, dt) {
    for (const [t0, t1, dist, e] of mv.def.moveRoot) {
      const u0 = clamp((mv.t - dt * mv.speed - t0) / (t1 - t0), 0, 1), u1 = clamp((mv.t - t0) / (t1 - t0), 0, 1);
      const step = dist * this.legLen * ((ease[e || 'out'])(u1) - (ease[e || 'out'])(u0));
      if (step) { this.pos.x += Math.sin(this.yaw) * step; this.pos.z += Math.cos(this.yaw) * step; }
    }
  }

  // --------------------------------------------------------------------------------------------- attack ticks

  tickAttack(dt, player, mv) {
    const at = this.atk, def = at.def, t = mv.t, once = k => (at.fired.has(k) ? false : (at.fired.add(k), true));
    const n = at.name;
    // staff hits (sweep, slam)
    if (def.hits && player && !player.dead) {
      def.hits.forEach(([t0, t1, info], i) => {
        if (t < t0 || t > t1 || at.hit.has(i)) return;
        let hit = null;
        if (n === 'horn') hit = this.hornHit(player);
        else if (this.staffMode === 'hand') hit = sweepBlade(this.prevButt, this.prevTip, this.staffButt, this.staffTip, [this.playerCapsule(player)], this.staff.userData.radius * 1.4, 8);
        if (hit) { at.hit.add(i); this.hitPlayer(player, info, hit.point || this.pos, n); }
      });
    }
    switch (n) {
      case 'sweep': {
        if (t >= def.tellAt && t < def.hits[0][0] && Math.random() < dt * 14) this.bfx.drip(this.staffPoint(rand(0.55, 1), _v), 2);
        if (t >= 0.85 && once('glow')) { this.staffGlow = 1; this.say('staff_swing', { pos: this.staffTip, pitch: 0.6, volume: 0.6 }, 'boss_swing'); }
        if (t >= def.hits[0][0] - 0.1 && once('swing')) this.say('staff_swing', { pos: this.staffTip, pitch: 0.5 }, 'boss_swing');
        if (t >= def.hits[0][0] && t <= def.hits[0][1]) {
          // the head of the staff ploughs the ground: dust and sparks along its path
          const tip = this.staffTip;
          if (tip.y - this.groundAt(tip.x, tip.z) < 3) { this.bfx.dustRing(new THREE.Vector3(tip.x, this.groundAt(tip.x, tip.z), tip.z), 2, 3); this.bfx.embers(tip, 3, { spread: 1, up: 3 }); }
        }
        break;
      }
      case 'slam': {
        const L = at.line, f = this.lineDir(new THREE.Vector3());
        if (L && !at.lineLocked) {
          const sx = this.pos.x + f.x * 9, sz = this.pos.z + f.z * 9;
          L.place(sx + f.x * 29, sz + f.z * 29, Math.atan2(f.x, f.z));
          if (mv.holding && t >= def.holdAt) at.lineLocked = true;
        }
        if (L) { L.u.uTime.value = this.time; L.u.uGlow.value = Math.max(L.u.uGlow.value, smooth(def.tellAt, def.holdAt, t) * 0.35); L.u.uProg.value = Math.max(L.u.uProg.value, smooth(def.tellAt, def.holdAt + 0.3, t)); }
        if (t >= def.tellAt && once('tell')) this.say('staff_swing', { pos: this.staffTip, pitch: 0.45, volume: 0.5 }, 'boss_swing');
        if (t > def.tellAt && t < def.impactAt && Math.random() < dt * 10) this.bfx.drip(this.staffPoint(rand(0.7, 1), _v), 2);
        if (mv.holding && mv.hold >= at.holdFor) mv.holding = false;
        if (t >= def.impactAt && once('impact')) {
          at.lineLocked = true;
          const tip = this.staffTip.clone(); tip.y = this.groundAt(tip.x, tip.z);
          this.bfx.debris(tip, 50, 12); this.bfx.dustRing(tip, 7, 40); this.bfx.burst(tip, 0.6);
          this.fx.shockwave(tip, 10, 0.5, new THREE.Color(1.0, 0.45, 0.15));
          this.say('bull_slam', { pos: tip }, 'boss_slam');
          this.cam?.addTrauma(0.75); this.arena?.shake?.(0.8);
          if (L) L.u.uGlow.value = 1;
          at.eruptAt = t + (def.eruptAt - def.impactAt); at.erupted = 0;
        }
        if (at.eruptAt !== undefined && t >= at.eruptAt) this.eruptAlongLine(at, player, t - at.eruptAt);
        if (L && t > def.impactAt + 1.5) { L.u.uGlow.value *= Math.exp(-dt * 1.5); }
        if (at.restFor > 0 && t >= def.restAt) {
          // the opening blow: the staff lies where it fell, both hands on it
          at.resting = true; mv.speed = 0;
          if ((at.restFor -= dt) <= 0) { mv.speed = 1; at.resting = false; }
        }
        break;
      }
      case 'sweep2': {
        if (t >= def.tellAt && once('tell')) { this.staffGlow = 1; this.say('staff_swing', { pos: this.staffTip, pitch: 0.55, volume: 0.7 }, 'boss_swing'); }
        if (t >= def.hits[0][0] - 0.1 && once('swing')) this.say('staff_swing', { pos: this.staffTip, pitch: 0.45 }, 'boss_swing');
        break;
      }
      case 'combo2': {
        if (t >= def.tellAt && once('tell')) { this.staffGlow = 1; this.say('staff_swing', { pos: this.staffTip, pitch: 0.55, volume: 0.7 }, 'boss_swing'); }
        if (t >= def.hits[0][0] - 0.1 && once('swing')) this.say('staff_swing', { pos: this.staffTip, pitch: 0.45 }, 'boss_swing');
        if (t >= def.hits[1][0] - 0.25 && once('glow2')) this.staffGlow = 1;
        if (t >= def.hits[1][0] - 0.1 && once('swing2')) this.say('staff_swing', { pos: this.staffTip, pitch: 0.5 }, 'boss_swing');
        break;
      }
      case 'charge': this.tickCharge(dt, player, mv, at); break;
      case 'quake': {
        // 锤地: he leaves the ground, the staff over his head, and comes down with it - the ground where it lands burns
        if (t >= def.tellAt && once('tell')) { this.staffGlow = 1; this.say('bull_roar', { pitch: 1.05, volume: 0.7 }, 'stagger'); }
        if (mv.holding) mv.holding = false;
        const u = clamp((t - 0.35) / (def.impactAt - 0.05 - 0.35), 0, 1);
        this.jumpY = Math.sin(u * Math.PI) * this.T.height * this.T.quakeJump;
        if (u > 0 && u < 1) { const e = u * u * (3 - 2 * u); this.pos.x = at.from.x + (at.to.x - at.from.x) * e; this.pos.z = at.from.z + (at.to.z - at.from.z) * e; this.keepIn(); }
        if (t >= def.impactAt && once('impact')) {
          this.jumpY = 0;
          const tip = this.staffTip.clone(); tip.y = this.groundAt(tip.x, tip.z);
          const c = this.pos.clone().lerp(tip, 0.7); c.y = tip.y;
          this.bfx.debris(tip, 90, 22); this.bfx.dustRing(tip, 16, 70); this.bfx.burst(tip, 1.4); this.bfx.dustRing(this.pos, 12, 40);
          this.fx.shockwave(c, this.T.quakeR * 1.1, 0.8, new THREE.Color(1.0, 0.4, 0.1));
          for (let i = 0; i < 5; i++) { const a = i * 1.257 + 0.4; this.arena?.eruption?.(c.x + Math.cos(a) * this.T.quakeR * 0.55, c.z + Math.sin(a) * this.T.quakeR * 0.55, 1.2); }
          this.arena?.eruption?.(tip.x, tip.z, 1.6);
          this.say('bull_slam', { pos: tip, pitch: 0.8 }, 'boss_slam'); this.say('lava_burst', { pos: tip, volume: 1 }, 'boss_slam');
          this.cam?.addTrauma(1); this.arena?.shake?.(1.2);
          this.addGroundFire(c.x, c.z, this.T.quakeR, { life: this.T.quakeLife, dmg: this.T.fieldDmg, tick: this.T.fieldTick, arm: 0.7 });
          this.events.push({ type: 'quake', x: c.x, z: c.z, r: this.T.quakeR });
        }
        break;
      }
      case 'slam2': {
        if (t >= def.tellAt && once('tell')) { this.staffGlow = 1; this.say('staff_swing', { pos: this.staffTip, pitch: 0.4, volume: 0.6 }, 'boss_swing'); }
        if (mv.holding && mv.hold >= at.holdFor) mv.holding = false;
        if (t >= def.impactAt && once('impact')) {
          const tip = this.staffTip.clone(); tip.y = this.groundAt(tip.x, tip.z);
          this.bfx.debris(tip, 60, 16); this.bfx.dustRing(tip, 10, 50); this.bfx.burst(tip, 0.8);
          this.fx.shockwave(tip, 16, 0.6, new THREE.Color(1.0, 0.45, 0.15));
          this.arena?.eruption?.(tip.x, tip.z, 1.0);
          this.say('bull_slam', { pos: tip }, 'boss_slam');
          this.cam?.addTrauma(0.8); this.arena?.shake?.(0.9);
        }
        break;
      }
      case 'palmL': case 'palmR': this.tickPalm(dt, player, mv, at); break;
      case 'breath': this.tickBreath(dt, player, mv, at); break;
      case 'grab': this.tickGrab(dt, player, mv, at); break;
      case 'grabSlam': this.tickGrabSlam(dt, player, mv, at); break;
      case 'stompL': case 'stompR': this.tickStomp(dt, player, mv, at); break;
      case 'horn': {
        if (t >= def.tellAt && once('tell')) this.say('bull_roar', { pitch: 0.9, volume: 0.6 }, 'stagger');
        if (t >= def.hits[0][0] && t <= def.hits[0][1] && Math.random() < dt * 20) {
          const h = this.bonePos('Head'); const g = this.groundAt(h.x, h.z);
          if (h.y - g < this.headSize * 2) this.bfx.dustRing(new THREE.Vector3(h.x, g, h.z), 4, 3);
        }
        if (t >= def.hits[0][0] && once('swing')) this.say('staff_swing', { pitch: 0.4 }, 'boss_swing');
        break;
      }
      case 'meteor': this.tickMeteor(dt, player, mv, at); break;
      case 'throw': this.tickThrow(dt, player, mv, at); break;
    }
  }

  lineDir(out) {
    const a = this.yaw - this.aimYaw;       // aimYaw is toward his right; world yaw grows toward his left
    return out.set(Math.sin(a), 0, Math.cos(a));
  }

  /** A point along the staff, 0 = butt, 1 = head. */
  staffPoint(u, out = new THREE.Vector3()) { return out.copy(this.staffButt).lerp(this.staffTip, u); }

  eruptAlongLine(at, player, te) {
    const f = this.lineDir(new THREE.Vector3());
    const start = 10, end = 58, speed = 48, step = 4.2;
    const reach = start + te * speed;
    while (start + at.erupted * step <= Math.min(end, reach)) {
      const d = start + at.erupted * step;
      const x = this.pos.x + f.x * d + (Math.random() - 0.5) * 1.2, z = this.pos.z + f.z * d + (Math.random() - 0.5) * 1.2;
      const y = this.groundAt(x, z), p = new THREE.Vector3(x, y, z);
      this.arena?.eruption?.(x, z, 0.85);
      if (at.erupted % 2 === 0) this.bfx.burst(p.setY(y + 0.5), 0.55); else this.bfx.smoke(p.setY(y + 0.5), 2, { size: [3, 6], rise: 3 });
      if (at.erupted % 3 === 0) this.say('lava_burst', { pos: p, volume: 0.7, pitch: rand(0.8, 1.1) }, 'pillar_blast');
      if (player && !player.dead && !at.hit.has('erupt') && horizDist(player.pos, p) < 3.4 && player.pos.y - y < 3) {
        at.hit.add('erupt');
        this.hitPlayer(player, { dmg: this.T.eruptDmg, kind: 'heavy' }, p, 'slam');
      }
      at.erupted++;
    }
    if (at.line) at.line.u.uGlow.value = Math.max(at.line.u.uGlow.value, 1.2 - te * 0.4);
  }

  tickPalm(dt, player, mv, at) {
    const def = at.def, t = mv.t, side = at.side, sh = at.shadow;
    // the shadow follows the player until the hand commits
    if (t <= def.track[1] && player) this.palmTarget(player, side, at.target);
    const dir = this.palmDir(at.target, _w);
    const L = this.hand[side].len * 2.6;
    const grow = smooth(def.tellAt, def.impactAt, t);
    sh.place(at.target.x + dir.x * L * 0.08, at.target.z + dir.z * L * 0.08, Math.atan2(dir.x, dir.z), L * 0.95 * (0.55 + 0.45 * grow), L * (0.55 + 0.45 * grow));
    sh.u.uTime.value = this.time;
    sh.u.uDark.value = t < def.impactAt ? 0.15 + 0.6 * grow : Math.max(0, 0.75 - (t - def.impactAt) * 1.5);
    sh.u.uGlow.value = t < def.impactAt ? 0.15 + 1.1 * grow * grow : Math.max(0, 1.2 - (t - def.impactAt) * 2);
    if (side === 'Right' && def.plantAt && t >= def.plantAt && this.staffMode === 'hand' && !at.fired.has('plant')) { at.fired.add('plant'); this.plantStaff(); }
    if (def.regripAt && t >= def.regripAt && this.staffMode === 'planted') this.regripStaff();
    if (t >= def.tellAt && !at.fired.has('tell')) { at.fired.add('tell'); this.say('bull_roar', { pitch: 1.2, volume: 0.35 }, 'boss_step'); }
    if (t >= def.impactAt - 0.12 && !at.fired.has('whoosh')) { at.fired.add('whoosh'); this.say('staff_swing', { pitch: 0.35 }, 'boss_swing'); }
    this.handIK(side, at.target, def[side === 'Left' ? 'ikL' : 'ikR'], t, true);
    if (t >= def.impactAt && !at.fired.has('impact')) {
      at.fired.add('impact');
      const p = at.target.clone();
      this.bfx.debris(p, 40, 9); this.bfx.dustRing(p, 9, 46); this.bfx.embers(p, 20, { spread: 4, up: 4 });
      this.fx.shockwave(p, 12, 0.5, new THREE.Color(0.9, 0.5, 0.25));
      this.say('bull_slam', { pos: p }, 'boss_slam');
      this.cam?.addTrauma(0.65); this.arena?.shake?.(0.7);
      const R = Math.max(4.2, this.hand[side].len * 1.35);
      if (player && horizDist(player.pos, p) < R && player.pos.y - p.y < 3) this.hitPlayer(player, { dmg: 36, kind: 'heavy', blockable: false }, p, at.name);
    }
    const w = this.weak[side === 'Left' ? 'handL' : 'handR'];
    w.resting = t >= def.restAt && t <= def.restEnd;
    if (w.resting && Math.random() < dt * 4) this.bfx.embers(w.pos, 2, { spread: 0.6, up: 1.5 });
  }

  /** Horizontal direction the hand lies along when it lands at `target` (fingers away from him). */
  palmDir(target, out) {
    out.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    if (out.lengthSq() < 1e-6) this.fwd(out);
    return out.normalize();
  }

  /** World-space hand placement: [t0 t1 t2 t3] fade window; leans the spine when the ground is out of reach. */
  handIK(side, target, win, t, flat) {
    if (!win) return;
    const [t0, t1, t2, t3] = win;
    const w = t < t0 ? 0 : t < t1 ? ease.inOut((t - t0) / Math.max(1e-3, t1 - t0)) : t <= t2 ? 1 : t < t3 ? 1 - ease.inOut((t - t2) / Math.max(1e-3, t3 - t2)) : 0;
    this.ik[side] = w > 0.001 ? { target: target.clone(), w, flat } : null;
  }

  tickBreath(dt, player, mv, at) {
    const def = at.def, t = mv.t, [b0, b1] = def.breath;
    const head = this.bonePos('Head', new THREE.Vector3());
    const hf = this.headAxis('F', new THREE.Vector3()), hu = this.headAxis('U', new THREE.Vector3());
    const mouth = head.clone().addScaledVector(hf, 0.55 * this.headSize).addScaledVector(hu, -0.45 * this.headSize);
    // the tell: he draws breath, the throat glows
    if (t >= def.tellAt && !at.fired.has('tell')) { at.fired.add('tell'); this.say('fire_breath', { pos: mouth, pitch: 0.7, volume: 0.5 }, 'pillar_charge'); }
    const charge = smooth(def.tellAt, b0, t) * (t < b1 ? 1 : Math.max(0, 1 - (t - b1) * 2));
    this.mouthGlow.position.copy(mouth);
    this.mouthGlow.scale.setScalar(this.headSize * (0.8 + 1.4 * charge));
    this.mouthGlow.material.opacity = charge * (0.7 + 0.3 * Math.sin(this.time * 17));
    if (t < b0 && Math.random() < dt * 30 * charge) this.bfx.embers(mouth, 2, { spread: 1.2, up: -2, size: [0.2, 0.5], life: [0.4, 0.8] });
    at.breathing = !at.reflected && t >= b0 && t <= b1;
    if (!at.breathing) return;
    if (!at.fired.has('roar')) { at.fired.add('roar'); this.say('fire_breath', { pos: mouth, volume: 1.1 }, 'pillar_blast'); this.cam?.addTrauma(0.35); this.fx.light(mouth, 0xff6a20, 90, 0.4, 60); }
    // where the stream meets the ground: along his head's horizontal heading
    const hx = hf.x, hz = hf.z, hl = Math.hypot(hx, hz) || 1;
    const dirX = hx / hl, dirZ = hz / hl;
    at.fireDir.set(dirX, 0, dirZ);
    const near = this.legLen * 0.75, far = 54;
    const tx = this.pos.x + dirX * near, tz = this.pos.z + dirZ * near, ty = this.groundAt(tx, tz);
    at.fireTarget.set(tx, ty, tz);
    const stream = new THREE.Vector3(tx - mouth.x, ty + 1 - mouth.y, tz - mouth.z);
    const sLen = stream.length(); stream.normalize();
    const vel = 46;
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Vector3().copy(stream).multiplyScalar(vel * rand(0.85, 1.1)).add(_w.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)));
      const s = mouth.clone().addScaledVector(stream, rand(0, 2));
      this.bfx.add.emit(s, v, Math.random() < 0.15 ? C.fireCore : Math.random() < 0.6 ? C.fire : C.deep, { size: rand(1.2, 2.6), life: (sLen / vel) * rand(0.9, 1.05), drag: 0.05, grav: 0, alpha: 0.3, grow: 2.0 });
    }
    // the fire rolls on along the ground to the far side of the field; pillars cast a shadow in it
    const cols = this.arena?.colliders || [];
    for (let i = 0; i < 16; i++) {
      const d = near + Math.pow(Math.random(), 0.8) * (far - near);
      const lat = rand(-2.2, 2.2);
      const x = this.pos.x + dirX * d - dirZ * lat, z = this.pos.z + dirZ * d + dirX * lat;
      let blocked = false;
      for (const c of cols) { if (this.occluded(tx, tz, x, z) || Math.hypot(x - c.x, z - c.z) < c.r) { blocked = true; break; } }
      if (blocked) continue;
      const y = this.groundAt(x, z);
      this.bfx.add.emit(_v.set(x, y + rand(0.2, 1.2), z), _w.set(dirX * rand(4, 12), rand(3, 9), dirZ * rand(4, 12)), Math.random() < 0.1 ? C.fireCore : Math.random() < 0.6 ? C.fire : C.deep,
        { size: rand(1.4, 3.6), life: rand(0.35, 0.8), drag: 0.8, grav: 3, alpha: 0.26, grow: 1.6 });
      // the fire is mostly smoke: dark billows roll along with it and swallow the glow
      if (Math.random() < 0.3) this.bfx.alpha.emit(_v.set(x, y + 3, z), _w.set(rand(-1, 1), rand(3, 6), rand(-1, 1)), C.smoke, { size: rand(5, 10), life: rand(1.5, 2.6), drag: 0.4, grav: 0.4, alpha: 0.28, grow: 1.4 });
    }
    if (Math.random() < dt * 10) this.fx.light(_v.set(tx + dirX * 12, ty + 3, tz + dirZ * 12), 0xff5a18, 55, 0.25, 40);
    // burning ground the fan can put out
    at.patchT -= dt;
    if (at.patchT <= 0) {
      at.patchT = 0.32;
      const d = near + rand(0.15, 0.85) * (far - near), x = this.pos.x + dirX * d, z = this.pos.z + dirZ * d;
      if (!this.occluded(tx, tz, x, z)) this.addGroundFire(x, z, rand(2.6, 3.6));
    }
    // damage: inside the moving strip, not behind a pillar
    if (player && !player.dead && !at.hit.has('fire')) {
      const px = player.pos.x - this.pos.x, pz = player.pos.z - this.pos.z;
      const along = px * dirX + pz * dirZ, lat = Math.abs(-px * dirZ + pz * dirX);
      if (along > near - 6 && along < far && lat < 3.6 && !this.occluded(tx, tz, player.pos.x, player.pos.z)) {
        at.hit.add('fire');
        this.hitPlayer(player, { dmg: this.T.fireDmg, kind: 'heavy' }, mouth, 'breath');
      }
    }
  }

  addGroundFire(x, z, r, { life = rand(6, 8), dmg = this.T.firePatchDmg, tick = 1.2, arm = 0.4 } = {}) {
    const mark = new GroundMark(this.scene, this.arena, 'fire', { w: r * 2.4, l: r * 2.4, segs: 8, uniforms: { uT: { value: 0 }, uFade: { value: 0 }, uBig: { value: r > 12 ? 1 : 0 } } });
    mark.place(x, z, Math.random() * 6);
    this.groundFires.push({ x, z, r, t: 0, life, dmg, tick, arm, mark, out: false, hitCd: 0 });
  }

  tickGrab(dt, player, mv, at) {
    const def = at.def, t = mv.t;
    if (t <= def.track[1] && player) this.palmTarget(player, 'Left', at.target, true);
    if (t >= def.tellAt && !at.fired.has('tell')) { at.fired.add('tell'); this.say('bull_roar', { pitch: 1.0, volume: 0.5 }, 'stagger'); this.eyeFlare = 1; }
    this.handIK('Left', at.target, def.ikL, t, false);
    if (t >= def.catchAt && !at.fired.has('catch')) {
      at.fired.add('catch');
      const p = at.target.clone();
      const R = Math.max(3.6, this.hand.Left.len * 1.15);
      let caught = false;
      if (player && !player.dead && horizDist(player.pos, p) < R && player.pos.y - p.y < 3.5) {
        const r = player.takeHit({ dmg: this.T.grabDmg, from: p.clone(), kind: 'grab', blockable: false });
        caught = !!r && r !== 'block' && r !== 'parry';
      }
      if (caught) {
        this.events.push({ type: 'grab', stage: 'caught' }, { type: 'hitPlayer', name: 'grab', result: true });
        this.carry = { player, hooked: !!player.onGrabbed };
        player.onGrabbed?.(this);
        this.say('rock_crack', { pos: p, pitch: 1.3 }, 'wax_crack');
        const saved = at.target.clone();
        this.atk = { name: 'grabSlam', def: BULL.grabSlam, hit: new Set(), marks: [], fired: new Set(), t0: this.time, target: saved, slamPoint: null };
        this.playMove('grabSlam', { aim: true });
      } else {
        this.bfx.debris(p, 30, 8); this.bfx.dustRing(p, 7, 30);
        this.say('bull_slam', { pos: p, pitch: 1.2, volume: 0.7 }, 'boss_slam');
        this.cam?.addTrauma(0.4);
      }
    }
    this.weak.handL.resting = t >= def.restAt && t <= def.restEnd;
  }

  tickGrabSlam(dt, player, mv, at) {
    const def = at.def, t = mv.t;
    if (this.carry) {
      const hold = this.handCenter('Left', new THREE.Vector3());
      const p = this.carry.player;
      p.pos.copy(hold).addScaledVector(UP, -0.75);
      if (t > def.liftAt && t < def.slamAt && Math.random() < dt * 6) this.bfx.embers(hold, 2, { spread: 1, up: 1 });
      if (t >= 0.9 && !at.fired.has('squeeze')) { at.fired.add('squeeze'); this.say('rock_crack', { pos: hold, pitch: 1.6, volume: 0.6 }, 'wax_crack'); this.cam?.addTrauma(0.2); }
    }
    if (!at.slamPoint) { at.slamPoint = new THREE.Vector3(); const f = this.fwd(_v), r = this.right(_w); at.slamPoint.set(this.pos.x + f.x * this.legLen * 0.7 - r.x * this.legLen * 0.25, 0, this.pos.z + f.z * this.legLen * 0.7 - r.z * this.legLen * 0.25); at.slamPoint.y = this.groundAt(at.slamPoint.x, at.slamPoint.z); }
    if (t < 0.25) this.handIK('Left', at.target, [0, 0.01, 0.0, 0.25], t, false);
    else this.handIK('Left', at.slamPoint, [def.slamAt - 0.18, def.slamAt, def.slamAt + 0.7, def.slamAt + 1.3], t, true);
    if (t >= def.releaseAt && !at.fired.has('slam')) {
      at.fired.add('slam');
      const p = at.slamPoint.clone();
      this.releaseCarry(true, p);
      this.bfx.debris(p, 50, 11); this.bfx.dustRing(p, 9, 46); this.bfx.burst(p, 0.4);
      this.say('bull_slam', { pos: p }, 'boss_slam');
      this.cam?.addTrauma(0.8); this.arena?.shake?.(0.8);
      this.events.push({ type: 'grab', stage: 'slam' });
    }
  }

  releaseCarry(slam, at) {
    const c = this.carry; if (!c) return;
    this.carry = null;
    const p = c.player;
    if (at) p.pos.set(at.x, at.y, at.z); else p.pos.y = this.groundAt(p.pos.x, p.pos.z);
    p.onReleased?.(this, { slam });
  }

  /** Center of the palm (world). */
  handCenter(side, out) {
    this.bonePos(side + 'Hand', out);
    return out.lerp(this.bonePos(side + 'HandMiddle1', _v), 0.8);
  }

  tickStomp(dt, player, mv, at) {
    const def = at.def, t = mv.t, foot = this.bonePos(at.foot + 'Foot', new THREE.Vector3());
    if (t >= def.tellAt && t < def.impactAt) {
      if (Math.random() < dt * 16) this.bfx.drip(foot, 2);
      if (!at.fired.has('tell')) {
        at.fired.add('tell');
        this.say('bull_roar', { pitch: 0.8, volume: 0.6 }, 'stagger');
        const g = foot.clone(); g.y = this.groundAt(g.x, g.z);
        at.ring = new GroundMark(this.scene, this.arena, 'ring', { w: this.duel ? 44 : 16, l: this.duel ? 44 : 16, uniforms: { uT: { value: 0 }, uFade: { value: 0 } } }).place(g.x, g.z, 0);
        at.marks.push(at.ring);
      }
    }
    if (at.ring) {
      at.ring.u.uTime.value = this.time;
      at.ring.u.uT.value = smooth(def.tellAt, def.impactAt, t);
      if (t > def.impactAt) at.ring.u.uFade.value = clamp((t - def.impactAt) / 0.3, 0, 1);
    }
    if (t >= def.impactAt && !at.fired.has('impact')) {
      at.fired.add('impact');
      const p = foot.clone(); p.y = this.groundAt(p.x, p.z);
      this.bfx.debris(p, 70, 14); this.bfx.dustRing(p, 12, 60); this.bfx.burst(p, 1);
      this.fx.shockwave(p, 16, 0.55, new THREE.Color(1.0, 0.42, 0.12));
      this.arena?.eruption?.(p.x, p.z, 1.2);
      this.say('bull_stomp', { pos: p }, 'boss_slam');
      this.cam?.addTrauma(0.9); this.arena?.shake?.(1);
      if (player && !player.dead && horizDist(player.pos, p) < (this.duel ? 19 : 7.5)) { at.hit.add('crush'); this.hitPlayer(player, { dmg: this.duel ? this.T.duelCrushDmg : 34, kind: 'heavy' }, p, at.name); }
      this.hazards.push(new LavaWave(this, p, at.hit, this.duel));
    }
  }

  footfall(side, k = 1) {
    const f = this.bonePos(side + 'Foot', new THREE.Vector3()); f.y = this.groundAt(f.x, f.z);
    this.bfx.dustRing(f, 6 * k, 20 * k); this.bfx.debris(f, 12 * k, 6);
    this.say('bull_stomp', { pos: f, volume: 0.5 * k, pitch: 1.1 }, 'boss_step');
    this.cam?.addTrauma(0.15 * k); this.arena?.shake?.(0.2 * k);
  }

  hornTips(outL, outR) {
    const hs = this.headSize, h = this.bonePos('Head', _v), F = this.headAxis('F', new THREE.Vector3()), U = this.headAxis('U', new THREE.Vector3()), R = this.headAxis('R', new THREE.Vector3());
    outL.copy(h).addScaledVector(R, -1.35 * hs).addScaledVector(U, 1.2 * hs).addScaledVector(F, 0.35 * hs);
    outR.copy(h).addScaledVector(R, 1.35 * hs).addScaledVector(U, 1.2 * hs).addScaledVector(F, 0.35 * hs);
  }

  hornHit(player) {
    const cap = this.playerCapsule(player), h = this.bonePos('Head'), L = new THREE.Vector3(), R = new THREE.Vector3();
    this.hornTips(L, R);
    for (const tip of [L, R]) {
      const r = segSeg(h, tip, cap.a, cap.b);
      if (r.dist < this.headSize * 0.55 + cap.r) return { point: r.c1.clone() };
    }
    const r = segSeg(h, h.clone().addScaledVector(this.headAxis('F', _v), this.headSize * 0.6), cap.a, cap.b);
    if (r.dist < this.headSize * 0.7 + cap.r) return { point: r.c1.clone() };
    return null;
  }

  tickMeteor(dt, player, mv, at) {
    const def = at.def, t = mv.t, [r0, r1] = def.rain;
    if (t >= def.tellAt && !at.fired.has('tell')) {
      at.fired.add('tell');
      this.say('bull_roar', { volume: 1.1, pitch: 0.7 }, 'boss_death');
      this.cam?.addTrauma(0.4); this.arena?.shake?.(0.6);
      const back = this.fwd(new THREE.Vector3()).multiplyScalar(-70).add(this.pos);
      this.arena?.eruption?.(back.x, back.z, 2);
    }
    if (t >= r0 && t <= r1) {
      at.next -= dt;
      if (at.next <= 0 && at.spawned < (this.duel ? 12 : 14)) {
        at.next = this.duel ? rand(0.24, 0.4) : rand(0.2, 0.36);
        const target = new THREE.Vector3();
        const b = this.bnd;
        if (this.duel && player) {
          // onto him (leading his run) and around him, in turn: he has to keep moving, and look where he steps
          if (at.spawned % 2 === 0) { const lead = (player.speed || 0) * 1.1; target.set(player.pos.x + Math.sin(player.yaw || 0) * lead + rand(-5, 5), 0, player.pos.z + Math.cos(player.yaw || 0) * lead + rand(-5, 5)); }
          else { const a = Math.random() * Math.PI * 2, rr = rand(22, 55); target.set(player.pos.x + Math.cos(a) * rr, 0, player.pos.z + Math.sin(a) * rr); }
        } else if (player && at.spawned % 2 === 0) {
          const lead = (player.speed || 0) * 0.9;
          target.set(player.pos.x + Math.sin(player.yaw || 0) * lead + rand(-3, 3), 0, player.pos.z + Math.cos(player.yaw || 0) * lead + rand(-3, 3));
        } else {
          const c = this.pos.clone().addScaledVector(this.fwd(_v), 36), a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 34;
          target.set(c.x + Math.cos(a) * rr, 0, c.z + Math.sin(a) * rr);
        }
        if (b) { target.x = clamp(target.x, b.minX + 2, b.maxX - 2); target.z = clamp(target.z, b.minZ + 2, b.maxZ - 2); }
        target.y = this.groundAt(target.x, target.z);
        this.hazards.push(new Meteor(this, target, this.duel ? rand(1.7, 2.1) : rand(1.3, 1.7), this.duel ? 3 : 1));
        at.spawned++;
      }
    }
  }

  /** 冲撞: he lines up on the monkey while he paws the ground, then runs straight - through him, if he is still there. */
  tickCharge(dt, player, mv, at) {
    const def = at.def, t = mv.t;
    if (t >= def.tellAt && !at.fired.has('tell')) { at.fired.add('tell'); this.say('bull_roar', { pitch: 0.75, volume: 1 }, 'stagger'); this.eyeFlare = 1; }
    if (t < def.runAt) {
      if (player) this.yaw = yawLerp(this.yaw, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z), 80 * DEG * dt);
      if ((at.paw = (at.paw || 0) + dt) > 0.45 && t > 0.5) { at.paw = 0; this.footfall(at.pawSide = at.pawSide === 'Left' ? 'Right' : 'Left', 0.7); }
      return;
    }
    if (t >= def.runEnd || at.stopped) {
      if (!at.fired.has('skid')) { at.fired.add('skid'); at.skidV = this.T.chargeSpeed * mv.speed; mv.t = Math.max(mv.t, def.runEnd); this.footfall('Left', 1.2); this.footfall('Right', 1.2); this.a.playBase('idle', { fade: 0.5 }); }
      return;
    }
    if (!at.fired.has('go')) { at.fired.add('go'); this.say('bull_stomp', { volume: 1, pitch: 0.8 }, 'boss_slam'); this.cam?.addTrauma(0.5); this.a.playBase('walk', { fade: 0.15 }); }
    this.a.setBaseTimeScale(1.5);
    const step = this.T.chargeSpeed * (this.beast ? this.T.beastSpeed : 1) * dt * mv.speed, f = this.fwd(_v);
    this.pos.x += f.x * step; this.pos.z += f.z * step; at.dist += step;
    if (this.keepIn(this.beast ? Math.max(16, 0.2 * this.T.beastLen * this.T.height) : 16)) at.stopped = true;   // (his horns stop short of the wall)
    if ((at.paw = (at.paw || 0) + dt) > 0.22) { at.paw = 0; this.footfall(at.pawSide = at.pawSide === 'Left' ? 'Right' : 'Left', 0.9); }
    if (player && !player.dead) {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, along = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
      const L = this.beast ? this.T.beastLen * this.T.height : 0;
      const reach = 8 + 0.45 * (player.S || 1), front = this.beast ? 0.2 * L + 0.3 * (player.S || 1) : reach + 6, wide = this.beast ? 0.16 * L + 0.3 * (player.S || 1) : reach;
      // the moment to step aside: his horns are a breath away (the coach says 现在闪)
      at.dodgeNow = !at.hit.has('c') && side < wide && along > front && (along - front) / Math.max(1, step / dt) < 0.45;
      if (!at.hit.has('c') && along > -4 && along < front && side < wide) {
        at.hit.add('c');
        // a charge is the most telegraphed blow he has: any roll / step still going when he arrives gets out of the way
        if (player.state === 'roll') { this.events.push({ type: 'dodged', name: 'charge' }); this.cam?.addTrauma(0.4); }
        else this.hitPlayer(player, { dmg: this.T.chargeDmg, kind: 'heavy', blockable: false }, this.bonePos('Head', new THREE.Vector3()), 'charge');
        this.cam?.addTrauma(0.8);
      }
      // (2026-11-17 user: "冲击到底部，冲程变大3倍": he no longer pulls up once past the monkey; he runs on to the wall)
    }
  }

  tickThrow(dt, player, mv, at) {
    const def = at.def, t = mv.t;
    if (t < 1.4 && player) this.throwTarget(player, at.target);
    at.mark.place(at.target.x, at.target.z, 0);
    at.mark.u.uTime.value = this.time; at.mark.u.uT.value = smooth(def.tellAt, def.releaseAt + 1.0, t);
    if (t >= def.tellAt && !at.fired.has('tell')) { at.fired.add('tell'); this.staffGlow = 1; this.say('staff_swing', { pitch: 0.5, volume: 0.6 }, 'boss_swing'); }
    if (t > def.tellAt && t < def.releaseAt && Math.random() < dt * 10) this.bfx.drip(this.staffPoint(rand(0.6, 1), _v), 2);
    if (t >= def.releaseAt && this.staffMode === 'hand' && this.hasStaff) {
      this.say('staff_swing', { pitch: 0.4, volume: 1.2 }, 'boss_swing');
      const mark = at.mark; mark.keep = true; at.marks = at.marks.filter(m => m !== mark);
      this.hazards.push(new ThrownStaff(this, at.target.clone(), mark));
      this.hasStaff = false; this.staffMode = 'flying'; this.a.sword = null; this.a.hold = STAND_EMPTY;
    }
  }

  // --------------------------------------------------------------------------------------------- staff

  plantStaff() {
    this.staffMode = 'planted'; this.a.sword = null;
    this.say('bull_slam', { pos: this.staffButt, volume: 0.6, pitch: 1.3 }, 'boss_step');
    const b = this.staffButt.clone(); b.y = this.groundAt(b.x, b.z);
    this.bfx.debris(b, 20, 6); this.bfx.dustRing(b, 4, 16);
    this.plantedPos = this.staff.position.clone(); this.plantedQuat = this.staff.quaternion.clone();
  }

  regripStaff() {
    if (!this.hasStaff) return;
    this.staffMode = 'hand'; this.a.sword = this.staff; this.staffBlend = 0;
  }

  // --------------------------------------------------------------------------------------------- per-frame pose work

  /** The resting pose: asleep -> awake blend, breathing, the head following the player. */
  composeHold(dt, player) {
    if (this.phase === 2 || this.state === 'transition' || this.dead) return;
    const hp = this.holdPose, k = this.wakeK = Math.min(1, this.wakeK + dt * (this.state === 'dormant' ? 0 : 0.5));
    const br = Math.sin(this.time * 0.55) * 1.2;
    let wy = 0, wp = 0;
    if (player && this.state !== 'dormant') {
      const ang = clamp(this.relAngle(player.pos), -1.1, 1.1);
      const head = this.bonePos('Head', _v);
      const dist = Math.max(1, horizDist(head, player.pos));
      wy = ang / DEG * 0.75;
      wp = clamp(Math.atan2(head.y - player.pos.y - 1, dist) / DEG - 18, -10, 32);
    }
    const s = 1 - Math.exp(-2.5 * dt);
    this.lookYaw += (wy - this.lookYaw) * s; this.lookPitch += (wp - this.lookPitch) * s;
    const L = (a, b) => a + (b - a) * k;
    hp.spine[0] = L(SEAT_SLEEP.spine[0], SEAT.spine[0]) + br; hp.spine[1] = this.lookYaw * 0.35 * k;
    hp.head[0] = L(SEAT_SLEEP.head[0], SEAT.head[0] + this.lookPitch * 0.6); hp.head[1] = this.lookYaw * 0.65 * k;
    this.a.hold = hp;
  }

  updateCloth(dt) {
    let want = this.phase === 1 ? 1 : 0;
    const mv = this.a.move;
    if (this.state === 'transition' && mv) want = 1 - smooth(5.6, 8.4, mv.t);
    if (mv && (mv.name === 'kneel' || mv.name === 'death')) want = smooth(0.4, 1.6, mv.t) * 0.8;
    const c = this.cloth;
    if (!c) return;
    const k = c.k < 0 ? want : c.k + clamp(want - c.k, -dt * 1.5, dt * 1.5);
    this.setClothRelax(k);
  }

  syncRoot() {
    const r = this.char.root;
    r.position.set(this.pos.x, this.pos.y - this.sink + (this.lift || 0) * (this.liftW || 0) + (this.jumpY || 0), this.pos.z);
    r.rotation.y = this.yaw;
    r.updateMatrixWorld(true);
  }

  /** After the pose: world-space hand targets, the palm laid flat, the staff, head parts, eyes, cracks. */
  afterPose(dt) {
    this.groundFeet(dt);
    for (const side of ['Left', 'Right']) {
      const ik = this.ik[side];
      if (!ik) continue;
      this.solveHand(side, ik.target, ik.w, ik.flat);
    }
    if (this.critYank > 0) {
      // the monkey hauls the head down by the ring, then the blow knocks it back
      const y = this.critYank, a = y > 0.6 ? (1 - y) / 0.4 : y / 0.6;
      this.rig.turn(this.B.Neck, [-1, 0, 0], (y > 0.6 ? 14 : -10) * a * DEG);
      this.critYank = Math.max(0, y - dt * 1.6);
    }
    // staff
    if (this.staffMode === 'planted' && this.plantedPos) { this.staff.position.copy(this.plantedPos); this.staff.quaternion.copy(this.plantedQuat); this.staff.updateMatrixWorld(true); }
    if (this.staffMode === 'hand' && this.staffBlend < 1 && this.plantedPos) {
      this.staffBlend = Math.min(1, this.staffBlend + dt / 0.35);
      const k = ease.inOut(this.staffBlend);
      this.staff.position.lerpVectors(this.plantedPos, this.staff.position, k);
      _q.copy(this.plantedQuat).slerp(this.staff.quaternion, k); this.staff.quaternion.copy(_q);
      this.staff.updateMatrixWorld(true);
    }
    // 横扫: the staff swells in his hands for the sweep (2026-11-17 user: "棍子要变大，就震撼一些"), and shrinks back after
    {
      const at = this.state === 'attack' ? this.atk : null, mv = this.a?.move;
      const sweep = at && mv && this.staffMode === 'hand' && SWEEPS.has(at.name) && at.def.hits && mv.t < at.def.hits[at.def.hits.length - 1][1] + 0.35;
      const want = sweep ? this.T.sweepStaff : 1, cur = this.staff.scale.x;
      const k = cur + (want - cur) * (1 - Math.exp(-dt * (sweep ? 5 : 3)));
      if (Math.abs(k - cur) > 1e-4 || (this.staffMode !== 'hand' && cur !== 1)) {
        const kk = this.staffMode === 'hand' ? k : 1;
        if (sweep && cur < 1.02 && kk >= 1.02) this.say('staff_swing', { pitch: 0.35, volume: 0.9 }, 'boss_swing');
        this.staff.scale.setScalar(kk); this.staff.updateMatrixWorld(true);
      }
    }
    if (this.staffMode !== 'flying' && this.staffMode !== 'stuck') {
      const L = this.staff.userData.length * this.staff.scale.y, gf = this.staff.userData.gripFrac;
      const y = _v.set(0, 1, 0).applyQuaternion(this.staff.quaternion);
      this.prevButt.copy(this.staffButt); this.prevTip.copy(this.staffTip);
      this.staffButt.copy(this.staff.position).addScaledVector(y, -L * gf);
      this.staffTip.copy(this.staff.position).addScaledVector(y, L * (1 - gf));
      if (dt === 0) { this.prevButt.copy(this.staffButt); this.prevTip.copy(this.staffTip); }
    }
    const crust = this.staff.userData.crust;
    if (crust) { this.staffGlow = Math.max(0, (this.staffGlow || 0) - dt * 0.6); crust.emissiveIntensity = (0.25 + 1.6 * (this.staffGlow || 0)) * (1 - this.look.uniforms.bkC.value.z); }
    // eyes
    this.B.Head.updateMatrixWorld(true);
    const head = this.bonePos('Head', new THREE.Vector3());
    const F = this.headAxis('F', new THREE.Vector3()), U = this.headAxis('U', new THREE.Vector3()), R = this.headAxis('R', new THREE.Vector3());
    this.eyes += ((this.eyesWant + (this.eyeFlare || 0) * 0.8) - this.eyes) * (1 - Math.exp(-(this.eyesWant > this.eyes ? 1.2 : 3) * Math.max(dt, 0.0001)));
    this.eyeFlare = Math.max(0, (this.eyeFlare || 0) - dt * 0.8);
    const hs = this.headSize;
    for (let i = 0; i < 2; i++) {
      const s = this.eyeSprites[i], side = i ? 1 : -1;
      const E = BULL_TUNING.eye;   // behind the eye holes of the gold mask
      s.position.copy(head).addScaledVector(F, E[0] * hs).addScaledVector(U, E[1] * hs).addScaledVector(R, side * E[2] * hs);
      s.scale.setScalar(hs * E[3] * (0.8 + 0.4 * Math.min(1.5, this.eyes)));
      this.eyeMats[i].opacity = clamp(this.eyes, 0, 1.4) * (0.75 + 0.1 * Math.sin(this.time * 3.1 + i));
    }
    // bodies
    this.updateBodyCircles();
    this.syncBeast(dt);
  }

  /** 现原形: during the run of his charge he is a great white bull; before and after, the bull king again. */
  syncBeast(dt) {
    const b = this.beast;
    if (!b) return;
    this.tickAfterimages(dt);
    const at = this.atk, mv = this.a.move;
    // (a boolean: a null here - no move - once read as a change and turned him back again, the afterimages twice more)
    const want = !!(!this.dead && this.state === 'attack' && at && at.name === 'charge' && mv && mv.t >= at.def.runAt && mv.t < at.def.runEnd + 0.5);
    if (want !== this.beastOn) this.setBeast(want);
    if (!this.beastOn) return;
    const L = this.T.beastLen * this.T.height, k = L / b.len;
    // the skid: he slides on, his stride dying, before he turns back into himself
    let gait = 1;
    if (at.skidV > 0) {
      at.skidV *= Math.exp(-dt * 3.5); gait = at.skidV / (this.T.chargeSpeed * this.T.beastSpeed);
      const f = this.fwd(_v); this.pos.x += f.x * at.skidV * dt; this.pos.z += f.z * at.skidV * dt; this.keepIn(16);
    }
    this.beastIn = Math.min(1, (this.beastIn || 0) + dt * 5);
    const ph = this.beastPhase = (this.beastPhase || 0) + dt * gait / this.T.beastStride;
    this.gallop(ph * Math.PI * 2, gait);
    const gy = this.groundAt(this.pos.x, this.pos.z), TAU = Math.PI * 2;
    // the body rides the stride: up in the flight after the forelegs push off, down when the hind legs land
    const bob = (0.5 + 0.5 * Math.sin(ph * TAU - 0.6)) * 0.035 * L * gait;
    const f = this.fwd(_v);
    b.root.position.set(this.pos.x - f.x * 0.3 * L, gy, this.pos.z - f.z * 0.3 * L);      // the horns lead: his head is where he is
    b.root.rotation.set(0.07 * Math.sin(ph * TAU + 0.9) * gait - 0.03, this.yaw, 0.02 * Math.sin(ph * TAU * 0.5), 'YXZ');
    b.root.scale.setScalar(k * (0.75 + 0.25 * this.beastIn));
    b.root.position.y = gy + bob - hoofLift(b);          // the lowest hoof on the ground (plus the flight of the stride)
    // each hoof that lands shakes the ground
    const beat = Math.floor(ph * 2);
    if (beat !== this.beastBeat) { this.beastBeat = beat; if (gait > 0.3) { this.cam?.addTrauma(0.18 * gait); this.say('bull_stomp', { pos: this.pos, volume: 0.5 * gait, pitch: 0.7 + Math.random() * 0.15 }, 'boss_step'); } }
    // dust from the hooves
    if (Math.random() < dt * 30 * gait) {
      const r = this.right(_w), side = Math.random() < 0.5 ? -1 : 1, back = rand(-0.7, 0.1) * L;
      this.bfx.add.emit(_p.set(this.pos.x + f.x * back + r.x * side * 0.12 * L, gy + 0.3, this.pos.z + f.z * back + r.z * side * 0.12 * L), new THREE.Vector3(rand(-2, 2) - f.x * 6, rand(2, 5), rand(-2, 2) - f.z * 6), Math.random() < 0.5 ? C.dust : C.dustLit, { size: rand(5, 12), life: rand(0.7, 1.4), drag: 0.8, grav: -0.5, alpha: 0.4, grow: 1.8 });
    }
  }

  /** The white bull's stride (gallopPose), his side axis taken from his heading. */
  gallop(ph, k) { gallopPose(this.beast, ph, k, this.right(_e).negate()); }

  /** Turn into the white bull (on) or back (off): a burst of smoke and gold hides the change. */
  setBeast(on, quiet = false) {
    const b = this.beast;
    if (!b) return;
    this.beastOn = on; this.beastIn = 0;
    b.root.visible = on;
    this.char.root.visible = !on;
    if (this.staff) this.staff.visible = !on && this.hasStaff;
    for (const s of this.eyeSprites || []) s.visible = !on;
    if (this.mouthGlow) this.mouthGlow.visible = !on;
    if (on) { this.beastPhase = 0; this.beastBeat = -1; }
    if (quiet) { this.clearAfterimages(); return; }
    if (!on) this.spawnAfterimages();
    const c = this.bonePos('Spine2', new THREE.Vector3());
    this.bfx.smoke(c, 18, { size: [8, 18], spread: 9, rise: 6, life: [0.8, 1.6], alpha: 0.5, color: C.ash });
    this.fx.shockwave(c, on ? 30 : 22, 0.45, new THREE.Color(1.0, 0.85, 0.5));
    if (on) this.say('bull_roar', { pos: c, pitch: 0.6, volume: 1 }, 'stagger');
    this.events.push({ type: on ? 'beast' : 'beastEnd' });
  }

  /**
   * 拖影 (2026-11-17 user: "白牛变成牛魔王时，要有个拖影动画"): as the white bull turns back into him, a train of glowing
   * copies of the bull - frozen in his last stride, strung out behind along the line he ran - rushes in, shrinking, onto
   * the Bull King where he stands, and fades.
   */
  spawnAfterimages() {
    const b = this.beast;
    if (!b) return;
    this.clearAfterimages();
    b.root.updateMatrixWorld(true);
    const f = this.fwd(new THREE.Vector3()), L = this.T.beastLen * this.T.height, N = 6;
    const to = new THREE.Vector3(this.pos.x, this.pos.y, this.pos.z), s0 = b.root.scale.x;
    // his own size against the bull's: the copies end at about the King's height
    const s1 = s0 * this.T.height / Math.max(1, b.height * s0) * 0.9;
    this.ghosts = [];
    for (let i = 0; i < N; i++) {
      const g = SkeletonUtils.clone(b.root);
      g.traverse(o => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshBasicMaterial({ color: i === 0 ? 0xfff4dc : 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
        o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
      });
      g.visible = true;
      const from = b.root.position.clone().addScaledVector(f, -i * 0.11 * L);
      g.position.copy(from);
      this.scene.add(g);
      this.ghosts.push({ g, from, to: to.clone(), s0, s1, t: -i * 0.05, life: 0.55, a: 0.42 * (1 - i / (N + 1)) });
    }
  }

  tickAfterimages(dt) {
    if (!this.ghosts?.length) return;
    for (const q of this.ghosts) {
      q.t += dt;
      const u = clamp(q.t / q.life, 0, 1), e = 1 - (1 - u) ** 3;
      q.g.position.lerpVectors(q.from, q.to, e);
      q.g.scale.setScalar(q.s0 + (q.s1 - q.s0) * e);
      const a = q.t < 0 ? 0 : q.a * (1 - u) * Math.min(1, q.t / 0.06);
      q.g.traverse(o => { if (o.isMesh) o.material.opacity = a; });
      if (u >= 1) q.done = true;
    }
    for (const q of this.ghosts) if (q.done) this.dropGhost(q);
    this.ghosts = this.ghosts.filter(q => !q.done);
  }

  dropGhost(q) {
    q.g.removeFromParent();
    q.g.traverse(o => { if (o.isMesh) o.material.dispose(); });
  }

  clearAfterimages() {
    for (const q of this.ghosts || []) this.dropGhost(q);
    this.ghosts = [];
  }

  /** The surface a hoof (or a knee) at (x, z) rests on: pressed a little into rock, ankle-deep in the lava lake. */
  supportY(x, z) {
    const g = this.groundAt(x, z), lava = this.arena?.lavaAt ? this.arena.lavaAt(x, z) || 0 : 0;
    if (lava > 0.5) return Math.min(g, this.arena.lavaY ?? g) - this.T.wade;
    return g - this.T.press;
  }

  /** Lowest point of a hoof (world). */
  soleOf(side, out = new THREE.Vector3()) {
    out.set(0, Infinity, 0);
    for (const s of this.soles[side]) { _p.copy(s.local).applyMatrix4(s.bone.matrixWorld); if (_p.y < out.y) out.copy(_p); }
    if (out.y === Infinity) this.bonePos(side + 'ToeBase', out);
    return out;
  }

  /**
   * Standing, he is carried by his hooves: the model's clips hold the soles well above its root (the root sits at the
   * lowest point of the bind pose, a pointed hoof), so the root is lowered until the supporting hoof — or a knee, when
   * he kneels — rests on what is under it. Fades in as he draws his feet under him in the rise; frozen once he falls.
   */
  groundFeet(dt) {
    const mv = this.a.move;
    let w = 0;
    if (this.state === 'transition') w = mv ? smooth(this.T.groundIn[0], this.T.groundIn[1], mv.t) : 1;
    else if (this.phase === 2) w = 1;
    this.liftW = w;
    if (w <= 0) { this.lift = 0; return; }
    if (this.dead && this.deathT > 1.2) return;            // toppling: keep what he had
    if (this.jumpY > 0.5) return;                          // in the air (锤地): the hooves leave the ground
    // the clips stand him on the very points of his hooves, the fetlocks metres in the air: from the front he seems
    // to hover. Lay each hoof down along the ground (its point a little below the ankle, T.hoofPitch) while the leg is
    // under him; a leg folded behind him (kneeling) keeps its own angle.
    for (const s of ['Left', 'Right']) {
      const tipL = this.hoofTip[s], foot = this.B[s + 'Foot'];
      if (!tipL || !foot) continue;
      const knee = this.bonePos(s + 'Leg', _e), up = (knee.y - this.groundAt(knee.x, knee.z)) / this.legLen;
      const fw = w * smooth(0.22, 0.4, up);
      if (fw <= 0.001) continue;
      foot.updateMatrixWorld(true);
      const ankle = foot.getWorldPosition(_ha), dir = _hb.copy(tipL).applyMatrix4(foot.matrixWorld).sub(ankle);
      const h = _hc.set(dir.x, 0, dir.z);
      if (h.lengthSq() < 1e-4 * dir.lengthSq()) this.fwd(h);
      h.normalize();
      const a = this.T.hoofPitch * DEG;
      this.rig.rotateWorld(foot, _q.setFromUnitVectors(dir.normalize(), _p.copy(h).multiplyScalar(Math.cos(a)).setY(-Math.sin(a))), fw);
    }
    let d = Infinity, d2 = Infinity;
    for (const s of ['Left', 'Right']) {
      const sole = this.soleOf(s, _e);
      let di = sole.y - this.supportY(sole.x, sole.z);
      const k = this.bonePos(s + 'Leg', _e);
      di = Math.min(di, k.y - this.legLen * 0.075 - (this.groundAt(k.x, k.z) - this.T.press));
      if (di < d) { d2 = d; d = di; } else if (di < d2) d2 = di;
    }
    // both feet down on uneven ground: stand on the higher one's terms only when the other is nearly there too
    if (d2 - d < this.legLen * 0.05) d = (d + d2) / 2;
    const want = this.lift * w - d;        // (measured with lift * w applied: the full offset that makes contact)
    if (dt <= 0 || this.liftFresh) { this.lift = want; this.liftFresh = false; }
    else this.lift += (want - this.lift) * (1 - Math.exp(-16 * dt));
  }

  /** Arm IK to a world target with an optional flat palm; leans further forward when the ground is out of reach. */
  solveHand(side, target, w, flat) {
    const B = this.B, rig = this.rig;
    const len = this.hand[side].len;
    const dir = this.palmDir(target, new THREE.Vector3());
    const wrist = target.clone().addScaledVector(dir, -len * 0.42).addScaledVector(UP, len * 0.3);
    // lean until the wrist is within reach (a few small steps of the upper spine)
    for (let i = 0; i < 4; i++) {
      const sh = B[side + 'Arm'].getWorldPosition(_v);
      const need = sh.distanceTo(wrist) - this.armLen * 0.985;
      if (need <= 0) break;
      const ang = Math.min(9, need / this.armLen * 70) * DEG * w;
      rig.turn(B.Spine1, [-1, 0, 0], ang * 0.5); rig.turn(B.Spine2, [-1, 0, 0], ang * 0.5);
    }
    const out = side === 'Left' ? -1 : 1;
    const pole = this.right(new THREE.Vector3()).multiplyScalar(out * 0.8).addScaledVector(UP, 0.35).addScaledVector(this.fwd(_w), -0.4);
    rig.ik(B[side + 'Arm'], B[side + 'ForeArm'], B[side + 'Hand'], wrist, pole, w);
    rig.aim(B[side + 'Hand'], B[side + 'HandMiddle1'], dir.clone().addScaledVector(UP, flat ? -0.12 : 0.1), w);
    if (flat) this.flattenPalm(side, w);
  }

  /** Roll the hand about its own axis until its back faces the sky. */
  flattenPalm(side, w) {
    const B = this.B, hand = B[side + 'Hand'];
    const h = B[side + 'HandMiddle1'].getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(_v)).normalize();
    const back = this.hand[side].back.clone().applyQuaternion(hand.getWorldQuaternion(_q));
    const b = back.addScaledVector(h, -back.dot(h)).normalize();
    const u = new THREE.Vector3(0, 1, 0).addScaledVector(h, -h.y).normalize();
    const ang = Math.atan2(_w.crossVectors(b, u).dot(h), b.dot(u));
    this.rig.rotateWorld(hand, _q.setFromAxisAngle(h, ang * w));
  }

  updateBodyCircles() {
    const c = this.bodyCircles || (this.bodyCircles = Array.from({ length: 6 + STAFF_CIRCLES }, () => ({ x: 0, z: 0, r: 0 })));
    const L = this.legLen;
    const set = (i, p, r) => { c[i].x = p.x; c[i].z = p.z; c[i].r = r; };
    set(0, this.bonePos('Hips', _v), L * (this.phase === 1 ? 0.42 : this.duel ? 0.62 : 0.22));       // (the duel: a body a giant cannot stand inside)
    if (this.phase === 1) {
      set(1, this.bonePos('LeftLeg', _v), L * 0.17); set(2, this.bonePos('RightLeg', _v), L * 0.17);
      set(3, this.bonePos('LeftFoot', _v), L * 0.15); set(4, this.bonePos('RightFoot', _v), L * 0.15);
    } else if (this.duel) {
      // two giants: the whole of him is solid - the feet, the chest that leans out over them in the swings, the head
      set(1, this.bonePos('LeftFoot', _v), L * 0.2); set(2, this.bonePos('RightFoot', _v), L * 0.2);
      set(3, this.bonePos('Spine2', _v), L * 0.5); set(4, this.bonePos('Head', _v), L * 0.3);
    } else {
      set(1, this.bonePos('LeftFoot', _v), L * 0.13); set(2, this.bonePos('RightFoot', _v), L * 0.13);
      set(3, this.bonePos('LeftLeg', _v), 0); set(4, this.bonePos('RightLeg', _v), 0);
    }
    const resting = this.weak.handL.resting ? 'Left' : this.weak.handR.resting ? 'Right' : null;
    if (resting) set(5, this.handCenter(resting, _hc), this.hand[resting].len * 0.45); else c[5].r = 0;
    // the iron staff lying on the stone (the prologue) is a wall, not a ghost: neither the monkey nor the lens goes into it
    const A = this.staffButt, B = this.staffTip;
    const still = this._tipLast && B.distanceTo(this._tipLast) < 0.05;
    (this._tipLast || (this._tipLast = new THREE.Vector3())).copy(B);
    this._stillN = still ? (this._stillN || 0) + 1 : 0;
    const lying = this.phase === 1 && this.staffMode === 'hand' && this._stillN > 12
      && A.y - this.groundAt(A.x, A.z) < 3.2 && B.y - this.groundAt(B.x, B.z) < 3.2;
    const sr = (this.staff?.userData.radius || this.T.staffRadius) * 1.7;
    for (let i = 0; i < STAFF_CIRCLES; i++) {
      const k = c[6 + i], f = i / (STAFF_CIRCLES - 1);
      if (!lying) { k.r = 0; continue; }
      k.x = A.x + (B.x - A.x) * f; k.z = A.z + (B.z - A.z) * f; k.r = sr; k.top = 2.6; k.staff = true;
    }
  }

  // --------------------------------------------------------------------------------------------- zones / cracks

  tickWeak(dt) {
    for (const p of PARTS) {
      const w = this.weak[p];
      w.flash = Math.max(0, w.flash - dt * 3);
      w.burst = Math.max(0, w.burst - dt * 0.25);
      w.exposedT = Math.max(0, w.exposedT - dt);
      if (w.broken && w.regrowT > 0 && this.state !== 'down') {
        w.regrowT -= dt;
        if (w.regrowT <= 0) {
          this.resetWeak(p, this.phase);
          this.bfx.embers(w.pos, 12, { spread: 1, up: 2 });
          this.events.push({ type: 'weakRegrow', part: p });
        }
      }
    }
  }

  updateZones() {
    const B = this.B, L = this.legLen, hs = this.headSize;
    if (!this.zones.length) {
      const z = (part, r) => ({ part, a: new THREE.Vector3(), b: new THREE.Vector3(), r });
      this.zones = [z('handL', 0), z('handR', 0), z('kneeL', 0), z('kneeR', 0), z('head', 0),
        z('body', 0), z('body', 0), z('body', 0), z('body', 0), z('body', 0), z('body', 0), z('body', 0), z('body', 0), z('body', 0), z('body', 0),
        z('staff', 0)];
      this.locks = ['handL', 'handR', 'kneeL', 'kneeR', 'head', 'body', 'staff'].map(part => ({ part, pos: new THREE.Vector3(), weak: part !== 'body' && part !== 'head', broken: false, open: true }));
    }
    const Z = this.zones;
    const u = this.look.uniforms;
    // hands
    ['Left', 'Right'].forEach((s, i) => {
      const zone = Z[i], len = this.hand[s].len, w = this.weak[zone.part];
      this.bonePos(s + 'Hand', zone.a);
      zone.b.copy(zone.a).lerp(this.bonePos(s + 'HandMiddle1', _v), 1.7);
      zone.r = len * 0.36;
      this.handCenter(s, w.pos);
      const back = this.hand[s].back.clone().applyQuaternion(B[s + 'Hand'].getWorldQuaternion(_q));
      w.pos.addScaledVector(back, len * 0.12);
      const hd = this.hand[s];
      u.bkWA.value[i].set(hd.bindC.x, hd.bindC.y, hd.bindC.z, hd.bindR);
      u.bkWB.value[i].set(hd.bindC.x, hd.bindC.y, hd.bindC.z, this.crackGlow(w));
      u.bkWC.value[i].set(1 - w.hp / w.max, w.broken ? 1 : 0, w.flash, w.burst);
    });
    // knees
    ['Left', 'Right'].forEach((s, j) => {
      const i = 2 + j, zone = Z[i], w = this.weak[zone.part], kn = this.knee[s];
      const knee = this.bonePos(s + 'Leg', _w);
      if (this.phase === 1) {
        zone.a.copy(knee).lerp(this.bonePos(s + 'UpLeg', _v), 0.12);
        zone.b.copy(knee).lerp(this.bonePos(s + 'Foot', _v), 0.14);
        zone.r = L * 0.13;
        u.bkWA.value[i].set(kn.a1.x, kn.a1.y, kn.a1.z, kn.r1); u.bkWB.value[i].set(kn.b1.x, kn.b1.y, kn.b1.z, this.crackGlow(w));
        w.pos.copy(knee).lerp(this.bonePos(s + 'Foot', _v), 0.05);
      } else {
        // standing: the crack runs down the lower shin, over the ankle and into the hoof — the part of him a 1.5 m
        // monkey can reach (the knee itself is ten metres up)
        const foot = this.bonePos(s + 'Foot', _v), sole = this.soleOf(s, _e);
        zone.a.copy(knee).lerp(foot, 0.5);
        zone.b.copy(foot).lerp(this.bonePos(s + 'ToeBase', _w), 0.75); zone.b.y = (zone.b.y + sole.y) * 0.5;
        zone.r = L * 0.135;
        u.bkWA.value[i].set(kn.a2.x, kn.a2.y, kn.a2.z, kn.r2); u.bkWB.value[i].set(kn.b2.x, kn.b2.y, kn.b2.z, this.crackGlow(w));
        // the lock: the front of the ankle, at the height of the monkey's swing
        w.pos.copy(zone.b).lerp(zone.a, 0.12); w.pos.y = Math.min(w.pos.y, Math.max(sole.y, this.groundAt(w.pos.x, w.pos.z)) + 1.6);
      }
      u.bkWC.value[i].set(1 - w.hp / w.max, w.broken ? 1 : 0, w.flash, w.burst);
    });
    // head
    this.bonePos('Head', Z[4].a); Z[4].b.copy(Z[4].a).addScaledVector(this.headAxis('F', _v), hs * 0.55).addScaledVector(this.headAxis('U', _w), -hs * 0.2);
    Z[4].r = hs * 0.55;
    // body (rock): torso, neck, thighs, shins, upper arms, forearms
    const seg = (i, a, b, r) => { this.bonePos(a, Z[i].a); this.bonePos(b, Z[i].b); Z[i].r = r; };
    seg(5, 'Hips', 'Spine2', L * 0.3); seg(6, 'Spine2', 'Neck', L * 0.26);
    seg(7, 'LeftUpLeg', 'LeftLeg', L * 0.13); seg(8, 'RightUpLeg', 'RightLeg', L * 0.13);
    seg(9, 'LeftLeg', 'LeftFoot', L * 0.11); seg(10, 'RightLeg', 'RightFoot', L * 0.11);
    seg(11, 'LeftArm', 'LeftForeArm', L * 0.09); seg(12, 'RightArm', 'RightForeArm', L * 0.09);
    seg(13, 'LeftForeArm', 'LeftHand', L * 0.075); seg(14, 'RightForeArm', 'RightHand', L * 0.075);
    // the staff lying on the ground after a slam (the opening blow): something to hit
    // (the staff lying after the slam is no longer something to hit: 2026-11-17 user: "现在还是让我打棍子" - the bull is the target)
    const sz = Z[15], lying = false;
    if (lying) { sz.a.copy(this.staffPoint(0.3, _v)); sz.b.copy(this.staffTip); sz.r = (this.staff.userData.radius || 0.8) * 1.15; }
    else { sz.a.set(0, -1e4, 0); sz.b.set(0, -1e4, 0); sz.r = 0; }
    // lock targets
    const lk = this.locks;
    for (let i = 0; i < 4; i++) { const w = this.weak[PARTS[i]]; lk[i].pos.copy(w.pos); lk[i].broken = w.broken; lk[i].weak = w.active; lk[i].open = w.active && !w.broken; }
    lk[4].pos.copy(Z[4].a).lerp(Z[4].b, 0.6); lk[4].open = this.state === 'down';
    this.bonePos('Spine2', lk[5].pos);
    // (the staff: its near part, where the monkey stands when he has dodged the blow)
    if (lying) { const pl = this.player && !this.player.ghost ? this.player.pos : sz.b; const r = segSeg(sz.a, sz.b, pl, pl); lk[6].pos.copy(r.c1); lk[6].pos.y += sz.r * 0.5; }
    else lk[6].pos.copy(lk[5].pos);
    lk[6].weak = false; lk[6].open = false; lk[6].broken = false;     // (never a lock target: the lock goes on the bull)
  }

  /** Brightness of a crack: dim at rest, brighter with damage and while exposed, a hot core once broken. */
  crackGlow(w) {
    if (!w.active) return 0;
    if (w.broken) return 0.25 + 0.6 * w.burst;
    const dmg = 1 - w.hp / w.max;
    return 0.38 + 1.5 * dmg + (w.resting ? 0.5 : 0) + (w.exposedT > 0 ? 0.6 + 0.3 * Math.sin(this.time * 14) : 0);
  }

  // --------------------------------------------------------------------------------------------- hazards / ambience

  tickHazards(dt, player) {
    this.hazards = this.hazards.filter(h => h.update(dt, player));
    for (const f of this.groundFires) {
      f.t += dt; f.hitCd -= dt;
      f.mark.u.uTime.value = this.time;
      f.mark.u.uFade.value = smooth(f.life - 1.2, f.life, f.t);
      const big = f.r > 12 ? 4 : 1;
      if (!f.out && Math.random() < dt * (big > 1 ? 60 : 5)) { const a = rand(0, 6.283), q = Math.sqrt(Math.random()) * f.r * 0.8; this.bfx.add.emit(_v.set(f.x + Math.cos(a) * q, this.groundAt(f.x, f.z) + 0.3 * big, f.z + Math.sin(a) * q), _w.set(rand(-0.5, 0.5) * big, rand(2, 4) * big, rand(-0.5, 0.5) * big), Math.random() < 0.25 ? C.fireCore : C.fire, { size: rand(0.8, 1.8) * big, life: rand(0.4, 0.8) * (big > 1 ? 1.6 : 1), drag: 0.6, grav: 2, alpha: big > 1 ? 0.3 : 0.7, grow: 1.2 }); }
      if (!f.out && player && !player.dead && f.hitCd <= 0 && f.t > f.arm && Math.hypot(player.pos.x - f.x, player.pos.z - f.z) < f.r * 0.85 && (this.duel || player.pos.y - this.groundAt(f.x, f.z) < 1)) {
        f.hitCd = f.tick;
        this.hitPlayer(player, { dmg: f.dmg, kind: 'light', blockable: false }, new THREE.Vector3(f.x, 0, f.z), 'fire');
      }
    }
    this.groundFires = this.groundFires.filter(f => { if (f.t >= f.life) { f.mark.remove(); return false; } return true; });
  }

  ambient(dt) {
    if (this.dead && this.deathT > 6) return;
    const k = this.state === 'dormant' ? 0.4 : 1;
    // ash sliding off the shoulders, embers rising from the cracks: the mountain breathes
    if (Math.random() < dt * 1.2 * k) {
      const p = this.bonePos(Math.random() < 0.5 ? 'LeftShoulder' : 'RightShoulder', _v);
      this.bfx.alpha.emit(_v.set(p.x + rand(-2, 2), p.y + 1, p.z + rand(-2, 2)), _w.set(rand(-0.4, 0.4), rand(-1.5, -0.3), rand(-0.4, 0.4)), C.ash, { size: rand(1.5, 3), life: rand(2, 3.5), drag: 0.6, grav: -0.8, alpha: 0.22, grow: 1.5 });
    }
    if (Math.random() < dt * 3 * k) {
      const names = ['Spine2', 'Spine1', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg', 'Neck'];
      const p = this.bonePos(names[(Math.random() * names.length) | 0], _v);
      this.bfx.embers(p, 1, { spread: 3, up: 1.6, size: [0.12, 0.3], life: [2, 4] });
    }
    for (const p of PARTS) {
      const w = this.weak[p];
      if (w.active && !w.broken && Math.random() < dt * (0.6 + 2 * (1 - w.hp / w.max)) * k) this.bfx.embers(w.pos, 1, { spread: 0.8, up: 1.4 });
      if (w.broken && w.burst > 0.2 && Math.random() < dt * 8) this.bfx.smoke(w.pos, 1, { size: [1.5, 3], rise: 2, alpha: 0.25 });
    }
    if (this.hasStaff && Math.random() < dt * 0.8 * k) this.bfx.drip(this.staffPoint(0.97, _v), 1);
  }
}

// ------------------------------------------------------------------------------------------------ hazards

const WAVE_VS = /* glsl */`varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const WAVE_FS = /* glsl */`uniform float uT; uniform float uTime; uniform vec2 uC; uniform vec4 uGaps[8]; varying vec2 vUv; varying vec3 vW;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main(){
    vec2 d = vW.xz - uC; float ang = atan(d.y, d.x), r = length(d);
    for (int i = 0; i < 8; i++) { vec4 g = uGaps[i]; if (g.w < 0.5) continue; float da = abs(atan(sin(ang - g.x), cos(ang - g.x))); if (da < g.y && r > g.z) discard; }
    float y = vUv.y;
    float crest = n(vec2(vUv.x * 160.0, uTime * 3.0)) * 0.35 + 0.65;
    if (y > crest) discard;
    float hot = smoothstep(crest, crest - 0.25, y) * (0.6 + 0.4 * n(vec2(vUv.x * 90.0 - uTime * 2.0, y * 4.0 - uTime * 5.0)));
    vec3 c = mix(vec3(0.5, 0.06, 0.01), vec3(1.0, 0.42, 0.1), hot) * (1.0 - uT * 0.6);
    float a = (0.55 + 0.45 * hot) * (1.0 - smoothstep(0.75, 1.0, uT));
    gl_FragColor = vec4(c * 1.6, a); }`;

/** A ring of lava pushed out by a stomp. Damages once as its crest passes; pillars break it (they cast a gap). */
class LavaWave {
  constructor(bull, center, hitSet, duel = false) {
    this.b = bull; this.c = center.clone(); this.t = 0; this.dur = duel ? 0.55 + (125 - 20) / 46 : 1.9; this.max = duel ? 125 : 40; this.hitSet = hitSet; this.duel = duel;
    this.r = 3;
    const gaps = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector4());
    const cols = duel ? [] : (bull.arena?.colliders || []).filter(c => Math.hypot(c.x - center.x, c.z - center.z) < this.max + c.r).slice(0, 8);
    cols.forEach((c, i) => {
      const dx = c.x - center.x, dz = c.z - center.z, d = Math.hypot(dx, dz);
      gaps[i].set(Math.atan2(dz, dx), Math.asin(Math.min(0.99, c.r / Math.max(d, c.r + 0.01))), d, 1);
    });
    this.gaps = gaps;
    this.mat = new THREE.ShaderMaterial({ vertexShader: WAVE_VS, fragmentShader: WAVE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uTime: { value: 0 }, uC: { value: new THREE.Vector2(center.x, center.z) }, uGaps: { value: gaps } } });
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true).translate(0, 0.5, 0), this.mat);
    this.mesh.position.copy(this.c); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    bull.scene.add(this.mesh);
  }
  update(dt, player) {
    this.t += dt;
    const f = Math.min(1, this.t / this.dur);
    const D = this.duel;
    // (the duel: the ring gathers round the hoof for a beat - time to see it - then rolls out at a steady pace)
    this.live = !D || this.t >= 0.55;
    this.r = D ? (this.live ? 20 + (this.t - 0.55) * 46 : 20 * smooth(0, 0.55, this.t)) : 3 + (this.max - 3) * (1 - Math.pow(1 - f, 1.6));
    const h = (D ? 11 : 3.2) * (1 - f * 0.55) * (this.live ? 1 : 0.35 + 0.65 * this.t / 0.55);
    this.mesh.scale.set(this.r, h, this.r);
    this.mat.uniforms.uT.value = f; this.mat.uniforms.uTime.value = this.b.time;
    for (let i = D ? 4 : 1; i--;) if (Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2, x = this.c.x + Math.cos(a) * this.r, z = this.c.z + Math.sin(a) * this.r, k = D ? 3 : 1;
      if (D || !this.b.occluded(this.c.x, this.c.z, x, z)) this.b.bfx.add.emit(_v.set(x, this.b.groundAt(x, z) + h * 0.8, z), _w.set(Math.cos(a) * 4 * k, rand(2, 6) * k, Math.sin(a) * 4 * k), C.lava, { size: rand(0.5, 1.2) * k, life: rand(0.4, 0.8), drag: 0.5, grav: -10 * k, alpha: 0.9 });
    }
    if (this.live && player && !player.dead && !this.hitSet.has('wave')) {
      const d = horizDist(player.pos, this.c);
      if ((D ? d - this.r > -1.5 && d - this.r < 5 : Math.abs(d - this.r) < 1.8) && player.pos.y - this.b.groundAt(player.pos.x, player.pos.z) < h * 0.8 && (D || !this.b.occluded(this.c.x, this.c.z, player.pos.x, player.pos.z))) {
        this.hitSet.add('wave');
        this.b.hitPlayer(player, { dmg: D ? this.b.T.duelWaveDmg : this.b.T.waveDmg, kind: 'heavy' }, new THREE.Vector3(this.c.x, 0, this.c.z), 'stomp');
      }
    }
    if (f >= 1) { this.remove(); return false; }
    return true;
  }
  remove() { this.b.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/** A lava bomb: a ring on the ground fills, the bomb comes down out of the smoke, bursts. */
class Meteor {
  constructor(bull, target, dur, scale = 1) {
    this.b = bull; this.target = target; this.dur = dur; this.t = 0; this.k = scale;
    this.mark = new GroundMark(bull.scene, bull.arena, 'ring', { w: 8 * scale, l: 8 * scale, segs: 8, uniforms: { uT: { value: 0 }, uFade: { value: 0 } } }).place(target.x, target.z, 0);
    const back = bull.fwd(new THREE.Vector3()).multiplyScalar(-60);
    this.from = new THREE.Vector3(target.x * 0.4 + bull.pos.x * 0.6 + back.x + rand(-20, 20), 140, target.z * 0.4 + bull.pos.z * 0.6 + back.z + rand(-20, 20));
    if (!Meteor.geo) Meteor.geo = new THREE.DodecahedronGeometry(1.4, 1);
    if (!Meteor.mat) Meteor.mat = new THREE.MeshStandardMaterial({ color: 0x1a0f0a, emissive: new THREE.Color(1.0, 0.35, 0.08), emissiveIntensity: 2.2, roughness: 0.9 });
    // (a giant's bomb is seen from close by: a dark rock with a dull glow, the fire is in its trail)
    if (scale > 1 && !Meteor.matBig) Meteor.matBig = new THREE.MeshStandardMaterial({ color: 0x2a1a12, emissive: new THREE.Color(0.9, 0.22, 0.04), emissiveIntensity: 0.55, roughness: 1, flatShading: true });
    this.rock = new THREE.Mesh(Meteor.geo, scale > 1 ? Meteor.matBig : Meteor.mat); this.rock.visible = false; this.rock.scale.setScalar(scale);
    bull.scene.add(this.rock);
    this.flight = 0.75;
  }
  update(dt, player) {
    const b = this.b;
    this.t += dt;
    this.mark.u.uTime.value = b.time;
    this.mark.u.uT.value = Math.min(1, this.t / this.dur);
    const fl0 = this.dur - this.flight;
    if (this.t >= fl0 && this.t < this.dur) {
      const u = (this.t - fl0) / this.flight;
      this.rock.visible = true;
      this.rock.position.lerpVectors(this.from, this.target, u * u * 0.3 + u * 0.7);
      this.rock.rotation.x += dt * 5; this.rock.rotation.z += dt * 3;
      for (let i = 0; i < 3; i++) b.bfx.add.emit(this.rock.position, _w.set(rand(-1, 1), rand(-1, 2), rand(-1, 1)), Math.random() < 0.4 ? C.fireCore : C.fire, { size: rand(1.5, 3.2) * this.k, life: rand(0.3, 0.6), drag: 1, grav: 0, alpha: 0.85, grow: 1.4 });
      if (Math.random() < 0.5) b.bfx.alpha.emit(this.rock.position, _w.set(rand(-1, 1), rand(0, 2), rand(-1, 1)), C.smoke, { size: rand(3, 6), life: rand(1.2, 2), drag: 0.6, grav: 0.2, alpha: 0.3, grow: 1.4 });
    }
    if (this.t >= this.dur && !this.done) {
      this.done = true; this.rock.visible = false;
      const p = this.target.clone();
      b.arena?.eruption?.(p.x, p.z, 1);
      b.bfx.burst(p.clone().setY(p.y + 0.5), 0.9 * this.k); b.bfx.debris(p, 30, 10 * this.k); b.bfx.dustRing(p, 5 * this.k, 20);
      if (this.k > 1) b.fx.shockwave(p.clone().setY(p.y + 0.5), 4.2 * this.k, 0.5, new THREE.Color(1.0, 0.45, 0.12));
      b.say('lava_burst', { pos: p, volume: 0.9 }, 'pillar_blast');
      b.cam?.addTrauma(Math.max(0.1, 0.45 - (player ? horizDist(player.pos, p) * 0.01 : 0)));
      if (player && !player.dead && horizDist(player.pos, p) < 4.2 * this.k && player.pos.y - p.y < 3) b.hitPlayer(player, { dmg: this.k > 1 ? b.T.duelMeteorDmg : b.T.meteorDmg, kind: 'heavy' }, p, 'meteor');
    }
    if (this.done) this.mark.u.uFade.value = Math.min(1, (this.t - this.dur) / 0.4);
    if (this.t > this.dur + 0.5) { this.remove(); return false; }
    return true;
  }
  remove() { this.mark.remove(); this.b.scene.remove(this.rock); }
}

/** The staff flung like a javelin: a high arc, head first into the ground, where it stays as a new pillar. */
class ThrownStaff {
  constructor(bull, target, mark) {
    this.b = bull; this.target = target; this.mark = mark; this.t = 0;
    const s = bull.staff, L = s.userData.length, gf = s.userData.gripFrac;
    this.L = L; this.gf = gf;
    this.p0 = bull.staffPoint(1, new THREE.Vector3());         // the head leads
    this.T = 1.15; this.g = 52;
    const sink = 5;
    this.p1 = target.clone(); this.p1.y -= sink;
    this.v0 = new THREE.Vector3().subVectors(this.p1, this.p0).divideScalar(this.T); this.v0.y += 0.5 * this.g * this.T;
    this.stuck = false;
  }
  update(dt, player) {
    const b = this.b, s = b.staff;
    if (!this.stuck) {
      this.t = Math.min(this.T, this.t + dt);
      const head = this.p0.clone().addScaledVector(this.v0, this.t); head.y -= 0.5 * this.g * this.t * this.t;
      const vel = this.v0.clone(); vel.y -= this.g * this.t;
      const dir = vel.normalize();            // +Y of the staff points along the flight (head first)
      s.quaternion.setFromUnitVectors(UP, dir);
      s.position.copy(head).addScaledVector(dir, -this.L * (1 - this.gf));
      s.updateMatrixWorld(true);
      b.staffTip.copy(head); b.staffButt.copy(s.position).addScaledVector(dir, -this.L * this.gf);
      this.mark.u.uTime.value = b.time; this.mark.u.uT.value = Math.min(1, 0.6 + this.t / this.T * 0.4);
      for (let i = 0; i < 2; i++) b.bfx.add.emit(head, _w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)), C.lava, { size: rand(0.5, 1.1), life: rand(0.3, 0.6), drag: 1, grav: -6, alpha: 0.9 });
      if (this.t >= this.T) {
        this.stuck = true; b.staffMode = 'stuck';
        const p = this.target;
        b.arena?.eruption?.(p.x, p.z, 1.3);
        b.bfx.burst(p.clone().setY(p.y + 0.5), 1.1); b.bfx.debris(p, 60, 13); b.bfx.dustRing(p, 9, 50);
        b.fx.shockwave(p, 14, 0.5, new THREE.Color(1.0, 0.45, 0.15));
        b.say('bull_slam', { pos: p }, 'boss_slam'); b.say('rock_crack', { pos: p, delay: 0.1 }, 'wax_crack');
        b.cam?.addTrauma(0.8); b.arena?.shake?.(1);
        if (player && !player.dead && horizDist(player.pos, p) < 5) b.hitPlayer(player, { dmg: 40, kind: 'heavy' }, p, 'throw');
        // it stays: a new pillar to hide behind
        const r = (s.userData.radius || 0.8) * 2.4;
        const col = { x: p.x, z: p.z, r, staff: true };
        if (b.arena) { b.arena.colliders = b.arena.colliders || []; b.arena.colliders.push(col); }
        b.stuckCollider = col;
        this.mark.remove();
      }
    }
    return true;
  }
  remove() { if (!this.stuck) this.mark.remove(); }
}
