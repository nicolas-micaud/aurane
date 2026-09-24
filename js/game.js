import { edgeKey, evaluateLink } from './galaxy.js';

/** Pure game state: which relays the player has built and what it costs. */
export class Game {
  constructor(galaxy, par) {
    this.galaxy = galaxy;
    this.par = par;
    this.links = new Map(); // key -> { a, b, cost }
    this.history = [];
  }

  tryLink(a, b) {
    if (a === b) return { ok: false, reason: 'same' };
    const key = edgeKey(a, b);
    if (this.links.has(key)) return { ok: false, reason: 'exists' };
    const res = evaluateLink(this.galaxy, this.galaxy.stars[a], this.galaxy.stars[b]);
    if (!res.ok) return res;
    const link = { a: Math.min(a, b), b: Math.max(a, b), cost: res.cost };
    this.links.set(key, link);
    this.history.push({ op: 'add', link });
    return { ok: true, link };
  }

  removeLink(a, b) {
    const key = edgeKey(a, b);
    const link = this.links.get(key);
    if (!link) return false;
    this.links.delete(key);
    this.history.push({ op: 'remove', link });
    return true;
  }

  undo() {
    const last = this.history.pop();
    if (!last) return false;
    const key = edgeKey(last.link.a, last.link.b);
    if (last.op === 'add') this.links.delete(key);
    else this.links.set(key, last.link);
    return true;
  }

  reset() {
    this.links.clear();
    this.history = [];
  }

  get cost() {
    let c = 0;
    for (const l of this.links.values()) c += l.cost;
    return c;
  }

  /** Stars reached by the signal, with BFS arrival distance (in cost units) from Earth. */
  powered() {
    const adj = new Map();
    for (const l of this.links.values()) {
      if (!adj.has(l.a)) adj.set(l.a, []);
      if (!adj.has(l.b)) adj.set(l.b, []);
      adj.get(l.a).push([l.b, l.cost]);
      adj.get(l.b).push([l.a, l.cost]);
    }
    const reach = new Map([[this.galaxy.earth, 0]]);
    const queue = [this.galaxy.earth];
    while (queue.length) {
      const v = queue.shift();
      for (const [w, c] of adj.get(v) || []) {
        if (!reach.has(w)) { reach.set(w, reach.get(v) + c); queue.push(w); }
      }
    }
    return reach;
  }

  connectedListeners() {
    const reach = this.powered();
    return this.galaxy.listeners.filter((l) => reach.has(l)).length;
  }

  get complete() {
    return this.connectedListeners() === this.galaxy.listeners.length;
  }

  serialize() {
    return [...this.links.values()].map((l) => [l.a, l.b]);
  }

  restore(pairs) {
    this.reset();
    for (const [a, b] of pairs || []) this.tryLink(a, b);
    this.history = [];
  }
}

/** 3 stars at par (or better), 2 within 10 %, 1 within 25 %, else 0. */
export function rating(cost, par) {
  if (cost <= par) return 3;
  if (cost <= par * 1.1) return 2;
  if (cost <= par * 1.25) return 1;
  return 0;
}
