// Natural-language doctrine → Policy. The model proposes, the schema disposes: whatever
// comes back is validated by PolicySchema, and a keyword heuristic covers the model being
// down or talking nonsense. The rule engine in @aurane/sim executes the result.
import { PolicySchema, RESOURCES, type Policy, type Resource } from '@aurane/protocol';
import { extractJson, type LlmClient } from './llm.js';

export interface DoctrineContext {
  lang: 'fr' | 'en';
  current: Policy;
  /** Systems the player owns: id → name, so "defend Thair" resolves to an id. */
  systems: Record<string, string>;
  /** Known colonies: id → name. */
  colonies: Record<string, string>;
  alliances: Record<string, string>;
}

export interface CompiledDoctrine { policy: Policy; summary: string; source: 'llm' | 'heuristic'; warnings: string[] }

const RESOURCE_WORDS: Record<Resource, string[]> = {
  metal: ['métal', 'metal'],
  energy: ['énergie', 'energie', 'energy'],
  food: ['vivres', 'nourriture', 'food'],
  crystal: ['cristal', 'crystal'],
  rium: ['rium'],
};

function findNamed(text: string, dict: Record<string, string>): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const [id, name] of Object.entries(dict)) if (name.length >= 3 && lower.includes(name.toLowerCase())) out.push(id);
  return out;
}

/** Deterministic fallback: reads intent from keywords in French or English. */
export function heuristicPolicy(text: string, ctx: DoctrineContext): CompiledDoctrine {
  const t = text.toLowerCase();
  const p: Policy = { ...ctx.current, notes: text.slice(0, 2000) };
  const warnings: string[] = [];
  const has = (...words: string[]): boolean => words.some((w) => t.includes(w));

  const never = [...findNamed(text, ctx.colonies), ...findNamed(text, ctx.alliances)].filter(() => has('jamais', 'never', 'pas attaquer', 'don\'t attack', 'do not attack'));
  const pacifist = has('jamais la guerre', 'pacifi', 'sans moi', 'without me', 'no attack') || (has('n\'attaque', 'never attack') && never.length === 0);
  if (pacifist) p.aggression = 0;
  else if (has('raid', 'attaque', 'attack', 'harcèle', 'harass')) p.aggression = Math.max(p.aggression, has('agressi', 'aggressi', 'tout ce qui bouge', 'anything') ? 0.8 : 0.5);
  if (has('défen', 'defen', 'protège', 'protect', 'tiens', 'hold')) {
    const named = findNamed(text, ctx.systems);
    p.defendFirst = [...new Set([...named, ...p.defendFirst])];
    if (has('capitale', 'capital')) p.defendFirst = [...new Set(['__capital__', ...p.defendFirst])];
  }
  if (has('étend', 'expan', 'colonis', 'grandis', 'grow', 'expand')) p.expansion = has('vite', 'fast', 'agressi', 'max') ? 1 : Math.max(p.expansion, 0.7);
  if (has('consolid', 'ne t\'étends pas', 'stop expand', 'no expansion', 'pas d\'expansion')) p.expansion = 0.1;
  for (const r of RESOURCES) {
    const words = RESOURCE_WORDS[r];
    if (words.some((w) => has(`vends le surplus de ${w}`, `vends ${w}`, `sell ${w}`, `sell surplus ${w}`, `surplus de ${w}`))) p.sellAbove = { ...p.sellAbove, [r]: p.sellAbove[r] ?? 0.5 };
    if (words.some((w) => has(`achète ${w}`, `achete ${w}`, `buy ${w}`, `manque de ${w}`, `stock de ${w}`))) p.buyBelow = { ...p.buyBelow, [r]: p.buyBelow[r] ?? 3 };
    const m = t.match(new RegExp(`(?:garde|keep|réserve|reserve)\\s+(\\d+)\\s+(?:de\\s+|d')?(?:${words.join('|')})`));
    if (m) p.reserves = { ...p.reserves, [r]: Number(m[1]) };
  }
  const trusted = findNamed(text, ctx.colonies).filter(() => has('confiance', 'trust', 'ami', 'friend', 'commerce avec', 'trade with'));
  if (trusted.length) p.trustedTraders = [...new Set([...p.trustedTraders, ...trusted])];
  if (never.length) p.neverAttack = [...new Set([...p.neverAttack, ...never])];
  if (p.defendFirst.includes('__capital__')) warnings.push('capital');

  const parsed = PolicySchema.safeParse(p);
  const policy = parsed.success ? parsed.data : ctx.current;
  if (!parsed.success) warnings.push('heuristic policy failed validation; kept the current one');
  return { policy, summary: summarize(policy, ctx.lang), source: 'heuristic', warnings };
}

export function summarize(p: Policy, lang: 'fr' | 'en'): string {
  const pct = (x: number): string => `${Math.round(x * 100)} %`;
  if (lang === 'fr') {
    const parts = [`expansion ${pct(p.expansion)}`, `agressivité ${pct(p.aggression)}`];
    if (p.defendFirst.length) parts.push(`défend d'abord ${p.defendFirst.length} système(s)`);
    if (Object.keys(p.sellAbove).length) parts.push(`vend ${Object.keys(p.sellAbove).join(', ')}`);
    if (Object.keys(p.buyBelow).length) parts.push(`achète ${Object.keys(p.buyBelow).join(', ')}`);
    if (p.neverAttack.length) parts.push(`n'attaque jamais ${p.neverAttack.length} cible(s)`);
    return parts.join(' · ');
  }
  const parts = [`expansion ${pct(p.expansion)}`, `aggression ${pct(p.aggression)}`];
  if (p.defendFirst.length) parts.push(`defends ${p.defendFirst.length} system(s) first`);
  if (Object.keys(p.sellAbove).length) parts.push(`sells ${Object.keys(p.sellAbove).join(', ')}`);
  if (Object.keys(p.buyBelow).length) parts.push(`buys ${Object.keys(p.buyBelow).join(', ')}`);
  if (p.neverAttack.length) parts.push(`never attacks ${p.neverAttack.length} target(s)`);
  return parts.join(' · ');
}

const SCHEMA_DOC = `{
  "version": 1,
  "reserves": { "metal"?: number, "energy"?: number, "food"?: number, "crystal"?: number, "rium"?: number },   // keep at least this much
  "sellAbove": { "<resource>": minPrice },   // sell surplus when the regional price is at least this
  "buyBelow": { "<resource>": maxPrice },    // buy up to the reserve when the price is at most this
  "defendFirst": ["<system id>"],            // only ids from the SYSTEMS list
  "expansion": 0..1,                          // 0 never build relays, 1 expand whenever affordable
  "aggression": 0..1,                         // 0 never attack without explicit order, 1 raid weak neighbours freely
  "neverAttack": ["<colony or alliance id>"],
  "trustedTraders": ["<colony id>"],
  "notes": "one sentence, the doctrine in the General's own words"
}`;

export async function compilePolicy(text: string, ctx: DoctrineContext, client: LlmClient | null): Promise<CompiledDoctrine> {
  const fallback = heuristicPolicy(text, ctx);
  if (!client || !text.trim()) return fallback;
  const systems = Object.entries(ctx.systems).map(([id, n]) => `${id} = ${n}`).join('; ');
  const colonies = Object.entries(ctx.colonies).slice(0, 60).map(([id, n]) => `${id} = ${n}`).join('; ');
  const alliances = Object.entries(ctx.alliances).map(([id, n]) => `${id} = ${n}`).join('; ');
  const messages = [
    { role: 'system' as const, content: `You compile a player's doctrine for a space strategy game into a strict JSON policy. Output ONLY a JSON object matching this shape, no prose, no code fences:\n${SCHEMA_DOC}\nRules: keep the CURRENT policy's values for anything the doctrine does not mention. Use only ids that appear in the lists. Resources are metal, energy, food, crystal, rium (fleet fuel). Prices are in credits (typical: metal 1, food 1, energy 2, crystal 6, rium 3). If the doctrine forbids attacking, aggression must be 0.` },
    { role: 'user' as const, content: `CURRENT: ${JSON.stringify(ctx.current)}\nSYSTEMS: ${systems || '(none)'}\nCOLONIES: ${colonies || '(none)'}\nALLIANCES: ${alliances || '(none)'}\nDOCTRINE (${ctx.lang}): ${text.slice(0, 2000)}` },
  ];
  try {
    const res = await client.chat(messages, { maxTokens: 600, temperature: 0.1, json: true });
    const raw = extractJson(res.text) as Record<string, unknown>;
    const parsed = PolicySchema.safeParse({ ...raw, version: 1, notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 2000) : text.slice(0, 2000) });
    if (!parsed.success) return { ...fallback, warnings: [...fallback.warnings, 'model output rejected by schema'] };
    const policy = parsed.data;
    // Guard rails the engine also enforces: unknown ids are dropped, never a blank cheque.
    policy.defendFirst = policy.defendFirst.filter((id) => id in ctx.systems);
    policy.neverAttack = policy.neverAttack.filter((id) => id in ctx.colonies || id in ctx.alliances);
    policy.trustedTraders = policy.trustedTraders.filter((id) => id in ctx.colonies);
    return { policy, summary: summarize(policy, ctx.lang), source: 'llm', warnings: [] };
  } catch (err) {
    return { ...fallback, warnings: [...fallback.warnings, `model unavailable: ${(err as Error).message}`] };
  }
}
