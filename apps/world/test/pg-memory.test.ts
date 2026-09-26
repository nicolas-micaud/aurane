// The Postgres side of the memory, against a real server when AURANE_TEST_PG_URL is set (skipped otherwise):
// row-locked read-modify-write, index with revisions and tombstones, corrupt rows read safely, durable outbox.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyMemory, recordChoice } from '@aurane/general';
import { PgBackupStatus, PgJobStore, PgMemoryStore, PgMirrorOutbox } from '../src/llmstore.js';

const url = process.env.AURANE_TEST_PG_URL;
const d = url ? describe : describe.skip;

d('Postgres memory store', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    await pool.query('drop table if exists general_memory, memory_outbox, ops_backups, llm_jobs; drop sequence if exists memory_outbox_seq');
    await PgJobStore.migrate(pool);
  });
  afterAll(async () => { await pool.end(); });

  it('does not lose concurrent updates of the same record', async () => {
    const s = new PgMemoryStore(pool);
    await Promise.all(Array.from({ length: 25 }, (_, i) => s.update('account:A', (m) => recordChoice(m ?? emptyMemory(), 'counsel.taken', `c${i}`, i))));
    expect((await s.load('account:A'))!.notes).toHaveLength(25);
  });

  it('indexes revisions and tombstones, and reads a corrupt row as a safe record', async () => {
    const s = new PgMemoryStore(pool);
    await s.save('t', { ...emptyMemory(), rev: 42 });
    await pool.query(`insert into general_memory (colony_id, data) values ('bad', '"just a string"'), ('bad2', '{"notes": 3, "rev": "x"}')`);
    const idx = new Map((await s.index()).map((e) => [e.key, e]));
    expect(idx.get('t')).toEqual({ key: 't', rev: 42, empty: true });
    expect(idx.get('account:A')!.empty).toBe(false);
    expect(idx.get('bad2')).toEqual({ key: 'bad2', rev: 0, empty: true });
    expect(await s.load('bad')).toEqual(emptyMemory());
    expect(await s.load('bad2')).toEqual(emptyMemory());
  });

  it('keeps the outbox across connections: coalesced per key, acked only for the current sequence', async () => {
    const o = new PgMirrorOutbox(pool);
    const s1 = await o.enqueue('k', 'merge', 1000);
    const s2 = await o.enqueue('k', 'put', 2000);
    expect(s2).toBeGreaterThan(s1);
    let due = await o.due(5000, 10);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ key: 'k', op: 'merge', createdAt: 1000 }); // merge survives a later put
    await o.ack('k', s1); // stale ack: ignored
    await o.retry('k', s2, 9000, 'down');
    expect(await o.due(5000, 10)).toHaveLength(0);
    expect(await o.stats(11000)).toEqual({ depth: 1, oldestAgeS: 10, maxAttempts: 1 });
    await o.enqueue('k', 'delete', 12000);
    due = await o.due(12000, 10);
    expect(due[0]!.op).toBe('delete');
    await o.ack('k', due[0]!.seq);
    expect((await o.stats(13000)).depth).toBe(0);
  });

  it('reads the last successful backups written by the backup script', async () => {
    await pool.query(`insert into ops_backups (kind, at, bytes, object) values ('pg', now() - interval '2 hours', 123, 's3://b/pg/x.dump') on conflict (kind) do update set at = excluded.at`);
    const b = await new PgBackupStatus(pool).list();
    expect(b[0]).toMatchObject({ kind: 'pg', bytes: 123 });
    expect(Date.now() - b[0]!.at).toBeGreaterThan(7000 * 1000);
  });
});
