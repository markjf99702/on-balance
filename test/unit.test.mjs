// The arithmetic and the links, without a browser:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { pack, unpack, readJoin, readAnswer } from '../js/share.js';
import { makeExample, exampleTitles } from '../js/examples.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

test('a pair answer reads back the same from either side', () => {
  const pairs = {};
  M.setPair(pairs, 'z', 'a', 2);
  assert.equal(M.getPair(pairs, 'z', 'a'), 2);
  assert.equal(M.getPair(pairs, 'a', 'z'), -2);
  M.setPair(pairs, 'a', 'z', 0);
  assert.equal(M.getPair(pairs, 'z', 'a'), 0);
  assert.equal(Object.keys(pairs).length, 1);
});

test('weights from pairs', () => {
  assert.deepEqual(M.weightsFromPairs(['a'], {}), { a: 1 });
  const pairs = {};
  M.setPair(pairs, 'a', 'b', 2);
  const w = M.weightsFromPairs(['a', 'b'], pairs);
  close(w.a, 0.8, 1e-3); close(w.b, 0.2, 1e-3);

  // All "the same": even shares.
  const same = {};
  for (const [x, y] of [['a', 'b'], ['a', 'c'], ['b', 'c']]) M.setPair(same, x, y, 0);
  for (const v of Object.values(M.weightsFromPairs(['a', 'b', 'c'], same))) close(v, 1 / 3, 1e-3);

  // Every pair answered: the geometric mean of each row.
  const ids = ['a', 'b', 'c', 'd'];
  const full = {};
  const answers = { 'a|b': 1, 'a|c': 2, 'a|d': 1, 'b|c': 1, 'b|d': -1, 'c|d': -2 };
  for (const [k, v] of Object.entries(answers)) M.setPair(full, ...k.split('|'), v);
  const gm = ids.map(i => Math.pow(ids.reduce((p, j) => p * (i === j ? 1 : M.RATIO[M.getPair(full, i, j)]), 1), 1 / 4));
  const sum = gm.reduce((s, v) => s + v, 0);
  const got = M.weightsFromPairs(ids, full);
  ids.forEach((id, i) => close(got[id], gm[i] / sum, 2e-3));

  // A chain is enough: a twice b, b twice c.
  const chain = {};
  M.setPair(chain, 'a', 'b', 1); M.setPair(chain, 'b', 'c', 1);
  const cw = M.weightsFromPairs(['a', 'b', 'c'], chain);
  close(cw.a / cw.b, 2, 0.01); close(cw.b / cw.c, 2, 0.01);
});

test('linked up, and answers that go round in a circle', () => {
  const pairs = {};
  M.setPair(pairs, 'a', 'b', 1);
  assert.equal(M.isConnected(['a', 'b', 'c'], pairs), false);
  M.setPair(pairs, 'b', 'c', 1);
  assert.equal(M.isConnected(['a', 'b', 'c'], pairs), true);
  assert.deepEqual(M.circles(['a', 'b', 'c'], pairs), []);
  M.setPair(pairs, 'c', 'a', 2);
  assert.equal(M.circles(['a', 'b', 'c'], pairs).length, 1);
});

test('the question order asks every pair once and links everything early', () => {
  for (let n = 2; n <= 8; n++) {
    const ids = 'abcdefgh'.slice(0, n).split('');
    const order = M.pairSchedule(ids);
    assert.equal(order.length, (n * (n - 1)) / 2);
    assert.equal(new Set(order.map(p => [...p].sort().join())).size, order.length);
    const first = {};
    for (const [a, b] of order.slice(0, n - 1)) M.setPair(first, a, b, 0);
    assert.ok(M.isConnected(ids, first), `the first ${n - 1} questions link all ${n}`);
  }
});

// A random decision, filled in, for checking the result against itself.
function randomDecision(seed) {
  const rand = M.mulberry32(seed);
  const d = M.blankDecision();
  const no = 2 + Math.floor(rand() * 4), nc = 1 + Math.floor(rand() * 6);
  d.options = Array.from({ length: no }, (_, i) => ({ id: `o${i}`, name: `Option ${i}` }));
  d.criteria = Array.from({ length: nc }, (_, i) => ({ id: `c${i}`, name: `Thing ${i}`, color: i }));
  for (const [a, b] of M.pairSchedule(d.criteria.map(c => c.id))) M.setPair(d.me.pairs, a, b, Math.floor(rand() * 5) - 2);
  for (const c of d.criteria) {
    d.me.scores[c.id] = {};
    for (const o of d.options) d.me.scores[c.id][o.id] = 1 + Math.floor(rand() * 5);
  }
  return d;
}

// The same, with the weights set by hand instead, some of them at 0.
function handWeighted(seed) {
  const d = randomDecision(seed);
  const rand = M.mulberry32(seed + 1e6);
  d.me.mode = 'manual';
  for (const c of d.criteria) d.me.manual[c.id] = rand() < 0.3 ? 0 : Math.floor(rand() * 11);
  return d;
}

test('what would change it really does change it', () => {
  let weights = 0, scores = 0, fromNothing = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    for (const d of [randomDecision(seed), handWeighted(seed)]) {
      const view = M.viewOf(d, d.me);
      const [W, R] = M.ranking(d, view);
      const f = M.flips(d, view, W, R);
      if (f.tie) continue;
      if (f.weight) {
        // Set the weight to the whole percent the page shows, and the runner-up must come out ahead.
        const to = f.weight.to / 100;
        const w = { ...view.w };
        const rest = 1 - w[f.weight.criterion];
        for (const id in w) w[id] = id === f.weight.criterion ? to : (w[id] / rest) * (1 - to);
        const t = Object.fromEntries(M.ranking(d, { ...view, w }).map(r => [r.id, r.total]));
        assert.ok(t[R.id] > t[W.id], `seed ${seed}: weight change puts the runner-up ahead of the winner`);
        weights++;
        if (!view.w[f.weight.criterion]) fromNothing++;
      }
      if (f.score) {
        const copy = structuredClone(d);
        copy.me.scores[f.score.criterion][f.score.option] = f.score.to;
        const again = M.ranking(copy, M.viewOf(copy, copy.me));
        assert.ok(again.findIndex(r => r.id === R.id) < again.findIndex(r => r.id === W.id), `seed ${seed}: score change puts the runner-up ahead of the winner`);
        // And it's the smallest: one point less wouldn't do it.
        const less = structuredClone(d);
        less.me.scores[f.score.criterion][f.score.option] = f.score.to + (f.score.to > f.score.from ? -1 : 1);
        if (less.me.scores[f.score.criterion][f.score.option] !== f.score.from) {
          const t = Object.fromEntries(M.ranking(less, M.viewOf(less, less.me)).map(r => [r.id, r.total]));
          assert.ok(t[R.id] <= t[W.id] + 1e-9, `seed ${seed}: one point less is not enough`);
        }
        scores++;
      }
    }
  }
  assert.ok(weights > 100 && scores > 100 && fromNothing > 10, `checked ${weights} weight changes (${fromNothing} for something that counted for nothing) and ${scores} score changes`);
});

test('what would change it can give weight to something that counts for nothing', () => {
  // Weights by hand: Price 5, Carrying the kids 0. The cargo bike wins if the kids count for 51%.
  const d = M.blankDecision();
  d.options = [{ id: 'a', name: 'Road bike' }, { id: 'b', name: 'Cargo bike' }];
  d.criteria = [{ id: 'p', name: 'Price', color: 0 }, { id: 'k', name: 'Carrying the kids', color: 1 }];
  Object.assign(d.me, { mode: 'manual', manual: { p: 5, k: 0 }, scores: { p: { a: 5, b: 1 }, k: { a: 1, b: 5 } } });
  const view = M.viewOf(d, d.me);
  const [W, R] = M.ranking(d, view);
  assert.equal(W.id, 'a');
  const f = M.flips(d, view, W, R);
  assert.deepEqual([f.weight?.criterion, f.weight?.to], ['k', 51]);
});

test('steadiness adds up and repeats for the same seed', () => {
  const d = randomDecision(7);
  const view = M.viewOf(d, d.me);
  const a = M.steadiness(d, view, 42), b = M.steadiness(d, view, 42);
  assert.deepEqual(a, b);
  close(Object.values(a).reduce((s, v) => s + v, 0), 1);
});

test('the examples come out the way their notes say', () => {
  assert.equal(exampleTitles.length, 3);
  const flat = makeExample(0);
  assert.equal(flat.others.length, 1);
  const together = M.ranking(flat, M.togetherView(flat));
  const mine = M.ranking(flat, M.viewOf(flat, flat.me));
  assert.notEqual(together[0].id, mine[0].id, 'Sam changes the apartment result');
  const job = makeExample(1);
  const [a, b] = M.ranking(job, M.viewOf(job, job.me));
  assert.ok(a.total - b.total < 0.06, 'the job is a close call');
  const trip = makeExample(2);
  const r = M.ranking(trip, M.viewOf(trip, trip.me));
  assert.equal(trip.me.mode, 'manual');
  assert.equal(r[r.length - 1].out.length, 1, 'camping is ruled out');
  for (const e of [flat, job, trip]) assert.ok(M.progress(e, e.me).complete);
});

test('together: weights averaged, and a ✕ from anyone rules it out', () => {
  const d = randomDecision(3);
  const other = structuredClone(d.me);
  const [c] = d.criteria, [o] = d.options;
  other.scores[c.id][o.id] = 0;
  d.others.push({ name: 'Sam', ...other });
  const t = M.togetherView(d);
  assert.deepEqual(t.out[o.id], [c.id]);
  const mine = M.viewOf(d, d.me);
  for (const cc of d.criteria) close(t.w[cc.id], mine.w[cc.id]);
  const diffs = M.differences(d, d.me, d.others[0]);
  assert.equal(diffs[0].kind, 'out');
});

test('removing a criterion takes its answers with it', () => {
  const d = randomDecision(11);
  const gone = d.criteria[0].id;
  M.removeCriterion(d, gone);
  assert.ok(!(gone in d.me.scores));
  assert.ok(Object.keys(d.me.pairs).every(k => !k.split('|').includes(gone)));
});

test('links carry a decision there and answers back', () => {
  const text = { héllo: 'wörld ✓ “quotes”', n: [1, 2] };
  assert.deepEqual(unpack(pack(text)), text);
  assert.ok(!/[+/=]/.test(pack(text)), 'safe in a link');

  const d = makeExample(0);
  const j = readJoin(pack({ v: 1, id: d.id, t: d.title, f: 'Mark', o: d.options.map(o => [o.id, o.name]), c: d.criteria.map(c => [c.id, c.name, c.color]) }));
  assert.equal(j.from, 'Mark');
  assert.deepEqual(j.options, d.options);
  assert.deepEqual(j.criteria, d.criteria);

  const a = readAnswer(pack({ v: 1, id: d.id, n: 'Sam', m: 'pairs', p: { ...d.me.pairs, 'x|y': 9 }, s: { [d.criteria[0].id]: { [d.options[0].id]: 7, [d.options[1].id]: 3 } } }));
  assert.equal(a.pairs['x|y'], undefined, 'nonsense answers are dropped');
  assert.deepEqual(a.scores[d.criteria[0].id], { [d.options[1].id]: 3 });

  // Answering twice under the same name replaces the first answers.
  assert.equal(M.addVoice(d, { ...a, name: 'Robin' }), false);
  assert.equal(M.addVoice(d, { ...a, name: 'robin' }), true);
  assert.equal(d.others.filter(o => o.name.toLowerCase() === 'robin').length, 1);
});

test('a link brings only ids the app makes, since ids go into the page as they are', () => {
  const link = { v: 1, id: 'k3x9q', t: 'Dinner', f: 'Mark', o: [['a1', 'Pizza'], ['p2', 'Curry']], c: [['b1', 'Taste', 0]] };
  const j = readJoin(pack(link));
  assert.deepEqual(j.options.map(o => o.id), ['a1', 'p2']);
  assert.equal(j.id, 'k3x9q');
  const odd = [
    { o: [['void(0)//', 'Pizza'], ['p2', 'Curry']] },
    { c: [['q" onclick=', 'Taste', 0]] },
    { o: [['', 'Pizza'], ['p2', 'Curry']] },
    { o: [[7, 'Pizza'], ['p2', 'Curry']] },
    { o: ['ab', ['p2', 'Curry']] },
    { o: [['a1', 'Pizza'], ['a1', 'Curry']] },
    { c: [['a1', 'Taste', 0]] },
    { id: '"><b>' },
  ];
  for (const change of odd) assert.throws(() => readJoin(pack({ ...link, ...change })), `turns away ${JSON.stringify(change)}`);
});

test('saved decisions come back as they were, and damaged ones are put right', () => {
  // Anything the app saved comes through unchanged.
  const saved = [makeExample(0), makeExample(1), makeExample(2), ...Array.from({ length: 40 }, (_, i) => randomDecision(i + 1))];
  saved[3].shared = { id: 'k3x9q', from: 'Mark', name: 'Sam' };
  saved[4].decided = { option: saved[4].options[0].id, at: 5 };
  saved[5].me.enough = true;
  for (const d of saved) assert.deepEqual(M.cleanDecision(structuredClone(d)), d);

  // A damaged copy or a backup edited by hand: what the page needs is put right, and odd ids are left out.
  for (const junk of [null, 5, 'x', [], {}, { id: '' }, { id: 7 }, { id: '"><b>' }]) assert.equal(M.cleanDecision(junk), null);
  const d = M.cleanDecision({
    id: 'h1',
    options: [{ id: 'a', name: 'Bus' }, { id: 'b' }, { id: 'x" onclick="', name: 'Odd' }, null, { id: 'a', name: 'Again' }],
    criteria: [{ id: 'c', name: 'Cost', color: '0" onclick="' }, { id: 'e', name: 'Ease', color: 0 }],
    me: 5,
    others: [null, { name: 4, scores: [] }],
    shared: 'x',
  });
  assert.equal(d.title, '');
  assert.deepEqual(d.options, [{ id: 'a', name: 'Bus' }, { id: 'b', name: '' }]);
  assert.deepEqual(d.criteria.map(c => c.color), [1, 0]);
  assert.deepEqual(d.me, { pairs: {}, manual: {}, scores: {}, mode: 'pairs' });
  assert.deepEqual(d.others.map(o => [o.name, o.scores]), [['Someone', {}]]);
  assert.equal(d.shared, null);
  assert.equal(M.ranking(d, M.viewOf(d, d.me)).length, 2);
});

test('the list is done once two choices and one thing that matters have names', () => {
  const d = M.blankDecision();
  d.options = [{ id: 'a1', name: '' }, { id: 'a2', name: '' }];
  d.criteria = [{ id: 'b1', name: '', color: 0 }, { id: 'b2', name: '', color: 1 }];
  assert.equal(M.progress(d, d.me).listed, false, 'blank rows are not a list');
  d.options[0].name = 'Tea';
  d.options[1].name = ' ';
  d.criteria[0].name = 'Taste';
  assert.equal(M.progress(d, d.me).listed, false);
  d.options[1].name = 'Coffee';
  assert.equal(M.progress(d, d.me).listed, true);
});
