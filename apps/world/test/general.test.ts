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
  const cfg = loadConfig({ SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '3', SEASON_SEED: 'general-test', TIME_SCALE: '1', ADMIN_TOKEN: 'adm', DOCTRINE_CONFIRM: '1', LLM_TALK_DEADLINE_MS: '600', LLM_BRIEFING_DEADLINE_MS: '600', LLM_QUOTA_TALK_HOUR: '3', LLM_EPISODE_SPREAD_MIN: '0' });
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

  it('says its first word on a new onboarding screen, in the player\'s language, without a model', async () => {
    const before = engine.history(colonyId).length;
    engine.world.events.push({ at: engine.world.time, kind: 'onboarding.unlocked', actors: [colonyId], data: { tier: 2 } });
    await engine.step();
    const h = engine.history(colonyId);
    expect(h.length).toBe(before + 1);
    expect(h.at(-1)!.who).toBe('general');
    expect(h.at(-1)!.text).toMatch(/Marché/);
  });

  it('serves the Draw Counsel as cards, runs a taken card, remembers the choice, and lets the player read and erase the memory', async () => {
    (voice as unknown as { chat: LlmClient['chat'] }).chat = scripted([() => JSON.stringify({ cards: [{ id: 'nope', title: 'x', line: 'y' }] })]).chat;
    const v = await (await fetch(`${base}/api/counsel?lang=fr`, { headers: auth() })).json() as { cards: { id: string; title: string; line: string; command: unknown }[]; source: string; drawIndex: number };
    expect(v.cards.length).toBeGreaterThanOrEqual(1);
    expect(v.cards.length).toBeLessThanOrEqual(3);
    expect(['llm', 'fallback', 'degraded']).toContain(v.source);
    const card = v.cards[0]!;
    const bad = await post('/api/counsel/skip', { id: 'ghost' });
    expect(bad.status).toBe(404);
    const took = await (await post('/api/counsel/take', { id: card.id })).json() as { ok: boolean; reply: string };
    expect(took.ok).toBe(true);
    expect(took.reply).toMatch(/Tirage|Draw/);
    const again = await (await fetch(`${base}/api/counsel?lang=fr`, { headers: auth() })).json() as { cards: { id: string }[] };
    expect(again.cards.some((c) => c.id === card.id)).toBe(false); // a taken card leaves the counsel
    const mem = await (await fetch(`${base}/api/memory`, { headers: auth() })).json() as { record: { notes: { kind: string; text: string }[] }; rendered: string };
    expect(mem.record.notes.some((n) => n.kind === 'counsel.taken' && n.text === card.id)).toBe(true);
    expect(mem.rendered).toContain('a suivi');
    expect(engine.history(colonyId).at(-1)!.text).toBe(took.reply);
    const erased = await (await fetch(`${base}/api/memory`, { method: 'DELETE', headers: auth() })).json() as { ok: boolean; mirror: boolean | null };
    expect(erased.ok).toBe(true);
    expect(erased.mirror).toBeNull(); // no long-memory instance configured in this test
    const after = await (await fetch(`${base}/api/memory`, { headers: auth() })).json() as { record: { notes: unknown[] } };
    expect(after.record.notes.length).toBe(0);
  });

  it('queues one counsel per recently seen colony twenty minutes before the Draw, and an episode per active colony when the day turns', async () => {
    const before = await engine.general.scheduler.counts();
    engine.world.time = 3600 * 5 - 15 * 60; // T−15 min before Draw 5
    engine.world.colonies[colonyId]!.lastSeenAt = engine.world.time - 600;
    engine.general.scheduleCounsel();
    engine.general.scheduleCounsel(); // idempotent for the same Draw
    await new Promise((r) => setTimeout(r, 30));
    const mid = await engine.general.scheduler.counts();
    expect(mid.queued + mid.running + mid.done - (before.queued + before.running + before.done)).toBe(1);
    (voice as unknown as { chat: LlmClient['chat'] }).chat = scripted([() => 'Tu as tenu ton étoile et relié ta voisine : une bonne première journée.']).chat;
    engine.world.time = 86400 + 10;
    engine.general.scheduleEpisodes(1);
    for (let i = 0; i < 40 && !(await engine.general.exportMemory(colonyId))!.record.notes.some((n) => n.kind === 'episode'); i++) await new Promise((r) => setTimeout(r, 100));
    const mem = await engine.general.exportMemory(colonyId);
    expect(mem!.record.notes.some((n) => n.kind === 'episode' && n.text.startsWith('J1 '))).toBe(true);
  });

  it('degrades every task in character once the month\'s budget is reached, and reports the spend', async () => {
    metrics.budget = { eurPerMonth: 0.001, alertRatio: 0.8 };
    metrics.price('scripted', { inPerM: 1000, outPerM: 1000 }); // 100 tokens → 0.1 EUR: the cap is passed on the first call
    (voice as unknown as { chat: LlmClient['chat'] }).chat = scripted([() => JSON.stringify({ reply: 'Oui.', orders: null, question: null }), () => JSON.stringify({ reply: 'Encore.', orders: null, question: null })]).chat;
    engine.world.time += 3600 * 24; // a new quota day for the colony
    const first = await (await post('/api/talk', { text: 'Un mot ?', lang: 'fr' })).json() as { source: string };
    void first; // may or may not reach the model depending on the quota state; the spend is what matters
    metrics.record({ cls: 'voice', provider: 'scripted', task: 'talk', ok: true, ms: 1, inputTokens: 100, outputTokens: 100 });
    expect(metrics.overBudget()).toBe(true);
    const capped = await (await post('/api/talk', { text: 'Et là ?', lang: 'fr' })).json() as { source: string; reply: string };
    expect(capped.source).toBe('degraded');
    expect(capped.reply.length).toBeGreaterThan(10);
    const snap = await (await fetch(`${base}/api/admin/llm/metrics`, { headers: { 'x-admin-token': 'adm' } })).json() as { llm: { spend: { overBudget: boolean; ratio: number }; degradations: { reason: string }[] } };
    expect(snap.llm.spend.overBudget).toBe(true);
    expect(snap.llm.degradations.some((d) => d.reason === 'budget')).toBe(true);
    metrics.budget = null;
  });

  it('rewrites the counsel when the onboarding tier changes within the same Draw', async () => {
    const before = await (await fetch(`${base}/api/counsel?lang=fr`, { headers: auth() })).json() as { tier: number; writtenAt: number };
    const col = engine.world.colonies[colonyId] as unknown as { onboarding: { tier: number } };
    col.onboarding.tier = Math.min(6, before.tier + 1);
    const after = await (await fetch(`${base}/api/counsel?lang=fr`, { headers: auth() })).json() as { tier: number };
    expect(after.tier).toBe(col.onboarding.tier);
    const same = await (await fetch(`${base}/api/counsel?lang=fr`, { headers: auth() })).json() as { tier: number };
    expect(same.tier).toBe(after.tier); // cached until the next Draw or the next tier
  });
});
