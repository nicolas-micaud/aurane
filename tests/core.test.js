import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashString } from '../js/rng.js';
import { pointSegmentDistance, segmentLengthInCircle } from '../js/geometry.js';
import { generateGalaxy, evaluateLink } from '../js/galaxy.js';
import { solvePar, shortestPathHeuristic } from '../js/solver.js';
import { Game, rating } from '../js/game.js';
import { dailyNumber } from '../js/daily.js';

test('rng is deterministic', () => {
  const a = createRng(hashString('2026-09-24'));
  const b = createRng(hashString('2026-09-24'));
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  assert.notEqual(hashString('a'), hashString('b'));
});

test('geometry helpers', () => {
  assert.equal(pointSegmentDistance({ x: 0, y: 5 }, { x: -10, y: 0 }, { x: 10, y: 0 }), 5);
  assert.equal(pointSegmentDistance({ x: 20, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }), 10);
  const inside = segmentLengthInCircle({ x: -100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0, r: 10 });
  assert.ok(Math.abs(inside - 20) < 1e-9);
  assert.equal(segmentLengthInCircle({ x: -100, y: 50 }, { x: 100, y: 50 }, { x: 0, y: 0, r: 10 }), 0);
  const half = segmentLengthInCircle({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0, r: 10 });
  assert.ok(Math.abs(half - 10) < 1e-9);
});

test('galaxies are deterministic and always solvable', () => {
  const g1 = generateGalaxy('2026-09-24');
  const g2 = generateGalaxy('2026-09-24');
  assert.deepEqual(g1.stars, g2.stars);
  for (let s = 0; s < 60; s++) {
    const g = generateGalaxy(s * 1013, { listeners: 2 + (s % 5) });
    const par = solvePar(g.stars.length, g.edges, g.terminals);
    assert.ok(par, `seed ${s} solvable`);
    assert.ok(par.cost > 0);
    for (const t of g.terminals) assert.ok(par.nodes.has(t), `par tree contains terminal ${t}`);
  }
});

test('links respect black holes and range', () => {
  const g = generateGalaxy('blackhole-test');
  const bh = g.blackHoles[0];
  const left = { x: bh.x - 60, y: bh.y, type: 'relay' };
  const right = { x: bh.x + 60, y: bh.y, type: 'relay' };
  assert.equal(evaluateLink(g, left, right).reason, 'blackhole');
  const far = { x: 0, y: 0, type: 'relay' }, far2 = { x: 900, y: 900, type: 'relay' };
  assert.equal(evaluateLink(g, far, far2).reason, 'range');
});

function bruteForceSteiner(n, edges, terminals) {
  // Enumerate every subset of Steiner nodes; MST of the induced graph is optimal for one of them.
  const others = [...Array(n).keys()].filter((v) => !terminals.includes(v));
  let best = Infinity;
  for (let mask = 0; mask < 1 << others.length; mask++) {
    const nodes = [...terminals, ...others.filter((_, i) => mask & (1 << i))];
    const sub = new Map([...edges].filter(([, e]) => nodes.includes(e.a) && nodes.includes(e.b)));
    const r = shortestPathHeuristic(n, sub, terminals);
    if (r) {
      // Kruskal on induced graph for the exact MST cost.
      const parent = new Map(nodes.map((v) => [v, v]));
      const find = (v) => (parent.get(v) === v ? v : find(parent.get(v)));
      let cost = 0, count = 0;
      for (const e of [...sub.values()].sort((x, y) => x.cost - y.cost)) {
        const ra = find(e.a), rb = find(e.b);
        if (ra !== rb) { parent.set(ra, rb); cost += e.cost; count++; }
      }
      if (count === nodes.length - 1) best = Math.min(best, cost);
    }
  }
  return best;
}

test('solver finds the optimum on small random graphs', () => {
  const rng = createRng(42);
  let optimal = 0;
  const runs = 40;
  for (let r = 0; r < runs; r++) {
    const n = 9;
    const edges = new Map();
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (rng.next() < 0.45) edges.set(`${i}-${j}`, { a: i, b: j, cost: rng.int(1, 20) });
    }
    for (let i = 0; i < n - 1; i++) if (!edges.has(`${i}-${i + 1}`)) edges.set(`${i}-${i + 1}`, { a: i, b: i + 1, cost: 25 });
    const terminals = [0, 4, 8];
    const par = solvePar(n, edges, terminals);
    const opt = bruteForceSteiner(n, edges, terminals);
    assert.ok(par.cost >= opt);
    if (par.cost === opt) optimal++;
  }
  assert.ok(optimal / runs >= 0.9, `optimal in ${optimal}/${runs} runs`);
});

test('game builds links, detects completion and undoes', () => {
  const g = generateGalaxy('game-test');
  const par = solvePar(g.stars.length, g.edges, g.terminals);
  const game = new Game(g, par.cost);
  assert.equal(game.complete, false);
  for (const [a, b] of par.edges) assert.ok(game.tryLink(a, b).ok);
  assert.equal(game.complete, true);
  assert.equal(game.cost, par.cost);
  assert.equal(rating(game.cost, par.cost), 3);
  game.undo();
  assert.equal(game.complete, false);
  const saved = game.serialize();
  const game2 = new Game(g, par.cost);
  game2.restore(saved);
  assert.equal(game2.cost, game.cost);
  assert.equal(game.tryLink(0, 0).ok, false);
});

test('rating thresholds', () => {
  assert.equal(rating(100, 100), 3);
  assert.equal(rating(95, 100), 3);
  assert.equal(rating(110, 100), 2);
  assert.equal(rating(125, 100), 1);
  assert.equal(rating(126, 100), 0);
});

test('daily numbering starts at #1 on launch day', () => {
  assert.equal(dailyNumber('2026-09-24'), 1);
  assert.equal(dailyNumber('2026-09-25'), 2);
  assert.equal(dailyNumber('2027-09-24'), 366);
});
