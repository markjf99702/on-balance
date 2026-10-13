// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// One person makes a decision, asks someone else by link, gets their answers back, and checks the rest of the page.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { pack } from '../js/share.js';

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

function watch(page) {
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('requestfailed', r => problems.push('failed: ' + r.url()));
  page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });
  return page;
}

async function device() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = watch(await ctx.newPage());
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
assert.equal(await page.locator('#steps a.done').count(), 0, 'a new decision has no steps ticked');
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
assert.deepEqual(await page.locator('#steps a.done').allInnerTexts(), ['✓\nList'], 'the list is ticked once it has names');
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

// ---------- A link that isn't one of ours ----------
// Ids from a link go into the page's markup as they are, so a link with ids the app didn't make is turned away.
{
  const { ctx, page } = await device();
  await page.goto(base + '#/join/' + pack({ v: 1, id: 'probe', t: 'Probe', f: 'Tester', o: [['void(0)//', 'One'], ['p2', 'Two']], c: [['q" onclick=', 'Cost', 0]] }));
  await page.locator('text=didn’t come through whole').waitFor({ timeout: 5000 });
  await ctx.close();
}

// ---------- A damaged copy, or a backup edited by hand ----------
// Neither may leave the home screen blank.
{
  const { ctx, page } = await device();
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const busOrBike = { id: 'x2', title: 'Bus or bike', options: [{ id: 'a', name: 'Bus' }, { id: 'b', name: 'Bike' }], criteria: [{ id: 'c' }], me: null };
    localStorage.setItem('on-balance', JSON.stringify({ decisions: [null, { id: 'x1' }, busOrBike] }));
  });
  await page.goto(base);
  await page.locator('.dlist').waitFor({ timeout: 5000 });
  assert.match(await page.locator('.dlist').innerText(), /Bus or bike/);
  // A backup whose decision has lost its title.
  const edited = { app: 'on-balance', version: 1, decisions: [{ id: 'h1', options: [{ id: 'a', name: 'Walk' }, { id: 'b', name: 'Drive' }], criteria: [{ id: 'c', name: 'Cost', color: 0 }], me: { pairs: {}, mode: 'pairs', manual: {}, scores: { c: { a: 3, b: 4 } } }, updated: 5 }] };
  await page.locator('#loadBackup').setInputFiles({ name: 'edited.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(edited)) });
  await page.locator('#toast:has-text("Loaded 1 decision")').waitFor({ timeout: 5000 });
  await page.reload();
  await page.locator('.dlist').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('.dlist li').count(), 2, 'both decisions after a reload');
  // A made-up backup can't put markup into the page through a weight set by hand or a score.
  const madeUp = { app: 'on-balance', version: 1, decisions: [{
    id: 'h2', title: 'Made up', updated: 5,
    options: [{ id: 'a', name: 'Walk' }, { id: 'b', name: 'Drive' }],
    criteria: [{ id: 'c', name: 'Cost', color: 0 }, { id: 'e', name: 'Ease', color: 1 }],
    me: { mode: 'manual', pairs: {}, manual: { c: '5" data-planted="', e: 5 }, scores: { c: { a: '3 <b data-planted>', b: 4 }, e: { a: 3, b: 4 } } },
    others: [{ name: 'Sam', at: 5, mode: 'pairs', pairs: { 'c|e': 1 }, manual: {}, scores: { c: { a: 0, b: 4 }, e: { a: 3, b: 4 } } }],
  }] };
  await page.locator('#loadBackup').setInputFiles({ name: 'made-up.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(madeUp)) });
  await page.locator('#toast:has-text("Loaded 1 decision")').waitFor({ timeout: 5000 });
  for (const step of ['weigh', 'result']) {
    await page.goto(base + `#/d/h2/${step}`);
    await page.locator('#steps').waitFor();
    assert.equal(await page.locator('[data-planted]').count(), 0, `nothing in the backup's answers is planted on ${step}`);
  }
  await ctx.close();
}

// ---------- Two tabs ----------
// Each tab carries on from what the other saved, rather than saving its own older copy over it.
{
  const { ctx, page: a } = await device();
  const b = watch(await ctx.newPage());
  await a.goto(base + '#/example/1');
  await a.locator('.verdict').waitFor();
  const id = await a.evaluate(() => location.hash.split('/')[2]);
  const d = await a.evaluate(id => window.onBalance.store.get(id), id);
  const threes = Object.fromEntries(d.criteria.map(c => [c.id, Object.fromEntries(d.options.map(o => [o.id, 3]))]));
  // Sam's answers come back, and open in a second tab, as tapping a link in a message does.
  await b.goto(base + '#/answer/' + pack({ v: 1, id, n: 'Sam', m: 'pairs', p: {}, h: {}, s: threes }));
  await b.waitForURL(/\/result$/);
  // The first tab, still on the result, shows them too, and deciding there keeps them.
  await a.locator('.voices button:has-text("Sam")').waitFor({ timeout: 5000 });
  await a.click('[data-decide]');
  const saved = await b.evaluate(id => JSON.parse(localStorage.getItem('on-balance')).decisions.find(x => x.id === id), id);
  assert.deepEqual(saved.others.map(o => o.name), ['Sam'], 'deciding in the first tab kept Sam’s answers');
  assert.ok(saved.decided, 'and it’s decided');
  // A choice added to the list in one tab stays there to be filled in while the other tab shows the result.
  await b.goto(base + `#/d/${id}/list`);
  await b.click('[data-add="option"]');
  await b.waitForTimeout(300);
  assert.equal(await b.locator('ul[data-kind=option] li').count(), 3, 'a choice added while the other tab shows the result stays');
  assert.equal(await b.evaluate(() => document.activeElement.matches('ul[data-kind=option] li:last-child input')), true, 'with the focus in it');
  await b.locator('ul[data-kind=option] li:last-child input').fill('Go freelance');
  // A decision started in one tab while the other sits on the home screen isn't tidied away or saved over.
  await a.goto(base + '#/');
  await a.locator('.dlist').waitFor();
  await b.goto(base + '#/new');
  await b.locator('#title').waitFor();
  await a.waitForTimeout(300);
  await b.fill('#title', 'Paint the hall');
  await a.locator('.dlist li:has-text("Paint the hall")').waitFor({ timeout: 5000 });
  await a.locator('.ditem:has-text("Northwind") .del').click();
  assert.deepEqual(await b.evaluate(() => JSON.parse(localStorage.getItem('on-balance')).decisions.map(x => x.title)), ['Paint the hall']);
  assert.match(await b.locator('main').innerText(), /What are you deciding/);
  await ctx.close();
}

// ---------- A quick second tap on ✕ ----------
// Once the first row has gone, a second tap lands on the next row's ✕: one Undo brings both back.
{
  const { ctx, page } = await device();
  for (const i of [0, 1, 2]) {
    await page.goto(base + `#/example/${i}`);
    await page.locator('.verdict').waitFor();
  }
  await page.goto(base + '#/');
  await page.locator('.dlist').waitFor();
  await page.locator('.del').first().tap();
  await page.locator('.del').first().tap();
  assert.equal(await page.locator('.dlist li').count(), 1);
  assert.match(await page.locator('#toast').innerText(), /Deleted 2 decisions/);
  await page.click('#toast button');
  assert.equal(await page.locator('.dlist li').count(), 3, 'one Undo brings both decisions back');
  // The same for other people's answers on a result.
  await page.click('.dlist a:has-text("Which apartment")');
  await page.locator('.verdict').waitFor();
  const id = await page.evaluate(() => location.hash.split('/')[2]);
  const d = await page.evaluate(id => window.onBalance.store.get(id), id);
  const threes = Object.fromEntries(d.criteria.map(c => [c.id, Object.fromEntries(d.options.map(o => [o.id, 3]))]));
  await page.goto(base + '#/answer/' + pack({ v: 1, id, n: 'Robin', m: 'pairs', p: {}, h: {}, s: threes }));
  await page.locator('.people li:has-text("Robin")').waitFor();
  await page.locator('.people .x').first().tap();
  await page.locator('.people .x').first().tap();
  assert.match(await page.locator('#toast').innerText(), /Removed Sam’s and Robin’s answers/);
  await page.click('#toast button');
  assert.equal(await page.locator('.people li').count(), 2, 'one Undo brings both people’s answers back');
  // Undo after moving on to another screen puts things back without drawing over that screen.
  await page.locator('.people .x').first().tap();
  await page.click('.steps a:has-text("Score")');
  await page.locator('.pick').first().waitFor();
  await page.click('#toast button');
  assert.equal(await page.locator('.pick').count() > 0, true, 'still on the scores after Undo');
  assert.equal(await page.evaluate(id => window.onBalance.store.get(id).others.length, id), 2);
  await page.goto(base + '#/');
  await page.locator('.del').first().click();
  await page.locator('.dlist a').first().click();
  await page.locator('.verdict').waitFor();
  await page.click('#toast button');
  assert.equal(await page.locator('.verdict').count(), 1, 'still on the result after Undo');
  assert.equal(await page.evaluate(() => window.onBalance.store.all().length), 3);
  await ctx.close();
}

// ---------- Weigh and Score wait for the list ----------
{
  const { ctx, page } = await device();
  await page.goto(base + '#/new');
  await page.locator('#title').waitFor();
  for (const step of ['Weigh', 'Score']) {
    await page.click(`.steps a:has-text("${step}")`);
    await page.locator('#body:has-text("Not ready yet")').waitFor({ timeout: 5000 });
    assert.match(await text(page), /Name at least two choices and one thing that matters/);
    assert.equal(await page.locator('#next').isHidden(), true, `${step} offers no way on`);
  }
  await page.click('text=Finish the list');
  await page.locator('#title').waitFor();
  assert.equal(await page.locator('ul.rows input').count(), 4, 'the blank rows are still there to fill in');
  await ctx.close();
}

// ---------- Enter in a sheet's name field ----------
// As a phone keyboard's Go key: the link sheet stays open, and the hand-over sheet hands it over.
{
  const { ctx, page } = await device();
  await page.goto(base + '#/example/1');
  await page.locator('.verdict').waitFor();
  await page.click('[data-act="ask"]');
  await page.fill('#sheetName', 'Mark');
  await page.press('#sheetName', 'Enter');
  assert.equal(await page.locator('#sheet').evaluate(d => d.open), true, 'Enter keeps the link sheet open');
  await page.click('.sheet button[value="close"]');
  await page.click('[data-act="hand"]');
  await page.fill('#sheetName', 'Ana');
  await page.press('#sheetName', 'Enter');
  await page.locator('#myname').waitFor({ timeout: 5000 });
  assert.match(await text(page), /Ana is weighing this up/);
  await ctx.close();
}

// ---------- The little balance on the home screen ----------
// It rocks on one animation loop however often home is drawn, and stops once home is left.
{
  const { ctx, page } = await device();
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
    const waiting = new Set();
    window.requestAnimationFrame = cb => { const id = raf(t => { waiting.delete(id); cb(t); }); waiting.add(id); return id; };
    window.cancelAnimationFrame = id => { waiting.delete(id); caf(id); };
    window.loops = () => waiting.size;
  });
  for (const i of [1, 2]) {
    await page.goto(base + `#/example/${i}`);
    await page.locator('.verdict').waitFor();
  }
  await page.goto(base + '#/');
  await page.locator('.dlist').waitFor();
  for (let i = 0; i < 3; i++) {
    await page.locator('.del').first().click();
    await page.click('#toast button');
  }
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.loops()), 1, 'one loop rocks the home balance');
  await page.locator('.dlist a').first().click();
  await page.locator('.verdict').waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.loops()), 0, 'no loop left running after home');
  await ctx.close();
}

// ---------- Load a backup, from the keyboard ----------
// Its file field is hidden behind the words, so the words show the focus.
{
  const { ctx, page } = await device();
  await page.goto(base);
  await page.locator('.keep').waitFor();
  const focused = () => page.evaluate(() => document.activeElement?.id);
  for (let i = 0; i < 30 && await focused() !== 'loadBackup'; i++) await page.keyboard.press('Tab');
  assert.equal(await focused(), 'loadBackup');
  assert.equal(await page.locator('.keep label').evaluate(el => getComputedStyle(el).outlineStyle), 'solid', 'Load a backup shows it has the focus');
  await ctx.close();
}

// ---------- Without JavaScript ----------
// The page says what it needs, in the page, above the footer.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base);
  const [said, foot] = [await page.locator('.noscript').boundingBox(), await page.locator('.jd-foot').boundingBox()];
  assert.ok(said.y + said.height <= foot.y, 'the message comes before the footer');
  await ctx.close();
}

// ---------- The next step's button on a phone ----------
// Its arrow stays with the words while the note beside it wraps.
{
  const { ctx, page } = await device();
  await page.goto(base + '#/new');
  await page.locator('#title').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const lines = await page.locator('.next-bar .btn.primary').evaluate(el => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size;
  });
  assert.equal(lines, 1, 'Next: weigh them → is on one line');
  await ctx.close();
}

// ---------- Answers that go round a circle of four ----------
{
  const { ctx, page } = await device();
  await page.goto(base);
  const id = await page.evaluate(() => {
    const { store, M } = window.onBalance;
    const d = M.blankDecision();
    d.title = 'Which flat?';
    d.options = [{ id: 'o1', name: 'Top floor' }, { id: 'o2', name: 'Garden flat' }];
    d.criteria = ['Cost', 'Space', 'Risk', 'Looks'].map((name, i) => ({ id: `c${i}`, name, color: i }));
    for (const [a, b] of [['c0', 'c1'], ['c3', 'c2'], ['c2', 'c0'], ['c1', 'c3']]) M.setPair(d.me.pairs, a, b, 1);
    d.me.enough = true; // Skip the rest
    store.put(d);
    return d.id;
  });
  await page.goto(base + `#/d/${id}/weigh`);
  await page.locator('.notice').waitFor({ timeout: 5000 });
  assert.match(await page.locator('.notice').innerText(), /in a circle: Cost over Space, Space over Looks, Looks over Risk, but Risk over Cost\./);
  await ctx.close();
}

// ---------- Weighing from the keyboard ----------
// After an answer, the focus waits on the same answer to the next question, instead of going back to the top.
{
  const { ctx, page } = await device();
  await page.goto(base + '#/example/0');
  await page.locator('.verdict').waitFor();
  const id = await page.evaluate(() => location.hash.split('/')[2]);
  await page.evaluate(id => { const { store } = window.onBalance; const d = store.get(id); d.me.pairs = {}; store.put(d); }, id);
  await page.goto(base + `#/d/${id}/weigh`);
  await page.locator('.ask').waitFor();
  await page.locator('.five button[data-v="1"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('.ask-top span:has-text("2 of 10")').waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate(() => document.activeElement.matches('.five button[data-v="1"]')), true, 'the focus is on the next question’s answer');
  await page.keyboard.press('Enter');
  await page.locator('.ask-top span:has-text("3 of 10")').waitFor({ timeout: 5000 });
  await ctx.close();
}

// ---------- Passing the phone to the same person twice ----------
// Their second answers replace the first, and the toast says so.
{
  const { ctx, page } = await device();
  await page.goto(base + '#/example/1');
  await page.locator('.verdict').waitFor();
  const id = await page.evaluate(() => location.hash.split('/')[2]);
  for (const said of ['Added', 'Updated']) {
    const copyId = await page.evaluate(id => {
      const { store, M } = window.onBalance;
      const d = store.get(id), copy = M.blankDecision();
      Object.assign(copy, { title: d.title, options: d.options.map(o => ({ ...o })), criteria: d.criteria.map(c => ({ ...c })), me: structuredClone(d.me) });
      copy.shared = { id, from: 'Mark', local: true, name: 'Robin' };
      store.put(copy);
      return copy.id;
    }, id);
    await page.goto(base + `#/d/${copyId}/result`);
    await page.click('[data-act="merge"]');
    await page.locator(`#toast:has-text("${said} Robin’s answers")`).waitFor({ timeout: 5000 });
  }
  assert.equal(await page.evaluate(id => window.onBalance.store.get(id).others.length, id), 1);
  await ctx.close();
}

// ---------- Two choices that come out level ----------
// Only a change to a score can separate two that score the same on everything.
{
  const { ctx, page } = await device();
  await page.goto(base);
  const id = await page.evaluate(() => {
    const { store, M } = window.onBalance;
    const d = M.blankDecision();
    d.title = 'Which sofa?';
    d.options = [{ id: 'a', name: 'Grey sofa' }, { id: 'b', name: 'Green sofa' }];
    d.criteria = [{ id: 'x', name: 'Comfort', color: 0 }, { id: 'y', name: 'Price', color: 1 }, { id: 'z', name: 'Size', color: 2 }];
    M.setPair(d.me.pairs, 'x', 'y', 1);
    M.setPair(d.me.pairs, 'y', 'z', 1);
    M.setPair(d.me.pairs, 'x', 'z', 2);
    d.me.scores = { x: { a: 4, b: 4 }, y: { a: 3, b: 3 }, z: { a: 2, b: 2 } };
    store.put(d);
    return d.id;
  });
  await page.goto(base + `#/d/${id}/result`);
  await page.locator('.flip-list').waitFor();
  assert.match(await page.locator('.flip-list').innerText(), /They score the same on everything, so only a change to a score would tip it/);
  assert.doesNotMatch(await page.locator('.sure').innerText(), /still/, 'nothing still wins when they’re level');
  await ctx.close();
}

// ---------- A weight that needs to move less than a point ----------
// Hassle counts for 26.5%, and 27% would tip it: the page mustn't say "27% instead of 27%".
{
  const { ctx, page } = await device();
  await page.goto(base);
  const id = await page.evaluate(() => {
    const { store, M } = window.onBalance;
    const d = M.blankDecision();
    d.title = 'Getting to work';
    d.options = ['Bus pass', 'Bike', 'Car share', 'Walk', 'Scooter'].map((name, i) => ({ id: `o${i}`, name }));
    d.criteria = ['Cost', 'Time', 'Weather', 'Exercise', 'Hassle'].map((name, i) => ({ id: `c${i}`, name, color: i }));
    d.me.pairs = { 'c0|c1': -1, 'c2|c3': -2, 'c0|c4': 0, 'c1|c2': 2, 'c3|c4': -2, 'c0|c2': 0, 'c1|c3': 1, 'c1|c4': 1, 'c0|c3': -1, 'c2|c4': -2 };
    d.me.scores = { c0: { o0: 3, o1: 3, o2: 3, o3: 1, o4: 5 }, c1: { o0: 5, o1: 2, o2: 2, o3: 3, o4: 2 }, c2: { o0: 1, o1: 4, o2: 5, o3: 1, o4: 4 }, c3: { o0: 1, o1: 2, o2: 2, o3: 4, o4: 4 }, c4: { o0: 2, o1: 2, o2: 5, o3: 4, o4: 3 } };
    store.put(d);
    return d.id;
  });
  await page.goto(base + `#/d/${id}/result`);
  await page.locator('.flip-list').waitFor();
  assert.match(await page.locator('.flip-list').innerText(), /Car share would come out ahead if Hassle counted for 27% instead of 26\.5%\./);
  await ctx.close();
}

// ---------- Long names on a phone ----------
// A long thing that matters keeps its dot beside it on Score, and long choices stay on the coin.
{
  const { ctx, page } = await device();
  await page.goto(base);
  const id = await page.evaluate(() => {
    const { store, M } = window.onBalance;
    const d = M.blankDecision();
    d.title = 'Where to live';
    d.options = [{ id: 'a', name: 'The little house at the end of Cherry Tree Lane with the green door' }, { id: 'b', name: 'Maybe the flat above the bakery on High Street' }];
    d.criteria = [{ id: 'x', name: 'How long the commute takes on a bad day', color: 0 }, { id: 'y', name: 'Rent', color: 1 }];
    M.setPair(d.me.pairs, 'x', 'y', 1);
    d.me.scores = { x: { a: 5, b: 3 }, y: { a: 3, b: 4 } };
    store.put(d);
    return d.id;
  });
  await page.goto(base + `#/d/${id}/score`);
  await page.locator('.crit h2').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const [dot, name] = await page.locator('.crit h2').first().evaluate(h => {
    const walk = document.createTreeWalker(h, NodeFilter.SHOW_TEXT, { acceptNode: t => (t.data.trim() && !t.parentElement.closest('.aside') ? 1 : 3) });
    const words = document.createRange();
    words.selectNodeContents(walk.nextNode());
    const middle = r => r.top + r.height / 2;
    return [middle(h.querySelector('.dot').getBoundingClientRect()), middle(words.getClientRects()[0])];
  });
  assert.ok(Math.abs(dot - name) < 6, `the dot sits beside the name's first line (dot at ${dot}, line at ${name})`);
  await page.goto(base + `#/d/${id}/result`);
  await page.locator('#coin').waitFor();
  for (const face of await page.locator('#coin .face').all()) {
    assert.ok(await face.evaluate(el => el.scrollHeight <= el.clientHeight), 'a long name stays on the coin');
  }
  await fits(page, 'the result with long names');
  await ctx.close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
