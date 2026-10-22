import { clamp, ease, hash2, lerp } from './util.js';

// DOM typography layer drawn over the WebGL canvas. Every property is set from the frame time,
// so screenshots are deterministic. Items: {text | segs, x, y, ax, ay, t0, t1, in, out, ...}

export const FONTS = {
  zh: '"NSC", "PingFang SC", sans-serif',
  en: '"INTER", "NSC", system-ui, sans-serif',
  mono: '"JBM", Menlo, monospace',
};

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class TextLayer {
  constructor(root) { this.root = root; this.items = []; }
  add(spec) { const it = new TextItem(spec); this.root.appendChild(it.el); this.items.push(it); return it; }
  // arbitrary DOM node driven by its own update(t)
  addNode(el, update) { this.root.appendChild(el); const it = { el, update: (t) => update(t, el) }; this.items.push(it); return it; }
  update(t) { for (const it of this.items) it.update(t); }
}

class TextItem {
  constructor(spec) {
    const s = (this.s = Object.assign({
      x: 540, y: 960, ax: 0.5, ay: 0.5, size: 48, weight: 400, font: 'zh', color: '#f2f6fb',
      ls: 0, lh: 1.25, t0: 0, t1: 1e9, align: 'left', opacity: 1,
      in: {}, out: {}, cls: '', style: null, width: null,
    }, spec));
    s.in = Object.assign({ type: 'rise', dur: 0.9, stagger: 0.035, dist: 26, blur: 12, order: 'forward', ease: ease.outCubic }, spec.in || {});
    s.out = Object.assign({ type: 'fade', dur: 0.6, dist: 20 }, spec.out || {});
    const el = (this.el = document.createElement('div'));
    el.className = 't ' + s.cls;
    Object.assign(el.style, {
      fontFamily: FONTS[s.font] || s.font, fontSize: s.size + 'px', fontWeight: String(s.weight),
      color: s.color, letterSpacing: s.ls + 'em', lineHeight: String(s.lh), textAlign: s.align, display: 'none',
    });
    if (s.width) { el.style.width = s.width + 'px'; el.style.whiteSpace = 'normal'; }
    if (s.style) Object.assign(el.style, s.style);
    const segs = s.segs || [{ text: s.text ?? '' }];
    this.chars = [];
    const perChar = !s.dyn && ['rise', 'blur', 'decode', 'type', 'drop', 'zoom', 'glitch'].includes(s.in.type);
    if (perChar) {
      for (const seg of segs) {
        if (seg.br) { el.appendChild(document.createElement('br')); continue; }
        for (const ch of [...seg.text]) {
          const sp = document.createElement('span');
          sp.className = 'c ' + (seg.cls || '');
          sp.textContent = ch === ' ' ? ' ' : ch;
          el.appendChild(sp);
          this.chars.push({ el: sp, ch, latin: /[A-Za-z0-9]/.test(ch) });
        }
      }
    } else if (!s.dyn) {
      el.innerHTML = segs.map((g) => (g.br ? '<br>' : g.cls ? `<span class="${g.cls}">${esc(g.text)}</span>` : esc(g.text))).join('');
    }
    this.visible = false;
    this.lastTxt = null;
  }

  update(t) {
    const s = this.s;
    if (t < s.t0 || t > s.t1) {
      if (this.visible) { this.el.style.display = 'none'; this.visible = false; }
      return;
    }
    if (!this.visible) { this.el.style.display = ''; this.visible = true; }
    let x = s.x, y = s.y, sc = 1, extra = 1;
    if (s.anchor) {
      const a = s.anchor(t);
      x = a.x; y = a.y;
      if (a.s != null) sc = a.s;
      if (a.o != null) extra = a.o;
    }
    if (s.dyn) {
      const txt = s.dyn(t);
      if (txt !== this.lastTxt) { this.el.innerHTML = txt; this.lastTxt = txt; }
    }
    // --- exit ---
    const od = s.out.dur;
    const q = od > 0 ? clamp((s.t1 - t) / od) : 1;
    const qe = ease.inOutCubic(q);
    let ox = 0, oy = 0, blur = 0, osc = 1;
    let op = qe;
    switch (s.out.type) {
      case 'blur': blur = (1 - qe) * 14; break;
      case 'up': oy = -(1 - qe) * s.out.dist; blur = (1 - qe) * 6; break;
      case 'down': oy = (1 - qe) * s.out.dist; blur = (1 - qe) * 6; break;
      case 'scale': osc = 1 + (1 - qe) * 0.12; blur = (1 - qe) * 10; break;
      case 'shrink': osc = 1 - (1 - qe) * 0.1; blur = (1 - qe) * 8; break;
      case 'none': op = 1; break;
      case 'glitch': {
        // flicker out with horizontal tearing
        if (q < 1) {
          const f = Math.floor(t * 40);
          op = (hash2(3.3, f) < q ? 1 : 0.15) * q;
          ox = (hash2(7.7, f) - 0.5) * 70 * (1 - q);
        } else op = 1;
        break;
      }
      default: break;
    }
    // --- entrance ---
    const ip = s.in;
    const p0 = clamp((t - s.t0) / Math.max(1e-3, ip.dur));
    if (this.chars.length) {
      const n = this.chars.length;
      for (let i = 0; i < n; i++) {
        const c = this.chars[i];
        const k = ip.order === 'center' ? Math.abs(i - (n - 1) / 2) : ip.order === 'reverse' ? n - 1 - i : ip.order === 'random' ? hash2(i, 3.7) * n * 0.6 : i;
        const p = clamp((t - s.t0 - k * ip.stagger) / ip.dur);
        const e = ip.ease(p);
        const st = c.el.style;
        switch (ip.type) {
          case 'rise':
            st.opacity = e; st.transform = `translateY(${(1 - e) * ip.dist}px)`;
            st.filter = e < 0.999 ? `blur(${(1 - e) * ip.blur}px)` : 'none';
            break;
          case 'drop':
            st.opacity = e; st.transform = `translateY(${-(1 - e) * ip.dist}px)`;
            st.filter = e < 0.999 ? `blur(${(1 - e) * ip.blur}px)` : 'none';
            break;
          case 'blur':
            st.opacity = e; st.transform = 'none'; st.filter = e < 0.999 ? `blur(${(1 - e) * ip.blur}px)` : 'none';
            break;
          case 'zoom':
            st.opacity = e; st.transform = `scale(${lerp(1.8, 1, e)})`; st.filter = e < 0.999 ? `blur(${(1 - e) * ip.blur}px)` : 'none';
            break;
          case 'type':
            st.opacity = p > 0 ? 1 : 0;
            break;
          case 'glitch': {
            if (p <= 0) { st.opacity = 0; break; }
            if (p >= 1) { st.opacity = 1; st.transform = 'none'; st.textShadow = ''; break; }
            const f = Math.floor(t * 40);
            const u = 1 - p;
            st.opacity = (hash2(i * 3.1, f) > 0.35 * u ? 1 : 0) * (0.35 + 0.65 * p);
            st.transform = `translate(${(hash2(i * 1.7, f + 11) - 0.5) * 46 * u}px, ${(hash2(i * 2.3, f + 5) - 0.5) * 12 * u}px)`;
            st.textShadow = `${10 * u}px 0 rgba(255,20,60,0.85), ${-10 * u}px 0 rgba(0,220,255,0.85)`;
            break;
          }
          case 'decode': {
            if (p <= 0) { st.opacity = 0; break; }
            st.opacity = 1;
            if (p < 1 && c.latin) {
              const g = GLYPHS[Math.floor(hash2(i * 7.31, Math.floor(t * 30)) * GLYPHS.length)];
              if (c.el.textContent !== g) c.el.textContent = g;
              st.opacity = 0.55 + 0.45 * p;
            } else if (p < 1) {
              st.opacity = e; st.filter = `blur(${(1 - e) * 6}px)`;
            } else {
              const fin = c.ch === ' ' ? ' ' : c.ch;
              if (c.el.textContent !== fin) c.el.textContent = fin;
              st.filter = 'none';
            }
            break;
          }
        }
      }
      if (ip.type === 'type' && ip.caret) {
        // caret handled by CSS class on the element
        const vis = this.chars.filter((c, i) => t - s.t0 - i * ip.stagger > 0).length;
        this.el.classList.toggle('typing', vis < n || Math.floor(t * 2.2) % 2 === 0);
      }
    } else {
      const e = ip.ease(p0);
      switch (ip.type) {
        case 'fade': op *= e; break;
        case 'rise': op *= e; oy += (1 - e) * ip.dist; blur = Math.max(blur, (1 - e) * ip.blur * 0.6); break;
        case 'wipe': this.el.style.clipPath = `inset(-20% ${(1 - e) * 100}% -20% 0)`; break;
        case 'scale': op *= e; osc *= lerp(1.15, 1, e); blur = Math.max(blur, (1 - e) * 10); break;
        case 'track': op *= e; this.el.style.letterSpacing = lerp(s.ls + (ip.from ?? 0.8), s.ls, e) + 'em'; blur = Math.max(blur, (1 - e) * 8); break;
        case 'slam': op *= Math.min(1, p0 * 5); osc *= lerp(ip.from ?? 1.7, 1, e); blur = Math.max(blur, (1 - e) * 16); break;
        case 'drop': op *= e; oy -= (1 - e) * ip.dist; blur = Math.max(blur, (1 - e) * ip.blur * 0.6); break;
        default: op *= e;
      }
    }
    const tr = `translate(${x}px, ${y}px) translate(${-s.ax * 100}%, ${-s.ay * 100}%) translate(${ox}px, ${oy}px) scale(${sc * osc})`;
    this.el.style.transform = tr;
    this.el.style.opacity = String(op * extra * s.opacity);
    this.el.style.filter = blur > 0.05 ? `blur(${blur}px)` : 'none';
  }
}

// Project a world point through a camera to overlay pixels.
export function project(v, camera, W = 1080, H = 1920) {
  const p = v.clone().project(camera);
  return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, behind: p.z > 1 };
}
