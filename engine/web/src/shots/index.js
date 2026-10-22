import { HookShot, PlateShot, QuoteShot } from './s_plate.js';
import { NumberShot, ChartShot, CompareShot, PointsShot, TimelineShot, HeadlineShot } from './s_data.js';
import { GlobeShot, AIShot, OutroShot } from './s_space.js';
import { captionBlock, chunkCaption, scrim } from './type.js';

const TYPES = { hook: HookShot, plate: PlateShot, quote: QuoteShot, number: NumberShot, chart: ChartShot, compare: CompareShot,
  points: PointsShot, timeline: TimelineShot, headline: HeadlineShot, globe: GlobeShot, ai: AIShot, outro: OutroShot };

export async function buildShots(ctx) {
  const { TL, spec, text: T } = ctx;
  const shots = [];
  for (const sh of TL.shots) {
    const C = TYPES[sh.type];
    if (!C) throw new Error(`unknown shot type ${sh.type}`);
    const s = new C(ctx, sh);
    if (s.init) await s.init(ctx);
    shots.push(s);
  }
  // captions = the Muse copy verbatim, top band. Voiced segments run as subtitle chunks (<= 2 lines) paced
  // by the narration; silent segments show the whole line.
  for (const sg of TL.segs) {
    if (sg.caption === false || !sg.text) continue;
    const y0 = sg.capY ?? 340, maxU = sg.maxU ?? 13;
    scrim(T, sg.t0, sg.t1, y0 - 120, y0 + 250, 0.4, 0.25, 0.2);
    if (!sg.voDur) { captionBlock(T, sg.text, y0, sg.t0 + 0.08, sg.t1, { accents: spec.accent, maxU, maxSize: sg.maxSize ?? 72 }); continue; }
    const chunks = chunkCaption(sg.text, maxU, 2, spec.accent);
    const w = chunks.map((c) => [...c.join('').replace(/\s/g, '')].length + 2);
    const tot = w.reduce((a, b) => a + b, 0);
    // chunk k starts when the voice reaches its first char: Whisper times (sg.align, one per letter/digit/CJK char
    // of the copy) when they match the text, else paced by char count
    const nrm = (x) => x.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const n = chunks.map((c) => nrm(c.join('')).length);
    const al = sg.align && sg.align.length === nrm(sg.text.replace(/-/g, '')).length ? sg.align : null;
    const starts = [];
    let acc = 0, nAcc = 0;
    chunks.forEach((c, k) => { starts.push(al ? sg.voT + al[Math.min(nAcc, al.length - 1)] - 0.08 : sg.voT + sg.voDur * acc / tot); acc += w[k]; nAcc += n[k]; });
    chunks.forEach((c, k) => {
      const a = k === 0 ? sg.t0 + 0.06 : starts[k];
      const b = k === chunks.length - 1 ? sg.t1 : starts[k + 1];
      captionBlock(T, c, y0, a, b + 0.02, { accents: spec.accent, maxU, maxSize: 70, lineDelay: 0.05, fast: true });
    });
  }
  shots.sort((a, b) => a.start - b.start);
  return shots;
}
