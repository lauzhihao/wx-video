// Cover for a run: node cover.mjs --run=runs/<id>  ->  runs/<id>/out/cover_1080x1920.png (+ 6:7 and 3:4 crops)
import puppeteer from 'puppeteer-core'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const run = (process.argv.find((a) => a.startsWith('--run=')) || '').slice(6);
if (!run) { console.error('usage: node cover.mjs --run=runs/<id>'); process.exit(2); }
const root = path.resolve('.');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf'};
const srv = http.createServer((q,res)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});res.end(d);});}).listen(0);
const chrome = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome';
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--hide-scrollbars'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
pg.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await pg.goto(`http://127.0.0.1:${srv.address().port}/cover.html?run=${run}`);
await pg.waitForFunction('window.coverReady === true', { timeout: 60000 });
const out = path.join(root, run, 'out'); fs.mkdirSync(out, { recursive: true });
await pg.screenshot({ path: path.join(out, 'cover_1080x1920.png'), clip: { x: 0, y: 0, width: 1080, height: 1920 } });
await b.close(); srv.close();
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(out, 'cover_1080x1920.png'), '-vf', 'crop=1080:1260:0:190', path.join(out, 'cover_1080x1260.png')]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(out, 'cover_1080x1920.png'), '-vf', 'crop=1080:1440:0:130', path.join(out, 'cover_1080x1440.png')]);
console.log('covers ->', out);
