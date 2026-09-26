// What the General remembers: structured facts, never transcripts. Betrayals, allies, victories and
// defeats are read from the world's event log; formulas recently used and past seasons are persisted
// by the world process (MemoryStore), outside the world snapshot.
import type { Colony, World } from '@aurane/sim';
import { isAlly } from '@aurane/sim';
import { safeName } from '../security.js';
import type { Lang } from './sheets.js';

export interface SeasonMemory { seed: string; label: string; summary: { fr: string; en: string } }
export interface MemoryNote { at: number; kind: string; text: string }

/** Schema of the persisted record. v1 adds `v` and `rev`; a record without `v` (v0) reads as v1. */
export const MEMORY_SCHEMA = 1;

/** The persisted part (per memory key: an account, or a colony of one season). */
export interface MemoryRecord {
  v?: number;
  /** Revision stamped on every write through the mirrored store (a monotonic millisecond clock): the instance refuses an
   *  older one, so a late PUT never overwrites a newer record or brings back an erased one. */
  rev?: number;
  /** Last signature lines the General used, newest last, so it does not repeat itself. */
  recentPhrases: string[];
  seasons: SeasonMemory[];
  /** Free structured notes the world process may add (e.g. the player's stated preferences). */
  notes: MemoryNote[];
}

/** Size bounds, per layer: the choices, the episodes (fourteen days) and the other notes never evict one another. */
export const MEMORY_CAPS = { choices: 60, episodes: 14, notes: 40, phrases: 10, seasons: 20, text: 600, kind: 40 } as const;
const CHOICE_KINDS: ReadonlySet<string> = new Set(['counsel.taken', 'counsel.skipped', 'order']);

export const emptyMemory = (): MemoryRecord => ({ v: MEMORY_SCHEMA, recentPhrases: [], seasons: [], notes: [] });
export const isEmptyMemory = (m: MemoryRecord): boolean => !m.notes.length && !m.seasons.length && !m.recentPhrases.length;

/** Records repaired on read (corrupt JSON, wrong shapes, over the bounds): a metric, never an exception. */
export const memoryRepairs = { count: 0 };

/** Keep the newest notes of each layer within its bound, order preserved. */
export function capNotes(notes: readonly MemoryNote[], caps: { choices?: number; episodes?: number; notes?: number } = {}): MemoryNote[] {
  const cap = { c: caps.choices ?? MEMORY_CAPS.choices, e: caps.episodes ?? MEMORY_CAPS.episodes, o: caps.notes ?? MEMORY_CAPS.notes };
  const seen = { c: 0, e: 0, o: 0 };
  const keep: boolean[] = [];
  for (let i = notes.length - 1; i >= 0; i--) {
    const k = notes[i]!.kind;
    const cls = CHOICE_KINDS.has(k) ? 'c' : k === 'episode' ? 'e' : 'o';
    keep[i] = ++seen[cls] <= cap[cls];
  }
  return notes.filter((_, i) => keep[i]);
}

const str = (x: unknown, max: number): string | null => (typeof x === 'string' ? x.slice(0, max) : null);

/**
 * A record as read from Postgres, the instance or a file, made safe: unknown shapes are dropped, strings and layers
 * bounded, the schema stamped. `null` in, `null` out; anything else unreadable becomes an empty memory (and is counted).
 */
export function normalizeMemory(raw: unknown): MemoryRecord | null {
  if (raw === null || raw === undefined) return null;
  let src: unknown = raw;
  if (typeof src === 'string') { try { src = JSON.parse(src); } catch { memoryRepairs.count++; return emptyMemory(); } }
  if (!src || typeof src !== 'object' || Array.isArray(src)) { memoryRepairs.count++; return emptyMemory(); }
  const o = src as Record<string, unknown>;
  let repaired = false;
  const arr = (x: unknown): unknown[] => { if (Array.isArray(x)) return x; if (x !== undefined) repaired = true; return []; };
  const phrases = arr(o.recentPhrases).map((p) => str(p, MEMORY_CAPS.text)).filter((p): p is string => p !== null);
  const seasons: SeasonMemory[] = [];
  for (const s of arr(o.seasons)) {
    const x = s as Record<string, unknown> | null;
    const sum = (x?.summary ?? null) as Record<string, unknown> | null;
    const seed = str(x?.seed, 80), label = str(x?.label, 120), fr = str(sum?.fr, MEMORY_CAPS.text), en = str(sum?.en, MEMORY_CAPS.text);
    if (seed === null || label === null || fr === null || en === null) { repaired = true; continue; }
    seasons.push({ seed, label, summary: { fr, en } });
  }
  const notes: MemoryNote[] = [];
  for (const n of arr(o.notes)) {
    const x = n as Record<string, unknown> | null;
    const at = typeof x?.at === 'number' && Number.isFinite(x.at) ? x.at : null;
    const kind = str(x?.kind, MEMORY_CAPS.kind), text = str(x?.text, MEMORY_CAPS.text);
    if (at === null || kind === null || text === null) { repaired = true; continue; }
    notes.push({ at, kind, text });
  }
  const capped = capNotes(notes);
  if (capped.length !== notes.length || phrases.length > MEMORY_CAPS.phrases || seasons.length > MEMORY_CAPS.seasons) repaired = true;
  if (repaired) memoryRepairs.count++;
  const rev = typeof o.rev === 'number' && Number.isFinite(o.rev) && o.rev >= 0 ? Math.floor(o.rev) : undefined;
  return { v: MEMORY_SCHEMA, ...(rev !== undefined ? { rev } : {}), recentPhrases: phrases.slice(-MEMORY_CAPS.phrases), seasons: seasons.slice(-MEMORY_CAPS.seasons), notes: capped };
}

/** Two memories of the same player as one (a guest colony joining its account, the instance and Postgres after an outage). */
export function mergeMemory(a: MemoryRecord | null, b: MemoryRecord | null): MemoryRecord {
  const x = a ?? emptyMemory(), y = b ?? emptyMemory();
  const seen = new Set<string>();
  const notes = [...x.notes, ...y.notes].filter((n) => { const k = `${n.kind}|${n.text}|${n.at}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((p, q) => p.at - q.at);
  const seasons = [...x.seasons, ...y.seasons.filter((s) => !x.seasons.some((t) => t.seed === s.seed))];
  const recentPhrases = [...x.recentPhrases.filter((p) => !y.recentPhrases.includes(p)), ...y.recentPhrases];
  const rev = Math.max(x.rev ?? 0, y.rev ?? 0);
  return normalizeMemory({ v: MEMORY_SCHEMA, ...(rev ? { rev } : {}), recentPhrases, seasons, notes })!;
}

export type MemoryUpdate = (current: MemoryRecord | null) => MemoryRecord;
export interface MemoryIndexEntry { key: string; rev: number; empty: boolean }

export interface MemoryStore {
  load(key: string): Promise<MemoryRecord | null>;
  save(key: string, m: MemoryRecord): Promise<void>;
  /** Read-modify-write that a concurrent write cannot undo (a row lock in Postgres, a per-key queue in process). */
  update(key: string, fn: MemoryUpdate): Promise<MemoryRecord>;
  /** Every key with its revision, for the reconciliation with the instance. */
  index?(): Promise<MemoryIndexEntry[]>;
}

/** One queue per key: the operations on a key run one after the other, the other keys are not held. */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const p = prev.then(fn, fn);
    const tail = p.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return p;
  }
}

/**
 * The dedicated long memory of Aurane (decision 0009, Nick 25.09: an instance of its own, player data kept apart from
 * ninabot's). Contract, deliberately small: PUT /memory/{key} with the record as JSON, GET /memory/{key},
 * DELETE /memory/{key}?rev=, GET /admin/index; Bearer token. Postgres stays the working copy: the world never waits.
 */
export class HttpMemoryStore {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly fetchFn: typeof fetch = (i, o) => fetch(i, o), private readonly timeoutMs = 4000) {}
  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: ctrl.signal });
    } finally { clearTimeout(timer); }
  }
  private path(key: string): string { return `/memory/${encodeURIComponent(key)}`; }
  async load(key: string): Promise<MemoryRecord | null> {
    const r = await this.call('GET', this.path(key));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`memory instance: HTTP ${r.status}`);
    const text = await r.text();
    try { return normalizeMemory(JSON.parse(text)); } catch { throw new Error('memory instance: unreadable record'); }
  }
  /** 409: the instance holds a newer revision (or an erasure after this one): nothing to push, the write is done. */
  async save(key: string, m: MemoryRecord): Promise<'ok' | 'stale'> {
    const r = await this.call('PUT', this.path(key), m);
    if (r.status === 409) return 'stale';
    if (!r.ok) throw new Error(`memory instance: HTTP ${r.status}`);
    return 'ok';
  }
  async erase(key: string, rev?: number): Promise<void> {
    const r = await this.call('DELETE', `${this.path(key)}${rev ? `?rev=${rev}` : ''}`);
    if (!r.ok && r.status !== 404) throw new Error(`memory instance: HTTP ${r.status}`);
  }
  async index(): Promise<Map<string, { rev: number; erased: boolean }>> {
    const r = await this.call('GET', '/admin/index');
    if (!r.ok) throw new Error(`memory instance: HTTP ${r.status}`);
    const body = await r.json() as Record<string, { rev?: number; erased?: boolean }>;
    return new Map(Object.entries(body).map(([k, v]) => [k, { rev: Number(v.rev) || 0, erased: !!v.erased }]));
  }
}

/** What the instance still has to hear, one row per key; `merge` = the instance may hold what Postgres lacks. */
export type OutboxOp = 'put' | 'merge' | 'delete';
export interface OutboxItem { key: string; op: OutboxOp; seq: number; attempts: number; nextAt: number; createdAt: number; lastError: string | null }
export interface MirrorOutbox {
  /** Upsert (latest wins, see `combineOps`); returns the item's new sequence number. */
  enqueue(key: string, op: OutboxOp, now: number): Promise<number>;
  due(now: number, limit: number): Promise<OutboxItem[]>;
  /** Done, unless the key was enqueued again meanwhile (another `seq`). */
  ack(key: string, seq: number): Promise<void>;
  retry(key: string, seq: number, nextAt: number, error: string): Promise<void>;
  stats(now: number): Promise<{ depth: number; oldestAgeS: number; maxAttempts: number }>;
}

/** An erasure beats everything; a write after an erasure replaces the whole record (never a merge with the erased one). */
export function combineOps(existing: OutboxOp | null, incoming: OutboxOp): OutboxOp {
  if (incoming === 'delete' || !existing) return incoming;
  if (incoming === 'put') return existing === 'merge' ? 'merge' : 'put';
  return existing === 'delete' ? 'put' : 'merge';
}

export class InMemoryOutbox implements MirrorOutbox {
  readonly items = new Map<string, OutboxItem>();
  private seq = 0;
  async enqueue(key: string, op: OutboxOp, now: number): Promise<number> {
    const prev = this.items.get(key);
    const it: OutboxItem = { key, op: combineOps(prev?.op ?? null, op), seq: ++this.seq, attempts: 0, nextAt: now, createdAt: prev?.createdAt ?? now, lastError: prev?.lastError ?? null };
    this.items.set(key, it);
    return it.seq;
  }
  async due(now: number, limit: number): Promise<OutboxItem[]> { return [...this.items.values()].filter((i) => i.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt).slice(0, limit).map((i) => ({ ...i })); }
  async ack(key: string, seq: number): Promise<void> { if (this.items.get(key)?.seq === seq) this.items.delete(key); }
  async retry(key: string, seq: number, nextAt: number, error: string): Promise<void> { const i = this.items.get(key); if (i?.seq === seq) { i.attempts++; i.nextAt = nextAt; i.lastError = error; } }
  async stats(now: number): Promise<{ depth: number; oldestAgeS: number; maxAttempts: number }> {
    const all = [...this.items.values()];
    return { depth: all.length, oldestAgeS: all.length ? Math.max(0, Math.round((now - Math.min(...all.map((i) => i.createdAt))) / 1000)) : 0, maxAttempts: Math.max(0, ...all.map((i) => i.attempts)) };
  }
}

export interface MirrorStats {
  ok: number; failures: number; consecutiveFailures: number; lastOkAt: number | null; lastErrorAt: number | null; lastError: string | null;
  outboxDepth: number; outboxOldestAgeS: number; outboxMaxAttempts: number;
  reconcile: { at: number | null; checked: number; pushed: number; pulled: number; erased: number; remoteOnly: number; error: string | null };
}

export interface MirroredOptions { outbox?: MirrorOutbox | undefined; now?: (() => number) | undefined; baseDelayMs?: number | undefined; maxDelayMs?: number | undefined }

/**
 * Working copy first (Postgres), long memory mirrored in the background through a durable outbox: a write the instance
 * missed is retried with backoff until it lands, a periodic reconciliation compares both sides and re-queues the
 * difference. A mirror failure never stalls the world; it shows in the metrics.
 */
export class MirroredMemoryStore implements MemoryStore {
  readonly outbox: MirrorOutbox;
  readonly stats: MirrorStats = { ok: 0, failures: 0, consecutiveFailures: 0, lastOkAt: null, lastErrorAt: null, lastError: null, outboxDepth: 0, outboxOldestAgeS: 0, outboxMaxAttempts: 0, reconcile: { at: null, checked: 0, pushed: 0, pulled: 0, erased: 0, remoteOnly: 0, error: null } };
  private readonly lock = new KeyedLock();
  private readonly now: () => number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private lastRev = 0;
  private flushing: Promise<number> | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private readonly primary: MemoryStore, private readonly mirror: HttpMemoryStore, private readonly onError: (err: Error) => void = () => undefined, opts: MirroredOptions = {}) {
    this.outbox = opts.outbox ?? new InMemoryOutbox();
    this.now = opts.now ?? Date.now;
    this.baseDelayMs = opts.baseDelayMs ?? 5000;
    this.maxDelayMs = opts.maxDelayMs ?? 10 * 60000;
  }

  private stamp(m: MemoryRecord): MemoryRecord {
    const rev = Math.max(this.now(), this.lastRev + 1, (m.rev ?? 0) + 1);
    this.lastRev = rev;
    return { ...(normalizeMemory(m) ?? emptyMemory()), v: MEMORY_SCHEMA, rev };
  }
  private failed(err: Error): void { this.stats.failures++; this.stats.consecutiveFailures++; this.stats.lastErrorAt = this.now(); this.stats.lastError = err.message; this.onError(err); }
  private succeeded(): void { this.stats.ok++; this.stats.consecutiveFailures = 0; this.stats.lastOkAt = this.now(); }
  /** The instance's copy, `undefined` when it could not answer (then Postgres cannot tell a newcomer from an outage). */
  private async remote(key: string): Promise<MemoryRecord | null | undefined> {
    try { const r = await this.mirror.load(key); this.succeeded(); return r; } catch (err) { this.failed(err as Error); return undefined; }
  }
  private kick(): void {
    // After repeated failures the timer retries on its own schedule: a dead instance does not cost every save a timeout.
    if (this.stats.consecutiveFailures >= 3) return;
    void this.flush().catch((err: Error) => this.onError(err));
  }

  async load(key: string): Promise<MemoryRecord | null> {
    const local = await this.primary.load(key);
    if (local) return local;
    return this.lock.run(key, async () => {
      const again = await this.primary.load(key);
      if (again) return again;
      const r = await this.remote(key);
      if (!r) return null;
      await this.primary.save(key, r); // the instance's revision is kept: this is its copy, not a new write
      return r;
    });
  }

  async save(key: string, m: MemoryRecord): Promise<void> {
    await this.lock.run(key, async () => { await this.primary.save(key, this.stamp(m)); await this.outbox.enqueue(key, 'put', this.now()); });
    this.kick();
  }

  async update(key: string, fn: MemoryUpdate): Promise<MemoryRecord> {
    const out = await this.lock.run(key, async () => {
      let op: OutboxOp = 'put';
      let seed: MemoryRecord | null = null;
      if (!(await this.primary.load(key))) {
        const r = await this.remote(key);
        if (r === undefined) op = 'merge'; else seed = r;
      }
      const next = await this.primary.update(key, (cur) => this.stamp(fn(cur ?? seed)));
      await this.outbox.enqueue(key, op, this.now());
      return next;
    });
    this.kick();
    return out;
  }

  async index(): Promise<MemoryIndexEntry[]> { return this.primary.index ? this.primary.index() : []; }

  /** Erase both: the world's copy at once (an empty record stays as a tombstone so no cold read brings the old one back),
   *  the instance before returning; if it does not answer, the erasure stays queued (`pending`) and is retried. */
  async erase(key: string): Promise<{ primary: true; mirror: boolean; pending: boolean }> {
    return this.lock.run(key, async () => {
      const tomb = this.stamp(emptyMemory());
      await this.primary.save(key, tomb);
      const seq = await this.outbox.enqueue(key, 'delete', this.now());
      try {
        await this.mirror.erase(key, tomb.rev);
        await this.outbox.ack(key, seq);
        this.succeeded();
        return { primary: true as const, mirror: true, pending: false };
      } catch (err) {
        this.failed(err as Error);
        await this.outbox.retry(key, seq, this.now(), (err as Error).message); // due at the next flush: an erasure does not wait
        return { primary: true as const, mirror: false, pending: true };
      }
    });
  }

  /** Push what is due; returns how many items landed. One flush at a time; the HTTP call runs outside the key's lock
   *  (the instance orders writes by revision), so a slow instance never holds a player's action. */
  flush(limit = 50): Promise<number> {
    if (this.flushing) return this.flushing;
    const run = async (): Promise<number> => {
      let done = 0;
      for (const it of await this.outbox.due(this.now(), limit)) {
        try {
          if (it.op === 'delete') {
            const cur = await this.primary.load(it.key);
            await this.mirror.erase(it.key, cur?.rev);
          } else if (it.op === 'put') {
            const cur = await this.primary.load(it.key);
            if (cur) await this.mirror.save(it.key, cur);
          } else {
            const r = await this.mirror.load(it.key);
            const merged = await this.lock.run(it.key, async () => {
              const cur = await this.primary.load(it.key);
              const m = r ? this.stamp(mergeMemory(r, cur)) : cur;
              if (m && r) await this.primary.save(it.key, m);
              return m;
            });
            if (merged) await this.mirror.save(it.key, merged);
          }
          await this.outbox.ack(it.key, it.seq);
          this.succeeded();
          done++;
        } catch (err) {
          this.failed(err as Error);
          await this.outbox.retry(it.key, it.seq, this.now() + Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** it.attempts), (err as Error).message);
        }
      }
      await this.refreshStats();
      return done;
    };
    this.flushing = run().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async refreshStats(): Promise<void> {
    const s = await this.outbox.stats(this.now());
    this.stats.outboxDepth = s.depth; this.stats.outboxOldestAgeS = s.oldestAgeS; this.stats.outboxMaxAttempts = s.maxAttempts;
  }

  /**
   * Compare Postgres and the instance key by key: a newer or missing record is pushed, an instance copy newer than
   * Postgres (a restored database) is merged back, an erasure on either side wins. Keys only the instance knows are
   * left alone (they are read cold when their player returns).
   */
  async reconcile(): Promise<MirrorStats['reconcile']> {
    const r = { at: this.now(), checked: 0, pushed: 0, pulled: 0, erased: 0, remoteOnly: 0, error: null as string | null };
    try {
      if (!this.primary.index) throw new Error('primary store has no index');
      const [local, remote] = await Promise.all([this.primary.index(), this.mirror.index()]);
      const known = new Set<string>();
      for (const l of local) {
        known.add(l.key); r.checked++;
        const x = remote.get(l.key);
        if (x?.erased && x.rev > l.rev && !l.empty) {
          // The player erased after the backup Postgres was restored from: the erasure holds.
          await this.lock.run(l.key, () => this.primary.save(l.key, this.stamp(emptyMemory())));
          await this.outbox.enqueue(l.key, 'delete', this.now()); r.erased++;
        } else if (l.empty) {
          if (x && !x.erased) { await this.outbox.enqueue(l.key, 'delete', this.now()); r.erased++; }
        } else if (!x || x.rev < l.rev || (x.erased && x.rev <= l.rev)) {
          await this.outbox.enqueue(l.key, 'put', this.now()); r.pushed++;
        } else if (x.rev > l.rev) {
          await this.outbox.enqueue(l.key, 'merge', this.now()); r.pulled++;
        }
      }
      for (const [k, x] of remote) if (!known.has(k) && !x.erased) r.remoteOnly++;
      this.succeeded();
    } catch (err) { r.error = (err as Error).message; this.failed(err as Error); }
    this.stats.reconcile = r;
    if (r.pushed + r.pulled + r.erased) this.kick();
    return r;
  }

  /** Background work: flush every `flushMs`, reconcile at start and every `reconcileMs`. */
  start(opts: { flushMs?: number; reconcileMs?: number } = {}): void {
    if (this.timers.length) return;
    const t1 = setInterval(() => void this.flush().catch((err: Error) => this.onError(err)), opts.flushMs ?? 5000);
    const t2 = setInterval(() => void this.reconcile(), opts.reconcileMs ?? 3600000);
    t1.unref?.(); t2.unref?.();
    this.timers.push(t1, t2);
    void this.reconcile();
  }
  async stop(): Promise<void> { for (const t of this.timers) clearInterval(t); this.timers = []; if (this.flushing) await this.flushing.catch(() => undefined); }

  /** Kept for the admin snapshot (consecutive failures, as before). */
  get mirrorFailures(): number { return this.stats.consecutiveFailures; }
}

export class InMemoryMemoryStore implements MemoryStore {
  private map = new Map<string, MemoryRecord>();
  async load(key: string): Promise<MemoryRecord | null> { const m = this.map.get(key); return m ? structuredClone(m) : null; }
  async save(key: string, m: MemoryRecord): Promise<void> { this.map.set(key, structuredClone(m)); }
  /** No await between the read and the write: atomic in one process. */
  async update(key: string, fn: MemoryUpdate): Promise<MemoryRecord> { const cur = this.map.get(key); const next = fn(cur ? structuredClone(cur) : null); this.map.set(key, structuredClone(next)); return next; }
  async index(): Promise<MemoryIndexEntry[]> { return [...this.map.entries()].map(([key, m]) => ({ key, rev: m.rev ?? 0, empty: isEmptyMemory(m) })); }
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
export function recordChoice(m: MemoryRecord, kind: 'counsel.taken' | 'counsel.skipped' | 'order', id: string, at: number, cap: number = MEMORY_CAPS.choices): MemoryRecord {
  // Only the choices layer is bounded here: sixty clicks used to push the fourteen episodes out of the record.
  return { ...m, notes: capNotes([...m.notes, { at, kind, text: id }], { choices: cap }) };
}

/** The *episodes* layer: one line per active day, written by the model (or a template), read again on return. */
export function recordEpisode(m: MemoryRecord, day: number, text: string, at: number, cap: number = MEMORY_CAPS.episodes): MemoryRecord {
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

export function rememberPhrases(m: MemoryRecord, phrases: readonly string[], cap: number = MEMORY_CAPS.phrases): MemoryRecord {
  const recent = [...m.recentPhrases.filter((p) => !phrases.includes(p)), ...phrases].slice(-cap);
  return { ...m, recentPhrases: recent };
}

const RES_NAME: Record<Lang, Record<string, string>> = {
  fr: { metal: 'Métal', energy: 'Énergie', food: 'Vivres', crystal: 'Cristal', rium: 'Rium' },
  en: { metal: 'Metal', energy: 'Energy', food: 'Food', crystal: 'Crystal', rium: 'Rium' },
};

/** A choice id (a Counsel card) in words, for the briefing and the episodes; `name` resolves system and colony ids. */
export function describeChoice(id: string, lang: Lang, name: (id: string) => string = (x) => x): string {
  const i = id.indexOf(':');
  const kind = i < 0 ? id : id.slice(0, i);
  const arg = i < 0 ? '' : id.slice(i + 1);
  const res = RES_NAME[lang][arg] ?? arg;
  const fr: Record<string, string> = {
    touch: 'regarder ta capitale', enter: 'entrer dans ta capitale', buy_energy: 'acheter de l\'Énergie', warehouse: 'bâtir un Entrepôt', antenna: 'bâtir une Antenne',
    train: 'former deux corvettes', doctrine: 'écrire ta doctrine', link: `relier ${name(arg)}`, turret: `une tourelle à ${name(arg)}`, defend: `défendre ${name(arg)}`,
    sell: `vendre le surplus de ${res}`, treaty: `un pacte avec ${name(arg)}`, recap: `lire le compte rendu du Tirage ${arg}`,
  };
  const en: Record<string, string> = {
    touch: 'look at your capital', enter: 'enter your capital', buy_energy: 'buy Energy', warehouse: 'build a Warehouse', antenna: 'build an Antenna',
    train: 'train two corvettes', doctrine: 'write your doctrine', link: `link ${name(arg)}`, turret: `a turret at ${name(arg)}`, defend: `defend ${name(arg)}`,
    sell: `sell the ${res} surplus`, treaty: `a pact with ${name(arg)}`, recap: `read the recap of Draw ${arg}`,
  };
  return (lang === 'fr' ? fr : en)[kind] ?? id;
}

/** The player's most recent Counsel decision, or null. */
export function lastChoice(m: MemoryRecord): { kind: 'counsel.taken' | 'counsel.skipped'; id: string; at: number } | null {
  for (let i = m.notes.length - 1; i >= 0; i--) {
    const n = m.notes[i]!;
    if (n.kind === 'counsel.taken' || n.kind === 'counsel.skipped') return { kind: n.kind, id: n.text, at: n.at };
  }
  return null;
}
