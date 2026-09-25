import { describe, expect, it } from 'vitest';
import { PERSONAS } from '@aurane/protocol';
import { createWorld, spawnColony } from '@aurane/sim';
import { analyze } from '../src/analysis/index.js';
import { counselAck, fallbackCards, firstCards, pickOptions, writeCounsel, type CounselOption } from '../src/counsel.js';
import { writeEpisode } from '../src/episode.js';
import { LlmUnavailable, type ChatResult, type LlmClient } from '../src/llm/index.js';
import { choicesOf, emptyMemory, episodesOf, recordChoice, recordEpisode, renderMemory } from '../src/persona/memory.js';

const scripted = (answers: (string | Error)[]): LlmClient & { calls: number } => {
  const c = { calls: 0 } as { calls: number };
  return Object.assign(c, { name: 's', healthy: async () => true, chat: async (): Promise<ChatResult> => { c.calls++; const a = answers.shift() ?? '{}'; if (a instanceof Error) throw a; return { text: a, model: 'm', provider: 'p', inputTokens: 1, outputTokens: 1, ms: 1, attempts: 1 }; } });
};

function optionsOf(seed: string): { options: CounselOption[]; analysis: string; persona: 'oriel' } {
  const w = createWorld(seed, { radius: 4 });
  const c = spawnColony(w, { name: 'Nick', faction: 'guild', persona: 'oriel' });
  const a = analyze(w, c);
  return { options: a.options.map((o) => ({ ...o, show: { screen: 'galaxy' as const } })), analysis: '', persona: 'oriel' };
}

describe('the Draw Counsel', () => {
  it('serves three fixed first cards at tier 0, in every voice and language, each with a place to show', () => {
    for (const p of PERSONAS) for (const lang of ['fr', 'en'] as const) {
      const cards = firstCards(p, lang, 'S1');
      expect(cards.length).toBe(3);
      expect(cards[0]!.show).toEqual({ screen: 'galaxy', system: 'S1' });
      expect(cards[2]!.show).toEqual({ screen: 'colony' });
      expect(new Set(cards.map((c) => c.line)).size).toBe(3);
    }
  });

  it('phrases the simulation\'s options with the model, keeps ids and commands, checks figures, fills gaps with fallback cards', async () => {
    const { options, persona } = optionsOf('counsel-1');
    const ids = options.slice(0, 3).map((o) => o.id);
    const good = scripted([JSON.stringify({ cards: [{ id: ids[0], title: 'Priorité du jour', line: 'Faites ceci maintenant, le retour est net.' }, { id: ids[1], title: 'Ensuite', line: 'Puis cela : 4 731 Crédits de gain, je le jure.' }] })]);
    const r = await writeCounsel({ persona, lang: 'fr', tier: 3, options, minutesToDraw: 20 }, good);
    expect(r.source).toBe('llm');
    expect(r.cards.map((c) => c.id)).toEqual(ids);
    expect(r.cards[0]!.command).toEqual(options[0]!.command);
    expect(r.cards[0]!.show).toEqual({ screen: 'galaxy' });
    expect(r.numbersStripped).toBe(true);
    expect(r.cards[1]!.line).not.toContain('4 731');
    expect(r.cards[2]!.line.length).toBeGreaterThan(10); // fallback card for the dropped option
  });

  it('falls back in character over quota, when the class is down, or without a model; skipped cards go last', async () => {
    const { options, persona } = optionsOf('counsel-2');
    const q = await writeCounsel({ persona, lang: 'en', tier: 3, options, minutesToDraw: 20, overQuota: true }, scripted([]));
    expect(q.source).toBe('degraded'); expect(q.degradeReason).toBe('quota'); expect(q.cards.length).toBe(Math.min(3, options.length));
    const d = await writeCounsel({ persona, lang: 'en', tier: 3, options, minutesToDraw: 20 }, scripted([new LlmUnavailable('voice', 'failed', 'x')]));
    expect(d.source).toBe('degraded');
    const n = await writeCounsel({ persona, lang: 'fr', tier: 3, options, minutesToDraw: 20 }, null);
    expect(n.source).toBe('fallback');
    expect(n.cards[0]!.line).toMatch(/Recommandation chiffrée/);
    const skipped = pickOptions(options, [options[0]!.id]);
    expect(skipped[skipped.length - 1]!.id === options[0]!.id || skipped.length < options.length).toBe(true);
    expect(fallbackCards({ persona, lang: 'fr', tier: 3, options, minutesToDraw: 20 }).every((c) => c.title.length <= 60)).toBe(true);
    expect(counselAck('kestrel', 'fr', true, 1)).toMatch(/Tirage/);
  });
});

describe('memory: choices and episodes', () => {
  it('records taken and skipped cards and daily episodes, and renders them for the prompt', async () => {
    let m = recordChoice(emptyMemory(), 'counsel.taken', 'double_bridge', 1);
    m = recordChoice(m, 'counsel.skipped', 'raid', 2);
    m = recordEpisode(m, 3, 'tu as tenu Rakanyx contre un raid corsaire.', 3);
    m = recordEpisode(m, 3, 'tu as tenu Rakanyx et doublé le pont.', 4); // same day: replaced
    expect(choicesOf(m)).toEqual({ taken: ['double_bridge'], skipped: ['raid'] });
    expect(episodesOf(m)).toEqual(['J3 tu as tenu Rakanyx et doublé le pont.']);
    const w = createWorld('mem-2', { radius: 4 });
    const c = spawnColony(w, { name: 'Nick', faction: 'guild', persona: 'solen' });
    const txt = renderMemory({ betrayals: [], attackers: [], allies: [], treaties: [], victories: 0, defeats: 0, systemsLost: 0, systemsCaptured: 0, beaconsLit: 0 }, m, 'fr');
    expect(txt).toContain('a suivi double_bridge');
    expect(txt).toContain('Épisodes récents : J3');
    void c;
    const ep = await writeEpisode({ persona: 'solen', lang: 'fr', day: 3, facts: 'Absence : 6 h, 6 Tirages.\nAlerte : 1 relais coupé par Vantor.\nTu as pris double_bridge.' }, scripted(['Hier tu as tenu bon : un relais coupé par Vantor, et tu as doublé le pont, comme je le proposais.']));
    expect(ep.source).toBe('llm');
    expect((await writeEpisode({ persona: 'solen', lang: 'fr', day: 3, facts: 'Absence : 6 h.' }, null)).text).toContain('Solen');
  });
});
