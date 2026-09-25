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

/**
 * The dedicated long memory of Aurane (decision 0009, Nick 25.09: a sokkan-memory/corthexis instance of its own,
 * player data kept apart from ninabot's). Contract, deliberately small: PUT /memory/{colony} with the record as JSON,
 * GET /memory/{colony}, DELETE /memory/{colony}; Bearer token. Postgres stays the working copy: the world never waits.
 */
export class HttpMemoryStore implements MemoryStore {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly fetchFn: typeof fetch = (i, o) => fetch(i, o), private readonly timeoutMs = 4000) {}
  private url(colonyId: string): string { return `${this.baseUrl.replace(/\/$/, '')}/memory/${encodeURIComponent(colonyId)}`; }
  private async call(method: string, colonyId: string, body?: unknown): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(this.url(colonyId), { method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: ctrl.signal });
    } finally { clearTimeout(timer); }
  }
  async load(colonyId: string): Promise<MemoryRecord | null> {
    const r = await this.call('GET', colonyId);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`memory instance: HTTP ${r.status}`);
    return await r.json() as MemoryRecord;
  }
  async save(colonyId: string, m: MemoryRecord): Promise<void> { const r = await this.call('PUT', colonyId, m); if (!r.ok) throw new Error(`memory instance: HTTP ${r.status}`); }
  async erase(colonyId: string): Promise<void> { const r = await this.call('DELETE', colonyId); if (!r.ok && r.status !== 404) throw new Error(`memory instance: HTTP ${r.status}`); }
}

/** Working copy first (Postgres), long memory mirrored in the background; a mirror failure never stalls the world. */
export class MirroredMemoryStore implements MemoryStore {
  private failures = 0;
  constructor(private readonly primary: MemoryStore, private readonly mirror: HttpMemoryStore, private readonly onError: (err: Error) => void = () => undefined) {}
  async load(colonyId: string): Promise<MemoryRecord | null> {
    const local = await this.primary.load(colonyId);
    if (local) return local;
    try { const remote = await this.mirror.load(colonyId); if (remote) { await this.primary.save(colonyId, remote); return remote; } } catch (err) { this.onError(err as Error); }
    return null;
  }
  async save(colonyId: string, m: MemoryRecord): Promise<void> {
    await this.primary.save(colonyId, m);
    void this.mirror.save(colonyId, m).then(() => { this.failures = 0; }).catch((err: Error) => { this.failures++; this.onError(err); });
  }
  /** Erase both: the world's copy at once, the long memory before returning (the player asked; we say if it failed). */
  async erase(colonyId: string): Promise<{ primary: true; mirror: boolean }> {
    await this.primary.save(colonyId, emptyMemory());
    try { await this.mirror.erase(colonyId); return { primary: true, mirror: true }; } catch (err) { this.onError(err as Error); return { primary: true, mirror: false }; }
  }
  get mirrorFailures(): number { return this.failures; }
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
    { const c = choicesOf(m); if (c.taken.length || c.skipped.length) L.push(`Choix du joueur : a suivi ${c.taken.slice(-5).join(', ') || 'rien'} ; a écarté ${c.skipped.slice(-5).join(', ') || 'rien'}.`); }
    { const e = episodesOf(m); if (e.length) L.push(`Épisodes récents : ${e.slice(-3).join(' | ')}.`); }
    { const other = m.notes.filter((n) => !['counsel.taken', 'counsel.skipped', 'order', 'episode'].includes(n.kind)); if (other.length) L.push(`Notes : ${other.slice(-4).map((n) => n.text).join(' ; ')}.`); }
    if (m.recentPhrases.length) L.push(`Formules déjà employées récemment, à ne pas répéter : ${m.recentPhrases.slice(-6).map((p) => `« ${p} »`).join(', ')}.`);
    return L.join('\n');
  }
  if (f.betrayals.length) L.push(`Betrayals: ${f.betrayals.map((b) => `${b.who} ${kindEn[b.what] ?? b.what} ${b.hoursAgo} h ago despite a treaty`).join('; ')}.`);
  if (f.attackers.length) L.push(`Attacked us (72 h): ${f.attackers.map((a) => `${a.who} ×${a.times}`).join(', ')}.`);
  if (f.allies.length) L.push(`Allies: ${f.allies.join(', ')}.`);
  if (f.treaties.length) L.push(`Treaties in force: ${f.treaties.map((t) => `${t.kind} with ${t.who}`).join(', ')}.`);
  L.push(`Last 72 h: ${f.victories} win(s), ${f.defeats} defeat(s), ${f.systemsCaptured} capture(s), ${f.systemsLost} system(s) lost, ${f.beaconsLit} Beacon(s) lit.`);
  if (m.seasons.length) L.push(`Past seasons: ${m.seasons.slice(-2).map((s) => `${s.label} — ${s.summary.en}`).join(' | ')}.`);
  { const c = choicesOf(m); if (c.taken.length || c.skipped.length) L.push(`Player's choices: followed ${c.taken.slice(-5).join(', ') || 'nothing'}; set aside ${c.skipped.slice(-5).join(', ') || 'nothing'}.`); }
  { const e = episodesOf(m); if (e.length) L.push(`Recent episodes: ${e.slice(-3).join(' | ')}.`); }
  { const other = m.notes.filter((n) => !['counsel.taken', 'counsel.skipped', 'order', 'episode'].includes(n.kind)); if (other.length) L.push(`Notes: ${other.slice(-4).map((n) => n.text).join('; ')}.`); }
  if (m.recentPhrases.length) L.push(`Formulas used recently, do not repeat: ${m.recentPhrases.slice(-6).map((p) => `"${p}"`).join(', ')}.`);
  return L.join('\n');
}

/** Signature lines (catchphrases, jokes) found in an answer, to be remembered so they are not repeated. */
export function signaturesIn(text: string, candidates: readonly string[]): string[] {
  const t = text.toLowerCase();
  return candidates.filter((c) => t.includes(c.toLowerCase().replace(/[.!…]$/, '')));
}

/** The *choices* layer: what the player took or set aside (a counsel card, an order), written without a model. */
export function recordChoice(m: MemoryRecord, kind: 'counsel.taken' | 'counsel.skipped' | 'order', id: string, at: number, cap = 60): MemoryRecord {
  const notes = [...m.notes, { at, kind, text: id }].slice(-cap);
  return { ...m, notes };
}

/** The *episodes* layer: one line per active day, written by the model (or a template), read again on return. */
export function recordEpisode(m: MemoryRecord, day: number, text: string, at: number, cap = 14): MemoryRecord {
  const notes = [...m.notes.filter((n) => !(n.kind === 'episode' && n.text.startsWith(`J${day} `))), { at, kind: 'episode', text: `J${day} ${text}` }];
  const episodes = notes.filter((n) => n.kind === 'episode');
  const keep = new Set(episodes.slice(-cap));
  return { ...m, notes: notes.filter((n) => n.kind !== 'episode' || keep.has(n)) };
}

export const choicesOf = (m: MemoryRecord): { taken: string[]; skipped: string[] } => ({
  taken: m.notes.filter((n) => n.kind === 'counsel.taken').map((n) => n.text),
  skipped: m.notes.filter((n) => n.kind === 'counsel.skipped').map((n) => n.text),
});
export const episodesOf = (m: MemoryRecord): string[] => m.notes.filter((n) => n.kind === 'episode').map((n) => n.text);

export function rememberPhrases(m: MemoryRecord, phrases: readonly string[], cap = 10): MemoryRecord {
  const recent = [...m.recentPhrases.filter((p) => !phrases.includes(p)), ...phrases].slice(-cap);
  return { ...m, recentPhrases: recent };
}
