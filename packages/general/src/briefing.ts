// The briefing: what happened while you were away, in your General's voice. A template
// always works; the model, when available, rewrites it with personality.
import type { Persona } from '@aurane/protocol';
import type { PlayerView, WorldEvent } from '@aurane/sim';
import type { LlmClient } from './llm/index.js';
import { PERSONA_VOICES } from './personas.js';

export interface BriefingInput {
  view: PlayerView;
  events: WorldEvent[];          // since the player was last seen
  awaySeconds: number;
  persona: Persona;
  lang: 'fr' | 'en';
  names: Record<string, string>; // colony id → name
}

export interface Digest {
  draws: number;
  relaysCut: number;
  raidsSuffered: number;
  raidsDone: number;
  battlesWon: number;
  battlesLost: number;
  claimed: number;
  captured: number;
  lost: number;
  trades: number;
  beacons: number;
  treaties: number;
  unpowered: number;
  convoysLost: number;
  attackers: string[];
}

export function digest(input: BriefingInput): Digest {
  const me = input.view.me.id;
  const d: Digest = { draws: 0, relaysCut: 0, raidsSuffered: 0, raidsDone: 0, battlesWon: 0, battlesLost: 0, claimed: 0, captured: 0, lost: 0, trades: 0, beacons: 0, treaties: 0, unpowered: 0, convoysLost: 0, attackers: [] };
  const attackers = new Set<string>();
  for (const e of input.events) {
    switch (e.kind) {
      case 'draw': d.draws++; break;
      case 'relay.cut': if (e.actors[1] === me) { d.relaysCut++; d.raidsSuffered++; attackers.add(e.actors[0]!); } else if (e.actors[0] === me) d.raidsDone++; break;
      case 'sabotage.success': if (e.actors[1] === me) { d.relaysCut++; attackers.add(e.actors[0]!); } break;
      case 'battle': { const won = (e.data as { attackerWins?: boolean } | undefined)?.attackerWins; if (e.actors[0] === me) { if (won) d.battlesWon++; else d.battlesLost++; } else if (e.actors[1] === me) { if (won) d.battlesLost++; else d.battlesWon++; attackers.add(e.actors[0]!); } break; }
      case 'system.claimed': if (e.actors[0] === me) d.claimed++; break;
      case 'system.captured': if (e.actors[0] === me) d.captured++; else if (e.actors[1] === me) { d.lost++; attackers.add(e.actors[0]!); } break;
      case 'barter.done': d.trades++; break;
      case 'beacon.lit': if (e.actors[0] === me) d.beacons++; break;
      case 'treaty.signed': d.treaties++; break;
      case 'relays.unpowered': if (e.actors[0] === me) d.unpowered++; break;
      case 'convoy.lost': if (e.actors[0] === me) { d.convoysLost++; if (e.actors[1]) attackers.add(e.actors[1]); } break;
    }
  }
  d.attackers = [...attackers].map((id) => input.names[id] ?? id);
  return d;
}

function hours(s: number, lang: 'fr' | 'en'): string {
  const h = Math.round(s / 3600);
  if (h < 1) return lang === 'fr' ? 'moins d\'une heure' : 'less than an hour';
  if (h < 48) return lang === 'fr' ? `${h} h` : `${h} h`;
  return lang === 'fr' ? `${Math.round(h / 24)} jours` : `${Math.round(h / 24)} days`;
}

/** Deterministic briefing, always available. */
export function templateBriefing(input: BriefingInput): string {
  const d = digest(input);
  const v = input.view;
  const voice = PERSONA_VOICES[input.persona];
  const L = input.lang;
  const lines: string[] = [];
  if (L === 'fr') {
    lines.push(`Absence : ${hours(input.awaySeconds, L)}, ${d.draws} Tirage${d.draws > 1 ? 's' : ''}.`);
    lines.push(`Réseau : ${v.me.connectedCount} système${v.me.connectedCount > 1 ? 's' : ''} connecté${v.me.connectedCount > 1 ? 's' : ''}${d.claimed ? `, ${d.claimed} nouveau${d.claimed > 1 ? 'x' : ''}` : ''}${d.unpowered ? `, ${d.unpowered} heure${d.unpowered > 1 ? 's' : ''} sous-alimentée${d.unpowered > 1 ? 's' : ''} (Énergie !)` : ''}.`);
    lines.push(`Stocks : Métal ${Math.round(v.me.stock.metal)}, Énergie ${Math.round(v.me.stock.energy)}, Vivres ${Math.round(v.me.stock.food)}, Cristal ${Math.round(v.me.stock.crystal)}, Rium ${Math.round(v.me.stock.rium)}, ${Math.round(v.me.credits)} Crédits.`);
    if (d.raidsSuffered || d.lost || d.battlesLost) lines.push(`Alerte : ${d.relaysCut} relais coupé${d.relaysCut > 1 ? 's' : ''}, ${d.lost} système${d.lost > 1 ? 's' : ''} perdu${d.lost > 1 ? 's' : ''}${d.attackers.length ? ` ; responsables : ${d.attackers.join(', ')}` : ''}.`);
    if (d.raidsDone || d.captured || d.battlesWon) lines.push(`Opérations : ${d.battlesWon} victoire${d.battlesWon > 1 ? 's' : ''}, ${d.raidsDone} raid${d.raidsDone > 1 ? 's' : ''}, ${d.captured} capture${d.captured > 1 ? 's' : ''}.`);
    if (d.convoysLost) lines.push(`Logistique : ${d.convoysLost} convoi${d.convoysLost > 1 ? 's' : ''} perdu${d.convoysLost > 1 ? 's' : ''} ; escorte-les ou change de route.`);
    { const o = v.me.lastOverflow; const lost = Math.round(o.metal + o.energy + o.food + o.crystal + o.rium); if (lost > 0) lines.push(`Entrepôts pleins : ${lost} ressources perdues au dernier Tirage. Construis un Entrepôt ou une route vers la capitale.`); }
    if (d.trades) lines.push(`Marché : ${d.trades} troc${d.trades > 1 ? 's' : ''} réglé${d.trades > 1 ? 's' : ''}.`);
    if (d.treaties) lines.push(`Diplomatie : ${d.treaties} traité${d.treaties > 1 ? 's' : ''} signé${d.treaties > 1 ? 's' : ''}.`);
    if (d.beacons) lines.push(`Un Phare rallumé. Le Signal se souvient.`);
    if (v.draw?.event.kind === 'storm') lines.push('Tempête en cours : certains relais sont hors de portée pour l\'heure.');
    lines.push(`Recommandation : ${v.me.stock.energy < 60 ? 'achète de l\'Énergie avant le prochain Tirage' : v.me.connectedCount < 4 ? 'relie une étoile de plus, la plus proche' : 'double ton pont le plus fragile'}.`);
    lines.push(voice.signoff.fr);
  } else {
    lines.push(`Away: ${hours(input.awaySeconds, L)}, ${d.draws} Draw${d.draws > 1 ? 's' : ''}.`);
    lines.push(`Network: ${v.me.connectedCount} connected system${v.me.connectedCount > 1 ? 's' : ''}${d.claimed ? `, ${d.claimed} new` : ''}${d.unpowered ? `, ${d.unpowered} unpowered hour${d.unpowered > 1 ? 's' : ''} (Energy!)` : ''}.`);
    lines.push(`Stocks: Metal ${Math.round(v.me.stock.metal)}, Energy ${Math.round(v.me.stock.energy)}, Food ${Math.round(v.me.stock.food)}, Crystal ${Math.round(v.me.stock.crystal)}, Rium ${Math.round(v.me.stock.rium)}, ${Math.round(v.me.credits)} Credits.`);
    if (d.raidsSuffered || d.lost || d.battlesLost) lines.push(`Alert: ${d.relaysCut} relay${d.relaysCut > 1 ? 's' : ''} cut, ${d.lost} system${d.lost > 1 ? 's' : ''} lost${d.attackers.length ? `; by ${d.attackers.join(', ')}` : ''}.`);
    if (d.raidsDone || d.captured || d.battlesWon) lines.push(`Operations: ${d.battlesWon} win${d.battlesWon > 1 ? 's' : ''}, ${d.raidsDone} raid${d.raidsDone > 1 ? 's' : ''}, ${d.captured} capture${d.captured > 1 ? 's' : ''}.`);
    if (d.convoysLost) lines.push(`Logistics: ${d.convoysLost} convoy${d.convoysLost > 1 ? 's' : ''} lost; escort them or change the route.`);
    { const o = v.me.lastOverflow; const lost = Math.round(o.metal + o.energy + o.food + o.crystal + o.rium); if (lost > 0) lines.push(`Warehouses full: ${lost} resources lost at the last Draw. Build a Warehouse or a route to the capital.`); }
    if (d.trades) lines.push(`Market: ${d.trades} barter${d.trades > 1 ? 's' : ''} settled.`);
    if (d.treaties) lines.push(`Diplomacy: ${d.treaties} treat${d.treaties > 1 ? 'ies' : 'y'} signed.`);
    if (d.beacons) lines.push(`A Beacon lit. The Signal remembers.`);
    if (v.draw?.event.kind === 'storm') lines.push('Storm in progress: some relays are out of range this hour.');
    lines.push(`Recommendation: ${v.me.stock.energy < 60 ? 'buy Energy before the next Draw' : v.me.connectedCount < 4 ? 'link one more star, the nearest' : 'double your weakest bridge'}.`);
    lines.push(voice.signoff.en);
  }
  return lines.join('\n');
}

/** Model-written briefing in the persona's voice; falls back to the template. */
export async function writeBriefing(input: BriefingInput, client: LlmClient | null): Promise<{ text: string; source: 'llm' | 'template' }> {
  const base = templateBriefing(input);
  if (!client) return { text: base, source: 'template' };
  const voice = PERSONA_VOICES[input.persona];
  const L = input.lang;
  const messages = [
    { role: 'system' as const, content: L === 'fr'
      ? `Tu es ${voice.name.fr}, Général IA d'une Colonie dans le jeu Aurane. Voix : ${voice.voice.fr}. Tu réécris un rapport factuel en 5 à 8 lignes courtes, à la deuxième personne, sans inventer aucun chiffre ni événement absent du rapport. Termine par : « ${voice.signoff.fr} ». Pas de titre, pas de liste à puces.`
      : `You are ${voice.name.en}, the AI General of a Colony in the game Aurane. Voice: ${voice.voice.en}. Rewrite a factual report in 5 to 8 short lines, second person, inventing no number or event that is not in the report. End with: "${voice.signoff.en}". No title, no bullet list.` },
    { role: 'user' as const, content: base },
  ];
  try {
    const res = await client.chat(messages, { maxTokens: 400, temperature: 0.7, timeoutMs: 30000 });
    const text = res.text.trim();
    if (text.length < 40) return { text: base, source: 'template' };
    return { text, source: 'llm' };
  } catch {
    return { text: base, source: 'template' };
  }
}
