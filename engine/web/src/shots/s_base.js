import * as THREE from 'three';
import { Shot, makeBackdrop, makeDust, makeGrid, loadTexture, makePlate } from './common.js';
import { clamp, lerp, ease } from '../core/util.js';
import { TL } from '../core/tl.js';

// Every shot lives in its timeline window (win0..win1 includes the transitions on both sides).
export class BaseShot extends Shot {
  constructor(ctx, sh, o = {}) {
    super(sh.id, sh.win0, sh.win1);
    this.ctx = ctx; this.sh = sh; this.th = ctx.theme; this.T = ctx.text;
    this.t0 = sh.t0; this.t1 = sh.t1;           // the shot's own (non-overlapping) span
    this.win0 = sh.win0; this.win1 = sh.win1;   // render window incl. transitions (DOM items end here)
    this.camera.fov = o.fov ?? 50; this.camera.updateProjectionMatrix();
    if (o.backdrop !== false) this.scene.add(makeBackdrop({ inner: this.th.bgIn, outer: this.th.bgOut, center: [0.5, o.bgY ?? 0.52], radius: o.bgR ?? 0.7 }));
    if (o.dust !== false) {
      this.dust = makeDust({ count: o.dustN ?? 900, box: [8, 13, 8], center: [0, 0, -4], size: 0.5, color: this.th.cAccent2, opacity: 0.18, seed: (sh.id.length * 13 + sh.seg * 7) | 0 });
      this.scene.add(this.dust);
    }
    if (o.grid) {
      const g = makeGrid({ size: 60, color: this.th.cAccent, cell: 0.5, major: 4, opacity: o.grid, fade: 6, y: o.gridY ?? -1.6 });
      this.scene.add(g);
    }
  }
  u(t) { return clamp((t - this.t0) / Math.max(0.01, this.t1 - this.t0)); }
  tick(t) { if (this.dust) this.dust.material.uniforms.uTime.value = t; }
  bloom() { return { strength: 0.8, radius: 0.55, threshold: 0.35 }; }
  grade() { return { exposure: 1.0, vignette: 0.5, grain: 0.03, ca: 0.001 }; }
  // local seed in 0..1 from the shot id (varies camera moves between shots/videos)
  seed(k = 1) { const s = Math.sin((this.sh.idx + 1) * 12.9898 * k + (this.ctx.spec.seed ?? 7) * 78.233) * 43758.5453; return s - Math.floor(s); }
}

// Ken Burns plate background (codex still, ESRGAN x4 -> 2x).
export async function addPlate(shot, key, o = {}) {
  const url = `./${shot.ctx.run}/plates/${key}.png`;
  const tex = await loadTexture(url);
  const p = makePlate(tex, shot.camera, { dist: 10, over: o.over ?? 1.18 });
  shot.scene.add(p);
  return p;
}

// Ken Burns move by direction name
export function kenBurns(plate, t, u, dir = 'in', amt = 1) {
  const e = ease.inOutSine(u);
  let s = 1.0, x = 0, y = 0;
  switch (dir) {
    case 'out': s = lerp(1.12, 1.0, e); break;
    case 'left': s = 1.08; x = lerp(0.35, -0.35, e); break;
    case 'right': s = 1.08; x = lerp(-0.35, 0.35, e); break;
    case 'up': s = 1.08; y = lerp(-0.5, 0.5, e); break;
    case 'down': s = 1.08; y = lerp(0.5, -0.5, e); break;
    default: s = lerp(1.0, 1.12, e);
  }
  plate.scale.setScalar(1 + (s - 1) * amt);
  plate.position.x = x * amt; plate.position.y = y * amt;
  plate.material.uniforms.uTime.value = t;
}

export { TL };
