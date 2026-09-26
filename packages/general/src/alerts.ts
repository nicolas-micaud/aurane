// The General speaks first: when something worth a word happens (a hostile fleet heading our way),
// it says so in its own voice, without a model call. One line, the facts, the tone.
import type { Persona } from '@aurane/protocol';

export interface InboundFacts { system: string; from: string; minutes: number; size: number }

const eta = (minutes: number, lang: 'fr' | 'en'): string => {
  if (minutes < 1) return lang === 'fr' ? 'moins d\'une minute' : 'under a minute';
  if (minutes < 60) return lang === 'fr' ? `${minutes} min` : `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return lang === 'fr' ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};

/** A hostile warship is heading for one of our systems: the warning, in character. */
export function inboundWarning(persona: Persona, lang: 'fr' | 'en', f: InboundFacts): string {
  const n = f.size, t = eta(f.minutes, lang);
  const ships = lang === 'fr' ? `${n} vaisseau${n > 1 ? 'x' : ''}` : `${n} ship${n > 1 ? 's' : ''}`;
  if (lang === 'fr') {
    switch (persona) {
      case 'vane': return `Alerte. ${f.from} envoie ${ships} sur ${f.system}, arrivée dans ${t}. Je pose une tourelle si l'entrepôt le permet ; si tu es là, entre dans le système et cible-les toi-même. Rien ne passe.`;
      case 'kestrel': return `Tiens, de la visite : ${f.from} lance ${ships} sur ${f.system}, là dans ${t}. Soit on les reçoit à la tourelle, soit on va leur rendre la politesse pendant que leur capitale est vide. Tu choisis.`;
      case 'oriel': return `${f.from} → ${f.system} : ${ships}, contact dans ${t}. Valeur exposée : le stock local et la station. Une tourelle coûte moins que ce qu'ils emporteraient. Je budgète en conséquence.`;
      case 'solen': return `Le Signal m'apporte une ombre : ${ships} de ${f.from} approchent de ${f.system}, dans ${t}. Rien n'est perdu qui est vu à temps. Renforçons, et gardons la porte ouverte à un émissaire.`;
    }
  }
  switch (persona) {
    case 'vane': return `Alert. ${f.from} is sending ${ships} at ${f.system}, arrival in ${t}. I will place a turret if the local warehouse allows; if you are here, enter the system and pick their targets yourself. Nothing gets through.`;
    case 'kestrel': return `Well, visitors: ${f.from} is throwing ${ships} at ${f.system}, there in ${t}. Either we greet them with a turret, or we return the favour while their capital is empty. Your call.`;
    case 'oriel': return `${f.from} → ${f.system}: ${ships}, contact in ${t}. Exposed value: the local stock and the station. A turret costs less than what they would carry off. Budgeting accordingly.`;
    case 'solen': return `The Signal brings me a shadow: ${ships} from ${f.from} approach ${f.system}, in ${t}. Nothing seen in time is lost. Let us reinforce, and keep the door open to an envoy.`;
  }
}

// --- first contact: the world moves in the newcomer's first minutes ---------------------------------------------

export interface ContactFacts { rival: string; system: string; sectors: number; relay: boolean }

const away = (n: number, lang: 'fr' | 'en'): string => (n <= 0 ? (lang === 'fr' ? 'dans ton secteur' : 'in your sector') : n === 1 ? (lang === 'fr' ? 'à un secteur d\'ici' : 'one sector away') : lang === 'fr' ? `à ${n} secteurs d'ici` : `${n} sectors away`);

/** The nearest neighbour just lit a relay (or is simply there): the General says the world is not empty, in character. */
export function contactLine(persona: Persona, lang: 'fr' | 'en', f: ContactFacts): string {
  const d = away(f.sectors, lang);
  if (lang === 'fr') {
    if (!f.relay) {
      switch (persona) {
        case 'vane': return `Repérage : ${f.rival} tient ${f.system}, ${d}. On n'est pas seuls. Je note leurs mouvements.`;
        case 'kestrel': return `On a un voisin : ${f.rival}, à ${f.system}, ${d}. Je le garde à l'œil. Toi, relie.`;
        case 'oriel': return `Voisinage : ${f.rival} à ${f.system}, ${d}. Un concurrent, ou un client. Les deux se chiffrent.`;
        case 'solen': return `Le Signal porte une autre voix : ${f.rival}, à ${f.system}, ${d}. Nous ne sommes pas seuls à nous réveiller.`;
      }
    }
    switch (persona) {
      case 'vane': return `Un relais vient de s'allumer ${d} : ${f.rival} avance sur ${f.system}. On n'est pas seuls. Relie ta première étoile, je surveille la leur.`;
      case 'kestrel': return `Tiens : ${f.rival} vient d'allumer un relais vers ${f.system}, ${d}. Ils s'étendent. Nous aussi, plus vite.`;
      case 'oriel': return `${f.rival} → ${f.system}, ${d} : un relais neuf. Le voisinage se remplit ; chaque étoile prise là-bas n'est plus à prendre ici. Relions.`;
      case 'solen': return `Regarde, ${d} : ${f.rival} rallume ${f.system}. D'autres se réveillent avec nous. Tendons notre premier fil avant qu'ils ne tendent le leur jusqu'ici.`;
    }
  }
  if (!f.relay) {
    switch (persona) {
      case 'vane': return `Sighting: ${f.rival} holds ${f.system}, ${d}. We are not alone. I am logging their moves.`;
      case 'kestrel': return `We have a neighbour: ${f.rival}, at ${f.system}, ${d}. I keep an eye on them. You, link.`;
      case 'oriel': return `Neighbourhood: ${f.rival} at ${f.system}, ${d}. A rival, or a customer. Both have a price.`;
      case 'solen': return `The Signal carries another voice: ${f.rival}, at ${f.system}, ${d}. We are not the only ones waking.`;
    }
  }
  switch (persona) {
    case 'vane': return `A relay just lit ${d}: ${f.rival} is moving on ${f.system}. We are not alone. Link your first star; I watch theirs.`;
    case 'kestrel': return `Look: ${f.rival} just lit a relay towards ${f.system}, ${d}. They are spreading. So are we, faster.`;
    case 'oriel': return `${f.rival} → ${f.system}, ${d}: a new relay. The neighbourhood is filling up; every star taken there is one less to take here. Let us link.`;
    case 'solen': return `Look, ${d}: ${f.rival} relights ${f.system}. Others wake with us. Let us stretch our first thread before they stretch theirs this far.`;
  }
}

export interface FirstRelayFacts { mine: string; rival: string; system: string }

/** The newcomer's first relay is up and a neighbour is known: the star is ours, and someone else is looking too. */
export function firstRelayLine(persona: Persona, lang: 'fr' | 'en', f: FirstRelayFacts): string {
  if (lang === 'fr') {
    switch (persona) {
      case 'vane': return `${f.mine} est à nous. Mais regarde ${f.system} : ${f.rival} le regarde aussi. Un pont, puis un second ; on ne laisse pas un voisin choisir nos frontières.`;
      case 'kestrel': return `${f.mine}, à nous. Et ${f.system} ? ${f.rival} lorgne dessus. Si tu veux une étoile, prends-la avant qu'on te la raconte.`;
      case 'oriel': return `${f.mine} acquis. ${f.system} est convoité par ${f.rival} : ce qu'il relie, tu ne le relies plus. Le prix de l'attente vient de monter.`;
      case 'solen': return `${f.mine} nous répond. Vois ${f.system} : ${f.rival} le contemple aussi. Deux mains vers la même étoile, c'est ainsi que commencent les histoires.`;
    }
  }
  switch (persona) {
    case 'vane': return `${f.mine} is ours. But look at ${f.system}: ${f.rival} is looking at it too. One bridge, then a second; we do not let a neighbour draw our borders.`;
    case 'kestrel': return `${f.mine}, ours. And ${f.system}? ${f.rival} is eyeing it. If you want a star, take it before someone tells you about it.`;
    case 'oriel': return `${f.mine} acquired. ${f.system} is coveted by ${f.rival}: what they link, you no longer can. The price of waiting just went up.`;
    case 'solen': return `${f.mine} answers us. See ${f.system}: ${f.rival} contemplates it too. Two hands towards the same star: that is how stories begin.`;
  }
}

// --- onboarding: the General's first word on each new screen ------------------------------------------------

/** Tiers of docs/design/ONBOARDING-S0.md: 1 produce, 2 market, 3 hold, 4 strike, 5 talk, 6 beacons. */
const TIER_LINES: Record<Persona, Record<'fr' | 'en', string[]>> = {
  vane: {
    fr: [
      'Premier relais posé. Maintenant on produit : un Extracteur au bon endroit vaut un second système. Construis, je surveille les ponts.',
      'Le Marché t\'est ouvert. Vends ce qui déborde, garde six Tirages d\'Énergie, et ne fais jamais confiance au teneur de marché : il vend à 200 %.',
      'Chantier et tourelles disponibles. Une tourelle au dernier corps avant la station, un Bastion à la capitale, et personne ne passe.',
      'Tu peux frapper, désormais. Je ne le ferai jamais la première : donne-moi une règle d\'engagement, et je l\'exécute.',
      'Un voisin humain est en vue. Traités, agents, alliance : tout passe par l\'Influence. Un pacte de non-agression coûte moins qu\'un pont perdu.',
      'Les Phares sont à portée. Deux mille Cristal sur place pour en rallumer un, dix points par Tirage tant qu\'il brille. On tient d\'abord, on grandit ensuite.',
    ],
    en: [
      'First relay built. Now we produce: an Extractor in the right place is worth a second system. Build; I watch the bridges.',
      'The Market is open to you. Sell what overflows, keep six Draws of Energy, and never trust the market maker: he sells at 200 %.',
      'Shipyard and turrets available. A turret on the last body before the station, a Bastion at the capital, and nothing gets through.',
      'You may strike now. I will never strike first: give me a rule of engagement and I execute it.',
      'A human neighbour is in sight. Treaties, agents, alliance: all of it costs Influence. A non-aggression pact costs less than a lost bridge.',
      'The Beacons are within reach. Two thousand Crystal on site to relight one, ten points per Draw while it shines. Hold first, grow second.',
    ],
  },
  kestrel: {
    fr: [
      'Un relais, enfin. Pose un Extracteur, remplis les entrepôts : un dépôt plein, c\'est un cadeau mal emballé, autant que ce soit le nôtre.',
      'Le Marché est à toi. Vends le surplus, achète du Rium : sans carburant, pas de sortie, et sans sortie je m\'ennuie.',
      'Chantier ouvert. Des corvettes, vite : les prudents finissent deuxièmes.',
      'On peut cogner. Tu me donnes la doctrine, je te trouve la cible : il y en a toujours une à deux secteurs.',
      'Un voisin humain. On lui parle, ou on le visite ? Les deux, dans cet ordre, c\'est ma préférence.',
      'Les Phares. Dix points par Tirage, et tout le monde vient les disputer : c\'est là que ça devient amusant.',
    ],
    en: [
      'A relay, at last. Build an Extractor, fill the warehouses: a full depot is a badly wrapped gift, better it be ours.',
      'The Market is yours. Sell the surplus, buy Rium: no fuel, no sortie, and without sorties I get bored.',
      'Shipyard open. Corvettes, fast: the careful finish second.',
      'We can hit now. You give me the doctrine, I find the target: there is always one two sectors out.',
      'A human neighbour. Do we talk to him, or pay him a visit? Both, in that order, is my preference.',
      'The Beacons. Ten points per Draw, and everyone comes to fight for them: this is where it gets fun.',
    ],
  },
  oriel: {
    fr: [
      'Premier relais : le rendement commence. Un Extracteur, 60 Métal, rend 50 % de plus à chaque Tirage. Je recommande.',
      'Le Marché vous est ouvert. Un prix par ressource et par région, réglé au Tirage ; le teneur de marché achète à 40 %, vendez au-dessus.',
      'Le poste défense est ouvert. Une tourelle légère coûte 40 Métal et protège un stock qui vaut dix fois plus. Le retour est évident.',
      'Vous pouvez attaquer. Je chiffre chaque sortie en Rium et en coques perdues avant de la financer : donnez-moi la doctrine.',
      'Un voisin humain. La diplomatie se paie en Influence, produite par le Cristal ; c\'est la ligne de dépense la moins chère du bilan.',
      'Les Phares : 2 000 Cristal immobilisés pour 10 points par Tirage. À votre score actuel, c\'est le meilleur placement disponible.',
    ],
    en: [
      'First relay: the yield begins. An Extractor, 60 Metal, returns 50 % more at every Draw. I recommend it.',
      'The Market is open to you. One price per resource per region, settled at the Draw; the market maker buys at 40 %, sell above that.',
      'The defence line is open. A light turret costs 40 Metal and protects a stock worth ten times more. The return is obvious.',
      'You may attack. I price every sortie in Rium and lost hulls before funding it: give me the doctrine.',
      'A human neighbour. Diplomacy is paid in Influence, produced by Crystal; it is the cheapest expense line on the books.',
      'The Beacons: 2,000 Crystal tied up for 10 points per Draw. At your current score, it is the best placement available.',
    ],
  },
  solen: {
    fr: [
      'Ton premier relais parle. Fais-le produire, mon ami : un système relié nourrit les autres, comme un voisin qui partage.',
      'Le Marché t\'accueille. Vends ce que tu as en trop, achète ce qui manque ; un échange juste est un traité qui ne dit pas son nom.',
      'Tu peux te défendre, désormais. Une tourelle n\'est pas une menace, c\'est une porte qu\'on ferme la nuit.',
      'Tu peux frapper. Je te demanderai toujours si un émissaire ne ferait pas mieux ; mais la décision est tienne.',
      'Un voisin humain nous voit. Écris-lui avant qu\'il ne t\'écrive : une main tendue coûte 7 Influence et vaut un pont.',
      'Les Phares se rallument à plusieurs. Deux mille Cristal, dix points par Tirage, et le Signal se souvient de qui l\'a fait.',
    ],
    en: [
      'Your first relay speaks. Make it produce, my friend: a connected system feeds the others, like a neighbour who shares.',
      'The Market welcomes you. Sell what you have too much of, buy what you lack; a fair trade is a treaty that does not say its name.',
      'You can defend yourself now. A turret is not a threat, it is a door one closes at night.',
      'You may strike. I will always ask whether an envoy would do better; but the decision is yours.',
      'A human neighbour sees us. Write to them before they write to you: an outstretched hand costs 7 Influence and is worth a bridge.',
      'Beacons are relit together. Two thousand Crystal, ten points per Draw, and the Signal remembers who did it.',
    ],
  },
};

const ALL_LINES: Record<Persona, { fr: string; en: string }> = {
  vane: { fr: 'Compris : tu connais le jeu. Tout est ouvert. Mes règles restent les mêmes : je ne frappe pas la première, je ne romps rien.', en: 'Understood: you know the game. Everything is open. My rules stay: I never strike first, I never break a treaty.' },
  kestrel: { fr: 'Un vétéran. Tout ouvert, alors : chantier, Marché, cibles. Dis un mot.', en: 'A veteran. Everything open, then: shipyard, Market, targets. Say the word.' },
  oriel: { fr: 'Vous connaissez les comptes. Tout est ouvert ; je vous épargne la leçon et je vous donne les prix.', en: 'You know the books. Everything is open; I spare you the lesson and give you the prices.' },
  solen: { fr: 'Tu as déjà marché sous ce ciel. Tout est ouvert, mon ami ; les voisins t\'attendent.', en: 'You have walked under this sky before. Everything is open, my friend; the neighbours are waiting.' },
};

/** A tier just unlocked (1..6), or everything at once: the General's first word on the new screen, no model. */
export function tierUnlocked(persona: Persona, lang: 'fr' | 'en', tier: number, all = false): string {
  if (all) return ALL_LINES[persona][lang];
  const lines = TIER_LINES[persona][lang];
  return lines[Math.min(lines.length, Math.max(1, Math.round(tier))) - 1]!;
}

const UNLOCK_INTENT = /\b(tout ouvrir|ouvre tout|ouvrir tout|je connais (déjà )?le jeu|passe le tuto(riel)?|saute le tuto(riel)?|pas de tuto(riel)?|show me everything|unlock everything|open everything|i know the game|skip the tutorial|no tutorial)\b/i;

/** "Show me everything": the player wants every tier open now. */
export function wantsEverything(text: string): boolean { return UNLOCK_INTENT.test(text); }
