// 火焰山 · 牛魔 — the volcano arena: a caldera at the end of which the giant sits on a half-buried altar.
// Contract: docs/niumo_architecture.md section 1. Art direction: docs/niumo_style.md. Helpers: ./arena/*.js.
//
//   const arena = await createVolcanoArena({ scene, renderer, quality })
//   arena.groundY(x, z)      walkable ground height (follows the phase-two collapse)
//   arena.lavaAt(x, z)       0..1 lava danger (> 0.5 burns), exactly what the lava shader shows
//   arena.setPhase(p)        0 entry, 1 phase one, 2 collapse + eruption, 3 rain; setPhase(p, { instant: true }) snaps
//   arena.eruption(x, z, k)  local burst of lava (splash, light, scorched spot)
//   arena.shake(k)           falling rocks and dust (camera shake stays with the camera rig)
//   arena.gradeHints         { exposure, warm, fog, desat, bloom } for the post grade (same object, updated per frame)
import * as THREE from 'three';
import { makeNoiseTexture } from '../arena/textures.js';
import {
  floorD, FLOOR, SEAT, SPAWN, BOUNDS, DUEL_BOUNDS, DUEL_SCALE, CAM_BOUNDS, ALTAR, MASK, LAVA_Y, RIVERS, buildMasks, buildGround, sampleField, propColliders,
} from './arena/layout.js';
import {
  makeCrackTexture, makeBasaltTexture, makeAshTexture, makeRuneTexture, makeFriezeTexture, fieldTexture,
  loadArenaTextures, configureExternal,
} from './arena/textures.js';
import { VOLCANO } from './arena/shared.js';
import { createTerrain, createLavaFalls } from './arena/terrain.js';
import { createSky, mainVolcanoDir, sunDir, SUN } from './arena/sky.js';
import { buildVolcanoEnvMaps } from './arena/envmap.js';
import { createProps } from './arena/props.js';
import { createParticles } from './arena/particles.js';
import { createHaze } from './arena/haze.js';
import { clamp, smooth, rng } from './arena/noise.js';

const QUALITY = {
  high: { grid: 289, shadow: 2048, particles: 1, haze: true },
  medium: { grid: 225, shadow: 2048, particles: 0.7, haze: true },
  low: { grid: 161, shadow: 1024, particles: 0.45, haze: false },
};
const TAU = 1.1;          // s, phase parameter smoothing
const SUN_LIGHT_EL = 0.5;    // rad: the key comes in steeper than the disc stands (SUN.el) ...
const SUN_LIGHT_AZ = SUN.az - 0.22;   // ... and a little more from the side, so the giant's shadow falls beside the fight, not on it
const COLLAPSE_T = 7.5;   // s, the floor gives way (phase two)

// Per-phase targets. Colours are linear RGB.
// sun*: the low sun behind his right shoulder (the shadow-casting key); fill*: cool sky light from the camera's side;
// key*: the lava's warm underlight; back*: the main volcano's glow (the eruption's rim).
const PHASES = [
  { // 0 entry: a burning dusk, the hush before he wakes; the lava is tired
    heat: 0.62, seamHeat: 1.4, veins: 0.5, flow: 0.28, riverLight: 0.75, fallLight: 0.5, fissure: 0.05,
    skyGlow: 0.55, erupt: 0, rain: 0, wet: 0, sunK: 1.0,
    sunI: 4.6, sunCol: [1.0, 0.54, 0.25], fillI: 0.75, fillCol: [0.5, 0.62, 0.9], keyI: 0.5, keyCol: [1.0, 0.5, 0.27], backI: 0.25, backCol: [1.0, 0.36, 0.14],
    hemiI: 0.85, hemiSky: [0.32, 0.35, 0.46], hemiGround: [0.3, 0.14, 0.07],
    fog: [0.15, 0.085, 0.06], fogDensity: 0.007, fogFall: 0.045, fogGlow: [0.22, 0.05, 0.014], sunGlow: [0.36, 0.16, 0.05],
    ash: 0.9, embers: 0.45, smoke: 0.5, steam: 0, rainFx: 0, lavaLights: 0.8, env: 0.85, haze: 0.8,
    exposure: 0.98, warm: 0.1, gfog: 0.1, desat: 0.04, bloom: 0.5,
  },
  { // 1 fight: the same dusk, a little more alive
    heat: 0.75, seamHeat: 1.4, veins: 0.62, flow: 0.35, riverLight: 0.9, fallLight: 0.6, fissure: 0.08,
    skyGlow: 0.7, erupt: 0, rain: 0, wet: 0, sunK: 1.0,
    sunI: 5.0, sunCol: [1.0, 0.54, 0.25], fillI: 0.8, fillCol: [0.5, 0.62, 0.9], keyI: 0.55, keyCol: [1.0, 0.5, 0.27], backI: 0.3, backCol: [1.0, 0.36, 0.14],
    hemiI: 0.85, hemiSky: [0.33, 0.36, 0.47], hemiGround: [0.32, 0.15, 0.07],
    fog: [0.16, 0.088, 0.06], fogDensity: 0.007, fogFall: 0.045, fogGlow: [0.26, 0.06, 0.016], sunGlow: [0.4, 0.17, 0.055],
    ash: 1.0, embers: 0.7, smoke: 0.6, steam: 0, rainFx: 0, lavaLights: 1.0, env: 0.9, haze: 1.0,
    exposure: 1.02, warm: 0.12, gfog: 0.1, desat: 0.02, bloom: 0.5,
  },
  { // 2 the mountain splits: the sun reddens behind the ash, the land itself lights the sky; the floor breaks into plates
    heat: 1.15, seamHeat: 1.6, veins: 0.9, flow: 0.5, riverLight: 1.5, fallLight: 1.4, fissure: 1.0,
    skyGlow: 1.6, erupt: 1.0, rain: 0, wet: 0, sunK: 1.0,
    sunI: 3.6, sunCol: [1.0, 0.42, 0.17], fillI: 0.45, fillCol: [0.62, 0.55, 0.7], keyI: 1.5, keyCol: [1.0, 0.48, 0.2], backI: 2.0, backCol: [1.0, 0.38, 0.12],
    hemiI: 0.9, hemiSky: [0.4, 0.2, 0.16], hemiGround: [0.5, 0.15, 0.05],
    fog: [0.17, 0.062, 0.034], fogDensity: 0.008, fogFall: 0.04, fogGlow: [0.36, 0.08, 0.02], sunGlow: [0.4, 0.12, 0.035],
    ash: 1.2, embers: 1.5, smoke: 1.0, steam: 0.1, rainFx: 0, lavaLights: 1.6, env: 1.0, haze: 1.3,
    exposure: 1.02, warm: 0.26, gfog: 0.12, desat: 0.0, bloom: 0.66,
  },
  { // 3 rain: the first rain in a thousand years; slate and silver, the fire dies, steam rises — cold, never black
    heat: 0.2, seamHeat: 0.25, veins: 0.06, flow: 0.08, riverLight: 0.22, fallLight: 0.12, fissure: 0.1,
    skyGlow: 0.1, erupt: 0, rain: 1, wet: 1, sunK: 1.0,
    sunI: 0.9, sunCol: [0.78, 0.84, 0.95], fillI: 0.7, fillCol: [0.6, 0.68, 0.8], keyI: 0.1, keyCol: [0.9, 0.5, 0.3], backI: 0.06, backCol: [0.9, 0.5, 0.3],
    hemiI: 1.15, hemiSky: [0.42, 0.47, 0.55], hemiGround: [0.13, 0.13, 0.14],
    fog: [0.2, 0.22, 0.25], fogDensity: 0.014, fogFall: 0.035, fogGlow: [0.03, 0.01, 0.004], sunGlow: [0.3, 0.3, 0.3],
    ash: 0.0, embers: 0.05, smoke: 0.0, steam: 1.0, rainFx: 1, lavaLights: 0.25, env: 0.9, haze: 0.15,
    exposure: 1.0, warm: -0.22, gfog: 0.3, desat: 0.3, bloom: 0.38,
  },
];

function cloneParams(p) {
  const o = {};
  for (const [k, v] of Object.entries(p)) o[k] = Array.isArray(v) ? v.slice() : v;
  return o;
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {'high'|'medium'|'low'} [o.quality]
 * @param {object} [o.textures]  optional preloaded { basalt, ash, crust } (THREE.Texture or null = procedural)
 */
export async function createVolcanoArena({ scene, renderer, quality = 'high', textures = undefined } = {}) {
  if (!QUALITY[quality]) quality = 'high';
  const Q = QUALITY[quality];
  const owned = [];
  renderer.shadowMap.enabled = true;

  // --- data: masks, ground, textures ---------------------------------------------------------------------------
  const masks = buildMasks();
  const ground = buildGround(Q.grid, masks);
  const maskTex = fieldTexture(masks.mask, masks.res, { mipmaps: true });
  const glowTex = fieldTexture(masks.glow, masks.gres);
  const noise = makeNoiseTexture(256, 4711);
  const crackTex = makeCrackTexture(512);
  const ext = await loadArenaTextures(textures || {});
  const externals = new Set(Object.values(ext).filter(Boolean));
  const rockTex = configureExternal(ext.basalt, renderer) || makeBasaltTexture(renderer);
  const ashTex = configureExternal(ext.ash, renderer) || makeAshTexture(renderer);
  const crustTex = configureExternal(ext.crust, renderer);
  const runeTex = makeRuneTexture();
  const friezeTex = makeFriezeTexture();
  for (const t of [maskTex, glowTex, noise, crackTex, rockTex, ashTex, runeTex, friezeTex]) if (!externals.has(t)) owned.push(t);
  VOLCANO.vGlowMap.value = glowTex;
  VOLCANO.vNoise.value = noise;
  VOLCANO.vMask.value = maskTex;
  VOLCANO.vMaskRect.value.set(MASK.x0, MASK.z0, 1 / MASK.size, 1 / MASK.size);

  // --- scene graph -----------------------------------------------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'volcano-arena';
  scene.add(group);

  const terrain = createTerrain({ ground, maskTex, crackTex, rockTex, ashTex, crustTex, quality });
  group.add(terrain.mesh);
  const falls = createLavaFalls({ ground, noise });
  group.add(falls.group);
  const sky = createSky({ noise });
  group.add(sky.mesh);

  const props = createProps({ ground, masks, rockTex, crackTex, runeTex, friezeTex, noise, quality });
  group.add(props.group);
  const particles = createParticles({ ground, masks, noise, quality, density: Q.particles, falls: falls.falls });
  group.add(particles.group);
  const haze = Q.haze ? createHaze({ masks, noise, quality }) : null;
  if (haze) group.add(haze.mesh);

  // --- lights ------------------------------------------------------------------------------------------------------
  // the sun: low behind his right shoulder, where the sky dome draws it. The light comes in a little steeper than the
  // disc stands (a cinematographer's cheat: shorter shadows, light on the floor) — his rim, the long shadows
  const sunTo = sunDir(new THREE.Vector3());
  const lightDir = new THREE.Vector3(Math.sin(SUN_LIGHT_AZ) * Math.cos(SUN_LIGHT_EL), Math.sin(SUN_LIGHT_EL), -Math.cos(SUN_LIGHT_AZ) * Math.cos(SUN_LIGHT_EL)).negate();   // travel
  const sunLight = new THREE.DirectionalLight(0xffa050, 3.0);
  sunLight.name = 'volcano-sun';
  const center = new THREE.Vector3(0, 0, -4);
  sunLight.position.copy(center).addScaledVector(lightDir, -150);
  sunLight.target.position.copy(center);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(Q.shadow, Q.shadow);
  {
    const sc = sunLight.shadow.camera;
    sc.left = -58; sc.right = 58; sc.top = 50; sc.bottom = -50;
    sc.near = 40; sc.far = 270;
    sc.updateProjectionMatrix();
  }
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.08;
  sunLight.shadow.radius = 3;
  group.add(sunLight, sunLight.target);
  const skyLight = sunLight;      // (exported as keyLight)

  // cool fill from the open sky on the camera's side, high over the spawn (no shadows): the giant's front, the
  // monkey's back — the complement of the sun
  const fillLight = new THREE.DirectionalLight(0x8ea0d0, 0.6);
  fillLight.name = 'volcano-sky-fill';
  fillLight.position.set(46, 80, 110).add(center);
  fillLight.target.position.copy(center);
  group.add(fillLight, fillLight.target);

  // warm back light from the main volcano's glow (no shadows): rim on everything facing the seat
  const backLight = new THREE.DirectionalLight(0xff6a30, 0.4);
  backLight.name = 'volcano-back-light';
  const volcDir = mainVolcanoDir(new THREE.Vector3());
  backLight.position.copy(volcDir).multiplyScalar(150);
  backLight.target.position.set(0, 0, 0);
  group.add(backLight, backLight.target);

  // warm key from the lava below and in front of him (no shadows): models the giant's front, the monkey's back, the
  // undersides of everything; the ground (facing up) ignores it
  const lavaKey = new THREE.DirectionalLight(0xff6a2a, 1.0);
  lavaKey.name = 'volcano-lava-key';
  lavaKey.position.set(14, -46, 120).add(center);
  lavaKey.target.position.copy(center);
  group.add(lavaKey, lavaKey.target);

  const hemi = new THREE.HemisphereLight(0x301610, 0x3a1206, 0.55);
  hemi.name = 'volcano-fill';
  group.add(hemi);

  // a few lava lights for the characters (the arena's own surfaces read the glow map)
  const lavaLights = [];
  const riverPoint = (river, z) => {
    let best = river[0];
    for (const p of river) if (Math.abs(p[1] - z) < Math.abs(best[1] - z)) best = p;
    return best;
  };
  for (const [ri, z] of [[0, -22], [0, 6], [1, -20], [1, 8]]) {
    const p = riverPoint(RIVERS[ri], z);
    const l = new THREE.PointLight(0xff5a1a, 8, 26, 1.6);
    l.position.set(p[0], 1.2, p[1]);
    l.userData.base = 8;
    l.userData.phase = lavaLights.length * 1.9 + 0.4;
    lavaLights.push(l);
  }
  {
    const l = new THREE.PointLight(0xff4a14, 14, 34, 1.5);    // the moat behind him: a backlight on his flanks
    l.position.set(0, 2.5, -50);
    l.userData.base = 14;
    l.userData.phase = 7.7;
    lavaLights.push(l);
  }
  for (const l of lavaLights) { l.castShadow = false; group.add(l); }
  // eruption flashes (pooled; always present so the light count never changes)
  const flashLights = [0, 1].map((i) => {
    const l = new THREE.PointLight(0xff7a2a, 0, 30, 1.6);
    l.name = 'volcano-flash-' + i;
    l.userData.life = 0;
    group.add(l);
    return l;
  });

  // --- atmosphere --------------------------------------------------------------------------------------------------
  const prev = { fog: scene.fog, bg: scene.background, env: scene.environment, envI: scene.environmentIntensity };
  const fog = new THREE.FogExp2(0x050302, 0.012);
  scene.fog = fog;
  scene.background = new THREE.Color(0x020101);
  const envMaps = buildVolcanoEnvMaps(renderer, noise);
  scene.environment = envMaps.ember;
  let envKey = 'ember';
  VOLCANO.vSunDir.value.copy(sunTo);

  // --- colliders ---------------------------------------------------------------------------------------------------
  const allColliders = propColliders().concat(props.colliders || []);
  // props standing where the phase-two lake opens sink with it (their colliders go away)
  const sinkers = [];
  for (const c of allColliders) {
    const g = sampleField(masks.mask, masks.res, c.x, c.z, 1);
    if (g > 0.3) c.sinks = true;
  }
  const colliders = [];
  const camCircles = [];
  const colliderSrc = allColliders.slice();
  let sunkState = -1;
  for (const s of props.sinkers || []) sinkers.push(s);
  // 山崩: when the floor gives way everything that stood on it goes down with it (pillars, steles, the ding, the bones):
  // the giants' duel is fought on an open lake - nothing is left standing for two forty-metre bodies to wade through
  {
    const own = new Set(sinkers.map((k) => k.object));
    for (const obj of props.group.children) {
      if (own.has(obj)) continue;
      const y0 = obj.position.y;
      sinkers.push({ object: obj, apply(collapse) { obj.position.y = y0 - collapse * collapse * 30; obj.visible = collapse < 0.995; } });
    }
    for (const c of allColliders) c.sinks = true;
  }

  // --- state -------------------------------------------------------------------------------------------------------
  let phase = 0;
  const target = cloneParams(PHASES[0]);
  const cur = cloneParams(PHASES[0]);
  let collapse = 0, collapseTarget = 0, collapseClock = -1;   // clock: seconds since the collapse began (-1 idle)
  let reveal2 = 0, seamPre = 0;
  let danger = 1;
  let time = 0;
  let rumble = 0;
  let flash = 0;
  const gradeHints = { exposure: cur.exposure, warm: cur.warm, fog: cur.gfog, desat: cur.desat, bloom: cur.bloom };
  const tmpC = new THREE.Color();
  const size = new THREE.Vector2();
  const rnd = rng(99);

  function setPhase(p, { instant = false } = {}) {
    p = clamp(Math.round(Number(p) || 0), 0, PHASES.length - 1);
    const was = phase;
    phase = p;
    Object.assign(target, cloneParams(PHASES[p]));
    if (p >= 2) {
      if (collapseTarget < 1) { collapseTarget = 1; collapseClock = 0; if (!instant) shake(0.8); }
    } else {
      collapseTarget = 0; collapseClock = -1;
      collapse = 0; reveal2 = 0; seamPre = 0;
      instant = instant || was >= 2;
    }
    danger = p === 3 ? 0.35 : 1;
    if (instant) {
      Object.assign(cur, cloneParams(target));
      if (p >= 2) { collapse = 1; reveal2 = 1; seamPre = 0; collapseClock = COLLAPSE_T + 1; }
    }
    applyColliders();
  }

  function applyColliders() {
    // sunk props drop out of the collision set (in place: callers may hold the arrays)
    const sunk = collapse > 0.5 ? 1 : 0;
    if (sunk === sunkState) return;
    sunkState = sunk;
    colliders.length = 0;
    camCircles.length = 0;
    for (const c of colliderSrc) {
      if (c.sinks && sunk) continue;
      colliders.push({ x: c.x, z: c.z, r: c.r });
      if (c.r >= 0.8) camCircles.push({ x: c.x, z: c.z, r: c.r });
    }
  }

  // 法相天地: the duel is fought in the same caldera drawn DUEL_SCALE times wider (the floor, the walls and the falls
  // are stretched in plan; heights stay), so two forty-metre bodies have room to run. ks is the scale now in force.
  let ks = 1;
  function setDuelScale(on) {
    const k = on ? DUEL_SCALE : 1;
    if (k === ks) return;
    ks = k;
    for (const o of [terrain.mesh, falls.group, props.group]) { o.scale.set(k, 1, k); o.updateMatrixWorld(true); }
    VOLCANO.vMaskRect.value.set(MASK.x0 * k, MASK.z0 * k, 1 / (MASK.size * k), 1 / (MASK.size * k));       // the lava map follows the floor (its fine textures keep their world size)
    const sc = sunLight.shadow.camera, w = on ? 58 * k * 1.15 : 58, h = on ? 50 * k * 1.25 : 50;
    sc.left = -w; sc.right = w; sc.top = h; sc.bottom = -h; sc.far = on ? 270 + 300 * k : 270;
    sunLight.position.copy(sunLight.target.position).addScaledVector(lightDir, on ? -150 - 60 * k : -150);
    sc.updateProjectionMatrix();
  }
  function groundY(x, z) {
    if (ks !== 1) { x /= ks; z /= ks; }
    if (Math.abs(x - ALTAR.x) <= ALTAR.hx && Math.abs(z - ALTAR.z) <= ALTAR.hz) return ALTAR.top;
    return ground.heightAt(x, z, collapse);
  }

  /** c: how far the floor has given way (default: now); pass 1 to ask what will be lava once it has. */
  function lavaAt(x, z, c = collapse) {
    if (ks !== 1) { x /= ks; z /= ks; }
    if (x < MASK.x0 || z < MASK.z0 || x > MASK.x0 + MASK.size || z > MASK.z0 + MASK.size) return 0;
    const r = sampleField(masks.mask, masks.res, x, z, 0);
    const g = c > 0 ? sampleField(masks.mask, masks.res, x, z, 1) * c : 0;
    return Math.max(r, g) * danger;
  }

  /** Nearest safe point (lavaAt < 0.2) to (x, z), searching outwards; handy after the collapse (c = 1: before it, for after). */
  function safeSpot(x, z, maxR = 30, c = collapse) {
    if (lavaAt(x, z, c) < 0.2) return { x, z };
    for (let r = 1; r <= maxR; r += 1) {
      const n = Math.max(8, Math.round(r * 6));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (px < BOUNDS.minX || px > BOUNDS.maxX || pz < BOUNDS.minZ || pz > BOUNDS.maxZ) continue;
        if (lavaAt(px, pz, c) < 0.2 && !colliders.some((k) => Math.hypot(px - k.x, pz - k.z) < k.r + 0.5)) return { x: px, z: pz };
      }
    }
    return { x: SPAWN.x, z: SPAWN.z };
  }

  function eruption(x, z, strength = 1) {
    strength = clamp(Number(strength) || 1, 0.1, 3);
    const y = groundY(x, z);
    particles.eruption(x, y, z, strength);
    const l = flashLights.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
    l.position.set(x, y + 1.5, z);
    l.userData.life = 1;
    l.userData.k = strength;
    flash = Math.min(1.5, flash + 0.25 * strength);
  }

  function shake(k = 1) {
    k = clamp(Number(k) || 1, 0, 3);
    rumble = Math.min(2, rumble + k);
    particles.shake(k);
  }

  function apply(dt) {
    const k = 1 - Math.exp(-dt / TAU);
    for (const key of Object.keys(target)) {
      const t = target[key];
      if (Array.isArray(t)) for (let i = 0; i < t.length; i++) cur[key][i] += (t[i] - cur[key][i]) * k;
      else cur[key] += (t - cur[key]) * k;
    }
    // collapse choreography: the floor cracks and glows, then gives way; the mountain splits, new falls pour
    if (collapseClock >= 0) {
      collapseClock += dt;
      const c = collapseClock;
      seamPre = smooth(0, 1.8, c) * (1 - smooth(4.5, 7.5, c));
      collapse = collapseTarget > 0 ? smooth(1.4, COLLAPSE_T, c) : 0;
      reveal2 = smooth(0.8, 4.0, c);
      if (c > 1.4 && c < COLLAPSE_T && rnd() < dt * 2.2) shake(0.35);
    }
    applyColliders();
    for (const s of sinkers) s.apply(collapse);

    const fl = flash;
    flash = Math.max(0, flash - dt * 1.6);
    // shared shading
    VOLCANO.vTime.value = time;
    VOLCANO.vGlowCol.value.setRGB(1.0, 0.26, 0.06).multiplyScalar(cur.riverLight * 1.1);
    VOLCANO.vSeamGlow.value = collapse * 1.2;
    VOLCANO.vCollapse.value = collapse;
    VOLCANO.vFallCol.value.setRGB(1.0, 0.3, 0.08).multiplyScalar(cur.fallLight);
    VOLCANO.vFissure.value = Math.max(cur.fissure, cur.fissure * reveal2);
    VOLCANO.vFogCol.value.setRGB(...cur.fog);
    VOLCANO.vFogDensity.value = cur.fogDensity;
    VOLCANO.vFogFall.value = cur.fogFall;
    VOLCANO.vFogGlowCol.value.setRGB(...cur.fogGlow).multiplyScalar(1 + fl * 0.6);
    VOLCANO.vSunCol.value.setRGB(...cur.sunGlow).multiplyScalar(1 + fl);
    VOLCANO.vWet.value = cur.wet;
    // terrain
    const tu = terrain.uniforms;
    tu.uCollapse.value = collapse;
    tu.uHeat.value = cur.heat;
    tu.uSeamHeat.value = cur.seamHeat;
    tu.uSeamPre.value = seamPre;
    tu.uVeins.value = cur.veins * (1 + rumble * 0.15);
    tu.uFlow.value = cur.flow;
    tu.uRain.value = cur.rainFx;
    falls.update(time, { heat: cur.heat * 1.15, reveal2 });
    // lights
    sunLight.intensity = cur.sunI;
    sunLight.color.setRGB(...cur.sunCol);
    fillLight.intensity = cur.fillI;
    fillLight.color.setRGB(...cur.fillCol);
    backLight.intensity = cur.backI * (1 + fl * 0.8);
    backLight.color.setRGB(...cur.backCol);
    lavaKey.intensity = cur.keyI * (1 + fl * 0.6);
    lavaKey.color.setRGB(...cur.keyCol);
    hemi.intensity = cur.hemiI;
    hemi.color.setRGB(...cur.hemiSky);
    hemi.groundColor.setRGB(...cur.hemiGround);
    for (const l of lavaLights) {
      const ph = l.userData.phase;
      const f = 0.85 + 0.1 * Math.sin(time * 1.3 + ph) + 0.05 * Math.sin(time * 3.7 + ph * 2.1);
      l.intensity = l.userData.base * cur.lavaLights * f;
    }
    for (const l of flashLights) {
      l.userData.life = Math.max(0, l.userData.life - dt / 1.2);
      const e = l.userData.life;
      l.intensity = e > 0 ? 60 * (l.userData.k || 1) * e * e * (0.85 + 0.15 * Math.sin(time * 40)) : 0;
    }
    // atmosphere
    if (scene.fog === fog) {
      fog.color.setRGB(...cur.fog);
      fog.density = cur.fogDensity * 0.85;
    }
    if (scene.background && scene.background.isColor && scene.background !== prev.bg) scene.background.setRGB(...cur.fog);
    const wantEnv = phase === 2 ? 'erupt' : phase === 3 ? 'rain' : 'ember';
    if (wantEnv !== envKey && scene.environment === envMaps[envKey]) scene.environment = envMaps[wantEnv];
    envKey = wantEnv;
    if (Object.values(envMaps).includes(scene.environment)) scene.environmentIntensity = cur.env;
    sky.update(time, { sun: cur.sunK, glow: cur.skyGlow * (1 + fl * 0.3), erupt: cur.erupt, rain: cur.rain, flash: fl * 0.5, fogCol: tmpC.setRGB(...cur.fog) });
    // grade hints (one object, mutated)
    gradeHints.exposure = cur.exposure + fl * 0.06;
    gradeHints.warm = cur.warm + fl * 0.15;
    gradeHints.fog = cur.gfog;
    gradeHints.desat = cur.desat;
    gradeHints.bloom = cur.bloom + fl * 0.1;
  }

  function update(dt = 1 / 60, elapsed, camera) {
    dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    time = Number.isFinite(elapsed) ? elapsed : time + dt;
    rumble = Math.max(0, rumble - dt * 0.8);
    apply(dt);
    renderer.getDrawingBufferSize(size);
    particles.update(time, dt, camera, {
      ash: cur.ash, embers: cur.embers, smoke: cur.smoke, steam: cur.steam, rain: cur.rainFx, heat: cur.heat,
      collapse, seamPre, reveal2, rumble, viewportH: size.y,
    });
    props.update(time, { heat: cur.heat, collapse });
    if (haze) haze.update(time, { strength: cur.haze, collapse, heat: cur.heat, rain: cur.rain, erupt: cur.erupt * reveal2 });
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
    });
    for (const t of owned) t.dispose();
    for (const t of externals) t.dispose();
    for (const m of Object.values(envMaps)) m.dispose();
    if (haze) haze.dispose();
    particles.dispose?.();
    skyLight.shadow.dispose();
    if (scene.fog === fog) scene.fog = prev.fog || null;
    if (Object.values(envMaps).includes(scene.environment)) { scene.environment = prev.env || null; scene.environmentIntensity = prev.envI; }
    if (scene.background && scene.background.isColor && scene.background !== prev.bg) scene.background = prev.bg || null;
  }

  setPhase(0, { instant: true });
  apply(0);

  return {
    bounds: { ...BOUNDS },
    duelBounds: { minX: DUEL_BOUNDS.minX * DUEL_SCALE, maxX: DUEL_BOUNDS.maxX * DUEL_SCALE, minZ: DUEL_BOUNDS.minZ * DUEL_SCALE, maxZ: DUEL_BOUNDS.maxZ * DUEL_SCALE },       // the giants' duel: the whole (widened) pit
    setDuelScale,
    get duelScale() { return ks; },
    /** 1 at the foot of the caldera's walls, more beyond (the floor as drawn now, duel scale included). */
    pitD: (x, z) => floorD(x / ks, z / ks),
    /**
     * The duel: keep a point (Vector3, moved in place) on the floor of the widened pit - at most `lim` of the way to the
     * cliff's foot, pulled straight in towards the pit's middle. Returns true when it moved. (The prologue's floor has
     * its own bounds: nothing happens at scale 1.)
     */
    pitClamp(p, lim = 0.95) {
      if (ks === 1 || floorD(p.x / ks, p.z / ks) <= lim) return false;
      const cx = FLOOR.cx * ks, cz = FLOOR.cz * ks;
      let lo = 0, hi = 1;
      for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (floorD((cx + (p.x - cx) * m) / ks, (cz + (p.z - cz) * m) / ks) <= lim) lo = m; else hi = m; }
      p.x = cx + (p.x - cx) * lo; p.z = cz + (p.z - cz) * lo;
      return true;
    },
    playerSpawn: { ...SPAWN },
    bullSeat: { ...SEAT, y: ALTAR.top },
    groundY,
    lavaAt,
    colliders,
    cameraBlockers: {
      circles: camCircles,
      bounds: { ...CAM_BOUNDS },
    },
    update,
    setPhase,
    eruption,
    shake,
    gradeHints,
    group,
    // extras (not part of the contract)
    safeSpot,
    dispose,
    get phase() { return phase; },
    get collapse() { return collapse; },
    keyLight: skyLight,
    backLight,
    lavaY: LAVA_Y,
    altar: { ...ALTAR },
    stats: { masksRes: masks.res, grid: Q.grid },
  };
}
