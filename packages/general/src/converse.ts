// The conversational General: one call answers the player in character and, when the message holds
// orders, compiles them into the policy. Without a model, a persona-flavoured fallback still answers.
import type { Persona, Policy } from '@aurane/protocol';
import type { PlayerView } from '@aurane/sim';
import { heuristicPolicy, summarize, type DoctrineContext } from './doctrine.js';
import { extractJson, type LlmClient } from './llm/index.js';
import { MECHANICS_PRIMER, PERSONA_VOICES } from './personas.js';
import { PolicySchema } from '@aurane/protocol';

export interface Turn { who: 'me' | 'general'; text: string; at: number }

export interface ConverseInput {
  text: string;
  lang: 'fr' | 'en';
  persona: Persona;
  history: Turn[];
  view: PlayerView;
  ctx: DoctrineContext;
}

export interface ConverseResult { reply: string; policy: Policy | null; source: 'llm' | 'heuristic' }

/** The state of the colony in a few lines, so the General talks about what is actually happening. */
export function situationSummary(v: PlayerView, lang: 'fr' | 'en', names: Record<string, string>): string {
  const me = v.me;
  const mine = v.systems.filter((s) => s.owner === me.id);
  const hot = mine.filter((s) => s.engaged || s.blockadedBy);
  const fleets = v.fleets.filter((f) => f.owner === me.id);
  const warships = fleets.reduce((s, f) => s + f.combat, 0);
  const cargos = fleets.reduce((s, f) => s + (f.units?.cargo ?? 0), 0);
  const incoming = v.fleets.filter((f) => f.owner !== me.id && f.destination && mine.some((s) => s.id === f.destination) && f.combat > 0);
  const nextDraw = Math.max(0, Math.round((v.nextDrawAt - v.time) / 60));
  const daysLeft = Math.max(0, Math.round((v.seasonEndsAt - v.time) / 86400));
  const neighbours = v.colonies.filter((c) => c.id !== me.id && !c.npc).length;
  const p = me.policy;
  const st = me.stock;
  if (lang === 'fr') {
    return [
      `Colonie ${me.name}, faction ${me.faction}. ${me.connectedCount} système(s) relié(s) sur ${mine.length} possédé(s), score ${me.score.toFixed(1)}. ${me.shielded ? 'Bouclier de débutant actif.' : ''}`,
      `Stocks : Métal ${Math.round(st.metal)}, Énergie ${Math.round(st.energy)}, Vivres ${Math.round(st.food)}, Cristal ${Math.round(st.crystal)}, Rium ${Math.round(st.rium)} ; ${Math.round(me.credits)} Crédits, ${Math.round(me.influence)} Influence. Dernière production : Métal +${Math.round(me.lastProduced.metal)}, Énergie +${Math.round(me.lastProduced.energy)}.`,
      `Flottes : ${warships} vaisseau(x) de guerre, ${cargos} cargo(s). ${incoming.length ? `ALERTE : ${incoming.length} flotte(s) hostile(s) en approche.` : ''} ${hot.length ? `Combat ou blocus à : ${hot.map((s) => s.name).join(', ')}.` : ''}`,
      `Prochain Tirage dans ${nextDraw} min ; bandes tirées : ${v.draw?.bands.join(', ') ?? 'aucune'} ; Silence dans ${daysLeft} jour(s). ${neighbours} Colonie(s) humaine(s) connue(s), ${v.colonies.filter((c) => c.ally).length} allié(s).`,
      `Doctrine en vigueur : ${summarize(p, 'fr')}${p.notes ? ` (« ${p.notes.slice(0, 120)} »)` : ''}.`,
      `Systèmes : ${mine.slice(0, 8).map((s) => `${s.name}${s.id === me.capital ? ' (capitale)' : ''} [${s.resource}${s.connected ? '' : ', non relié'}]`).join(' ; ')}${mine.length > 8 ? ' ; …' : ''}.`,
      v.barters.filter((b) => b.to === me.id && !b.accepted).length ? `Offres de troc en attente : ${v.barters.filter((b) => b.to === me.id && !b.accepted).map((b) => names[b.from] ?? b.from).join(', ')}.` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    `Colony ${me.name}, faction ${me.faction}. ${me.connectedCount} connected system(s) of ${mine.length} owned, score ${me.score.toFixed(1)}. ${me.shielded ? 'Newcomer shield active.' : ''}`,
    `Stocks: Metal ${Math.round(st.metal)}, Energy ${Math.round(st.energy)}, Food ${Math.round(st.food)}, Crystal ${Math.round(st.crystal)}, Rium ${Math.round(st.rium)}; ${Math.round(me.credits)} Credits, ${Math.round(me.influence)} Influence. Last production: Metal +${Math.round(me.lastProduced.metal)}, Energy +${Math.round(me.lastProduced.energy)}.`,
    `Fleets: ${warships} warship(s), ${cargos} cargo(s). ${incoming.length ? `ALERT: ${incoming.length} hostile fleet(s) inbound.` : ''} ${hot.length ? `Fighting or blockade at: ${hot.map((s) => s.name).join(', ')}.` : ''}`,
    `Next Draw in ${nextDraw} min; bands drawn: ${v.draw?.bands.join(', ') ?? 'none'}; Silence in ${daysLeft} day(s). ${neighbours} known human colony(ies), ${v.colonies.filter((c) => c.ally).length} ally(ies).`,
    `Standing doctrine: ${summarize(p, 'en')}${p.notes ? ` ("${p.notes.slice(0, 120)}")` : ''}.`,
    `Systems: ${mine.slice(0, 8).map((s) => `${s.name}${s.id === me.capital ? ' (capital)' : ''} [${s.resource}${s.connected ? '' : ', not connected'}]`).join('; ')}${mine.length > 8 ? '; …' : ''}.`,
    v.barters.filter((b) => b.to === me.id && !b.accepted).length ? `Pending barter offers: ${v.barters.filter((b) => b.to === me.id && !b.accepted).map((b) => names[b.from] ?? b.from).join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}

const ORDERS_SHAPE = `{
  "reply": "your answer to the player, in character, 1 to 3 sentences, in the player's language",
  "orders": null | {
    "reserves"?: { "metal"?: number, "energy"?: number, "food"?: number, "crystal"?: number, "rium"?: number },
    "sellAbove"?: { "<resource>": minPrice }, "buyBelow"?: { "<resource>": maxPrice },
    "defendFirst"?: ["<system id>"], "expansion"?: 0..1, "aggression"?: 0..1,
    "neverAttack"?: ["<colony or alliance id>"], "trustedTraders"?: ["<colony id>"],
    "fuel"?: "auto" | "refinery" | "synthesizer", "autoTurrets"?: 0..6, "retreatBelow"?: 0..1,
    "targetPriority"?: "ships" | "turrets" | "station" | "economy", "notes"?: "the doctrine in one sentence"
  }
}`;

/** Small talk, questions and orders, answered in one model call; the persona fallback when no model is available. */
export async function converse(input: ConverseInput, client: LlmClient | null, names: Record<string, string> = {}): Promise<ConverseResult> {
  const fallback = heuristicConverse(input);
  if (!client || !input.text.trim()) return fallback;
  const L = input.lang;
  const voice = PERSONA_VOICES[input.persona];
  const ch = voice.character[L];
  const situation = situationSummary(input.view, L, names);
  const systems = Object.entries(input.ctx.systems).map(([id, n]) => `${id} = ${n}`).join('; ');
  const colonies = Object.entries(input.ctx.colonies).slice(0, 60).map(([id, n]) => `${id} = ${n}`).join('; ');
  const alliances = Object.entries(input.ctx.alliances).map(([id, n]) => `${id} = ${n}`).join('; ');
  const system = [
    `You are ${voice.name[L]}, the player's AI General in Aurane, a slow real-time galactic strategy game. You are a character, not an assistant.`,
    `Temperament: ${ch.temperament}`,
    `Humour: ${ch.humour}`,
    `Style: ${ch.style.join(' ')}`,
    `Never: ${ch.never.join(' ')}`,
    `Your speciality: ${ch.expertise}`,
    `Catchphrases you may use sparingly: ${ch.catchphrases.join(' | ')}`,
    '',
    MECHANICS_PRIMER[L],
    '',
    `Current situation of the colony you serve:\n${situation}`,
    '',
    `Ids you may use in orders (never invent one): SYSTEMS: ${systems || '(none)'}; COLONIES: ${colonies || '(none)'}; ALLIANCES: ${alliances || '(none)'}. Current policy: ${JSON.stringify(input.ctx.current)}.`,
    '',
    `Answer ONLY with a JSON object of this shape, no prose outside it, no code fences:\n${ORDERS_SHAPE}`,
    'Rules: "orders" is null unless the player clearly gives you an instruction about how to run the colony; then fill only the fields the instruction touches and say in the reply what you will do. If the player jokes, provokes or chats, stay in character and use your humour; if they ask how something works, explain it correctly and briefly from the rules above, in your voice, tied to their real situation. Never break character, never mention being a language model, never exceed three sentences.',
  ].join('\n');
  const messages = [
    { role: 'system' as const, content: system },
    ...input.history.slice(-8).map((t) => ({ role: (t.who === 'me' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text })),
    { role: 'user' as const, content: input.text.slice(0, 1500) },
  ];
  try {
    const res = await client.chat(messages, { maxTokens: 500, temperature: 0.7, json: true, timeoutMs: 20000 });
    const raw = extractJson(res.text) as { reply?: unknown; orders?: unknown };
    const reply = typeof raw.reply === 'string' && raw.reply.trim() ? raw.reply.trim().slice(0, 600) : fallback.reply;
    let policy: Policy | null = null;
    if (raw.orders && typeof raw.orders === 'object') {
      const merged = PolicySchema.safeParse({ ...input.ctx.current, ...(raw.orders as Record<string, unknown>), version: 1 });
      if (merged.success) {
        policy = merged.data;
        policy.defendFirst = policy.defendFirst.filter((id) => id in input.ctx.systems);
        policy.neverAttack = policy.neverAttack.filter((id) => id in input.ctx.colonies || id in input.ctx.alliances);
        policy.trustedTraders = policy.trustedTraders.filter((id) => id in input.ctx.colonies);
        if (typeof policy.notes !== 'string' || !policy.notes) policy.notes = input.text.slice(0, 2000);
      }
    }
    return { reply, policy, source: 'llm' };
  } catch {
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

const JOKES: Record<Persona, { fr: string[]; en: string[] }> = {
  vane: {
    fr: ['Une blague. Bien. Deux Généraux entrent dans un système sans tourelle. Il n\'y en a qu\'un qui ressort. Voilà, c\'est fait ; parlons de tes ponts.', 'J\'ai un humour de caserne : il tient en une ligne et il finit par un ordre. Ris maintenant, double ton pont ensuite.'],
    en: ['A joke. Fine. Two Generals enter a system without a turret. Only one comes out. There, done; now about your bridges.', 'My humour is barracks humour: one line, ending with an order. Laugh now, double your bridge next.'],
  },
  kestrel: {
    fr: ['Tu veux rire ? Regarde la doctrine de ton voisin : « défense d\'abord ». Il défend une station que personne n\'a encore trouvée. Nous, on va la trouver.', 'Ma meilleure blague, c\'est un cargo de Rium sans escorte. La chute arrive dans dix minutes, à la géante gazeuse d\'à côté.'],
    en: ['You want a laugh? Look at your neighbour\'s doctrine: "defence first". He defends a station nobody has found yet. We will.', 'My best joke is an unescorted Rium cargo. The punchline lands in ten minutes, at the gas giant next door.'],
  },
  oriel: {
    fr: ['Votre demande a un rendement estimé de 0,3 sourire par Tirage, sous le Métal. Je la satisfais néanmoins : un Corsaire entre dans un Marché et demande le prix de l\'honnêteté. Introuvable ; rupture de stock depuis la Saison 0.', 'L\'humour est un actif volatil. Je propose plutôt une marge : vendez vos Vivres au-dessus de 1,2, elle est garantie et elle fait sourire.'],
    en: ['Your request yields an estimated 0.3 smiles per Draw, below Metal. I comply nonetheless: a Corsair walks into a Market and asks the price of honesty. Not listed; out of stock since Season 0.', 'Humour is a volatile asset. I propose a margin instead: sell your Food above 1.2, it is guaranteed and it makes people smile.'],
  },
  solen: {
    fr: ['On raconte qu\'un Phare demanda un jour au Silence pourquoi il l\'éteignait. « Pour voir qui viendrait te rallumer », répondit-il. Ris si tu veux, mais regarde qui sont tes voisins.', 'Un moine, un Corsaire et un Marchand construisent un relais. Le Marchand le vend, le Corsaire le coupe, le moine le double. Devine lequel a encore un Réseau le matin.'],
    en: ['They say a Beacon once asked the Silence why it put it out. "To see who would come and relight you," it answered. Laugh if you like, but look at who your neighbours are.', 'A monk, a Corsair and a Merchant build a relay. The Merchant sells it, the Corsair cuts it, the monk doubles it. Guess who still has a Network in the morning.'],
  },
};

const GREETINGS: Record<Persona, { fr: string; en: string }> = {
  vane: { fr: 'Présente. Ponts tenus, réserves comptées. Tes ordres ?', en: 'Present. Bridges held, reserves counted. Your orders?' },
  kestrel: { fr: 'Enfin réveillé. J\'ai trois cibles et pas d\'ordre : dis un mot.', en: 'Awake at last. I have three targets and no orders: say the word.' },
  oriel: { fr: 'Bonjour. Les comptes sont justes et l\'Énergie a bougé de 4 % : je vous écoute.', en: 'Good day. The books balance and Energy moved 4 %: I am listening.' },
  solen: { fr: 'La paix sur ta Colonie. Les voisins sont calmes, le Signal veille. Que puis-je pour toi ?', en: 'Peace on your Colony. The neighbours are quiet, the Signal keeps watch. What can I do for you?' },
};

function pick<T>(arr: T[], seed: string): T { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return arr[h % arr.length]!; }

/** No model: keywords decide between orders, a rules answer, a joke or a greeting, always in the persona's voice. */
export function heuristicConverse(input: ConverseInput): ConverseResult {
  const L = input.lang;
  const t = input.text.toLowerCase();
  const voice = PERSONA_VOICES[input.persona];
  const compiled = heuristicPolicy(input.text, input.ctx);
  const changed = compiled.summary !== summarize(input.ctx.current, L) || compiled.policy.defendFirst.join() !== input.ctx.current.defendFirst.join();
  if (changed) return { reply: compiled.reply, policy: compiled.policy, source: 'heuristic' };
  const has = (...w: string[]): boolean => w.some((x) => t.includes(x));
  if (has('rire', 'blague', 'drôle', 'drole', 'joke', 'funny', 'laugh', 'humour', 'humor')) return { reply: pick(JOKES[input.persona][L], input.text), policy: null, source: 'heuristic' };
  if (has('bonjour', 'salut', 'hello', 'hi ', 'hey', 'coucou', 'yo ') && t.length < 30) return { reply: GREETINGS[input.persona][L], policy: null, source: 'heuristic' };
  for (const f of FAQ) if (f.keys.some((k) => t.includes(k))) return { reply: `${f[L]} ${voice.signoff[L]}`, policy: null, source: 'heuristic' };
  return { reply: compiled.reply, policy: null, source: 'heuristic' };
}
