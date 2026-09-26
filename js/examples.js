// Worked examples, filled in all the way so the result shows straight away.
import { setPair, newId } from './model.js';

const EXAMPLES = [
  {
    title: 'Which apartment?',
    options: ['Maple Street', 'Birch Avenue', 'The loft on 5th'],
    criteria: ['Rent', 'Commute', 'Space', 'Light', 'The area'],
    // [criterion, criterion, answer]: 2 the first matters much more, 1 more, 0 the same, -1/-2 the other way.
    pairs: [[0, 1, 1], [0, 2, 1], [0, 3, 2], [0, 4, 1], [1, 2, 0], [1, 3, 1], [1, 4, 0], [2, 3, 1], [2, 4, 0], [3, 4, -1]],
    // One row per criterion, one score per option (1 poor to 5 great, 0 rules it out).
    scores: [[4, 3, 2], [2, 4, 5], [4, 4, 3], [3, 2, 5], [4, 3, 4]],
    others: [{
      name: 'Sam',
      pairs: [[0, 1, -1], [0, 2, 0], [0, 3, -1], [0, 4, 0], [1, 2, 1], [1, 3, 0], [1, 4, 1], [2, 3, -1], [2, 4, 0], [3, 4, 1]],
      scores: [[4, 3, 2], [2, 4, 5], [3, 4, 2], [3, 2, 5], [4, 1, 4]],
    }],
  },
  {
    title: 'Take the Northwind job?',
    options: ['Stay where I am', 'Northwind offer'],
    criteria: ['Pay', 'Growth', 'Commute', 'The people', 'Security'],
    pairs: [[0, 1, -1], [0, 2, 0], [0, 3, -1], [0, 4, 0], [1, 2, 1], [1, 3, 0], [1, 4, 1], [2, 3, -1], [2, 4, 0], [3, 4, 1]],
    scores: [[3, 4], [2, 5], [4, 3], [5, 3], [4, 3]],
  },
  {
    title: 'Where for the long weekend?',
    options: ['Lake cabin', 'Montreal', 'Camping at the dunes'],
    criteria: ['Cost', 'Getting there', 'Things to do', 'Rest', 'Weather'],
    manual: [7, 4, 6, 8, 5],
    scores: [[3, 2, 5], [4, 2, 4], [2, 5, 3], [5, 2, 4], [4, 4, 0]],
  },
];

export const exampleTitles = EXAMPLES.map(e => e.title);

function voice(e, ids, v) {
  const out = { pairs: {}, mode: v.manual ? 'manual' : 'pairs', manual: {}, scores: {} };
  for (const [a, b, n] of v.pairs || []) setPair(out.pairs, ids.c[a], ids.c[b], n);
  (v.manual || []).forEach((n, i) => { out.manual[ids.c[i]] = n; });
  v.scores.forEach((row, ci) => {
    out.scores[ids.c[ci]] = {};
    row.forEach((s, oi) => { out.scores[ids.c[ci]][ids.o[oi]] = s; });
  });
  return out;
}

export function makeExample(i) {
  const e = EXAMPLES[i];
  const ids = { o: [], c: [] };
  for (const _ of e.options) ids.o.push(newId(ids.o));
  for (const _ of e.criteria) ids.c.push(newId([...ids.o, ...ids.c]));
  const now = Date.now();
  return {
    id: newId(),
    title: e.title,
    example: true,
    options: e.options.map((name, i) => ({ id: ids.o[i], name })),
    criteria: e.criteria.map((name, i) => ({ id: ids.c[i], name, color: i })),
    me: voice(e, ids, e),
    others: (e.others || []).map(o => ({ name: o.name, at: now, ...voice(e, ids, o) })),
    shared: null,
    decided: null,
    created: now,
    updated: now,
  };
}
