// Structures, orbits and warehouses: the static rules of a system's plateau.
import type { Building, Orbit, Stock, StockDelta } from '@aurane/protocol';
import * as B from './balance.js';
import type { StarSystem } from './galaxy.js';
import type { Structure, SystemState, World } from './state.js';

/** Orbit slots of a system: 2 orbits for one-slot systems, 3 beyond; the capital gets 3 extra slots. */
export function orbitSlots(w: World, sys: StarSystem): Record<Orbit, number> {
  const st = w.systems[sys.id]!;
  const isCapital = st.owner !== null && w.colonies[st.owner]?.capital === sys.id;
  const total = sys.slots + (isCapital ? B.CAPITAL_EXTRA_SLOTS : 0);
  // Spread: industry first, then military, then Signal.
  const slots: Record<Orbit, number> = { 1: 0, 2: 0, 3: 0 };
  const orbits: Orbit[] = sys.slots <= 1 && !isCapital ? [1, 2] : [1, 2, 3];
  for (let i = 0; i < total; i++) slots[orbits[i % orbits.length]!]++;
  return slots;
}

export function totalSlots(w: World, sys: StarSystem): number {
  const s = orbitSlots(w, sys);
  return s[1] + s[2] + s[3];
}

export function freeSlotsOnOrbit(w: World, sys: StarSystem, orbit: Orbit): number {
  const st = w.systems[sys.id]!;
  const used = st.structures.filter((x) => x.orbit === orbit).length + st.buildQueue.filter((j) => j.orbit === orbit).length;
  return orbitSlots(w, sys)[orbit] - used;
}

/** Where a building goes by default; a player may override within the same family. */
export const defaultOrbit = (kind: Building): Orbit => B.BUILDING_ORBIT[kind];

/** Angle for a new structure: spread evenly around the orbit, deterministic. */
export function nextAngle(st: SystemState, orbit: Orbit, capacity: number): number {
  const taken = new Set([...st.structures.filter((x) => x.orbit === orbit).map((x) => x.angle), ...st.buildQueue.filter((j) => j.orbit === orbit).map((j, i) => (360 / Math.max(1, capacity)) * i)]);
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
