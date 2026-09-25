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
    const ok = await (await fetch(`${base}/api/cmd`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'onboarding_unlock' }) })).json() as { ok: boolean };
    expect(ok.ok).toBe(true);
    expect(engine.world.colonies[colonyId]!.onboarding.tier).toBe(6);

    // Doctrine compiles without an LLM (heuristic) and the briefing always answers.
    const doc = await (await fetch(`${base}/api/doctrine`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ text: 'Défends la capitale, ne déclenche jamais la guerre sans moi.', lang: 'fr' }) })).json() as { source: string; policy: { aggression: number; defendFirst: string[] } };
    expect(doc.source).toBe('heuristic');
    expect(doc.policy.aggression).toBe(0);
    expect((doc as { reply: string }).reply.length).toBeGreaterThan(10); // the General always answers, in its voice
    // Small talk is not an order: the General says so instead of staying silent.
    const chat = await (await fetch(`${base}/api/talk`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ text: 'Fais-moi rire.', lang: 'fr' }) })).json() as { reply: string; policyChanged: boolean; history: unknown[] };
    expect(chat.policyChanged).toBe(false);
    expect(chat.reply.length).toBeGreaterThan(20);
    expect(chat.history).toHaveLength(2);
    const hist = await (await fetch(`${base}/api/talk`, { headers: { authorization: `Bearer ${token}` } })).json() as { history: unknown[] };
    expect(hist.history).toHaveLength(2);
    expect(doc.policy.defendFirst).toContain(engine.world.colonies[colonyId]!.capital);
    const brief = await (await fetch(`${base}/api/briefing?lang=en`, { headers: { authorization: `Bearer ${token}` } })).json() as { text: string; source: string };
    expect(brief.source).toBe('template');
    expect(brief.text).toContain('Oriel.');

    // Reject a bad token
    expect((await fetch(`${base}/api/me`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('serves the System view and battle reports to the owner only', async () => {
    const { token, colonyId } = await (await fetch(`${base}/api/guest`, { method: 'POST', body: JSON.stringify({ name: 'Sys', faction: 'concordat', persona: 'vane' }) })).json() as { token: string; colonyId: string };
    const capital = engine.world.colonies[colonyId]!.capital;
    const v = await (await fetch(`${base}/api/system/${encodeURIComponent(capital)}`, { headers: { authorization: `Bearer ${token}` } })).json() as { mine: boolean; station: { hp: number } | null; structures: unknown[]; stock: unknown };
    expect(v.mine).toBe(true);
    expect(v.station?.hp).toBe(300);
    expect(v.structures.length).toBeGreaterThan(0);
    expect((await fetch(`${base}/api/system/nope`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    expect((await fetch(`${base}/api/system/${encodeURIComponent(capital)}`)).status).toBe(401);
    expect(await (await fetch(`${base}/api/battles`, { headers: { authorization: `Bearer ${token}` } })).json()).toEqual([]);
    expect((await fetch(`${base}/api/battle/X1`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it('streams a watched plateau over WebSocket at 2 Hz and stops on unwatch', async () => {
    const { token, colonyId } = await (await fetch(`${base}/api/guest`, { method: 'POST', body: JSON.stringify({ name: 'Watch', faction: 'guild', persona: 'oriel' }) })).json() as { token: string; colonyId: string };
    const capital = engine.world.colonies[colonyId]!.capital;
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
    const frames: { type: string; view?: { id: string; time: number }; error?: string }[] = [];
    const systemFrames = (n: number): Promise<void> => new Promise((resolve) => {
      const check = (): void => { if (frames.filter((f) => f.type === 'system').length >= n) { ws.off('message', onMsg); resolve(); } };
      const onMsg = (): void => check();
      ws.on('message', onMsg);
      check();
    });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
      ws.on('error', reject);
    });
    ws.send(JSON.stringify({ watch: capital }));
    await systemFrames(1);
    // The engine is not started in tests: advance it by hand and run one stream tick.
    await engine.step();
    engine.streamSystems();
    await systemFrames(2);
    const sys = frames.filter((f) => f.type === 'system');
    expect(sys[0]!.view!.id).toBe(capital);
    expect(sys[1]!.view!.time).toBeGreaterThan(sys[0]!.view!.time); // the sim moved between frames
    ws.send(JSON.stringify({ watch: 'nope' }));
    await new Promise<void>((resolve) => ws.on('message', (raw) => { if ((JSON.parse(raw.toString()) as { type: string }).type === 'error') resolve(); }));
    ws.send(JSON.stringify({ watch: null }));
    await new Promise((r) => setTimeout(r, 100));
    const before = frames.filter((f) => f.type === 'system').length;
    await engine.step();
    engine.streamSystems();
    await new Promise((r) => setTimeout(r, 100));
    expect(frames.filter((f) => f.type === 'system').length).toBe(before);
    ws.close();
  });

  it('streams views over WebSocket and answers commands', async () => {
    const { token } = await (await fetch(`${base}/api/guest`, { method: 'POST', body: JSON.stringify({ name: 'Ada', faction: 'oracles', persona: 'solen' }) })).json() as { token: string };
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
    const messages: { type: string; result?: { ok: boolean }; view?: { me: { name: string } } }[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ id: '1', command: { type: 'onboarding_unlock' } })));
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

  it('serves the public gazette and colony pages', async () => {
    // Fast-forward two days so day 1 has an issue.
    const { tick } = await import('@aurane/sim');
    tick(engine.world, 86400 + 3600, 300);
    const issue = await (await fetch(`${base}/api/public/gazette?lang=fr`)).json() as { day: number; title: string; sections: unknown[] };
    expect(issue.day).toBe(1);
    expect(issue.title).toContain('jour 1');
    expect(issue.sections.length).toBeGreaterThanOrEqual(3);
    const page = await (await fetch(`${base}/gazette?lang=en`)).text();
    expect(page).toContain('<title>Aurane Gazette');
    const id = Object.keys(engine.world.colonies)[0]!;
    const colony = await (await fetch(`${base}/c/${id}`)).text();
    expect(colony).toContain(engine.world.colonies[id]!.name);
    expect((await fetch(`${base}/c/nope`)).status).toBe(404);
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

describe('closed beta', () => {
  let eng: Engine; let srv: ReturnType<typeof createHttpServer>; let url: string;
  beforeAll(async () => {
    const d = await mkdtemp(join(tmpdir(), 'aurane-beta-'));
    const cfg = loadConfig({ SNAPSHOT_DIR: d, GALAXY_RADIUS: '4', NPC_COUNT: '3', SEASON_SEED: 'beta-test', REQUIRE_INVITE: '1', INVITE_CODES: 'aur-friend1', ADMIN_TOKEN: 'adm', AUTH_SECRET: 'secret', PUBLIC_ORIGIN: 'https://example.test' });
    eng = new Engine(cfg, new FileStore(d));
    await eng.init();
    srv = createHttpServer(eng);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await eng.stop(); await new Promise<void>((r) => srv.close(() => r())); });

  it('requires an invitation, accepts each code once, and the admin mints more', async () => {
    expect((await (await fetch(`${url}/api/public/config`)).json() as { requireInvite: boolean }).requireInvite).toBe(true);
    const body = { name: 'Nick', faction: 'guild', persona: 'oriel' };
    expect((await fetch(`${url}/api/guest`, { method: 'POST', body: JSON.stringify(body) })).status).toBe(403);
    expect((await fetch(`${url}/api/guest`, { method: 'POST', body: JSON.stringify({ ...body, invite: 'AUR-NOPE' }) })).status).toBe(403);
    const ok = await fetch(`${url}/api/guest`, { method: 'POST', body: JSON.stringify({ ...body, invite: 'AUR-FRIEND1' }) });
    expect(ok.status).toBe(201);
    expect((await fetch(`${url}/api/guest`, { method: 'POST', body: JSON.stringify({ ...body, name: 'Again', invite: 'aur-friend1' }) })).status).toBe(403);
    expect((await fetch(`${url}/api/admin/invites`, { method: 'POST', body: JSON.stringify({ count: 2, note: 'wave 1' }) })).status).toBe(401);
    const minted = await (await fetch(`${url}/api/admin/invites`, { method: 'POST', headers: { 'x-admin-token': 'adm' }, body: JSON.stringify({ count: 2, note: 'wave 1' }) })).json() as { codes: string[] };
    expect(minted.codes).toHaveLength(2);
    expect(minted.codes[0]).toMatch(/^AUR-[A-Z2-9]{8}$/);
    expect((await fetch(`${url}/api/guest`, { method: 'POST', body: JSON.stringify({ ...body, name: 'Friend', invite: minted.codes[0] }) })).status).toBe(201);
    const list = await (await fetch(`${url}/api/admin/invites`, { headers: { 'x-admin-token': 'adm' } })).json() as { invites: { code: string; usedBy: string | null }[] };
    expect(list.invites.filter((i) => i.usedBy).length).toBe(2);
  });

  it('a device link opens the same colony with a fresh token', async () => {
    const minted = await (await fetch(`${url}/api/admin/invites`, { method: 'POST', headers: { 'x-admin-token': 'adm' }, body: JSON.stringify({ count: 1 }) })).json() as { codes: string[] };
    const { token, colonyId } = await (await fetch(`${url}/api/guest`, { method: 'POST', body: JSON.stringify({ name: 'Linker', faction: 'oracles', persona: 'solen', invite: minted.codes[0] }) })).json() as { token: string; colonyId: string };
    const link = await (await fetch(`${url}/api/link`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).json() as { code: string; url: string };
    expect(link.url.startsWith('https://example.test/#join=')).toBe(true);
    const second = await (await fetch(`${url}/api/redeem`, { method: 'POST', body: JSON.stringify({ code: link.code }) })).json() as { token: string; colonyId: string };
    expect(second.colonyId).toBe(colonyId);
    expect(second.token).not.toBe(token);
    const me = await (await fetch(`${url}/api/me`, { headers: { authorization: `Bearer ${second.token}` } })).json() as { me: { id: string } };
    expect(me.me.id).toBe(colonyId);
    expect((await fetch(`${url}/api/redeem`, { method: 'POST', body: JSON.stringify({ code: `${link.code}x` }) })).status).toBe(403);
  });
});
