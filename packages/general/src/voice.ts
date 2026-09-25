// One way to ask a voice-class model for JSON: fixed task sampling, guided decoding when available,
// zod validation, and a single repair turn when the answer does not fit. Anything else throws, and the
// caller degrades in character.
import type { z } from 'zod';
import { extractJson } from './llm/json.js';
import type { ChatMessage, JsonSchemaSpec, LlmClient, LlmTask } from './llm/types.js';

export interface JsonAsk<T> { task: LlmTask; messages: ChatMessage[]; schema: JsonSchemaSpec; zod: z.ZodType<T>; repair?: boolean }

export interface JsonAnswer<T> { value: T; repaired: boolean; provider: string; model: string; ms: number; inputTokens: number; outputTokens: number }

export class InvalidAnswer extends Error { constructor(readonly detail: string) { super(`model answer rejected: ${detail}`); this.name = 'InvalidAnswer'; } }

export async function askJson<T>(client: LlmClient, ask: JsonAsk<T>): Promise<JsonAnswer<T>> {
  const first = await client.chat(ask.messages, { task: ask.task, schema: ask.schema, json: true });
  const parsed = parse(first.text, ask.zod);
  if (parsed.ok) return { value: parsed.value, repaired: false, provider: first.provider, model: first.model, ms: first.ms, inputTokens: first.inputTokens, outputTokens: first.outputTokens };
  if (ask.repair === false) throw new InvalidAnswer(parsed.error);
  const second = await client.chat([
    ...ask.messages,
    { role: 'assistant', content: first.text.slice(0, 1500) },
    { role: 'user', content: `Your answer was not valid for the required JSON shape (${parsed.error}). Answer again with ONLY the JSON object, same content, valid this time.` },
  ], { task: ask.task, schema: ask.schema, json: true });
  const again = parse(second.text, ask.zod);
  if (!again.ok) throw new InvalidAnswer(again.error);
  return { value: again.value, repaired: true, provider: second.provider, model: second.model, ms: first.ms + second.ms, inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens };
}

function parse<T>(text: string, zod: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown;
  try { raw = extractJson(text); } catch (err) { return { ok: false, error: (err as Error).message }; }
  const r = zod.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ') };
}
