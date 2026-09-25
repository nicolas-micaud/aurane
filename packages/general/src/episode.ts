// The *episodes* layer of the memory (decision 0009): one line per active day, in the General's voice, written
// at level 1 from level-0 facts (digest of the day, choices made), read again when the player returns.
import type { Persona } from '@aurane/protocol';
import { LlmUnavailable, type LlmClient } from './llm/index.js';
import { numbersIn, verifyNumbers, RULE_NUMBERS } from './analysis/index.js';
import { systemPrompt, type Lang } from './persona/index.js';
import { PERSONA_VOICES } from './personas.js';

export interface EpisodeInput {
  persona: Persona;
  lang: Lang;
  day: number;
  /** The day's facts, already rendered (a template briefing, the tally, the choices). */
  facts: string;
  seed?: string | number | undefined;
}

export interface EpisodeResult { text: string; source: 'llm' | 'template' | 'degraded' }

/** Deterministic episode: the first three lines of the facts, signed. */
export function templateEpisode(input: EpisodeInput): string {
  const lines = input.facts.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
  return `${lines.join(' ')} ${PERSONA_VOICES[input.persona].signoff[input.lang]}`.trim().slice(0, 400);
}

/** One to three sentences, past tense, second person, only the facts' figures. */
export async function writeEpisode(input: EpisodeInput, client: LlmClient | null): Promise<EpisodeResult> {
  const base = templateEpisode(input);
  if (!client) return { text: base, source: 'template' };
  const system = systemPrompt({
    persona: input.persona, lang: input.lang, crisis: false, seed: input.seed ?? input.day, focus: 'briefing', primer: false,
    analysis: `FACTS OF DAY ${input.day} (what happened to the player's colony and what the player chose):\n${input.facts}`, memory: '',
    contract: ['TASK: write the episode of this day for your memory: one to three sentences, past tense, second person, in your voice, plain text. Keep only what matters (a raid held, a bridge doubled, a choice made); invent nothing; no sign-off.'],
  });
  const allowed = new Set<number>([...RULE_NUMBERS, ...numbersIn(input.facts)]);
  for (const v of [...allowed]) { allowed.add(Math.round(v)); if (v >= 100) allowed.add(Math.round(v / 10) * 10); }
  try {
    const res = await client.chat([{ role: 'system', content: system }, { role: 'user', content: input.lang === 'fr' ? 'L\'épisode du jour.' : 'The day\'s episode.' }], { task: 'episode' });
    const check = verifyNumbers(res.text.trim(), allowed);
    const text = (check.ok ? res.text.trim() : check.stripped).slice(0, 400);
    return text.length >= 20 ? { text, source: 'llm' } : { text: base, source: 'template' };
  } catch (err) {
    return { text: base, source: err instanceof LlmUnavailable ? 'degraded' : 'template' };
  }
}
