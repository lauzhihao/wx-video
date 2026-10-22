import * as THREE from 'three';

// Clean tech palettes (no alarm red). bg: backdrop inner/outer; accent: main highlight; accent2: secondary; warm: numbers/dates.
export const THEMES = {
  ocean:    { bgIn: '#0b2038', bgOut: '#02060d', accent: '#3ab7ff', accent2: '#7cf0d6', warm: '#ffc56b', ink: '#f3f6fb', dim: '#9aa9bd', panel: 'rgba(10, 26, 46, 0.74)', line: 'rgba(120, 190, 255, 0.30)' },
  graphite: { bgIn: '#1c2029', bgOut: '#050608', accent: '#f5b942', accent2: '#8fb4ff', warm: '#ffd88a', ink: '#f5f5f2', dim: '#a3a7b0', panel: 'rgba(24, 26, 32, 0.78)', line: 'rgba(245, 185, 66, 0.30)' },
  dawn:     { bgIn: '#2b1621', bgOut: '#07040a', accent: '#ff8a5c', accent2: '#ffd27a', warm: '#ffe2a8', ink: '#fbf5f1', dim: '#b9a3a8', panel: 'rgba(40, 18, 28, 0.74)', line: 'rgba(255, 150, 110, 0.30)' },
  mint:     { bgIn: '#0b2a24', bgOut: '#020807', accent: '#3de0b0', accent2: '#9fdcff', warm: '#ffd479', ink: '#f1faf7', dim: '#95b3ab', panel: 'rgba(8, 34, 30, 0.74)', line: 'rgba(80, 230, 180, 0.30)' },
  violet:   { bgIn: '#1d1438', bgOut: '#05030b', accent: '#a58bff', accent2: '#6fe3ff', warm: '#ffc98a', ink: '#f5f3fd', dim: '#a8a2c2', panel: 'rgba(28, 20, 54, 0.74)', line: 'rgba(170, 150, 255, 0.30)' },
};

export function theme(name) {
  const t = THEMES[name] || THEMES.ocean;
  return Object.assign({ name }, t, {
    cAccent: new THREE.Color(t.accent), cAccent2: new THREE.Color(t.accent2), cWarm: new THREE.Color(t.warm),
    cInk: new THREE.Color(t.ink), cDim: new THREE.Color(t.dim),
  });
}

export function applyCss(t) {
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries({ accent: t.accent, accent2: t.accent2, warm: t.warm, ink: t.ink, dim: t.dim, panel: t.panel, line: t.line })) r.setProperty('--' + k, v);
}
