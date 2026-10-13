// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// One person makes a decision, asks someone else by link, gets their answers back, and checks the rest of the page.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
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

const browser = await pw.chromium.launch();
const problems = [];

async function device() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('requestfailed', r => problems.push('failed: ' + r.url()));
  page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });
  return { ctx, page };
}

const fits = async (page, where) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${where} scrolls sideways on a phone`);
const text = page => page.locator('main').innerText();

// Answer every "which matters more?" question, choosing from the given list in turn.
async function answerAll(page, picks) {
  for (let i = 0; await page.locator('.five').count(); i++) {
    await page.click(`.five button[data-v="${picks[i % picks.length]}"]`);
    await page.waitForTimeout(300);
    assert.ok(i < 30, 'the questions end');
  }
}

// Goes on to the next step and waits for it to be drawn.
async function next(page, ready) {
  await page.click('.next-bar .btn.primary');
  await page.locator(ready).first().waitFor();
}

async function scoreAll(page, scores) {
  const boxes = page.locator('.pick');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).locator(`button[data-s="${scores[i % scores.length]}"]`).click();
}

// ---------- Mark makes a decision ----------
const mark = await device();
let page = mark.page;
// Every tool at junkdrawer.works/… shares one address, and so one cache storage. Another tool's offline copy,
// made before On Balance's worker starts, has to survive it, while an old copy of On Balance's own goes
// (checked once the worker is in charge, near the end).
await page.goto(base + 'manifest.webmanifest');
await page.evaluate(() => Promise.all(['another-tool-v1', 'on-balance-v0'].map(name => caches.open(name).then(c => c.put('index.html', new Response(name))))));
await page.goto(base);
await page.evaluate(() => document.fonts.ready);
assert.match(await text(page), /Weigh up a hard choice/);
await fits(page, 'the home screen');

await page.click('text=Start a decision');
await page.locator('#title').waitFor();
await page.fill('#title', 'Which apartment');
const opts = page.locator('ul[data-kind=option] input');
await opts.nth(0).fill('Maple Street');
await opts.nth(1).fill('Birch Avenue');
await opts.nth(1).press('Enter'); // Enter on the last choice adds another
await page.keyboard.type('The loft');
const crits = page.locator('ul[data-kind=criterion] input');
await crits.nth(0).fill('Rent');
await crits.nth(1).fill('Commute');
await page.click('.chip[data-idea="Space"]');
assert.equal(await page.locator('ul[data-kind=criterion] li').count(), 3, 'an idea adds a row');
await fits(page, 'the list');

await next(page, '.ask');
assert.match(page.url(), /\/weigh$/);
assert.match(await text(page), /1 of 3/);
await answerAll(page, [1, 2, -1]); // Rent over Commute, Rent much over Space, Space over Commute
const weights = await page.locator('.weights li').allInnerTexts();
assert.match(weights[0], /Rent/, 'Rent counts most');
await fits(page, 'the weights');

await next(page, '.pick');
assert.match(page.url(), /\/score$/);
assert.equal(await page.locator('.next-bar .btn.primary[aria-disabled="true"]').count(), 1, 'the result waits for every score');
// Rent: 4 2 3; Commute: 2 5 3; Space: 4 3 3
await scoreAll(page, [4, 2, 3, 2, 5, 3, 4, 3, 3]);
await fits(page, 'the scores');
await next(page, '.verdict');
assert.match(page.url(), /\/result$/);
await page.waitForTimeout(1500);
const verdict = await page.locator('.verdict').innerText();
assert.match(verdict, /Maple Street/);
assert.match(verdict, /times in 100/);
assert.equal(await page.locator('.scale .hang').count(), 2, 'two pans on the balance');
const tilt = await page.locator('.scale .beam').evaluate(el => el.style.transform);
assert.match(tilt, /rotate\(-\d/, 'the balance tips towards the winner on the left');
assert.match(await text(page), /would come out ahead if/);
await fits(page, 'the result');

// Gut check.
await page.click('[data-act="flip"]');
await page.locator('#gutAfter:not([hidden])').waitFor({ timeout: 4000 });
await page.click('[data-feel="sad"]');
assert.match(await page.locator('#gutSay').innerText(), /gut|pulling/);

// ---------- Mark asks Sam ----------
await page.click('[data-act="ask"]');
await page.fill('#sheetName', 'Mark');
const ask = await page.locator('#sheetLink').inputValue();
assert.ok(ask.startsWith(base + '#/join/'), 'the link points back to this page');
await page.click('#sheetCopy');
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), ask, 'Copy link copies it');
await page.click('.sheet button[value="close"]');

const sam = await device();
await sam.page.goto(ask);
await sam.page.waitForURL(/\/list$/);
assert.match(await text(sam.page), /Mark is weighing this up/);
assert.equal(await sam.page.locator('ul[data-kind=option] input').count(), 0, 'Sam can’t change the list');
await sam.page.fill('#myname', 'Sam');
await sam.page.click('text=Start weighing');
await sam.page.locator('.ask').waitFor();
await answerAll(sam.page, [-2, 0, 1]);
await next(sam.page, '.pick');
await scoreAll(sam.page, [4, 2, 3, 1, 5, 4, 4, 3, 3]);
await next(sam.page, '.verdict');
assert.match(await sam.page.locator('.verdict').innerText(), /The loft|Birch|Maple/);
await sam.page.click('[data-act="sendback"]');
assert.equal(await sam.page.locator('#sheetName').inputValue(), 'Sam');
const back = await sam.page.locator('#sheetLink').inputValue();
assert.ok(back.startsWith(base + '#/answer/'));

// Sam's link on Sam's phone goes nowhere useful; on Mark's it adds Sam.
await sam.page.goto(back);
await sam.page.locator('text=isn’t on this device').waitFor();
await page.goto(back);
await page.waitForURL(/\/result$/);
await page.waitForTimeout(600);
assert.equal(await page.locator('.voices button').count(), 3, 'Together, You and Sam');
assert.equal(await page.locator('.voices button[aria-pressed="true"]').innerText(), 'Together');
const differ = await text(page);
assert.match(differ, /Where you differ/);
assert.match(differ, /Sam puts (more|less) weight on/);
await page.click('.voices button:has-text("Sam")');
assert.match(await page.locator('.verdict').innerText(), /The loft/, 'Sam’s own result');
await fits(page, 'the result for two');

// Sending the same answers again replaces them rather than adding a second Sam.
await page.goto(back);
await page.waitForURL(/\/result$/);
assert.equal(await page.locator('.people li').count(), 1);

// ---------- Two people, one phone ----------
await page.click('[data-act="hand"]');
await page.click('#sheetGo');
await page.waitForURL(/\/list$/);
await page.fill('#myname', 'Robin');
await page.click('text=Start weighing');
await page.locator('.ask').waitFor();
await answerAll(page, [0]);
await next(page, '.pick');
await scoreAll(page, [3]);
await next(page, '.verdict');
await page.click('[data-act="merge"]');
await page.waitForURL(/\/result$/);
await page.waitForTimeout(400);
assert.equal(await page.locator('.voices button').count(), 4, 'Robin joins');

// Decide.
await page.click('.voices button:has-text("You")');
await page.click('[data-decide]');
assert.equal(await page.locator('.stamp').count(), 1);

// ---------- Home, examples, delete ----------
await page.goto(base + '#/');
await page.locator('.dlist').waitFor();
assert.match(await page.locator('.dlist').innerText(), /Went with Maple Street/);
assert.equal(await page.locator('.dlist li').count(), 1, 'the one-phone copy folded back in');
await page.click('a.example:has-text("long weekend")');
await page.waitForURL(/\/result$/);
assert.match(await text(page), /Ruled out on Weather/);
await page.click('.steps a:has-text("Weigh")');
await page.locator('input[type=range]').first().waitFor();
assert.equal(await page.locator('input[type=range]').count(), 5, 'weights set by hand');
await page.goto(base + '#/');
await page.locator('.del').first().waitFor();
await page.locator('.del').first().click();
assert.equal(await page.locator('.dlist li').count(), 1);
await page.click('.toast button');
assert.equal(await page.locator('.dlist li').count(), 2, 'undo brings it back');

// A backup has every decision in it.
const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
assert.equal(saved.decisions.length, 2);

// Survives a reload, and works offline once it has been opened.
await page.reload();
assert.equal(await page.locator('.dlist li').count(), 2);
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
// The worker leaves other tools' offline copies alone, and clears out its own old ones.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 });
assert.ok(await page.evaluate(() => caches.has('another-tool-v1')), 'the service worker deleted another tool’s offline copy');
assert.equal(await page.evaluate(() => caches.has('on-balance-v0')), false, 'the service worker kept an old copy of its own');
await mark.ctx.setOffline(true);
await page.reload();
assert.match(await text(page), /Your decisions/, 'loads offline');
await mark.ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
