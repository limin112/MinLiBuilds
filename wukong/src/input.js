// Keyboard + mouse (pointer lock) + gamepad. Actions are edge-triggered with a short input buffer.
//
// Keyboard/mouse: WASD move · mouse look · LMB light attack · RMB block (hold) · Shift+LMB / F heavy · Space roll (tap) ·
//                 Shift hold sprint · Q / MMB lock-on · E / R heal · Esc pause · Enter skip
// Gamepad:        LS move · RS look · RB light · RT heavy · LB block · B (or A) roll/sprint · R3 lock-on · X heal · Start pause
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0 };
    this.buffer = new Map();       // action -> time pressed (seconds, performance.now based)
    this.held = new Set();
    this.lookSensitivity = 0.0024;
    this.padLookScale = 1;         // settings: gamepad look speed multiplier
    this.invertY = false;          // settings: invert vertical look
    this.pad = null;
    this.padPrev = [];
    this.sprintHeldTime = 0;
    this.enabled = true;
    this.pointerLocked = false;

    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEYMAP[e.code];
      if (a) this.press(a);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      const a = KEYMAP[e.code];
      if (a) this.release(a);
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.pointerLocked && this.enabled) canvas.requestPointerLock?.()?.catch?.(() => {});
      if (e.button === 0) this.press(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 'heavy' : 'light');
      if (e.button === 2) this.press('block');
      if (e.button === 1) this.press('lock');
      e.preventDefault();
    });
    canvas.addEventListener('mouseup', e => {
      if (e.button === 0) { this.release('light'); this.release('heavy'); }
      if (e.button === 2) this.release('block');
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.pointerLocked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === canvas; });
  }

  press(action) { this.buffer.set(action, performance.now() / 1000); this.held.add(action); }
  release(action) { this.held.delete(action); }

  /** Consume a buffered press if it happened within `window` seconds. */
  take(action, window = 0.22) {
    const t = this.buffer.get(action);
    if (t === undefined) return false;
    if (performance.now() / 1000 - t > window) { this.buffer.delete(action); return false; }
    this.buffer.delete(action);
    return true;
  }
  peek(action, window = 0.22) {
    const t = this.buffer.get(action);
    return t !== undefined && performance.now() / 1000 - t <= window;
  }
  isHeld(action) { return this.held.has(action); }

  /** Movement vector in camera-relative axes: {x: right, y: forward}, magnitude 0..1. */
  move() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const p = this.pad;
    if (p) {
      const ax = dz(p.axes[0]), ay = dz(p.axes[1]);
      if (Math.hypot(ax, ay) > Math.hypot(x, y)) { x = ax; y = -ay; }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  /** Camera look delta in radians since last call. */
  look(dt) {
    let dx = this.mouse.dx * this.lookSensitivity, dy = this.mouse.dy * this.lookSensitivity;
    this.mouse.dx = this.mouse.dy = 0;
    const p = this.pad;
    if (p) { dx += dz(p.axes[2]) * 3.2 * dt * this.padLookScale; dy += dz(p.axes[3]) * 2.4 * dt * this.padLookScale; }
    return { dx, dy: this.invertY ? -dy : dy };
  }

  sprinting() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (this.pad && (this.pad.buttons[1]?.pressed || this.pad.buttons[0]?.pressed) && this.sprintHeldTime > 0.25);
  }

  /** Poll the gamepad once per frame (edge detection into the same action buffer). */
  update(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = [...pads].find(p => p && p.connected) || null;
    if (!this.pad) return;
    const b = this.pad.buttons.map(x => x.pressed || x.value > 0.5);
    const edge = i => b[i] && !this.padPrev[i];
    const up = i => !b[i] && this.padPrev[i];
    if (edge(5)) this.press('light');
    if (edge(7)) this.press('heavy');
    if (up(7)) this.release('heavy');
    if (edge(4)) this.press('block');
    if (up(4)) this.release('block');
    if (edge(11) || edge(10)) this.press('lock');
    if (edge(2)) this.press('heal');
    if (edge(9)) { this.press('pause'); this.press('menu'); }   // Start: pause menu (and skips the intro)
    if (edge(3)) this.press('skip');
    // B/A: tap = roll (on release, if short), hold = sprint
    const rollBtn = b[1] || b[0];
    if (rollBtn) this.sprintHeldTime += dt;
    else {
      if (this.sprintHeldTime > 0 && this.sprintHeldTime < 0.25) this.press('roll');
      this.sprintHeldTime = 0;
    }
    this.padPrev = b;
  }

  rumble(strong = 0.6, weak = 0.4, ms = 120) {
    const act = this.pad?.vibrationActuator;
    if (act?.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}

const KEYMAP = {
  Space: 'roll', KeyQ: 'lock', Tab: 'lock', KeyE: 'heal', KeyR: 'heal', Escape: 'pause', Enter: 'skip', KeyF: 'heavy',
};
const dz = v => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
