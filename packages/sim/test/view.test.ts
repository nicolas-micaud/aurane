import { describe, expect, it } from 'vitest';
import { createWorld, spawnColony, tick, viewFor, snapshotWorld, restoreWorld, apply, productiveSystems } from '../src/index.js';

describe('player view and snapshots', () => {
  it('hides what the colony cannot see and survives a snapshot round-trip', () => {
    const w = createWorld('view', { radius: 5, rules: { onboarding: false } });
    const a = spawnColony(w, { name: 'A', faction: 'guild', persona: 'oriel' });
    const b = spawnColony(w, { name: 'B', faction: 'corsairs', persona: 'kestrel' });
    tick(w, 3600);
    const va = viewFor(w, a);
    expect(va.me.id).toBe(a.id);
    expect(va.systems.some((s) => s.id === a.capital)).toBe(true);
    expect(va.systems.some((s) => s.id === b.capital)).toBe(false); // far away, fogged
    expect(va.colonies.find((c) => c.id === b.id)?.name).toBe('B'); // roster is public
    expect(va.sectors.length).toBeGreaterThan(0);

    const snap = snapshotWorld(w, { radius: 5 });
    const w2 = restoreWorld(JSON.parse(JSON.stringify(snap)));
    expect(Object.keys(w2.galaxy.systems).length).toBe(Object.keys(w.galaxy.systems).length);
    tick(w, 3600); tick(w2, 3600);
    expect(JSON.stringify(w2.colonies)).toBe(JSON.stringify(w.colonies));
    expect(apply(w2, a.id, { type: 'set_watch', startHour: 3 }).ok).toBe(true);
    expect(productiveSystems(w2, w2.colonies[a.id]!).length).toBeGreaterThanOrEqual(1);
  });
});
