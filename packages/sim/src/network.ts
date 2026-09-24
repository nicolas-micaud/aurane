import * as B from './balance.js';
import type { Faction, Stock } from '@aurane/protocol';
import {
  AMPLIFIER_RANGE_MULT, BASE_RANGE, BEACON_RANGE_MULT, CONCORDAT_RANGE_MULT, NEBULA_COST_MULT,
  PULSAR_RANGE_MULT, RELAY_BUILD_SECONDS_PER_UNIT, RELAY_COST_PER_UNIT, RELAY_UPKEEP_PER_UNIT, STORM_RANGE_MULT,
  RESOURCE_LIST,
} from './balance.js';
import { MAX_LINK_LENGTH, type Galaxy, type StarSystem } from './galaxy.js';
import { dist, pointSegmentDistance } from './geometry.js';
import { hexDistance } from './hex.js';

export interface Relay {
  id: string;            // `${a}|${b}` with a < b
  a: string;
  b: string;
  owner: string;         // colony id
  length: number;
  upkeep: number;        // energy per draw
  readyAt: number;       // sim time (s) when construction completes
  cutUntil: number;      // sim time (s) until which the relay is cut (0 = intact)
}

export const relayId = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface RangeContext {
  faction: Faction;
  /** Systems where the owner has an amplifier. */
  amplifiers: ReadonlySet<string>;
  /** Lit beacons (system ids). */
  litBeacons: readonly string[];
  /** Sectors under a storm this hour. */
  stormSectors: ReadonlySet<string>;
}

/** Effective range of a relay between two systems for a given owner. */
export function relayRange(galaxy: Galaxy, a: StarSystem, b: StarSystem, ctx: RangeContext): number {
  let range = BASE_RANGE;
  if (a.kind === 'pulsar' || b.kind === 'pulsar') range *= PULSAR_RANGE_MULT;
  if (ctx.amplifiers.has(a.id) || ctx.amplifiers.has(b.id)) range *= AMPLIFIER_RANGE_MULT;
  if (ctx.faction === 'concordat') range *= CONCORDAT_RANGE_MULT;
  for (const bid of ctx.litBeacons) {
    const beacon = galaxy.systems[bid];
    if (!beacon) continue;
    const sa = galaxy.sectors[a.sector]!, sb = galaxy.sectors[b.sector]!, sbeacon = galaxy.sectors[beacon.sector]!;
    if (hexDistance(sa.hex, sbeacon.hex) <= 2 || hexDistance(sb.hex, sbeacon.hex) <= 2) { range *= BEACON_RANGE_MULT; break; }
  }
  if (ctx.stormSectors.has(a.sector) || ctx.stormSectors.has(b.sector)) range *= STORM_RANGE_MULT;
  return range;
}

export type LinkVerdict =
  | { ok: true; length: number; cost: Stock; upkeep: number; buildSeconds: number }
  | { ok: false; reason: 'range' | 'blackhole' | 'same' | 'far'; length: number };

function verdictFromGeometry(galaxy: Galaxy, a: StarSystem, b: StarSystem, ctx: RangeContext, length: number, extra: number): LinkVerdict {
  if (length > relayRange(galaxy, a, b, ctx)) return { ok: false, reason: 'range', length };
  const effective = length + extra * (NEBULA_COST_MULT - 1);
  const cost = B.emptyStock();
  for (const r of RESOURCE_LIST) cost[r] = Math.ceil(RELAY_COST_PER_UNIT[r] * effective);
  return { ok: true, length, cost, upkeep: RELAY_UPKEEP_PER_UNIT * effective, buildSeconds: Math.round(RELAY_BUILD_SECONDS_PER_UNIT * length) };
}

/** Can a relay be built between a and b, and what does it cost? Uses the precomputed geometry. */
export function evaluateLink(galaxy: Galaxy, a: StarSystem, b: StarSystem, ctx: RangeContext): LinkVerdict {
  if (a.id === b.id) return { ok: false, reason: 'same', length: 0 };
  const cand = galaxy.candidates[a.id]?.find((c) => c.to === b.id);
  if (cand) return verdictFromGeometry(galaxy, a, b, ctx, cand.length, cand.extra);
  // Not a candidate: explain why (rare path, only for hand-issued commands).
  const length = dist(a, b);
  const sa = galaxy.sectors[a.sector]!, sb = galaxy.sectors[b.sector]!;
  if (hexDistance(sa.hex, sb.hex) > 1 || length > MAX_LINK_LENGTH) return { ok: false, reason: 'far', length };
  const sectors = sa.key === sb.key ? [sa] : [sa, sb];
  for (const s of sectors) for (const bh of s.blackHoles) if (pointSegmentDistance(bh, a, b) < bh.r) return { ok: false, reason: 'blackhole', length };
  return { ok: false, reason: 'range', length };
}

/** All buildable links from `a` for this owner, cheapest first. */
export function linkOptions(galaxy: Galaxy, a: StarSystem, ctx: RangeContext): { to: StarSystem; verdict: Extract<LinkVerdict, { ok: true }> }[] {
  const out: { to: StarSystem; verdict: Extract<LinkVerdict, { ok: true }> }[] = [];
  for (const c of galaxy.candidates[a.id] ?? []) {
    const b = galaxy.systems[c.to]!;
    const v = verdictFromGeometry(galaxy, a, b, ctx, c.length, c.extra);
    if (v.ok) out.push({ to: b, verdict: v });
  }
  return out;
}

export const relayActive = (r: Relay, now: number): boolean => r.readyAt <= now && r.cutUntil <= now;

/**
 * Systems reachable from `root` through active relays owned by `owner` (or by any owner in
 * `transit`). Returns a map system → hop distance. The heart of the game: only what is
 * connected exists.
 */
export function connectedFrom(relays: Iterable<Relay>, root: string, owner: string, now: number, transit: ReadonlySet<string> = new Set()): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const r of relays) {
    if (!relayActive(r, now)) continue;
    if (r.owner !== owner && !transit.has(r.owner)) continue;
    if (!adj.has(r.a)) adj.set(r.a, []);
    if (!adj.has(r.b)) adj.set(r.b, []);
    adj.get(r.a)!.push(r.b);
    adj.get(r.b)!.push(r.a);
  }
  const reach = new Map<string, number>([[root, 0]]);
  const queue = [root];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i]!;
    for (const w of adj.get(v) ?? []) {
      if (!reach.has(w)) { reach.set(w, reach.get(v)! + 1); queue.push(w); }
    }
  }
  return reach;
}

/** Relays whose loss disconnects part of the owner's network (graph bridges, Tarjan). */
export function findBridges(relays: Relay[], owner: string, now: number): Set<string> {
  const mine = relays.filter((r) => r.owner === owner && relayActive(r, now));
  const adj = new Map<string, { to: string; id: string }[]>();
  for (const r of mine) {
    if (!adj.has(r.a)) adj.set(r.a, []);
    if (!adj.has(r.b)) adj.set(r.b, []);
    adj.get(r.a)!.push({ to: r.b, id: r.id });
    adj.get(r.b)!.push({ to: r.a, id: r.id });
  }
  const disc = new Map<string, number>(), low = new Map<string, number>();
  const bridges = new Set<string>();
  let time = 0;
  const dfs = (v: string, parentEdge: string | null): void => {
    disc.set(v, time); low.set(v, time); time++;
    for (const e of adj.get(v) ?? []) {
      if (e.id === parentEdge) continue;
      if (!disc.has(e.to)) {
        dfs(e.to, e.id);
        low.set(v, Math.min(low.get(v)!, low.get(e.to)!));
        if (low.get(e.to)! > disc.get(v)!) bridges.add(e.id);
      } else {
        low.set(v, Math.min(low.get(v)!, disc.get(e.to)!));
      }
    }
  };
  for (const v of adj.keys()) if (!disc.has(v)) dfs(v, null);
  return bridges;
}
