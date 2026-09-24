// Points of interest: a system is a small map of planets, moons, belts, nebula pockets,
// wrecks and jump points, joined by lanes (docs/decisions/0003). Generated lazily and
// deterministically from the galaxy seed, so snapshots never store geometry.
import type { Orbit } from '@aurane/protocol';
import type { Galaxy, StarSystem } from './galaxy.js';
import { createRng, subSeed } from './rng.js';

export type PoiKind = 'rocky' | 'gas' | 'moon' | 'belt' | 'ice' | 'nebula' | 'wreck' | 'derelict' | 'jump';
export type Template = 'forge' | 'oasis' | 'crossroads' | 'graveyard' | 'sanctuary' | 'lair' | 'burnt';

export interface Poi {
  id: string;
  kind: PoiKind;
  /** Exoplanet-style designation: b, c, b-1 (moon of b), belt-1, J1 (jump point). Labelled by the client. */
  designation: string;
  /** Position on the system map, in map units (the map spans roughly ±9). */
  x: number;
  y: number;
  /** Visual size class 1..3 (also scales slots). */
  size: 1 | 2 | 3;
  /** 0 = open, 1 = some cover, 2 = hidden until probed, 3 = total cover (no structures). */
  cover: 0 | 1 | 2 | 3;
  orbitSlots: Record<Orbit, number>;
  /** Parent planet for moons. */
  parent?: string;
  /** Visual seed for the client (planet shader, belt scatter). */
  hue: number;
}
export interface Lane { a: string; b: string; seconds: number; length: number }
export interface SystemLayout {
  template: Template;
  pois: Poi[];
  lanes: Lane[];
  /** Where a new owner settles: most slots, least cover. */
  main: string;
  jumps: string[];
}

export const LANE_SECONDS_PER_UNIT = 28;
export const MAX_POIS = 7;

const SLOT_SHAPES: Record<PoiKind, [number, number, number]> = {
  rocky: [2, 1, 0], gas: [1, 2, 1], moon: [0, 1, 2], belt: [1, 1, 0], ice: [1, 0, 0], nebula: [0, 0, 0], wreck: [0, 0, 1], derelict: [1, 1, 1], jump: [0, 0, 0],
};
const COVER: Record<PoiKind, 0 | 1 | 2 | 3> = { rocky: 0, gas: 1, moon: 0, belt: 2, ice: 1, nebula: 3, wreck: 1, derelict: 0, jump: 0 };
/** Kinds that may host a relay (a station) and therefore be a main POI. */
export const RELAY_KINDS: ReadonlySet<PoiKind> = new Set(['rocky', 'gas', 'moon', 'derelict', 'belt']);

const TEMPLATE_BODIES: Record<Template, { core: PoiKind[]; extras: PoiKind[]; jumps: number; extra: number }> = {
  forge: { core: ['rocky', 'rocky', 'belt'], extras: ['moon', 'ice', 'derelict'], jumps: 1, extra: 2 },
  oasis: { core: ['gas', 'moon', 'moon', 'rocky'], extras: ['ice', 'belt'], jumps: 1, extra: 1 },
  crossroads: { core: ['rocky', 'derelict', 'gas'], extras: ['moon', 'belt', 'wreck'], jumps: 3, extra: 1 },
  graveyard: { core: ['wreck', 'wreck', 'nebula', 'rocky'], extras: ['belt', 'derelict', 'moon'], jumps: 1, extra: 1 },
  sanctuary: { core: ['rocky', 'wreck', 'moon'], extras: ['ice', 'gas'], jumps: 1, extra: 1 },
  lair: { core: ['belt', 'nebula', 'rocky', 'belt'], extras: ['wreck', 'moon'], jumps: 2, extra: 1 },
  burnt: { core: ['rocky'], extras: ['belt'], jumps: 1, extra: 1 },
};

const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Template weights from what the galaxy already says about the system: type, resource, region, distance to the core. */
function pickTemplate(g: Galaxy, sys: StarSystem, rng: ReturnType<typeof createRng>): Template {
  if (sys.kind === 'pulsar') return 'burnt';
  if (sys.kind === 'beacon') return 'sanctuary';
  const ring = g.sectors[sys.sector]?.ring ?? 0;
  const rim = ring / Math.max(1, g.radius);
  const regionTag = hashStr(sys.region) % 5; // regions lean towards a storyline: 0 forge belt, 1 trade routes, 2 the Fall, 3 oracles, 4 corsair refuges
  const w: Record<Template, number> = { forge: 1, oasis: 1, crossroads: 0.6, graveyard: 0.5, sanctuary: 0.2, lair: 0.4, burnt: 0 };
  if (sys.resource === 'metal') w.forge += 1.2;
  if (sys.resource === 'food') w.oasis += 1.2;
  if (sys.resource === 'energy') { w.oasis += 0.5; w.crossroads += 0.4; }
  if (sys.resource === 'crystal') { w.graveyard += 1.0; w.sanctuary += 0.4; }
  if (regionTag === 0) w.forge += 0.8; if (regionTag === 1) w.crossroads += 1.0; if (regionTag === 2) w.graveyard += 1.0; if (regionTag === 3) w.sanctuary += 0.6; if (regionTag === 4) w.lair += 1.0;
  if (rim > 0.7) w.lair += 0.5; else w.crossroads += 0.3;
  const total = Object.values(w).reduce((s, x) => s + x, 0);
  let r = rng.next() * total;
  for (const [k, v] of Object.entries(w) as [Template, number][]) { r -= v; if (r <= 0) return k; }
  return 'forge';
}

const cache = new WeakMap<Galaxy, Map<string, SystemLayout>>();

/** The layout of a system, generated on first use from the galaxy seed. */
export function layoutOf(g: Galaxy, systemId: string): SystemLayout {
  let m = cache.get(g);
  if (!m) { m = new Map(); cache.set(g, m); }
  const hit = m.get(systemId);
  if (hit) return hit;
  const sys = g.systems[systemId];
  if (!sys) throw new Error(`no system ${systemId}`);
  const layout = generateLayout(g, sys);
  m.set(systemId, layout);
  return layout;
}

function generateLayout(g: Galaxy, sys: StarSystem): SystemLayout {
  const rng = createRng(subSeed(g.seed, 'poi', sys.id));
  const template = pickTemplate(g, sys, rng);
  const spec = TEMPLATE_BODIES[template];
  // Body list: the template's core, then a few extras; small systems shed bodies, rich ones gain one.
  const kinds: PoiKind[] = [...spec.core];
  const extraCount = Math.min(spec.extra, Math.max(0, Math.round(rng.range(0, spec.extra + 0.6))));
  for (let i = 0; i < extraCount && spec.extras.length; i++) kinds.push(rng.pick(spec.extras));
  if (sys.slots <= 1 && kinds.length > 2) kinds.length = 2;
  if (sys.slots >= 4 && kinds.length < MAX_POIS - spec.jumps) kinds.push(rng.pick(['moon', 'belt', 'rocky']));
  while (kinds.length + spec.jumps > MAX_POIS) kinds.pop();
  if (!kinds.some((k) => RELAY_KINDS.has(k))) kinds[0] = 'rocky';

  // Slot budget: the old per-system slots (plus a little) spread over the bodies by shape.
  const budget = sys.slots + 2 + (sys.slots >= 3 ? 1 : 0);
  const shapes = kinds.map((k) => SLOT_SHAPES[k]);
  const raw = shapes.reduce((s, sh) => s + sh[0] + sh[1] + sh[2], 0) || 1;
  const scale = budget / raw;

  const pois: Poi[] = [];
  let planetIdx = 0, beltIdx = 0, moonOf: string | null = null;
  const letters = 'bcdefgh';
  const rings: Record<PoiKind, number> = { rocky: 2.8, gas: 4.8, moon: 0, belt: 6.2, ice: 7.0, nebula: 6.6, wreck: 4.2, derelict: 3.6, jump: 8.8 };
  const angles: number[] = [];
  const angleFor = (): number => { // spread bodies around the star, never closer than 40°
    for (let tries = 0; tries < 20; tries++) { const a = rng.next() * Math.PI * 2; if (angles.every((b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 0.85)) { angles.push(a); return a; } }
    const a = rng.next() * Math.PI * 2; angles.push(a); return a;
  };
  kinds.forEach((kind, i) => {
    const shape = SLOT_SHAPES[kind];
    const size = (kind === 'gas' ? 3 : kind === 'rocky' || kind === 'derelict' ? (rng.next() < 0.4 ? 3 : 2) : kind === 'moon' || kind === 'wreck' ? 1 : 2) as 1 | 2 | 3;
    const slots: Record<Orbit, number> = { 1: Math.round(shape[0] * scale), 2: Math.round(shape[1] * scale), 3: Math.round(shape[2] * scale) };
    if (kind !== 'nebula' && kind !== 'jump' && slots[1] + slots[2] + slots[3] === 0) slots[shape[0] ? 1 : shape[1] ? 2 : 3] = 1;
    if (kind === 'gas' && slots[1] < 1) slots[1] = 1; // room for a Rium refinery (decision 0004)
    let designation: string, parent: string | undefined, x: number, y: number;
    if (kind === 'moon' && moonOf) {
      const p = pois.find((q) => q.id === moonOf)!;
      const a = rng.next() * Math.PI * 2;
      x = p.x + Math.cos(a) * 2.0; y = p.y + Math.sin(a) * 2.0; parent = p.id;
      designation = `${p.designation}-${pois.filter((q) => q.parent === p.id).length + 1}`;
    } else {
      const a = angleFor();
      const r = rings[kind] + rng.range(-0.4, 0.4);
      x = Math.cos(a) * r; y = Math.sin(a) * r;
      if (kind === 'rocky' || kind === 'gas' || kind === 'derelict' || (kind === 'moon' && !moonOf)) { designation = letters[planetIdx++] ?? `p${planetIdx}`; if (kind !== 'derelict') moonOf = `${sys.id}/${designation}`; }
      else if (kind === 'belt') designation = `belt-${++beltIdx}`;
      else designation = `${kind}-${i + 1}`;
    }
    pois.push({ id: `${sys.id}/${designation}`, kind, designation, x, y, size, cover: COVER[kind], orbitSlots: slots, hue: Math.floor(rng.next() * 360), ...(parent ? { parent } : {}) });
  });
  // Main body: most slots, least cover; a lair prefers cover.
  // Outside a lair, a covered body never becomes the main one: a capital must be findable.
  const score = (p: Poi): number => (RELAY_KINDS.has(p.kind) ? 10 : -100) + (p.orbitSlots[1] + p.orbitSlots[2] + p.orbitSlots[3]) * 2 + (template === 'lair' ? p.cover * 3 : p.cover >= 2 ? -50 : -p.cover * 3);
  const main = [...pois].sort((a, b) => score(b) - score(a))[0]!;
  // The main body always has room for industry and for a gun: a station must be defensible.
  if (main.orbitSlots[1] < 1) main.orbitSlots[1] = 1;
  if (main.orbitSlots[2] < 1) main.orbitSlots[2] = 1;
  // Jump points on the rim, the first opposite the main body so an invasion crosses the system.
  const jumps: string[] = [];
  const baseA = Math.atan2(main.y, main.x) + Math.PI;
  for (let j = 0; j < spec.jumps; j++) {
    const a = baseA + (j === 0 ? 0 : (j % 2 ? 1 : -1) * (Math.PI / 2 + rng.range(-0.3, 0.3)));
    const id = `${sys.id}/J${j + 1}`;
    pois.push({ id, kind: 'jump', designation: `J${j + 1}`, x: Math.cos(a) * 8.6, y: Math.sin(a) * 8.6, size: 1, cover: 0, orbitSlots: { 1: 0, 2: 0, 3: 0 }, hue: 0 });
    jumps.push(id);
  }
  const lanes = wire(pois, rng);
  return { template, pois, lanes, main: main.id, jumps };
}

/** Minimum spanning tree over euclidean distance, plus one or two short loops. */
function wire(pois: Poi[], rng: ReturnType<typeof createRng>): Lane[] {
  const d = (a: Poi, b: Poi): number => Math.hypot(a.x - b.x, a.y - b.y);
  const inTree = new Set<string>([pois[0]!.id]);
  const lanes: Lane[] = [];
  const add = (a: Poi, b: Poi): void => { const len = d(a, b); lanes.push({ a: a.id, b: b.id, length: len, seconds: Math.round(Math.min(240, Math.max(45, len * LANE_SECONDS_PER_UNIT))) }); };
  while (inTree.size < pois.length) {
    let best: [Poi, Poi] | null = null, bd = Infinity;
    for (const a of pois) if (inTree.has(a.id)) for (const b of pois) if (!inTree.has(b.id)) { const dd = d(a, b); if (dd < bd) { bd = dd; best = [a, b]; } }
    if (!best) break;
    add(best[0], best[1]); inTree.add(best[1].id);
  }
  const has = (a: string, b: string): boolean => lanes.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  const extra = pois.length >= 5 ? 1 + (rng.next() < 0.5 ? 1 : 0) : pois.length >= 4 ? 1 : 0;
  const pairs: [Poi, Poi, number][] = [];
  for (let i = 0; i < pois.length; i++) for (let j = i + 1; j < pois.length; j++) if (!has(pois[i]!.id, pois[j]!.id) && pois[i]!.kind !== 'jump' && pois[j]!.kind !== 'jump') pairs.push([pois[i]!, pois[j]!, d(pois[i]!, pois[j]!)]);
  pairs.sort((x, y) => x[2] - y[2]);
  for (const [a, b] of pairs.slice(0, extra)) add(a, b);
  return lanes;
}

/** Shortest lane path inside a system: POIs after `from`, ending with `to`; empty when equal. */
export function pathInSystem(layout: SystemLayout, from: string, to: string): { hops: string[]; seconds: number } {
  if (from === to) return { hops: [], seconds: 0 };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null, du = Infinity;
    for (const [v, dv] of dist) if (!done.has(v) && dv < du) { u = v; du = dv; }
    if (u === null || u === to) break;
    done.add(u);
    for (const l of layout.lanes) {
      const v = l.a === u ? l.b : l.b === u ? l.a : null;
      if (!v) continue;
      const nd = du + l.seconds;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); }
    }
  }
  if (!dist.has(to)) return { hops: [to], seconds: 120 };
  const hops: string[] = [];
  for (let v = to; v !== from; v = prev.get(v)!) hops.unshift(v);
  return { hops, seconds: dist.get(to)! };
}

export function laneBetween(layout: SystemLayout, a: string, b: string): Lane | null {
  return layout.lanes.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)) ?? null;
}

export function poiOf(layout: SystemLayout, id: string): Poi | undefined { return layout.pois.find((p) => p.id === id); }

/** POIs one lane away from `id`. */
export function neighbours(layout: SystemLayout, id: string): string[] {
  return layout.lanes.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.b : l.a));
}

/** The jump point a fleet lands on when it comes from `fromSystem` (nearest bearing), or the first one. */
export function entryJump(g: Galaxy, systemId: string, fromSystem: string | null): string {
  const layout = layoutOf(g, systemId);
  if (!fromSystem || layout.jumps.length === 1) return layout.jumps[0]!;
  const a = g.systems[fromSystem], b = g.systems[systemId];
  if (!a || !b) return layout.jumps[0]!;
  const bearing = Math.atan2(a.y - b.y, a.x - b.x);
  let best = layout.jumps[0]!, bd = Infinity;
  for (const j of layout.jumps) { const p = poiOf(layout, j)!; const dd = Math.abs(((Math.atan2(p.y, p.x) - bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (dd < bd) { bd = dd; best = j; } }
  return best;
}
