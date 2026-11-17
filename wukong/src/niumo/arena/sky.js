// Sky over the caldera: a burning dusk. A low sun stands behind the smoke of the volcanoes (molten gold and crimson
// at the horizon, slate teal overhead as the complement); the smoke rolls and the high cloud catch it on their
// undersides and edges; shafts of light fan out of the sun through the ash. The distant smoking volcanoes are drawn
// as layered silhouettes in the dome itself (they are kilometres away: no parallax).
// The dome writes linear HDR (the sun's core is far above 1 so the bloom spills by itself) and the same shader is
// rendered into the PMREM environment maps (envmap.js), so the characters are lit by the sky they stand under.
// Camera-centred, pinned to the far plane, so it works with any camera.far. Phase moods via uniforms:
// uGlow (the fire of the land under the clouds), uErupt (the main volcano erupts, the sky catches fire), uRain.
import * as THREE from 'three';

// azimuth: 0 = towards -z (behind the giant), + towards +x; elevations in radians
export const VOLCANOES = [
  { az: 0.32, el: 0.30, w: 0.72, crater: 0.035, far: 0.55, main: 1 },   // the great one, right behind his shoulder
  { az: -0.86, el: 0.2, w: 0.55, crater: 0.025, far: 0.7, main: 0 },    // the sun stands in its smoke
  { az: 1.18, el: 0.22, w: 0.6, crater: 0.03, far: 0.62, main: 0 },
  { az: -1.62, el: 0.17, w: 0.5, crater: 0.02, far: 0.78, main: 0 },
  { az: 2.25, el: 0.15, w: 0.55, crater: 0.022, far: 0.8, main: 0 },
  { az: -2.55, el: 0.2, w: 0.6, crater: 0.028, far: 0.72, main: 0 },
];

/** The sun: low, behind the giant's right shoulder (screen left from the fight camera). */
export const SUN = { az: -0.68, el: 0.3 };
const dirOf = (az, el, out) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
/** Unit vector (world) from the arena toward the sun as it is drawn in the sky. */
export function sunDir(target = new THREE.Vector3()) { return dirOf(SUN.az, SUN.el, target); }

function volcanoGLSL() {
  const n = VOLCANOES.length;
  const arr = (f) => VOLCANOES.map(f).map((v) => v.toFixed(4)).join(', ');
  return /* glsl */`
const int NV = ${n};
const float vAz[NV] = float[NV](${arr((v) => v.az)});
const float vEl[NV] = float[NV](${arr((v) => v.el)});
const float vW[NV] = float[NV](${arr((v) => v.w)});
const float vCr[NV] = float[NV](${arr((v) => v.crater)});
const float vFar[NV] = float[NV](${arr((v) => v.far)});
const float vMain[NV] = float[NV](${arr((v) => v.main)});
`;
}

export function createSky({ noise, env = false } = {}) {
  const uniforms = {
    uNoise: { value: noise },
    uTime: { value: 0 },
    uGlow: { value: 0.7 },        // the fire of the land on the undersides of the smoke
    uErupt: { value: 0 },         // phase two: the sky is lit from below, the sun reddens behind the ash
    uRain: { value: 0 },          // the closing rain: slate, cold, one pale break where the sun was
    uFlash: { value: 0 },         // short eruption / lightning flashes
    uFogCol: { value: new THREE.Color(0.3, 0.16, 0.1) },
    uGlowCol: { value: new THREE.Color(0.9, 0.2, 0.05) },
    uHotCol: { value: new THREE.Color(1.0, 0.35, 0.08) },
    uSunDir: { value: sunDir() },
    uSunCol: { value: new THREE.Color(1.0, 0.58, 0.24) },
    uSunK: { value: 1 },          // sun strength (phase)
    uBright: { value: 1 },
    uEnv: { value: env ? 1 : 0 }, // rendering the IBL: a softer, wider sun (no fireflies), a real ground below
    uGroundCol: { value: new THREE.Color(0.05, 0.03, 0.022) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'volcano-sky',
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec3 v = mat3(viewMatrix) * position;
        gl_Position = projectionMatrix * vec4(v, 1.0);
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uTime; uniform float uGlow; uniform float uErupt; uniform float uRain;
      uniform float uFlash; uniform vec3 uFogCol; uniform vec3 uGlowCol; uniform vec3 uHotCol; uniform float uBright;
      uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunK; uniform float uEnv; uniform vec3 uGroundCol;
      varying vec3 vDir;
      ${volcanoGLSL()}
      float fbmS(vec2 p) { return texture2D(uNoise, p).r * 0.55 + texture2D(uNoise, p * 2.13 + 0.31).g * 0.3 + texture2D(uNoise, p * 4.7 + 0.73).b * 0.15; }
      void main() {
        vec3 dir = normalize(vDir);
        float el = asin(clamp(dir.y, -1.0, 1.0));
        float az = atan(dir.x, -dir.z);
        float t = uTime;
        float mu = dot(dir, uSunDir);
        float mu01 = max(mu, 0.0);
        // how far round the horizon from the sun (1 under it, 0 opposite)
        vec2 sh = normalize(uSunDir.xz);
        float side = clamp(0.5 + 0.5 * dot(normalize(dir.xz + 1e-5), sh), 0.0, 1.0);
        float up = max(el, 0.0);
        // the sun behind ash: redder and weaker in the eruption, gone in the rain
        vec3 sunC = uSunCol * uSunK * mix(vec3(1.0), vec3(1.0, 0.5, 0.26) * 0.75, uErupt) * (1.0 - uRain);

        // ---- the air: molten gold under the sun, crimson and violet round the back, slate teal overhead ----
        vec3 zen = mix(vec3(0.035, 0.06, 0.105), vec3(0.06, 0.105, 0.16), side);
        vec3 mid = mix(vec3(0.15, 0.07, 0.13), vec3(0.42, 0.17, 0.14), side * side);
        vec3 hor = mix(vec3(0.3, 0.08, 0.075), vec3(1.7, 0.62, 0.17), pow(side, 2.5));
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.26, up));
        col = mix(col, zen, smoothstep(0.1, 0.7, up));
        // the glow round the sun (wide forward scatter, a tight corona, the disc)
        float disc = smoothstep(0.99955, 0.99985, mu);
        vec3 sunGlow = sunC * (0.16 * pow(mu01, 5.0) + 0.5 * pow(mu01, 60.0) + 3.5 * pow(mu01, 700.0));
        // the land burns: a red breath along the whole horizon, stronger behind the giant
        float behind = exp(-(az / 0.9) * (az / 0.9));
        vec3 fire = uGlowCol * uGlow * exp(-up * 7.0) * (0.25 + 0.75 * behind);
        fire += uHotCol * uErupt * exp(-up * 3.2) * (0.3 + 0.7 * exp(-((az - VOLCANOES_MAIN_AZ) / 0.7) * ((az - VOLCANOES_MAIN_AZ) / 0.7))) * 0.8;
        col *= 1.0 - 0.45 * uErupt * smoothstep(0.08, 0.6, up);      // the ash darkens the height: the fire below reads
        col += fire;

        // ---- shafts of light through the ash: streaks radiating from the sun ----
        vec3 b1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
        vec3 b2 = cross(b1, uSunDir);
        float ang = atan(dot(dir, b2), dot(dir, b1));
        float rays = texture2D(uNoise, vec2(ang * 0.55 + t * 0.0015, 0.37)).r * 0.6 + texture2D(uNoise, vec2(ang * 1.9 - t * 0.002, 0.71)).g * 0.4;
        rays = smoothstep(0.42, 0.78, rays);
        float rayFall = pow(mu01, 3.0) * (1.0 - pow(mu01, 90.0)) * smoothstep(-0.02, 0.1, el);
        vec3 shafts = sunC * rays * rayFall * 0.3;

        // ---- cloud: high streaks that catch the sun, and the heavy smoke rolling under them ----
        vec2 cp = dir.xz / max(el + 0.16, 0.06);
        vec2 drift = vec2(t * 0.0021, t * 0.0012);
        vec2 toSun = sh * 0.035;
        // high cloud, combed by the wind
        vec2 hp = vec2(cp.x * 0.05 + cp.y * 0.018, cp.y * 0.11) + drift * 0.6;
        float hc = fbmS(hp);
        float hcS = fbmS(hp + toSun * 0.6);
        float high = smoothstep(0.5, 0.72, hc) * smoothstep(0.0, 0.14, el);
        float highLit = clamp((hc - hcS) * 7.0 + 0.45, 0.0, 1.0);          // the flank that faces the sun
        vec3 fireCloud = mix(vec3(0.3, 0.1, 0.14), mix(vec3(0.95, 0.2, 0.09), vec3(1.5, 0.62, 0.2), pow(side, 3.0)), side);
        vec3 highCol = mix(vec3(0.075, 0.05, 0.085), fireCloud, highLit * (0.35 + 0.65 * side));
        highCol += sunC * 0.6 * pow(mu01, 8.0) * (1.0 - high * 0.6);
        highCol += fire * 0.6;
        // smoke rolls
        vec2 sp = cp * 0.11;
        float c1 = fbmS(sp + drift);
        float c2 = fbmS(sp * 2.6 - drift * 1.7 + 0.47);
        float dn = c1 * 0.7 + c2 * 0.4;
        float dens = smoothstep(0.36 - 0.1 * uErupt, 0.78 - 0.08 * uErupt, dn) * smoothstep(-0.05, 0.08, el);
        float dnS = fbmS(sp + drift + toSun) * 0.7 + fbmS((sp + toSun) * 2.6 - drift * 1.7 + 0.47) * 0.4;
        float lit = clamp((dn - dnS) * 6.0 + 0.3, 0.0, 1.0);
        vec3 smoke = mix(vec3(0.03, 0.027, 0.038), vec3(0.12, 0.07, 0.075), 0.4 * c2 + 0.6 * side * side);
        smoke += vec3(1.0, 0.36, 0.14) * lit * (0.15 + 0.85 * side * side) * mix(1.0, 0.5, uErupt) * (1.0 - uRain);   // sunlit flanks
        smoke += fire * (0.5 + 0.9 * smoothstep(0.5, 0.85, c2));                                          // fire-lit bellies
        // silver lining: the thin edges of the smoke burn where the sun is behind them
        float edge = dens * (1.0 - dens) * 4.0;
        smoke += sunC * edge * (1.1 * pow(mu01, 12.0) + 0.3 * pow(mu01, 3.0));
        // compose: sky + sun, veiled by the high cloud, then by the smoke (which also hides the disc)
        vec3 sky = col + sunGlow + shafts;
        sky += sunC * disc * mix(24.0, 5.0, uEnv);
        sky = mix(sky, highCol, high * 0.9 * (1.0 - 0.75 * pow(mu01, 30.0)));
        float veil = dens * (0.93 - 0.5 * pow(mu01, 24.0));
        col = mix(sky, smoke, veil);

        // ---- distant volcanoes: silhouettes, plumes, crater glow and lava streaks ----
        // the air between: each cone paler and warmer with distance, soaked in the light near the sun
        vec3 air = mix(mid, hor, 0.55) * 0.55 + sunC * (0.3 * pow(mu01, 4.0) + 0.9 * pow(mu01, 24.0));
        for (int i = 0; i < NV; i++) {
          float da = az - vAz[i];
          da = atan(sin(da), cos(da));
          float ad = abs(da);
          if (ad > vW[i] * 1.6) continue;
          float rough = (texture2D(uNoise, vec2(da * 1.7 + float(i) * 0.37, 0.13 * float(i))).r - 0.5) * 0.025;
          float prof = vEl[i] * (1.0 - pow(clamp(ad / vW[i], 0.0, 1.0), 0.8)) - 0.012 + rough;
          float crater = vEl[i] - vCr[i] * 0.45 * smoothstep(vCr[i], 0.0, ad);
          float h = min(prof, crater);
          float far = vFar[i];
          float hot = mix(1.0, 2.6, vMain[i] * uErupt);
          // plume above the crater (drawn first, behind the cone)
          float pz = el - vEl[i];
          if (pz > -0.01) {
            float bend = pz * pz * 1.8 + pz * 0.25;
            float pw = vCr[i] * 1.1 + pz * 0.62;
            float px = (da - bend) / pw;
            float pn = fbmS(vec2(px * 0.12 + float(i), pz * 1.3 - t * 0.012 * (1.0 + vMain[i])));
            float body = exp(-px * px * 1.6) * smoothstep(0.25, 0.65, pn + 0.15);
            float plume = body * smoothstep(0.62, 0.05, pz) * smoothstep(-0.01, 0.01, pz);
            // dark ash, red at its root, its thin edges burning in the back light
            vec3 pc = mix(vec3(0.05, 0.042, 0.05), air * 0.5, far * 0.6);
            pc = mix(pc, uGlowCol * 0.7 * hot, exp(-pz * 16.0) * 0.6 * (0.5 + 0.5 * uGlow));
            float pe = plume * (1.0 - plume) * 4.0;
            pc += sunC * pe * (1.4 * pow(mu01, 12.0) + 0.35 * pow(mu01, 2.0));
            pc += vec3(0.9, 0.36, 0.16) * (1.0 - uRain) * 0.3 * clamp(px * sign(sin(${SUN.az.toFixed(3)} - vAz[i])) * 0.6 + 0.3, 0.0, 1.0) * side;
            col = mix(col, pc, plume * (0.94 - far * 0.2));
          }
          if (el < h) {
            float below = vEl[i] - el;                          // angular depth under the peak
            float depth = clamp(below / max(vEl[i], 0.01), 0.0, 1.0);
            vec3 rock = mix(vec3(0.028, 0.02, 0.024), air, far * 0.62);
            rock = mix(rock, air * 1.1, depth * depth * 0.5);   // haze pools at the feet
            rock += fire * 0.08 * far * (1.0 - depth);
            // a few lava streaks: lines through the apex (constant da / below), wiggling, broken, fading downhill
            float u = da / max(below, 0.004);
            float wig = (texture2D(uNoise, vec2(below * 6.0 + float(i) * 0.31, float(i) * 0.17)).r - 0.5) * 0.35;
            float q = fract((u + wig) * 0.9 + float(i) * 0.37);
            float line = smoothstep(0.035, 0.0, abs(q - 0.5) - 0.012);
            float brk = smoothstep(0.42, 0.62, texture2D(uNoise, vec2(floor((u + wig) * 0.9 + float(i) * 0.37) * 0.13, below * 3.0)).g);
            float streak = line * brk * exp(-depth * 3.5) * smoothstep(0.004, 0.02, below) * (0.7 + 0.3 * sin(t * 0.5 + float(i) * 2.0));
            float cr = smoothstep(vCr[i] * 1.1, 0.0, ad) * smoothstep(0.012, 0.0, below - vCr[i] * 0.15) * (0.55 + 0.45 * fbmS(vec2(da * 40.0, t * 0.05 + float(i))));
            rock += vec3(1.0, 0.24, 0.05) * (streak * 1.2 + cr * 2.4) * hot * (1.0 - far * 0.5) * (1.0 - uRain * 0.9);
            col = mix(col, rock, smoothstep(0.0, 0.0025, h - el));
          }
        }
        // ---- the eruption: fire fountains in the main crater, flicker ----
        if (uErupt > 0.01) {
          float da = atan(sin(az - VOLCANOES_MAIN_AZ), cos(az - VOLCANOES_MAIN_AZ));
          float pz = el - VOLCANOES_MAIN_EL;
          float f = exp(-(da / (0.022 + max(pz, 0.0) * 0.3)) * (da / (0.022 + max(pz, 0.0) * 0.3))) * smoothstep(0.2, 0.0, pz) * smoothstep(-0.02, 0.0, pz);
          float fl = 0.7 + 0.3 * sin(t * 13.0) * sin(t * 7.3 + 1.0);
          col += uHotCol * f * uErupt * fl * 3.2;
        }
        // ---- the closing rain: slate overcast, the red dies; one pale break where the sun was ----
        if (uRain > 0.001) {
          vec3 rainSky = mix(vec3(0.3, 0.335, 0.39), vec3(0.11, 0.135, 0.17), smoothstep(-0.05, 0.7, el));
          float sheets = texture2D(uNoise, vec2(az * 2.0 + t * 0.01, el * 0.4 - t * 0.05)).b;
          rainSky *= 0.85 + 0.3 * sheets * smoothstep(0.35, 0.0, el);
          float cl = fbmS(cp * 0.15 + drift * 3.0);
          rainSky = mix(rainSky, rainSky * 0.55, smoothstep(0.4, 0.7, cl));
          rainSky += vec3(0.95, 0.9, 0.82) * (0.5 * pow(mu01, 5.0) + 1.1 * pow(mu01, 30.0)) * (1.0 - 0.6 * smoothstep(0.4, 0.7, cl));
          col = mix(col, rainSky + col * 0.06, uRain);
        }
        col += uFlash * vec3(1.0, 0.55, 0.3) * exp(-up * 5.5) * 0.8;
        // the horizon dissolves into the haze of the land (the scene's fog colour), the ground below for the IBL
        col = mix(col, uFogCol * 1.15 + sunC * 0.25 * pow(mu01, 6.0), smoothstep(0.035, -0.05, el) * (1.0 - uEnv));
        col = mix(col, uGroundCol, smoothstep(0.0, -0.1, el) * uEnv);
        gl_FragColor = vec4(col * uBright, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`.replaceAll('VOLCANOES_MAIN_AZ', VOLCANOES[0].az.toFixed(4)).replaceAll('VOLCANOES_MAIN_EL', VOLCANOES[0].el.toFixed(4)),
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  mesh.name = 'volcano-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;   // after the opaques: early-z skips covered pixels
  return {
    mesh, material: mat, uniforms,
    update(time, s) {
      uniforms.uTime.value = time;
      if (s) {
        uniforms.uGlow.value = s.glow;
        uniforms.uErupt.value = s.erupt;
        uniforms.uRain.value = s.rain;
        uniforms.uFlash.value = s.flash || 0;
        if (s.sun !== undefined) uniforms.uSunK.value = s.sun;
        if (s.fogCol) uniforms.uFogCol.value.copy(s.fogCol);
      }
    },
  };
}

/** Direction (world) towards the main volcano (the eruption's glow: fog in-scatter in phase two). */
export function mainVolcanoDir(target = new THREE.Vector3()) {
  const v = VOLCANOES[0];
  return dirOf(v.az, v.el * 0.6, target);
}
