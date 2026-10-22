import * as THREE from 'three';
import { makeGlowSprite, makeStreak } from './common.js';
import { BaseShot, addPlate, kenBurns } from './s_base.js';
import { clamp, lerp, ease, pulse } from '../core/util.js';
import { big, line, mono, scrim, wrapZh, lineUnits, accentSegs, X0 } from './type.js';

// hook: the cover title over a plate. Two lines (Muse title), line 2 in the accent colour.
export class HookShot extends BaseShot {
  constructor(ctx, sh) { super(ctx, sh, { dust: true, dustN: 600 }); }
  async init() {
    this.plate = await addPlate(this, this.sh.plate || 'hero');
    const T = this.T, sp = this.ctx.spec, t0 = this.t0, t1 = this.win1;
    const lines = this.sh.lines || sp.title || [];
    scrim(T, t0, t1, 220, 900, 0.5, 0.2, 0.3);
    const tag = [sp.date ? sp.date.replace(/-/g, '.') : '', (sp.tag || '').replace(/大佬|钱|反差/g, '').trim()].filter(Boolean).join('  ·  ');
    if (tag) mono(T, tag, 300, t0 + 0.1, t1, { size: 30, color: 'var(--accent2)', ls: 0.12 });
    let y = 470;
    lines.forEach((ln, i) => {
      const size = Math.min(i === 0 ? 170 : 160, Math.floor(980 / Math.max(1, lineUnits(ln))));
      T.add({ segs: accentSegs(ln, sp.accent, 'acc'), x: X0, y, size, weight: 900, font: 'zh', cls: i === 1 ? 'sh glow acc' : 'sh',
        t0: t0 + 0.15 + i * 0.35, t1, ls: 0.03, in: { type: 'slam', dur: 0.55, ease: ease.outExpo, from: 1.35 }, out: { type: 'fade', dur: 0.25 } });
      y += size * 1.2;
    });
    this.sweep = makeStreak(this.th.cAccent2); this.sweep.scale.set(18, 1.2, 1); this.sweep.position.set(0, 0, -9.9); this.sweep.material.depthTest = false; this.scene.add(this.sweep);
  }
  update(t) {
    kenBurns(this.plate, t, this.u(t), this.sh.kb || 'in');
    this.plate.material.uniforms.uExposure.value = 0.92 + 0.12 * pulse(t, this.t0 + 0.15, 4);
    const k = clamp((t - this.t0 - 0.1) / 1.2);
    this.sweep.position.y = lerp(4, -3, ease.inOutSine(k));
    this.sweep.material.uniforms.uI.value = Math.sin(Math.PI * k) * 0.35;
    this.tick(t);
  }
  bloom() { return { strength: 0.7, radius: 0.55, threshold: 0.6 }; }
}

// plate: a Ken Burns move over a codex still, optional label chip at the bottom.
export class PlateShot extends BaseShot {
  constructor(ctx, sh) { super(ctx, sh, { dustN: 700 }); }
  async init() {
    this.plate = await addPlate(this, this.sh.plate);
    if (this.sh.label) {
      scrim(this.T, this.t0, this.win1, 1260, 1440, 0.45);
      line(this.T, this.sh.label, 1350, this.t0 + 0.4, this.t1, { size: 40, weight: 600, cls: 'sh chip' });
    }
  }
  update(t) {
    kenBurns(this.plate, t, this.u(t), this.sh.kb || ['in', 'left', 'out', 'right', 'up'][this.sh.idx % 5]);
    this.plate.material.uniforms.uExposure.value = this.sh.exposure ?? 0.95;
    this.tick(t);
  }
  bloom() { return { strength: 0.6, radius: 0.5, threshold: 0.62 }; }
}

// quote: a person's words, large, with attribution; plate behind (dimmed) or plain backdrop.
export class QuoteShot extends BaseShot {
  constructor(ctx, sh) { super(ctx, sh, { dustN: 800 }); }
  async init() {
    if (this.sh.plate) this.plate = await addPlate(this, this.sh.plate);
    const T = this.T, t0 = this.t0, t1 = this.win1;
    const lines = wrapZh(this.sh.text || '', this.sh.maxU ?? 11);
    const size = Math.min(64, Math.floor(900 / Math.max(...lines.map(lineUnits), 1)));
    const lh = size * 1.45, y0 = 960 - (lines.length - 1) * lh / 2;
    scrim(T, t0, t1, y0 - 220, y0 + lines.length * lh + 160, 0.55);
    T.add({ text: '“', x: 150, y: y0 - 110, size: 220, weight: 900, font: 'en', cls: 'acc', t0: t0 + 0.1, t1, opacity: 0.55, in: { type: 'fade', dur: 0.4 }, out: { type: 'fade', dur: 0.25 } });
    lines.forEach((ln, i) => T.add({ segs: accentSegs(ln, this.ctx.spec.accent), x: X0, y: y0 + i * lh, size, weight: 700, font: 'zh', cls: 'sh', t0: t0 + 0.25 + i * 0.18, t1, ls: 0.02,
      in: { type: 'rise', dur: 0.55, stagger: 0.02, dist: 18, blur: 8 }, out: { type: 'fade', dur: 0.25 } }));
    const who = [this.sh.who, this.sh.role].filter(Boolean).join('  ');
    if (who) line(T, '—— ' + who, y0 + lines.length * lh + 50, t0 + 0.7, t1, { size: 36, weight: 500, cls: 'sh dim', x: 980, ax: 1 });
  }
  update(t) {
    if (this.plate) { kenBurns(this.plate, t, this.u(t), 'in', 0.6); this.plate.material.uniforms.uExposure.value = 0.42; this.plate.material.uniforms.uSat.value = 0.7; }
    this.tick(t);
  }
}
