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
