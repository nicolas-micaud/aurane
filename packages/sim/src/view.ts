// What one colony is allowed to see. The server sends nothing else; fog of war is enforced
// here, not in the client.
import type { Building, Fleet, Orbit, Resource, Stock, UnitType } from '@aurane/protocol';
import type { Circle } from './geometry.js';
import type { Draw } from './draw.js';
import type { Colony, FleetOrder, LitBeacon, PlateauPos, World } from './state.js';
import { combatSize, fleetSize } from './state.js';
import { isAlly } from './diplomacy.js';
import { colonyNetwork, colonyScore, colonyStockTotal, findBridgesFor, hiddenFrom, isShielded, isWatching, nextDrawHint, ownedSystems, rangeContext, reachableRegions, routeLimit, visibleSectors } from './world.js';
import { layoutOf } from './pois.js';
import { linkOptions } from './network.js';
import { regionName } from './galaxy.js';
import { capacityOf, orbitSlots } from './structures.js';
import { fleetHpFraction } from './battle.js';
import * as B from './balance.js';

export interface StructureView { id: string; kind: Building; orbit: Orbit; angle: number; hp: number; maxHp: number }
export interface SystemView {
  id: string; name: string; x: number; y: number; sector: string; region: string;
  kind: 'normal' | 'pulsar' | 'beacon'; resource: Resource; band: number; slots: number; hue: number;
  owner: string | null; connected: boolean;
  /** Kinds only (compat); null when not visible in detail. */
  buildings: Building[] | null;
  structures: StructureView[] | null;
  /** Station hit points (max STATION_HP); null when unowned or unseen. */
  stationHp: number | null;
  stock: Stock | null; capacity: number | null;
  population: number | null;
  blockadedBy: string | null; engaged: boolean; lit: LitBeacon | null; beaconName?: string;
  /** Slots of the main point of interest. */
  orbitSlots: [number, number, number];
  /** Points of interest in the system (bodies only, jump points excluded) and its template. */
  pois: number; template: string;
  /** Someone lives here behind cover: probe to learn who. */
  signature: boolean;
  buildQueue: { building: Building; orbit: Orbit; readyAt: number }[] | null;
  trainQueue: { unit: UnitType; count: number; readyAt: number }[] | null;
}
export interface RelayView { id: string; a: string; b: string; owner: string; ready: boolean; cut: boolean; readyAt: number; cutUntil: number; bridge: boolean }
export interface FleetView {
  id: string; owner: string; at: string | null; from: string | null; destination: string | null; path: string[];
  departAt: number; arriveAt: number; units: Fleet | null; size: number; combat: number; order: string;
  orderTarget: string | null; pos: PlateauPos | null; hp: number; cargo: Stock | null; focus: string | null;
}
export interface RouteView { id: string; from: string; to: string; resource: Resource | 'all'; perTrip: number; whenBelow: number; active: boolean; lastRunAt: number }
export interface BattleView { id: string; system: string; startedAt: number; endedAt: number | null; sides: string[]; events: World['battles'][string]['events'] }
export interface SectorView { key: string; q: number; r: number; region: string; origin: { x: number; y: number }; nebulae: Circle[]; blackHoles: Circle[] }
export interface ColonyView {
  id: string; name: string; faction: string; persona: string; alliance: string | null; allianceName: string | null;
  capital: string; score: number; shielded: boolean; npc: boolean; ally: boolean;
}

export interface PlayerView {
  galaxyRadius: number;
  /** Simulated seconds per real second (1 in production). */
  timeScale: number;
  time: number;
  nextDrawAt: number;
  seasonEndsAt: number;
  me: {
    id: string; name: string; faction: string; persona: string; capital: string; marketSystem: string;
    /** Sum of every system's warehouse. */
    stock: Stock; credits: number; influence: number;
    watchStartHour: number; watching: boolean; shielded: boolean; score: number; connectedCount: number;
    /** The General's journal, newest last, and the decrees in force. */
    journal: Colony['journal']; decrees: Colony['decrees'];
    /** Oracles only: one band of the next Draw, known inside their window; null otherwise. */
    oracleBand: number | null;
    /** Progressive onboarding tier; the client hides what is not open yet. */
    onboarding: Colony['onboarding'];
    alliance: string | null; policy: Colony['policy']; regions: { key: string; name: string }[]; lastProduced: Stock; lastOverflow: Stock;
    routeLimit: number;
  };
  draw: Draw | null;
  /** For each connected system: ids it could link to right now, with the metal cost. */
  linkTargets: Record<string, { to: string; metal: number; energy: number }[]>;
  sectors: SectorView[];
  systems: SystemView[];
  relays: RelayView[];
  fleets: FleetView[];
  routes: RouteView[];
  battles: BattleView[];
  colonies: ColonyView[];
  orders: { id: string; region: string; resource: Resource; side: 'buy' | 'sell'; qty: number; price: number }[];
  barters: { id: string; from: string; to: string; give: Partial<Stock>; want: Partial<Stock>; accepted: boolean }[];
  clearing: World['lastClearing'];
  treaties: { id: string; with: string; kind: string; until: number | null }[];
  proposals: { from: string; to: string; kind: string }[];
  invites: { alliance: string; name: string }[];
  titles: World['titles'];
  events: World['events'];
  ended: World['ended'];
}

const orderTarget = (o: FleetOrder): string | null => {
  switch (o.kind) {
    case 'move': return o.to;
    case 'raid': return o.via;
    case 'blockade': case 'defend': case 'ambush': return o.system;
    case 'convoy': return o.to;
    default: return null;
  }
};

export function viewFor(w: World, colony: Colony, timeScale = 1): PlayerView {
  const visible = visibleSectors(w, colony);
  const net = colonyNetwork(w, colony);
  const bridges = findBridgesFor(w, colony.id);
  const sectors: SectorView[] = [];
  const systems: SystemView[] = [];
  const visibleSystems = new Set<string>();
  for (const key of visible) {
    const s = w.galaxy.sectors[key]!;
    sectors.push({ key, q: s.hex.q, r: s.hex.r, region: s.region, origin: s.origin, nebulae: s.nebulae, blackHoles: s.blackHoles });
    for (const id of s.systems) {
      visibleSystems.add(id);
      const sys = w.galaxy.systems[id]!;
      const st = w.systems[id]!;
      const mineOrAlly = st.owner !== null && (st.owner === colony.id || isAlly(w, colony.id, st.owner));
      const hidden = hiddenFrom(w, colony.id, id);
      // Anyone in the sector sees the structures (they are big); only owners/allies see stocks and queues. A lair shows nothing.
      const seen = st.owner !== null && !hidden;
      const layout = layoutOf(w.galaxy, id);
      const v: SystemView = {
        id, name: sys.name, x: sys.x, y: sys.y, sector: sys.sector, region: sys.region, kind: sys.kind, resource: sys.resource,
        band: sys.band, slots: sys.slots, hue: sys.hue, owner: hidden ? null : st.owner, connected: net.has(id),
        buildings: seen ? st.structures.map((x) => x.kind) : null,
        structures: seen ? st.structures.map((x) => ({ id: x.id, kind: x.kind, orbit: x.orbit, angle: x.angle, hp: x.hp, maxHp: B.STRUCTURE_HP[x.kind] })) : null,
        stationHp: seen ? st.stationHp : null,
        stock: mineOrAlly ? st.stock : null, capacity: mineOrAlly ? capacityOf(w, id) : null,
        population: mineOrAlly ? st.population : null, blockadedBy: hidden ? null : st.blockade?.by ?? null, engaged: st.engaged && !hidden, lit: w.litBeacons[id] ?? null,
        orbitSlots: (() => { const o = orbitSlots(w, sys); return [o[1], o[2], o[3]] as [number, number, number]; })(),
        pois: layout.pois.filter((p) => p.kind !== 'jump').length, template: layout.template, signature: hidden,
        buildQueue: mineOrAlly ? st.buildQueue : null, trainQueue: mineOrAlly ? st.trainQueue : null,
      };
      if (sys.beaconName) v.beaconName = sys.beaconName;
      systems.push(v);
    }
  }
  const relays: RelayView[] = [];
  for (const r of Object.values(w.relays)) {
    if (!visibleSystems.has(r.a) && !visibleSystems.has(r.b)) continue;
    relays.push({ id: r.id, a: r.a, b: r.b, owner: r.owner, ready: r.readyAt <= w.time, cut: r.cutUntil > w.time, readyAt: r.readyAt, cutUntil: r.cutUntil, bridge: bridges.has(r.id) });
  }
  const fleets: FleetView[] = [];
  for (const f of Object.values(w.fleets)) {
    const mine = f.owner === colony.id || isAlly(w, colony.id, f.owner);
    const at = f.at ?? f.destination;
    if (!mine && (!at || !visibleSystems.has(at))) continue;
    // Docked foreign fleets (pos null at a system) are invisible: they sit inside the station.
    if (!mine && f.at !== null && f.pos === null) continue;
    if (!mine && f.at !== null && hiddenFrom(w, colony.id, f.at)) continue;
    fleets.push({
      id: f.id, owner: f.owner, at: f.at, from: f.from, destination: f.destination, path: mine ? f.path : [], departAt: f.departAt, arriveAt: f.arriveAt,
      units: mine ? f.units : null, size: fleetSize(f.units), combat: combatSize(f.units), order: mine ? f.order.kind : f.order.kind === 'convoy' ? 'convoy' : 'fleet',
      orderTarget: mine ? orderTarget(f.order) : null, pos: f.pos, hp: Math.round(fleetHpFraction(f) * 100) / 100, cargo: mine ? f.cargo : null, focus: mine ? f.focus : null,
    });
  }
  const colonies: ColonyView[] = Object.values(w.colonies).map((c) => ({
    id: c.id, name: c.name, faction: c.faction, persona: c.persona, alliance: c.alliance,
    allianceName: c.alliance ? w.alliances[c.alliance]?.name ?? null : null, capital: c.capital,
    score: Math.round(colonyScore(w, c) * 10) / 10, shielded: isShielded(w, c), npc: c.npc, ally: isAlly(w, colony.id, c.id),
  }));
  const rctx = rangeContext(w, colony);
  const linkTargets: PlayerView['linkTargets'] = {};
  for (const id of net.keys()) {
    const sys = w.galaxy.systems[id]!;
    linkTargets[id] = linkOptions(w.galaxy, sys, rctx)
      .filter((o) => { const st = w.systems[o.to.id]!; return !net.has(o.to.id) && (!st.owner || st.owner === colony.id || isAlly(w, colony.id, st.owner)) && !w.relays[`${[id, o.to.id].sort().join('|')}`]; })
      .map((o) => ({ to: o.to.id, metal: o.verdict.cost.metal, energy: o.verdict.cost.energy }));
  }
  const nextDrawAt = (Math.floor(w.time / 3600) + 1) * 3600;
  const owned = new Set(ownedSystems(w, colony.id));
  const battles = Object.values(w.battles)
    .filter((b) => b.sides.includes(colony.id) || owned.has(b.system))
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, 20)
    .map((b) => ({ id: b.id, system: b.system, startedAt: b.startedAt, endedAt: b.endedAt, sides: b.sides, events: b.events.slice(-80) }));
  return {
    galaxyRadius: w.galaxy.radius, timeScale, time: w.time, nextDrawAt, seasonEndsAt: w.seasonEndsAt,
    me: {
      id: colony.id, name: colony.name, faction: colony.faction, persona: colony.persona, capital: colony.capital, marketSystem: colony.marketSystem,
      stock: colonyStockTotal(w, colony.id), credits: colony.credits, influence: colony.influence, watchStartHour: colony.watchStartHour,
      watching: isWatching(w, colony), shielded: isShielded(w, colony), score: colonyScore(w, colony),
      connectedCount: ownedSystems(w, colony.id).filter((id) => net.has(id)).length, alliance: colony.alliance,
      policy: colony.policy, regions: [...reachableRegions(w, colony)].map((key) => ({ key, name: regionName(key) })), lastProduced: colony.lastProduced,
      lastOverflow: colony.lastOverflow, routeLimit: routeLimit(w, colony), journal: colony.journal, decrees: colony.decrees.filter((d) => d.until > w.time),
      oracleBand: colony.faction === 'oracles' ? nextDrawHint(w) : null,
      onboarding: colony.onboarding,
    },
    draw: w.lastDraw, linkTargets, sectors, systems, relays, fleets, colonies,
    routes: Object.values(w.routes).filter((r) => r.owner === colony.id).map((r) => ({ id: r.id, from: r.from, to: r.to, resource: r.resource, perTrip: r.perTrip, whenBelow: r.whenBelow, active: r.active, lastRunAt: r.lastRunAt })),
    battles,
    orders: Object.values(w.orders).filter((o) => o.colony === colony.id).map((o) => ({ id: o.id, region: o.region, resource: o.resource, side: o.side, qty: o.qty, price: o.price })),
    barters: Object.values(w.barters).filter((b) => b.from === colony.id || b.to === colony.id).map((b) => ({ id: b.id, from: b.from, to: b.to, give: b.give as Partial<Stock>, want: b.want as Partial<Stock>, accepted: b.accepted })),
    clearing: w.lastClearing,
    treaties: Object.values(w.treaties).filter((t) => t.a === colony.id || t.b === colony.id).map((t) => ({ id: t.id, with: t.a === colony.id ? t.b : t.a, kind: t.kind, until: t.until })),
    proposals: w.proposals.filter((p) => p.to === colony.id || p.from === colony.id).map((p) => ({ from: p.from, to: p.to, kind: p.kind })),
    invites: Object.values(w.alliances).filter((a) => a.invites.includes(colony.id)).map((a) => ({ alliance: a.id, name: a.name })),
    titles: w.titles,
    events: w.events.filter((e) => e.actors.includes(colony.id) || e.kind === 'draw' || e.kind === 'season.ended').slice(-80),
    ended: w.ended,
  };
}
