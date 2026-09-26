import { describe, expect, it } from 'vitest';
import { PERSONAS } from '@aurane/protocol';
import { createWorld, spawnColony } from '@aurane/sim';
import { analyze } from '../src/analysis/index.js';
import { cardTitle, counselAck, fallbackCards, firstCards, liveCounselCards, pickOptions, sameGoal, writeCounsel, type CounselOption } from '../src/counsel.js';
import { fromSimCounsel } from '../src/counsel-sim.js';
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

describe('the simulation\'s Counsel, bridged', () => {
  it('turns sim options into costed options with the client\'s fixed lines filled, a show target and the raw show kept', async () => {
    const { showOf, fillLine } = await import('../src/counsel-sim.js');
    const opts = fromSimCounsel([
      { id: 'turret:S9', kind: 'turret', urgency: 2, command: { type: 'build', system: 'S9', building: 'turret_light' }, show: { kind: 'plateau', system: 'S9', orbit: 2 }, cost: { metal: 40, energy: 20 }, params: { system: 'Kessa', ships: 5, eta: 30 } },
      { id: 'link:S2', kind: 'link_first', urgency: 2, command: null, show: { kind: 'link', from: 'S1', to: 'S2' }, cost: { metal: 41, energy: 20 }, params: { from: 'Isno', to: 'Orun', metal: 41, energy: 20 } },
      { id: 'recap:3', kind: 'read_recap', urgency: 0, command: null, show: { kind: 'tab', tab: 'log' }, cost: {}, params: { draw: 4 } },
      { id: 'weird', kind: 'something_new', urgency: 1, command: null, show: { kind: 'tab', tab: 'general' }, cost: {}, params: {} },
    ]);
    expect(opts[0]!.label.fr).toBe('5 vaisseaux ennemis sur Kessa, arrivée dans 30 min. Une tourelle légère sur l\'orbite Défense, maintenant.');
    expect(opts[0]!.label.en).toContain('5 enemy ships on Kessa');
    expect(opts[0]!.show).toEqual({ screen: 'system', system: 'S9', slot: '2' });
    expect(opts[0]!.raw).toEqual({ kind: 'plateau', system: 'S9', orbit: 2 });
    expect(opts[0]!.risk).toBe('mid');
    expect(opts[1]!.label.fr).toContain('Relie Orun depuis Isno : 41 Métal, 20 Énergie');
    expect(opts[1]!.show).toEqual({ screen: 'galaxy', system: 'S1' });
    expect(opts[2]!.show).toEqual({ screen: 'journal' });
    expect(opts[3]!.label.en).toContain('Tell me what you want'); // unknown kind: the doctrine line, never a crash
    expect(opts[3]!.gain.en).toBe('one more step for the Colony');
    const first = fromSimCounsel([{ id: 'touch', kind: 'touch_star', urgency: 2, command: null, show: { kind: 'star', system: 'S1' }, cost: {}, params: { system: 'Isno' } }]);
    expect(first[0]!.label.fr).toContain('Isno, ta capitale');
    expect(first[0]!.title?.fr).toBe('Toucher Isno');
    expect(showOf({ kind: 'star', system: 'S1' })).toEqual({ screen: 'galaxy', system: 'S1' });
    expect(fillLine('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    const r = await writeCounsel({ persona: 'vane', lang: 'fr', tier: 1, options: opts, minutesToDraw: 20 }, null);
    expect(r.cards.map((c) => c.id)).toEqual(['turret:S9', 'link:S2', 'recap:3']);
    expect(r.cards[0]!.raw).toEqual({ kind: 'plateau', system: 'S9', orbit: 2 });
    expect(r.cards[0]!.line).toContain('30 min');
    expect(r.cards[1]!.title).toBe('Relier Orun'); // the simulation's short title, naming its target, not the first words of the line
    expect(r.cards[2]!.line).not.toMatch(/\.\./); // no double period after a label that already ends with one
    expect(r.cards[2]!.line).not.toContain("heure.. ");
    const long = fallbackCards({ persona: 'vane', lang: 'fr', tier: 1, minutesToDraw: 20, options: [{ id: 'l', label: { fr: 'x'.repeat(130), en: 'y'.repeat(130) }, cost: {}, delayMin: 0, gain: { fr: 'GAIN', en: 'GAIN' }, risk: 'low', command: null }] });
    expect(long[0]!.line).not.toContain('GAIN'); // a long label stands alone on a phone
  });
});

describe('card titles name their target (issue #35)', () => {
  const relay = (b: string) => ({ type: 'build_relay' as const, a: 'S1', b });
  const option = (id: string, command: CounselOption['command'], title?: { fr: string; en: string }): CounselOption => ({ id, label: { fr: `Ligne ${id}`, en: `Line ${id}` }, ...(title ? { title } : {}), cost: {}, delayMin: 0, gain: { fr: 'g', en: 'g' }, risk: 'low', command });

  it('keeps the simulation\'s title on a card with a command and the model\'s voice in the line', async () => {
    const options = fromSimCounsel([
      { id: 'link:S3', kind: 'link_more', urgency: 1, command: relay('S3'), show: { kind: 'link', from: 'S1', to: 'S3' }, cost: { metal: 12 }, params: { from: 'Vennyxdra-84', to: 'Israzen', metal: 12, energy: 6 } },
      { id: 'doctrine', kind: 'doctrine', urgency: 0, command: null, show: { kind: 'tab', tab: 'general' }, cost: {}, params: {} },
    ]);
    const llm = scripted([JSON.stringify({ cards: [{ id: 'link:S3', title: 'Link your neighbour', line: 'Israzen next: the Network grows by one.' }, { id: 'doctrine', title: 'Tell me your line', line: 'One sentence and I run with it.' }] })]);
    const r = await writeCounsel({ persona: 'oriel', lang: 'en', tier: 1, options, minutesToDraw: 20 }, llm);
    expect(r.source).toBe('llm');
    expect(r.cards[0]).toMatchObject({ title: 'Link Israzen', line: 'Israzen next: the Network grows by one.' });
    expect(r.cards[1]!.title).toBe('Tell me your line'); // no command: the model titles it
  });

  it('never gives two relay cards the same title', () => {
    const a = fromSimCounsel([{ id: 'link:S2', kind: 'link_first', urgency: 2, command: relay('S2'), show: { kind: 'link', from: 'S1', to: 'S2' }, cost: {}, params: { from: 'V', to: 'Arnophe', metal: 12, energy: 6 } }])[0]!;
    const b = fromSimCounsel([{ id: 'link:S3', kind: 'link_more', urgency: 1, command: relay('S3'), show: { kind: 'link', from: 'S1', to: 'S3' }, cost: {}, params: { from: 'V', to: 'Israzen', metal: 12 } }])[0]!;
    expect([a.title?.fr, b.title?.fr]).toEqual(['Relier Arnophe', 'Relier Israzen']);
    expect(cardTitle(a, 'Relie ta voisine', 'fr')).toBe('Relier Arnophe');
    expect(cardTitle(option('x', null, { fr: 'Relier Arnophe', en: 'Link Arnophe' }), 'Plus tard', 'fr')).toBe('Plus tard');
  });

  it('takes the target\'s title when a cached card gets a command', () => {
    const live = liveCounselCards([{ id: 'link:S3', title: 'Link your neighbour', line: 'v', command: null, show: null }], [option('link:S3', relay('S3'), { fr: 'Relier Israzen', en: 'Link Israzen' })], { persona: 'vane', lang: 'en', tier: 1 });
    expect(live[0]!.title).toBe('Link Israzen');
  });
});

describe('a cached Counsel against the world as it stands', () => {
  const opt = (id: string, command: CounselOption['command']): CounselOption => ({ id, label: { fr: `Ligne ${id}`, en: `Line ${id}` }, cost: {}, delayMin: 0, gain: { fr: 'g', en: 'g' }, risk: 'low', command, show: { screen: 'galaxy' } });
  const relay = { type: 'build_relay' as const, a: 'S1', b: 'S2' };
  const cards = [
    { id: 'link:S2', title: 'Link Belis', line: 'Voice line', command: relay, show: null },
    { id: 'enter', title: 'Enter', line: 'Voice line', command: null, show: null },
    { id: 'antenna', title: 'Antenna', line: 'Voice line 40', command: { type: 'build' as const, system: 'S1', building: 'antenna' as const }, show: null },
  ];
  const ctx = { persona: 'oriel' as const, lang: 'en' as const, tier: 1 };

  it('drops a card whose option is gone (done through any path, or no longer on the table) and keeps the voice of the others', () => {
    const live = liveCounselCards(cards, [opt('enter', null), opt('antenna', cards[2]!.command), opt('link:S7', { type: 'build_relay', a: 'S2', b: 'S7' })], ctx);
    expect(live.map((c) => c.id)).toEqual(['enter', 'antenna']);
    expect(live[1]!.line).toBe('Voice line 40');
  });

  it('keeps the id and title of a card whose command changed, with the live command and the fixed line', () => {
    const live = liveCounselCards(cards, [opt('link:S2', null)], ctx);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: 'link:S2', title: 'Link Belis', line: 'Line link:S2', command: null });
  });

  it('lets the first-minute cards stand only at tier 0 with nothing else to propose', () => {
    const first = firstCards('oriel', 'en', 'S1');
    expect(liveCounselCards(first, [], { ...ctx, tier: 0 })).toHaveLength(3);
    expect(liveCounselCards(first, [], ctx)).toHaveLength(0);
    expect(liveCounselCards(first, [opt('touch', null)], { ...ctx, tier: 0 })).toHaveLength(0);
  });

  it('knows two commands reach the same goal whichever path the player took', () => {
    expect(sameGoal(relay, { type: 'build_relay', a: 'S2', b: 'S1' })).toBe(true);
    expect(sameGoal(relay, { type: 'build_relay', a: 'S1', b: 'S3' })).toBe(false);
    expect(sameGoal({ type: 'build', system: 'S1', building: 'antenna' }, { type: 'build', system: 'S1', building: 'antenna', orbit: 3 } as never)).toBe(true);
    expect(sameGoal({ type: 'train', system: 'S1', unit: 'corvette', count: 2 }, { type: 'train', system: 'S1', unit: 'corvette', count: 1 })).toBe(true);
  });
});
