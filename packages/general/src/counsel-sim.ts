// Bridge between the simulation's Counsel (packages/sim/src/counsel.ts, decision 0009: `PlayerView.me.counsel`,
// options { id, kind, urgency, command, show, cost, params }) and the LLM layer's CounselOption. Typed structurally so
// this package needs nothing from a sim that may not carry the Counsel yet. The fixed lines mirror the client's
// (apps/web/src/i18n, key `counsel`): they are what the General rephrases, and what the client shows meanwhile.
import type { Command, Stock } from '@aurane/protocol';
import { counselLine, counselTitle } from '@aurane/sim';
import type { CounselOption, ShowTarget } from './counsel.js';

export type SimCounselKind = 'touch_star' | 'enter_system' | 'link_first' | 'link_more' | 'warehouse' | 'antenna' | 'turret' | 'defend' | 'buy_energy' | 'sell_surplus' | 'train' | 'treaty' | 'doctrine' | 'read_recap';
export interface SimCounselOption {
  id: string;
  kind: SimCounselKind | string;
  urgency: 0 | 1 | 2 | number;
  command: Command | null;
  show: { kind: string; [k: string]: unknown };
  cost: Partial<Stock> & { credits?: number };
  params: Record<string, string | number>;
}

export const SIM_COUNSEL_LINES: Record<'fr' | 'en', Record<SimCounselKind, string>> = {
  fr: {
    touch_star: '{system}, ta capitale. Touche-la : tout part d\'ici. Les étoiles autour sont à portée de relais.',
    enter_system: 'Entre dans {system} : le plateau, c\'est là qu\'on construit. Trois orbites, trois métiers : Industrie, Défense, Signal.',
    link_first: 'Relie {to} depuis {from} : {metal} Métal, {energy} Énergie. Un système relié, c\'est ton premier revenu.',
    link_more: 'Le Métal est là : relie {to} depuis {from} ({metal} Métal). Chaque système relié compte au Tirage.',
    warehouse: '{lost} ressources perdues au dernier Tirage, entrepôts pleins. Un Entrepôt à {system} et on garde tout.',
    antenna: 'Une Antenne à {system} révèle les secteurs voisins : on voit venir avant de subir.',
    turret: '{ships} vaisseaux ennemis sur {system}, arrivée dans {eta} min. Une tourelle légère sur l\'orbite Défense, maintenant.',
    defend: 'Ta flotte de {ships} vaisseaux est libre : envoie-la défendre {system}.',
    buy_energy: 'Plus que {draws} Tirage(s) d\'Énergie pour les relais. J\'achète {qty} Énergie au Marché ({credits} Crédits) avant que le Réseau s\'éteigne.',
    sell_surplus: '{qty} {resource} dorment à la capitale. Vends-les au Marché : environ {credits} Crédits au Tirage.',
    train: 'Le Chantier est ouvert et rien ne vole. {count} corvettes à {system}, pour voir venir et escorter.',
    treaty: '{colony} nous voit. Un pacte de non-agression coûte 7 Influence et vaut un pont.',
    doctrine: 'Dis-moi ce que tu veux : défendre, commercer, t\'étendre. Une phrase suffit, je m\'en occupe.',
    read_recap: 'Le Tirage {draw} est passé : lis ce qu\'il a produit, c\'est ta feuille de route pour l\'heure.',
  },
  en: {
    touch_star: '{system}, your capital. Touch it: everything starts here. The stars around are within relay range.',
    enter_system: 'Enter {system}: the plateau is where we build. Three orbits, three trades: Industry, Defence, Signal.',
    link_first: 'Link {to} from {from}: {metal} Metal, {energy} Energy. A connected system is your first income.',
    link_more: 'The Metal is there: link {to} from {from} ({metal} Metal). Every connected system counts at the Draw.',
    warehouse: '{lost} resources lost at the last Draw, warehouses full. A Warehouse at {system} and we keep it all.',
    antenna: 'An Antenna at {system} reveals the neighbouring sectors: we see it coming before it hits.',
    turret: '{ships} enemy ships on {system}, arriving in {eta} min. A light turret on the Defence orbit, now.',
    defend: 'Your fleet of {ships} ships is free: send it to defend {system}.',
    buy_energy: 'Only {draws} Draw(s) of Energy left for the relays. I buy {qty} Energy at the Market ({credits} Credits) before the Network goes dark.',
    sell_surplus: '{qty} {resource} sleep at the capital. Sell them at the Market: about {credits} Credits at the Draw.',
    train: 'The Shipyard is open and nothing flies. {count} corvettes at {system}, to see and to escort.',
    treaty: '{colony} can see us. A non-aggression pact costs 7 Influence and is worth a bridge.',
    doctrine: 'Tell me what you want: defend, trade, expand. One sentence is enough, I take it from there.',
    read_recap: 'Draw {draw} is done: read what it produced, it is your road map for the hour.',
  },
};

const GAINS: Record<'fr' | 'en', Record<SimCounselKind, string>> = {
  fr: { touch_star: 'tu sais d\'où tout part', enter_system: 'tu sais où l\'on construit', link_first: 'un premier système relié, +1 point par Tirage', link_more: '+1 système relié, +1 point par Tirage', warehouse: 'plus rien ne se perd au Tirage', antenna: 'les secteurs voisins deviennent visibles', turret: 'le raid se heurte à un mur', defend: 'des coques face aux leurs', buy_energy: 'les relais restent allumés', sell_surplus: 'des Crédits au Tirage', train: 'une première escorte', treaty: 'sept jours de paix garantis', doctrine: 'le Général joue tes règles, même absent', read_recap: 'ta feuille de route pour l\'heure' },
  en: { touch_star: 'you know where everything starts', enter_system: 'you know where we build', link_first: 'a first connected system, +1 point per Draw', link_more: '+1 connected system, +1 point per Draw', warehouse: 'nothing is lost at the Draw any more', antenna: 'the neighbouring sectors become visible', turret: 'the raid hits a wall', defend: 'hulls against theirs', buy_energy: 'the relays stay lit', sell_surplus: 'Credits at the Draw', train: 'a first escort', treaty: 'seven days of guaranteed peace', doctrine: 'the General plays your rules, even when you are away', read_recap: 'your road map for the hour' },
};

export function fillLine(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

/** The sim's `show` as the LLM layer's ShowTarget (the raw object travels with the card too). */
export function showOf(s: SimCounselOption['show']): ShowTarget {
  switch (s.kind) {
    case 'star': return { screen: 'galaxy', system: String(s.system) };
    case 'link': return { screen: 'galaxy', system: String(s.from) };
    case 'plateau': return { screen: 'system', system: String(s.system), ...(s.orbit !== null && s.orbit !== undefined ? { slot: String(s.orbit) } : {}) };
    case 'tab': { const tab = String(s.tab); return { screen: tab === 'market' ? 'market' : tab === 'general' ? 'general' : tab === 'log' ? 'journal' : 'colony' }; }
    default: return { screen: 'galaxy' };
  }
}

const RISK: Record<number, CounselOption['risk']> = { 0: 'low', 1: 'low', 2: 'mid' };

/** The simulation's own line and short title for a kind it knows; our copy of the phrases otherwise. */
function simText(kind: SimCounselKind, params: Record<string, string | number>): { label: { fr: string; en: string }; title: { fr: string; en: string } | undefined } {
  try {
    const o = { kind, params } as Parameters<typeof counselLine>[0];
    return { label: { fr: counselLine(o, 'fr'), en: counselLine(o, 'en') }, title: { fr: counselTitle(o, 'fr'), en: counselTitle(o, 'en') } };
  } catch {
    return { label: { fr: fillLine(SIM_COUNSEL_LINES.fr[kind], params), en: fillLine(SIM_COUNSEL_LINES.en[kind], params) }, title: undefined };
  }
}

/** The simulation's options, ready for `writeCounsel`: label = the simulation's line filled in, title = its short title, gain per kind. */
export function fromSimCounsel(options: readonly SimCounselOption[]): CounselOption[] {
  return options.map((o) => {
    const kind = (o.kind in SIM_COUNSEL_LINES.fr ? o.kind : 'doctrine') as SimCounselKind;
    const text = simText(kind, o.params);
    return {
      id: o.id,
      label: text.label,
      ...(text.title ? { title: text.title } : {}),
      cost: o.cost, delayMin: 0,
      gain: { fr: GAINS.fr[kind], en: GAINS.en[kind] },
      risk: RISK[Math.max(0, Math.min(2, Math.round(o.urgency)))] ?? 'low',
      command: o.command,
      show: showOf(o.show),
      raw: o.show,
    };
  });
}
