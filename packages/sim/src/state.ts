import type { Building, Faction, Fleet, Persona, Policy, Resource, Stock, StockDelta, UnitType } from '@starnet/protocol';
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
  stock: Stock;
  credits: number;
  influence: number;
  createdAt: number;
  watchStartHour: number;   // 8-hour window of doubled defence
  policy: Policy;
  alliance: string | null;
  /** Rolling connected-system counts, one per draw, newest last. */
  scoreWindow: number[];
  marketVolume7d: number[];
  lastSeenAt: number;
}

export interface BuildJob { building: Building; readyAt: number }
export interface TrainJob { unit: UnitType; count: number; readyAt: number }

export interface SystemState {
  owner: string | null;
  buildings: Building[];
  population: number;       // 0..1 of capacity
  buildQueue: BuildJob[];
  trainQueue: TrainJob[];
  blockade: { by: string; since: number } | null;
}

export type FleetOrder =
  | { kind: 'idle' }
  | { kind: 'move'; to: string }
  | { kind: 'raid'; relay: string; via: string }
  | { kind: 'blockade'; system: string }
  | { kind: 'defend'; system: string }
  | { kind: 'return' };

export interface FleetState {
  id: string;
  owner: string;
  units: Fleet;
  /** System where the fleet sits, or null while travelling. */
  at: string | null;
  from: string | null;
  destination: string | null;
  arriveAt: number;
  order: FleetOrder;
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

export interface LitBeacon { system: string; by: string; since: number }

export interface Clearing { region: string; resource: Resource; price: number; qty: number }

export type WorldEvent = { at: number; kind: string; actors: string[]; data?: Record<string, unknown> };

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
  reveals: Record<string, Record<string, number>>; // colony → sector → until
  litBeacons: Record<string, LitBeacon>;
  lastClearing: Clearing[];
  events: WorldEvent[];
  titles: { network: string | null; admiralty: string | null; exchange: string | null };
  ended: { at: number; reason: 'silence' | 'renaissance'; winner: string | null } | null;
  nextId: number;
}

export const newId = (w: World, prefix: string): string => `${prefix}${(w.nextId++).toString(36)}`;
export const emptyFleet = (): Fleet => ({ corvette: 0, frigate: 0, cruiser: 0 });
export const fleetSize = (f: Fleet): number => f.corvette + f.frigate + f.cruiser;
