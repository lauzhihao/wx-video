import { clamp, pulse } from './util.js';

// Run timeline, loaded from runs/<id>/timeline.json (built by tools/timeline.mjs from spec.json + voice durations).
export const FPS = 60;
export const W = 1080, H = 1920;
export const TL = { duration: 30, shots: [], segs: [], hits: [], transitions: [], glitches: [] };

export function setTimeline(j) { Object.assign(TL, j); }

export function glitchAt(t) {
  let g = 0;
  for (const [t0, d, k] of TL.glitches) if (t >= t0 && t < t0 + d) g = Math.max(g, k * (1 - (t - t0) / d * 0.5));
  return g;
}

// Global post: exposure pops on hits (multiplicative in the engine), gentle fade in/out.
export function globals(t) {
  let flash = 0, ca = 0;
  for (const h of TL.hits) { flash += pulse(t, h.t, 16.0) * h.k * 0.22; ca += pulse(t, h.t, 5.0) * h.k * 0.006; }
  let fade = 0;
  if (t < 0.25) fade = 1 - t / 0.25;
  if (t > TL.duration - 1.2) fade = clamp((t - (TL.duration - 1.2)) / 1.0);
  return { flash, ca, fade, glitch: glitchAt(t) };
}

export function overlayShake(t) {
  let x = 0, y = 0;
  for (const h of TL.hits) {
    if (t < h.t) continue;
    const dt = t - h.t, e = Math.exp(-dt * 10) * h.k;
    x += Math.sin(dt * 83 + h.t) * e; y += Math.cos(dt * 67 + h.t * 1.3) * e;
  }
  return [x * 5, y * 5];
}
