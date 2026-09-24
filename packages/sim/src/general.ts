// The deterministic rule engine that executes a Policy. Both NPC colonies and players'
// Generals run this; the LLM only writes the Policy and narrates. No randomness beyond a
// seeded stream per colony and decision tick, so a season replays bit-for-bit.
import type { Command, Policy, Resource, Stock } from '@aurane/protocol';
import { COMBAT_UNITS } from '@aurane/protocol';
import * as B from './balance.js';
import type { StarSystem } from './galaxy.js';
import { hexDistance } from './hex.js';
import { findBridges, linkOptions, relayActive } from './network.js';
import { createRng, subSeed } from './rng.js';
import { combatSize, fleetSize, type Colony, type FleetState, type World } from './state.js';
import { atPeace, isAlly } from './diplomacy.js';
import { armedHostilesPresent, fleetHpFraction, plateauIndex, plateauKey } from './battle.js';
import { RELAY_KINDS, layoutOf, pathInSystem } from './pois.js';
import { planPath } from './routing.js';
import { capacityOf, freeSlotsOnOrbit, hasStructure } from './structures.js';
import {
  colonyNetwork, colonyRelays, colonyScore, hasBuilding, isShielded, networkUpkeep, offNetRium, ownedSystems, rangeContext,
  reachableRegions, routeLimit, stockHas,
} from './world.js';

export interface Decision { commands: Command[]; notes: string[] }

interface Ctx {
  w: World;
  c: Colony;
  p: Policy;
  net: Map<string, number>;
  owned: string[];
  productive: string[];
  /** Stock at the market system (the capital by default): what the General trades and budgets with. */
  home: Stock;
  reserve: Stock;
  rng: ReturnType<typeof createRng>;
  out: Command[];
  notes: string[];
}

const BASE_PRICE: Record<Resource, number> = { metal: 1, energy: 1.5, food: 1, crystal: 6, rium: 3 };

/** Default reserves at the home system: energy for six hours of upkeep, food for the population. */
function reserves(w: World, c: Colony, p: Policy, productive: string[]): Stock {
  const upkeep = networkUpkeep(colonyRelays(w, c.id).filter((r) => relayActive(r, w.time)));
  const pop = productive.reduce((s, id) => s + w.systems[id]!.population, 0);
  return {
    metal: p.reserves.metal ?? 80,
    energy: p.reserves.energy ?? Math.max(60, Math.ceil(upkeep * 3)),
    food: p.reserves.food ?? Math.max(40, Math.ceil(pop * B.POP_FOOD_PER_UNIT * 20 * 6)),
    crystal: p.reserves.crystal ?? 20,
    rium: p.reserves.rium ?? 40,
  };
}

const spare = (ctx: Ctx, r: Resource): number => ctx.home[r] - ctx.reserve[r];

function canAffordAt(ctx: Ctx, systemId: string, cost: Partial<Record<Resource, number | undefined>>): boolean {
  const st = ctx.w.systems[systemId]!;
  const home = systemId === ctx.c.marketSystem;
  for (const r of B.RESOURCE_LIST) {
    const keep = home ? ctx.reserve[r] : 40;
    if ((cost[r] ?? 0) > st.stock[r] - keep) return false;
  }
  return true;
}

function lastPrice(w: World, region: string, r: Resource): number | null {
  const c = w.lastClearing.find((x) => x.region === region && x.resource === r);
  return c ? c.price : null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Accept fair incoming barters; offer surplus-for-need to allies and neighbours. */
function decideBarter(ctx: Ctx): void {
  const { w, c, p } = ctx;
  const value = (st: Partial<Record<Resource, number | undefined>>): number => B.RESOURCE_LIST.reduce((s, r) => s + (st[r] ?? 0) * BASE_PRICE[r], 0);
  for (const b of Object.values(w.barters)) {
    if (b.to !== c.id || b.accepted) continue;
    const trusted = p.trustedTraders.includes(b.from) || isAlly(w, c.id, b.from);
    const fair = value(b.give) >= value(b.want) * (trusted ? 0.7 : 0.9);
    const affordable = B.RESOURCE_LIST.every((r) => (b.want[r] ?? 0) <= Math.max(0, ctx.home[r] - ctx.reserve[r] * 0.5));
    if (fair && affordable) ctx.out.push({ type: 'barter_accept', offer: b.id });
  }
  if (Object.values(w.barters).some((b) => b.from === c.id)) return;
  const surplus = B.RESOURCE_LIST.filter((r) => spare(ctx, r) > ctx.reserve[r]).sort((a, b) => spare(ctx, b) / BASE_PRICE[b] - spare(ctx, a) / BASE_PRICE[a])[0];
  const need = B.RESOURCE_LIST.filter((r) => spare(ctx, r) < 0).sort((a, b) => spare(ctx, a) - spare(ctx, b))[0];
  if (!surplus || !need || ctx.rng.next() > 0.5) return;
  const partners = Object.values(w.colonies).filter((o) => o.id !== c.id && (isAlly(w, c.id, o.id) || p.trustedTraders.includes(o.id) || hexDistance(w.galaxy.sectors[w.galaxy.systems[o.capital]!.sector]!.hex, w.galaxy.sectors[w.galaxy.systems[c.capital]!.sector]!.hex) <= 2));
  if (!partners.length) return;
  const to = ctx.rng.pick(partners);
  const wantQty = Math.min(Math.ceil(-spare(ctx, need)), 60);
  const giveQty = Math.min(Math.floor(spare(ctx, surplus) * 0.5), Math.ceil((wantQty * BASE_PRICE[need]) / BASE_PRICE[surplus] * 1.05));
  if (giveQty < 1 || wantQty < 1) return;
  ctx.out.push({ type: 'barter_offer', to: to.id, give: { [surplus]: giveQty }, want: { [need]: wantQty } });
  ctx.notes.push(`barter with ${to.name}`);
}

function decideMarket(ctx: Ctx): void {
  const { w, c, p } = ctx;
  decideBarter(ctx);
  for (const o of Object.values(w.orders)) if (o.colony === c.id) return; // one round of orders per draw
  const regions = [...reachableRegions(w, c)];
  if (!regions.length) return;
  const home = w.galaxy.systems[c.marketSystem]!.region;
  const region = regions.includes(home) ? home : regions[0]!;
  for (const r of B.RESOURCE_LIST) {
    const ref = lastPrice(w, region, r) ?? BASE_PRICE[r];
    const cap = capacityOf(w, c.marketSystem);
    // Sell what would overflow the warehouse first, then a share of the surplus.
    const surplus = Math.max(spare(ctx, r) - ctx.reserve[r] * 0.5, ctx.home[r] - cap * 0.85);
    if (surplus >= 20) {
      const floor = p.sellAbove[r] ?? ref * 0.85;
      const qty = Math.floor(Math.min(surplus * 0.6, ctx.home[r] * 0.5));
      if (qty > 0) ctx.out.push({ type: 'market_order', region, resource: r, side: 'sell', qty, price: round2(Math.max(0.1, floor)) });
    } else if (spare(ctx, r) < 0 && c.credits > 20) {
      const capPrice = p.buyBelow[r] ?? ref * 1.2;
      const qty = Math.max(1, Math.min(Math.ceil(-spare(ctx, r)), Math.floor((c.credits * 0.5) / capPrice)));
      if (qty > 0) ctx.out.push({ type: 'market_order', region, resource: r, side: 'buy', qty, price: round2(capPrice) });
    }
  }
}

interface Candidate { a: string; b: string; score: number; cost: Partial<Stock>; upkeep: number }

function expansionCandidates(ctx: Ctx): Candidate[] {
  const { w, c } = ctx;
  const rctx = rangeContext(w, c);
  const need: Record<Resource, number> = { metal: 1, energy: 1, food: 1, crystal: 1, rium: 1 };
  for (const r of B.RESOURCE_LIST) need[r] = 1 + Math.max(0, 1 - ctx.home[r] / (ctx.reserve[r] * 3 + 1));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const from of ctx.net.keys()) {
    if (w.systems[from]!.owner !== c.id) continue;
    const a = w.galaxy.systems[from]!;
    for (const opt of linkOptions(w.galaxy, a, rctx)) {
      const id = opt.to.id;
      if (ctx.net.has(id) || seen.has(id)) continue;
      const st = w.systems[id]!;
      if (st.owner && st.owner !== c.id && !isAlly(w, c.id, st.owner)) continue;
      if (!canAffordAt(ctx, from, opt.verdict.cost)) continue;
      seen.add(id);
      const b = opt.to;
      const kindBonus = b.kind === 'pulsar' ? 1.4 : b.kind === 'beacon' ? 2 : 1;
      // A gas giant is a refinery site: worth reaching for, more so when fuel is short and none is held yet.
      const gasBonus = layoutOf(w.galaxy, id).pois.some((q) => q.kind === 'gas') ? (ctx.p.fuel === 'refinery' ? 1.8 : ctx.owned.some((o) => hasBuilding(w, o, 'refinery')) ? 1.15 : 1.4) : 1;
      const score = (need[b.resource] * (1 + b.slots * 0.3) * kindBonus * gasBonus) / (1 + opt.verdict.cost.metal / 20);
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
  const active = colonyRelays(w, c.id).filter((r) => relayActive(r, w.time));
  const income = c.avgProduced.energy;
  for (const cand of cands.slice(0, 5)) {
    const projected = networkUpkeep([...active, { id: '', a: '', b: '', owner: c.id, length: 0, upkeep: cand.upkeep, readyAt: 0, cutUntil: 0 }]);
    if (w.drawIndex >= 0 && projected > income * 0.8) { ctx.notes.push('expansion capped by energy income'); break; }
    ctx.out.push({ type: 'build_relay', a: cand.a, b: cand.b });
    ctx.notes.push(`expand to ${w.galaxy.systems[cand.b]!.name}`);
    return;
  }
  if (cands.length === 0) {
    const frontier = ctx.productive.find((id) => !hasBuilding(w, id, 'amplifier') && freeSlotsOnOrbit(w, w.galaxy.systems[id]!, 3) > 0 && canAffordAt(ctx, id, B.BUILDING_COST.amplifier));
    if (frontier) ctx.out.push({ type: 'build', system: frontier, building: 'amplifier' });
  }
}

function queuedAt(ctx: Ctx, id: string): number { return ctx.w.systems[id]!.buildQueue.length; }

function decideBuildings(ctx: Ctx, threatened: Set<string>): void {
  const { w, c, p } = ctx;
  const capital = c.capital;
  const totalQueued = ctx.owned.reduce((s, id) => s + queuedAt(ctx, id), 0);
  // Defence first: turrets where the shooting is, if the local warehouse can pay.
  for (const id of threatened) {
    const st = w.systems[id]!;
    const turrets = st.structures.filter((s) => s.kind in B.TURRET_STATS).length + st.buildQueue.filter((j) => j.building in B.TURRET_STATS).length;
    if (turrets >= p.autoTurrets || queuedAt(ctx, id) >= 2) continue;
    const sys = w.galaxy.systems[id]!;
    const hostiles = hostilesInSystem(w, id);
    const cruisers = hostiles.reduce((s, f) => s + f.units.cruiser, 0), corvettes = hostiles.reduce((s, f) => s + f.units.corvette, 0);
    const kind = cruisers > corvettes ? 'turret_heavy' : hostiles.some((f) => f.units.frigate > f.units.corvette) ? 'launcher' : 'turret_light';
    // Guns go where the invasion passes: the last point of interest before the station, else the station itself.
    const poi = approachPoi(w, id);
    const where = freeSlotsOnOrbit(w, sys, 2, poi) > 0 ? poi : st.mainPoi;
    if (freeSlotsOnOrbit(w, sys, 2, where) > 0 && canAffordAt(ctx, id, B.BUILDING_COST[kind])) { ctx.out.push({ type: 'build', system: id, building: kind, poi: where }); ctx.notes.push(`turret at ${sys.name}`); }
  }
  if (totalQueued >= 2) return;
  // A second relay on another body keeps the Network up when the station falls: capital first, then rich systems.
  for (const id of [capital, ...ctx.productive.filter((x) => x !== capital)]) {
    const st = w.systems[id]!;
    if (st.structures.some((x) => x.kind === 'relay') || st.buildQueue.some((j) => j.building === 'relay')) continue;
    if (id !== capital && !(threatened.has(id) || st.stock.metal > 250)) continue;
    const layout = layoutOf(w.galaxy, id);
    const spot = layout.pois.find((q) => q.id !== st.mainPoi && RELAY_KINDS.has(q.kind) && freeSlotsOnOrbit(w, w.galaxy.systems[id]!, 3, q.id) > 0);
    if (spot && canAffordAt(ctx, id, B.BUILDING_COST.relay) && (id !== capital || w.drawIndex >= 6)) { ctx.out.push({ type: 'build', system: id, building: 'relay', poi: spot.id }); ctx.notes.push(`backup relay at ${w.galaxy.systems[id]!.name}`); return; }
  }
  // Warehouses before anything overflows.
  for (const id of ctx.productive) {
    const st = w.systems[id]!;
    const cap = capacityOf(w, id);
    const full = B.RESOURCE_LIST.some((r) => st.stock[r] > cap * 0.9);
    if (full && freeSlotsOnOrbit(w, w.galaxy.systems[id]!, 1) > 0 && canAffordAt(ctx, id, B.BUILDING_COST.warehouse) && !st.buildQueue.some((j) => j.building === 'warehouse')) {
      ctx.out.push({ type: 'build', system: id, building: 'warehouse' });
      return;
    }
  }
  // Fuel: a refinery wherever a gas giant has a free industry slot; without one, a synthesizer at home once Rium runs short.
  for (const id of ctx.productive) {
    const st = w.systems[id]!;
    if (st.buildQueue.some((j) => j.building === 'refinery')) continue;
    const gas = layoutOf(w.galaxy, id).pois.find((q) => q.kind === 'gas' && !st.structures.some((x) => x.kind === 'refinery' && x.poi === q.id) && freeSlotsOnOrbit(w, w.galaxy.systems[id]!, 1, q.id) > 0);
    if (gas && canAffordAt(ctx, id, B.BUILDING_COST.refinery)) { ctx.out.push({ type: 'build', system: id, building: 'refinery', poi: gas.id }); ctx.notes.push(`refinery at ${w.galaxy.systems[id]!.name}`); return; }
  }
  const wantSynth = p.fuel === 'synthesizer' ? true : p.fuel === 'refinery' ? false : ctx.home.rium < ctx.reserve.rium * 2 && !ctx.owned.some((id) => hasBuilding(w, id, 'refinery'));
  if (!hasBuilding(w, capital, 'synthesizer') && wantSynth
    && freeSlotsOnOrbit(w, w.galaxy.systems[capital]!, 1) > 0 && canAffordAt(ctx, capital, B.BUILDING_COST.synthesizer) && !w.systems[capital]!.buildQueue.some((j) => j.building === 'synthesizer')) {
    ctx.out.push({ type: 'build', system: capital, building: 'synthesizer' }); return;
  }
  const byYield = ctx.productive.filter((id) => !hasBuilding(w, id, 'extractor') && freeSlotsOnOrbit(w, w.galaxy.systems[id]!, 1) > 0 && !w.systems[id]!.buildQueue.some((j) => j.building === 'extractor') && canAffordAt(ctx, id, B.BUILDING_COST.extractor));
  if (byYield.length) { ctx.out.push({ type: 'build', system: byYield[0]!, building: 'extractor' }); return; }
  if (!hasBuilding(w, capital, 'shipyard') && freeSlotsOnOrbit(w, w.galaxy.systems[capital]!, 2) > 0 && canAffordAt(ctx, capital, B.BUILDING_COST.shipyard) && !w.systems[capital]!.buildQueue.some((j) => j.building === 'shipyard')) {
    ctx.out.push({ type: 'build', system: capital, building: 'shipyard' });
    return;
  }
  if (threatened.size || p.defendFirst.length) {
    const bridges = findBridges(Object.values(w.relays), c.id, w.time);
    const endpoints = new Set<string>();
    for (const rid of bridges) { const r = w.relays[rid]!; endpoints.add(r.a); endpoints.add(r.b); }
    for (const id of [...p.defendFirst, capital, ...endpoints]) {
      if (!ctx.productive.includes(id) || hasBuilding(w, id, 'bastion') || freeSlotsOnOrbit(w, w.galaxy.systems[id]!, 2) <= 0) continue;
      if (w.systems[id]!.buildQueue.some((j) => j.building === 'bastion')) continue;
      if (canAffordAt(ctx, id, B.BUILDING_COST.bastion)) { ctx.out.push({ type: 'build', system: id, building: 'bastion' }); return; }
    }
  }
  if (!hasBuilding(w, capital, 'antenna') && freeSlotsOnOrbit(w, w.galaxy.systems[capital]!, 3) > 0 && canAffordAt(ctx, capital, B.BUILDING_COST.antenna) && !w.systems[capital]!.buildQueue.some((j) => j.building === 'antenna')) {
    ctx.out.push({ type: 'build', system: capital, building: 'antenna' });
    return;
  }
  if (!hasBuilding(w, capital, 'tradepost') && c.credits < 100 && freeSlotsOnOrbit(w, w.galaxy.systems[capital]!, 1) > 0 && canAffordAt(ctx, capital, B.BUILDING_COST.tradepost) && !w.systems[capital]!.buildQueue.some((j) => j.building === 'tradepost')) {
    ctx.out.push({ type: 'build', system: capital, building: 'tradepost' });
  }
}

/** Keep outposts supplied: a route from the capital when an owned system runs short of what it needs to build or fight. */
function decideLogistics(ctx: Ctx): void {
  const { w, c } = ctx;
  const mine = Object.values(w.routes).filter((r) => r.owner === c.id);
  let routes = mine.length;
  const limit = routeLimit(w, c);
  const routeKeys = new Set(mine.map((r) => `${r.from}>${r.to}:${r.resource}`));
  const cargos = Object.values(w.fleets).filter((f) => f.owner === c.id && f.units.cargo > 0).reduce((s, f) => s + f.units.cargo, 0);
  // Cargos are the bloodstream: keep a few at the capital.
  const cap = w.systems[c.capital]!;
  if (cargos < 2 + Math.floor(ctx.productive.length / 3) && hasStructure(cap, 'shipyard') && cap.trainQueue.length === 0 && canAffordAt(ctx, c.capital, { metal: B.UNIT_COST.cargo.metal! * 2, food: B.UNIT_COST.cargo.food! * 2 })) {
    ctx.out.push({ type: 'train', system: c.capital, unit: 'cargo', count: 2 });
  }
  // Refinery depots: a cargo shuttle per depot, and a route bringing the fuel home.
  for (const id of ctx.owned) {
    const st = w.systems[id]!;
    for (const s of st.structures) {
      if (s.kind !== 'refinery' || s.poi === st.mainPoi || (w.depots[s.poi] ?? 0) < 80) continue;
      const served = Object.values(w.fleets).some((f) => f.owner === c.id && f.units.cargo > 0 && (f.shuttle === s.poi || (f.at === id && f.poi === s.poi)));
      if (served) continue;
      const cargo = Object.values(w.fleets).find((f) => f.owner === c.id && f.units.cargo > 0 && combatSize(f.units) === 0 && f.order.kind === 'idle' && f.at === id)
        ?? Object.values(w.fleets).find((f) => f.owner === c.id && f.units.cargo > 0 && combatSize(f.units) === 0 && f.order.kind === 'idle' && f.at === c.capital);
      if (!cargo) continue;
      const designation = layoutOf(w.galaxy, id).pois.find((q) => q.id === s.poi)?.designation;
      if (designation) { ctx.out.push({ type: 'fleet_order', fleet: cargo.id, order: 'move', target: `${id}:${designation}` }); ctx.notes.push(`shuttle to ${w.galaxy.systems[id]!.name}`); }
    }
    if (id !== c.capital && st.structures.some((s) => s.kind === 'refinery') && st.stock.rium > 150 && routes < limit && !routeKeys.has(`${id}>${c.capital}:rium`)) {
      routes++; routeKeys.add(`${id}>${c.capital}:rium`); ctx.out.push({ type: 'route_set', from: id, to: c.capital, resource: 'rium', perTrip: 120, whenBelow: 400 });
    }
  }
  // Explicit resupply to threatened or building systems that are short of metal/energy.
  for (const id of ctx.productive) {
    if (id === c.capital) continue;
    const st = w.systems[id]!;
    const short = (['metal', 'energy'] as const).filter((r) => st.stock[r] < 60 && cap.stock[r] > ctx.reserve[r] + 150);
    for (const r of short) {
      const exists = routeKeys.has(`${c.capital}>${id}:${r}`);
      if (!exists && routes < limit) { routes++; routeKeys.add(`${c.capital}>${id}:${r}`); ctx.out.push({ type: 'route_set', from: c.capital, to: id, resource: r, perTrip: 120, whenBelow: 150 }); }
    }
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
  return Object.values(w.fleets).filter((f) => f.owner === colonyId).reduce((s, f) => s + combatSize(f.units), 0);
}

function decideMilitary(ctx: Ctx, threatened: Set<string>): void {
  const { w, c, p } = ctx;
  const capital = c.capital;
  const myStrength = fleetStrength(w, c.id);
  const cap = w.systems[capital]!;
  if (hasStructure(cap, 'shipyard') && cap.trainQueue.length === 0) {
    const want = threatened.size ? 'frigate' : p.aggression >= 0.5 && ctx.rng.next() < 0.4 ? 'cruiser' : p.aggression > 0.3 ? 'corvette' : 'frigate';
    const cost = B.UNIT_COST[want];
    const batch = 4;
    const total: Partial<Stock> = {};
    for (const r of B.RESOURCE_LIST) if (cost[r]) total[r] = cost[r]! * batch;
    if (myStrength < 12 + p.aggression * 30 && canAffordAt(ctx, capital, total)) ctx.out.push({ type: 'train', system: capital, unit: want, count: batch });
  }
  const mine = Object.values(w.fleets).filter((f) => f.owner === c.id && f.at !== null && combatSize(f.units) > 0);
  // Retreat badly hurt fleets that are away from home.
  for (const f of mine) {
    if (f.pos !== null && fleetHpFraction(f) < p.retreatBelow && f.at !== capital && (f.order.kind === 'raid' || f.order.kind === 'blockade')) {
      ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'return', target: capital });
      ctx.notes.push('retreat');
    }
  }
  const idle = mine.filter((f) => f.order.kind === 'idle');
  const besieged = [...threatened][0];
  for (const f of idle) {
    if (besieged && f.at !== besieged && combatSize(f.units) >= 4) {
      ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'defend', target: besieged });
      ctx.notes.push('relieve');
      continue;
    }
    if (f.at !== capital && f.at !== null && !p.defendFirst.includes(f.at)) {
      ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'return', target: capital });
      continue;
    }
    if (isShielded(w, c) || p.aggression <= 0 || ctx.rng.next() > p.aggression * 0.25) continue;
    if (combatSize(f.units) < 6) continue;
    const targets = hostileNeighbours(ctx).filter((o) => fleetStrength(w, o.id) < combatSize(f.units) && colonyScore(w, c) <= B.BULLY_SCORE_RATIO * Math.max(1, colonyScore(w, o)));
    if (!targets.length) continue;
    const victim = ctx.rng.pick(targets);
    // The sortie must be fuelled: energy for the trip out and back, on top of the home reserve.
    const fuelFor = (to: string): boolean => {
      const plan = planPath(w, c, f.at!, to);
      const need = plan.onNet ? 0 : 2 * offNetRium(plan.length, f.units);
      return w.systems[f.at!]!.stock.rium - (f.at === capital ? ctx.reserve.rium : 0) >= need;
    };
    if (!fuelFor(victim.capital)) { ctx.notes.push('no fuel'); continue; }
    const prey = ownedSystems(w, victim.id).filter((id) => id !== victim.capital && !w.systems[id]!.blockade);
    // A siege needs weight (a fleet of 8+) and picks the least defended system.
    const defences = (id: string): number => w.systems[id]!.structures.filter((s) => s.kind in B.TURRET_STATS && s.hp > 0).length;
    if (combatSize(f.units) >= 8 && prey.length && ctx.rng.next() < 0.6) {
      const weakest = prey.reduce((a, b) => (defences(b) < defences(a) ? b : a));
      ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'blockade', target: weakest });
      ctx.notes.push(`blockade ${victim.name}`);
      continue;
    }
    // Raid the station of a bridge endpoint: cutting it splits the victim's network.
    const bridges = findBridges(Object.values(w.relays), victim.id, w.time);
    const relays = colonyRelays(w, victim.id).filter((r) => relayActive(r, w.time));
    if (!relays.length && !prey.length) continue;
    const relay = relays.find((r) => bridges.has(r.id)) ?? (relays.length ? ctx.rng.pick(relays) : null);
    const targetSystem = relay ? (w.systems[relay.a]!.owner === victim.id ? relay.a : relay.b) : ctx.rng.pick(prey);
    ctx.out.push({ type: 'fleet_order', fleet: f.id, order: 'raid', target: targetSystem });
    ctx.notes.push(`raid ${victim.name}`);
  }
}

function decideDiplomacy(ctx: Ctx): void {
  const { w, c, p } = ctx;
  for (const prop of w.proposals) {
    if (prop.to !== c.id) continue;
    const trusted = p.trustedTraders.includes(prop.from);
    if (prop.kind === 'nap' && (p.aggression < 0.4 || trusted)) ctx.out.push({ type: 'treaty', with: prop.from, kind: 'nap' });
    if ((prop.kind === 'trade' || prop.kind === 'transit') && (trusted || p.aggression < 0.6)) ctx.out.push({ type: 'treaty', with: prop.from, kind: prop.kind });
  }
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
    if (sys.kind !== 'beacon' || w.litBeacons[id]) continue;
    const st = w.systems[id]!;
    if (st.stock.crystal >= B.BEACON_CRYSTAL) ctx.out.push({ type: 'light_beacon', system: id });
    else if (w.systems[c.capital]!.stock.crystal > B.BEACON_CRYSTAL * 0.5 && !Object.values(w.routes).some((r) => r.owner === c.id && r.to === id && r.resource === 'crystal')) {
      ctx.out.push({ type: 'route_set', from: c.capital, to: id, resource: 'crystal', perTrip: 240, whenBelow: B.BEACON_CRYSTAL });
    }
  }
}

/** Armed hostile fleets anywhere in a system (all points of interest). */
function hostilesInSystem(w: World, systemId: string): FleetState[] {
  const out: FleetState[] = [];
  for (const p of layoutOf(w.galaxy, systemId).pois) out.push(...armedHostilesPresent(w, systemId, p.id));
  return out;
}

/** The point of interest an invasion crosses last before the station. */
function approachPoi(w: World, systemId: string): string {
  const st = w.systems[systemId]!;
  const layout = layoutOf(w.galaxy, systemId);
  const jump = layout.jumps[0];
  if (!jump) return st.mainPoi;
  const { hops } = pathInSystem(layout, jump, st.mainPoi);
  return hops.length >= 2 ? hops[hops.length - 2]! : st.mainPoi;
}

/** Systems of this colony with hostiles on a plateau or a fresh blockade. */
function threatenedSystems(w: World, c: Colony, owned: string[]): Set<string> {
  const out = new Set<string>();
  const plateau = plateauIndex(w);
  for (const id of owned) {
    const st = w.systems[id]!;
    if (st.engaged || st.blockade) { out.add(id); continue; }
    for (const p of layoutOf(w.galaxy, id).pois) {
      const here = plateau.get(plateauKey(id, p.id));
      if (here && armedHostilesPresent(w, id, p.id, here).length) { out.add(id); break; }
    }
  }
  return out;
}

/** What the General does for `colony` at this decision tick. Pure: returns commands, applies nothing. */
export function decide(w: World, colony: Colony, tickIndex: number): Decision {
  const p = colony.policy;
  const net = colonyNetwork(w, colony);
  const owned = ownedSystems(w, colony.id);
  const productive = owned.filter((id) => net.has(id));
  const home = w.systems[colony.marketSystem]?.stock ?? B.emptyStock();
  const ctx: Ctx = {
    w, c: colony, p, net, owned, productive, home,
    reserve: reserves(w, colony, p, productive),
    rng: createRng(subSeed(w.seed, 'general', colony.id, tickIndex)),
    out: [], notes: [],
  };
  const threatened = threatenedSystems(w, colony, owned);
  const recentlyHit = w.events.slice(-200).some((e) => (e.kind === 'relay.cut' || e.kind === 'blockade.start' || e.kind === 'battle') && e.actors[1] === colony.id && w.time - e.at < 12 * 3600);
  if (recentlyHit && threatened.size === 0) threatened.add(colony.capital);

  decideMarket(ctx);
  decideBuildings(ctx, threatened);
  decideLogistics(ctx);
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

export const _unused = { COMBAT_UNITS, fleetSize, stockHas } as { COMBAT_UNITS: typeof COMBAT_UNITS; fleetSize: typeof fleetSize; stockHas: typeof stockHas; f?: FleetState };
