const STRINGS = {
  fr: {
    tagline: "can't stop the signal",
    daily: 'Signal du jour',
    endless: 'Mode infini',
    howto: 'Comment jouer',
    stats: 'Statistiques',
    level: 'Niveau',
    par: 'par',
    energy: 'Énergie',
    listeners: 'Récepteurs',
    undo: 'Annuler',
    reset: 'Tout effacer',
    menu: 'Menu',
    sound: 'Son',
    hintIdle: 'Touche une étoile puis une autre pour créer un relais.',
    hintSelected: 'Choisis une étoile à portée. Touche le vide pour annuler.',
    hintRemove: 'Touche un relais existant pour le supprimer.',
    range: 'Hors de portée',
    blackhole: 'Un trou noir avale le signal',
    exists: 'Relais déjà construit',
    established: 'Signal établi !',
    beatPar: 'Tu as battu la machine !',
    atPar: 'Solution optimale trouvée.',
    overPar: (d) => `${d} ⚡ au-dessus du par. Tu peux faire mieux ?`,
    share: 'Partager',
    copied: 'Copié dans le presse-papier',
    next: 'Galaxie suivante',
    keepTuning: 'Optimiser encore',
    nextDaily: 'Prochain signal dans',
    played: 'Joués',
    streak: 'Série',
    best: 'Record',
    perfect: 'Parfaits',
    close: 'Fermer',
    play: 'Jouer',
    howtoBody: `
      <p><b>Terra</b> doit transmettre son signal à toutes les civilisations <b>réceptrices</b> de la galaxie.</p>
      <ul>
        <li>Relie deux étoiles pour construire un <b>relais</b>. Chaque relais coûte de l'énergie ⚡ selon sa longueur.</li>
        <li>Un relais a une <b>portée limitée</b>. Les <b>pulsars</b> ✦ l'augmentent de 50 %.</li>
        <li>Traverser une <b>nébuleuse</b> coûte le double.</li>
        <li>Les <b>trous noirs</b> avalent tout relais qui les traverse.</li>
      </ul>
      <p>Connecte tous les récepteurs en dépensant le moins d'énergie possible. Le <b>par</b> est le score de notre IA : égale-le pour ★★★, bats-le pour la gloire éternelle.</p>
      <p>Une nouvelle galaxie chaque jour, la même pour tout le monde. Le lundi est doux, le dimanche est cruel.</p>`,
  },
  en: {
    tagline: "can't stop the signal",
    daily: 'Daily signal',
    endless: 'Endless mode',
    howto: 'How to play',
    stats: 'Statistics',
    level: 'Level',
    par: 'par',
    energy: 'Energy',
    listeners: 'Listeners',
    undo: 'Undo',
    reset: 'Clear all',
    menu: 'Menu',
    sound: 'Sound',
    hintIdle: 'Tap a star, then another one, to build a relay.',
    hintSelected: 'Pick a star within range. Tap empty space to cancel.',
    hintRemove: 'Tap an existing relay to remove it.',
    range: 'Out of range',
    blackhole: 'A black hole swallows the signal',
    exists: 'Relay already built',
    established: 'Signal established!',
    beatPar: 'You beat the machine!',
    atPar: 'Optimal network found.',
    overPar: (d) => `${d} ⚡ over par. Can you do better?`,
    share: 'Share',
    copied: 'Copied to clipboard',
    next: 'Next galaxy',
    keepTuning: 'Keep optimizing',
    nextDaily: 'Next signal in',
    played: 'Played',
    streak: 'Streak',
    best: 'Best',
    perfect: 'Perfect',
    close: 'Close',
    play: 'Play',
    howtoBody: `
      <p><b>Terra</b> must beam its signal to every <b>listener</b> civilisation in the galaxy.</p>
      <ul>
        <li>Connect two stars to build a <b>relay</b>. Each relay costs energy ⚡ based on its length.</li>
        <li>Relays have a <b>limited range</b>. <b>Pulsars</b> ✦ boost it by 50%.</li>
        <li>Crossing a <b>nebula</b> costs double.</li>
        <li><b>Black holes</b> swallow any relay passing through them.</li>
      </ul>
      <p>Connect every listener while spending as little energy as possible. <b>Par</b> is our AI's score: match it for ★★★, beat it for eternal glory.</p>
      <p>A new galaxy every day, the same for everyone. Mondays are gentle, Sundays are cruel.</p>`,
  },
};

const lang = (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
document.documentElement.lang = lang;

export const t = (key, ...args) => {
  const v = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
};
