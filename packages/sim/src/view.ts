// What one colony is allowed to see. The server sends nothing else; fog of war is enforced
// here, not in the client.
import type { Building, Fleet, Resource, Stock } from '@aurane/protocol';
import type { Circle } from './geometry.js';
import type { Draw } from './draw.js';
import type { Colony, LitBeacon, World } from './state.js';
import { fleetSize } from './state.js';
import { isAlly } from './diplomacy.js';
import { colonyNetwork, colonyScore, findBridgesFor, isShielded, isWatching, ownedSystems, reachableRegions, visibleSectors } from './world.js';

export interface SystemView {
  id: string; name: string; x: number; y: number; sector: string; region: string;
  kind: 'normal' | 'pulsar' | 'beacon'; resource: Resource; band: number; slots: number; hue: number;
  owner: string | null; connected: boolean; buildings: Building[] | null; population: number | null;
  blockadedBy: string | null; lit: LitBeacon | null; beaconName?: string;
}
export interface RelayView { id: string; a: string; b: string; owner: string; ready: boolean; cut: boolean; readyAt: number; cutUntil: number; bridge: boolean }
export interface FleetView { id: string; owner: string; at: string | null; destination: string | null; arriveAt: number; units: Fleet | null; size: number; order: string }
export interface SectorView { key: string; q: number; r: number; region: string; origin: { x: number; y: number }; nebulae: Circle[]; blackHoles: Circle[] }
export interface ColonyView {
  id: string; name: string; faction: string; persona: string; alliance: string | null; allianceName: string | null;
  capital: string; score: number; shielded: boolean; npc: boolean; ally: boolean;
}

export interface PlayerView {
  time: number;
  nextDrawAt: number;
  seasonEndsAt: number;
  me: {
    id: string; name: string; faction: string; persona: string; capital: string; stock: Stock; credits: number; influence: number;
    watchStartHour: number; watching: boolean; shielded: boolean; score: number; connectedCount: number;
    alliance: string | null; policy: Colony['policy']; regions: string[]; lastProduced: Stock;
  };
  draw: Draw | null;
  sectors: SectorView[];
  systems: SystemView[];
  relays: RelayView[];
  fleets: FleetView[];
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

export function viewFor(w: World, colony: Colony): PlayerView {
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
      const v: SystemView = {
        id, name: sys.name, x: sys.x, y: sys.y, sector: sys.sector, region: sys.region, kind: sys.kind, resource: sys.resource,
        band: sys.band, slots: sys.slots, hue: sys.hue, owner: st.owner, connected: net.has(id),
        buildings: mineOrAlly ? st.buildings : st.buildings.length ? st.buildings.map(() => 'extractor' as Building).slice(0, 0) : null,
        population: mineOrAlly ? st.population : null, blockadedBy: st.blockade?.by ?? null, lit: w.litBeacons[id] ?? null,
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
    fleets.push({ id: f.id, owner: f.owner, at: f.at, destination: f.destination, arriveAt: f.arriveAt, units: mine ? f.units : null, size: fleetSize(f.units), order: f.order.kind });
  }
  const colonies: ColonyView[] = Object.values(w.colonies).map((c) => ({
    id: c.id, name: c.name, faction: c.faction, persona: c.persona, alliance: c.alliance,
    allianceName: c.alliance ? w.alliances[c.alliance]?.name ?? null : null, capital: c.capital,
    score: Math.round(colonyScore(w, c) * 10) / 10, shielded: isShielded(w, c), npc: c.npc, ally: isAlly(w, colony.id, c.id),
  }));
  const nextDrawAt = (Math.floor(w.time / 3600) + 1) * 3600;
  return {
    time: w.time, nextDrawAt, seasonEndsAt: w.seasonEndsAt,
    me: {
      id: colony.id, name: colony.name, faction: colony.faction, persona: colony.persona, capital: colony.capital,
      stock: colony.stock, credits: colony.credits, influence: colony.influence, watchStartHour: colony.watchStartHour,
      watching: isWatching(w, colony), shielded: isShielded(w, colony), score: colonyScore(w, colony),
      connectedCount: ownedSystems(w, colony.id).filter((id) => net.has(id)).length, alliance: colony.alliance,
      policy: colony.policy, regions: [...reachableRegions(w, colony)], lastProduced: colony.lastProduced,
    },
    draw: w.lastDraw, sectors, systems, relays, fleets, colonies,
    orders: Object.values(w.orders).filter((o) => o.colony === colony.id).map((o) => ({ id: o.id, region: o.region, resource: o.resource, side: o.side, qty: o.qty, price: o.price })),
    barters: Object.values(w.barters).filter((b) => b.from === colony.id || b.to === colony.id).map((b) => ({ id: b.id, from: b.from, to: b.to, give: b.give as Partial<Stock>, want: b.want as Partial<Stock>, accepted: b.accepted })),
    clearing: w.lastClearing,
    treaties: Object.values(w.treaties).filter((t) => t.a === colony.id || t.b === colony.id).map((t) => ({ id: t.id, with: t.a === colony.id ? t.b : t.a, kind: t.kind, until: t.until })),
    proposals: w.proposals.filter((p) => p.to === colony.id || p.from === colony.id).map((p) => ({ from: p.from, to: p.to, kind: p.kind })),
    invites: Object.values(w.alliances).filter((a) => a.invites.includes(colony.id)).map((a) => ({ alliance: a.id, name: a.name })),
    titles: w.titles,
    events: w.events.filter((e) => e.actors.includes(colony.id) || e.kind === 'draw' || e.kind === 'season.ended').slice(-60),
    ended: w.ended,
  };
}
