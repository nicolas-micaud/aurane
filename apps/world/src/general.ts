// The Generals' service: everything between the HTTP boundary and the model. It owns the job queue,
// the quotas, the memory, the pending doctrines and the caches; the engine only exposes the world. No
// method here is called from the simulation step: the Draw never waits for a model.
import type { Policy } from '@aurane/protocol';
import { apply, viewFor, type Colony, type World } from '@aurane/sim';
import {
  InMemoryMemoryStore, LlmMetrics, MemoryJobStore, PlayerQuota, Scheduler, analyze, compileDoctrine, converse, degradedReply, emptyMemory, factsFrom,
  metrics as globalMetrics, rememberPhrases, renderMemory, stackFromEnv, writeBriefing, writeGazette,
  type Analysis, type CompiledDoctrine, type ConverseResult, type DoctrineContext, type GazetteIssue, type JobStore, type LlmStack, type MemoryRecord, type MemoryStore, type Turn,
} from '@aurane/general';
import type { Config } from './config.js';

export interface GeneralDeps {
  world: () => World;
  /** Mark a colony's view dirty (its clients get a fresh frame). */
  dirty: (colonyId: string) => void;
  jobStore?: JobStore | undefined;
  memoryStore?: MemoryStore | undefined;
  stack?: LlmStack | undefined;
  metrics?: LlmMetrics | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export interface PendingDoctrine { id: string; colonyId: string; policy: Policy; readable: string[]; summary: string; reply: string; createdAt: number; lang: 'fr' | 'en' }

export interface TalkResponse { reply: string; source: string; policyChanged: boolean; pending: { id: string; readable: string[] } | null; question: string | null; history: Turn[] }
export interface DoctrineResponse { policy: Policy; summary: string; readable: string[]; question: string | null; source: string; warnings: string[]; reply: string; pending: { id: string } | null; applied: boolean }

interface TalkJob { colonyId: string; text: string; lang: 'fr' | 'en'; seed: string }
interface BriefingJob { colonyId: string; lang: 'fr' | 'en'; since: number; awaySeconds: number }
interface GazetteJob { day: number; lang: 'fr' | 'en' }

const ABSENT_AFTER_S = 1800;

export class GeneralService {
  readonly scheduler: Scheduler;
  readonly stack: LlmStack;
  readonly metrics: LlmMetrics;
  readonly quota: PlayerQuota;
  private readonly memoryStore: MemoryStore;
  private talks = new Map<string, Turn[]>();
  private langs = new Map<string, 'fr' | 'en'>();
  private pending = new Map<string, PendingDoctrine>();
  private lastBriefedAt = new Map<string, number>();
  private briefings = new Map<string, { text: string; source: string; eventMark: number; awaySeconds: number }>();
  private gazettes = new Map<string, GazetteIssue>();
  private seq = 0;

  constructor(readonly cfg: Config, private readonly deps: GeneralDeps) {
    this.metrics = deps.metrics ?? globalMetrics;
    this.stack = deps.stack ?? stackFromEnv(deps.env ?? process.env, this.metrics);
    for (const w of this.stack.warnings) console.warn(JSON.stringify({ msg: 'llm config', warning: w }));
    this.quota = new PlayerQuota(cfg.quotas);
    this.memoryStore = deps.memoryStore ?? new InMemoryMemoryStore();
    this.scheduler = new Scheduler(deps.jobStore ?? new MemoryJobStore(), undefined, {
      concurrency: cfg.llmWorkers,
      onEvent: (e) => { if (e.kind !== 'enqueued') this.metrics.job(e.kind); else this.metrics.job('enqueued'); },
    });
    this.scheduler.handle<TalkJob, ConverseResult>('talk', (job) => this.runTalk(job.payload));
    this.scheduler.handle<TalkJob, CompiledDoctrine>('doctrine', (job) => this.runDoctrine(job.payload));
    this.scheduler.handle<BriefingJob, { text: string; source: string }>('briefing', (job) => this.runBriefing(job.payload));
    this.scheduler.handle<GazetteJob, GazetteIssue>('gazette', (job) => this.runGazette(job.payload));
  }

  start(): void { this.scheduler.start(); }
  async stop(): Promise<void> { await this.scheduler.stop(); }

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
    return { lang, current: c.policy, systems, colonies, alliances, persona: c.persona };
  }

  private async memoryOf(c: Colony, lang: 'fr' | 'en'): Promise<{ record: MemoryRecord; text: string }> {
    const record = (await this.memoryStore.load(c.id)) ?? emptyMemory();
    return { record, text: renderMemory(factsFrom(this.deps.world(), c), record, lang) };
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
    this.pending.set(c.id, p);
    return p;
  }

  // --- talk --------------------------------------------------------------------

  private async runTalk(p: TalkJob): Promise<ConverseResult> {
    const c = this.colony(p.colonyId);
    if (!c) throw new Error('colony gone');
    const mem = await this.memoryOf(c, p.lang);
    const res = await converse({ text: p.text, lang: p.lang, persona: c.persona, history: this.history(c.id), ctx: this.context(c, p.lang), analysis: this.analysisOf(c), memory: mem.text, seed: p.seed }, this.stack.voice);
    if (res.usedPhrases.length) await this.memoryStore.save(c.id, rememberPhrases(mem.record, res.usedPhrases));
    return res;
  }

  async talk(colonyId: string, text: string, lang: 'fr' | 'en'): Promise<TalkResponse | null> {
    const c = this.colony(colonyId);
    if (!c) return null;
    this.langs.set(c.id, lang);
    const history = this.history(c.id);
    const seed = `${c.id}:${history.length}:${Date.now()}`;
    let res: ConverseResult;
    const overQuota = !this.quota.take(c.id, 'talk');
    if (!overQuota && this.stack.voice && !this.scheduler.active) res = await this.runTalk({ colonyId: c.id, text, lang, seed });
    else if (overQuota || !this.stack.voice) {
      res = await converse({ text, lang, persona: c.persona, history, ctx: this.context(c, lang), analysis: this.analysisOf(c), seed, overQuota }, null);
      if (overQuota) this.metrics.degradation('voice', 'talk', 'quota');
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
    const overQuota = !this.quota.take(c.id, 'doctrine');
    if (!overQuota && this.stack.voice && !this.scheduler.active) compiled = await this.runDoctrine({ colonyId: c.id, text, lang, seed });
    else if (overQuota || !this.stack.voice) {
      compiled = await compileDoctrine(text, this.context(c, lang), null, { overQuota, seed });
      if (overQuota) this.metrics.degradation('voice', 'doctrine', 'quota');
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

  pendingDoctrine(colonyId: string): PendingDoctrine | null { return this.pending.get(colonyId) ?? null; }

  /** The player read the doctrine and confirms: it becomes active. */
  confirmDoctrine(colonyId: string, id: string): { ok: true; summary: string } | { ok: false; reason: string } {
    const c = this.colony(colonyId);
    const p = this.pending.get(colonyId);
    if (!c || !p || p.id !== id) return { ok: false, reason: 'no such pending doctrine' };
    this.pending.delete(colonyId);
    this.applyPolicy(c, p.policy);
    return { ok: true, summary: p.summary };
  }

  discardDoctrine(colonyId: string): void { this.pending.delete(colonyId); }

  // --- briefing ----------------------------------------------------------------

  private eventMark(c: Colony, since: number): number {
    const w = this.deps.world();
    let n = 0;
    for (const e of w.events) if (e.at > since && (e.actors.includes(c.id) || e.kind === 'draw')) n++;
    return n;
  }

  private briefingInput(c: Colony, lang: 'fr' | 'en', since: number, awaySeconds: number): Parameters<typeof writeBriefing>[0] {
    const w = this.deps.world();
    const events = w.events.filter((e) => e.at > since && (e.actors.includes(c.id) || e.kind === 'draw'));
    const names: Record<string, string> = {};
    for (const o of Object.values(w.colonies)) names[o.id] = o.name;
    return { view: viewFor(w, c), events, awaySeconds, persona: c.persona, lang, names, analysis: this.analysisOf(c), seed: `${c.id}:${since}` };
  }

  private async runBriefing(p: BriefingJob): Promise<{ text: string; source: string }> {
    const c = this.colony(p.colonyId);
    if (!c) throw new Error('colony gone');
    const mem = await this.memoryOf(c, p.lang);
    const r = await writeBriefing({ ...this.briefingInput(c, p.lang, p.since, p.awaySeconds), memory: mem.text }, this.stack.voice);
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
    const overQuota = worth && !this.quota.take(c.id, 'briefing');
    let out: { text: string; source: string };
    if (worth && !overQuota && this.stack.voice && !this.scheduler.active) out = await this.runBriefing({ colonyId: c.id, lang, since, awaySeconds });
    else if (!worth || overQuota || !this.stack.voice) {
      out = await writeBriefing({ ...this.briefingInput(c, lang, since, awaySeconds), overQuota }, null);
      if (overQuota) this.metrics.degradation('voice', 'briefing', 'quota');
    } else {
      const input = this.briefingInput(c, lang, since, awaySeconds);
      const template = (): { text: string; source: string } => { this.metrics.degradation('voice', 'briefing', 'deadline'); return writeBriefingSync(input); };
      out = (await this.scheduler.enqueueWithDeadline<BriefingJob, { text: string; source: string }>('briefing', 'briefing', { colonyId: c.id, lang, since, awaySeconds }, this.cfg.briefingDeadlineMs, template, { colony: c.id, key: `briefing:${c.id}:${lang}:${since}`, ttlMs: 900000 })).result;
    }
    this.lastBriefedAt.set(c.id, w.time);
    this.briefings.set(`${c.id}:${lang}`, { text: out.text, source: out.source, eventMark: this.eventMark(c, w.time), awaySeconds });
    return { ...out, awaySeconds };
  }

  // --- gazette -------------------------------------------------------------------

  private async runGazette(p: GazetteJob): Promise<GazetteIssue> {
    const issue = await writeGazette(this.deps.world(), p.day, p.lang, this.stack.narrative ?? this.stack.voice);
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

  // --- observability -----------------------------------------------------------

  async snapshot(): Promise<{ llm: ReturnType<LlmMetrics['snapshot']>; jobs: Awaited<ReturnType<Scheduler['counts']>>; inFlight: number; pendingDoctrines: number; classes: { voice: string | null; narrative: string | null } }> {
    return { llm: this.metrics.snapshot(), jobs: await this.scheduler.counts(), inFlight: this.scheduler.inFlight, pendingDoctrines: this.pending.size, classes: { voice: this.stack.voice?.name ?? null, narrative: this.stack.narrative?.name ?? null } };
  }

  prometheus(): string { return this.metrics.prometheus(); }
}

// --- synchronous fallbacks (no model, no await on the queue) --------------------

import { heuristicConverse, heuristicPolicy, renderAnalysis, templateBriefing, templateGazette, dayFacts } from '@aurane/general';

function converseSync(text: string, lang: 'fr' | 'en', c: Colony, ctx: DoctrineContext): ConverseResult {
  return heuristicConverse({ text, lang, persona: c.persona, history: [], ctx });
}
function heuristicSync(text: string, lang: 'fr' | 'en', c: Colony, ctx: DoctrineContext): CompiledDoctrine { void lang; void c; return heuristicPolicy(text, ctx); }
function writeBriefingSync(input: Parameters<typeof writeBriefing>[0]): { text: string; source: string } { return { text: templateBriefing(input), source: 'template' }; }
function writeGazetteSync(w: World, day: number, lang: 'fr' | 'en'): GazetteIssue { return templateGazette(dayFacts(w, day), lang, w.time); }
function renderAnalysisSafe(a: Analysis, lang: 'fr' | 'en'): string { return renderAnalysis(a, lang); }
