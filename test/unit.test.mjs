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

test('weights shown as whole percents add up to 100', () => {
  const total = p => Object.values(p).reduce((s, n) => s + n, 0);
  // The apartment example: each share rounded on its own came to 36 + 18 + 18 + 9 + 18 = 99, and Together to 99.
  const flat = makeExample(0);
  assert.deepEqual(Object.values(M.wholePercents(M.voiceWeights(flat.criteria, flat.me))), [37, 18, 18, 9, 18]);
  assert.equal(total(M.wholePercents(M.togetherView(flat).w)), 100);
  for (let seed = 1; seed <= 1000; seed++) {
    for (const d of [randomDecision(seed), handWeighted(seed)]) {
      const w = M.voiceWeights(d.criteria, d.me), shown = M.wholePercents(w);
      assert.equal(total(shown), 100, `seed ${seed}: adds up to 100`);
      for (const c of d.criteria) {
        assert.ok(Number.isInteger(shown[c.id]) && Math.abs(shown[c.id] - w[c.id] * 100) < 1, `seed ${seed}: within a point`);
        if (!w[c.id]) assert.equal(shown[c.id], 0, `seed ${seed}: something that counts for nothing shows 0`);
      }
    }
  }
  // At the edges: one thing, eight level things, and level shares, where the first on the list gets the point.
  assert.deepEqual(M.wholePercents({ a: 1 }), { a: 100 });
  assert.deepEqual(Object.values(M.wholePercents(Object.fromEntries('abcdefgh'.split('').map(k => [k, 1 / 8])))), [13, 13, 13, 13, 12, 12, 12, 12]);
  assert.deepEqual(M.wholePercents({ a: 1 / 3, b: 1 / 3, c: 1 / 3 }), { a: 34, b: 33, c: 33 });
  assert.deepEqual(M.wholePercents({ a: 0, b: 0.5, c: 0.5 }), { a: 0, b: 50, c: 50 });
});

test('how often each choice still wins, in times in 100, adds up to 100', () => {
  // Each share rounded on its own read "Pizza still wins 100 times in 100, Curry 1", and 74 and 27.
  assert.deepEqual(M.wholePercents({ pizza: 0.995, curry: 0.005 }), { pizza: 100, curry: 0 });
  assert.deepEqual(M.wholePercents({ pizza: 0.735, curry: 0.265 }), { pizza: 74, curry: 26 });
  const total = p => Object.values(p).reduce((s, n) => s + n, 0);
  for (let seed = 1; seed <= 300; seed++) {
    const d = randomDecision(seed);
    const shares = M.steadiness(d, M.viewOf(d, d.me), seed), times = M.wholePercents(shares);
    assert.equal(total(times), 100, `seed ${seed}: adds up to 100`);
    for (const id in shares) assert.ok(Math.abs(times[id] - shares[id] * 100) < 1, `seed ${seed}: within a point`);
  }
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
  assert.equal(M.addVoice(d, { ...a, name: 'Robin' }).replaced, false);
  assert.equal(M.addVoice(d, { ...a, name: 'robin' }).replaced, true);
  assert.equal(d.others.filter(o => o.name.toLowerCase() === 'robin').length, 1);
});

test('answers without a name are kept apart, and only a name replaces earlier answers', () => {
  const d = makeExample(1);
  const [c] = d.criteria, [o] = d.options;
  const answers = (name, s) => ({ id: d.id, name, mode: 'pairs', pairs: {}, manual: {}, scores: { [c.id]: { [o.id]: s } } });
  // A link sent without a name carries Someone, as links already sent do.
  const blank = readAnswer(pack({ v: 1, id: d.id, n: '', m: 'pairs', p: {}, s: { [c.id]: { [o.id]: 5 } } }));
  assert.equal(blank.name, 'Someone');
  assert.deepEqual(M.addVoice(d, blank), { name: 'Someone', replaced: false });
  assert.deepEqual(M.addVoice(d, answers('Someone', 1)), { name: 'Someone 2', replaced: false });
  assert.deepEqual(M.addVoice(d, answers('', 2)), { name: 'Someone 3', replaced: false }); // passing the phone without a name
  assert.deepEqual(M.addVoice(d, answers('  someone ', 3)), { name: 'Someone 4', replaced: false });
  assert.deepEqual(d.others.map(v => [v.name, v.scores[c.id][o.id]]), [['Someone', 5], ['Someone 2', 1], ['Someone 3', 2], ['Someone 4', 3]]);
  // A name replaces only its own answers.
  assert.deepEqual(M.addVoice(d, answers('Sam', 4)), { name: 'Sam', replaced: false });
  assert.deepEqual(M.addVoice(d, answers(' sam', 2)), { name: 'sam', replaced: true });
  assert.equal(d.others.length, 5);
  // A number freed by removing someone's answers is used again first.
  d.others.splice(1, 1);
  assert.equal(M.addVoice(d, answers('Someone', 4)).name, 'Someone 2');
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
  const saved = [makeExample(0), makeExample(1), makeExample(2), ...Array.from({ length: 40 }, (_, i) => randomDecision(i + 1)), ...Array.from({ length: 20 }, (_, i) => handWeighted(i + 1))];
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

  // Answers keep only the numbers the app gives them, since weights and scores go into the page's markup too.
  const odd = M.cleanDecision({
    id: 'h2', title: 'Walk or drive',
    options: [{ id: 'a', name: 'Walk' }, { id: 'b', name: 'Drive' }],
    criteria: [{ id: 'c', name: 'Cost', color: 0 }, { id: 'e', name: 'Ease', color: 1 }],
    me: { mode: 'manual', pairs: { 'c|e': '1" x="' }, manual: { c: '5" autofocus onfocus="', e: 7 }, scores: { c: { a: '<img src=x>', b: 4 }, e: { a: 2.5, b: 0 } } },
    others: [{ name: 'Sam', mode: 'pairs', pairs: { 'c|e': 2 }, manual: {}, scores: { c: { a: 0, b: '4' } } }],
  });
  assert.deepEqual(odd.me, { mode: 'manual', pairs: {}, manual: { e: 7 }, scores: { c: { b: 4 }, e: { b: 0 } } });
  assert.deepEqual([odd.others[0].pairs, odd.others[0].scores], [{ 'c|e': 2 }, { c: { a: 0 } }]);
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

test('answers that go round a bigger circle are noticed too, the smallest circle first', () => {
  const ids = ['cost', 'space', 'risk', 'looks'];
  // The first four questions: Cost over Space, Looks over Risk, Risk over Cost, Space over Looks. No three go round.
  const p = {};
  M.setPair(p, 'cost', 'space', 1);
  M.setPair(p, 'looks', 'risk', 1);
  M.setPair(p, 'risk', 'cost', 2);
  M.setPair(p, 'space', 'looks', 1);
  assert.deepEqual(M.circles(ids, p)[0], ['cost', 'space', 'looks', 'risk']);
  // The other two the same: still a circle.
  M.setPair(p, 'cost', 'looks', 0);
  M.setPair(p, 'space', 'risk', 0);
  assert.deepEqual(M.circles(ids, p)[0], ['cost', 'space', 'looks', 'risk']);
  // Space over Risk makes a circle of three as well, which comes first.
  M.setPair(p, 'space', 'risk', 1);
  assert.equal(M.circles(ids, p)[0].length, 3);
  // Answers that line up don't go round.
  const line = {};
  for (const [a, b] of [['cost', 'space'], ['space', 'risk'], ['risk', 'looks'], ['cost', 'looks']]) M.setPair(line, a, b, 1);
  assert.deepEqual(M.circles(ids, line), []);
});

test('when two choices are level, only what they differ on can tip them', () => {
  const d = M.blankDecision();
  d.options = [{ id: 'a', name: 'Grey sofa' }, { id: 'b', name: 'Green sofa' }];
  d.criteria = [{ id: 'x', name: 'Comfort', color: 0 }, { id: 'y', name: 'Price', color: 1 }, { id: 'z', name: 'Size', color: 2 }];
  const shift = (view, cid, share) => {
    const w = { ...view.w }, rest = 1 - w[cid];
    for (const id in w) w[id] = id === cid ? share : (w[id] / rest) * (1 - share);
    const [p, q] = M.ranking(d, { ...view, w });
    return Math.abs(p.total - q.total) > 1e-9;
  };
  // The same scores on everything: no weight can separate them.
  Object.assign(d.me, { mode: 'manual', manual: { x: 6, y: 3, z: 2 }, scores: { x: { a: 4, b: 4 }, y: { a: 3, b: 3 }, z: { a: 2, b: 2 } } });
  let view = M.viewOf(d, d.me);
  assert.deepEqual(M.flips(d, view, ...M.ranking(d, view)), { tie: true, differ: [] });
  for (const c of d.criteria) for (const share of [0, 0.3, 0.9]) assert.equal(shift(view, c.id, share), false);
  // Level because Comfort and Price cancel out: their weights tip it, Size's doesn't.
  Object.assign(d.me, { manual: { x: 5, y: 5, z: 5 }, scores: { x: { a: 4, b: 2 }, y: { a: 2, b: 4 }, z: { a: 3, b: 3 } } });
  view = M.viewOf(d, d.me);
  assert.deepEqual(M.flips(d, view, ...M.ranking(d, view)), { tie: true, differ: ['x', 'y'] });
  assert.equal(shift(view, 'x', 0.5), true);
  assert.equal(shift(view, 'z', 0.6), false);
});
