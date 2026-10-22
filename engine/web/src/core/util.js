// Pure helpers shared by every shot. Everything here is a function of its inputs:
// shots must be renderable at any time t in any order (sub-frame motion blur relies on it).

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ramp = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const fract = (x) => x - Math.floor(x);
export const TAU = Math.PI * 2;

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inQuart: (t) => t * t * t * t,
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  inOutExpo: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outSine: (t) => Math.sin((t * Math.PI) / 2),
};

// Eased progress of t through [a, b].
export const prog = (t, a, b, fn = ease.inOutCubic) => fn(ramp(t, a, b));

// Visibility envelope: 0 before t0, eased up over fi, 1, eased down over fo, 0 after t1.
export function env(t, t0, t1, fi = 0.5, fo = 0.5, ei = ease.outCubic, eo = ease.inOutCubic) {
  if (t <= t0 || t >= t1) return 0;
  const a = fi > 0 ? ei(clamp((t - t0) / fi)) : 1;
  const b = fo > 0 ? eo(clamp((t1 - t) / fo)) : 1;
  return Math.min(a, b);
}

// Exponentially decaying pulse started at t0 (0 before).
export const pulse = (t, t0, decay = 6) => (t < t0 ? 0 : Math.exp(-(t - t0) * decay));

// Deterministic PRNG (mulberry32).
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
export const hash2 = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453123);

// Gaussian-ish sample from a uniform rng.
export const gauss = (r) => {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
};

// ---- 3D simplex noise (Stefan Gustavson, public domain), CPU side for geometry generation ----
const grad3 = new Float32Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);
export function makeNoise3(seed = 7) {
  const r = rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
  const F3 = 1 / 3, G3 = 1 / 6;
  return function noise(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const g = (idx, x, y, z) => grad3[idx * 3] * x + grad3[idx * 3 + 1] * y + grad3[idx * 3 + 2] * z;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    n0 = t0 < 0 ? 0 : ((t0 *= t0), t0 * t0 * g(permMod12[ii + perm[jj + perm[kk]]], x0, y0, z0));
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    n1 = t1 < 0 ? 0 : ((t1 *= t1), t1 * t1 * g(permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1));
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    n2 = t2 < 0 ? 0 : ((t2 *= t2), t2 * t2 * g(permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2));
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    n3 = t3 < 0 ? 0 : ((t3 *= t3), t3 * t3 * g(permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3));
    return 32 * (n0 + n1 + n2 + n3);
  };
}

// ---- GLSL chunks ----
export const GLSL_NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
vec3 curl(vec3 p){
  const float e=0.1;
  vec3 dx=vec3(e,0.0,0.0),dy=vec3(0.0,e,0.0),dz=vec3(0.0,0.0,e);
  float x=snoise(p+dy+vec3(0.0,0.0,17.1))-snoise(p-dy+vec3(0.0,0.0,17.1))-snoise(p+dz+vec3(0.0,31.7,0.0))+snoise(p-dz+vec3(0.0,31.7,0.0));
  float y=snoise(p+dz)-snoise(p-dz)-snoise(p+dx+vec3(0.0,0.0,17.1))+snoise(p-dx+vec3(0.0,0.0,17.1));
  float z=snoise(p+dx+vec3(0.0,31.7,0.0))-snoise(p-dx+vec3(0.0,31.7,0.0))-snoise(p+dy)+snoise(p-dy);
  return vec3(x,y,z)/(2.0*e);
}
float hash11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
`;
