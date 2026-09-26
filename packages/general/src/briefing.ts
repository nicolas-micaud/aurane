// The briefing: what happened while you were away, in your General's voice. A template always works;
// the model, when available, rewrites it with personality, and every figure it keeps is checked
// against the report. Nothing in here runs at the Draw: the caller queues it at the connection.
import type { Persona } from '@aurane/protocol';
import type { PlayerView, WorldEvent } from '@aurane/sim';
import { LlmUnavailable, type LlmClient } from './llm/index.js';
import { PERSONA_VOICES } from './personas.js';
import { numbersIn, verifyNumbers, RULE_NUMBERS, type Analysis, renderAnalysis } from './analysis/index.js';
import { degradedReply, describeChoice, lastChoice, systemPrompt, type DegradeReason, type Facts, type MemoryRecord } from './persona/index.js';

export interface BriefingInput {
  view: PlayerView;
  events: WorldEvent[];          // since the player was last seen
  awaySeconds: number;
  persona: Persona;
  lang: 'fr' | 'en';
  names: Record<string, string>; // colony id → name
  analysis?: Analysis | undefined;
  memory?: string | undefined;
  /** The persisted memory (choices, episodes): the report then names the player's last decision and what followed. */
  record?: MemoryRecord | undefined;
  /** Facts from the event log: the report then names who broke a treaty or keeps attacking. */
  facts?: Facts | undefined;
  seed?: string | number | undefined;
  overQuota?: boolean | undefined;
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
  if (h < 48) return `${h} h`;
  return lang === 'fr' ? `${Math.round(h / 24)} jours` : `${Math.round(h / 24)} days`;
}


const plural = (n: number, fr: boolean): string => (fr ? (n > 1 ? 's' : '') : n === 1 ? '' : 's');

/**
 * What the General remembers, inside the report itself (decision 0009, Grok's reading of 26.09): the player's last
 * Counsel decision and what followed while they were away, then one name it does not forget. Deterministic, so the
 * template carries it and the model only rephrases it.
 */
export function recallLines(input: BriefingInput, d: Digest): string[] {
  const fr = input.lang === 'fr';
  const out: string[] = [];
  const name = (id: string): string => input.view.systems.find((s) => s.id === id)?.name ?? input.names[id] ?? id;
  const last = input.record ? lastChoice(input.record) : null;
  if (last) {
    const what = describeChoice(last.id, input.lang, name);
    const followed = fr
      ? (d.raidsSuffered || d.lost ? `j'ai tenu la ligne pendant ${d.relaysCut} coupure${plural(d.relaysCut, true)}` : d.claimed ? `j'ai relié ${d.claimed} étoile${plural(d.claimed, true)} entre-temps` : d.trades ? `j'ai réglé ${d.trades} troc${plural(d.trades, true)}` : 'rien n\'a bougé de ce côté')
      : (d.raidsSuffered || d.lost ? `I held the line through ${d.relaysCut} cut${plural(d.relaysCut, false)}` : d.claimed ? `I linked ${d.claimed} star${plural(d.claimed, false)} meanwhile` : d.trades ? `I settled ${d.trades} barter${plural(d.trades, false)}` : 'nothing moved on that side');
    if (last.kind === 'counsel.taken') out.push(fr ? `Tu m'avais dit oui pour « ${what} » ; depuis, ${followed}.` : `You had said yes to "${what}"; since then, ${followed}.`);
    else out.push(fr ? `Tu avais écarté « ${what} » ; je n'y suis pas revenu, et ${followed}.` : `You had set aside "${what}"; I did not go back to it, and ${followed}.`);
  }
  const f = input.facts;
  if (f) {
    const b = f.betrayals[f.betrayals.length - 1];
    const a = f.attackers[0];
    if (b) out.push(fr ? `Je n'oublie pas : ${b.who} a rompu un traité il y a ${b.hoursAgo} h.` : `I do not forget: ${b.who} broke a treaty ${b.hoursAgo} h ago.`);
    else if (a && a.times >= 2) out.push(fr ? `Je garde ${a.who} à l'œil : ${a.times} attaques en 72 h.` : `I keep an eye on ${a.who}: ${a.times} attacks in 72 h.`);
  }
  return out;
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
    lines.push(...recallLines(input, d));
    const opt = input.analysis?.options[0];
    lines.push(`Recommandation : ${opt ? opt.label.fr : v.me.stock.energy < 60 ? 'achète de l\'Énergie avant le prochain Tirage' : v.me.connectedCount < 4 ? 'relie une étoile de plus, la plus proche' : 'double ton pont le plus fragile'}.`);
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
    lines.push(...recallLines(input, d));
    const opt = input.analysis?.options[0];
    lines.push(`Recommendation: ${opt ? opt.label.en : v.me.stock.energy < 60 ? 'buy Energy before the next Draw' : v.me.connectedCount < 4 ? 'link one more star, the nearest' : 'double your weakest bridge'}.`);
    lines.push(voice.signoff.en);
  }
  return lines.join('\n');
}

const degradeReason = (err: unknown): DegradeReason => (err instanceof LlmUnavailable && (err.reason === 'saturated' || err.reason === 'open') ? 'saturated' : 'unavailable');

/** Model-written briefing in the persona's voice; falls back to the template, every figure checked against it. */
export async function writeBriefing(input: BriefingInput, client: LlmClient | null): Promise<{ text: string; source: 'llm' | 'template' | 'degraded'; numbersStripped?: boolean }> {
  const base = templateBriefing(input);
  const voice = PERSONA_VOICES[input.persona];
  const L = input.lang;
  if (input.overQuota) return { text: `${degradedReply(input.persona, L, 'quota', input.seed ?? input.view.me.id)}\n${base}`, source: 'degraded' };
  if (!client) return { text: base, source: 'template' };
  const analysisText = input.analysis ? renderAnalysis(input.analysis, L) : '';
  const system = systemPrompt({
    persona: input.persona, lang: L, crisis: input.analysis?.crisis ?? false, seed: input.seed ?? input.view.me.id, focus: 'briefing', primer: false,
    analysis: analysisText ? `${analysisText}\n\nREPORT OF THE ABSENCE (facts):\n${base}` : `REPORT OF THE ABSENCE (facts):\n${base}`, memory: input.memory ?? '',
    contract: [
      'TASK: rewrite the report of the absence as a briefing in your voice: 5 to 8 short lines, second person, plain text (no JSON, no title, no bullets).',
      'Keep every fact and every figure of the report; add nothing that is not in the report or the analysis. End with your sign-off.',
      'If the report names a decision the player made ("you had said yes to", "you had set aside") or a name you do not forget, keep that sentence in your own words: it is why they come back to you.',
      `Sign-off: ${voice.signoff[L]}`,
    ],
  });
  const allowed = new Set<number>([...RULE_NUMBERS, ...numbersIn(base), ...numbersIn(analysisText), ...numbersIn(input.memory ?? '')]);
  for (const v of [...allowed]) { allowed.add(Math.round(v)); if (v >= 100) allowed.add(Math.round(v / 10) * 10); }
  try {
    const res = await client.chat([{ role: 'system', content: system }, { role: 'user', content: L === 'fr' ? 'Mon briefing.' : 'My briefing.' }], { task: 'briefing' });
    let text = res.text.trim();
    if (text.length < 40) return { text: base, source: 'template' };
    const check = verifyNumbers(text, allowed);
    if (!check.ok) text = check.stripped;
    if (text.length < 40) return { text: base, source: 'template', numbersStripped: true };
    if (!text.includes(voice.signoff[L])) text = `${text}\n${voice.signoff[L]}`;
    return { text, source: 'llm', numbersStripped: !check.ok };
  } catch (err) {
    if (err instanceof LlmUnavailable) return { text: `${degradedReply(input.persona, L, degradeReason(err), input.seed ?? input.view.me.id)}\n${base}`, source: 'degraded' };
    return { text: base, source: 'template' };
  }
}
