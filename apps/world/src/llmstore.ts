// Persistence of the LLM layer, beside the world's own store: the job queue (so a briefing or a Gazette
// survives a restart) and the Generals' memory (recent phrases, past seasons). Postgres in production,
// JSON files in development, memory in tests. Nothing here touches the world snapshot.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { MemoryJobStore, emptyMemory, type Job, type JobState, type JobStore, type MemoryRecord, type MemoryStore } from '@aurane/general';

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
  protected override async flush(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, 'llm-jobs.json.tmp');
    await writeFile(tmp, JSON.stringify([...this.jobs.values()]));
    await rename(tmp, join(this.dir, 'llm-jobs.json'));
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
  async load(colonyId: string): Promise<MemoryRecord | null> { await this.ensure(); const m = this.map.get(colonyId); return m ? structuredClone(m) : null; }
  async save(colonyId: string, m: MemoryRecord): Promise<void> {
    await this.ensure();
    this.map.set(colonyId, structuredClone(m));
    const tmp = join(this.dir, 'general-memory.json.tmp');
    await writeFile(tmp, JSON.stringify(Object.fromEntries(this.map)));
    await rename(tmp, join(this.dir, 'general-memory.json'));
  }
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

export class PgMemoryStore implements MemoryStore {
  constructor(private readonly pool: pg.Pool) {}
  async load(colonyId: string): Promise<MemoryRecord | null> {
    const r = await this.pool.query<{ data: MemoryRecord }>('select data from general_memory where colony_id = $1', [colonyId]);
    return r.rows[0]?.data ?? null;
  }
  async save(colonyId: string, m: MemoryRecord): Promise<void> {
    await this.pool.query('insert into general_memory (colony_id, data, updated_at) values ($1, $2, now()) on conflict (colony_id) do update set data = excluded.data, updated_at = now()', [colonyId, JSON.stringify(m)]);
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

export { emptyMemory };
