// Issue #33: after "Do it" on the first relay, a card pushed out of the top three by the next tier's advice was marked
// "✓ Done" like the one really done, so the Counsel read as the same cards staying. Only a reached goal says Done.
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@aurane/sim';
import { counselKindOf, doneCards, doneThisDraw, goalReached, titleOfCard, type ShownCard } from '../src/ui/counsel.js';

type V = Pick<PlayerView, 'me' | 'systems' | 'relays'>;
const world = (over: { relays?: V['relays']; systems?: V['systems']; notes?: string } = {}): V => ({
  me: { id: 'me', policy: { expansion: 0.5, aggression: 0.2, notes: over.notes ?? '' } } as unknown as V['me'],
  systems: over.systems ?? [],
  relays: over.relays ?? [],
});
const relay = (a: string, b: string, owner = 'me'): V['relays'][number] => ({ id: `${a}|${b}`, a, b, owner, ready: true, cut: false, readyAt: 0, cutUntil: 0, bridge: false });

const tier0: ShownCard[] = [
  { id: 'touch', title: 'Touch your star', command: null },
  { id: 'link:B', title: 'Link your neighbour', command: { type: 'build_relay', a: 'A', b: 'B' } },
  { id: 'doctrine', title: 'Your doctrine', command: null },
];

describe('counsel done marks', () => {
  it('the first relay done: only the relay card says Done, the doctrine pushed out by tier 1 leaves quietly', () => {
    const now = new Set(['enter', 'link:C', 'antenna']);
    const out = doneCards(tier0, now, world({ relays: [relay('B', 'A')] }), new Set(), new Set());
    expect(out).toEqual([{ id: 'link:B', title: 'Link your neighbour', index: 1 }]);
  });

  it('a card answered on screen (Do it, or looked at) is done even before the world shows it', () => {
    const out = doneCards(tier0, new Set(['doctrine']), world(), new Set(['touch', 'link:B']), new Set());
    expect(out.map((c) => c.id)).toEqual(['touch', 'link:B']);
  });

  it('a card set aside or already marked is never marked again', () => {
    expect(doneCards(tier0, new Set(), world({ relays: [relay('A', 'B')], notes: 'defend' }), new Set(), new Set(['link:B', 'doctrine']))).toEqual([]);
  });

  it('reads the goal from the world: relay either way round and owned, building built or queued, doctrine written', () => {
    const link = tier0[1]!;
    expect(goalReached(link, world({ relays: [relay('B', 'A')] }), new Set())).toBe(true);
    expect(goalReached(link, world({ relays: [relay('A', 'B', 'other')] }), new Set())).toBe(false);
    const antenna: ShownCard = { id: 'antenna', title: 'An Antenna', command: { type: 'build', system: 'A', building: 'antenna' } };
    const sys = (buildings: string[], queue: string[]) => [{ id: 'A', buildings, buildQueue: queue.map((b) => ({ building: b, orbit: 3, readyAt: 1 })) }] as unknown as V['systems'];
    expect(goalReached(antenna, world({ systems: sys(['extractor'], []) }), new Set())).toBe(false);
    expect(goalReached(antenna, world({ systems: sys(['extractor'], ['antenna']) }), new Set())).toBe(true);
    expect(goalReached(antenna, world({ systems: sys(['antenna'], []) }), new Set())).toBe(true);
    expect(goalReached(tier0[2]!, world({ notes: '  ' }), new Set())).toBe(false);
    expect(goalReached(tier0[2]!, world({ notes: 'Expand, trade, defend.' }), new Set())).toBe(true);
    expect(goalReached(tier0[0]!, world(), new Set())).toBe(false);
  });
});

// Issue #35: the tier-1 cards take the places of the tier-0 ones, so what was done must stay said, with its target.
describe('done this Draw', () => {
  type DV = Parameters<typeof doneThisDraw>[0];
  const T = 7 * 3600 + 1200; // twenty minutes into the Draw hour
  const at = (journal: { at: number; kind: string; note?: string }[]): DV => ({
    time: T,
    me: { id: 'me', capital: 'A', journal } as unknown as DV['me'],
    systems: [{ id: 'A', name: 'Vennyxdra-84' }, { id: 'B', name: 'Arnophe' }, { id: 'C', name: 'Israzen' }] as unknown as DV['systems'],
    colonies: [{ id: 'k', name: 'Kael Vantor' }] as unknown as DV['colonies'],
  });

  it('lists what the journal says was reached since the Draw began, named, once, oldest first', () => {
    const v = at([
      { at: T - 3600, kind: 'counsel.taken', note: 'link:C' }, // the Draw before: not this one
      { at: T - 600, kind: 'counsel.taken', note: 'touch' },
      { at: T - 300, kind: 'counsel.taken', note: 'link:B' }, // the simulation's card, "Do it"
      { at: T - 300, kind: 'counsel.done', note: 'link:B' }, // the same, seen by the General
      { at: T - 200, kind: 'counsel.skipped', note: 'doctrine' }, // set aside is not done
      { at: T - 100, kind: 'counsel.done', note: 'antenna' },
    ]);
    // Said in the past: the line reads as done, not as more advice.
    expect(doneThisDraw(v, new Map(), 'fr')).toEqual([{ id: 'touch', title: 'Vu Vennyxdra-84' }, { id: 'link:B', title: 'Relié Arnophe' }, { id: 'antenna', title: 'Antenne construite à Vennyxdra-84' }]);
    expect(doneThisDraw(v, new Map(), 'en').map((d) => d.title)).toEqual(['Looked at Vennyxdra-84', 'Linked Arnophe', 'Built an Antenna at Vennyxdra-84']);
  });

  it('survives a reload (the journal alone) and adds what this screen saw reached otherwise', () => {
    const v = at([{ at: T - 10, kind: 'counsel.taken', note: 'link:B' }]);
    expect(doneThisDraw(v, new Map([['doctrine', 'Tell me your line'], ['link:B', 'x'], ['first-2', 'Link your neighbour']]), 'en')).toEqual([{ id: 'link:B', title: 'Linked Arnophe' }, { id: 'doctrine', title: 'Gave your doctrine' }]);
    expect(doneThisDraw(at([{ at: T - 3700, kind: 'counsel.done', note: 'link:B' }]), new Map(), 'en')).toEqual([]); // a new Draw starts empty
  });

  it('names the target of every kind of card from its id', () => {
    const v = at([]);
    expect(counselKindOf('link:B')).toBe('link_first');
    expect(counselKindOf('first-2')).toBeNull();
    expect(titleOfCard('link:C', v, 'fr')).toBe('Relier Israzen');
    expect(titleOfCard('turret:B', v, 'en')).toBe('Turret at Arnophe');
    expect(titleOfCard('treaty:k', v, 'fr')).toBe('Pacte avec Kael Vantor');
    expect(titleOfCard('sell:metal', v, 'fr')).toBe('Métal au Marché');
    expect(titleOfCard('recap:4', v, 'en')).toBe('Draw 5 recap');
    expect(titleOfCard('first-2', v, 'en', 'Link your neighbour')).toBe('Link your neighbour');
    expect(titleOfCard('link:C', v, 'en')).not.toBe(titleOfCard('link:B', v, 'en')); // two relay cards never read the same
    expect(titleOfCard('sell:food', v, 'en', undefined, true)).toBe('Sold Food at the Market');
    expect(titleOfCard('treaty:k', v, 'fr', undefined, true)).toBe('Pacte proposé à Kael Vantor');
  });
});
