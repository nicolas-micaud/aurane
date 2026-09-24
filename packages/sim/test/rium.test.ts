// Rium: the fifth resource (decision 0004). Mined at gas giants, synthesized from stock, burnt by fleets.
import { describe, expect, it } from 'vitest';
import { apply, createWorld, fleetsAt, layoutOf, spawnColony, tick, type World } from '../src/index.js';
import * as B from '../src/balance.js';

/** A colony whose capital layout holds a gas giant with a free industry slot. */
function withGasGiant(seed: string): { w: World; c: ReturnType<typeof spawnColony>; gas: string } {
  for (let i = 0; i < 40; i++) {
    const w = createWorld(`${seed}${i}`, { radius: 4 });
    const c = spawnColony(w, { name: 'R', faction: 'guild', persona: 'oriel' });
    c.createdAt = -1e9;
    const gas = layoutOf(w.galaxy, c.capital).pois.find((p) => p.kind === 'gas' && p.orbitSlots[1] > 0);
    if (gas) return { w, c, gas: gas.id };
  }
  throw new Error('no seed with a gas giant at the capital');
}

describe('rium', () => {
  it('is part of every stock and the capital starts with a fuel allowance', () => {
    const w = createWorld('rium0', { radius: 4 });
    const c = spawnColony(w, { name: 'R', faction: 'concordat', persona: 'vane' });
    expect(w.systems[c.capital]!.stock.rium).toBe(B.STARTING_STOCK.rium);
    expect(B.RESOURCE_LIST).toContain('rium');
    // No system produces Rium by nature.
    expect(Object.values(w.galaxy.systems).some((s) => s.resource === 'rium')).toBe(false);
  });

  it('a refinery only builds at a gas giant and mines Rium every draw', () => {
    const { w, c, gas } = withGasGiant('rium1');
    const cap = w.systems[c.capital]!;
    cap.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 0 };
    expect(apply(w, c.id, { type: 'build', system: c.capital, building: 'refinery' }).ok).toBe(false); // main body, not a gas giant
    expect(apply(w, c.id, { type: 'build', system: c.capital, building: 'refinery', poi: gas }).ok).toBe(true);
    tick(w, B.BUILDING_SECONDS.refinery + 60);
    expect(cap.structures.some((s) => s.kind === 'refinery' && s.poi === gas)).toBe(true);
    const before = cap.stock.rium;
    tick(w, B.DRAW_INTERVAL_S);
    // Mined Rium lands in the station's stock when the giant is the main body, else it waits in the depot.
    const mined = cap.mainPoi === gas ? cap.stock.rium - before : w.depots[gas] ?? 0;
    expect(mined).toBeGreaterThanOrEqual(B.RIUM_REFINERY_YIELD - 0.01);
  });

  it('a cargo parked at the depot shuttles the Rium to the station and goes back for more', () => {
    const { w, c, gas } = withGasGiant('rium6');
    const cap = w.systems[c.capital]!;
    if (cap.mainPoi === gas) return; // nothing to shuttle when the giant is the main body
    cap.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 0 };
    expect(apply(w, c.id, { type: 'build', system: c.capital, building: 'refinery', poi: gas }).ok).toBe(true);
    expect(apply(w, c.id, { type: 'train', system: c.capital, unit: 'cargo', count: 2 }).ok).toBe(true);
    tick(w, B.BUILDING_SECONDS.refinery + 60);
    const cargo = fleetsAt(w, c.capital).find((x) => x.units.cargo >= 2 && x.units.corvette + x.units.frigate + x.units.cruiser === 0)!;
    w.depots[gas] = 200;
    const designation = layoutOf(w.galaxy, c.capital).pois.find((p) => p.id === gas)!.designation;
    expect(apply(w, c.id, { type: 'fleet_order', fleet: cargo.id, order: 'move', target: `${c.capital}:${designation}` }).ok).toBe(true);
    const stockBefore = cap.stock.rium;
    tick(w, 3 * 600 + 4 * 240); // lane there, load on the route cadence, lane back, unload
    expect(w.events.some((e) => e.kind === 'depot.loaded')).toBe(true);
    expect(cap.stock.rium).toBeGreaterThan(stockBefore);
    expect(cargo.shuttle).toBe(gas); // keeps ferrying
    // An explicit order ends the shuttle.
    expect(apply(w, c.id, { type: 'fleet_order', fleet: cargo.id, order: 'return', target: '' }).ok).toBe(true);
    expect(cargo.shuttle).toBeUndefined();
  });

  it('a raid that breaks a refinery carries off most of its depot', () => {
    const { w, c, gas } = withGasGiant('rium7');
    const cap = w.systems[c.capital]!;
    if (cap.mainPoi === gas) return;
    cap.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 0 };
    expect(apply(w, c.id, { type: 'build', system: c.capital, building: 'refinery', poi: gas }).ok).toBe(true);
    tick(w, B.BUILDING_SECONDS.refinery + 60);
    const refinery = cap.structures.find((s) => s.kind === 'refinery')!;
    w.depots[gas] = 300;
    const atk = spawnColony(w, { name: 'Atk', faction: 'corsairs', persona: 'kestrel' });
    atk.createdAt = -1e9; c.createdAt = -1e9;
    w.systems[atk.capital]!.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 1e4 };
    expect(apply(w, atk.id, { type: 'train', system: atk.capital, unit: 'cruiser', count: 6 }).ok).toBe(true);
    tick(w, B.UNIT_SECONDS.cruiser * 6 + 60);
    const f = fleetsAt(w, atk.capital).find((x) => x.units.cruiser === 6)!;
    const riumBefore = w.systems[atk.capital]!.stock.rium;
    expect(apply(w, atk.id, { type: 'fleet_order', fleet: f.id, order: 'raid', target: `${c.capital}:${refinery.id}` }).ok).toBe(true);
    tick(w, f.arriveAt - w.time + 40 * 60);
    const raided = w.events.find((e) => e.kind === 'refinery.raided');
    expect(raided).toBeDefined();
    expect(Number(raided!.data!.rium)).toBeGreaterThanOrEqual(100);
    expect(cap.structures.some((s) => s.id === refinery.id)).toBe(false); // broken: to be rebuilt
    expect(w.systems[atk.capital]!.stock.rium).toBeGreaterThan(riumBefore - 200); // fuel spent, plunder recovered part of it
  });

  it('the fuel doctrine is compiled from the persona and steers the General', () => {
    const w = createWorld('rium8', { radius: 4 });
    const vane = spawnColony(w, { name: 'V', faction: 'concordat', persona: 'vane' });
    const kestrel = spawnColony(w, { name: 'K', faction: 'corsairs', persona: 'kestrel' });
    expect(vane.policy.fuel).toBe('synthesizer');
    expect(kestrel.policy.fuel).toBe('refinery');
  });

  it('a synthesizer turns Energy and Food into Rium at the draw, and idles when the stock is short', () => {
    const w = createWorld('rium2', { radius: 4 });
    const c = spawnColony(w, { name: 'R', faction: 'oracles', persona: 'solen' });
    c.createdAt = -1e9;
    const cap = w.systems[c.capital]!;
    cap.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 0 };
    expect(apply(w, c.id, { type: 'build', system: c.capital, building: 'synthesizer' }).ok).toBe(true);
    tick(w, B.BUILDING_SECONDS.synthesizer + 60);
    const e0 = cap.stock.energy, f0 = cap.stock.food;
    tick(w, B.DRAW_INTERVAL_S);
    expect(cap.stock.rium).toBeGreaterThanOrEqual(B.RIUM_SYNTH_OUTPUT);
    // Inputs were taken (production of the draw is added on top, so compare against the input size).
    expect(e0 - cap.stock.energy + c.lastProduced.energy).toBeGreaterThanOrEqual(B.RIUM_SYNTH_INPUT.energy - 0.01);
    expect(f0 - cap.stock.food + c.lastProduced.food).toBeGreaterThanOrEqual(B.RIUM_SYNTH_INPUT.food - 0.01);
    cap.stock.energy = 0; cap.stock.rium = 0;
    tick(w, B.DRAW_INTERVAL_S);
    expect(cap.stock.rium).toBeLessThan(B.RIUM_SYNTH_OUTPUT);
  });

  it('off-network departures burn Rium, not Energy, and a fleet without fuel stays put', () => {
    const w = createWorld('rium3', { radius: 4 });
    const c = spawnColony(w, { name: 'R', faction: 'corsairs', persona: 'kestrel' });
    c.createdAt = -1e9;
    const cap = w.systems[c.capital]!;
    cap.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 1e4 };
    expect(apply(w, c.id, { type: 'train', system: c.capital, unit: 'corvette', count: 4 }).ok).toBe(true);
    tick(w, B.UNIT_SECONDS.corvette * 4 + 60);
    const f = fleetsAt(w, c.capital).find((x) => x.units.corvette === 4)!;
    const far = Object.keys(w.galaxy.systems).find((id) => id !== c.capital && !w.systems[id]!.owner)!;
    cap.stock.rium = 0;
    const energy = cap.stock.energy;
    expect(apply(w, c.id, { type: 'fleet_order', fleet: f.id, order: 'move', target: far }).ok).toBe(false);
    cap.stock.rium = 1e4;
    expect(apply(w, c.id, { type: 'fleet_order', fleet: f.id, order: 'move', target: far }).ok).toBe(true);
    expect(cap.stock.rium).toBeLessThan(1e4);
    expect(cap.stock.energy).toBe(energy);
  });

  it('fleets deployed in foreign space cost Rium at every draw and run dry when the capital cannot pay', () => {
    const w = createWorld('rium4', { radius: 4 });
    const c = spawnColony(w, { name: 'R', faction: 'concordat', persona: 'vane' });
    c.createdAt = -1e9;
    const cap = w.systems[c.capital]!;
    cap.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 1e4 };
    expect(apply(w, c.id, { type: 'train', system: c.capital, unit: 'frigate', count: 5 }).ok).toBe(true);
    tick(w, B.UNIT_SECONDS.frigate * 5 + 60);
    const f = fleetsAt(w, c.capital).find((x) => x.units.frigate === 5)!;
    const far = Object.keys(w.galaxy.systems).find((id) => id !== c.capital && !w.systems[id]!.owner)!;
    // Teleport for the test: parked in an unclaimed system.
    f.at = far; f.poi = w.systems[far]!.mainPoi; f.pos = null; f.order = { kind: 'defend', system: far, poi: w.systems[far]!.mainPoi };
    cap.stock.rium = 100;
    tick(w, B.DRAW_INTERVAL_S);
    expect(cap.stock.rium).toBeLessThanOrEqual(100 - 5 * B.RIUM_OPS_PER_SHIP_PER_DRAW + 0.01);
    expect(f.dry).toBe(false);
    cap.stock.rium = 0;
    tick(w, B.DRAW_INTERVAL_S);
    expect(f.dry).toBe(true);
    expect(w.events.some((e) => e.kind === 'fleets.dry')).toBe(true);
  });

  it('Rium trades on the market like any other resource', () => {
    const w = createWorld('rium5', { radius: 4 });
    const c = spawnColony(w, { name: 'R', faction: 'guild', persona: 'oriel' });
    const region = w.galaxy.sectors[w.galaxy.systems[c.capital]!.sector]!.region;
    expect(apply(w, c.id, { type: 'market_order', region, resource: 'rium', side: 'sell', qty: 10, price: 3 }).ok).toBe(true);
  });
});
