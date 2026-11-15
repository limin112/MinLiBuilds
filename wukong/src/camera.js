// Third-person camera with Souls-style lock-on, trauma-based shake, directional kick and FOV punch.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _seg = new THREE.Vector3();

/** Entry parameter (0..1) of the segment a + s*d into the vertical circle (x, z, r), or 1 when it does not enter. */
function enterCircle(a, d, x, z, r) {
  const ox = a.x - x, oz = a.z - z;
  const A = d.x * d.x + d.z * d.z, B = 2 * (d.x * ox + d.z * oz), Cc = ox * ox + oz * oz - r * r;
  if (Cc <= 0 || A < 1e-9) return 1;              // the player is already inside: never clip on it
  const disc = B * B - 4 * A * Cc;
  if (disc < 0) return 1;
  const s = (-B - Math.sqrt(disc)) / (2 * A);
  return s >= 0 && s < 1 ? s : 1;
}
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// cheap smooth noise for shake
function noise1(t, seed) {
  return Math.sin(t * 13.1 + seed) * 0.5 + Math.sin(t * 27.7 + seed * 1.7) * 0.3 + Math.sin(t * 51.3 + seed * 2.3) * 0.2;
}

export class CameraRig {
  constructor(camera, { bounds }) {
    this.cam = camera;
    this.bounds = bounds;
    this.yaw = Math.PI;          // looking toward -Z
    this.pitch = 0.18;           // + looks down
    this.dist = 4.3;
    this.targetHeight = 1.42;
    this.target = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.locked = false;
    this.lockPoint = null;       // () => Vector3
    this.trauma = 0;
    this.shakeScale = 1;         // settings: 0 = no shake / kick, 1 = full
    // locked on: pull back and narrow the lens (telephoto) so the 5 m saint reads as three times the knight
    this.lockDistAdd = 3.0; this.lockFovAdd = -10;
    this.kick = new THREE.Vector3();
    this.kickVel = new THREE.Vector3();
    this.fovBase = camera.fov;
    this.fovPunch = 0;
    this.time = 0;
    this.initialized = false;
    this.lockBlend = 0;
    // camera collision: { circles: [{x, z, r}], bounds: {minX, maxX, minZ, maxZ} } (static, e.g. the hall's piers)
    // plus bodies() -> [{x, z, r, top}] (moving, e.g. the boss); the camera pulls in front of them
    this.blockers = null;
    this.bodies = null;
    this.clipS = 1;
  }

  /** How far (0..1) along target -> pos the camera can sit without entering a pier, a wall or a body. */
  clearance(target, pos) {
    const d = _seg.subVectors(pos, target);
    let s = 1;
    const bl = this.blockers;
    if (bl) {
      if (bl.circles) for (const c of bl.circles) s = Math.min(s, enterCircle(target, d, c.x, c.z, c.r + 0.35));
      const b = bl.bounds;
      if (b) {
        if (pos.x > b.maxX && d.x > 1e-6) s = Math.min(s, (b.maxX - target.x) / d.x);
        if (pos.x < b.minX && d.x < -1e-6) s = Math.min(s, (b.minX - target.x) / d.x);
        if (pos.z > b.maxZ && d.z > 1e-6) s = Math.min(s, (b.maxZ - target.z) / d.z);
        if (pos.z < b.minZ && d.z < -1e-6) s = Math.min(s, (b.minZ - target.z) / d.z);
      }
    }
    if (this.bodies) {
      for (const o of this.bodies()) {
        const e = enterCircle(target, d, o.x, o.z, o.r + 0.3);
        if (e < 1 && target.y + d.y * e < o.top) s = Math.min(s, e);
      }
    }
    return Math.max(0.12, s);
  }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }
  /** Impulse that shoves the camera along `dir` (world) by roughly `amount` meters. */
  punch(dir, amount = 0.2) { this.kickVel.addScaledVector(dir, amount * 18); }
  zoomPunch(deg = 3) { this.fovPunch = Math.max(this.fovPunch, deg); }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  setLock(fn) { this.lockPoint = fn; this.locked = !!fn; }

  snapBehind(playerPos, yaw) {
    this.yaw = yaw; this.pitch = 0.16;
    this.target.copy(playerPos).y += this.targetHeight;
    this.initialized = false;
  }

  update(dt, playerPos, look) {
    this.time += dt;
    const desiredTarget = _v.copy(playerPos); desiredTarget.y += this.targetHeight;
    if (!this.initialized) { this.target.copy(desiredTarget); }
    this.target.lerp(desiredTarget, damp(14, dt));

    this.lockBlend += ((this.locked ? 1 : 0) - this.lockBlend) * damp(6, dt);
    if (this.locked && this.lockPoint) {
      const lp = this.lockPoint();
      const dx = lp.x - playerPos.x, dz = lp.z - playerPos.z;
      const horiz = Math.hypot(dx, dz);
      const desiredYaw = Math.atan2(dx, dz);
      this.yaw += wrap(desiredYaw - this.yaw) * damp(7, dt);
      // pitch so that both the player and the (tall) boss stay framed: look up more when she is close
      const up = Math.atan2(lp.y - (playerPos.y + 1.6), Math.max(horiz, 0.5));
      const desiredPitch = THREE.MathUtils.clamp(0.22 - up * 0.42, -0.35, 0.42);
      this.pitch += (desiredPitch - this.pitch) * damp(5, dt);
      this.yaw += look.dx * 0.15;     // small manual nudge while locked
    } else {
      this.yaw -= look.dx;
      this.pitch = THREE.MathUtils.clamp(this.pitch + look.dy, -0.55, 1.1);
    }
    this.yaw = wrap(this.yaw);

    const dist = this.dist + this.lockBlend * this.lockDistAdd;
    const d = _w.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const pos = this.pos.copy(this.target).addScaledVector(d, -dist);
    pos.y += this.lockBlend * 0.75;
    if (this.blockers || this.bodies) {
      // pull in front of piers / walls / her body at once, ease back out when the view is clear again
      const s = this.clearance(this.target, pos);
      this.clipS = s < this.clipS ? s : this.clipS + (s - this.clipS) * damp(2.5, dt);
      pos.sub(this.target).multiplyScalar(this.clipS).add(this.target);
    } else {
      const b = this.bounds;           // no collision data: just keep inside the hall
      pos.x = THREE.MathUtils.clamp(pos.x, b.minX - 5, b.maxX + 5);
      pos.z = THREE.MathUtils.clamp(pos.z, b.minZ - 4, b.maxZ + 8);
    }
    pos.y = Math.max(pos.y, 0.35);

    // look target: the player, pulled toward the lock point when locked
    const lookTarget = _v.copy(this.target).addScaledVector(d, 2.0);
    if (this.locked && this.lockPoint) {
      const lp = this.lockPoint();
      const mid = new THREE.Vector3().copy(this.target).lerp(lp, 0.56);
      lookTarget.lerp(mid, this.lockBlend);
    }
    if (!this.initialized) { this.lookAt.copy(lookTarget); this.initialized = true; }
    this.lookAt.lerp(lookTarget, damp(this.locked ? 10 : 30, dt));

    // kick spring
    this.kickVel.addScaledVector(this.kick, -220 * dt);
    this.kickVel.multiplyScalar(Math.exp(-16 * dt));
    this.kick.addScaledVector(this.kickVel, dt);

    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const s = this.trauma * this.trauma * this.shakeScale;
    const t = this.time;
    this.cam.position.copy(pos).addScaledVector(this.kick, this.shakeScale);
    this.cam.position.x += noise1(t, 1) * 0.22 * s;
    this.cam.position.y += noise1(t, 2) * 0.18 * s;
    this.cam.position.z += noise1(t, 3) * 0.22 * s;
    this.cam.lookAt(this.lookAt);
    this.cam.rotateZ(noise1(t, 4) * 0.045 * s);

    this.fovPunch = Math.max(0, this.fovPunch - dt * 18);
    const fov = this.fovBase - this.fovPunch + this.lockBlend * this.lockFovAdd;
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  }
}
