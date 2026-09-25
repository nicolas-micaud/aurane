// 0007: what the player reads and feels between two Draws: the hourly recap, inbound fleets,
// the General's journal, decrees bought with Credits, and NPC Corsair pressure from day two.
import { describe, expect, it } from 'vitest';
import * as B from '../src/balance.js';
import {
  apply, createWorld, decide, fleetsAt, isWatching, rangeContext, recordNotes, restoreWorld, setOwner, snapshotWorld, spawnColony, tick, watchHours,
  type World, type Colony,
} from '../src/index.js';

const rich = (w: World, c: Colony): void => { w.systems[c.capital]!.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 1e4 }; };

describe('journal, alerts and decrees', () => {
  it('writes an hourly recap for human colonies only', () => {
    const w = createWorld('j1', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    const npc = spawnColony(w, { name: 'Npc', faction: 'concordat', persona: 'vane', npc: true });
    tick(w, 3600);
    const recaps = w.events.filter((e) => e.kind === 'draw.recap');
    expect(recaps.map((e) => e.actors[0])).toEqual([me.id]);
    expect(recaps.some((e) => e.actors[0] === npc.id)).toBe(false);
    const d = recaps[0]!.data as { index: number; produced: Record<string, number>; credits: number; productive: number };
    expect(d.index).toBe(0);
    expect(d.productive).toBe(1);
    expect(d.produced.metal).toBeGreaterThan(0);
    expect(d.credits).toBe(B.CREDITS_PER_SYSTEM_PER_DRAW);
  });

  it('announces a hostile warship heading for one of our systems, with its arrival time', () => {
    const w = createWorld('j2', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    const atk = spawnColony(w, { name: 'Atk', faction: 'corsairs', persona: 'kestrel' });
    me.createdAt = -1e9; atk.createdAt = -1e9;
    rich(w, atk);
    expect(apply(w, atk.id, { type: 'train', system: atk.capital, unit: 'corvette', count: 3 }).ok).toBe(true);
    tick(w, B.UNIT_SECONDS.corvette * 3 + 60);
    const f = fleetsAt(w, atk.capital).find((x) => x.units.corvette === 3)!;
    expect(apply(w, atk.id, { type: 'fleet_order', fleet: f.id, order: 'raid', target: me.capital }).ok).toBe(true);
    const ev = w.events.find((e) => e.kind === 'fleet.inbound');
    expect(ev).toBeDefined();
    expect(ev!.actors).toEqual([atk.id, me.id]);
    expect(ev!.data).toMatchObject({ system: me.capital, size: 3 });
    expect(Number(ev!.data!.arriveAt)).toBeGreaterThan(w.time);
    // A cargo convoy or a fleet coming home is not an alarm.
    expect(apply(w, atk.id, { type: 'train', system: atk.capital, unit: 'cargo', count: 1 }).ok).toBe(true);
    tick(w, B.UNIT_SECONDS.cargo + 60);
    const cargo = fleetsAt(w, atk.capital).find((x) => x.units.cargo >= 1)!;
    expect(cargo.units.corvette + cargo.units.frigate + cargo.units.cruiser).toBe(0);
    const before = w.events.filter((e) => e.kind === 'fleet.inbound').length;
    apply(w, atk.id, { type: 'fleet_order', fleet: cargo.id, order: 'move', target: me.capital });
    expect(w.events.filter((e) => e.kind === 'fleet.inbound').length).toBe(before);
  });

  it('keeps the General\'s notes as a capped journal for human colonies', () => {
    const w = createWorld('j3', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    const npc = spawnColony(w, { name: 'Npc', faction: 'concordat', persona: 'vane', npc: true });
    for (let i = 0; i < B.JOURNAL_MAX + 5; i++) recordNotes(w, me, [{ kind: 'expand', system: me.capital }]);
    recordNotes(w, npc, [{ kind: 'expand' }]);
    expect(me.journal.length).toBe(B.JOURNAL_MAX);
    expect(me.journal[0]).toMatchObject({ kind: 'expand', system: me.capital, at: w.time });
    expect(npc.journal.length).toBe(0);
    // The rule engine itself produces structured notes.
    rich(w, me);
    const d = decide(w, me, 1);
    for (const n of d.notes) expect(typeof n.kind).toBe('string');
  });

  it('decrees cost Credits, are public, and change range, fees and the Watch for a while', () => {
    const w = createWorld('j4', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    me.credits = 1000;
    const base = rangeContext(w, me);
    expect(base.rangeMult).toBeUndefined();
    expect(apply(w, me.id, { type: 'decree', kind: 'range' })).toMatchObject({ ok: true });
    expect(me.credits).toBe(1000 - B.DECREE_COST_CREDITS.range);
    expect(rangeContext(w, me).rangeMult).toBe(B.DECREE_RANGE_MULT);
    expect(apply(w, me.id, { type: 'decree', kind: 'range' })).toMatchObject({ ok: false, reason: 'decree already in force' });
    expect(w.events.filter((e) => e.kind === 'decree' && e.actors[0] === me.id).length).toBe(1);
    expect(watchHours(w, me)).toBe(B.WATCH_HOURS);
    expect(apply(w, me.id, { type: 'decree', kind: 'longwatch' })).toMatchObject({ ok: true });
    expect(watchHours(w, me)).toBe(B.WATCH_HOURS_DECREE);
    me.watchStartHour = (Math.floor(w.time / 3600) - 10 + 24) % 24; // ten hours into the window: only the long Watch covers it
    expect(isWatching(w, me)).toBe(true);
    tick(w, B.DECREE_HOURS.range * 3600 + 60);
    expect(rangeContext(w, me).rangeMult).toBeUndefined();
    expect(me.decrees.every((d) => d.until > w.time)).toBe(true);
    me.credits = 10;
    expect(apply(w, me.id, { type: 'decree', kind: 'freefees' })).toMatchObject({ ok: false, reason: 'not enough credits' });
  });

  it('free fees: a sale settles at the full price while the decree lasts', () => {
    const w = createWorld('j5', { radius: 4 });
    const seller = spawnColony(w, { name: 'S', faction: 'concordat', persona: 'vane' });
    const buyer = spawnColony(w, { name: 'B', faction: 'oracles', persona: 'solen' });
    rich(w, seller); rich(w, buyer);
    seller.credits = 1000; buyer.credits = 1000;
    const region = w.galaxy.systems[seller.capital]!.region;
    setOwner(w, buyer.capital, null);
    const other = Object.values(w.galaxy.systems).find((s) => s.region === region && !w.systems[s.id]!.owner && s.id !== seller.capital)!;
    setOwner(w, other.id, buyer.id); buyer.capital = other.id; buyer.marketSystem = other.id; rich(w, buyer);
    expect(apply(w, seller.id, { type: 'decree', kind: 'freefees' })).toMatchObject({ ok: true });
    const credits = seller.credits;
    expect(apply(w, seller.id, { type: 'market_order', region, resource: 'food', side: 'sell', qty: 10, price: 2 }).ok).toBe(true);
    expect(apply(w, buyer.id, { type: 'market_order', region, resource: 'food', side: 'buy', qty: 10, price: 2 }).ok).toBe(true);
    tick(w, 3600);
    const cleared = w.lastClearing.find((c) => c.region === region && c.resource === 'food');
    expect(cleared).toBeDefined();
    expect(seller.credits - credits).toBeCloseTo(10 * cleared!.price + B.CREDITS_PER_SYSTEM_PER_DRAW, 5); // no fee at all
  });

  it('NPC Corsairs raid a nearby human outpost from the second day, then wait', () => {
    const w = createWorld('j6', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    const corsair = spawnColony(w, { name: 'Cor', faction: 'corsairs', persona: 'kestrel', npc: true });
    me.createdAt = -1e9; corsair.createdAt = -1e9;
    rich(w, corsair);
    // An outpost of ours right next to their capital, undefended.
    const sector = w.galaxy.sectors[w.galaxy.systems[corsair.capital]!.sector]!;
    const outpost = sector.systems.find((id) => id !== corsair.capital && !w.systems[id]!.owner)!;
    setOwner(w, outpost, me.id);
    w.systems[outpost]!.stationHp = B.STATION_HP;
    expect(apply(w, corsair.id, { type: 'train', system: corsair.capital, unit: 'corvette', count: 4 }).ok).toBe(true);
    tick(w, B.UNIT_SECONDS.corvette * 4 + 60);
    w.drawIndex = 10;
    let d = decide(w, corsair, 1);
    expect(d.commands.some((c) => c.type === 'fleet_order' && c.order === 'raid' && c.target === outpost)).toBe(false); // too early
    w.drawIndex = B.CORSAIR_PRESSURE_FROM_DRAW;
    d = decide(w, corsair, 2);
    const raid = d.commands.find((c) => c.type === 'fleet_order' && c.order === 'raid' && c.target === outpost);
    expect(raid).toBeDefined();
    expect(d.notes).toContainEqual({ kind: 'raid', system: outpost, colony: me.id });
    for (const cmd of d.commands) apply(w, corsair.id, cmd);
    expect(w.events.some((e) => e.kind === 'fleet.inbound' && e.actors[1] === me.id)).toBe(true);
    // Cooldown: no second sortie right away even with another fleet at home.
    expect(apply(w, corsair.id, { type: 'train', system: corsair.capital, unit: 'corvette', count: 3 }).ok).toBe(true);
    tick(w, B.UNIT_SECONDS.corvette * 3 + 60);
    d = decide(w, corsair, 3);
    expect(d.commands.some((c) => c.type === 'fleet_order' && c.order === 'raid')).toBe(false);
  });

  it('snapshots carry the journal and decrees, and v4 snapshots migrate', () => {
    const w = createWorld('j7', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    me.credits = 500;
    apply(w, me.id, { type: 'decree', kind: 'range' });
    recordNotes(w, me, [{ kind: 'expand', system: me.capital }]);
    const snap = snapshotWorld(w, { radius: 4 });
    expect(snap.version).toBe(6);
    const back = restoreWorld(JSON.parse(JSON.stringify(snap)) as typeof snap);
    expect(back.colonies[me.id]!.journal).toEqual(me.journal);
    expect(back.colonies[me.id]!.decrees).toEqual(me.decrees);
    const old = JSON.parse(JSON.stringify(snap)) as { version: number; state: { colonies: Record<string, Record<string, unknown>> } };
    old.version = 4;
    for (const c of Object.values(old.state.colonies)) { delete c.journal; delete c.decrees; }
    const migrated = restoreWorld(old as unknown as typeof snap);
    expect(migrated.colonies[me.id]!.journal).toEqual([]);
    expect(migrated.colonies[me.id]!.decrees).toEqual([]);
  });
});

describe('late joiners', () => {
  it('a colony founded mid-season expands before its first Draw instead of stalling on an unmeasured income', () => {
    const w = createWorld('late1', { radius: 4 });
    spawnColony(w, { name: 'Early', faction: 'concordat', persona: 'vane', npc: true });
    tick(w, 3600 * 30); // day two of the season
    const late = spawnColony(w, { name: 'Late', faction: 'guild', persona: 'oriel' });
    // The expansion roll is seeded per tick: over a few ticks the General must try to link at least once.
    const rounds = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => decide(w, late, i));
    expect(rounds.some((d) => d.commands.some((c) => c.type === 'build_relay'))).toBe(true);
    for (const d of rounds) expect(d.notes).not.toContainEqual({ kind: 'expansion.energy' });
    // No backup relay at the capital before the colony is six hours old: the Metal goes to expansion first.
    for (const d of rounds) expect(d.commands.some((c) => c.type === 'build' && c.building === 'relay')).toBe(false);
  });
});
