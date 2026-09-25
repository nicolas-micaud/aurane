// The LLM job queue: every model call is a job with a priority, a colony, a payload and a deadline.
// Live dialogue is served first; briefings, narrative reactions, the Gazette and NPC chatter wait,
// and the non-urgent ones are spread over the hour so a Draw never turns into a burst.
import type { LlmTask } from '../llm/types.js';

/** Lower runs first. */
export const PRIORITY = { talk: 0, doctrine: 1, briefing: 2, reaction: 3, gazette: 4, npc: 5 } as const;
export type JobKind = keyof typeof PRIORITY;

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'expired';

export interface Job<P = unknown, R = unknown> {
  id: string;
  kind: JobKind;
  task: LlmTask;
  priority: number;
  /** Colony the job serves (quotas, metrics), or null for shared work such as the Gazette. */
  colony: string | null;
  /** Dedup key: a second enqueue with the same key returns the existing queued job. */
  key: string | null;
  payload: P;
  createdAt: number;
  /** Not before this time (ms): the jitter that smooths a Draw's aftermath. */
  runAfter: number;
  /** After this time (ms) the job is dropped as expired: a briefing nobody waits for any more. */
  expiresAt: number;
  attempts: number;
  state: JobState;
  result?: R;
  error?: string;
}

/** Where jobs live between two process lives: Postgres in production, a JSON file in development. */
export interface JobStore {
  put(job: Job): Promise<void>;
  update(job: Job): Promise<void>;
  /** The best queued job that may run now: lowest priority number, then oldest. */
  next(now: number): Promise<Job | null>;
  findQueuedByKey(key: string): Promise<Job | null>;
  /** Jobs still marked running when the process starts are requeued. */
  recoverRunning(): Promise<number>;
  /** Drop finished jobs older than `olderThanMs`. */
  purge(olderThanMs: number, now: number): Promise<number>;
  counts(): Promise<Record<JobState, number>>;
  close(): Promise<void>;
}

const cmp = (a: Job, b: Job): number => a.priority - b.priority || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

export class MemoryJobStore implements JobStore {
  protected jobs = new Map<string, Job>();
  async put(job: Job): Promise<void> { this.jobs.set(job.id, { ...job }); await this.flush(); }
  async update(job: Job): Promise<void> { this.jobs.set(job.id, { ...job }); await this.flush(); }
  async next(now: number): Promise<Job | null> {
    let best: Job | null = null;
    for (const j of this.jobs.values()) {
      if (j.state !== 'queued' || j.runAfter > now) continue;
      if (!best || cmp(j, best) < 0) best = j;
    }
    return best ? { ...best } : null;
  }
  async findQueuedByKey(key: string): Promise<Job | null> {
    for (const j of this.jobs.values()) if (j.key === key && (j.state === 'queued' || j.state === 'running')) return { ...j };
    return null;
  }
  async recoverRunning(): Promise<number> {
    let n = 0;
    for (const j of this.jobs.values()) if (j.state === 'running') { j.state = 'queued'; n++; }
    if (n) await this.flush();
    return n;
  }
  async purge(olderThanMs: number, now: number): Promise<number> {
    let n = 0;
    for (const [id, j] of this.jobs) if (j.state !== 'queued' && j.state !== 'running' && now - j.createdAt > olderThanMs) { this.jobs.delete(id); n++; }
    if (n) await this.flush();
    return n;
  }
  async counts(): Promise<Record<JobState, number>> {
    const c: Record<JobState, number> = { queued: 0, running: 0, done: 0, failed: 0, expired: 0 };
    for (const j of this.jobs.values()) c[j.state]++;
    return c;
  }
  protected async flush(): Promise<void> { /* memory only */ }
  async close(): Promise<void> { /* nothing */ }
}

export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export type JobHandler<P = unknown, R = unknown> = (job: Job<P, R>) => Promise<R>;

export interface SchedulerOptions {
  /** Jobs executed concurrently by this scheduler (the pools bound the providers themselves). */
  concurrency?: number;
  /** Poll interval when idle. */
  idleMs?: number;
  /** Results kept in the store for this long. */
  retentionMs?: number;
  onEvent?: (e: { kind: 'done' | 'failed' | 'expired' | 'enqueued'; job: Job }) => void;
}

/**
 * One scheduler per world process. `enqueue` returns a promise that resolves with the result if the
 * caller is still around (a live request), or that can be ignored (a background rewrite).
 */
export class Scheduler {
  private handlers = new Map<JobKind, JobHandler>();
  private waiters = new Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void }[]>();
  private running = 0;
  private stopped = true;
  private loop: Promise<void> | null = null;
  private seq = 0;
  constructor(private readonly store: JobStore, private readonly clock: Clock = realClock, private readonly opts: SchedulerOptions = {}) {}

  handle<P, R>(kind: JobKind, fn: JobHandler<P, R>): void { this.handlers.set(kind, fn as JobHandler); }

  /**
   * Queue a job. `spreadMs` adds a random delay in [0, spreadMs] (the smoothing); `key` dedups; `ttlMs`
   * bounds the wait. The returned promise settles when the job ends (result, error, or expiry).
   */
  async enqueue<P, R>(kind: JobKind, task: LlmTask, payload: P, o: { colony?: string | null; key?: string | null; spreadMs?: number; ttlMs?: number; random?: () => number } = {}): Promise<{ id: string; result: Promise<R>; reused: boolean }> {
    if (o.key) {
      const existing = await this.store.findQueuedByKey(o.key);
      if (existing) return { id: existing.id, result: this.wait<R>(existing.id), reused: true };
    }
    const now = this.clock.now();
    const jitter = o.spreadMs ? Math.floor((o.random ?? Math.random)() * o.spreadMs) : 0;
    const job: Job<P, R> = {
      id: `j${now.toString(36)}${(this.seq++).toString(36)}`, kind, task, priority: PRIORITY[kind], colony: o.colony ?? null, key: o.key ?? null,
      payload, createdAt: now, runAfter: now + jitter, expiresAt: now + (o.ttlMs ?? 3600000), attempts: 0, state: 'queued',
    };
    await this.store.put(job as Job);
    this.opts.onEvent?.({ kind: 'enqueued', job: job as Job });
    return { id: job.id, result: this.wait<R>(job.id), reused: false };
  }

  private wait<R>(id: string): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const list = this.waiters.get(id) ?? [];
      list.push({ resolve: resolve as (r: unknown) => void, reject });
      this.waiters.set(id, list);
    });
  }

  /** Same as enqueue but resolves with `fallback` if the job has not finished within `waitMs` (the job keeps running). */
  async enqueueWithDeadline<P, R>(kind: JobKind, task: LlmTask, payload: P, waitMs: number, fallback: () => R, o: Parameters<Scheduler['enqueue']>[3] = {}): Promise<{ result: R; timedOut: boolean; id: string }> {
    const { id, result } = await this.enqueue<P, R>(kind, task, payload, o);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), waitMs); });
    const settled = await Promise.race([result.then((r) => ({ r })).catch((e: Error) => ({ e })), timeout]);
    if (timer) clearTimeout(timer);
    if (settled === 'timeout') { result.catch(() => undefined); return { result: fallback(), timedOut: true, id }; }
    if ('e' in settled) return { result: fallback(), timedOut: false, id };
    return { result: settled.r, timedOut: false, id };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop;
    this.loop = null;
  }

  /** Run everything that is ready right now, once (tests and the CLI). Returns how many jobs ran. */
  async drain(): Promise<number> {
    let n = 0;
    for (;;) {
      const job = await this.store.next(this.clock.now());
      if (!job) return n;
      await this.execute(job);
      n++;
    }
  }

  private async run(): Promise<void> {
    await this.store.recoverRunning();
    let lastPurge = this.clock.now();
    while (!this.stopped) {
      const max = this.opts.concurrency ?? 4;
      let started = 0;
      while (this.running < max) {
        const job = await this.store.next(this.clock.now());
        if (!job) break;
        void this.execute(job);
        started++;
      }
      if (this.clock.now() - lastPurge > 600000) { lastPurge = this.clock.now(); await this.store.purge(this.opts.retentionMs ?? 6 * 3600000, lastPurge); }
      if (!started) await this.clock.sleep(this.opts.idleMs ?? 250);
    }
    while (this.running > 0) await this.clock.sleep(20);
  }

  private async execute(job: Job): Promise<void> {
    this.running++;
    try {
      const now = this.clock.now();
      if (now > job.expiresAt) {
        job.state = 'expired';
        await this.store.update(job);
        this.opts.onEvent?.({ kind: 'expired', job });
        this.settle(job.id, null, new Error('job expired'));
        return;
      }
      job.state = 'running'; job.attempts++;
      await this.store.update(job);
      const handler = this.handlers.get(job.kind);
      try {
        if (!handler) throw new Error(`no handler for ${job.kind}`);
        const result = await handler(job);
        job.state = 'done'; job.result = result;
        await this.store.update(job);
        this.opts.onEvent?.({ kind: 'done', job });
        this.settle(job.id, result, null);
      } catch (err) {
        job.state = 'failed'; job.error = (err as Error).message;
        await this.store.update(job);
        this.opts.onEvent?.({ kind: 'failed', job });
        this.settle(job.id, null, err as Error);
      }
    } finally { this.running--; }
  }

  private settle(id: string, result: unknown, err: Error | null): void {
    const list = this.waiters.get(id) ?? [];
    this.waiters.delete(id);
    for (const w of list) { if (err) w.reject(err); else w.resolve(result); }
  }

  get inFlight(): number { return this.running; }
  /** Is the loop running? When it is not, callers should do the work inline rather than wait on a deadline. */
  get active(): boolean { return !this.stopped; }
  counts(): Promise<Record<JobState, number>> { return this.store.counts(); }
}
