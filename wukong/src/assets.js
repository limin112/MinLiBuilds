// Asset loading and normalization for Tripo3D characters (Mixamo-spec skeletons).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map();

export function loadGLTF(url, onProgress) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => loader.load(url, resolve, onProgress, reject)));
  }
  return cache.get(url);
}

export async function loadTexture(url, { srgb = true, repeat = false } = {}) {
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  } catch {
    return null;
  }
}

const ARM_BONES = /^mixamorig:?(Left|Right)(ForeArm|Hand)/;
// three.js sanitizes node names (':' is removed), so 'mixamorig:Hips' arrives as 'mixamorigHips'
export const shortBone = name => name.replace(/^mixamorig:?/, '');
// note: shoulders/upper arms keep their weights (pauldrons, sleeves); only forearm/hand influence is cleaned

/** Bind-pose world position of every bone (model space of the skinned mesh). */
function bindPositions(mesh) {
  const out = new Map();
  const m = new THREE.Matrix4();
  mesh.skeleton.bones.forEach((bone, i) => {
    m.copy(mesh.skeleton.boneInverses[i]).invert();
    out.set(shortBone(bone.name), new THREE.Vector3().setFromMatrixPosition(m));
  });
  return out;
}

function distToSegment(p, a, b) {
  const ab = _v1.subVectors(b, a), ap = _v2.subVectors(p, a);
  const t = THREE.MathUtils.clamp(ap.dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
  return ap.sub(ab.multiplyScalar(t)).length();
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

/**
 * Auto-rigs often give robe/skirt vertices near the hands some forearm/hand weight; when the arms come down
 * from the A-pose those vertices are dragged into spikes. Strip forearm/hand influence from vertices that are
 * far from the forearm/hand segments and below the chest, then renormalize.
 */
export function cleanArmWeights(mesh, { radius = 0.065 } = {}) {
  const geo = mesh.geometry, pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const bones = mesh.skeleton.bones, bp = bindPositions(mesh);
  const get = n => bp.get(n);
  const chest = get('Spine1')?.y ?? Infinity;
  const segs = [];
  for (const s of ['Left', 'Right']) {
    const fa = get(s + 'ForeArm'), h = get(s + 'Hand'), tip = get(s + 'HandMiddle4') || get(s + 'HandMiddle3');
    if (fa && h) segs.push([fa, h]);
    if (h && tip) segs.push([h, tip]);
  }
  const armIdx = new Set(bones.map((b, i) => (ARM_BONES.test(b.name) ? i : -1)).filter(i => i >= 0));
  const hipsIdx = Math.max(0, bones.findIndex(b => shortBone(b.name) === 'Hips'));
  const p = new THREE.Vector3();
  // bind-space vertex positions: geometry is in mesh space; bind matrix maps it to skeleton space
  const bind = mesh.bindMatrix;
  let fixed = 0;
  for (let v = 0; v < pos.count; v++) {
    let armW = 0;
    for (let k = 0; k < 4; k++) if (armIdx.has(si.getComponent(v, k))) armW += sw.getComponent(v, k);
    if (armW <= 0) continue;
    p.fromBufferAttribute(pos, v).applyMatrix4(bind);
    if (p.y > chest) continue;
    let d = Infinity;
    for (const [a, b] of segs) d = Math.min(d, distToSegment(p, a, b));
    if (d <= radius) continue;
    let rest = 0;
    for (let k = 0; k < 4; k++) {
      if (armIdx.has(si.getComponent(v, k))) sw.setComponent(v, k, 0);
      else rest += sw.getComponent(v, k);
    }
    if (rest > 1e-4) for (let k = 0; k < 4; k++) sw.setComponent(v, k, sw.getComponent(v, k) / rest);
    else { si.setComponent(v, 0, hipsIdx); sw.setComponent(v, 0, 1); }
    fixed++;
  }
  sw.needsUpdate = si.needsUpdate = true;
  return fixed;
}

/** Remove horizontal root motion from the Hips position track (keep vertical bob and lateral sway). */
export function makeInPlace(clip) {
  const track = clip.tracks.find(t => /Hips\.position$/.test(t.name));
  if (!track) return clip;
  const v = track.values, t = track.times, n = t.length, T = t[n - 1] - t[0] || 1;
  const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2];
  for (let i = 0; i < n; i++) {
    const f = (t[i] - t[0]) / T;
    v[i * 3] -= dx * f;
    v[i * 3 + 2] -= dz * f;
  }
  clip.userData = { ...(clip.userData || {}), rootSpeed: Math.hypot(dx, dz) / T };  // file units per second
  return clip;
}

/**
 * Instantiate a character: returns { root, model, mesh, skeleton, bones, clips, height }.
 * root: Group at the feet, +Z forward. The Tripo file faces +X, so the model is turned -90° about Y.
 */
export async function loadCharacter(url, { height = 1.7, inPlace = ['walk', 'run', 'turn'], cleanArms = true, castShadow = true } = {}) {
  const gltf = await loadGLTF(url);
  const model = SkeletonUtils.clone(gltf.scene);
  let mesh = null;
  model.traverse(o => {
    if (o.isSkinnedMesh && !mesh) mesh = o;
    if (o.isMesh) {
      o.castShadow = castShadow;
      o.receiveShadow = true;
      o.frustumCulled = false;
      if (o.material) {
        o.material = o.material.clone();
        o.material.envMapIntensity = 1.0;
      }
    }
  });
  if (mesh && cleanArms) {
    // clone geometry so weight edits don't leak into other instances sharing the cached glTF
    mesh.geometry = mesh.geometry.clone();
    mesh.userData.cleanedVertices = cleanArmWeights(mesh);
  }
  const bones = {};
  if (mesh) for (const b of mesh.skeleton.bones) bones[shortBone(b.name)] = b;

  // measure the bind-pose height
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const fileHeight = box.max.y - box.min.y || 1;
  const s = height / fileHeight;
  model.scale.setScalar(s);
  model.rotation.y = -Math.PI / 2;
  model.position.y = -box.min.y * s;

  const pivot = new THREE.Group();   // used for whole-body rotations (rolls, knockdowns)
  pivot.add(model);
  const root = new THREE.Group();
  root.add(pivot);

  const clips = {};
  for (const c of gltf.animations) {
    const clip = c.clone();
    if (inPlace.includes(clip.name)) makeInPlace(clip);
    clips[clip.name] = clip;
  }
  return { root, pivot, model, mesh, skeleton: mesh?.skeleton, bones, clips, height, scale: s };
}

/**
 * Sword prop: returns a Group whose local +Y runs from the grip (origin) to the tip; total length in meters.
 * The blade axis is the longest bounding-box axis; the tip end is the end whose cross-section is narrowest.
 * gripFrac: distance from the pommel end to the grip center, as a fraction of the total length.
 */
export async function loadBlade(url, { length = 1.1, gripFrac = 0.12, castShadow = true } = {}) {
  const gltf = await loadGLTF(url);
  const obj = gltf.scene.clone(true);
  const pts = [];
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = castShadow; o.receiveShadow = true; o.material = o.material.clone();
    const p = o.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone());
  });
  const box = new THREE.Box3().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  const ax = size.x >= size.y && size.x >= size.z ? 'x' : size.z >= size.y ? 'z' : 'y';
  const others = ['x', 'y', 'z'].filter(a => a !== ax);
  const len = size[ax], lo = box.min[ax], hi = box.max[ax];
  const spread = end => {
    const sel = pts.filter(p => Math.abs(p[ax] - end) < len * 0.04);
    if (!sel.length) return 0;
    const b = new THREE.Box3().setFromPoints(sel), s = b.getSize(new THREE.Vector3());
    return Math.max(s[others[0]], s[others[1]]);
  };
  const tipAtHigh = spread(hi) < spread(lo);
  // rotation taking the tip direction of the file onto +Y
  const tipDir = new THREE.Vector3(); tipDir[ax] = tipAtHigh ? 1 : -1;
  const q = new THREE.Quaternion().setFromUnitVectors(tipDir, new THREE.Vector3(0, 1, 0));
  const s = length / len;
  const pommel = box.getCenter(new THREE.Vector3()); pommel[ax] = tipAtHigh ? lo : hi;
  const inner = new THREE.Group();
  inner.add(obj);
  inner.quaternion.copy(q);
  inner.scale.setScalar(s);
  // put the pommel center at the origin, then shift down so the grip point sits at the origin
  inner.position.copy(pommel).applyQuaternion(q).multiplyScalar(-s);
  inner.position.y -= length * gripFrac;
  const holder = new THREE.Group();
  holder.add(inner);
  holder.userData = { length, gripFrac, bladeLength: length * (1 - gripFrac) };
  return holder;
}
