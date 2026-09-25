// The engine analyses, the General narrates. Everything here is deterministic and testable; the model
// receives the result (a compact summary and a short list of costed options), never the raw state.
import type { Command, Policy, Resource, Stock } from '@aurane/protocol';
import {
  BASE_PRICE, BEACON_CRYSTAL, BUILDING_COST, BUILDING_SECONDS, RESOURCE_LIST, TURRET_STATS,
  capacityOf, colonyNetwork, colonyRelays, colonyScore, colonyStockTotal, combatSize, connectedFrom, hasStructure, hexDistance,
  isAlly, atPeace, isShielded, isWatching, linkOptions, networkUpkeep, offNetRium, ownedSystems, planPath, rangeContext,
  reachableRegions, relayActive, relayUp, shieldHours, watchHours, freeSlotsOnOrbit,
  type Colony, type FleetState, type Relay, type World,
} from '@aurane/sim';

export interface Named { id: string; name: string }

export interface BridgeRisk { relay: string; a: Named; b: Named; lostSystems: number; lost: string[]; guarded: boolean }
export interface Articulation { system: Named; lostSystems: number }

export interface InboundThreat { fleet: string; from: Named; target: Named; ships: number; etaMin: number; npc: boolean }
export interface Threats {
  inbound: InboundThreat[];
  engaged: Named[];
  blockaded: { system: Named; by: Named; sinceMin: number; captureInMin: number }[];
  exposedRelays: BridgeRisk[];
  protections: { shielded: boolean; shieldHoursLeft: number; watching: boolean; watchHours: number; watchStartHour: number };
}

export interface EnergyOutlook {
  stock: number;
  incomePerDraw: number;
  upkeepPerDraw: number;
  netPerDraw: number;
  /** Draws before the stock runs out at the current pace (null: it grows). */
  drawsUntilDark: number | null;
  /** Relays the engine would darken first (farthest from the capital first, as in the Draw). */
  firstToDarken: { relay: string; a: Named; b: Named; upkeep: number }[];
  projection: number[];
}

export interface ResourceLine { resource: Resource; stock: number; reserve: number; surplus: number; incomePerDraw: number; prices: { region: string; price: number }[]; reference: number }
export interface Arbitrage { resource: Resource; buyRegion: string; buyPrice: number; sellRegion: string; sellPrice: number; spreadPct: number }
export interface Economy {
  credits: number;
  lines: ResourceLine[];
  arbitrage: Arbitrage[];
  warehouses: { system: Named; fillPct: number; resource: Resource }[];
  overflowLastDraw: number;
}

export interface BeaconOutlook {
  system: Named; beaconName: string; lit: boolean; litBy: Named | null; holder: Named | null;
  sectors: number; owned: boolean; connected: boolean; crystalHave: number; crystalNeeded: number;
  link: { from: Named; metal: number; energy: number } | null;
}

export type OptionKind = 'turret' | 'defend' | 'buy_energy' | 'double_bridge' | 'backup_relay' | 'expand' | 'sell_surplus' | 'beacon' | 'raid' | 'hold';
export interface Option {
  id: string;
  kind: OptionKind;
  /** What it is, in both languages, with the numbers already in. */
  label: { fr: string; en: string };
  cost: Partial<Stock> & { credits?: number };
  delayMin: number;
  gain: { fr: string; en: string };
  risk: 'low' | 'mid' | 'high';
  command: Command | null;
}

export interface Analysis {
  at: number;
  drawIndex: number;
  nextDrawMin: number;
  colony: { id: string; name: string; capital: Named; faction: string; persona: string; score: number; owned: number; connected: number; credits: number; influence: number };
  stock: Stock;
  bridges: BridgeRisk[];
  articulations: Articulation[];
  threats: Threats;
  energy: EnergyOutlook;
  economy: Economy;
  beacons: BeaconOutlook[];
  options: Option[];
  /** Hostiles inbound or on a plateau, a blockade, or the lights going out within two Draws: no jokes. */
  crisis: boolean;
}

const named = (w: World, systemId: string): Named => ({ id: systemId, name: w.galaxy.systems[systemId]?.name ?? systemId });
const colonyNamed = (w: World, id: string): Named => ({ id, name: w.colonies[id]?.name ?? w.alliances[id]?.name ?? id });
const r1 = (x: number): number => Math.round(x * 10) / 10;
const hex = (w: World, systemId: string): { q: number; r: number } => w.galaxy.sectors[w.galaxy.systems[systemId]!.sector]!.hex;
const hasTurret = (w: World, systemId: string): boolean => w.systems[systemId]!.structures.some((s) => s.kind in TURRET_STATS && s.hp > 0);

/** Live relays of the colony (both stations up, built, not cut). */
function liveRelays(w: World, c: Colony): Relay[] {
  return colonyRelays(w, c.id).filter((r) => relayActive(r, w.time) && relayUp(w.systems[r.a]!) && relayUp(w.systems[r.b]!));
}

function reachOwned(w: World, c: Colony, relays: Relay[]): Set<string> {
  const reach = connectedFrom(relays, c.capital, c.id, w.time);
  const out = new Set<string>();
  for (const id of reach.keys()) if (w.systems[id]?.owner === c.id) out.add(id);
  return out;
}

export function analyzeBridges(w: World, c: Colony): { bridges: BridgeRisk[]; articulations: Articulation[] } {
  const relays = liveRelays(w, c);
  const base = reachOwned(w, c, relays);
  const bridges: BridgeRisk[] = [];
  for (const r of relays) {
    const without = reachOwned(w, c, relays.filter((x) => x.id !== r.id));
    const lost = [...base].filter((id) => !without.has(id));
    if (!lost.length) continue;
    bridges.push({ relay: r.id, a: named(w, r.a), b: named(w, r.b), lostSystems: lost.length, lost: lost.map((id) => named(w, id).name), guarded: hasTurret(w, r.a) && hasTurret(w, r.b) });
  }
  bridges.sort((x, y) => y.lostSystems - x.lostSystems || x.relay.localeCompare(y.relay));
  const articulations: Articulation[] = [];
  for (const id of base) {
    if (id === c.capital) continue;
    const without = reachOwned(w, c, relays.filter((x) => x.a !== id && x.b !== id));
    const lost = base.size - without.size - 1; // minus the station itself
    if (lost > 0) articulations.push({ system: named(w, id), lostSystems: lost });
  }
  articulations.sort((x, y) => y.lostSystems - x.lostSystems || x.system.id.localeCompare(y.system.id));
  return { bridges, articulations };
}

export function analyzeThreats(w: World, c: Colony, bridges: BridgeRisk[]): Threats {
  const owned = new Set(ownedSystems(w, c.id));
  const inbound: InboundThreat[] = [];
  for (const f of Object.values(w.fleets)) {
    if (f.owner === c.id || !f.destination || !owned.has(f.destination) || combatSize(f.units) === 0) continue;
    if (isAlly(w, c.id, f.owner) || f.order.kind === 'convoy') continue;
    inbound.push({ fleet: f.id, from: colonyNamed(w, f.owner), target: named(w, f.destination), ships: combatSize(f.units), etaMin: Math.max(0, Math.round((f.arriveAt - w.time) / 60)), npc: w.colonies[f.owner]?.npc ?? false });
  }
  inbound.sort((x, y) => x.etaMin - y.etaMin);
  const engaged: Named[] = [];
  const blockaded: Threats['blockaded'] = [];
  for (const id of owned) {
    const st = w.systems[id]!;
    if (st.engaged) engaged.push(named(w, id));
    if (st.blockade) blockaded.push({ system: named(w, id), by: colonyNamed(w, st.blockade.by), sinceMin: Math.round((w.time - st.blockade.since) / 60), captureInMin: Math.max(0, Math.round((st.blockade.since + 12 * 3600 - w.time) / 60)) });
  }
  const shieldLeft = Math.max(0, shieldHours(w.seasonEndsAt / 86400) - (w.time - c.createdAt) / 3600);
  return {
    inbound, engaged, blockaded,
    exposedRelays: bridges.filter((b) => !b.guarded),
    protections: { shielded: isShielded(w, c), shieldHoursLeft: r1(shieldLeft), watching: isWatching(w, c), watchHours: watchHours(w, c), watchStartHour: c.watchStartHour },
  };
}

export function analyzeEnergy(w: World, c: Colony, horizon = 6): EnergyOutlook {
  const relays = liveRelays(w, c);
  const upkeep = networkUpkeep(relays);
  const income = c.avgProduced.energy;
  const stock = colonyStockTotal(w, c.id).energy;
  const net = income - upkeep;
  const projection: number[] = [];
  let e = stock, dark: number | null = null;
  for (let i = 1; i <= horizon; i++) { e += net; projection.push(Math.round(e)); if (dark === null && e < 0) dark = i; }
  if (dark === null && net < 0 && stock >= 0) dark = Math.ceil(stock / -net) > horizon ? Math.ceil(stock / -net) : dark;
  const net0 = colonyNetwork(w, c);
  const order = [...relays].sort((x, y) => Math.max(net0.get(y.a) ?? 1e9, net0.get(y.b) ?? 1e9) - Math.max(net0.get(x.a) ?? 1e9, net0.get(x.b) ?? 1e9));
  return {
    stock: Math.round(stock), incomePerDraw: r1(income), upkeepPerDraw: r1(upkeep), netPerDraw: r1(net), drawsUntilDark: dark,
    firstToDarken: order.slice(0, 3).map((r) => ({ relay: r.id, a: named(w, r.a), b: named(w, r.b), upkeep: r1(r.upkeep) })),
    projection,
  };
}

/** Reserves the rule engine keeps (mirrors packages/sim general.ts `reserves`). */
export function reservesOf(w: World, c: Colony): Stock {
  const upkeep = networkUpkeep(liveRelays(w, c));
  const net = colonyNetwork(w, c);
  const pop = ownedSystems(w, c.id).filter((id) => net.has(id)).reduce((s, id) => s + w.systems[id]!.population, 0);
  const p = c.policy;
  return {
    metal: p.reserves.metal ?? 160,
    energy: p.reserves.energy ?? Math.max(60, Math.ceil(upkeep * 3)),
    food: p.reserves.food ?? Math.max(40, Math.ceil(pop * 0.05 * 20 * 6)),
    crystal: p.reserves.crystal ?? 20,
    rium: p.reserves.rium ?? Math.round(40 + 120 * p.aggression),
  };
}

export function analyzeEconomy(w: World, c: Colony): Economy {
  const regions = [...reachableRegions(w, c)];
  const total = colonyStockTotal(w, c.id);
  const reserve = reservesOf(w, c);
  const lines: ResourceLine[] = RESOURCE_LIST.map((r) => ({
    resource: r, stock: Math.round(total[r]), reserve: Math.round(reserve[r]), surplus: Math.round(total[r] - reserve[r]), incomePerDraw: r1(c.avgProduced[r]), reference: BASE_PRICE[r],
    prices: regions.map((reg) => { const cl = w.lastClearing.find((x) => x.region === reg && x.resource === r); return cl ? { region: reg, price: Math.round(cl.price * 100) / 100 } : null; }).filter((x): x is { region: string; price: number } => x !== null),
  }));
  const arbitrage: Arbitrage[] = [];
  for (const l of lines) {
    if (l.prices.length < 2) continue;
    const lo = l.prices.reduce((a, b) => (b.price < a.price ? b : a)), hi = l.prices.reduce((a, b) => (b.price > a.price ? b : a));
    if (lo.price > 0 && hi.price / lo.price >= 1.15) arbitrage.push({ resource: l.resource, buyRegion: lo.region, buyPrice: lo.price, sellRegion: hi.region, sellPrice: hi.price, spreadPct: Math.round(((hi.price - lo.price) / lo.price) * 100) });
  }
  arbitrage.sort((a, b) => b.spreadPct - a.spreadPct);
  const warehouses: Economy['warehouses'] = [];
  for (const id of ownedSystems(w, c.id)) {
    const cap = capacityOf(w, id);
    const st = w.systems[id]!;
    let worst: Resource = 'metal', fill = 0;
    for (const r of RESOURCE_LIST) { const f = st.stock[r] / cap; if (f > fill) { fill = f; worst = r; } }
    if (fill >= 0.8) warehouses.push({ system: named(w, id), fillPct: Math.round(fill * 100), resource: worst });
  }
  const o = c.lastOverflow;
  return { credits: Math.round(c.credits), lines, arbitrage, warehouses, overflowLastDraw: Math.round(o.metal + o.energy + o.food + o.crystal + o.rium) };
}

export function analyzeBeacons(w: World, c: Colony): BeaconOutlook[] {
  const net = colonyNetwork(w, c);
  const home = hex(w, c.capital);
  const rctx = rangeContext(w, c);
  const out: BeaconOutlook[] = [];
  for (const id of w.galaxy.beacons) {
    const sys = w.galaxy.systems[id]!;
    const st = w.systems[id]!;
    const lit = w.litBeacons[id];
    let link: BeaconOutlook['link'] = null;
    if (st.owner !== c.id) {
      for (const from of net.keys()) {
        if (w.systems[from]!.owner !== c.id) continue;
        const opt = linkOptions(w.galaxy, w.galaxy.systems[from]!, rctx).find((o) => o.to.id === id);
        if (opt && (!link || opt.verdict.cost.metal < link.metal)) link = { from: named(w, from), metal: opt.verdict.cost.metal, energy: opt.verdict.cost.energy };
      }
    }
    out.push({
      system: named(w, id), beaconName: sys.beaconName ?? sys.name, lit: !!lit, litBy: lit ? colonyNamed(w, lit.by) : null, holder: st.owner ? colonyNamed(w, st.owner) : null,
      sectors: hexDistance(home, hex(w, id)), owned: st.owner === c.id, connected: net.has(id), crystalHave: Math.round(st.stock.crystal), crystalNeeded: BEACON_CRYSTAL, link,
    });
  }
  return out.sort((a, b) => a.sectors - b.sectors || a.system.id.localeCompare(b.system.id));
}

function idleWarFleet(w: World, c: Colony): FleetState | null {
  let best: FleetState | null = null;
  for (const f of Object.values(w.fleets)) {
    if (f.owner !== c.id || f.at === null || f.order.kind !== 'idle' || combatSize(f.units) === 0) continue;
    if (!best || combatSize(f.units) > combatSize(best.units)) best = f;
  }
  return best;
}

const fmtCost = (cost: Partial<Stock> & { credits?: number }, lang: 'fr' | 'en'): string => {
  const names: Record<string, { fr: string; en: string }> = { metal: { fr: 'Métal', en: 'Metal' }, energy: { fr: 'Énergie', en: 'Energy' }, food: { fr: 'Vivres', en: 'Food' }, crystal: { fr: 'Cristal', en: 'Crystal' }, rium: { fr: 'Rium', en: 'Rium' }, credits: { fr: 'Crédits', en: 'Credits' } };
  const parts = Object.entries(cost).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${Math.round(v!)} ${names[k]![lang]}`);
  return parts.length ? parts.join(' + ') : lang === 'fr' ? 'rien' : 'nothing';
};

/** Three to five candidate actions, costed, ranked, filtered by the doctrine. */
export function buildOptions(w: World, c: Colony, a: Omit<Analysis, 'options' | 'crisis'>): Option[] {
  const p: Policy = c.policy;
  const out: Option[] = [];
  const net = colonyNetwork(w, c);
  const rctx = rangeContext(w, c);
  const stockAt = (id: string): Stock => w.systems[id]!.stock;
  const affordable = (id: string, cost: Partial<Stock>): boolean => RESOURCE_LIST.every((r) => (cost[r] ?? 0) <= stockAt(id)[r]);

  // 1. Guns where the enemy is heading.
  const target = a.threats.inbound[0]?.target ?? a.threats.blockaded[0]?.system ?? a.threats.engaged[0];
  if (target && !hasTurret(w, target.id)) {
    const sys = w.galaxy.systems[target.id]!;
    const cruisers = Object.values(w.fleets).filter((f) => f.destination === target.id && f.owner !== c.id).reduce((s, f) => s + f.units.cruiser, 0);
    const kind = cruisers > 0 ? 'turret_heavy' : 'turret_light';
    const cost = BUILDING_COST[kind];
    if (freeSlotsOnOrbit(w, sys, 2) > 0) {
      const eta = a.threats.inbound[0]?.etaMin ?? 0;
      const delay = Math.round(BUILDING_SECONDS[kind] / 60);
      out.push({
        id: 'turret', kind: 'turret', cost, delayMin: delay, risk: 'low', command: affordable(target.id, cost) ? { type: 'build', system: target.id, building: kind } : null,
        label: { fr: `Poser une ${kind === 'turret_heavy' ? 'tourelle lourde' : 'tourelle légère'} à ${target.name} (${fmtCost(cost, 'fr')}, prête en ${delay} min${eta ? `, ennemi dans ${eta} min` : ''})`, en: `Build a ${kind === 'turret_heavy' ? 'heavy' : 'light'} turret at ${target.name} (${fmtCost(cost, 'en')}, ready in ${delay} min${eta ? `, enemy in ${eta} min` : ''})` },
        gain: { fr: affordable(target.id, cost) ? `${eta && delay > eta ? 'trop tard pour cette flotte, utile pour la suivante' : 'le raid se heurte à un mur'}` : `l'entrepôt local ne peut pas payer : il faut y convoyer ${fmtCost(cost, 'fr')}`, en: affordable(target.id, cost) ? `${eta && delay > eta ? 'too late for this fleet, useful for the next' : 'the raid hits a wall'}` : `the local warehouse cannot pay: convoy ${fmtCost(cost, 'en')} there` },
      });
    }
  }
  // 2. Move the idle fleet to the threatened system.
  const fleet = idleWarFleet(w, c);
  if (target && fleet && fleet.at !== target.id) {
    const plan = planPath(w, c, fleet.at!, target.id);
    const speed = 60; // on-network fleet speed, world units per minute
    const delay = Math.round(plan.length / speed);
    out.push({
      id: 'defend', kind: 'defend', cost: {}, delayMin: delay, risk: 'mid', command: { type: 'fleet_order', fleet: fleet.id, order: 'defend', target: target.id },
      label: { fr: `Envoyer la flotte de ${combatSize(fleet.units)} vaisseaux défendre ${target.name} (arrivée dans ${delay} min)`, en: `Send the ${combatSize(fleet.units)}-ship fleet to defend ${target.name} (arrival in ${delay} min)` },
      gain: { fr: `${combatSize(fleet.units)} coques face à ${a.threats.inbound[0]?.ships ?? '?'}`, en: `${combatSize(fleet.units)} hulls against ${a.threats.inbound[0]?.ships ?? '?'}` },
    });
  }
  // 3. Energy before the lights go out.
  if (a.energy.drawsUntilDark !== null && a.energy.drawsUntilDark <= 3 && a.economy.credits > 10) {
    const need = Math.ceil(-a.energy.netPerDraw * 3);
    const regions = [...reachableRegions(w, c)];
    const home = w.galaxy.systems[c.marketSystem]!.region;
    const region = regions.includes(home) ? home : regions[0];
    const price = Math.round((a.economy.lines.find((l) => l.resource === 'energy')?.prices.find((x) => x.region === region)?.price ?? BASE_PRICE.energy) * 1.2 * 100) / 100;
    const qty = Math.max(1, Math.min(need, Math.floor(a.economy.credits / price)));
    out.push({
      id: 'buy_energy', kind: 'buy_energy', cost: { credits: Math.round(qty * price) }, delayMin: a.nextDrawMin, risk: 'low',
      command: region ? { type: 'market_order', region, resource: 'energy', side: 'buy', qty, price } : null,
      label: { fr: `Acheter ${qty} Énergie au Marché à ${price} au plus (${Math.round(qty * price)} Crédits), réglé au Tirage`, en: `Buy ${qty} Energy at the Market at ${price} at most (${Math.round(qty * price)} Credits), settled at the Draw` },
      gain: { fr: `${Math.round(qty / Math.max(0.1, -a.energy.netPerDraw))} Tirage(s) d'entretien de plus ; sinon les relais s'éteignent dans ${a.energy.drawsUntilDark} Tirage(s)`, en: `${Math.round(qty / Math.max(0.1, -a.energy.netPerDraw))} more Draw(s) of upkeep; else the relays go dark in ${a.energy.drawsUntilDark} Draw(s)` },
    });
  }
  // 4. Double the worst bridge: a second relay that closes a cycle around it.
  const worst = a.bridges[0];
  if (worst) {
    let best: { from: string; to: string; metal: number; energy: number; seconds: number; upkeep: number } | null = null;
    for (const from of net.keys()) {
      if (w.systems[from]!.owner !== c.id) continue;
      for (const opt of linkOptions(w.galaxy, w.galaxy.systems[from]!, rctx)) {
        const to = opt.to.id;
        if (!net.has(to) || w.systems[to]!.owner !== c.id) continue;
        if (colonyRelays(w, c.id).some((r) => (r.a === from && r.b === to) || (r.a === to && r.b === from))) continue;
        // Would this link keep `worst.lost` connected without the bridge?
        const relays = [...liveRelays(w, c).filter((r) => r.id !== worst.relay), { id: 'tmp', a: from, b: to, owner: c.id, length: opt.verdict.length, upkeep: opt.verdict.upkeep, readyAt: 0, cutUntil: 0 }];
        const reach = reachOwned(w, c, relays);
        if (!worst.lost.every((n) => [...reach].some((id) => w.galaxy.systems[id]!.name === n))) continue;
        if (!best || opt.verdict.cost.metal < best.metal) best = { from, to, metal: opt.verdict.cost.metal, energy: opt.verdict.cost.energy, seconds: opt.verdict.buildSeconds, upkeep: opt.verdict.upkeep };
      }
    }
    if (best) {
      const cost = { metal: best.metal, energy: best.energy };
      out.push({
        id: 'double_bridge', kind: 'double_bridge', cost, delayMin: Math.round(best.seconds / 60), risk: 'low', command: { type: 'build_relay', a: best.from, b: best.to },
        label: { fr: `Doubler le pont ${worst.a.name}–${worst.b.name} par un relais ${named(w, best.from).name}–${named(w, best.to).name} (${fmtCost(cost, 'fr')}, ${Math.round(best.seconds / 60)} min, +${r1(best.upkeep)} Énergie d'entretien par Tirage)`, en: `Double the ${worst.a.name}–${worst.b.name} bridge with a ${named(w, best.from).name}–${named(w, best.to).name} relay (${fmtCost(cost, 'en')}, ${Math.round(best.seconds / 60)} min, +${r1(best.upkeep)} Energy upkeep per Draw)` },
        gain: { fr: `${worst.lostSystems} système(s) ne dépendent plus d'un seul relais`, en: `${worst.lostSystems} system(s) no longer hang on one relay` },
      });
    } else {
      // No cycle possible: a backup relay structure at the most exposed articulation keeps the Network up when the station falls.
      const art = a.articulations[0];
      if (art && !hasStructure(w.systems[art.system.id]!, 'relay')) {
        const cost = BUILDING_COST.relay;
        out.push({
          id: 'backup_relay', kind: 'backup_relay', cost, delayMin: Math.round(BUILDING_SECONDS.relay / 60), risk: 'low', command: affordable(art.system.id, cost) ? { type: 'build', system: art.system.id, building: 'relay' } : null,
          label: { fr: `Relais de secours à ${art.system.name} (${fmtCost(cost, 'fr')}, ${Math.round(BUILDING_SECONDS.relay / 60)} min)`, en: `Backup relay at ${art.system.name} (${fmtCost(cost, 'en')}, ${Math.round(BUILDING_SECONDS.relay / 60)} min)` },
          gain: { fr: `si la station tombe, ${art.lostSystems} système(s) restent reliés`, en: `if the station falls, ${art.lostSystems} system(s) stay connected` },
        });
      }
    }
  }
  // 5. Expansion, if the doctrine wants it and the Energy follows.
  if (p.expansion > 0.1) {
    let best: { from: string; to: string; metal: number; energy: number; seconds: number; upkeep: number; resource: Resource } | null = null;
    for (const from of net.keys()) {
      if (w.systems[from]!.owner !== c.id) continue;
      for (const opt of linkOptions(w.galaxy, w.galaxy.systems[from]!, rctx)) {
        const st = w.systems[opt.to.id]!;
        if (net.has(opt.to.id) || (st.owner && st.owner !== c.id)) continue;
        if (!best || opt.verdict.cost.metal < best.metal) best = { from, to: opt.to.id, metal: opt.verdict.cost.metal, energy: opt.verdict.cost.energy, seconds: opt.verdict.buildSeconds, upkeep: opt.verdict.upkeep, resource: opt.to.resource };
      }
    }
    if (best) {
      const projected = a.energy.upkeepPerDraw + best.upkeep;
      const ok = projected <= a.energy.incomePerDraw * 0.8;
      const cost = { metal: best.metal, energy: best.energy };
      out.push({
        id: 'expand', kind: 'expand', cost, delayMin: Math.round(best.seconds / 60), risk: ok ? 'low' : 'mid', command: ok ? { type: 'build_relay', a: best.from, b: best.to } : null,
        label: { fr: `Relier ${named(w, best.to).name} [${best.resource}] depuis ${named(w, best.from).name} (${fmtCost(cost, 'fr')}, ${Math.round(best.seconds / 60)} min, entretien ${r1(projected)} Énergie par Tirage pour ${r1(a.energy.incomePerDraw)} produits)`, en: `Link ${named(w, best.to).name} [${best.resource}] from ${named(w, best.from).name} (${fmtCost(cost, 'en')}, ${Math.round(best.seconds / 60)} min, upkeep ${r1(projected)} Energy per Draw for ${r1(a.energy.incomePerDraw)} produced)` },
        gain: { fr: ok ? '+1 système relié, +1 point par Tirage' : `l'entretien dépasserait 80 % du revenu d'Énergie : d'abord de l'Énergie`, en: ok ? '+1 connected system, +1 point per Draw' : 'upkeep would pass 80 % of the Energy income: Energy first' },
      });
    }
  }
  // 6. Sell the biggest surplus where it pays.
  const surplus = a.economy.lines.filter((l) => l.surplus >= 40 && l.prices.length).map((l) => ({ l, best: l.prices.reduce((x, y) => (y.price > x.price ? y : x)) })).filter((x) => x.best.price >= x.l.reference * 0.85).sort((x, y) => y.l.surplus * y.best.price - x.l.surplus * x.best.price)[0];
  if (surplus) {
    const qty = Math.floor(surplus.l.surplus * 0.6);
    const floor = p.sellAbove[surplus.l.resource] ?? Math.round(surplus.best.price * 0.9 * 100) / 100;
    out.push({
      id: 'sell_surplus', kind: 'sell_surplus', cost: { [surplus.l.resource]: qty }, delayMin: a.nextDrawMin, risk: 'low',
      command: { type: 'market_order', region: surplus.best.region, resource: surplus.l.resource, side: 'sell', qty, price: floor },
      label: { fr: `Vendre ${qty} ${surplus.l.resource} sur ${surplus.best.region} à ${floor} au moins (dernier prix ${surplus.best.price}), réglé au Tirage`, en: `Sell ${qty} ${surplus.l.resource} on ${surplus.best.region} at ${floor} at least (last price ${surplus.best.price}), settled at the Draw` },
      gain: { fr: `≈ ${Math.round(qty * floor * 0.95)} Crédits après frais`, en: `≈ ${Math.round(qty * floor * 0.95)} Credits after fees` },
    });
  }
  // 7. The nearest Beacon.
  const beacon = a.beacons.find((b) => !b.lit && (b.owned || b.link));
  if (beacon) {
    if (beacon.owned && beacon.connected) {
      const missing = Math.max(0, beacon.crystalNeeded - beacon.crystalHave);
      out.push({
        id: 'beacon', kind: 'beacon', cost: { crystal: missing }, delayMin: 0, risk: 'mid', command: missing === 0 ? { type: 'light_beacon', system: beacon.system.id } : { type: 'route_set', from: c.capital, to: beacon.system.id, resource: 'crystal', perTrip: 240, whenBelow: beacon.crystalNeeded },
        label: { fr: missing === 0 ? `Rallumer le Phare ${beacon.beaconName} maintenant` : `Convoyer ${missing} Cristal vers le Phare ${beacon.beaconName} (${beacon.crystalHave} sur ${beacon.crystalNeeded} sur place)`, en: missing === 0 ? `Light the Beacon ${beacon.beaconName} now` : `Convoy ${missing} Crystal to the Beacon ${beacon.beaconName} (${beacon.crystalHave} of ${beacon.crystalNeeded} on site)` },
        gain: { fr: '+10 points par Tirage tant qu\'il brille, et tout le monde le voit', en: '+10 points per Draw while it shines, and everyone sees it' },
      });
    } else if (beacon.link) {
      const cost = { metal: beacon.link.metal, energy: beacon.link.energy };
      out.push({
        id: 'beacon', kind: 'beacon', cost, delayMin: 0, risk: 'mid', command: { type: 'build_relay', a: beacon.link.from.id, b: beacon.system.id },
        label: { fr: `Relier le Phare ${beacon.beaconName} depuis ${beacon.link.from.name} (${fmtCost(cost, 'fr')}, ${beacon.sectors} secteur(s), ${beacon.holder ? `tenu par ${beacon.holder.name}` : 'libre'})`, en: `Link the Beacon ${beacon.beaconName} from ${beacon.link.from.name} (${fmtCost(cost, 'en')}, ${beacon.sectors} sector(s), ${beacon.holder ? `held by ${beacon.holder.name}` : 'free'})` },
        gain: { fr: `puis ${beacon.crystalNeeded} Cristal pour le rallumer : +10 points par Tirage`, en: `then ${beacon.crystalNeeded} Crystal to light it: +10 points per Draw` },
      });
    }
  }
  // 8. A raid, only when the doctrine allows and a weaker, unprotected neighbour exists.
  if (p.aggression > 0.3 && fleet && combatSize(fleet.units) >= 6 && !a.threats.protections.shielded) {
    const home = hex(w, c.capital);
    const myStrength = Object.values(w.fleets).filter((f) => f.owner === c.id).reduce((s, f) => s + combatSize(f.units), 0);
    const victims = Object.values(w.colonies).filter((o) => o.id !== c.id && !isAlly(w, c.id, o.id) && !atPeace(w, c.id, o.id) && !isShielded(w, o)
      && !p.neverAttack.includes(o.id) && !(o.alliance && p.neverAttack.includes(o.alliance)) && hexDistance(home, hex(w, o.capital)) <= 3
      && Object.values(w.fleets).filter((f) => f.owner === o.id).reduce((s, f) => s + combatSize(f.units), 0) < myStrength
      && colonyScore(w, c) <= 3 * Math.max(1, colonyScore(w, o)));
    const victim = victims.sort((x, y) => colonyScore(w, y) - colonyScore(w, x))[0];
    if (victim) {
      const vb = analyzeBridges(w, victim).bridges[0];
      const prey = ownedSystems(w, victim.id).filter((id) => id !== victim.capital);
      const targetId = vb ? (w.systems[vb.a.id]!.owner === victim.id ? vb.a.id : vb.b.id) : prey[0];
      if (targetId) {
        const plan = planPath(w, c, fleet.at!, targetId);
        const fuel = plan.onNet ? 0 : Math.ceil(2 * offNetRium(plan.length, fleet.units));
        out.push({
          id: 'raid', kind: 'raid', cost: { rium: fuel }, delayMin: Math.round(plan.length / 30), risk: 'high', command: { type: 'fleet_order', fleet: fleet.id, order: 'raid', target: targetId },
          label: { fr: `Raider ${named(w, targetId).name} (${victim.name}) avec ${combatSize(fleet.units)} vaisseaux : ${fuel} Rium aller-retour, ${Math.round(plan.length / 30)} min de trajet`, en: `Raid ${named(w, targetId).name} (${victim.name}) with ${combatSize(fleet.units)} ships: ${fuel} Rium round trip, ${Math.round(plan.length / 30)} min of travel` },
          gain: { fr: vb ? `c'est un pont : ${vb.lostSystems} de leurs systèmes s'éteignent six heures` : 'butin sur les stocks locaux, station coupée six heures', en: vb ? `it is a bridge: ${vb.lostSystems} of their systems go dark for six hours` : 'loot from the local stocks, station cut for six hours' },
        });
      }
    }
  }
  // Rank: crisis answers first, then structure, then economy, then adventure. Cap at five.
  const rank: Record<OptionKind, number> = { turret: 0, defend: 1, buy_energy: 2, double_bridge: 3, backup_relay: 3, expand: 4, sell_surplus: 5, beacon: 6, raid: 7, hold: 9 };
  out.sort((x, y) => rank[x.kind] - rank[y.kind]);
  const top = out.slice(0, 5);
  if (top.length < 3) {
    top.push({
      id: 'hold', kind: 'hold', cost: {}, delayMin: a.nextDrawMin, risk: 'low', command: null,
      label: { fr: `Tenir jusqu'au prochain Tirage (dans ${a.nextDrawMin} min) et laisser les entrepôts se remplir`, en: `Hold until the next Draw (in ${a.nextDrawMin} min) and let the warehouses fill` },
      gain: { fr: `+${r1(c.avgProduced.metal)} Métal, +${r1(c.avgProduced.energy)} Énergie attendus`, en: `+${r1(c.avgProduced.metal)} Metal, +${r1(c.avgProduced.energy)} Energy expected` },
    });
  }
  return top;
}

export function analyze(w: World, c: Colony): Analysis {
  const { bridges, articulations } = analyzeBridges(w, c);
  const threats = analyzeThreats(w, c, bridges);
  const energy = analyzeEnergy(w, c);
  const economy = analyzeEconomy(w, c);
  const beacons = analyzeBeacons(w, c);
  const net = colonyNetwork(w, c);
  const owned = ownedSystems(w, c.id);
  const nextDrawMin = Math.max(0, Math.round(((w.drawIndex + 1) * 3600 - w.time) / 60));
  const base = {
    at: w.time, drawIndex: w.drawIndex, nextDrawMin,
    colony: { id: c.id, name: c.name, capital: named(w, c.capital), faction: c.faction, persona: c.persona, score: Math.round(colonyScore(w, c) * 10) / 10, owned: owned.length, connected: owned.filter((id) => net.has(id)).length, credits: Math.round(c.credits), influence: Math.round(c.influence) },
    stock: colonyStockTotal(w, c.id), bridges, articulations, threats, energy, economy, beacons,
  };
  const options = buildOptions(w, c, base);
  const crisis = threats.inbound.length > 0 || threats.engaged.length > 0 || threats.blockaded.length > 0 || (energy.drawsUntilDark !== null && energy.drawsUntilDark <= 2);
  return { ...base, options, crisis };
}
