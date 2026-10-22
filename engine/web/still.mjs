// Render stills at given times: node still.mjs out_dir t1 t2 ... [--ss=1] [--mb=1]
import puppeteer from 'puppeteer-core'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2);
const opts = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const s = a.slice(2); const i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));
const [outDir, ...rawTimes] = args.filter(a => !a.startsWith('--'));
const times = rawTimes.flatMap(t => t.trim().split(/\s+/)).filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });
const root = path.resolve('.');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf','.woff2':'font/woff2'};
const srv = http.createServer((q,res)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});res.end(d);});}).listen(0);
const chrome = opts.chrome || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', userDataDir: path.resolve('../.chrome-profile'),
  args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit',
    ...(process.platform === 'linux' ? ['--use-gl=angle', '--use-angle=gl-egl'] : []), ...(opts.flags ? opts.flags.split(',') : [])] });
const pg = await b.newPage();
pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text().slice(0, 300)); });
pg.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 500)));
await pg.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
const q = `?ss=${opts.ss||1}&mb=${opts.mb||1}${opts.run?'&run='+opts.run:''}`;
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html${q}`);
await pg.waitForFunction('window.ready===true || window.bootError', { timeout: 180000 });
const err = await pg.evaluate('window.bootError'); if (err) { console.log('BOOT ERROR', err); process.exit(1); }
const cdp = await pg.createCDPSession();
for (const t of times) {
  const t0 = Date.now();
  await pg.evaluate((tt) => window.renderTime(tt), parseFloat(t));
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(outDir, `t${String(parseFloat(t).toFixed(2)).padStart(7, '0')}.png`);
  fs.writeFileSync(f, Buffer.from(data, 'base64'));
  console.log('saved', f, (Date.now() - t0) + 'ms');
}
await b.close(); srv.close();
