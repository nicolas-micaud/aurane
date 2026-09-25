// What the General remembers: structured facts, never transcripts. Betrayals, allies, victories and
// defeats are read from the world's event log; formulas recently used and past seasons are persisted
// by the world process (MemoryStore), outside the world snapshot.
import type { Colony, World } from '@aurane/sim';
import { isAlly } from '@aurane/sim';
import { safeName } from '../security.js';
import type { Lang } from './sheets.js';

export interface SeasonMemory { seed: string; label: string; summary: { fr: string; en: string } }

/** The persisted part (per colony). */
export interface MemoryRecord {
  /** Last signature lines the General used, newest last, so it does not repeat itself. */
  recentPhrases: string[];
  seasons: SeasonMemory[];
  /** Free structured notes the world process may add (e.g. the player's stated preferences). */
  notes: { at: number; kind: string; text: string }[];
}

export const emptyMemory = (): MemoryRecord => ({ recentPhrases: [], seasons: [], notes: [] });

export interface MemoryStore {
  load(colonyId: string): Promise<MemoryRecord | null>;
  save(colonyId: string, m: MemoryRecord): Promise<void>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private map = new Map<string, MemoryRecord>();
  async load(colonyId: string): Promise<MemoryRecord | null> { const m = this.map.get(colonyId); return m ? structuredClone(m) : null; }
  async save(colonyId: string, m: MemoryRecord): Promise<void> { this.map.set(colonyId, structuredClone(m)); }
}

export interface Facts {
  betrayals: { who: string; what: string; hoursAgo: number }[];
  attackers: { who: string; times: number }[];
  allies: string[];
  treaties: { who: string; kind: string }[];
  victories: number;
  defeats: number;
  systemsLost: number;
  systemsCaptured: number;
  beaconsLit: number;
}

const HOUR = 3600;

/** Facts from the event log, for this colony, deterministic. */
export function factsFrom(w: World, c: Colony, sinceHours = 72): Facts {
  const from = w.time - sinceHours * HOUR;
  const name = (id: string): string => safeName(w.colonies[id]?.name ?? w.alliances[id]?.name ?? id);
  const hadTreaty = (other: string): boolean => Object.values(w.treaties).some((t) => (t.a === c.id && t.b === other) || (t.b === c.id && t.a === other));
  const attackers = new Map<string, number>();
  const betrayals: Facts['betrayals'] = [];
  let victories = 0, defeats = 0, systemsLost = 0, systemsCaptured = 0, beaconsLit = 0;
  for (const e of w.events) {
    if (e.at < from) continue;
    const [a0, a1] = e.actors;
    const hostile = e.kind === 'relay.cut' || e.kind === 'blockade.start' || e.kind === 'system.captured' || e.kind === 'sabotage.success' || e.kind === 'refinery.raided';
    if (hostile && a1 === c.id && a0) {
      attackers.set(a0, (attackers.get(a0) ?? 0) + 1);
      if (hadTreaty(a0) || isAlly(w, c.id, a0)) betrayals.push({ who: name(a0), what: e.kind, hoursAgo: Math.round((w.time - e.at) / HOUR) });
    }
    if (e.kind === 'battle') {
      const won = (e.data as { attackerWins?: boolean } | undefined)?.attackerWins;
      if (a0 === c.id) { if (won) victories++; else defeats++; } else if (a1 === c.id) { if (won) defeats++; else victories++; }
    }
    if (e.kind === 'system.captured') { if (a0 === c.id) systemsCaptured++; else if (a1 === c.id) systemsLost++; }
    if (e.kind === 'beacon.lit' && a0 === c.id) beaconsLit++;
  }
  const allies = Object.values(w.colonies).filter((o) => o.id !== c.id && isAlly(w, c.id, o.id)).map((o) => safeName(o.name));
  const treaties = Object.values(w.treaties).filter((t) => (t.a === c.id || t.b === c.id) && (t.until === null || t.until > w.time)).map((t) => ({ who: name(t.a === c.id ? t.b : t.a), kind: t.kind }));
  return {
    betrayals: betrayals.slice(-5),
    attackers: [...attackers.entries()].map(([id, times]) => ({ who: name(id), times })).sort((x, y) => y.times - x.times).slice(0, 5),
    allies, treaties, victories, defeats, systemsLost, systemsCaptured, beaconsLit,
  };
}

/** The memory block of the prompt, compact, in the player's language. */
export function renderMemory(f: Facts, m: MemoryRecord, lang: Lang): string {
  const L: string[] = [];
  const kindFr: Record<string, string> = { 'relay.cut': 'a coupé un relais', 'blockade.start': 'a mis un système sous blocus', 'system.captured': 'a pris un système', 'sabotage.success': 'a saboté un relais', 'refinery.raided': 'a pillé une raffinerie' };
  const kindEn: Record<string, string> = { 'relay.cut': 'cut a relay', 'blockade.start': 'blockaded a system', 'system.captured': 'took a system', 'sabotage.success': 'sabotaged a relay', 'refinery.raided': 'raided a refinery' };
  if (lang === 'fr') {
    if (f.betrayals.length) L.push(`Trahisons : ${f.betrayals.map((b) => `${b.who} ${kindFr[b.what] ?? b.what} il y a ${b.hoursAgo} h malgré un traité`).join(' ; ')}.`);
    if (f.attackers.length) L.push(`Nous ont attaqués (72 h) : ${f.attackers.map((a) => `${a.who} ×${a.times}`).join(', ')}.`);
    if (f.allies.length) L.push(`Alliés : ${f.allies.join(', ')}.`);
    if (f.treaties.length) L.push(`Traités en vigueur : ${f.treaties.map((t) => `${t.kind} avec ${t.who}`).join(', ')}.`);
    L.push(`Bilan 72 h : ${f.victories} victoire(s), ${f.defeats} défaite(s), ${f.systemsCaptured} capture(s), ${f.systemsLost} système(s) perdu(s), ${f.beaconsLit} Phare(s) rallumé(s).`);
    if (m.seasons.length) L.push(`Saisons passées : ${m.seasons.slice(-2).map((s) => `${s.label} — ${s.summary.fr}`).join(' | ')}.`);
    if (m.notes.length) L.push(`Notes : ${m.notes.slice(-4).map((n) => n.text).join(' ; ')}.`);
    if (m.recentPhrases.length) L.push(`Formules déjà employées récemment, à ne pas répéter : ${m.recentPhrases.slice(-6).map((p) => `« ${p} »`).join(', ')}.`);
    return L.join('\n');
  }
  if (f.betrayals.length) L.push(`Betrayals: ${f.betrayals.map((b) => `${b.who} ${kindEn[b.what] ?? b.what} ${b.hoursAgo} h ago despite a treaty`).join('; ')}.`);
  if (f.attackers.length) L.push(`Attacked us (72 h): ${f.attackers.map((a) => `${a.who} ×${a.times}`).join(', ')}.`);
  if (f.allies.length) L.push(`Allies: ${f.allies.join(', ')}.`);
  if (f.treaties.length) L.push(`Treaties in force: ${f.treaties.map((t) => `${t.kind} with ${t.who}`).join(', ')}.`);
  L.push(`Last 72 h: ${f.victories} win(s), ${f.defeats} defeat(s), ${f.systemsCaptured} capture(s), ${f.systemsLost} system(s) lost, ${f.beaconsLit} Beacon(s) lit.`);
  if (m.seasons.length) L.push(`Past seasons: ${m.seasons.slice(-2).map((s) => `${s.label} — ${s.summary.en}`).join(' | ')}.`);
  if (m.notes.length) L.push(`Notes: ${m.notes.slice(-4).map((n) => n.text).join('; ')}.`);
  if (m.recentPhrases.length) L.push(`Formulas used recently, do not repeat: ${m.recentPhrases.slice(-6).map((p) => `"${p}"`).join(', ')}.`);
  return L.join('\n');
}

/** Signature lines (catchphrases, jokes) found in an answer, to be remembered so they are not repeated. */
export function signaturesIn(text: string, candidates: readonly string[]): string[] {
  const t = text.toLowerCase();
  return candidates.filter((c) => t.includes(c.toLowerCase().replace(/[.!…]$/, '')));
}

export function rememberPhrases(m: MemoryRecord, phrases: readonly string[], cap = 10): MemoryRecord {
  const recent = [...m.recentPhrases.filter((p) => !phrases.includes(p)), ...phrases].slice(-cap);
  return { ...m, recentPhrases: recent };
}
