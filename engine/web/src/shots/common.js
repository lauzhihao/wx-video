import * as THREE from 'three';
import { GLSL_NOISE, rng } from '../core/util.js';

// Palette (sRGB hex; THREE.Color converts to linear working space).
// Render-resolution dependent constants (set by main.js before shots are built).
export const RENDER = { pxScale: 960, ss: 1 };
export const ASPECT = 1080 / 1920;

export const C = {
  blue: new THREE.Color('#086BFF'),
  cyan: new THREE.Color('#00A8FF'),
  ice: new THREE.Color('#9fd4ff'),
  white: new THREE.Color('#eaf4ff'),
  purple: new THREE.Color('#4D1FFF'),
  violet: new THREE.Color('#6a4dff'),
  navy: new THREE.Color('#020C1C'),
  deep: new THREE.Color('#07152A'),
  red: new THREE.Color('#ff2e46'),
  blood: new THREE.Color('#b3001f'),
  holo: new THREE.Color('#1f8fff'),
  amber: new THREE.Color('#ffb547'),
  grey: new THREE.Color('#6d7c93'),
};

export class Shot {
  constructor(id, start, end) {
    this.id = id; this.start = start; this.end = end;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, ASPECT, 0.05, 400);
    this.clearColor = 0x000000;
  }
  mb() { return 1; }
  bloom() { return { strength: 1.0, radius: 0.6, threshold: 0.15 }; }
  grade() { return {}; }
  update() {}
}

// ---------- background gradient (screen-space quad, drawn first) ----------
export function makeBackdrop({ inner = '#0a1f44', outer = '#000000', center = [0.5, 0.5], radius = 0.9, intensity = 1 } = {}) {
  // radius is measured in screen heights (portrait frame)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: new THREE.Color(inner) }, uOuter: { value: new THREE.Color(outer) },
      uCenter: { value: new THREE.Vector2(...center) }, uRadius: { value: radius }, uIntensity: { value: intensity },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: `uniform vec3 uInner, uOuter; uniform vec2 uCenter; uniform float uRadius, uIntensity; varying vec2 vUv;
      void main(){ vec2 d = (vUv - uCenter) * vec2(0.5625, 1.0); float r = length(d) / uRadius;
        vec3 c = mix(uInner, uOuter, smoothstep(0.0, 1.0, r)); gl_FragColor = vec4(c * uIntensity, 1.0); }`,
    depthWrite: false, depthTest: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false; m.renderOrder = -1000;
  return m;
}

// ---------- soft glow sprite texture ----------
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.08, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.28)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.LinearSRGBColorSpace;
  return _glowTex;
}

export function makeGlowSprite(color = C.cyan, scale = 1) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(m); s.scale.setScalar(scale);
  return s;
}

// Anamorphic streak (horizontal lens flare)
export function makeStreak(color = C.ice) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uI: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying vec2 vUv;
      void main(){ vec2 d = vUv - 0.5; float h = exp(-abs(d.y) * 60.0) * (1.0 - smoothstep(0.0, 0.5, abs(d.x)));
        float core = exp(-abs(d.y) * 220.0) * exp(-abs(d.x) * 6.0);
        gl_FragColor = vec4(uColor * (h * 0.8 + core * 3.0) * uI, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = 50;
  return m;
}

// ---------- soft points ----------
// Generic additive point material. Vertex chunk may modify `pos`, `bright`, `psize`, `col`.
export function pointsMaterial({ color = C.cyan, size = 3.0, opacity = 1, vertexHead = '', vertexBody = '', uniforms = {}, fragmentBody = '', depthTest = true } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uTime: { value: 0 }, uColor: { value: color.clone() }, uSize: { value: size }, uOpacity: { value: opacity },
      uPxScale: { value: RENDER.pxScale },
    }, uniforms),
    vertexShader: /* glsl */ `
      uniform float uTime, uSize, uOpacity, uPxScale; uniform vec3 uColor;
      attribute float aRand;
      varying vec3 vCol; varying float vA;
      ${GLSL_NOISE}
      ${vertexHead}
      void main(){
        vec3 pos = position; float bright = 1.0; float psize = uSize; vec3 col = uColor;
        ${vertexBody}
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = psize * uPxScale * projectionMatrix[1][1] / max(0.05, -mv.z) * 0.01;
        gl_PointSize = clamp(px, 1.0, 160.0);
        // keep energy when clamped small: fade instead of shrinking below 1px
        float cover = clamp(px, 0.0, 1.0);
        vCol = col * bright; vA = uOpacity * cover;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA;
      void main(){
        vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
        float a = smoothstep(1.0, 0.0, r); a *= a;
        ${fragmentBody}
        gl_FragColor = vec4(vCol * a * vA, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest, transparent: true,
  });
}

export function makePoints(positions, material, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const n = positions.length / 3;
  const r = rng(extra.seed ?? 11);
  const rand = new Float32Array(n);
  for (let i = 0; i < n; i++) rand[i] = r();
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  for (const [k, v] of Object.entries(extra.attrs || {})) g.setAttribute(k, new THREE.BufferAttribute(v.array, v.size));
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  return p;
}

// Ambient dust drifting in a box.
export function makeDust({ count = 3000, box = [30, 18, 30], center = [0, 0, 0], size = 1.2, color = C.ice, opacity = 0.35, seed = 5, speed = 0.05 } = {}) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center[0] + (r() - 0.5) * box[0];
    pos[i * 3 + 1] = center[1] + (r() - 0.5) * box[1];
    pos[i * 3 + 2] = center[2] + (r() - 0.5) * box[2];
  }
  const mat = pointsMaterial({
    color, size, opacity,
    uniforms: { uSpeed: { value: speed } },
    vertexHead: 'uniform float uSpeed;',
    vertexBody: `
      float ph = aRand * 6.2831;
      pos += vec3(sin(uTime * 0.21 * (0.5 + aRand) + ph), cos(uTime * 0.17 * (0.5 + aRand) + ph * 1.3), sin(uTime * 0.13 + ph * 2.1)) * uSpeed * 6.0;
      bright = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.6 + aRand * 1.7) + ph * 7.0), 3.0);
      psize = uSize * (0.5 + aRand);`,
  });
  return makePoints(pos, mat, { seed: seed + 1 });
}

// ---------- lines with per-vertex order (draw-on) and brightness ----------
export function drawLineMaterial({ color = C.cyan, opacity = 1, uniforms = {}, vertexHead = '', vertexBody = '' } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uTime: { value: 0 }, uColor: { value: color.clone() }, uOpacity: { value: opacity },
      uProgress: { value: 1 }, uTip: { value: 3.0 }, uReveal: { value: 1e5 },
    }, uniforms),
    vertexShader: /* glsl */ `
      uniform float uTime, uProgress; uniform vec3 uColor;
      attribute float aOrder;
      varying float vOrder; varying vec3 vCol; varying float vB; varying float vY;
      ${vertexHead}
      void main(){
        vec3 pos = position; float bright = 1.0; vec3 col = uColor;
        ${vertexBody}
        vOrder = aOrder; vCol = col; vB = bright;
        vec4 wp = modelMatrix * vec4(pos, 1.0); vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uProgress, uOpacity, uTip, uReveal;
      varying float vOrder; varying vec3 vCol; varying float vB; varying float vY;
      void main(){
        if (vOrder > uProgress) discard;
        if (vY > uReveal) discard;
        float tip = exp(-(uProgress - vOrder) * 60.0) * uTip;
        float edge = exp(-abs(vY - uReveal) * 25.0) * 2.0 * step(uReveal, 1e4);
        gl_FragColor = vec4(vCol * (vB + tip + edge) * uOpacity, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
}

// ---------- hologram surfaces ----------
export function holoMaterial({ color = C.holo, rim = 2.2, base = 0.05, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uColor: { value: color.clone() }, uRim: { value: rim }, uBase: { value: base },
      uOpacity: { value: opacity }, uReveal: { value: 1e5 }, uScan: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uRim, uBase, uOpacity, uReveal, uScan; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vW;
      void main(){
        if (vW.y > uReveal) discard;
        vec3 V = normalize(cameraPosition - vW);
        float f = clamp(1.0 - abs(dot(normalize(vN), V)), 0.0, 1.0);
        float fres = pow(f, uRim);
        float scan = 0.82 + 0.18 * sin(vW.y * 90.0 - uTime * 3.0);
        float band = exp(-abs(fract(vW.y * 0.9 - uTime * 0.35) - 0.5) * 18.0) * 0.35 * uScan;
        float edge = uReveal < 1e4 ? exp(-abs(vW.y - uReveal) * 30.0) * 3.0 : 0.0;
        vec3 c = uColor * ((uBase + fres * 1.25) * scan + band + edge);
        gl_FragColor = vec4(c * uOpacity, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
  });
}

export function edgeMaterial({ color = C.ice, opacity = 0.9 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uOpacity: { value: opacity }, uReveal: { value: 1e5 }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uReveal; varying vec3 vW;
      void main(){ if (vW.y > uReveal) discard; float edge = uReveal < 1e4 ? exp(-abs(vW.y - uReveal) * 30.0) * 4.0 : 0.0;
        gl_FragColor = vec4(uColor * (1.0 + edge) * uOpacity, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
}

// ---------- infinite-ish ground grid ----------
export function makeGrid({ size = 200, color = C.blue, cell = 1.0, major = 5, opacity = 0.6, fade = 30, y = 0, wall = false } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() }, uCell: { value: cell }, uMajor: { value: major }, uOpacity: { value: opacity },
      uFade: { value: fade }, uTime: { value: 0 }, uScroll: { value: new THREE.Vector2(0, 0) }, uCenter: { value: new THREE.Vector3() },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uCell, uMajor, uOpacity, uFade; uniform vec2 uScroll; uniform vec3 uCenter; varying vec3 vW;
      float gridLine(vec2 p, float s){ vec2 g = abs(fract(p / s - 0.5) - 0.5) / max(fwidth(p / s), vec2(1e-4)); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main(){
        vec2 p = (WALL ? vW.xy : vW.xz) + uScroll;
        float minor = gridLine(p, uCell) * 0.35;
        float maj = gridLine(p, uCell * uMajor);
        float d = WALL ? length(vW.xy - uCenter.xy) : length(vW.xz - uCenter.xz);
        float f = exp(-d * d / (uFade * uFade));
        gl_FragColor = vec4(uColor * max(minor, maj) * f * uOpacity, 1.0);
      }`,
    defines: { WALL: wall ? 'true' : 'false' },
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  if (!wall) { m.rotation.x = -Math.PI / 2; m.position.y = y; }
  return m;
}

// ---------- canvas texture card ----------
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Unlit textured plane that is additive (for glass cards / labels in 3D)
export function cardMaterial(tex, opacity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: tex }, uOpacity: { value: opacity }, uGain: { value: 1.0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tMap; uniform float uOpacity, uGain; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tMap, vUv); gl_FragColor = vec4(c.rgb * c.a * uOpacity * uGain, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
  });
}

export function setUniform(obj, name, value) {
  obj.traverse((o) => {
    const m = o.material;
    if (!m) return;
    const arr = Array.isArray(m) ? m : [m];
    for (const mm of arr) if (mm.uniforms && mm.uniforms[name]) {
      const u = mm.uniforms[name];
      if (u.value && u.value.isColor && value && value.isColor) u.value.copy(value);
      else u.value = value;
    }
  });
}

// Camera shake from a list of impacts [{t, k}] — deterministic
export function shake(t, hits, amp = 0.02) {
  let x = 0, y = 0;
  for (const h of hits) {
    if (t < h.t) continue;
    const dt = t - h.t;
    const e = Math.exp(-dt * 7) * (h.k ?? 1);
    x += Math.sin(dt * 71.0 + h.t) * e;
    y += Math.cos(dt * 57.0 + h.t * 1.7) * e;
  }
  return [x * amp, y * amp];
}

// ---------- textures from files ----------
const _texCache = new Map();
export function loadTexture(url, { srgb = false } = {}) {
  if (_texCache.has(url)) return _texCache.get(url);
  const p = new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
    // plates are decoded to linear in their own shader (pow 2.2), cards use SRGB colour space
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
    t.anisotropy = 8;
    res(t);
  }, undefined, rej));
  _texCache.set(url, p);
  return p;
}

// ---------- full-frame photographic plate ----------
// A textured plane that fills the camera frustum at distance `dist` (oversized by `over` so drift/push never shows an edge).
// Effects: exposure/tint, red alarm wash, x-ray edge reveal (scan from the top), local tearing, crack split.
export function plateMaterial(tex) {
  const img = tex.image;
  return new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: tex }, uTexel: { value: new THREE.Vector2(1 / img.width, 1 / img.height) }, uTime: { value: 0 },
      uExposure: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uLift: { value: 0 },
      uAlarm: { value: 0 }, uXray: { value: 0 }, uXrayY: { value: 0 }, uGlitch: { value: 0 },
      uSplit: { value: 0 }, uSplitGlow: { value: 0 }, uFreeze: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap; uniform vec2 uTexel; uniform float uTime, uExposure, uSat, uLift, uAlarm, uXray, uXrayY, uGlitch, uSplit, uSplitGlow, uFreeze;
      uniform vec3 uTint; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 lin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
      float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      // jagged crack path: x offset of the fissure at height y (piecewise linear between random nodes)
      float crackX(float y){ float k = y * 13.0; float i = floor(k); float f = fract(k);
        float a = (h(vec2(i, 4.1)) - 0.5) * 0.16, b = (h(vec2(i + 1.0, 4.1)) - 0.5) * 0.16;
        return 0.5 + mix(a, b, f) + 0.04 * sin(y * 5.0 + 0.8); }
      void main(){
        vec2 uv = vUv;
        if (uGlitch > 0.001) {
          float fr = floor(uTime * 24.0), band = floor(uv.y * 64.0);
          uv.x += (h(vec2(band, fr)) - 0.5) * 0.09 * uGlitch * step(0.62, h(vec2(band * 0.37, fr + 3.0)));
        }
        float gapEm = 0.0; float sd = 0.0;
        if (uSplit > 0.0001) {
          sd = vUv.x - crackX(vUv.y);
          float side = sign(sd);
          uv += vec2(-side * uSplit * 0.5, side * uSplit * 0.35);
          gapEm = 1.0 - smoothstep(uSplit * 0.5, uSplit * 0.5 + 0.004, abs(sd));
        }
        vec3 c;
        float ca = 0.003 * uGlitch;
        c.r = texture2D(tMap, uv + vec2(ca, 0.0)).r; c.g = texture2D(tMap, uv).g; c.b = texture2D(tMap, uv - vec2(ca, 0.0)).b;
        c = lin(c);
        if (uXray > 0.001) {
          float l00 = lum(lin(texture2D(tMap, uv + uTexel * vec2(-1.5, -1.5)).rgb)), l10 = lum(lin(texture2D(tMap, uv + uTexel * vec2(0.0, -1.5)).rgb)), l20 = lum(lin(texture2D(tMap, uv + uTexel * vec2(1.5, -1.5)).rgb));
          float l01 = lum(lin(texture2D(tMap, uv + uTexel * vec2(-1.5, 0.0)).rgb)), l21 = lum(lin(texture2D(tMap, uv + uTexel * vec2(1.5, 0.0)).rgb));
          float l02 = lum(lin(texture2D(tMap, uv + uTexel * vec2(-1.5, 1.5)).rgb)), l12 = lum(lin(texture2D(tMap, uv + uTexel * vec2(0.0, 1.5)).rgb)), l22 = lum(lin(texture2D(tMap, uv + uTexel * vec2(1.5, 1.5)).rgb));
          float gx = -l00 - 2.0 * l01 - l02 + l20 + 2.0 * l21 + l22, gy = -l00 - 2.0 * l10 - l20 + l02 + 2.0 * l12 + l22;
          float e = clamp(sqrt(gx * gx + gy * gy) * 3.0, 0.0, 1.0);
          float fromTop = 1.0 - vUv.y;
          float m = uXray * (1.0 - smoothstep(uXrayY - 0.01, uXrayY + 0.01, fromTop));
          vec3 xr = vec3(0.25, 0.85, 1.4) * e * 1.6 + c * 0.12;
          float grid = step(0.985, fract(vUv.y * 180.0)) * 0.15;
          c = mix(c, xr + grid * vec3(0.2, 0.6, 1.0), m);
          c += vec3(0.4, 1.0, 1.6) * exp(-abs(fromTop - uXrayY) * 140.0) * uXray * 1.2;
        }
        c = mix(c, c * vec3(1.75, 0.3, 0.32) + vec3(0.02, 0.0, 0.0), uAlarm);
        float l = lum(c);
        c = mix(vec3(l), c, uSat);
        c = mix(c, vec3(l) * vec3(0.9, 0.95, 1.05), uFreeze);
        c = c * uTint * uExposure + uLift;
        if (uSplit > 0.0001) {
          float lip = abs(abs(sd) - uSplit * 0.5);
          c *= 1.0 - gapEm;                                                   // the crack is a void
          c += vec3(0.015, 0.03, 0.06) * gapEm;                               // faint haze inside it
          c += vec3(0.9, 1.2, 1.8) * exp(-lip * 650.0) * uSplitGlow * 1.5;    // hot lips
          c += vec3(0.2, 0.35, 0.75) * exp(-lip * 55.0) * uSplitGlow * 0.3;   // soft spill onto the halves
          c += vec3(1.0, 1.1, 1.3) * exp(-abs(sd) * 700.0) * gapEm * uSplitGlow * 0.8; // hairline of light deep inside
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthWrite: false, depthTest: false,
  });
}

export function makePlate(tex, camera, { dist = 10, over = 1.14 } = {}) {
  const hgt = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * over;
  const img = tex.image;
  const imgAspect = img.width / img.height;
  // cover the frame: match height, then widen if the image is narrower than the frame
  let w = hgt * imgAspect, hh = hgt;
  if (w < hgt * camera.aspect) { w = hgt * camera.aspect; hh = w / imgAspect; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), plateMaterial(tex));
  m.position.set(0, 0, -dist);
  m.renderOrder = -900;
  m.frustumCulled = false;
  return m;
}

// Opaque card (screenshots of reports / posts) with normal blending and a soft shadow plane behind it.
export function paperMaterial(tex, { gain = 0.85 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: tex }, uGain: { value: gain }, uOpacity: { value: 1 }, uHi: { value: new THREE.Vector4(0, 0, 0, 0) }, uHiP: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap; uniform float uGain, uOpacity, uHiP, uTime; uniform vec4 uHi; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tMap, vUv).rgb;   // SRGB texture -> already linear here
        c *= uGain;
        // highlight box (uHi = x0, y0, x1, y1 in uv, y from top): red marker sweep + outline
        if (uHiP > 0.0) {
          float y = 1.0 - vUv.y;
          float inX = step(uHi.x, vUv.x) * step(vUv.x, mix(uHi.x, uHi.z, clamp(uHiP, 0.0, 1.0)));
          float inY = step(uHi.y, y) * step(y, uHi.w);
          c = mix(c, c * vec3(1.0, 0.55, 0.55) + vec3(0.35, 0.0, 0.02), inX * inY * 0.85);
        }
        gl_FragColor = vec4(c, uOpacity);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

export function shadowPlane(w, h, opacity = 0.6) {
  const tex = canvasTexture(256, 256, (g) => {
    const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.35, h * 1.45), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false }));
  return m;
}

// Expanding ring for map pings.
export function makeRing(color = C.red) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uP: { value: 0 }, uI: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uP, uI; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.0; float ring = exp(-abs(r - uP) * 40.0) * (1.0 - uP);
        gl_FragColor = vec4(uColor * ring * uI * 2.0, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
}
