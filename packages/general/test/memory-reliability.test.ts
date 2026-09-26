// The long memory must not lose a write: a failed mirror PUT is retried from a durable outbox, a late PUT never
// overwrites a newer record, an erasure holds even when the instance is down, concurrent writers do not undo each other,
// a periodic reconciliation repairs any drift, and a corrupt or oversized record is read safely.
import { describe, expect, it } from 'vitest';
import {
  HttpMemoryStore, InMemoryMemoryStore, InMemoryOutbox, MEMORY_CAPS, MEMORY_SCHEMA, MirroredMemoryStore, combineOps, emptyMemory, episodesOf, mergeMemory,
  normalizeMemory, recordChoice, recordEpisode, type MemoryRecord,
} from '../src/index.js';

/** A stand-in for deploy/memory/server.py with the same rules: revisions, tombstones, index. */
function fakeInstance() {
  const rows = new Map<string, { data: string; rev: number; erased: boolean }>();
  const state = { down: false, calls: [] as string[] };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET';
    state.calls.push(`${method} ${url.pathname}`);
    if (state.down) throw new Error('ECONNREFUSED');
    if (url.pathname === '/admin/index') return Response.json(Object.fromEntries([...rows].map(([k, v]) => [k, { rev: v.rev, erased: v.erased }])));
    const key = decodeURIComponent(url.pathname.split('/memory/')[1]!);
    const row = rows.get(key);
    if (method === 'GET') return row && !row.erased ? new Response(row.data, { status: 200 }) : new Response('', { status: 404 });
    if (method === 'PUT') {
      const rec = JSON.parse(String(init!.body)) as MemoryRecord;
      const rev = rec.rev ?? 0;
      if (row && rev <= row.rev && (row.erased || rev < row.rev)) return new Response('{}', { status: 409 });
      rows.set(key, { data: String(init!.body), rev, erased: false });
      return new Response('{}', { status: 200 });
    }
    const rev = Number(url.searchParams.get('rev') ?? 0);
    rows.set(key, { data: '{}', rev: Math.max(rev, row?.rev ?? 0), erased: true });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { rows, state, http: new HttpMemoryStore('http://memory:8090', 'tok', fetchFn) };
}
const remoteNotes = (inst: ReturnType<typeof fakeInstance>, key: string): string[] => (JSON.parse(inst.rows.get(key)!.data) as MemoryRecord).notes.map((n) => n.text);

describe('memory mirror: durable outbox', () => {
  it('keeps a failed write in the outbox and delivers it once the instance is back, even after a restart', async () => {
    const inst = fakeInstance();
    let now = 1_000_000;
    const outbox = new InMemoryOutbox(); // stands for the Postgres table: it outlives the store object
    const primary = new InMemoryMemoryStore();
    inst.state.down = true;
    const a = new MirroredMemoryStore(primary, inst.http, () => undefined, { outbox, now: () => now, baseDelayMs: 1000 });
    await a.update('account:A1', (m) => recordChoice(m ?? emptyMemory(), 'counsel.taken', 'buy_energy', 1));
    await a.flush();
    await a.refreshStats();
    expect(inst.rows.has('account:A1')).toBe(false);
    expect(a.stats.outboxDepth).toBe(1);
    expect(a.stats.failures).toBeGreaterThan(0);
    // The world restarts; the instance comes back.
    const b = new MirroredMemoryStore(primary, inst.http, () => undefined, { outbox, now: () => now, baseDelayMs: 1000 });
    inst.state.down = false;
    expect(await b.flush()).toBe(0); // backoff: not due yet
    now += 60_000;
    expect(await b.flush()).toBe(1);
    expect(remoteNotes(inst, 'account:A1')).toEqual(['buy_energy']);
    expect(b.stats.outboxDepth).toBe(0);
  });

  it('never lets a late PUT overwrite a newer record on the instance', async () => {
    const inst = fakeInstance();
    const s = new MirroredMemoryStore(new InMemoryMemoryStore(), inst.http);
    await s.update('k', (m) => recordChoice(m ?? emptyMemory(), 'counsel.taken', 'first', 1));
    const old = (await s.load('k'))!;
    await s.update('k', (m) => recordChoice(m!, 'counsel.taken', 'second', 2));
    await s.flush();
    expect(await inst.http.save('k', old)).toBe('stale'); // a delayed copy of the older revision arrives
    expect(remoteNotes(inst, 'k')).toEqual(['first', 'second']);
  });

  it('serialises concurrent writers on the same key: no lost update', async () => {
    const inst = fakeInstance();
    const s = new MirroredMemoryStore(new InMemoryMemoryStore(), inst.http);
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.update('k', (m) => recordChoice(m ?? emptyMemory(), 'counsel.taken', `c${i}`, i))));
    expect((await s.load('k'))!.notes).toHaveLength(20);
    await s.flush();
    expect(remoteNotes(inst, 'k')).toHaveLength(20);
  });

  it('merges instead of overwriting when the instance could not be read before the first write', async () => {
    const inst = fakeInstance();
    const past = recordEpisode(emptyMemory(), 3, 'tu as tenu Rakanyx.', 5);
    await inst.http.save('account:A1', { ...past, rev: 10 });
    inst.state.down = true;
    const s = new MirroredMemoryStore(new InMemoryMemoryStore(), inst.http, () => undefined, { baseDelayMs: 0 });
    await s.update('account:A1', (m) => recordChoice(m ?? emptyMemory(), 'counsel.skipped', 'raid', 50));
    inst.state.down = false;
    await s.flush(); // may be the flush the write kicked while the instance was down
    await s.flush();
    const merged = (await s.load('account:A1'))!;
    expect(merged.notes.map((n) => n.text)).toEqual(['J3 tu as tenu Rakanyx.', 'raid']);
    expect(remoteNotes(inst, 'account:A1')).toEqual(['J3 tu as tenu Rakanyx.', 'raid']);
  });
});

describe('memory mirror: cold reads', () => {
  it('does not ask a dead instance on every read, nor a newcomer twice in five minutes', async () => {
    const inst = fakeInstance();
    let now = 1_000_000;
    const s = new MirroredMemoryStore(new InMemoryMemoryStore(), inst.http, () => undefined, { now: () => now });
    expect(await s.load('new')).toBeNull();
    expect(await s.load('new')).toBeNull();
    expect(inst.state.calls.filter((c) => c === 'GET /memory/new')).toHaveLength(1);
    inst.state.down = true;
    for (const k of ['a', 'b', 'c', 'd', 'e']) await s.load(k);
    expect(inst.state.calls.filter((c) => c.startsWith('GET /memory/') && c !== 'GET /memory/new')).toHaveLength(3); // then the breaker
    now += 31_000; inst.state.down = false;
    await inst.http.save('d', { ...recordChoice(emptyMemory(), 'counsel.taken', 'x', 1), rev: 1 });
    expect((await s.load('d'))!.notes).toHaveLength(1);
  });
});

describe('memory mirror: erasure (LPD/RGPD)', () => {
  it('says when the instance did not confirm, retries, and a late write cannot resurrect the erased record', async () => {
    const inst = fakeInstance();
    const primary = new InMemoryMemoryStore();
    const s = new MirroredMemoryStore(primary, inst.http, () => undefined, { baseDelayMs: 0 });
    await s.update('k', (m) => recordChoice(m ?? emptyMemory(), 'counsel.taken', 'secret', 1));
    await s.flush();
    const before = (await s.load('k'))!;
    inst.state.down = true;
    expect(await s.erase('k')).toEqual({ primary: true, mirror: false, pending: true });
    expect((await primary.load('k'))!.notes).toEqual([]); // the world's copy is gone at once
    expect((await s.load('k'))!.notes).toEqual([]); // and the tombstone prevents a cold read of the old one
    inst.state.down = false;
    await s.flush();
    expect(inst.rows.get('k')!.erased).toBe(true);
    expect(await inst.http.save('k', before)).toBe('stale');
    expect(await inst.http.load('k')).toBeNull();
  });

  it('an erasure beats a queued write; a write after the erasure replaces the record', () => {
    expect(combineOps('put', 'delete')).toBe('delete');
    expect(combineOps('merge', 'delete')).toBe('delete');
    expect(combineOps('delete', 'put')).toBe('put');
    expect(combineOps('delete', 'merge')).toBe('put'); // never merge the erased copy back
    expect(combineOps('merge', 'put')).toBe('merge');
  });
});

describe('memory mirror: reconciliation', () => {
  it('pushes what the instance lacks, pulls what Postgres lost, and makes an erasure hold on both sides', async () => {
    const inst = fakeInstance();
    const primary = new InMemoryMemoryStore();
    const s = new MirroredMemoryStore(primary, inst.http, () => undefined, { baseDelayMs: 0 });
    // Missing on the instance (a write lost before the outbox existed).
    await primary.save('missing', { ...recordChoice(emptyMemory(), 'counsel.taken', 'a', 1), rev: 5 });
    // Postgres restored from an older backup: the instance is ahead.
    await primary.save('behind', { ...recordChoice(emptyMemory(), 'counsel.taken', 'old', 1), rev: 5 });
    await inst.http.save('behind', { ...recordChoice(recordChoice(emptyMemory(), 'counsel.taken', 'old', 1), 'counsel.taken', 'newer', 2), rev: 9 });
    // Erased in the world, still on the instance.
    await primary.save('erased-here', { ...emptyMemory(), rev: 7 });
    await inst.http.save('erased-here', { ...recordChoice(emptyMemory(), 'counsel.taken', 'x', 1), rev: 3 });
    // Erased on the instance after the backup Postgres came from.
    await primary.save('erased-there', { ...recordChoice(emptyMemory(), 'counsel.taken', 'y', 1), rev: 3 });
    await inst.http.erase('erased-there', 8);
    const r = await s.reconcile();
    expect(r).toMatchObject({ checked: 4, pushed: 1, pulled: 1, erased: 2, error: null });
    await s.flush();
    expect(remoteNotes(inst, 'missing')).toEqual(['a']);
    expect((await primary.load('behind'))!.notes.map((n) => n.text)).toEqual(['old', 'newer']);
    expect(inst.rows.get('erased-here')!.erased).toBe(true);
    expect((await primary.load('erased-there'))!.notes).toEqual([]);
    expect(await s.reconcile()).toMatchObject({ pushed: 0, pulled: 0, erased: 0 }); // converged
  });

  it('reports a reconciliation that could not run instead of staying silent', async () => {
    const inst = fakeInstance();
    inst.state.down = true;
    const s = new MirroredMemoryStore(new InMemoryMemoryStore(), inst.http);
    expect((await s.reconcile()).error).toContain('ECONNREFUSED');
    expect(s.stats.reconcile.error).not.toBeNull();
  });
});

describe('memory record: bounds, corruption, schema', () => {
  it('reads corrupt JSON and wrong shapes as a safe record, and stamps the schema', () => {
    expect(normalizeMemory('{not json')).toEqual(emptyMemory());
    expect(normalizeMemory([1, 2])).toEqual(emptyMemory());
    expect(normalizeMemory(null)).toBeNull();
    const m = normalizeMemory({ recentPhrases: ['a', 3], seasons: [{ seed: 's', label: 'S0', summary: { fr: 'x', en: 'y' } }, { seed: 1 }], notes: [{ at: 1, kind: 'episode', text: 'J1 x' }, { at: 'no', kind: 'x', text: 'y' }, 'junk'], rev: 12 })!;
    expect(m).toEqual({ v: MEMORY_SCHEMA, rev: 12, recentPhrases: ['a'], seasons: [{ seed: 's', label: 'S0', summary: { fr: 'x', en: 'y' } }], notes: [{ at: 1, kind: 'episode', text: 'J1 x' }] });
    expect(normalizeMemory({ notes: [{ at: 1, kind: 'note', text: 'x'.repeat(5000) }] })!.notes[0]!.text).toHaveLength(MEMORY_CAPS.text);
  });

  it('bounds each layer on its own: choices never push the fourteen days of episodes out', () => {
    let m = emptyMemory();
    for (let d = 1; d <= 20; d++) m = recordEpisode(m, d, `jour ${d}`, d);
    for (let i = 0; i < 200; i++) m = recordChoice(m, 'counsel.taken', `c${i}`, 100 + i);
    expect(episodesOf(m)).toHaveLength(MEMORY_CAPS.episodes);
    expect(episodesOf(m)[0]).toBe('J7 jour 7');
    expect(m.notes.filter((n) => n.kind === 'counsel.taken')).toHaveLength(MEMORY_CAPS.choices);
    expect(JSON.stringify(m).length).toBeLessThan(16 * 1024);
  });

  it('merges two memories of the same player without duplicates', () => {
    const a = recordChoice(emptyMemory(), 'counsel.taken', 'x', 1);
    const b = recordEpisode(recordChoice(emptyMemory(), 'counsel.taken', 'x', 1), 2, 'y', 2);
    expect(mergeMemory(a, b).notes.map((n) => n.text)).toEqual(['x', 'J2 y']);
  });
});
