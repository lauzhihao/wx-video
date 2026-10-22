// spec.json (+ voice/voice.json) -> timeline.json. Single timing source for picture and sound.
// usage: node tools/timeline.mjs <run_dir>
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/timeline.mjs <run_dir>'); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(path.join(dir, 'spec.json'), 'utf8'));
const vpath = path.join(dir, 'voice', 'voice.json');
const voice = fs.existsSync(vpath) ? JSON.parse(fs.readFileSync(vpath, 'utf8')) : null;
// per-char narration times from tools/asr_check.py (subtitle chunks follow the voice, not the char count)
const apath = path.join(dir, 'voice', 'align.json');
const align = voice && fs.existsSync(apath) && fs.statSync(apath).mtimeMs >= fs.statSync(vpath).mtimeMs ? JSON.parse(fs.readFileSync(apath, 'utf8')) : {};
const BEAT = 0.5, PRE = 0.2, POST = 0.35, TR = 0.2;
const snap = (t) => Math.ceil(t / BEAT - 1e-6) * BEAT;
const visible = (s) => [...String(s || '').replace(/\s/g, '')].length;
const readTime = (s) => 1.3 + visible(s) / 5.2;

let t = 0;
const segs = [], shots = [];
spec.segments.forEach((sg, i) => {
  const hasHook = sg.shots.some((s) => s.type === 'hook');
  const capText = sg.caption === false || hasHook ? '' : (typeof sg.caption === 'string' ? sg.caption : (sg.vo || ''));
  const v = voice?.segments?.find((x) => x.i === i);
  const vd = v?.dur ?? 0;
  const shotText = sg.shots.map((s) => [s.text, s.sub, s.label, ...(s.items || []).map((it) => (typeof it === 'string' ? it : it.text))].filter(Boolean).join('')).join('');
  const base = vd > 0 ? PRE + vd + POST : readTime(capText || (sg.vo || '') || shotText);
  const dur = snap(Math.max(base, sg.min ?? 0, sg.shots.length * 2.2, 2.5));
  segs.push({ i, t0: t, t1: t + dur, text: capText, caption: capText ? true : false, capY: sg.capY, maxU: sg.maxU, maxSize: sg.maxSize,
    vo: sg.vo || '', voT: vd > 0 ? t + PRE : null, voFile: v?.file ?? null, voDur: vd, align: vd > 0 ? align[String(i)] ?? null : null });
  const W = sg.shots.reduce((a, s) => a + (s.w ?? 1), 0);
  let ts = t;
  sg.shots.forEach((s) => {
    const d = dur * (s.w ?? 1) / W;
    shots.push({ ...s, id: `s${shots.length}`, idx: shots.length, seg: i, t0: ts, t1: ts + d });
    ts += d;
  });
  t += dur;
});
const duration = t + (spec.tail ?? 1.0);
shots[shots.length - 1].t1 = duration;
// transition at every shot boundary: segment boundaries rotate zoom / wipe / fade, inside a segment it's a fade
const kinds = spec.transitions || ['fade', 'zoom', 'wipe'];
const transitions = [];
let segK = (spec.seed ?? 0) % kinds.length;
for (let k = 1; k < shots.length; k++) {
  const b = shots[k].t0, newSeg = shots[k].seg !== shots[k - 1].seg;
  const type = newSeg ? kinds[(segK++) % kinds.length] : 'fade';
  const w = type === 'zoom' ? 0.18 : TR;
  transitions.push({ a: shots[k - 1].id, b: shots[k].id, t0: b - w, t1: b + w, type });
}
shots.forEach((s, k) => { s.win0 = k === 0 ? 0 : s.t0 - TR; s.win1 = k === shots.length - 1 ? duration : shots[k + 1].t0 + TR; });
const hits = segs.map((s, i) => ({ t: i === 0 ? 0.35 : s.t0, k: i === 0 ? 0.6 : (i === segs.length - 1 ? 0.55 : 0.4) }));
const out = { duration, fps: 60, beat: BEAT, shots, segs, hits, transitions, glitches: [], theme: spec.theme, music: spec.music || {} };
fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(out, null, 1));
console.log(`timeline: ${duration.toFixed(2)} s, ${segs.length} segments, ${shots.length} shots, voiced ${segs.filter((s) => s.voDur > 0).length}`);
