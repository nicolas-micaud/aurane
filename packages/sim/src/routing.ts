// Shortest paths along usable relays, with the waypoints (needed for convoys, which can be
// intercepted at every system they cross).
import * as B from './balance.js';
import { dist } from './geometry.js';
import { relayActive } from './network.js';
import { transitSet } from './diplomacy.js';
import type { Colony, World } from './state.js';

export interface PathPlan {
  /** Systems after `from`, ending with `to`. Empty when from === to. */
  waypoints: string[];
  /** Length of each leg, same order as waypoints. */
  legs: number[];
  onNet: boolean;
  length: number;
}

export function planPath(w: World, colony: Colony, from: string, to: string): PathPlan {
  if (from === to) return { waypoints: [], legs: [], onNet: true, length: 0 };
  const usable = transitSet(w, colony.id);
  const adj = new Map<string, { to: string; len: number }[]>();
  for (const owner of usable) for (const rid of w.relaysByOwner[owner] ?? []) {
    const r = w.relays[rid]!;
    if (!relayActive(r, w.time) || w.systems[r.a]!.stationHp <= 0 || w.systems[r.b]!.stationHp <= 0) continue;
    if (!adj.has(r.a)) adj.set(r.a, []);
    if (!adj.has(r.b)) adj.set(r.b, []);
    adj.get(r.a)!.push({ to: r.b, len: r.length });
    adj.get(r.b)!.push({ to: r.a, len: r.length });
  }
  const distMap = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null, du = Infinity;
    for (const [v, d] of distMap) if (!done.has(v) && d < du) { u = v; du = d; }
    if (u === null || u === to) break;
    done.add(u);
    for (const e of adj.get(u) ?? []) {
      const nd = du + e.len;
      if (nd < (distMap.get(e.to) ?? Infinity)) { distMap.set(e.to, nd); prev.set(e.to, u); }
    }
  }
  if (distMap.has(to)) {
    const waypoints: string[] = [];
    for (let v = to; v !== from; v = prev.get(v)!) waypoints.unshift(v);
    const legs: number[] = [];
    let last = from;
    for (const wp of waypoints) { legs.push(dist(w.galaxy.systems[last]!, w.galaxy.systems[wp]!)); last = wp; }
    return { waypoints, legs, onNet: true, length: distMap.get(to)! };
  }
  const length = dist(w.galaxy.systems[from]!, w.galaxy.systems[to]!);
  return { waypoints: [to], legs: [length], onNet: false, length };
}

/** World units per second for a fleet: the slowest unit type sets the pace. */
export function fleetSpeed(colony: Colony, units: { corvette: number; frigate: number; cruiser: number; cargo: number }, onNet: boolean): number {
  const base = units.cargo > 0 ? B.CARGO_SPEED_ON_NET : B.FLEET_SPEED_ON_NET;
  const faction = colony.faction === 'corsairs' ? B.CORSAIR_SPEED_MULT : 1;
  return (base * faction * (onNet ? 1 : B.OFF_NET_SPEED_MULT)) / 60;
}
