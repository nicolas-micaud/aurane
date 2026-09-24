import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from '@aurane/protocol';
import { createWorld, spawnColony, tick, viewFor } from '@aurane/sim';
import { compilePolicy, extractJson, heuristicPolicy, templateBriefing, writeBriefing, FailoverClient, OpenAICompatibleClient, Quota, type LlmClient } from '../src/index.js';

const ctx = { lang: 'fr' as const, current: DEFAULT_POLICY, systems: { S1: 'Thair', S2: 'Amqua' }, colonies: { C1: 'Colonie Vantor', C2: 'Colonie Draven' }, alliances: { A1: 'Compact du Nord' } };

describe('doctrine', () => {
  it('heuristic reads intent in French and English', () => {
    const fr = heuristicPolicy('Défends Thair à tout prix, vends le surplus de Vivres, garde 150 d\'énergie, ne déclenche jamais la guerre sans moi. Commerce avec Colonie Vantor, on a confiance.', ctx);
    expect(fr.policy.defendFirst).toContain('S1');
    expect(fr.policy.aggression).toBe(0);
    expect(fr.policy.sellAbove.food).toBeDefined();
    expect(fr.policy.reserves.energy).toBe(150);
    expect(fr.policy.trustedTraders).toContain('C1');
    const en = heuristicPolicy('Expand fast and raid anything weak. Never attack Colonie Draven.', { ...ctx, lang: 'en' });
    expect(en.policy.expansion).toBe(1);
    expect(en.policy.aggression).toBeGreaterThanOrEqual(0.5);
    expect(en.policy.neverAttack).toContain('C2');
    expect(en.source).toBe('heuristic');
  });

  it('uses the model when it answers valid JSON, and falls back when it does not', async () => {
    const good: LlmClient = { name: 'fake', healthy: async () => true, chat: async () => ({ text: 'Sure:\n```json\n{"expansion":0.9,"aggression":0.2,"defendFirst":["S2","BOGUS"],"notes":"Grow, guard Amqua."}\n```', model: 'm', provider: 'fake', inputTokens: 1, outputTokens: 1, ms: 1 }) };
    const r = await compilePolicy('grow and guard Amqua', ctx, good);
    expect(r.source).toBe('llm');
    expect(r.policy.expansion).toBe(0.9);
    expect(r.policy.defendFirst).toEqual(['S2']);
    const bad: LlmClient = { ...good, chat: async () => ({ text: 'I cannot help with that.', model: 'm', provider: 'fake', inputTokens: 1, outputTokens: 1, ms: 1 }) };
    const r2 = await compilePolicy('grow', ctx, bad);
    expect(r2.source).toBe('heuristic');
    expect(r2.warnings.length).toBeGreaterThan(0);
    const down: LlmClient = { ...good, chat: async () => { throw new Error('ECONNREFUSED'); } };
    expect((await compilePolicy('grow', ctx, down)).source).toBe('heuristic');
  });

  it('extracts JSON from fenced or chatty answers', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go {"a":{"b":2}} thanks')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('nope')).toThrow();
  });
});

describe('briefing', () => {
  it('writes a deterministic template briefing and prefers the model when it works', async () => {
    const w = createWorld('brief', { radius: 4 });
    const c = spawnColony(w, { name: 'Nick', faction: 'guild', persona: 'oriel' });
    tick(w, 3 * 3600);
    const view = viewFor(w, c);
    const input = { view, events: w.events, awaySeconds: 3 * 3600, persona: 'oriel' as const, lang: 'fr' as const, names: { [c.id]: c.name } };
    const text = templateBriefing(input);
    expect(text).toContain('3 Tirages');
    expect(text).toContain('Oriel.');
    expect(templateBriefing({ ...input, lang: 'en' })).toContain('3 Draws');
    const fake: LlmClient = { name: 'fake', healthy: async () => true, chat: async () => ({ text: 'Les comptes sont bons, capitaine. Trois Tirages, rien à signaler, un peu d\'Énergie à acheter. Les comptes sont justes. Oriel.', model: 'm', provider: 'fake', inputTokens: 1, outputTokens: 1, ms: 1 }) };
    const r = await writeBriefing(input, fake);
    expect(r.source).toBe('llm');
    const r2 = await writeBriefing(input, { ...fake, chat: async () => { throw new Error('down'); } });
    expect(r2.source).toBe('template');
  });
});

describe('failover and quota', () => {
  it('falls back when the primary fails and cools it down', async () => {
    let primaryCalls = 0;
    const primary = new OpenAICompatibleClient({ name: 'p', baseUrl: 'http://127.0.0.1:9', model: 'x', concurrency: 1, timeoutMs: 500 });
    (primary as unknown as { chat: LlmClient['chat'] }).chat = async () => { primaryCalls++; throw new Error('down'); };
    const fallback: LlmClient = { name: 'f', healthy: async () => true, chat: async () => ({ text: 'ok', model: 'f', provider: 'f', inputTokens: 0, outputTokens: 0, ms: 0 }) };
    const fo = new FailoverClient(primary, fallback, { cooldownMs: 60000 });
    expect((await fo.chat([{ role: 'user', content: 'hi' }])).provider).toBe('f');
    expect((await fo.chat([{ role: 'user', content: 'hi' }])).provider).toBe('f');
    expect(primaryCalls).toBe(1); // second call skipped the cooling primary
  });
  it('quotas reset per day and cap calls', () => {
    const q = new Quota({ writes: 2, events: 1 });
    expect(q.take('c', 'writes')).toBe(true);
    expect(q.take('c', 'writes')).toBe(true);
    expect(q.take('c', 'writes')).toBe(false);
    expect(q.remaining('c').events).toBe(1);
  });
});
