import * as THREE from 'three';
import { makeGlowSprite, makeRing, pointsMaterial, makePoints, loadTexture, paperMaterial, shadowPlane } from './common.js';
import { BaseShot } from './s_base.js';
import { clamp, lerp, ease, pulse, rng } from '../core/util.js';
import { line, mono, scrim, node, wrapZh, lineUnits, accentSegs, X0 } from './type.js';
import { project } from '../core/text.js';

const fmt = (v, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// number: one figure that carries the story (count-up), label above, context below, particle burst.
export class NumberShot extends BaseShot {
  constructor(ctx, sh) {
    super(ctx, sh, { dustN: 700, bgY: 0.5 });
    const T = this.T, s = sh, t0 = this.t0, t1 = this.win1;
    const from = s.from ?? 0, to = +s.value, d = s.decimals ?? 0, dur = s.countDur ?? 1.3;
    const val = (t) => lerp(from, to, ease.outCubic(clamp((t - t0 - 0.2) / dur)));
    if (s.label) line(T, s.label, 800, t0 + 0.05, t1, { size: 46, weight: 700, cls: 'sh dim' });
    const txt = (t) => `<span style="font-size:0.5em;vertical-align:0.62em;margin-right:0.06em">${s.prefix || ''}</span>${fmt(val(t), d)}<span style="font-size:0.42em;margin-left:0.12em;font-family:NSC">${s.suffix || ''}</span>`;
    const units = (fmt(to, d).length + (s.prefix || '').length * 0.5) * 0.62 + [...(s.suffix || '')].length * 0.42;
    const size = Math.min(200, Math.floor(900 / Math.max(units, 1)));
    T.add({ text: '', dyn: txt, x: X0, y: 950, size, weight: 900, font: 'en', cls: 'glow num', color: 'var(--ink)', t0: t0 + 0.15, t1, in: { type: 'scale', dur: 0.5 }, out: { type: 'fade', dur: 0.25 } });
    if (s.sub) {
      const lines = wrapZh(s.sub, 16);
      lines.forEach((ln, i) => line(T, ln, 1110 + i * 54, t0 + 0.6 + i * 0.1, t1, { size: 40, weight: 500, cls: 'sh dim' }));
    }
    // burst ring + soft core light
    this.glow = makeGlowSprite(this.th.cAccent, 5.0); this.glow.position.set(0, 0.2, -6); this.scene.add(this.glow);
    const n = 1400, r = rng(sh.idx * 31 + 5), aux = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { aux[i * 3] = r(); aux[i * 3 + 1] = r(); aux[i * 3 + 2] = r(); }
    this.burst = makePoints(new Float32Array(n * 3), pointsMaterial({ color: this.th.cAccent2, size: 1.0, opacity: 1,
      uniforms: { uK: { value: 0 } }, vertexHead: 'uniform float uK; attribute vec3 aAux;',
      vertexBody: `float a = aAux.x * 6.2831; float rad = 0.4 + uK * (1.5 + 2.2 * aAux.y); pos = vec3(cos(a) * rad, sin(a) * rad * 1.0 + 0.2, -6.0 + (aAux.z - 0.5) * 1.5);
        bright = (1.0 - uK) * (0.4 + 0.6 * aAux.z) * step(0.001, uK); psize = uSize * (0.5 + aAux.y);` }), { seed: 5, attrs: { aAux: { array: aux, size: 3 } } });
    this.scene.add(this.burst);
  }
  update(t) {
    const k = clamp((t - this.t0 - 0.2) / 1.6);
    this.burst.material.uniforms.uK.value = ease.outCubic(k); this.burst.material.uniforms.uTime.value = t;
    this.glow.material.opacity = 0.18 + 0.25 * pulse(t, this.t0 + 0.2, 1.5);
    this.camera.position.set(0, 0, lerp(0.3, -0.2, this.u(t))); this.camera.lookAt(0, 0, -6);
    this.tick(t);
  }
}

// chart: a line (or bar) chart drawn on, with value labels on key points.
// Layout in group units, fitted to the portrait frame for the whole camera move (at the chart the frame is only
// 2.4-2.6 units wide): points span x ±CX (outer centres >= 125 px from the frame edge); values map onto CY0..CY1,
// so the x labels end above y 1350 px (the unit line sits below, at 1400) and the top value label stays below
// y 610 px, clear of the caption band.
const CX = 0.88, CY0 = -0.67, CY1 = 0.65;
export class ChartShot extends BaseShot {
  constructor(ctx, sh) {
    super(ctx, sh, { dustN: 600, grid: 0.18, gridY: -1.25 });
    const pts = (sh.points || []).map(Number); this.n = pts.length;
    const lo = sh.min ?? Math.min(0, ...pts), hi = sh.max ?? Math.max(...pts) * 1.08;
    const X = (i) => lerp(-CX, CX, this.n > 1 ? i / (this.n - 1) : 0.5), Y = (v) => lerp(CY0, CY1, (v - lo) / Math.max(1e-9, hi - lo));
    this.P = pts.map((v, i) => new THREE.Vector3(X(i), Y(v), 0));
    const col = this.th.cAccent;
    this.g = new THREE.Group(); this.g.position.set(0, -0.05, -4.6); this.scene.add(this.g);
    if (sh.style === 'bar') {
      this.bars = this.P.map((p, i) => {
        const w = CX * Math.min(0.27, 1.7 / this.n);
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, w * 0.4), new THREE.MeshBasicMaterial({ color: i === (sh.hi ?? this.n - 1) ? this.th.cAccent : this.th.cAccent2, transparent: true, opacity: 0.85 }));
        m.position.set(p.x, CY0, 0); m.userData.h = p.y - CY0; this.g.add(m); return m;
      });
    } else {
      const curve = new THREE.CatmullRomCurve3(this.P.length > 1 ? this.P : [this.P[0], this.P[0].clone().add(new THREE.Vector3(0.01, 0, 0))], false, 'catmullrom', 0.2);
      const geo = new THREE.TubeGeometry(curve, 240, 0.018, 8, false);
      this.lineMat = new THREE.ShaderMaterial({
        uniforms: { uC: { value: col.clone() }, uP: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uC; uniform float uP; varying vec2 vUv; void main(){ if (vUv.x > uP) discard; float tip = exp(-(uP - vUv.x) * 30.0) * 3.0; gl_FragColor = vec4(uC * (1.6 + tip), 1.0); }`,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      });
      this.g.add(new THREE.Mesh(geo, this.lineMat));
      // soft area under the curve
      const shape = new THREE.Shape(); shape.moveTo(this.P[0].x, CY0); this.P.forEach((p) => shape.lineTo(p.x, p.y)); shape.lineTo(this.P[this.P.length - 1].x, CY0);
      this.areaMat = new THREE.ShaderMaterial({ uniforms: { uC: { value: col.clone() }, uP: { value: 0 }, uX0: { value: this.P[0].x }, uX1: { value: this.P[this.P.length - 1].x } },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uC; uniform float uP, uX0, uX1; varying vec3 vP; void main(){ float k = (vP.x - uX0) / max(1e-4, uX1 - uX0); if (k > uP) discard; float a = smoothstep(${CY0.toFixed(2)}, ${CY1.toFixed(2)}, vP.y) * 0.22; gl_FragColor = vec4(uC * a, 1.0); }`,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide });
      this.g.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), this.areaMat));
      this.dots = this.P.map((p, i) => { const s = makeGlowSprite(i === (sh.hi ?? this.n - 1) ? this.th.cWarm : this.th.cAccent, 0.22); s.position.copy(p); this.g.add(s); return s; });
      this.hiRing = makeRing(this.th.cWarm); this.hiRing.position.copy(this.P[sh.hi ?? this.n - 1]); this.hiRing.scale.setScalar(0.5); this.g.add(this.hiRing);
    }
    // labels; a wide label on an outer point slides inward so it stays inside the frame (48 px margin)
    const T = this.T, t0 = this.t0, t1 = this.win1, d = sh.decimals ?? 0;
    const inFrame = (it, v, dy = 0) => { const hw = it.el.offsetWidth / 2; return { x: clamp(v.x, 48 + hw, 1032 - hw), y: v.y + dy }; };
    const show = sh.labelAll || this.n <= 6 ? this.P.map((_, i) => i) : [0, sh.hi ?? this.n - 1];
    show.forEach((i) => {
      const k = this.n > 1 ? i / (this.n - 1) : 1;
      const tv = t0 + 0.3 + k * 1.4;
      const vl = T.add({ text: `${sh.prefix || ''}${fmt(pts[i], d)}${sh.suffix || ''}`, x: 0, y: 0, size: i === (sh.hi ?? this.n - 1) ? 44 : 34, weight: 800, font: 'en', cls: i === (sh.hi ?? this.n - 1) ? 'sh warm num' : 'sh num', t0: tv, t1,
        anchor: () => inFrame(vl, this.worldOf(i, 0.18)), in: { type: 'fade', dur: 0.3 }, out: { type: 'fade', dur: 0.25 } });
      if (sh.labels && sh.labels[i]) { const xl = T.add({ text: sh.labels[i], x: 0, y: 0, size: 30, weight: 600, font: 'zh', cls: 'sh dim', t0: tv, t1,
        anchor: () => inFrame(xl, this.baseOf(i), 34), in: { type: 'fade', dur: 0.3 }, out: { type: 'fade', dur: 0.25 } }); }
    });
    if (sh.unit) line(T, sh.unit, 1400, t0 + 0.2, t1, { size: 32, weight: 500, cls: 'sh dim' });
  }
  worldOf(i, dy = 0) { const v = this.P[i].clone(); v.y += dy; if (this.bars) v.y = CY0 + this.bars[i].scale.y + dy; return project(this.g.localToWorld(v), this.camera); }
  baseOf(i) { const v = new THREE.Vector3(this.P[i].x, CY0, 0); return project(this.g.localToWorld(v), this.camera); }
  update(t) {
    const p = ease.inOutCubic(clamp((t - this.t0 - 0.2) / 1.6));
    if (this.bars) this.bars.forEach((b, i) => { const k = ease.outCubic(clamp((t - this.t0 - 0.2 - i * 0.12) / 0.8)); b.scale.y = Math.max(0.001, b.userData.h * k); b.position.y = CY0 + b.scale.y / 2; });
    else {
      this.lineMat.uniforms.uP.value = p; this.areaMat.uniforms.uP.value = p;
      this.dots.forEach((s, i) => { const k = this.n > 1 ? i / (this.n - 1) : 1; s.material.opacity = clamp((p - k) * 20 + 1); });
      const hi = this.sh.hi ?? this.n - 1, th = this.t0 + 0.2 + 1.6;
      this.hiRing.material.uniforms.uP.value = t < th ? 0 : ((t - th) * 0.7) % 1; this.hiRing.material.uniforms.uI.value = t < th ? 0 : 1;
    }
    const u = this.u(t);
    this.g.rotation.set(-0.08, lerp(-0.18, 0.12, ease.inOutSine(u)), 0);
    this.camera.position.set(0, 0.05, lerp(0.4, -0.1, u)); this.camera.lookAt(0, 0, -4.6);
    this.g.updateMatrixWorld(); this.camera.updateMatrixWorld();
    this.tick(t);
  }
  bloom() { return { strength: 0.9, radius: 0.5, threshold: 0.2 }; }
}

// compare: two glass cards, A vs B.
export class CompareShot extends BaseShot {
  constructor(ctx, sh) {
    super(ctx, sh, { dustN: 700 });
    const T = this.T, t0 = this.t0, t1 = this.win1;
    this.gl = makeGlowSprite(this.th.cAccent, 4); this.gl.position.set(-1.2, 0, -6); this.scene.add(this.gl);
    this.gr = makeGlowSprite(this.th.cAccent2, 4); this.gr.position.set(1.2, 0, -6); this.scene.add(this.gr);
    const mk = (d, x, dx, col, t) => {
      const el = document.createElement('div'); el.className = 'card';
      Object.assign(el.style, { left: x + 'px', top: '760px', width: '440px', height: '420px', padding: '34px 30px', borderColor: col });
      el.innerHTML = `<div class="k">${d.title || ''}</div><div class="v" style="color:${col};margin-top:26px">${d.value || ''}</div><div class="s" style="margin-top:22px">${d.sub || ''}</div>`;
      node(T, el, t, t1, { dx, dy: 0 });
    };
    mk(sh.left || {}, 70, -80, 'var(--accent)', t0 + 0.15);
    mk(sh.right || {}, 570, 80, 'var(--accent2)', t0 + 0.4);
    T.add({ text: sh.vs || 'VS', x: X0, y: 970, size: 44, weight: 900, font: 'en', cls: 'sh warm', t0: t0 + 0.6, t1, in: { type: 'scale', dur: 0.4 }, out: { type: 'fade', dur: 0.25 } });
    if (sh.label) line(T, sh.label, 1300, t0 + 0.8, t1, { size: 40, weight: 600, cls: 'sh dim' });
  }
  update(t) { const u = this.u(t); this.gl.material.opacity = 0.25 + 0.1 * Math.sin(t * 1.3); this.gr.material.opacity = 0.25 + 0.1 * Math.cos(t * 1.1); this.camera.position.set(lerp(-0.1, 0.1, u), 0, 0); this.camera.lookAt(0, 0, -6); this.tick(t); }
}

// points: 2-4 short key points appearing one by one.
export class PointsShot extends BaseShot {
  constructor(ctx, sh) {
    super(ctx, sh, { dustN: 700 });
    const T = this.T, t0 = this.t0, t1 = this.win1, items = (sh.items || []).slice(0, 4);
    const step = items.length > 3 ? 150 : 175, y0 = 1000 - (items.length - 1) * step / 2;
    const span = Math.max(0.6, (this.t1 - t0 - 0.6) / Math.max(1, items.length));
    items.forEach((it, i) => {
      const el = document.createElement('div'); el.className = 'card';
      Object.assign(el.style, { left: '80px', top: (y0 + i * step - 62) + 'px', width: '920px', minHeight: '124px', padding: '22px 30px', display: 'flex', alignItems: 'center', gap: '28px' });
      el.innerHTML = `<div class="pt-num">${String(i + 1).padStart(2, '0')}</div><div class="pt-text">${it}</div>`;
      node(T, el, t0 + 0.2 + i * Math.min(span, 0.9), t1, { dx: -40, dy: 0 });
    });
    this.glow = makeGlowSprite(this.th.cAccent, 5); this.glow.position.set(0, 0, -7); this.scene.add(this.glow);
  }
  update(t) { this.glow.material.opacity = 0.15; this.camera.position.set(0, lerp(0.1, -0.1, this.u(t)), 0); this.camera.lookAt(0, 0, -7); this.tick(t); }
}

// timeline: dated milestones on a vertical rail.
export class TimelineShot extends BaseShot {
  constructor(ctx, sh) {
    super(ctx, sh, { dustN: 700 });
    const T = this.T, t0 = this.t0, t1 = this.win1, items = (sh.items || []).slice(0, 5);
    const top = 740, bottom = 1380, step = items.length > 1 ? (bottom - top) / (items.length - 1) : 0;
    const span = Math.max(0.45, (this.t1 - t0 - 0.8) / Math.max(1, items.length));
    const rail = document.createElement('div');
    Object.assign(rail.style, { position: 'absolute', left: '168px', top: top + 'px', width: '4px', height: (bottom - top) + 'px', background: 'linear-gradient(180deg, var(--accent), var(--accent2))', borderRadius: '2px', transformOrigin: '50% 0' });
    node(T, rail, t0 + 0.05, t1, { dy: 0, update: (t, e) => { e.style.transform = `scaleY(${ease.outCubic(clamp((t - t0 - 0.05) / (span * items.length + 0.3))).toFixed(3)})`; } });
    items.forEach((it, i) => {
      const y = top + i * step, ti = t0 + 0.2 + i * span;
      const dot = document.createElement('div');
      Object.assign(dot.style, { position: 'absolute', left: '156px', top: (y - 14) + 'px', width: '28px', height: '28px', borderRadius: '14px', background: 'var(--accent)', boxShadow: '0 0 22px var(--accent)' });
      node(T, dot, ti, t1, { dy: 0 });
      const el = document.createElement('div');
      Object.assign(el.style, { position: 'absolute', left: '220px', top: (y - 26) + 'px', width: '800px' });
      el.innerHTML = `<div class="tl-date">${it.date || ''}</div><div class="tl-text">${it.text || ''}</div>`;
      node(T, el, ti + 0.05, t1, { dx: 30, dy: 0 });
    });
  }
  update(t) { this.camera.position.set(0, lerp(0.15, -0.15, this.u(t)), 0); this.camera.lookAt(0, 0, -6); this.tick(t); }
}

// headline: a screenshot of a report/post as a card in space, a marker sweep over the key line.
export class HeadlineShot extends BaseShot {
  constructor(ctx, sh) { super(ctx, sh, { dustN: 700, grid: 0.12 }); }
  async init() {
    const tex = await loadTexture(`./${this.ctx.run}/${this.sh.media}`, { srgb: true });
    const w = this.sh.width ?? 3.2, h = w * tex.image.height / tex.image.width;
    this.card = new THREE.Group();
    const sh = shadowPlane(w, h, 0.7); sh.position.set(0.1, -0.12, -0.05); this.card.add(sh);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paperMaterial(tex, { gain: 0.72 }));
    if (this.sh.hi) m.material.uniforms.uHi.value.set(...this.sh.hi);
    this.mat = m.material; this.card.add(m); this.scene.add(this.card);
    this.cw = w; this.ch = h;
    if (this.sh.label) { scrim(this.T, this.t0, this.win1, 1260, 1440, 0.45); line(this.T, this.sh.label, 1350, this.t0 + 0.3, this.t1, { size: 38, weight: 600, cls: 'sh chip' }); }
  }
  update(t) {
    const u = this.u(t), a = ease.outExpo(clamp((t - this.t0 + 0.1) / 0.8));
    // focus: centre of the highlight box if given, else the card centre
    const hi = this.sh.hi, fx = hi ? (hi[0] + hi[2]) / 2 : 0.5, fy = hi ? (hi[1] + hi[3]) / 2 : 0.5;
    const z = this.sh.zoom ?? (hi ? -4.2 : -6.0);
    // the focus sits a little below mid-frame so the report never runs under the subtitle band
    this.card.position.set(-(fx - 0.5) * this.cw + lerp(0.12, -0.12, u), (fy - 0.5) * this.ch - 0.42 + lerp(-1.5, 0, a), lerp(z - 1.0, z, a) + lerp(0, 0.25, u));
    this.card.rotation.set(lerp(0.4, -0.05, a), lerp(-0.3, 0.06, a) + lerp(0, -0.05, u), 0.01);
    this.mat.uniforms.uOpacity.value = clamp((t - this.t0 + 0.1) / 0.2);
    this.mat.uniforms.uHiP.value = ease.inOutCubic(clamp((t - this.t0 - 0.6) / 0.7));
    this.camera.position.set(0, 0, 0); this.camera.lookAt(0, 0, -1);
    this.tick(t);
  }
  bloom() { return { strength: 0.45, radius: 0.45, threshold: 0.95 }; }
}
