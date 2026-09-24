// The world process: one simulation, a real-time loop, NPC and absent-player Generals,
// snapshots, and a fan-out of per-colony views to connected clients.
import { createHash, randomBytes } from 'node:crypto';
import { FACTIONS, PERSONAS, type Command, type Faction, type Persona } from '@aurane/protocol';
import {
  apply, createWorld, decide, restoreWorld, snapshotWorld, spawnColony, tick, viewFor,
  type ApplyResult, type Colony, type PlayerView, type World,
} from '@aurane/sim';
import { clientFromEnv, compilePolicy, writeBriefing, Quota, type LlmClient } from '@aurane/general';
import type { Config } from './config.js';
import type { Store } from './store.js';

const DECISION_INTERVAL_S = 1800;
const ABSENT_AFTER_S = 1800;

export type Listener = (view: PlayerView) => void;

export class Engine {
  world!: World;
  private listeners = new Map<string, Set<Listener>>();
  private timer: NodeJS.Timeout | null = null;
  private lastReal = Date.now();
  private lastSnapshot = Date.now();
  private lastDecisionSim = 0;
  private decisionTick = 0;
  private dirtyColonies = new Set<string>();
  private lastDrawSeen = -1;
  private llm: LlmClient | null = clientFromEnv();
  private quota = new Quota();
  /** Sim time of the last briefing per colony, so the next one covers only what is new. */
  private lastBriefedAt = new Map<string, number>();

  constructor(private readonly cfg: Config, private readonly store: Store) {}

  async init(): Promise<void> {
    const snap = await this.store.loadSnapshot();
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
  }

  start(): void {
    if (this.timer) return;
    this.lastReal = Date.now();
    this.timer = setInterval(() => void this.step(), 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
    const drawHappened = this.world.drawIndex !== this.lastDrawSeen;
    if (drawHappened) {
      this.lastDrawSeen = this.world.drawIndex;
      for (const id of this.listeners.keys()) this.dirtyColonies.add(id);
    }
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
      c.lastSeenAt = seen; // the General acting does not count as the player being present
      if (d.commands.length && this.listeners.has(c.id)) this.dirtyColonies.add(c.id);
    }
  }

  async snapshot(): Promise<void> {
    await this.store.saveSnapshot(snapshotWorld(this.world, { radius: this.cfg.galaxyRadius }));
  }

  // --- players -------------------------------------------------------------

  async createGuest(name: string, faction: Faction, persona: Persona): Promise<{ token: string; colony: Colony }> {
    const colony = spawnColony(this.world, { name, faction, persona, npc: false });
    const token = randomBytes(24).toString('base64url');
    await this.store.createPlayer({ id: `P${colony.id}`, colonyId: colony.id, tokenHash: hashToken(token), name, createdAt: Date.now() });
    await this.snapshot();
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

  // --- the General -----------------------------------------------------------

  async doctrine(colonyId: string, text: string, lang: 'fr' | 'en'): Promise<{ policy: unknown; summary: string; source: string; warnings: string[] } | null> {
    const c = this.world.colonies[colonyId];
    if (!c) return null;
    const systems: Record<string, string> = {};
    for (const [id, st] of Object.entries(this.world.systems)) if (st.owner === c.id) systems[id] = this.world.galaxy.systems[id]!.name;
    const colonies: Record<string, string> = {};
    for (const o of Object.values(this.world.colonies)) if (o.id !== c.id) colonies[o.id] = o.name;
    const alliances: Record<string, string> = {};
    for (const a of Object.values(this.world.alliances)) alliances[a.id] = a.name;
    const client = this.quota.take(c.id, 'writes') ? this.llm : null;
    const compiled = await compilePolicy(text, { lang, current: c.policy, systems, colonies, alliances }, client);
    // "__capital__" from the heuristic resolves to the real capital id.
    compiled.policy.defendFirst = compiled.policy.defendFirst.map((id) => (id === '__capital__' ? c.capital : id));
    apply(this.world, c.id, { type: 'set_policy', policy: compiled.policy });
    this.dirtyColonies.add(c.id);
    return { policy: compiled.policy, summary: compiled.summary, source: compiled.source, warnings: compiled.warnings };
  }

  async briefing(colonyId: string, lang: 'fr' | 'en'): Promise<{ text: string; source: string; awaySeconds: number } | null> {
    const c = this.world.colonies[colonyId];
    if (!c) return null;
    const since = this.lastBriefedAt.get(c.id) ?? c.createdAt;
    const awaySeconds = Math.max(0, this.world.time - since);
    const events = this.world.events.filter((e) => e.at > since && (e.actors.includes(c.id) || e.kind === 'draw'));
    const names: Record<string, string> = {};
    for (const o of Object.values(this.world.colonies)) names[o.id] = o.name;
    const client = awaySeconds >= ABSENT_AFTER_S && this.quota.take(c.id, 'writes') ? this.llm : null;
    const res = await writeBriefing({ view: viewFor(this.world, c), events, awaySeconds, persona: c.persona, lang, names }, client);
    this.lastBriefedAt.set(c.id, this.world.time);
    return { ...res, awaySeconds };
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

import { colonyScore as colonyScoreOf } from '@aurane/sim';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const NPC_FIRST = ['Ilse', 'Tamsin', 'Orrin', 'Vesna', 'Kael', 'Maren', 'Dario', 'Nyra', 'Haldor', 'Selin', 'Bram', 'Odile'];
const NPC_LAST = ['Vantor', 'Quill', 'Ashgrove', 'Merrow', 'Solace', 'Draven', 'Hale', 'Corvin', 'Estrid', 'Lorne'];
function npcName(i: number): string {
  return `Colonie ${NPC_FIRST[i % NPC_FIRST.length]} ${NPC_LAST[Math.floor(i / NPC_FIRST.length) % NPC_LAST.length]}`;
}
