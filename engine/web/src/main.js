import { Engine } from './core/engine.js';
import { TextLayer } from './core/text.js';
import { FPS, W, H, TL, setTimeline, globals, overlayShake, glitchAt } from './core/tl.js';
import { theme, applyCss } from './core/theme.js';
import { RENDER } from './shots/common.js';
import { buildShots } from './shots/index.js';

const qs = new URLSearchParams(location.search);
const ss = parseFloat(qs.get('ss') || '1');
const mbScale = parseFloat(qs.get('mb') || '1');
const run = qs.get('run');
RENDER.ss = ss; RENDER.pxScale = (H * ss) / 2;

async function boot() {
  if (!run) throw new Error('missing ?run=runs/<id>');
  const [tl, spec] = await Promise.all([fetch(`./${run}/timeline.json`).then((r) => r.json()), fetch(`./${run}/spec.json`).then((r) => r.json())]);
  setTimeline(tl);
  const th = theme(spec.theme);
  applyCss(th);
  const fontLoads = [];
  for (const w of [400, 500, 600, 700, 800, 900]) fontLoads.push(document.fonts.load(`${w} 40px NSC`, '科技新闻数据时间线对比'));
  for (const w of [400, 600, 700, 800, 900]) fontLoads.push(document.fonts.load(`${w} 40px INTER`, 'AI 2026 $100%'));
  for (const w of [400, 500, 700]) fontLoads.push(document.fonts.load(`${w} 20px JBM`, '2026.10.01'));
  await Promise.all(fontLoads);
  const engine = new Engine({ canvas: document.getElementById('gl'), width: W, height: H, fps: FPS, ss, mbScale });
  const overlay = document.getElementById('overlay');
  const text = new TextLayer(overlay);
  const ctx = { engine, text, spec, theme: th, run, TL };
  const shots = await buildShots(ctx);
  engine.setTimeline({ shots, transitions: TL.transitions, globals });
  window.renderTime = (t) => {
    engine.renderTime(t);
    text.update(t);
    const [sx, sy] = overlayShake(t);
    const g = glitchAt(t);
    overlay.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px)`;
    overlay.style.filter = g > 0.05 ? `drop-shadow(${(6 * g).toFixed(1)}px 0 rgba(255,60,120,0.6)) drop-shadow(${(-6 * g).toFixed(1)}px 0 rgba(0,220,255,0.6))` : 'none';
    overlay.style.opacity = String(1 - (globals(t).fade ?? 0));
    return true;
  };
  window.renderFrame = (f) => window.renderTime(f / FPS);
  window.meta = { fps: FPS, duration: TL.duration, frames: Math.round(TL.duration * FPS), ss, mbScale };
  for (const s of shots) engine.renderTime(s.start + 0.01);
  window.ready = true;
}
boot().catch((e) => { window.bootError = String(e && e.stack || e); console.error(e); });
