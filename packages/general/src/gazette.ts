// The Gazette: a daily public chronicle of the galaxy, written from the event log.
// Template first (always available, deterministic), model rewrite when a client exists.
import type { World } from '@aurane/sim';
import { colonyScore } from '@aurane/sim';
import type { LlmClient } from './llm.js';

export interface GazetteIssue {
  day: number;                 // season day (1-based)
  lang: 'fr' | 'en';
  title: string;
  lead: string;
  sections: { heading: string; body: string }[];
  source: 'llm' | 'template';
  generatedAt: number;         // sim time
}

interface DayFacts {
  day: number;
  draws: number;
  battles: number;
  cuts: number;
  /** The day's biggest engagements and new blockades, for the siege column. */
  sieges: { system: string; sides: string[]; kills: number; minutes: number }[];
  blockades: { by: string; owner: string; system: string }[];
  stationsDown: { by: string; owner: string; system: string }[];
  convoysLost: number;
  captures: { by: string; from: string; system: string }[];
  beacons: { by: string; name: string }[];
  treaties: number;
  alliances: string[];
  founded: number;
  storms: number;
  eruptions: number;
  top: { name: string; faction: string; score: number }[];
  titles: { network: string | null; admiralty: string | null; exchange: string | null };
  daysLeft: number;
}

const name = (w: World, id: string | undefined): string => (id ? w.colonies[id]?.name ?? w.alliances[id]?.name ?? id : '—');
const sysName = (w: World, id: string | undefined): string => (id ? w.galaxy.systems[id]?.name ?? id : '—');
const beaconName = (w: World, id: string | undefined): string => (id ? w.galaxy.systems[id]?.beaconName ?? w.galaxy.systems[id]?.name ?? id : '—');

export function dayFacts(w: World, day: number): DayFacts {
  const from = (day - 1) * 86400, to = day * 86400;
  const events = w.events.filter((e) => e.at >= from && e.at < to);
  const count = (k: string): number => events.filter((e) => e.kind === k).length;
  return {
    day,
    draws: count('draw'),
    battles: count('battle'),
    cuts: count('relay.cut') + count('sabotage.success'),
    sieges: events.filter((e) => e.kind === 'battle').map((e) => { const d = e.data as { system?: string; seconds?: number; kills?: number } | undefined; return { system: sysName(w, d?.system), sides: e.actors.map((a) => name(w, a)), kills: d?.kills ?? 0, minutes: Math.max(1, Math.round((d?.seconds ?? 0) / 60)) }; }).sort((a, b) => b.kills - a.kills || b.minutes - a.minutes).slice(0, 3),
    blockades: events.filter((e) => e.kind === 'blockade.start').slice(0, 5).map((e) => ({ by: name(w, e.actors[0]), owner: name(w, e.actors[1]), system: sysName(w, (e.data as { system?: string } | undefined)?.system) })),
    stationsDown: events.filter((e) => e.kind === 'relay.cut').slice(0, 5).map((e) => ({ by: name(w, e.actors[0]), owner: name(w, e.actors[1]), system: sysName(w, (e.data as { system?: string } | undefined)?.system) })),
    convoysLost: count('convoy.lost'),
    captures: events.filter((e) => e.kind === 'system.captured').map((e) => ({ by: name(w, e.actors[0]), from: name(w, e.actors[1]), system: w.galaxy.systems[(e.data as { system?: string })?.system ?? '']?.name ?? '?' })),
    beacons: events.filter((e) => e.kind === 'beacon.lit').map((e) => ({ by: name(w, e.actors[0]), name: String((e.data as { beacon?: string })?.beacon ?? beaconName(w, undefined)) })),
    treaties: count('treaty.signed'),
    alliances: events.filter((e) => e.kind === 'alliance.created').map((e) => String((e.data as { name?: string })?.name ?? '')),
    founded: count('colony.founded'),
    storms: events.filter((e) => e.kind === 'draw' && (e.data as { event?: { kind: string } })?.event?.kind === 'storm').length,
    eruptions: events.filter((e) => e.kind === 'draw' && (e.data as { event?: { kind: string } })?.event?.kind === 'eruption').length,
    top: Object.values(w.colonies).map((c) => ({ name: c.name, faction: c.faction, score: Math.round(colonyScore(w, c) * 10) / 10 })).sort((a, b) => b.score - a.score).slice(0, 5),
    titles: { network: name(w, w.titles.network ?? undefined), admiralty: name(w, w.titles.admiralty ?? undefined), exchange: name(w, w.titles.exchange ?? undefined) },
    daysLeft: Math.max(0, Math.ceil((w.seasonEndsAt - w.time) / 86400)),
  };
}

export function templateGazette(f: DayFacts, lang: 'fr' | 'en', now: number): GazetteIssue {
  const fr = lang === 'fr';
  const sections: { heading: string; body: string }[] = [];
  const s = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;
  if (fr) {
    sections.push({ heading: 'Le front', body: f.battles || f.cuts ? `${s(f.battles, 'bataille', 'batailles')}, ${s(f.cuts, 'relais coupé', 'relais coupés')}.${f.captures.length ? ' ' + f.captures.map((c) => `${c.by} prend ${c.system} à ${c.from}`).join(' ; ') + '.' : ''}` : 'Journée calme sur le front. Les Généraux affûtent leurs doctrines.' });
    if (f.sieges.length || f.blockades.length || f.stationsDown.length) {
      const parts: string[] = [];
      for (const sg of f.sieges) parts.push(`À ${sg.system}, ${sg.sides.join(' contre ')} : ${sg.minutes} minute${sg.minutes > 1 ? 's' : ''} de feu, ${s(sg.kills, 'coque perdue', 'coques perdues')}.`);
      for (const b of f.blockades) parts.push(`${b.by} tient le plateau de ${b.system} ; ${b.owner} a douze heures pour le reprendre.`);
      for (const d of f.stationsDown) parts.push(`La station de ${d.system} (${d.owner}) s'est tue sous les tirs de ${d.by}.`);
      if (f.convoysLost) parts.push(`${s(f.convoysLost, 'convoi perdu', 'convois perdus')} en route.`);
      sections.push({ heading: 'Les sièges', body: parts.join(' ') });
    }
    sections.push({ heading: 'La Trame politique', body: `${s(f.treaties, 'traité signé', 'traités signés')}${f.alliances.length ? ` ; nouvelles alliances : ${f.alliances.join(', ')}` : ''}${f.founded ? ` ; ${s(f.founded, 'Colonie fondée', 'Colonies fondées')}` : ''}.` });
    if (f.beacons.length) sections.push({ heading: 'Les Phares', body: f.beacons.map((b) => `${b.by} rallume ${b.name}. Le Signal se souvient.`).join(' ') });
    sections.push({ heading: 'Le ciel', body: `${s(f.draws, 'Tirage', 'Tirages')}${f.storms ? `, ${s(f.storms, 'tempête', 'tempêtes')}` : ''}${f.eruptions ? `, ${s(f.eruptions, 'éruption', 'éruptions')}` : ''}. Titres : Grand Réseau ${f.titles.network}, Amirauté ${f.titles.admiralty}, Bourse ${f.titles.exchange}.` });
    sections.push({ heading: 'Le classement', body: f.top.map((t, i) => `${i + 1}. ${t.name} (${t.score})`).join(' · ') });
    return { day: f.day, lang, title: `Gazette de l'Aurane — jour ${f.day}`, lead: `Le Silence est dans ${f.daysLeft} jours. ${f.battles ? 'La galaxie s\'arme.' : 'La galaxie tisse.'}`, sections, source: 'template', generatedAt: now };
  }
  sections.push({ heading: 'The front', body: f.battles || f.cuts ? `${s(f.battles, 'battle', 'battles')}, ${s(f.cuts, 'relay cut', 'relays cut')}.${f.captures.length ? ' ' + f.captures.map((c) => `${c.by} takes ${c.system} from ${c.from}`).join('; ') + '.' : ''}` : 'A quiet day on the front. Generals sharpen their doctrines.' });
  if (f.sieges.length || f.blockades.length || f.stationsDown.length) {
    const parts: string[] = [];
    for (const sg of f.sieges) parts.push(`At ${sg.system}, ${sg.sides.join(' against ')}: ${sg.minutes} minute${sg.minutes > 1 ? 's' : ''} under fire, ${s(sg.kills, 'hull lost', 'hulls lost')}.`);
    for (const b of f.blockades) parts.push(`${b.by} holds the plateau of ${b.system}; ${b.owner} has twelve hours to take it back.`);
    for (const d of f.stationsDown) parts.push(`The station of ${d.system} (${d.owner}) fell silent under ${d.by}'s guns.`);
    if (f.convoysLost) parts.push(`${s(f.convoysLost, 'convoy lost', 'convoys lost')} en route.`);
    sections.push({ heading: 'The sieges', body: parts.join(' ') });
  }
  sections.push({ heading: 'Politics', body: `${s(f.treaties, 'treaty signed', 'treaties signed')}${f.alliances.length ? `; new alliances: ${f.alliances.join(', ')}` : ''}${f.founded ? `; ${s(f.founded, 'Colony founded', 'Colonies founded')}` : ''}.` });
  if (f.beacons.length) sections.push({ heading: 'The Beacons', body: f.beacons.map((b) => `${b.by} lights ${b.name}. The Signal remembers.`).join(' ') });
  sections.push({ heading: 'The sky', body: `${s(f.draws, 'Draw', 'Draws')}${f.storms ? `, ${s(f.storms, 'storm', 'storms')}` : ''}${f.eruptions ? `, ${s(f.eruptions, 'eruption', 'eruptions')}` : ''}. Titles: Great Network ${f.titles.network}, Admiralty ${f.titles.admiralty}, Exchange ${f.titles.exchange}.` });
  sections.push({ heading: 'Standings', body: f.top.map((t, i) => `${i + 1}. ${t.name} (${t.score})`).join(' · ') });
  return { day: f.day, lang, title: `Aurane Gazette — day ${f.day}`, lead: `The Silence falls in ${f.daysLeft} days. ${f.battles ? 'The galaxy arms.' : 'The galaxy weaves.'}`, sections, source: 'template', generatedAt: now };
}

export async function writeGazette(w: World, day: number, lang: 'fr' | 'en', client: LlmClient | null): Promise<GazetteIssue> {
  const facts = dayFacts(w, day);
  const base = templateGazette(facts, lang, w.time);
  if (!client) return base;
  const messages = [
    { role: 'system' as const, content: lang === 'fr'
      ? 'Tu es la rédaction de la Gazette de l\'Aurane, chronique quotidienne d\'une galaxie en jeu. Ton : journalisme spatial, sobre, un peu littéraire, jamais moqueur envers les joueurs. Réécris les faits fournis en JSON : {"title": string, "lead": string, "sections": [{"heading": string, "body": string}]} avec 3 à 5 sections courtes. N\'invente aucun nom, chiffre ni événement. Réponds uniquement avec le JSON.'
      : 'You are the newsroom of the Aurane Gazette, the daily chronicle of a galaxy at play. Tone: space journalism, sober, a little literary, never mocking players. Rewrite the given facts as JSON: {"title": string, "lead": string, "sections": [{"heading": string, "body": string}]} with 3 to 5 short sections. Invent no name, number or event. Answer with the JSON only.' },
    { role: 'user' as const, content: JSON.stringify({ facts, template: base }) },
  ];
  try {
    const res = await client.chat(messages, { maxTokens: 900, temperature: 0.6, timeoutMs: 60000 });
    const { extractJson } = await import('./llm.js');
    const raw = extractJson(res.text) as { title?: string; lead?: string; sections?: { heading?: string; body?: string }[] };
    if (!raw.title || !raw.sections?.length) return base;
    return { ...base, title: String(raw.title).slice(0, 120), lead: String(raw.lead ?? base.lead).slice(0, 400), sections: raw.sections.slice(0, 6).map((x) => ({ heading: String(x.heading ?? '').slice(0, 80), body: String(x.body ?? '').slice(0, 1200) })), source: 'llm' };
  } catch {
    return base;
  }
}
