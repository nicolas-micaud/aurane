import type { CounselKind, CounselOption } from './counsel.js';

/**
 * Fixed lines for the Counsel cards, FR and EN, one per kind: what the client shows when the General's voice
 * has not spoken yet, and what the LLM layer receives as the option's label. One source for both.
 */
const LINES: Record<CounselKind, { fr: string; en: string }> = {
  touch_star: { fr: '{system}, ta capitale. Touche-la : tout part d\'ici. Les étoiles autour sont à portée de relais.', en: '{system}, your capital. Touch it: everything starts here. The stars around are within relay range.' },
  enter_system: { fr: 'Entre dans {system} : le plateau, c\'est là qu\'on construit. Trois orbites, trois métiers : Industrie, Défense, Signal.', en: 'Enter {system}: the plateau is where we build. Three orbits, three trades: Industry, Defence, Signal.' },
  link_first: { fr: 'Relie {to} depuis {from} : {metal} Métal, {energy} Énergie. Un système relié, c\'est ton premier revenu.', en: 'Link {to} from {from}: {metal} Metal, {energy} Energy. A connected system is your first income.' },
  link_more: { fr: 'Le Métal est là : relie {to} depuis {from} ({metal} Métal). Chaque système relié compte au Tirage.', en: 'The Metal is there: link {to} from {from} ({metal} Metal). Every connected system counts at the Draw.' },
  warehouse: { fr: '{lost} ressources perdues au dernier Tirage, entrepôts pleins. Un Entrepôt à {system} et on garde tout.', en: '{lost} resources lost at the last Draw, warehouses full. A Warehouse at {system} and we keep it all.' },
  antenna: { fr: 'Une Antenne à {system} révèle les secteurs voisins : on voit venir avant de subir.', en: 'An Antenna at {system} reveals the neighbouring sectors: we see it coming before it hits.' },
  turret: { fr: '{ships} vaisseaux ennemis sur {system}, arrivée dans {eta} min. Une tourelle légère sur l\'orbite Défense, maintenant.', en: '{ships} enemy ships on {system}, arriving in {eta} min. A light turret on the Defence orbit, now.' },
  defend: { fr: 'Ta flotte de {ships} vaisseaux est libre : envoie-la défendre {system}.', en: 'Your fleet of {ships} ships is free: send it to defend {system}.' },
  buy_energy: { fr: 'Plus que {draws} Tirage(s) d\'Énergie pour les relais. J\'achète {qty} Énergie au Marché ({credits} Crédits) avant que le Réseau s\'éteigne.', en: 'Only {draws} Draw(s) of Energy left for the relays. I buy {qty} Energy at the Market ({credits} Credits) before the Network goes dark.' },
  sell_surplus: { fr: '{qty} {resource} dorment à la capitale. Vends-les au Marché : environ {credits} Crédits au Tirage.', en: '{qty} {resource} sleep at the capital. Sell them at the Market: about {credits} Credits at the Draw.' },
  train: { fr: 'Le Chantier est ouvert et rien ne vole. {count} corvettes à {system}, pour voir venir et escorter.', en: 'The Shipyard is open and nothing flies. {count} corvettes at {system}, to see and to escort.' },
  treaty: { fr: '{colony} nous voit. Un pacte de non-agression coûte 7 Influence et vaut un pont.', en: '{colony} can see us. A non-aggression pact costs 7 Influence and is worth a bridge.' },
  doctrine: { fr: 'Dis-moi ce que tu veux : défendre, commercer, t\'étendre. Une phrase suffit, je m\'en occupe.', en: 'Tell me what you want: defend, trade, expand. One sentence is enough, I take it from there.' },
  read_recap: { fr: 'Le Tirage {draw} est passé : lis ce qu\'il a produit, c\'est ta feuille de route pour l\'heure.', en: 'Draw {draw} is done: read what it produced, it is your road map for the hour.' },
};

/** Card titles. Every card that acts on something names it ("Relier Israzen", "Antenne à Vennyxdra-84"): two cards
 *  of the same kind in a row never read the same (issue #35), and a done card says which goal was reached. */
const TITLES: Record<CounselKind, { fr: string; en: string }> = {
  touch_star: { fr: 'Toucher {system}', en: 'Touch {system}' }, enter_system: { fr: 'Entrer dans {system}', en: 'Enter {system}' },
  link_first: { fr: 'Relier {to}', en: 'Link {to}' }, link_more: { fr: 'Relier {to}', en: 'Link {to}' },
  warehouse: { fr: 'Entrepôt à {system}', en: 'Warehouse at {system}' }, antenna: { fr: 'Antenne à {system}', en: 'Antenna at {system}' },
  turret: { fr: 'Tourelle à {system}', en: 'Turret at {system}' }, defend: { fr: 'Défendre {system}', en: 'Defend {system}' },
  buy_energy: { fr: 'Acheter de l\'Énergie', en: 'Buy Energy' }, sell_surplus: { fr: '{resource} au Marché', en: '{resource} to the Market' },
  train: { fr: 'Corvettes à {system}', en: 'Corvettes at {system}' }, treaty: { fr: 'Pacte avec {colony}', en: 'Pact with {colony}' },
  doctrine: { fr: 'Ta doctrine', en: 'Your doctrine' }, read_recap: { fr: 'Compte rendu du Tirage {draw}', en: 'Draw {draw} recap' },
};

/** What a reached card says in the « ✓ Fait ce Tirage » line: the goal in the past, target named ("Relié Arnophe",
 *  "Linked Arnophe"), so the line reads as done, not as advice (issue #35). */
const DONE_TITLES: Record<CounselKind, { fr: string; en: string }> = {
  touch_star: { fr: 'Vu {system}', en: 'Looked at {system}' }, enter_system: { fr: 'Entré dans {system}', en: 'Entered {system}' },
  link_first: { fr: 'Relié {to}', en: 'Linked {to}' }, link_more: { fr: 'Relié {to}', en: 'Linked {to}' },
  warehouse: { fr: 'Entrepôt construit à {system}', en: 'Built a Warehouse at {system}' }, antenna: { fr: 'Antenne construite à {system}', en: 'Built an Antenna at {system}' },
  turret: { fr: 'Tourelle construite à {system}', en: 'Built a turret at {system}' }, defend: { fr: 'Flotte envoyée à {system}', en: 'Sent the fleet to {system}' },
  buy_energy: { fr: 'Énergie achetée', en: 'Bought Energy' }, sell_surplus: { fr: 'Vendu au Marché : {resource}', en: 'Sold {resource} at the Market' },
  train: { fr: 'Corvettes lancées à {system}', en: 'Trained corvettes at {system}' }, treaty: { fr: 'Pacte proposé à {colony}', en: 'Offered a pact to {colony}' },
  doctrine: { fr: 'Doctrine donnée', en: 'Gave your doctrine' }, read_recap: { fr: 'Compte rendu du Tirage {draw} lu', en: 'Read the Draw {draw} recap' },
};

/** Untargeted titles, for a card whose target is unknown (an option without its params). */
const GENERIC_TITLES: Record<CounselKind, { fr: string; en: string }> = {
  touch_star: { fr: 'Toucher ton étoile', en: 'Touch your star' }, enter_system: { fr: 'Entrer dans ton système', en: 'Enter your system' },
  link_first: { fr: 'Relier une voisine', en: 'Link a neighbour' }, link_more: { fr: 'Un relais de plus', en: 'One more relay' },
  warehouse: { fr: 'Un Entrepôt', en: 'A Warehouse' }, antenna: { fr: 'Une Antenne', en: 'An Antenna' },
  turret: { fr: 'Une tourelle', en: 'A turret' }, defend: { fr: 'Défendre', en: 'Defend' },
  buy_energy: TITLES.buy_energy, sell_surplus: { fr: 'Vendre le surplus', en: 'Sell the surplus' },
  train: { fr: 'Des corvettes', en: 'Corvettes' }, treaty: { fr: 'Un pacte', en: 'A pact' },
  doctrine: TITLES.doctrine, read_recap: { fr: 'Le compte rendu', en: 'The recap' },
};

const RESOURCE_NAMES: Record<string, { fr: string; en: string }> = {
  metal: { fr: 'Métal', en: 'Metal' }, energy: { fr: 'Énergie', en: 'Energy' }, food: { fr: 'Vivres', en: 'Food' }, crystal: { fr: 'Cristal', en: 'Crystal' }, rium: { fr: 'Rium', en: 'Rium' },
};

export function fillCounsel(tpl: string, params: Record<string, string | number>, lang: 'fr' | 'en'): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => { const v = params[k]; if (v === undefined) return ''; return typeof v === 'string' && RESOURCE_NAMES[v] ? RESOURCE_NAMES[v]![lang] : String(v); });
}

export const counselLine = (o: Pick<CounselOption, 'kind' | 'params'>, lang: 'fr' | 'en'): string => fillCounsel(LINES[o.kind][lang], o.params, lang);
const hasAll = (tpl: string, params: Record<string, string | number>): boolean => [...tpl.matchAll(/\{(\w+)\}/g)].every((m) => params[m[1]!] !== undefined && params[m[1]!] !== '');

/** The card's title with its target ("Relier Israzen"); the untargeted one when a placeholder has no value. */
export function counselTitle(o: Pick<CounselOption, 'kind'> & { params?: Record<string, string | number> }, lang: 'fr' | 'en'): string {
  const tpl = TITLES[o.kind][lang], params = o.params ?? {};
  return hasAll(tpl, params) ? fillCounsel(tpl, params, lang) : GENERIC_TITLES[o.kind][lang];
}

/** The card once its goal is reached, in the past ("Relié Arnophe" / "Linked Arnophe"); null when a target is missing. */
export function counselDoneTitle(o: Pick<CounselOption, 'kind'> & { params?: Record<string, string | number> }, lang: 'fr' | 'en'): string | null {
  const tpl = DONE_TITLES[o.kind][lang], params = o.params ?? {};
  return hasAll(tpl, params) ? fillCounsel(tpl, params, lang) : null;
}
