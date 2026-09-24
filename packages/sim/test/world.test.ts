import { describe, expect, it } from 'vitest';
import * as B from '../src/balance.js';
import {
  apply, createWorld, spawnColony, tick, colonyNetwork, colonyStockTotal, productiveSystems, evaluateLink, rangeContext,
  clearAuction, resolveBattle, colonyScore, fleetsAt, planRoute, setOwner, type World, type Colony, type MarketOrder,
} from '../src/index.js';

function nearestBuildable(w: World, c: Colony): { a: string; b: string } {
  const net = colonyNetwork(w, c);
  const ctx = rangeContext(w, c);
  let best: { a: string; b: string; len: number } | null = null;
  for (const a of net.keys()) {
    for (const [id, st] of Object.entries(w.systems)) {
      if (st.owner || net.has(id)) continue;
      const v = evaluateLink(w.galaxy, w.galaxy.systems[a]!, w.galaxy.systems[id]!, ctx);
      if (v.ok && (!best || v.length < best.len)) best = { a, b: id, len: v.length };
    }
  }
  if (!best) throw new Error('nothing buildable');
  return best;
}

describe('world', () => {
  it('spawns colonies apart on the rim and runs a deterministic draw', () => {
    const mk = () => {
      const w = createWorld('w1', { radius: 5 });
      const a = spawnColony(w, { name: 'A', faction: 'concordat', persona: 'vane' });
      const b = spawnColony(w, { name: 'B', faction: 'guild', persona: 'oriel' });
      return { w, a, b };
    };
    const { w, a, b } = mk();
    expect(a.capital).not.toBe(b.capital);
    expect(w.galaxy.sectors[w.galaxy.systems[a.capital]!.sector]!.ring).toBeGreaterThanOrEqual(3);
    tick(w, 3600);
    expect(w.drawIndex).toBe(0);
    const stock = colonyStockTotal(w, a.id);
    expect(stock.metal + stock.energy + stock.food + stock.crystal).toBeGreaterThan(740);
    const again = mk();
    tick(again.w, 3600);
    expect(JSON.stringify(again.w.colonies)).toBe(JSON.stringify(w.colonies));
  });

  it('builds relays, claims systems, produces only when connected, and pays upkeep', () => {
    const w = createWorld('w2', { radius: 5 });
    const c = spawnColony(w, { name: 'C', faction: 'corsairs', persona: 'kestrel' });
    const { a, b } = nearestBuildable(w, c);
    const cap = w.systems[c.capital]!;
    const before = cap.stock.metal;
    expect(apply(w, c.id, { type: 'build_relay', a, b })).toMatchObject({ ok: true });
    expect(cap.stock.metal).toBeLessThan(before);
    expect(w.systems[b]!.owner).toBe(c.id);
    expect(productiveSystems(w, c)).toEqual([c.capital]); // relay under construction
    tick(w, 1800);
    expect(productiveSystems(w, c).sort()).toEqual([c.capital, b].sort());
    const relay = Object.values(w.relays)[0]!;
    const energyBefore = colonyStockTotal(w, c.id).energy;
    tick(w, 3600 - 1800);
    expect(w.drawIndex).toBe(0);
    expect(colonyStockTotal(w, c.id).energy).toBeGreaterThan(energyBefore - relay.upkeep - 1); // upkeep paid, production added
    expect(w.systems[b]!.stationHp).toBe(300);
    // Cutting the relay disconnects the claimed system.
    relay.cutUntil = w.time + 1000;
    expect(productiveSystems(w, c)).toEqual([c.capital]);
    expect(apply(w, c.id, { type: 'build_relay', a, b })).toMatchObject({ ok: false });
  });

  it('refuses relays that are not anchored and buildings without slots', () => {
    const w = createWorld('w3', { radius: 4 });
    const c = spawnColony(w, { name: 'C', faction: 'oracles', persona: 'solen' });
    const ids = Object.keys(w.systems).filter((id) => id !== c.capital);
    expect(apply(w, c.id, { type: 'build_relay', a: ids[0]!, b: ids[1]! })).toMatchObject({ ok: false, reason: 'not connected to your network' });
    expect(apply(w, c.id, { type: 'build', system: c.capital, building: 'antenna' })).toMatchObject({ ok: true });
    expect(apply(w, c.id, { type: 'build', system: c.capital, building: 'antenna' })).toMatchObject({ ok: false });
    tick(w, 700);
    expect(w.systems[c.capital]!.structures.map((x) => x.kind)).toContain('antenna');
    expect(w.systems[c.capital]!.structures.find((x) => x.kind === 'antenna')!.orbit).toBe(3);
  });

  it('clears the market at a uniform price and settles at the draw', () => {
    const mk = (id: string, colony: string, side: 'buy' | 'sell', qty: number, price: number): MarketOrder => ({ id, colony, region: 'R', resource: 'food', side, qty, price, placedAt: 0 });
    const res = clearAuction([mk('1', 'a', 'sell', 50, 2), mk('2', 'b', 'sell', 50, 4), mk('3', 'c', 'buy', 60, 5), mk('4', 'd', 'buy', 100, 1)]);
    expect(res.qty).toBe(60);
    expect(res.price).toBe(4.5);
    const filled = Object.fromEntries(res.fills.map((f) => [f.colony, f.qty]));
    expect(filled).toEqual({ a: 50, b: 10, c: 60 });

    const w = createWorld('w4', { radius: 4 });
    const seller = spawnColony(w, { name: 'S', faction: 'guild', persona: 'oriel' });
    const buyer = spawnColony(w, { name: 'B', faction: 'guild', persona: 'oriel' });
    // Move the buyer's capital into the seller's region so they share a market.
    const region = w.galaxy.systems[seller.capital]!.region;
    const other = Object.values(w.galaxy.systems).find((s) => s.region === region && !w.systems[s.id]!.owner && s.slots >= 1)!;
    setOwner(w, buyer.capital, null);
    buyer.capital = other.id;
    setOwner(w, other.id, buyer.id);
    expect(apply(w, seller.id, { type: 'market_order', region, resource: 'food', side: 'sell', qty: 50, price: 2 }).ok).toBe(true);
    expect(w.systems[seller.capital]!.stock.food).toBe(150);
    expect(apply(w, buyer.id, { type: 'market_order', region, resource: 'food', side: 'buy', qty: 50, price: 3 }).ok).toBe(true);
    expect(buyer.credits).toBe(150);
    tick(w, 3600);
    expect(w.lastClearing).toEqual([{ region, resource: 'food', price: 2.5, qty: 50 }]);
    expect(buyer.credits).toBeCloseTo(300 + 2 - 50 * 2.5 * (1 + 0.025), 5); // guild pays half fee; +2 credits per connected system
    expect(seller.credits).toBeCloseTo(300 + 2 + 50 * 2.5 * (1 - 0.025), 5);
    expect(Object.keys(w.orders)).toHaveLength(0);
  });

  it('the market maker backstops a colony alone in its region: energy at a premium, surplus at a discount', () => {
    const w = createWorld('w4m', { radius: 4 });
    const c = spawnColony(w, { name: 'Alone', faction: 'concordat', persona: 'vane' });
    const region = w.galaxy.systems[c.capital]!.region;
    const cap = w.systems[c.capital]!;
    cap.stock.energy = 0; c.credits = 500;
    expect(apply(w, c.id, { type: 'market_order', region, resource: 'energy', side: 'buy', qty: 30, price: 4 }).ok).toBe(true);
    expect(apply(w, c.id, { type: 'market_order', region, resource: 'metal', side: 'sell', qty: 100, price: 0.3 }).ok).toBe(true);
    tick(w, 3600);
    const energy = w.lastClearing.find((x) => x.resource === 'energy')!;
    expect(energy.qty).toBe(30);
    expect(energy.price).toBeCloseTo((4 + B.BASE_PRICE.energy * B.MAKER_SELL_MULT) / 2, 2);
    expect(cap.stock.energy).toBeGreaterThanOrEqual(30);
    const metal = w.lastClearing.find((x) => x.resource === 'metal')!;
    expect(metal.qty).toBe(B.MAKER_QTY); // the floor takes at most 40 per draw; the rest comes back
    expect(Object.keys(w.orders)).toHaveLength(0);
  });

  it('resolves battles deterministically with counters and variance bounds', () => {
    const a = { corvette: 30, frigate: 0, cruiser: 0, cargo: 0 };
    const d = { corvette: 0, frigate: 0, cruiser: 12, cargo: 0 }; // corvettes counter cruisers
    const r1 = resolveBattle(a, d, 1, 7);
    const r2 = resolveBattle(a, d, 1, 7);
    expect(r1).toEqual(r2);
    expect(r1.attackerWins).toBe(true);
    const r3 = resolveBattle({ corvette: 10, frigate: 0, cruiser: 0, cargo: 0 }, { corvette: 0, frigate: 10, cruiser: 0, cargo: 0 }, 2, 3);
    expect(r3.attackerWins).toBe(false);
    expect(r3.attackerLosses.corvette).toBeGreaterThanOrEqual(5);
  });

  it('trains fleets, moves them and raids a station, which darkens its relays', () => {
    const w = createWorld('w5', { radius: 4 });
    const atk = spawnColony(w, { name: 'Atk', faction: 'corsairs', persona: 'kestrel' });
    const vic = spawnColony(w, { name: 'Vic', faction: 'concordat', persona: 'vane' });
    // Skip newcomer shields for the test.
    atk.createdAt = -1e9; vic.createdAt = -1e9;
    const link = nearestBuildable(w, vic);
    expect(apply(w, vic.id, { type: 'build_relay', a: link.a, b: link.b }).ok).toBe(true);
    tick(w, 1800);
    expect(productiveSystems(w, vic)).toHaveLength(2);
    expect(apply(w, atk.id, { type: 'train', system: atk.capital, unit: 'corvette', count: 8 }).ok).toBe(true);
    tick(w, 8 * 300);
    const fleet = fleetsAt(w, atk.capital).find((f) => f.units.corvette > 0)!;
    expect(fleet.units.corvette).toBe(8);
    w.systems[atk.capital]!.stock.energy = 100000;
    w.systems[atk.capital]!.stock.rium = 100000;
    const outpost = link.b;
    const route = planRoute(w, atk, atk.capital, outpost);
    expect(route.onNet).toBe(false);
    expect(apply(w, atk.id, { type: 'fleet_order', fleet: fleet.id, order: 'raid', target: outpost }).ok).toBe(true);
    expect(fleet.at).toBeNull();
    tick(w, route.seconds + 60);
    expect(fleet.at).toBe(outpost);
    // The fleet drops at the jump point and crosses the lanes to the station; then 8 corvettes
    // against a 300 HP station with no defenders: it goes dark within the minute.
    tick(w, 15 * 60);
    expect(w.systems[outpost]!.stationHp).toBe(0);
    expect(w.events.some((e) => e.kind === 'relay.cut')).toBe(true);
    expect(w.events.some((e) => e.kind === 'battle.start')).toBe(true);
    expect(productiveSystems(w, vic)).toEqual([vic.capital]);
    expect(colonyScore(w, vic)).toBeGreaterThanOrEqual(0);
    // Left alone, the crews rebuild the station and the relay comes back.
    Object.values(w.fleets).filter((f) => f.owner === atk.id).forEach((f) => delete w.fleets[f.id]);
    tick(w, 13 * 3600);
    expect(w.systems[outpost]!.stationHp).toBe(300);
    expect(productiveSystems(w, vic)).toHaveLength(2);
  });

  it('ends the season at the Silence with a winner', () => {
    const w = createWorld('w6', { radius: 3, seasonDays: 1 });
    spawnColony(w, { name: 'A', faction: 'guild', persona: 'oriel' });
    spawnColony(w, { name: 'B', faction: 'oracles', persona: 'solen' });
    tick(w, 86400 + 10);
    expect(w.ended?.reason).toBe('silence');
    expect(w.ended?.winner).toBeTruthy();
  });
});
