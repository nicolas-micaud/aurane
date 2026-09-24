// Shared vocabulary between the simulation, the world server, the client and
// the General (AI). Everything here is plain data and JSON-serialisable.
import { z } from 'zod';

export const FACTIONS = ['concordat', 'guild', 'oracles', 'corsairs'] as const;
export type Faction = (typeof FACTIONS)[number];

export const RESOURCES = ['metal', 'energy', 'food', 'crystal', 'rium'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Stock = Record<Resource, number>;
/** A partial stock as produced by zod's .partial() (keys may be present with undefined). */
export type StockDelta = { [K in Resource]?: number | undefined };

export const BUILDINGS = ['extractor', 'refinery', 'synthesizer', 'shipyard', 'bastion', 'tradepost', 'amplifier', 'antenna', 'warehouse', 'turret_light', 'turret_heavy', 'launcher', 'relay'] as const;
export type Building = (typeof BUILDINGS)[number];

export const UNITS = ['corvette', 'frigate', 'cruiser', 'cargo'] as const;
export const COMBAT_UNITS = ['corvette', 'frigate', 'cruiser'] as const;
export type CombatUnit = (typeof COMBAT_UNITS)[number];

export const ORBITS = [1, 2, 3] as const;
export type Orbit = (typeof ORBITS)[number];
export type UnitType = (typeof UNITS)[number];
export type Fleet = Record<UnitType, number>;

export const BAND_COUNT = 8;
export const BANDS_PER_DRAW = 3;

/** Hex sector address (axial coordinates). */
export interface Hex { q: number; r: number }

export const StockSchema = z.object({ metal: z.number(), energy: z.number(), food: z.number(), crystal: z.number(), rium: z.number() });

/**
 * A Policy is what the General compiles a player's natural-language doctrine
 * into. The deterministic rule engine in the simulation executes it; the LLM
 * never acts directly.
 */
export const PolicySchema = z.object({
  version: z.literal(1),
  /** Keep at least this much of each resource before selling or spending on optional actions. */
  reserves: StockSchema.partial().default({}),
  /** Sell surplus above the reserve when the regional price is at least this. */
  sellAbove: z.record(z.enum(RESOURCES), z.number().nonnegative()).default({}),
  /** Buy up to the reserve when the regional price is at most this. */
  buyBelow: z.record(z.enum(RESOURCES), z.number().nonnegative()).default({}),
  /** Systems (by id) to defend first; the rule engine keeps fleets near them. */
  defendFirst: z.array(z.string()).default([]),
  /** Expansion appetite: 0 = never build new relays, 1 = expand whenever affordable. */
  expansion: z.number().min(0).max(1).default(0.5),
  /** Aggression: 0 = never attack without an explicit order, 1 = raid weak neighbours freely. */
  aggression: z.number().min(0).max(1).default(0),
  /** Rules of engagement the engine enforces regardless of aggression. */
  neverAttack: z.array(z.string()).default([]),
  /** Colonies or alliances the General may accept trades from without asking. */
  trustedTraders: z.array(z.string()).default([]),
  /** Logistics: escort convoys whose cargo value exceeds this (credits). */
  escortAbove: z.number().nonnegative().default(300),
  /** Retreat when the fleet's hit points fall below this fraction. */
  retreatBelow: z.number().min(0).max(1).default(0.3),
  /** Turrets the General may build on its own when a system is attacked and local stock allows. */
  autoTurrets: z.number().int().min(0).max(6).default(2),
  /** Fuel doctrine: refinery (hold gas giants, never synthesize), synthesizer (autonomy at home first), auto. */
  fuel: z.enum(['auto', 'refinery', 'synthesizer']).default('auto'),
  /** Target priority for own units when the player is absent. */
  targetPriority: z.enum(['ships', 'turrets', 'station', 'economy']).default('ships'),
  /** Free text the General keeps to explain its choices in briefings. */
  notes: z.string().max(2000).default(''),
});
export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = PolicySchema.parse({ version: 1 });

/** Persona of a General: affects tone and default policy, never power. */
export const PERSONAS = ['vane', 'kestrel', 'oriel', 'solen'] as const;
export type Persona = (typeof PERSONAS)[number];

export const PERSONA_DEFAULTS: Record<Persona, Partial<Policy>> = {
  vane: { expansion: 0.3, aggression: 0, fuel: 'synthesizer' },
  kestrel: { expansion: 0.8, aggression: 0.7, fuel: 'refinery' },
  oriel: { expansion: 0.5, aggression: 0.25 },
  solen: { expansion: 0.4, aggression: 0, fuel: 'synthesizer' },
};

/** Commands a player (or their General) can issue. Validated at the world boundary. */
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('build_relay'), a: z.string(), b: z.string() }),
  z.object({ type: z.literal('remove_relay'), a: z.string(), b: z.string() }),
  z.object({ type: z.literal('build'), system: z.string(), building: z.enum(BUILDINGS), orbit: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), poi: z.string().optional() }),
  z.object({ type: z.literal('train'), system: z.string(), unit: z.enum(UNITS), count: z.number().int().positive() }),
  z.object({ type: z.literal('market_order'), region: z.string(), resource: z.enum(RESOURCES), side: z.enum(['buy', 'sell']), qty: z.number().int().positive(), price: z.number().positive() }),
  z.object({ type: z.literal('cancel_order'), order: z.string() }),
  z.object({ type: z.literal('barter_offer'), to: z.string(), give: StockSchema.partial(), want: StockSchema.partial() }),
  z.object({ type: z.literal('barter_accept'), offer: z.string() }),
  z.object({ type: z.literal('fleet_order'), fleet: z.string(), order: z.enum(['move', 'raid', 'blockade', 'defend', 'return', 'ambush']), target: z.string() }),
  z.object({ type: z.literal('focus'), fleet: z.string(), target: z.string().nullable() }),
  z.object({ type: z.literal('route_set'), from: z.string(), to: z.string(), resource: z.enum([...RESOURCES, 'all']), perTrip: z.number().int().positive().max(2000), whenBelow: z.number().nonnegative() }),
  z.object({ type: z.literal('route_remove'), route: z.string() }),
  z.object({ type: z.literal('convoy_send'), from: z.string(), to: z.string(), cargo: StockSchema.partial(), escort: z.string().optional() }),
  z.object({ type: z.literal('split_fleet'), fleet: z.string(), units: z.object({ corvette: z.number().int().nonnegative(), frigate: z.number().int().nonnegative(), cruiser: z.number().int().nonnegative(), cargo: z.number().int().nonnegative() }).partial() }),
  z.object({ type: z.literal('agent_mission'), mission: z.enum(['spy', 'sabotage', 'envoy', 'probe']), target: z.string() }),
  z.object({ type: z.literal('treaty'), with: z.string(), kind: z.enum(['nap', 'trade', 'transit', 'federation']) }),
  z.object({ type: z.literal('set_watch'), startHour: z.number().int().min(0).max(23) }),
  z.object({ type: z.literal('light_beacon'), system: z.string() }),
  z.object({ type: z.literal('alliance_create'), name: z.string().min(2).max(40) }),
  z.object({ type: z.literal('alliance_invite'), colony: z.string() }),
  z.object({ type: z.literal('alliance_join'), alliance: z.string() }),
  z.object({ type: z.literal('alliance_leave') }),
  z.object({ type: z.literal('set_policy'), policy: PolicySchema }),
]);
export type Command = z.infer<typeof CommandSchema>;
