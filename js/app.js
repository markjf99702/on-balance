// The page: which screen to show for the address, the home screen, and opening shared links.
import * as M from './model.js';
import { store } from './store.js';
import { readJoin, readAnswer } from './share.js';
import { makeExample, exampleTitles } from './examples.js';
import { scaleSVG, setTilt } from './scale.js';
import { app, esc, ui, on, go, toast, toastAction, day, names } from './ui.js';
import { list, weigh, score } from './steps.js';
import { result } from './result.js';

const STEPS = { list, weigh, score, result };
const EXAMPLE_NOTES = [
  'Three places, five things that matter, and a second opinion from Sam.',
  'Stay or go. Two choices that come out close.',
  'Weights set by hand, and one choice ruled out by the weather.',
];

let lastPath = null;

// tidy: false when another tab changed what's saved, and this one is only drawing its screen again.
function route(tidy = true) {
  const path = location.hash.replace(/^#\/?/, '');
  const [head, a, b] = path.split('/');
  document.getElementById('allLink').hidden = !head;
  stopIdle();
  if (path !== lastPath) {
    window.scrollTo(0, 0);
    lastPath = path;
  }

  if (head === 'new') {
    const d = M.blankDecision();
    d.options = [{ id: 'a1', name: '' }, { id: 'a2', name: '' }];
    d.criteria = [{ id: 'b1', name: '', color: 0 }, { id: 'b2', name: '', color: 1 }];
    store.put(d);
    return go(`/d/${d.id}/list`, true);
  }
  if (head === 'example' && exampleTitles[a]) {
    const d = makeExample(Number(a));
    store.put(d);
    return go(`/d/${d.id}/result`, true);
  }
  if (head === 'join') return join(a);
  if (head === 'answer') return answer(a);
  if (head === 'd') {
    const d = store.get(a);
    if (!d) return message('That decision isn’t here', 'It may have been deleted, or it was made on another device.');
    const step = STEPS[b] ? b : 'list';
    if (step !== 'list') prune(d);
    document.title = `${d.title || 'Untitled decision'} · On Balance`;
    return STEPS[step](d);
  }
  home(tidy);
}

// Blank rows left on the list are dropped once you move on.
function prune(d) {
  const blankO = d.options.filter(o => !o.name.trim()), blankC = d.criteria.filter(c => !c.name.trim());
  if (!blankO.length && !blankC.length) return;
  blankO.forEach(o => M.removeOption(d, o.id));
  blankC.forEach(c => M.removeCriterion(d, c.id));
  store.put(d);
}

function message(title, text) {
  document.title = 'On Balance';
  app.innerHTML = `
    <div class="card empty" style="margin-top:24px">
      <h2>${esc(title)}</h2>
      <p class="hint">${esc(text)}</p>
      <a class="btn" href="#/">All decisions</a>
    </div>`;
  on({});
}

// Someone sent you their decision to weigh up your way.
function join(data) {
  let j;
  try { j = readJoin(data); } catch { return message('That link didn’t come through whole', 'Ask for it again, or copy all of it into the address bar.'); }
  let d = store.sharedCopy(j.id);
  if (d && !d.shared.local) {
    // They may have changed the list since; keep the answers that still fit.
    const oids = new Set(j.options.map(o => o.id)), cids = new Set(j.criteria.map(c => c.id));
    d.options.filter(o => !oids.has(o.id)).forEach(o => M.removeOption(d, o.id));
    d.criteria.filter(c => !cids.has(c.id)).forEach(c => M.removeCriterion(d, c.id));
    Object.assign(d, { title: j.title, options: j.options, criteria: j.criteria });
    d.shared.from = j.from;
  } else {
    d = M.blankDecision();
    Object.assign(d, { title: j.title, options: j.options, criteria: j.criteria, shared: { id: j.id, from: j.from } });
  }
  store.put(d);
  go(`/d/${d.id}/list`, true);
}

// Someone sent their answers back.
function answer(data) {
  let a;
  try { a = readAnswer(data); } catch { return message('That link didn’t come through whole', 'Ask for it again, or copy all of it into the address bar.'); }
  const d = store.get(a.id);
  if (!d || d.shared) return message('That decision isn’t on this device', 'Answers go back to whoever asked, on the phone or computer they asked from.');
  const replaced = M.addVoice(d, a);
  store.put(d);
  ui.voice[d.id] = 'together';
  go(`/d/${d.id}/result`, true);
  toast(replaced ? `Updated ${a.name}’s answers` : `Added ${a.name}’s answers`);
}

function statusOf(d) {
  const n = names(d);
  if (d.decided && n[d.decided.option]) return `Went with <b>${esc(n[d.decided.option])}</b> · ${day(d.decided.at)}`;
  const p = M.progress(d, d.me);
  if (!p.listed) return 'Still listing the choices';
  if (!p.weighed) return 'Ready to weigh';
  if (p.scored < p.scoresTotal) return `${p.scoresTotal - p.scored} scores to go`;
  const view = d.others.length ? M.togetherView(d) : M.viewOf(d, d.me);
  const alive = M.ranking(d, view).filter(r => !r.out.length);
  if (!alive.length) return 'Everything is ruled out';
  if (alive.length === 1) return `Only <b>${esc(n[alive[0].id])}</b> is left`;
  const v = M.verdict(M.steadiness(d, view, M.hash(d.id + (d.others.length ? 'together' : 'me')))[alive[0].id], alive.length);
  return `${v.label}: <b>${esc(n[alive[0].id])}</b>`;
}

function nextStep(d) {
  const p = M.progress(d, d.me);
  if (!p.listed) return 'list';
  if (d.shared && !p.weighed && !Object.keys(d.me.pairs).length) return 'list';
  if (!p.weighed) return 'weigh';
  if (p.scored < p.scoresTotal) return 'score';
  return 'result';
}

function home(tidy = true) {
  document.title = 'On Balance';
  // A decision started and left without a single word typed isn't worth keeping
  // (unless it's one another tab has only just started).
  for (const d of tidy ? store.all() : []) {
    if (!d.shared && !d.title.trim() && ![...d.options, ...d.criteria].some(x => x.name.trim())) store.remove(d.id);
  }
  const all = store.all();
  app.innerHTML = `
    <section class="hero">
      <div id="heroScale" aria-hidden="true"></div>
      <h1>Weigh up a hard choice.</h1>
      <p>List your choices and what matters to you, then score them. On Balance shows which way it tips, how sure you can be, and what would change it.</p>
      <a class="btn primary" href="#/new">Start a decision</a>
    </section>
    ${all.length ? `
      <h2 class="home-h">Your decisions</h2>
      <ul class="dlist">${all.map(d => `
        <li class="ditem">
          <a href="#/d/${d.id}/${nextStep(d)}">
            <span class="t">${esc(d.title || 'Untitled decision')}</span>
            <span class="s">${d.example ? '<span class="tag">Example</span>' : ''}${d.shared ? `<span class="tag">For ${esc(d.shared.from || 'someone')}</span>` : ''}${d.others.length ? `<span class="tag">With ${esc(d.others.map(o => o.name).join(', '))}</span>` : ''}${statusOf(d)}</span>
          </a>
          <button type="button" class="del" data-del="${d.id}" aria-label="Delete ${esc(d.title || 'untitled decision')}">✕</button>
        </li>`).join('')}
      </ul>` : ''}
    <h2 class="home-h">${all.length ? 'Examples' : 'Or try an example'}</h2>
    <div class="examples">${exampleTitles.map((t, i) => `
      <a class="example" href="#/example/${i}"><b>${esc(t)}</b><span>${EXAMPLE_NOTES[i]}</span></a>`).join('')}
    </div>
    <div class="keep">
      <p>Your decisions stay in this browser. Nothing is sent anywhere unless you share a link.</p>
      <button type="button" class="link-btn" data-act="save"${canSave() ? '' : ' hidden'}>Save a backup</button>
      <label class="link-btn">Load a backup<input type="file" id="loadBackup" accept=".json,application/json"></label>
    </div>`;
  startIdle();

  on({
    click(e) {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.del) {
        const d = store.get(t.dataset.del);
        store.remove(d.id);
        home();
        const deleted = [...(toastAction()?.deleted || []), d];
        const what = deleted.length > 1 ? `${deleted.length} decisions` : `“${d.title || 'Untitled decision'}”`;
        toast(`Deleted ${what}`, { label: 'Undo', deleted, run: () => { deleted.forEach(x => store.put(x)); home(); } });
      } else if (t.dataset.act === 'save') {
        const url = URL.createObjectURL(new Blob([store.backup()], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: `on-balance-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    },
    async change(e) {
      if (e.target.id !== 'loadBackup' || !e.target.files[0]) return;
      let n;
      try {
        n = store.restore(await e.target.files[0].text());
      } catch (err) {
        return toast(err.message.startsWith('That file') ? err.message : 'That file isn’t an On Balance backup.');
      }
      home();
      toast(n ? `Loaded ${n} decision${n === 1 ? '' : 's'}` : 'Nothing new in that backup');
    },
  });
}

// The one-file copy shown inside another page can't start a download.
function canSave() {
  if (!('single' in document.documentElement.dataset)) return true;
  try { return window.top === window.self; } catch { return false; }
}

// The little balance on the home screen, rocking gently.
let idle = 0;
function startIdle() {
  const holder = document.getElementById('heroScale');
  const left = { id: 'l', total: 0.62, parts: { a: 0.3, b: 0.2, c: 0.12 } };
  const right = { id: 'r', total: 0.55, parts: { a: 0.14, b: 0.16, d: 0.25 } };
  const crit = [{ id: 'a', name: '', color: 0 }, { id: 'b', name: '', color: 1 }, { id: 'c', name: '', color: 2 }, { id: 'd', name: '', color: 3 }];
  holder.innerHTML = scaleSVG(left, right, crit, { l: '', r: '' }, '');
  const svg = holder.querySelector('svg');
  svg.classList.add('idle');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setTilt(svg, 3);
  const t0 = performance.now();
  const tick = now => {
    setTilt(svg, 3 + 3.2 * Math.sin((now - t0) / 1100));
    idle = requestAnimationFrame(tick);
  };
  idle = requestAnimationFrame(tick);
}
function stopIdle() { cancelAnimationFrame(idle); }

window.addEventListener('hashchange', () => route());
store.onChange(() => route(false));
route();

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For the screenshot tool and tests: the store, so they can set things up without tapping through.
window.onBalance = { store, M };
