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
export const pct = w => `${Math.round(w * 100)}%`;
export const day = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const names = d => Object.fromEntries([...d.options, ...d.criteria].map(x => [x.id, x.name]));
export const fromName = d => d.shared?.from || 'Whoever asked';

// One set of listeners on the page; each screen says what they do.
let handlers = {};
export function on(h) { handlers = h; }
for (const type of ['click', 'input', 'change', 'keydown']) {
  app.addEventListener(type, e => handlers[type]?.(e));
}

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
}

export function refresh(d, step, next) {
  document.getElementById('steps').innerHTML = stepsHTML(d, step);
  if (next !== undefined) {
    const bar = document.getElementById('next');
    bar.innerHTML = next;
    bar.hidden = !next;
  }
}

let toastTimer;
export function toast(message, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2600);
}

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
  } catch {
    field?.select();
    document.execCommand?.('copy');
  }
  toast('Link copied');
}
