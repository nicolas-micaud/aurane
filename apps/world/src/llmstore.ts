// Persistence of the LLM layer, beside the world's own store: the job queue (so a briefing or a Gazette
// survives a restart) and the Generals' memory (recent phrases, past seasons). Postgres in production,
// JSON files in development, memory in tests. Nothing here touches the world snapshot.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { KeyedLock, MemoryJobStore, combineOps, emptyMemory, isEmptyMemory, normalizeMemory, type Job, type JobState, type JobStore, type MemoryIndexEntry, type MemoryRecord, type MemoryStore, type MemoryUpdate, type MirrorOutbox, type OutboxItem, type OutboxOp } from '@aurane/general';
import type { PendingDoctrine, PendingDoctrineStore } from './general.js';

/** Jobs and memory in one JSON file per kind, rewritten on change: fine for a developer's machine. */
export class FileJobStore extends MemoryJobStore {
  private loaded = false;
  constructor(private readonly dir: string) { super(); }
  private async ensure(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await mkdir(this.dir, { recursive: true });
    try { for (const j of JSON.parse(await readFile(join(this.dir, 'llm-jobs.json'), 'utf8')) as Job[]) this.jobs.set(j.id, j); } catch { /* first run */ }
  }
  /** Flushes are chained: two jobs enqueued in the same tick used to race on the same temp file (ENOENT on rename). */
  private chain: Promise<void> = Promise.resolve();
  protected override flush(): Promise<void> {
    const run = async (): Promise<void> => {
      await mkdir(this.dir, { recursive: true });
      const tmp = join(this.dir, 'llm-jobs.json.tmp');
      await writeFile(tmp, JSON.stringify([...this.jobs.values()]));
      await rename(tmp, join(this.dir, 'llm-jobs.json'));
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }
  override async put(job: Job): Promise<void> { await this.ensure(); await super.put(job); }
  override async update(job: Job): Promise<void> { await this.ensure(); await super.update(job); }
  override async next(now: number): Promise<Job | null> { await this.ensure(); return super.next(now); }
  override async findQueuedByKey(key: string): Promise<Job | null> { await this.ensure(); return super.findQueuedByKey(key); }
  override async recoverRunning(): Promise<number> { await this.ensure(); return super.recoverRunning(); }
  override async counts(): Promise<Record<JobState, number>> { await this.ensure(); return super.counts(); }
}

export class FileMemoryStore implements MemoryStore {
  private map = new Map<string, MemoryRecord>();
  private loaded = false;
  constructor(private readonly dir: string) {}
  private async ensure(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await mkdir(this.dir, { recursive: true });
    try { for (const [k, v] of Object.entries(JSON.parse(await readFile(join(this.dir, 'general-memory.json'), 'utf8')) as Record<string, MemoryRecord>)) this.map.set(k, v); } catch { /* first run */ }
  }
  private readonly lock = new KeyedLock();
  async load(key: string): Promise<MemoryRecord | null> { await this.ensure(); const m = this.map.get(key); return m ? normalizeMemory(structuredClone(m)) : null; }
  async save(key: string, m: MemoryRecord): Promise<void> {
    await this.ensure();
    this.map.set(key, structuredClone(m));
    // One file for every key: writes are queued so two saves never race on the temp file.
    await this.lock.run('file', async () => {
      const tmp = join(this.dir, 'general-memory.json.tmp');
      await writeFile(tmp, JSON.stringify(Object.fromEntries(this.map)));
      await rename(tmp, join(this.dir, 'general-memory.json'));
    });
  }
  async update(key: string, fn: MemoryUpdate): Promise<MemoryRecord> {
    await this.ensure();
    const next = fn(await this.load(key)); // no await between the read and the in-memory write
    await this.save(key, next);
    return next;
  }
  async index(): Promise<MemoryIndexEntry[]> { await this.ensure(); return [...this.map.entries()].map(([key, m]) => ({ key, rev: m.rev ?? 0, empty: isEmptyMemory(normalizeMemory(m) ?? emptyMemory()) })); }
}

interface JobRow { id: string; kind: string; task: string; priority: number; colony: string | null; key: string | null; payload: unknown; created_at: string; run_after: string; expires_at: string; attempts: number; state: string; result: unknown; error: string | null }
const rowToJob = (r: JobRow): Job => ({ id: r.id, kind: r.kind as Job['kind'], task: r.task as Job['task'], priority: r.priority, colony: r.colony, key: r.key, payload: r.payload, createdAt: Number(r.created_at), runAfter: Number(r.run_after), expiresAt: Number(r.expires_at), attempts: r.attempts, state: r.state as JobState, ...(r.result !== null && r.result !== undefined ? { result: r.result } : {}), ...(r.error ? { error: r.error } : {}) });

export class PgJobStore implements JobStore {
  constructor(private readonly pool: pg.Pool) {}
  static async migrate(pool: pg.Pool): Promise<void> {
    await pool.query(`
      create table if not exists llm_jobs (
        id text primary key, kind text not null, task text not null, priority int not null, colony text, key text,
        payload jsonb not null, created_at bigint not null, run_after bigint not null, expires_at bigint not null,
        attempts int not null default 0, state text not null, result jsonb, error text);
      create index if not exists llm_jobs_ready on llm_jobs (state, run_after, priority, created_at);
      create index if not exists llm_jobs_key on llm_jobs (key) where key is not null;
      create table if not exists general_memory (colony_id text primary key, data jsonb not null, updated_at timestamptz not null default now());
      create sequence if not exists memory_outbox_seq;
      create table if not exists memory_outbox (key text primary key, op text not null, seq bigint not null, attempts int not null default 0,
        next_at bigint not null, created_at bigint not null, last_error text);
      create index if not exists memory_outbox_due on memory_outbox (next_at);
      create table if not exists ops_backups (kind text primary key, at timestamptz not null, bytes bigint, object text);
    `);
  }
  async put(j: Job): Promise<void> {
    await this.pool.query('insert into llm_jobs (id, kind, task, priority, colony, key, payload, created_at, run_after, expires_at, attempts, state, result, error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (id) do nothing',
      [j.id, j.kind, j.task, j.priority, j.colony, j.key, JSON.stringify(j.payload ?? null), j.createdAt, j.runAfter, j.expiresAt, j.attempts, j.state, j.result === undefined ? null : JSON.stringify(j.result), j.error ?? null]);
  }
  async update(j: Job): Promise<void> {
    await this.pool.query('update llm_jobs set attempts = $2, state = $3, result = $4, error = $5 where id = $1', [j.id, j.attempts, j.state, j.result === undefined ? null : JSON.stringify(j.result), j.error ?? null]);
  }
  async next(now: number): Promise<Job | null> {
    const r = await this.pool.query<JobRow>("select * from llm_jobs where state = 'queued' and run_after <= $1 order by priority, created_at, id limit 1", [now]);
    return r.rows[0] ? rowToJob(r.rows[0]) : null;
  }
  async findQueuedByKey(key: string): Promise<Job | null> {
    const r = await this.pool.query<JobRow>("select * from llm_jobs where key = $1 and state in ('queued', 'running') limit 1", [key]);
    return r.rows[0] ? rowToJob(r.rows[0]) : null;
  }
  async recoverRunning(): Promise<number> {
    const r = await this.pool.query("update llm_jobs set state = 'queued' where state = 'running'");
    return r.rowCount ?? 0;
  }
  async purge(olderThanMs: number, now: number): Promise<number> {
    const r = await this.pool.query("delete from llm_jobs where state not in ('queued', 'running') and created_at < $1", [now - olderThanMs]);
    return r.rowCount ?? 0;
  }
  async counts(): Promise<Record<JobState, number>> {
    const r = await this.pool.query<{ state: JobState; n: string }>('select state, count(*)::text as n from llm_jobs group by state');
    const c: Record<JobState, number> = { queued: 0, running: 0, done: 0, failed: 0, expired: 0 };
    for (const row of r.rows) c[row.state] = Number(row.n);
    return c;
  }
  async close(): Promise<void> { /* the pool belongs to the caller */ }
}

/** `colony_id` is the memory key (`account:…` or `season:<seed>:<colony>`; a bare colony id is a pre-0.x legacy row). */
export class PgMemoryStore implements MemoryStore {
  constructor(private readonly pool: pg.Pool) {}
  async load(key: string): Promise<MemoryRecord | null> {
    const r = await this.pool.query<{ data: unknown }>('select data from general_memory where colony_id = $1', [key]);
    return r.rows[0] ? normalizeMemory(r.rows[0].data) : null;
  }
  async save(key: string, m: MemoryRecord): Promise<void> {
    await this.pool.query('insert into general_memory (colony_id, data, updated_at) values ($1, $2, now()) on conflict (colony_id) do update set data = excluded.data, updated_at = now()', [key, JSON.stringify(m)]);
  }
  /** Read-modify-write under a transaction-scoped advisory lock on the key: it also covers a row that does not exist yet. */
  async update(key: string, fn: MemoryUpdate): Promise<MemoryRecord> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`general_memory:${key}`]);
      const r = await c.query<{ data: unknown }>('select data from general_memory where colony_id = $1', [key]);
      const next = fn(r.rows[0] ? normalizeMemory(r.rows[0].data) : null);
      await c.query('insert into general_memory (colony_id, data, updated_at) values ($1, $2, now()) on conflict (colony_id) do update set data = excluded.data, updated_at = now()', [key, JSON.stringify(next)]);
      await c.query('commit');
      return next;
    } catch (err) { await c.query('rollback').catch(() => undefined); throw err; } finally { c.release(); }
  }
  async index(): Promise<MemoryIndexEntry[]> {
    const r = await this.pool.query<{ key: string; rev: string; empty: boolean }>(`
      select colony_id as key,
        case when jsonb_typeof(data) = 'object' and data->>'rev' ~ '^[0-9]+$' then (data->>'rev')::bigint else 0 end as rev,
        not (jsonb_typeof(data) = 'object' and (
          (case when jsonb_typeof(data->'notes') = 'array' then jsonb_array_length(data->'notes') else 0 end) > 0 or
          (case when jsonb_typeof(data->'seasons') = 'array' then jsonb_array_length(data->'seasons') else 0 end) > 0 or
          (case when jsonb_typeof(data->'recentPhrases') = 'array' then jsonb_array_length(data->'recentPhrases') else 0 end) > 0)) as empty
      from general_memory`);
    return r.rows.map((x) => ({ key: x.key, rev: Number(x.rev), empty: x.empty }));
  }
}

/** The mirror's outbox in Postgres: what the memory instance has not confirmed survives a restart of the world. */
export class PgMirrorOutbox implements MirrorOutbox {
  constructor(private readonly pool: pg.Pool) {}
  async enqueue(key: string, op: OutboxOp, now: number): Promise<number> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`memory_outbox:${key}`]);
      const prev = await c.query<{ op: OutboxOp }>('select op from memory_outbox where key = $1', [key]);
      const r = await c.query<{ seq: string }>(`insert into memory_outbox (key, op, seq, attempts, next_at, created_at, last_error) values ($1, $2, nextval('memory_outbox_seq'), 0, $3, $3, null)
        on conflict (key) do update set op = excluded.op, seq = excluded.seq, attempts = 0, next_at = excluded.next_at returning seq`, [key, combineOps(prev.rows[0]?.op ?? null, op), now]);
      await c.query('commit');
      return Number(r.rows[0]!.seq);
    } catch (err) { await c.query('rollback').catch(() => undefined); throw err; } finally { c.release(); }
  }
  async due(now: number, limit: number): Promise<OutboxItem[]> {
    const r = await this.pool.query<{ key: string; op: OutboxOp; seq: string; attempts: number; next_at: string; created_at: string; last_error: string | null }>('select * from memory_outbox where next_at <= $1 order by next_at limit $2', [now, limit]);
    return r.rows.map((x) => ({ key: x.key, op: x.op, seq: Number(x.seq), attempts: x.attempts, nextAt: Number(x.next_at), createdAt: Number(x.created_at), lastError: x.last_error }));
  }
  async ack(key: string, seq: number): Promise<void> { await this.pool.query('delete from memory_outbox where key = $1 and seq = $2', [key, seq]); }
  async retry(key: string, seq: number, nextAt: number, error: string): Promise<void> {
    await this.pool.query('update memory_outbox set attempts = attempts + 1, next_at = $3, last_error = $4 where key = $1 and seq = $2', [key, seq, nextAt, error.slice(0, 500)]);
  }
  async stats(now: number): Promise<{ depth: number; oldestAgeS: number; maxAttempts: number }> {
    const r = await this.pool.query<{ depth: string; oldest: string | null; max_attempts: number | null }>('select count(*)::text as depth, min(created_at)::text as oldest, max(attempts) as max_attempts from memory_outbox');
    const x = r.rows[0]!;
    return { depth: Number(x.depth), oldestAgeS: x.oldest ? Math.max(0, Math.round((now - Number(x.oldest)) / 1000)) : 0, maxAttempts: x.max_attempts ?? 0 };
  }
}

/** Last successful backup per kind (`pg`, `memory`), written by deploy/backup/pg-backup.sh, read for the metrics. */
export interface BackupStatus { kind: string; at: number; bytes: number | null; object: string | null }
export class PgBackupStatus {
  constructor(private readonly pool: pg.Pool) {}
  async list(): Promise<BackupStatus[]> {
    const r = await this.pool.query<{ kind: string; at: Date; bytes: string | null; object: string | null }>('select kind, at, bytes, object from ops_backups order by kind');
    return r.rows.map((x) => ({ kind: x.kind, at: x.at.getTime(), bytes: x.bytes === null ? null : Number(x.bytes), object: x.object }));
  }
}

/** The month's LLM spend, persisted so a restart does not reset the cap (decision 0009: 100 EUR per month). */
export interface BudgetStore { load(month: string): Promise<number>; save(month: string, eur: number): Promise<void> }

export class FileBudgetStore implements BudgetStore {
  constructor(private readonly dir: string) {}
  private file(): string { return join(this.dir, 'llm-budget.json'); }
  async load(month: string): Promise<number> {
    try { const all = JSON.parse(await readFile(this.file(), 'utf8')) as Record<string, number>; return all[month] ?? 0; } catch { return 0; }
  }
  async save(month: string, eur: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    let all: Record<string, number> = {};
    try { all = JSON.parse(await readFile(this.file(), 'utf8')) as Record<string, number>; } catch { /* first run */ }
    all[month] = eur;
    await writeFile(this.file(), JSON.stringify(all));
  }
}

export class PgBudgetStore implements BudgetStore {
  constructor(private readonly pool: pg.Pool) {}
  static async migrate(pool: pg.Pool): Promise<void> { await pool.query('create table if not exists llm_budget (month text primary key, eur double precision not null default 0, updated_at timestamptz not null default now())'); }
  async load(month: string): Promise<number> { const r = await this.pool.query<{ eur: number }>('select eur from llm_budget where month = $1', [month]); return Number(r.rows[0]?.eur ?? 0); }
  async save(month: string, eur: number): Promise<void> { await this.pool.query('insert into llm_budget (month, eur, updated_at) values ($1, $2, now()) on conflict (month) do update set eur = greatest(llm_budget.eur, excluded.eur), updated_at = now()', [month, eur]); }
}

/** Doctrines waiting for the player's yes, one JSON file for the whole world (development). */
export class FilePendingDoctrineStore implements PendingDoctrineStore {
  constructor(private readonly dir: string) {}
  private file(): string { return join(this.dir, 'doctrine-pending.json'); }
  private async read(): Promise<Record<string, PendingDoctrine>> {
    try { return JSON.parse(await readFile(this.file(), 'utf8')) as Record<string, PendingDoctrine>; } catch { return {}; }
  }
  private async write(all: Record<string, PendingDoctrine>): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file()}.tmp`;
    await writeFile(tmp, JSON.stringify(all));
    await rename(tmp, this.file());
  }
  async loadAll(): Promise<PendingDoctrine[]> { return Object.values(await this.read()); }
  async save(p: PendingDoctrine): Promise<void> { const all = await this.read(); all[p.colonyId] = p; await this.write(all); }
  async remove(colonyId: string): Promise<void> { const all = await this.read(); if (!(colonyId in all)) return; delete all[colonyId]; await this.write(all); }
}

export class PgPendingDoctrineStore implements PendingDoctrineStore {
  constructor(private readonly pool: pg.Pool) {}
  static async migrate(pool: pg.Pool): Promise<void> { await pool.query('create table if not exists doctrine_pending (colony_id text primary key, data jsonb not null, created_at bigint not null)'); }
  async loadAll(): Promise<PendingDoctrine[]> { return (await this.pool.query<{ data: PendingDoctrine }>('select data from doctrine_pending')).rows.map((r) => r.data); }
  async save(p: PendingDoctrine): Promise<void> {
    await this.pool.query('insert into doctrine_pending (colony_id, data, created_at) values ($1, $2, $3) on conflict (colony_id) do update set data = excluded.data, created_at = excluded.created_at', [p.colonyId, JSON.stringify(p), p.createdAt]);
  }
  async remove(colonyId: string): Promise<void> { await this.pool.query('delete from doctrine_pending where colony_id = $1', [colonyId]); }
}

export { emptyMemory };
