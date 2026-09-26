// The first three steps: list the choices and what matters, weigh what matters, score the choices.
import * as M from './model.js';
import { store } from './store.js';
import { esc, dot, pct, ui, frame, refresh, on, fromName } from './ui.js';

const IDEAS = ['Cost', 'Time', 'Where it is', 'Quality', 'Space', 'Fun', 'Risk', 'Hassle', 'The people', 'Growth', 'Looks', 'Stress', 'Health', 'Family'];

const named = list => list.filter(x => x.name.trim());

// ---------- List ----------

function listNext(d) {
  const o = named(d.options).length, c = named(d.criteria).length;
  const note = o < 2 ? 'Name at least two choices.' : c < 1 ? 'Add at least one thing that matters.' : '';
  return `<span class="note">${note}</span><a class="btn primary" href="#/d/${d.id}/weigh"${note ? ' aria-disabled="true" tabindex="-1"' : ''}>Next: weigh them →</a>`;
}

function rowsHTML(list, kind) {
  return list.map((x, i) => `
    <li data-id="${x.id}">
      ${kind === 'criterion' ? dot(x) : ''}
      <input class="input" value="${esc(x.name)}" maxlength="80" autocomplete="off" enterkeyhint="next"
        placeholder="${kind === 'option' ? `Choice ${i + 1}` : ['Say, cost', 'Say, time', 'Say, the people'][i] || 'Something that matters'}"
        aria-label="${kind === 'option' ? 'Choice' : 'Something that matters'} ${i + 1}">
      <button type="button" class="x" data-remove="${kind}" aria-label="Remove${x.name ? ' ' + esc(x.name) : ''}">✕</button>
    </li>`).join('');
}

export function list(d, focus) {
  if (d.shared) return welcome(d);
  const ideas = IDEAS.filter(n => !d.criteria.some(c => c.name.trim().toLowerCase() === n.toLowerCase()));
  frame(d, 'list', `
    <div class="card">
      <label class="field"><span>What are you deciding?</span>
        <input class="input title-input" id="title" value="${esc(d.title)}" maxlength="120" autocomplete="off" placeholder="Which apartment to rent">
      </label>
    </div>
    <div class="card">
      <h2>The choices <span class="aside">${d.options.length} of ${M.MAX_OPTIONS}</span></h2>
      <p class="hint">At least two. If doing nothing is one of them, put it in.</p>
      <ul class="rows" data-kind="option">${rowsHTML(d.options, 'option')}</ul>
      <button type="button" class="add" data-add="option"${d.options.length >= M.MAX_OPTIONS ? ' hidden' : ''}>+ Add a choice</button>
    </div>
    <div class="card">
      <h2>What matters <span class="aside">${d.criteria.length} of ${M.MAX_CRITERIA}</span></h2>
      <p class="hint">What you’ll weigh them on. Keep each one separate: if two always go together, make them one.</p>
      <ul class="rows" data-kind="criterion">${rowsHTML(d.criteria, 'criterion')}</ul>
      <button type="button" class="add" data-add="criterion"${d.criteria.length >= M.MAX_CRITERIA ? ' hidden' : ''}>+ Add something that matters</button>
      ${d.criteria.length < M.MAX_CRITERIA && ideas.length ? `<div class="chips"><span>Ideas</span>${ideas.map(n => `<button type="button" class="chip" data-idea="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
    </div>`, listNext(d));

  if (focus) {
    const input = document.querySelector(`li[data-id="${focus}"] input`);
    input?.focus();
  }

  const save = () => { store.put(d); refresh(d, 'list', listNext(d)); };
  const add = (kind, name = '') => {
    if (kind === 'option') {
      if (d.options.length >= M.MAX_OPTIONS) return;
      const id = M.newId([...d.options, ...d.criteria].map(x => x.id));
      d.options.push({ id, name });
      return id;
    }
    const blank = d.criteria.find(c => !c.name.trim());
    if (blank && name) { blank.name = name; return blank.id; }
    if (d.criteria.length >= M.MAX_CRITERIA) return;
    const id = M.newId([...d.options, ...d.criteria].map(x => x.id));
    d.criteria.push({ id, name, color: M.nextColor(d.criteria) });
    return id;
  };

  on({
    input(e) {
      const t = e.target;
      if (t.id === 'title') {
        d.title = t.value;
        const h = document.getElementById('dtitle');
        h.textContent = d.title.trim() || 'Untitled decision';
        h.classList.toggle('untitled', !d.title.trim());
        return save();
      }
      const li = t.closest('li[data-id]');
      if (!li) return;
      const kind = li.parentElement.dataset.kind;
      const item = (kind === 'option' ? d.options : d.criteria).find(x => x.id === li.dataset.id);
      if (item) { item.name = t.value; save(); }
    },
    keydown(e) {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      const li = e.target.closest('li[data-id]');
      if (!li) { document.querySelector('.rows input')?.focus(); return; }
      const next = li.nextElementSibling?.querySelector('input');
      if (next) return next.focus();
      if (!e.target.value.trim()) return;
      const id = add(li.parentElement.dataset.kind);
      store.put(d);
      if (id) list(d, id);
    },
    click(e) {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.remove) {
        const id = t.closest('li').dataset.id;
        if (t.dataset.remove === 'option') M.removeOption(d, id); else M.removeCriterion(d, id);
        store.put(d);
        list(d);
      } else if (t.dataset.add) {
        const id = add(t.dataset.add);
        store.put(d);
        list(d, id);
      } else if (t.dataset.idea) {
        add('criterion', t.dataset.idea);
        store.put(d);
        list(d);
      }
    },
  });
}

// What someone sees when they open a link asking for their take.
function welcome(d) {
  const from = fromName(d);
  frame(d, 'list', `
    <div class="card">
      <p class="lede">${d.shared.from ? `${esc(from)} is weighing this up and wants to know how you’d weigh it.` : 'You’ve been asked how you’d weigh this up.'}
        You’ll say what matters more to you and score each choice your way. Nobody sees your answers unless you send them back.</p>
      <label class="field"><span>Your name</span>
        <input class="input" id="myname" value="${esc(d.shared.name ?? (d.shared.local ? '' : store.name))}" maxlength="40" autocomplete="given-name" placeholder="So they know who answered">
      </label>
    </div>
    <div class="card">
      <h2>The choices</h2>
      <ul class="readonly">${d.options.map(o => `<li>${esc(o.name)}</li>`).join('')}</ul>
    </div>
    <div class="card">
      <h2>What matters</h2>
      <ul class="readonly">${d.criteria.map(c => `<li>${dot(c)}${esc(c.name)}</li>`).join('')}</ul>
    </div>`,
  `<a class="btn primary" href="#/d/${d.id}/weigh">Start weighing →</a>`);
  on({
    input(e) {
      if (e.target.id !== 'myname') return;
      d.shared.name = e.target.value.trim();
      if (!d.shared.local) store.name = d.shared.name;
      store.put(d);
    },
  });
}

// ---------- Weigh ----------

const SIZES = { big: { 2: 46, 1: 34, 0: 24 }, mini: { 2: 20, 1: 15, 0: 11 } };

function five(a, b, current, size) {
  const label = { 2: `${a.name} matters much more`, 1: `${a.name} matters more`, 0: 'They matter the same', '-1': `${b.name} matters more`, '-2': `${b.name} matters much more` };
  const words = { 2: 'Much more', 1: 'More', 0: 'Same', '-1': 'More', '-2': 'Much more' };
  return [2, 1, 0, -1, -2].map(v => {
    const sc = v > 0 ? `--sc:var(--c${a.color});` : v < 0 ? `--sc:var(--c${b.color});` : '';
    return `<button type="button" role="radio" data-v="${v}" aria-checked="${current === v}" aria-label="${esc(label[v])}" style="${sc}--sz:${SIZES[size][Math.abs(v)]}px"><i></i>${size === 'big' ? `<span>${words[v]}</span>` : ''}</button>`;
  }).join('');
}

function weighNext(d) {
  const p = M.progress(d, d.me);
  const note = p.weighed ? '' : 'Answer a few more to link everything up.';
  return `<span class="note">${note}</span><a class="btn primary" href="#/d/${d.id}/score"${note ? ' aria-disabled="true" tabindex="-1"' : ''}>Next: score them →</a>`;
}

export function weigh(d) {
  const v = d.me;
  const crit = Object.fromEntries(d.criteria.map(c => [c.id, c]));
  const ids = d.criteria.map(c => c.id);

  if (ids.length < 2) {
    frame(d, 'weigh', `
      <div class="card empty">
        <h2>Nothing to weigh</h2>
        <p class="hint">With only one thing that matters, it counts for everything. Add more on the list if there’s more to it.</p>
        <a class="btn" href="#/d/${d.id}/list">Back to the list</a>
      </div>`, weighNext(d));
    return on({});
  }

  if (v.mode === 'manual') return sliders(d);

  const schedule = M.pairSchedule(ids);
  const open = schedule.map((p, i) => (M.getPair(v.pairs, ...p) === undefined ? i : -1)).filter(i => i >= 0);
  if (ui.q[d.id] === undefined && open.length && (!v.enough || !M.isConnected(ids, v.pairs))) ui.q[d.id] = open[0];
  const qi = ui.q[d.id];

  if (qi !== undefined && qi < schedule.length) {
    const [a, b] = schedule[qi].map(id => crit[id]);
    const current = M.getPair(v.pairs, a.id, b.id);
    const connected = M.isConnected(ids, v.pairs);
    frame(d, 'weigh', `
      <div class="card ask">
        <div class="ask-top"><span>${qi + 1} of ${schedule.length}</span><div class="meter"><i style="width:${(100 * (schedule.length - open.length)) / schedule.length}%"></i></div></div>
        <h2 id="q">Which matters more to you here?</h2>
        <div class="versus">
          <div class="side">${dot(a)}<b>${esc(a.name)}</b></div>
          <span class="vs">or</span>
          <div class="side">${dot(b)}<b>${esc(b.name)}</b></div>
        </div>
        <div class="five" role="radiogroup" aria-labelledby="q">${five(a, b, current, 'big')}</div>
        <div class="ask-nav">
          <button type="button" class="link-btn" data-go="back"${qi === 0 ? ' hidden' : ''}>← Back</button>
          <button type="button" class="link-btn" data-go="enough"${connected && open.length ? '' : ' hidden'}>Skip the rest</button>
        </div>
      </div>
      <p class="hint" style="text-align:center">${connected && open.length ? 'That’s enough to work the weights out. The rest fine-tune them.' : 'Go with your first thought. You can change any answer after.'}</p>`,
    weighNext(d));

    on({
      click(e) {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.v !== undefined) {
          M.setPair(v.pairs, a.id, b.id, Number(t.dataset.v));
          store.put(d);
          document.querySelectorAll('.five button').forEach(btn => btn.setAttribute('aria-checked', btn === t));
          const later = schedule.map((p, i) => i).filter(i => i > qi && M.getPair(v.pairs, ...schedule[i]) === undefined);
          const earlier = schedule.map((p, i) => i).filter(i => i < qi && M.getPair(v.pairs, ...schedule[i]) === undefined);
          const nextQ = later[0] ?? earlier[0];
          setTimeout(() => {
            ui.q[d.id] = nextQ;
            if (nextQ === undefined) v.enough = false;
            weigh(d);
          }, 220);
        } else if (t.dataset.go === 'back') {
          ui.q[d.id] = Math.max(0, qi - 1);
          weigh(d);
        } else if (t.dataset.go === 'enough') {
          v.enough = true;
          ui.q[d.id] = undefined;
          store.put(d);
          weigh(d);
        }
      },
    });
    return;
  }

  // Every question answered, or enough of them: how much each thing counts, and all the answers to change.
  ui.q[d.id] = undefined;
  const w = M.weightsFromPairs(ids, v.pairs);
  const circle = M.circles(ids, v.pairs)[0];
  frame(d, 'weigh', `
    <div class="card">
      <h2>How much each thing counts</h2>
      ${weightBars(d, w)}
      ${circle ? `<p class="notice">Some answers go round in a circle: <b>${esc(crit[circle[0]].name)}</b> over <b>${esc(crit[circle[1]].name)}</b>, <b>${esc(crit[circle[1]].name)}</b> over <b>${esc(crit[circle[2]].name)}</b>, but <b>${esc(crit[circle[2]].name)}</b> over <b>${esc(crit[circle[0]].name)}</b>. The weights still work, but it’s worth another look.</p>` : ''}
    </div>
    <div class="card">
      <h2>Your answers</h2>
      <p class="hint">The bigger the circle, the more that side matters. Change any of them and the weights follow.</p>
      <ul class="pairs">${schedule.map(([p, q]) => {
        const cur = M.getPair(v.pairs, p, q);
        return `<li data-a="${p}" data-b="${q}"><span class="l">${esc(crit[p].name)}</span><span class="mini${cur === undefined ? ' unset' : ''}" role="radiogroup" aria-label="${esc(crit[p].name)} or ${esc(crit[q].name)}">${five(crit[p], crit[q], cur, 'mini')}</span><span class="r">${esc(crit[q].name)}</span></li>`;
      }).join('')}</ul>
      ${open.length ? `<p class="hint" style="margin-top:12px">${open.length} left unanswered. <button type="button" class="link-btn" data-go="rest">Answer them</button></p>` : ''}
    </div>
    <p class="switch"><button type="button" class="link-btn" data-go="manual">Set the weights by hand instead</button></p>`,
  weighNext(d));

  on({
    click(e) {
      const t = e.target.closest('button');
      if (!t) return;
      const li = t.closest('li[data-a]');
      if (li && t.dataset.v !== undefined) {
        M.setPair(v.pairs, li.dataset.a, li.dataset.b, Number(t.dataset.v));
        store.put(d);
        weigh(d);
      } else if (t.dataset.go === 'rest') {
        v.enough = false;
        ui.q[d.id] = open[0];
        store.put(d);
        weigh(d);
      } else if (t.dataset.go === 'manual') {
        const max = Math.max(...Object.values(w));
        v.manual = Object.fromEntries(ids.map(id => [id, Math.max(1, Math.round((w[id] / max) * 10))]));
        v.mode = 'manual';
        store.put(d);
        weigh(d);
      }
    },
  });
}

export function weightBars(d, w) {
  const max = Math.max(...Object.values(w), 0.0001);
  return `<ul class="weights">${[...d.criteria].sort((a, b) => w[b.id] - w[a.id]).map(c => `
    <li><span class="name">${dot(c)}${esc(c.name)}</span><span class="track"><i style="width:${(w[c.id] / max) * 100}%;--bc:var(--c${c.color})"></i></span><b>${pct(w[c.id])}</b></li>`).join('')}
  </ul>`;
}

function sliders(d) {
  const v = d.me;
  const ids = d.criteria.map(c => c.id);
  const w = M.manualWeights(ids, v.manual);
  frame(d, 'weigh', `
    <div class="card">
      <h2>How much each thing counts</h2>
      <p class="hint">Slide each one. Only how they compare matters: everything at 5 is the same as everything at 10.</p>
      <ul class="sliders">${d.criteria.map(c => `
        <li><label for="s-${c.id}">${dot(c)}${esc(c.name)}</label>
          <input type="range" id="s-${c.id}" data-c="${c.id}" min="0" max="10" step="1" value="${v.manual[c.id] ?? 5}" style="--rc:var(--c${c.color})">
          <b data-pct="${c.id}">${pct(w[c.id])}</b></li>`).join('')}
      </ul>
    </div>
    <p class="switch"><button type="button" class="link-btn" data-go="pairs">Compare them in pairs instead</button></p>`,
  weighNext(d));
  on({
    input(e) {
      const id = e.target.dataset.c;
      if (!id) return;
      v.manual[id] = Number(e.target.value);
      store.put(d);
      const now = M.manualWeights(ids, v.manual);
      for (const c of ids) document.querySelector(`[data-pct="${c}"]`).textContent = pct(now[c]);
    },
    click(e) {
      if (e.target.closest('[data-go="pairs"]')) {
        v.mode = 'pairs';
        store.put(d);
        weigh(d);
      }
    },
  });
}

// ---------- Score ----------

function scoreNext(d) {
  const p = M.progress(d, d.me);
  const left = p.scoresTotal - p.scored;
  const note = !p.weighed ? 'Finish weighing first.' : left ? `${left} still to score.` : '';
  return `<span class="note">${note}</span><a class="btn primary" href="#/d/${d.id}/result"${note ? ' aria-disabled="true" tabindex="-1"' : ''}>See the result →</a>`;
}

export function score(d) {
  const v = d.me;
  const w = M.voiceWeights(d.criteria, v);
  frame(d, 'score', `
    <p class="lede">Score each choice from 1 (poor) to 5 (great) on each thing. Score how good it is, not how much of it there is: a low price scores high. ✕ rules a choice out, however well it does on everything else.</p>
    ${d.criteria.map(c => `
      <div class="card crit">
        <h2>${dot(c)}${esc(c.name)} <span class="aside">counts ${pct(w[c.id])}</span></h2>
        <ul class="scores">${d.options.map(o => {
          const s = v.scores[c.id]?.[o.id];
          return `<li><span class="oname" id="n-${c.id}-${o.id}">${esc(o.name)}</span>
            <span class="pick" role="radiogroup" aria-labelledby="n-${c.id}-${o.id}" data-c="${c.id}" data-o="${o.id}">
              ${[0, 1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-s="${n}" aria-checked="${s === n}"${n ? '' : ' class="out" aria-label="Rules it out"'}>${n || '✕'}</button>`).join('')}
            </span></li>`;
        }).join('')}</ul>
      </div>`).join('')}`,
  scoreNext(d));
  on({
    click(e) {
      const t = e.target.closest('.pick button');
      if (!t) return;
      const box = t.parentElement;
      const { c, o } = box.dataset;
      const n = Number(t.dataset.s);
      v.scores[c] ||= {};
      if (v.scores[c][o] === n) delete v.scores[c][o]; else v.scores[c][o] = n;
      store.put(d);
      box.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', v.scores[c][o] === Number(b.dataset.s)));
      refresh(d, 'score', scoreNext(d));
    },
  });
}

