// The arithmetic behind On Balance. No DOM here, so it runs in Node for the tests.
//
// A decision has options (the choices) and criteria (what matters). Each person who weighs in is a "voice":
//   pairs:  { 'a|b': n }   answers to "which matters more?", n from -2 to 2 (see pairKey)
//   mode:   'pairs' or 'manual'
//   manual: { criterionId: 0..10 }   weights set by hand, used when mode is 'manual'
//   scores: { criterionId: { optionId: 1..5, or 0 for "rules it out" } }

export const MAX_OPTIONS = 8;
export const MAX_CRITERIA = 8;

// How much more one thing matters than another, for each answer. Doubling per step keeps the scale symmetric:
// "much more" is to "more" what "more" is to "the same".
export const RATIO = { 2: 4, 1: 2, 0: 1, '-1': 1 / 2, '-2': 1 / 4 };

// Pair answers are stored once per pair, keyed with the smaller id first.
// The number says how much the first id in the key matters over the second: 2 much more, 1 more, 0 the same.
export function pairKey(a, b) {
  return a < b ? [`${a}|${b}`, 1] : [`${b}|${a}`, -1];
}

export function getPair(pairs, a, b) {
  const [key, sign] = pairKey(a, b);
  const v = pairs?.[key];
  return v === undefined ? undefined : v * sign || 0;
}

export function setPair(pairs, a, b, v) {
  const [key, sign] = pairKey(a, b);
  if (v === undefined) delete pairs[key];
  else pairs[key] = v * sign || 0;
}

// The order to ask the questions in: each criterion turns up early, and the answers link everything together as
// soon as possible, so "skip the rest" is available sooner. Deterministic for a given list.
export function pairSchedule(ids) {
  const left = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) left.push([ids[i], ids[j]]);
  const degree = Object.fromEntries(ids.map(id => [id, 0]));
  const group = Object.fromEntries(ids.map(id => [id, id]));
  const find = x => (group[x] === x ? x : (group[x] = find(group[x])));
  const out = [];
  while (left.length) {
    let best = 0, bestCost = Infinity;
    left.forEach(([a, b], i) => {
      const joins = find(a) !== find(b) ? 0 : 1;
      const cost = joins * 1000 + Math.max(degree[a], degree[b]) * 10 + degree[a] + degree[b];
      if (cost < bestCost) { bestCost = cost; best = i; }
    });
    const [a, b] = left.splice(best, 1)[0];
    out.push([a, b]);
    degree[a]++; degree[b]++;
    group[find(a)] = find(b);
  }
  return out;
}

export function answeredPairs(ids, pairs) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const v = getPair(pairs, ids[i], ids[j]);
      if (v !== undefined) out.push([ids[i], ids[j], v]);
    }
  }
  return out;
}

// True when every criterion is linked to every other through some chain of answers,
// which is all the weights need. With one criterion there's nothing to ask.
export function isConnected(ids, pairs) {
  if (ids.length < 2) return true;
  const seen = new Set([ids[0]]);
  const links = answeredPairs(ids, pairs);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [a, b] of links) {
      if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grew = true; }
    }
  }
  return seen.size === ids.length;
}

// Weights from the pair answers, by least squares on the logs (with every pair answered this is the usual
// geometric-mean method). It works with some pairs unanswered, as long as they're linked. A criterion with no
// answers at all gets pulled towards an even share rather than breaking the sums.
export function weightsFromPairs(ids, pairs) {
  const n = ids.length;
  if (n === 0) return {};
  if (n === 1) return { [ids[0]]: 1 };
  const index = Object.fromEntries(ids.map((id, i) => [id, i]));
  const A = ids.map(() => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (const [p, q, v] of answeredPairs(ids, pairs)) {
    const i = index[p], j = index[q], r = Math.log(RATIO[v]);
    A[i][i]++; A[j][j]++; A[i][j]--; A[j][i]--;
    b[i] += r; b[j] -= r;
  }
  for (let i = 0; i < n; i++) A[i][i] += 1e-3; // the gentle pull towards even
  const x = solve(A, b);
  const raw = x.map(Math.exp);
  const sum = raw.reduce((s, v) => s + v, 0);
  return Object.fromEntries(ids.map((id, i) => [id, raw[i] / sum]));
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function manualWeights(ids, manual) {
  const raw = ids.map(id => Math.max(0, manual?.[id] ?? 5));
  const sum = raw.reduce((s, v) => s + v, 0);
  return Object.fromEntries(ids.map((id, i) => [id, sum ? raw[i] / sum : 1 / ids.length]));
}

export function voiceWeights(criteria, voice) {
  const ids = criteria.map(c => c.id);
  return voice?.mode === 'manual' ? manualWeights(ids, voice.manual) : weightsFromPairs(ids, voice?.pairs || {});
}

// Answers that go round in a circle: a over b, b over c, but c over a.
export function circles(ids, pairs) {
  const out = [];
  const over = (a, b) => (getPair(pairs, a, b) ?? 0) > 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = 0; j < ids.length; j++) {
      for (let k = 0; k < ids.length; k++) {
        const [a, b, c] = [ids[i], ids[j], ids[k]];
        if (i < j && i < k && j !== k && over(a, b) && over(b, c) && over(c, a)) out.push([a, b, c]);
      }
    }
  }
  return out;
}

// How far along one voice is.
export function progress(decision, voice) {
  const ids = decision.criteria.map(c => c.id);
  const pairsTotal = (ids.length * (ids.length - 1)) / 2;
  const pairsDone = answeredPairs(ids, voice?.pairs || {}).length;
  let scored = 0;
  for (const c of decision.criteria) {
    for (const o of decision.options) if (voice?.scores?.[c.id]?.[o.id] !== undefined) scored++;
  }
  const manual = voice?.mode === 'manual';
  const weighed = manual || isConnected(ids, voice?.pairs || {});
  return {
    pairsTotal, pairsDone, weighed,
    scored, scoresTotal: decision.options.length * decision.criteria.length,
    listed: decision.options.length >= 2 && decision.criteria.length >= 1,
    get complete() { return this.listed && this.weighed && this.scored === this.scoresTotal; },
  };
}

// Scores as numbers from 0 to 1 (1 is poor, 5 is great), plus which criteria rule each option out.
// A "view" is what the results are worked out from: one person's answers, or everyone's put together.
export function viewOf(decision, voice) {
  const w = voiceWeights(decision.criteria, voice);
  const u = {}, out = {};
  for (const o of decision.options) {
    u[o.id] = {}; out[o.id] = [];
    for (const c of decision.criteria) {
      const s = voice?.scores?.[c.id]?.[o.id];
      if (s === 0) out[o.id].push(c.id);
      u[o.id][c.id] = s ? (s - 1) / 4 : 0.5;
    }
  }
  return { w, u, out };
}

// Everyone's answers put together: the weights averaged, each score averaged over whoever gave it,
// and anything anyone ruled out stays ruled out.
export function togetherView(decision) {
  const voices = [decision.me, ...(decision.others || [])];
  const views = voices.map(v => viewOf(decision, v));
  const w = {}, u = {}, out = {};
  for (const c of decision.criteria) w[c.id] = views.reduce((s, v) => s + v.w[c.id], 0) / views.length;
  for (const o of decision.options) {
    u[o.id] = {}; out[o.id] = [];
    for (const c of decision.criteria) {
      const given = voices.map(v => v?.scores?.[c.id]?.[o.id]).filter(s => s !== undefined);
      if (given.includes(0)) out[o.id].push(c.id);
      const counted = given.filter(s => s > 0);
      u[o.id][c.id] = counted.length ? counted.reduce((s, x) => s + (x - 1) / 4, 0) / counted.length : 0.5;
    }
  }
  return { w, u, out };
}

// Each option's total out of 1, and how much each criterion put in. Best first; ruled-out options last.
export function ranking(decision, view) {
  // Totals that differ only by rounding count as level, so a tie keeps the options in their listed order.
  const rows = decision.options.map(o => {
    const parts = {};
    let total = 0;
    for (const c of decision.criteria) { parts[c.id] = view.w[c.id] * view.u[o.id][c.id]; total += parts[c.id]; }
    return { id: o.id, total, parts, out: view.out[o.id] };
  });
  return rows.sort((a, b) => (a.out.length > 0) - (b.out.length > 0) || (Math.abs(b.total - a.total) < 1e-9 ? 0 : b.total - a.total));
}

// How often each option still comes out on top when the weights and scores shift a little:
// each weight up or down by around a third, each score by up to half a point either way.
export function steadiness(decision, view, seed = 1, trials = 1000) {
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const alive = decision.options.filter(o => !view.out[o.id].length).map(o => o.id);
  const wins = Object.fromEntries(alive.map(id => [id, 0]));
  if (alive.length === 0) return wins;
  const cids = decision.criteria.map(c => c.id);
  for (let t = 0; t < trials; t++) {
    const w = cids.map(id => view.w[id] * Math.exp(0.35 * gauss()));
    let best = null, bestTotal = -Infinity;
    for (const oid of alive) {
      let total = 0;
      cids.forEach((cid, i) => {
        const u = Math.min(1, Math.max(0, view.u[oid][cid] + (rand() - 0.5) / 4));
        total += w[i] * u;
      });
      if (total > bestTotal) { bestTotal = total; best = oid; }
    }
    wins[best]++;
  }
  for (const id of alive) wins[id] /= trials;
  return wins;
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// The smallest single change that would put the runner-up ahead of the winner:
// one weight moved (to: its new share in whole percent, the others keeping their proportions),
// and one score moved (whole points only).
// Scores are only suggested for one person's answers (withScores), since a blend of several has no one score to move.
export function flips(decision, view, winner, runner, withScores = true) {
  const D = winner.total - runner.total;
  if (D < 1e-6) return { tie: true };
  let weight = null;
  for (const c of decision.criteria) {
    const w = view.w[c.id];
    const gap = view.u[runner.id][c.id] - view.u[winner.id][c.id]; // > 0: the runner-up is better on this
    if (!w || w > 0.999 || !gap) continue; // with only one thing that matters, its weight can't change anything
    const k = 1 + D / (w * gap); // multiply this weight by k (the others stay put, then all rescale)
    if (k < 0) continue; // it would have to count for less than nothing
    const at = (k * w) / (1 + (k - 1) * w); // the share where the two draw level
    if (!(at < 0.995) || at < 1e-9) continue; // at 0 they'd only draw level
    const change = Math.abs(at - w);
    // The whole percent to show: the first one past the point where they draw level.
    const to = gap > 0 ? Math.floor(at * 100 + 1e-6) + 1 : Math.max(0, Math.ceil(at * 100 - 1e-6) - 1);
    if (!weight || change < weight.change) weight = { criterion: c.id, from: w, at, to, change, up: gap > 0 };
  }
  let score = null;
  for (const c of withScores ? decision.criteria : []) {
    const w = view.w[c.id];
    if (!w) continue;
    const need = (4 * D) / w; // points of score it would take
    for (const [who, dir] of [[runner, 1], [winner, -1]]) {
      const s = view.u[who.id][c.id] * 4 + 1;
      if (Math.abs(s - Math.round(s)) > 1e-6) continue;
      const to = dir > 0 ? Math.floor(s + need + 1e-9) + 1 : Math.ceil(s - need - 1e-9) - 1;
      if (to < 1 || to > 5) continue;
      const steps = Math.abs(to - s);
      if (!score || steps < score.steps || (steps === score.steps && w > view.w[score.criterion])) {
        score = { option: who.id, criterion: c.id, from: Math.round(s), to, steps };
      }
    }
  }
  return { weight, score };
}

// Where one voice parts company with another: how much things count, and scores two or more points apart.
// Biggest first, by how much they move the result.
export function differences(decision, a, b) {
  const va = viewOf(decision, a), vb = viewOf(decision, b);
  const out = [];
  for (const c of decision.criteria) {
    const d = vb.w[c.id] - va.w[c.id];
    if (Math.abs(d) >= 0.08) out.push({ kind: 'weight', criterion: c.id, a: va.w[c.id], b: vb.w[c.id], size: Math.abs(d) });
  }
  for (const c of decision.criteria) {
    for (const o of decision.options) {
      const sa = a?.scores?.[c.id]?.[o.id], sb = b?.scores?.[c.id]?.[o.id];
      if (sa === undefined || sb === undefined) continue;
      if ((sa === 0) !== (sb === 0)) {
        out.push({ kind: 'out', criterion: c.id, option: o.id, a: sa, b: sb, size: 1 });
      } else if (sa && sb && Math.abs(sa - sb) >= 2) {
        const w = (va.w[c.id] + vb.w[c.id]) / 2;
        out.push({ kind: 'score', criterion: c.id, option: o.id, a: sa, b: sb, size: (Math.abs(sa - sb) / 4) * w * 2 });
      }
    }
  }
  return out.sort((x, y) => y.size - x.size);
}

// Plain-words verdict from the winner's share of the shaken-up runs.
export function verdict(share, optionsLeft) {
  if (optionsLeft < 2) return { key: 'only', label: 'Only one left' };
  if (share >= 0.9) return { key: 'clear', label: 'Clear winner' };
  if (share >= 0.7) return { key: 'likely', label: 'Likely winner' };
  if (share >= 0.5) return { key: 'close', label: 'Close call' };
  return { key: 'toss', label: 'Toss-up' };
}

export function newId(taken = []) {
  let id;
  do id = Math.random().toString(36).slice(2, 7); while (!id || taken.includes(id));
  return id;
}

export function nextColor(criteria) {
  const used = new Set(criteria.map(c => c.color));
  for (let i = 0; i < MAX_CRITERIA; i++) if (!used.has(i)) return i;
  return 0;
}

export function blankDecision() {
  const now = Date.now();
  return {
    id: newId(), title: '', options: [], criteria: [],
    me: { pairs: {}, mode: 'pairs', manual: {}, scores: {} },
    others: [], shared: null, decided: null, created: now, updated: now,
  };
}

// Removing an option or criterion takes its answers with it.
export function removeOption(d, oid) {
  d.options = d.options.filter(o => o.id !== oid);
  for (const v of [d.me, ...d.others]) for (const cid in v.scores) delete v.scores[cid][oid];
  if (d.decided?.option === oid) d.decided = null;
}

export function removeCriterion(d, cid) {
  d.criteria = d.criteria.filter(c => c.id !== cid);
  for (const v of [d.me, ...d.others]) {
    delete v.scores[cid];
    delete v.manual?.[cid];
    for (const key of Object.keys(v.pairs)) if (key.split('|').includes(cid)) delete v.pairs[key];
  }
}

// Adds (or replaces, by name) another person's answers, keeping only what still fits the decision.
export function addVoice(d, a) {
  const cids = new Set(d.criteria.map(c => c.id)), oids = new Set(d.options.map(o => o.id));
  const scores = {};
  for (const [cid, row] of Object.entries(a.scores)) {
    if (!cids.has(cid)) continue;
    scores[cid] = {};
    for (const [oid, s] of Object.entries(row)) if (oids.has(oid)) scores[cid][oid] = s;
  }
  const pairs = {};
  for (const [key, n] of Object.entries(a.pairs)) if (key.split('|').every(id => cids.has(id))) pairs[key] = n;
  const voice = { name: a.name, at: Date.now(), mode: a.mode, pairs, manual: a.manual || {}, scores };
  const i = d.others.findIndex(o => o.name.trim().toLowerCase() === a.name.trim().toLowerCase());
  if (i >= 0) d.others[i] = voice; else d.others.push(voice);
  return i >= 0;
}
