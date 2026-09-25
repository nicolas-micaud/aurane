// Progressive onboarding (docs/design/ONBOARDING-S0.md): tiers open on game facts with time floors, commands above
// the tier are refused with `locked:<tier>`, NPCs and veterans sit at the last tier, and a legacy season has none.
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_MAX_TIER, apply, colonyNetwork, commandTier, createWorld, evaluateLink, rangeContext, restoreWorld, snapshotWorld, spawnColony, tick, viewFor,
  type Colony, type World,
} from '../src/index.js';

const rich = (w: World, c: Colony): void => { w.systems[c.capital]!.stock = { metal: 1e4, energy: 1e4, food: 1e4, crystal: 1e4, rium: 1e4 }; };

function nearestBuildable(w: World, c: Colony): { a: string; b: string } {
  const net = colonyNetwork(w, c), ctx = rangeContext(w, c);
  let best: { a: string; b: string; len: number } | null = null;
  for (const a of net.keys()) for (const [id, st] of Object.entries(w.systems)) {
    if (st.owner || net.has(id)) continue;
    const v = evaluateLink(w.galaxy, w.galaxy.systems[a]!, w.galaxy.systems[id]!, ctx);
    if (v.ok && (!best || v.length < best.len)) best = { a, b: id, len: v.length };
  }
  if (!best) throw new Error('nothing buildable');
  return best;
}

describe('progressive onboarding', () => {
  it('maps every gated command to a tier and leaves linking open from the start', () => {
    expect(commandTier({ type: 'build_relay', a: 'x', b: 'y' })).toBe(0);
    expect(commandTier({ type: 'build', system: 'x', building: 'extractor' })).toBe(1);
    expect(commandTier({ type: 'build', system: 'x', building: 'tradepost' })).toBe(2);
    expect(commandTier({ type: 'build', system: 'x', building: 'turret_light' })).toBe(3);
    expect(commandTier({ type: 'market_order', region: 'r', resource: 'metal', side: 'sell', qty: 1, price: 1 })).toBe(2);
    expect(commandTier({ type: 'fleet_order', fleet: 'f', order: 'defend', target: 'x' })).toBe(3);
    expect(commandTier({ type: 'fleet_order', fleet: 'f', order: 'raid', target: 'x' })).toBe(4);
    expect(commandTier({ type: 'treaty', with: 'c', kind: 'nap' })).toBe(5);
    expect(commandTier({ type: 'light_beacon', system: 'x' })).toBe(6);
  });

  it('starts a human colony at tier 0, refuses locked commands with the tier, and opens tiers on facts', () => {
    const w = createWorld('onb1', { radius: 4, seasonDays: 56 });
    const me = spawnColony(w, { name: 'Me', faction: 'guild', persona: 'oriel' });
    const npc = spawnColony(w, { name: 'Npc', faction: 'concordat', persona: 'vane', npc: true });
    rich(w, me);
    expect(me.onboarding.tier).toBe(0);
    expect(npc.onboarding.tier).toBe(ONBOARDING_MAX_TIER);
    expect(apply(w, me.id, { type: 'build', system: me.capital, building: 'extractor' })).toEqual({ ok: false, reason: 'locked:1' });
    expect(apply(w, me.id, { type: 'set_watch', startHour: 3 })).toEqual({ ok: false, reason: 'locked:3' });
    // Tier 1: the first relay opens the system board right away.
    const { a, b } = nearestBuildable(w, me);
    expect(apply(w, me.id, { type: 'build_relay', a, b }).ok).toBe(true);
    expect(me.onboarding.tier).toBe(1);
    expect(me.journal.at(-1)?.kind).toBe('onboarding.1');
    expect(w.events.some((e) => e.kind === 'onboarding.unlocked' && e.actors[0] === me.id && e.data?.tier === 1)).toBe(true);
    expect(apply(w, me.id, { type: 'build', system: me.capital, building: 'warehouse' }).ok).toBe(true);
    // Tier 2 needs a Draw lived, three connected systems and the first hour.
    expect(apply(w, me.id, { type: 'decree', kind: 'freefees' })).toEqual({ ok: false, reason: 'locked:2' });
    tick(w, 3600);
    expect(me.onboarding.tier).toBe(1);
    const second = nearestBuildable(w, me);
    expect(apply(w, me.id, { type: 'build_relay', a: second.a, b: second.b }).ok).toBe(true);
    tick(w, 3600);
    expect(me.onboarding.tier).toBe(2);
    // Tier 3 waits for the six-hour floor even though the capital's shipyard is there from the start.
    expect(me.onboarding.tier).toBeLessThan(3);
    tick(w, 4 * 3600);
    expect(me.onboarding.tier).toBe(3);
    expect(apply(w, me.id, { type: 'set_watch', startHour: 3 }).ok).toBe(true);
    // Tier 4 waits for the shield to drop and a warship to exist; tier 5 for day two and a human neighbour.
    expect(apply(w, me.id, { type: 'train', system: me.capital, unit: 'corvette', count: 1 }).ok).toBe(true);
    tick(w, 3600);
    expect(me.onboarding.tier).toBe(3);
    me.createdAt -= 80 * 3600;
    tick(w, 3600);
    expect(me.onboarding.tier).toBe(4);
    expect(apply(w, me.id, { type: 'treaty', with: npc.id, kind: 'nap' })).toEqual({ ok: false, reason: 'locked:5' });
    const view = viewFor(w, me);
    expect(view.me.onboarding.tier).toBe(4);
    expect(view.me.onboarding.unlockedAt[1]).toBe(0);
  });

  it('"show me everything" opens every tier, and the snapshot keeps the tier', () => {
    const w = createWorld('onb2', { radius: 4 });
    const me = spawnColony(w, { name: 'Me', faction: 'oracles', persona: 'solen' });
    expect(apply(w, me.id, { type: 'onboarding_unlock' }).ok).toBe(true);
    expect(me.onboarding.tier).toBe(ONBOARDING_MAX_TIER);
    expect(me.journal.at(-1)?.kind).toBe('onboarding.all');
    const back = restoreWorld(snapshotWorld(w));
    expect(back.colonies[me.id]!.onboarding.tier).toBe(ONBOARDING_MAX_TIER);
  });

  it('a legacy season and a pre-onboarding snapshot leave everything open', () => {
    const w = createWorld('onb3', { radius: 4, rules: { onboarding: false } });
    const me = spawnColony(w, { name: 'Me', faction: 'corsairs', persona: 'kestrel' });
    expect(me.onboarding.tier).toBe(ONBOARDING_MAX_TIER);
    const snap = snapshotWorld(w) as unknown as { version: number; state: { colonies: Record<string, { onboarding?: unknown }> } };
    delete snap.state.colonies[me.id]!.onboarding;
    snap.version = 6;
    const back = restoreWorld(snap as never);
    expect(back.colonies[me.id]!.onboarding.tier).toBe(ONBOARDING_MAX_TIER);
  });
});
