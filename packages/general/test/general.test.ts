import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from '@aurane/protocol';
import { createWorld, spawnColony, tick, viewFor } from '@aurane/sim';
import { compilePolicy, dayFacts, extractJson, heuristicPolicy, templateBriefing, templateGazette, writeBriefing, FailoverClient, OpenAICompatibleClient, Quota, type LlmClient } from '../src/index.js';
import { converse, situationSummary } from '../src/converse.js';

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

describe('gazette', () => {
  it('writes a siege column from battles, blockades and dark stations', () => {
    const w = createWorld('gz', { radius: 4 });
    const a = spawnColony(w, { name: 'Aster', faction: 'corsairs', persona: 'kestrel' });
    const b = spawnColony(w, { name: 'Boreal', faction: 'concordat', persona: 'vane' });
    w.time = 90000; // day 2
    const sys = b.capital;
    w.events.push(
      { at: 87000, kind: 'battle', actors: [b.id, a.id], data: { system: sys, battle: 'X1', seconds: 420, kills: 9 } },
      { at: 87500, kind: 'blockade.start', actors: [a.id, b.id], data: { system: sys } },
      { at: 88000, kind: 'relay.cut', actors: [a.id, b.id], data: { system: sys } },
      { at: 88100, kind: 'convoy.lost', actors: [b.id, a.id], data: { system: sys, cargos: 1 } },
    );
    const fr = templateGazette(dayFacts(w, 2), 'fr', w.time);
    const siege = fr.sections.find((s) => s.heading === 'Les sièges')!;
    expect(siege.body).toContain('7 minutes de feu, 9 coques perdues');
    expect(siege.body).toContain('Aster tient le plateau');
    expect(siege.body).toContain('1 convoi perdu');
    const en = templateGazette(dayFacts(w, 2), 'en', w.time);
    expect(en.sections.find((s) => s.heading === 'The sieges')!.body).toContain('fell silent');
    const quiet = templateGazette(dayFacts(w, 1), 'fr', w.time);
    expect(quiet.sections.some((s) => s.heading === 'Les sièges')).toBe(false);
  });
});

describe('conversation', () => {
  const view = { me: { id: 'C1', name: 'Nick', faction: 'guild', persona: 'kestrel', capital: 'S1', marketSystem: 'S1', stock: { metal: 100, energy: 80, food: 50, crystal: 10, rium: 60 }, credits: 300, influence: 20, watchStartHour: 0, watching: false, shielded: true, score: 1, connectedCount: 1, alliance: null, policy: DEFAULT_POLICY, regions: [], lastProduced: { metal: 4, energy: 3, food: 3, crystal: 1, rium: 0 }, lastOverflow: { metal: 0, energy: 0, food: 0, crystal: 0, rium: 0 }, routeLimit: 3 }, systems: [{ id: 'S1', name: 'Isno', owner: 'C1', connected: true, resource: 'metal', engaged: false, blockadedBy: null }], fleets: [], colonies: [], barters: [], draw: null, time: 0, nextDrawAt: 3600, seasonEndsAt: 7 * 86400 } as unknown as import('@aurane/sim').PlayerView;
  const ctx = { lang: 'fr' as const, current: DEFAULT_POLICY, systems: { S1: 'Isno' }, colonies: {}, alliances: {}, persona: 'kestrel' as const };
  it('answers a joke request in character without touching the policy', async () => {
    const r = await converse({ text: 'Fais-moi rire', lang: 'fr', persona: 'kestrel', history: [], view, ctx }, null);
    expect(r.source).toBe('heuristic');
    expect(r.policy).toBeNull();
    expect(r.reply.length).toBeGreaterThan(20);
  });
  it('explains a rule when asked, in the persona voice', async () => {
    const r = await converse({ text: 'C\'est quoi le Rium ?', lang: 'fr', persona: 'oriel', history: [], view, ctx: { ...ctx, persona: 'oriel' } }, null);
    expect(r.reply).toMatch(/Rium/);
    expect(r.reply).toMatch(/Oriel/);
    expect(r.policy).toBeNull();
  });
  it('turns an order into a policy change and says so', async () => {
    const r = await converse({ text: 'Ne déclenche jamais la guerre sans moi et défends la capitale.', lang: 'fr', persona: 'vane', history: [], view, ctx: { ...ctx, persona: 'vane' } }, null);
    expect(r.policy?.aggression).toBe(0);
    expect(r.reply).toMatch(/Compris|Doctrine/);
  });
  it('summarises the situation with the real numbers', () => {
    const s = situationSummary(view, 'en', {});
    expect(s).toMatch(/Metal 100/);
    expect(s).toMatch(/Newcomer shield/);
  });
});
