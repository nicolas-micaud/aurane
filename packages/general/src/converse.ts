// The conversational General: one call answers the player in character and, when the message holds
// orders, compiles them. The model receives the engine's analysis and a short memory, never the raw
// state; every figure it cites is checked against the analysis; foreign names are fenced as data; over
// quota or without a model, a persona-flavoured line still answers.
import type { Persona, Policy } from '@aurane/protocol';
import type { PlayerView } from '@aurane/sim';
import { heuristicPolicy, idLines, policyChanged, summarize, type DoctrineContext } from './doctrine.js';
import { LlmUnavailable, type LlmClient } from './llm/index.js';
import { PERSONA_VOICES } from './personas.js';
import { TALK_JSON_SCHEMA, TalkOutputSchema, ORDERS_SHAPE_DOC, mergeOrders } from './doctrine/schema.js';
import { clarificationFor, semanticCheck } from './doctrine/validate.js';
import { readablePolicy } from './doctrine/readable.js';
import { degradedReply, sheetOf, signaturesIn, systemPrompt, type DegradeReason, type Situation } from './persona/index.js';
import { allowedNumbers, numbersIn, renderAnalysis, verifyNumbers, type Analysis } from './analysis/index.js';
import { sanitizeText } from './security.js';
import { tierUnlocked, wantsEverything } from './alerts.js';
import type { Command } from '@aurane/protocol';
import { askJson } from './voice.js';

export interface Turn { who: 'me' | 'general'; text: string; at: number }

export interface ConverseInput {
  text: string;
  lang: 'fr' | 'en';
  persona: Persona;
  history: Turn[];
  ctx: DoctrineContext;
  /** The engine's analysis of the colony; without it the General answers from the heuristic only. */
  analysis?: Analysis | undefined;
  /** renderMemory output, or ''. */
  memory?: string | undefined;
  /** Rotation seed (colony id + turn count). */
  seed?: string | number | undefined;
  /** The player is over quota: no model, an in-character line says so. */
  overQuota?: boolean | undefined;
  /** Kept for the heuristic summary of the first API; unused by the model path. */
  view?: PlayerView | undefined;
}

export interface ConverseResult {
  reply: string;
  policy: Policy | null;
  /** One line per rule of the proposed policy (for a confirmation step), when `policy` is set. */
  readable: string[] | null;
  /** The General asks before acting: the doctrine was ambiguous. */
  question: string | null;
  /** The General refused the order outright (it would sink the colony); the reply says why. */
  refused?: boolean;
  source: 'llm' | 'heuristic' | 'degraded';
  /** A command the conversation asks the world to run (e.g. onboarding_unlock), validated by the engine. */
  command?: Command;
  /** Numbers the model invented were removed from the reply. */
  numbersStripped: boolean;
  /** Signature lines used in this reply, for the memory of recent phrases. */
  usedPhrases: string[];
  degradeReason?: DegradeReason;
}

/** The state of the colony in a few lines (first API; kept for tests and for the offline General). */
export function situationSummary(v: PlayerView, lang: 'fr' | 'en', names: Record<string, string>): string {
  const me = v.me;
  const mine = v.systems.filter((s) => s.owner === me.id);
  const fleets = v.fleets.filter((f) => f.owner === me.id);
  const warships = fleets.reduce((s, f) => s + f.combat, 0);
  const incoming = v.fleets.filter((f) => f.owner !== me.id && f.destination && mine.some((s) => s.id === f.destination) && f.combat > 0);
  const nextDraw = Math.max(0, Math.round((v.nextDrawAt - v.time) / 60));
  const st = me.stock;
  if (lang === 'fr') return `Colonie ${me.name} : ${me.connectedCount} relié(s) sur ${mine.length}, score ${me.score.toFixed(1)}.${me.shielded ? ' Bouclier de débutant actif.' : ''} Métal ${Math.round(st.metal)}, Énergie ${Math.round(st.energy)}, Vivres ${Math.round(st.food)}, Cristal ${Math.round(st.crystal)}, Rium ${Math.round(st.rium)}, ${Math.round(me.credits)} Crédits. ${warships} vaisseau(x) de guerre${incoming.length ? `, ${incoming.length} flotte(s) hostile(s) en approche` : ''}. Prochain Tirage dans ${nextDraw} min. Doctrine : ${summarize(me.policy, 'fr')}.${Object.keys(names).length ? '' : ''}`;
  return `Colony ${me.name}: ${me.connectedCount} connected of ${mine.length}, score ${me.score.toFixed(1)}.${me.shielded ? ' Newcomer shield active.' : ''} Metal ${Math.round(st.metal)}, Energy ${Math.round(st.energy)}, Food ${Math.round(st.food)}, Crystal ${Math.round(st.crystal)}, Rium ${Math.round(st.rium)}, ${Math.round(me.credits)} Credits. ${warships} warship(s)${incoming.length ? `, ${incoming.length} hostile fleet(s) inbound` : ''}. Next Draw in ${nextDraw} min. Doctrine: ${summarize(me.policy, 'en')}.`;
}

const ORDER_WORDS = /\b(défen|defen|vend|sell|achèt|achet|buy|garde|keep|réserve|reserve|étend|expan|grow|attaque|attack|raid|jamais|never|carburant|fuel|raffinerie|refinery|synthé|synthe|tourelle|turret|repli|retreat|escort|doctrine|priorit)/i;
const JOKE_WORDS = /rire|blague|drôle|drole|joke|funny|laugh|humour|humor/i;
const RULE_WORDS = /comment|pourquoi|c'est quoi|qu'est-ce|how|why|what is|what's|explique|explain|règle|rule/i;

function situationOf(text: string, crisis: boolean): Situation {
  if (crisis) return 'crisis';
  if (JOKE_WORDS.test(text)) return 'smalltalk';
  if (RULE_WORDS.test(text)) return 'teaching';
  if (ORDER_WORDS.test(text)) return 'clarification';
  return 'advice';
}

const degradeReason = (err: unknown): DegradeReason => (err instanceof LlmUnavailable && (err.reason === 'saturated' || err.reason === 'open') ? 'saturated' : 'unavailable');

/** Small talk, questions and orders, answered in one model call; the persona fallback when no model is available. */
export async function converse(input: ConverseInput, client: LlmClient | null, _names: Record<string, string> = {}): Promise<ConverseResult> {
  const fallback = heuristicConverse(input);
  if (fallback.command || fallback.refused) return fallback; // "show me everything" and refusals: deterministic, no model needed
  const L = input.lang;
  const seed = input.seed ?? `${input.text}:${input.history.length}`;
  if (input.overQuota) return { ...fallback, source: 'degraded', degradeReason: 'quota', reply: fallback.question ?? `${degradedReply(input.persona, L, 'quota', seed)} ${fallback.policy ? fallback.reply : ''}`.trim() };
  if (!client || !input.text.trim()) return fallback;
  const crisis = input.analysis?.crisis ?? false;
  const analysisText = input.analysis ? renderAnalysis(input.analysis, L) : '(no analysis available: answer from the rules and the doctrine only, cite no figure)';
  const system = systemPrompt({
    persona: input.persona, lang: L, crisis, seed, focus: situationOf(input.text, crisis), primer: true,
    analysis: analysisText, memory: input.memory ?? '', data: idLines(input.ctx),
    contract: [
      'TASK: answer the player\'s message. It may be an order about how to run the colony, a question about the rules, small talk or a provocation.',
      `Answer ONLY with a JSON object, no prose outside it, no code fences: {"reply": "1 to 3 sentences in the player's language, in your voice", "orders": null | ${ORDERS_SHAPE_DOC}, "question": null | "one question"}.`,
      `Rules: "orders" is null unless the player clearly instructs you about running the colony; then fill only the fields the instruction touches (CURRENT policy: ${JSON.stringify(input.ctx.current)}) and say in the reply what you will do. If an order is ambiguous or contradicts itself, "orders" is null and "question" holds ONE precise question. Use only ids from the lists. When you recommend an action, pick it from the OPTIONS of the analysis and cite its figures. If the player asks how something works, explain it correctly from the rules, in your voice, tied to their situation.`,
    ],
  });
  const history = input.history.slice(-8).map((t) => ({ role: (t.who === 'me' ? 'user' : 'assistant') as 'user' | 'assistant', content: sanitizeText(t.text, 1500) }));
  const user = sanitizeText(input.text, 1500);
  const messages = [{ role: 'system' as const, content: system }, ...history, { role: 'user' as const, content: user }];
  const allowed = input.analysis ? allowedNumbers(input.analysis, `${user} ${input.memory ?? ''} ${input.history.map((t) => t.text).join(' ')}`) : new Set<number>([...numbersIn(user), ...numbersIn(input.memory ?? '')]);
  try {
    let ans = await askJson(client, { task: 'talk', schema: TALK_JSON_SCHEMA, zod: TalkOutputSchema, messages });
    let check = verifyNumbers(ans.value.reply, allowed);
    if (!check.ok) {
      // One corrective turn: the model narrates the engine's figures, it does not make its own.
      ans = await askJson(client, { task: 'talk', schema: TALK_JSON_SCHEMA, zod: TalkOutputSchema, repair: false, messages: [...messages, { role: 'assistant', content: JSON.stringify(ans.value) }, { role: 'user', content: `Your reply cited figures that are not in the facts you were given (${check.unknown.join(', ')}). Answer again, same meaning, citing only the figures from the analysis, or no figure at all. Same JSON shape.` }] }).catch(() => ans);
      check = verifyNumbers(ans.value.reply, allowed);
    }
    const stripped = !check.ok;
    let reply = (check.ok ? ans.value.reply : check.stripped).trim().slice(0, 600);
    let policy: Policy | null = null;
    let question: string | null = ans.value.question?.trim().slice(0, 300) || null;
    // The General asked in the reply itself ("which first?"): that is the question, and no order is taken meanwhile.
    if (!question && ans.value.orders && /\?\s*$/.test(reply)) question = reply;
    reply = stripExampleNames(reply, [...Object.values(input.ctx.systems), ...Object.values(input.ctx.colonies), ...Object.values(input.ctx.alliances)]);
    if (ans.value.orders && !question) {
      let merged = mergeOrders(input.ctx.current, ans.value.orders, input.ctx);
      if (!merged.notes || merged.notes === input.ctx.current.notes) merged.notes = user.slice(0, 2000);
      const checked = semanticCheck(merged, input.ctx, user);
      merged = checked.policy;
      const blocking = checked.issues.find((i) => i.blocking);
      if (blocking) question = clarificationFor(blocking, input.ctx, input.persona);
      else if (policyChanged(merged, input.ctx.current)) policy = merged;
    }
    if (question) reply = question;
    if (!reply) reply = fallback.reply;
    const sheet = sheetOf(input.persona);
    const usedPhrases = signaturesIn(reply, [...PERSONA_VOICES[input.persona].character[L].catchphrases, sheet.signoff[L], ...sheet.examples[L].map((e) => e.text)]);
    return { reply, policy, readable: policy ? readablePolicy(policy, input.ctx) : null, question, source: 'llm', numbersStripped: stripped, usedPhrases };
  } catch (err) {
    if (err instanceof LlmUnavailable) { const reason = degradeReason(err); return { ...fallback, source: 'degraded', degradeReason: reason, reply: fallback.question ?? `${degradedReply(input.persona, L, reason, seed)} ${fallback.policy ? fallback.reply : ''}`.trim() }; }
    return fallback;
  }
}

/** Keyword answers about the rules, so the offline General still teaches the game. */
const FAQ: { keys: string[]; fr: string; en: string }[] = [
  { keys: ['relais', 'relay', 'relier', 'link', 'réseau', 'network', 'portée', 'range'], fr: 'Relier deux étoiles construit un relais ; seul ce qui est relié à la capitale produit et compte. Chaque relais mange de l\'Énergie à chaque Tirage, de plus en plus cher : double tes ponts avant de t\'étendre trop loin.', en: 'Linking two stars builds a relay; only what is connected to the capital produces and scores. Every relay eats Energy at each Draw, more and more: double your bridges before reaching too far.' },
  { keys: ['tirage', 'draw', 'bande', 'band', 'heure'], fr: 'Chaque heure pile, trois bandes sur huit sortent : tes systèmes de ces bandes produisent triple, et le Marché se règle à ce moment-là. Le reste de l\'heure, on prépare.', en: 'Every hour on the hour, three of eight bands come out: your systems in those bands produce triple, and the Market settles then. The rest of the hour, we prepare.' },
  { keys: ['rium', 'carburant', 'fuel', 'raffinerie', 'refinery', 'synthé', 'synthe'], fr: 'Le Rium est le carburant : partir hors Réseau et tenir une flotte en territoire étranger en brûlent. On le mine en Raffinerie sur une géante gazeuse, vingt par Tirage, ou on le fabrique au Synthétiseur contre Énergie et Vivres.', en: 'Rium is fuel: leaving the Network and keeping a fleet in foreign space burn it. Mine it with a Refinery at a gas giant, twenty per Draw, or make it in a Synthesizer from Energy and Food.' },
  { keys: ['marché', 'market', 'prix', 'price', 'vend', 'sell', 'achet', 'buy', 'crédit', 'credit'], fr: 'Le Marché de ta région se règle au Tirage à un prix unique par ressource. Un teneur de marché vend toujours à 200 % du prix de référence et achète à 40 % : un plafond et un plancher, jamais une aubaine.', en: 'Your region\'s Market settles at the Draw at one price per resource. A market maker always sells at 200 % of reference and buys at 40 %: a ceiling and a floor, never a bargain.' },
  { keys: ['blocus', 'blockade', 'captur', 'siège', 'siege', 'raid'], fr: 'Un raid casse une installation ou la station et coupe les relais six heures. Un blocus tenu douze heures au corps principal capture le système, jamais une capitale. Les tourelles et une flotte en défense brisent un blocus.', en: 'A raid breaks a structure or the station and cuts relays for six hours. A blockade held twelve hours at the main body captures the system, never a capital. Turrets and a defending fleet break a blockade.' },
  { keys: ['flotte', 'fleet', 'corvette', 'frégate', 'frigate', 'croiseur', 'cruiser', 'vaisseau', 'ship'], fr: 'Trois coques en pierre-feuille-ciseaux : la Corvette bat le Croiseur, le Croiseur bat la Frégate, la Frégate bat la Corvette. On les entraîne au Chantier ; une flotte arrive au point de saut puis traverse les couloirs du système.', en: 'Three hulls in rock-paper-scissors: Corvette beats Cruiser, Cruiser beats Frigate, Frigate beats Corvette. Train them at the Shipyard; a fleet arrives at the jump point then crosses the system\'s lanes.' },
  { keys: ['score', 'gagner', 'win', 'victoire', 'phare', 'beacon', 'saison', 'season', 'silence'], fr: 'Le score, c\'est un point par système relié au Tirage, dix par Phare rallumé, plus les titres. La saison finit au Silence ; sept Phares rallumés ensemble vingt-quatre heures, c\'est la Renaissance.', en: 'Score is one point per connected system at the Draw, ten per lit Beacon, plus titles. The season ends at the Silence; seven Beacons lit together for twenty-four hours is the Renaissance.' },
  { keys: ['traité', 'treaty', 'allian', 'diplomat', 'influence', 'agent', 'espion', 'spy'], fr: 'Les traités se paient en Influence, que produit le Cristal : non-agression, pacte commercial, transit, fédération. Les agents espionnent, sabotent ou négocient. Rompre un traité se lit dans la Gazette.', en: 'Treaties cost Influence, which Crystal produces: non-aggression, trade pact, transit, federation. Agents spy, sabotage or negotiate. Breaking a treaty is read in the Gazette.' },
  { keys: ['doctrine', 'politique', 'policy', 'que fais', 'what do you', 'ordre', 'order'], fr: 'Ma doctrine, ce sont tes règles : jusqu\'où m\'étendre, quand attaquer, quoi vendre, quoi défendre, qui ne jamais toucher. Dis-le en une phrase et je l\'applique à chaque Tirage, que tu sois là ou non.', en: 'My doctrine is your rules: how far to expand, when to strike, what to sell, what to defend, whom never to touch. Say it in a sentence and I apply it at every Draw, whether you are here or not.' },
];

const GREETINGS: Record<Persona, { fr: string; en: string }> = {
  vane: { fr: 'Présente. Ponts tenus, réserves comptées. Tes ordres ?', en: 'Present. Bridges held, reserves counted. Your orders?' },
  kestrel: { fr: 'Enfin réveillé. J\'ai trois cibles et pas d\'ordre : dis un mot.', en: 'Awake at last. I have three targets and no orders: say the word.' },
  oriel: { fr: 'Bonjour. Les comptes sont justes et l\'Énergie a bougé de 4 % : je vous écoute.', en: 'Good day. The books balance and Energy moved 4 %: I am listening.' },
  solen: { fr: 'La paix sur ta Colonie. Les voisins sont calmes, le Signal veille. Que puis-je pour toi ?', en: 'Peace on your Colony. The neighbours are quiet, the Signal keeps watch. What can I do for you?' },
};

/** Names that live only in the character sheets' example lines: cited as facts, they are hallucinations. */
export const EXAMPLE_NAMES = ['Vantor', 'Draven', 'Vexqua', 'Sollum', 'Kessa', 'Orun', 'Rakanyx', 'Cynyx', 'Islum-9'] as const;

/** Drop the sentences that cite an example name unknown to this world (known names come from the context). */
export function stripExampleNames(text: string, known: readonly string[]): string {
  const knownLower = new Set(known.map((n) => n.toLowerCase()));
  const foreign = EXAMPLE_NAMES.filter((n) => !knownLower.has(n.toLowerCase()) && !known.some((k) => k.toLowerCase().includes(n.toLowerCase())));
  if (!foreign.some((n) => text.includes(n))) return text;
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const kept = sentences.filter((s) => !foreign.some((n) => s.includes(n)));
  return kept.join(' ').trim();
}

function pick<T>(arr: readonly T[], seed: string): T { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return arr[h % arr.length]!; }

/** No model: keywords decide between orders, a rules answer, a joke or a greeting, always in the persona's voice. */
export function heuristicConverse(input: ConverseInput): ConverseResult {
  const L = input.lang;
  const t = input.text.toLowerCase();
  const voice = PERSONA_VOICES[input.persona];
  const sheet = sheetOf(input.persona);
  const base = { readable: null, question: null, source: 'heuristic' as const, numbersStripped: false, usedPhrases: [] as string[] };
  if (wantsEverything(input.text)) return { ...base, reply: tierUnlocked(input.persona, L, 6, true), policy: null, command: { type: 'onboarding_unlock' } };
  const compiled = heuristicPolicy(input.text, input.ctx);
  if (compiled.question) return { ...base, reply: compiled.question, policy: null, question: compiled.question };
  if (compiled.refused) return { ...base, reply: compiled.reply, policy: null, refused: true };
  const changed = compiled.summary !== summarize(input.ctx.current, L) || compiled.policy.defendFirst.join() !== input.ctx.current.defendFirst.join();
  if (changed) return { ...base, reply: compiled.reply, policy: compiled.policy, readable: compiled.readable };
  const has = (...w: string[]): boolean => w.some((x) => t.includes(x));
  if (has('rire', 'blague', 'drôle', 'drole', 'joke', 'funny', 'laugh', 'humour', 'humor')) {
    const jokes = sheet.examples[L].filter((e) => e.situation === 'smalltalk').map((e) => e.text);
    return { ...base, reply: pick(jokes.length ? jokes : [sheet.signoff[L]], input.text), policy: null };
  }
  if (has('bonjour', 'salut', 'hello', 'hi ', 'hey', 'coucou', 'yo ') && t.length < 30) return { ...base, reply: GREETINGS[input.persona][L], policy: null };
  for (const f of FAQ) if (f.keys.some((k) => t.includes(k))) return { ...base, reply: `${f[L]} ${voice.signoff[L]}`, policy: null };
  return { ...base, reply: compiled.reply, policy: null };
}
