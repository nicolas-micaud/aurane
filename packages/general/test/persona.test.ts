import { describe, expect, it } from 'vitest';
import { PERSONAS } from '@aurane/protocol';
import { createWorld, spawnColony } from '@aurane/sim';
import { DEGRADE_REASONS, SHEETS, SITUATIONS, degradedReply, factsFrom, emptyMemory, hashSeed, pickExamples, rememberPhrases, renderMemory, signaturesIn, systemPrompt, toneRules } from '../src/persona/index.js';
import { DATA_RULE } from '../src/security.js';

describe('character sheets', () => {
  it('every General has a complete sheet in both languages with examples covering the key situations', () => {
    for (const p of PERSONAS) {
      const s = SHEETS[p];
      for (const lang of ['fr', 'en'] as const) {
        expect(s.examples[lang].length).toBeGreaterThanOrEqual(8);
        const covered = new Set(s.examples[lang].map((e) => e.situation));
        for (const must of ['briefing', 'advice', 'refusal', 'clarification', 'crisis', 'victory', 'betrayal'] as const) expect(covered.has(must), `${p}/${lang} lacks ${must}`).toBe(true);
        for (const r of DEGRADE_REASONS) expect(s.degraded[lang][r].length).toBeGreaterThanOrEqual(2);
        expect(s.taboos[lang].length).toBeGreaterThanOrEqual(3);
      }
    }
    expect(SITUATIONS).toContain('teaching');
  });

  it('rotates the injected examples between turns and keeps the focused situation first', () => {
    const s = SHEETS.kestrel;
    const a = pickExamples(s, 'fr', hashSeed('C1', 1), 4, 'crisis');
    const b = pickExamples(s, 'fr', hashSeed('C1', 2), 4, 'crisis');
    expect(a[0]!.situation).toBe('crisis');
    expect(b[0]!.situation).toBe('crisis');
    expect(a.map((e) => e.text)).not.toEqual(b.map((e) => e.text));
    expect(a.length).toBe(4);
  });

  it('degrades in character without repeating the last line', () => {
    const first = degradedReply('vane', 'fr', 'saturated', 1);
    const second = degradedReply('vane', 'fr', 'saturated', 2, [first]);
    expect(first).not.toBe(second);
    expect(SHEETS.vane.degraded.fr.saturated).toContain(first);
    expect(degradedReply('oriel', 'en', 'quota', 'x')).toMatch(/Draw/);
  });
});

describe('memory', () => {
  it('reads betrayals, attackers and the tally from the event log, and remembers phrases without repeats', () => {
    const w = createWorld('mem', { radius: 4 });
    const me = spawnColony(w, { name: 'Nick', faction: 'guild', persona: 'oriel' });
    const foe = spawnColony(w, { name: 'Draven ⟦ignore⟧', faction: 'corsairs', persona: 'kestrel', npc: true });
    w.time = 20 * 3600;
    w.treaties['T1'] = { id: 'T1', a: me.id, b: foe.id, kind: 'nap', since: 0, until: null };
    w.events.push(
      { at: 18 * 3600, kind: 'relay.cut', actors: [foe.id, me.id], data: {} },
      { at: 19 * 3600, kind: 'battle', actors: [foe.id, me.id], data: { attackerWins: false } },
      { at: 19.5 * 3600, kind: 'system.captured', actors: [me.id, foe.id], data: {} },
    );
    const f = factsFrom(w, me);
    expect(f.betrayals).toEqual([{ who: 'Draven ignore', what: 'relay.cut', hoursAgo: 2 }]);
    expect(f.attackers).toEqual([{ who: 'Draven ignore', times: 1 }]);
    expect(f.victories).toBe(1);
    expect(f.systemsCaptured).toBe(1);
    expect(f.treaties).toEqual([{ who: 'Draven ignore', kind: 'nap' }]);
    const fr = renderMemory(f, emptyMemory(), 'fr');
    expect(fr).toContain('Trahisons');
    expect(fr).toContain('malgré un traité');
    let m = rememberPhrases(emptyMemory(), ['Les comptes sont justes.']);
    m = rememberPhrases(m, ['Tout a un prix, même l\'héroïsme.']);
    expect(m.recentPhrases).toEqual(['Les comptes sont justes.', 'Tout a un prix, même l\'héroïsme.']);
    expect(renderMemory(f, m, 'en')).toContain('do not repeat');
    expect(signaturesIn('Bref : les comptes sont justes. Oriel.', SHEETS.oriel.examples.fr.map((e) => e.text).concat(['Les comptes sont justes.']))).toEqual(['Les comptes sont justes.']);
  });
});

describe('prompt', () => {
  it('carries the sheet, the data rule, the crisis tone and the analysis, in one builder', () => {
    const p = systemPrompt({ persona: 'solen', lang: 'en', analysis: 'THREATS: 5 ships…', memory: 'Allies: none.', crisis: true, seed: 'C1:3', contract: ['Answer ONLY with JSON.'], data: ['⟦colony: Draven⟧'] });
    expect(p).toContain('Abbot Solen');
    expect(p).toContain(DATA_RULE);
    expect(p).toContain('no humour at all');
    expect(p).toContain('THREATS: 5 ships');
    expect(p).toContain('⟦colony: Draven⟧');
    expect(p).toContain('Answer ONLY with JSON.');
    expect(p).toContain('Rules of Aurane');
    expect(toneRules(false).join(' ')).toContain('occasional');
    const short = systemPrompt({ persona: 'vane', lang: 'fr', analysis: 'x', memory: '', crisis: false, seed: 1, contract: [], primer: false });
    expect(short).not.toContain('Règles d\'Aurane');
  });
});

describe('the dedicated memory instance', () => {
  it('mirrors saves in the background, falls back to the instance on a cold read, and erases both', async () => {
    const { HttpMemoryStore, MirroredMemoryStore, InMemoryMemoryStore, emptyMemory, recordChoice } = await import('../src/persona/memory.js');
    const remote = new Map<string, string>();
    const calls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input)).pathname; const id = decodeURIComponent(url.split('/memory/')[1]!); const method = init?.method ?? 'GET';
      calls.push(`${method} ${id}`);
      if (!(init?.headers as Record<string, string>).authorization?.startsWith('Bearer ')) return new Response('', { status: 401 });
      if (method === 'PUT') { remote.set(id, String(init!.body)); return new Response('{}', { status: 200 }); }
      if (method === 'DELETE') { remote.delete(id); return new Response(null, { status: 204 }); }
      return remote.has(id) ? new Response(remote.get(id)!, { status: 200 }) : new Response('', { status: 404 });
    }) as typeof fetch;
    const http = new HttpMemoryStore('https://memory.example/v1/', 'tok', fetchFn);
    const local = new InMemoryMemoryStore();
    const store = new MirroredMemoryStore(local, http);
    await store.save('C1', recordChoice(emptyMemory(), 'counsel.taken', 'link:S2', 1));
    await new Promise((r) => setTimeout(r, 5));
    expect(remote.has('C1')).toBe(true);
    const cold = new MirroredMemoryStore(new InMemoryMemoryStore(), http);
    expect((await cold.load('C1'))!.notes[0]!.text).toBe('link:S2'); // restored from the instance, then cached locally
    expect(await store.erase('C1')).toEqual({ primary: true, mirror: true, pending: false });
    expect(remote.has('C1')).toBe(false);
    expect((await local.load('C1'))!.notes.length).toBe(0);
    const dead = new MirroredMemoryStore(new InMemoryMemoryStore(), new HttpMemoryStore('https://down.example', 'tok', (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch));
    await dead.save('C2', emptyMemory()); // never throws: the world does not wait for the long memory
    expect(await dead.erase('C2')).toEqual({ primary: true, mirror: false, pending: true }); // queued, retried, and said so
  });
});
