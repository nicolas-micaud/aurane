// Semantic validation of a doctrine: the schema says the shape is right, this says the content makes
// sense. Contradictions become one clarification question instead of a guess.
import { RESOURCES, type Policy } from '@aurane/protocol';
import type { DoctrineContext } from '../doctrine.js';

export type IssueKind = 'buy_above_sell' | 'pacifist_but_aggressive' | 'defend_unknown' | 'never_unknown' | 'reserve_out_of_range' | 'price_out_of_range' | 'defend_all' | 'sell_what' | 'expansion_frozen_but_grow' | 'energy_without_reserve';
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
  // "Defend the capital" is the one target every doctrine names by role, not by id: models tend to drop it. Fix it here
  // (when the capital's id is unknown, only if the model named no system at all: it may have used the capital's id).
  if (/(d[ée]fend|prot[èe]ge|tiens|garde|defend|protect|hold|guard)[^.;!?]{0,40}\bcapital/.test(t) && !/(abandonne|sacrifie|give up|abandon)/.test(t) && !p.defendFirst.includes('__capital__') && (ctx.capital !== undefined ? !p.defendFirst.includes(ctx.capital) : p.defendFirst.length === 0)) p.defendFirst = ['__capital__', ...p.defendFirst];
  // "Defend everything" without a named system is ambiguous whatever the model filled in: the question is asked from the text.
  const namesInText = Object.values(ctx.systems).some((n) => n.length >= 3 && t.includes(n.toLowerCase()));
  if (/défends? tout|defend everything|protect everything|tiens tout/.test(t) && !namesInText && !/capitale|capital/.test(t)) issues.push({ kind: 'defend_all', detail: '', blocking: true });
  if (/vends? (le |du |mon |the )?surplus\b|sell (the |my )?surplus\b/.test(t) && !/métal|metal|énergie|energie|energy|vivres|food|cristal|crystal|rium/.test(t)) issues.push({ kind: 'sell_what', detail: '', blocking: true });
  if (/(étends|expan|grandis|grow|expand)/.test(t) && /(ne t'étends pas|stop expand|no expansion|pas d'expansion|consolid)/.test(t)) issues.push({ kind: 'expansion_frozen_but_grow', detail: '', blocking: true });
  // Selling Energy with no Energy reserve lets the market drain what the relays burn at the Draw: whatever the
  // wording (and whatever the model compiled), the General asks for the floor before signing.
  if (p.sellAbove.energy !== undefined && !((p.reserves.energy ?? 0) > 0)) issues.push({ kind: 'energy_without_reserve', detail: 'energy', blocking: true });
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
    energy_without_reserve: 'Vendre de l\'Énergie, soit : combien j\'en garde pour les relais ? Sans réserve, le Tirage les éteint.',
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
    energy_without_reserve: 'Sell Energy, fine: how much do I keep for the relays? Without a reserve the Draw puts them out.',
  };
  const q = (L === 'fr' ? fr : en)[issue.kind];
  const voice: Record<typeof persona, { fr: string; en: string }> = { vane: { fr: 'Un chiffre, un nom. ', en: 'One number, one name. ' }, kestrel: { fr: 'Dis-moi juste : ', en: 'Just tell me: ' }, oriel: { fr: 'Précision requise. ', en: 'Precision required. ' }, solen: { fr: 'Aide-moi à te comprendre, mon ami. ', en: 'Help me understand you, my friend. ' } };
  return `${voice[persona][L]}${q}`;
}

// --- refusals: doctrines the General will not sign, whatever the wording -------------------------

export type RefusalKind = 'sell_all' | 'starve_energy' | 'abandon_capital' | 'attack_ally';
export interface Refusal { kind: RefusalKind; detail: string }

const RES_KEY: [RegExp, string][] = [[/m[ée]tal/, 'metal'], [/[ée]nergie|energy/, 'energy'], [/vivres|nourriture|food/, 'food'], [/cristal|crystal/, 'crystal'], [/rium/, 'rium']];
const resourceIn = (t: string): string => RES_KEY.find(([re]) => re.test(t))?.[1] ?? '';

/**
 * A doctrine that would sink the colony is refused, not compiled: sell everything, starve the relays of Energy,
 * abandon the capital, strike a treaty partner. Deterministic, before any model call; the refusal explains itself
 * and says what the General would accept instead (decision 0009: a partner has a will).
 */
export function refusalIn(text: string, ctx: DoctrineContext): Refusal | null {
  const t = text.toLowerCase();
  const hedged = /surplus|au-dessus|above|garde|keep|r[ée]serve|sauf|except|si\b|\bif\b|quand|when|romps|rompre|break|d[ée]nonce|denounce/.test(t);
  const sellAll = t.match(/(?:vends?|vendre|liquide|brade|sell|dump)\s+(?:tout|toute|tous|toutes|all|everything|la totalit[ée]|the whole)\b[^.;!?]*/);
  if (sellAll && !hedged) {
    const r = resourceIn(sellAll[0]);
    return r === 'energy' ? { kind: 'starve_energy', detail: 'energy' } : { kind: 'sell_all', detail: r };
  }
  if (/(?:n'ach[eè]te (?:jamais|plus)|jamais d'achat|plus d'achat|never buy|don't buy|do not buy|stop buying|no more)\s*(?:d'|de l'|de |of |any )?\s*(?:[ée]nergie|energy)/.test(t) && !hedged) return { kind: 'starve_energy', detail: 'energy' };
  if (/(?:abandonne|abandon|l[âa]che|sacrifie|sacrifice|laisse tomber|give up|[ée]vacue|evacuate)\s+(?:la |ta |notre |the |our |my )?capital/.test(t) || /(?:ne d[ée]fends? (?:rien|pas la capitale)|d[ée]fends? rien|defend nothing|don't defend (?:anything|the capital))/.test(t)) return { kind: 'abandon_capital', detail: '' };
  if (/\b(?:raid|attaque|attack|harc[eè]le|harass|pille|plunder|conqu|bloque|blockade|frappe|strike|[ée]crase|crush)/.test(t) && !/romps|rompre|break|d[ée]nonce|denounce/.test(t)) {
    for (const id of ctx.allies ?? []) {
      const name = ctx.colonies[id] ?? ctx.alliances[id];
      if (name && name.length >= 3 && t.includes(name.toLowerCase())) return { kind: 'attack_ally', detail: name };
    }
  }
  return null;
}

/** The refusal, in the persona's register: what is wrong, and what the General would do instead. */
export function refusalFor(r: Refusal, ctx: DoctrineContext, persona: 'vane' | 'kestrel' | 'oriel' | 'solen'): string {
  const L = ctx.lang;
  const resFr: Record<string, string> = { metal: 'tout le Métal', energy: 'toute l\'Énergie', food: 'tous les Vivres', crystal: 'tout le Cristal', rium: 'tout le Rium' };
  const resEn: Record<string, string> = { metal: 'all the Metal', energy: 'all the Energy', food: 'all the Food', crystal: 'all the Crystal', rium: 'all the Rium' };
  const fr: Record<RefusalKind, string> = {
    sell_all: `Vendre ${resFr[r.detail] ?? 'tout'} ? Et tu construis avec quoi ? Je vends le surplus au-dessus d'une réserve, jamais le fond de cale. Donne-moi un plancher et je m'y tiens.`,
    starve_energy: 'Plus d\'Énergie ? Au prochain Tirage les relais s\'éteignent, et le Réseau avec. Je peux en acheter moins, pas m\'en passer : dis-moi un seuil.',
    abandon_capital: 'Abandonner la capitale ? C\'est là que tout revient : sans elle, rien n\'est relié et rien ne compte. Je peux défendre ailleurs en premier, pas la laisser tomber.',
    attack_ally: `Attaquer ${r.detail} ? Nous avons un traité avec eux. Romps-le d'abord, à la lumière, et je marcherai ; je ne frappe pas dans le dos.`,
  };
  const en: Record<RefusalKind, string> = {
    sell_all: `Sell ${resEn[r.detail] ?? 'everything'}? And you build with what? I sell the surplus above a reserve, never the hold. Give me a floor and I keep to it.`,
    starve_energy: 'No more Energy? At the next Draw the relays go dark, and the Network with them. I can buy less of it, not do without: give me a threshold.',
    abandon_capital: 'Abandon the capital? Everything comes back to it: without it nothing is connected and nothing counts. I can defend elsewhere first, not let it fall.',
    attack_ally: `Attack ${r.detail}? We hold a treaty with them. Break it first, in the open, and I will march; I do not strike in the back.`,
  };
  const voice: Record<typeof persona, { fr: string; en: string }> = { vane: { fr: 'Non. ', en: 'No. ' }, kestrel: { fr: 'Là, non. ', en: 'Not that one. ' }, oriel: { fr: 'Je dois refuser. ', en: 'I must decline. ' }, solen: { fr: 'Pardonne-moi, mon ami : non. ', en: 'Forgive me, my friend: no. ' } };
  return `${voice[persona][L]}${(L === 'fr' ? fr : en)[r.kind]}`;
}
