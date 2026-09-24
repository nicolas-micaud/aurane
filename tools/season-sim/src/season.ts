import { FACTIONS, PERSONAS, type Faction, type Persona } from '@starnet/protocol';
import { apply, colonyScore, createWorld, decide, fleetSize, productiveSystems, spawnColony, tick, type World } from '@starnet/sim';

export interface SeasonOptions {
  seed: string;
  days: number;
  colonies: number;
  radius: number;
  decisionMinutes: number;
}

export function runSeason(opts: SeasonOptions): World {
  const w = createWorld(opts.seed, { radius: opts.radius, seasonDays: opts.days });
  for (let i = 0; i < opts.colonies; i++) {
    const faction = FACTIONS[i % FACTIONS.length] as Faction;
    const persona = PERSONAS[(i * 7 + Math.floor(i / 4)) % PERSONAS.length] as Persona;
    try {
      spawnColony(w, { name: `${faction}-${i}`, faction, persona, npc: true });
    } catch {
      break; // rim is full
    }
  }
  const step = opts.decisionMinutes * 60;
  const total = opts.days * 86400;
  let tickIndex = 0;
  while (w.time < total && !w.ended) {
    for (const c of Object.values(w.colonies)) {
      const d = decide(w, c, tickIndex);
      for (const cmd of d.commands) apply(w, c.id, cmd);
    }
    tick(w, step, 300);
    tickIndex++;
  }
  return w;
}

export interface Report {
  seed: string;
  days: number;
  colonies: number;
  wallSeconds?: number;
  ended: World['ended'];
  relays: number;
  relaysCut: number;
  battles: number;
  systemsCaptured: number;
  tradesSettled: number;
  avgPrice: Record<string, number>;
  medianConnected: number;
  maxConnected: number;
  giniConnected: number;
  starving: number;
  stuck: number;
  fleetsTotal: number;
  alliances: number;
  treaties: number;
  beaconsLit: number;
  byFaction: Record<string, { colonies: number; avgScore: number; avgConnected: number }>;
  top: { name: string; faction: string; score: number; connected: number }[];
  anomalies: string[];
}

function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (!n) return 0;
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  let acc = 0;
  v.forEach((x, i) => { acc += (2 * (i + 1) - n - 1) * x; });
  return acc / (n * sum);
}

export function summarize(w: World, opts: SeasonOptions): Report {
  const colonies = Object.values(w.colonies);
  const connected = colonies.map((c) => productiveSystems(w, c).length).sort((a, b) => a - b);
  const events = w.events;
  const count = (kind: string): number => events.filter((e) => e.kind === kind).length;
  const prices: Record<string, number[]> = {};
  for (const e of events) {
    if (e.kind !== 'draw') continue;
  }
  for (const c of w.lastClearing) (prices[c.resource] ??= []).push(c.price);
  const avgPrice: Record<string, number> = {};
  for (const [r, arr] of Object.entries(prices)) avgPrice[r] = Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 100) / 100;
  const byFaction: Report['byFaction'] = {};
  for (const f of FACTIONS) {
    const cs = colonies.filter((c) => c.faction === f);
    byFaction[f] = {
      colonies: cs.length,
      avgScore: cs.length ? Math.round((cs.reduce((s, c) => s + colonyScore(w, c), 0) / cs.length) * 10) / 10 : 0,
      avgConnected: cs.length ? Math.round((cs.reduce((s, c) => s + productiveSystems(w, c).length, 0) / cs.length) * 10) / 10 : 0,
    };
  }
  const starving = colonies.filter((c) => c.stock.food <= 0).length;
  const stuck = colonies.filter((c) => productiveSystems(w, c).length <= 1).length;
  const anomalies: string[] = [];
  for (const c of colonies) for (const r of ['metal', 'energy', 'food', 'crystal'] as const) {
    if (!Number.isFinite(c.stock[r]) || c.stock[r] < -1e-6) anomalies.push(`${c.name} ${r}=${c.stock[r]}`);
  }
  if (!Number.isFinite(colonies.reduce((s, c) => s + c.credits, 0))) anomalies.push('credits not finite');
  if (opts.days >= 7 && stuck / Math.max(1, colonies.length) > 0.2) anomalies.push(`${stuck} colonies stuck at 1 system`);
  if (opts.days >= 7 && count('barter.done') + count('draw') === 0) anomalies.push('no draws');
  const tradesSettled = events.filter((e) => e.kind === 'barter.done').length + colonies.reduce((s, c) => s + c.marketVolume7d.filter((v) => v > 0).length, 0);
  return {
    seed: opts.seed, days: opts.days, colonies: colonies.length, ended: w.ended,
    relays: Object.keys(w.relays).length, relaysCut: count('relay.cut') + count('sabotage.success'),
    battles: count('battle'), systemsCaptured: count('system.captured'), tradesSettled, avgPrice,
    medianConnected: connected[Math.floor(connected.length / 2)] ?? 0, maxConnected: connected[connected.length - 1] ?? 0,
    giniConnected: Math.round(gini(connected) * 100) / 100, starving, stuck,
    fleetsTotal: Object.values(w.fleets).reduce((s, f) => s + fleetSize(f.units), 0),
    alliances: Object.keys(w.alliances).length, treaties: Object.keys(w.treaties).length,
    beaconsLit: Object.keys(w.litBeacons).length, byFaction,
    top: colonies.map((c) => ({ name: c.name, faction: c.faction, score: Math.round(colonyScore(w, c) * 10) / 10, connected: productiveSystems(w, c).length }))
      .sort((a, b) => b.score - a.score).slice(0, 8),
    anomalies,
  };
}
