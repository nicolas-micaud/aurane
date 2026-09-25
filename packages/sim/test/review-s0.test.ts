// Season 0 design review (docs/design/REVIEW-S0.md): each risk as a reproducible scenario, the problem under the
// legacy rules, then the effect of the rule proposed. Seeds are fixed; nothing here depends on wall time.
import { describe, expect, it } from 'vitest';
import * as B from '../src/balance.js';
import {
  LEGACY_RULES, apply, bundleValue, captureHours, colonyNetwork, createWorld, expandGalaxy, fleetsAt, generateGalaxy, isYoung, mergeRules,
  renaissanceHoldHours, restoreWorld, setOwner, snapshotWorld, spawnColony, tick, transitSet, type Colony, type World,
} from '../src/index.js';

const rich = (w: World, c: Colony): void => { w.systems[c.capital]!.stock = { metal: 1e5, energy: 1e5, food: 1e5, crystal: 1e5, rium: 1e5 }; };
const old = (c: Colony): void => { c.createdAt = -1e9; };

/** An alliance of `n` colonies owning and having lit all Seven Beacons, connected by fiat. */
function beaconBloc(seed: string, n: number, rules: Partial<typeof LEGACY_RULES>): { w: World; members: Colony[] } {
  const w = createWorld(seed, { radius: 4, seasonDays: 56, rules: { onboarding: false, ...rules } });
  const members: Colony[] = [];
  for (let i = 0; i < n; i++) { const c = spawnColony(w, { name: `M${i}`, faction: 'concordat', persona: 'vane', npc: true }); old(c); members.push(c); }
  const lead = members[0]!;
  lead.influence = 1e6;
  apply(w, lead.id, { type: 'alliance_create', name: 'Bloc' });
  for (const m of members.slice(1)) { apply(w, lead.id, { type: 'alliance_invite', colony: m.id }); apply(w, m.id, { type: 'alliance_join', alliance: lead.alliance! }); }
  // Beacons: owned by the leader, lit by fiat (the crystal and the relay chain are not the point here).
  for (const id of w.galaxy.beacons) {
    setOwner(w, id, lead.id);
    w.systems[id]!.stationHp = B.STATION_HP;
    w.litBeacons[id] = { system: id, by: lead.id, since: w.time };
  }
  return { w, members };
}

describe('R1 · premature Renaissance', () => {
  it('legacy: a bloc holding the Seven Beacons in week 3 ends the season for everyone 24 h later', () => {
    const { w } = beaconBloc('r1-legacy', 6, LEGACY_RULES);
    tick(w, 14 * 86400); // week 3
    for (const id of w.galaxy.beacons) w.litBeacons[id]!.since = w.time;
    tick(w, 25 * 3600);
    expect(w.ended?.reason).toBe('renaissance');
    expect(w.ended!.at).toBeLessThan(15 * 86400);
  });

  it('season 0 rules: the same bloc cannot end the season before the floor date, and a coalition of twenty holds longer', () => {
    const { w } = beaconBloc('r1-s0', 6, {});
    tick(w, 14 * 86400);
    for (const id of w.galaxy.beacons) w.litBeacons[id]!.since = w.time;
    tick(w, 7 * 86400); // a full week of hold in week 3-4
    expect(w.ended).toBeNull();
    // Hold requirement grows with the bloc.
    expect(renaissanceHoldHours(w, w.colonies[Object.keys(w.colonies)[0]!]!.alliance!)).toBe(24 + 2 * (6 - 5));
    const big = beaconBloc('r1-big', 20, {});
    expect(renaissanceHoldHours(big.w, big.members[0]!.alliance!)).toBe(24 + 2 * 15);
    // From the floor date (75 % of 56 days = day 42) the hold counts: a hold that started before it completes right after.
    tick(w, (42 - 21) * 86400 - 3600);
    expect(w.ended).toBeNull();
    tick(w, 2 * 3600);
    expect(w.ended?.reason).toBe('renaissance');
    expect(w.ended!.at).toBeGreaterThanOrEqual(0.75 * w.seasonEndsAt);
  });

  it('a lit Beacon follows the capture of its system and restarts the clock; the Beacon Alert halves capture time on the bloc', () => {
    const { w, members } = beaconBloc('r1-capture', 6, {});
    const lead = members[0]!;
    expect(w.beaconAlert).toBeNull();
    tick(w, 3600); // the Draw evaluates the alert
    expect(w.beaconAlert).toBe(lead.alliance);
    expect(w.events.some((e) => e.kind === 'beacons.alert')).toBe(true);
    const beacon = w.galaxy.beacons[0]!;
    expect(captureHours(w, beacon)).toBe(B.BLOCKADE_CAPTURE_HOURS / 2);
    expect(captureHours(w, lead.capital)).toBe(B.BLOCKADE_CAPTURE_HOURS);
    // A rival blockades the beacon system: with the alert, six hours of blockade capture it, and the Beacon changes hands.
    const rival = spawnColony(w, { name: 'Rival', faction: 'corsairs', persona: 'kestrel' });
    old(rival); rich(w, rival);
    w.systems[beacon]!.stock.rium = 0;
    apply(w, rival.id, { type: 'train', system: rival.capital, unit: 'cruiser', count: 6 });
    tick(w, B.UNIT_SECONDS.cruiser * 6 + 60);
    const f = fleetsAt(w, rival.capital).find((x) => x.units.cruiser === 6)!;
    expect(apply(w, rival.id, { type: 'fleet_order', fleet: f.id, order: 'blockade', target: beacon }).ok).toBe(true);
    tick(w, f.arriveAt - w.time + 30 * 60);
    const before = w.time;
    tick(w, 7 * 3600);
    expect(w.systems[beacon]!.owner).toBe(rival.id);
    expect(w.litBeacons[beacon]!.by).toBe(rival.id);
    expect(w.litBeacons[beacon]!.since).toBeGreaterThan(before);
    expect(w.ended).toBeNull();
  });
});

describe('R2 · throwaway colonies feeding a main one', () => {
  function pair(seed: string, rules: Partial<typeof LEGACY_RULES>): { w: World; main: Colony; alt: Colony } {
    const w = createWorld(seed, { radius: 4, rules: { onboarding: false, ...rules } });
    const main = spawnColony(w, { name: 'Main', faction: 'guild', persona: 'oriel', origin: 'device-A' });
    const alt = spawnColony(w, { name: 'Alt', faction: 'guild', persona: 'oriel', origin: 'device-B' });
    return { w, main, alt };
  }
  const reach = (w: World, a: Colony, b: Colony): void => {
    // The usual throwaway set-up: the alt joins the main's alliance at once, which opens barter between them.
    if (!a.alliance) { a.influence = 1e6; apply(w, a.id, { type: 'alliance_create', name: 'Farm' }); }
    apply(w, a.id, { type: 'alliance_invite', colony: b.id });
    expect(apply(w, b.id, { type: 'alliance_join', alliance: a.alliance! }).ok).toBe(true);
  };

  it('legacy: a fresh alt gives its whole starting stock to the main in one barter', () => {
    const { w, main, alt } = pair('r2-legacy', LEGACY_RULES);
    reach(w, main, alt);
    const r = apply(w, alt.id, { type: 'barter_offer', to: main.id, give: { metal: 280, energy: 180 }, want: { food: 1 } });
    expect(r.ok).toBe(true);
    apply(w, main.id, { type: 'barter_accept', offer: (r as { id: string }).id });
    const before = w.systems[main.capital]!.stock.metal;
    tick(w, 8 * 3600); // settled at the Draw, then carried by a courier convoy
    expect(w.systems[main.capital]!.stock.metal).toBeGreaterThan(before + 200);
  });

  it('season 0 rules: a young colony cannot gift, a pair is capped per day, the same origin never trades, convoys included', () => {
    const { w, main, alt } = pair('r2-s0', {});
    reach(w, main, alt);
    expect(isYoung(w, alt)).toBe(true);
    expect(apply(w, alt.id, { type: 'barter_offer', to: main.id, give: { metal: 280, energy: 180 }, want: { food: 1 } })).toMatchObject({ ok: false, reason: 'young colonies cannot gift' });
    // A fair trade still passes for a newcomer (they may need Energy).
    expect(apply(w, alt.id, { type: 'barter_offer', to: main.id, give: { metal: 30 }, want: { energy: 20 } }).ok).toBe(true);
    // Once grown up, gifts are allowed but the pair cap binds: 600 of value per day.
    old(alt); old(main);
    rich(w, alt);
    expect(bundleValue({ metal: 500 })).toBe(500);
    expect(apply(w, alt.id, { type: 'barter_offer', to: main.id, give: { metal: 500 }, want: { food: 1 } }).ok).toBe(true);
    expect(apply(w, alt.id, { type: 'barter_offer', to: main.id, give: { metal: 200 }, want: { food: 1 } })).toMatchObject({ ok: false, reason: 'pair transfer cap reached' });
    // Convoys into the main's warehouse count against the same cap.
    apply(w, alt.id, { type: 'train', system: alt.capital, unit: 'cargo', count: 4 });
    tick(w, B.UNIT_SECONDS.cargo * 4 + 60);
    expect(apply(w, alt.id, { type: 'convoy_send', from: alt.capital, to: main.capital, cargo: { metal: 300 } })).toMatchObject({ ok: false, reason: 'pair transfer cap reached' });
    // Next day the cap resets.
    tick(w, 86400);
    expect(apply(w, alt.id, { type: 'barter_offer', to: main.id, give: { metal: 200 }, want: { food: 1 } }).ok).toBe(true);
    // Same origin: never.
    const twin = spawnColony(w, { name: 'Twin', faction: 'guild', persona: 'oriel', origin: 'device-A' });
    old(twin); reach(w, main, twin);
    expect(apply(w, twin.id, { type: 'barter_offer', to: main.id, give: { metal: 10 }, want: { food: 10 } })).toMatchObject({ ok: false, reason: 'same origin' });
    expect(apply(w, twin.id, { type: 'treaty', with: main.id, kind: 'transit' })).toMatchObject({ ok: false, reason: 'same origin' });
  });

  it('a young colony lends its relays to nobody: no throwaway bridges through an alliance', () => {
    const w = createWorld('r2-transit', { radius: 4, rules: { onboarding: false } });
    const main = spawnColony(w, { name: 'Main', faction: 'guild', persona: 'oriel' });
    const alt = spawnColony(w, { name: 'Alt', faction: 'guild', persona: 'oriel' });
    old(main); main.influence = 1e6;
    apply(w, main.id, { type: 'alliance_create', name: 'Us' });
    apply(w, main.id, { type: 'alliance_invite', colony: alt.id });
    apply(w, alt.id, { type: 'alliance_join', alliance: main.alliance! });
    expect(transitSet(w, main.id).has(alt.id)).toBe(false);
    expect(transitSet(w, alt.id).has(main.id)).toBe(true); // the newcomer may still ride its allies' relays
    tick(w, w.rules.youngColonyHours * 3600 + 3600);
    alt.createdAt = -1e9; // out of the shield too
    expect(transitSet(w, main.id).has(alt.id)).toBe(true);
    // Transit treaties cannot be granted by or to a young colony.
    const kid = spawnColony(w, { name: 'Kid', faction: 'guild', persona: 'oriel' });
    kid.influence = 100;
    expect(apply(w, kid.id, { type: 'treaty', with: main.id, kind: 'transit' })).toMatchObject({ ok: false, reason: 'young colonies cannot grant transit' });
  });
});

describe('R4 · a galaxy that grows with its population', () => {
  it('expanding by one ring keeps every existing sector identical and adds the new ring', () => {
    const g4 = generateGalaxy('grow', { radius: 4 });
    const g5 = expandGalaxy(g4, { radius: 4, baseRadius: 4 });
    expect(g5.radius).toBe(5);
    for (const [key, s] of Object.entries(g4.sectors)) expect(JSON.stringify(g5.sectors[key])).toBe(JSON.stringify(s));
    for (const [id, sys] of Object.entries(g4.systems)) expect(JSON.stringify(g5.systems[id])).toBe(JSON.stringify(sys));
    expect(Object.keys(g5.sectors).length - Object.keys(g4.sectors).length).toBe(6 * 5);
    // Restoring a grown world regenerates the same galaxy.
    const w = createWorld('grow', { radius: 4, rules: { onboarding: false } });
    w.galaxy = g5; w.galaxyOptions = { radius: 5, baseRadius: 4 };
    for (const id of Object.keys(g5.systems)) if (!w.systems[id]) w.systems[id] = { owner: null, mainPoi: '', structures: [], stationHp: 0, stock: B.emptyStock(), population: 0, buildQueue: [], trainQueue: [], blockade: null, engaged: false, engagedPois: [] };
    const back = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(w))) as ReturnType<typeof snapshotWorld>);
    expect(back.galaxy.radius).toBe(5);
    expect(Object.keys(back.galaxy.systems).sort()).toEqual(Object.keys(g5.systems).sort());
  });

  it('the world opens a ring when the rim is half occupied, and newcomers spawn on it', () => {
    const w = createWorld('grow2', { radius: 3, rules: { onboarding: false,  galaxyGrowth: { enabled: true, rimOccupancy: 0.5, maxRadius: 4 } } });
    const rim = Object.values(w.galaxy.sectors).filter((s) => s.ring >= 1).length;
    let n = 0;
    while (n < rim) { try { spawnColony(w, { name: `c${n}`, faction: 'guild', persona: 'oriel', npc: true }); n++; } catch { break; } }
    expect(n).toBeGreaterThan(rim * 0.5);
    tick(w, 3600);
    expect(w.galaxy.radius).toBe(4);
    expect(w.events.some((e) => e.kind === 'galaxy.expanded')).toBe(true);
    const late = spawnColony(w, { name: 'late', faction: 'guild', persona: 'oriel' });
    expect(w.galaxy.sectors[w.galaxy.systems[late.capital]!.sector]!.ring).toBeGreaterThanOrEqual(2);
    tick(w, 3600);
    expect(w.galaxy.radius).toBe(4); // capped
  });
});

describe('R5 · rule holes', () => {
  it('the Night Watch window changes at most once a day', () => {
    const w = createWorld('r5-watch', { radius: 4, rules: { onboarding: false } });
    const c = spawnColony(w, { name: 'W', faction: 'guild', persona: 'oriel' });
    expect(apply(w, c.id, { type: 'set_watch', startHour: 22 }).ok).toBe(true);
    expect(apply(w, c.id, { type: 'set_watch', startHour: 6 })).toMatchObject({ ok: false, reason: 'watch changed recently' });
    tick(w, 24 * 3600 + 60);
    expect(apply(w, c.id, { type: 'set_watch', startHour: 6 }).ok).toBe(true);
    expect(c.watchStartHour).toBe(6);
  });

  it('a captured system its captor never connects falls neutral after the grace period', () => {
    const w = createWorld('r5-grace', { radius: 4, rules: { onboarding: false } });
    const a = spawnColony(w, { name: 'A', faction: 'guild', persona: 'oriel' });
    const b = spawnColony(w, { name: 'B', faction: 'corsairs', persona: 'kestrel' });
    old(a); old(b);
    // B holds an outpost far from A; A "captures" it by fiat (the blockade mechanics are tested elsewhere).
    const outpost = Object.values(w.galaxy.systems).find((s) => !w.systems[s.id]!.owner && s.sector !== w.galaxy.systems[a.capital]!.sector)!;
    setOwner(w, outpost.id, a.id);
    w.systems[outpost.id]!.stationHp = B.STATION_HP;
    w.systems[outpost.id]!.capturedAt = w.time;
    expect(colonyNetwork(w, a).has(outpost.id)).toBe(false);
    tick(w, 23 * 3600);
    expect(w.systems[outpost.id]!.owner).toBe(a.id);
    tick(w, 2 * 3600);
    expect(w.systems[outpost.id]!.owner).toBeNull();
    expect(w.events.some((e) => e.kind === 'system.lapsed' && e.actors[0] === a.id)).toBe(true);
  });

  it('a fleet already under way keeps its arrival time when a relay behind it falls', () => {
    const w = createWorld('r5-transit', { radius: 4, rules: { onboarding: false } });
    const c = spawnColony(w, { name: 'C', faction: 'guild', persona: 'oriel' });
    old(c); rich(w, c);
    apply(w, c.id, { type: 'train', system: c.capital, unit: 'corvette', count: 2 });
    tick(w, B.UNIT_SECONDS.corvette * 2 + 60);
    const f = fleetsAt(w, c.capital).find((x) => x.units.corvette === 2)!;
    const far = Object.values(w.galaxy.systems).find((s) => !w.systems[s.id]!.owner && s.sector !== w.galaxy.systems[c.capital]!.sector)!;
    expect(apply(w, c.id, { type: 'fleet_order', fleet: f.id, order: 'move', target: far.id }).ok).toBe(true);
    const eta = f.arriveAt;
    for (const r of Object.values(w.relays)) r.cutUntil = w.time + 6 * 3600; // every relay cut behind the fleet
    tick(w, eta - w.time + 60);
    expect(f.at).toBe(far.id);
  });

  it('snapshots carry the season rules and legacy snapshots get the defaults', () => {
    const w = createWorld('r5-snap', { radius: 4, rules: { onboarding: false,  pairTransferCapPerDay: 123 } });
    spawnColony(w, { name: 'S', faction: 'guild', persona: 'oriel' });
    const snap = snapshotWorld(w);
    expect(snap.version).toBe(7);
    expect(restoreWorld(JSON.parse(JSON.stringify(snap)) as typeof snap).rules.pairTransferCapPerDay).toBe(123);
    const oldSnap = JSON.parse(JSON.stringify(snap)) as { version: number; state: Record<string, unknown> };
    oldSnap.version = 5;
    delete oldSnap.state.rules; delete oldSnap.state.transfers; delete oldSnap.state.galaxyOptions; delete oldSnap.state.beaconAlert;
    const back = restoreWorld(oldSnap as unknown as typeof snap);
    expect(back.rules).toEqual(mergeRules());
    expect(back.galaxyOptions.baseRadius).toBe(4);
  });
});
