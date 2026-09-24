// Palier 1 of the two-scale design (docs/decisions/0002): local stocks, convoys, continuous combat.
import { describe, expect, it } from 'vitest';
import {
  apply, capacityOf, colonyNetwork, colonyStockTotal, createWorld, evaluateLink, fleetsAt, productiveSystems, rangeContext,
  restoreWorld, snapshotWorld, spawnColony, tick, type Colony, type World,
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

/** A colony with one connected outpost and warm relays. */
function withOutpost(seed: string, faction: 'concordat' | 'guild' | 'oracles' | 'corsairs' = 'concordat'): { w: World; c: Colony; outpost: string } {
  const w = createWorld(seed, { radius: 4 });
  const c = spawnColony(w, { name: 'C', faction, persona: 'vane' });
  c.createdAt = -1e9;
  const { a, b } = nearestBuildable(w, c);
  expect(apply(w, c.id, { type: 'build_relay', a, b }).ok).toBe(true);
  tick(w, 1800);
  expect(productiveSystems(w, c)).toHaveLength(2);
  return { w, c, outpost: b };
}

function warFleet(w: World, c: Colony, unit: 'corvette' | 'frigate' | 'cruiser', count: number) {
  const cap = w.systems[c.capital]!;
  cap.stock = { metal: 1e6, energy: 1e6, food: 1e6, crystal: 1e6 };
  expect(apply(w, c.id, { type: 'train', system: c.capital, unit, count }).ok).toBe(true);
  tick(w, B.UNIT_SECONDS[unit] * count + 60);
  const f = fleetsAt(w, c.capital).find((x) => x.units[unit] === count)!;
  expect(f).toBeDefined();
  return f;
}

describe('local stocks', () => {
  it('produces into each system, caps at the warehouse and reports overflow', () => {
    const { w, c, outpost } = withOutpost('ls1');
    const cap = capacityOf(w, outpost);
    expect(cap).toBe(B.WAREHOUSE_BASE_CAPACITY);
    expect(capacityOf(w, c.capital)).toBe(B.WAREHOUSE_BASE_CAPACITY * B.CAPITAL_CAPACITY_MULT);
    // Remove the starting cargos so nothing hauls the outpost's output away.
    for (const f of Object.values(w.fleets)) delete w.fleets[f.id];
    const st = w.systems[outpost]!;
    st.stock.metal = cap - 0.5; st.stock.energy = cap - 0.5; st.stock.food = cap - 0.5; st.stock.crystal = cap - 0.5;
    tick(w, 3600 - (w.time % 3600));
    expect(st.stock.metal).toBeLessThanOrEqual(cap);
    expect(c.lastOverflow.metal + c.lastOverflow.energy + c.lastOverflow.food + c.lastOverflow.crystal).toBeGreaterThan(0);
    expect(w.systems[c.capital]!.stock.metal).toBeGreaterThan(0);
  });

  it('builds a warehouse to raise the local capacity, on orbit 1', () => {
    const { w, c } = withOutpost('ls2');
    const before = capacityOf(w, c.capital);
    expect(apply(w, c.id, { type: 'build', system: c.capital, building: 'warehouse' }).ok).toBe(true);
    tick(w, B.BUILDING_SECONDS.warehouse + 60);
    expect(capacityOf(w, c.capital)).toBe(before + B.WAREHOUSE_EXTRA_CAPACITY);
    expect(w.systems[c.capital]!.structures.find((s) => s.kind === 'warehouse')!.orbit).toBe(1);
  });

  it('pays construction from the local warehouse, not from the capital', () => {
    const { w, c, outpost } = withOutpost('ls3');
    expect(apply(w, c.id, { type: 'build', system: outpost, building: 'extractor' })).toMatchObject({ ok: false, reason: 'not enough resources here' });
    w.systems[outpost]!.stock.metal = 500; w.systems[outpost]!.stock.energy = 500;
    expect(apply(w, c.id, { type: 'build', system: outpost, building: 'extractor' }).ok).toBe(true);
  });
});

describe('convoys and routes', () => {
  it('delivers a manual convoy along the network with the starting cargos', () => {
    const { w, c, outpost } = withOutpost('cv1');
    const before = w.systems[outpost]!.stock.metal;
    const res = apply(w, c.id, { type: 'convoy_send', from: c.capital, to: outpost, cargo: { metal: 100 } });
    expect(res.ok).toBe(true);
    const convoy = w.fleets[(res as { id: string }).id]!;
    expect(convoy.units.cargo).toBe(1);
    expect(convoy.cargo.metal).toBe(100);
    tick(w, 3600);
    expect(w.systems[outpost]!.stock.metal).toBeGreaterThanOrEqual(before + 100 - 1);
    expect(convoy.order.kind).toBe('idle'); // the cargo now waits at the outpost
    expect(convoy.at).toBe(outpost);
    expect(convoy.cargo.metal).toBe(0);
    expect(w.events.some((e) => e.kind === 'convoy.arrived')).toBe(true);
  });

  it('refuses a convoy without idle cargos and keeps the stock', () => {
    const { w, c, outpost } = withOutpost('cv2');
    for (const f of Object.values(w.fleets)) delete w.fleets[f.id];
    const before = w.systems[c.capital]!.stock.metal;
    expect(apply(w, c.id, { type: 'convoy_send', from: c.capital, to: outpost, cargo: { metal: 100 } }).ok).toBe(false);
    expect(w.systems[c.capital]!.stock.metal).toBe(before);
  });

  it('creates the default route on claim and hauls outpost production home', () => {
    const { w, c, outpost } = withOutpost('cv3');
    const route = Object.values(w.routes).find((r) => r.owner === c.id && r.from === outpost && r.to === c.capital);
    expect(route?.resource).toBe('all');
    // Move a cargo to the outpost and let it work.
    expect(apply(w, c.id, { type: 'convoy_send', from: c.capital, to: outpost, cargo: { food: 30 } }).ok).toBe(true);
    w.systems[outpost]!.stock.metal = 400;
    tick(w, 4 * 3600);
    expect(w.systems[outpost]!.stock.metal).toBeLessThan(200);
    expect(w.events.filter((e) => e.kind === 'convoy.sent' && e.data?.from === outpost).length).toBeGreaterThan(0);
  });

  it('limits the number of routes and removes them on demand', () => {
    const { w, c, outpost } = withOutpost('cv4');
    const limit = B.ROUTES_BASE;
    const ids: string[] = [];
    for (let i = ids.length; ; i++) {
      const r = apply(w, c.id, { type: 'route_set', from: c.capital, to: outpost, resource: (['metal', 'energy', 'food', 'crystal'] as const)[i % 4]!, perTrip: 60, whenBelow: 100 });
      if (!r.ok) break;
      ids.push((r as { id: string }).id);
      if (i > 10) throw new Error('no route limit');
    }
    expect(Object.values(w.routes).filter((r) => r.owner === c.id)).toHaveLength(limit);
    expect(apply(w, c.id, { type: 'route_remove', route: ids[0]! }).ok).toBe(true);
    expect(Object.values(w.routes).filter((r) => r.owner === c.id)).toHaveLength(limit - 1);
  });
});

describe('continuous combat', () => {
  it('an unescorted convoy is lost to an ambush; an escorted one fights through', () => {
    const w = createWorld('cb1', { radius: 4 });
    const vic = spawnColony(w, { name: 'Vic', faction: 'concordat', persona: 'vane' });
    const atk = spawnColony(w, { name: 'Atk', faction: 'corsairs', persona: 'kestrel' });
    vic.createdAt = -1e9; atk.createdAt = -1e9;
    const { a, b } = nearestBuildable(w, vic);
    expect(apply(w, vic.id, { type: 'build_relay', a, b }).ok).toBe(true);
    tick(w, 1800);
    const raiders = warFleet(w, atk, 'corvette', 2);
    w.systems[atk.capital]!.stock.energy = 1e6;
    expect(apply(w, atk.id, { type: 'fleet_order', fleet: raiders.id, order: 'ambush', target: b }).ok).toBe(true);
    tick(w, raiders.arriveAt - w.time + 5);
    expect(raiders.at).toBe(b);
    const stockBefore = w.systems[b]!.stock.metal;
    const res = apply(w, vic.id, { type: 'convoy_send', from: vic.capital, to: b, cargo: { metal: 100 } });
    expect(res.ok).toBe(true);
    const convoy = w.fleets[(res as { id: string }).id]!;
    tick(w, convoy.arriveAt - w.time + 600);
    expect(w.fleets[convoy.id]).toBeUndefined();
    expect(w.systems[b]!.stock.metal).toBeLessThan(stockBefore + 100);
    expect(w.events.some((e) => e.kind === 'convoy.lost')).toBe(true);

    // Now with an escort of six frigates (frigates counter corvettes).
    const escort = warFleet(w, vic, 'frigate', 6);
    const res2 = apply(w, vic.id, { type: 'convoy_send', from: vic.capital, to: b, cargo: { metal: 100 }, escort: escort.id });
    expect(res2.ok).toBe(true);
    const convoy2 = w.fleets[(res2 as { id: string }).id]!;
    expect(convoy2.units.frigate).toBe(6);
    tick(w, convoy2.arriveAt - w.time + 600);
    expect(Object.values(w.fleets).some((f) => f.owner === atk.id && f.units.corvette > 0)).toBe(false);
    expect(w.systems[b]!.stock.metal).toBeGreaterThanOrEqual(stockBefore + 100 - 1);
  });

  it('turrets hold a system against a small raid and the fight is logged', () => {
    const { w, c, outpost } = withOutpost('cb2');
    const atk = spawnColony(w, { name: 'Atk', faction: 'corsairs', persona: 'kestrel' });
    atk.createdAt = -1e9;
    w.systems[outpost]!.stock = { metal: 1e5, energy: 1e5, food: 1e5, crystal: 1e5 };
    expect(apply(w, c.id, { type: 'build', system: outpost, building: 'turret_light' }).ok).toBe(true);
    tick(w, B.BUILDING_SECONDS.turret_light + 60);
    expect(w.systems[outpost]!.structures.filter((s) => s.kind === 'turret_light')).toHaveLength(1);
    const raiders = warFleet(w, atk, 'corvette', 2);
    w.systems[atk.capital]!.stock.energy = 1e6;
    expect(apply(w, atk.id, { type: 'fleet_order', fleet: raiders.id, order: 'raid', target: outpost }).ok).toBe(true);
    tick(w, raiders.arriveAt - w.time + 900);
    expect(w.fleets[raiders.id]).toBeUndefined();
    expect(w.systems[outpost]!.owner).toBe(c.id);
    expect(w.systems[outpost]!.stationHp).toBeGreaterThan(0);
    const battle = Object.values(w.battles).find((b) => b.system === outpost)!;
    expect(battle.endedAt).not.toBeNull();
    expect(battle.events.some((e) => e.kind === 'kill' && e.who === c.id)).toBe(true);
    expect(w.systems[outpost]!.engaged).toBe(false);
  });

  it('counters matter: corvettes beat cruisers of equal cost, frigates beat corvettes', () => {
    const duel = (seed: string, au: 'corvette' | 'frigate' | 'cruiser', an: number, du: 'corvette' | 'frigate' | 'cruiser', dn: number): 'attacker' | 'defender' => {
      const w = createWorld(seed, { radius: 4 });
      const atk = spawnColony(w, { name: 'A', faction: 'guild', persona: 'oriel' });
      const def = spawnColony(w, { name: 'D', faction: 'guild', persona: 'oriel' });
      atk.createdAt = -1e9; def.createdAt = -1e9;
      const fa = warFleet(w, atk, au, an);
      warFleet(w, def, du, dn);
      w.systems[atk.capital]!.stock.energy = 1e6;
      w.systems[def.capital]!.structures = []; // no turrets, station only
      expect(apply(w, atk.id, { type: 'fleet_order', fleet: fa.id, order: 'blockade', target: def.capital }).ok).toBe(true);
      tick(w, fa.arriveAt - w.time + 1200);
      const aAlive = Object.values(w.fleets).some((f) => f.owner === atk.id && f.at === def.capital && f.units[au] > 0);
      const dAlive = Object.values(w.fleets).some((f) => f.owner === def.id && f.units[du] > 0);
      expect(aAlive !== dAlive).toBe(true);
      return aAlive ? 'attacker' : 'defender';
    };
    expect(duel('d1', 'corvette', 12, 'cruiser', 3)).toBe('attacker');
    expect(duel('d2', 'corvette', 6, 'frigate', 4)).toBe('defender');
    expect(duel('d3', 'frigate', 8, 'cruiser', 4)).toBe('defender');
  });

  it('a blockade needs plateau control; twelve hours later the system changes hands, capitals excepted', () => {
    const { w, c, outpost } = withOutpost('cb3');
    const atk = spawnColony(w, { name: 'Atk', faction: 'corsairs', persona: 'kestrel' });
    atk.createdAt = -1e9;
    const fleet = warFleet(w, atk, 'cruiser', 6);
    w.systems[atk.capital]!.stock.energy = 1e6;
    expect(apply(w, atk.id, { type: 'fleet_order', fleet: fleet.id, order: 'blockade', target: outpost }).ok).toBe(true);
    tick(w, fleet.arriveAt - w.time + 300);
    expect(w.systems[outpost]!.blockade?.by).toBe(atk.id);
    expect(w.events.some((e) => e.kind === 'blockade.start')).toBe(true);
    tick(w, B.BLOCKADE_CAPTURE_HOURS * 3600 + 120);
    expect(w.systems[outpost]!.owner).toBe(atk.id);
    expect(w.events.some((e) => e.kind === 'system.captured')).toBe(true);
    expect(productiveSystems(w, c)).toEqual([c.capital]);
    // The capital cannot be taken.
    w.systems[outpost]!.stock.energy = 1e5; // fuel for the off-network hop
    expect(apply(w, atk.id, { type: 'fleet_order', fleet: fleet.id, order: 'blockade', target: c.capital }).ok).toBe(true);
    tick(w, fleet.arriveAt - w.time + 300 + (B.BLOCKADE_CAPTURE_HOURS + 1) * 3600);
    expect(w.systems[c.capital]!.owner).toBe(c.id);
  });

  it('a focus order and a split fleet are accepted', () => {
    const { w, c } = withOutpost('cb4');
    const f = warFleet(w, c, 'frigate', 4);
    expect(apply(w, c.id, { type: 'split_fleet', fleet: f.id, units: { frigate: 2 } }).ok).toBe(true);
    expect(fleetsAt(w, c.capital).filter((x) => x.units.frigate === 2)).toHaveLength(2);
    expect(apply(w, c.id, { type: 'focus', fleet: f.id, target: 'station' }).ok).toBe(true);
    expect(f.focus).toBe('station');
  });
});

describe('snapshots', () => {
  it('migrates a v1 snapshot: colony stock to the capital, buildings to structures', () => {
    const w = createWorld('mig', { radius: 4 });
    const c = spawnColony(w, { name: 'M', faction: 'oracles', persona: 'solen' });
    const snap = snapshotWorld(w, { radius: 4 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v1 = JSON.parse(JSON.stringify(snap)) as { version: number; state: Record<string, any> };
    v1.version = 1;
    const st = v1.state.systems[c.capital];
    st.buildings = ['extractor', 'shipyard']; delete st.structures; delete st.stationHp; delete st.stock; delete st.engaged;
    v1.state.colonies[c.id].stock = { metal: 10, energy: 20, food: 30, crystal: 40 };
    delete v1.state.colonies[c.id].marketSystem; delete v1.state.colonies[c.id].lastOverflow;
    delete v1.state.routes; delete v1.state.battles; delete v1.state.engagedSystems;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of Object.values(v1.state.fleets) as any[]) { delete f.damage; delete f.cargo; delete f.path; delete f.pos; delete f.focus; delete f.units.cargo; }
    const w2 = restoreWorld(v1 as never);
    const cap = w2.systems[c.capital]!;
    expect(cap.stock).toEqual({ metal: 10, energy: 20, food: 30, crystal: 40 });
    expect(cap.structures.map((s) => s.kind)).toEqual(['extractor', 'shipyard']);
    expect(cap.stationHp).toBe(B.STATION_HP);
    expect(w2.colonies[c.id]!.marketSystem).toBe(c.capital);
    expect(colonyStockTotal(w2, c.id).crystal).toBe(40);
    tick(w2, 3600); // and it still runs
    expect(w2.drawIndex).toBe(0);
  });
});
