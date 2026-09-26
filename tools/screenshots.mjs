// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded, so the same pictures come out every time. Needs Playwright, and upng-js from `npm install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const SEED = 5;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// A 256-colour palette keeps the PNGs small.
async function save(shot, path) {
  const img = UPNG.decode(shot);
  await writeFile(join(root, path), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
}

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }, SEED);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Opens the apartment example (with Sam's second opinion) and returns its id.
async function apartment(page) {
  await page.goto(base + '#/example/0');
  await page.waitForSelector('.verdict');
  return page.evaluate(() => location.hash.split('/')[2]);
}

const scrollTo = (page, sel, pad = 64) => page.evaluate(([s, p]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - p), [sel, pad]);

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  const id = await apartment(page);
  await scrollTo(page, '.voices', 70);
  await page.waitForTimeout(200);
  await save(await page.screenshot(), 'docs/phone-result.png');

  await scrollTo(page, '.card:has(.diffs)', 70);
  await save(await page.screenshot(), 'docs/phone-differ.png');

  await page.goto(base + `#/d/${id}/score`);
  await page.waitForSelector('.pick');
  await scrollTo(page, '.crit:nth-of-type(2)', 70);
  await save(await page.screenshot(), 'docs/phone-score.png');

  // A question part way through: take back a few answers and go to Weigh.
  await page.evaluate(id => {
    const d = window.onBalance.store.get(id);
    const keys = Object.keys(d.me.pairs);
    for (const k of keys.slice(4)) delete d.me.pairs[k];
    window.onBalance.store.put(d);
  }, id);
  await page.goto(base + `#/d/${id}/weigh`);
  await page.waitForSelector('.ask');
  await page.click('.five button[data-v="-1"]');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await save(await page.screenshot(), 'docs/phone-weigh.png');

  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left, the app's own balance on the right.
{
  const page = await open({ width: 1200, height: 630 }, 1);
  await apartment(page);
  await page.evaluate(async () => {
    const scale = document.querySelector('.verdict .scale').outerHTML;
    document.body.innerHTML = `<div class="ogcard">
      <div class="ogtext">
        <img src="icon.svg" alt="" width="72" height="72">
        <h1>On Balance</h1>
        <p>Weigh up a hard choice and see which way it tips.</p>
        <ul><li>How sure you can be</li><li>What would change it</li><li>Where the two of you differ</li></ul>
      </div>
      <div class="ogscale card">
        <span class="pill likely">Likely winner</span>
        ${scale}
      </div>
    </div>`;
    const style = document.createElement('style');
    style.textContent = `
      body { width: 1200px; height: 630px; overflow: hidden; }
      .bar, .toast { display: none !important; }
      .ogcard { display: grid; grid-template-columns: 560px 1fr; align-items: center; height: 630px; padding: 0 56px 0 64px; gap: 40px; }
      .ogtext img { border-radius: 16px; display: block; }
      .ogtext h1 { font-size: 92px; margin: 22px 0 14px; letter-spacing: -.02em; white-space: nowrap; }
      .ogtext p { font-size: 32px; line-height: 1.28; color: var(--ink-2); margin: 0 0 26px; font-weight: 500; }
      .ogtext ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      .ogtext li { font-size: 24px; font-weight: 600; color: var(--muted); display: flex; align-items: center; gap: 12px; }
      .ogtext li::before { content: ''; width: 12px; height: 12px; border-radius: 50%; border: 2.5px solid var(--brass); }
      .ogscale { margin: 0; padding: 22px 20px 8px; text-align: center; border-radius: 26px; }
      .ogscale .scale { max-width: none; width: 100%; margin-top: 4px; }
      .ogscale .scale .beam, .ogscale .scale .hang { transition: none; }`;
    document.head.append(style);
    await document.fonts.ready;
  });
  await page.waitForTimeout(200);
  await save(await page.screenshot(), 'og.png');
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
