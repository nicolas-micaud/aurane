// The briefing that remembers (decision 0009, Grok's reading of 26.09.2026): the report names the player's last
// decision and what followed, and the General refuses a doctrine that would sink the colony, in character.
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from '@aurane/protocol';
import { createWorld, spawnColony, tick, viewFor } from '@aurane/sim';
import { compileDoctrine, converse, describeChoice, emptyMemory, heuristicConverse, heuristicPolicy, lastChoice, recordChoice, templateBriefing, writeBriefing, type Facts, type LlmClient } from '../src/index.js';

const ctx = { lang: 'fr' as const, current: DEFAULT_POLICY, systems: { S1: 'Thair', S2: 'Amqua' }, colonies: { C1: 'Colonie Vantor', C2: 'Colonie Draven' }, alliances: { A1: 'Compact du Nord' }, allies: ['C1'], persona: 'vane' as const };
const noFacts: Facts = { betrayals: [], attackers: [], allies: [], treaties: [], victories: 0, defeats: 0, systemsLost: 0, systemsCaptured: 0, beaconsLit: 0 };

describe('choices in words', () => {
  it('describes a Counsel card id in both languages and finds the last decision', () => {
    const name = (id: string): string => ({ S9: 'Irzen', C3: 'Corvan' })[id] ?? id;
    expect(describeChoice('link:S9', 'fr', name)).toBe('relier Irzen');
    expect(describeChoice('link:S9', 'en', name)).toBe('link Irzen');
    expect(describeChoice('sell:metal', 'fr')).toBe('vendre le surplus de Métal');
    expect(describeChoice('treaty:C3', 'en', name)).toBe('a pact with Corvan');
    expect(describeChoice('recap:3', 'fr')).toContain('Tirage 3');
    expect(describeChoice('mystery', 'fr')).toBe('mystery');
    let m = emptyMemory();
    expect(lastChoice(m)).toBeNull();
    m = recordChoice(m, 'counsel.taken', 'buy_energy', 1);
    m = recordChoice(m, 'counsel.skipped', 'link:S9', 2);
    expect(lastChoice(m)).toEqual({ kind: 'counsel.skipped', id: 'link:S9', at: 2 });
  });
});

describe('the briefing that remembers', () => {
  it('names the last decision, what followed, and the name it does not forget; the model keeps that sentence', async () => {
    const w = createWorld('remember', { radius: 4 });
    const c = spawnColony(w, { name: 'Nick', faction: 'concordat', persona: 'vane' });
    tick(w, 2 * 3600);
    const view = viewFor(w, c);
    const star = view.systems.find((s) => s.id !== c.capital)!;
    const record = recordChoice(emptyMemory(), 'counsel.skipped', `link:${star.id}`, Date.now());
    const facts: Facts = { ...noFacts, attackers: [{ who: 'Corvan', times: 3 }] };
    const input = { view, events: w.events, awaySeconds: 2 * 3600, persona: 'vane' as const, lang: 'fr' as const, names: { [c.id]: c.name }, record, facts };
    const fr = templateBriefing(input);
    expect(fr).toContain(`Tu avais écarté « relier ${star.name} »`);
    expect(fr).toContain('Je garde Corvan à l\'œil : 3 attaques en 72 h.');
    const en = templateBriefing({ ...input, lang: 'en' });
    expect(en).toContain(`You had set aside "link ${star.name}"`);
    expect(en).toContain('I keep an eye on Corvan: 3 attacks in 72 h.');
    // A decision taken, and a betrayal: the other two sentences.
    const taken = templateBriefing({ ...input, record: recordChoice(emptyMemory(), 'counsel.taken', 'buy_energy', 1), facts: { ...noFacts, betrayals: [{ who: 'Vantor', what: 'relay.cut', hoursAgo: 5 }] } });
    expect(taken).toContain('Tu m\'avais dit oui pour « acheter de l\'Énergie »');
    expect(taken).toContain('Je n\'oublie pas : Vantor a rompu un traité il y a 5 h.');
    // Without memory nor facts, the report says nothing it does not know.
    const bare = templateBriefing({ ...input, record: undefined, facts: undefined });
    expect(bare).not.toMatch(/écarté|oublie|à l'œil/);
    // The model is asked to keep the memory sentence; its figures (3 attacks, 72 h) are allowed since the report holds them.
    let prompt = '';
    const fake: LlmClient = { name: 'fake', healthy: async () => true, chat: async (msgs) => { prompt = msgs[0]!.content; return { text: `Deux heures dehors. Tu avais dit non pour ${star.name} ; je n'y suis pas revenu. Corvan rôde encore : 3 attaques en 72 h, je le garde à l'œil. Achète de l'Énergie. Rien ne passe.`, model: 'm', provider: 'fake', inputTokens: 1, outputTokens: 1, ms: 1, attempts: 1 }; } };
    const r = await writeBriefing(input, fake);
    expect(r.source).toBe('llm');
    expect(r.numbersStripped).toBeFalsy();
    expect(r.text).toContain('3 attaques en 72 h');
    expect(prompt).toContain('keep that sentence');
  });
});

describe('a doctrine the General refuses', () => {
  it('refuses to sell everything, to starve the relays, to abandon the capital or to strike a treaty partner, and says why', () => {
    const sell = heuristicPolicy('Vends tout le métal, on a besoin de Crédits.', ctx);
    expect(sell.refused).toBe(true);
    expect(sell.question).toBeNull();
    expect(sell.policy).toBe(ctx.current);
    expect(sell.reply).toMatch(/^Non\. Vendre tout le Métal \? Et tu construis avec quoi \?/);
    const energy = heuristicPolicy('Never buy energy again, it is a waste.', { ...ctx, lang: 'en', persona: 'oriel' });
    expect(energy.refused).toBe(true);
    expect(energy.reply).toMatch(/^I must decline\. No more Energy\?/);
    expect(heuristicPolicy('Vends toute l\'énergie', ctx).reply).toContain('les relais s\'éteignent');
    const capital = heuristicPolicy('Abandonne la capitale et défends Amqua.', { ...ctx, persona: 'kestrel' });
    expect(capital.refused).toBe(true);
    expect(capital.reply).toMatch(/^Là, non\. Abandonner la capitale \?/);
    const ally = heuristicPolicy('Raid Colonie Vantor tonight, they are weak.', { ...ctx, lang: 'en', persona: 'solen' });
    expect(ally.refused).toBe(true);
    expect(ally.reply).toContain('Attack Colonie Vantor? We hold a treaty with them.');
    // Not refused: a floor, a surplus, a treaty broken in the open, a non-ally.
    expect(heuristicPolicy('Vends tout le surplus de métal au-dessus de 200.', ctx).refused).toBe(false);
    expect(heuristicPolicy('Romps le traité avec Colonie Vantor et attaque-les.', ctx).refused).toBe(false);
    expect(heuristicPolicy('Raid Colonie Draven tonight.', { ...ctx, lang: 'en' }).refused).toBe(false);
    expect(heuristicPolicy('Vends le surplus de Vivres.', ctx).refused).toBe(false);
  });

  it('refuses before any model call, in the doctrine screen and in the conversation', async () => {
    let calls = 0;
    const eager: LlmClient = { name: 'fake', healthy: async () => true, chat: async () => { calls++; return { text: JSON.stringify({ orders: { sellAbove: { metal: 0 } }, reply: 'Fait.', question: null }), model: 'm', provider: 'fake', inputTokens: 1, outputTokens: 1, ms: 1, attempts: 1 }; } };
    const d = await compileDoctrine('Vends tout le métal.', ctx, eager);
    expect(d.refused).toBe(true);
    expect(d.policy).toBe(ctx.current);
    expect(calls).toBe(0);
    const talk = await converse({ text: 'Vends tout le métal.', lang: 'fr', persona: 'vane', history: [], ctx }, eager);
    expect(talk.refused).toBe(true);
    expect(talk.policy).toBeNull();
    expect(talk.reply).toContain('Et tu construis avec quoi ?');
    expect(calls).toBe(0);
    // Offline, the refusal wins over the rules FAQ that "vends" would otherwise trigger.
    const offline = heuristicConverse({ text: 'Vends tout le métal.', lang: 'fr', persona: 'vane', history: [], ctx });
    expect(offline.refused).toBe(true);
    expect(offline.reply).not.toContain('teneur de marché');
  });
});
