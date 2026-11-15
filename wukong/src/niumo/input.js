// Keyboard-only controls for 火焰山 · 牛魔, on top of the shared Input (src/input.js, not modified):
//
//   W A S D   move (relative to the automatic camera; arrow keys too)
//   Space     tap = roll (fires on release), hold = run
//   J         light: the three-hit staff combo (a fourth press: the spinning finisher); 牵牛鼻子 when his head is down
//   K         heavy: hold to charge, release to smash
//   L         guard: hold to block; pressed just before a blow lands = parry
//   I         芭蕉扇 (the banana-leaf fan, costs mana)
//
// Mouse is optional (LMB light / RMB guard / small camera nudge while pointer-locked, from the base class).
// Gamepad (base class): RB light · RT heavy · LB guard · B tap roll / hold run · X fan · Start pause.
import { Input } from '../input.js';

const KEYS = { KeyJ: 'light', KeyK: 'heavy', KeyL: 'block', KeyI: 'fan' };
const now = () => performance.now() / 1000;

export class NiumoInput extends Input {
  constructor(canvas) {
    super(canvas);
    this.tapTime = 0.24;        // Space released sooner than this rolls; held longer, he runs
    this.spaceDownAt = -1;      // seconds (performance clock) the Space key went down, -1 when up
    this.kbCode = null;         // code of the keyboard event the base listeners are handling right now
    // capture phase runs before the base class's window listeners: remember which key they are about to translate,
    // so the base mapping of Space -> 'roll' on key-down (and E/R -> 'heal') can be swallowed in press()
    addEventListener('keydown', e => { this.kbCode = e.code; }, true);
    addEventListener('keyup', e => { this.kbCode = e.code; }, true);
    // bubble phase, registered after the base listeners: our own keys, then forget the event
    addEventListener('keydown', e => {
      if (!e.repeat) {
        if (e.code === 'Space') this.spaceDownAt = now();
        const a = KEYS[e.code];
        if (a) { this.press(a); if (e.code === 'KeyI') e.preventDefault(); }
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
    if (action === 'heal') {                                      // no flasks here: pad X is the fan, E/R do nothing
      if (this.kbCode) return;
      action = 'fan';
    }
    super.press(action);
  }

  /** Space (or the pad's B) held past a tap, or Shift. */
  sprinting() {
    return (this.spaceDownAt >= 0 && now() - this.spaceDownAt >= this.tapTime) || super.sprinting();
  }

  /** Seconds the Space key has been held (0 when up). */
  spaceHeld() { return this.spaceDownAt >= 0 ? now() - this.spaceDownAt : 0; }

  clearHeld() {
    this.keys.clear();
    this.held.clear();
    this.buffer.clear();
    this.spaceDownAt = -1;
    this.kbCode = null;
  }

  update(dt) {
    this.kbCode = null;
    super.update(dt);
  }
}
