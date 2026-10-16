// Small pieces every screen uses: escaping, the decision header and steps, the bar at the bottom,
// the toast, the share sheet, and one set of event handlers for whichever screen is showing.
import * as M from './model.js';

export const app = document.getElementById('app');

export const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Things that only matter while the page is open: which question you're on, whose view of the result, and so on.
export const ui = { q: {}, voice: {}, tilt: {}, coin: {} };

export function go(path, replace = false) {
  const hash = '#' + path;
  if (replace) location.replace(hash); else location.hash = hash;
}

export const dot = c => `<i class="dot" style="--dc:var(--c${c.color})" aria-hidden="true"></i>`;
// A criterion's name in bold with its colour dot, kept on the same line as the first word.
export const tagged = c => {
  const [first, ...rest] = esc(c.name).split(' ');
  return `<span class="nw">${dot(c)}<b>${first}</b></span>${rest.length ? `<b> ${rest.join(' ')}</b>` : ''}`;
};
export const day = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const names = d => Object.fromEntries([...d.options, ...d.criteria].map(x => [x.id, x.name]));
export const fromName = d => d.shared?.from || 'Whoever asked';

// One set of listeners on the page; each screen says what they do.
let handlers = {};
export function on(h) { handlers = h; }
for (const type of ['click', 'input', 'change', 'keydown']) {
  app.addEventListener(type, e => handlers[type]?.(e));
}

// Answers and scores are radio buttons, and each set of them is one Tab stop: the one chosen, or the first when
// none is. The arrow keys move along the set and choose, as screen readers say radio buttons do.
export function rove(set, stop = set.querySelector('[role=radio][aria-checked="true"]') || set.querySelector('[role=radio]')) {
  for (const b of set.querySelectorAll('[role=radio]')) b.tabIndex = b === stop ? 0 : -1;
}
let arrowed = false;
// True while the arrow keys are choosing, so a screen can choose without moving on, as it would for a tap.
export const byArrows = () => arrowed;
app.addEventListener('focusin', e => {
  const set = e.target.closest?.('[role=radiogroup]');
  if (set && e.target.matches('[role=radio]')) rove(set, e.target);
});
app.addEventListener('keydown', e => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  const set = e.target.closest?.('[role=radiogroup]');
  if (!step || !set || !e.target.matches('[role=radio]') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  const all = [...set.querySelectorAll('[role=radio]')];
  const next = all[(all.indexOf(e.target) + step + all.length) % all.length];
  next.focus();
  arrowed = true;
  try { next.click(); } finally { arrowed = false; }
});

const STEPS = [['list', 'List'], ['weigh', 'Weigh'], ['score', 'Score'], ['result', 'Result']];

function stepsHTML(d, step) {
  const p = M.progress(d, d.me);
  const done = { list: p.listed, weigh: p.listed && p.weighed, score: p.listed && p.scoresTotal > 0 && p.scored === p.scoresTotal, result: !!d.decided };
  return STEPS.map(([key, label], i) => {
    const cls = [key === step && 'here', done[key] && 'done'].filter(Boolean).join(' ');
    return `<a href="#/d/${d.id}/${key}" class="${cls}"${key === step ? ' aria-current="step"' : ''}><i aria-hidden="true">${done[key] ? '✓' : i + 1}</i>${label}</a>`;
  }).join('');
}

// Draws a decision screen: the title, the four steps, the body, and the bar with the next step.
export function frame(d, step, body, next = '') {
  app.innerHTML = `
    <div class="dhead">
      ${d.shared ? `<p class="from">${esc(fromName(d))} wants your take</p>` : ''}
      <h1 id="dtitle" class="${d.title ? '' : 'untitled'}">${esc(d.title || 'Untitled decision')}</h1>
      <nav class="steps" id="steps" aria-label="Steps">${stepsHTML(d, step)}</nav>
    </div>
    <div id="body">${body}</div>
    <div class="next-bar" id="next"${next ? '' : ' hidden'}>${next}</div>`;
  for (const set of app.querySelectorAll('[role=radiogroup]')) rove(set);
}

// What a step shows until the steps it needs are done.
export function notReady(d, step) {
  const p = M.progress(d, d.me);
  const todo = !p.listed ? ['list', 'Finish the list', 'Name at least two choices and one thing that matters.']
    : !p.weighed ? ['weigh', 'Weigh what matters', 'Answer a few more questions about what matters more.']
    : ['score', 'Score the rest', `${p.scoresTotal - p.scored} of ${p.scoresTotal} scores still to fill in.`];
  frame(d, step, `
    <div class="card empty">
      <h2>Not ready yet</h2>
      <p class="hint">${todo[2]}</p>
      <a class="btn primary" href="#/d/${d.id}/${todo[0]}">${todo[1]} →</a>
    </div>`);
  on({});
}

export function refresh(d, step, next) {
  document.getElementById('steps').innerHTML = stepsHTML(d, step);
  if (next !== undefined) {
    const bar = document.getElementById('next');
    bar.innerHTML = next;
    bar.hidden = !next;
  }
}

let toastTimer, showing = null, waiting = null;
export function toast(message, action, ms = action ? 6000 : 2600) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  showing = action || null;
  const gone = () => { el.hidden = true; showing = null; };
  if (action) el.querySelector('button').onclick = () => { gone(); action.run(); toastWaiting(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { gone(); toastWaiting(); }, ms);
}
// The action on the toast that's showing, if there is one: a second delete while it's up joins the first,
// so one Undo brings both back (a quick second tap lands on the next row's ✕).
export const toastAction = () => showing;

// A toast that mustn't be missed: it waits until nothing covers it, after any toast the same tap brings up
// (and that toast's Undo), and until the share sheet is closed.
export function toastSoon(message) {
  waiting = message;
  setTimeout(toastWaiting);
}
function toastWaiting() {
  if (!waiting || !document.getElementById('toast').hidden || document.getElementById('sheet').open) return;
  const message = waiting;
  waiting = null;
  toast(message, null, 8000);
}
document.getElementById('sheet').addEventListener('close', toastWaiting);

// The sheet that slides up for sharing. bind() wires up what's inside once it's drawn.
export function sheet(html, bind) {
  const dlg = document.getElementById('sheet');
  const body = dlg.querySelector('.sheet-body');
  body.innerHTML = html;
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  bind?.(body, () => dlg.close?.() ?? dlg.removeAttribute('open'));
}

export async function copy(text, field) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    // Some browsers and embedded views refuse the clipboard: select the link so it can be copied by hand.
    field?.focus();
    field?.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { /* not allowed here either */ }
    toast(done ? 'Link copied' : 'The link is selected. Copy it from there.');
  }
}
