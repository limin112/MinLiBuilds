// Touch controls for phones and tablets (2026-11-17 user: "要支持移动端打开玩"; then "像王者荣耀的界面，左边是方向键，
// 右边是两个技能").
//
// Left: a joystick, always shown in the lower left; a thumb anywhere on the left half takes it there (floating) ->
// NiumoInput.touchMove (analog, camera-relative like WASD); pushed to the rim he runs.
// Right: two buttons, sending the very keyboard events the keys send, so every rule of the keyboard holds:
//   攻 (big)  tap = J light; held past HOLD s = K held (the charged smash, released on lift)
//   闪        tap = Space (roll / step); held past HOLD s = L held (guard; a parry still needs it just before the blow)
//   停 Escape (pause) · 跳过 Enter (cinematics) · 再来一次 R (ending).
// Shown when the device has a coarse pointer (or ?touch); hidden on the splash and the ending card by the page's state.

export const isTouch = () => new URLSearchParams(location.search).has('touch')
  || (matchMedia?.('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);

const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code, bubbles: true }));

export function createTouchControls(input, { getState = () => 'fight' } = {}) {
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="stick"><div class="knob"></div></div>
    <div class="btns">
      <button data-tap="KeyJ" data-hold="KeyK" class="b-atk">攻</button>
      <button data-tap="Space" data-hold="KeyL" class="b-dodge">闪</button>
    </div>
    <button data-code="Escape" class="b-pause">停</button>
    <button data-code="Enter" class="b-skip">跳过 ›</button>
    <button data-code="KeyR" class="b-retry">再来一次</button>
    <div class="rotate">请横屏游玩<br><small>Rotate to landscape</small></div>`;
  document.body.appendChild(root);
  document.body.classList.add('touch');

  // ---------------------------------------------------------------------------------------- the two skill buttons
  const HOLD = 0.22;
  for (const b of root.querySelectorAll('button[data-tap]')) {
    const tap = b.dataset.tap, hold = b.dataset.hold;
    let id = null, timer = 0, held = false;
    const down = e => {
      e.preventDefault(); e.stopPropagation();
      if (id !== null) return;
      id = e.pointerId; b.setPointerCapture?.(e.pointerId); b.classList.add('on'); held = false;
      timer = setTimeout(() => { held = true; b.classList.add('hold'); key('keydown', hold); }, HOLD * 1000);
    };
    const up = e => {
      if (id === null || (e.pointerId !== undefined && e.pointerId !== id)) return;
      e.preventDefault(); id = null; clearTimeout(timer); b.classList.remove('on', 'hold');
      if (held) key('keyup', hold);
      else { key('keydown', tap); setTimeout(() => key('keyup', tap), 40); }
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ---------------------------------------------------------------------------------------- the other buttons
  for (const b of root.querySelectorAll('button[data-code]')) {
    const code = b.dataset.code;
    let id = null;
    const down = e => {
      e.preventDefault(); e.stopPropagation();
      if (id !== null) return;
      id = e.pointerId; b.setPointerCapture?.(e.pointerId); b.classList.add('on');
      key('keydown', code);
    };
    const up = e => {
      if (id === null || (e.pointerId !== undefined && e.pointerId !== id)) return;
      e.preventDefault(); id = null; b.classList.remove('on');
      key('keyup', code);
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ---------------------------------------------------------------------------------------- the stick
  const stick = root.querySelector('.stick'), knob = root.querySelector('.knob');
  const R = 56;
  let sid = null, ox = 0, oy = 0;
  const zone = e => e.clientX < innerWidth * 0.5 && !e.target.closest?.('button');
  addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || sid !== null || !zone(e) || !root.classList.contains('play')) return;
    sid = e.pointerId; ox = e.clientX; oy = e.clientY;
    stick.style.left = ox + 'px'; stick.style.top = oy + 'px'; stick.classList.add('on');
    knob.style.transform = 'translate(-50%, -50%)';
  }, { passive: true });
  addEventListener('pointermove', e => {
    if (e.pointerId !== sid) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const m = Math.min(1, l / R), dead = 0.12, k = m < dead ? 0 : (m - dead) / (1 - dead) / (m || 1);
    input.touchMove.x = dx / R * k; input.touchMove.y = -dy / R * k;
    // pushed to the rim: he runs (like holding Space)
    input.touchRun = m > 0.96;
  }, { passive: true });
  // at rest the stick waits in the lower left (shown, dim), like a MOBA's
  const home = () => { stick.style.left = `max(${R + 54}px, calc(env(safe-area-inset-left) + ${R + 40}px))`; stick.style.top = `calc(100% - ${R + 48}px)`; knob.style.transform = 'translate(-50%, -50%)'; };
  home();
  const end = e => {
    if (e.pointerId !== sid) return;
    sid = null; stick.classList.remove('on'); home();
    input.touchMove.x = input.touchMove.y = 0; input.touchRun = false;
  };
  addEventListener('pointerup', end); addEventListener('pointercancel', end);

  // ---------------------------------------------------------------------------------------- what shows when
  let last = '';
  const tick = () => {
    const s = getState();
    const play = s === 'fight' || s === 'fight-wait';
    const cine = s === 'mv' || s === 'transition' || s === 'ending';
    const cls = (play ? 'play ' : '') + (cine ? 'cine ' : '') + (s === 'ending' ? 'end' : '');
    if (cls !== last) {
      last = cls; root.className = cls;
      if (!play) { input.touchMove.x = input.touchMove.y = 0; input.touchRun = false; sid = null; stick.classList.remove('on'); home(); }
    }
    requestAnimationFrame(tick);
  };
  tick();
  // no page zoom / scroll / text selection under the thumbs; and no emulated mouse events after a touch on the canvas
  // or a button (the canvas takes a mouse click as a blow of the staff: every touch of the stick struck)
  document.addEventListener('touchstart', e => { if (e.target.closest?.('#touch button, canvas')) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 || e.target.closest?.('#touch, canvas')) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  return root;
}

export const TOUCH_CSS = `
  body.touch #keyline { display: none; }
  body.touch, body.touch * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  body.touch canvas { touch-action: none; }
  #touch { position: fixed; inset: 0; pointer-events: none; z-index: 30; font-family: var(--serif); }
  #touch button { pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; border: 1px solid rgba(220,194,142,.55);
    background: rgba(10,7,5,.42); color: #e4dac7; border-radius: 50%; font: 600 20px var(--serif); display: none; padding: 0;
    box-shadow: 0 2px 10px rgba(0,0,0,.45); backdrop-filter: blur(2px); }
  #touch button.on { background: rgba(185,154,95,.55); color: #120c08; }
  #touch.play .btns button, #touch.play .b-pause { display: block; }
  #touch.cine .b-skip, #touch.end .b-retry { display: block; }
  #touch .b-retry { position: absolute; left: 50%; bottom: max(26px, env(safe-area-inset-bottom)); transform: translateX(-50%); width: auto; height: 46px;
    border-radius: 23px; padding: 0 26px; font-size: 17px; letter-spacing: .3em; }
  #touch .btns { position: absolute; right: max(22px, env(safe-area-inset-right)); bottom: max(20px, env(safe-area-inset-bottom)); width: 200px; height: 170px; }
  #touch .btns button { position: absolute; }
  #touch .b-atk { right: 0; bottom: 0; width: 96px; height: 96px; font-size: 32px; border-width: 2px; }
  #touch .b-dodge { right: 112px; bottom: 54px; width: 68px; height: 68px; font-size: 22px; }
  #touch .btns button.hold { box-shadow: 0 0 0 3px rgba(230,190,110,.55), 0 2px 10px rgba(0,0,0,.45); }
  #touch .b-pause { position: absolute; right: max(16px, env(safe-area-inset-right)); top: max(12px, env(safe-area-inset-top)); width: 40px; height: 40px; font-size: 15px; }
  #touch .b-skip { position: absolute; right: max(18px, env(safe-area-inset-right)); top: max(16px, env(safe-area-inset-top)); width: auto; height: 40px;
    border-radius: 20px; padding: 0 18px; font-size: 15px; letter-spacing: .2em; }
  #touch .stick { position: absolute; width: 132px; height: 132px; margin: -66px 0 0 -66px; border-radius: 50%; border: 1px solid rgba(220,194,142,.4);
    background: rgba(10,7,5,.25); opacity: 0; transition: opacity .15s; }
  #touch.play .stick { opacity: .45; } #touch.play .stick.on { opacity: 1; }
  #touch .knob { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; border-radius: 50%; background: rgba(220,194,142,.5); transform: translate(-50%, -50%); }
  #touch .rotate { display: none; position: fixed; inset: 0; background: #050404; color: #e4dac7; font-size: 22px; letter-spacing: .3em; text-align: center;
    align-items: center; justify-content: center; flex-direction: column; pointer-events: auto; z-index: 40; }
  #touch .rotate small { font-family: Georgia, serif; font-style: italic; font-size: 14px; letter-spacing: .05em; opacity: .7; margin-top: 10px; }
  @media (orientation: portrait) { #touch .rotate { display: flex; } }
  /* a phone in landscape: the HUD a little smaller */
  @media (max-height: 500px) {
    body.touch #boss { bottom: 18px; width: 56vw; } body.touch #boss .name { font-size: 14px; margin-bottom: 4px; }
    body.touch #tip { font-size: 15px !important; bottom: 66px !important; white-space: normal !important; max-width: 52vw; left: 47% !important; text-align: center; } body.touch #tip i { font-size: 12px; }
    body.touch #goal { font-size: 13px; } body.touch #goal i { font-size: 11px; }
    body.touch .bar { left: 18px; } body.touch #hp { top: 16px; width: 220px; } body.touch #st { top: 30px; width: 160px; } body.touch #mp { top: 42px; width: 120px; }
  }
`;
