// Natural-language doctrine → Policy. The model proposes, the schema disposes: whatever
// comes back is validated by PolicySchema, and a keyword heuristic covers the model being
// down or talking nonsense. The rule engine in @aurane/sim executes the result.
import { PolicySchema, RESOURCES, type Persona, type Policy, type Resource } from '@aurane/protocol';
import { PERSONA_VOICES } from './personas.js';
import { extractJson, type LlmClient } from './llm.js';

export interface DoctrineContext {
  lang: 'fr' | 'en';
  current: Policy;
  /** Systems the player owns: id → name, so "defend Thair" resolves to an id. */
  systems: Record<string, string>;
  /** Known colonies: id → name. */
  colonies: Record<string, string>;
  alliances: Record<string, string>;
  /** The General answering, for the voice of the reply. */
  persona?: Persona;
}

export interface CompiledDoctrine { policy: Policy; summary: string; source: 'llm' | 'heuristic'; warnings: string[]; /** What the General answers the player, in its voice. */ reply: string }

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
/** The General's answer when no model wrote one: acknowledges an order, or says what it listens for. */
/** Did the text change any rule? Small talk leaves the policy (and its notes) untouched. */
function policyChanged(policy: Policy, cur: Policy): boolean {
  return policy.expansion !== cur.expansion || policy.aggression !== cur.aggression || policy.fuel !== cur.fuel
    || policy.defendFirst.join() !== cur.defendFirst.join() || policy.neverAttack.join() !== cur.neverAttack.join()
    || JSON.stringify(policy.sellAbove) !== JSON.stringify(cur.sellAbove) || JSON.stringify(policy.buyBelow) !== JSON.stringify(cur.buyBelow)
    || JSON.stringify(policy.reserves) !== JSON.stringify(cur.reserves) || policy.trustedTraders.join() !== cur.trustedTraders.join()
    || policy.autoTurrets !== cur.autoTurrets || policy.targetPriority !== cur.targetPriority || policy.retreatBelow !== cur.retreatBelow || policy.escortAbove !== cur.escortAbove;
}

function cannedReply(ctx: DoctrineContext, policy: Policy): string {
  const voice = PERSONA_VOICES[ctx.persona ?? 'vane'];
  const changed = policyChanged(policy, ctx.current);
  if (ctx.lang === 'fr') {
    return changed
      ? `Compris. Doctrine en vigueur : ${summarize(policy, 'fr')}. ${voice.signoff.fr}`
      : `Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. ${voice.signoff.fr}`;
  }
  return changed
    ? `Understood. Standing doctrine: ${summarize(policy, 'en')}. ${voice.signoff.en}`
    : `I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. ${voice.signoff.en}`;
}

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
  if (has('autonom', 'synthé', 'synthe', 'self-suffic', 'pas de raffinerie', 'no refinery')) p.fuel = 'synthesizer';
  else if (has('raffinerie', 'refiner', 'géante', 'geante', 'gas giant', 'conqu')) p.fuel = 'refinery';
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
  if (policy !== ctx.current && !policyChanged(policy, ctx.current)) policy.notes = ctx.current.notes; // not an order: the standing doctrine stays
  return { policy, summary: summarize(policy, ctx.lang), source: 'heuristic', warnings, reply: cannedReply(ctx, policy) };
}

export function summarize(p: Policy, lang: 'fr' | 'en'): string {
  const pct = (x: number): string => `${Math.round(x * 100)} %`;
  if (lang === 'fr') {
    const parts = [`expansion ${pct(p.expansion)}`, `agressivité ${pct(p.aggression)}`];
    if (p.defendFirst.length) parts.push(`défend d'abord ${p.defendFirst.length} système(s)`);
    if (Object.keys(p.sellAbove).length) parts.push(`vend ${Object.keys(p.sellAbove).join(', ')}`);
    if (Object.keys(p.buyBelow).length) parts.push(`achète ${Object.keys(p.buyBelow).join(', ')}`);
    if (p.neverAttack.length) parts.push(`n'attaque jamais ${p.neverAttack.length} cible(s)`);
    if (p.fuel !== 'auto') parts.push(p.fuel === 'refinery' ? 'carburant : raffineries' : 'carburant : synthétiseurs');
    return parts.join(' · ');
  }
  const parts = [`expansion ${pct(p.expansion)}`, `aggression ${pct(p.aggression)}`];
  if (p.defendFirst.length) parts.push(`defends ${p.defendFirst.length} system(s) first`);
  if (Object.keys(p.sellAbove).length) parts.push(`sells ${Object.keys(p.sellAbove).join(', ')}`);
  if (Object.keys(p.buyBelow).length) parts.push(`buys ${Object.keys(p.buyBelow).join(', ')}`);
  if (p.neverAttack.length) parts.push(`never attacks ${p.neverAttack.length} target(s)`);
  if (p.fuel !== 'auto') parts.push(p.fuel === 'refinery' ? 'fuel: refineries' : 'fuel: synthesizers');
  return parts.join(' · ');
}

const SCHEMA_DOC = `{
  "version": 1,
  "reserves": { "metal"?: number, "energy"?: number, "food"?: number, "crystal"?: number, "rium"?: number },   // keep at least this much
  "sellAbove": { "<resource>": minPrice },   // sell surplus when the regional price is at least this
  "buyBelow": { "<resource>": maxPrice },    // buy up to the reserve when the price is at most this
  "defendFirst": ["<system id>"],            // only ids from the SYSTEMS list
  "expansion": 0..1,                          // 0 never build relays, 1 expand whenever affordable
  "fuel": "auto" | "refinery" | "synthesizer", // refinery: hold gas giants, never synthesize; synthesizer: autonomy at home
  "aggression": 0..1,                         // 0 never attack without explicit order, 1 raid weak neighbours freely
  "neverAttack": ["<colony or alliance id>"],
  "trustedTraders": ["<colony id>"],
  "notes": "one sentence, the doctrine in the General's own words",
  "reply": "one or two sentences answering the player, in the General's voice and in the player's language; if the text is not a doctrine (a joke, a question, small talk), answer it in character and say what kind of orders you take"
}`;

export async function compilePolicy(text: string, ctx: DoctrineContext, client: LlmClient | null): Promise<CompiledDoctrine> {
  const fallback = heuristicPolicy(text, ctx);
  if (!client || !text.trim()) return fallback;
  const systems = Object.entries(ctx.systems).map(([id, n]) => `${id} = ${n}`).join('; ');
  const colonies = Object.entries(ctx.colonies).slice(0, 60).map(([id, n]) => `${id} = ${n}`).join('; ');
  const alliances = Object.entries(ctx.alliances).map(([id, n]) => `${id} = ${n}`).join('; ');
  const voice = PERSONA_VOICES[ctx.persona ?? 'vane'];
  const messages = [
    { role: 'system' as const, content: `You are ${voice.name[ctx.lang]}, the player's AI General in the space strategy game Aurane. Voice: ${voice.voice[ctx.lang]}. You compile the player's doctrine into a strict JSON policy and answer them in character. Output ONLY a JSON object matching this shape, no prose, no code fences:\n${SCHEMA_DOC}\nRules: keep the CURRENT policy's values for anything the doctrine does not mention. Use only ids that appear in the lists. Resources are metal, energy, food, crystal, rium (fleet fuel). Prices are in credits (typical: metal 1, food 1, energy 2, crystal 6, rium 3). If the doctrine forbids attacking, aggression must be 0. The reply is always in ${ctx.lang === 'fr' ? 'French' : 'English'}, never more than two sentences.` },
    { role: 'user' as const, content: `CURRENT: ${JSON.stringify(ctx.current)}\nSYSTEMS: ${systems || '(none)'}\nCOLONIES: ${colonies || '(none)'}\nALLIANCES: ${alliances || '(none)'}\nDOCTRINE (${ctx.lang}): ${text.slice(0, 2000)}` },
  ];
  try {
    const res = await client.chat(messages, { maxTokens: 700, temperature: 0.3, json: true, timeoutMs: 20000 });
    const raw = extractJson(res.text) as Record<string, unknown>;
    const parsed = PolicySchema.safeParse({ ...raw, version: 1, notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 2000) : text.slice(0, 2000) });
    if (!parsed.success) return { ...fallback, warnings: [...fallback.warnings, 'model output rejected by schema'] };
    const policy = parsed.data;
    // Guard rails the engine also enforces: unknown ids are dropped, never a blank cheque.
    policy.defendFirst = policy.defendFirst.filter((id) => id in ctx.systems);
    policy.neverAttack = policy.neverAttack.filter((id) => id in ctx.colonies || id in ctx.alliances);
    policy.trustedTraders = policy.trustedTraders.filter((id) => id in ctx.colonies);
    const reply = typeof raw.reply === 'string' && raw.reply.trim() ? raw.reply.trim().slice(0, 400) : cannedReply(ctx, policy);
    return { policy, summary: summarize(policy, ctx.lang), source: 'llm', warnings: [], reply };
  } catch (err) {
    return { ...fallback, warnings: [...fallback.warnings, `model unavailable: ${(err as Error).message}`] };
  }
}
