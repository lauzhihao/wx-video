// Render a frame range straight into an H.264 segment.
// node render.mjs --from=0 --to=600 --out=../out/seg_0.mp4 [--ss=2] [--mb=2] [--crf=16] [--preset=slow]
import puppeteer from 'puppeteer-core'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn } from 'node:child_process';
const opts = Object.fromEntries(process.argv.slice(2).map(a => { const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));
const from = +opts.from, to = +opts.to, out = path.resolve(opts.out);
const ss = opts.ss || '1', mb = opts.mb || '1', crf = opts.crf || '16', preset = opts.preset || 'slow';
const linux = process.platform === 'linux';
const root = path.resolve('.');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf'};
const srv = http.createServer((q,res)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});res.end(d);});}).listen(0);
const args = ['--hide-scrollbars', '--force-device-scale-factor=1', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
if (linux) args.push('--use-gl=angle', '--use-angle=gl-egl');
const profile = path.join(os.tmpdir(), `astraprof-${process.pid}`);
const b = await puppeteer.launch({ executablePath: linux ? '/usr/bin/google-chrome' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', userDataDir: profile, args, protocolTimeout: 600000 });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 400)));
await pg.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html?ss=${ss}&mb=${mb}${opts.run ? '&run=' + opts.run : ''}`);
await pg.waitForFunction('window.ready===true || window.bootError', { timeout: 300000 });
const err = await pg.evaluate('window.bootError'); if (err) { console.log('BOOT ERROR', err); process.exit(2); }
const gpu = await pg.evaluate(() => { const c = document.getElementById('gl'); const gl = c.getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
console.log(`worker ${process.pid} frames ${from}-${to} ss=${ss} mb=${mb} gpu=${gpu}`);
const cdp = await pg.createCDPSession();
fs.mkdirSync(path.dirname(out), { recursive: true });
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'png', '-i', '-',
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-profile:v', 'high',
  '-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-bf', '2', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-r', '60', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const write = (buf) => new Promise((res) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res); });
const t0 = Date.now();
for (let f = from; f < to; f++) {
  await pg.evaluate((ff_) => window.renderFrame(ff_), f);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  await write(Buffer.from(data, 'base64'));
  if ((f - from) % 60 === 59 || f === to - 1) {
    const done = f - from + 1, el = (Date.now() - t0) / 1000;
    console.log(`progress ${done}/${to - from} frames ${(done / el).toFixed(1)} fps eta ${((to - from - done) / (done / el)).toFixed(0)}s`);
  }
}
ff.stdin.end();
await new Promise((res) => ff.on('close', res));
await b.close(); srv.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(`DONE ${out} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(0);
