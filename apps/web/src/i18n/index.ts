import { signal } from '@preact/signals';

export type Lang = 'fr' | 'en';

const STRINGS = {
  fr: {
    tagline: "can't stop the signal",
    subtitle: 'Un réseau, une galaxie, une saison. Tisse le Réseau, fais circuler le Signal, survis au Silence.',
    play: 'Entrer dans l\'Aurane',
    yourName: 'Nom de ta Colonie',
    faction: 'Allégeance',
    general: 'Ton Général',
    concordat: 'Concordat', guild: 'Guilde des Marchands', oracles: 'Oracles', corsairs: 'Corsaires',
    concordatDesc: 'Ordre et archives. Portée des relais +10 %.',
    guildDesc: 'Commerce libre. Frais de marché −50 %, une région de plus.',
    oraclesDesc: 'Savoir. Une bande du prochain Tirage connue à l\'avance.',
    corsairsDesc: 'Milices. Vaisseaux −15 %, vitesse +10 %.',
    vane: 'Maréchale Idris Vane', kestrel: 'Kestrel', oriel: 'Oriel-Neuf', solen: 'L\'Abbé Solen',
    vaneDesc: 'Prudente, méthodique. Défend d\'abord.', kestrelDesc: 'Agressif, opportuniste. Raide les faibles.',
    orielDesc: 'Mercantile, calculateur. Arbitre les marchés.', solenDesc: 'Diplomate, patient. Tisse des traités.',
    connecting: 'Connexion au Signal…', offline: 'Signal perdu, reconnexion…',
    metal: 'Métal', energy: 'Énergie', food: 'Vivres', crystal: 'Cristal', credits: 'Crédits', influence: 'Influence',
    nextDraw: 'Prochain Tirage', draw: 'Tirage', bands: 'Bandes', event: 'Événement',
    score: 'Score', connected: 'connectés', shielded: 'Bouclier de débutant actif', watching: 'Garde de nuit active',
    tabColony: 'Colonie', tabSystem: 'Système', tabMarket: 'Marché', tabFleets: 'Flottes', tabDiplomacy: 'Diplomatie', tabGeneral: 'Général', tabLog: 'Journal',
    build: 'Construire', train: 'Entraîner', relay: 'Relais', linkMode: 'Relier', cancel: 'Annuler',
    linkHint: 'Choisis l\'étoile à relier', selectHint: 'Touche une étoile',
    extractor: 'Extracteur', shipyard: 'Chantier', bastion: 'Bastion', tradepost: 'Comptoir', amplifier: 'Amplificateur', antenna: 'Antenne',
    corvette: 'Corvette', frigate: 'Frégate', cruiser: 'Croiseur',
    owner: 'Propriétaire', unclaimed: 'Libre', band: 'Bande', slots: 'Emplacements', population: 'Population', kindPulsar: 'Pulsar', kindBeacon: 'Phare',
    buy: 'Acheter', sell: 'Vendre', qty: 'Quantité', price: 'Prix', place: 'Placer l\'ordre', lastPrice: 'Dernier prix', myOrders: 'Mes ordres', region: 'Région', noMarket: 'Aucun marché à portée',
    move: 'Déplacer', raid: 'Raider', blockade: 'Bloquer', defend: 'Défendre', return: 'Rentrer', inTransit: 'en transit', at: 'à',
    treaties: 'Traités', propose: 'Proposer', nap: 'Non-agression', trade: 'Pacte commercial', transit: 'Transit', federation: 'Fédération',
    alliance: 'Alliance', createAlliance: 'Fonder une alliance', invites: 'Invitations', join: 'Rejoindre',
    doctrine: 'Doctrine', doctrineHint: 'Explique à ton Général ce qu\'il doit faire quand tu n\'es pas là. Il traduira en règles.', doctrinePlaceholder: 'Défends la capitale, vends le surplus de Vivres, n\'attaque personne sans moi.',
    apply: 'Appliquer', policy: 'Politique en vigueur', expansion: 'Expansion', aggression: 'Agressivité',
    log: 'Journal', noEvents: 'Rien à signaler.',
    ended: 'Le Silence est tombé.', renaissance: 'La Renaissance ! Le Signal est revenu.',
    errors: { range: 'Hors de portée', blackhole: 'Un trou noir avale le signal', far: 'Trop loin', same: 'Même étoile', 'relay exists': 'Relais déjà construit', 'not enough resources': 'Pas assez de ressources', 'not connected to your network': 'Pas relié à ton Réseau', 'system held by another colony': 'Système tenu par une autre Colonie' } as Record<string, string>,
    lightBeacon: 'Rallumer le Phare', lit: 'Rallumé', by: 'par',
    metalDesc: 'Construit relais, bâtiments et coques.', energyDesc: 'Alimente les relais à chaque Tirage. Sans Énergie, le Réseau s\'éteint.', foodDesc: 'Nourrit la population, qui produit davantage.', crystalDesc: 'Rare. Technologie, croiseurs, Phares et Influence.', creditsDesc: 'Monnaie du Marché, réglé à chaque Tirage.', influenceDesc: 'Monnaie politique : traités, agents, décrets.',
    perDraw: 'par Tirage', legend: 'Légende', help: 'Aide', cost: 'Coût', produces: 'Produit', yieldNow: 'ce Tirage', inRange: 'à portée', tapToLink: 'Touche une étoile verte pour la relier',
    extractorDesc: 'Rendement du système +50 %.', shipyardDesc: 'Permet d\'entraîner des vaisseaux ici.', bastionDesc: 'Défense ×2, protège les relais voisins.', tradepostDesc: 'Une région de marché en plus, frais réduits.', amplifierDesc: 'Portée des relais partant d\'ici +25 %.', antennaDesc: 'Révèle les secteurs voisins.', warehouse: 'Entrepôt', warehouseDesc: 'Stock local +900 par ressource.', turret_light: 'Tourelle légère', turret_lightDesc: 'Tir rapide. Déchire les corvettes.', turret_heavy: 'Tourelle lourde', turret_heavyDesc: 'Gros calibre. Casse les croiseurs.', launcher: 'Lance-missiles', launcherDesc: 'Longue portée. Chasse les frégates.', cargo: 'Cargo', cargoDesc: 'Transporte 120 ressources. Sans armes : escorte-le.', station: 'Station', underAttack: 'sous le feu', localStock: 'Entrepôt local',
    corvetteDesc: 'Rapide. Coupe les relais. Bat les croiseurs.', frigateDesc: 'Escorte et défense. Bat les corvettes.', cruiserDesc: 'Blocus et siège. Bat les frégates.',
    building: 'en construction', queued: 'en file', capitalTag: 'Capitale', noSlot: 'Plus d\'emplacement libre',
    barter: 'Troc', offerTo: 'Proposer à', give: 'Je donne', want: 'Je veux', send: 'Envoyer', accept: 'Accepter', offers: 'Offres en cours', settledAtDraw: 'Réglé au prochain Tirage si l\'autre accepte.',
    agents: 'Agents', spy: 'Espionner', sabotage: 'Saboter', envoy: 'Émissaire', spyDesc: 'Révèle ce secteur 6 h.', sabotageDesc: 'Coupe ce relais sans flotte. Risque de capture.', envoyDesc: 'Gagne de l\'Influence, apaise cette Colonie.', influenceCost: 'Influence',
    coach1: 'Touche une étoile de ton secteur.', coach2: 'Appuie sur « Relier », puis touche une étoile voisine : un relais se construit.', coach3: 'À chaque heure pile, le Tirage produit et règle le Marché. Reviens quand tu veux : ton Général veille.', next: 'Suivant', done: 'C\'est parti',
    drawEventNone: 'Calme', drawEventEruption: 'Éruption', drawEventStorm: 'Tempête', drawEventEcho: 'Écho',
    briefing: 'Briefing', dismiss: 'Compris', compiling: 'Ton Général relit ta doctrine…', compiled: 'Doctrine appliquée', viaModel: 'interprétée par ton Général', viaRules: 'interprétée par les règles de base (modèle indisponible)',
  },
  en: {
    tagline: "can't stop the signal",
    subtitle: 'One network, one galaxy, one season. Weave the Network, carry the Signal, survive the Silence.',
    play: 'Enter the Aurane',
    yourName: 'Your Colony\'s name',
    faction: 'Allegiance',
    general: 'Your General',
    concordat: 'Concordat', guild: 'Merchants\' Guild', oracles: 'Oracles', corsairs: 'Corsairs',
    concordatDesc: 'Order and archives. Relay range +10%.',
    guildDesc: 'Free trade. Market fees −50%, one more region.',
    oraclesDesc: 'Knowledge. One band of the next Draw known in advance.',
    corsairsDesc: 'Militias. Ships −15%, speed +10%.',
    vane: 'Marshal Idris Vane', kestrel: 'Kestrel', oriel: 'Oriel-Nine', solen: 'Abbot Solen',
    vaneDesc: 'Careful, methodical. Defends first.', kestrelDesc: 'Aggressive, opportunistic. Raids the weak.',
    orielDesc: 'Mercantile, calculating. Arbitrages markets.', solenDesc: 'Diplomatic, patient. Weaves treaties.',
    connecting: 'Connecting to the Signal…', offline: 'Signal lost, reconnecting…',
    metal: 'Metal', energy: 'Energy', food: 'Food', crystal: 'Crystal', credits: 'Credits', influence: 'Influence',
    nextDraw: 'Next Draw', draw: 'Draw', bands: 'Bands', event: 'Event',
    score: 'Score', connected: 'connected', shielded: 'Newcomer shield active', watching: 'Night watch active',
    tabColony: 'Colony', tabSystem: 'System', tabMarket: 'Market', tabFleets: 'Fleets', tabDiplomacy: 'Diplomacy', tabGeneral: 'General', tabLog: 'Log',
    build: 'Build', train: 'Train', relay: 'Relay', linkMode: 'Link', cancel: 'Cancel',
    linkHint: 'Pick the star to link', selectHint: 'Tap a star',
    extractor: 'Extractor', shipyard: 'Shipyard', bastion: 'Bastion', tradepost: 'Trading post', amplifier: 'Amplifier', antenna: 'Antenna',
    corvette: 'Corvette', frigate: 'Frigate', cruiser: 'Cruiser',
    owner: 'Owner', unclaimed: 'Unclaimed', band: 'Band', slots: 'Slots', population: 'Population', kindPulsar: 'Pulsar', kindBeacon: 'Beacon',
    buy: 'Buy', sell: 'Sell', qty: 'Quantity', price: 'Price', place: 'Place order', lastPrice: 'Last price', myOrders: 'My orders', region: 'Region', noMarket: 'No market in reach',
    move: 'Move', raid: 'Raid', blockade: 'Blockade', defend: 'Defend', return: 'Return', inTransit: 'in transit', at: 'at',
    treaties: 'Treaties', propose: 'Propose', nap: 'Non-aggression', trade: 'Trade pact', transit: 'Transit', federation: 'Federation',
    alliance: 'Alliance', createAlliance: 'Found an alliance', invites: 'Invitations', join: 'Join',
    doctrine: 'Doctrine', doctrineHint: 'Tell your General what to do while you are away. It will turn it into rules.', doctrinePlaceholder: 'Defend the capital, sell surplus food, attack nobody without me.',
    apply: 'Apply', policy: 'Policy in force', expansion: 'Expansion', aggression: 'Aggression',
    log: 'Log', noEvents: 'Nothing to report.',
    ended: 'The Silence has fallen.', renaissance: 'The Renaissance! The Signal is back.',
    errors: { range: 'Out of range', blackhole: 'A black hole swallows the signal', far: 'Too far', same: 'Same star', 'relay exists': 'Relay already built', 'not enough resources': 'Not enough resources', 'not connected to your network': 'Not connected to your Network', 'system held by another colony': 'System held by another Colony' } as Record<string, string>,
    lightBeacon: 'Light the Beacon', lit: 'Lit', by: 'by',
    metalDesc: 'Builds relays, buildings and hulls.', energyDesc: 'Powers relays at every Draw. Without Energy, the Network goes dark.', foodDesc: 'Feeds the population, which produces more.', crystalDesc: 'Rare. Technology, cruisers, Beacons and Influence.', creditsDesc: 'Market currency, settled at every Draw.', influenceDesc: 'Political currency: treaties, agents, decrees.',
    perDraw: 'per Draw', legend: 'Legend', help: 'Help', cost: 'Cost', produces: 'Produces', yieldNow: 'this Draw', inRange: 'in range', tapToLink: 'Tap a green star to link it',
    extractorDesc: 'System yield +50%.', shipyardDesc: 'Lets you train ships here.', bastionDesc: 'Defence ×2, protects adjacent relays.', tradepostDesc: 'One more market region, lower fees.', amplifierDesc: 'Relay range from here +25%.', antennaDesc: 'Reveals neighbouring sectors.', warehouse: 'Warehouse', warehouseDesc: 'Local stock +900 per resource.', turret_light: 'Light turret', turret_lightDesc: 'Fast firing. Shreds corvettes.', turret_heavy: 'Heavy turret', turret_heavyDesc: 'Big guns. Cracks cruisers.', launcher: 'Missile launcher', launcherDesc: 'Long range. Hunts frigates.', cargo: 'Cargo', cargoDesc: 'Carries 120 resources. Unarmed: escort it.', station: 'Station', underAttack: 'under fire', localStock: 'Local warehouse',
    corvetteDesc: 'Fast. Cuts relays. Beats cruisers.', frigateDesc: 'Escort and defence. Beats corvettes.', cruiserDesc: 'Blockade and siege. Beats frigates.',
    building: 'under construction', queued: 'queued', capitalTag: 'Capital', noSlot: 'No free slot left',
    barter: 'Barter', offerTo: 'Offer to', give: 'I give', want: 'I want', send: 'Send', accept: 'Accept', offers: 'Open offers', settledAtDraw: 'Settled at the next Draw if they accept.',
    agents: 'Agents', spy: 'Spy', sabotage: 'Sabotage', envoy: 'Envoy', spyDesc: 'Reveals this sector for 6 h.', sabotageDesc: 'Cuts this relay without a fleet. Risk of capture.', envoyDesc: 'Gains Influence, warms this Colony.', influenceCost: 'Influence',
    coach1: 'Tap a star in your sector.', coach2: 'Press “Link”, then tap a neighbouring star: a relay is built.', coach3: 'Every hour on the hour, the Draw produces and settles the Market. Come back whenever: your General keeps watch.', next: 'Next', done: 'Let\'s go',
    drawEventNone: 'Calm', drawEventEruption: 'Eruption', drawEventStorm: 'Storm', drawEventEcho: 'Echo',
    briefing: 'Briefing', dismiss: 'Got it', compiling: 'Your General is reading your doctrine…', compiled: 'Doctrine applied', viaModel: 'interpreted by your General', viaRules: 'interpreted by the base rules (model unavailable)',
  },
} as const;

type Strings = typeof STRINGS.fr;

const detect = (): Lang => {
  try { const saved = localStorage.getItem('aurane.lang'); if (saved === 'fr' || saved === 'en') return saved; } catch { /* ignore */ }
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
};

export const lang = signal<Lang>(detect());
export function setLang(l: Lang): void {
  lang.value = l;
  document.documentElement.lang = l;
  try { localStorage.setItem('aurane.lang', l); } catch { /* ignore */ }
}

export function t<K extends keyof Strings>(key: K): Strings[K] {
  return (STRINGS[lang.value] as Strings)[key];
}

export function tError(reason: string): string {
  return t('errors')[reason] ?? reason;
}
