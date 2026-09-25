// In-character degradation: the providers are saturated, unavailable, or the player is over quota.
// Zero model calls, one line in the General's voice, never the same line twice in a row.
import type { Persona } from '@aurane/protocol';
import { hashSeed, sheetOf, type DegradeReason, type Lang } from './sheets.js';

export function degradedReply(persona: Persona, lang: Lang, reason: DegradeReason, seed: string | number, avoid: readonly string[] = []): string {
  const bank = sheetOf(persona).degraded[lang][reason === 'budget' ? 'quota' : reason];
  const fresh = bank.filter((l) => !avoid.includes(l));
  const pool = fresh.length ? fresh : bank;
  return pool[hashSeed(persona, lang, reason, seed) % pool.length]!;
}
