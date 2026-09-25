// The Generals' service in the world process: live requests go through the job queue with a deadline,
// doctrines wait for a confirmation when asked to, briefings are cached until something happens, and the
// metrics are readable behind the admin token. A scripted voice pool stands for the providers.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LlmMetrics, MemoryJobStore, type ChatMessage, type ChatOptions, type ChatResult, type LlmClient, type LlmStack } from '@aurane/general';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { createHttpServer } from '../src/http.js';
import { FileStore } from '../src/store.js';

function scripted(answers: (() => string | Promise<string>)[]): LlmClient & { calls: { messages: ChatMessage[]; opts: ChatOptions }[] } {
  const calls: { messages: ChatMessage[]; opts: ChatOptions }[] = [];
  return {
    name: 'voice:scripted', calls, healthy: async () => true,
    chat: async (messages, opts = {}): Promise<ChatResult> => { calls.push({ messages, opts }); const a = answers.shift(); const text = a ? await a() : '{}'; return { text, model: 'm', provider: 'scripted', inputTokens: 100, outputTokens: 20, ms: 5, attempts: 1 }; },
  };
}

let engine: Engine; let base: string; let token: string; let colonyId: string; let server: ReturnType<typeof createHttpServer>;
const voice = scripted([]);
const stack: LlmStack = { voice: voice as unknown as LlmStack['voice'], narrative: null, warnings: [], forClass(c) { return c === 'voice' ? this.voice : this.narrative; } };
const metrics = new LlmMetrics();

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aurane-general-'));
  const cfg = loadConfig({ SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '3', SEASON_SEED: 'general-test', TIME_SCALE: '1', ADMIN_TOKEN: 'adm', DOCTRINE_CONFIRM: '1', LLM_TALK_DEADLINE_MS: '600', LLM_BRIEFING_DEADLINE_MS: '600', LLM_QUOTA_TALK_HOUR: '3' });
  engine = new Engine(cfg, new FileStore(dir), { stack, metrics, jobStore: new MemoryJobStore() });
  await engine.init();
  engine.start();
  server = createHttpServer(engine);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const made = await (await fetch(`${base}/api/guest`, { method: 'POST', body: JSON.stringify({ name: 'Nick', faction: 'guild', persona: 'oriel' }) })).json() as { token: string; colonyId: string };
  token = made.token; colonyId = made.colonyId;
});
afterAll(async () => { await engine.stop(); await new Promise<void>((r) => server.close(() => r())); });

const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const post = async (path: string, body: unknown): Promise<Response> => fetch(`${base}${path}`, { method: 'POST', headers: auth(), body: JSON.stringify(body) });

describe('the Generals behind the queue', () => {
  it('answers a live message through the queue, applies no order without confirmation, exposes the pending doctrine', async () => {
    voice.calls.length = 0;
    (voice as unknown as { chat: LlmClient['chat'] }).chat = scripted([() => JSON.stringify({ reply: 'Compris, associé : expansion à 90 %.', orders: { expansion: 0.9 }, question: null })]).chat;
    const r = await (await post('/api/talk', { text: 'Étends-toi vite.', lang: 'fr' })).json() as { reply: string; source: string; policyChanged: boolean; pending: { id: string; readable: string[] } | null; history: unknown[] };
    expect(r.source).toBe('llm');
    expect(r.policyChanged).toBe(false);
    expect(r.pending?.readable.join('\n')).toContain('Expansion : 90 %');
    expect(engine.world.colonies[colonyId]!.policy.expansion).not.toBe(0.9);
    const pending = await (await fetch(`${base}/api/doctrine/pending`, { headers: auth() })).json() as { id: string };
    expect(pending.id).toBe(r.pending!.id);
    const bad = await post('/api/doctrine/confirm', { id: 'nope' });
    expect(bad.status).toBe(404);
    const ok = await (await post('/api/doctrine/confirm', { id: pending.id })).json() as { ok: boolean };
    expect(ok.ok).toBe(true);
    expect(engine.world.colonies[colonyId]!.policy.expansion).toBe(0.9);
    expect(r.history.length).toBe(2);
  });

  it('answers in character when the model misses the deadline, and the job still completes', async () => {
    let release: (() => void) | null = null;
    (voice as unknown as { chat: LlmClient['chat'] }).chat = scripted([async () => { await new Promise<void>((r) => { release = r; }); return JSON.stringify({ reply: 'late', orders: null, question: null }); }]).chat;
    const started = Date.now();
    const r = await (await post('/api/talk', { text: 'Tu es là ?', lang: 'fr' })).json() as { reply: string; source: string };
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.source).toBe('degraded');
    expect(r.reply).toMatch(/Tirage|Signal|heure|ligne/);
    release!();
    await new Promise((r) => setTimeout(r, 50));
    const snap = await (await fetch(`${base}/api/admin/llm/metrics`, { headers: { 'x-admin-token': 'adm' } })).json() as { jobs: { done: number }; llm: { degradations: { reason: string }[] } };
    expect(snap.jobs.done).toBeGreaterThanOrEqual(2);
    expect(snap.llm.degradations.some((d) => d.reason === 'deadline')).toBe(true);
    const prom = await (await fetch(`${base}/api/admin/llm/metrics?format=prometheus`, { headers: { 'x-admin-token': 'adm' } })).text();
    expect(prom).toContain('aurane_llm_degradations_total');
    expect((await fetch(`${base}/api/admin/llm/metrics`)).status).toBe(401);
  });

  it('enforces the hourly talk quota with an in-character line, no model call', async () => {
    (voice as unknown as { chat: LlmClient['chat'] }).chat = scripted([() => JSON.stringify({ reply: 'Oui.', orders: null, question: null }), () => JSON.stringify({ reply: 'Oui.', orders: null, question: null })]).chat;
    const a = await (await post('/api/talk', { text: 'Encore ?', lang: 'fr' })).json() as { source: string };
    expect(a.source).toBe('llm'); // third of the hour
    const b = await (await post('/api/talk', { text: 'Et encore ?', lang: 'fr' })).json() as { source: string; reply: string };
    expect(b.source).toBe('degraded');
    expect(b.reply).toMatch(/Tirage/);
  });

  it('serves the briefing at once and caches it until a new event concerns the colony', async () => {
    (voice as unknown as { chat: LlmClient['chat'] }).chat = scripted([() => 'Bonjour. Rien à signaler, les comptes sont justes. Trois lignes suffisent ce matin. Les comptes sont justes. Oriel.']).chat;
    const first = await (await fetch(`${base}/api/briefing?lang=fr`, { headers: auth() })).json() as { text: string; source: string; awaySeconds: number };
    expect(['template', 'llm']).toContain(first.source); // fresh colony: under 30 min away, the template answers
    const again = await (await fetch(`${base}/api/briefing?lang=fr`, { headers: auth() })).json() as { text: string; source: string };
    expect(again.text).toBe(first.text); // cached: nothing happened in between
  });
});
