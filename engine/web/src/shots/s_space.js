import * as THREE from 'three';
import { makeGlowSprite, makeRing, makeStreak, pointsMaterial, makePoints } from './common.js';
import { landMask, globeDots, latLonToVec } from '../geo/globe.js';
import { BaseShot } from './s_base.js';
import { clamp, lerp, ease, pulse, rng } from '../core/util.js';
import { line, mono, scrim, wrapZh, lineUnits, accentSegs, X0 } from './type.js';
import { project } from '../core/text.js';

const R = 1.3;
let _dots = null;
const dots = () => (_dots ??= landMask().then((m) => globeDots(m, 60000)));

function tubeMat(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: color.clone() }, uP: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uC; uniform float uP; varying vec2 vUv; void main(){ if (vUv.x > uP) discard; float tip = exp(-(uP - vUv.x) * 40.0) * 3.0; gl_FragColor = vec4(uC * (1.3 + tip), 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
}

// globe: where it happens. points [{lat, lon, label}], optional from [lat, lon] for arcs.
export class GlobeShot extends BaseShot {
  constructor(ctx, sh) { super(ctx, sh, { fov: 42, dustN: 900 }); this.globe = new THREE.Group(); this.scene.add(this.globe); }
  async init() {
    const d = await dots();
    const sc = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * R; return o; };
    const facing = `vec3 wp = (modelMatrix * vec4(pos, 1.0)).xyz; float f = smoothstep(-0.2, 0.5, dot(normalize(wp - vec3(0.0, -0.1, 0.0)), vec3(0.0, 0.0, 1.0)));`;
    this.land = makePoints(sc(d.land), pointsMaterial({ color: this.th.cAccent2, size: 0.6, opacity: 1, vertexBody: `${facing} bright = (0.45 + 0.4 * aRand) * f;` }), { seed: 3 });
    this.ocean = makePoints(sc(d.ocean), pointsMaterial({ color: this.th.cAccent, size: 0.4, opacity: 0.35, vertexBody: `${facing} bright = f * 0.6;` }), { seed: 4 });
    this.globe.add(this.land, this.ocean);
    const pts = this.sh.points || [];
    const from = this.sh.from;
    this.targets = pts.map((p) => latLonToVec(p.lat, p.lon, R * 1.01));
    this.pings = this.targets.map((v, i) => {
      const s = makeGlowSprite(i === 0 ? this.th.cWarm : this.th.cAccent, 0.4); s.position.copy(v); this.globe.add(s);
      const r = makeRing(i === 0 ? this.th.cWarm : this.th.cAccent); r.position.copy(v); r.lookAt(v.clone().multiplyScalar(2)); r.scale.setScalar(0.7); this.globe.add(r);
      return { s, r };
    });
    this.arcs = [];
    if (from) {
      const va = latLonToVec(from[0], from[1], 1);
      pts.forEach((p) => {
        const vb = latLonToVec(p.lat, p.lon, 1), ang = va.angleTo(vb), P = [];
        for (let k = 0; k <= 120; k++) { const f = k / 120; const v = va.clone().multiplyScalar(Math.sin((1 - f) * ang)).addScaledVector(vb, Math.sin(f * ang)).divideScalar(Math.sin(ang) || 1).normalize(); P.push(v.multiplyScalar(R * (1 + 0.25 * Math.sin(Math.PI * f)))); }
        const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P), 160, 0.008, 6, false), tubeMat(this.th.cAccent)); this.globe.add(m); this.arcs.push(m);
      });
    }
    // orientation: face the first point (or the mean of all)
    const c = pts.length ? pts.reduce((a, p) => [a[0] + p.lat / pts.length, a[1] + p.lon / pts.length], [0, 0]) : [20, 110];
    const f0 = this.sh.face || (pts.length === 1 ? [pts[0].lat, pts[0].lon] : c);
    this.face = f0; this.startLon = f0[1] - 50;
    pts.forEach((p, i) => { if (p.label) this.T.add({ text: p.label, x: 0, y: 0, size: 32, weight: 700, font: 'zh', cls: 'sh chip', t0: this.t0 + 0.8 + i * 0.25, t1: this.win1,
      anchor: () => { const v = this.pings[i].s.getWorldPosition(new THREE.Vector3()); const q = project(v, this.camera); return { x: q.x, y: q.y - 58 }; }, in: { type: 'fade', dur: 0.3 }, out: { type: 'fade', dur: 0.25 } }); });
  }
  update(t) {
    const u = this.u(t), k = ease.inOutCubic(clamp((t - this.t0) / 1.4));
    const lat = this.face[0] * 0.7, lon = lerp(this.startLon, this.face[1], k) + (t - this.t0) * 2;
    this.globe.rotation.set(THREE.MathUtils.degToRad(lat), THREE.MathUtils.degToRad(-lon), 0, 'XYZ');
    this.globe.position.set(0, -0.1, 0);
    this.camera.position.set(0, -0.05, lerp(7.2, 6.3, ease.outCubic(u))); this.camera.lookAt(0, -0.1, 0);
    this.arcs.forEach((m, i) => { m.material.uniforms.uP.value = ease.inOutCubic(clamp((t - this.t0 - 0.4 - i * 0.15) / 1.0)); });
    this.pings.forEach(({ s, r }, i) => { const on = this.t0 + 0.7 + i * 0.25; s.material.opacity = clamp((t - on) / 0.15); r.material.uniforms.uP.value = t < on ? 0 : ((t - on) * 0.8) % 1; r.material.uniforms.uI.value = t < on ? 0 : 1; });
    this.land.material.uniforms.uTime.value = t; this.ocean.material.uniforms.uTime.value = t;
    this.globe.updateMatrixWorld(); this.camera.updateMatrixWorld();
    this.tick(t);
  }
  bloom() { return { strength: 0.9, radius: 0.5, threshold: 0.15 }; }
}

// ai: a calm particle mind with two orbit rings (for model / AI-behaviour beats).
export class AIShot extends BaseShot {
  constructor(ctx, sh) {
    super(ctx, sh, { dustN: 900 });
    const n = 22000, r = rng(sh.idx * 17 + 3), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = r() * 2 - 1, a = r() * Math.PI * 2, rad = Math.cbrt(r()), s = Math.sqrt(1 - u * u); pos[i * 3] = s * Math.cos(a) * rad; pos[i * 3 + 1] = u * rad; pos[i * 3 + 2] = s * Math.sin(a) * rad; }
    this.core = makePoints(pos, pointsMaterial({ color: this.th.cAccent2, size: 0.7, opacity: 1,
      vertexBody: `vec3 p = pos; p += curl(p * 1.2 + vec3(0.0, uTime * 0.18, 0.0)) * 0.1; float rr = length(p); pos = p * 1.05;
        bright = (0.22 + 0.9 * smoothstep(0.5, 1.0, rr)) * (0.4 + 0.6 * aRand); col = mix(uColor, vec3(1.0), smoothstep(0.9, 1.0, rr) * 0.3); psize = uSize * (0.6 + aRand);` }), { seed: 9 });
    this.g = new THREE.Group(); this.g.position.set(0, 0, -5); this.g.add(this.core); this.scene.add(this.g);
    this.rings = [0, 1].map((i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(1.5 + i * 0.25, 0.006, 8, 200), new THREE.MeshBasicMaterial({ color: i ? this.th.cAccent : this.th.cWarm, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); this.g.add(m); return m; });
    this.glow = makeGlowSprite(this.th.cAccent, 3.5); this.g.add(this.glow);
    if (sh.label) line(this.T, sh.label, 1330, this.t0 + 0.4, this.win1, { size: 40, weight: 600, cls: 'sh chip' });
  }
  update(t) {
    this.core.material.uniforms.uTime.value = t;
    this.g.rotation.set(0.25, t * 0.15, 0);
    this.rings[0].rotation.set(1.2 + 0.1 * Math.sin(t * 0.5), 0.3, t * 0.2); this.rings[1].rotation.set(0.5, -0.8 + 0.1 * Math.cos(t * 0.4), -t * 0.15);
    this.glow.material.opacity = 0.18 + 0.06 * Math.sin(t * 1.7);
    this.camera.position.set(0, 0, lerp(0.4, -0.3, this.u(t))); this.camera.lookAt(0, 0, -5);
    this.tick(t);
  }
  bloom() { return { strength: 0.9, radius: 0.55, threshold: 0.15 }; }
}

// outro: the closing line(s), a quiet light.
export class OutroShot extends BaseShot {
  constructor(ctx, sh) {
    super(ctx, sh, { dustN: 1000 });
    this.light = makeGlowSprite(this.th.cAccent2, 2.6); this.light.position.set(0, 0, -5); this.scene.add(this.light);
    this.streak = makeStreak(this.th.cAccent2); this.streak.scale.set(8, 0.9, 1); this.streak.position.set(0, 0, -5.05); this.scene.add(this.streak);
    const T = this.T, t0 = this.t0, t1 = this.win1, lines = sh.lines || [];
    let y = 960 - (lines.length - 1) * 70;
    lines.forEach((ln, i) => {
      const size = Math.min(110, Math.floor(940 / Math.max(1, lineUnits(ln))));
      T.add({ segs: accentSegs(ln, ctx.spec.accent), x: X0, y, size, weight: 900, font: 'zh', cls: 'sh glow', t0: t0 + 0.2 + i * 0.35, t1: t1 + 5, ls: 0.03,
        in: { type: 'rise', dur: 0.7, stagger: 0.04, dist: 24, blur: 14 }, out: { type: 'none', dur: 0 } });
      y += size * 1.3;
    });
  }
  update(t) {
    const on = ease.outCubic(clamp((t - this.t0) / 1.2));
    this.light.material.opacity = on * (0.35 + 0.05 * Math.sin(t * 2));
    this.streak.material.uniforms.uI.value = on * 0.5;
    this.camera.position.set(0, 0, lerp(0.2, -0.2, this.u(t))); this.camera.lookAt(0, 0, -5);
    this.tick(t);
  }
}
