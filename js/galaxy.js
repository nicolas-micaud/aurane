import { createRng, hashString } from './rng.js';
import { dist, pointSegmentDistance, segmentLengthInCircle } from './geometry.js';

export const WORLD = 1000;
export const BASE_RANGE = 190;
export const PULSAR_BOOST = 1.5;
export const COST_UNIT = 10;

const SYLLABLES = ['ka', 'ra', 'vex', 'lo', 'mi', 'zen', 'tor', 'qua', 'nyx', 'sol', 'dra', 'eo',
  'lum', 'is', 'ar', 'cy', 'ven', 'tha', 'or', 'phe', 'xi', 'ul', 'no', 'bel'];

function makeName(rng) {
  const n = rng.int(2, 3);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(SYLLABLES);
  return s[0].toUpperCase() + s.slice(1) + (rng.next() < 0.35 ? `-${rng.int(2, 99)}` : '');
}

/** Range of a link starting or ending at a pulsar is boosted. */
export function linkRange(a, b) {
  return BASE_RANGE * (a.type === 'pulsar' || b.type === 'pulsar' ? PULSAR_BOOST : 1);
}

/**
 * Checks whether a relay between stars a and b is possible and what it costs.
 * Nebulae double the cost of the portion of the link that crosses them;
 * black holes swallow any link that passes through them.
 */
export function evaluateLink(galaxy, a, b) {
  const len = dist(a, b);
  if (len > linkRange(a, b)) return { ok: false, reason: 'range', len };
  for (const bh of galaxy.blackHoles) {
    if (pointSegmentDistance(bh, a, b) < bh.r) return { ok: false, reason: 'blackhole', len };
  }
  let extra = 0;
  for (const neb of galaxy.nebulae) extra += segmentLengthInCircle(a, b, neb);
  return { ok: true, len, cost: Math.max(1, Math.round((len + extra) / COST_UNIT)) };
}

export const edgeKey = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);

function buildEdges(galaxy) {
  const edges = new Map();
  const { stars } = galaxy;
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const res = evaluateLink(galaxy, stars[i], stars[j]);
      if (res.ok) edges.set(edgeKey(i, j), { a: i, b: j, cost: res.cost });
    }
  }
  return edges;
}

function terminalsConnected(n, edges, terminals) {
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges.values()) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const seen = new Set([terminals[0]]);
  const stack = [terminals[0]];
  while (stack.length) {
    const v = stack.pop();
    for (const w of adj[v]) if (!seen.has(w)) { seen.add(w); stack.push(w); }
  }
  return terminals.every((t) => seen.has(t));
}

function attempt(seed, { listeners, starCount }) {
  const rng = createRng(seed);
  const margin = 45;

  const blackHoles = [];
  const bhCount = rng.int(1, 2);
  while (blackHoles.length < bhCount) {
    const bh = { x: rng.range(220, 780), y: rng.range(220, 780), r: rng.range(34, 52) };
    if (blackHoles.every((o) => dist(o, bh) > 320)) blackHoles.push(bh);
  }

  const nebulae = [];
  const nebCount = rng.int(2, 3);
  for (let i = 0; i < nebCount; i++) {
    nebulae.push({ x: rng.range(120, 880), y: rng.range(120, 880), r: rng.range(85, 140), hue: rng.int(0, 360) });
  }

  const stars = [];
  for (let tries = 0; tries < 6000 && stars.length < starCount; tries++) {
    const p = { x: rng.range(margin, WORLD - margin), y: rng.range(margin, WORLD - margin) };
    if (stars.some((s) => dist(s, p) < 74)) continue;
    if (blackHoles.some((bh) => dist(bh, p) < bh.r + 32)) continue;
    stars.push({ ...p, type: 'relay', name: '', hue: rng.int(180, 260), size: rng.range(0.8, 1.3) });
  }

  // Earth sits near a random corner, listeners are spread as far apart as possible.
  const corner = { x: rng.pick([0, WORLD]), y: rng.pick([0, WORLD]) };
  let earth = 0;
  stars.forEach((s, i) => { if (dist(s, corner) < dist(stars[earth], corner)) earth = i; });
  const chosen = [earth];
  const listenerIdx = [];
  for (let k = 0; k < listeners; k++) {
    let best = -1, bestD = -1;
    stars.forEach((s, i) => {
      if (chosen.includes(i)) return;
      const d = Math.min(...chosen.map((c) => dist(stars[c], s))) * rng.range(0.85, 1);
      if (d > bestD) { bestD = d; best = i; }
    });
    chosen.push(best);
    listenerIdx.push(best);
  }

  stars[earth].type = 'earth';
  stars[earth].name = 'Terra';
  for (const i of listenerIdx) stars[i].type = 'listener';
  const free = rng.shuffle(stars.map((_, i) => i).filter((i) => !chosen.includes(i)));
  for (const i of free.slice(0, 4)) stars[i].type = 'pulsar';
  for (const s of stars) if (!s.name) s.name = makeName(rng);

  const galaxy = { seed, stars, blackHoles, nebulae, earth, listeners: listenerIdx };
  galaxy.edges = buildEdges(galaxy);
  galaxy.terminals = [earth, ...listenerIdx];
  return galaxy;
}

/**
 * Generates a solvable galaxy for the given seed (string or number).
 * Same seed + options => same galaxy, on every device.
 */
export function generateGalaxy(seed, { listeners = 3, starCount = 46 } = {}) {
  const base = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  for (let i = 0; i < 50; i++) {
    const g = attempt((base + i * 7919) >>> 0, { listeners, starCount });
    if (g.stars.length >= starCount * 0.8 && terminalsConnected(g.stars.length, g.edges, g.terminals)) return g;
  }
  throw new Error(`Could not generate a solvable galaxy for seed ${seed}`);
}
