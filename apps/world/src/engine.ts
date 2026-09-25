// The world process: one simulation, a real-time loop, NPC and absent-player Generals,
// snapshots, and a fan-out of per-colony views to connected clients.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { FACTIONS, PERSONAS, type Command, type Faction, type Persona } from '@aurane/protocol';
import {
  apply, battleList, battleReport, createWorld, decide, recordNotes, restoreWorld, seedNumber, snapshotWorld, spawnColony, systemViewFor, tick, viewFor,
  type ApplyResult, type BattleReport, type Colony, type PlayerView, type SystemDetailView, type World,
} from '@aurane/sim';
import { inboundWarning, tierUnlocked, type GazetteIssue, type Turn } from '@aurane/general';
import type { Config } from './config.js';
import type { Store } from './store.js';
import { GeneralService, type GeneralDeps } from './general.js';
import { simCounselSource } from './counsel.js';

const DECISION_INTERVAL_S = 1800;
const ABSENT_AFTER_S = 1800;

export type Listener = (view: PlayerView) => void;
export type SystemListener = (view: SystemDetailView) => void;
interface SystemWatch { colonyId: string; systemId: string; fn: SystemListener; last: string }
/** The System view streams at 2 Hz while something changes on the plateau. */
const SYSTEM_STREAM_MS = 500;

export class Engine {
  world!: World;
  private listeners = new Map<string, Set<Listener>>();
  private systemWatches = new Set<SystemWatch>();
  private timer: NodeJS.Timeout | null = null;
  private systemTimer: NodeJS.Timeout | null = null;
  private lastReal = Date.now();
  private lastSnapshot = Date.now();
  private lastDecisionSim = 0;
  private decisionTick = 0;
  private dirtyColonies = new Set<string>();
  private lastDrawSeen = -1;
  private lastDaySeen = -1;
  /** How far the event log has been read for the General's unprompted words. */
  private lastEventSeen = 0;
  /** The Generals: conversation, doctrine, briefing, Gazette, behind the job queue. Never called from step(). */
  readonly general: GeneralService;

  constructor(readonly cfg: Config, private readonly store: Store, generalDeps: Partial<GeneralDeps> = {}) {
    this.general = new GeneralService(cfg, { world: () => this.world, dirty: (id) => { this.dirtyColonies.add(id); }, ...generalDeps });
    this.general.counselSource = simCounselSource; // the simulation's counsel (0009), not the analysis' options
  }

  async init(): Promise<void> {
    let snap = await this.store.loadSnapshot();
    // A new seed or radius in the configuration means a new season: the old world is archived, a fresh one starts.
    // The radius may have grown during the season (galaxy growth): the base radius is what the season was configured with.
    if (snap && (snap.state.seed !== seedNumber(this.cfg.seasonSeed) || (snap.galaxyOptions.baseRadius ?? snap.galaxyOptions.radius ?? 12) !== this.cfg.galaxyRadius)) {
      const label = `${snap.state.seed}-${Math.floor(snap.state.time)}`;
      console.log(`[world] season changed (seed ${this.cfg.seasonSeed}, radius ${this.cfg.galaxyRadius}): archiving the previous world as ${label}`);
      await this.store.archiveSnapshot(label);
      snap = null;
    }
    if (snap) {
      this.world = restoreWorld(snap);
    } else {
      this.world = createWorld(this.cfg.seasonSeed, { radius: this.cfg.galaxyRadius, seasonDays: this.cfg.seasonDays });
      for (let i = 0; i < this.cfg.npcCount; i++) {
        const faction = FACTIONS[i % FACTIONS.length] as Faction;
        const persona = PERSONAS[(i * 7 + Math.floor(i / 4)) % PERSONAS.length] as Persona;
        try { spawnColony(this.world, { name: npcName(i), faction, persona, npc: true }); } catch { break; }
      }
      await this.snapshot();
    }
    this.lastDrawSeen = this.world.drawIndex;
    this.lastDaySeen = Math.floor(this.world.time / 86400);
    this.lastEventSeen = this.world.events.length;
  }

  start(): void {
    if (this.timer) return;
    this.general.start();
    this.lastReal = Date.now();
    this.timer = setInterval(() => void this.step(), 1000);
    this.systemTimer = setInterval(() => this.streamSystems(), SYSTEM_STREAM_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.systemTimer) clearInterval(this.systemTimer);
    this.timer = null;
    this.systemTimer = null;
    await this.general.stop();
    await this.snapshot();
  }

  /** One real-time step: advance the simulation, run Generals, snapshot, notify. */
  async step(): Promise<void> {
    const now = Date.now();
    const dt = ((now - this.lastReal) / 1000) * this.cfg.timeScale;
    this.lastReal = now;
    if (dt > 0 && !this.world.ended) {
      tick(this.world, dt, 60);
    }
    if (this.world.time - this.lastDecisionSim >= DECISION_INTERVAL_S) {
      this.lastDecisionSim = this.world.time;
      this.runGenerals();
    }
    this.speakFirst();
    const drawHappened = this.world.drawIndex !== this.lastDrawSeen;
    if (drawHappened) {
      this.lastDrawSeen = this.world.drawIndex;
      for (const id of this.listeners.keys()) this.dirtyColonies.add(id);
    }
    // A new season day: yesterday's Gazette is queued (spread over the off-peak window), never written here.
    const day = Math.floor(this.world.time / 86400);
    if (day !== this.lastDaySeen) { this.lastDaySeen = day; this.general.scheduleDailyGazette(day); this.general.scheduleEpisodes(day); }
    this.general.scheduleCounsel(); // T−20 min before the Draw: queued, never written here
    this.flush();
    if (now - this.lastSnapshot >= this.cfg.snapshotEverySeconds * 1000) {
      this.lastSnapshot = now;
      await this.snapshot();
    }
  }

  /** NPCs always play; a human's General plays only while the human is away. */
  private runGenerals(): void {
    this.decisionTick++;
    for (const c of Object.values(this.world.colonies)) {
      const absent = this.world.time - c.lastSeenAt >= ABSENT_AFTER_S;
      if (!c.npc && !absent) continue;
      const seen = c.lastSeenAt;
      const d = decide(this.world, c, this.decisionTick);
      for (const cmd of d.commands) apply(this.world, c.id, cmd);
      recordNotes(this.world, c, d.notes);
      c.lastSeenAt = seen; // the General acting does not count as the player being present
      if (d.commands.length && this.listeners.has(c.id)) this.dirtyColonies.add(c.id);
    }
  }

  /** A hostile fleet heading for a player's system: their General says so in the conversation, unprompted and free. */
  private speakFirst(): void {
    const w = this.world;
    if (this.lastEventSeen > w.events.length) this.lastEventSeen = 0;
    for (let i = this.lastEventSeen; i < w.events.length; i++) {
      const e = w.events[i]!;
      if (e.kind === 'onboarding.unlocked') {
        // A new screen opens: the General says its first word on it, in the player's language, no model.
        const c = w.colonies[e.actors[0] ?? ''];
        const d = e.data as { tier?: number; all?: boolean } | undefined;
        if (c && !c.npc) this.general.pushLine(c.id, tierUnlocked(c.persona, this.general.langOf(c.id), d?.tier ?? 1, d?.all === true));
        continue;
      }
      if (e.kind !== 'fleet.inbound') continue;
      const c = w.colonies[e.actors[1] ?? ''];
      if (!c || c.npc) continue;
      const d = e.data as { system?: string; arriveAt?: number; size?: number } | undefined;
      const lang = this.general.langOf(c.id);
      const text = inboundWarning(c.persona, lang, {
        system: w.galaxy.systems[d?.system ?? '']?.name ?? d?.system ?? '?', from: w.colonies[e.actors[0] ?? '']?.name ?? '?',
        minutes: Math.max(0, Math.round(((d?.arriveAt ?? w.time) - w.time) / 60)), size: d?.size ?? 0,
      });
      this.general.pushLine(c.id, text);
    }
    this.lastEventSeen = w.events.length;
  }

  async snapshot(): Promise<void> {
    await this.store.saveSnapshot(snapshotWorld(this.world));
  }

  // --- players -------------------------------------------------------------

  async createGuest(name: string, faction: Faction, persona: Persona, invite?: string, origin?: string): Promise<{ token: string; colony: Colony } | { error: 'invite required' | 'invalid invite' }> {
    const spawn = (): Colony => spawnColony(this.world, { name, faction, persona, npc: false, ...(origin ? { origin } : {}) });
    // Closed beta: the invitation must exist (store, or the environment's bootstrap list) and be unused.
    const code = (invite ?? '').trim().toUpperCase();
    if (this.cfg.requireInvite) {
      if (!code) return { error: 'invite required' };
      if (!(await this.store.findInvite(code)) && this.cfg.inviteCodes.map((x) => x.toUpperCase()).includes(code)) {
        await this.store.createInvite({ code, note: 'env', createdAt: Date.now(), usedBy: null, usedAt: null });
      }
      // A code spent on a colony of a past season is good again: the tester keeps their invitation across seasons.
      const known = await this.store.findInvite(code);
      if (known?.usedBy && !known.usedBy.startsWith('pending:') && !this.world.colonies[known.usedBy]) await this.store.releaseInvite(code);
      const pending = `pending:${randomBytes(4).toString('hex')}`;
      if (!(await this.store.useInvite(code, pending, Date.now()))) return { error: 'invalid invite' };
      const colony = spawn();
      await this.store.createInvite({ code, note: 'env', createdAt: Date.now(), usedBy: colony.id, usedAt: Date.now() }).catch(() => undefined);
      await this.store.useInvite(code, colony.id, Date.now()).catch(() => undefined);
      return this.issueToken(colony, name);
    }
    const colony = spawn();
    return this.issueToken(colony, name);
  }

  /** Opaque origin of a request (client address hashed with the auth secret): same origin ⇒ same household, no trade between its colonies. */
  originHash(ip: string | undefined): string | undefined {
    if (!ip) return undefined;
    return createHmac('sha256', this.cfg.authSecret).update(`origin:${ip}`).digest('hex').slice(0, 16);
  }

  private async issueToken(colony: Colony, name: string): Promise<{ token: string; colony: Colony }> {
    const token = randomBytes(24).toString('base64url');
    await this.store.createPlayer({ id: `P${colony.id}`, colonyId: colony.id, tokenHash: hashToken(token), name, createdAt: Date.now() });
    await this.snapshot();
    return { token, colony };
  }

  /** Invitations minted by the admin: short, unambiguous codes. */
  async createInvites(count: number, note: string): Promise<string[]> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const bytes = randomBytes(8);
      const code = `AUR-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
      await this.store.createInvite({ code, note, createdAt: Date.now(), usedBy: null, usedAt: null });
      codes.push(code);
    }
    return codes;
  }

  invites(): ReturnType<Store['listInvites']> { return this.store.listInvites(); }

  /** A signed, short-lived code that opens this colony on another device (it mints a second token). */
  linkCode(colonyId: string, ttlSeconds = 24 * 3600): string {
    const payload = Buffer.from(JSON.stringify({ c: colonyId, e: Date.now() + ttlSeconds * 1000, n: randomBytes(6).toString('base64url') })).toString('base64url');
    const sig = createHmac('sha256', this.cfg.authSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  async redeemLink(code: string): Promise<{ token: string; colony: Colony } | null> {
    const [payload, sig] = code.split('.');
    if (!payload || !sig) return null;
    const expected = createHmac('sha256', this.cfg.authSecret).update(payload).digest('base64url');
    if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    let data: { c: string; e: number };
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { c: string; e: number }; } catch { return null; }
    if (data.e < Date.now()) return null;
    const colony = this.world.colonies[data.c];
    if (!colony || colony.npc) return null;
    const token = randomBytes(24).toString('base64url');
    await this.store.createPlayer({ id: `P${colony.id}-${randomBytes(4).toString('hex')}`, colonyId: colony.id, tokenHash: hashToken(token), name: colony.name, createdAt: Date.now() });
    return { token, colony };
  }

  async authenticate(token: string): Promise<Colony | null> {
    const p = await this.store.findPlayerByToken(hashToken(token));
    if (!p) return null;
    return this.world.colonies[p.colonyId] ?? null;
  }

  command(colonyId: string, cmd: Command): ApplyResult {
    const res = apply(this.world, colonyId, cmd);
    this.dirtyColonies.add(colonyId);
    // Anyone sharing a sector with the actor may see the change; keep it simple and cheap.
    for (const id of this.listeners.keys()) if (id !== colonyId) this.dirtyColonies.add(id);
    return res;
  }

  view(colonyId: string): PlayerView | null {
    const c = this.world.colonies[colonyId];
    return c ? viewFor(this.world, c, this.cfg.timeScale) : null;
  }

  subscribe(colonyId: string, fn: Listener): () => void {
    if (!this.listeners.has(colonyId)) this.listeners.set(colonyId, new Set());
    this.listeners.get(colonyId)!.add(fn);
    const c = this.world.colonies[colonyId];
    if (c) { c.lastSeenAt = this.world.time; fn(viewFor(this.world, c, this.cfg.timeScale)); }
    return () => {
      const set = this.listeners.get(colonyId);
      set?.delete(fn);
      if (set && set.size === 0) this.listeners.delete(colonyId);
    };
  }

  // --- the System view ------------------------------------------------------

  systemView(colonyId: string, systemId: string): SystemDetailView | null {
    const c = this.world.colonies[colonyId];
    return c ? systemViewFor(this.world, c, systemId) : null;
  }

  battle(colonyId: string, battleId: string): BattleReport | null {
    const c = this.world.colonies[colonyId];
    return c ? battleReport(this.world, c, battleId) : null;
  }

  battles(colonyId: string): ReturnType<typeof battleList> {
    const c = this.world.colonies[colonyId];
    return c ? battleList(this.world, c) : [];
  }

  /** Stream one plateau to a client; the first frame is sent at once, then every change at up to 2 Hz. */
  watchSystem(colonyId: string, systemId: string, fn: SystemListener): () => void {
    const first = this.systemView(colonyId, systemId);
    const watch: SystemWatch = { colonyId, systemId, fn, last: first ? JSON.stringify(first) : '' };
    if (first) fn(first);
    this.systemWatches.add(watch);
    return () => { this.systemWatches.delete(watch); };
  }

  /** Called at SYSTEM_STREAM_MS; the view is rebuilt once per (colony, system) pair per tick. */
  streamSystems(): void {
    if (!this.systemWatches.size) return;
    const cache = new Map<string, string>();
    for (const wch of this.systemWatches) {
      const key = `${wch.colonyId}|${wch.systemId}`;
      let json = cache.get(key);
      if (json === undefined) {
        const v = this.systemView(wch.colonyId, wch.systemId);
        json = v ? JSON.stringify(v) : '';
        cache.set(key, json);
      }
      if (json && json !== wch.last) { wch.last = json; wch.fn(JSON.parse(json) as SystemDetailView); }
    }
  }

  private flush(): void {
    for (const id of this.dirtyColonies) {
      const set = this.listeners.get(id);
      const c = this.world.colonies[id];
      if (!set || !c) continue;
      const v = viewFor(this.world, c, this.cfg.timeScale);
      for (const fn of set) fn(v);
    }
    this.dirtyColonies.clear();
  }

  // --- the General (delegated to the service; nothing here touches a model) ---

  doctrine(colonyId: string, text: string, lang: 'fr' | 'en'): ReturnType<GeneralService['doctrine']> { return this.general.doctrine(colonyId, text, lang); }
  confirmDoctrine(colonyId: string, id: string): ReturnType<GeneralService['confirmDoctrine']> { return this.general.confirmDoctrine(colonyId, id); }
  history(colonyId: string): Turn[] { return this.general.history(colonyId); }
  talk(colonyId: string, text: string, lang: 'fr' | 'en'): ReturnType<GeneralService['talk']> { return this.general.talk(colonyId, text, lang); }
  briefing(colonyId: string, lang: 'fr' | 'en'): ReturnType<GeneralService['briefing']> { return this.general.briefing(colonyId, lang); }
  gazette(lang: 'fr' | 'en', day?: number): Promise<GazetteIssue | null> { return this.general.gazette(lang, day); }

  publicColony(id: string): { id: string; name: string; faction: string; persona: string; alliance: string | null; score: number; connected: number; createdAt: number; npc: boolean; beacons: string[] } | null {
    const c = this.world.colonies[id];
    if (!c) return null;
    const net = ownedSystems(this.world, c.id).length;
    return { id: c.id, name: c.name, faction: c.faction, persona: c.persona, alliance: c.alliance ? this.world.alliances[c.alliance]?.name ?? null : null, score: Math.round(colonyScoreOf(this.world, c) * 10) / 10, connected: net, createdAt: c.createdAt, npc: c.npc, beacons: Object.values(this.world.litBeacons).filter((b) => b.by === c.id).map((b) => this.world.galaxy.systems[b.system]?.beaconName ?? b.system) };
  }

  publicConfig(): { requireInvite: boolean; seasonDays: number; seasonSeed: string } {
    return { requireInvite: this.cfg.requireInvite, seasonDays: this.cfg.seasonDays, seasonSeed: this.cfg.seasonSeed };
  }

  publicSummary(): { time: number; drawIndex: number; colonies: { id: string; name: string; faction: string; score: number; alliance: string | null }[]; titles: World['titles']; ended: World['ended'] } {
    const w = this.world;
    return {
      time: w.time, drawIndex: w.drawIndex, titles: w.titles, ended: w.ended,
      colonies: Object.values(w.colonies).map((c) => ({ id: c.id, name: c.name, faction: c.faction, alliance: c.alliance, score: Math.round(colonyScoreOf(w, c) * 10) / 10 }))
        .sort((a, b) => b.score - a.score),
    };
  }
}

import { colonyScore as colonyScoreOf, ownedSystems } from '@aurane/sim';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const NPC_FIRST = ['Ilse', 'Tamsin', 'Orrin', 'Vesna', 'Kael', 'Maren', 'Dario', 'Nyra', 'Haldor', 'Selin', 'Bram', 'Odile'];
const NPC_LAST = ['Vantor', 'Quill', 'Ashgrove', 'Merrow', 'Solace', 'Draven', 'Hale', 'Corvin', 'Estrid', 'Lorne'];
function npcName(i: number): string {
  return `Colonie ${NPC_FIRST[i % NPC_FIRST.length]} ${NPC_LAST[Math.floor(i / NPC_FIRST.length) % NPC_LAST.length]}`;
}
