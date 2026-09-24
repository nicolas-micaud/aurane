// The System view: a small map of points of interest joined by lanes, each with its own
// plateau, streamed at 2 Hz to whoever is looking at it; and the battle reports built from
// the salvo log. Fog of war: the sector must be visible; covered points of interest need a
// presence or a probe; stocks, queues, docked fleets and routes are for the owner and allies.
// The flat fields (structures, fleets, station...) describe the main point of interest, for
// clients that show one plateau at a time.
import type { Building, Fleet, Orbit, Resource, Stock, UnitType } from '@aurane/protocol';
import { COMBAT_UNITS } from '@aurane/protocol';
import * as B from './balance.js';
import { STATION_POS, fleetHpFraction } from './battle.js';
import { isAlly } from './diplomacy.js';
import { layoutOf, type Lane, type PoiKind, type Template } from './pois.js';
import type { BattleLog, Colony, FleetState, PlateauPos, World } from './state.js';
import { combatSize, fleetSize } from './state.js';
import { capacityOf, orbitSlots } from './structures.js';
import { colonyNetwork, hiddenFrom, knownPois, ownedSystems, visibleSectors } from './world.js';

export interface PlateauFleetView {
  id: string; owner: string; units: Fleet | null; size: number; combat: number; hp: number;
  pos: PlateauPos | null; order: string; focus: string | null; cargo: Stock | null; docked: boolean;
  /** Point of interest the fleet sits at, or null while on a lane. */
  poi: string | null;
  /** Lane travel inside the system: from → to with progress 0..1 at `time`. */
  hop: { from: string; to: string; departAt: number; arriveAt: number } | null;
}
export interface InboundView { id: string; owner: string; from: string | null; arriveAt: number; departAt: number; size: number; order: string; convoy: boolean }
export interface StructureDetailView { id: string; kind: Building; poi: string; orbit: Orbit; angle: number; hp: number; maxHp: number; armed: boolean; range: number | null }
export interface PoiView {
  id: string; kind: PoiKind; designation: string; x: number; y: number; size: 1 | 2 | 3; cover: 0 | 1 | 2 | 3; hue: number; parent?: string;
  /** False when the point of interest is covered and unprobed: only its position on the map is known... */
  known: boolean;
  main: boolean;
  orbitSlots: [number, number, number];
  structures: StructureDetailView[];
  station: { pos: PlateauPos; hp: number; maxHp: number } | null;
  engaged: boolean;
  shield: { active: boolean; fraction: number } | null;
  battle: { id: string; startedAt: number; sides: string[]; kills: Record<string, number> } | null;
  /** Wrecks: what remains to salvage, 0..1. */
  salvage: number | null;
  /** Refinery depot: Rium waiting for a cargo (owner and allies only). */
  depot: number | null;
}

export interface SystemDetailView {
  id: string; name: string; kind: 'normal' | 'pulsar' | 'beacon'; resource: Resource; band: number; hue: number; sector: string; region: string;
  time: number;
  owner: string | null; ownerName: string | null; mine: boolean; allied: boolean; connected: boolean;
  visible: boolean;                       // false → only the header fields above are filled
  /** The system's map: points of interest, lanes, main body and jump points. */
  template: Template;
  pois: PoiView[];
  lanes: Lane[];
  mainPoi: string;
  jumps: string[];
  /** Someone lives here behind cover (their main body is unprobed). */
  signature: boolean;
  plateauRadius: number;
  // --- main point of interest, flattened -------------------------------------------------
  station: { pos: PlateauPos; hp: number; maxHp: number } | null;
  orbitSlots: [number, number, number];
  structures: StructureDetailView[];
  stock: Stock | null; capacity: number | null; population: number | null;
  buildQueue: { building: Building; orbit: Orbit; readyAt: number; poi: string }[] | null;
  trainQueue: { unit: UnitType; count: number; readyAt: number }[] | null;
  fleets: PlateauFleetView[];
  inbound: InboundView[];
  routes: { id: string; from: string; to: string; resource: Resource | 'all'; perTrip: number; whenBelow: number; active: boolean }[];
  blockade: { by: string; since: number; captureAt: number } | null;
  engaged: boolean;
  battle: { id: string; startedAt: number; sides: string[]; kills: Record<string, number> } | null;
  shield: { active: boolean; fraction: number } | null;
}

const orderName = (o: FleetState['order']): string => o.kind;

export function systemViewFor(w: World, colony: Colony, systemId: string): SystemDetailView | null {
  const sys = w.galaxy.systems[systemId];
  const st = w.systems[systemId];
  if (!sys || !st) return null;
  const layout = layoutOf(w.galaxy, systemId);
  const visible = visibleSectors(w, colony).has(sys.sector) || st.owner === colony.id;
  const hidden = hiddenFrom(w, colony.id, systemId);
  const mine = st.owner === colony.id;
  const allied = st.owner !== null && !mine && isAlly(w, colony.id, st.owner);
  const detail = mine || allied;
  const known = knownPois(w, colony.id, systemId);
  const slotsOf = (poi: string): [number, number, number] => { const o = orbitSlots(w, sys, poi); return [o[1], o[2], o[3]]; };
  const base: SystemDetailView = {
    id: sys.id, name: sys.name, kind: sys.kind, resource: sys.resource, band: sys.band, hue: sys.hue, sector: sys.sector, region: sys.region,
    time: w.time, owner: hidden ? null : st.owner, ownerName: hidden ? null : st.owner ? w.colonies[st.owner]?.name ?? null : null, mine, allied,
    connected: colonyNetwork(w, colony).has(systemId), visible,
    template: layout.template, pois: [], lanes: layout.lanes, mainPoi: st.mainPoi, jumps: layout.jumps, signature: hidden, plateauRadius: B.PLATEAU_RADIUS,
    station: null, orbitSlots: slotsOf(st.mainPoi), structures: [], stock: null, capacity: null, population: null,
    buildQueue: null, trainQueue: null, fleets: [], inbound: [], routes: [], blockade: null, engaged: false, battle: null, shield: null,
  };
  // The geometry is public knowledge once the sector is visible; what stands there is not.
  base.pois = layout.pois.map((p) => ({
    id: p.id, kind: p.kind, designation: p.designation, x: p.x, y: p.y, size: p.size, cover: p.cover, hue: p.hue, ...(p.parent ? { parent: p.parent } : {}),
    known: known.has(p.id), main: p.id === st.mainPoi && !hidden, orbitSlots: slotsOf(p.id), structures: [], station: null, engaged: false, shield: null, battle: null,
    salvage: p.kind === 'wreck' && known.has(p.id) ? w.salvage[p.id] ?? 1 : null,
    depot: detail && (w.depots[p.id] ?? 0) > 0 ? Math.round(w.depots[p.id]!) : null,
  }));
  if (!visible) return base;

  const owner = st.owner ? w.colonies[st.owner] : undefined;
  const watch = owner ? ((Math.floor(w.time / 3600) % 24) - owner.watchStartHour + 24) % 24 < B.WATCH_HOURS : false;
  const structView = (s: (typeof st.structures)[number]): StructureDetailView => {
    const t = B.TURRET_STATS[s.kind];
    return { id: s.id, kind: s.kind, poi: s.poi, orbit: s.orbit, angle: s.angle, hp: s.hp, maxHp: B.STRUCTURE_HP[s.kind], armed: !!t, range: t ? t.range : s.kind === 'bastion' ? B.BASTION_RANGE : null };
  };
  for (const pv of base.pois) {
    if (!pv.known || hidden) continue;
    pv.structures = st.structures.filter((s) => s.poi === pv.id).map(structView);
    pv.station = st.owner && pv.id === st.mainPoi ? { pos: STATION_POS, hp: st.stationHp, maxHp: B.STATION_HP } : null;
    pv.engaged = st.engagedPois.includes(pv.id);
    const bastion = st.structures.some((s) => s.kind === 'bastion' && s.hp > 0 && s.poi === pv.id);
    pv.shield = st.owner && bastion ? { active: true, fraction: watch ? B.BASTION_SHIELD_WATCH : B.BASTION_SHIELD } : null;
    const live = Object.values(w.battles).find((b) => b.system === systemId && b.poi === pv.id && b.endedAt === null);
    if (live) pv.battle = { id: live.id, startedAt: live.startedAt, sides: live.sides, kills: killsBySide(live) };
  }
  const main = base.pois.find((p) => p.id === st.mainPoi);
  if (main && !hidden) {
    base.station = main.station; base.structures = main.structures; base.shield = main.shield; base.battle = main.battle;
    base.engaged = st.engaged;
    base.blockade = st.blockade ? { by: st.blockade.by, since: st.blockade.since, captureAt: st.blockade.since + B.BLOCKADE_CAPTURE_HOURS * 3600 } : null;
  }
  if (detail) {
    base.stock = st.stock; base.capacity = capacityOf(w, systemId); base.population = st.population;
    base.buildQueue = st.buildQueue; base.trainQueue = st.trainQueue;
    base.routes = Object.values(w.routes).filter((r) => r.owner === colony.id && (r.from === systemId || r.to === systemId))
      .map((r) => ({ id: r.id, from: r.from, to: r.to, resource: r.resource, perTrip: r.perTrip, whenBelow: r.whenBelow, active: r.active }));
  }
  for (const f of Object.values(w.fleets)) {
    const friend = f.owner === colony.id || isAlly(w, colony.id, f.owner);
    if (f.at === systemId) {
      if (!friend && (f.pos === null || hidden)) continue; // docked inside the station, or a lair: out of sight
      if (!friend && f.poi && !known.has(f.poi)) continue;
      base.fleets.push({
        id: f.id, owner: f.owner, units: friend ? f.units : null, size: fleetSize(f.units), combat: combatSize(f.units),
        hp: Math.round(fleetHpFraction(f) * 100) / 100, pos: f.pos, order: friend ? orderName(f.order) : f.units.cargo > 0 && combatSize(f.units) === 0 ? 'convoy' : 'fleet',
        focus: friend ? f.focus : null, cargo: friend ? f.cargo : null, docked: f.pos === null && f.poi !== null, poi: f.poi, hop: f.hop,
      });
    } else if (f.at === null && f.destination === systemId && (friend || (f.from !== null && visibleSectors(w, colony).has(w.galaxy.systems[f.from]!.sector)))) {
      base.inbound.push({ id: f.id, owner: f.owner, from: f.from, arriveAt: f.arriveAt, departAt: f.departAt, size: fleetSize(f.units), order: friend ? orderName(f.order) : 'fleet', convoy: f.units.cargo > 0 });
    }
  }
  base.inbound.sort((a, b) => a.arriveAt - b.arriveAt);
  return base;
}

function killsBySide(b: BattleLog): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of b.events) if (e.kind === 'kill') out[e.who] = (out[e.who] ?? 0) + (e.amount ?? 0);
  return out;
}

export interface BattleReport {
  id: string; system: string; systemName: string; poi: string; startedAt: number; endedAt: number | null; seconds: number;
  sides: { id: string; name: string; defender: boolean; kills: Record<UnitType, number>; losses: Record<UnitType, number>; structuresDestroyed: string[]; stationDown: boolean }[];
  /** Who held the plateau when it ended: the system owner if hostiles were gone, else the strongest attacker. */
  outcome: 'held' | 'lost' | 'ongoing' | 'skirmish';
  timeline: { at: number; kind: string; who: string; what: string; amount?: number; target?: string }[];
}

const emptyCount = (): Record<UnitType, number> => ({ corvette: 0, frigate: 0, cruiser: 0, cargo: 0 });

/** A readable, chronological account of one engagement; null when the colony has no business seeing it. */
export function battleReport(w: World, colony: Colony, battleId: string): BattleReport | null {
  const b = w.battles[battleId];
  if (!b) return null;
  const st = w.systems[b.system]!;
  const involved = b.sides.includes(colony.id) || st.owner === colony.id || b.sides.some((s) => isAlly(w, colony.id, s));
  if (!involved) return null;
  const defenderId = b.sides[0] ?? null; // startEngagement puts the system owner first
  const sides = b.sides.map((id) => ({ id, name: w.colonies[id]?.name ?? id, defender: id === defenderId && st.owner === id, kills: emptyCount(), losses: emptyCount(), structuresDestroyed: [] as string[], stationDown: false }));
  const byId = new Map(sides.map((s) => [s.id, s]));
  for (const e of b.events) {
    const who = byId.get(e.who), target = e.target ? byId.get(e.target) : undefined;
    if (e.kind === 'kill') { const u = e.what as UnitType; if (who) who.kills[u] += e.amount ?? 0; if (target) target.losses[u] += e.amount ?? 0; }
    else if (e.kind === 'destroyed' && target) target.structuresDestroyed.push(e.what);
    else if (e.kind === 'station.down' && target) target.stationDown = true;
  }
  const seconds = (b.endedAt ?? w.time) - b.startedAt;
  let outcome: BattleReport['outcome'] = 'ongoing';
  if (b.endedAt !== null) {
    if (!defenderId || st.owner !== defenderId) outcome = 'lost';
    else {
      const attackersLeft = Object.values(w.fleets).some((f) => f.at === b.system && f.poi === b.poi && f.pos !== null && f.owner !== defenderId && combatSize(f.units) > 0);
      outcome = attackersLeft || (st.blockade && b.poi === st.mainPoi) ? 'lost' : b.events.some((e) => e.kind === 'kill' || e.kind === 'destroyed' || e.kind === 'station.down') ? 'held' : 'skirmish';
    }
  }
  return { id: b.id, system: b.system, systemName: w.galaxy.systems[b.system]?.name ?? b.system, poi: b.poi, startedAt: b.startedAt, endedAt: b.endedAt, seconds, sides, outcome, timeline: b.events.slice(-400) };
}

/** Recent engagements this colony may read, newest first. */
export function battleList(w: World, colony: Colony, limit = 30): { id: string; system: string; systemName: string; poi: string; startedAt: number; endedAt: number | null; sides: string[]; kills: number }[] {
  const owned = new Set(ownedSystems(w, colony.id));
  return Object.values(w.battles)
    .filter((b) => b.sides.includes(colony.id) || owned.has(b.system))
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
    .map((b) => ({ id: b.id, system: b.system, systemName: w.galaxy.systems[b.system]?.name ?? b.system, poi: b.poi, startedAt: b.startedAt, endedAt: b.endedAt, sides: b.sides, kills: b.events.filter((e) => e.kind === 'kill').reduce((s, e) => s + (e.amount ?? 0), 0) }));
}

export const _sysview = { COMBAT_UNITS };
