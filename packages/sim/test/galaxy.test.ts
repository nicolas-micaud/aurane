import { describe, expect, it } from 'vitest';
import { generateGalaxy, hexDisk, regionCenter, hexDistance, hexKey, rollDraw, createRng, evaluateLink, connectedFrom, findBridges, relayId, type Relay } from '../src/index.js';

describe('hex grid', () => {
  it('disk sizes follow 3r²+3r+1', () => {
    expect(hexDisk(0)).toHaveLength(1);
    expect(hexDisk(3)).toHaveLength(37);
    expect(hexDisk(12)).toHaveLength(469);
  });
  it('regions are 7-hex flowers with every hex within distance 1 of its centre', () => {
    const sizes = new Map<string, number>();
    for (const h of hexDisk(9)) {
      const c = regionCenter(h);
      expect(hexDistance(h, c)).toBeLessThanOrEqual(1);
      sizes.set(hexKey(c), (sizes.get(hexKey(c)) ?? 0) + 1);
    }
    // interior regions are complete flowers
    const full = [...sizes.values()].filter((n) => n === 7).length;
    expect(full).toBeGreaterThan(20);
    expect(Math.max(...sizes.values())).toBe(7);
  });
});

describe('galaxy', () => {
  const g = generateGalaxy('season-0', { radius: 6 });
  it('is deterministic', () => {
    const g2 = generateGalaxy('season-0', { radius: 6 });
    expect(JSON.stringify(g2)).toBe(JSON.stringify(g));
    expect(JSON.stringify(generateGalaxy('other', { radius: 6 }))).not.toBe(JSON.stringify(g));
  });
  it('has seven named beacons near the core and systems in every sector', () => {
    expect(g.beacons).toHaveLength(7);
    for (const b of g.beacons) expect(g.systems[b]!.beaconName).toBeDefined();
    for (const s of Object.values(g.sectors)) expect(s.systems.length).toBeGreaterThanOrEqual(8);
  });
  it('puts food on the rim and energy at the core', () => {
    const share = (ring: (r: number) => boolean, res: string) => {
      const sys = Object.values(g.systems).filter((s) => ring(g.sectors[s.sector]!.ring));
      return sys.filter((s) => s.resource === res).length / sys.length;
    };
    expect(share((r) => r <= 2, 'energy')).toBeGreaterThan(share((r) => r >= 5, 'energy'));
    expect(share((r) => r >= 5, 'food')).toBeGreaterThan(share((r) => r <= 2, 'food'));
  });
});

describe('draw', () => {
  it('is deterministic, draws 3 distinct bands and remembers the previous hour', () => {
    const base = { seasonSeed: 42, regions: ['R0,0'], beacons: ['b'] };
    const d0 = rollDraw({ ...base, index: 0 });
    expect(rollDraw({ ...base, index: 0 })).toEqual(d0);
    expect(new Set(d0.bands).size).toBe(3);
    let repeats = 0, total = 0;
    let prev = d0;
    for (let i = 1; i < 3000; i++) {
      const d = rollDraw({ ...base, index: i, previous: prev });
      for (const b of d.bands) { total++; if (prev.bands.includes(b)) repeats++; }
      prev = d;
    }
    // without memory a band repeats with p = 3/8 = 0.375; with the penalty it should be clearly lower
    expect(repeats / total).toBeLessThan(0.3);
    expect(repeats / total).toBeGreaterThan(0.15);
  });
});

describe('network', () => {
  const g = generateGalaxy('net', { radius: 3 });
  const ctx = { faction: 'guild' as const, amplifiers: new Set<string>(), litBeacons: [], stormSectors: new Set<string>() };
  it('rejects far links and accepts close ones with a positive cost', () => {
    const sys = Object.values(g.systems);
    let ok = 0, far = 0;
    for (const a of sys) for (const b of sys) {
      if (a.id >= b.id) continue;
      const v = evaluateLink(g, a, b, ctx);
      if (v.ok) { ok++; expect(v.cost.metal).toBeGreaterThan(0); expect(v.upkeep).toBeGreaterThan(0); }
      else if (v.reason === 'far') far++;
    }
    expect(ok).toBeGreaterThan(50);
    expect(far).toBeGreaterThan(ok);
  });
  it('computes connectivity and bridges', () => {
    const mk = (a: string, b: string): Relay => ({ id: relayId(a, b), a, b, owner: 'me', length: 100, upkeep: 1, readyAt: 0, cutUntil: 0 });
    const relays = [mk('A', 'B'), mk('B', 'C'), mk('C', 'A'), mk('C', 'D'), mk('D', 'E')];
    const reach = connectedFrom(relays, 'A', 'me', 10);
    expect([...reach.keys()].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(reach.get('E')).toBe(3);
    const bridges = findBridges(relays, 'me', 10);
    expect(bridges).toEqual(new Set([relayId('C', 'D'), relayId('D', 'E')]));
    relays[3]!.cutUntil = 100;
    expect(connectedFrom(relays, 'A', 'me', 10).has('D')).toBe(false);
    expect(connectedFrom(relays, 'A', 'me', 200).has('D')).toBe(true);
  });
  it('rng sub-streams are independent and reproducible', () => {
    const a = createRng('x'), b = createRng('x');
    expect(a.next()).toBe(b.next());
  });
});
