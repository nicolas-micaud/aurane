import type { Building, Command, Faction, Fleet, Persona, Resource, Stock, StockDelta, UnitType } from '@starnet/protocol';
import { DEFAULT_POLICY, PERSONA_DEFAULTS, PolicySchema } from '@starnet/protocol';
import * as B from './balance.js';
import { generateGalaxy, type GalaxyOptions, type StarSystem } from './galaxy.js';
import { hexNeighbors, hexKey } from './hex.js';
import { dist } from './geometry.js';
import { connectedFrom, evaluateLink, linkOptions, relayActive, relayId, type RangeContext, type Relay } from './network.js';
import { rollDraw, type Draw } from './draw.js';
import { clearAuction, marketKey } from './market.js';
import { addFleet, resolveBattle, subtractFleet } from './combat.js';
import { atPeace, isAlly, transitSet } from './diplomacy.js';
import { createRng, subSeed } from './rng.js';
import {
  emptyFleet, fleetSize, newId,
  type Colony, type FleetState, type SystemState, type World, type WorldEvent, type TreatyKind,
} from './state.js';

export type ApplyResult = { ok: true; id?: string } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface WorldOptions extends GalaxyOptions {
  seasonDays?: number;
}

export function createWorld(seed: number | string, opts: WorldOptions = {}): World {
  const galaxy = generateGalaxy(seed, opts);
  const systems: Record<string, SystemState> = {};
  for (const id of Object.keys(galaxy.systems)) {
    systems[id] = { owner: null, buildings: [], population: 0, buildQueue: [], trainQueue: [], blockade: null };
  }
  return {
    seed: galaxy.seed, galaxy, time: 0, seasonEndsAt: (opts.seasonDays ?? B.SEASON_DAYS) * 86400,
    drawIndex: -1, lastDraw: null, colonies: {}, systems, relays: {}, fleets: {}, orders: {}, barters: {},
    treaties: {}, proposals: [], alliances: {}, missions: {}, reveals: {}, litBeacons: {}, lastClearing: [],
    events: [], titles: { network: null, admiralty: null, exchange: null }, ended: null, nextId: 1, owned: {}, relaysByOwner: {}, treatiesByColony: {},
  };
}

export function logEvent(w: World, kind: string, actors: string[], data?: Record<string, unknown>): void {
  const ev: WorldEvent = { at: w.time, kind, actors };
  if (data) ev.data = data;
  w.events.push(ev);
}

// ---------------------------------------------------------------------------
// Stock helpers
// ---------------------------------------------------------------------------

export function stockHas(stock: Stock, cost: StockDelta): boolean {
  for (const r of B.RESOURCE_LIST) if ((cost[r] ?? 0) > stock[r] + 1e-9) return false;
  return true;
}
export function stockSub(stock: Stock, cost: StockDelta): void {
  for (const r of B.RESOURCE_LIST) stock[r] -= cost[r] ?? 0;
}
export function stockAdd(stock: Stock, add: StockDelta): void {
  for (const r of B.RESOURCE_LIST) stock[r] += add[r] ?? 0;
}
export function scaleStock(cost: StockDelta, k: number): StockDelta {
  const out: StockDelta = {};
  for (const r of B.RESOURCE_LIST) if (cost[r] !== undefined) out[r] = Math.ceil(cost[r]! * k);
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const currentHour = (w: World): number => Math.floor(w.time / 3600) % 24;

export function slotsOf(w: World, sys: StarSystem): number {
  const st = w.systems[sys.id]!;
  const isCapital = st.owner !== null && w.colonies[st.owner]?.capital === sys.id;
  return sys.slots + (isCapital ? B.CAPITAL_EXTRA_SLOTS : 0);
}

export function hasBuilding(w: World, systemId: string, b: Building): boolean {
  return w.systems[systemId]!.buildings.includes(b);
}

export function stormSectors(w: World): Set<string> {
  const out = new Set<string>();
  const ev = w.lastDraw?.event;
  if (ev?.kind === 'storm') for (const s of Object.values(w.galaxy.sectors)) if (s.region === ev.region) out.add(s.key);
  return out;
}

export function rangeContext(w: World, colony: Colony): RangeContext {
  const amplifiers = new Set<string>();
  for (const id of ownedSystems(w, colony.id)) if (w.systems[id]!.buildings.includes('amplifier')) amplifiers.add(id);
  return { faction: colony.faction, amplifiers, litBeacons: Object.keys(w.litBeacons), stormSectors: stormSectors(w) };
}

/** Systems connected to the colony's capital, with hop distance. Only these exist. */
export function colonyNetwork(w: World, colony: Colony): Map<string, number> {
  const transit = transitSet(w, colony.id);
  const relays: Relay[] = [];
  for (const owner of transit) for (const id of w.relaysByOwner[owner] ?? []) relays.push(w.relays[id]!);
  return connectedFrom(relays, colony.capital, colony.id, w.time, transit);
}

export function addRelay(w: World, relay: Relay): void {
  w.relays[relay.id] = relay;
  (w.relaysByOwner[relay.owner] ??= []).push(relay.id);
}

export function removeRelay(w: World, id: string): void {
  const r = w.relays[id];
  if (!r) return;
  delete w.relays[id];
  const list = w.relaysByOwner[r.owner];
  if (list) { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); }
}

export function ownedSystems(w: World, colonyId: string): string[] {
  return w.owned[colonyId] ?? [];
}

/** The only way ownership changes: keeps the per-colony index in sync. */
export function setOwner(w: World, systemId: string, owner: string | null): void {
  const st = w.systems[systemId]!;
  if (st.owner === owner) return;
  if (st.owner) {
    const list = w.owned[st.owner];
    if (list) { const i = list.indexOf(systemId); if (i >= 0) list.splice(i, 1); }
  }
  st.owner = owner;
  if (owner) (w.owned[owner] ??= []).push(systemId);
}

/** Owned systems that are connected to the capital right now. */
export function productiveSystems(w: World, colony: Colony): string[] {
  const net = colonyNetwork(w, colony);
  return ownedSystems(w, colony.id).filter((id) => net.has(id));
}

export function colonyRelays(w: World, colonyId: string): Relay[] {
  return (w.relaysByOwner[colonyId] ?? []).map((id) => w.relays[id]!);
}

/** Regions whose market the colony can trade on: touched by its network, plus one per tradepost. */
export function reachableRegions(w: World, colony: Colony): Set<string> {
  const regions = new Set<string>();
  const sectors = new Set<string>();
  for (const id of colonyNetwork(w, colony).keys()) {
    const sys = w.galaxy.systems[id]!;
    regions.add(sys.region);
    sectors.add(sys.sector);
  }
  let extra = ownedSystems(w, colony.id).filter((id) => hasBuilding(w, id, 'tradepost')).length;
  if (colony.faction === 'guild') extra += 1;
  if (extra > 0) {
    // Expand to adjacent regions, nearest first, up to `extra` new regions.
    const frontier = new Set<string>();
    for (const key of sectors) for (const n of hexNeighbors(w.galaxy.sectors[key]!.hex)) {
      const ns = w.galaxy.sectors[hexKey(n)];
      if (ns && !regions.has(ns.region)) frontier.add(ns.region);
    }
    for (const r of [...frontier].sort()) { if (extra-- <= 0) break; regions.add(r); }
  }
  return regions;
}

export function visibleSectors(w: World, colony: Colony): Set<string> {
  const out = new Set<string>();
  const addWithNeighbors = (key: string, antenna: boolean): void => {
    out.add(key);
    if (antenna) for (const n of hexNeighbors(w.galaxy.sectors[key]!.hex)) if (w.galaxy.sectors[hexKey(n)]) out.add(hexKey(n));
  };
  for (const other of Object.values(w.colonies)) {
    if (other.id !== colony.id && !isAlly(w, colony.id, other.id)) continue;
    for (const id of ownedSystems(w, other.id)) addWithNeighbors(w.galaxy.systems[id]!.sector, hasBuilding(w, id, 'antenna'));
    for (const id of colonyNetwork(w, other).keys()) out.add(w.galaxy.systems[id]!.sector);
  }
  for (const [sector, until] of Object.entries(w.reveals[colony.id] ?? {})) if (until > w.time) out.add(sector);
  return out;
}

export function isShielded(w: World, colony: Colony): boolean {
  return w.time - colony.createdAt < B.NEWCOMER_SHIELD_HOURS * 3600;
}

export function isWatching(w: World, colony: Colony): boolean {
  const h = currentHour(w);
  return (h - colony.watchStartHour + 24) % 24 < B.WATCH_HOURS;
}

export function colonyScore(w: World, colony: Colony): number {
  const win = colony.scoreWindow;
  const avg = win.length ? win.reduce((s, x) => s + x, 0) / win.length : 0;
  let score = avg;
  for (const lb of Object.values(w.litBeacons)) if (lb.by === colony.id) score += B.BEACON_SCORE;
  for (const holder of Object.values(w.titles)) if (holder === colony.id) score += B.TITLE_SCORE;
  return score;
}

export function allianceScore(w: World, allianceId: string): number {
  const a = w.alliances[allianceId];
  if (!a) return 0;
  return a.members.reduce((s, m) => s + (w.colonies[m] ? colonyScore(w, w.colonies[m]!) : 0), 0);
}

export function fleetsAt(w: World, systemId: string): FleetState[] {
  return Object.values(w.fleets).filter((f) => f.at === systemId && fleetSize(f.units) > 0);
}

// ---------------------------------------------------------------------------
// Colonies
// ---------------------------------------------------------------------------

export interface SpawnOptions { name: string; faction: Faction; persona: Persona; npc?: boolean; id?: string }

/** Number of free systems a relay could reach from `sys` (own sector and neighbours). */
function countLinkable(w: World, sys: StarSystem, faction: Faction): number {
  const ctx: RangeContext = { faction, amplifiers: new Set(), litBeacons: [], stormSectors: new Set() };
  return linkOptions(w.galaxy, sys, ctx).filter((o) => !w.systems[o.to.id]!.owner).length;
}

/** Places a new colony on the rim, as far as possible from existing capitals. */
export function spawnColony(w: World, opts: SpawnOptions): Colony {
  const capitals = Object.values(w.colonies).map((c) => w.galaxy.systems[c.capital]!);
  const rimMin = Math.max(0, w.galaxy.radius - 2);
  let best: StarSystem | null = null, bestScore = -Infinity;
  const rng = createRng(subSeed(w.seed, 'spawn', Object.keys(w.colonies).length));
  for (const sector of Object.values(w.galaxy.sectors)) {
    if (sector.ring < rimMin) continue;
    for (const id of sector.systems) {
      const sys = w.galaxy.systems[id]!;
      if (w.systems[id]!.owner || sys.kind === 'beacon' || sys.slots < 2) continue;
      if (countLinkable(w, sys, opts.faction) < 2) continue; // a capital with nothing in range is a dead start
      const d = capitals.length ? Math.min(...capitals.map((c) => dist(c, sys))) : 1e9;
      const score = Math.min(d, 6000) * rng.range(0.9, 1);
      if (score > bestScore) { bestScore = score; best = sys; }
    }
  }
  if (!best) throw new Error('no room left on the rim');
  const id = opts.id ?? newId(w, 'C');
  const colony: Colony = {
    id, name: opts.name, faction: opts.faction, persona: opts.persona, npc: opts.npc ?? false,
    capital: best.id, stock: { ...B.STARTING_STOCK }, credits: 300, influence: B.STARTING_INFLUENCE,
    createdAt: w.time, watchStartHour: 0, policy: PolicySchema.parse({ ...DEFAULT_POLICY, ...PERSONA_DEFAULTS[opts.persona] }),
    alliance: null, scoreWindow: [], marketVolume7d: [], lastSeenAt: w.time,
  };
  w.colonies[id] = colony;
  const st = w.systems[best.id]!;
  setOwner(w, best.id, id);
  st.buildings = ['extractor'];
  st.population = 0.5;
  logEvent(w, 'colony.founded', [id], { capital: best.id, faction: opts.faction });
  return colony;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

interface Route { seconds: number; onNet: boolean; length: number }

/** Shortest route along usable relays; falls back to a slow, energy-hungry off-network line. */
export function planRoute(w: World, colony: Colony, from: string, to: string): Route {
  const usable = transitSet(w, colony.id);
  const adj = new Map<string, { to: string; len: number }[]>();
  for (const r of Object.values(w.relays)) {
    if (!relayActive(r, w.time) || !usable.has(r.owner)) continue;
    if (!adj.has(r.a)) adj.set(r.a, []);
    if (!adj.has(r.b)) adj.set(r.b, []);
    adj.get(r.a)!.push({ to: r.b, len: r.length });
    adj.get(r.b)!.push({ to: r.a, len: r.length });
  }
  const distMap = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null, du = Infinity;
    for (const [v, d] of distMap) if (!done.has(v) && d < du) { u = v; du = d; }
    if (u === null || u === to) break;
    done.add(u);
    for (const e of adj.get(u) ?? []) {
      const nd = du + e.len;
      if (nd < (distMap.get(e.to) ?? Infinity)) distMap.set(e.to, nd);
    }
  }
  const speed = B.FLEET_SPEED_ON_NET * (colony.faction === 'corsairs' ? B.CORSAIR_SPEED_MULT : 1) / 60; // units per second
  if (distMap.has(to)) return { seconds: Math.ceil(distMap.get(to)! / speed), onNet: true, length: distMap.get(to)! };
  const length = dist(w.galaxy.systems[from]!, w.galaxy.systems[to]!);
  return { seconds: Math.ceil(length / (speed * B.OFF_NET_SPEED_MULT)), onNet: false, length };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function apply(w: World, colonyId: string, cmd: Command): ApplyResult {
  const colony = w.colonies[colonyId];
  if (!colony) return { ok: false, reason: 'no such colony' };
  if (w.ended) return { ok: false, reason: 'season over' };
  colony.lastSeenAt = w.time;
  switch (cmd.type) {
    case 'build_relay': return buildRelay(w, colony, cmd.a, cmd.b);
    case 'remove_relay': {
      const r = w.relays[relayId(cmd.a, cmd.b)];
      if (!r || r.owner !== colony.id) return { ok: false, reason: 'not your relay' };
      removeRelay(w, r.id);
      return { ok: true };
    }
    case 'build': return build(w, colony, cmd.system, cmd.building);
    case 'train': return train(w, colony, cmd.system, cmd.unit, cmd.count);
    case 'market_order': {
      if (!reachableRegions(w, colony).has(cmd.region)) return { ok: false, reason: 'market out of reach' };
      if (cmd.side === 'sell') {
        if (colony.stock[cmd.resource] < cmd.qty) return { ok: false, reason: 'not enough stock' };
        colony.stock[cmd.resource] -= cmd.qty;
      } else {
        const escrow = cmd.qty * cmd.price;
        if (colony.credits < escrow) return { ok: false, reason: 'not enough credits' };
        colony.credits -= escrow;
      }
      const id = newId(w, 'O');
      w.orders[id] = { id, colony: colony.id, region: cmd.region, resource: cmd.resource, side: cmd.side, qty: cmd.qty, price: cmd.price, placedAt: w.time };
      return { ok: true, id };
    }
    case 'cancel_order': {
      const o = w.orders[cmd.order];
      if (!o || o.colony !== colony.id) return { ok: false, reason: 'no such order' };
      if (o.side === 'sell') colony.stock[o.resource] += o.qty; else colony.credits += o.qty * o.price;
      delete w.orders[o.id];
      return { ok: true };
    }
    case 'barter_offer': {
      const to = w.colonies[cmd.to];
      if (!to || to.id === colony.id) return { ok: false, reason: 'no such partner' };
      const shared = [...reachableRegions(w, colony)].some((r) => reachableRegions(w, to).has(r));
      if (!shared && !isAlly(w, colony.id, to.id)) return { ok: false, reason: 'no shared market' };
      if (!stockHas(colony.stock, cmd.give)) return { ok: false, reason: 'not enough stock' };
      stockSub(colony.stock, cmd.give);
      const id = newId(w, 'B');
      w.barters[id] = { id, from: colony.id, to: to.id, give: cmd.give, want: cmd.want, accepted: false, createdAt: w.time };
      return { ok: true, id };
    }
    case 'barter_accept': {
      const b = w.barters[cmd.offer];
      if (!b || b.to !== colony.id) return { ok: false, reason: 'no such offer' };
      b.accepted = true;
      return { ok: true };
    }
    case 'ally_transfer': {
      const to = w.colonies[cmd.to];
      if (!to || !isAlly(w, colony.id, to.id)) return { ok: false, reason: 'not an ally' };
      const total = B.RESOURCE_LIST.reduce((s, r) => s + (cmd.stock[r] ?? 0), 0);
      if (total > B.ALLY_TRANSFER_CAP_PER_DRAW) return { ok: false, reason: 'over transfer cap' };
      if (!stockHas(colony.stock, cmd.stock)) return { ok: false, reason: 'not enough stock' };
      stockSub(colony.stock, cmd.stock);
      stockAdd(to.stock, cmd.stock);
      return { ok: true };
    }
    case 'fleet_order': return fleetOrder(w, colony, cmd.fleet, cmd.order, cmd.target);
    case 'agent_mission': {
      const cost = B.AGENT_COST_INFLUENCE[cmd.mission];
      if (colony.influence < cost) return { ok: false, reason: 'not enough influence' };
      if (cmd.mission === 'spy' && !w.galaxy.sectors[cmd.target]) return { ok: false, reason: 'no such sector' };
      if (cmd.mission === 'sabotage' && !w.relays[cmd.target]) return { ok: false, reason: 'no such relay' };
      if (cmd.mission === 'envoy' && !w.colonies[cmd.target]) return { ok: false, reason: 'no such colony' };
      colony.influence -= cost;
      const id = newId(w, 'M');
      w.missions[id] = { id, owner: colony.id, mission: cmd.mission, target: cmd.target, readyAt: w.time + B.AGENT_SECONDS[cmd.mission] };
      return { ok: true, id };
    }
    case 'treaty': return proposeTreaty(w, colony, cmd.with, cmd.kind);
    case 'set_watch': colony.watchStartHour = cmd.startHour; return { ok: true };
    case 'set_policy': colony.policy = cmd.policy; return { ok: true };
    case 'light_beacon': {
      const sys = w.galaxy.systems[cmd.system];
      if (!sys || sys.kind !== 'beacon') return { ok: false, reason: 'not a beacon' };
      if (w.litBeacons[sys.id]) return { ok: false, reason: 'already lit' };
      if (w.systems[sys.id]!.owner !== colony.id || !colonyNetwork(w, colony).has(sys.id)) return { ok: false, reason: 'beacon not connected' };
      if (colony.stock.crystal < B.BEACON_CRYSTAL) return { ok: false, reason: 'not enough crystal' };
      colony.stock.crystal -= B.BEACON_CRYSTAL;
      w.litBeacons[sys.id] = { system: sys.id, by: colony.id, since: w.time };
      logEvent(w, 'beacon.lit', [colony.id], { beacon: sys.beaconName });
      return { ok: true };
    }
    case 'alliance_create': {
      if (colony.alliance) return { ok: false, reason: 'already in an alliance' };
      const id = newId(w, 'A');
      w.alliances[id] = { id, name: cmd.name, leader: colony.id, members: [colony.id], invites: [], createdAt: w.time };
      colony.alliance = id;
      logEvent(w, 'alliance.created', [colony.id], { alliance: id, name: cmd.name });
      return { ok: true, id };
    }
    case 'alliance_invite': {
      const a = colony.alliance ? w.alliances[colony.alliance] : undefined;
      if (!a || a.leader !== colony.id) return { ok: false, reason: 'not an alliance leader' };
      if (!w.colonies[cmd.colony]) return { ok: false, reason: 'no such colony' };
      if (a.members.length >= 20) return { ok: false, reason: 'alliance full' };
      if (!a.invites.includes(cmd.colony)) a.invites.push(cmd.colony);
      return { ok: true };
    }
    case 'alliance_join': {
      const a = w.alliances[cmd.alliance];
      if (!a || !a.invites.includes(colony.id)) return { ok: false, reason: 'not invited' };
      if (colony.alliance) return { ok: false, reason: 'already in an alliance' };
      if (a.members.length >= 20) return { ok: false, reason: 'alliance full' };
      a.invites = a.invites.filter((c) => c !== colony.id);
      a.members.push(colony.id);
      colony.alliance = a.id;
      logEvent(w, 'alliance.joined', [colony.id], { alliance: a.id });
      return { ok: true };
    }
    case 'alliance_leave': {
      const a = colony.alliance ? w.alliances[colony.alliance] : undefined;
      if (!a) return { ok: false, reason: 'not in an alliance' };
      a.members = a.members.filter((c) => c !== colony.id);
      colony.alliance = null;
      if (a.members.length === 0) delete w.alliances[a.id];
      else if (a.leader === colony.id) a.leader = a.members[0]!;
      return { ok: true };
    }
  }
}

function buildRelay(w: World, colony: Colony, aId: string, bId: string): ApplyResult {
  const a = w.galaxy.systems[aId], b = w.galaxy.systems[bId];
  if (!a || !b) return { ok: false, reason: 'no such system' };
  if (w.relays[relayId(aId, bId)]) return { ok: false, reason: 'relay exists' };
  const net = colonyNetwork(w, colony);
  const anchored = net.has(aId) || net.has(bId);
  if (!anchored) return { ok: false, reason: 'not connected to your network' };
  for (const id of [aId, bId]) {
    const owner = w.systems[id]!.owner;
    if (owner && owner !== colony.id && !isAlly(w, colony.id, owner)) return { ok: false, reason: 'system held by another colony' };
  }
  const verdict = evaluateLink(w.galaxy, a, b, rangeContext(w, colony));
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  if (!stockHas(colony.stock, verdict.cost)) return { ok: false, reason: 'not enough resources' };
  stockSub(colony.stock, verdict.cost);
  const id = relayId(aId, bId);
  addRelay(w, { id, a: id.split('|')[0]!, b: id.split('|')[1]!, owner: colony.id, length: verdict.length, upkeep: verdict.upkeep, readyAt: w.time + verdict.buildSeconds, cutUntil: 0 });
  for (const sid of [aId, bId]) {
    const st = w.systems[sid]!;
    if (!st.owner) { setOwner(w, sid, colony.id); st.population = 0.1; logEvent(w, 'system.claimed', [colony.id], { system: sid }); }
  }
  return { ok: true, id };
}

function build(w: World, colony: Colony, systemId: string, building: Building): ApplyResult {
  const sys = w.galaxy.systems[systemId];
  const st = w.systems[systemId];
  if (!sys || !st || st.owner !== colony.id) return { ok: false, reason: 'not your system' };
  if (!colonyNetwork(w, colony).has(systemId)) return { ok: false, reason: 'system not connected' };
  if (st.buildings.length + st.buildQueue.length >= slotsOf(w, sys)) return { ok: false, reason: 'no free slot' };
  if (st.buildings.includes(building) || st.buildQueue.some((j) => j.building === building)) return { ok: false, reason: 'already built' };
  const cost = B.BUILDING_COST[building];
  if (!stockHas(colony.stock, cost)) return { ok: false, reason: 'not enough resources' };
  stockSub(colony.stock, cost);
  st.buildQueue.push({ building, readyAt: w.time + B.BUILDING_SECONDS[building] });
  return { ok: true };
}

function train(w: World, colony: Colony, systemId: string, unit: UnitType, count: number): ApplyResult {
  const st = w.systems[systemId];
  if (!st || st.owner !== colony.id) return { ok: false, reason: 'not your system' };
  if (!st.buildings.includes('shipyard')) return { ok: false, reason: 'no shipyard' };
  if (!colonyNetwork(w, colony).has(systemId)) return { ok: false, reason: 'system not connected' };
  const mult = colony.faction === 'corsairs' ? B.CORSAIR_SHIP_COST_MULT : 1;
  const cost = scaleStock(B.UNIT_COST[unit], count * mult);
  if (!stockHas(colony.stock, cost)) return { ok: false, reason: 'not enough resources' };
  stockSub(colony.stock, cost);
  const queueEnd = st.trainQueue.length ? st.trainQueue[st.trainQueue.length - 1]!.readyAt : w.time;
  st.trainQueue.push({ unit, count, readyAt: queueEnd + B.UNIT_SECONDS[unit] * count });
  return { ok: true };
}

function fleetOrder(w: World, colony: Colony, fleetId: string, order: 'move' | 'raid' | 'blockade' | 'defend' | 'return', target: string): ApplyResult {
  const fleet = w.fleets[fleetId];
  if (!fleet || fleet.owner !== colony.id) return { ok: false, reason: 'not your fleet' };
  if (fleet.at === null) return { ok: false, reason: 'fleet in transit' };
  if (fleetSize(fleet.units) === 0) return { ok: false, reason: 'empty fleet' };
  let destination: string;
  if (order === 'raid') {
    const relay = w.relays[target];
    if (!relay) return { ok: false, reason: 'no such relay' };
    if (relay.owner === colony.id) return { ok: false, reason: 'your own relay' };
    destination = planRoute(w, colony, fleet.at, relay.a).seconds <= planRoute(w, colony, fleet.at, relay.b).seconds ? relay.a : relay.b;
    fleet.order = { kind: 'raid', relay: target, via: destination };
  } else if (order === 'return') {
    destination = colony.capital;
    fleet.order = { kind: 'return' };
  } else {
    if (!w.galaxy.systems[target]) return { ok: false, reason: 'no such system' };
    destination = target;
    fleet.order = order === 'move' ? { kind: 'move', to: target } : order === 'blockade' ? { kind: 'blockade', system: target } : { kind: 'defend', system: target };
  }
  if (destination === fleet.at) { arrive(w, fleet); return { ok: true }; }
  const route = planRoute(w, colony, fleet.at, destination);
  if (!route.onNet) {
    const energy = Math.ceil(route.length * B.OFF_NET_ENERGY_PER_UNIT * fleetSize(fleet.units));
    if (colony.stock.energy < energy) return { ok: false, reason: 'not enough energy for off-network travel' };
    colony.stock.energy -= energy;
  }
  clearBlockadeBy(w, fleet);
  fleet.from = fleet.at;
  fleet.at = null;
  fleet.destination = destination;
  fleet.arriveAt = w.time + route.seconds;
  return { ok: true };
}

function proposeTreaty(w: World, colony: Colony, withId: string, kind: TreatyKind): ApplyResult {
  const other = w.colonies[withId];
  if (!other || other.id === colony.id) return { ok: false, reason: 'no such colony' };
  const cost = B.TREATY_COST_INFLUENCE[kind];
  if (colony.influence < cost) return { ok: false, reason: 'not enough influence' };
  if (kind === 'federation' && (!colony.alliance || colony.alliance !== other.alliance)) return { ok: false, reason: 'federation requires a shared alliance' };
  const existing = w.proposals.findIndex((p) => p.from === other.id && p.to === colony.id && p.kind === kind);
  if (existing >= 0) {
    w.proposals.splice(existing, 1);
    colony.influence -= cost;
    const id = newId(w, 'T');
    w.treaties[id] = { id, a: other.id, b: colony.id, kind, since: w.time, until: kind === 'nap' ? w.time + B.NAP_DAYS * 86400 : null };
    (w.treatiesByColony[other.id] ??= []).push(id);
    (w.treatiesByColony[colony.id] ??= []).push(id);
    logEvent(w, 'treaty.signed', [other.id, colony.id], { kind });
    return { ok: true, id };
  }
  if (!w.proposals.some((p) => p.from === colony.id && p.to === other.id && p.kind === kind)) {
    colony.influence -= cost;
    w.proposals.push({ from: colony.id, to: other.id, kind, at: w.time });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Advance the simulation by `seconds`. Timers resolve in order; the Draw fires on each hour. */
export function tick(w: World, seconds: number, maxStep = 60): void {
  let remaining = seconds;
  while (remaining > 0 && !w.ended) {
    const nextHour = (Math.floor(w.time / 3600) + 1) * 3600;
    const step = Math.min(remaining, nextHour - w.time, maxStep);
    w.time += step;
    remaining -= step;
    processTimers(w);
    if (w.time >= nextHour) runDraw(w);
    if (w.time >= w.seasonEndsAt) endSeason(w, 'silence');
  }
}

function processTimers(w: World): void {
  // Only owned systems can have queues or blockades.
  for (const owner of Object.keys(w.owned)) for (const id of w.owned[owner]!) {
    const st = w.systems[id]!;
    if (st.buildQueue.length) {
      const done = st.buildQueue.filter((j) => j.readyAt <= w.time);
      if (done.length) {
        st.buildQueue = st.buildQueue.filter((j) => j.readyAt > w.time);
        for (const j of done) st.buildings.push(j.building);
      }
    }
    if (st.trainQueue.length && st.owner) {
      const done = st.trainQueue.filter((j) => j.readyAt <= w.time);
      if (done.length) {
        st.trainQueue = st.trainQueue.filter((j) => j.readyAt > w.time);
        const units = emptyFleet();
        for (const j of done) units[j.unit] += j.count;
        mergeFleet(w, st.owner, id, units);
      }
    }
    if (st.blockade && st.owner) {
      const still = fleetsAt(w, id).some((f) => f.owner === st.blockade!.by && f.order.kind === 'blockade');
      if (!still) st.blockade = null;
      else if (w.time - st.blockade.since >= B.BLOCKADE_CAPTURE_HOURS * 3600) capture(w, id, st.blockade.by);
    }
  }
  for (const fleet of Object.values(w.fleets)) {
    if (fleet.at === null && fleet.arriveAt <= w.time) arrive(w, fleet);
  }
  for (const m of Object.values(w.missions)) if (m.readyAt <= w.time) resolveMission(w, m.id);
  for (const [id, f] of Object.entries(w.fleets)) if (fleetSize(f.units) === 0 && f.at !== null) delete w.fleets[id];
}

function mergeFleet(w: World, owner: string, at: string, units: Fleet): FleetState {
  const existing = Object.values(w.fleets).find((f) => f.owner === owner && f.at === at && f.order.kind !== 'blockade');
  if (existing) { existing.units = addFleet(existing.units, units); return existing; }
  const id = newId(w, 'F');
  const f: FleetState = { id, owner, units, at, from: null, destination: null, arriveAt: 0, order: { kind: 'idle' } };
  w.fleets[id] = f;
  return f;
}

function clearBlockadeBy(w: World, fleet: FleetState): void {
  if (fleet.order.kind === 'blockade' && fleet.at) {
    const st = w.systems[fleet.at]!;
    if (st.blockade?.by === fleet.owner) st.blockade = null;
  }
}

function defenseMultiplier(w: World, defenderId: string, systems: string[]): number {
  const colony = w.colonies[defenderId];
  let mult = 1;
  if (systems.some((s) => w.systems[s]!.owner === defenderId && w.systems[s]!.buildings.includes('bastion'))) mult *= B.BASTION_DEFENSE_MULT;
  if (colony && isWatching(w, colony)) mult *= B.WATCH_DEFENSE_MULT;
  return mult;
}

/** Fights `attacker` against every hostile fleet at `systems`; returns true if the attacker prevails. */
function fight(w: World, attacker: FleetState, victimId: string, systems: string[]): boolean {
  const defenders = systems.flatMap((s) => fleetsAt(w, s)).filter((f) => f.id !== attacker.id && f.at !== null && (f.owner === victimId || isAlly(w, f.owner, victimId)) && !isAlly(w, f.owner, attacker.owner));
  const combined = defenders.reduce((acc, f) => addFleet(acc, f.units), emptyFleet());
  const seed = subSeed(w.seed, 'battle', w.time, attacker.id);
  const result = resolveBattle(attacker.units, combined, defenseMultiplier(w, victimId, systems), seed);
  attacker.units = subtractFleet(attacker.units, result.attackerLosses);
  const total = Math.max(1, fleetSize(combined));
  for (const d of defenders) {
    const share = fleetSize(d.units) / total;
    const losses: Fleet = { corvette: 0, frigate: 0, cruiser: 0 };
    for (const t of ['corvette', 'frigate', 'cruiser'] as const) losses[t] = Math.min(d.units[t], Math.round(result.defenderLosses[t] * share));
    d.units = subtractFleet(d.units, losses);
  }
  logEvent(w, 'battle', [attacker.owner, victimId], {
    at: systems[0], attackerWins: result.attackerWins,
    attackerLosses: result.attackerLosses, defenderLosses: result.defenderLosses,
  });
  return result.attackerWins && fleetSize(attacker.units) > 0;
}

function loot(w: World, attacker: Colony, victim: Colony, size: number): void {
  if (colonyScore(w, attacker) > B.BULLY_SCORE_RATIO * Math.max(1, colonyScore(w, victim))) {
    attacker.influence = Math.max(0, attacker.influence - 5);
    logEvent(w, 'raid.bully', [attacker.id, victim.id]);
    return;
  }
  const taken: StockDelta = {};
  for (const r of B.RESOURCE_LIST) {
    const amount = Math.min(Math.floor(victim.stock[r] * B.LOOT_FRACTION), size * 5);
    if (amount > 0) { victim.stock[r] -= amount; attacker.stock[r] += amount; taken[r] = amount; }
  }
  logEvent(w, 'raid.loot', [attacker.id, victim.id], { taken });
}

function arrive(w: World, fleet: FleetState): void {
  const colony = w.colonies[fleet.owner]!;
  const dest = fleet.destination ?? fleet.at!;
  fleet.at = dest;
  fleet.destination = null;
  const order = fleet.order;
  if (order.kind === 'raid') {
    const relay = w.relays[order.relay];
    const victim = relay ? w.colonies[relay.owner] : undefined;
    if (!relay || !victim || relayActive(relay, w.time) === false) { fleet.order = { kind: 'idle' }; return; }
    if (isShielded(w, victim) || isShielded(w, colony) || atPeace(w, colony.id, victim.id)) { fleet.order = { kind: 'idle' }; logEvent(w, 'raid.refused', [colony.id, victim.id]); return; }
    if (fight(w, fleet, victim.id, [relay.a, relay.b])) {
      relay.cutUntil = w.time + B.RELAY_CUT_HOURS * 3600;
      logEvent(w, 'relay.cut', [colony.id, victim.id], { relay: relay.id });
      loot(w, colony, victim, fleetSize(fleet.units));
    }
    fleet.order = { kind: 'idle' };
  } else if (order.kind === 'blockade') {
    const st = w.systems[dest]!;
    const victim = st.owner ? w.colonies[st.owner] : undefined;
    if (!victim || victim.id === colony.id || isShielded(w, victim) || isShielded(w, colony) || atPeace(w, colony.id, victim.id)) { fleet.order = { kind: 'idle' }; return; }
    if (fight(w, fleet, victim.id, [dest])) {
      st.blockade = { by: colony.id, since: w.time };
      logEvent(w, 'blockade.start', [colony.id, victim.id], { system: dest });
    } else fleet.order = { kind: 'idle' };
  } else if (order.kind === 'defend') {
    const st = w.systems[dest]!;
    if (st.blockade && st.blockade.by !== colony.id && !isAlly(w, st.blockade.by, colony.id)) {
      const blockader = st.blockade.by;
      if (fight(w, fleet, blockader, [dest])) {
        st.blockade = null;
        for (const f of fleetsAt(w, dest)) if (f.owner === blockader) f.order = { kind: 'idle' };
        logEvent(w, 'blockade.lifted', [colony.id, blockader], { system: dest });
      }
    }
  } else if (order.kind === 'move' || order.kind === 'return') {
    fleet.order = { kind: 'idle' };
  }
}

function capture(w: World, systemId: string, by: string): void {
  const st = w.systems[systemId]!;
  const prev = st.owner!;
  if (w.colonies[prev]?.capital === systemId) return; // capitals are never captured
  setOwner(w, systemId, by);
  st.blockade = null;
  st.buildings = st.buildings.slice(0, Math.max(0, st.buildings.length - 1));
  st.buildQueue = [];
  st.trainQueue = [];
  st.population *= 0.5;
  for (const r of colonyRelays(w, prev)) if (r.a === systemId || r.b === systemId) removeRelay(w, r.id);
  for (const f of fleetsAt(w, systemId)) if (f.owner === by && f.order.kind === 'blockade') f.order = { kind: 'idle' };
  logEvent(w, 'system.captured', [by, prev], { system: systemId });
}

function resolveMission(w: World, id: string): void {
  const m = w.missions[id]!;
  delete w.missions[id];
  const owner = w.colonies[m.owner];
  if (!owner) return;
  const rng = createRng(subSeed(w.seed, 'mission', id));
  if (m.mission === 'spy') {
    (w.reveals[owner.id] ??= {})[m.target] = w.time + B.SPY_REVEAL_HOURS * 3600;
    logEvent(w, 'spy.done', [owner.id], { sector: m.target });
  } else if (m.mission === 'sabotage') {
    const relay = w.relays[m.target];
    if (!relay) return;
    const victim = w.colonies[relay.owner];
    if (!victim || atPeace(w, owner.id, victim.id) || isShielded(w, victim)) return;
    const bastions = [relay.a, relay.b].filter((s) => w.systems[s]!.owner === victim.id && w.systems[s]!.buildings.includes('bastion')).length;
    const p = B.SABOTAGE_BASE_SUCCESS - 0.2 * bastions;
    if (rng.next() < p) {
      relay.cutUntil = w.time + B.RELAY_CUT_HOURS * 3600;
      logEvent(w, 'sabotage.success', [owner.id, victim.id], { relay: relay.id });
    } else {
      owner.influence = Math.max(0, owner.influence - 10);
      logEvent(w, 'sabotage.caught', [owner.id, victim.id], { relay: relay.id });
    }
  } else {
    const target = w.colonies[m.target];
    if (!target) return;
    owner.influence += 8;
    target.influence += 4;
    logEvent(w, 'envoy.done', [owner.id, target.id]);
  }
}

// ---------------------------------------------------------------------------
// The Draw
// ---------------------------------------------------------------------------

function runDraw(w: World): void {
  w.drawIndex++;
  const regions = [...new Set(Object.values(w.galaxy.sectors).map((s) => s.region))].sort();
  const draw: Draw = rollDraw({ seasonSeed: w.seed, index: w.drawIndex, previous: w.lastDraw ?? undefined, regions, beacons: w.galaxy.beacons });
  w.lastDraw = draw;
  const drawn = new Set(draw.bands);
  const nextDrawAt = w.time + B.DRAW_INTERVAL_S;

  // Storms shorten relays: those now out of range go dark for the hour.
  if (draw.event.kind === 'storm') {
    for (const colony of Object.values(w.colonies)) {
      const ctx = rangeContext(w, colony);
      for (const r of colonyRelays(w, colony.id)) {
        const v = evaluateLink(w.galaxy, w.galaxy.systems[r.a]!, w.galaxy.systems[r.b]!, ctx);
        if (!v.ok && v.reason === 'range') r.cutUntil = Math.max(r.cutUntil, nextDrawAt);
      }
    }
  }

  for (const colony of Object.values(w.colonies)) {
    // Upkeep: unpowered relays go dark, farthest from the capital first.
    let net = colonyNetwork(w, colony);
    const relays = colonyRelays(w, colony.id).filter((r) => relayActive(r, w.time));
    let upkeep = relays.reduce((s, r) => s + r.upkeep, 0);
    if (upkeep > colony.stock.energy) {
      relays.sort((x, y) => Math.max(net.get(y.a) ?? 1e9, net.get(y.b) ?? 1e9) - Math.max(net.get(x.a) ?? 1e9, net.get(x.b) ?? 1e9));
      while (upkeep > colony.stock.energy && relays.length) {
        const r = relays.shift()!;
        r.cutUntil = Math.max(r.cutUntil, nextDrawAt);
        upkeep -= r.upkeep;
      }
      logEvent(w, 'relays.unpowered', [colony.id]);
      net = colonyNetwork(w, colony);
    }
    colony.stock.energy -= upkeep;

    // Production from connected systems.
    const produced = B.emptyStock();
    let foodNeed = 0;
    const productive = ownedSystems(w, colony.id).filter((id) => net.has(id));
    for (const id of productive) {
      const sys = w.galaxy.systems[id]!;
      const st = w.systems[id]!;
      if (st.blockade) continue;
      let mult = 1;
      if (drawn.has(sys.band)) mult = draw.event.kind === 'eruption' && draw.event.band === sys.band ? B.DRAW_ERUPTION_MULT : B.DRAW_MATCH_MULT;
      if (st.buildings.includes('extractor')) mult *= B.EXTRACTOR_MULT;
      mult *= 1 + B.POP_YIELD_BONUS * st.population;
      produced[sys.resource] += B.BASE_YIELD * sys.baseYield * mult;
      const generic = (id === colony.capital ? B.CAPITAL_GENERIC_YIELD : B.GENERIC_YIELD) * (1 + B.POP_YIELD_BONUS * st.population);
      for (const r of B.RESOURCE_LIST) produced[r] += generic;
      foodNeed += st.population * B.POP_FOOD_PER_UNIT * 20;
    }
    stockAdd(colony.stock, produced);
    // Population: fed systems grow, starving ones shrink.
    const fed = colony.stock.food >= foodNeed;
    colony.stock.food = Math.max(0, colony.stock.food - foodNeed);
    for (const id of productive) {
      const st = w.systems[id]!;
      st.population = fed ? Math.min(1, st.population + B.POP_GROWTH) : Math.max(0, st.population - 2 * B.POP_GROWTH);
    }
    colony.influence += produced.crystal * B.INFLUENCE_PER_CRYSTAL;
    colony.credits += productive.length * B.CREDITS_PER_SYSTEM_PER_DRAW;
    if (draw.event.kind === 'echo' && net.has(draw.event.beacon)) { colony.stock.crystal += 100; logEvent(w, 'echo.bonus', [colony.id]); }

    colony.scoreWindow.push(productive.length);
    if (colony.scoreWindow.length > B.SCORE_WINDOW_DRAWS) colony.scoreWindow.shift();
  }

  settleMarkets(w);
  settleBarters(w);
  for (const p of w.proposals.slice()) if (w.time - p.at > 86400) w.proposals.splice(w.proposals.indexOf(p), 1);
  updateTitles(w);
  checkRenaissance(w);
  logEvent(w, 'draw', [], { index: draw.index, bands: draw.bands, event: draw.event });
}

function settleMarkets(w: World): void {
  const books = new Map<string, typeof w.orders[string][]>();
  for (const o of Object.values(w.orders)) {
    const k = marketKey(o.region, o.resource);
    if (!books.has(k)) books.set(k, []);
    books.get(k)!.push(o);
  }
  w.lastClearing = [];
  const volume = new Map<string, number>();
  for (const [key, orders] of books) {
    const res = clearAuction(orders);
    if (res.price === null) continue;
    const [region, resource] = key.split(':') as [string, Resource];
    w.lastClearing.push({ region, resource, price: res.price, qty: res.qty });
    for (const f of res.fills) {
      const o = w.orders[f.order]!;
      const colony = w.colonies[o.colony]!;
      let fee = B.MARKET_FEE;
      if (ownedSystems(w, colony.id).some((s) => w.systems[s]!.buildings.includes('tradepost'))) fee = B.MARKET_FEE_TRADEPOST;
      if (colony.faction === 'guild') fee *= B.GUILD_FEE_MULT;
      if (o.side === 'buy') {
        colony.stock[resource] += f.qty;
        colony.credits += f.qty * (o.price - f.price); // refund the difference from escrow
        colony.credits -= f.qty * f.price * fee;
      } else {
        colony.credits += f.qty * f.price * (1 - fee);
      }
      volume.set(colony.id, (volume.get(colony.id) ?? 0) + f.qty * f.price);
      o.qty -= f.qty;
      if (o.qty <= 0) delete w.orders[o.id];
    }
  }
  // Unfilled orders expire at the draw: escrow returns.
  for (const o of Object.values(w.orders)) {
    const colony = w.colonies[o.colony]!;
    if (o.side === 'sell') colony.stock[o.resource] += o.qty; else colony.credits += o.qty * o.price;
    delete w.orders[o.id];
  }
  for (const colony of Object.values(w.colonies)) {
    colony.marketVolume7d.push(volume.get(colony.id) ?? 0);
    if (colony.marketVolume7d.length > 24 * 7) colony.marketVolume7d.shift();
  }
}

function settleBarters(w: World): void {
  for (const b of Object.values(w.barters)) {
    const from = w.colonies[b.from], to = w.colonies[b.to];
    if (b.accepted && from && to && stockHas(to.stock, b.want)) {
      stockSub(to.stock, b.want);
      stockAdd(from.stock, b.want);
      stockAdd(to.stock, b.give);
      logEvent(w, 'barter.done', [b.from, b.to], { give: b.give, want: b.want });
    } else if (from) {
      stockAdd(from.stock, b.give); // refund
    }
    delete w.barters[b.id];
  }
}

function updateTitles(w: World): void {
  let network: string | null = null, netBest = 0;
  let admiralty: string | null = null, fleetBest = 0;
  let exchange: string | null = null, volBest = 0;
  for (const c of Object.values(w.colonies)) {
    const n = productiveSystems(w, c).length;
    if (n > netBest) { netBest = n; network = c.id; }
    const f = Object.values(w.fleets).filter((x) => x.owner === c.id).reduce((s, x) => s + fleetSize(x.units), 0);
    if (f > fleetBest) { fleetBest = f; admiralty = c.id; }
    const v = c.marketVolume7d.reduce((s, x) => s + x, 0);
    if (v > volBest) { volBest = v; exchange = c.id; }
  }
  w.titles = { network, admiralty, exchange };
}

function checkRenaissance(w: World): void {
  if (Object.keys(w.litBeacons).length < w.galaxy.beacons.length) return;
  const holders = new Set(Object.values(w.litBeacons).map((b) => w.colonies[b.by]?.alliance ?? b.by));
  if (holders.size !== 1) return;
  const since = Math.max(...Object.values(w.litBeacons).map((b) => b.since));
  if (w.time - since >= B.RENAISSANCE_HOURS * 3600) endSeason(w, 'renaissance');
}

function endSeason(w: World, reason: 'silence' | 'renaissance'): void {
  if (w.ended) return;
  let winner: string | null = null, best = -1;
  for (const a of Object.values(w.alliances)) { const s = allianceScore(w, a.id); if (s > best) { best = s; winner = a.id; } }
  for (const c of Object.values(w.colonies)) { if (c.alliance) continue; const s = colonyScore(w, c); if (s > best) { best = s; winner = c.id; } }
  w.ended = { at: w.time, reason, winner };
  logEvent(w, 'season.ended', winner ? [winner] : [], { reason });
}
