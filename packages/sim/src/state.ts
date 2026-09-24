import type { Building, Faction, Fleet, Orbit, Persona, Policy, Resource, Stock, StockDelta, UnitType } from '@aurane/protocol';
import type { Galaxy } from './galaxy.js';
import type { Relay } from './network.js';
import type { Draw } from './draw.js';

export interface Colony {
  id: string;
  name: string;
  faction: Faction;
  persona: Persona;
  npc: boolean;
  capital: string;
  /** Market deliveries and orders go through this system (capital or a tradepost). */
  marketSystem: string;
  credits: number;
  influence: number;
  createdAt: number;
  watchStartHour: number;   // 8-hour window of doubled defence
  policy: Policy;
  alliance: string | null;
  /** Rolling connected-system counts, one per draw, newest last. */
  scoreWindow: number[];
  marketVolume7d: number[];
  /** What the last Draw produced across all systems, so Generals can budget upkeep against income. */
  lastProduced: Stock;
  /** Exponential moving average of production over the last few Draws. */
  avgProduced: Stock;
  /** Resources lost to full warehouses at the last Draw (a signal for the player and the General). */
  lastOverflow: Stock;
  lastSeenAt: number;
}

export interface BuildJob { building: Building; orbit: Orbit; readyAt: number }
export interface TrainJob { unit: UnitType; count: number; readyAt: number }

/** A structure on an orbit. The station-relais is not a structure: see SystemState.stationHp. */
export interface Structure {
  id: string;
  kind: Building;
  orbit: Orbit;
  /** Angle on the orbit, degrees, for the system view and range checks. */
  angle: number;
  hp: number;
}

export interface SystemState {
  owner: string | null;
  structures: Structure[];
  /** Hit points of the station-relais, the physical node of the Network (0 = relays down). */
  stationHp: number;
  /** Local stock; production, construction and upkeep happen here. */
  stock: Stock;
  population: number;       // 0..1 of capacity
  buildQueue: BuildJob[];
  trainQueue: TrainJob[];
  blockade: { by: string; since: number } | null;
  /** True while hostile armed units are on the plateau: combat ticks every second. */
  engaged: boolean;
}

export type FleetOrder =
  | { kind: 'idle' }
  | { kind: 'move'; to: string }
  | { kind: 'raid'; target: string; via: string }            // target: structure id or 'station'
  | { kind: 'blockade'; system: string }
  | { kind: 'defend'; system: string }
  | { kind: 'ambush'; system: string }
  | { kind: 'convoy'; to: string; route: string | null }
  | { kind: 'return' };

export interface PlateauPos { r: number; a: number }   // polar: orbit distance (0..PLATEAU_RADIUS), angle in degrees

export interface FleetState {
  id: string;
  owner: string;
  units: Fleet;
  /** Accumulated damage per unit type; a unit is lost when damage ≥ its HP. */
  damage: Record<UnitType, number>;
  /** Cargo carried by the cargos of this fleet. */
  cargo: Stock;
  /** System where the fleet sits, or null while travelling. */
  at: string | null;
  from: string | null;
  destination: string | null;
  /** Remaining waypoints for convoys (system ids), so they can be intercepted en route. */
  path: string[];
  departAt: number;
  arriveAt: number;
  order: FleetOrder;
  /** Position on the plateau while at a system (null when docked and invisible to combat). */
  pos: PlateauPos | null;
  /** Explicit target (fleet id, structure id or 'station') set by the player or the General. */
  focus: string | null;
}

export interface MarketOrder {
  id: string;
  colony: string;
  region: string;
  resource: Resource;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  placedAt: number;
}

export interface BarterOffer {
  id: string;
  from: string;
  to: string;
  give: StockDelta;
  want: StockDelta;
  accepted: boolean;
  createdAt: number;
}

export type TreatyKind = 'nap' | 'trade' | 'transit' | 'federation';
export interface Treaty { id: string; a: string; b: string; kind: TreatyKind; since: number; until: number | null }
export interface TreatyProposal { from: string; to: string; kind: TreatyKind; at: number }

export interface Alliance { id: string; name: string; leader: string; members: string[]; invites: string[]; createdAt: number }

export interface AgentMission {
  id: string;
  owner: string;
  mission: 'spy' | 'sabotage' | 'envoy';
  target: string;           // sector key (spy), relay id (sabotage), colony id (envoy)
  readyAt: number;
}

/** A standing supply rule executed by the General with idle cargos at `from`. */
export interface SupplyRoute {
  id: string;
  owner: string;
  from: string;
  to: string;
  resource: Resource | 'all';
  perTrip: number;
  whenBelow: number;
  active: boolean;
  /** Sim time of the last departure, to space trips. */
  lastRunAt: number;
}

export interface LitBeacon { system: string; by: string; since: number }

export interface Clearing { region: string; resource: Resource; price: number; qty: number }

export type WorldEvent = { at: number; kind: string; actors: string[]; data?: Record<string, unknown> };

/** One salvo-level record of an engagement, for replayable battle reports. */
export interface BattleLog {
  id: string;
  system: string;
  startedAt: number;
  endedAt: number | null;
  sides: string[];              // colony ids involved
  /** kind: kill (what = unit type, target = victim colony), destroyed (what = structure kind), station.down. */
  events: { at: number; kind: string; who: string; what: string; amount?: number; target?: string }[];
}

export interface World {
  seed: number;
  galaxy: Galaxy;
  time: number;             // simulated seconds since season start
  seasonEndsAt: number;
  drawIndex: number;
  lastDraw: Draw | null;
  colonies: Record<string, Colony>;
  systems: Record<string, SystemState>;
  relays: Record<string, Relay>;
  fleets: Record<string, FleetState>;
  orders: Record<string, MarketOrder>;
  barters: Record<string, BarterOffer>;
  treaties: Record<string, Treaty>;
  proposals: TreatyProposal[];
  alliances: Record<string, Alliance>;
  missions: Record<string, AgentMission>;
  routes: Record<string, SupplyRoute>;
  reveals: Record<string, Record<string, number>>; // colony → sector → until
  litBeacons: Record<string, LitBeacon>;
  lastClearing: Clearing[];
  events: WorldEvent[];
  battles: Record<string, BattleLog>;
  titles: { network: string | null; admiralty: string | null; exchange: string | null };
  ended: { at: number; reason: 'silence' | 'renaissance'; winner: string | null } | null;
  nextId: number;
  /** Index colony → owned system ids; maintained by setOwner. */
  owned: Record<string, string[]>;
  /** Index colony → relay ids; maintained by addRelay/removeRelay. */
  relaysByOwner: Record<string, string[]>;
  /** Index colony → treaty ids it is party to. */
  treatiesByColony: Record<string, string[]>;
  /** Systems with hostiles on the plateau, ticked every second. */
  engagedSystems: string[];
}

export const newId = (w: World, prefix: string): string => `${prefix}${(w.nextId++).toString(36)}`;
export const emptyFleet = (): Fleet => ({ corvette: 0, frigate: 0, cruiser: 0, cargo: 0 });
export const emptyDamage = (): Record<UnitType, number> => ({ corvette: 0, frigate: 0, cruiser: 0, cargo: 0 });
export const fleetSize = (f: Fleet): number => f.corvette + f.frigate + f.cruiser + f.cargo;
export const combatSize = (f: Fleet): number => f.corvette + f.frigate + f.cruiser;
