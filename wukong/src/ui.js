// DOM HUD: player bars, boss bar (with chip damage + damage counter), lock-on reticle, title cards, subtitles.
import * as THREE from 'three';

const $ = sel => document.querySelector(sel);
const _v = new THREE.Vector3();

export class UI {
  constructor() {
    this.hud = $('#hud');
    this.hp = $('#hp .fill'); this.hpChip = $('#hp .chip');
    this.st = $('#st .fill');
    this.flask = $('#flask .n');
    this.bossWrap = $('#boss');
    this.bossFill = $('#boss .fill'); this.bossChip = $('#boss .chip'); this.bossDmg = $('#boss .dmg');
    this.reticle = $('#reticle');
    this.card = $('#card');
    this.sub = $('#subtitle');
    this.hint = $('#hint');
    this.vals = { hp: 1, hpChip: 1, boss: 1, bossChip: 1 };
    this.dmgSum = 0; this.dmgTimer = 0;
    this.cardTimer = 0;
  }

  showHUD(v) { this.hud.classList.toggle('on', v); }
  showBoss(v) { this.bossWrap.classList.toggle('on', v); }

  setPlayer(hp, hpMax, st, stMax, flasks) {
    const f = Math.max(0, hp / hpMax);
    if (f < this.vals.hp) this.vals.hpChipHold = 0.6;
    this.vals.hp = f;
    this.hp.style.width = (f * 100) + '%';
    this.st.style.width = (Math.max(0, st / stMax) * 100) + '%';
    this.flask.textContent = flasks;
  }

  setBoss(hp, hpMax) {
    const f = Math.max(0, hp / hpMax);
    if (f < this.vals.boss) this.vals.bossChipHold = 0.7;
    this.vals.boss = f;
    this.bossFill.style.width = (f * 100) + '%';
  }

  addBossDamage(n) {
    this.dmgSum += n; this.dmgTimer = 2.2;
    this.bossDmg.textContent = Math.round(this.dmgSum);
    this.bossDmg.classList.add('on');
  }

  /** Big centered card: kind = 'area' | 'death' | 'victory' | 'name'. */
  card_(text, kind = 'area', dur = 4, sub = '') {
    this.card.className = 'card ' + kind;
    this.card.innerHTML = `<div class="t">${text}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
    void this.card.offsetWidth;
    this.card.classList.add('on');
    this.cardTimer = dur;
  }

  subtitle(text, dur = 3.5) {
    this.sub.textContent = text;
    this.sub.classList.add('on');
    this.subTimer = dur;
  }

  setHint(text) { this.hint.textContent = text || ''; this.hint.classList.toggle('on', !!text); }

  /** Position the lock-on reticle at a world point (or hide it with null). */
  setReticle(world, camera, renderer) {
    if (!world) { this.reticle.classList.remove('on'); return; }
    _v.copy(world).project(camera);
    if (_v.z > 1) { this.reticle.classList.remove('on'); return; }
    const r = renderer.domElement.getBoundingClientRect();
    this.reticle.style.transform = `translate(${(_v.x * 0.5 + 0.5) * r.width}px, ${(-_v.y * 0.5 + 0.5) * r.height}px)`;
    this.reticle.classList.add('on');
  }

  update(dt) {
    const v = this.vals;
    // chip bars wait, then drain
    v.hpChipHold = (v.hpChipHold || 0) - dt;
    if (v.hpChipHold <= 0) v.hpChip += (v.hp - v.hpChip) * (1 - Math.exp(-4 * dt));
    if (v.hp > v.hpChip) v.hpChip = v.hp;
    this.hpChip.style.width = (v.hpChip * 100) + '%';
    v.bossChipHold = (v.bossChipHold || 0) - dt;
    if (v.bossChipHold <= 0) v.bossChip += (v.boss - v.bossChip) * (1 - Math.exp(-3 * dt));
    if (v.boss > v.bossChip) v.bossChip = v.boss;
    this.bossChip.style.width = (v.bossChip * 100) + '%';
    if (this.dmgTimer > 0) {
      this.dmgTimer -= dt;
      if (this.dmgTimer <= 0) { this.bossDmg.classList.remove('on'); this.dmgSum = 0; }
    }
    if (this.cardTimer > 0) {
      this.cardTimer -= dt;
      if (this.cardTimer <= 0) this.card.classList.remove('on');
    }
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.sub.classList.remove('on');
    }
  }
}
