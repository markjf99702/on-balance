// The result: which way it tips, how sure you can be, what would change it, where two people differ,
// a coin for the gut check, and sending it to someone else.
import * as M from './model.js';
import { store } from './store.js';
import { joinLink, answerLink } from './share.js';
import { scaleSVG, setTilt, tiltFor } from './scale.js';
import { esc, dot, tagged, pct, ui, frame, on, go, toast, toastAction, sheet, copy, day, names, fromName, notReady } from './ui.js';

function listWords(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function result(d) {
  const p = M.progress(d, d.me);
  if (!p.complete) return notReady(d, 'result');
  const n = names(d);
  const crit = Object.fromEntries(d.criteria.map(c => [c.id, c]));
  const mine = !d.shared;

  // Whose answers: yours, someone else's, or everyone's together.
  const voices = [['me', 'You', d.me], ...d.others.map((o, i) => [`o${i}`, o.name, o])];
  if (d.others.length) voices.unshift(['together', 'Together', null]);
  let sel = ui.voice[d.id];
  if (!voices.some(([k]) => k === sel)) sel = d.others.length ? 'together' : 'me';
  const selVoice = voices.find(([k]) => k === sel)[2];
  const view = sel === 'together' ? M.togetherView(d) : M.viewOf(d, selVoice);
  const rank = M.ranking(d, view);
  const alive = rank.filter(r => !r.out.length);
  const [W, R] = alive;
  const who = sel === 'me' ? 'you' : sel === 'together' ? 'you both' : voices.find(([k]) => k === sel)[1];

  let verdictCard, flipCard = '', gutCard = '';
  if (!W) {
    verdictCard = `
      <div class="card empty">
        <span class="pill">Nothing left</span>
        <h2>Every choice is ruled out</h2>
        <p class="hint">Each one has a ✕ against something. Loosen one, or add another choice.</p>
        <a class="btn" href="#/d/${d.id}/score">Back to the scores</a>
      </div>`;
  } else {
    const shares = alive.length > 1 ? M.steadiness(d, view, M.hash(d.id + sel)) : { [W.id]: 1 };
    const v = M.verdict(shares[W.id], alive.length);
    const w100 = Math.round(W.total * 100), r100 = R ? Math.round(R.total * 100) : 0;
    const level = R && w100 === r100;
    const sub = !R ? 'Everything else is ruled out.'
      : level ? `Level with ${esc(n[R.id])} on ${w100}. The coin below might help.`
      : `comes out ahead of ${esc(n[R.id])}, ${w100} to ${r100}.`;
    const others = alive.slice(1).map(r => `${esc(n[r.id])} ${Math.round(shares[r.id] * 100)}`).filter(s => !s.endsWith(' 0'));
    const sure = R ? `When every weight and score is nudged a little either way, <b>${esc(n[W.id])}</b> still wins <b>${Math.round(shares[W.id] * 100)} times in 100</b>${others.length ? `, ${listWords(others)}` : ''}.` : '';
    const decided = d.decided && d.options.find(o => o.id === d.decided.option);
    const label = R ? `A balance tipping towards ${n[W.id]}, ${w100}, over ${n[R.id]}, ${r100}` : `${n[W.id]}`;

    verdictCard = `
      <div class="card verdict">
        ${decided ? '<div class="stamp">Decided</div>' : ''}
        <span class="pill ${v.key}">${level ? 'Dead heat' : v.label}</span>
        <h2 class="winner">${esc(n[W.id])}</h2>
        <p class="sub">${sub}</p>
        ${R ? scaleSVG(W, R, d.criteria, n, label) : ''}
        ${sure ? `<p class="sure">${sure}</p>` : ''}
        ${mine ? (decided
          ? `<p class="decided-note">You went with <b>${esc(decided.name)}</b> on ${day(d.decided.at)}. <button type="button" class="link-btn" data-act="undecide">Undo</button></p>`
          : `<div class="actions"><button type="button" class="btn primary" data-decide="${W.id}">Go with ${esc(n[W.id])}</button></div>`) : ''}
      </div>`;

    if (R) {
      const f = M.flips(d, view, W, R, sel !== 'together');
      const items = [];
      if (f.tie) {
        items.push('They’re level, so any change to how much something counts, or to a score, would tip it one way or the other.');
      } else {
        if (f.weight) {
          const c = crit[f.weight.criterion];
          const { to } = f.weight;
          items.push(to <= 0
            ? `${esc(n[R.id])} would come out ahead if ${tagged(c)} didn’t count at all. It counts for ${pct(f.weight.from)} now.`
            : `${esc(n[R.id])} would come out ahead if ${tagged(c)} counted for ${to}% instead of ${pct(f.weight.from)}.`);
        }
        if (f.score) {
          const c = crit[f.score.criterion];
          const yours = sel === 'me' ? 'you’d' : `${esc(who)} had`;
          items.push(`${items.length ? 'Or it would' : `${esc(n[R.id])} would`} come out ahead if ${yours} given ${esc(n[f.score.option])} a ${f.score.to} for ${tagged(c)} instead of a ${f.score.from}.`);
        }
        if (!items.length) items.push(`No change to just one weight or one score would put ${esc(n[R.id])} ahead.`);
      }
      flipCard = `
        <div class="card">
          <h2>What would change it</h2>
          <p class="hint">The smallest single changes that would put ${esc(n[R.id])} ahead of ${esc(n[W.id])}.</p>
          <ul class="flip-list">${items.map(t => `<li>${t}</li>`).join('')}</ul>
        </div>`;

      gutCard = `
        <div class="card gut">
          <h2>Gut check</h2>
          <p class="hint">Flip a coin between the top two. While it’s in the air, notice which way you’re hoping it lands.</p>
          <div class="coin-wrap"><div class="coin" id="coin"><div class="face heads">${esc(n[W.id])}</div><div class="face tails">${esc(n[R.id])}</div></div></div>
          <div class="row"><button type="button" class="btn" data-act="flip">Flip the coin</button></div>
          <div class="gut-after" id="gutAfter" hidden></div>
        </div>`;
    }
  }

  const rankCard = `
    <div class="card">
      <h2>All the choices <span class="aside">out of 100</span></h2>
      <ol class="rank">${rank.map((r, i) => `
        <li class="${r.out.length ? 'out' : ''}">
          <span class="n">${r.out.length ? '–' : i + 1}</span>
          <span class="o">${esc(n[r.id])}</span>
          <span class="tot">${Math.round(r.total * 100)}</span>
          <span class="stack" style="width:${Math.max(0.5, r.total * 100)}%${r.out.length ? ';opacity:.35' : ''}" aria-hidden="true">${d.criteria.filter(c => r.parts[c.id] > 0.0005).map(c =>
            `<i style="--g:${r.parts[c.id]};--bc:var(--c${c.color})" title="${esc(c.name)}: ${Math.round(r.parts[c.id] * 100)}"></i>`).join('')}</span>
          ${r.out.length ? `<span class="why">Ruled out on ${listWords(r.out.map(id => esc(n[id])))}</span>` : ''}
        </li>`).join('')}
      </ol>
      <div class="legend" aria-label="How much each thing counts">${d.criteria.map(c => `<span>${dot(c)}${esc(c.name)} <b>${pct(view.w[c.id])}</b></span>`).join('')}</div>
    </div>`;

  let diffCard = '';
  if (sel === 'together') {
    const diffs = d.others.flatMap(o => M.differences(d, d.me, o).map(x => ({ ...x, who: o.name }))).sort((a, b) => b.size - a.size).slice(0, 5);
    diffCard = `
      <div class="card">
        <h2>Where you differ</h2>
        ${diffs.length ? `<ul class="diffs">${diffs.map(x => {
          const c = crit[x.criterion];
          const them = esc(x.who);
          if (x.kind === 'weight') return `<li>${dot(c)}<span>${them} puts ${x.b > x.a ? 'more' : 'less'} weight on <b>${esc(c.name)}</b>: ${pct(x.b)} against your ${pct(x.a)}.</span></li>`;
          if (x.kind === 'out') return x.b === 0
            ? `<li>${dot(c)}<span>${them} ruled out <b>${esc(n[x.option])}</b> on ${esc(c.name)}. You gave it a ${x.a}.</span></li>`
            : `<li>${dot(c)}<span>You ruled out <b>${esc(n[x.option])}</b> on ${esc(c.name)}. ${them} gave it a ${x.b}.</span></li>`;
          return `<li>${dot(c)}<span><b>${esc(n[x.option])}</b> for ${esc(c.name)}: you gave it a ${x.a}, ${them} gave it a ${x.b}.</span></li>`;
        }).join('')}</ul>` : '<p class="hint">You’re close on everything: no weight more than 8 points apart and no score more than a point apart.</p>'}
      </div>`;
  }

  const shareCard = mine ? `
    <div class="card">
      <h2>Ask someone else</h2>
      <p class="hint">Give someone the same choices and the same list of what matters, but not your answers. They weigh and score it their way, and you see both results and where you differ.</p>
      ${d.others.length ? `<ul class="people">${d.others.map((o, i) => `<li><span>${esc(o.name)}’s answers <small>added ${day(o.at)}</small></span><button type="button" class="x" data-drop="${i}" aria-label="Remove ${esc(o.name)}’s answers">✕</button></li>`).join('')}</ul>` : ''}
      <div class="row" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
        <button type="button" class="btn" data-act="ask">Send them a link</button>
        <button type="button" class="btn" data-act="hand">Pass them this phone</button>
      </div>
    </div>` : `
    <div class="card">
      <h2>${d.shared.local ? `Add your answers to ${esc(fromName(d))}’s` : `Send your answers back`}</h2>
      <p class="hint">${d.shared.local
        ? 'They’ll see your result next to theirs, and where the two of you differ.'
        : `Send ${esc(fromName(d))} a link with your answers. When they open it, they’ll see your result next to theirs, and where you differ.`}</p>
      <button type="button" class="btn primary" data-act="${d.shared.local ? 'merge' : 'sendback'}">${d.shared.local ? 'Add my answers' : `Send them to ${esc(fromName(d))}`}</button>
    </div>`;

  frame(d, 'result', `
    ${voices.length > 1 ? `<div class="voices" role="group" aria-label="Whose answers">${voices.map(([k, label]) => `<button type="button" data-voice="${k}" aria-pressed="${k === sel}">${esc(label)}</button>`).join('')}</div>` : ''}
    ${verdictCard}
    ${flipCard}
    ${rankCard}
    ${diffCard}
    ${gutCard}
    ${shareCard}`);

  // Settle the balance: from where it was last time (or level) to where it tips now.
  const svg = document.querySelector('.scale');
  if (svg && W && R) {
    const key = d.id + sel;
    const target = tiltFor(W.total, R.total);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = ui.tilt[key] ?? 0;
    svg.querySelectorAll('.beam,.hang').forEach(el => { el.style.transition = 'none'; });
    setTilt(svg, reduce ? target : from);
    svg.getBoundingClientRect();
    svg.querySelectorAll('.beam,.hang').forEach(el => { el.style.transition = ''; });
    if (!reduce) requestAnimationFrame(() => requestAnimationFrame(() => setTilt(svg, target)));
    ui.tilt[key] = target;
  }

  on({
    click(e) {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.voice) { ui.voice[d.id] = t.dataset.voice; result(d); return; }
      if (t.dataset.decide) {
        d.decided = { option: t.dataset.decide, at: Date.now() };
        store.put(d);
        result(d);
        toast(`Decided: ${n[t.dataset.decide]}`);
        return;
      }
      if (t.dataset.drop !== undefined) {
        const [gone] = d.others.splice(Number(t.dataset.drop), 1);
        store.put(d);
        result(d);
        const before = toastAction();
        const removed = [...(before?.from === d.id ? before.removed : []), gone];
        const showing = () => location.hash.replace(/^#\/?/, '') === `d/${d.id}/result`;
        toast(`Removed ${listWords(removed.map(o => `${o.name}’s`))} answers`, { label: 'Undo', from: d.id, removed, run: () => { d.others.push(...removed); store.put(d); if (showing()) result(d); } });
        return;
      }
      const act = t.dataset.act;
      if (act === 'undecide') { d.decided = null; store.put(d); result(d); }
      else if (act === 'flip') flipCoin(d, W, R, n, t);
      else if (act === 'ask') askSheet(d);
      else if (act === 'hand') handSheet(d);
      else if (act === 'sendback') sendBackSheet(d);
      else if (act === 'merge') merge(d);
      else if (act === 'gut') gutAnswer(d, t, n);
    },
  });
}

// ---------- Gut check ----------

function flipCoin(d, W, R, n, button) {
  const coin = document.getElementById('coin');
  const after = document.getElementById('gutAfter');
  const heads = Math.random() < 0.5;
  const pick = heads ? W : R;
  ui.coin[d.id] = { pick: pick.id, W: W.id, R: R.id };
  after.hidden = true;
  button.disabled = true;
  const end = 360 * 5 + (heads ? 0 : 180);
  const done = () => {
    button.disabled = false;
    button.textContent = 'Flip again';
    after.hidden = false;
    after.innerHTML = `
      <p>It landed on <b>${esc(n[pick.id])}</b>. How does that feel?</p>
      <div class="row"><button type="button" class="btn small" data-act="gut" data-feel="glad">Relieved</button><button type="button" class="btn small" data-act="gut" data-feel="sad">Let down</button></div>
      <p class="gut-say" id="gutSay" hidden></p>`;
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !coin.animate) {
    coin.style.transform = `rotateX(${end}deg)`;
    return done();
  }
  coin.animate([
    { transform: 'translateY(0) rotateX(0deg)' },
    { transform: `translateY(-110px) rotateX(${end * 0.55}deg)`, offset: 0.45, easing: 'ease-in' },
    { transform: `translateY(0) rotateX(${end}deg)` },
  ], { duration: 1500, easing: 'cubic-bezier(.2,.6,.35,1)', fill: 'forwards' }).finished.then(done);
}

function gutAnswer(d, t, n) {
  const c = ui.coin[d.id];
  if (!c) return;
  const glad = t.dataset.feel === 'glad';
  const wantsWinner = (c.pick === c.W) === glad;
  const say = document.getElementById('gutSay');
  t.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === t));
  say.hidden = false;
  say.innerHTML = wantsWinner
    ? `Then your gut and your scores agree: <b>${esc(n[c.W])}</b>.`
    : `Part of you is pulling for <b>${esc(n[c.R])}</b>, even though it scored lower. Is there something about it that isn’t on your list? <a href="#/d/${d.id}/list">Add it</a> and see if it tips.${d.shared ? '' : ` Or <button type="button" class="link-btn" data-decide="${c.R}">go with ${esc(n[c.R])}</button>.`}`;
}

// ---------- Sharing ----------

function linkSheet({ title, blurb, nameLabel, name, placeholder, makeLink, onName }) {
  const canShare = typeof navigator.share === 'function';
  sheet(`
    <h2>${title}</h2>
    <p>${blurb}</p>
    <label class="field"><span>${nameLabel}</span><input class="input" id="sheetName" value="${esc(name)}" maxlength="40" autocomplete="given-name" enterkeyhint="done" placeholder="${placeholder}"></label>
    <textarea id="sheetLink" readonly aria-label="The link"></textarea>
    <div class="row">
      <button class="btn" value="close">Close</button>
      <button type="button" class="btn${canShare ? '' : ' primary'}" id="sheetCopy">Copy link</button>
      ${canShare ? '<button type="button" class="btn primary" id="sheetShare">Share…</button>' : ''}
    </div>`, body => {
    const input = body.querySelector('#sheetName');
    const field = body.querySelector('#sheetLink');
    const update = () => { field.value = makeLink(input.value.trim()); };
    update();
    input.addEventListener('input', () => { onName(input.value.trim()); update(); });
    body.querySelector('#sheetCopy').onclick = () => copy(field.value, field);
    const share = body.querySelector('#sheetShare');
    if (share) share.onclick = () => navigator.share({ title: 'On Balance', url: field.value }).catch(() => {});
    // Enter (Done on a phone keyboard) would close the sheet, as Close comes first: go on to sending instead.
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      (share || body.querySelector('#sheetCopy')).focus();
    });
  });
}

function askSheet(d) {
  linkSheet({
    title: 'Ask someone else',
    blurb: 'Send them this link. They’ll score the same choices their way, then send you a link back. Open it here and their answers join yours.',
    nameLabel: 'Your name',
    name: store.name,
    placeholder: 'So they know who’s asking',
    makeLink: name => joinLink(d, name),
    onName: name => { store.name = name; },
  });
}

function sendBackSheet(d) {
  linkSheet({
    title: `Send your answers to ${esc(fromName(d))}`,
    blurb: `Send ${esc(fromName(d))} this link. It only works on the phone or computer they asked from.`,
    nameLabel: 'Your name',
    name: d.shared.name ?? store.name,
    placeholder: 'So they know who answered',
    makeLink: name => answerLink(d, name || 'Someone'),
    onName: name => { d.shared.name = name; store.name = name; store.put(d); },
  });
}

// Two people, one phone: a copy for the second person to answer, which folds back in when they're done.
function handSheet(d) {
  sheet(`
    <h2>Pass them this phone</h2>
    <p>They’ll get the same choices and the same list of what matters, without your answers. When they’re done, their answers join yours here.</p>
    <label class="field"><span>Your name</span><input class="input" id="sheetName" value="${esc(store.name)}" maxlength="40" autocomplete="given-name" enterkeyhint="go" placeholder="So they know who’s asking"></label>
    <div class="row"><button class="btn" value="close">Cancel</button><button type="button" class="btn primary" id="sheetGo">Hand it over</button></div>`, (body, close) => {
    // Enter (Go on a phone keyboard) hands it over, rather than cancelling, which comes first.
    body.querySelector('#sheetName').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      body.querySelector('#sheetGo').click();
    });
    body.querySelector('#sheetGo').onclick = () => {
      store.name = body.querySelector('#sheetName').value.trim();
      const copyOf = M.blankDecision();
      Object.assign(copyOf, {
        title: d.title,
        options: d.options.map(o => ({ ...o })),
        criteria: d.criteria.map(c => ({ ...c })),
        shared: { id: d.id, from: store.name, local: true, name: '' },
      });
      store.put(copyOf);
      close();
      go(`/d/${copyOf.id}/list`);
    };
  });
}

function merge(d) {
  const owner = store.get(d.shared.id);
  if (!owner) { toast('The original decision isn’t here any more.'); return; }
  const name = d.shared.name || 'Someone';
  M.addVoice(owner, { name, ...d.me });
  store.put(owner);
  store.remove(d.id);
  ui.voice[owner.id] = 'together';
  go(`/d/${owner.id}/result`, true);
  toast(`Added ${name}’s answers`);
}
