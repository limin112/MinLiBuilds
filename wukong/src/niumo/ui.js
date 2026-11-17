// 火焰山 · 牛魔 HUD: the shared UI (src/ui.js: boss bar with chip damage, cards, subtitles, hint, reticle) plus the
// monkey's mana bar (hidden: the fan is gone), the chapter card (回目) and the MV narration line. niumo.html provides the DOM.
import { UI } from '../ui.js';
import { ICON_SWORD, ICON_HEAVY, ICON_DODGE } from './touch.js';

const $ = s => document.querySelector(s);

export class NiumoUI extends UI {
  constructor() {
    super();
    this.mp = $('#mp .fill'); this.mpBar = $('#mp');
    this.chapter = $('#chapter');
    this.mvText = $('#mvtext');
    this.narr = '';
  }

  /** Player bars: hp (with chip), stamina, mana (the fan). The shared UI's flask counter does not exist here. */
  setPlayer(hp, hpMax, st, stMax, mp = 0, mpMax = 100) {
    const f = Math.max(0, hp / hpMax);
    if (f < this.vals.hp) this.vals.hpChipHold = 0.6;
    this.vals.hp = f;
    this.hp.style.width = (f * 100) + '%';
    this.st.style.width = (Math.max(0, st / stMax) * 100) + '%';
    const m = Math.max(0, Math.min(1, mp / (mpMax || 1)));
    if (Math.abs(m - (this.vals.mp ?? -1)) > 1e-3) {
      this.vals.mp = m;
      this.mp.style.width = (m * 100) + '%';
      this.mpBar.classList.toggle('low', m < 0.25);
    }
  }

  /** The chapter card (回目卡). */
  showChapter(on) { this.chapter.classList.toggle('on', !!on); }
  get chapterText() { return this.chapter.querySelector('.page')?.dataset.text || ''; }

  /** One narration line of the opening cinematic ('' hides it). */
  narrate(text, en = '') {
    if (text === this.narr) return;
    this.narr = text;
    if (text) {
      this.mvText.textContent = ''; this.mvText.append(this.zh_(text)); this.mvText.dataset.text = text; this.mvText.dataset.speaker = '';
      this.addEn_(en);
      this.mvText.classList.remove('line'); this.mvText.classList.add('on');
    } else this.mvText.classList.remove('on');
  }

  /** A spoken line: the speaker's name small above it (same place as the narration; '' hides it). */
  speak(name, text, speaker = '', en = '') {
    const key = text ? name + '|' + text : '';
    if (key === this.narr) return;
    this.narr = key;
    const el = this.mvText;
    if (!text) { el.classList.remove('on'); return; }
    el.textContent = '';
    const who = document.createElement('span'); who.className = 'who'; who.textContent = name;
    el.append(who, this.zh_(text));
    el.dataset.text = text; el.dataset.speaker = speaker;
    this.addEn_(en);
    el.classList.add('on', 'line');
  }
  /** The Chinese line, in its own span (a phone shows the English instead when there is one). */
  zh_(text) { const z = document.createElement('span'); z.className = 'zh'; z.textContent = text; return z; }
  /** The English subtitle, small under the line (on a phone, instead of the line: 2026-11-17 user, shorter). */
  addEn_(en) {
    this.mvText.classList.toggle('hasen', !!en);
    if (!en) return;
    const e = document.createElement('span'); e.className = 'en'; e.textContent = en;
    this.mvText.append(e);
  }

  /** What to do now (under the bars); html allowed: <b>3 / 6</b>. '' hides it. */
  setGoal(html) { this.html_('#goal', html); }
  /** The answer to what he is doing (large, low in the middle). kind: 'danger' (his blow) | 'go' (your opening) | ''. */
  setTip(html, kind = '') {
    const el = this.html_('#tip', html);
    if (el && html) { el.classList.toggle('danger', kind === 'danger'); el.classList.toggle('go', kind === 'go'); }
  }
  /** The keys, along the bottom edge. */
  setKeys(html) { this.html_('#keyline', html); }
  html_(sel, html) {
    if (html && document.body.classList.contains('touch')) html = touchKeys(html);
    const el = $(sel);
    if (!el) return null;
    const cur = el.dataset.html || '';
    if (cur !== html) { if (html) el.innerHTML = html; el.dataset.html = html; el.classList.toggle('on', !!html); }
    return el;
  }

  /** His posture (架势) under his health: f 0..1 (-1 hides it); it fills as blows land and breaks when full. */
  setPosture(f, broken = false) {
    const el = this.postureEl || (this.postureEl = $('#posture'));
    if (!el) return;
    const on = f >= 0;
    if (on !== this.postureOn) { this.postureOn = on; el.classList.toggle('on', on); }
    if (!on) return;
    const w = Math.round(f * 1000) / 10;
    if (w !== this.postureW) { this.postureW = w; el.firstElementChild.style.width = w + '%'; }
    if (broken !== this.postureBroken) { this.postureBroken = broken; el.classList.toggle('broken', broken); }
  }

  letterbox(on) { document.getElementById('letterbox').classList.toggle('on', !!on); }
  clearCard() { this.card.classList.remove('on'); this.cardTimer = 0; }
}

// on a phone the keys are the on-screen buttons (touch.js): <kbd>J</kbd> -> <kbd>攻</kbd> ...
// (three buttons, 2026-11-17 user: light / heavy / roll, as on the keyboard)
const TOUCH_NAMES = { J: ICON_SWORD, K: ICON_HEAVY, '空格': ICON_DODGE, Space: ICON_DODGE, Enter: '跳过' };
// (2026-11-17 user, on his phone: the tips "全盖住了 · 手机端不能这么干扰" - a phone drops the parenthesised extras;
// the English line stays, small: "受众是中文和英文的读者", and each tip only comes up a few times - main.js TIP_TIMES)
function touchKeys(html) {
  return html.replace(/<kbd>([^<]+)<\/kbd>/g, (m, k) => TOUCH_NAMES[k] ? `<kbd>${TOUCH_NAMES[k]}</kbd>` : m)
    .replace(/（[^（）]*）/g, '').replace(/Enter 跳过/g, '');
}
