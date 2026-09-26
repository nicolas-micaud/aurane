// The General's memory across a season change: keyed by account once the colony has one (the returning player finds it,
// from Postgres or cold from the instance), by season otherwise (next season's namesake never reads it), erased on both
// sides on request and honestly reported when the instance does not answer; health and metrics for the alerting.
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryJobStore } from '@aurane/general';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { createHttpServer } from '../src/http.js';
import { FileMemoryStore } from '../src/llmstore.js';
import { FileStore } from '../src/store.js';

/** deploy/memory/server.py's rules in miniature: revisions, tombstones, index. */
const rows = new Map<string, { data: string; rev: number; erased: boolean }>();
let down = false;
let instance: Server; let memoryUrl = '';
beforeAll(async () => {
  instance = createServer((req, res) => {
    if (down) { req.socket.destroy(); return; }
    if (req.headers.authorization !== 'Bearer test-memory-token-0123456789') { res.writeHead(401).end(); return; }
    const url = new URL(req.url!, 'http://x');
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      if (url.pathname === '/admin/index') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Object.fromEntries([...rows].map(([k, v]) => [k, { rev: v.rev, erased: v.erased }])))); return; }
      const key = decodeURIComponent(url.pathname.slice('/memory/'.length));
      const row = rows.get(key);
      if (req.method === 'GET') { if (row && !row.erased) res.writeHead(200).end(row.data); else res.writeHead(404).end(); return; }
      if (req.method === 'PUT') {
        const rev = (JSON.parse(body) as { rev?: number }).rev ?? 0;
        if (row && rev <= row.rev && (row.erased || rev < row.rev)) { res.writeHead(409).end('{}'); return; }
        rows.set(key, { data: body, rev, erased: false }); res.writeHead(200).end('{}'); return;
      }
      rows.set(key, { data: '{}', rev: Math.max(Number(url.searchParams.get('rev') ?? 0), row?.rev ?? 0), erased: true }); res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => instance.listen(0, '127.0.0.1', () => r()));
  memoryUrl = `http://127.0.0.1:${(instance.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => instance.close(() => r())); });

async function boot(dir: string, memDir: string, seed: string) {
  const env = { SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '3', SEASON_SEED: seed, REQUIRE_INVITE: '0', ADMIN_TOKEN: 'adm', AURANE_MEMORY_URL: memoryUrl, AURANE_MEMORY_TOKEN: 'test-memory-token-0123456789', AURANE_MEMORY_FLUSH_MS: '3600000', AURANE_MEMORY_RECONCILE_MS: '3600000', AURANE_MEMORY_ALERT_OUTBOX_S: '0' };
  const engine = new Engine(loadConfig(env), new FileStore(dir), { jobStore: new MemoryJobStore(), memoryStore: new FileMemoryStore(memDir) });
  await engine.init();
  await engine.general.init();
  engine.start();
  const server = createHttpServer(engine);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const guest = async (name: string) => {
    const made = await (await fetch(`${base}/api/guest`, { method: 'POST', body: JSON.stringify({ name, faction: 'guild', persona: 'oriel' }) })).json() as { token: string; colonyId: string };
    const h = { authorization: `Bearer ${made.token}` };
    return {
      id: made.colonyId,
      take: async () => {
        const v = await (await fetch(`${base}/api/counsel?lang=fr`, { headers: h })).json() as { cards: { id: string }[] };
        const card = v.cards[0]!;
        expect((await fetch(`${base}/api/counsel/take`, { method: 'POST', headers: h, body: JSON.stringify({ id: card.id }) })).status).toBe(200);
        return card.id;
      },
      memory: async () => (await (await fetch(`${base}/api/memory`, { headers: h })).json() as { record: { notes: { kind: string; text: string }[] } }).record.notes,
      erase: async () => await (await fetch(`${base}/api/memory`, { method: 'DELETE', headers: h })).json() as { ok: boolean; mirror: boolean | null; pending: boolean },
    };
  };
  const link = async (accountId: string, colonyId: string) => {
    if (!(await engine.persistence.findAccount(accountId))) await engine.persistence.createAccount({ id: accountId, createdAt: Date.now(), lang: 'fr', email: null, emailVerifiedAt: null });
    await engine.persistence.linkColony(accountId, colonyId, Date.now());
    await engine.adoptSessions(colonyId, accountId); // what the passkey and e-mail routes do
  };
  const admin = async (path: string) => fetch(`${base}${path}`, { headers: { 'x-admin-token': 'adm' } });
  const close = async () => { await engine.stop(); await new Promise<void>((r) => server.close(() => r())); };
  return { engine, guest, link, admin, close };
}

describe('the General\'s memory across seasons', () => {
  it('follows the account, stays with a guest\'s season, and is erased on both sides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aurane-mem-'));
    const s1 = await boot(dir, dir, 'mem-1');
    const nick = await s1.guest('Nick');
    const card = await nick.take(); // written as a guest: season key
    await s1.link('Anick', nick.id); // first passkey: the memory joins the account
    const other = await s1.guest('Other');
    const otherCard = await other.take();
    await s1.engine.general.flushMemory();
    expect([...rows.keys()].sort()).toEqual(['account:Anick', `season:mem-1:${nick.id}`, `season:mem-1:${other.id}`].sort());
    expect(rows.get(`season:mem-1:${nick.id}`)!.erased).toBe(true); // moved, not copied
    expect(rows.get(`season:mem-1:${other.id}`)!.data).toContain(otherCard);
    await s1.close();

    // Next season; Postgres (here a new directory) does not know the colonies: the instance answers cold.
    const s2 = await boot(dir, await mkdtemp(join(tmpdir(), 'aurane-mem2-')), 'mem-2');
    const stranger = await s2.guest('Stranger');
    expect([nick.id, other.id]).not.toContain(stranger.id);
    expect(await stranger.memory()).toEqual([]); // nobody else's memory
    const back = await s2.guest('Nick again');
    await s2.link('Anick', back.id);
    expect((await back.memory()).some((n) => n.kind === 'counsel.taken' && n.text === card)).toBe(true);

    // The player erases while the instance is down: the world's copy goes at once, the instance's is queued and said so.
    down = true;
    expect(await back.erase()).toEqual({ ok: true, mirror: false, pending: true });
    expect(await back.memory()).toEqual([]);
    const health = await s2.admin('/api/admin/memory/health');
    expect(health.status).toBe(503);
    expect(((await health.json()) as { problems: string[] }).problems.join(' ')).toMatch(/outbox/);
    const prom = await (await s2.admin('/api/admin/llm/metrics?format=prometheus')).text();
    expect(prom).toMatch(/aurane_memory_outbox_depth [1-9]/);
    expect(prom).toMatch(/aurane_memory_mirror_failures_total [1-9]/);
    down = false;
    await s2.engine.general.flushMemory();
    await new Promise((r) => setTimeout(r, 10));
    await s2.engine.general.flushMemory();
    expect(rows.get('account:Anick')!.erased).toBe(true);
    expect((await s2.admin('/api/admin/memory/health')).status).toBe(200);
    await s2.close();
  });
});
