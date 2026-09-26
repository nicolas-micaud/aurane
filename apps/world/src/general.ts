// The Generals' service: everything between the HTTP boundary and the model. It owns the job queue,
// the quotas, the memory, the pending doctrines and the caches; the engine only exposes the world. No
// method here is called from the simulation step: the Draw never waits for a model.
import type { Command, Policy } from '@aurane/protocol';
import { apply, isAlly, viewFor, type Colony, type World } from '@aurane/sim';
import {
  HttpMemoryStore, InMemoryMemoryStore, LlmMetrics, MemoryJobStore, MirroredMemoryStore, isEmptyMemory, memoryRepairs, mergeMemory, normalizeMemory, PlayerQuota, Scheduler, analyze, compileDoctrine, converse, counselAck, degradedReply, liveCounselCards, sameGoal, describeChoice, emptyMemory, factsFrom, fromSimCounsel,
  TASK_CLASS, type LlmClass, type LlmTask,
  metrics as globalMetrics, recordChoice, recordEpisode, rememberPhrases, renderMemory, stackFromEnv, writeBriefing, writeCounsel, writeEpisode, writeGazette, choicesOf,
  type Analysis, type CompiledDoctrine, type ConverseResult, type CounselCard, type CounselOption, type CounselResult, type DoctrineContext, type GazetteIssue, type JobStore, type LlmStack, type MemoryRecord, type MemoryStore, type MirrorOutbox, type MirrorStats, type Turn,
} from '@aurane/general';
import type { Config } from './config.js';
import type { BackupStatus, BudgetStore } from './llmstore.js';

export interface GeneralDeps {
  world: () => World;
  /** Mark a colony's view dirty (its clients get a fresh frame). */
  dirty: (colonyId: string) => void;
  jobStore?: JobStore | undefined;
  memoryStore?: MemoryStore | undefined;
  /** Durable outbox of the mirror (Postgres in production); in memory when absent. */
  mirrorOutbox?: MirrorOutbox | undefined;
  /** The memory key of a colony: `account:<id>` once it belongs to an account (the memory follows the player from one
   *  season to the next), else `season:<seed>:<colony>` (a guest's memory never leaks to next season's namesake). */
  memoryKey?: ((colonyId: string) => Promise<string>) | undefined;
  /** Last successful backups (deploy/backup), for the metrics and the health check. */
  backupStatus?: (() => Promise<BackupStatus[]>) | undefined;
  budgetStore?: BudgetStore | undefined;
  /** Doctrines awaiting the player's yes, kept across a restart (Postgres or a file); memory only when absent. */
  pendingStore?: PendingDoctrineStore | undefined;
  stack?: LlmStack | undefined;
  metrics?: LlmMetrics | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export interface PendingDoctrine { id: string; colonyId: string; policy: Policy; readable: string[]; summary: string; reply: string; createdAt: number; lang: 'fr' | 'en' }

/** One pending doctrine per Colony: a new one replaces the previous, a yes or a no removes it. */
export interface PendingDoctrineStore { loadAll(): Promise<PendingDoctrine[]>; save(p: PendingDoctrine): Promise<void>; remove(colonyId: string): Promise<void> }

export interface TalkResponse { reply: string; source: string; policyChanged: boolean; pending: { id: string; readable: string[] } | null; question: string | null; history: Turn[] }
export interface DoctrineResponse { policy: Policy; summary: string; readable: string[]; question: string | null; source: string; warnings: string[]; reply: string; pending: { id: string } | null; applied: boolean }

interface TalkJob { colonyId: string; text: string; lang: 'fr' | 'en'; seed: string }
interface BriefingJob { colonyId: string; lang: 'fr' | 'en'; since: number; awaySeconds: number }
interface GazetteJob { day: number; lang: 'fr' | 'en' }
interface CounselJob { colonyId: string; lang: 'fr' | 'en'; drawIndex: number }
interface EpisodeJob { colonyId: string; lang: 'fr' | 'en'; day: number }

export interface CounselView { drawIndex: number; minutesToDraw: number; cards: CounselCard[]; source: string; writtenAt: number; /** Onboarding tier the counsel was written for: a new tier invalidates it (the first minute opens tier 1). */ tier: number }

/** Where the simulation's counsel comes from; `buildOptions` of the analysis until `counsel(w, colony, tier)` lands in packages/sim. */
export type CounselSource = (w: World, c: Colony) => { tier: number; options: CounselOption[] };

const ABSENT_AFTER_S = 1800;

export class GeneralService {
  readonly scheduler: Scheduler;
  readonly stack: LlmStack;
  readonly metrics: LlmMetrics;
  readonly quota: PlayerQuota;
  private readonly memoryStore: MemoryStore;
  private readonly mirror: MirroredMemoryStore | null = null;
  private readonly budgetStore: BudgetStore | null;
  private readonly pendingStore: PendingDoctrineStore | null;
  private readonly primaryMemory: MemoryStore;
  private readonly memoryKeys = new Map<string, string>();
  private backups: BackupStatus[] = [];
  private backupsReadAt = 0;
  legacyMemory = { migrated: 0, orphans: 0 };
  private lastBudgetSave = 0;
  private talks = new Map<string, Turn[]>();
  private langs = new Map<string, 'fr' | 'en'>();
  private pending = new Map<string, PendingDoctrine>();
  private lastBriefedAt = new Map<string, number>();
  private briefings = new Map<string, { text: string; source: string; eventMark: number; awaySeconds: number }>();
  private gazettes = new Map<string, GazetteIssue>();
  private counsels = new Map<string, CounselView>();
  private lastCounselDraw = -1;
  private lastEpisodeDay = -1;
  private seq = 0;
  /** The simulation's Counsel (`PlayerView.me.counsel`, 0009) when the sim carries it, else the analysis' options. Overridable. */
  counselSource: CounselSource = (w, c) => {
    const tier = (c as Colony & { onboarding?: { tier: number } }).onboarding?.tier ?? 6;
    const me = viewFor(w, c).me as { counsel?: Parameters<typeof fromSimCounsel>[0] };
    if (Array.isArray(me.counsel)) return { tier, options: fromSimCounsel(me.counsel) };
    return { tier, options: analyze(w, c).options };
  };

  constructor(readonly cfg: Config, private readonly deps: GeneralDeps) {
    this.metrics = deps.metrics ?? globalMetrics;
    this.stack = deps.stack ?? stackFromEnv(deps.env ?? process.env, this.metrics);
    for (const w of this.stack.warnings) console.warn(JSON.stringify({ msg: 'llm config', warning: w }));
    this.quota = new PlayerQuota(cfg.quotas);
    const primary = deps.memoryStore ?? new InMemoryMemoryStore();
    this.primaryMemory = primary;
    if (cfg.memoryUrl && cfg.memoryToken) {
      this.mirror = new MirroredMemoryStore(primary, new HttpMemoryStore(cfg.memoryUrl, cfg.memoryToken), (err) => console.warn(JSON.stringify({ msg: 'memory instance', error: err.message })), { outbox: deps.mirrorOutbox });
      this.memoryStore = this.mirror;
    } else this.memoryStore = primary;
    this.budgetStore = deps.budgetStore ?? null;
    this.pendingStore = deps.pendingStore ?? null;
    if (cfg.budgetEurMonth > 0) this.metrics.budget = { eurPerMonth: cfg.budgetEurMonth, alertRatio: cfg.budgetAlertRatio };
    this.metrics.onSpend = (month, eur) => { const now = Date.now(); if (now - this.lastBudgetSave < 10000) return; this.lastBudgetSave = now; void this.budgetStore?.save(month, eur).catch((err: Error) => console.warn(JSON.stringify({ msg: 'budget save', error: err.message }))); };
    this.metrics.onAlert = (kind, month, eur, budget) => console.warn(JSON.stringify({ msg: kind === 'cap' ? 'LLM BUDGET REACHED: every task degrades in character until the month turns' : 'LLM budget alert', month, eur: Math.round(eur * 100) / 100, budgetEur: budget.eurPerMonth, ratio: Math.round((eur / budget.eurPerMonth) * 100) / 100 }));
    this.scheduler = new Scheduler(deps.jobStore ?? new MemoryJobStore(), undefined, {
      concurrency: cfg.llmWorkers,
      onEvent: (e) => { if (e.kind !== 'enqueued') this.metrics.job(e.kind); else this.metrics.job('enqueued'); },
    });
    this.scheduler.handle<TalkJob, ConverseResult>('talk', (job) => this.runTalk(job.payload));
    this.scheduler.handle<TalkJob, CompiledDoctrine>('doctrine', (job) => this.runDoctrine(job.payload));
    this.scheduler.handle<BriefingJob, { text: string; source: string }>('briefing', (job) => this.runBriefing(job.payload));
    this.scheduler.handle<GazetteJob, GazetteIssue>('gazette', (job) => this.runGazette(job.payload));
    this.scheduler.handle<CounselJob, CounselView>('counsel', (job) => this.runCounsel(job.payload));
    this.scheduler.handle<EpisodeJob, string>('episode', (job) => this.runEpisode(job.payload));
  }

  /** Restore the month's spend so the cap survives a restart, the doctrines still waiting for a yes, and move memories
   *  still keyed by a bare colony id. */
  async init(): Promise<void> {
    if (this.budgetStore) {
      const month = LlmMetrics.monthKey();
      try { this.metrics.seedSpend(month, await this.budgetStore.load(month)); } catch (err) { console.warn(JSON.stringify({ msg: 'budget load', error: (err as Error).message })); }
    }
    if (this.pendingStore) {
      try {
        for (const p of await this.pendingStore.loadAll()) {
          if (this.expired(p) || !this.colony(p.colonyId)) this.forget(p.colonyId);
          else this.pending.set(p.colonyId, p);
        }
      } catch (err) { console.warn(JSON.stringify({ msg: 'pending doctrines load', error: (err as Error).message })); }
    }
    try { await this.migrateLegacyMemory(); } catch (err) { console.warn(JSON.stringify({ msg: 'memory legacy keys', error: (err as Error).message })); }
  }

  /** The month's cap is reached: no model for anyone, in-character lines everywhere (decision 0009: never a silence). */
  /** The class a task is served by here (a routine task rides the voice pool when no routine class is configured), for metric labels. */
  private classOf(task: LlmTask): LlmClass { return this.stack.forTask(task)?.cls ?? TASK_CLASS[task]; }

  private capped(task: 'talk' | 'doctrine' | 'briefing' | 'counsel' | 'episode' | 'gazette'): boolean {
    if (!this.metrics.overBudget()) return false;
    this.metrics.degradation(task === 'gazette' ? 'narrative' : 'voice', task, 'budget');
    return true;
  }

  start(): void { this.scheduler.start(); this.mirror?.start({ flushMs: this.cfg.memoryFlushMs, reconcileMs: this.cfg.memoryReconcileMs }); }
  async stop(): Promise<void> { await this.scheduler.stop(); await this.pendingWrites; await this.mirror?.stop(); }

  // --- memory keys ------------------------------------------------------------------

  private async keyOf(colonyId: string): Promise<string> {
    const k = this.memoryKeys.get(colonyId);
    if (k) return k;
    const key = this.deps.memoryKey ? await this.deps.memoryKey(colonyId) : colonyId;
    this.memoryKeys.set(colonyId, key);
    return key;
  }
  private seasonKey(colonyId: string): string { return `season:${this.cfg.seasonSeed}:${colonyId}`; }

  /** Erase one key everywhere; `null` = no instance configured, `pending` = the instance will hear it from the outbox. */
  private async eraseKey(key: string): Promise<{ mirror: boolean | null; pending: boolean }> {
    if (this.mirror) { const r = await this.mirror.erase(key); return { mirror: r.mirror, pending: r.pending }; }
    await this.primaryMemory.save(key, emptyMemory());
    return { mirror: null, pending: false };
  }

  /** Move a memory from one key to another (merged with what is there), then erase the old key on both sides. */
  private async moveMemory(from: string, to: string): Promise<boolean> {
    if (from === to) return false;
    const old = await this.memoryStore.load(from);
    if (!old || isEmptyMemory(old)) return false;
    await this.memoryStore.update(to, (cur) => mergeMemory(cur, old));
    await this.eraseKey(from);
    return true;
  }

  /** Whether anything is remembered under this key (a returning account, before its colony exists: « le Général se
   *  souvient de toi »). Read-only; a cold key is fetched from the instance like any read. */
  async hasMemory(key: string): Promise<boolean> {
    const m = await this.memoryStore.load(key);
    return !!m && !isEmptyMemory(m);
  }

  /** Push what the outbox holds now (tests, admin); the timer does it on its own every `memoryFlushMs`. */
  async flushMemory(): Promise<number> { return this.mirror ? this.mirror.flush() : 0; }

  /** A colony now belongs to an account (first passkey or verified e-mail): its guest memory joins the account's. */
  async adoptMemory(colonyId: string): Promise<void> {
    this.memoryKeys.delete(colonyId);
    const to = await this.keyOf(colonyId);
    await this.moveMemory(this.seasonKey(colonyId), to);
  }

  /** Rows written before memory keys existed carry the bare colony id: moved to the colony's key when the colony is in
   *  this world; left alone otherwise (a past season's id: never read again, counted). */
  async migrateLegacyMemory(): Promise<{ migrated: number; orphans: number }> {
    if (!this.primaryMemory.index) return this.legacyMemory;
    const w = this.deps.world();
    for (const e of await this.primaryMemory.index()) {
      if (e.key.includes(':') || e.empty) continue;
      const c = w.colonies[e.key];
      if (c && !c.npc && await this.moveMemory(e.key, await this.keyOf(c.id))) this.legacyMemory.migrated++;
      else this.legacyMemory.orphans++;
    }
    if (this.legacyMemory.migrated || this.legacyMemory.orphans) console.log(JSON.stringify({ msg: 'memory legacy keys', ...this.legacyMemory }));
    return this.legacyMemory;
  }

  // --- context ---------------------------------------------------------------

  private colony(id: string): Colony | null { return this.deps.world().colonies[id] ?? null; }

  private context(c: Colony, lang: 'fr' | 'en'): DoctrineContext {
    const w = this.deps.world();
    const systems: Record<string, string> = {};
    for (const [id, st] of Object.entries(w.systems)) if (st.owner === c.id) systems[id] = w.galaxy.systems[id]!.name;
    const colonies: Record<string, string> = {};
    for (const o of Object.values(w.colonies)) if (o.id !== c.id) colonies[o.id] = o.name;
    const alliances: Record<string, string> = {};
    for (const a of Object.values(w.alliances)) alliances[a.id] = a.name;
    const treatyWith = (o: string): boolean => Object.values(w.treaties).some((t) => (t.until === null || t.until > w.time) && ((t.a === c.id && t.b === o) || (t.b === c.id && t.a === o)));
    const allies = Object.values(w.colonies).filter((o) => o.id !== c.id && (isAlly(w, c.id, o.id) || treatyWith(o.id))).map((o) => o.id);
    return { lang, current: c.policy, systems, colonies, alliances, allies, persona: c.persona, capital: c.capital };
  }

  private async memoryOf(c: Colony, lang: 'fr' | 'en'): Promise<{ record: MemoryRecord; text: string; facts: ReturnType<typeof factsFrom> }> {
    const record = withJournalChoices((await this.memoryStore.load(await this.keyOf(c.id))) ?? emptyMemory(), c);
    const facts = factsFrom(this.deps.world(), c);
    return { record, text: renderMemory(facts, record, lang), facts };
  }

  private analysisOf(c: Colony): Analysis { return analyze(this.deps.world(), c); }

  history(colonyId: string): Turn[] { return this.talks.get(colonyId) ?? []; }

  /** A line the General says on its own (fleet inbound…): appended to the conversation, no model. */
  pushLine(colonyId: string, text: string): void {
    this.talks.set(colonyId, [...this.history(colonyId), { who: 'general' as const, text, at: Date.now() }].slice(-16));
    this.deps.dirty(colonyId);
  }

  langOf(colonyId: string): 'fr' | 'en' { return this.langs.get(colonyId) ?? 'fr'; }

  private applyPolicy(c: Colony, policy: Policy): void {
    policy.defendFirst = policy.defendFirst.map((id) => (id === '__capital__' ? c.capital : id));
    apply(this.deps.world(), c.id, { type: 'set_policy', policy });
    this.deps.dirty(c.id);
  }

  private hold(c: Colony, r: { policy: Policy; readable: string[]; summary: string; reply: string }, lang: 'fr' | 'en'): PendingDoctrine {
    const id = `d${Date.now().toString(36)}${(this.seq++).toString(36)}`;
    const p: PendingDoctrine = { id, colonyId: c.id, policy: r.policy, readable: r.readable, summary: r.summary, reply: r.reply, createdAt: Date.now(), lang };
    this.pending.set(c.id, p); // replaces the previous one: the player answers the latest doctrine, not a queue of them
    this.persist('save', () => this.pendingStore!.save(p));
    return p;
  }

  private expired(p: PendingDoctrine, now = Date.now()): boolean { return now - p.createdAt > this.cfg.doctrinePendingTtlMs; }

  private forget(colonyId: string): void {
    this.pending.delete(colonyId);
    this.persist('remove', () => this.pendingStore!.remove(colonyId));
  }

  /** Writes are chained: a save then a remove must reach the store in that order, or a confirmed doctrine comes back. */
  private pendingWrites: Promise<void> = Promise.resolve();
  private persist(what: 'save' | 'remove', op: () => Promise<void>): void {
    if (!this.pendingStore) return;
    this.pendingWrites = this.pendingWrites.then(op).catch((err: Error) => console.warn(JSON.stringify({ msg: `pending doctrine ${what}`, error: err.message })));
  }

  /** Resolves when the pending doctrines are written (tests, shutdown). */
  flushPending(): Promise<void> { return this.pendingWrites; }

  // --- talk --------------------------------------------------------------------

  private async runTalk(p: TalkJob): Promise<ConverseResult> {
    const c = this.colony(p.colonyId);
    if (!c) throw new Error('colony gone');
    const mem = await this.memoryOf(c, p.lang);
    const res = await converse({ text: p.text, lang: p.lang, persona: c.persona, history: this.history(c.id), ctx: this.context(c, p.lang), analysis: this.analysisOf(c), memory: mem.text, seed: p.seed }, this.stack.voice);
    // Re-read at write time: a choice or an episode written while the model was answering must not be lost.
    if (res.usedPhrases.length) await this.memoryStore.update(await this.keyOf(c.id), (cur) => rememberPhrases(withJournalChoices(cur ?? emptyMemory(), c), res.usedPhrases));
    return res;
  }

  async talk(colonyId: string, text: string, lang: 'fr' | 'en'): Promise<TalkResponse | null> {
    const c = this.colony(colonyId);
    if (!c) return null;
    this.langs.set(c.id, lang);
    const history = this.history(c.id);
    const seed = `${c.id}:${history.length}:${Date.now()}`;
    let res: ConverseResult;
    const overQuota = this.capped('talk') || !this.quota.take(c.id, 'talk');
    if (!overQuota && this.stack.voice && !this.scheduler.active) res = await this.runTalk({ colonyId: c.id, text, lang, seed });
    else if (overQuota || !this.stack.voice) {
      res = await converse({ text, lang, persona: c.persona, history, ctx: this.context(c, lang), analysis: this.analysisOf(c), seed, overQuota }, null);
      if (overQuota && !this.metrics.overBudget()) this.metrics.degradation('voice', 'talk', 'quota');
    } else {
      const fallback = (): ConverseResult => {
        this.metrics.degradation('voice', 'talk', 'deadline');
        const h = converseSync(text, lang, c, this.context(c, lang));
        return { ...h, source: 'degraded', degradeReason: 'saturated', reply: `${degradedReply(c.persona, lang, 'saturated', seed)} ${h.policy ? h.reply : ''}`.trim() };
      };
      const out = await this.scheduler.enqueueWithDeadline<TalkJob, ConverseResult>('talk', 'talk', { colonyId: c.id, text, lang, seed }, this.cfg.talkDeadlineMs, fallback, { colony: c.id, ttlMs: 120000 });
      res = out.result;
      if (res.source === 'degraded' && res.degradeReason && !out.timedOut) this.metrics.degradation('voice', 'talk', res.degradeReason);
    }
    let policyChanged = false;
    let pending: TalkResponse['pending'] = null;
    if (res.command) { apply(this.deps.world(), c.id, res.command); this.deps.dirty(c.id); }
    if (res.policy) {
      if (this.cfg.doctrineConfirm) pending = { id: this.hold(c, { policy: res.policy, readable: res.readable ?? [], summary: '', reply: res.reply }, lang).id, readable: res.readable ?? [] };
      else { this.applyPolicy(c, res.policy); policyChanged = true; }
    }
    const next = [...history, { who: 'me' as const, text: text.slice(0, 1500), at: Date.now() }, { who: 'general' as const, text: res.reply, at: Date.now() }].slice(-16);
    this.talks.set(c.id, next);
    return { reply: res.reply, source: res.source, policyChanged, pending, question: res.question, history: next };
  }

  // --- doctrine ----------------------------------------------------------------

  private async runDoctrine(p: TalkJob): Promise<CompiledDoctrine> {
    const c = this.colony(p.colonyId);
    if (!c) throw new Error('colony gone');
    const mem = await this.memoryOf(c, p.lang);
    const a = this.analysisOf(c);
    return compileDoctrine(p.text, this.context(c, p.lang), this.stack.voice, { analysis: renderAnalysisSafe(a, p.lang), memory: mem.text, crisis: a.crisis, seed: p.seed });
  }

  async doctrine(colonyId: string, text: string, lang: 'fr' | 'en'): Promise<DoctrineResponse | null> {
    const c = this.colony(colonyId);
    if (!c) return null;
    this.langs.set(c.id, lang);
    const seed = `${c.id}:doctrine:${Date.now()}`;
    let compiled: CompiledDoctrine;
    const overQuota = this.capped('doctrine') || !this.quota.take(c.id, 'doctrine');
    if (!overQuota && this.stack.voice && !this.scheduler.active) compiled = await this.runDoctrine({ colonyId: c.id, text, lang, seed });
    else if (overQuota || !this.stack.voice) {
      compiled = await compileDoctrine(text, this.context(c, lang), null, { overQuota, seed });
      if (overQuota && !this.metrics.overBudget()) this.metrics.degradation('voice', 'doctrine', 'quota');
    } else {
      const fallback = (): CompiledDoctrine => { this.metrics.degradation('voice', 'doctrine', 'deadline'); return { ...heuristicSync(text, lang, c, this.context(c, lang)), source: 'degraded' }; };
      compiled = (await this.scheduler.enqueueWithDeadline<TalkJob, CompiledDoctrine>('doctrine', 'doctrine', { colonyId: c.id, text, lang, seed }, this.cfg.talkDeadlineMs, fallback, { colony: c.id, ttlMs: 120000 })).result;
    }
    let pending: DoctrineResponse['pending'] = null;
    let applied = false;
    if (!compiled.question) {
      if (this.cfg.doctrineConfirm) pending = { id: this.hold(c, compiled, lang).id };
      else { this.applyPolicy(c, compiled.policy); applied = true; }
    }
    return { policy: compiled.policy, summary: compiled.summary, readable: compiled.readable, question: compiled.question, source: compiled.source, warnings: compiled.warnings, reply: compiled.reply, pending, applied };
  }

  /** The doctrine waiting for a yes; one left unanswered past DOCTRINE_PENDING_TTL_H is dropped (the active one stays). */
  pendingDoctrine(colonyId: string, now = Date.now()): PendingDoctrine | null {
    const p = this.pending.get(colonyId);
    if (!p) return null;
    if (this.expired(p, now)) { this.forget(colonyId); return null; }
    return p;
  }

  /** The player read the doctrine and confirms: it becomes active. */
  confirmDoctrine(colonyId: string, id: string, now = Date.now()): { ok: true; summary: string } | { ok: false; reason: string } {
    const c = this.colony(colonyId);
    const p = this.pendingDoctrine(colonyId, now);
    if (!c || !p || p.id !== id) return { ok: false, reason: 'no such pending doctrine' };
    this.forget(colonyId);
    this.applyPolicy(c, p.policy);
    return { ok: true, summary: p.summary };
  }

  discardDoctrine(colonyId: string): void { this.forget(colonyId); }

  // --- briefing ----------------------------------------------------------------

  private eventMark(c: Colony, since: number): number {
    const w = this.deps.world();
    let n = 0;
    for (const e of w.events) if (e.at > since && (e.actors.includes(c.id) || e.kind === 'draw')) n++;
    return n;
  }

  /** The report's input, memory included: the template names the player's last choice and the names it holds against. */
  private async briefingInput(c: Colony, lang: 'fr' | 'en', since: number, awaySeconds: number): Promise<Parameters<typeof writeBriefing>[0]> {
    const w = this.deps.world();
    const events = w.events.filter((e) => e.at > since && (e.actors.includes(c.id) || e.kind === 'draw'));
    const names: Record<string, string> = {};
    for (const o of Object.values(w.colonies)) names[o.id] = o.name;
    const mem = await this.memoryOf(c, lang);
    return { view: viewFor(w, c), events, awaySeconds, persona: c.persona, lang, names, analysis: this.analysisOf(c), seed: `${c.id}:${since}`, memory: mem.text, record: mem.record, facts: mem.facts };
  }

  private async runBriefing(p: BriefingJob): Promise<{ text: string; source: string }> {
    const c = this.colony(p.colonyId);
    if (!c) throw new Error('colony gone');
    const r = await writeBriefing(await this.briefingInput(c, p.lang, p.since, p.awaySeconds), this.stack.forTask('briefing'));
    this.briefings.set(`${c.id}:${p.lang}`, { text: r.text, source: r.source, eventMark: this.eventMark(c, p.since), awaySeconds: p.awaySeconds });
    return r;
  }

  /**
   * Lazy briefing: generated when the player connects, from the events since the last one, cached until
   * a new event concerns the colony. The model has a few seconds; past that the template answers and the
   * rewrite finishes in the background for the next read.
   */
  async briefing(colonyId: string, lang: 'fr' | 'en'): Promise<{ text: string; source: string; awaySeconds: number } | null> {
    const c = this.colony(colonyId);
    if (!c) return null;
    this.langs.set(c.id, lang);
    const w = this.deps.world();
    const since = this.lastBriefedAt.get(c.id) ?? c.createdAt;
    const awaySeconds = Math.max(0, w.time - since);
    const cached = this.briefings.get(`${c.id}:${lang}`);
    if (cached && cached.eventMark === this.eventMark(c, since)) return { text: cached.text, source: cached.source, awaySeconds: cached.awaySeconds };
    const worth = awaySeconds >= ABSENT_AFTER_S;
    const overQuota = worth && (this.capped('briefing') || !this.quota.take(c.id, 'briefing'));
    let out: { text: string; source: string };
    if (worth && !overQuota && this.stack.forTask('briefing') && !this.scheduler.active) out = await this.runBriefing({ colonyId: c.id, lang, since, awaySeconds });
    else if (!worth || overQuota || !this.stack.forTask('briefing')) {
      out = await writeBriefing({ ...(await this.briefingInput(c, lang, since, awaySeconds)), overQuota }, null);
      if (overQuota && !this.metrics.overBudget()) this.metrics.degradation(this.classOf('briefing'), 'briefing', 'quota');
    } else {
      const input = await this.briefingInput(c, lang, since, awaySeconds);
      const template = (): { text: string; source: string } => { this.metrics.degradation(this.classOf('briefing'), 'briefing', 'deadline'); return writeBriefingSync(input); };
      out = (await this.scheduler.enqueueWithDeadline<BriefingJob, { text: string; source: string }>('briefing', 'briefing', { colonyId: c.id, lang, since, awaySeconds }, this.cfg.briefingDeadlineMs, template, { colony: c.id, key: `briefing:${c.id}:${lang}:${since}`, ttlMs: 900000 })).result;
    }
    this.lastBriefedAt.set(c.id, w.time);
    this.briefings.set(`${c.id}:${lang}`, { text: out.text, source: out.source, eventMark: this.eventMark(c, w.time), awaySeconds });
    return { ...out, awaySeconds };
  }

  // --- gazette -------------------------------------------------------------------

  private async runGazette(p: GazetteJob): Promise<GazetteIssue> {
    const issue = await writeGazette(this.deps.world(), p.day, p.lang, this.capped('gazette') ? null : (this.stack.narrative ?? this.stack.voice));
    this.gazettes.set(`${p.day}:${p.lang}`, issue);
    return issue;
  }

  /** Called once per season day by the engine: both issues are written in batch, spread over the off-peak window. */
  scheduleDailyGazette(day: number): void {
    if (day < 1) return;
    for (const lang of ['fr', 'en'] as const) {
      void this.scheduler.enqueue<GazetteJob, GazetteIssue>('gazette', 'gazette', { day, lang }, { key: `gazette:${day}:${lang}`, spreadMs: this.cfg.gazetteSpreadMin * 60000, ttlMs: 6 * 3600000 })
        .then((j) => j.result.catch(() => undefined));
    }
  }

  /** Yesterday's issue (the current day is still being written): cached, else queued with a short wait and the template meanwhile. */
  async gazette(lang: 'fr' | 'en', day?: number): Promise<GazetteIssue | null> {
    const w = this.deps.world();
    const today = Math.floor(w.time / 86400) + 1;
    const target = day ?? today - 1;
    if (target < 1 || target >= today) return null;
    const hit = this.gazettes.get(`${target}:${lang}`);
    if (hit) return hit;
    const template = (): GazetteIssue => writeGazetteSync(w, target, lang);
    if (!(this.stack.narrative ?? this.stack.voice)) { const issue = template(); this.gazettes.set(`${target}:${lang}`, issue); return issue; }
    if (!this.scheduler.active) return this.runGazette({ day: target, lang });
    const out = await this.scheduler.enqueueWithDeadline<GazetteJob, GazetteIssue>('gazette', 'gazette', { day: target, lang }, this.cfg.briefingDeadlineMs, template, { key: `gazette:${target}:${lang}`, ttlMs: 6 * 3600000 });
    return out.result;
  }

  // --- the Draw Counsel (decision 0009) -------------------------------------------

  private drawIndexNow(): number { return Math.floor(this.deps.world().time / 3600); }
  private minutesToDraw(): number { return Math.max(0, Math.round(((this.drawIndexNow() + 1) * 3600 - this.deps.world().time) / 60)); }

  private async runCounsel(p: CounselJob): Promise<CounselView> {
    const c = this.colony(p.colonyId);
    if (!c) throw new Error('colony gone');
    const w = this.deps.world();
    const mem = await this.memoryOf(c, p.lang);
    const src = this.counselSource(w, c);
    const a = this.analysisOf(c);
    const r: CounselResult = await writeCounsel({ persona: c.persona, lang: p.lang, tier: src.tier, options: src.options, analysis: renderAnalysisSafe(a, p.lang), memory: mem.text, crisis: a.crisis, minutesToDraw: this.minutesToDraw(), seed: `${c.id}:${p.drawIndex}`, skipped: choicesOf(mem.record).skipped.slice(-6) }, this.stack.forTask('counsel'));
    if (r.source === 'degraded' && r.degradeReason) this.metrics.degradation(this.classOf('counsel'), 'counsel', r.degradeReason);
    const view: CounselView = { drawIndex: p.drawIndex, minutesToDraw: this.minutesToDraw(), cards: r.cards, source: r.source, writtenAt: w.time, tier: src.tier };
    this.counsels.set(`${c.id}:${p.lang}`, view);
    return view;
  }

  /** Called every step by the engine: T−lead minutes before the Draw, one counsel job per colony seen in the last two hours. */
  scheduleCounsel(): void {
    const w = this.deps.world();
    const next = this.drawIndexNow() + 1;
    if (this.lastCounselDraw === next || this.minutesToDraw() > this.cfg.counselLeadMin) return;
    this.lastCounselDraw = next;
    if (this.capped('counsel')) return; // the live request serves the fallback cards
    for (const c of Object.values(w.colonies)) {
      if (c.npc || w.time - c.lastSeenAt > 2 * 3600) continue;
      if (!this.quota.take(c.id, 'counsel')) { this.metrics.degradation(this.classOf('counsel'), 'counsel', 'quota'); continue; }
      const lang = this.langOf(c.id);
      void this.scheduler.enqueue<CounselJob, CounselView>('counsel', 'counsel', { colonyId: c.id, lang, drawIndex: next }, { colony: c.id, key: `counsel:${c.id}:${lang}:${next}`, spreadMs: Math.max(0, (this.cfg.counselLeadMin - 5) * 60000), ttlMs: this.cfg.counselLeadMin * 60000 })
        .then((j) => j.result.catch(() => undefined));
    }
  }

  /** The counsel for the coming Draw: cached when written ahead, else written now within the budget (fallback cards past it). */
  async counsel(colonyId: string, lang: 'fr' | 'en'): Promise<CounselView | null> {
    const c = this.colony(colonyId);
    if (!c) return null;
    this.langs.set(c.id, lang);
    const next = this.drawIndexNow() + 1;
    const src = this.counselSource(this.deps.world(), c);
    const hit = this.counsels.get(`${c.id}:${lang}`);
    if (hit && hit.drawIndex === next && hit.tier === src.tier) {
      // Written ahead, served until the Draw, but never past its goal: re-checked against the simulation each time.
      hit.cards = liveCounselCards(hit.cards, src.options, { persona: c.persona, lang, tier: src.tier });
      return { ...hit, minutesToDraw: this.minutesToDraw() };
    }
    const fallback = async (): Promise<CounselView> => { const r = await writeCounsel({ persona: c.persona, lang, tier: src.tier, options: src.options, minutesToDraw: this.minutesToDraw() }, null); return { drawIndex: next, minutesToDraw: this.minutesToDraw(), cards: r.cards, source: r.source, writtenAt: this.deps.world().time, tier: src.tier }; };
    if (!this.stack.forTask('counsel') || this.capped('counsel') || !this.quota.take(c.id, 'counsel')) { const v = await fallback(); this.counsels.set(`${c.id}:${lang}`, v); return v; }
    if (!this.scheduler.active) return this.runCounsel({ colonyId: c.id, lang, drawIndex: next });
    const template = await fallback();
    const out = await this.scheduler.enqueueWithDeadline<CounselJob, CounselView>('counsel', 'counsel', { colonyId: c.id, lang, drawIndex: next }, this.cfg.counselDeadlineMs, () => { this.metrics.degradation(this.classOf('counsel'), 'counsel', 'deadline'); return template; }, { colony: c.id, key: `counsel:${c.id}:${lang}:${next}:t${src.tier}`, ttlMs: 3600000 });
    if (out.timedOut) this.counsels.set(`${c.id}:${lang}`, out.result);
    return out.result;
  }

  /** "Do it" / "Not now": the choice enters the memory; a taken card runs its command through the world. A card whose
   *  goal is already reached (the player did it by hand) or no longer legal answers `stale` and leaves the Counsel;
   *  a command the world refuses answers its reason: in both cases nothing is remembered and the General says nothing. */
  async decideCounsel(colonyId: string, cardId: string, take: boolean): Promise<{ ok: true; reply: string; result: unknown } | { ok: false; reason: string }> {
    const c = this.colony(colonyId);
    if (!c) return { ok: false, reason: 'no such colony' };
    const lang = this.langOf(c.id);
    const view = this.counsels.get(`${c.id}:${lang}`) ?? this.counsels.get(`${c.id}:${lang === 'fr' ? 'en' : 'fr'}`);
    const card = view?.cards.find((x) => x.id === cardId);
    if (!view || !card) return { ok: false, reason: 'no such card' };
    const src = this.counselSource(this.deps.world(), c);
    const live = liveCounselCards([card], src.options, { persona: c.persona, lang, tier: src.tier })[0];
    if (!live) { view.cards = view.cards.filter((x) => x.id !== card.id); return { ok: false, reason: 'stale' }; }
    let result: unknown = null;
    if (take && live.command) {
      const r = apply(this.deps.world(), c.id, live.command);
      this.deps.dirty(c.id);
      if (!r.ok) return { ok: false, reason: r.reason };
      result = r;
    }
    await this.memoryStore.update(await this.keyOf(c.id), (cur) => recordChoice(cur ?? emptyMemory(), take ? 'counsel.taken' : 'counsel.skipped', card.id, Date.now()));
    view.cards = view.cards.filter((x) => x.id !== card.id);
    const reply = counselAck(c.persona, lang, take, `${c.id}:${card.id}`);
    this.pushLine(c.id, reply);
    return { ok: true, reply, result };
  }

  /**
   * A command the player sent by hand (any screen) that reaches the goal of a card on the Counsel: the card leaves the
   * Counsel and the choice layer records it as taken, since the player followed the advice even without "Do it".
   * Only cards the Counsel was serving count; the world having moved on otherwise is not a choice.
   */
  async noteCommand(colonyId: string, cmd: Command): Promise<void> {
    const c = this.colony(colonyId);
    if (!c) return;
    const done = new Set<string>();
    for (const lang of ['fr', 'en'] as const) {
      const view = this.counsels.get(`${c.id}:${lang}`);
      if (!view) continue;
      for (const card of view.cards) if (card.command && sameGoal(card.command, cmd)) done.add(card.id);
      view.cards = view.cards.filter((x) => !done.has(x.id));
    }
    if (!done.size) return;
    const key = await this.keyOf(c.id);
    await this.memoryStore.update(key, (cur) => { let r = cur ?? emptyMemory(); for (const id of done) r = recordChoice(r, 'counsel.taken', id, Date.now()); return r; });
  }

  // --- episodes (memory, level 1) -------------------------------------------------

  private async runEpisode(p: EpisodeJob): Promise<string> {
    const c = this.colony(p.colonyId);
    if (!c) throw new Error('colony gone');
    const w = this.deps.world();
    const since = (p.day - 1) * 86400, until = p.day * 86400;
    const events = w.events.filter((e) => e.at >= since && e.at < until && (e.actors.includes(c.id) || e.kind === 'draw'));
    const names: Record<string, string> = {}; for (const o of Object.values(w.colonies)) names[o.id] = o.name;
    const mem = (await this.memoryStore.load(await this.keyOf(c.id))) ?? emptyMemory();
    const choices = choicesOf(mem);
    const label = (id: string): string => describeChoice(id, p.lang, (x) => w.galaxy.systems[x]?.name ?? names[x] ?? x);
    const facts = [templateBriefing({ view: viewFor(w, c), events, awaySeconds: 86400, persona: c.persona, lang: p.lang, names }), choices.taken.length ? (p.lang === 'fr' ? `Le joueur a suivi : ${choices.taken.slice(-5).map(label).join(', ')}.` : `The player followed: ${choices.taken.slice(-5).map(label).join(', ')}.`) : '', choices.skipped.length ? (p.lang === 'fr' ? `Il a écarté : ${choices.skipped.slice(-5).map(label).join(', ')}.` : `Set aside: ${choices.skipped.slice(-5).map(label).join(', ')}.`) : ''].filter(Boolean).join('\n');
    const r = await writeEpisode({ persona: c.persona, lang: p.lang, day: p.day, facts, seed: `${c.id}:${p.day}` }, this.capped('episode') ? null : this.stack.forTask('episode'));
    await this.memoryStore.update(await this.keyOf(c.id), (cur) => recordEpisode(cur ?? emptyMemory(), p.day, r.text, Date.now()));
    return r.text;
  }

  /** Called by the engine when the season day turns: one episode per colony seen during the day that ended. */
  scheduleEpisodes(day: number): void {
    if (day < 1 || this.lastEpisodeDay === day) return;
    this.lastEpisodeDay = day;
    const w = this.deps.world();
    for (const c of Object.values(w.colonies)) {
      if (c.npc || c.lastSeenAt < (day - 1) * 86400) continue;
      void this.scheduler.enqueue<EpisodeJob, string>('episode', 'episode', { colonyId: c.id, lang: this.langOf(c.id), day }, { colony: c.id, key: `episode:${c.id}:${day}`, spreadMs: this.cfg.episodeSpreadMin * 60000, ttlMs: 12 * 3600000 }).then((j) => j.result.catch(() => undefined));
    }
  }

  // --- the player's memory: theirs to read and to erase -----------------------------

  async exportMemory(colonyId: string): Promise<{ facts: ReturnType<typeof factsFrom>; record: MemoryRecord; rendered: string; stores: string[] } | null> {
    const c = this.colony(colonyId);
    if (!c) return null;
    const mem = await this.memoryOf(c, this.langOf(c.id));
    return { facts: factsFrom(this.deps.world(), c), record: mem.record, rendered: mem.text, stores: this.mirror ? ['postgres', 'instance'] : ['postgres'] };
  }

  /**
   * Erase everywhere: every key this colony's memory may live under (its account or season key, a legacy bare id), in
   * Postgres and on the instance. `mirror`: the instance confirmed (null without an instance); `pending`: it did not
   * answer and the erasure stays queued in the outbox until it does (the player is told, not reassured).
   */
  async eraseMemory(colonyId: string): Promise<{ ok: boolean; mirror: boolean | null; pending: boolean }> {
    const c = this.colony(colonyId);
    if (!c) return { ok: false, mirror: null, pending: false };
    let mirror: boolean | null = this.mirror ? true : null;
    let pending = false;
    for (const key of new Set([await this.keyOf(c.id), this.seasonKey(c.id), c.id])) {
      const r = await this.eraseKey(key);
      if (r.mirror === false) mirror = false;
      pending ||= r.pending;
    }
    this.talks.delete(c.id);
    for (const lang of ['fr', 'en'] as const) { this.briefings.delete(`${c.id}:${lang}`); this.counsels.delete(`${c.id}:${lang}`); }
    return { ok: true, mirror, pending };
  }

  // --- observability -----------------------------------------------------------

  async snapshot(): Promise<{ llm: ReturnType<LlmMetrics['snapshot']>; jobs: Awaited<ReturnType<Scheduler['counts']>>; inFlight: number; pendingDoctrines: number; classes: { voice: string | null; routine: string | null; narrative: string | null }; memory: Awaited<ReturnType<GeneralService['memoryHealth']>> }> {
    return { llm: this.metrics.snapshot(), jobs: await this.scheduler.counts(), inFlight: this.scheduler.inFlight, pendingDoctrines: this.pending.size, classes: { voice: this.stack.voice?.name ?? null, routine: this.stack.forClass('routine')?.name ?? null, narrative: this.stack.narrative?.name ?? null }, memory: await this.memoryHealth() };
  }

  private async readBackups(): Promise<BackupStatus[]> {
    if (!this.deps.backupStatus || Date.now() - this.backupsReadAt < 60000) return this.backups;
    this.backupsReadAt = Date.now();
    try { this.backups = await this.deps.backupStatus(); } catch (err) { console.warn(JSON.stringify({ msg: 'backup status', error: (err as Error).message })); }
    return this.backups;
  }

  /**
   * The memory's health, for the admin snapshot, the Prometheus scrape and an Uptime Kuma check
   * (`GET /api/admin/memory/health`, 503 when a problem is listed): mirror failing, outbox not draining, reconciliation
   * failing, a backup older than `MEMORY_ALERT_BACKUP_H` hours.
   */
  async memoryHealth(): Promise<{ ok: boolean; problems: string[]; stores: string[]; mirrorFailures: number; mirror: MirrorStats | null; repairs: number; legacy: { migrated: number; orphans: number }; backups: (BackupStatus & { ageS: number })[] }> {
    const now = Date.now();
    await this.mirror?.refreshStats().catch(() => undefined);
    const backups = (await this.readBackups()).map((b) => ({ ...b, ageS: Math.round((now - b.at) / 1000) }));
    const problems: string[] = [];
    const s = this.mirror?.stats ?? null;
    if (s) {
      if (s.outboxDepth > 0 && s.outboxOldestAgeS >= this.cfg.memoryAlertOutboxS) problems.push(`outbox: ${s.outboxDepth} write(s) waiting, oldest ${s.outboxOldestAgeS} s`);
      if (s.consecutiveFailures >= 3) problems.push(`mirror: ${s.consecutiveFailures} consecutive failures (${s.lastError ?? '?'})`);
      if (s.reconcile.error) problems.push(`reconcile: ${s.reconcile.error}`);
    }
    if (this.deps.backupStatus) {
      for (const kind of this.mirror ? ['pg', 'memory'] : ['pg']) {
        const b = backups.find((x) => x.kind === kind);
        if (!b) problems.push(`backup ${kind}: never recorded`);
        else if (b.ageS > this.cfg.memoryAlertBackupH * 3600) problems.push(`backup ${kind}: last success ${Math.round(b.ageS / 3600)} h ago`);
      }
    }
    return { ok: problems.length === 0, problems, stores: this.mirror ? ['postgres', 'instance'] : ['postgres'], mirrorFailures: s?.consecutiveFailures ?? 0, mirror: s, repairs: memoryRepairs.count, legacy: this.legacyMemory, backups };
  }

  async prometheus(): Promise<string> {
    const h = await this.memoryHealth();
    const L: string[] = [];
    const s = h.mirror;
    L.push('# TYPE aurane_memory_healthy gauge', `aurane_memory_healthy ${h.ok ? 1 : 0}`);
    L.push('# TYPE aurane_memory_repairs_total counter', `aurane_memory_repairs_total ${h.repairs}`);
    if (s) {
      L.push('# TYPE aurane_memory_mirror_ok_total counter', `aurane_memory_mirror_ok_total ${s.ok}`);
      L.push('# TYPE aurane_memory_mirror_failures_total counter', `aurane_memory_mirror_failures_total ${s.failures}`);
      L.push('# TYPE aurane_memory_mirror_consecutive_failures gauge', `aurane_memory_mirror_consecutive_failures ${s.consecutiveFailures}`);
      if (s.lastOkAt) L.push('# TYPE aurane_memory_mirror_last_success_timestamp_seconds gauge', `aurane_memory_mirror_last_success_timestamp_seconds ${Math.round(s.lastOkAt / 1000)}`);
      L.push('# TYPE aurane_memory_outbox_depth gauge', `aurane_memory_outbox_depth ${s.outboxDepth}`);
      L.push('# TYPE aurane_memory_outbox_oldest_seconds gauge', `aurane_memory_outbox_oldest_seconds ${s.outboxOldestAgeS}`);
      if (s.reconcile.at) {
        L.push('# TYPE aurane_memory_reconcile_last_timestamp_seconds gauge', `aurane_memory_reconcile_last_timestamp_seconds ${Math.round(s.reconcile.at / 1000)}`);
        L.push('# TYPE aurane_memory_reconcile_drift gauge');
        for (const k of ['pushed', 'pulled', 'erased'] as const) L.push(`aurane_memory_reconcile_drift{kind="${k}"} ${s.reconcile[k]}`);
        L.push('# TYPE aurane_memory_reconcile_error gauge', `aurane_memory_reconcile_error ${s.reconcile.error ? 1 : 0}`);
      }
    }
    if (h.backups.length) {
      L.push('# TYPE aurane_backup_last_success_timestamp_seconds gauge');
      for (const b of h.backups) L.push(`aurane_backup_last_success_timestamp_seconds{kind="${b.kind}"} ${Math.round(b.at / 1000)}`);
      L.push('# TYPE aurane_backup_age_seconds gauge');
      for (const b of h.backups) L.push(`aurane_backup_age_seconds{kind="${b.kind}"} ${b.ageS}`);
    }
    return this.metrics.prometheus() + L.join('\n') + '\n';
  }
}

// --- synchronous fallbacks (no model, no await on the queue) --------------------

import { heuristicConverse, heuristicPolicy, renderAnalysis, templateBriefing, templateGazette, dayFacts } from '@aurane/general';

/** The client answers a card through the simulation (`counsel_answer` → journal `counsel.taken` / `counsel.skipped`, note = id): those choices join the memory's *choices* layer. */
function withJournalChoices(record: MemoryRecord, c: Colony): MemoryRecord {
  const fromJournal = (c.journal as { at: number; kind: string; note?: string }[]).filter((j) => (j.kind === 'counsel.taken' || j.kind === 'counsel.skipped') && j.note);
  if (!fromJournal.length) return record;
  const seen = new Set(record.notes.map((n) => `${n.kind}|${n.text}|${n.at}`));
  const extra = fromJournal.map((j) => ({ at: Math.round(j.at * 1000), kind: j.kind, text: j.note! })).filter((n) => !seen.has(`${n.kind}|${n.text}|${n.at}`));
  // Bounded per layer (normalizeMemory): a long journal of choices no longer pushes the episodes out.
  return normalizeMemory({ ...record, notes: [...record.notes, ...extra].sort((a, b) => a.at - b.at) }) ?? record;
}

function converseSync(text: string, lang: 'fr' | 'en', c: Colony, ctx: DoctrineContext): ConverseResult {
  return heuristicConverse({ text, lang, persona: c.persona, history: [], ctx });
}
function heuristicSync(text: string, lang: 'fr' | 'en', c: Colony, ctx: DoctrineContext): CompiledDoctrine { void lang; void c; return heuristicPolicy(text, ctx); }
function writeBriefingSync(input: Parameters<typeof writeBriefing>[0]): { text: string; source: string } { return { text: templateBriefing(input), source: 'template' }; }
function writeGazetteSync(w: World, day: number, lang: 'fr' | 'en'): GazetteIssue { return templateGazette(dayFacts(w, day), lang, w.time); }
function renderAnalysisSafe(a: Analysis, lang: 'fr' | 'en'): string { return renderAnalysis(a, lang); }
