// Structures, orbits and warehouses: the static rules of a plateau. A system has one plateau
// per point of interest (pois.ts); slots and angles are per POI.
import type { Building, Orbit, Stock, StockDelta } from '@aurane/protocol';
import * as B from './balance.js';
import type { StarSystem } from './galaxy.js';
import { layoutOf, poiOf } from './pois.js';
import type { Structure, SystemState, World } from './state.js';

/** Orbit slots of a POI; the capital's main POI gets 3 extra slots (one per orbit). */
export function orbitSlots(w: World, sys: StarSystem, poiId?: string): Record<Orbit, number> {
  const st = w.systems[sys.id]!;
  const layout = layoutOf(w.galaxy, sys.id);
  const poi = poiOf(layout, poiId ?? st.mainPoi ?? layout.main);
  if (!poi) return { 1: 0, 2: 0, 3: 0 };
  const slots: Record<Orbit, number> = { ...poi.orbitSlots };
  const isCapital = st.owner !== null && w.colonies[st.owner]?.capital === sys.id && poi.id === st.mainPoi;
  if (isCapital) for (let i = 0; i < B.CAPITAL_EXTRA_SLOTS; i++) slots[((i % 3) + 1) as Orbit]++;
  return slots;
}

/** Slots of the whole system, all POIs together. */
export function totalSlots(w: World, sys: StarSystem): number {
  let n = 0;
  for (const p of layoutOf(w.galaxy, sys.id).pois) { const s = orbitSlots(w, sys, p.id); n += s[1] + s[2] + s[3]; }
  return n;
}

export function freeSlotsOnOrbit(w: World, sys: StarSystem, orbit: Orbit, poiId?: string): number {
  const st = w.systems[sys.id]!;
  const poi = poiId ?? st.mainPoi;
  const used = st.structures.filter((x) => x.orbit === orbit && x.poi === poi).length + st.buildQueue.filter((j) => j.orbit === orbit && j.poi === poi).length;
  return orbitSlots(w, sys, poi)[orbit] - used;
}

/** Where a building goes by default; a player may override within the same family. */
export const defaultOrbit = (kind: Building): Orbit => B.BUILDING_ORBIT[kind];

/** Angle for a new structure: spread evenly around the orbit, deterministic. */
export function nextAngle(st: SystemState, orbit: Orbit, capacity: number, poi: string = st.mainPoi): number {
  const taken = new Set([...st.structures.filter((x) => x.orbit === orbit && x.poi === poi).map((x) => x.angle), ...st.buildQueue.filter((j) => j.orbit === orbit && j.poi === poi).map((j, i) => (360 / Math.max(1, capacity)) * i)]);
  for (let i = 0; i < Math.max(1, capacity); i++) {
    const a = Math.round((360 / Math.max(1, capacity)) * i + 30 * (orbit - 1)) % 360;
    if (!taken.has(a)) return a;
  }
  return 0;
}

export function hasStructure(st: SystemState, kind: Building): boolean {
  return st.structures.some((x) => x.kind === kind && x.hp > 0);
}

export function structuresOf(st: SystemState, kind: Building): Structure[] {
  return st.structures.filter((x) => x.kind === kind);
}

/** Warehouse capacity per resource. */
export function capacityOf(w: World, systemId: string): number {
  const st = w.systems[systemId]!;
  const isCapital = st.owner !== null && w.colonies[st.owner]?.capital === systemId;
  const extra = st.structures.filter((x) => x.kind === 'warehouse' && x.hp > 0).length * B.WAREHOUSE_EXTRA_CAPACITY;
  return B.WAREHOUSE_BASE_CAPACITY * (isCapital ? B.CAPITAL_CAPACITY_MULT : 1) + extra;
}

/** Adds to a local stock, clamped to capacity; returns what overflowed. */
export function depositClamped(w: World, systemId: string, add: StockDelta): Stock {
  const st = w.systems[systemId]!;
  const cap = capacityOf(w, systemId);
  const lost: Stock = { metal: 0, energy: 0, food: 0, crystal: 0 };
  for (const r of B.RESOURCE_LIST) {
    const amount = add[r] ?? 0;
    if (amount <= 0) continue;
    const room = Math.max(0, cap - st.stock[r]);
    const kept = Math.min(room, amount);
    st.stock[r] += kept;
    lost[r] += amount - kept;
  }
  return lost;
}

export const isArmed = (kind: Building): boolean => kind in B.TURRET_STATS;

/** Structures at one point of interest. */
export function structuresAt(st: SystemState, poi: string): Structure[] {
  return st.structures.filter((x) => x.poi === poi);
}

/** Any relay keeps the system on the Network: the station at the main POI or a 'relay' structure elsewhere. */
export function relayUp(st: SystemState): boolean {
  return st.stationHp > 0 || st.structures.some((x) => x.kind === 'relay' && x.hp > 0);
}
