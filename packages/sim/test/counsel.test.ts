// The Draw Counsel (0009): legal, priced options with a ready command and a screen to show, filtered by the
// onboarding tier, computed by the simulation alone.
import { describe, expect, it } from 'vitest';
import { apply, commandTier, counsel, createWorld, spawnColony, tick, viewFor, type Colony, type World } from '../src/index.js';

const rich = (w: World, c: Colony): void => { w.systems[c.capital]!.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 1e4 }; };

describe('the Draw Counsel', () => {
  it('opens with the first relay for a newcomer, and every card respects the tier', () => {
    const w = createWorld('counsel1', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    const cards = counsel(w, me);
    expect(cards.map((c) => c.kind)).toEqual(['touch_star', 'link_first', 'doctrine']);
    const link = cards[1]!;
    expect(link.command?.type).toBe('build_relay');
    expect(link.show.kind).toBe('link');
    for (const c of cards) if (c.command) expect(commandTier(c.command)).toBeLessThanOrEqual(me.onboarding.tier);
    // The card's command is accepted as is; the first relay opens tier 1 and the plateau card takes over.
    expect(apply(w, me.id, link.command!).ok).toBe(true);
    const after = counsel(w, me);
    expect(after.some((c) => c.kind === 'link_first' || c.kind === 'touch_star')).toBe(false);
    expect(after[0]!.kind).toBe('enter_system');
    expect(after[0]!.show).toEqual({ kind: 'plateau', system: me.capital, orbit: null });
  });

  it('puts a threat first, sells a surplus once the Market is open, and shows up in the view', () => {
    const w = createWorld('counsel2', { radius: 4, rules: { onboarding: false } });
    const me = spawnColony(w, { name: 'Me', faction: 'concordat', persona: 'vane' });
    rich(w, me);
    tick(w, 3600);
    const cards = counsel(w, me, 5);
    expect(cards.some((c) => c.kind === 'sell_surplus' && c.command?.type === 'market_order')).toBe(true);
    expect(cards.some((c) => c.kind === 'train')).toBe(true);
    const v = viewFor(w, me);
    expect(v.me.counsel.length).toBeLessThanOrEqual(3);
    expect(v.me.counsel.every((c) => c.id && c.show && c.params)).toBe(true);
  });

  it('remembers what the player took or skipped in the General\'s journal', () => {
    const w = createWorld('counsel3', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'oracles', persona: 'solen' });
    expect(apply(w, me.id, { type: 'counsel_answer', id: 'link:X', taken: true }).ok).toBe(true);
    expect(apply(w, me.id, { type: 'counsel_answer', id: 'doctrine', taken: false }).ok).toBe(true);
    expect(me.journal.slice(-2).map((j) => `${j.kind}:${j.note}`)).toEqual(['counsel.taken:link:X', 'counsel.skipped:doctrine']);
  });
});
