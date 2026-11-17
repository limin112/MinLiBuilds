// Keyboard-only controls for 火焰山 · 牛魔, on top of the shared Input (src/input.js, not modified):
//
//   W A S D   move (relative to the automatic camera; arrow keys too)
//   Space     tap = roll (fires on release), hold = run
//   J         light: the three-hit staff combo (a fourth press: the spinning finisher); 牵牛鼻子 when his head is down
//   K         heavy: hold to charge, release to smash
//   L         guard: hold to block; pressed just before a blow lands = parry
//   (no I: the banana-leaf fan was taken out of the game on 2026-11-17 - the user wants J K L only)
//
// Mouse is optional (LMB light / RMB guard / small camera nudge while pointer-locked, from the base class).
// Gamepad (base class): RB light · RT heavy · LB guard · B tap roll / hold run · Start pause.
import { Input } from '../input.js';

const KEYS = { KeyJ: 'light', KeyK: 'heavy', KeyL: 'block' };
const now = () => performance.now() / 1000;

export class NiumoInput extends Input {
  constructor(canvas) {
    super(canvas);
    this.tapTime = 0.24;        // Space released sooner than this rolls; held longer, he runs
    this.spaceDownAt = -1;      // seconds (performance clock) the Space key went down, -1 when up
    this.kbCode = null;         // code of the keyboard event the base listeners are handling right now
    this.touchMove = { x: 0, y: 0 };   // the on-screen stick (touch.js): camera-relative, like WASD
    this.touchRun = false;             // the stick pushed to its rim
    // capture phase runs before the base class's window listeners: remember which key they are about to translate,
    // so the base mapping of Space -> 'roll' on key-down (and E/R -> 'heal') can be swallowed in press()
    addEventListener('keydown', e => { this.kbCode = e.code; }, true);
    addEventListener('keyup', e => { this.kbCode = e.code; }, true);
    // bubble phase, registered after the base listeners: our own keys, then forget the event
    addEventListener('keydown', e => {
      if (!e.repeat) {
        if (e.code === 'Space') this.spaceDownAt = now();
        const a = KEYS[e.code];
        if (a) this.press(a);
      }
      this.kbCode = null;
    });
    addEventListener('keyup', e => {
      if (e.code === 'Space') {
        const held = this.spaceDownAt >= 0 ? now() - this.spaceDownAt : Infinity;
        this.spaceDownAt = -1;
        if (held < this.tapTime) super.press('roll');
      }
      const a = KEYS[e.code];
      if (a) this.release(a);
      this.kbCode = null;
    });
    // a key released while the window is unfocused never sends keyup: drop everything held
    addEventListener('blur', () => this.clearHeld());
  }

  press(action) {
    if (this.kbCode === 'Space' && action === 'roll') return;   // Space rolls on release (tap) instead
    if (action === 'heal' || action === 'fan') return;            // no flasks, no fan (E/R and pad X do nothing)
    super.press(action);
  }

  // locked (a scripted beat inside the fight, e.g. the opening bullet time): the monkey hears nothing; presses are dropped
  take(a, w) { return !this.locked && super.take(a, w); }
  peek(a, w) { return !this.locked && super.peek(a, w); }
  isHeld(a) { return !this.locked && super.isHeld(a); }

  /** Space (or the pad's B) held past a tap, or Shift, or the touch stick at its rim. */
  sprinting() {
    if (this.locked) return false;
    return (this.spaceDownAt >= 0 && now() - this.spaceDownAt >= this.tapTime) || this.touchRun || super.sprinting();
  }

  /** The keys / pad, or the touch stick when it is pushed further. */
  move() {
    if (this.locked) return { x: 0, y: 0 };
    const m = super.move(), t = this.touchMove;
    return Math.hypot(t.x, t.y) > Math.hypot(m.x, m.y) ? { x: t.x, y: t.y } : m;
  }

  /** Seconds the Space key has been held (0 when up). */
  spaceHeld() { return this.spaceDownAt >= 0 ? now() - this.spaceDownAt : 0; }

  clearHeld() {
    this.keys.clear();
    this.held.clear();
    this.buffer.clear();
    this.spaceDownAt = -1;
    this.kbCode = null;
    this.touchMove.x = this.touchMove.y = 0; this.touchRun = false;
  }

  update(dt) {
    this.kbCode = null;
    super.update(dt);
  }
}
