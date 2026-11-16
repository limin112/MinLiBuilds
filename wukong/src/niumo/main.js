// 火焰山 · 牛魔 — bootstrap, renderer + post chain, module and asset loading, the game's state machine,
// hitstop / slow motion, pause + settings, debug hooks.
//
// Flow (docs/niumo_architecture.md §5):
//   splash (点击开始) → mv (ONE opening cinematic: the prologue, the walk in under his knee, the title, his eyes
//   opening, the spoken exchange, the roar; it ends on the fight camera) → fight → transition (山崩, at half health)
//   → fight (phase two) → ending (rain);  death → retry straight into the fight (no cinematic).
// URL flags: ?skipmv / ?skipintro (no cinematic: straight to the fight) ?god ?debug ?autostart (no click: starts at
// once) (?quality=low|high, ?mv = ?autostart). ?demo: the demo player (src/niumo/demo.js) plays the monkey through the
// real input; it starts by itself after a moment (a click starts it at once and lets the sound play); with ?skipmv
// it goes straight to the fight. ?turbo=N (tests): N simulation steps per drawn frame.
// Debug: window.__niumo (always exposed; ?debug adds an overlay and keeps the game running when the pointer is freed).
//
// Modules: arena.js (the caldera), bull.js (牛魔王), monkey.js + moves_monkey.js (悟空), input.js, camera.js (AutoCam),
// mv.js + cutscenes.js (cinematics), ui.js, demo.js (?demo). A missing model or module is an error, not a stand-in.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { FX } from '../fx.js';
import { updateLooks } from '../look.js';
import { separate, horizDist } from '../combat.js';
import { createVolcanoArena } from './arena.js';
import { BullKing, loadBullCharacter, loadWhiteBull } from './bull.js';
import { Monkey, loadMonkeyAssets, createMonkeyActor } from './monkey.js';
import { NiumoInput } from './input.js';
import { AutoCam } from './camera.js';
import { NiumoUI } from './ui.js';
import { OpeningMV, titleCamera, MV_CUES, cuesFromScore } from './mv.js';
import { CollapseScene, EndingScene, EyeGlow, VoiceLines, safeSpot } from './cutscenes.js';

const Q = new URLSearchParams(location.search);
const FLAG = {
  skipmv: Q.has('skipmv'), skipintro: Q.has('skipintro'), god: Q.has('god'), debug: Q.has('debug'),
  autostart: Q.has('autostart'), mv: Q.has('mv'), quality: Q.get('quality') || 'high',
  demo: Q.has('demo'), turbo: Math.max(1, Math.min(8, +(Q.get('turbo') || 1) || 1)),
};
const $ = s => document.querySelector(s);

export const SCALE = { bull: 40, bullSeated: 22, monkey: 1.5, staff: 1.9, bullStaff: 30 };
const FIGHT_START = 28;        // m in front of the seat: where a retry (and ?skipintro) puts the monkey

// ------------------------------------------------------------------ renderer + post

const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0605);
scene.fog = new THREE.FogExp2(0x160c08, 0.006);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2400);

const pmrem = new THREE.PMREMGenerator(renderer);
/** Reflection environment for the volcano (used when the arena brings none): smoke-dark sky, dull red horizon, lava glow below. */
function volcanoEnv() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; void main(){ float h = vP.y;
      vec3 c = mix(vec3(0.05, 0.022, 0.014), vec3(0.012, 0.01, 0.012), smoothstep(0.05, 0.8, h));   // dull red horizon -> smoke
      c += vec3(0.16, 0.05, 0.015) * smoothstep(0.1, -0.5, h);                                       // lava bounce from below
      gl_FragColor = vec4(c, 1.0); }`,
  })));
  for (let i = 0; i < 9; i++) {      // a few embers / lava pools low around the horizon
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.9, 0.25) }));
    const a = i / 9 * Math.PI * 2; m.position.set(Math.cos(a) * 30, -6 - (i % 3) * 3, Math.sin(a) * 30); env.add(m);
  }
  return pmrem.fromScene(env, 0.03).texture;
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// depth of field: cutscenes and the MV only
const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.002, maxblur: 0.01 });
bokeh.enabled = false;
composer.addPass(bokeh);
// restrained bloom: only lava cracks, eyes, sparks and the phase-two eruption are bright enough to reach it
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.5, 1.15);
composer.addPass(bloom);
// the grade (linear HDR, before ACES): split toning, warm/cool from the arena's hints, haze, heat shimmer, vignette,
// hurt edge, flash, grain
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uFlash: { value: 0 }, uAberr: { value: 0 },
    uVignette: { value: 0.55 }, uWarm: { value: 0.15 }, uDesat: { value: 0.14 }, uHaze: { value: 0.3 }, uHeat: { value: 0 },
    uHazeCol: { value: new THREE.Color(0.055, 0.032, 0.026) }, uFlashCol: { value: new THREE.Color(3.0, 2.3, 1.7) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uFlash, uAberr, uVignette, uWarm, uDesat, uHaze, uHeat;
    uniform vec3 uHazeCol, uFlashCol; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      if (uHeat > 0.001) {   // heat shimmer, strongest low in the frame (over the lava)
        float k = uHeat * (1.0 - smoothstep(0.05, 0.85, uv.y));
        uv += k * vec2(sin(uv.y * 92.0 + uTime * 5.3) + 0.6 * sin(uv.y * 41.0 - uTime * 3.1 + uv.x * 13.0),
                       cos(uv.x * 63.0 + uTime * 4.2)) * 0.0022;
      }
      vec2 c = uv - 0.5; float r = length(c);
      vec2 off = c * (0.004 * uAberr + 0.0005);
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), uDesat);
      // cool steel in the shadows, ember in the highlights
      col *= mix(vec3(0.88, 0.93, 1.08), vec3(1.07, 0.98, 0.88), smoothstep(0.02, 0.9, l));
      // warm (+) / cool (-) from the arena's phase
      col = mix(col, col * (uWarm >= 0.0 ? vec3(1.12, 0.97, 0.80) : vec3(0.82, 0.94, 1.1)), abs(uWarm));
      // haze: the smoke lifts the deep shadows a little (aerial perspective is the arena's fog; this is the air in the lens)
      col = mix(col, uHazeCol, uHaze * 0.25 * (1.0 - smoothstep(0.0, 0.5, l)));
      col = max(col - 0.003, 0.0) * 1.03;
      col *= 1.0 - uVignette * smoothstep(0.3, 0.86, r);
      col = mix(col, col * vec3(1.0, 0.3, 0.22) + vec3(0.22, 0.0, 0.0) * smoothstep(0.35, 0.8, r), uHurt * smoothstep(0.25, 0.75, r));
      col = mix(col, uFlashCol, uFlash);
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.016;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());
const fxaa = new FXAAPass();
composer.addPass(fxaa);

function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ loading

const loadEl = $('#load');
const setLoad = s => { loadEl.textContent = s; };
const fallbacks = [];          // kept empty: the debug overlay and the smoke test still read it (no stand-ins any more)
const assetFallbacks = [];

/** Audio: the shared AudioSystem plus the opening's cue sheet (every cut of the opening lands on a drum). */
async function loadAudio() {
  const mod = await import('../audio.js');
  const sys = new mod.AudioSystem();
  const music = new Set(mod.MUSIC_STATES || []), sfx = new Set(mod.SFX_NAMES || []);
  sys.wants = { music: st => music.has(st), sfx: n => sfx.has(n) };
  return { audio: sys, cues: cuesFromScore(mod.NIUMO_CUES && mod.NIUMO_CUES.opening) };
}

// ------------------------------------------------------------------ boot

/**
 * The shared FX tuned for the caldera (on this instance only; fx.js is shared with the cathedral and stays as it is).
 * Its dust is a pale grey and its contact flash near white. Dust becomes warm ash in the evening light (some of it
 * catching the sun), the parry / block spark an ember-gold one with a small warm core, the
 * shockwave sits on the ground (the altar is not at y = 0) and burns dimmer.
 */
function caldera(fx, arena) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const ash = new THREE.Color(0.25, 0.21, 0.18), ashLit = new THREE.Color(0.42, 0.27, 0.17);
  const gy = (x, z) => (arena.groundY ? arena.groundY(x, z) || 0 : 0);
  fx.dust = (pos, radius = 2, n = 40) => {
    const g = gy(pos.x, pos.z);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius, lit = Math.random() < 0.3;
      fx.alpha.emit(new THREE.Vector3(pos.x + Math.cos(a) * r, g + 0.12 + Math.random() * 0.35, pos.z + Math.sin(a) * r),
        new THREE.Vector3(Math.cos(a) * rand(0.5, 2), rand(0.3, 1.2), Math.sin(a) * rand(0.5, 2)), lit ? ashLit : ash,
        { size: rand(0.3, 0.8), life: rand(0.8, 1.7), drag: 1.6, grav: 0.15, alpha: lit ? 0.2 : 0.28, grow: 1.4 });
    }
  };
  const gold = new THREE.Color(1.0, 0.62, 0.26), hot = new THREE.Color(1.0, 0.78, 0.45), core = new THREE.Color(1.15, 0.7, 0.36);
  fx.hitSpark = (pos, dir, heavy = false) => {
    for (let i = 0; i < (heavy ? 54 : 32); i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(3, heavy ? 10 : 7)).addScaledVector(dir, rand(2, 5));
      fx.add.emit(pos, v, Math.random() < 0.25 ? hot : gold, { size: rand(0.018, 0.045), life: rand(0.16, 0.42), drag: 3, grav: -14 });
    }
    for (let i = 0; i < (heavy ? 10 : 5); i++) {
      fx.add.emit(pos, new THREE.Vector3(rand(-1, 1), rand(0, 1.4), rand(-1, 1)).multiplyScalar(rand(0.3, 1.0)), gold,
        { size: rand(0.08, 0.18), life: rand(0.5, 1.0), drag: 1.2, grav: 0.4, alpha: 0.45, grow: 0.5 });
    }
    fx.add.emit(pos, new THREE.Vector3(), core, { size: heavy ? 0.9 : 0.6, life: 0.08, grav: 0, alpha: 0.8 });
    fx.light(pos, 0xffb070, heavy ? 40 : 24, 0.14, 9);
  };
  const rawShock = fx.shockwave.bind(fx);
  fx.shockwave = (pos, radius = 4, dur = 0.55, color = new THREE.Color(1.0, 0.6, 0.3)) => {
    rawShock(pos, radius, dur, color.clone().multiplyScalar(0.45));
    const m = fx.timed.length && fx.scene.children[fx.scene.children.length - 1];
    if (m && m.isMesh && m.geometry && m.geometry.type === 'RingGeometry') m.position.y = gy(pos.x, pos.z) + 0.14;
  };
}

async function boot() {
  setLoad('载入火焰山…');
  const [arena, audioRes] = await Promise.all([createVolcanoArena({ scene, renderer, quality: FLAG.quality }), loadAudio()]);
  if (!scene.environment) { scene.environment = volcanoEnv(); scene.environmentIntensity = 0.9; }
  setLoad('载入角色…');
  const [bullChar, mAssets, beast] = await Promise.all([loadBullCharacter({ height: SCALE.bull }), loadMonkeyAssets({ height: SCALE.monkey }), loadWhiteBull()]);
  const monkeyChar = mAssets.char, monkeyStaff = mAssets.staff;
  const { audio, cues } = audioRes;
  scene.add(bullChar.root, monkeyChar.root);
  const fx = new FX(scene, { arena });
  arena._fx = arena._fx || fx;
  caldera(fx, arena);

  const input = new NiumoInput(canvas);
  const ui = new NiumoUI();
  const voice = new VoiceLines(audio, ui);
  voice.loadManifest();
  const cam = new AutoCam(camera, { bounds: arena.bounds, arena, blockers: arena.cameraBlockers });
  if (arena.cameraBlockers && !cam.blockers) cam.blockers = arena.cameraBlockers;

  const actor = createMonkeyActor(monkeyChar, monkeyStaff, scene);
  actor.playBase('idle', { fade: 0 });
  const monkey = new Monkey({ actor, fx, audio, cam, input, arena, staff: monkeyStaff });

  let bullStaff = null;
  const makeBull = () => new BullKing({ char: bullChar, scene, fx, audio, arena, cam, staff: bullStaff, beast });
  let bull = makeBull();
  bullStaff = bull.staff;      // reuse the same rod if the bull is ever rebuilt
  setLoad('');

  // a dead stand-in far away: what the bull "sees" while dormant and during cutscenes (so no AI ever targets the monkey then)
  const ghost = { pos: new THREE.Vector3(0, 0, 1e4), yaw: 0, hp: 0, maxHp: 1, st: 0, mp: 0, dead: true, state: 'dead', events: [], ghost: true,
    takeHit: () => false, canAct: () => false };

  const G = {
    scene, camera, renderer, composer, bloom, bokeh, grade, arena, audio, fx, input, ui, cam, monkey, bull, actor, ghost, voice,
    chars: { bull: bullChar, monkey: monkeyChar }, staffs: { monkey: monkeyStaff, get bull() { return bullStaff; } },
    state: 'loading', time: 0, hitstop: 0, slowmo: 1, slowmoT: 0, flash: 0, hurt: 0, aberr: 0, paused: false,
    god: FLAG.god, deaths: 0, wakeSeen: false, mv: null, cut: null, cutKind: null, fps: 60, frameMs: 0, flags: FLAG,
    fallbacks, assetFallbacks, cues: { ...MV_CUES, ...(cues || {}) }, cuesFromAudio: !!cues, post: { heat: 0, dof: null, letterbox: false },
    grade: { exposure: 0.95, warm: 0.15, fog: 0.3 }, stateLog: [],
  };
  window.__niumo = G;
  monkey.god = G.god;
  G.turbo = FLAG.turbo;
  // the demo player: drives the monkey through the input, between the cinematics
  if (FLAG.demo) {
    const { DemoBot } = await import('./demo.js');
    G.bot = new DemoBot(G);
    G.bot.debug = FLAG.debug;
    document.body.classList.add('demo');
    const go = $('#splash .go'); if (go) go.textContent = '点 击 观 看 演 示'; const goe = $('#splash .goe'); if (goe) goe.textContent = 'Click to watch the demo';
    // the sound needs one gesture: any click or key lets it play
    const wake = () => { audio.context?.resume?.().catch?.(() => {}); };
    addEventListener('pointerdown', wake); addEventListener('keydown', wake);
  }

  const music = (s, fade = 2) => audio.setMusic(s, { fade });
  const sfx = (name, o) => audio.play(name, o);
  const maxOf = (o, k, d) => o[`max${k}`] ?? o.T?.[`max${k}`] ?? d;
  const setState = s => { if (G.state !== s) { G.state = s; G.stateLog.push([+G.time.toFixed(2), s]); } };
  const seat = arena.bullSeat || { x: 0, z: -30, yaw: 0 };
  const seatF = new THREE.Vector3(Math.sin(seat.yaw), 0, Math.cos(seat.yaw));
  const fightStart = () => {
    const x = seat.x + seatF.x * FIGHT_START, z = seat.z + seatF.z * FIGHT_START;
    const p = safeSpot(arena, x, z);
    return { x: p.x, z: p.z, yaw: Math.atan2(seat.x - p.x, seat.z - p.z) };
  };

  /** The bull before the fight: posed and breathing, blind to the monkey. */
  const bullDormant = dt => { bull.dormant = true; bull.update(dt, ghost); };
  G.bullTick = bullDormant;
  // his eyes: the bull's own (setEyes(k), or its eyesWant field), else two dark-red points placed on the head bone here
  const ownEyes = b => typeof b.setEyes === 'function' || 'eyesWant' in b;
  const eyes = ownEyes(bull) ? null : new EyeGlow(scene, bullChar, { offset: [0.017, 0.045, 0.04] });
  G.eyes = eyes; G.eyeK = 0;
  G.setEyes = k => {
    G.eyeK = k;
    if (typeof bull.setEyes === 'function') bull.setEyes(k);
    else if ('eyesWant' in bull) bull.eyesWant = k;
    else eyes?.set(k);
  };
  const camSnap = () => {
    const yaw = Math.atan2(bull.pos.x - monkey.pos.x, bull.pos.z - monkey.pos.z);
    if (cam.snapBehind) cam.snapBehind(monkey.pos, yaw); else cam.snap?.(monkey, bull);
  };
  const camUpdate = (dt, look) => cam.update(dt, monkey, bull, look);

  function resetBull() {
    if (typeof bull.reset === 'function') bull.reset(seat);
    else { bull = G.bull = makeBull(); console.info('[niumo] BullKing has no reset(): rebuilt it for the retry'); }
    bull.dormant = true;
  }

  function resetWorld({ retry = false } = {}) {
    const sp = retry ? fightStart() : arena.playerSpawn;
    monkey.setGiant(1);
    monkey.reset(sp);
    if (monkey.mp !== undefined) monkey.mp = maxOf(monkey, 'Mp', 100);
    monkeyChar.root.visible = true; monkeyStaff.visible = true;
    if (retry || bull.dead || bull.phase !== 1 || bull.hp < bull.maxHp) resetBull();
    G.setEyes(retry ? 1 : 0);
    arena.setPhase(retry ? 1 : 0);
    camSnap();
    ui.setPlayer(monkey.hp, maxOf(monkey, 'Hp', 100), monkey.st, maxOf(monkey, 'St', 100), monkey.mp ?? 0, maxOf(monkey, 'Mp', 100));
    ui.setBoss(bull.hp, bull.maxHp);
  }

  // -------------------------------------------------------------- states

  /** The fight. fromCine: the opening cinematic has just put the camera exactly where the fight camera starts. */
  function beginFight({ retry = false, fromCine = false } = {}) {
    setState('fight');
    G.cut = null; G.cutKind = null; G.mv = null; G.wakeSeen = true;
    bull.dormant = false;
    // (the cinematic's roar woke him already; a skipped 山崩 leaves him finishing his stand-up: never wake him out of it,
    // that would drop him back into phase one, seated, with the arena reverted)
    const rising = bull.state === 'transition';
    if ((!fromCine || bull.state === 'dormant') && !rising && bull.state !== 'attack') bull.wake?.();
    G.setEyes(1);
    ui.showHUD(true); ui.showBoss(true); ui.letterbox(false); ui.setHint('');
    const p2 = bull.phase === 2 || rising, want = p2 ? 'niumo_phase2' : 'niumo_phase1';
    if (audio.musicState !== want) music(want, retry ? 1.5 : 0.3);
    arena.setPhase(p2 ? 2 : 1);
    if (p2) {                       // 法相天地: phase two is fought at his scale
      G.reachedP2 = true;
      if (!monkey.giant) { monkey.setGiant(); monkey.reset({ x: monkey.pos.x, z: monkey.pos.z, yaw: monkey.yaw }); }
    }
    if (!(fromCine && G.camPrimed)) camSnap();         // after the cinematic the auto camera is already on its frame
    G.camPrimed = false;
    if (!retry && !p2 && !fromCine) { G.flash = Math.max(G.flash, 0.25); cam.addTrauma?.(0.3); }
  }

  /** Straight into the fight (no cinematic: ?skipmv / ?skipintro, or a skip before the cinematic exists). */
  function fightNow() {
    resetWorld();
    monkey.reset(fightStart());
    beginFight();
    ui.clearCard();
  }

  /** The fight camera's first frame with the monkey where he stands now (the cinematic's last shot lands on it). */
  function fightCamPose() {
    const p = camera.position.clone(), q = camera.quaternion.clone(), fov = camera.fov;
    // settle the auto camera on its framing (it eases toward it), then keep that state: the fight carries on from it
    camSnap();
    for (let i = 0; i < 90; i++) cam.update(1 / 60, monkey, bull, { dx: 0, dy: 0 });
    const out = { pos: camera.position.clone(), look: camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(30)), fov: camera.fov };
    camera.position.copy(p); camera.quaternion.copy(q); camera.fov = fov; camera.updateProjectionMatrix();
    G.camPrimed = true;
    return out;
  }

  function beginTransition() {
    if (G.state === 'transition') return;
    setState('transition');
    ui.showHUD(false); ui.setHint('');
    G.slowmo = 1; G.slowmoT = 0;
    G.cutKind = 'collapse';
    G.cut = new CollapseScene({ G, camera, bull, monkey, actor, audio, fx, arena, ui, music,
      onDone: () => { G.cut = null; G.cutKind = null; beginFight({ retry: true }); G.flash = Math.max(G.flash, 0.2); } });
  }

  function beginEnding() {
    if (G.state === 'ending') return;
    setState('ending');
    G.reachedP2 = false;            // (won: a retry from here is a new game, from the seat)
    ui.showHUD(false); ui.showBoss(false); ui.setHint('');
    G.cutKind = 'ending';
    G.cut = new EndingScene({ G, camera, bull, monkey, actor, audio, fx, arena, ui, music,
      onDone: () => { ui.setHint('R 重新挑战'); } });
  }

  function onMonkeyDead() {
    if (G.state !== 'fight') return;
    setState('dead'); G.deaths++;
    music('niumo_defeat', 0.3);
    G.slowmo = 0.4; G.slowmoT = 1.4;
    const id = G.deaths;
    setTimeout(() => { if (G.state === 'dead' && G.deaths === id) ui.card_('火 未 熄', 'death', 4.2, '<i>The fire still burns</i>'); }, 900);
    setTimeout(() => { if (G.state === 'dead' && G.deaths === id) $('#fade').classList.add('on'); }, 4600);
    setTimeout(() => {
      if (G.state !== 'dead' || G.deaths !== id) return;
      retryNow();
      $('#fade').classList.remove('on');
    }, 6400);
  }

  function retryNow() {
    if (G.paused) togglePause(false);
    G.cut?.dispose?.();
    G.cut = null; G.cutKind = null;
    resetWorld({ retry: true });
    if (G.reachedP2) {
      // he had already stood up: no prologue and no cinematic again — he is on his feet, the monkey at his scale
      bull.wake?.({ opening: false });
      bull.startTransition();
      bull.events.length = 0;
      for (let i = 0; i < 300 && bull.state === 'transition'; i++) bull.update(0.1, ghost);
      bull.events.length = 0;
      arena.setPhase(2, { instant: true });
      const sp = safeSpot(arena, bull.pos.x + seatF.x * 34, bull.pos.z + seatF.z * 34);
      monkey.setGiant();
      monkey.reset({ x: sp.x, z: sp.z, yaw: Math.atan2(bull.pos.x - sp.x, bull.pos.z - sp.z) });
      camSnap();
    }
    setState('fight-wait'); G.waitT = 1.2;
    ui.showHUD(true); ui.showBoss(true); ui.setHint(''); ui.letterbox(false); ui.clearCard();
  }

  function drainEvents() {
    for (const e of (monkey.events || []).splice(0)) {
      if (e.type === 'hit') {
        // the rod biting into a lava crack holds a beat longer and kicks the lens a little; rock just thuds
        const weak = (e.part && e.part !== 'body') || monkey.giant;
        G.hitstop = Math.max(G.hitstop, (e.hitstop || 0.07) + (weak ? 0.02 : 0));
        if (monkey.giant) {
          // giant on giant: the blow hangs longer, the lens is shoved the way the rod went
          G.hitstop = Math.max(G.hitstop, (e.hitstop || 0.07) * 1.25 + (e.heavy ? 0.05 : 0.02));
          cam.punch?.(cam.forward(new THREE.Vector3()), e.heavy ? 0.55 : 0.22); cam.zoomPunch?.(e.heavy ? 3.5 : 1.4); cam.addTrauma?.(e.heavy ? 0.3 : 0.12);
          G.aberr = Math.max(G.aberr, e.heavy ? 1 : 0.4); if (e.heavy) G.flash = Math.max(G.flash, 0.06);
        } else if (weak) { cam.zoomPunch?.(e.heavy ? 2.4 : 1.0); cam.addTrauma?.(e.heavy ? 0.12 : 0.05); G.aberr = Math.max(G.aberr, e.heavy ? 0.8 : 0.3); }
        else if (e.heavy) G.aberr = Math.max(G.aberr, 0.5);
        input.rumble?.(e.heavy ? 0.8 : 0.4, 0.4, e.heavy ? 150 : 80);
        // 呐喊: he shouts with the blows that matter (every heavy one, now and then a light one)
        if (G.time - (G.shoutT || -9) > (e.heavy ? 0.9 : 2.6) && (e.heavy || Math.random() < 0.4)) {
          G.shoutT = G.time;
          const id = e.heavy ? (Math.random() < 0.5 ? 'y2' : 'y3') : (Math.random() < 0.5 ? 'y1' : 'y4');
          G.voice?.shout(id, { gain: e.heavy ? 0.85 : 0.6, rate: (monkey.giant ? 0.9 : 1) * (0.96 + Math.random() * 0.1) });
        }
        if (bull.armored && G.time - (G.armorTipT || -9) > 4) { G.armorTipT = G.time; G.armorTip = 2.5; }
      }
      if (e.type === 'fan' && e.armor) { G.hitstop = Math.max(G.hitstop, 0.14); G.slowmo = 0.4; G.slowmoT = 0.5; G.flash = Math.max(G.flash, 0.14); cam.addTrauma?.(0.4); }
      if (e.type === 'hurt') { G.hitstop = Math.max(G.hitstop, e.hitstop || 0.1); G.hurt = 1; G.aberr = Math.max(G.aberr, 0.6); G.heatKick = Math.max(G.heatKick || 0, 0.25); }
      if (e.type === 'block') { G.hitstop = Math.max(G.hitstop, e.hitstop || 0.06); G.aberr = Math.max(G.aberr, 0.3); }
      if (e.type === 'parry') { G.hitstop = Math.max(G.hitstop, 0.11); G.slowmo = 0.35; G.slowmoT = 0.35; G.flash = Math.max(G.flash, 0.2); G.aberr = 0.9; }
      if (e.type === 'guardbreak') { G.hitstop = Math.max(G.hitstop, e.hitstop || 0.12); G.hurt = 0.6; }
      if (e.type === 'critical') { G.hitstop = Math.max(G.hitstop, 0.24); G.slowmo = 0.3; G.slowmoT = 0.6; G.flash = Math.max(G.flash, 0.16); G.aberr = 1; input.rumble?.(1, 0.8, 300); }
      if (e.type === 'dead') onMonkeyDead();
    }
    for (const e of (bull.events || []).splice(0)) {
      if (e.type === 'damage') ui.addBossDamage(e.amount ?? e.dmg ?? 0);
      if (e.type === 'weakBreak') {
        // a crack bursts: the blow hangs, the world slows a breath, the heat pours out of it
        G.hitstop = Math.max(G.hitstop, 0.16); G.slowmo = 0.5; G.slowmoT = 0.4;
        G.flash = Math.max(G.flash, 0.1); G.aberr = Math.max(G.aberr, 0.8); G.heatKick = Math.max(G.heatKick || 0, 0.6);
      }
      if (e.type === 'stagger') { G.slowmo = e.reel ? 0.3 : 0.45; G.slowmoT = e.reel ? 0.7 : 0.5; G.flash = Math.max(G.flash, e.reel ? 0.16 : 0.1); cam.addTrauma?.(0.35); if (e.reel) { G.hitstop = Math.max(G.hitstop, 0.2); G.aberr = 1; input.rumble?.(1, 0.8, 300); } }
      if (e.type === 'flinch') { G.hitstop = Math.max(G.hitstop, 0.16); G.aberr = Math.max(G.aberr, 0.8); cam.addTrauma?.(0.2); }
      if (e.type === 'enrage') { ui.card_('牛魔王 · 现真身', 'name', 2.6, '烈 火 披 身 · 用 芭 蕉 扇 扇 灭 它<i>His true form: wreathed in fire — blow it out with the fan</i>'); if (monkey.mp !== undefined) monkey.mp = maxOf(monkey, 'Mp', 100);
        G.slowmo = 0.5; G.slowmoT = 0.8; cam.pullBack?.(1, 3); cam.addTrauma?.(0.6); G.heatKick = Math.max(G.heatKick || 0, 0.8); }
      if (e.type === 'down') { G.slowmo = 0.5; G.slowmoT = 0.6; }
      if (e.type === 'gold') { G.flash = Math.max(G.flash, 0.12); cam.addTrauma?.(0.25); }
      if (e.type === 'goldRebound') { G.hitstop = Math.max(G.hitstop, 0.14); G.flash = Math.max(G.flash, 0.12); G.aberr = Math.max(G.aberr, 0.7); }
      // 'critical' { stage: 'open' } = his head is down (the hint shows); { stage: 'hit' } (or no stage) = 牵牛鼻子 lands
      if (e.type === 'critical' && e.stage !== 'open') { G.hitstop = Math.max(G.hitstop, 0.2); G.slowmo = 0.3; G.slowmoT = 0.7; G.flash = Math.max(G.flash, 0.18); }
      if (e.type === 'phase2' && G.state === 'fight') beginTransition();
      if (e.type === 'dead' && G.state !== 'ending') beginEnding();
    }
  }

  // -------------------------------------------------------------- splash -> the opening cinematic -> the fight

  const splash = $('#splash');
  const startMV = async () => {
    if (G.state !== 'splash') return;
    setState('starting');
    splash.classList.add('hide');
    await audio.unlock();
    voice.load();                       // decode the spoken lines on the unlocked context
    if (FLAG.skipmv || FLAG.skipintro) { fightNow(); return; }
    setState('mv'); ui.showHUD(false);
    resetWorld();
    G.mv = new OpeningMV({ G, camera, scene, bull, monkey, actor, audio, arena, fx, ui, voice, cues: G.cues,
      bullTick: dt => bullDormant(dt),
      fightPose: fightCamPose,
      onDone: skipped => { G.mv = null; G.cineEnd = { pos: camera.position.clone(), skipped }; beginFight({ fromCine: !skipped }); } });
  };
  splash.addEventListener('click', startMV);
  addEventListener('keydown', e => { if (e.code === 'Enter' && G.state === 'splash' && splash.classList.contains('ready')) startMV(); });

  resetWorld();
  setState('splash');
  splash.classList.add('ready');
  if (FLAG.autostart || FLAG.mv) startMV();
  else if (FLAG.demo) setTimeout(startMV, 2500);          // the demo plays by itself (a click starts it sooner)

  // -------------------------------------------------------------- pause + settings

  const pausable = () => ['fight', 'fight-wait'].includes(G.state);
  addEventListener('keydown', e => {
    if (e.code === 'Escape' && pausable()) togglePause();
    if (e.code === 'KeyR' && (G.state === 'ending' && !G.cut?.running || G.paused)) retryNow();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && pausable() && !G.paused && !FLAG.debug && G.hadPointer) togglePause(true);
    if (document.pointerLockElement) G.hadPointer = true;
  });
  function togglePause(force) {
    G.paused = force !== undefined ? force : !G.paused;
    $('#pause').classList.toggle('on', G.paused);
    if (G.paused && document.pointerLockElement) document.exitPointerLock?.();
  }
  $('#pause').addEventListener('click', e => { if (e.target.id === 'pause') togglePause(false); });
  $('#p-resume').addEventListener('click', () => togglePause(false));
  $('#p-retry').addEventListener('click', () => { if (['fight', 'fight-wait', 'dead'].includes(G.state)) retryNow(); else togglePause(false); });

  const SETTINGS_KEY = 'hunxi.niumo.settings.v1';
  const settings = { master: 100, music: 85, sfx: 100, sens: 100, shake: 100, invY: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* private mode: defaults */ }
  function applySettings() {
    audio.setVolumes({ master: settings.master / 100, music: settings.music / 100, sfx: settings.sfx / 100 });
    input.lookSensitivity = 0.0024 * settings.sens / 100; input.padLookScale = settings.sens / 100;
    input.invertY = !!settings.invY;
    cam.shakeScale = settings.shake / 100;
  }
  const fmt = { master: v => v + '%', music: v => v + '%', sfx: v => v + '%', sens: v => (v / 100).toFixed(2) + '×', shake: v => v + '%' };
  for (const [key, id] of [['master', 's-master'], ['music', 's-music'], ['sfx', 's-sfx'], ['sens', 's-sens'], ['shake', 's-shake'], ['invY', 's-invy']]) {
    const el = $('#' + id), out = el.parentElement.querySelector('output');
    const show = () => { if (out) out.textContent = key === 'invY' ? (settings.invY ? '开' : '关') : fmt[key](settings[key]); };
    if (key === 'invY') el.checked = !!settings.invY; else el.value = settings[key];
    show();
    el.addEventListener('input', () => {
      settings[key] = key === 'invY' ? el.checked : +el.value;
      show(); applySettings();
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not persisted */ }
    });
  }
  applySettings();

  // -------------------------------------------------------------- debug overlay (?debug)

  let dbg = null;
  if (FLAG.debug) {
    dbg = document.createElement('pre');
    Object.assign(dbg.style, { position: 'fixed', right: '8px', top: '6px', margin: 0, font: '11px/1.35 ui-monospace, monospace', color: '#cbbfa8',
      background: 'rgba(0,0,0,.45)', padding: '6px 8px', zIndex: 9, pointerEvents: 'none', whiteSpace: 'pre' });
    document.body.appendChild(dbg);
  }
  let dbgT = 0;
  function debugText() {
    const b = bull, m = monkey;
    return [`${G.state}${G.paused ? ' (paused)' : ''}  ${G.fps.toFixed(0)} fps  ${G.frameMs.toFixed(1)} ms`,
      `bull ${Math.round(b.hp)}/${b.maxHp} p${b.phase} ${b.state}${b.dead ? ' dead' : ''}`,
      `monkey ${Math.round(m.hp)} st ${Math.round(m.st)} mp ${Math.round(m.mp ?? 0)} ${m.state}`,
      `music ${audio.musicState}  arena phase ${G.arenaPhase ?? '-'}`,
      ''].join('\n');
  }
  // remember the arena phase for the overlay / tests
  const rawSetPhase = arena.setPhase.bind(arena);
  arena.setPhase = (p, o) => { G.arenaPhase = p; return rawSetPhase(p, o); };
  // a burst of lava anywhere in the field breathes heat through the lens for a moment
  if (arena.eruption) { const rawErupt = arena.eruption.bind(arena); arena.eruption = (x, z, k = 1, ...r) => { G.heatKick = Math.max(G.heatKick || 0, Math.min(0.35, 0.18 * k)); return rawErupt(x, z, k, ...r); }; }
  G.arenaPhase = 0;

  // -------------------------------------------------------------- test / debug helpers

  Object.assign(G, {
    beginFight, fightNow, fightCamPose, beginTransition, beginEnding, retryNow, togglePause, resetWorld, fightStart,
    /** Strike the bull through its own contract (used by the tests to drive the phases). */
    hitBull(dmg = 50, part = null) {
      const zones = bull.hurtZones ? bull.hurtZones() : [];
      const z = (part && zones.find(q => q.part === part)) || zones[0];
      const point = z ? z.a.clone().lerp(z.b, 0.5) : bull.pos.clone().setY(8);
      return bull.takeHit({ dmg, poise: 0, point, dir: new THREE.Vector3(0, 0, -1), heavy: true, from: monkey.pos.clone(), part: z ? z.part : 'body' });
    },
    nearestWeakPoint() {
      const t = bull.lockTargets ? bull.lockTargets() : [];
      let best = null, bd = Infinity;
      for (const q of t) { const d = horizDist(q.pos, monkey.pos); if (d < bd) { bd = d; best = q; } }
      return best;
    },
  });

  // -------------------------------------------------------------- loop

  const timer = new THREE.Timer();
  timer.connect?.(document);
  const listenerFwd = new THREE.Vector3();
  const noLook = { dx: 0, dy: 0 };
  const gh = arena.gradeHints || {};
  G.grade = { exposure: gh.exposure ?? 0.95, warm: gh.warm ?? 0.15, fog: gh.fog ?? 0.3, desat: gh.desat ?? 0.14, bloom: gh.bloom ?? 0.55 };

  /**
   * Heat shimmer in the fight (the grade's uHeat, only cutscenes used it): a faint base over the caldera, more in phase
   * two (the lake), near lava, while he breathes fire, and a kick when something bursts. Eased, never strong.
   */
  let heatS = 0, heatNear = 0, heatProbeT = 0;
  function fightHeat(dt) {
    let want = 0;
    if (G.state === 'fight' || G.state === 'dead' || G.state === 'fight-wait') {
      if ((heatProbeT -= dt) <= 0) {
        heatProbeT = 0.25;
        const p = monkey.pos;
        let lv = arena.lavaAt ? arena.lavaAt(p.x, p.z) || 0 : 0;
        for (let i = 0; i < 8 && arena.lavaAt; i++) {
          const a = i / 8 * Math.PI * 2;
          lv = Math.max(lv, (arena.lavaAt(p.x + Math.cos(a) * 3, p.z + Math.sin(a) * 3) || 0) * 0.8, (arena.lavaAt(p.x + Math.cos(a) * 7, p.z + Math.sin(a) * 7) || 0) * 0.5);
        }
        heatNear = lv;
      }
      want = (bull.phase === 2 ? 0.2 : 0.08) + 0.3 * heatNear;
      const at = bull.atk;
      if (at && at.name === 'breath' && (at.breathing || (bull.a?.move && bull.a.move.t > at.def.tellAt + 0.6))) want += 0.45;
    }
    G.heatKick = Math.max(0, (G.heatKick || 0) - dt * 0.8);
    want += G.heatKick || 0;
    heatS += (Math.min(0.9, want) - heatS) * (1 - Math.exp(-2.5 * dt));
    return heatS;
  }

  /**
   * What the screen tells the player: the goal (under the bars), the answer to the blow that is coming or the opening
   * it leaves (large, low in the middle), and the keys (along the bottom). Only in the fight.
   */
  const K = k => `<kbd>${k}</kbd>`;
  // the English under every tip (matched by a phrase of the Chinese; first match wins)
  const TIP_EN = [
    ['子弹时间', `Bullet time — ${K('Space')} roll out from under it!`], ['躲开了', 'Dodged!'],
    ['横扫', `Sweep — hold ${K('L')} to guard`], ['破绽', `Opening! ${K('J')}`], ['连扫两下', `Two sweeps — keep ${K('L')} held`],
    ['震地火浪', `Fire wave — ${K('Space')} through it as it reaches you`], ['火雨要来了', 'Fire rain coming — watch the red rings'],
    ['火雨——跑出', `Fire rain — out of the red rings! He is roaring: hit him ${K('J')}`], ['冲撞', `Charge — ${K('Space')} to the side`], ['现在闪', `Now — ${K('Space')}!`],
    ['他刹不住', `He cannot stop — run him down! ${K('J')}`], ['跳劈锤地', `Leaping smash — ${K('Space')} away, then run out`],
    ['地面烧起来了', 'The ground is burning — get out of the ring!'], ['往旁边翻开', `Overhead smash — roll aside ${K('Space')}`],
    ['砸棍', `Overhead smash — ${K('Space')} away`], ['敲他的铁棍', `Now — strike his staff! ${K('J')}`],
    ['巨掌', 'Giant palm — out of the shadow on the ground'], ['手掌落地了', `The hand is down — strike it! ${K('J')}`],
    ['架势崩了', `Posture broken — all out! ${K('J')} ${K('K')}`], ['他站不稳了', `He is staggered — all out! ${K('J')}`],
    ['脚下是熔岩', `Lava underfoot — run out (or fan it out ${K('I')})`], ['火甲挡住了', `The fire armour holds — break it with the fan ${K('I')} (or a parry)`],
    ['金身', 'Golden body — do not strike: the blow rebounds and stuns you'],
  ];
  function coach() {
    if (G.state !== 'fight' || monkey.dead || bull.dead) { ui.setGoal(''); ui.setTip(''); ui.setKeys(''); return; }
    const duel = monkey.giant, at = bull.state === 'attack' ? bull.atk : null, mv = bull.a?.move, t = mv ? mv.t : 0;
    ui.setKeys(duel ? `WASD 绕着他跑（始终锁定）　${K('J')} 出棍　${K('K')} 重击（按住蓄力）　${K('L')} 格挡　${K('空格')} 闪步　${K('I')} 芭蕉扇<i>WASD circle him (always locked) · J strike · K heavy (hold to charge) · L guard · Space step · I fan</i>`
      : `WASD 移动　${K('J')} 出棍　${K('K')} 重击　${K('L')} 格挡　${K('空格')} 翻滚<i>WASD move · J strike · K heavy · L guard · Space roll</i>`);
    if (bull.phase === 1 && bull.state !== 'transition') {
      const n = bull.T.preludeHits || 6;
      ui.setGoal(`敲他！棍子打中他 ${n} 下，逼他站起来<b>${Math.min(bull.preludeHits || 0, n)} / ${n}</b><i>Strike him ${n} times with the staff to make him stand</i>`);
    } else if (duel) ui.setGoal(!bull.enraged ? '法相天地　·　打倒牛魔王<i>Stand as Heaven and Earth · bring the Bull Demon King down</i>' : bull.armored ? `牛魔王现了真身 · 火甲护体（伤害大减）——用芭蕉扇 ${K('I')} 扇灭<i>His true form: fire armour (damage much reduced) — blow it out with the fan ${K('I')}</i>` : '火甲灭了 · 趁现在猛攻<i>The fire is out · all out, now</i>');
    else ui.setGoal('');
    let tip = '', kind = '';
    if (at && mv) {
      const def = at.def, hit = def.hits && def.hits[0];
      if (at.name === 'sweep2' || at.name === 'sweep') {
        if (t < hit[1]) { tip = `横扫——按住 ${K('L')} 格挡`; kind = 'danger'; }
        else { tip = `破绽！${K('J')} 连击`; kind = 'go'; }
      } else if (at.name === 'combo2') {
        if (t < def.hits[1][1]) { tip = `连扫两下——按住 ${K('L')} 别松`; kind = 'danger'; }
        else { tip = `破绽！${K('J')} 连击`; kind = 'go'; }
      } else if (duel && (at.name === 'stompL' || at.name === 'stompR')) {
        if (t < def.impactAt + 1.6) { tip = `震地火浪——火浪到跟前时 ${K('空格')} 穿过去`; kind = 'danger'; }
        else { tip = `破绽！${K('J')} 连击`; kind = 'go'; }
      } else if (duel && at.name === 'meteor') {
        tip = t < def.rain[0] ? '火雨要来了——盯住地上的红圈' : `火雨——跑出红圈！他在吼，趁机打他 ${K('J')}`; kind = 'danger';
      } else if (at.name === 'charge') {
        if (at.dodgeNow) { tip = `现在闪！${K('空格')}`; kind = 'danger'; }
        else if (t < def.runEnd && !at.stopped) { tip = `冲撞——${K('空格')} 往旁边闪`; kind = 'danger'; }
        else { tip = `他刹不住——追上去打！${K('J')}`; kind = 'go'; }
      } else if (at.name === 'quake') {
        if (!at.fired.has('impact')) { tip = `跳劈锤地——${K('空格')} 闪开，落地后往外跑`; kind = 'danger'; }
        else { tip = '地面烧起来了——跑出火圈！'; kind = 'danger'; }
      } else if (at.name === 'slam2') {
        if (!at.fired.has('impact')) { tip = `砸棍——${K('空格')} 闪开`; kind = 'danger'; }
        else { tip = `破绽！${K('J')} 连击`; kind = 'go'; }
      } else if (at.name === 'slam') {
        if (at.bt && !at.bt.done && !at.bt.rolled) { tip = `子弹时间——${K('空格')} 从棍下翻出去！（不按他也会自己躲）`; kind = 'danger'; }
        else if (at.bt && at.bt.rolled && !at.bt.hit && (!at.fired.has('impact') || t < def.impactAt + 0.6)) { tip = '躲开了！'; kind = 'go'; }
        else if (!at.fired.has('impact')) { tip = `砸棍——${K('空格')} 往旁边翻开`; kind = 'danger'; }
        else if (at.resting || t < (def.restAt ?? 2.6) + 1) { tip = `趁现在，敲他的铁棍！${K('J')}`; kind = 'go'; }
      } else if (at.name === 'palmL' || at.name === 'palmR') {
        if (t < def.impactAt) { tip = '巨掌——跑出地上的影子'; kind = 'danger'; }
        else if (t < def.restEnd) { tip = `手掌落地了，敲它！${K('J')}`; kind = 'go'; }
      }
    } else if (bull.state === 'stagger') { tip = bull.reeling ? `架势崩了——猛攻！${K('J')} ${K('K')}` : bull.duel ? '' : `他站不稳了——猛攻！${K('J')}`; kind = 'go'; }
    if (duel) {
      const inFire = (bull.groundFires || []).some(f => !f.out && f.r > 12 && Math.hypot(monkey.pos.x - f.x, monkey.pos.z - f.z) < f.r * 0.9);
      if (inFire) { tip = `脚下是熔岩——快跑出去（或 ${K('I')} 芭蕉扇 扇灭）`; kind = 'danger'; }
      else if (G.armorTip > 0 && bull.armored && kind !== 'danger') { tip = `火甲挡住了——${K('I')} 芭蕉扇 破防（弹反也行）`; kind = 'danger'; }
    }
    if (bull.goldT > 0 && kind !== 'danger') { tip = '金身——别打！打上去会被震开僵直'; kind = 'danger'; }
    if (tip) { const en = TIP_EN.find(([key]) => tip.includes(key)); if (en) tip += `<i>${en[1]}</i>`; }
    ui.setTip(tip, kind);
  }

  /**
   * 子弹时间 (2026-11-16 user: the first blow needs a bullet-time dodge, or it is dull): as he holds the staff over his
   * head for the opening blow, time all but stops and the screen says roll; the roll plays out in slow motion under the
   * falling staff, and time comes back once it has hit the ground. Only for the fight's opening slam (the cinematic has
   * its own); a blow taken in it ends it at once.
   */
  function openingBulletTime() {
    const at = bull.state === 'attack' ? bull.atk : null, mv = bull.a?.move;
    if (!at || !at.opening || at.name !== 'slam' || !mv || monkey.dead || G.state !== 'fight') { monkey.dodgeSafe = false; return; }
    const def = at.def, t = mv.t;
    if (!at.bt) {
      if (t < def.holdAt - 0.12 || at.fired.has('impact')) return;
      at.bt = { rolled: false, hit: false, done: false, hp: monkey.hp };
      G.flash = Math.max(G.flash, 0.12); cam.addTrauma?.(0.15);
      audio.play('staff_swing', { pos: bull.staffTip, volume: 0.8, pitch: 0.3 });
    }
    const b = at.bt;
    if (b.done) return;
    if (monkey.hp < b.hp) b.hit = true;
    if (monkey.state === 'roll' && !b.hit) b.rolled = true;
    const landed = at.fired.has('impact') && t > def.impactAt + 0.15;
    // a roll started in the bullet time carries him clear: safe until the staff is down (the window is long and slow,
    // and the staff is thirty metres of iron; the point is the moment, not a frame-perfect press)
    // no key pressed by the last moment: he rolls out by himself (2026-11-16 user: the automatic dodge of the
    // cinematic was the good part) - sideways, away from where the staff comes down, still facing the bull
    if (!b.rolled && !b.hit && t >= def.impactAt - 0.32 && !at.fired.has('impact')) {
      const face = Math.atan2(bull.pos.x - monkey.pos.x, bull.pos.z - monkey.pos.z);
      const right = Math.random() < 0.5;
      monkey.a.stopMove?.();
      monkey.startMove(right ? 'rollR' : 'rollL');
      monkey.state = 'roll'; monkey.yaw = face; monkey.moveYaw = face + (right ? -Math.PI / 2 : Math.PI / 2);
      monkey.sfx?.(['monkey_roll', 'roll_ash', 'swing_light'], { pos: monkey.pos, volume: 0.45, pitch: 0.62 });
      b.rolled = true; b.auto = true;
    }
    monkey.dodgeSafe = b.rolled && !landed;
    if (b.hit || (landed && monkey.state !== 'roll')) { b.done = true; monkey.dodgeSafe = false; G.slowmo = 1; G.slowmoT = 0; return; }
    G.slowmo = b.rolled ? 0.3 : 0.16; G.slowmoT = 0.25;        // (refreshed every frame; it lapses by itself)
    G.aberr = Math.max(G.aberr, 0.35);
  }

  function frame() {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    timer.update();
    const rawDt = timer.getDelta();
    let dt = Math.min(rawDt, 1 / 20);
    if (G.fixedDt) dt = G.fixedDt;
    G.fps = G.fps * 0.95 + (1 / Math.max(rawDt, 1e-3)) * 0.05;
    // G.turbo (tests / demo tuning only): run several simulation steps per drawn frame
    const n = G.turbo > 1 && !G.paused ? Math.floor(G.turbo) : 1;
    for (let i = 0; i < n; i++) tick(dt, i === 0 ? rawDt : dt, i === n - 1);
    G.frameMs = G.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    if (dbg && (dbgT += dt) > 0.25) { dbgT = 0; dbg.textContent = debugText(); }
  }

  function tick(dt, rawDt, draw) {
    input.update(dt);
    if (input.take('menu', 0.3) && pausable()) togglePause();
    if (G.paused) { composer.render(dt); return; }
    G.time += dt;

    if (G.slowmoT > 0) { G.slowmoT -= dt; if (G.slowmoT <= 0) G.slowmo = 1; }
    if (G.armorTip > 0) G.armorTip -= dt;
    const gdt = dt * G.slowmo;
    let adt = gdt;
    if (G.hitstop > 0) { G.hitstop -= dt; adt = 0; }

    const skip = input.take('skip', 1) || input.take('pause', 1) || input.take('menu', 1);
    if (skip && G.state === 'mv' && G.mv) G.mv.skip();
    if (skip && G.cut && G.cut.skippable !== false) G.cut.skip();
    monkey.god = G.god;
    const look = input.look ? input.look(dt) : noLook;

    switch (G.state) {
      case 'loading':
      case 'splash':
      case 'starting':
        titleCamera(camera, arena, G.time);
        bullDormant(dt);
        actor.update(dt);
        break;
      case 'mv':
        // the MV keeps wall-clock time (not the clamped game step) so it stays on the score
        G.mv.update(G.fixedDt || Math.min(rawDt, 0.25));
        break;
      case 'transition':
      case 'ending':
        G.bot?.setActive(false);
        coach();
        if (G.cut) G.cut.update(gdt);
        if (G.state === 'transition' || G.state === 'ending') drainEvents();
        break;
      case 'fight-wait':
        G.bot?.setActive(false);
        G.waitT -= dt;
        monkey.update(adt, null);
        bullDormant(adt);
        camUpdate(dt, look);
        drainEvents();
        if (G.waitT <= 0) beginFight({ retry: true });
        break;
      case 'fight':
      case 'dead': {
        openingBulletTime();
        if (G.bot) { G.bot.setActive(G.state === 'fight'); G.bot.update(adt); }
        monkey.update(adt, bull.dead ? null : bull);
        bull.update(adt, monkey);
        // the seated giant is a mountain: the monkey cannot walk into him (a bull with colliders() is handled by the monkey)
        if (!bull.dead && !monkey.dead && typeof bull.colliders !== 'function') separate(monkey.pos, 0.35, bull.pos, bull.radius ?? (bull.phase === 2 ? 4.5 : 8.5), 1);
        camUpdate(dt, look);
        drainEvents();
        break;
      }
    }
    if (G.debugCam) { camera.position.copy(G.debugCam.pos); camera.lookAt(G.debugCam.look); if (G.debugCam.fov) { camera.fov = G.debugCam.fov; camera.updateProjectionMatrix(); } }

    voice.update(rawDt);
    eyes?.update(dt, G.time);
    updateLooks(camera);
    fx.update(gdt);
    arena.setDuelScale?.(!!monkey.giant);       // the giants fight in the widened caldera (it changes on the cut into the duel)
    arena.update(dt, G.time, camera);
    camera.getWorldDirection(listenerFwd);
    audio.setListener({ position: camera.position, forward: listenerFwd });
    const hpMax = maxOf(monkey, 'Hp', 100), hpK = monkey.hp / hpMax, low = G.state === 'fight' && !monkey.dead && hpK < 0.3;
    audio.setMuffle(Math.max(low ? 0.35 + (0.3 - hpK) * 1.8 : 0, G.slowmoT > 0 && G.slowmo < 1 ? 0.5 : 0));
    G.heartT = (G.heartT || 0) - dt;
    if (low && hpK < 0.25 && G.heartT <= 0) { sfx('heartbeat', { volume: 0.9 }); G.heartT = hpK < 0.12 ? 0.62 : 0.84; }
    audio.update(dt);

    ui.setPlayer(monkey.hp, hpMax, monkey.st, maxOf(monkey, 'St', 100), monkey.mp ?? 0, maxOf(monkey, 'Mp', 100));
    ui.setBoss(bull.hp, bull.maxHp);
    const lt = G.state !== 'fight' || bull.dead ? null : monkey.giant ? monkey.lockTarget?.pos || null : (cam.lockTarget?.pos || G.nearestWeakPoint()?.pos || null);
    ui.setPosture(G.state === 'fight' && bull.duel && !bull.dead ? bull.posture : -1, bull.reeling);
    ui.setReticle(lt, camera, renderer);
    if (G.state === 'fight') {
      const open = !!bull.criticalOpen?.(monkey) && !monkey.dead;
      if (open !== G.critHint) { G.critHint = open; ui.setHint(open ? 'J · 牵牛鼻子' : ''); }
    }
    coach();
    ui.update(dt);

    // grade: ease toward the arena's hints for its current phase; cutscenes may push heat / warmth on top
    const hints = arena.gradeHints || {};
    const k = 1 - Math.exp(-1.5 * dt);
    G.grade.exposure += ((hints.exposure ?? 0.95) - G.grade.exposure) * k;
    G.grade.warm += ((hints.warm ?? 0.15) - G.grade.warm) * k;
    G.grade.fog += ((hints.fog ?? 0.3) - G.grade.fog) * k;
    G.grade.desat += ((hints.desat ?? 0.14) - G.grade.desat) * k;
    G.grade.bloom += ((hints.bloom ?? 0.55) - G.grade.bloom) * k;
    const cin = G.state === 'mv' ? G.mv : G.cut;
    const cp = (cin && cin.post) || {};
    renderer.toneMappingExposure = G.grade.exposure * (cp.exposure ?? 1);
    G.flash = Math.max(0, G.flash - dt * 1.6);
    G.hurt = Math.max(0, G.hurt - dt * 1.4);
    G.aberr = Math.max(0, G.aberr - dt * 3);
    const u = grade.uniforms;
    u.uTime.value = G.time;
    u.uFlash.value = Math.max(G.flash * G.flash, cp.flash || 0);
    u.uHurt.value = Math.max(G.hurt, G.state === 'fight' && hpK < 0.25 ? 0.35 : 0);
    u.uAberr.value = G.aberr;
    u.uWarm.value = G.grade.warm + (cp.warm || 0);
    u.uHaze.value = G.grade.fog;
    u.uHeat.value = Math.max(cp.heat || 0, fightHeat(dt));
    u.uDesat.value = G.grade.desat + (cp.desat || 0);
    bloom.strength = G.grade.bloom + (cp.bloom || 0);
    u.uVignette.value = 0.55 + (cp.vignette || 0);
    const dof = cin && cin.dof;
    bokeh.enabled = !!dof;
    if (dof) { bokeh.uniforms.focus.value = dof.focus; bokeh.uniforms.aperture.value = dof.aperture; bokeh.uniforms.maxblur.value = dof.maxblur; }
    $('#mvfade').style.opacity = cin && cin.black ? cin.black.toFixed(3) : '0';
    if (draw) composer.render(dt);
  }
  frame();
  window.__ready = true;
}

boot().catch(e => {
  console.error(e);
  setLoad('载入失败：' + e.message);
  window.__error = String(e && e.stack || e);
});
