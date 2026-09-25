import type { Building, Command, Decree, Faction, Fleet, Orbit, Persona, Resource, Stock, StockDelta, UnitType } from '@aurane/protocol';
import { COMBAT_UNITS, DEFAULT_POLICY, PERSONA_DEFAULTS, PolicySchema } from '@aurane/protocol';
import * as B from './balance.js';
import { expandGalaxy, generateGalaxy, type GalaxyOptions, type StarSystem } from './galaxy.js';
import { mergeRules, type SeasonRules } from './rules.js';
import { hexNeighbors, hexKey } from './hex.js';
import { dist } from './geometry.js';
import { connectedFrom, evaluateLink, findBridges, linkOptions, relayActive, relayId, type RangeContext, type Relay } from './network.js';
import { oracleHint, rollDraw, type Draw } from './draw.js';
import { clearAuction, marketKey } from './market.js';
import { addFleet } from './combat.js';
import { atPeace, isAlly, transitSet } from './diplomacy.js';
import { createRng, subSeed } from './rng.js';
import { planPath, fleetSpeed } from './routing.js';
import { armedHostilesPresent, battleTick, plateauFleets, plateauIndex, plateauKey, pruneBattles, regenerate } from './battle.js';
import { capacityOf, defaultOrbit, depositClamped, freeSlotsOnOrbit, hasStructure, nextAngle, orbitSlots, relayUp } from './structures.js';
import { RELAY_KINDS, entryJump, laneBetween, layoutOf, pathInSystem, poiOf } from './pois.js';
import {
  combatSize, emptyDamage, emptyFleet, fleetSize, newId,
  type Colony, type FleetOrder, type FleetState, type JournalEntry, type SystemState, type World, type WorldEvent, type TreatyKind,
} from './state.js';

export type ApplyResult = { ok: true; id?: string } | { ok: false; reason: string };

export { totalSlots as slotsOf } from './structures.js';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface WorldOptions extends GalaxyOptions {
  seasonDays?: number;
  /** Season rules overrides (see rules.ts); defaults are the Season 0 guard-rails. */
  rules?: Partial<SeasonRules>;
}

export function createWorld(seed: number | string, opts: WorldOptions = {}): World {
  const galaxy = generateGalaxy(seed, opts);
  const systems: Record<string, SystemState> = {};
  for (const id of Object.keys(galaxy.systems)) { systems[id] = emptySystem(); systems[id]!.mainPoi = layoutOf(galaxy, id).main; }
  return {
    seed: galaxy.seed, galaxy, time: 0, seasonEndsAt: (opts.seasonDays ?? B.SEASON_DAYS) * 86400,
    drawIndex: -1, lastDraw: null, colonies: {}, systems, relays: {}, fleets: {}, orders: {}, barters: {},
    treaties: {}, proposals: [], alliances: {}, missions: {}, routes: {}, reveals: {}, known: {}, salvage: {}, depots: {}, litBeacons: {}, lastClearing: [],
    events: [], battles: {}, titles: { network: null, admiralty: null, exchange: null }, ended: null, nextId: 1,
    owned: {}, relaysByOwner: {}, treatiesByColony: {}, engagedSystems: [],
    rules: mergeRules(opts.rules), transfers: {}, beaconAlert: null,
    galaxyOptions: { radius: galaxy.radius, baseRadius: opts.baseRadius ?? galaxy.radius, ...(opts.systemsPerSector ? { systemsPerSector: opts.systemsPerSector } : {}) },
  };
}

export const emptySystem = (): SystemState => ({ owner: null, mainPoi: '', structures: [], stationHp: 0, stock: B.emptyStock(), population: 0, buildQueue: [], trainQueue: [], blockade: null, engaged: false, engagedPois: [] });

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
export const stockTotal = (s: StockDelta): number => B.RESOURCE_LIST.reduce((t, r) => t + (s[r] ?? 0), 0);

/** Sum of a colony's local stocks (for the HUD and coarse decisions; nothing is spent from it). */
export function colonyStockTotal(w: World, colonyId: string): Stock {
  const out = B.emptyStock();
  for (const id of ownedSystems(w, colonyId)) stockAdd(out, w.systems[id]!.stock);
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const currentHour = (w: World): number => Math.floor(w.time / 3600) % 24;

export function hasBuilding(w: World, systemId: string, b: Building): boolean {
  return hasStructure(w.systems[systemId]!, b);
}

export function stormSectors(w: World): Set<string> {
  const out = new Set<string>();
  const ev = w.lastDraw?.event;
  if (ev?.kind === 'storm') for (const s of Object.values(w.galaxy.sectors)) if (s.region === ev.region) out.add(s.key);
  return out;
}

export function rangeContext(w: World, colony: Colony): RangeContext {
  const amplifiers = new Set<string>();
  for (const id of ownedSystems(w, colony.id)) if (hasStructure(w.systems[id]!, 'amplifier')) amplifiers.add(id);
  const ctx: RangeContext = { faction: colony.faction, amplifiers, litBeacons: Object.keys(w.litBeacons), stormSectors: stormSectors(w), concordatRangeMult: w.rules.concordatRangeMult };
  if (hasDecree(w, colony, 'range')) ctx.rangeMult = B.DECREE_RANGE_MULT;
  return ctx;
}

/** A relay carries the Signal only when both stations stand. */
export function relayLive(w: World, r: Relay): boolean {
  return relayActive(r, w.time) && relayUp(w.systems[r.a]!) && relayUp(w.systems[r.b]!);
}

/** Systems connected to the colony's capital, with hop distance. Only these exist. */
export function colonyNetwork(w: World, colony: Colony): Map<string, number> {
  const transit = transitSet(w, colony.id);
  const relays: Relay[] = [];
  for (const owner of transit) for (const id of w.relaysByOwner[owner] ?? []) { const r = w.relays[id]!; if (relayLive(w, r)) relays.push(r); }
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

/** Energy per Draw for a set of active relays: superlinear, so empires pay for their size. */
export function networkUpkeep(relays: readonly Relay[]): number {
  const base = relays.reduce((s, r) => s + r.upkeep, 0);
  return base * (1 + B.UPKEEP_SCALE_PER_RELAY * relays.length);
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
  for (const f of Object.values(w.fleets)) if (f.owner === colony.id && f.at) out.add(w.galaxy.systems[f.at]!.sector);
  for (const [sector, until] of Object.entries(w.reveals[colony.id] ?? {})) if (until > w.time) out.add(sector);
  return out;
}

export function isShielded(w: World, colony: Colony): boolean {
  return w.time - colony.createdAt < B.shieldHours(w.seasonEndsAt / 86400) * 3600;
}

export function isWatching(w: World, colony: Colony): boolean {
  const h = currentHour(w);
  return (h - colony.watchStartHour + 24) % 24 < watchHours(w, colony);
}

/** The Night Watch window, stretched by the Long Watch decree. */
export function watchHours(w: World, colony: Colony): number {
  return hasDecree(w, colony, 'longwatch') ? B.WATCH_HOURS_DECREE : B.WATCH_HOURS;
}

/** A colony younger than the season's `youngColonyHours` (or still shielded): it cannot gift, lend relays or grant transit. */
export function isYoung(w: World, colony: Colony): boolean {
  return w.time - colony.createdAt < w.rules.youngColonyHours * 3600 || isShielded(w, colony);
}

/** Value of a bundle at the season's reference prices, for transfer caps. */
export function bundleValue(st: StockDelta): number {
  return B.RESOURCE_LIST.reduce((s, r) => s + (st[r] ?? 0) * B.BASE_PRICE[r], 0);
}

const pairKey = (a: string, b: string): string => [a, b].sort().join('|');

/** Records a transfer between two colonies against the daily pair cap; false when it would exceed it. */
function recordTransfer(w: World, a: string, b: string, value: number): boolean {
  const cap = w.rules.pairTransferCapPerDay;
  if (cap <= 0) return true;
  const key = pairKey(a, b);
  const day = Math.floor(w.time / 86400);
  const cur = w.transfers[key];
  const used = cur && cur.day === day ? cur.value : 0;
  if (used + value > cap + 1e-9) return false;
  w.transfers[key] = { day, value: used + value };
  return true;
}

export function hasDecree(w: World, colony: Colony, kind: Decree): boolean {
  return colony.decrees.some((d) => d.kind === kind && d.until > w.time);
}

/** Buy a decree with Credits: public (an event), temporary, one of each kind at a time. */
function enactDecree(w: World, colony: Colony, kind: Decree): ApplyResult {
  if (hasDecree(w, colony, kind)) return { ok: false, reason: 'decree already in force' };
  const cost = B.DECREE_COST_CREDITS[kind];
  if (colony.credits < cost) return { ok: false, reason: 'not enough credits' };
  colony.credits -= cost;
  colony.decrees = colony.decrees.filter((d) => d.until > w.time);
  const until = w.time + B.DECREE_HOURS[kind] * 3600;
  colony.decrees.push({ kind, until });
  logEvent(w, 'decree', [colony.id], { kind, until });
  return { ok: true };
}

/** One line in the General's journal (what it did and why), capped. */
export function journal(w: World, colony: Colony, entry: Omit<JournalEntry, 'at'>): void {
  colony.journal.push({ at: w.time, ...entry });
  if (colony.journal.length > B.JOURNAL_MAX) colony.journal.splice(0, colony.journal.length - B.JOURNAL_MAX);
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

/** Bridges of one colony's network (relays whose loss splits it). */
export function findBridgesFor(w: World, colonyId: string): Set<string> {
  return findBridges(colonyRelays(w, colonyId), colonyId, w.time);
}

export function fleetsAt(w: World, systemId: string): FleetState[] {
  return Object.values(w.fleets).filter((f) => f.at === systemId && fleetSize(f.units) > 0);
}

export function routeCount(w: World, colonyId: string): number {
  return Object.values(w.routes).filter((r) => r.owner === colonyId).length;
}

export function routeLimit(w: World, colony: Colony): number {
  return B.ROUTES_BASE + B.ROUTES_PER_TRADEPOST * ownedSystems(w, colony.id).filter((id) => hasBuilding(w, id, 'tradepost')).length;
}

// ---------------------------------------------------------------------------
// Colonies
// ---------------------------------------------------------------------------

export interface SpawnOptions { name: string; faction: Faction; persona: Persona; npc?: boolean; id?: string; origin?: string }

/** Number of free systems a relay could reach from `sys` (own sector and neighbours). */
function countLinkable(w: World, sys: StarSystem, faction: Faction): number {
  const ctx: RangeContext = { faction, amplifiers: new Set(), litBeacons: [], stormSectors: new Set() };
  return linkOptions(w.galaxy, sys, ctx).filter((o) => !w.systems[o.to.id]!.owner).length;
}

function addStructure(w: World, systemId: string, kind: Building, orbit?: Orbit, poi?: string): void {
  const st = w.systems[systemId]!;
  const sys = w.galaxy.systems[systemId]!;
  const o = orbit ?? defaultOrbit(kind);
  const at = poi ?? st.mainPoi;
  st.structures.push({ id: newId(w, 'S'), kind, poi: at, orbit: o, angle: nextAngle(st, o, orbitSlots(w, sys, at)[o], at), hp: B.STRUCTURE_HP[kind] });
}

/** Points of interest a colony can see in a system: open ones always; covered ones once owned, occupied or probed. */
export function knownPois(w: World, colonyId: string, systemId: string): Set<string> {
  const layout = layoutOf(w.galaxy, systemId);
  const st = w.systems[systemId]!;
  const out = new Set<string>();
  const owner = st.owner === colonyId || (st.owner !== null && isAlly(w, colonyId, st.owner));
  const probed = new Set(w.known[colonyId]?.[systemId] ?? []);
  for (const p of layout.pois) {
    if (p.cover < 2 || owner || probed.has(p.id)) { out.add(p.id); continue; }
    if (Object.values(w.fleets).some((f) => f.owner === colonyId && f.at === systemId && (f.poi === p.id || f.hop?.to === p.id))) out.add(p.id);
  }
  return out;
}

/** A system whose main point of interest is covered hides its owner from strangers: a lair. */
export function hiddenFrom(w: World, colonyId: string, systemId: string): boolean {
  const st = w.systems[systemId]!;
  if (!st.owner || st.owner === colonyId || isAlly(w, colonyId, st.owner)) return false;
  const main = poiOf(layoutOf(w.galaxy, systemId), st.mainPoi);
  return !!main && main.cover >= 2 && !knownPois(w, colonyId, systemId).has(main.id);
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
      const lair = layoutOf(w.galaxy, id).template === 'lair' ? (opts.faction === 'corsairs' ? 1.35 : 0.4) : 1;
      const score = Math.min(d, 6000) * rng.range(0.9, 1) * lair;
      if (score > bestScore) { bestScore = score; best = sys; }
    }
  }
  if (!best) throw new Error('no room left on the rim');
  const id = opts.id ?? newId(w, 'C');
  const colony: Colony = {
    id, name: opts.name, faction: opts.faction, persona: opts.persona, npc: opts.npc ?? false,
    capital: best.id, marketSystem: best.id, credits: 300, influence: B.STARTING_INFLUENCE,
    createdAt: w.time, watchStartHour: 0, policy: PolicySchema.parse({ ...DEFAULT_POLICY, ...PERSONA_DEFAULTS[opts.persona] }),
    alliance: null, scoreWindow: [], marketVolume7d: [], lastProduced: B.emptyStock(), avgProduced: B.emptyStock(), lastOverflow: B.emptyStock(), lastSeenAt: w.time, journal: [], decrees: [],
  };
  if (opts.origin) colony.origin = opts.origin;
  w.colonies[id] = colony;
  const st = w.systems[best.id]!;
  setOwner(w, best.id, id);
  st.stationHp = B.STATION_HP;
  st.stock = { ...B.STARTING_STOCK };
  st.population = 0.5;
  addStructure(w, best.id, 'extractor');
  addStructure(w, best.id, 'shipyard');
  const cargos = emptyFleet(); cargos.cargo = B.STARTING_CARGOS;
  mergeFleet(w, id, best.id, cargos);
  logEvent(w, 'colony.founded', [id], { capital: best.id, faction: opts.faction });
  return colony;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Legacy summary of a route (seconds, on-network flag, length); convoys use planPath directly. */
export function planRoute(w: World, colony: Colony, from: string, to: string): { seconds: number; onNet: boolean; length: number } {
  const p = planPath(w, colony, from, to);
  const speed = fleetSpeed(colony, { corvette: 1, frigate: 0, cruiser: 0, cargo: 0 }, p.onNet);
  return { seconds: Math.ceil(p.length / speed), onNet: p.onNet, length: p.length };
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
    case 'build': return build(w, colony, cmd.system, cmd.building, cmd.orbit, cmd.poi);
    case 'train': return train(w, colony, cmd.system, cmd.unit, cmd.count);
    case 'market_order': {
      if (!reachableRegions(w, colony).has(cmd.region)) return { ok: false, reason: 'market out of reach' };
      const ms = w.systems[colony.marketSystem]!;
      if (cmd.side === 'sell') {
        if (ms.stock[cmd.resource] < cmd.qty) return { ok: false, reason: 'not enough stock at the market system' };
        ms.stock[cmd.resource] -= cmd.qty;
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
      if (o.side === 'sell') depositClamped(w, colony.marketSystem, { [o.resource]: o.qty }); else colony.credits += o.qty * o.price;
      delete w.orders[o.id];
      return { ok: true };
    }
    case 'barter_offer': {
      const to = w.colonies[cmd.to];
      if (!to || to.id === colony.id) return { ok: false, reason: 'no such partner' };
      const shared = [...reachableRegions(w, colony)].some((r) => reachableRegions(w, to).has(r));
      if (!shared && !isAlly(w, colony.id, to.id)) return { ok: false, reason: 'no shared market' };
      const ms = w.systems[colony.marketSystem]!;
      if (!stockHas(ms.stock, cmd.give)) return { ok: false, reason: 'not enough stock at the market system' };
      // Throwaway colonies feeding a main one (REVIEW-S0 § 2): same origin never trades; a young colony may not gift;
      // a pair of colonies exchanges at most `pairTransferCapPerDay` of value per day.
      if (!w.rules.sameOriginTrade && colony.origin && colony.origin === to.origin) return { ok: false, reason: 'same origin' };
      const give = bundleValue(cmd.give), want = bundleValue(cmd.want);
      if (isYoung(w, colony) && give > want * w.rules.giftRatioMax) return { ok: false, reason: 'young colonies cannot gift' };
      if (!recordTransfer(w, colony.id, to.id, give)) return { ok: false, reason: 'pair transfer cap reached' };
      stockSub(ms.stock, cmd.give);
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
    case 'fleet_order': return fleetOrder(w, colony, cmd.fleet, cmd.order, cmd.target);
    case 'focus': {
      const f = w.fleets[cmd.fleet];
      if (!f || f.owner !== colony.id) return { ok: false, reason: 'not your fleet' };
      f.focus = cmd.target;
      return { ok: true };
    }
    case 'split_fleet': {
      const f = w.fleets[cmd.fleet];
      if (!f || f.owner !== colony.id || f.at === null) return { ok: false, reason: 'not your fleet or in transit' };
      const units = emptyFleet();
      for (const t of Object.keys(units) as UnitType[]) units[t] = Math.min(f.units[t], cmd.units[t] ?? 0);
      if (fleetSize(units) === 0 || fleetSize(units) === fleetSize(f.units)) return { ok: false, reason: 'nothing to split' };
      for (const t of Object.keys(units) as UnitType[]) f.units[t] -= units[t];
      const nf = newFleet(w, colony.id, f.at, units);
      nf.pos = f.pos ? { ...f.pos } : null;
      return { ok: true, id: nf.id };
    }
    case 'route_set': {
      if (!w.systems[cmd.from] || !w.systems[cmd.to] || cmd.from === cmd.to) return { ok: false, reason: 'bad route' };
      if (w.systems[cmd.from]!.owner !== colony.id) return { ok: false, reason: 'origin is not yours' };
      const toOwner = w.systems[cmd.to]!.owner;
      if (toOwner !== colony.id && (!toOwner || !isAlly(w, colony.id, toOwner))) return { ok: false, reason: 'destination is not yours or an ally\'s' };
      const existing = Object.values(w.routes).find((r) => r.owner === colony.id && r.from === cmd.from && r.to === cmd.to && r.resource === cmd.resource);
      if (existing) { existing.perTrip = cmd.perTrip; existing.whenBelow = cmd.whenBelow; existing.active = true; return { ok: true, id: existing.id }; }
      if (routeCount(w, colony.id) >= routeLimit(w, colony)) return { ok: false, reason: 'route limit reached' };
      const id = newId(w, 'R');
      w.routes[id] = { id, owner: colony.id, from: cmd.from, to: cmd.to, resource: cmd.resource, perTrip: cmd.perTrip, whenBelow: cmd.whenBelow, active: true, lastRunAt: -1e9 };
      return { ok: true, id };
    }
    case 'route_remove': {
      const r = w.routes[cmd.route];
      if (!r || r.owner !== colony.id) return { ok: false, reason: 'no such route' };
      delete w.routes[r.id];
      return { ok: true };
    }
    case 'convoy_send': return sendConvoy(w, colony, cmd.from, cmd.to, cmd.cargo, cmd.escort ?? null, null);
    case 'agent_mission': {
      const cost = B.AGENT_COST_INFLUENCE[cmd.mission];
      if (colony.influence < cost) return { ok: false, reason: 'not enough influence' };
      if (cmd.mission === 'spy' && !w.galaxy.sectors[cmd.target]) return { ok: false, reason: 'no such sector' };
      if (cmd.mission === 'sabotage' && !w.relays[cmd.target]) return { ok: false, reason: 'no such relay' };
      if (cmd.mission === 'envoy' && !w.colonies[cmd.target]) return { ok: false, reason: 'no such colony' };
      if (cmd.mission === 'probe' && !w.galaxy.systems[cmd.target]) return { ok: false, reason: 'no such system' };
      colony.influence -= cost;
      const id = newId(w, 'M');
      w.missions[id] = { id, owner: colony.id, mission: cmd.mission, target: cmd.target, readyAt: w.time + B.AGENT_SECONDS[cmd.mission] };
      return { ok: true, id };
    }
    case 'treaty': return proposeTreaty(w, colony, cmd.with, cmd.kind);
    case 'set_watch': {
      const cd = w.rules.watchChangeCooldownHours * 3600;
      if (colony.watchChangedAt !== undefined && w.time - colony.watchChangedAt < cd) return { ok: false, reason: 'watch changed recently' };
      if (cmd.startHour === colony.watchStartHour) return { ok: true };
      colony.watchStartHour = cmd.startHour;
      colony.watchChangedAt = w.time;
      return { ok: true };
    }
    case 'set_policy': colony.policy = cmd.policy; return { ok: true };
    case 'decree': return enactDecree(w, colony, cmd.kind);
    case 'light_beacon': {
      const sys = w.galaxy.systems[cmd.system];
      if (!sys || sys.kind !== 'beacon') return { ok: false, reason: 'not a beacon' };
      if (w.litBeacons[sys.id]) return { ok: false, reason: 'already lit' };
      const st = w.systems[sys.id]!;
      if (st.owner !== colony.id || !colonyNetwork(w, colony).has(sys.id)) return { ok: false, reason: 'beacon not connected' };
      if (st.stock.crystal < B.BEACON_CRYSTAL) return { ok: false, reason: 'not enough crystal at the beacon' };
      st.stock.crystal -= B.BEACON_CRYSTAL;
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
  if (!net.has(aId) && !net.has(bId)) return { ok: false, reason: 'not connected to your network' };
  for (const id of [aId, bId]) {
    const owner = w.systems[id]!.owner;
    if (owner && owner !== colony.id && !isAlly(w, colony.id, owner)) return { ok: false, reason: 'system held by another colony' };
  }
  const verdict = evaluateLink(w.galaxy, a, b, rangeContext(w, colony));
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  // The anchored end pays from its own warehouse when it can; otherwise the Network pays from the
  // capital (it is connected to the anchor by construction). Frontier outposts hold almost nothing, and
  // making every relay wait for a metal convoy stalled expansion at three systems (decision 0005).
  const payers = [aId, bId, colony.capital].filter((id) => net.has(id) && w.systems[id]!.owner === colony.id && stockHas(w.systems[id]!.stock, verdict.cost));
  if (!payers.length) return { ok: false, reason: 'not enough resources' };
  stockSub(w.systems[payers[0]!]!.stock, verdict.cost);
  const id = relayId(aId, bId);
  addRelay(w, { id, a: id.split('|')[0]!, b: id.split('|')[1]!, owner: colony.id, length: verdict.length, upkeep: verdict.upkeep, readyAt: w.time + verdict.buildSeconds, cutUntil: 0 });
  for (const sid of [aId, bId]) {
    const st = w.systems[sid]!;
    if (!st.owner) claim(w, colony, sid);
  }
  return { ok: true, id };
}

/** A new system: station up, a little population, and a default supply route home. */
function claim(w: World, colony: Colony, systemId: string): void {
  const st = w.systems[systemId]!;
  setOwner(w, systemId, colony.id);
  st.population = 0.1;
  st.stationHp = B.STATION_HP;
  logEvent(w, 'system.claimed', [colony.id], { system: systemId });
  if (systemId !== colony.capital && routeCount(w, colony.id) < routeLimit(w, colony) + 50) {
    const id = newId(w, 'R');
    w.routes[id] = { id, owner: colony.id, from: systemId, to: colony.capital, resource: 'all', perTrip: B.CARGO_CAPACITY * 2, whenBelow: Infinity, active: true, lastRunAt: -1e9 };
  }
}

function build(w: World, colony: Colony, systemId: string, building: Building, orbit?: Orbit, poiId?: string): ApplyResult {
  const sys = w.galaxy.systems[systemId];
  const st = w.systems[systemId];
  if (!sys || !st || st.owner !== colony.id) return { ok: false, reason: 'not your system' };
  if (!colonyNetwork(w, colony).has(systemId)) return { ok: false, reason: 'system not connected' };
  if (st.blockade) return { ok: false, reason: 'system under blockade' };
  const layout = layoutOf(w.galaxy, systemId);
  const poi = poiOf(layout, poiId ?? st.mainPoi);
  if (!poi) return { ok: false, reason: 'no such point of interest' };
  if (poi.kind === 'jump' || poi.kind === 'nebula') return { ok: false, reason: 'nothing can be built here' };
  const o = orbit ?? defaultOrbit(building);
  if (Math.abs(o - defaultOrbit(building)) > 1) return { ok: false, reason: 'wrong orbit for this structure' };
  if (freeSlotsOnOrbit(w, sys, o, poi.id) <= 0) return { ok: false, reason: 'no free slot on this orbit' };
  const unique: Building[] = ['extractor', 'shipyard', 'bastion', 'tradepost', 'amplifier', 'antenna'];
  if (unique.includes(building) && (hasStructure(st, building) || st.buildQueue.some((j) => j.building === building))) return { ok: false, reason: 'already built' };
  if (building === 'refinery' && poi.kind !== 'gas') return { ok: false, reason: 'a refinery needs a gas giant' };
  if (building === 'relay') {
    if (poi.id === st.mainPoi) return { ok: false, reason: 'the station already relays here' };
    if (!RELAY_KINDS.has(poi.kind)) return { ok: false, reason: 'a relay needs a body to anchor to' };
    if (st.structures.some((x) => x.kind === 'relay' && x.poi === poi.id) || st.buildQueue.some((j) => j.building === 'relay' && j.poi === poi.id)) return { ok: false, reason: 'already built' };
  }
  const cost = B.BUILDING_COST[building];
  if (!stockHas(st.stock, cost)) return { ok: false, reason: 'not enough resources here' };
  stockSub(st.stock, cost);
  st.buildQueue.push({ building, orbit: o, readyAt: w.time + B.BUILDING_SECONDS[building], poi: poi.id });
  return { ok: true };
}

function train(w: World, colony: Colony, systemId: string, unit: UnitType, count: number): ApplyResult {
  const st = w.systems[systemId];
  if (!st || st.owner !== colony.id) return { ok: false, reason: 'not your system' };
  if (!hasStructure(st, 'shipyard')) return { ok: false, reason: 'no shipyard' };
  if (!colonyNetwork(w, colony).has(systemId)) return { ok: false, reason: 'system not connected' };
  if (st.blockade) return { ok: false, reason: 'system under blockade' };
  const mult = colony.faction === 'corsairs' && unit !== 'cargo' ? B.CORSAIR_SHIP_COST_MULT : 1;
  const cost = scaleStock(B.UNIT_COST[unit], count * mult);
  if (!stockHas(st.stock, cost)) return { ok: false, reason: 'not enough resources here' };
  stockSub(st.stock, cost);
  const queueEnd = st.trainQueue.length ? st.trainQueue[st.trainQueue.length - 1]!.readyAt : w.time;
  st.trainQueue.push({ unit, count, readyAt: queueEnd + B.UNIT_SECONDS[unit] * count });
  return { ok: true };
}

function newFleet(w: World, owner: string, at: string, units: Fleet, poi?: string): FleetState {
  const id = newId(w, 'F');
  const f: FleetState = { id, owner, units, damage: emptyDamage(), cargo: B.emptyStock(), at, from: null, destination: null, path: [], departAt: 0, arriveAt: 0, order: { kind: 'idle' }, poi: poi ?? w.systems[at]!.mainPoi, hops: [], hop: null, pos: null, focus: null };
  w.fleets[id] = f;
  return f;
}

/** Idle fleets of one class merge: warships with warships, cargos with cargos (a convoy is escorted on purpose). */
function mergeFleet(w: World, owner: string, at: string, units: Fleet): FleetState {
  const cargoClass = combatSize(units) === 0 && units.cargo > 0;
  const main = w.systems[at]!.mainPoi;
  const existing = Object.values(w.fleets).find((f) => f.owner === owner && f.at === at && f.poi === main && f.order.kind === 'idle' && f.pos === null && (combatSize(f.units) === 0 && f.units.cargo > 0) === cargoClass);
  if (existing) { existing.units = addFleet(existing.units, units); return existing; }
  return newFleet(w, owner, at, units);
}

/** Rium a fleet burns to cross `length` world units off the Network. */
export function offNetRium(length: number, units: Fleet): number {
  return Math.ceil(length * B.OFF_NET_RIUM_PER_UNIT * fleetSize(units));
}

/** Starts a journey along waypoints; convoys hop, warships jump to the end (they are not intercepted en route). */
function depart(w: World, colony: Colony, f: FleetState, to: string, order: FleetOrder): ApplyResult {
  if (f.at === null) return { ok: false, reason: 'fleet in transit' };
  const plan = planPath(w, colony, f.at, to);
  if (!plan.onNet) {
    const rium = offNetRium(plan.length, f.units);
    // Fuel comes from the departure system when it is ours, otherwise the capital fuels the fleet remotely
    // (so a raider deep in enemy space can always be called home).
    const st = w.systems[f.at]!;
    const fuel = st.owner === colony.id && st.stock.rium >= rium ? st : w.systems[colony.capital]!;
    if (fuel.stock.rium < rium) return { ok: false, reason: 'not enough Rium for off-network travel' };
    fuel.stock.rium -= rium;
  }
  const hop = f.units.cargo > 0;
  const speed = fleetSpeed(colony, f.units, plan.onNet);
  f.order = order;
  f.from = f.at;
  f.at = null;
  f.pos = null;
  f.poi = null; f.hops = []; f.hop = null;
  if (hop && plan.waypoints.length > 1) {
    f.path = plan.waypoints.slice(1);
    f.destination = plan.waypoints[0]!;
    f.arriveAt = w.time + Math.ceil(plan.legs[0]! / speed);
  } else {
    f.path = [];
    f.destination = to;
    f.arriveAt = w.time + Math.ceil(plan.length / speed);
  }
  f.departAt = w.time;
  // A warship heading for someone else's system is announced to its owner: the tension of the approach, with an hour of arrival.
  const dst = w.systems[to];
  if (dst?.owner && dst.owner !== colony.id && combatSize(f.units) > 0 && !isAlly(w, colony.id, dst.owner) && order.kind !== 'convoy' && order.kind !== 'return') {
    logEvent(w, 'fleet.inbound', [colony.id, dst.owner], { system: to, arriveAt: f.arriveAt, size: combatSize(f.units) });
  }
  return { ok: true };
}

function fleetOrder(w: World, colony: Colony, fleetId: string, order: 'move' | 'raid' | 'blockade' | 'defend' | 'return' | 'ambush', target: string): ApplyResult {
  const fleet = w.fleets[fleetId];
  if (!fleet || fleet.owner !== colony.id) return { ok: false, reason: 'not your fleet' };
  if (fleet.at === null) return { ok: false, reason: 'fleet in transit' };
  if (fleetSize(fleet.units) === 0) return { ok: false, reason: 'empty fleet' };
  if (order !== 'move' && order !== 'return' && combatSize(fleet.units) === 0) return { ok: false, reason: 'cargos cannot fight' };
  delete fleet.shuttle;
  let destination: string;
  let newOrder: FleetOrder;
  // target: "<systemId>", "<systemId>:<structureId>" (raid) or "<systemId>:<poiId>" (blockade, defend, ambush, move)
  const [sysId, extra] = target.split(':') as [string, string | undefined];
  const poiArg = extra && layoutOf(w.galaxy, sysId).pois.some((p) => p.id === `${sysId}/${extra}` || p.id === extra) ? (extra.includes('/') ? extra : `${sysId}/${extra}`) : undefined;
  if (order === 'raid') {
    const st = w.systems[sysId];
    if (!st || !st.owner) return { ok: false, reason: 'no such target' };
    if (st.owner === colony.id) return { ok: false, reason: 'your own system' };
    const structId = extra && !poiArg ? extra : undefined;
    if (structId && !st.structures.some((s) => s.id === structId)) return { ok: false, reason: 'no such structure' };
    destination = sysId;
    newOrder = { kind: 'raid', target: structId ?? 'station', via: sysId };
  } else if (order === 'return') {
    destination = colony.capital;
    newOrder = { kind: 'return' };
  } else {
    if (!w.galaxy.systems[sysId]) return { ok: false, reason: 'no such system' };
    destination = sysId;
    const withPoi = poiArg ? { poi: poiArg } : {};
    newOrder = order === 'move' ? { kind: 'move', to: sysId, ...withPoi } : order === 'blockade' ? { kind: 'blockade', system: sysId, ...withPoi } : order === 'ambush' ? { kind: 'ambush', system: sysId, ...withPoi } : { kind: 'defend', system: sysId, ...withPoi };
  }
  if (newOrder.kind === 'raid' || newOrder.kind === 'blockade') {
    const victim = w.colonies[w.systems[destination]!.owner ?? ''];
    if (victim && (isShielded(w, victim) || isShielded(w, colony) || atPeace(w, colony.id, victim.id))) return { ok: false, reason: 'at peace or shielded' };
  }
  if (destination === fleet.at) {
    // Already in the system: travel between points of interest along the lanes.
    fleet.order = newOrder;
    if (fleet.hop) return { ok: false, reason: 'fleet in transit' };
    fleet.pos = null;
    proceed(w, fleet);
    return { ok: true };
  }
  return depart(w, colony, fleet, destination, newOrder);
}

function sendConvoy(w: World, colony: Colony, from: string, to: string, cargo: StockDelta, escortId: string | null, routeId: string | null): ApplyResult {
  const st = w.systems[from];
  if (!st || st.owner !== colony.id) return { ok: false, reason: 'origin is not yours' };
  if (!w.systems[to] || to === from) return { ok: false, reason: 'bad destination' };
  if (st.blockade) return { ok: false, reason: 'origin under blockade' };
  // A convoy into another colony's warehouse is a transfer like a barter: same caps (REVIEW-S0 § 2).
  const destOwner = w.systems[to]!.owner;
  if (destOwner && destOwner !== colony.id) {
    const other = w.colonies[destOwner];
    if (other && !w.rules.sameOriginTrade && colony.origin && colony.origin === other.origin) return { ok: false, reason: 'same origin' };
    if (isYoung(w, colony)) return { ok: false, reason: 'young colonies cannot gift' };
    if (!recordTransfer(w, colony.id, destOwner, bundleValue(cargo))) return { ok: false, reason: 'pair transfer cap reached' };
  }
  const total = stockTotal(cargo);
  if (total <= 0) return { ok: false, reason: 'empty cargo' };
  if (!stockHas(st.stock, cargo)) return { ok: false, reason: 'not enough stock at origin' };
  const idle = Object.values(w.fleets).filter((f) => f.owner === colony.id && f.at === from && f.order.kind === 'idle' && f.units.cargo > 0);
  const available = idle.reduce((s, f) => s + f.units.cargo, 0);
  const needed = Math.ceil(total / B.CARGO_CAPACITY);
  if (available < needed) return { ok: false, reason: `need ${needed} cargo(s), ${available} idle here` };
  // Take cargos from idle fleets, escorts from the named fleet.
  let left = needed;
  const convoy = newFleet(w, colony.id, from, emptyFleet());
  for (const f of idle) {
    const take = Math.min(left, f.units.cargo);
    f.units.cargo -= take; convoy.units.cargo += take; left -= take;
    if (fleetSize(f.units) === 0) delete w.fleets[f.id];
    if (left === 0) break;
  }
  if (escortId) {
    const e = w.fleets[escortId];
    if (e && e.owner === colony.id && e.at === from && e.id !== convoy.id) {
      for (const t of COMBAT_UNITS) { convoy.units[t] += e.units[t]; convoy.damage[t] += e.damage[t]; e.units[t] = 0; e.damage[t] = 0; }
      if (fleetSize(e.units) === 0) delete w.fleets[e.id];
    }
  }
  stockSub(st.stock, cargo);
  stockAdd(convoy.cargo, cargo);
  const res = depart(w, colony, convoy, to, { kind: 'convoy', to, route: routeId });
  if (!res.ok) { // refund and dissolve
    stockAdd(st.stock, convoy.cargo);
    mergeFleet(w, colony.id, from, convoy.units);
    delete w.fleets[convoy.id];
    return res;
  }
  logEvent(w, 'convoy.sent', [colony.id], { from, to, cargo, cargos: convoy.units.cargo });
  return { ok: true, id: convoy.id };
}

function proposeTreaty(w: World, colony: Colony, withId: string, kind: TreatyKind): ApplyResult {
  const other = w.colonies[withId];
  if (!other || other.id === colony.id) return { ok: false, reason: 'no such colony' };
  const cost = B.TREATY_COST_INFLUENCE[kind];
  if (colony.influence < cost) return { ok: false, reason: 'not enough influence' };
  if (kind === 'federation' && (!colony.alliance || colony.alliance !== other.alliance)) return { ok: false, reason: 'federation requires a shared alliance' };
  if ((kind === 'transit' || kind === 'federation') && (isYoung(w, colony) || isYoung(w, other))) return { ok: false, reason: 'young colonies cannot grant transit' };
  if (!w.rules.sameOriginTrade && colony.origin && colony.origin === other.origin) return { ok: false, reason: 'same origin' };
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

const ROUTE_INTERVAL_S = 600;
const BATTLE_SUBSTEP_S = 2;

/** Advance the simulation by `seconds`. Timers resolve in order; the Draw fires on each hour. */
export function tick(w: World, seconds: number, maxStep = 60): void {
  let remaining = seconds;
  let lastRoutes = Math.floor(w.time / ROUTE_INTERVAL_S);
  while (remaining > 0 && !w.ended) {
    const nextHour = (Math.floor(w.time / 3600) + 1) * 3600;
    const step = Math.min(remaining, nextHour - w.time, maxStep);
    // Plateaus with hostiles are simulated in short sub-steps so combat stays continuous.
    if (w.engagedSystems.length || hasHostilePresence(w)) {
      for (let done = 0; done < step; done += BATTLE_SUBSTEP_S) {
        const dt = Math.min(BATTLE_SUBSTEP_S, step - done);
        w.time += dt;
        runBattles(w, dt);
      }
    } else {
      w.time += step;
    }
    remaining -= step;
    processTimers(w, step);
    const routeSlot = Math.floor(w.time / ROUTE_INTERVAL_S);
    if (routeSlot !== lastRoutes) { lastRoutes = routeSlot; processRoutes(w); processSalvage(w); processDepots(w); }
    if (w.time >= nextHour) { runDraw(w); pruneBattles(w); }
    if (w.time >= w.seasonEndsAt) endSeason(w, 'silence');
  }
}

function hasHostilePresence(w: World): boolean {
  for (const f of Object.values(w.fleets)) if (f.at && f.poi && f.pos && combatSize(f.units) > 0) return true;
  return false;
}

function runBattles(w: World, dt: number): void {
  // One pass over the fleets: who is out on which plateau, who is docked where. Everything below
  // works from these lists, so a season with thousands of fleets stays linear per step.
  const out = new Map<string, FleetState[]>();
  const docked = new Map<string, FleetState[]>();
  const push = (m: Map<string, FleetState[]>, key: string, f: FleetState): void => { const l = m.get(key); if (l) l.push(f); else m.set(key, [f]); };
  const plateaus = new Set<string>();
  for (const id of w.engagedSystems) for (const poi of w.systems[id]!.engagedPois) plateaus.add(plateauKey(id, poi));
  const all = Object.values(w.fleets);
  // Most fleets sit docked most of the time: only fleets out on a plateau cost anything here.
  for (const f of all) {
    if (f.pos === null || f.at === null || f.poi === null) continue;
    const armed = combatSize(f.units) > 0;
    if (!armed && f.units.cargo === 0) continue;
    const key = plateauKey(f.at, f.poi);
    push(out, key, f);
    if (armed) plateaus.add(key);
  }
  if (!plateaus.size) return;
  for (const f of all) {
    if (f.pos !== null || f.at === null || f.poi === null) continue;
    if (combatSize(f.units) === 0 && f.units.cargo === 0) continue;
    const key = plateauKey(f.at, f.poi);
    if (plateaus.has(key)) push(docked, key, f);
  }
  for (const key of plateaus) {
    const [id, poi] = key.split('|') as [string, string];
    const fleets = [...(out.get(key) ?? [])];
    fleets.push(...deployDefenders(w, id, poi, docked.get(key) ?? [], fleets));
    const ongoing = battleTick(w, id, poi, dt, fleets);
    if (!ongoing) settlePlateau(w, id, poi, fleets);
  }
}

/** After the shooting stops: convoys move on, friends dock, raiders take their plunder. */
function settlePlateau(w: World, systemId: string, poi: string, fleets: FleetState[] = plateauFleets(w, systemId, poi)): void {
  const st = w.systems[systemId]!;
  for (const f of fleets) {
    if (f.at !== systemId || f.poi !== poi || f.pos === null) continue;
    const colony = w.colonies[f.owner];
    if (!colony) continue;
    const friendly = st.owner === f.owner || (st.owner !== null && isAlly(w, f.owner, st.owner));
    if (f.hops.length) { startHop(w, f); continue; }          // passing through: on to the next point of interest
    if (f.order.kind === 'convoy') { continueConvoy(w, f); continue; }
    if (f.order.kind === 'raid') {
      const victim = st.owner ? w.colonies[st.owner] : undefined;
      const target = f.order.target;
      const targetGone = target === 'station' ? st.stationHp <= 0 : !st.structures.some((x) => x.id === target && x.hp > 0);
      if (victim && targetGone) {
        if (target === 'station') logEvent(w, 'relay.cut', [f.owner, victim.id], { system: systemId });
        loot(w, colony, victim, systemId, combatSize(f.units), poi);
        f.order = { kind: 'idle' };
      }
      continue;
    }
    // Friends dock; in an unclaimed system, fleets with nothing to do hold orbit quietly (docked) too.
    if ((friendly || st.owner === null) && (f.order.kind === 'idle' || f.order.kind === 'defend' || f.order.kind === 'return' || f.order.kind === 'move')) { f.pos = null; if (f.order.kind !== 'defend') f.order = { kind: 'idle' }; }
  }
}

/** Friendly warships docked at a threatened system come out to fight; cargos stay in the dock. Returns the fleets that came out. */
function deployDefenders(w: World, systemId: string, poi: string, dockedHere?: FleetState[], plateau?: FleetState[]): FleetState[] {
  const st = w.systems[systemId]!;
  const hostiles = armedHostilesPresent(w, systemId, poi, plateau);
  if (!hostiles.length) return [];
  const docked = dockedHere ?? Object.values(w.fleets).filter((f) => f.at === systemId && f.poi === poi && f.pos === null);
  const deployed: FleetState[] = [];
  let i = 0;
  for (const f of docked) {
    if (f.pos !== null || combatSize(f.units) === 0) continue;
    if (!st.owner || (f.owner !== st.owner && !isAlly(w, f.owner, st.owner))) continue;
    f.pos = { r: 2, a: (90 + i * 47) % 360 };
    deployed.push(f);
    i++;
  }
  // With the station down, or away from the station, docked cargos are exposed.
  if (poi !== st.mainPoi || st.stationHp <= 0) for (const f of docked) if (f.pos === null && f.units.cargo > 0) { f.pos = { r: 1, a: 180 }; deployed.push(f); }
  return deployed;
}

function processTimers(w: World, dt: number): void {
  const plateau = plateauIndex(w);
  for (const owner of Object.keys(w.owned)) for (const id of w.owned[owner]!) {
    const st = w.systems[id]!;
    const sys = w.galaxy.systems[id]!;
    if (st.buildQueue.length) {
      const done = st.buildQueue.filter((j) => j.readyAt <= w.time);
      if (done.length) {
        st.buildQueue = st.buildQueue.filter((j) => j.readyAt > w.time);
        for (const j of done) st.structures.push({ id: newId(w, 'S'), kind: j.building, poi: j.poi, orbit: j.orbit, angle: nextAngle(st, j.orbit, orbitSlots(w, sys, j.poi)[j.orbit], j.poi), hp: B.STRUCTURE_HP[j.building] });
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
    evaluateBlockade(w, id, plateau.get(plateauKey(id, st.mainPoi)) ?? []);
    if (st.blockade && st.owner && w.time - st.blockade.since >= captureHours(w, id) * 3600) capture(w, id, st.blockade.by);
  }
  for (const fleet of Object.values(w.fleets)) {
    if (fleet.at === null && fleet.arriveAt <= w.time) arrive(w, fleet);
    else if (fleet.hop && fleet.hop.arriveAt <= w.time) reachPoi(w, fleet);
  }
  for (const m of Object.values(w.missions)) if (m.readyAt <= w.time) resolveMission(w, m.id);
  for (const [id, f] of Object.entries(w.fleets)) if (fleetSize(f.units) === 0 && f.at !== null) delete w.fleets[id];
  // Healing where nothing hostile is present.
  const nets = new Map<string, Map<string, number>>();
  const contested = new Set<string>();
  for (const [key, fleets] of plateau) { const id = key.split('|')[0]!; if (fleets.some((f) => combatSize(f.units) > 0 && w.systems[id]!.owner !== f.owner)) contested.add(id); }
  for (const owner of Object.keys(w.owned)) {
    const colony = w.colonies[owner];
    if (!colony) continue;
    if (!nets.has(owner)) nets.set(owner, colonyNetwork(w, colony));
    for (const id of w.owned[owner]!) regenerate(w, id, dt, nets.get(owner)!.has(id), contested.has(id));
  }
}

/** A blockade is control of the plateau: hostiles armed, nothing left to shoot back. */
function evaluateBlockade(w: World, systemId: string, plateau: FleetState[]): void {
  const st = w.systems[systemId]!;
  if (!st.owner || !plateau.length) { st.blockade = null; return; }
  const hostiles = armedHostilesPresent(w, systemId, st.mainPoi, plateau).filter((f) => f.order.kind === 'blockade' || f.order.kind === 'raid' || f.order.kind === 'ambush');
  if (!hostiles.length) { st.blockade = null; return; }
  const defendersAlive = Object.values(w.fleets).some((f) => f.at === systemId && f.poi === st.mainPoi && combatSize(f.units) > 0 && (f.owner === st.owner || isAlly(w, f.owner, st.owner!)));
  const turretsAlive = st.structures.some((s) => s.kind in B.TURRET_STATS && s.hp > 0 && s.poi === st.mainPoi);
  if (defendersAlive || turretsAlive) { st.blockade = null; return; }
  const by = hostiles.reduce((a, b) => (combatSize(a.units) >= combatSize(b.units) ? a : b)).owner;
  if (!st.blockade || st.blockade.by !== by) {
    st.blockade = { by, since: w.time };
    logEvent(w, 'blockade.start', [by, st.owner], { system: systemId });
  }
}

function loot(w: World, attacker: Colony, victim: Colony, systemId: string, size: number, poi?: string): void {
  if (colonyScore(w, attacker) > B.BULLY_SCORE_RATIO * Math.max(1, colonyScore(w, victim))) {
    attacker.influence = Math.max(0, attacker.influence - 5);
    logEvent(w, 'raid.bully', [attacker.id, victim.id]);
    return;
  }
  const st = w.systems[systemId]!;
  const taken: StockDelta = {};
  for (const r of B.RESOURCE_LIST) {
    const amount = Math.min(Math.floor(st.stock[r] * B.LOOT_FRACTION), size * 5);
    if (amount > 0) { st.stock[r] -= amount; taken[r] = amount; }
  }
  // A raid that breaks a refinery carries off most of its depot; the refinery itself is gone and must be rebuilt.
  if (poi && (w.depots[poi] ?? 0) > 0 && !st.structures.some((s) => s.kind === 'refinery' && s.poi === poi && s.hp > 0)) {
    const depot = w.depots[poi]!;
    const grabbed = Math.min(Math.floor(depot * B.DEPOT_LOOT_FRACTION), size * 20);
    if (grabbed > 0) { w.depots[poi] = depot - grabbed; taken.rium = (taken.rium ?? 0) + grabbed; }
    logEvent(w, 'refinery.raided', [attacker.id, victim.id], { system: systemId, poi, rium: grabbed });
  }
  // Loot travels home with the fleet as cargo-less plunder: credited to the raider's capital.
  depositClamped(w, attacker.capital, taken);
  logEvent(w, 'raid.loot', [attacker.id, victim.id], { taken, system: systemId });
}

/** Angle on the plateau edge from which a fleet arrives, based on where it came from. */
function approachAngle(w: World, from: string | null, to: string): number {
  if (!from) return 180;
  const a = w.galaxy.systems[from]!, b = w.galaxy.systems[to]!;
  return ((Math.atan2(a.y - b.y, a.x - b.x) * 180) / Math.PI + 360) % 360;
}

/** Arrival from another system: the fleet drops at a jump point, then crosses the lanes to its target. */
function arrive(w: World, fleet: FleetState): void {
  const dest = fleet.destination ?? fleet.at!;
  fleet.at = dest;
  fleet.destination = null;
  fleet.poi = entryJump(w.galaxy, dest, fleet.from);
  fleet.pos = null; fleet.hop = null; fleet.hops = [];
  if (!engageIfContested(w, fleet)) proceed(w, fleet);
}

/** Armed enemies on this plateau: the fleet stops at the edge and the engagement opens at once. */
function engageIfContested(w: World, fleet: FleetState): boolean {
  if (fleet.at === null || fleet.poi === null) return false;
  const colony = w.colonies[fleet.owner]!;
  const enemies = plateauFleets(w, fleet.at, fleet.poi).some((g) => g.owner !== colony.id && !isAlly(w, g.owner, colony.id) && !atPeace(w, g.owner, colony.id) && combatSize(g.units) > 0);
  const st = w.systems[fleet.at]!;
  const turrets = st.owner !== null && st.owner !== colony.id && !isAlly(w, colony.id, st.owner) && !atPeace(w, colony.id, st.owner) && !isShielded(w, colony) && !isShielded(w, w.colonies[st.owner]!)
    && st.structures.some((s) => s.poi === fleet.poi && s.kind in B.TURRET_STATS && s.hp > 0) && combatSize(fleet.units) > 0;
  if (!enemies && !turrets) return false;
  fleet.pos = { r: B.PLATEAU_RADIUS, a: approachAngle(w, fleet.from, fleet.at) };
  deployDefenders(w, fleet.at, fleet.poi);
  battleTick(w, fleet.at, fleet.poi, 0);
  return true;
}

/** Which point of interest an order aims at inside the system. */
function targetPoiFor(w: World, fleet: FleetState): string {
  const st = w.systems[fleet.at!]!;
  const o = fleet.order;
  if (o.kind === 'raid') {
    if (o.target === 'station') return st.mainPoi;
    return st.structures.find((s) => s.id === o.target)?.poi ?? st.mainPoi;
  }
  if ((o.kind === 'blockade' || o.kind === 'defend' || o.kind === 'ambush' || o.kind === 'move') && o.poi) return o.poi;
  return st.mainPoi;
}

/** From the current point of interest, go to the order's target: land here, or start crossing the lanes. */
function proceed(w: World, fleet: FleetState): void {
  if (fleet.at === null || fleet.poi === null) return;
  const target = targetPoiFor(w, fleet);
  if (fleet.poi === target) { landAt(w, fleet); return; }
  fleet.hops = pathInSystem(layoutOf(w.galaxy, fleet.at), fleet.poi, target).hops;
  startHop(w, fleet);
}

function startHop(w: World, fleet: FleetState): void {
  const next = fleet.hops.shift();
  if (!next || fleet.at === null || fleet.poi === null) { landAt(w, fleet); return; }
  const layout = layoutOf(w.galaxy, fleet.at);
  const lane = laneBetween(layout, fleet.poi, next);
  const st = w.systems[fleet.at]!;
  const colony = w.colonies[fleet.owner]!;
  const relayed = st.owner === colony.id || (st.owner !== null && isAlly(w, colony.id, st.owner));
  const seconds = Math.ceil((lane?.seconds ?? 120) / (relayed ? B.LANE_RELAYED_SPEEDUP : 1) / (colony.faction === 'corsairs' ? B.CORSAIR_SPEED_MULT : 1));
  fleet.hop = { from: fleet.poi, to: next, departAt: w.time, arriveAt: w.time + seconds };
  fleet.poi = null; fleet.pos = null;
}

/** End of a lane hop. */
function reachPoi(w: World, fleet: FleetState): void {
  if (!fleet.hop) return;
  fleet.poi = fleet.hop.to;
  fleet.hop = null;
  if (engageIfContested(w, fleet)) return;
  if (fleet.hops.length) startHop(w, fleet); else landAt(w, fleet);
}

/** The fleet has reached the point of interest its order aims at. */
function landAt(w: World, fleet: FleetState): void {
  const colony = w.colonies[fleet.owner]!;
  const dest = fleet.at!;
  const poi = fleet.poi!;
  const st = w.systems[dest]!;
  const order = fleet.order;
  const friendly = st.owner === colony.id || (st.owner !== null && isAlly(w, colony.id, st.owner));
  const hostileHere = plateauFleets(w, dest, poi).some((g) => g.owner !== colony.id && !isAlly(w, g.owner, colony.id) && !atPeace(w, g.owner, colony.id) && combatSize(g.units) > 0)
    || (st.owner !== null && !friendly && !atPeace(w, colony.id, st.owner) && !isShielded(w, colony) && !isShielded(w, w.colonies[st.owner]!));

  if (order.kind === 'convoy') {
    if (hostileHere) {
      // Exposed on the plateau; it continues (or unloads) once the engagement ends.
      fleet.pos = { r: B.PLATEAU_RADIUS, a: approachAngle(w, fleet.from, dest) };
      return;
    }
    continueConvoy(w, fleet);
    return;
  }
  if (order.kind === 'move' || order.kind === 'return') {
    fleet.order = { kind: 'idle' };
    fleet.pos = friendly && !hostileHere ? null : { r: B.PLATEAU_RADIUS, a: approachAngle(w, fleet.from, dest) };
    if (friendly && !hostileHere && poi === st.mainPoi && stockTotal(fleet.cargo) > 0) {
      // Cargos unload at the station; a shuttle then heads back to its depot.
      fleet.cargo = depositClamped(w, dest, fleet.cargo);
      if (stockTotal(fleet.cargo) === 0) fleet.cargo = B.emptyStock();
      if (fleet.shuttle && st.structures.some((s) => s.kind === 'refinery' && s.poi === fleet.shuttle && s.hp > 0)) { fleet.order = { kind: 'move', to: dest }; fleet.hops = pathInSystem(layoutOf(w.galaxy, dest), poi, fleet.shuttle).hops; if (fleet.hops.length) startHop(w, fleet); }
      else delete fleet.shuttle;
    }
    return;
  }
  if (order.kind === 'defend' || order.kind === 'ambush') {
    fleet.pos = friendly && !hostileHere ? null : { r: 2, a: approachAngle(w, fleet.from, dest) };
    return;
  }
  // raid / blockade: hostile intent, on the plateau from the edge.
  const victim = st.owner ? w.colonies[st.owner] : undefined;
  if (!victim || victim.id === colony.id || isShielded(w, victim) || isShielded(w, colony) || atPeace(w, colony.id, victim.id)) {
    fleet.order = { kind: 'idle' };
    fleet.pos = friendly ? null : { r: B.PLATEAU_RADIUS, a: approachAngle(w, fleet.from, dest) };
    logEvent(w, 'raid.refused', [colony.id, victim?.id ?? dest]);
    return;
  }
  fleet.pos = { r: B.PLATEAU_RADIUS, a: approachAngle(w, fleet.from, dest) };
  if (poi === st.mainPoi || st.structures.some((s) => s.poi === poi)) { deployDefenders(w, dest, poi); battleTick(w, dest, poi, 0); }
}

/** Next leg, or unloading at the destination. Called on arrival and when an engagement ends. */
function continueConvoy(w: World, f: FleetState): void {
  const colony = w.colonies[f.owner]!;
  if (f.order.kind !== 'convoy' || f.at === null) return;
  const st = w.systems[f.at]!;
  if (f.hops.length > 0) { startHop(w, f); return; }
  if (f.poi !== st.mainPoi && f.poi !== null) { // unloading happens at the station: cross to the main body first
    f.hops = pathInSystem(layoutOf(w.galaxy, f.at), f.poi, st.mainPoi).hops;
    if (f.hops.length) { startHop(w, f); return; }
  }
  if (f.path.length > 0) {
    const next = f.path.shift()!;
    const plan = planPath(w, colony, f.at, next);
    const speed = fleetSpeed(colony, f.units, plan.onNet);
    f.from = f.at; f.at = null; f.pos = null; f.destination = next; f.departAt = w.time; f.arriveAt = w.time + Math.ceil(plan.length / speed);
    return;
  }
  if (f.at !== f.order.to) { // rerouted or path exhausted: try again from here
    const res = depart(w, colony, f, f.order.to, f.order);
    if (!res.ok) { f.order = { kind: 'idle' }; f.pos = null; }
    return;
  }
  // Unload. Overflow stays aboard; the cargos are then free for the next route.
  const lost = depositClamped(w, f.at, f.cargo);
  f.cargo = lost;
  if (stockTotal(lost) === 0) f.cargo = B.emptyStock();
  const raidPlunder = st.owner !== f.owner && st.owner !== null && !isAlly(w, f.owner, st.owner);
  const routeId = f.order.route;
  logEvent(w, 'convoy.arrived', [f.owner], { system: f.at, route: routeId, kept: stockTotal(lost) });
  f.order = { kind: 'idle' };
  f.pos = raidPlunder ? { r: B.PLATEAU_RADIUS, a: 0 } : null;
  // Barter and market couriers vanish once delivered.
  if ((f as FleetState & { courier?: boolean }).courier) { delete w.fleets[f.id]; return; }
  // Route cargos shuttle back to the origin for the next trip.
  const route = routeId ? w.routes[routeId] : undefined;
  if (route && route.active && route.to === f.at && f.pos === null && stockTotal(f.cargo) === 0) {
    const back = depart(w, colony, f, route.from, { kind: 'convoy', to: route.from, route: null });
    if (back.ok) return;
  }
  // Merge with an idle fleet of the same class at the destination.
  const cargoClass = combatSize(f.units) === 0 && f.units.cargo > 0;
  const other = Object.values(w.fleets).find((g) => g.id !== f.id && g.owner === f.owner && g.at === f.at && g.poi === f.poi && g.order.kind === 'idle' && g.pos === null && (combatSize(g.units) === 0 && g.units.cargo > 0) === cargoClass);
  if (other && f.pos === null) { other.units = addFleet(other.units, f.units); stockAdd(other.cargo, f.cargo); delete w.fleets[f.id]; }
}

/** Fleets holding a wreck salvage it: Metal and Crystal for their capital, until the pool runs dry. */
/** Cargos parked at a refinery depot load its Rium and shuttle it to the station, again and again. */
function processDepots(w: World): void {
  for (const [poiId, amount] of Object.entries(w.depots)) {
    if (amount <= 0) continue;
    const systemId = poiId.split('/')[0]!;
    const st = w.systems[systemId];
    if (!st?.owner) continue;
    for (const f of Object.values(w.fleets)) {
      if (f.at !== systemId || f.poi !== poiId || f.hop || f.units.cargo === 0 || combatSize(f.units) > 0) continue;
      if (f.order.kind !== 'idle' && f.order.kind !== 'defend' && f.order.kind !== 'move') continue;
      if (f.owner !== st.owner && !isAlly(w, f.owner, st.owner)) continue;
      if (armedHostilesPresent(w, systemId, poiId).length) continue;
      const room = f.units.cargo * B.CARGO_CAPACITY - stockTotal(f.cargo);
      const load = Math.min(room, w.depots[poiId] ?? 0);
      if (load <= 0) continue;
      w.depots[poiId]! -= load;
      f.cargo.rium += load;
      f.shuttle = poiId;
      f.order = { kind: 'move', to: systemId };
      f.pos = null;
      f.hops = pathInSystem(layoutOf(w.galaxy, systemId), poiId, st.mainPoi).hops;
      if (f.hops.length) startHop(w, f); else landAt(w, f);
      logEvent(w, 'depot.loaded', [f.owner], { system: systemId, poi: poiId, rium: Math.round(load) });
    }
  }
}

function processSalvage(w: World): void {
  for (const f of Object.values(w.fleets)) {
    if (f.at === null || f.poi === null || f.hop || combatSize(f.units) === 0) continue;
    if (f.order.kind !== 'defend' && f.order.kind !== 'ambush' && f.order.kind !== 'idle' && f.order.kind !== 'move') continue;
    const poi = poiOf(layoutOf(w.galaxy, f.at), f.poi);
    if (!poi || poi.kind !== 'wreck') continue;
    if (armedHostilesPresent(w, f.at, f.poi).length) continue;
    const left = w.salvage[f.poi] ?? 1;
    if (left <= 0) continue;
    const colony = w.colonies[f.owner];
    if (!colony) continue;
    const k = Math.min(1, 0.3 + combatSize(f.units) * 0.1);
    const take = { metal: Math.min(B.SALVAGE_PER_PASS.metal * k, B.SALVAGE_POOL.metal * left), crystal: Math.min(B.SALVAGE_PER_PASS.crystal * k, B.SALVAGE_POOL.crystal * left) };
    const spent = Math.max(take.metal / B.SALVAGE_POOL.metal, take.crystal / B.SALVAGE_POOL.crystal);
    w.salvage[f.poi] = Math.max(0, left - spent);
    depositClamped(w, colony.capital, take);
    logEvent(w, 'salvage', [colony.id], { system: f.at, poi: f.poi, metal: Math.round(take.metal), crystal: Math.round(take.crystal * 10) / 10, left: Math.round(w.salvage[f.poi]! * 100) });
  }
}

/** Standing routes: idle cargos at the origin carry what the destination lacks. */
function processRoutes(w: World): void {
  // Idle cargos by "owner@system", one pass.
  const idleCargos = new Map<string, number>();
  for (const f of Object.values(w.fleets)) if (f.at && f.order.kind === 'idle' && f.units.cargo > 0) idleCargos.set(`${f.owner}@${f.at}`, (idleCargos.get(`${f.owner}@${f.at}`) ?? 0) + f.units.cargo);
  for (const route of Object.values(w.routes)) {
    if (!route.active) continue;
    const colony = w.colonies[route.owner];
    const from = w.systems[route.from], to = w.systems[route.to];
    if (!colony || !from || !to || from.owner !== route.owner) { if (from && from.owner !== route.owner) delete w.routes[route.id]; continue; }
    if (from.blockade || w.time - route.lastRunAt < ROUTE_INTERVAL_S) continue;
    const cargos = idleCargos.get(`${route.owner}@${route.from}`) ?? 0;
    if (!cargos) continue;
    const capacity = Math.min(route.perTrip, cargos * B.CARGO_CAPACITY);
    const load: StockDelta = {};
    if (route.resource === 'all') {
      // Everything above a working reserve at the origin, split across resources.
      const reserve = 120;
      let budget = capacity;
      for (const r of B.RESOURCE_LIST) {
        const surplus = Math.floor(from.stock[r] - reserve);
        if (surplus <= 0 || budget <= 0) continue;
        const take = Math.min(surplus, budget, Math.max(0, capacityOf(w, route.to) - to.stock[r]));
        if (take > 0) { load[r] = take; budget -= take; }
      }
    } else {
      const r = route.resource;
      if (to.stock[r] >= route.whenBelow) continue;
      const room = Math.max(0, capacityOf(w, route.to) - to.stock[r]);
      const take = Math.min(capacity, Math.floor(from.stock[r]), room, route.whenBelow === Infinity ? capacity : Math.ceil(route.whenBelow - to.stock[r]));
      if (take > 0) load[r] = take;
    }
    if (stockTotal(load) < 20) continue;
    const res = sendConvoy(w, colony, route.from, route.to, load, null, route.id);
    if (res.ok) { route.lastRunAt = w.time; idleCargos.set(`${route.owner}@${route.from}`, cargos - Math.ceil(stockTotal(load) / B.CARGO_CAPACITY)); }
  }
}

function capture(w: World, systemId: string, by: string): void {
  const st = w.systems[systemId]!;
  const prev = st.owner!;
  if (w.colonies[prev]?.capital === systemId) return; // capitals are never captured
  setOwner(w, systemId, by);
  st.blockade = null;
  st.capturedAt = w.time;
  // A lit Beacon belongs to whoever holds its system: the Renaissance clock restarts for the new holder.
  const lit = w.litBeacons[systemId];
  if (lit && w.rules.beaconFollowsCapture) { lit.by = by; lit.since = w.time; }
  for (const s of st.structures) s.hp = Math.max(1, Math.floor(s.hp * 0.5));
  st.stationHp = Math.min(st.stationHp, 100) || 100;
  st.buildQueue = [];
  st.trainQueue = [];
  st.population *= 0.5;
  for (const r of colonyRelays(w, prev)) if (r.a === systemId || r.b === systemId) removeRelay(w, r.id);
  for (const id of Object.keys(w.routes)) if (w.routes[id]!.from === systemId || w.routes[id]!.to === systemId) delete w.routes[id];
  for (const f of fleetsAt(w, systemId)) if (f.owner === by) { f.order = { kind: 'idle' }; f.pos = null; f.hops = []; }
  const winner = w.colonies[by];
  if (winner) {
    const rid = newId(w, 'R');
    w.routes[rid] = { id: rid, owner: by, from: systemId, to: winner.capital, resource: 'all', perTrip: B.CARGO_CAPACITY * 2, whenBelow: Infinity, active: true, lastRunAt: -1e9 };
  }
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
    const bastions = [relay.a, relay.b].filter((s) => w.systems[s]!.owner === victim.id && hasStructure(w.systems[s]!, 'bastion')).length;
    const p = B.SABOTAGE_BASE_SUCCESS - 0.2 * bastions;
    if (rng.next() < p) {
      relay.cutUntil = w.time + B.RELAY_CUT_HOURS * 3600;
      logEvent(w, 'sabotage.success', [owner.id, victim.id], { relay: relay.id });
    } else {
      owner.influence = Math.max(0, owner.influence - 10);
      logEvent(w, 'sabotage.caught', [owner.id, victim.id], { relay: relay.id });
    }
  } else if (m.mission === 'probe') {
    const layout = layoutOf(w.galaxy, m.target);
    const before = new Set(w.known[owner.id]?.[m.target] ?? []);
    const hidden = layout.pois.filter((p) => p.cover >= 2).map((p) => p.id);
    const found = hidden.filter((id) => !before.has(id));
    (w.known[owner.id] ??= {})[m.target] = hidden;
    owner.influence += found.length * B.PROBE_INFLUENCE_PER_FIND;
    // A first look at a wreck yields a little Crystal to the capital.
    const wrecks = layout.pois.filter((p) => p.kind === 'wreck').length;
    if (wrecks && !w.events.some((e) => e.kind === 'probe.done' && e.actors[0] === owner.id && e.data?.system === m.target)) depositClamped(w, owner.capital, { crystal: B.WRECK_FIRST_CRYSTAL * wrecks });
    logEvent(w, 'probe.done', [owner.id], { system: m.target, found: found.length, template: layout.template });
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
    // Upkeep: each station pays half of its relays' share from its own stock; short stations darken relays.
    const relays = colonyRelays(w, colony.id).filter((r) => relayLive(w, r));
    const total = networkUpkeep(relays);
    const base = relays.reduce((s, r) => s + r.upkeep, 0);
    const scale = base > 0 ? total / base : 1;
    let unpowered = 0;
    const net0 = colonyNetwork(w, colony);
    relays.sort((x, y) => Math.max(net0.get(y.a) ?? 1e9, net0.get(y.b) ?? 1e9) - Math.max(net0.get(x.a) ?? 1e9, net0.get(x.b) ?? 1e9));
    for (const r of relays) {
      const share = (r.upkeep * scale) / 2;
      const sa = w.systems[r.a]!, sb = w.systems[r.b]!;
      const payA = sa.owner === colony.id ? sa : sb, payB = sb.owner === colony.id ? sb : sa;
      const home = w.systems[colony.marketSystem]!;
      if (payA.stock.energy >= share && payB.stock.energy >= share) { payA.stock.energy -= share; payB.stock.energy -= share; }
      else if (payA.stock.energy >= share * 2) payA.stock.energy -= share * 2;
      else if (payB.stock.energy >= share * 2) payB.stock.energy -= share * 2;
      else if (home.stock.energy >= share * 2) home.stock.energy -= share * 2; // the capital covers young outposts
      else { r.cutUntil = Math.max(r.cutUntil, nextDrawAt); unpowered++; }
    }
    if (unpowered) logEvent(w, 'relays.unpowered', [colony.id], { count: unpowered });

    const net = colonyNetwork(w, colony);
    const pace = B.paceMultiplier(w.seasonEndsAt / 86400);
    const produced = B.emptyStock();
    const overflow = B.emptyStock();
    const productive = ownedSystems(w, colony.id).filter((id) => net.has(id));
    for (const id of productive) {
      const sys = w.galaxy.systems[id]!;
      const st = w.systems[id]!;
      if (st.blockade) continue;
      let mult = pace;
      if (drawn.has(sys.band)) mult = pace * (draw.event.kind === 'eruption' && draw.event.band === sys.band ? B.DRAW_ERUPTION_MULT : B.DRAW_MATCH_MULT);
      if (hasStructure(st, 'extractor')) mult *= B.EXTRACTOR_MULT;
      mult *= 1 + B.POP_YIELD_BONUS * st.population;
      const local = B.emptyStock();
      local[sys.resource] += B.BASE_YIELD * sys.baseYield * mult;
      const generic = pace * (id === colony.capital ? B.CAPITAL_GENERIC_YIELD : B.GENERIC_YIELD) * (1 + B.POP_YIELD_BONUS * st.population);
      for (const r of B.RESOURCE_LIST) if (r !== 'rium') local[r] += generic;
      // Rium is never a natural yield: refineries mine it at gas giants, synthesizers make it from stock.
      for (const s of st.structures) {
        if (s.kind !== 'refinery' || s.hp <= 0) continue;
        const mined = B.RIUM_REFINERY_YIELD * (1 + B.POP_YIELD_BONUS * st.population);
        if (s.poi === st.mainPoi) local.rium += mined; // the station is right there
        else w.depots[s.poi] = Math.min(B.DEPOT_CAP, (w.depots[s.poi] ?? 0) + mined); // waits for a cargo
      }
      for (const s of st.structures) {
        if (s.kind !== 'synthesizer' || s.hp <= 0) continue;
        if (st.stock.energy < B.RIUM_SYNTH_MIN_ENERGY + B.RIUM_SYNTH_INPUT.energy || st.stock.food < B.RIUM_SYNTH_INPUT.food) continue;
        st.stock.energy -= B.RIUM_SYNTH_INPUT.energy; st.stock.food -= B.RIUM_SYNTH_INPUT.food; local.rium += B.RIUM_SYNTH_OUTPUT;
      }
      // Population eats locally; fed systems grow.
      const foodNeed = st.population * B.POP_FOOD_PER_UNIT * 20;
      const fed = st.stock.food + local.food >= foodNeed;
      local.food -= Math.min(local.food, foodNeed);
      if (local.food === 0 && st.stock.food < foodNeed - 0) st.stock.food = Math.max(0, st.stock.food - foodNeed);
      st.population = fed ? Math.min(1, st.population + B.POP_GROWTH) : Math.max(0, st.population - 2 * B.POP_GROWTH);
      const lost = depositClamped(w, id, local);
      stockAdd(produced, local);
      stockAdd(overflow, lost);
    }
    colony.lastProduced = produced;
    colony.lastOverflow = overflow;
    payOperations(w, colony);
    for (const r of B.RESOURCE_LIST) colony.avgProduced[r] = w.drawIndex === 0 ? produced[r] : colony.avgProduced[r] * 0.8 + produced[r] * 0.2;
    colony.influence += produced.crystal * B.INFLUENCE_PER_CRYSTAL;
    colony.credits += productive.length * B.CREDITS_PER_SYSTEM_PER_DRAW;
    if (draw.event.kind === 'echo' && net.has(draw.event.beacon)) { depositClamped(w, draw.event.beacon, { crystal: 100 }); logEvent(w, 'echo.bonus', [colony.id]); }
    colony.scoreWindow.push(productive.length);
    if (colony.scoreWindow.length > B.SCORE_WINDOW_DRAWS) colony.scoreWindow.shift();
    // The hourly recap a player reads in the log: what the Draw brought, what was lost, what it cost.
    if (!colony.npc) {
      const round = (st: Stock): Stock => { const o = B.emptyStock(); for (const r of B.RESOURCE_LIST) o[r] = Math.round(st[r]); return o; };
      const drawnMine = productive.filter((id) => drawn.has(w.galaxy.systems[id]!.band)).length;
      logEvent(w, 'draw.recap', [colony.id], { index: draw.index, produced: round(produced), overflow: Math.round(B.RESOURCE_LIST.reduce((s, r) => s + overflow[r], 0)), credits: productive.length * B.CREDITS_PER_SYSTEM_PER_DRAW, productive: productive.length, drawn: drawnMine, unpowered });
    }
    colony.decrees = colony.decrees.filter((d) => d.until > w.time);
  }

  lapseCaptures(w);
  maybeGrowGalaxy(w);
  settleMarkets(w);
  settleBarters(w);
  for (const p of w.proposals.slice()) if (w.time - p.at > 86400) w.proposals.splice(w.proposals.indexOf(p), 1);
  updateTitles(w);
  checkRenaissance(w);
  logEvent(w, 'draw', [], { index: draw.index, bands: draw.bands, event: draw.event });
}

/** Armed fleets deployed outside friendly systems burn Rium from the capital; unpaid, they run dry. */
function payOperations(w: World, colony: Colony): void {
  const home = w.systems[colony.capital]!;
  let dry = 0;
  for (const f of Object.values(w.fleets)) {
    if (f.owner !== colony.id || combatSize(f.units) === 0) continue;
    const here = f.at ? w.systems[f.at]!.owner : null;
    const friendly = f.at !== null && here !== null && (here === colony.id || isAlly(w, here, colony.id));
    if (friendly) { f.dry = false; continue; }
    const cost = combatSize(f.units) * B.RIUM_OPS_PER_SHIP_PER_DRAW;
    if (home.stock.rium >= cost) { home.stock.rium -= cost; f.dry = false; } else { f.dry = true; dry++; }
  }
  if (dry) logEvent(w, 'fleets.dry', [colony.id], { count: dry });
}

/** NPC market maker: a floor and a ceiling in every region where someone trades, so that a stranded
 *  colony can always buy Energy at a premium or dump Metal at a discount (decision 0005). */
function seedMarketMaker(w: World): string[] {
  const regions = new Set<string>();
  for (const c of Object.values(w.colonies)) regions.add(w.galaxy.systems[c.marketSystem]!.region);
  const ids: string[] = [];
  for (const region of regions) for (const resource of B.RESOURCE_LIST) {
    for (const side of ['buy', 'sell'] as const) {
      const id = `${B.MAKER_ID}:${region}:${resource}:${side}`;
      const price = Math.round(B.BASE_PRICE[resource] * (side === 'sell' ? B.MAKER_SELL_MULT : B.MAKER_BUY_MULT) * 100) / 100;
      w.orders[id] = { id, colony: B.MAKER_ID, region, resource, side, qty: B.MAKER_QTY, price, placedAt: w.time };
      ids.push(id);
    }
  }
  return ids;
}

function settleMarkets(w: World): void {
  const makers = seedMarketMaker(w);
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
      if (o.colony === B.MAKER_ID) { o.qty -= f.qty; continue; } // the maker's goods and credits come from nowhere
      const colony = w.colonies[o.colony]!;
      let fee = B.MARKET_FEE;
      if (ownedSystems(w, colony.id).some((s) => hasBuilding(w, s, 'tradepost'))) fee = B.MARKET_FEE_TRADEPOST;
      if (colony.faction === 'guild') fee *= B.GUILD_FEE_MULT;
      if (hasDecree(w, colony, 'freefees')) fee = 0;
      if (o.side === 'buy') {
        depositClamped(w, colony.marketSystem, { [resource]: f.qty });
        colony.credits += f.qty * (o.price - f.price);
        colony.credits -= f.qty * f.price * fee;
      } else {
        colony.credits += f.qty * f.price * (1 - fee);
      }
      volume.set(colony.id, (volume.get(colony.id) ?? 0) + f.qty * f.price);
      o.qty -= f.qty;
      if (o.qty <= 0) delete w.orders[o.id];
    }
  }
  for (const id of makers) delete w.orders[id];
  for (const o of Object.values(w.orders)) {
    const colony = w.colonies[o.colony]!;
    if (o.side === 'sell') depositClamped(w, colony.marketSystem, { [o.resource]: o.qty }); else colony.credits += o.qty * o.price;
    delete w.orders[o.id];
  }
  for (const colony of Object.values(w.colonies)) {
    colony.marketVolume7d.push(volume.get(colony.id) ?? 0);
    if (colony.marketVolume7d.length > 24 * 7) colony.marketVolume7d.shift();
  }
}

/** Accepted barters become two couriers: the goods physically cross the galaxy. */
function settleBarters(w: World): void {
  for (const b of Object.values(w.barters)) {
    const from = w.colonies[b.from], to = w.colonies[b.to];
    const toMs = to ? w.systems[to.marketSystem]! : null;
    if (b.accepted && from && to && toMs && stockHas(toMs.stock, b.want)) {
      stockSub(toMs.stock, b.want);
      courier(w, from, from.marketSystem, to.marketSystem, b.give);
      courier(w, to, to.marketSystem, from.marketSystem, b.want);
      logEvent(w, 'barter.done', [b.from, b.to], { give: b.give, want: b.want });
    } else if (from) {
      depositClamped(w, from.marketSystem, b.give); // refund
    }
    delete w.barters[b.id];
  }
}

/** A neutral courier convoy (interceptable, escortable by nobody) that vanishes on delivery. */
function courier(w: World, owner: Colony, from: string, to: string, cargo: StockDelta): void {
  const units = emptyFleet();
  units.cargo = Math.max(1, Math.ceil(stockTotal(cargo) / B.CARGO_CAPACITY));
  const f = newFleet(w, owner.id, from, units);
  (f as FleetState & { courier?: boolean }).courier = true;
  stockAdd(f.cargo, cargo);
  const res = depart(w, owner, f, to, { kind: 'convoy', to, route: null });
  if (!res.ok) { depositClamped(w, to, cargo); delete w.fleets[f.id]; }
}

function updateTitles(w: World): void {
  let network: string | null = null, netBest = 0;
  let admiralty: string | null = null, fleetBest = 0;
  let exchange: string | null = null, volBest = 0;
  for (const c of Object.values(w.colonies)) {
    const n = productiveSystems(w, c).length;
    if (n > netBest) { netBest = n; network = c.id; }
    const f = Object.values(w.fleets).filter((x) => x.owner === c.id).reduce((s, x) => s + combatSize(x.units), 0);
    if (f > fleetBest) { fleetBest = f; admiralty = c.id; }
    const v = c.marketVolume7d.reduce((s, x) => s + x, 0);
    if (v > volBest) { volBest = v; exchange = c.id; }
  }
  w.titles = { network, admiralty, exchange };
}

/** The bloc (alliance id or colony id) a lit Beacon counts for. */
const blocOf = (w: World, colonyId: string): string => w.colonies[colonyId]?.alliance ?? colonyId;
const blocSize = (w: World, bloc: string): number => w.alliances[bloc]?.members.length ?? 1;

/** Hours of simultaneous hold the Renaissance needs for this bloc: longer for a large coalition. */
export function renaissanceHoldHours(w: World, bloc: string): number {
  const r = w.rules;
  return r.renaissanceHoldHours + r.renaissanceHoldHoursPerMember * Math.max(0, blocSize(w, bloc) - r.renaissanceFreeMembers);
}

/** Earliest sim time at which the Renaissance may end the season. */
export const renaissanceEarliestAt = (w: World): number => w.rules.renaissanceEarliestFraction * w.seasonEndsAt;

/** Beacon Alert: one bloc holds at least `beaconAlertAt` lit Beacons. Public, and its beacon systems fall in half the time. */
function updateBeaconAlert(w: World): void {
  const count = new Map<string, number>();
  for (const b of Object.values(w.litBeacons)) { const k = blocOf(w, b.by); count.set(k, (count.get(k) ?? 0) + 1); }
  let bloc: string | null = null;
  for (const [k, n] of count) if (n >= w.rules.beaconAlertAt) bloc = k;
  if (bloc !== w.beaconAlert) {
    w.beaconAlert = bloc;
    logEvent(w, bloc ? 'beacons.alert' : 'beacons.calm', bloc ? [bloc] : [], { beacons: bloc ? count.get(bloc) : 0 });
  }
}

/** Hours of unbroken blockade before capture: halved on a Beacon system of the bloc under Beacon Alert. */
export function captureHours(w: World, systemId: string): number {
  const st = w.systems[systemId]!;
  const lit = w.litBeacons[systemId];
  if (w.beaconAlert && lit && st.owner && blocOf(w, st.owner) === w.beaconAlert) return B.BLOCKADE_CAPTURE_HOURS / 2;
  return B.BLOCKADE_CAPTURE_HOURS;
}

function checkRenaissance(w: World): void {
  updateBeaconAlert(w);
  if (Object.keys(w.litBeacons).length < w.galaxy.beacons.length) return;
  const holders = new Set(Object.values(w.litBeacons).map((b) => blocOf(w, b.by)));
  if (holders.size !== 1) return;
  const bloc = [...holders][0]!;
  const since = Math.max(...Object.values(w.litBeacons).map((b) => b.since));
  if (w.time < renaissanceEarliestAt(w)) return; // the Beacons burn, the season goes on: the floor date protects everyone else
  if (w.time - since >= renaissanceHoldHours(w, bloc) * 3600) endSeason(w, 'renaissance');
}

/** A captured system its captor never connected falls neutral after the grace period (REVIEW-S0 § 5). */
function lapseCaptures(w: World): void {
  const grace = w.rules.captureGraceHours * 3600;
  if (grace <= 0) return;
  const nets = new Map<string, Map<string, number>>();
  for (const [id, st] of Object.entries(w.systems)) {
    if (st.capturedAt === undefined || !st.owner) { if (st.capturedAt !== undefined && !st.owner) delete st.capturedAt; continue; }
    const c = w.colonies[st.owner];
    if (!c) continue;
    let net = nets.get(c.id);
    if (!net) { net = colonyNetwork(w, c); nets.set(c.id, net); }
    if (net.has(id)) { delete st.capturedAt; continue; }
    if (w.time - st.capturedAt >= grace) {
      const prev = st.owner;
      setOwner(w, id, null);
      st.blockade = null;
      delete st.capturedAt;
      for (const r of colonyRelays(w, prev)) if (r.a === id || r.b === id) removeRelay(w, r.id);
      logEvent(w, 'system.lapsed', [prev], { system: id });
    }
  }
}

/** The galaxy grows a ring when the rim fills up (REVIEW-S0 § 4): existing sectors are untouched, new ones open for newcomers. */
function maybeGrowGalaxy(w: World): void {
  const g = w.rules.galaxyGrowth;
  if (!g.enabled || w.galaxy.radius >= g.maxRadius) return;
  const rimMin = Math.max(0, w.galaxy.radius - 2);
  const rim = Object.values(w.galaxy.sectors).filter((s) => s.ring >= rimMin);
  const occupied = rim.filter((s) => s.systems.some((id) => { const o = w.systems[id]!.owner; return o !== null && w.colonies[o]?.capital === id; })).length;
  if (occupied / Math.max(1, rim.length) < g.rimOccupancy) return;
  const next = expandGalaxy(w.galaxy, w.galaxyOptions);
  for (const id of Object.keys(next.systems)) if (!w.systems[id]) { w.systems[id] = emptySystem(); w.systems[id]!.mainPoi = layoutOf(next, id).main; }
  w.galaxy = next;
  w.galaxyOptions = { ...w.galaxyOptions, radius: next.radius };
  logEvent(w, 'galaxy.expanded', [], { radius: next.radius });
}

/** The band of the next Draw the Oracles know ahead of time, or null outside their window (or when the perk is off). */
export function nextDrawHint(w: World): number | null {
  if (w.rules.oracleHintMinutes <= 0) return null;
  const nextDrawAt = (Math.floor(w.time / 3600) + 1) * 3600;
  if (nextDrawAt - w.time > w.rules.oracleHintMinutes * 60) return null;
  const regions = [...new Set(Object.values(w.galaxy.sectors).map((s) => s.region))].sort();
  const next = rollDraw({ seasonSeed: w.seed, index: w.drawIndex + 1, previous: w.lastDraw ?? undefined, regions, beacons: w.galaxy.beacons });
  return oracleHint(w.seed, next);
}

function endSeason(w: World, reason: 'silence' | 'renaissance'): void {
  if (w.ended) return;
  let winner: string | null = null, best = -1;
  for (const a of Object.values(w.alliances)) { const s = allianceScore(w, a.id); if (s > best) { best = s; winner = a.id; } }
  for (const c of Object.values(w.colonies)) { if (c.alliance) continue; const s = colonyScore(w, c); if (s > best) { best = s; winner = c.id; } }
  w.ended = { at: w.time, reason, winner };
  logEvent(w, 'season.ended', winner ? [winner] : [], { reason });
}

// Exposed for the General and tests.
export { continueConvoy, sendConvoy, loot, depart };
