// Points of interest (docs/decisions/0003): generation constraints, lanes, relays, probing.
import { describe, expect, it } from 'vitest';
import {
  apply, colonyNetwork, createWorld, evaluateLink, fleetsAt, generateGalaxy, hiddenFrom, knownPois, layoutOf, pathInSystem,
  productiveSystems, rangeContext, spawnColony, systemViewFor, tick, RELAY_KINDS, MAX_POIS, type Colony, type World,
} from '../src/index.js';
import * as B from '../src/balance.js';

function nearestBuildable(w: World, c: Colony): { a: string; b: string } {
  const net = colonyNetwork(w, c);
  const ctx = rangeContext(w, c);
  let best: { a: string; b: string; len: number } | null = null;
  for (const a of net.keys()) for (const [id, st] of Object.entries(w.systems)) {
    if (st.owner || net.has(id)) continue;
    const v = evaluateLink(w.galaxy, w.galaxy.systems[a]!, w.galaxy.systems[id]!, ctx);
    if (v.ok && (!best || v.length < best.len)) best = { a, b: id, len: v.length };
  }
  if (!best) throw new Error('nothing buildable');
  return best;
}

describe('system layouts', () => {
  it('every system gets a connected map with a defensible main body and a jump point', () => {
    const g = generateGalaxy('layouts', { radius: 6 });
    const templates = new Map<string, number>();
    let bodies = 0, hidden = 0;
    for (const id of Object.keys(g.systems)) {
      const l = layoutOf(g, id);
      templates.set(l.template, (templates.get(l.template) ?? 0) + 1);
      expect(l.pois.length).toBeLessThanOrEqual(MAX_POIS);
      expect(l.pois.length).toBeGreaterThanOrEqual(2);
      expect(l.jumps.length).toBeGreaterThanOrEqual(1);
      const main = l.pois.find((p) => p.id === l.main)!;
      expect(RELAY_KINDS.has(main.kind)).toBe(true);
      expect(main.orbitSlots[1]).toBeGreaterThanOrEqual(1);
      expect(main.orbitSlots[2]).toBeGreaterThanOrEqual(1);
      if (l.template !== 'lair') expect(main.cover).toBeLessThan(2);
      // Connected: every POI reachable from the first jump point.
      for (const p of l.pois) { const path = pathInSystem(l, l.jumps[0]!, p.id); if (p.id !== l.jumps[0]) expect(path.seconds).toBeGreaterThan(0); expect(path.hops[path.hops.length - 1] ?? l.jumps[0]).toBe(p.id); }
      expect(new Set(l.pois.map((p) => p.id)).size).toBe(l.pois.length);
      bodies += l.pois.filter((p) => p.kind !== 'jump').length;
      hidden += l.pois.filter((p) => p.cover >= 2).length;
    }
    expect(templates.size).toBeGreaterThanOrEqual(5); // variety, not one shape everywhere
    expect(hidden / bodies).toBeGreaterThan(0.08);
    expect(hidden / bodies).toBeLessThan(0.4);
    // Deterministic and lazy: the same galaxy again gives the same layouts.
    const g2 = generateGalaxy('layouts', { radius: 6 });
    const some = Object.keys(g.systems).slice(0, 20);
    expect(some.map((id) => JSON.stringify(layoutOf(g2, id)))).toEqual(some.map((id) => JSON.stringify(layoutOf(g, id))));
  });

  it('lane travel takes minutes and follows the shortest path', () => {
    const g = generateGalaxy('lanes', { radius: 4 });
    for (const id of Object.keys(g.systems).slice(0, 30)) {
      const l = layoutOf(g, id);
      for (const lane of l.lanes) { expect(lane.seconds).toBeGreaterThanOrEqual(45); expect(lane.seconds).toBeLessThanOrEqual(4 * 60 + 30); }
      const path = pathInSystem(l, l.jumps[0]!, l.main);
      expect(path.hops.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('salvage', () => {
  it('a fleet holding a wreck recovers Metal and Crystal for its capital until the pool runs dry', () => {
    const w = createWorld('salv', { radius: 5, rules: { onboarding: false } });
    const c = spawnColony(w, { name: 'S', faction: 'oracles', persona: 'solen' });
    const wreckSys = Object.keys(w.galaxy.systems).find((id) => layoutOf(w.galaxy, id).pois.some((p) => p.kind === 'wreck'))!;
    const wreck = layoutOf(w.galaxy, wreckSys).pois.find((p) => p.kind === 'wreck')!;
    w.systems[c.capital]!.stock = { metal: 1e6, energy: 1e6, food: 1e6, crystal: 0, rium: 1e6 };
    expect(apply(w, c.id, { type: 'train', system: c.capital, unit: 'corvette', count: 2 }).ok).toBe(true);
    tick(w, 700);
    const f = fleetsAt(w, c.capital).find((x) => x.units.corvette === 2)!;
    // Teleport for the test: park the fleet at the wreck with a holding order.
    f.at = wreckSys; f.poi = wreck.id; f.pos = null; f.order = { kind: 'defend', system: wreckSys, poi: wreck.id };
    const before = w.systems[c.capital]!.stock.crystal;
    tick(w, 3600);
    expect(w.systems[c.capital]!.stock.crystal).toBeGreaterThan(before);
    expect(w.salvage[wreck.id]).toBeLessThan(1);
    expect(w.events.some((e) => e.kind === 'salvage' && e.actors[0] === c.id)).toBe(true);
    tick(w, 40 * 3600);
    expect(w.salvage[wreck.id]).toBe(0);
    const passes = w.events.filter((e) => e.kind === 'salvage').length;
    tick(w, 3600);
    expect(w.events.filter((e) => e.kind === 'salvage').length).toBe(passes); // nothing left to take
  });
});

describe('fleets between points of interest', () => {
  it('crosses the lanes to a chosen point of interest and back to the station', () => {
    const w = createWorld('hop1', { radius: 4, rules: { onboarding: false } });
    const c = spawnColony(w, { name: 'C', faction: 'guild', persona: 'oriel' });
    w.systems[c.capital]!.stock = { metal: 1e6, energy: 1e6, food: 1e6, crystal: 1e6, rium: 1e6 };
    expect(apply(w, c.id, { type: 'train', system: c.capital, unit: 'corvette', count: 2 }).ok).toBe(true);
    tick(w, 700);
    const f = fleetsAt(w, c.capital).find((x) => x.units.corvette === 2)!;
    const st = w.systems[c.capital]!;
    const layout = layoutOf(w.galaxy, c.capital);
    const other = layout.pois.find((p) => p.id !== st.mainPoi && p.kind !== 'jump')!;
    expect(f.poi).toBe(st.mainPoi);
    expect(apply(w, c.id, { type: 'fleet_order', fleet: f.id, order: 'defend', target: `${c.capital}:${other.designation}` }).ok).toBe(true);
    expect(f.at).toBe(c.capital);
    expect(f.hop).not.toBeNull();
    const eta = pathInSystem(layout, st.mainPoi, other.id).seconds;
    tick(w, Math.ceil(eta / B.LANE_RELAYED_SPEEDUP) + 60);
    expect(f.poi).toBe(other.id);
    expect(f.hop).toBeNull();
    expect(f.order.kind).toBe('defend');
    expect(apply(w, c.id, { type: 'fleet_order', fleet: f.id, order: 'return', target: c.capital }).ok).toBe(true);
    tick(w, Math.ceil(eta / B.LANE_RELAYED_SPEEDUP) + 60);
    expect(f.poi).toBe(st.mainPoi);
    expect(f.order.kind).toBe('idle');
    expect(f.pos).toBeNull(); // docked
  });

  it('a backup relay on another body keeps the system on the Network when the station falls', () => {
    const w = createWorld('relay1', { radius: 4, rules: { onboarding: false } });
    const c = spawnColony(w, { name: 'C', faction: 'concordat', persona: 'vane' });
    c.createdAt = -1e9;
    const { a, b } = nearestBuildable(w, c);
    expect(apply(w, c.id, { type: 'build_relay', a, b }).ok).toBe(true);
    tick(w, 1800);
    const st = w.systems[b]!;
    st.stock = { metal: 1e5, energy: 1e5, food: 1e5, crystal: 1e5, rium: 1e5 };
    const layout = layoutOf(w.galaxy, b);
    const spot = layout.pois.find((p) => p.id !== st.mainPoi && RELAY_KINDS.has(p.kind) && p.orbitSlots[3] > 0);
    if (!spot) return; // this outpost has a single body: nothing to test here
    expect(apply(w, c.id, { type: 'build', system: b, building: 'relay' })).toMatchObject({ ok: false }); // not at the station
    expect(apply(w, c.id, { type: 'build', system: b, building: 'relay', poi: spot.id }).ok).toBe(true);
    tick(w, B.BUILDING_SECONDS.relay + 60);
    expect(st.structures.some((s) => s.kind === 'relay' && s.poi === spot.id)).toBe(true);
    st.stationHp = 0;
    expect(productiveSystems(w, c)).toHaveLength(2); // still connected through the relay
    st.structures = st.structures.filter((s) => s.kind !== 'relay');
    expect(productiveSystems(w, c)).toHaveLength(1);
  });

  it('a probe reveals covered points of interest, and a corsair lair stays hidden until then', () => {
    const w = createWorld('probe1', { radius: 5, rules: { onboarding: false } });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    const corsair = spawnColony(w, { name: 'Kestrel', faction: 'corsairs', persona: 'kestrel' });
    // Find (or force) a system with a covered body, and make the corsair capital a lair.
    const target = Object.keys(w.galaxy.systems).find((id) => layoutOf(w.galaxy, id).pois.some((p) => p.cover >= 2) && id !== me.capital)!;
    expect(target).toBeDefined();
    const before = knownPois(w, me.id, target);
    const hiddenIds = layoutOf(w.galaxy, target).pois.filter((p) => p.cover >= 2).map((p) => p.id);
    for (const id of hiddenIds) expect(before.has(id)).toBe(false);
    const view0 = systemViewFor(w, me, target)!;
    expect(view0.pois.filter((p) => p.cover >= 2).every((p) => !p.known)).toBe(true);
    me.influence = 100;
    expect(apply(w, me.id, { type: 'agent_mission', mission: 'probe', target }).ok).toBe(true);
    tick(w, B.AGENT_SECONDS.probe + 60);
    const after = knownPois(w, me.id, target);
    for (const id of hiddenIds) expect(after.has(id)).toBe(true);
    expect(w.events.some((e) => e.kind === 'probe.done' && e.actors[0] === me.id)).toBe(true);
    // A lair: force the corsair's main body onto a covered POI and check the owner is hidden.
    const cl = layoutOf(w.galaxy, corsair.capital);
    const covered = cl.pois.find((p) => p.cover >= 2 && RELAY_KINDS.has(p.kind));
    if (covered) {
      const cst = w.systems[corsair.capital]!;
      cst.mainPoi = covered.id;
      for (const s of cst.structures) s.poi = covered.id;
      expect(hiddenFrom(w, me.id, corsair.capital)).toBe(true);
      expect(systemViewFor(w, me, corsair.capital)!.owner).toBeNull();
      expect(systemViewFor(w, me, corsair.capital)!.signature).toBe(true);
      (w.known[me.id] ??= {})[corsair.capital] = [covered.id];
      expect(hiddenFrom(w, me.id, corsair.capital)).toBe(false);
    }
  });
});
