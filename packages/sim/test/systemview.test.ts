// Palier 2: the System view and battle reports respect fog of war and read the salvo log.
import { describe, expect, it } from 'vitest';
import { apply, battleList, battleReport, createWorld, fleetsAt, pruneBattles, spawnColony, systemViewFor, tick } from '../src/index.js';
import * as B from '../src/balance.js';

describe('system view', () => {
  it('shows a plateau in full to its owner and only the header to a stranger', () => {
    const w = createWorld('sv1', { radius: 5 });
    const a = spawnColony(w, { name: 'A', faction: 'guild', persona: 'oriel' });
    const b = spawnColony(w, { name: 'B', faction: 'oracles', persona: 'solen' });
    const mine = systemViewFor(w, a, a.capital)!;
    expect(mine.visible).toBe(true);
    expect(mine.mine).toBe(true);
    expect(mine.station?.hp).toBe(B.STATION_HP);
    expect(mine.station?.pos).toEqual({ r: 0, a: 0 });
    expect(mine.pois.length).toBeGreaterThanOrEqual(2);
    expect(mine.pois.some((p) => p.main)).toBe(true);
    expect(mine.lanes.length).toBeGreaterThanOrEqual(mine.pois.length - 1);
    expect(mine.structures.map((s) => s.kind).sort()).toEqual(['extractor', 'shipyard']);
    expect(mine.stock?.metal).toBe(B.STARTING_STOCK.metal);
    expect(mine.fleets.some((f) => f.units?.cargo === B.STARTING_CARGOS && f.docked)).toBe(true);
    expect(mine.orbitSlots.reduce((s, x) => s + x, 0)).toBeGreaterThanOrEqual(3);
    const theirs = systemViewFor(w, b, a.capital)!;
    expect(theirs.visible).toBe(false); // far away on the rim
    expect(theirs.structures).toEqual([]);
    expect(theirs.stock).toBeNull();
    expect(theirs.owner).toBe(a.id); // ownership is public
    expect(systemViewFor(w, a, 'nope')).toBeNull();
  });

  it('streams a live battle with positions, then a report with kills and losses per side', () => {
    const w = createWorld('sv2', { radius: 4 });
    const atk = spawnColony(w, { name: 'Atk', faction: 'corsairs', persona: 'kestrel' });
    const def = spawnColony(w, { name: 'Def', faction: 'concordat', persona: 'vane' });
    atk.createdAt = -1e9; def.createdAt = -1e9;
    w.systems[atk.capital]!.stock = { metal: 1e6, energy: 1e6, food: 1e6, crystal: 1e6 };
    w.systems[def.capital]!.stock = { metal: 1e6, energy: 1e6, food: 1e6, crystal: 1e6 };
    expect(apply(w, atk.id, { type: 'train', system: atk.capital, unit: 'corvette', count: 6 }).ok).toBe(true);
    expect(apply(w, def.id, { type: 'train', system: def.capital, unit: 'frigate', count: 2 }).ok).toBe(true);
    tick(w, 6 * B.UNIT_SECONDS.corvette + 60);
    const raiders = fleetsAt(w, atk.capital).find((f) => f.units.corvette === 6)!;
    expect(apply(w, atk.id, { type: 'fleet_order', fleet: raiders.id, order: 'raid', target: def.capital }).ok).toBe(true);
    tick(w, raiders.arriveAt - w.time + 4);
    expect(raiders.at).toBe(def.capital);
    // Cross the lanes from the jump point to the station.
    for (let i = 0; i < 60 && (raiders.poi !== w.systems[def.capital]!.mainPoi || raiders.hop); i++) tick(w, 30);
    tick(w, 4);
    const live = systemViewFor(w, def, def.capital)!;
    expect(live.engaged).toBe(true);
    expect(live.battle?.sides).toEqual([def.id, atk.id]);
    const enemy = live.fleets.find((f) => f.owner === atk.id)!;
    expect(enemy.units).toBeNull(); // composition hidden, size and position public
    expect(enemy.size).toBe(6);
    expect(enemy.pos).not.toBeNull();
    expect(live.fleets.some((f) => f.owner === def.id && !f.docked)).toBe(true); // defenders came out
    // A stranger in another sector sees nothing of it.
    expect(systemViewFor(w, def, atk.capital)!.visible).toBe(false);
    tick(w, 1800);
    const list = battleList(w, def);
    expect(list.length).toBe(1);
    const report = battleReport(w, def, list[0]!.id)!;
    expect(report.endedAt).not.toBeNull();
    expect(report.sides.map((s) => s.id)).toEqual([def.id, atk.id]);
    const d = report.sides[0]!, a = report.sides[1]!;
    expect(d.defender).toBe(true);
    // 6 corvettes against 2 frigates (which counter them) and a 300 HP station: the frigates win.
    expect(d.kills.corvette).toBe(6);
    expect(a.losses.corvette).toBe(6);
    expect(report.outcome).toBe('held');
    expect(report.timeline.every((e) => e.at >= report.startedAt)).toBe(true);
    expect(battleReport(w, atk, report.id)).not.toBeNull(); // the attacker may read it too
    const third = spawnColony(w, { name: 'C', faction: 'guild', persona: 'oriel' });
    expect(battleReport(w, third, report.id)).toBeNull();
    // Old logs are pruned once the season moves on.
    w.time += 8 * 86400;
    pruneBattles(w);
    expect(Object.keys(w.battles)).toHaveLength(0);
  });
});
