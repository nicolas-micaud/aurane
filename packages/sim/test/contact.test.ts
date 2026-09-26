// First contact (rule `firstContact`): the world moves before the newcomer's first Draw. Within the booked window the
// nearest NPC lights a relay towards a star the newcomer can reach too, the sectors are revealed, and the event names
// the rival. A legacy season books nothing.
import { describe, expect, it } from 'vitest';
import { LEGACY_RULES, colonyNetwork, createWorld, dist, linkOptions, rangeContext, spawnColony, stockHas, tick, viewFor, type World } from '../src/index.js';

const seeded = (seed: string, rules?: Partial<typeof LEGACY_RULES>): World => {
  const w = createWorld(seed, { radius: 4, seasonDays: 56, ...(rules ? { rules } : {}) });
  for (let i = 0; i < 4; i++) spawnColony(w, { name: `Npc${i}`, faction: 'concordat', persona: 'vane', npc: true });
  return w;
};

describe('first contact', () => {
  it('books the nearest NPC at founding and makes it light a relay towards the newcomer within the window', () => {
    const w = seeded('contact1');
    const relaysBefore = Object.keys(w.relays).length;
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    expect(me.contact).toBeDefined();
    expect(me.contact!.system).toBeNull();
    expect(me.contact!.at).toBe(w.time + 90);
    const rival = w.colonies[me.contact!.rival]!;
    expect(rival.npc).toBe(true);
    // Nothing happens before the booked moment.
    tick(w, 60);
    expect(me.contact!.system).toBeNull();
    expect(w.events.some((e) => e.kind === 'contact.first')).toBe(false);
    // Then the rival moves: a relay is lit, the event names it, the sectors are revealed, the newcomer sees the star.
    tick(w, 60);
    const ev = w.events.find((e) => e.kind === 'contact.first');
    expect(ev).toBeDefined();
    expect(ev!.actors).toEqual([me.id, rival.id]);
    const d = ev!.data as { system: string; kind: string; sectors: number; shared: boolean };
    expect(me.contact!.system).toBe(d.system);
    expect(d.kind).toBe('relay');
    expect(Object.keys(w.relays).length).toBe(relaysBefore + 1);
    const relay = Object.values(w.relays).find((r) => r.owner === rival.id && (r.a === d.system || r.b === d.system));
    expect(relay).toBeDefined();
    expect(Object.keys(w.reveals[me.id] ?? {}).length).toBeGreaterThan(0);
    const v = viewFor(w, me);
    expect(v.systems.some((s) => s.id === d.system)).toBe(true);
    expect(v.relays.some((r) => r.a === relay!.a && r.b === relay!.b)).toBe(true);
    expect(v.colonies.some((c) => c.id === rival.id)).toBe(true);
    // The contact fires once.
    tick(w, 600);
    expect(w.events.filter((e) => e.kind === 'contact.first').length).toBe(1);
  });

  it('fires on every seed and picks the rival star nearest the newcomer (capitals are placed far apart, so a shared star is rare)', () => {
    for (const seed of ['c-a', 'c-b', 'c-c', 'c-d', 'c-e', 'c-f']) {
      const w = seeded(seed);
      const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
      tick(w, 120);
      const ev = w.events.find((e) => e.kind === 'contact.first');
      expect(ev, seed).toBeDefined();
      const d = ev!.data as { system: string; from?: string; sectors: number; kind: string };
      expect(d.sectors).toBeGreaterThanOrEqual(0);
      if (d.kind !== 'relay') continue;
      // No free star reachable by the rival lies closer to the newcomer's capital than the one it chose.
      const home = w.galaxy.systems[me.capital]!;
      const rival = w.colonies[me.contact!.rival]!;
      const chosen = dist(w.galaxy.systems[d.system]!, home);
      const ctx = rangeContext(w, rival);
      for (const a of colonyNetwork(w, rival).keys()) {
        if (w.systems[a]!.owner !== rival.id || a === d.system) continue;
        for (const opt of linkOptions(w.galaxy, w.galaxy.systems[a]!, ctx)) {
          if (opt.to.id === d.system || w.systems[opt.to.id]!.owner) continue;
          if (stockHas(w.systems[a]!.stock, opt.verdict.cost) || stockHas(w.systems[rival.capital]!.stock, opt.verdict.cost)) expect(dist(opt.to, home)).toBeGreaterThanOrEqual(chosen - 1e-6);
        }
      }
    }
  });

  it('books nothing for NPCs or under legacy rules', () => {
    const w = seeded('contact2');
    for (const c of Object.values(w.colonies)) expect(c.contact).toBeUndefined();
    const legacy = seeded('contact3', LEGACY_RULES);
    const me = spawnColony(legacy, { name: 'Me', faction: 'guild', persona: 'oriel' });
    expect(me.contact).toBeUndefined();
    tick(legacy, 300);
    expect(legacy.events.some((e) => e.kind === 'contact.first')).toBe(false);
  });
});
