import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { createHttpServer } from '../src/http.js';
import { FileStore } from '../src/store.js';

let engine: Engine;
let base: string;
let dir: string;
let server: ReturnType<typeof createHttpServer>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aurane-'));
  const cfg = loadConfig({ SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '6', SEASON_SEED: 'server-test', TIME_SCALE: '3600' });
  engine = new Engine(cfg, new FileStore(dir));
  await engine.init();
  server = createHttpServer(engine);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await engine.stop();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('world server', () => {
  it('serves health and the public summary without auth', async () => {
    expect((await (await fetch(`${base}/healthz`)).json()).ok).toBe(true);
    const summary = await (await fetch(`${base}/api/public/summary`)).json() as { colonies: unknown[] };
    expect(summary.colonies).toHaveLength(6);
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });

  it('creates a guest, returns a fogged view and accepts commands', async () => {
    const res = await fetch(`${base}/api/guest`, { method: 'POST', body: JSON.stringify({ name: 'Nick', faction: 'guild', persona: 'oriel' }) });
    expect(res.status).toBe(201);
    const { token, colonyId } = await res.json() as { token: string; colonyId: string };
    const me = await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json() as { me: { id: string }; systems: { id: string; owner: string | null }[] };
    expect(me.me.id).toBe(colonyId);
    expect(me.systems.some((s) => s.owner === colonyId)).toBe(true);

    const bad = await fetch(`${base}/api/cmd`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'nope' }) });
    expect(bad.status).toBe(400);
    const ok = await (await fetch(`${base}/api/cmd`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'set_watch', startHour: 22 }) })).json() as { ok: boolean };
    expect(ok.ok).toBe(true);
    expect(engine.world.colonies[colonyId]!.watchStartHour).toBe(22);

    // Reject a bad token
    expect((await fetch(`${base}/api/me`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('streams views over WebSocket and answers commands', async () => {
    const { token } = await (await fetch(`${base}/api/guest`, { method: 'POST', body: JSON.stringify({ name: 'Ada', faction: 'oracles', persona: 'solen' }) })).json() as { token: string };
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
    const messages: { type: string; result?: { ok: boolean }; view?: { me: { name: string } } }[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ id: '1', command: { type: 'set_watch', startHour: 5 } })));
      ws.on('message', (raw) => {
        messages.push(JSON.parse(raw.toString()));
        if (messages.some((m) => m.type === 'result')) resolve();
      });
      ws.on('error', reject);
    });
    ws.close();
    expect(messages[0]?.type).toBe('view');
    expect(messages[0]?.view?.me.name).toBe('Ada');
    expect(messages.find((m) => m.type === 'result')?.result?.ok).toBe(true);
  });

  it('advances time, runs NPC Generals and persists a snapshot that restores', async () => {
    const before = engine.world.time;
    await engine.step();
    await new Promise((r) => setTimeout(r, 1100));
    await engine.step();
    expect(engine.world.time).toBeGreaterThan(before);
    await engine.snapshot();
    const cfg = loadConfig({ SNAPSHOT_DIR: 'unused', GALAXY_RADIUS: '4', NPC_COUNT: '6', SEASON_SEED: 'server-test' });
    const again = new Engine(cfg, new FileStore(dir));
    await again.init();
    expect(Object.keys(again.world.colonies).length).toBe(Object.keys(engine.world.colonies).length);
  });
});
