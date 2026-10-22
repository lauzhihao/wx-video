import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { clamp, lerp, ease } from './util.js';

// Frame renderer.
//  per active shot:  N motion-blur sub-frames -> MSAA HDR target -> averaged into an accumulation target
//  two shots during a transition are blended by a transition shader
//  then: supersample downscale -> bloom -> final grade (ACES, CA, vignette, grain, flash, fade) -> canvas

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const ACC_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform float uWeight; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  // scrub NaN/Inf/negatives per channel (comparisons with NaN are false, so NaN falls to 0)
  c.r = (c.r >= 0.0 && c.r < 64.0) ? c.r : (c.r >= 64.0 ? 64.0 : 0.0);
  c.g = (c.g >= 0.0 && c.g < 64.0) ? c.g : (c.g >= 64.0 ? 64.0 : 0.0);
  c.b = (c.b >= 0.0 && c.b < 64.0) ? c.b : (c.b >= 64.0 ? 64.0 : 0.0);
  gl_FragColor = vec4(c * uWeight, uWeight);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uSrcTexel; uniform float uSS; varying vec2 vUv;
void main(){
  if (uSS < 1.5) { gl_FragColor = texture2D(tSrc, vUv); return; }
  // tent-weighted 4x4 taps (bilinear) ~ good quality box/tent filter for 2x..3x supersampling
  vec3 c = vec3(0.0); float w = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)) * uSrcTexel * (uSS * 0.5);
    float k = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
    c += texture2D(tSrc, vUv + o).rgb * k; w += k;
  }
  gl_FragColor = vec4(c / w, 1.0);
}`;

const MIX_FRAG = /* glsl */ `
uniform sampler2D tA; uniform sampler2D tB; uniform float uP; uniform int uType; uniform float uTime; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
vec3 zoomBlur(sampler2D t, vec2 uv, float amt){
  vec3 c = vec3(0.0); vec2 d = uv - 0.5;
  for (int i = 0; i < 12; i++){ float k = float(i) / 11.0; c += texture2D(t, 0.5 + d * (1.0 - amt * k)).rgb; }
  return c / 12.0;
}
void main(){
  float p = uP;
  if (uType == 0) { // crossfade
    gl_FragColor = vec4(mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, p), 1.0);
  } else if (uType == 1) { // zoom-through
    float a = smoothstep(0.0, 1.0, p);
    vec3 ca = zoomBlur(tA, 0.5 + (vUv - 0.5) / (1.0 + a * 0.6), a * 0.35);
    vec3 cb = zoomBlur(tB, 0.5 + (vUv - 0.5) * (1.0 + (1.0 - a) * 0.5), (1.0 - a) * 0.35);
    gl_FragColor = vec4(mix(ca, cb, a), 1.0);
  } else if (uType == 2) { // glitch
    float band = floor(vUv.y * 24.0);
    float r = h(vec2(band, floor(uTime * 30.0)));
    float sh = (r - 0.5) * 0.12 * sin(p * 3.14159);
    vec2 uv = vUv + vec2(sh, 0.0);
    float sw = step(h(vec2(band * 3.1, floor(uTime * 20.0))), p);
    vec3 a = vec3(texture2D(tA, uv + vec2(0.01 * sin(p * 3.14), 0.0)).r, texture2D(tA, uv).g, texture2D(tA, uv - vec2(0.01 * sin(p * 3.14), 0.0)).b);
    vec3 b = vec3(texture2D(tB, uv + vec2(0.012 * sin(p * 3.14), 0.0)).r, texture2D(tB, uv).g, texture2D(tB, uv - vec2(0.012 * sin(p * 3.14), 0.0)).b);
    gl_FragColor = vec4(mix(a, b, sw), 1.0);
  } else { // luma wipe with bright seam (left -> right)
    float e = vUv.x + (h(vec2(floor(vUv.y * 90.0), 1.0)) - 0.5) * 0.02;
    float m = smoothstep(p * 1.2 - 0.1, p * 1.2 - 0.05, e);
    float seam = exp(-abs(e - (p * 1.2 - 0.075)) * 90.0);
    gl_FragColor = vec4(mix(texture2D(tB, vUv).rgb, texture2D(tA, vUv).rgb, m) + vec3(0.3, 0.55, 1.0) * seam * 2.0, 1.0);
  }
}`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uRes; uniform float uTime;
uniform float uExposure, uFlash, uFade, uCA, uGrain, uVignette, uSat, uContrast, uGlitch, uScan;
uniform vec3 uFlashColor, uTint;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 uv = vUv;
  if (uGlitch > 0.001) {
    // digital tear: displaced horizontal bands + a few displaced blocks, re-rolled 24x per second
    float fr = floor(uTime * 24.0);
    float band = floor(uv.y * 38.0);
    float on = step(1.0 - 0.55 * uGlitch, h(vec2(band, fr)));
    uv.x += (h(vec2(band * 1.3, fr + 7.0)) - 0.5) * 0.14 * uGlitch * on;
    float bx = floor(uv.x * 10.0), by = floor(uv.y * 22.0);
    float blk = step(1.0 - 0.16 * uGlitch, h(vec2(bx + fr, by)));
    uv += (vec2(h(vec2(by, fr)), h(vec2(bx, fr + 3.0))) - 0.5) * 0.06 * blk;
  }
  vec2 d = uv - 0.5; float r2 = dot(d, d);
  float ca = uCA * (0.25 + r2 * 2.0) + uGlitch * 0.010;
  vec3 col;
  col.r = texture2D(tSrc, uv - d * ca).r;
  col.g = texture2D(tSrc, uv).g;
  col.b = texture2D(tSrc, uv + d * ca).b;
  // flash = an exposure pop on the hit frames (multiplicative keeps blacks black) + a trace of warm lift
  col = col * uExposure * uTint * (1.0 + uFlash * 3.0) + uFlashColor * uFlash * 0.03;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  float vig = smoothstep(0.95, 0.15, sqrt(r2) * 1.25);
  col *= mix(1.0, vig, uVignette);
  col = toSRGB(col);
  if (uScan > 0.001) col *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.5708));
  float g = h(uv * uRes + fract(uTime * 13.7) * 91.0) - 0.5;
  col += g * uGrain * (1.1 - l);
  col += (h(uv * uRes * 1.37 + fract(uTime * 7.1) * 57.0) - 0.5) / 255.0;
  col *= (1.0 - uFade);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Engine {
  constructor({ canvas, width, height, fps, ss = 1, mbScale = 1 }) {
    this.W = width; this.H = height; this.fps = fps; this.ss = ss; this.mbScale = mbScale;
    this.IW = Math.round(width * ss); this.IH = Math.round(height * ss);
    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance',
    }));
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.setClearColor(0x000000, 1);

    const base = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.rtScene = new THREE.WebGLRenderTarget(this.IW, this.IH, { ...base, depthBuffer: true, samples: 4 });
    this.rtAcc = [0, 1].map(() => new THREE.WebGLRenderTarget(this.IW, this.IH, base));
    this.rtMix = new THREE.WebGLRenderTarget(this.IW, this.IH, base);
    this.rtOut = new THREE.WebGLRenderTarget(width, height, base);

    this.accMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: ACC_FRAG,
      uniforms: { tSrc: { value: null }, uWeight: { value: 1 } },
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true });
    this.downMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uSrcTexel: { value: new THREE.Vector2(1 / this.IW, 1 / this.IH) }, uSS: { value: ss } },
      depthTest: false, depthWrite: false });
    this.mixMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: MIX_FRAG,
      uniforms: { tA: { value: null }, tB: { value: null }, uP: { value: 0 }, uType: { value: 0 }, uTime: { value: 0 } },
      depthTest: false, depthWrite: false });
    this.finalMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FINAL_FRAG,
      uniforms: {
        tSrc: { value: null }, uRes: { value: new THREE.Vector2(width, height) }, uTime: { value: 0 },
        uExposure: { value: 1 }, uFlash: { value: 0 }, uFade: { value: 0 }, uCA: { value: 0.002 }, uGrain: { value: 0.035 },
        uVignette: { value: 0.55 }, uSat: { value: 1.0 }, uContrast: { value: 1.0 },
        uFlashColor: { value: new THREE.Color(1.0, 0.82, 0.8) }, uTint: { value: new THREE.Vector3(1, 1, 1) },
        uGlitch: { value: 0 }, uScan: { value: 0 },
      },
      depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.accMat);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 1.0, 0.6, 0.2);
    this.bloom.renderToScreen = false;

    this.shots = [];
    this.transitions = [];
    this.globals = null; // (t) => { flash, fade, ca, exposure, ... }
  }

  setTimeline({ shots, transitions, globals }) {
    this.shots = shots; this.transitions = transitions; this.globals = globals;
  }

  // Render one shot into accumulation target idx (motion blur by sub-frame averaging).
  renderShot(shot, t, idx) {
    const r = this.renderer;
    const n = Math.max(1, Math.round((shot.mb ? shot.mb(t) : 1) * this.mbScale));
    const shutter = (shot.shutter ?? 0.5) / this.fps; // 180 degree shutter by default
    r.setRenderTarget(this.rtAcc[idx]);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    for (let k = 0; k < n; k++) {
      const ts = n === 1 ? t : t + ((k + 0.5) / n - 0.5) * shutter;
      shot.update(ts, this);
      r.setRenderTarget(this.rtScene);
      r.setClearColor(shot.clearColor ?? 0x000000, 1);
      r.clear(true, true, false);
      r.render(shot.scene, shot.camera);
      if (shot.overlayScene) { r.clearDepth(); r.render(shot.overlayScene, shot.overlayCamera || shot.camera); }
      this.accMat.uniforms.tSrc.value = this.rtScene.texture;
      this.accMat.uniforms.uWeight.value = 1 / n;
      this.quad.material = this.accMat;
      r.setRenderTarget(this.rtAcc[idx]);
      this.quad.render(r);
    }
    shot.update(t, this); // leave the shot at the exact frame time (text anchors read cameras)
    shot.scene.updateMatrixWorld(); shot.camera.updateMatrixWorld();
    return this.rtAcc[idx];
  }

  activeAt(t) {
    return this.shots.filter((s) => t >= s.start && t < s.end);
  }

  renderTime(t) {
    const r = this.renderer;
    const act = this.activeAt(t);
    const tr = this.transitions.find((x) => t >= x.t0 && t < x.t1);
    let src = null;
    let bloomParams = null, grade = null;
    if (tr && tr.type !== 'cut') {
      const A = this.shots.find((s) => s.id === tr.a), B = this.shots.find((s) => s.id === tr.b);
      const ta = this.renderShot(A, t, 0), tb = this.renderShot(B, t, 1);
      const p = ease.inOutSine(clamp((t - tr.t0) / (tr.t1 - tr.t0)));
      this.mixMat.uniforms.tA.value = ta.texture; this.mixMat.uniforms.tB.value = tb.texture;
      this.mixMat.uniforms.uP.value = p; this.mixMat.uniforms.uTime.value = t;
      this.mixMat.uniforms.uType.value = { fade: 0, zoom: 1, glitch: 2, wipe: 3 }[tr.type] ?? 0;
      this.quad.material = this.mixMat;
      r.setRenderTarget(this.rtMix); this.quad.render(r);
      src = this.rtMix;
      bloomParams = mixBloom(A.bloom?.(t), B.bloom?.(t), p);
      grade = mixGrade(A.grade?.(t), B.grade?.(t), p);
    } else {
      // cut transitions: the later shot wins once its window has started
      let shot = act[act.length - 1];
      if (tr && tr.type === 'cut') shot = this.shots.find((s) => s.id === tr.b);
      if (!shot) { r.setRenderTarget(null); r.setClearColor(0, 1); r.clear(); return; }
      src = this.renderShot(shot, t, 0);
      bloomParams = shot.bloom?.(t);
      grade = shot.grade?.(t);
    }
    // supersample -> output size
    this.downMat.uniforms.tSrc.value = src.texture;
    this.quad.material = this.downMat;
    r.setRenderTarget(this.rtOut); this.quad.render(r);
    // bloom (in place, additive)
    const bp = Object.assign({ strength: 1.0, radius: 0.6, threshold: 0.2 }, bloomParams || {});
    this.bloom.strength = bp.strength; this.bloom.radius = bp.radius; this.bloom.threshold = bp.threshold;
    if (bp.strength > 0.001) this.bloom.render(r, null, this.rtOut, 0, false);
    // final grade to canvas
    const g = Object.assign({ exposure: 1, sat: 1, contrast: 1, vignette: 0.55, grain: 0.035, ca: 0.0015, tint: [1, 1, 1], scan: 0 }, grade || {});
    const glob = this.globals ? this.globals(t) : {};
    const u = this.finalMat.uniforms;
    u.tSrc.value = this.rtOut.texture; u.uTime.value = t;
    u.uExposure.value = g.exposure * (glob.exposure ?? 1);
    u.uSat.value = g.sat; u.uContrast.value = g.contrast; u.uVignette.value = g.vignette; u.uGrain.value = g.grain;
    u.uCA.value = g.ca + (glob.ca ?? 0);
    u.uFlash.value = glob.flash ?? 0; u.uFade.value = glob.fade ?? 0;
    u.uGlitch.value = glob.glitch ?? 0; u.uScan.value = g.scan ?? 0;
    u.uTint.value.set(g.tint[0], g.tint[1], g.tint[2]);
    this.quad.material = this.finalMat;
    r.setRenderTarget(null); this.quad.render(r);
  }
}

function mixBloom(a = {}, b = {}, p) {
  const A = Object.assign({ strength: 1.0, radius: 0.6, threshold: 0.2 }, a);
  const B = Object.assign({ strength: 1.0, radius: 0.6, threshold: 0.2 }, b);
  return { strength: lerp(A.strength, B.strength, p), radius: lerp(A.radius, B.radius, p), threshold: lerp(A.threshold, B.threshold, p) };
}
function mixGrade(a = {}, b = {}, p) {
  const D = { exposure: 1, sat: 1, contrast: 1, vignette: 0.55, grain: 0.035, ca: 0.0015, tint: [1, 1, 1], scan: 0 };
  const A = Object.assign({}, D, a), B = Object.assign({}, D, b);
  const o = {};
  for (const k of Object.keys(D)) o[k] = k === 'tint' ? A.tint.map((v, i) => lerp(v, B.tint[i], p)) : lerp(A[k], B[k], p);
  return o;
}
