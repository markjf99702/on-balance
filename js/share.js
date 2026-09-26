// Links that carry a decision to someone else, and their answers back.
// Everything travels in the part of the link after #, which browsers never send to a server.
//
//   #/join/<data>    the choices and what matters, so someone else can weigh and score them their way
//   #/answer/<data>  their answers, to add to the original decision

export const SITE = 'https://junkdrawer.works/on-balance/';

// Where links should point: this page when it's the real site or a local copy, the real site otherwise
// (for example the single-file copy, which lives somewhere a link can't reach).
export function base(loc = globalThis.location) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return SITE;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname);
  if (local || loc.hostname.endsWith('junkdrawer.works')) return loc.origin + loc.pathname;
  return SITE;
}

export function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unpack(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const clean = (s, max = 80) => String(s ?? '').slice(0, max);
const score = s => (Number.isInteger(s) && s >= 0 && s <= 5 ? s : undefined);

export function joinLink(decision, from) {
  return `${base()}#/join/${pack({
    v: 1,
    id: decision.id,
    t: decision.title,
    f: from || '',
    o: decision.options.map(o => [o.id, o.name]),
    c: decision.criteria.map(c => [c.id, c.name, c.color]),
  })}`;
}

export function readJoin(data) {
  const p = unpack(data);
  if (p.v !== 1 || !Array.isArray(p.o) || !Array.isArray(p.c)) throw new Error('not a decision');
  return {
    id: clean(p.id, 20),
    title: clean(p.t, 120),
    from: clean(p.f, 40),
    options: p.o.slice(0, 8).map(([id, name]) => ({ id: clean(id, 12), name: clean(name) })),
    criteria: p.c.slice(0, 8).map(([id, name, color], i) => ({ id: clean(id, 12), name: clean(name), color: Number.isInteger(color) && color >= 0 && color < 8 ? color : i })),
  };
}

export function answerLink(decision, name) {
  const v = decision.me;
  return `${base()}#/answer/${pack({
    v: 1,
    id: decision.shared.id,
    n: name,
    m: v.mode,
    p: v.pairs,
    h: v.manual,
    s: v.scores,
  })}`;
}

export function readAnswer(data) {
  const p = unpack(data);
  if (p.v !== 1 || !p.id) throw new Error('not an answer');
  const pairs = {};
  for (const [k, n] of Object.entries(p.p || {})) if ([-2, -1, 0, 1, 2].includes(n)) pairs[clean(k, 30)] = n;
  const manual = {};
  for (const [k, n] of Object.entries(p.h || {})) if (typeof n === 'number' && n >= 0 && n <= 10) manual[clean(k, 12)] = n;
  const scores = {};
  for (const [cid, row] of Object.entries(p.s || {})) {
    scores[clean(cid, 12)] = {};
    for (const [oid, s] of Object.entries(row || {})) if (score(s) !== undefined) scores[clean(cid, 12)][clean(oid, 12)] = s;
  }
  return { id: clean(p.id, 20), name: clean(p.n, 40) || 'Someone', mode: p.m === 'manual' ? 'manual' : 'pairs', pairs, manual, scores };
}
