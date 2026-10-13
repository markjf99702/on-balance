// Saves decisions in this browser. Nothing leaves the device unless you share a link or save a backup.
import { cleanDecision } from './model.js';

const KEY = 'on-balance';

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.decisions)) {
      // A damaged copy mustn't leave the page blank: put right what can be, and leave out what can't.
      data.decisions = data.decisions.map(cleanDecision).filter(Boolean);
      if (typeof data.name !== 'string') data.name = '';
      return data;
    }
  } catch { /* private window, blocked storage or bad data: start empty */ }
  return { decisions: [], name: '' };
}

let state = read();

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* can't save here; it still works for this visit */ }
}

export const store = {
  all: () => [...state.decisions].sort((a, b) => b.updated - a.updated),
  get: id => state.decisions.find(d => d.id === id),
  sharedCopy: id => state.decisions.find(d => d.shared?.id === id),
  put(d) {
    d.updated = Date.now();
    const i = state.decisions.findIndex(x => x.id === d.id);
    if (i >= 0) state.decisions[i] = d; else state.decisions.push(d);
    write();
  },
  remove(id) {
    state.decisions = state.decisions.filter(d => d.id !== id);
    write();
  },
  get name() { return state.name || ''; },
  set name(v) { state.name = String(v || '').slice(0, 40); write(); },
  backup: () => JSON.stringify({ app: 'on-balance', version: 1, saved: new Date().toISOString(), ...state }, null, 1),
  // Adds the decisions from a backup; one that's already here is replaced if the backup's copy is newer.
  restore(text) {
    const data = JSON.parse(text);
    if (data?.app !== 'on-balance' || !Array.isArray(data.decisions)) throw new Error('That file isn’t an On Balance backup.');
    let added = 0;
    for (const d of data.decisions) {
      if (!d?.id || !Array.isArray(d.options) || !Array.isArray(d.criteria) || !d.me || !cleanDecision(d)) continue;
      const mine = state.decisions.find(x => x.id === d.id);
      if (!mine) { state.decisions.push(d); added++; } else if ((d.updated || 0) > (mine.updated || 0)) { Object.assign(mine, d); added++; }
    }
    if (!state.name && typeof data.name === 'string') state.name = data.name.slice(0, 40);
    write();
    return added;
  },
};
