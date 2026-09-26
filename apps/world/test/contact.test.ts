// First contact through the world process: the nearest NPC lights a relay within the window, the General says so in
// character without a model, and at the newcomer's first relay it names the rival and the coveted star before its
// tier-1 word (docs/design/ONBOARDING-S0.md, "Le monde est vivant").
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apply, colonyNetwork, evaluateLink, rangeContext, tick } from '@aurane/sim';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';

let engine: Engine;
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aurane-contact-'));
  engine = new Engine(loadConfig({ SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '6', SEASON_SEED: 'contact-server', TIME_SCALE: '1' }), new FileStore(dir));
  await engine.init();
});
afterAll(async () => { await engine.stop(); });

describe('first contact in the world process', () => {
  it('the General announces the neighbour, then names it again at the first relay', async () => {
    const made = await engine.createGuest('Nick', 'guild', 'oriel');
    if ('error' in made) throw new Error(made.error);
    const c = made.colony;
    const w = engine.world;
    expect(c.contact).toBeDefined();
    tick(w, 120);
    await engine.step();
    const ev = w.events.find((e) => e.kind === 'contact.first' && e.actors[0] === c.id);
    expect(ev).toBeDefined();
    const rival = w.colonies[c.contact!.rival]!;
    const lines = () => engine.general.history(c.id).map((t) => t.text);
    expect(lines().some((l) => l.includes(rival.name))).toBe(true);
    // The first relay: tier 1 opens, and the General says the star is ours but the rival looks at another one.
    const net = colonyNetwork(w, c), ctx = rangeContext(w, c);
    let target: { a: string; b: string } | null = null;
    for (const a of net.keys()) for (const [id, st] of Object.entries(w.systems)) {
      if (st.owner || net.has(id)) continue;
      if (evaluateLink(w.galaxy, w.galaxy.systems[a]!, w.galaxy.systems[id]!, ctx).ok) { target = { a, b: id }; break; }
    }
    expect(target).not.toBeNull();
    const r = apply(w, c.id, { type: 'build_relay', a: target!.a, b: target!.b });
    expect(r.ok).toBe(true);
    expect(c.onboarding.tier).toBe(1);
    await engine.step();
    const after = lines();
    const mine = w.galaxy.systems[target!.b]!.name, star = w.galaxy.systems[c.contact!.system!]!.name;
    const idx = after.findIndex((l) => l.includes(mine) && l.includes(star) && l.includes(rival.name));
    expect(idx, after.join('\n')).toBeGreaterThanOrEqual(0);
    expect(after[idx + 1]).toContain('Premier relais'); // the tier-1 word follows
  });
});
