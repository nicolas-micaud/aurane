import type { Command, Resource, Stock } from '@aurane/protocol';
import * as B from './balance.js';
import { isAlly } from './diplomacy.js';
import { linkOptions } from './network.js';
import { commandTier } from './onboarding.js';
import { defaultOrbit, freeSlotsOnOrbit, hasStructure } from './structures.js';
import { combatSize, type Colony, type World } from './state.js';
import { colonyNetwork, colonyStockTotal, ownedSystems, rangeContext, reachableRegions, visibleSectors } from './world.js';

/**
 * The Draw Counsel (decision 0009): what the Partner proposes before the next Draw, computed by the simulation
 * alone. Each option is legal now, priced, carries the command ready to send and the screen to show. The General
 * phrases them in its voice (LLM layer) or the client falls back to fixed lines; nothing here needs a model.
 */
export type ShowTarget =
  | { kind: 'star'; system: string }
  | { kind: 'link'; from: string; to: string | null }
  | { kind: 'plateau'; system: string; orbit: 1 | 2 | 3 | null }
  | { kind: 'tab'; tab: 'colony' | 'logistics' | 'market' | 'fleets' | 'diplomacy' | 'general' | 'log' };

export type CounselKind =
  | 'link_first' | 'link_more' | 'warehouse' | 'antenna' | 'turret' | 'defend' | 'buy_energy' | 'sell_surplus'
  | 'train' | 'treaty' | 'doctrine' | 'read_recap';

export interface CounselOption {
  /** Stable within a Draw: `${kind}:${target}` so a skip can be remembered for the hour. */
  id: string;
  kind: CounselKind;
  /** 2 = a threat or the lights going out, 1 = money on the table, 0 = learning and housekeeping. */
  urgency: 0 | 1 | 2;
  /** Ready to send, or null when the option is right but the warehouse cannot pay yet. */
  command: Command | null;
  show: ShowTarget;
  cost: Partial<Stock>;
  /** Numbers and names the client or the General puts in the sentence. */
  params: Record<string, string | number>;
}

const affordable = (stock: Stock, cost: Partial<Stock>): boolean => B.RESOURCE_LIST.every((r) => (cost[r] ?? 0) <= stock[r]);

/** Cheapest relay the colony could build right now, from any connected system. */
function cheapestLink(w: World, c: Colony): { from: string; to: string; cost: Stock } | null {
  const net = colonyNetwork(w, c), rctx = rangeContext(w, c);
  let best: { from: string; to: string; cost: Stock } | null = null;
  for (const from of net.keys()) {
    for (const o of linkOptions(w.galaxy, w.galaxy.systems[from]!, rctx)) {
      const st = w.systems[o.to.id]!;
      if (net.has(o.to.id) || (st.owner && st.owner !== c.id && !isAlly(w, c.id, st.owner))) continue;
      if (w.relays[[from, o.to.id].sort().join('|')]) continue;
      if (!best || o.verdict.cost.metal < best.cost.metal) best = { from, to: o.to.id, cost: o.verdict.cost };
    }
  }
  return best;
}

export function counsel(w: World, c: Colony, max = 3): CounselOption[] {
  const out: CounselOption[] = [];
  const tier = c.onboarding.tier;
  const stock = colonyStockTotal(w, c.id);
  const capital = w.galaxy.systems[c.capital]!;
  const capStock = w.systems[c.capital]!.stock;
  const owned = ownedSystems(w, c.id);
  const net = colonyNetwork(w, c);
  const name = (id: string): string => w.galaxy.systems[id]?.name ?? id;
  const push = (o: CounselOption): void => { if (!o.command || commandTier(o.command) <= tier) out.push(o); };

  // A hostile warfleet heading for one of our systems: a turret there, or the idle fleet.
  const inbound = Object.values(w.fleets).find((f) => f.destination && owned.includes(f.destination) && f.owner !== c.id && !isAlly(w, c.id, f.owner) && combatSize(f.units) > 0);
  if (inbound?.destination) {
    const target = inbound.destination, sys = w.galaxy.systems[target]!;
    if (!w.systems[target]!.structures.some((s) => s.kind in B.TURRET_STATS && s.hp > 0) && freeSlotsOnOrbit(w, sys, defaultOrbit('turret_light')) > 0) {
      const cost = B.BUILDING_COST.turret_light;
      push({ id: `turret:${target}`, kind: 'turret', urgency: 2, cost, show: { kind: 'plateau', system: target, orbit: defaultOrbit('turret_light') },
        command: affordable(w.systems[target]!.stock, cost) ? { type: 'build', system: target, building: 'turret_light' } : null,
        params: { system: name(target), ships: combatSize(inbound.units), eta: Math.max(0, Math.round((inbound.arriveAt - w.time) / 60)) } });
    }
    const idle = Object.values(w.fleets).find((f) => f.owner === c.id && f.at && f.at !== target && combatSize(f.units) > 0 && f.order.kind !== 'convoy');
    if (idle?.at) push({ id: `defend:${target}`, kind: 'defend', urgency: 2, cost: {}, show: { kind: 'tab', tab: 'fleets' }, command: { type: 'fleet_order', fleet: idle.id, order: 'defend', target }, params: { system: name(target), ships: combatSize(idle.units) } });
  }

  // Energy for the relays: three Draws of upkeep in the warehouses, or the Network goes dark.
  const upkeep = Object.values(w.relays).filter((r) => r.owner === c.id).reduce((s, r) => s + r.upkeep, 0);
  if (upkeep > 0 && stock.energy < upkeep * 3 && c.credits > 5) {
    const regions = [...reachableRegions(w, c)];
    const region = regions.includes(capital.region) ? capital.region : regions[0];
    const price = Math.round(B.BASE_PRICE.energy * 1.2 * 100) / 100;
    const qty = Math.max(1, Math.min(Math.ceil(upkeep * 3 - stock.energy), Math.floor(c.credits / price)));
    push({ id: 'buy_energy', kind: 'buy_energy', urgency: 2, cost: { credits: Math.round(qty * price) } as Partial<Stock>, show: { kind: 'tab', tab: 'market' },
      command: region ? { type: 'market_order', region, resource: 'energy', side: 'buy', qty, price } : null,
      params: { qty, credits: Math.round(qty * price), draws: Math.max(0, Math.floor(stock.energy / upkeep)) } });
  }

  // The first relay, then the next one while the Network is small and the metal is there.
  const link = cheapestLink(w, c);
  const hasRelay = Object.values(w.relays).some((r) => r.owner === c.id);
  if (link && (!hasRelay || net.size < 6)) {
    push({ id: `link:${link.to}`, kind: hasRelay ? 'link_more' : 'link_first', urgency: hasRelay ? 1 : 2, cost: link.cost, show: { kind: 'link', from: link.from, to: link.to },
      command: affordable(w.systems[link.from]!.stock, link.cost) || affordable(capStock, link.cost) ? { type: 'build_relay', a: link.from, b: link.to } : null,
      params: { from: name(link.from), to: name(link.to), metal: Math.ceil(link.cost.metal), energy: Math.ceil(link.cost.energy) } });
  }

  // Warehouses full at the last Draw: a warehouse at the capital.
  const lost = B.RESOURCE_LIST.reduce((s, r) => s + c.lastOverflow[r], 0);
  if (lost > 0 && freeSlotsOnOrbit(w, capital, defaultOrbit('warehouse')) > 0) {
    const cost = B.BUILDING_COST.warehouse;
    push({ id: 'warehouse', kind: 'warehouse', urgency: 1, cost, show: { kind: 'plateau', system: c.capital, orbit: defaultOrbit('warehouse') },
      command: affordable(capStock, cost) ? { type: 'build', system: c.capital, building: 'warehouse' } : null, params: { lost: Math.round(lost), system: name(c.capital) } });
  }

  // Eyes: an antenna reveals the neighbouring sectors.
  if (!owned.some((id) => hasStructure(w.systems[id]!, 'antenna')) && freeSlotsOnOrbit(w, capital, defaultOrbit('antenna')) > 0) {
    const cost = B.BUILDING_COST.antenna;
    if (affordable(capStock, cost)) push({ id: 'antenna', kind: 'antenna', urgency: 0, cost, show: { kind: 'plateau', system: c.capital, orbit: defaultOrbit('antenna') }, command: { type: 'build', system: c.capital, building: 'antenna' }, params: { system: name(c.capital) } });
  }

  // Money on the table: the resource that overflows the most, sold at the Market.
  const surplus = (['metal', 'food', 'crystal', 'rium'] as Resource[]).map((r) => ({ r, q: capStock[r] })).filter((x) => x.q >= 400).sort((a, b) => b.q - a.q)[0];
  if (surplus && tier >= 2) {
    const regions = [...reachableRegions(w, c)];
    const region = regions.includes(capital.region) ? capital.region : regions[0];
    const qty = Math.floor((surplus.q - 250) / 10) * 10, price = Math.round(B.BASE_PRICE[surplus.r] * 0.9 * 100) / 100;
    if (region && qty > 0) push({ id: `sell:${surplus.r}`, kind: 'sell_surplus', urgency: 1, cost: { [surplus.r]: qty }, show: { kind: 'tab', tab: 'market' }, command: { type: 'market_order', region, resource: surplus.r, side: 'sell', qty, price }, params: { resource: surplus.r, qty, credits: Math.round(qty * price) } });
  }

  // A first pair of corvettes once the Shipyard is open and nothing flies.
  const warships = Object.values(w.fleets).some((f) => f.owner === c.id && combatSize(f.units) > 0);
  if (!warships && hasStructure(w.systems[c.capital]!, 'shipyard')) {
    const cost: Partial<Stock> = {}; for (const r of B.RESOURCE_LIST) { const x = (B.UNIT_COST.corvette[r] ?? 0) * 2; if (x) cost[r] = x; }
    if (affordable(capStock, cost)) push({ id: 'train', kind: 'train', urgency: 0, cost, show: { kind: 'plateau', system: c.capital, orbit: null }, command: { type: 'train', system: c.capital, unit: 'corvette', count: 2 }, params: { system: name(c.capital), count: 2 } });
  }

  // A human neighbour in sight and no word exchanged: a non-aggression pact.
  const seen = visibleSectors(w, c);
  const neighbour = Object.values(w.colonies).find((o) => o.id !== c.id && !o.npc && seen.has(w.galaxy.systems[o.capital]!.sector)
    && !Object.values(w.treaties).some((t) => (t.a === c.id && t.b === o.id) || (t.a === o.id && t.b === c.id))
    && !w.proposals.some((p) => (p.from === c.id && p.to === o.id) || (p.from === o.id && p.to === c.id)));
  if (neighbour && c.influence >= 7) push({ id: `treaty:${neighbour.id}`, kind: 'treaty', urgency: 1, cost: {}, show: { kind: 'tab', tab: 'diplomacy' }, command: { type: 'treaty', with: neighbour.id, kind: 'nap' }, params: { colony: neighbour.name } });

  // Learning: a word to the General, and the recap of the last Draw.
  if (!(c.policy.notes ?? '').trim()) push({ id: 'doctrine', kind: 'doctrine', urgency: 0, cost: {}, show: { kind: 'tab', tab: 'general' }, command: null, params: {} });
  if (w.drawIndex >= 0) push({ id: `recap:${w.drawIndex}`, kind: 'read_recap', urgency: 0, cost: {}, show: { kind: 'tab', tab: 'log' }, command: null, params: { draw: w.drawIndex + 1 } });

  return out.sort((a, b) => b.urgency - a.urgency).slice(0, max);
}
