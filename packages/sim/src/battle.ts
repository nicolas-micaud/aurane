// Continuous combat on a system's plateau. Ticked every second only where hostiles are
// present. Deterministic: the per-salvo variance comes from a seeded stream per system.
import type { Building, UnitType } from '@aurane/protocol';
import { COMBAT_UNITS } from '@aurane/protocol';
import * as B from './balance.js';
import { counterMult } from './combat.js';
import { atPeace, isAlly } from './diplomacy.js';
import { createRng, subSeed } from './rng.js';
import { combatSize, newId, type BattleLog, type FleetState, type PlateauPos, type Structure, type SystemState, type World } from './state.js';

interface XY { x: number; y: number }
const toXY = (p: PlateauPos): XY => ({ x: p.r * Math.cos((p.a * Math.PI) / 180), y: p.r * Math.sin((p.a * Math.PI) / 180) });
const fromXY = (q: XY): PlateauPos => ({ r: Math.hypot(q.x, q.y), a: ((Math.atan2(q.y, q.x) * 180) / Math.PI + 360) % 360 });
const d2 = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The station-relais sits at the heart of the plateau; orbits 1..3 ring it, the edge is PLATEAU_RADIUS. */
export const STATION_POS: PlateauPos = { r: 0, a: 0 };
export const structurePos = (s: Structure): PlateauPos => ({ r: s.orbit, a: s.angle });

type Target =
  | { kind: 'fleet'; fleet: FleetState; pos: XY }
  | { kind: 'structure'; structure: Structure; pos: XY }
  | { kind: 'station'; pos: XY };

function hostile(w: World, a: string, b: string): boolean {
  if (a === b || isAlly(w, a, b) || atPeace(w, a, b)) return false;
  const ca = w.colonies[a], cb = w.colonies[b];
  if (!ca || !cb) return false;
  const shielded = (c: typeof ca): boolean => w.time - c.createdAt < B.NEWCOMER_SHIELD_HOURS * 3600;
  return !shielded(ca) && !shielded(cb);
}

/** Fleets on the plateau (not docked) of one point of interest. */
export function plateauFleets(w: World, systemId: string, poi: string): FleetState[] {
  return Object.values(w.fleets).filter((f) => f.at === systemId && f.poi === poi && f.pos !== null && (combatSize(f.units) > 0 || f.units.cargo > 0));
}

export const plateauKey = (systemId: string, poi: string): string => `${systemId}|${poi}`;

/** One pass over the fleets: "system|poi" → fleets on that plateau. Build it once per step, then query many. */
export function plateauIndex(w: World): Map<string, FleetState[]> {
  const idx = new Map<string, FleetState[]>();
  for (const f of Object.values(w.fleets)) {
    if (f.at === null || f.poi === null || f.pos === null || (combatSize(f.units) === 0 && f.units.cargo === 0)) continue;
    const key = plateauKey(f.at, f.poi);
    const list = idx.get(key);
    if (list) list.push(f); else idx.set(key, [f]);
  }
  return idx;
}

export function armedHostilesPresent(w: World, systemId: string, poi: string, plateau?: FleetState[]): FleetState[] {
  const st = w.systems[systemId]!;
  const owner = st.owner;
  const fleets = plateau ?? plateauFleets(w, systemId, poi);
  if (!fleets.length) return fleets;
  return fleets.filter((f) => combatSize(f.units) > 0 && (owner ? hostile(w, f.owner, owner) : fleets.some((g) => g.id !== f.id && hostile(w, f.owner, g.owner))));
}

function hpOf(f: FleetState, t: UnitType): number { return f.units[t] * B.UNIT_STATS[t].hp - f.damage[t]; }

export function fleetHpFraction(f: FleetState): number {
  let max = 0, cur = 0;
  for (const t of COMBAT_UNITS) { max += f.units[t] * B.UNIT_STATS[t].hp; cur += hpOf(f, t); }
  return max > 0 ? cur / max : 1;
}

/** Applies damage to a fleet, killing units when their pool is exhausted. Returns kills per type. */
export function damageFleet(f: FleetState, amount: number, prefer: UnitType | null): Partial<Record<UnitType, number>> {
  const kills: Partial<Record<UnitType, number>> = {};
  // Cargos die first if the attacker wants them; otherwise damage goes to the preferred type, then the largest pool.
  const order: UnitType[] = [];
  if (prefer && f.units[prefer] > 0) order.push(prefer);
  for (const t of [...COMBAT_UNITS].sort((a, b) => hpOf(f, b) - hpOf(f, a))) if (!order.includes(t) && f.units[t] > 0) order.push(t);
  if (f.units.cargo > 0) order.push('cargo');
  let left = amount;
  for (const t of order) {
    if (left <= 0) break;
    const pool = hpOf(f, t);
    if (pool <= 0) continue;
    const dealt = Math.min(pool, left);
    f.damage[t] += dealt;
    left -= dealt;
    const per = B.UNIT_STATS[t].hp;
    const dead = Math.min(f.units[t], Math.floor(f.damage[t] / per));
    if (dead > 0) { f.units[t] -= dead; f.damage[t] -= dead * per; kills[t] = (kills[t] ?? 0) + dead; }
  }
  if (combatSize(f.units) === 0 && f.units.cargo > 0 && amount > 0) {
    // An unescorted convoy is lost at the first salvo.
    kills.cargo = (kills.cargo ?? 0) + f.units.cargo;
    f.units.cargo = 0;
    f.cargo = { metal: 0, energy: 0, food: 0, crystal: 0 };
  }
  return kills;
}

function shieldAt(w: World, st: SystemState, poi: string, defenderOwner: string | null, pos: XY): number {
  if (!defenderOwner) return 0;
  const colony = w.colonies[defenderOwner];
  const watch = colony ? ((Math.floor(w.time / 3600) % 24) - colony.watchStartHour + 24) % 24 < B.WATCH_HOURS : false;
  for (const s of st.structures) {
    if (s.kind !== 'bastion' || s.hp <= 0 || s.poi !== poi) continue;
    if (d2(toXY(structurePos(s)), pos) <= B.BASTION_RANGE) return watch ? B.BASTION_SHIELD_WATCH : B.BASTION_SHIELD;
  }
  return 0;
}

function pickTarget(w: World, f: FleetState, candidates: Target[], unit: UnitType): Target | null {
  if (!candidates.length) return null;
  const me = toXY(f.pos!);
  if (f.focus) {
    const t = candidates.find((c) => (c.kind === 'fleet' && c.fleet.id === f.focus) || (c.kind === 'structure' && c.structure.id === f.focus) || (c.kind === 'station' && f.focus === 'station'));
    if (t) return t;
  }
  const policy = w.colonies[f.owner]?.policy.targetPriority ?? 'ships';
  const score = (c: Target): number => {
    let s = d2(me, c.pos); // nearer is better
    const pri = (n: number): void => { s -= n * 10; };
    if (f.order.kind === 'raid') {
      const wanted = f.order.target;
      if ((c.kind === 'station' && wanted === 'station') || (c.kind === 'structure' && c.structure.id === wanted)) pri(5);
    }
    if (policy === 'ships' && c.kind === 'fleet' && combatSize(c.fleet.units) > 0) pri(3);
    if (policy === 'turrets' && c.kind === 'structure' && c.structure.kind in B.TURRET_STATS) pri(3);
    if (policy === 'station' && c.kind === 'station') pri(3);
    if (policy === 'economy' && c.kind === 'structure' && (c.structure.kind === 'warehouse' || c.structure.kind === 'extractor')) pri(3);
    if (unit === 'corvette') { if (c.kind === 'fleet' && c.fleet.units.cargo > 0 && combatSize(c.fleet.units) === 0) pri(4); if (c.kind === 'station') pri(2); if (c.kind === 'fleet' && c.fleet.units.cruiser > 0) pri(1); }
    if (unit === 'frigate') { if (c.kind === 'fleet' && c.fleet.units.corvette > 0) pri(2); if (c.kind === 'fleet') pri(1); }
    if (unit === 'cruiser') { if (c.kind === 'structure' && c.structure.kind in B.TURRET_STATS) pri(3); if (c.kind === 'structure' && c.structure.kind === 'bastion') pri(2); if (c.kind === 'station') pri(1); }
    return s;
  };
  return candidates.reduce((best, c) => (score(c) < score(best) ? c : best));
}

function moveToward(f: FleetState, target: XY, range: number, speedPerMin: number, dt: number): void {
  const me = toXY(f.pos!);
  const d = d2(me, target);
  if (d <= range * 0.9) return;
  const step = Math.min(d - range * 0.9, (speedPerMin * dt) / 60);
  const nx = me.x + ((target.x - me.x) / d) * step, ny = me.y + ((target.y - me.y) / d) * step;
  f.pos = fromXY({ x: nx, y: ny });
}

function log(w: World, systemId: string, poi: string, kind: string, who: string, what: string, amount?: number, target?: string): void {
  const b = Object.values(w.battles).find((x) => x.system === systemId && x.poi === poi && x.endedAt === null);
  if (!b) return;
  const e: BattleLog['events'][number] = { at: w.time, kind, who, what };
  if (amount !== undefined) e.amount = amount;
  if (target !== undefined) e.target = target;
  if (b.events.length < 2000) b.events.push(e);
}

/**
 * One second of combat at `systemId`. Returns true while the engagement continues.
 * Sides: the system owner and its allies defend with fleets, turrets and the station; every
 * hostile fleet on the plateau attacks. In unowned systems, hostile fleets fight each other.
 */
export function battleTick(w: World, systemId: string, poi: string, dt = 1, plateau?: FleetState[]): boolean {
  const st = w.systems[systemId]!;
  const fleets = plateau ?? plateauFleets(w, systemId, poi);
  const hostiles = armedHostilesPresent(w, systemId, poi, fleets);
  if (!hostiles.length) return endEngagement(w, systemId, poi);

  // Targets available to each attacker: what stands at this point of interest.
  const structureTargets: Target[] = st.owner ? st.structures.filter((s) => s.hp > 0 && s.poi === poi).map((s) => ({ kind: 'structure' as const, structure: s, pos: toXY(structurePos(s)) })) : [];
  const stationTarget: Target | null = st.owner && poi === st.mainPoi && st.stationHp > 0 ? { kind: 'station', pos: toXY(STATION_POS) } : null;
  const candidatesFor = (f: FleetState): Target[] => {
    const enemyFleets: Target[] = fleets.filter((g) => g.id !== f.id && hostile(w, f.owner, g.owner)).map((g) => ({ kind: 'fleet' as const, fleet: g, pos: toXY(g.pos!) }));
    const attackingSystem = st.owner !== null && hostile(w, f.owner, st.owner);
    return [...enemyFleets, ...(attackingSystem ? structureTargets : []), ...(attackingSystem && stationTarget ? [stationTarget] : [])];
  };
  const turretsLive = st.owner !== null && st.structures.some((s) => s.kind in B.TURRET_STATS && s.hp > 0 && s.poi === poi);
  // Nothing left to shoot on either side: the plateau is held, not fought over.
  if (!turretsLive && !fleets.some((f) => combatSize(f.units) > 0 && candidatesFor(f).length > 0)) return endEngagement(w, systemId, poi);
  if (!st.engagedPois.includes(poi)) startEngagement(w, systemId, poi, fleets);
  const rng = createRng(subSeed(w.seed, 'salvo', systemId, poi, Math.floor(w.time)));
  const variance = (): number => 1 + (rng.next() * 2 - 1) * B.COMBAT_VARIANCE_SALVO;

  const kills = new Map<string, number>();
  for (const f of fleets) {
    if (combatSize(f.units) === 0) continue;
    const candidates = candidatesFor(f);
    if (!candidates.length) continue;
    // The fleet manoeuvres as one body toward the target of its longest-range type.
    const longest = [...COMBAT_UNITS].filter((t) => f.units[t] > 0).sort((a, b) => B.UNIT_STATS[b].range - B.UNIT_STATS[a].range)[0]!;
    const primary = pickTarget(w, f, candidates, longest);
    if (!primary) continue;
    const slowest = Math.min(...COMBAT_UNITS.filter((t) => f.units[t] > 0).map((t) => B.UNIT_STATS[t].speed));
    moveToward(f, primary.pos, B.UNIT_STATS[longest].range, slowest, dt);
    const me = toXY(f.pos!);
    for (const t of COMBAT_UNITS) {
      if (f.units[t] === 0) continue;
      const stats = B.UNIT_STATS[t];
      const target = pickTarget(w, f, candidates.filter((c) => d2(me, c.pos) <= stats.range + 0.05), t) ?? null;
      if (!target) continue;
      const defenderOwner = target.kind === 'fleet' ? target.fleet.owner : st.owner;
      const shield = shieldAt(w, st, poi, defenderOwner, target.pos);
      let dmg = f.units[t] * stats.dps * dt * variance() * (1 - shield);
      if (target.kind === 'fleet') {
        const prefer = B.COUNTERS[t];
        dmg *= counterMult(t, prefer && target.fleet.units[prefer] > 0 ? prefer : null);
        const k = damageFleet(target.fleet, dmg, prefer);
        for (const [u, n] of Object.entries(k)) { kills.set(`${f.owner}:${u}`, (kills.get(`${f.owner}:${u}`) ?? 0) + n!); log(w, systemId, poi, 'kill', f.owner, u, n, target.fleet.owner); }
        if (k.cargo) w.events.push({ at: w.time, kind: 'convoy.lost', actors: [target.fleet.owner, f.owner], data: { system: systemId, poi, cargos: k.cargo } });
      } else if (target.kind === 'structure') {
        target.structure.hp = Math.max(0, target.structure.hp - dmg);
        if (target.structure.hp === 0) { log(w, systemId, poi, 'destroyed', f.owner, target.structure.kind, undefined, st.owner ?? undefined); }
      } else {
        st.stationHp = Math.max(0, st.stationHp - dmg);
        if (st.stationHp === 0) log(w, systemId, poi, 'station.down', f.owner, systemId, undefined, st.owner ?? undefined);
      }
    }
  }
  // Turrets fire at hostile fleets in range.
  if (st.owner) {
    for (const s of st.structures) {
      const ts = B.TURRET_STATS[s.kind as Building];
      if (!ts || s.hp <= 0 || s.poi !== poi) continue;
      const spos = toXY(structurePos(s));
      const inRange = hostiles.filter((f) => d2(spos, toXY(f.pos!)) <= ts.range);
      if (!inRange.length) continue;
      const target = inRange.reduce((a, b) => (d2(spos, toXY(a.pos!)) <= d2(spos, toXY(b.pos!)) ? a : b));
      const prefer = ts.counters;
      const dmg = ts.dps * dt * variance() * (target.units[prefer] > 0 ? B.COUNTER_MULT : 1);
      const k = damageFleet(target, dmg, prefer);
      for (const [u, n] of Object.entries(k)) log(w, systemId, poi, 'kill', st.owner, u, n, target.owner);
      if (k.cargo) w.events.push({ at: w.time, kind: 'convoy.lost', actors: [target.owner, st.owner], data: { system: systemId, poi, cargos: k.cargo } });
    }
  }
  // Destroyed structures leave their slot; dead fleets vanish.
  st.structures = st.structures.filter((s) => s.hp > 0);
  for (const f of fleets) if (combatSize(f.units) === 0 && f.units.cargo === 0) delete w.fleets[f.id];
  return armedHostilesPresent(w, systemId, poi).length > 0 ? true : endEngagement(w, systemId, poi);
}

function startEngagement(w: World, systemId: string, poi: string, fleets: FleetState[]): void {
  const st = w.systems[systemId]!;
  st.engaged = true;
  if (!st.engagedPois.includes(poi)) st.engagedPois.push(poi);
  if (!w.engagedSystems.includes(systemId)) w.engagedSystems.push(systemId);
  const id = newId(w, 'X');
  const sides = [...new Set([...(st.owner ? [st.owner] : []), ...fleets.map((f) => f.owner)])];
  w.battles[id] = { id, system: systemId, poi, startedAt: w.time, endedAt: null, sides, events: [] };
  w.events.push({ at: w.time, kind: 'battle.start', actors: sides, data: { system: systemId, poi, battle: id } });
}

function endEngagement(w: World, systemId: string, poi: string): boolean {
  const st = w.systems[systemId]!;
  if (st.engagedPois.includes(poi)) {
    st.engagedPois = st.engagedPois.filter((p) => p !== poi);
    st.engaged = st.engagedPois.length > 0;
    if (!st.engaged) w.engagedSystems = w.engagedSystems.filter((s) => s !== systemId);
    const b = Object.values(w.battles).find((x) => x.system === systemId && x.poi === poi && x.endedAt === null);
    if (b) {
      b.endedAt = w.time;
      w.events.push({ at: w.time, kind: 'battle', actors: b.sides, data: { system: systemId, poi, battle: b.id, seconds: b.endedAt - b.startedAt, kills: b.events.filter((e) => e.kind === 'kill').length } });
    }
  }
  return false;
}

/** Slow healing when nothing hostile is around. */
export function regenerate(w: World, systemId: string, dt: number, connected: boolean, contested = false): void {
  const st = w.systems[systemId]!;
  if (st.engaged || contested) return;
  if (st.stationHp >= B.STATION_HP && !st.structures.some((s) => s.hp < B.STRUCTURE_HP[s.kind])) return;
  for (const s of st.structures) s.hp = Math.min(B.STRUCTURE_HP[s.kind], s.hp + B.STRUCTURE_REGEN_PER_S * dt);
  if (st.stationHp <= 0) {
    // A dark station is rebuilt by its own crews (faster when a neighbour still reaches it).
    const rate = (B.STATION_HP / (B.STATION_REBUILD_HOURS * 3600)) * (connected ? 1 : 0.5);
    if (st.owner) st.stationHp = Math.min(B.STATION_HP, st.stationHp + rate * dt + 1e-9);
  } else st.stationHp = Math.min(B.STATION_HP, st.stationHp + B.STATION_REGEN_PER_S * dt);
  const dock = st.structures.some((s) => s.kind === 'shipyard' && s.hp > 0);
  for (const f of Object.values(w.fleets)) {
    if (f.at !== systemId || f.owner !== st.owner) continue;
    const rate = dock ? B.SHIP_REPAIR_DOCK_PER_S : B.SHIP_REPAIR_FIELD_PER_S;
    for (const t of COMBAT_UNITS) f.damage[t] = Math.max(0, f.damage[t] - rate * dt);
  }
}

/** Drop battle logs older than `keepSeconds` so a season's snapshot stays bounded. */
export function pruneBattles(w: World, keepSeconds = 7 * 86400, keepMax = 2000): void {
  const ids = Object.keys(w.battles);
  if (ids.length <= keepMax / 2 && ids.every((id) => (w.battles[id]!.endedAt ?? w.time) >= w.time - keepSeconds)) return;
  const sorted = ids.map((id) => w.battles[id]!).sort((a, b) => b.startedAt - a.startedAt);
  sorted.forEach((b, i) => { if (b.endedAt !== null && (i >= keepMax || b.endedAt < w.time - keepSeconds)) delete w.battles[b.id]; });
}

