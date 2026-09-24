// The deterministic rule engine that executes a Policy. Both NPC colonies and players'
// Generals run this; the LLM only writes the Policy and narrates. No randomness beyond a
// seeded stream per colony and decision tick, so a season replays bit-for-bit.
import type { Command, Policy, Resource, Stock } from '@starnet/protocol';
import * as B from './balance.js';
import type { StarSystem } from './galaxy.js';
import { hexDistance } from './hex.js';
import { findBridges, linkOptions, relayActive } from './network.js';
import { createRng, subSeed } from './rng.js';
import { fleetSize, type Colony, type World } from './state.js';
import { atPeace, isAlly } from './diplomacy.js';
import {
  colonyNetwork, colonyRelays, colonyScore, fleetsAt, hasBuilding, isShielded, networkUpkeep, ownedSystems, rangeContext,
  reachableRegions, slotsOf,
} from './world.js';

export interface Decision { commands: Command[]; notes: string[] }

interface Ctx {
  w: World;
  c: Colony;
  p: Policy;
  net: Map<string, number>;
  owned: string[];
  productive: string[];
  reserve: Stock;
  rng: ReturnType<typeof createRng>;
  out: Command[];
  notes: string[];
}

/** Default reserves scale with the network: enough energy for six hours of upkeep, food for the population. */
function reserves(w: World, c: Colony, p: Policy, productive: string[]): Stock {
  const upkeep = networkUpkeep(colonyRelays(w, c.id).filter((r) => relayActive(r, w.time)));
  const pop = productive.reduce((s, id) => s + w.systems[id]!.population, 0);
  return {
    metal: p.reserves.metal ?? 80,
    energy: p.reserves.energy ?? Math.max(60, Math.ceil(upkeep * 6)),
    food: p.reserves.food ?? Math.max(40, Math.ceil(pop * B.POP_FOOD_PER_UNIT * 20 * 6)),
    crystal: p.reserves.crystal ?? 20,
  };
}

function spare(ctx: Ctx, r: Resource): number {
  return ctx.c.stock[r] - ctx.reserve[r];
}

function canAfford(ctx: Ctx, cost: Partial<Record<Resource, number | undefined>>): boolean {
  for (const r of B.RESOURCE_LIST) if ((cost[r] ?? 0) > spare(ctx, r)) return false;
  return true;
}

function lastPrice(w: World, region: string, r: Resource): number | null {
  const c = w.lastClearing.find((x) => x.region === region && x.resource === r);
  return c ? c.price : null;
}

const BASE_PRICE: Record<Resource, number> = { metal: 1, energy: 1.5, food: 1, crystal: 6 };

function decideMarket(ctx: Ctx): void {
  const { w, c, p } = ctx;
  for (const o of Object.values(w.orders)) if (o.colony === c.id) return; // one round of orders per draw
  const regions = [...reachableRegions(w, c)];
  if (!regions.length) return;
  const home = w.galaxy.systems[c.capital]!.region;
  const region = regions.includes(home) ? home : regions[0]!;
  for (const r of B.RESOURCE_LIST) {
    const ref = lastPrice(w, region, r) ?? BASE_PRICE[r];
    const surplus = spare(ctx, r) - ctx.reserve[r] * 0.5;
    if (surplus >= 20) {
      const floor = p.sellAbove[r] ?? ref * 0.85;
      const qty = Math.floor(surplus * 0.6);
      ctx.out.push({ type: 'market_order', region, resource: r, side: 'sell', qty, price: round2(Math.max(0.1, floor)) });
    } else if (spare(ctx, r) < 0 && c.credits > 20) {
      const cap = p.buyBelow[r] ?? ref * 1.2;
      const qty = Math.max(1, Math.min(Math.ceil(-spare(ctx, r)), Math.floor((c.credits * 0.5) / cap)));
      if (qty > 0) ctx.out.push({ type: 'market_order', region, resource: r, side: 'buy', qty, price: round2(cap) });
    }
  }
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

interface Candidate { a: string; b: string; score: number; cost: Partial<Stock>; upkeep: number }

function expansionCandidates(ctx: Ctx): Candidate[] {
  const { w, c } = ctx;
  const rctx = rangeContext(w, c);
  const need: Record<Resource, number> = { metal: 1, energy: 1, food: 1, crystal: 1 };
  for (const r of B.RESOURCE_LIST) need[r] = 1 + Math.max(0, 1 - c.stock[r] / (ctx.reserve[r] * 3 + 1));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const from of ctx.net.keys()) {
    const a = w.galaxy.systems[from]!;
    for (const opt of linkOptions(w.galaxy, a, rctx)) {
      const id = opt.to.id;
      if (ctx.net.has(id) || seen.has(id)) continue;
      const st = w.systems[id]!;
      if (st.owner && st.owner !== c.id && !isAlly(w, c.id, st.owner)) continue;
      seen.add(id);
      const b = opt.to;
      const kindBonus = b.kind === 'pulsar' ? 1.4 : b.kind === 'beacon' ? 2 : 1;
      const score = (need[b.resource] * (1 + b.slots * 0.3) * kindBonus) / (1 + opt.verdict.cost.metal / 20);
      out.push({ a: from, b: id, score, cost: opt.verdict.cost, upkeep: opt.verdict.upkeep });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

function decideExpansion(ctx: Ctx): void {
  const { w, c, p } = ctx;
  if (ctx.rng.next() > p.expansion) return;
  const pending = colonyRelays(w, c.id).filter((r) => r.readyAt > w.time).length;
  if (pending >= 2) return;
  const cands = expansionCandidates(ctx);
  // Budget: the network after this relay must still be paid for by last hour's energy income.
  const active = colonyRelays(w, c.id).filter((r) => relayActive(r, w.time));
  const income = c.avgProduced.energy;
  for (const cand of cands.slice(0, 5)) {
    if (!canAfford(ctx, cand.cost)) continue;
    const projected = networkUpkeep([...active, { id: '', a: '', b: '', owner: c.id, length: 0, upkeep: cand.upkeep, readyAt: 0, cutUntil: 0 }]);
    if (w.drawIndex >= 0 && projected > income * 0.8) { ctx.notes.push('expansion capped by energy income'); break; }
    ctx.out.push({ type: 'build_relay', a: cand.a, b: cand.b });
    ctx.notes.push(`expand to ${w.galaxy.systems[cand.b]!.name}`);
    return;
  }
  // Nothing in range: an amplifier on the frontier opens new options.
  if (cands.length === 0 && canAfford(ctx, B.BUILDING_COST.amplifier)) {
    const frontier = ctx.productive.find((id) => !hasBuilding(w, id, 'amplifier') && w.systems[id]!.buildings.length < slotsOf(w, w.galaxy.systems[id]!));
    if (frontier) ctx.out.push({ type: 'build', system: frontier, building: 'amplifier' });
  }
}

function freeSlot(ctx: Ctx, id: string): boolean {
  const st = ctx.w.systems[id]!;
  return st.buildings.length + st.buildQueue.length < slotsOf(ctx.w, ctx.w.galaxy.systems[id]!);
}

function decideBuildings(ctx: Ctx, threatened: boolean): void {
  const { w, c, p } = ctx;
  const queued = ctx.owned.reduce((s, id) => s + w.systems[id]!.buildQueue.length, 0);
  if (queued >= 2) return;
  // Extractors on the best connected systems first.
  const byYield = ctx.productive.filter((id) => !hasBuilding(w, id, 'extractor') && freeSlot(ctx, id) && !w.systems[id]!.buildQueue.some((j) => j.building === 'extractor'));
  if (byYield.length && canAfford(ctx, B.BUILDING_COST.extractor)) {
    ctx.out.push({ type: 'build', system: byYield[0]!, building: 'extractor' });
    return;
  }
  const capital = c.capital;
  if (!hasBuilding(w, capital, 'shipyard') && (p.aggression > 0 || threatened) && freeSlot(ctx, capital) && canAfford(ctx, B.BUILDING_COST.shipyard) && !w.systems[capital]!.buildQueue.some((j) => j.building === 'shipyard')) {
    ctx.out.push({ type: 'build', system: capital, building: 'shipyard' });
    return;
  }
  if (threatened || p.defendFirst.length) {
    const bridges = findBridges(Object.values(w.relays), c.id, w.time);
    const endpoints = new Set<string>();
    for (const rid of bridges) { const r = w.relays[rid]!; endpoints.add(r.a); endpoints.add(r.b); }
    for (const id of [...p.defendFirst, capital, ...endpoints]) {
      if (!ctx.productive.includes(id) || hasBuilding(w, id, 'bastion') || !freeSlot(ctx, id)) continue;
      if (w.systems[id]!.buildQueue.some((j) => j.building === 'bastion')) continue;
      if (canAfford(ctx, B.BUILDING_COST.bastion)) { ctx.out.push({ type: 'build', system: id, building: 'bastion' }); return; }
    }
  }
  if (!hasBuilding(w, capital, 'antenna') && freeSlot(ctx, capital) && canAfford(ctx, B.BUILDING_COST.antenna) && !w.systems[capital]!.buildQueue.some((j) => j.building === 'antenna')) {
    ctx.out.push({ type: 'build', system: capital, building: 'antenna' });
    return;
  }
  if (!hasBuilding(w, capital, 'tradepost') && c.credits < 100 && freeSlot(ctx, capital) && canAfford(ctx, B.BUILDING_COST.tradepost) && !w.systems[capital]!.buildQueue.some((j) => j.building === 'tradepost')) {
    ctx.out.push({ type: 'build', system: capital, building: 'tradepost' });
  }
}

function hostileNeighbours(ctx: Ctx): Colony[] {
  const { w, c } = ctx;
  const mine = w.galaxy.sectors[w.galaxy.systems[c.capital]!.sector]!.hex;
  return Object.values(w.colonies).filter((o) => {
    if (o.id === c.id || isAlly(w, c.id, o.id) || atPeace(w, c.id, o.id) || isShielded(w, o)) return false;
    if (ctx.p.neverAttack.includes(o.id) || (o.alliance && ctx.p.neverAttack.includes(o.alliance))) return false;
    const h = w.galaxy.sectors[w.galaxy.systems[o.capital]!.sector]!.hex;
    return hexDistance(mine, h) <= 3;
  });
}

function fleetStrength(w: World, colonyId: string): number {
  return Object.values(w.fleets).filter((f) => f.owner === colonyId).reduce((s, f) => s + fleetSize(f.units), 0);
}

function decideMilitary(ctx: Ctx, threatened: boolean): void {
  const { w, c, p } = ctx;
  const capital = c.capital;
  const myStrength = fleetStrength(w, c.id);
  if (hasBuilding(w, capital, 'shipyard') && w.systems[capital]!.trainQueue.length === 0) {
    const want = threatened ? 'frigate' : p.aggression >= 0.5 && ctx.rng.next() < 0.4 ? 'cruiser' : p.aggression > 0.3 ? 'corvette' : 'frigate';
    const cost = B.UNIT_COST[want];
    const batch = 4;
    const total: Partial<Stock> = {};
    for (const r of B.RESOURCE_LIST) if (cost[r]) total[r] = cost[r]! * batch;
    if (myStrength < 12 + p.aggression * 30 && canAfford(ctx, total)) ctx.out.push({ type: 'train', system: capital, unit: want, count: batch });
  }
  const idle = Object.values(w.fleets).filter((f) => f.owner === c.id && f.at !== null && f.order.kind === 'idle');
  const besieged = ctx.owned.find((id) => w.systems[id]!.blockade && !isAlly(w, w.systems[id]!.blockade!.by, c.id));
  for (const f of idle) {
    if (besieged && fleetSize(f.units) >= 4) {
      ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'defend', target: besieged });
      ctx.notes.push('lift blockade');
      continue;
    }
    if (f.at !== capital && f.at !== null) {
      // Come home after a raid, or hold a defended system.
      if (!p.defendFirst.includes(f.at)) ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'return', target: capital });
      continue;
    }
    if (isShielded(w, c) || p.aggression <= 0 || ctx.rng.next() > p.aggression * 0.15) continue;
    if (fleetSize(f.units) < 6) continue;
    const targets = hostileNeighbours(ctx).filter((o) => fleetStrength(w, o.id) < fleetSize(f.units) && colonyScore(w, c) <= B.BULLY_SCORE_RATIO * Math.max(1, colonyScore(w, o)));
    if (!targets.length) continue;
    const victim = ctx.rng.pick(targets);
    // Cruisers besiege; everything else cuts relays, bridges first.
    if (f.units.cruiser >= 4 && ctx.rng.next() < 0.6) {
      const prey = ownedSystems(w, victim.id).filter((id) => id !== victim.capital && !w.systems[id]!.blockade);
      if (prey.length) {
        const target = ctx.rng.pick(prey);
        ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'blockade', target });
        ctx.notes.push(`blockade ${victim.name}`);
        continue;
      }
    }
    const bridges = findBridges(Object.values(w.relays), victim.id, w.time);
    const relays = colonyRelays(w, victim.id).filter((r) => relayActive(r, w.time));
    if (!relays.length) continue;
    const target = relays.find((r) => bridges.has(r.id)) ?? ctx.rng.pick(relays);
    ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'raid', target: target.id });
    ctx.notes.push(`raid ${victim.name}`);
  }
}

function decideDiplomacy(ctx: Ctx): void {
  const { w, c, p } = ctx;
  // Accept peace and trade proposals when not aggressive; accept everything from trusted traders.
  for (const prop of w.proposals) {
    if (prop.to !== c.id) continue;
    const trusted = p.trustedTraders.includes(prop.from);
    if (prop.kind === 'nap' && (p.aggression < 0.4 || trusted)) ctx.out.push({ type: 'treaty', with: prop.from, kind: 'nap' });
    if ((prop.kind === 'trade' || prop.kind === 'transit') && (trusted || p.aggression < 0.6)) ctx.out.push({ type: 'treaty', with: prop.from, kind: prop.kind });
  }
  // Join an alliance you were invited to when it shares your faction or an ally.
  if (!c.alliance) {
    for (const a of Object.values(w.alliances)) {
      if (!a.invites.includes(c.id)) continue;
      const leader = w.colonies[a.leader];
      if (leader && (leader.faction === c.faction || p.trustedTraders.includes(leader.id))) { ctx.out.push({ type: 'alliance_join', alliance: a.id }); break; }
    }
  }
  if (c.npc && ctx.rng.next() < 0.02) {
    const a = c.alliance ? w.alliances[c.alliance] : undefined;
    if (!a && ctx.rng.next() < 0.3) ctx.out.push({ type: 'alliance_create', name: `${c.name} Compact` });
    else if (a && a.leader === c.id && a.members.length < 12) {
      const cand = Object.values(w.colonies).find((o) => !o.alliance && o.faction === c.faction && !a.invites.includes(o.id) && hexDistance(w.galaxy.sectors[w.galaxy.systems[o.capital]!.sector]!.hex, w.galaxy.sectors[w.galaxy.systems[c.capital]!.sector]!.hex) <= 4);
      if (cand) ctx.out.push({ type: 'alliance_invite', colony: cand.id });
    }
    if (p.aggression < 0.3 && c.influence >= 3 * B.TREATY_COST_INFLUENCE.nap) {
      const n = hostileNeighbours(ctx).filter((o) => fleetStrength(w, o.id) > fleetStrength(w, c.id) && !w.proposals.some((pr) => pr.from === c.id && pr.to === o.id));
      if (n.length) ctx.out.push({ type: 'treaty', with: ctx.rng.pick(n).id, kind: 'nap' });
    }
  }
}

function decideBeacon(ctx: Ctx): void {
  const { w, c } = ctx;
  for (const id of ctx.productive) {
    const sys: StarSystem = w.galaxy.systems[id]!;
    if (sys.kind === 'beacon' && !w.litBeacons[id] && c.stock.crystal >= B.BEACON_CRYSTAL) ctx.out.push({ type: 'light_beacon', system: id });
  }
}

/** What the General does for `colony` at this decision tick. Pure: returns commands, applies nothing. */
export function decide(w: World, colony: Colony, tickIndex: number): Decision {
  const p = colony.policy;
  const net = colonyNetwork(w, colony);
  const owned = ownedSystems(w, colony.id);
  const productive = owned.filter((id) => net.has(id));
  const ctx: Ctx = {
    w, c: colony, p, net, owned, productive,
    reserve: reserves(w, colony, p, productive),
    rng: createRng(subSeed(w.seed, 'general', colony.id, tickIndex)),
    out: [], notes: [],
  };
  const recentlyHit = w.events.slice(-200).some((e) => (e.kind === 'relay.cut' || e.kind === 'blockade.start' || e.kind === 'battle') && e.actors[1] === colony.id && w.time - e.at < 12 * 3600);
  const enemyNear = Object.values(w.fleets).some((f) => f.owner !== colony.id && !isAlly(w, f.owner, colony.id) && f.at !== null && owned.includes(f.at));
  const threatened = recentlyHit || enemyNear || fleetsAt(w, colony.capital).some((f) => f.owner !== colony.id && !isAlly(w, f.owner, colony.id));

  decideMarket(ctx);
  decideBuildings(ctx, threatened);
  decideExpansion(ctx);
  decideMilitary(ctx, threatened);
  decideDiplomacy(ctx);
  decideBeacon(ctx);
  return { commands: ctx.out, notes: ctx.notes };
}

/** Convenience for headless runs: decide and apply, returning how many commands succeeded. */
export function runGeneral(w: World, colony: Colony, tickIndex: number, applyFn: (w: World, id: string, cmd: Command) => { ok: boolean }): number {
  const d = decide(w, colony, tickIndex);
  let ok = 0;
  for (const cmd of d.commands) if (applyFn(w, colony.id, cmd).ok) ok++;
  return ok;
}


