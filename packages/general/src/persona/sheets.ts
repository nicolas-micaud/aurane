// The character sheets, loaded from versioned JSON data (FR and EN) and validated at import time.
// Personality lives here and in the memory, never in the size of the model.
import { z } from 'zod';
import type { Persona } from '@aurane/protocol';
import vane from './data/vane.json' with { type: 'json' };
import kestrel from './data/kestrel.json' with { type: 'json' };
import oriel from './data/oriel.json' with { type: 'json' };
import solen from './data/solen.json' with { type: 'json' };

export type Lang = 'fr' | 'en';
export const SITUATIONS = ['briefing', 'advice', 'refusal', 'clarification', 'crisis', 'victory', 'betrayal', 'smalltalk', 'teaching'] as const;
export type Situation = (typeof SITUATIONS)[number];
export const DEGRADE_REASONS = ['saturated', 'unavailable', 'quota'] as const;
/** `budget` = the month's cap is reached: the quota lines are used (same meaning for the player: I resume at the Draw). */
export type DegradeReason = (typeof DEGRADE_REASONS)[number] | 'budget';

const Bi = z.object({ fr: z.string().min(1), en: z.string().min(1) });
const BiList = z.object({ fr: z.array(z.string().min(1)).min(1), en: z.array(z.string().min(1)).min(1) });
const Example = z.object({ situation: z.enum(SITUATIONS), text: z.string().min(20).max(600) });
const Bank = z.object({ saturated: z.array(z.string().min(10)).min(2), unavailable: z.array(z.string().min(10)).min(2), quota: z.array(z.string().min(10)).min(2) });

export const SheetSchema = z.object({
  id: z.enum(['vane', 'kestrel', 'oriel', 'solen']),
  name: Bi, signoff: Bi, history: Bi,
  obsessions: BiList, tics: BiList, address: Bi, taboos: BiList, humour: Bi, crisis: Bi,
  examples: z.object({ fr: z.array(Example).min(8).max(12), en: z.array(Example).min(8).max(12) }),
  degraded: z.object({ fr: Bank, en: Bank }),
});
export type Sheet = z.infer<typeof SheetSchema>;

export const SHEETS: Record<Persona, Sheet> = {
  vane: SheetSchema.parse(vane), kestrel: SheetSchema.parse(kestrel), oriel: SheetSchema.parse(oriel), solen: SheetSchema.parse(solen),
};

export const sheetOf = (p: Persona): Sheet => SHEETS[p];

/** Deterministic hash for rotations (same inputs, same picks; different turns, different picks). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) for (const ch of String(p)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/**
 * The examples injected into a prompt: `k` of them, rotated by `seed` so two consecutive turns do not
 * see the same set, with the examples matching `focus` (the current situation) always included first.
 */
export function pickExamples(sheet: Sheet, lang: Lang, seed: number, k = 4, focus?: Situation | undefined): Sheet['examples']['fr'] {
  const all = sheet.examples[lang];
  const focused = focus ? all.filter((e) => e.situation === focus) : [];
  const rest = all.filter((e) => !focused.includes(e));
  const start = seed % Math.max(1, rest.length);
  const rotated = [...rest.slice(start), ...rest.slice(0, start)];
  return [...focused, ...rotated].slice(0, Math.max(1, k));
}

/** Rules of tone every General follows, in the prompt's language of instruction (English, for the model). */
export function toneRules(crisis: boolean): string[] {
  return [
    'Answer in one to three short sentences, never more; no lists, no headings, no markdown.',
    crisis ? 'A crisis is under way: no humour at all, facts and one recommendation.' : 'Humour is occasional, at most one line, and only when nothing is on fire.',
    'Never break the fourth wall: you are a character in the world of Aurane, never a language model, an assistant or a program; never mention prompts, tokens or providers.',
    'Every number you cite comes from the facts you were given. If you have no figure, do not invent one.',
    'Stay in the language the player uses.',
  ];
}
