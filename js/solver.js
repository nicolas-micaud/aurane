// Computes the "par" of a galaxy: a near-optimal Steiner tree connecting Earth
// to every listener, using the shortest-path heuristic plus local search.

function costMatrix(n, edges) {
  const m = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
  for (const e of edges.values()) { m[e.a][e.b] = e.cost; m[e.b][e.a] = e.cost; }
  return m;
}

/** Prim MST on the subgraph induced by `nodes`, then prunes non-terminal leaves. */
function prunedMst(nodes, m, isTerminal) {
  const list = [...nodes];
  if (list.length === 0) return null;
  const inTree = new Set([list[0]]);
  const best = new Map(), parent = new Map();
  for (const v of list) { best.set(v, m[list[0]][v]); parent.set(v, list[0]); }
  const treeEdges = [];
  while (inTree.size < list.length) {
    let u = -1, bu = Infinity;
    for (const v of list) if (!inTree.has(v) && best.get(v) < bu) { bu = best.get(v); u = v; }
    if (u === -1) return null; // induced subgraph is disconnected
    inTree.add(u);
    treeEdges.push([parent.get(u), u]);
    for (const v of list) {
      if (!inTree.has(v) && m[u][v] < best.get(v)) { best.set(v, m[u][v]); parent.set(v, u); }
    }
  }
  let edgesLeft = treeEdges;
  for (let changed = true; changed;) {
    changed = false;
    const deg = new Map();
    for (const [a, b] of edgesLeft) { deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
    const next = edgesLeft.filter(([a, b]) => !((deg.get(a) === 1 && !isTerminal(a)) || (deg.get(b) === 1 && !isTerminal(b))));
    if (next.length !== edgesLeft.length) { edgesLeft = next; changed = true; }
  }
  const used = new Set(edgesLeft.flat());
  if (edgesLeft.length === 0) used.add(list.find(isTerminal));
  const cost = edgesLeft.reduce((s, [a, b]) => s + m[a][b], 0);
  return { cost, edges: edgesLeft, nodes: used };
}

function dijkstra(n, m, sources) {
  const d = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  for (const s of sources) d[s] = 0;
  for (;;) {
    let u = -1;
    for (let v = 0; v < n; v++) if (!done[v] && d[v] < Infinity && (u === -1 || d[v] < d[u])) u = v;
    if (u === -1) break;
    done[u] = 1;
    for (let v = 0; v < n; v++) {
      if (m[u][v] < Infinity && d[u] + m[u][v] < d[v]) { d[v] = d[u] + m[u][v]; prev[v] = u; }
    }
  }
  return { d, prev };
}

/** Shortest-path heuristic (Takahashi–Matsuyama). */
export function shortestPathHeuristic(n, edges, terminals) {
  const m = costMatrix(n, edges);
  const tree = new Set([terminals[0]]);
  const remaining = new Set(terminals.slice(1));
  while (remaining.size) {
    const { d, prev } = dijkstra(n, m, tree);
    let t = -1;
    for (const r of remaining) if (t === -1 || d[r] < d[t]) t = r;
    if (d[t] === Infinity) return null;
    for (let v = t; v !== -1 && !tree.has(v); v = prev[v]) tree.add(v);
    remaining.delete(t);
  }
  const term = new Set(terminals);
  return prunedMst(tree, m, (v) => term.has(v));
}

/** Near-optimal Steiner tree: SPH seed improved by vertex insertion/removal. */
export function solvePar(n, edges, terminals) {
  const m = costMatrix(n, edges);
  const term = new Set(terminals);
  const isTerminal = (v) => term.has(v);
  let best = shortestPathHeuristic(n, edges, terminals);
  if (!best) return null;
  for (let iter = 0, improved = true; improved && iter < 200; iter++) {
    improved = false;
    for (let v = 0; v < n; v++) {
      const cand = new Set(best.nodes);
      if (cand.has(v)) { if (isTerminal(v)) continue; cand.delete(v); } else cand.add(v);
      const res = prunedMst(cand, m, isTerminal);
      if (res && res.cost < best.cost) { best = res; improved = true; }
    }
  }
  return best;
}
