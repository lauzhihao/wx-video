import { ease } from '../core/util.js';

// Typography for the portrait frame. Safe band for text: y 250..1450 (the feed UI covers the bottom ~470 px).
export const X0 = 540;

const CLOSE = '，。、！？；：”’）》」』…·—,.!?;:)%';
const OPEN = '“‘（《「『(';
// capitals and m/w set wider than other Latin glyphs in the heavy title font, so count them wider
const unitsOf = (s) => [...s].reduce((a, ch) => a + (ch === '%' ? 1.2 : /[A-Zmw]/.test(ch) ? 0.72 : /[\x00-\xff]/.test(ch) ? 0.56 : 1), 0);

// Chinese-aware wrap: latin words and numbers stay whole, closing punctuation never starts a line,
// opening punctuation never ends one. maxU = line width in CJK character units.
export function wrapZh(text, maxU = 12, keep = []) {
  // tokens = dictionary words (Intl.Segmenter, zh), accent terms kept whole, punctuation glued to its neighbour
  const src = text.trim();
  const kept = (keep || []).filter((k) => k && k.length > 1);
  const guard = new Array(src.length).fill(-1);          // char index -> id of the kept span covering it
  kept.forEach((k, id) => { let i = src.indexOf(k); while (i >= 0) { for (let j = i; j < i + k.length; j++) guard[j] = guard[j] < 0 ? i : guard[j]; i = src.indexOf(k, i + k.length); } });
  const seg = new Intl.Segmenter('zh', { granularity: 'word' });
  const raw = [];
  for (const { segment, index } of seg.segment(src)) {
    const prev = raw[raw.length - 1];
    // merge a segment into the previous one when both sit inside the same kept term
    if (prev && guard[index] >= 0 && guard[index] === guard[prev.index] && guard[index] !== index) { prev.s += segment; continue; }
    raw.push({ s: segment, index });
  }
  const toks = [];
  for (const { s } of raw) {
    if (/^\s+$/.test(s)) { if (toks.length) toks[toks.length - 1] += ' '; continue; }
    // glue Latin/number runs with no space in between ("GPT-6.1", "3.5%", "A/B")
    if (toks.length && /[A-Za-z0-9.\-_/+%$]$/.test(toks[toks.length - 1]) && /^[A-Za-z0-9.\-_/+%$]/.test(s)) { toks[toks.length - 1] += s; continue; }
    if (toks.length && CLOSE.includes(s[0])) toks[toks.length - 1] += s;
    else if (toks.length && OPEN.includes(toks[toks.length - 1].slice(-1))) toks[toks.length - 1] += s;
    else toks.push(s);
  }
  const lines = [];
  let cur = '';
  for (const tk of toks) {
    if (cur && unitsOf(cur + tk.trimEnd()) > maxU) {
      // break priority: after punctuation (line >= 40% full), then at a Latin/CJK space (>= 50%), else here
      const c = cur.trimEnd();
      let pu = -1;
      for (const p of '，：；、') pu = Math.max(pu, c.lastIndexOf(p));
      // a space is a break only between a word and CJK text, never next to a number ("10 月", "GPT 5")
      let sp = -1;
      for (let q = c.length - 1; q > 0; q--) if (c[q] === ' ' && !/[0-9]/.test(c[q - 1]) && !/[0-9]/.test(c[q + 1] || '')) { sp = q; break; }
      if (pu > 0 && pu < c.length - 1 && unitsOf(c.slice(0, pu + 1)) >= maxU * 0.4) { lines.push(c.slice(0, pu + 1)); cur = c.slice(pu + 1).trimStart() + (cur.endsWith(' ') ? ' ' : '') + tk; }
      else if (sp > 0 && unitsOf(c.slice(0, sp)) >= maxU * 0.5) { lines.push(c.slice(0, sp).trim()); cur = c.slice(sp + 1) + (tk.startsWith(' ') ? tk : (cur.endsWith(' ') ? ' ' : '') + tk); }
      else {
        // never strand a number from its unit: "蒸发 5000 | 亿美元" -> "蒸发 | 5000 亿美元"
        const m = c.match(/^(.*\S)\s+([0-9][0-9.,%]*)$/u);
        if (m && !/^\s/.test(tk) && unitsOf(m[1]) >= maxU * 0.4) { lines.push(m[1]); cur = m[2] + ' ' + tk; }
        else { lines.push(c); cur = tk.trimStart(); }
      }
    } else cur += tk;
  }
  if (cur.trim()) lines.push(cur.trim());
  // avoid a lonely last line: re-wrap narrower until balanced (at most 3 tries)
  if (lines.length > 1 && unitsOf(lines[lines.length - 1]) < maxU * 0.3 && maxU > 7) {
    const alt = wrapZh(text, maxU - 1, keep);
    if (alt.length === lines.length) return alt;
  }
  return lines;
}

export function lineUnits(s) { return unitsOf(s); }

// Split a line into segments, colouring any accent substrings (and text inside “ ” / 「 」).
export function accentSegs(line, accents = [], cls = 'acc') {
  const marks = new Array([...line].length).fill(false);
  const chars = [...line];
  const str = chars.join('');
  for (const a of accents || []) {
    if (!a) continue;
    let i = str.indexOf(a);
    while (i >= 0) {
      const pre = [...str.slice(0, i)].length, n = [...a].length;
      for (let k = pre; k < pre + n; k++) marks[k] = true;
      i = str.indexOf(a, i + a.length);
    }
  }
  let inQ = false;
  chars.forEach((ch, k) => { if ('“「'.includes(ch)) inQ = true; if (inQ) marks[k] = true; if ('”」'.includes(ch)) inQ = false; });
  const segs = [];
  chars.forEach((ch, k) => {
    const c = marks[k] ? cls : '';
    if (segs.length && segs[segs.length - 1].cls === c) segs[segs.length - 1].text += ch; else segs.push({ text: ch, cls: c });
  });
  return segs;
}

// A wrapped caption block. Returns the y just below the block.
export function captionBlock(T, text, y0, t0, t1, o = {}) {
  const maxU = o.maxU ?? 12;
  const lines = Array.isArray(text) ? text : wrapZh(text, maxU, o.accents);
  const widest = Math.max(...lines.map(lineUnits));
  const size = o.size ?? Math.max(50, Math.min(o.maxSize ?? 78, Math.floor(940 / Math.max(widest, 1))));
  const lh = size * (o.lh ?? 1.32);
  lines.forEach((ln, i) => {
    T.add({
      segs: accentSegs(ln, o.accents), x: o.x ?? X0, y: y0 + i * lh, size, weight: o.weight ?? 800, font: 'zh', cls: o.cls ?? 'sh',
      t0: t0 + i * (o.lineDelay ?? 0.12), t1, ls: 0.02, ax: o.ax ?? 0.5,
      in: o.fast ? { type: 'rise', dur: 0.28, stagger: 0.008, dist: 12, blur: 6 } : { type: 'rise', dur: 0.5, stagger: 0.022, dist: 22, blur: 8 },
      out: { type: 'fade', dur: o.fast ? 0.1 : 0.25 },
    });
  });
  return y0 + lines.length * lh;
}

export function big(T, text, y, t0, t1, o = {}) {
  return T.add(Object.assign({
    text, x: X0, y, size: 150, weight: 900, font: 'zh', cls: 'sh', t0, t1, ls: 0.02,
    in: { type: 'slam', dur: 0.55, ease: ease.outExpo, from: 1.35 }, out: { type: 'fade', dur: 0.25 },
  }, o));
}

export function line(T, text, y, t0, t1, o = {}) {
  return T.add(Object.assign({
    text, x: X0, y, size: 56, weight: 700, font: 'zh', cls: 'sh', t0, t1, ls: 0.03,
    in: { type: 'rise', dur: 0.5, stagger: 0.025, dist: 22, blur: 8 }, out: { type: 'fade', dur: 0.25 },
  }, o));
}

export function mono(T, text, y, t0, t1, o = {}) {
  return T.add(Object.assign({
    text, x: X0, y, size: 30, weight: 600, font: 'mono', cls: 'sh', color: 'var(--accent)', t0, t1, ls: 0.14,
    in: { type: 'decode', dur: 0.3, stagger: 0.02 }, out: { type: 'fade', dur: 0.2 },
  }, o));
}

// Vertical gradient scrim behind a text band (legibility over photographic plates).
export function scrim(T, t0, t1, y0, y1, a = 0.6, fi = 0.35, fo = 0.3) {
  const el = document.createElement('div');
  el.className = 'scrim';
  Object.assign(el.style, { top: y0 + 'px', height: (y1 - y0) + 'px', display: 'none',
    background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,${a}) 28%, rgba(0,0,0,${a}) 72%, rgba(0,0,0,0) 100%)` });
  return T.addNode(el, (t, e) => {
    if (t < t0 || t > t1) { e.style.display = 'none'; return; }
    e.style.display = '';
    e.style.opacity = String(Math.max(0, Math.min(1, (t - t0) / fi, (t1 - t) / fo)));
  });
}

// Absolutely positioned DOM element with a fade/slide envelope.
export function node(T, el, t0, t1, o = {}) {
  el.style.display = 'none';
  const dy = o.dy ?? 30, dx = o.dx ?? 0, fi = o.fi ?? 0.45, fo = o.fo ?? 0.25;
  return T.addNode(el, (t, e) => {
    if (t < t0 || t > t1) { e.style.display = 'none'; return; }
    e.style.display = '';
    const a = ease.outCubic(Math.max(0, Math.min(1, (t - t0) / fi)));
    const b = Math.max(0, Math.min(1, (t1 - t) / fo));
    e.style.opacity = String(Math.min(a, b));
    e.style.transform = `translate(${(1 - a) * dx}px, ${(1 - a) * dy}px)` + (o.extra ? ' ' + o.extra(t) : '');
    if (o.update) o.update(t, e);
  });
}

// Split narration into subtitle chunks of at most `maxLines` wrapped lines, breaking at punctuation first.
export function chunkCaption(text, maxU = 13, maxLines = 2, keep = []) {
  const phrases = [];
  let cur = '';
  const cs = [...text.trim()];
  cs.forEach((ch, k) => {
    cur += ch;
    const next = cs[k + 1] || ' ';
    // CJK punctuation always breaks; ASCII punctuation only when a space/end follows (keeps "GPT-6.1", "3.5%")
    if ('，。：；！？、'.includes(ch) || (',.!?;:'.includes(ch) && /\s/.test(next))) { phrases.push(cur); cur = ''; }
  });
  if (cur.trim()) phrases.push(cur);
  const chunks = [];
  let acc = '';
  for (const ph of phrases) {
    const trial = acc + ph;
    if (!acc || wrapZh(trial, maxU, keep).length <= maxLines) { acc = trial; continue; }
    chunks.push(acc); acc = ph;
  }
  if (acc) chunks.push(acc);
  // a single over-long phrase: cut its wrapped lines into groups
  const out = [];
  for (const c of chunks) {
    const ls = wrapZh(c, maxU, keep).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < ls.length; i += maxLines) out.push(ls.slice(i, i + maxLines));
  }
  // drop trailing sentence punctuation at the end of each subtitle chunk (keeps 、 and quotes)
  return out.map((ls) => { const c = ls.slice(); c[c.length - 1] = c[c.length - 1].replace(/[，。；：,.;:]+$/u, ''); return c; });
}
