// The strict contract between the model and the rule engine. Zod validates what comes back; the JSON
// Schema drives guided decoding on providers that support it (json_schema response_format).
import { z } from 'zod';
import { PolicySchema, RESOURCES, type Policy } from '@aurane/protocol';
import type { JsonSchemaSpec } from '../llm/types.js';

/** The fields a doctrine may set: a partial Policy, version-less (the server fills the rest). */
export const OrdersSchema = PolicySchema.omit({ version: true }).partial().strict();
export type Orders = z.infer<typeof OrdersSchema>;

/** What a talking General answers: the line, optional orders, or one clarification question. */
export const TalkOutputSchema = z.object({
  reply: z.string().min(1).max(600),
  orders: OrdersSchema.nullable().default(null),
  question: z.string().max(300).nullable().default(null),
}).strict();
export type TalkOutput = z.infer<typeof TalkOutputSchema>;

/** What a doctrine compilation answers. */
export const DoctrineOutputSchema = z.object({
  orders: OrdersSchema.nullable().default(null),
  reply: z.string().min(1).max(400),
  question: z.string().max(300).nullable().default(null),
}).strict();
export type DoctrineOutput = z.infer<typeof DoctrineOutputSchema>;

const num01 = { type: 'number', minimum: 0, maximum: 1 };
const priceMap = { type: 'object', additionalProperties: false, properties: Object.fromEntries(RESOURCES.map((r) => [r, { type: 'number', minimum: 0, maximum: 50 }])) };
const stockMap = { type: 'object', additionalProperties: false, properties: Object.fromEntries(RESOURCES.map((r) => [r, { type: 'number', minimum: 0, maximum: 5000 }])) };
const ids = { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 24 };

export const ORDERS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  properties: {
    reserves: stockMap, sellAbove: priceMap, buyBelow: priceMap,
    defendFirst: ids, neverAttack: ids, trustedTraders: ids,
    expansion: num01, aggression: num01, retreatBelow: num01,
    escortAbove: { type: 'number', minimum: 0, maximum: 5000 },
    autoTurrets: { type: 'integer', minimum: 0, maximum: 6 },
    fuel: { type: 'string', enum: ['auto', 'refinery', 'synthesizer'] },
    targetPriority: { type: 'string', enum: ['ships', 'turrets', 'station', 'economy'] },
    notes: { type: 'string', maxLength: 2000 },
  },
};

export const TALK_JSON_SCHEMA: JsonSchemaSpec = {
  name: 'general_talk',
  schema: {
    type: 'object', additionalProperties: false, required: ['reply', 'orders', 'question'],
    properties: { reply: { type: 'string', maxLength: 600 }, orders: { anyOf: [ORDERS_JSON_SCHEMA, { type: 'null' }] }, question: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] } },
  },
};

export const DOCTRINE_JSON_SCHEMA: JsonSchemaSpec = {
  name: 'general_doctrine',
  schema: {
    type: 'object', additionalProperties: false, required: ['orders', 'reply', 'question'],
    properties: { orders: { anyOf: [ORDERS_JSON_SCHEMA, { type: 'null' }] }, reply: { type: 'string', maxLength: 400 }, question: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] } },
  },
};

/** The shape, as prose for providers without guided decoding. */
export const ORDERS_SHAPE_DOC = `{
  "reserves"?: { "metal"?: n, "energy"?: n, "food"?: n, "crystal"?: n, "rium"?: n },   // keep at least this much
  "sellAbove"?: { "<resource>": minPrice }, "buyBelow"?: { "<resource>": maxPrice },
  "defendFirst"?: ["<system id>" or "__capital__" for the capital], "neverAttack"?: ["<colony or alliance id>"], "trustedTraders"?: ["<colony id>"],
  "expansion"?: 0..1, "aggression"?: 0..1, "retreatBelow"?: 0..1, "escortAbove"?: credits, "autoTurrets"?: 0..6,
  "fuel"?: "auto" | "refinery" | "synthesizer", "targetPriority"?: "ships" | "turrets" | "station" | "economy",
  "notes"?: "the doctrine in one sentence, in your own words"
}`;

/** Merge validated orders into the current policy. Unknown ids are dropped here and again by the engine. */
export function mergeOrders(current: Policy, orders: Orders, known: { systems: Record<string, string>; colonies: Record<string, string>; alliances: Record<string, string> }): Policy {
  const merged = PolicySchema.parse({ ...current, ...orders, version: 1 });
  merged.defendFirst = [...new Set(merged.defendFirst.filter((id) => id in known.systems || id === '__capital__'))];
  merged.neverAttack = [...new Set(merged.neverAttack.filter((id) => id in known.colonies || id in known.alliances))];
  merged.trustedTraders = [...new Set(merged.trustedTraders.filter((id) => id in known.colonies))];
  return merged;
}
