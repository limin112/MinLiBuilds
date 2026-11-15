// Image-based lighting for the PBR characters (bone-white hide, gold, black iron): the sky dome's own shader (sky.js,
// in its IBL mode: a softer sun, a real ground) rendered once per mood with the floor of the caldera under it — dark
// ash crossed by the two glowing rivers — and prefiltered with PMREM. The arena swaps the maps by phase.
import * as THREE from 'three';
import { createSky } from './sky.js';

const MOODS = {
  // the burning dusk
  ember: { glow: 0.7, erupt: 0, rain: 0, sun: 1, fog: [0.3, 0.16, 0.1], ground: [0.07, 0.04, 0.028], lava: [2.2, 0.45, 0.08] },
  // the mountain splits: everything is lit from below and behind
  erupt: { glow: 1.6, erupt: 1, rain: 0, sun: 1, fog: [0.42, 0.17, 0.08], ground: [0.16, 0.055, 0.02], lava: [5.0, 1.1, 0.2] },
  // the rain: a cool overcast with one pale break
  rain: { glow: 0.1, erupt: 0, rain: 1, sun: 1, fog: [0.2, 0.22, 0.25], ground: [0.05, 0.055, 0.06], lava: [0.3, 0.06, 0.015] },
};

export function buildVolcanoEnvMaps(renderer, noise) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const maps = {};
  for (const [k, m] of Object.entries(MOODS)) {
    const s = new THREE.Scene();
    const sky = createSky({ noise, env: true });
    sky.update(0, { glow: m.glow, erupt: m.erupt, rain: m.rain, sun: m.sun, fogCol: new THREE.Color(...m.fog) });
    sky.uniforms.uGroundCol.value.setRGB(...m.ground);
    sky.mesh.renderOrder = 0;
    s.add(sky.mesh);
    // the rivers: two long glowing strips below the horizon, converging behind the giant; the moat behind him
    const lava = new THREE.MeshBasicMaterial({ color: new THREE.Color(...m.lava), side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(4, 90), lava);
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = sx * 0.28;
      strip.position.set(sx * 24, -3.5, 0);
      s.add(strip);
    }
    const moat = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), lava);
    moat.rotation.x = -Math.PI / 2;
    moat.position.set(0, -3.5, -45);
    s.add(moat);
    maps[k] = pmrem.fromScene(s, 0.02, 0.1, 400, { size: 256, position: new THREE.Vector3(0, 2, 0) }).texture;
    s.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  pmrem.dispose();
  return maps;
}
