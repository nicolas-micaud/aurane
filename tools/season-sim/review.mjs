// Season 0 design review measurements (docs/design/REVIEW-S0.md). Headless, seeded, reproducible.
// Usage (after `npm run build`): node tools/season-sim/review.mjs factions|contact|all [--seeds 3] [--days 7]
/* global process, console */
import { FACTIONS, PERSONAS } from '../../packages/protocol/dist/index.js';
import { LEGACY_RULES, apply, colonyScore, createWorld, decide, spawnColony, tick, productiveSystems, hexDistance } from '../../packages/sim/dist/index.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const what = process.argv[2] ?? 'all';
const seeds = Number(arg('seeds', 3));
const days = Number(arg('days', 7));

/** One accelerated season: NPC Generals only, factions round-robin, personas balanced across factions. */
function run({ seed, colonies, radius, days, rules, onTick }) {
  const w = createWorld(seed, { radius, seasonDays: days, rules });
  for (let i = 0; i < colonies; i++) {
    const faction = FACTIONS[i % 4];
    const persona = PERSONAS[Math.floor(i / 4) % 4]; // every faction gets every persona equally
    try { spawnColony(w, { name: `${faction}-${i}`, faction, persona, npc: true }); } catch { break; }
  }
  const step = 1800; let ti = 0;
  while (w.time < days * 86400 && !w.ended) {
    for (const c of Object.values(w.colonies)) { const d = decide(w, c, ti); for (const cmd of d.commands) apply(w, c.id, cmd); }
    tick(w, step, 300); ti++;
    onTick?.(w, ti);
  }
  return w;
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} %`;

function factions() {
  console.log(`\n== Faction balance: ${seeds} seed(s) × ${days} days × 40 colonies, radius 6, NPC Generals ==`);
  for (const [label, rules] of [['oracle hint 60 min (default)', {}], ['oracle hint off', { oracleHintMinutes: 0 }], ['oracle hint 15 min', { oracleHintMinutes: 15 }]]) {
    const scores = { concordat: [], guild: [], oracles: [], corsairs: [] };
    const connected = { concordat: [], guild: [], oracles: [], corsairs: [] };
    for (let s = 0; s < seeds; s++) {
      const w = run({ seed: `review-f-${s}`, colonies: 40, radius: 6, days, rules });
      for (const c of Object.values(w.colonies)) { scores[c.faction].push(colonyScore(w, c)); connected[c.faction].push(productiveSystems(w, c).length); }
    }
    const all = mean(Object.values(scores).flat());
    console.log(`-- ${label}: mean score ${all.toFixed(2)}`);
    for (const f of FACTIONS) console.log(`   ${f.padEnd(10)} score ${mean(scores[f]).toFixed(2).padStart(6)} (${pct(mean(scores[f]) / all - 1)})   connected ${mean(connected[f]).toFixed(1)}`);
  }
}

/** First contact: the first hour at which a colony sees another colony's system within one sector of its own network. */
function contact() {
  console.log(`\n== First contact: hours until a colony has a foreign capital within 1 sector of one of its systems (median over colonies), 3 days ==`);
  const rows = [];
  for (const [colonies, radius] of [[40, 6], [40, 8], [40, 12], [120, 8], [120, 10], [250, 10], [250, 12], [500, 12]]) {
    const first = new Map();
    const check = (w, ti) => {
      if (ti % 2) return; // hourly
      const hour = ti / 2;
      const caps = Object.values(w.colonies).map((c) => ({ id: c.id, hex: w.galaxy.sectors[w.galaxy.systems[c.capital].sector].hex }));
      for (const c of Object.values(w.colonies)) {
        if (first.has(c.id)) continue;
        const mine = (w.owned[c.id] ?? []).map((id) => w.galaxy.sectors[w.galaxy.systems[id].sector].hex);
        if (caps.some((o) => o.id !== c.id && mine.some((h) => hexDistance(h, o.hex) <= 1))) first.set(c.id, hour);
      }
    };
    const w = run({ seed: `review-c-${colonies}-${radius}`, colonies, radius, days: 3, rules: { galaxyGrowth: { enabled: false } }, onTick: check });
    const n = Object.keys(w.colonies).length;
    const hours = [...first.values()].sort((a, b) => a - b);
    const median = hours.length >= n / 2 ? hours[Math.floor(n / 2)] : null;
    const sectors = Object.keys(w.galaxy.sectors).length;
    rows.push({ colonies: n, radius, sectors, perColony: +(sectors / n).toFixed(1), contactBy72h: `${Math.round((hours.length / n) * 100)} %`, medianHours: median ?? '> 72', relays: Object.keys(w.relays).length });
  }
  console.table(rows);
  console.log(`\n== Same, with galaxy growth from radius 4 (rim occupancy 0.5, max 12) ==`);
  const grown = [];
  for (const colonies of [40, 120, 250]) {
    const w = run({ seed: `review-g-${colonies}`, colonies, radius: 4, days: 1, rules: { galaxyGrowth: { enabled: true, rimOccupancy: 0.5, maxRadius: 12 } } });
    grown.push({ colonies: Object.keys(w.colonies).length, startRadius: 4, endRadius: w.galaxy.radius, sectors: Object.keys(w.galaxy.sectors).length, expansions: w.events.filter((e) => e.kind === 'galaxy.expanded').length });
  }
  console.table(grown);
}

function transfers() {
  console.log(`\n== Throwaway feeding: one main + 3 alts spawned next to it, alts gift everything each hour for a day ==`);
  for (const [label, rules] of [['legacy', LEGACY_RULES], ['season 0', {}]]) {
    const w = createWorld('review-t', { radius: 4, rules });
    const main = spawnColony(w, { name: 'main', faction: 'guild', persona: 'oriel', origin: 'd' });
    const alts = [1, 2, 3].map((i) => spawnColony(w, { name: `alt${i}`, faction: 'guild', persona: 'oriel', origin: `d${i}` }));
    const region = w.galaxy.systems[main.capital].region;
    for (const a of alts) { const sys = Object.values(w.galaxy.systems).find((s) => s.region === region && !w.systems[s.id].owner); w.systems[sys.id].owner = main.id; w.systems[sys.id].owner = null; a.marketSystem = a.capital; }
    let ti = 0; let accepted = 0, refused = 0;
    while (w.time < 86400) {
      for (const a of alts) {
        const st = w.systems[a.capital].stock;
        const give = { metal: Math.floor(st.metal * 0.9), energy: Math.floor(st.energy * 0.9) };
        // Reach: alts sit in the same region as the main by construction of the rim? Not guaranteed: fall back to alliance.
        const r = apply(w, a.id, { type: 'barter_offer', to: main.id, give, want: { food: 1 } });
        if (r.ok) { accepted++; apply(w, main.id, { type: 'barter_accept', offer: r.id }); } else refused++;
      }
      const d = decide(w, main, ti); for (const cmd of d.commands) apply(w, main.id, cmd);
      tick(w, 3600, 300); ti++;
    }
    console.log(`-- ${label}: offers accepted ${accepted}, refused ${refused}; main connected ${productiveSystems(w, main).length}, main metal ${Math.round(w.systems[main.capital].stock.metal)}`);
  }
}

if (what === 'factions' || what === 'all') factions();
if (what === 'contact' || what === 'all') contact();
if (what === 'transfers' || what === 'all') transfers();
