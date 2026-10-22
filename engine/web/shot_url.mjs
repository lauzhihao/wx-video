// Screenshot the top of a web page (report headline / post) as material for a `headline` shot.
// usage: node tools/shot_url.mjs <url> <out.png> [--w=1000] [--h=1300] [--y=0]
import puppeteer from 'puppeteer-core';
const [url, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const w = +(opt.w || 1000), h = +(opt.h || 1300), y = +(opt.y || 0);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars', '--lang=zh-CN'] });
const pg = await b.newPage();
await pg.setViewport({ width: w, height: h + y, deviceScaleFactor: 2 });
await pg.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
await pg.screenshot({ path: out, clip: { x: 0, y, width: w, height: h } });
await b.close();
console.log('saved', out);
