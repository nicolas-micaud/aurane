// Semantic validation of a doctrine: the schema says the shape is right, this says the content makes
// sense. Contradictions become one clarification question instead of a guess.
import { RESOURCES, type Policy } from '@aurane/protocol';
import type { DoctrineContext } from '../doctrine.js';

export type IssueKind = 'buy_above_sell' | 'pacifist_but_aggressive' | 'defend_unknown' | 'never_unknown' | 'reserve_out_of_range' | 'price_out_of_range' | 'defend_all' | 'sell_what' | 'expansion_frozen_but_grow';
export interface Issue { kind: IssueKind; detail: string; /** Blocking issues need a question; others are fixed silently and reported. */ blocking: boolean }

const RES_WORDS: Record<string, string[]> = { metal: ['métal', 'metal'], energy: ['énergie', 'energie', 'energy'], food: ['vivres', 'nourriture', 'food'], crystal: ['cristal', 'crystal'], rium: ['rium'] };

/** Fix what can be fixed, flag what cannot. Returns the corrected policy and the issues found. */
export function semanticCheck(policy: Policy, ctx: DoctrineContext, text = ''): { policy: Policy; issues: Issue[] } {
  const p: Policy = { ...policy, reserves: { ...policy.reserves }, sellAbove: { ...policy.sellAbove }, buyBelow: { ...policy.buyBelow }, defendFirst: [...policy.defendFirst], neverAttack: [...policy.neverAttack], trustedTraders: [...policy.trustedTraders] };
  const issues: Issue[] = [];
  for (const r of RESOURCES) {
    const s = p.sellAbove[r], b = p.buyBelow[r];
    if (s !== undefined && b !== undefined && b > s) issues.push({ kind: 'buy_above_sell', detail: r, blocking: true });
    const res = p.reserves[r];
    if (res !== undefined && (res < 0 || res > 5000)) { p.reserves[r] = Math.min(5000, Math.max(0, res)); issues.push({ kind: 'reserve_out_of_range', detail: r, blocking: false }); }
    for (const [k, map] of [['sellAbove', p.sellAbove], ['buyBelow', p.buyBelow]] as const) {
      const v = map[r];
      if (v !== undefined && (v < 0 || v > 50)) { map[r] = Math.min(50, Math.max(0, v)); issues.push({ kind: 'price_out_of_range', detail: `${k}.${r}`, blocking: false }); }
    }
  }
  const unknownDefend = p.defendFirst.filter((id) => !(id in ctx.systems) && id !== '__capital__');
  if (unknownDefend.length) { p.defendFirst = p.defendFirst.filter((id) => !unknownDefend.includes(id)); issues.push({ kind: 'defend_unknown', detail: unknownDefend.join(','), blocking: false }); }
  const unknownNever = p.neverAttack.filter((id) => !(id in ctx.colonies) && !(id in ctx.alliances));
  if (unknownNever.length) { p.neverAttack = p.neverAttack.filter((id) => !unknownNever.includes(id)); issues.push({ kind: 'never_unknown', detail: unknownNever.join(','), blocking: false }); }
  const t = text.toLowerCase();
  const pacifist = /jamais la guerre|pacifi|sans moi|without me|no attack|n'attaque jamais|never attack(?! [a-z])|pas de guerre|no war/.test(t);
  const warlike = /\b(raid|attaque|attack|harc[eè]le|harass|pille|plunder|conqu)/.test(t);
  if (pacifist && warlike && !/sauf|except|mais|but/.test(t)) issues.push({ kind: 'pacifist_but_aggressive', detail: '', blocking: true });
  if (pacifist && p.aggression > 0 && !warlike) { p.aggression = 0; }
  // "Defend everything" without a named system is ambiguous whatever the model filled in: the question is asked from the text.
  const namesInText = Object.values(ctx.systems).some((n) => n.length >= 3 && t.includes(n.toLowerCase()));
  if (/défends? tout|defend everything|protect everything|tiens tout/.test(t) && !namesInText && !/capitale|capital/.test(t)) issues.push({ kind: 'defend_all', detail: '', blocking: true });
  if (/vends? (le |du |mon |the )?surplus\b|sell (the |my )?surplus\b/.test(t) && !/métal|metal|énergie|energie|energy|vivres|food|cristal|crystal|rium/.test(t)) issues.push({ kind: 'sell_what', detail: '', blocking: true });
  if (/(étends|expan|grandis|grow|expand)/.test(t) && /(ne t'étends pas|stop expand|no expansion|pas d'expansion|consolid)/.test(t)) issues.push({ kind: 'expansion_frozen_but_grow', detail: '', blocking: true });
  void RES_WORDS;
  return { policy: p, issues };
}

/** One clarification question, in the persona's register, for the first blocking issue. */
export function clarificationFor(issue: Issue, ctx: DoctrineContext, persona: 'vane' | 'kestrel' | 'oriel' | 'solen'): string {
  const L = ctx.lang;
  const names = Object.values(ctx.systems).slice(0, 3).join(', ');
  const fr: Record<IssueKind, string> = {
    buy_above_sell: `Tu me demandes d'acheter ${issue.detail} plus cher que le plancher auquel je le vends. Lequel des deux compte : le prix d'achat ou le prix de vente ?`,
    pacifist_but_aggressive: 'Tu veux la paix et tu me parles de raids dans la même phrase. Je ne devine pas : paix totale, ou raids sur ordre seulement ?',
    defend_unknown: `Je ne connais pas ${issue.detail}. Quel système veux-tu que je défende en premier ?`,
    never_unknown: `Je ne connais pas ${issue.detail}. Qui ne dois-je jamais attaquer ?`,
    reserve_out_of_range: 'La réserve que tu demandes dépasse ce que les entrepôts peuvent tenir. Quel chiffre, entre 0 et 5000 ?',
    price_out_of_range: 'Ce prix est hors de tout ce que le Marché a jamais réglé. Quel seuil, entre 0 et 50 ?',
    defend_all: `Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou ${names || 'un avant-poste'} ?`,
    sell_what: 'Vendre le surplus, oui : de quelle ressource, et à quel plancher ? Sans plancher je vends au teneur de marché, à 40 % de la référence.',
    expansion_frozen_but_grow: 'Tu me demandes de m\'étendre et de consolider dans le même souffle. Lequel des deux, pour les six prochains Tirages ?',
  };
  const en: Record<IssueKind, string> = {
    buy_above_sell: `You ask me to buy ${issue.detail} dearer than the floor I sell it at. Which one counts: the buying price or the selling price?`,
    pacifist_but_aggressive: 'You want peace and you speak of raids in the same breath. I do not guess: total peace, or raids on your order only?',
    defend_unknown: `I do not know ${issue.detail}. Which system do you want defended first?`,
    never_unknown: `I do not know ${issue.detail}. Whom must I never attack?`,
    reserve_out_of_range: 'The reserve you ask for exceeds what the warehouses can hold. Which figure, between 0 and 5000?',
    price_out_of_range: 'That price is outside anything the Market has ever settled. Which threshold, between 0 and 50?',
    defend_all: `I cannot hold everything, nobody can. Which first: the capital, or ${names || 'an outpost'}?`,
    sell_what: 'Sell the surplus, yes: of which resource, and at what floor? Without a floor I sell to the market maker at 40 % of reference.',
    expansion_frozen_but_grow: 'You ask me to expand and to consolidate in the same breath. Which one, for the next six Draws?',
  };
  const q = (L === 'fr' ? fr : en)[issue.kind];
  const voice: Record<typeof persona, { fr: string; en: string }> = { vane: { fr: 'Un chiffre, un nom. ', en: 'One number, one name. ' }, kestrel: { fr: 'Dis-moi juste : ', en: 'Just tell me: ' }, oriel: { fr: 'Précision requise. ', en: 'Precision required. ' }, solen: { fr: 'Aide-moi à te comprendre, mon ami. ', en: 'Help me understand you, my friend. ' } };
  return `${voice[persona][L]}${q}`;
}
