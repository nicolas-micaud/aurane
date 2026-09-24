// Shared vocabulary between the simulation, the world server, the client and
// the General (AI). Everything here is plain data and JSON-serialisable.
import { z } from 'zod';

export const FACTIONS = ['concordat', 'guild', 'oracles', 'corsairs'] as const;
export type Faction = (typeof FACTIONS)[number];

export const RESOURCES = ['metal', 'energy', 'food', 'crystal'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Stock = Record<Resource, number>;

export const BUILDINGS = ['extractor', 'shipyard', 'bastion', 'tradepost', 'amplifier', 'antenna'] as const;
export type Building = (typeof BUILDINGS)[number];

export const UNITS = ['corvette', 'frigate', 'cruiser'] as const;
export type UnitType = (typeof UNITS)[number];
export type Fleet = Record<UnitType, number>;

export const BAND_COUNT = 8;
export const BANDS_PER_DRAW = 3;

/** Hex sector address (axial coordinates). */
export interface Hex { q: number; r: number }

export const StockSchema = z.object({ metal: z.number(), energy: z.number(), food: z.number(), crystal: z.number() });

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
  /** Free text the General keeps to explain its choices in briefings. */
  notes: z.string().max(2000).default(''),
});
export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = PolicySchema.parse({ version: 1 });

/** Persona of a General: affects tone and default policy, never power. */
export const PERSONAS = ['vane', 'kestrel', 'oriel', 'solen'] as const;
export type Persona = (typeof PERSONAS)[number];

export const PERSONA_DEFAULTS: Record<Persona, Partial<Policy>> = {
  vane: { expansion: 0.3, aggression: 0 },
  kestrel: { expansion: 0.8, aggression: 0.6 },
  oriel: { expansion: 0.5, aggression: 0.1 },
  solen: { expansion: 0.4, aggression: 0 },
};

/** Commands a player (or their General) can issue. Validated at the world boundary. */
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('build_relay'), a: z.string(), b: z.string() }),
  z.object({ type: z.literal('remove_relay'), a: z.string(), b: z.string() }),
  z.object({ type: z.literal('build'), system: z.string(), building: z.enum(BUILDINGS) }),
  z.object({ type: z.literal('train'), system: z.string(), unit: z.enum(UNITS), count: z.number().int().positive() }),
  z.object({ type: z.literal('market_order'), region: z.string(), resource: z.enum(RESOURCES), side: z.enum(['buy', 'sell']), qty: z.number().int().positive(), price: z.number().positive() }),
  z.object({ type: z.literal('cancel_order'), order: z.string() }),
  z.object({ type: z.literal('barter_offer'), to: z.string(), give: StockSchema.partial(), want: StockSchema.partial() }),
  z.object({ type: z.literal('barter_accept'), offer: z.string() }),
  z.object({ type: z.literal('fleet_order'), fleet: z.string(), order: z.enum(['move', 'raid', 'blockade', 'defend', 'return']), target: z.string() }),
  z.object({ type: z.literal('agent_mission'), mission: z.enum(['spy', 'sabotage', 'envoy']), target: z.string() }),
  z.object({ type: z.literal('treaty'), with: z.string(), kind: z.enum(['nap', 'trade', 'transit', 'federation']) }),
  z.object({ type: z.literal('set_watch'), startHour: z.number().int().min(0).max(23) }),
  z.object({ type: z.literal('set_policy'), policy: PolicySchema }),
]);
export type Command = z.infer<typeof CommandSchema>;
