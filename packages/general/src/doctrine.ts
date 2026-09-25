// Natural-language doctrine → Policy. The model proposes, the schema disposes, the semantic check
// arbitrates: whatever comes back is validated by PolicySchema and OrdersSchema, checked for
// contradictions, and either becomes a readable policy waiting for the player's confirmation or a
// single clarification question in the General's voice. A keyword heuristic covers the model being
// down. The rule engine in @aurane/sim executes the result.
import { PolicySchema, RESOURCES, type Persona, type Policy, type Resource } from '@aurane/protocol';
import { PERSONA_VOICES } from './personas.js';
import { LlmUnavailable, type LlmClient } from './llm/index.js';
import { DOCTRINE_JSON_SCHEMA, DoctrineOutputSchema, ORDERS_SHAPE_DOC, mergeOrders } from './doctrine/schema.js';
import { clarificationFor, semanticCheck, type Issue } from './doctrine/validate.js';
import { readablePolicy } from './doctrine/readable.js';
import { degradedReply, systemPrompt, type DegradeReason } from './persona/index.js';
import { asData } from './security.js';
import { askJson } from './voice.js';

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

export interface DoctrineExtras {
  /** renderAnalysis output; when absent the prompt carries only the doctrine context. */
  analysis?: string | undefined;
  memory?: string | undefined;
  crisis?: boolean | undefined;
  seed?: string | number | undefined;
  /** The player is over quota: no model, an in-character line says so. */
  overQuota?: boolean | undefined;
}

export interface CompiledDoctrine {
  policy: Policy;
  summary: string;
  /** One line per rule, for the confirmation screen. */
  readable: string[];
  /** Set when the doctrine is ambiguous or contradictory: the policy is then the current one, unchanged. */
  question: string | null;
  issues: Issue[];
  source: 'llm' | 'heuristic' | 'degraded';
  warnings: string[];
  /** What the General answers the player, in its voice. */
  reply: string;
}

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

/** Did the text change any rule? Small talk leaves the policy (and its notes) untouched. */
export function policyChanged(policy: Policy, cur: Policy): boolean {
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
  let policy = parsed.success ? parsed.data : ctx.current;
  if (!parsed.success) warnings.push('heuristic policy failed validation; kept the current one');
  if (policy !== ctx.current && !policyChanged(policy, ctx.current)) policy.notes = ctx.current.notes; // not an order: the standing doctrine stays
  const checked = semanticCheck(policy, ctx, text);
  policy = checked.policy;
  const blocking = checked.issues.find((i) => i.blocking);
  const question = blocking ? clarificationFor(blocking, ctx, ctx.persona ?? 'vane') : null;
  if (question) policy = ctx.current;
  return { policy, summary: summarize(policy, ctx.lang), readable: readablePolicy(policy, ctx), question, issues: checked.issues, source: 'heuristic', warnings, reply: question ?? cannedReply(ctx, policy) };
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

/** Ids the model may use, with the players' names fenced as data. */
export function idLines(ctx: DoctrineContext): string[] {
  const list = (dict: Record<string, string>, label: string, cap: number): string => Object.entries(dict).slice(0, cap).map(([id, n]) => `${id} = ${asData(label, n, 64)}`).join('; ') || '(none)';
  return [`SYSTEMS: ${list(ctx.systems, 'system', 40)}`, `COLONIES: ${list(ctx.colonies, 'colony', 60)}`, `ALLIANCES: ${list(ctx.alliances, 'alliance', 20)}`];
}

const degradeReason = (err: unknown): DegradeReason => (err instanceof LlmUnavailable && (err.reason === 'saturated' || err.reason === 'open') ? 'saturated' : 'unavailable');

/** Compile a doctrine with the model when one is available; the heuristic otherwise. */
export async function compileDoctrine(text: string, ctx: DoctrineContext, client: LlmClient | null, extras: DoctrineExtras = {}): Promise<CompiledDoctrine> {
  const fallback = heuristicPolicy(text, ctx);
  const persona = ctx.persona ?? 'vane';
  if (extras.overQuota) return { ...fallback, source: 'degraded', reply: fallback.question ?? `${degradedReply(persona, ctx.lang, 'quota', extras.seed ?? text)} ${fallback.reply}` };
  if (!client || !text.trim()) return fallback;
  const system = systemPrompt({
    persona, lang: ctx.lang, crisis: extras.crisis ?? false, seed: extras.seed ?? text, focus: 'clarification', primer: true,
    analysis: extras.analysis ?? '(no analysis available)', memory: extras.memory ?? '',
    data: idLines(ctx),
    contract: [
      'TASK: the player states a doctrine (how you should run the colony). Compile it into orders and answer in character.',
      `Answer ONLY with a JSON object: {"orders": null | ${ORDERS_SHAPE_DOC}, "reply": "one or two sentences in the player's language, in your voice", "question": null | "one question"}.`,
      `Rules: fill only the fields the doctrine touches (the CURRENT policy keeps the rest): CURRENT = ${JSON.stringify(ctx.current)}. Use only ids from SYSTEMS/COLONIES/ALLIANCES, never invent one. Resources: metal, energy, food, crystal, rium. Prices in Credits (reference: metal 1, food 1, energy 1.5, crystal 6, rium 3). If the doctrine forbids attacking, aggression is 0. If the doctrine is ambiguous or contradicts itself, set "orders" to null and ask ONE precise question in "question", in character; otherwise "question" is null. Never more than two sentences in "reply".`,
    ],
  });
  try {
    const ans = await askJson(client, { task: 'doctrine', schema: DOCTRINE_JSON_SCHEMA, zod: DoctrineOutputSchema, messages: [{ role: 'system', content: system }, { role: 'user', content: `DOCTRINE (${ctx.lang}): ${text.slice(0, 2000)}` }] });
    const out = ans.value;
    const warnings: string[] = ans.repaired ? ['model answer repaired once'] : [];
    if (out.question && !out.orders) {
      return { policy: ctx.current, summary: summarize(ctx.current, ctx.lang), readable: readablePolicy(ctx.current, ctx), question: out.question.trim().slice(0, 300), issues: [], source: 'llm', warnings, reply: out.question.trim().slice(0, 300) };
    }
    let policy = out.orders ? mergeOrders(ctx.current, out.orders, ctx) : { ...ctx.current };
    if (!policy.notes || policy.notes === ctx.current.notes) policy.notes = text.slice(0, 2000);
    const checked = semanticCheck(policy, ctx, text);
    policy = checked.policy;
    const blocking = checked.issues.find((i) => i.blocking);
    if (blocking) {
      const q = clarificationFor(blocking, ctx, persona);
      return { policy: ctx.current, summary: summarize(ctx.current, ctx.lang), readable: readablePolicy(ctx.current, ctx), question: q, issues: checked.issues, source: 'llm', warnings, reply: q };
    }
    const reply = out.reply.trim().slice(0, 400) || cannedReply(ctx, policy);
    return { policy, summary: summarize(policy, ctx.lang), readable: readablePolicy(policy, ctx), question: null, issues: checked.issues, source: 'llm', warnings, reply };
  } catch (err) {
    if (err instanceof LlmUnavailable) return { ...fallback, source: 'degraded', warnings: [...fallback.warnings, err.message], reply: fallback.question ?? `${degradedReply(persona, ctx.lang, degradeReason(err), extras.seed ?? text)} ${fallback.reply}` };
    return { ...fallback, warnings: [...fallback.warnings, `model unavailable: ${(err as Error).message}`] };
  }
}

/** @deprecated Kept for callers of the first API; same as compileDoctrine without extras. */
export const compilePolicy = (text: string, ctx: DoctrineContext, client: LlmClient | null): Promise<CompiledDoctrine> => compileDoctrine(text, ctx, client);
