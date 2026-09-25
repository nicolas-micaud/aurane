// The Draw Counsel (decision 0009): twenty minutes before each Draw, three cards in the General's voice, each
// carrying a ready command and a place to show. Level 0 (the simulation) computes the legal, costed options;
// level 1 (this file, class voice) phrases three of them; without a model, in-character fallback cards. The
// General proposes and shows; the player says "Do it".
import type { Command, Persona, Stock } from '@aurane/protocol';
import { z } from 'zod';
import { LlmUnavailable, type JsonSchemaSpec, type LlmClient } from './llm/index.js';
import { numbersIn, verifyNumbers, RULE_NUMBERS } from './analysis/index.js';
import { degradedReply, sheetOf, systemPrompt, type DegradeReason, type Lang } from './persona/index.js';
import { PERSONA_VOICES } from './personas.js';
import { askJson } from './voice.js';

/** Where the client takes the player on "Show me": a screen, optionally a star or a slot to highlight. */
export interface ShowTarget { screen: 'galaxy' | 'system' | 'colony' | 'market' | 'general' | 'journal'; system?: string; poi?: string; slot?: string }

/** One legal, costed option from the simulation (`counsel(w, colony, tier)`; `buildOptions` today). */
export interface CounselOption {
  id: string;
  label: { fr: string; en: string };
  /** Short title (3 to 6 words) when the source has one; else the first words of the label. */
  title?: { fr: string; en: string } | undefined;
  cost: Partial<Stock> & { credits?: number };
  delayMin: number;
  gain: { fr: string; en: string };
  risk: 'low' | 'mid' | 'high';
  command: Command | null;
  show?: ShowTarget | undefined;
  /** The simulation's own `show` object, passed through to the client untouched. */
  raw?: unknown;
}

export interface CounselCard { id: string; title: string; line: string; command: Command | null; show: ShowTarget | null; /** The simulation's `show`, when the option came from it. */ raw?: unknown }

export interface CounselInput {
  persona: Persona;
  lang: Lang;
  /** Onboarding tier of the colony (0 = first minute: the fixed first cards replace the coach). */
  tier: number;
  options: CounselOption[];
  /** renderAnalysis output, or ''. */
  analysis?: string | undefined;
  memory?: string | undefined;
  crisis?: boolean | undefined;
  /** Minutes before the Draw. */
  minutesToDraw: number;
  seed?: string | number | undefined;
  overQuota?: boolean | undefined;
  /** Ids of cards the player set aside recently: not proposed again first. */
  skipped?: string[] | undefined;
}

export interface CounselResult { cards: CounselCard[]; source: 'llm' | 'fallback' | 'degraded'; degradeReason?: DegradeReason; numbersStripped: boolean }

const CardSchema = z.object({ id: z.string().min(1).max(64), title: z.string().min(1).max(60), line: z.string().min(1).max(240) }).strict();
export const CounselOutputSchema = z.object({ cards: z.array(CardSchema).min(1).max(3) }).strict();
export const COUNSEL_JSON_SCHEMA: JsonSchemaSpec = {
  name: 'general_counsel',
  schema: { type: 'object', additionalProperties: false, required: ['cards'], properties: { cards: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'line'], properties: { id: { type: 'string', maxLength: 64 }, title: { type: 'string', maxLength: 60 }, line: { type: 'string', maxLength: 240 } } } } } },
};

/** The first minute: three fixed cards at tier 0, in the voice, with a "show me" each. */
const FIRST_CARDS: Record<Persona, Record<Lang, { title: string; line: string }[]>> = {
  vane: {
    fr: [{ title: 'Touche ton étoile', line: 'Ta capitale. Tout part d\'ici et tout y revient : regarde-la avant de regarder les autres.' }, { title: 'Relie ta voisine', line: 'Un relais vers l\'étoile la plus proche. C\'est le premier pont ; on le doublera plus tard.' }, { title: 'Regarde ton entrepôt', line: 'Métal, Énergie, Vivres : ce que tu as, ce que tu brûles. Rien ne passe sans Énergie.' }],
    en: [{ title: 'Touch your star', line: 'Your capital. Everything starts here and comes back here: look at it before you look at the others.' }, { title: 'Link your neighbour', line: 'A relay to the nearest star. It is the first bridge; we double it later.' }, { title: 'Look at your warehouse', line: 'Metal, Energy, Food: what you have, what you burn. Nothing gets through without Energy.' }],
  },
  kestrel: {
    fr: [{ title: 'Touche ton étoile', line: 'C\'est chez toi. Petit, pour l\'instant. Les cibles sont autour.' }, { title: 'Relie ta voisine', line: 'Un relais vers la plus proche, et tu as déjà doublé ton territoire. Vas-y, ça ne mord pas.' }, { title: 'Regarde ton entrepôt', line: 'Tes stocks. Le Rium, c\'est le carburant : sans lui, on ne sort pas.' }],
    en: [{ title: 'Touch your star', line: 'That is home. Small, for now. The targets are all around.' }, { title: 'Link your neighbour', line: 'One relay to the nearest star and you have already doubled your ground. Go on, it does not bite.' }, { title: 'Look at your warehouse', line: 'Your stocks. Rium is fuel: without it, nobody leaves.' }],
  },
  oriel: {
    fr: [{ title: 'Touchez votre étoile', line: 'Votre capitale, votre seul actif à cette heure. Tout rendement commence par un inventaire.' }, { title: 'Reliez votre voisine', line: 'Un relais coûte du Métal et de l\'Énergie ; un système relié rend chaque Tirage. Le retour est immédiat.' }, { title: 'Regardez votre entrepôt', line: 'Cinq ressources, cinq prix. Sachez ce que vous avez avant de décider ce que vous vendez.' }],
    en: [{ title: 'Touch your star', line: 'Your capital, your only asset at this hour. Every return starts with an inventory.' }, { title: 'Link your neighbour', line: 'A relay costs Metal and Energy; a connected system yields every Draw. The return is immediate.' }, { title: 'Look at your warehouse', line: 'Five resources, five prices. Know what you have before deciding what you sell.' }],
  },
  solen: {
    fr: [{ title: 'Touche ton étoile', line: 'Ta maison, mon ami. Regarde-la : tout ce que tu bâtiras en part.' }, { title: 'Relie ta voisine', line: 'Un relais vers l\'étoile la plus proche. Le Réseau commence par un seul fil.' }, { title: 'Regarde ton entrepôt', line: 'Ce que tu as, ce qui manque. Un voisin partagera peut-être le reste.' }],
    en: [{ title: 'Touch your star', line: 'Your home, my friend. Look at it: everything you build starts from it.' }, { title: 'Link your neighbour', line: 'A relay to the nearest star. The Network begins with a single thread.' }, { title: 'Look at your warehouse', line: 'What you have, what you lack. A neighbour may share the rest.' }],
  },
};
const FIRST_SHOW: ShowTarget[] = [{ screen: 'galaxy' }, { screen: 'galaxy' }, { screen: 'colony' }];

export function firstCards(persona: Persona, lang: Lang, capital?: string): CounselCard[] {
  return FIRST_CARDS[persona][lang].map((c, i) => ({ id: `first-${i + 1}`, title: c.title, line: c.line, command: null, show: { ...FIRST_SHOW[i]!, ...(capital && i !== 2 ? { system: capital } : {}) } }));
}

/** Pick three options: crisis answers first (the simulation ranks them), the ones the player set aside last. */
export function pickOptions(options: CounselOption[], skipped: readonly string[] = []): CounselOption[] {
  const fresh = options.filter((o) => !skipped.includes(o.id));
  const rest = options.filter((o) => skipped.includes(o.id));
  return [...fresh, ...rest].slice(0, 3);
}

const titleOf = (label: string): string => label.split(/[(:—–]/)[0]!.trim().slice(0, 60);

/** Without a model: title = the option's label, line = the gain in the persona's register. */
export function fallbackCards(input: CounselInput): CounselCard[] {
  const L = input.lang;
  const voice = PERSONA_VOICES[input.persona].character[L];
  const opener: Record<Persona, Record<Lang, string>> = {
    vane: { fr: 'Ordre du jour : ', en: 'Order of the day: ' }, kestrel: { fr: 'Moi je ferais ça : ', en: 'Here is what I would do: ' },
    oriel: { fr: 'Recommandation chiffrée : ', en: 'Costed recommendation: ' }, solen: { fr: 'Si tu veux mon avis : ', en: 'If you want my view: ' },
  };
  const sentence = (t: string): string => t.trim().replace(/[.!?…]+$/, '');
  return pickOptions(input.options, input.skipped).map((o, i) => ({
    id: o.id, title: o.title?.[L] ?? titleOf(o.label[L]),
    line: `${i === 0 ? opener[input.persona][L] : ''}${sentence(o.label[L])}. ${o.gain[L].charAt(0).toUpperCase()}${sentence(o.gain[L]).slice(1)}.${i === 2 ? ` ${voice.catchphrases[0] ?? ''}` : ''}`.trim().slice(0, 240),
    command: o.command, show: o.show ?? null, ...(o.raw !== undefined ? { raw: o.raw } : {}),
  }));
}

const degradeReason = (err: unknown): DegradeReason => (err instanceof LlmUnavailable && (err.reason === 'saturated' || err.reason === 'open') ? 'saturated' : 'unavailable');

/** Three cards in the General's voice, within the 3 s budget of the task; fallback cards otherwise. */
export async function writeCounsel(input: CounselInput, client: LlmClient | null): Promise<CounselResult> {
  if (input.tier <= 0 && !input.options.length) return { cards: firstCards(input.persona, input.lang), source: 'fallback', numbersStripped: false };
  const chosen = pickOptions(input.options, input.skipped);
  if (!chosen.length) return { cards: [], source: 'fallback', numbersStripped: false };
  const fallback = fallbackCards({ ...input, options: chosen });
  if (input.overQuota) return { cards: fallback, source: 'degraded', degradeReason: 'quota', numbersStripped: false };
  if (!client) return { cards: fallback, source: 'fallback', numbersStripped: false };
  const L = input.lang;
  const optText = chosen.map((o, i) => `${i + 1}. [${o.id}] ${o.label[L]} — ${L === 'fr' ? 'gain' : 'gain'}: ${o.gain[L]} — ${L === 'fr' ? 'risque' : 'risk'} ${o.risk}`).join('\n');
  const system = systemPrompt({
    persona: input.persona, lang: L, crisis: input.crisis ?? false, seed: input.seed ?? optText, focus: 'advice', primer: false,
    analysis: `${input.analysis ?? ''}\n\nOPTIONS FOR THIS COUNSEL (the only ones you may propose, keep their ids):\n${optText}`, memory: input.memory ?? '',
    contract: [
      `TASK: ${input.minutesToDraw} minutes before the Draw, propose these options to the player as cards, in your voice, in the player's language.`,
      'Answer ONLY with JSON: {"cards": [{"id": "<option id>", "title": "3 to 6 words", "line": "one or two sentences: what it does and why now, with the option\'s figures"}]}. One card per option, same order, never invent an option or a figure.',
    ],
  });
  const allowed = new Set<number>([...RULE_NUMBERS, ...numbersIn(optText), ...numbersIn(input.analysis ?? '')]);
  for (const v of [...allowed]) { allowed.add(Math.round(v)); if (v >= 100) allowed.add(Math.round(v / 10) * 10); }
  try {
    const ans = await askJson(client, { task: 'counsel', schema: COUNSEL_JSON_SCHEMA, zod: CounselOutputSchema, repair: false, messages: [{ role: 'system', content: system }, { role: 'user', content: L === 'fr' ? 'Mes cartes.' : 'My cards.' }] });
    let stripped = false;
    const byId = new Map(chosen.map((o) => [o.id, o]));
    const cards: CounselCard[] = [];
    for (const c of ans.value.cards) {
      const o = byId.get(c.id);
      if (!o) continue;
      const check = verifyNumbers(c.line, allowed);
      if (!check.ok) stripped = true;
      const line = (check.ok ? c.line : check.stripped).trim() || fallback.find((f) => f.id === o.id)!.line;
      cards.push({ id: o.id, title: c.title.trim().slice(0, 60), line: line.slice(0, 240), command: o.command, show: o.show ?? null, ...(o.raw !== undefined ? { raw: o.raw } : {}) });
    }
    for (const f of fallback) if (!cards.some((c) => c.id === f.id)) cards.push(f); // the model dropped one: the fallback card fills in
    return { cards: cards.slice(0, 3), source: 'llm', numbersStripped: stripped };
  } catch (err) {
    if (err instanceof LlmUnavailable) return { cards: fallback, source: 'degraded', degradeReason: degradeReason(err), numbersStripped: false };
    return { cards: fallback, source: 'fallback', numbersStripped: false };
  }
}

/** The line the General says when a card is taken or set aside (no model). */
export function counselAck(persona: Persona, lang: Lang, taken: boolean, seed: string | number): string {
  const s = sheetOf(persona);
  if (taken) {
    const ack: Record<Persona, Record<Lang, string>> = { vane: { fr: 'Exécuté. Je te dis au Tirage ce que ça a donné.', en: 'Done. I tell you at the Draw what it gave.' }, kestrel: { fr: 'Ça, c\'est parlé. On voit au Tirage.', en: 'Now we are talking. We see at the Draw.' }, oriel: { fr: 'Ordre passé. Le retour se lira au Tirage.', en: 'Order placed. The return reads at the Draw.' }, solen: { fr: 'C\'est fait, mon ami. Le Signal nous dira le reste au Tirage.', en: 'Done, my friend. The Signal tells us the rest at the Draw.' } };
    return ack[persona][lang];
  }
  const skip: Record<Persona, Record<Lang, string>> = { vane: { fr: 'Noté. Je ne le reproposerai pas ce Tirage.', en: 'Noted. I will not propose it again this Draw.' }, kestrel: { fr: 'Dommage. J\'aurai autre chose au prochain Tirage.', en: 'Shame. I will have something else at the next Draw.' }, oriel: { fr: 'Écarté. Le coût d\'opportunité est consigné.', en: 'Set aside. The opportunity cost is on the books.' }, solen: { fr: 'Comme tu veux. Je m\'en souviendrai, sans insister.', en: 'As you wish. I will remember it, without insisting.' } };
  void seed; void s;
  return skip[persona][lang];
}

/** In-character line when the counsel itself could not be written (kept for the client's banner). */
export const counselDegraded = (persona: Persona, lang: Lang, reason: DegradeReason, seed: string | number): string => degradedReply(persona, lang, reason, seed);
