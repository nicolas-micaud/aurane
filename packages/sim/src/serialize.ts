import { generateGalaxy, type GalaxyOptions } from './galaxy.js';
import * as B from './balance.js';
import { layoutOf } from './pois.js';
import type { Colony, Structure, SystemState, World } from './state.js';
import { emptyDamage, emptyFleet } from './state.js';

export interface WorldSnapshot { version: 3; galaxyOptions: GalaxyOptions; state: Omit<World, 'galaxy'> }
/** v2: one plateau per system (0002). v1: one stock per colony, buildings as a list of kinds. */
interface WorldSnapshotOld { version: 1 | 2; galaxyOptions: GalaxyOptions; state: Record<string, unknown> }

/** The galaxy is deterministic from the seed, so a snapshot stores only the mutable state. */
export function snapshotWorld(w: World, galaxyOptions: GalaxyOptions): WorldSnapshot {
  const state: Partial<World> = { ...w };
  delete state.galaxy;
  return { version: 3, galaxyOptions, state: JSON.parse(JSON.stringify(state)) as Omit<World, 'galaxy'> };
}

export function restoreWorld(snap: WorldSnapshot | WorldSnapshotOld): World {
  const galaxy = generateGalaxy((snap.state as { seed: number }).seed, snap.galaxyOptions);
  let state = snap.version === 1 ? migrateV1(snap.state) : (snap.state as Omit<World, 'galaxy'>);
  if (snap.version < 3) state = migrateV2(state, galaxy);
  return { ...state, galaxy };
}

/** v1 → v2: the colony stock moves to its capital, buildings become structures, stations stand at full HP. */
function migrateV1(raw: Record<string, unknown>): Omit<World, 'galaxy'> {
  const s = raw as unknown as Omit<World, 'galaxy'> & { colonies: Record<string, Colony & { stock?: unknown }> };
  let n = 0;
  for (const st of Object.values(s.systems as Record<string, SystemState & { buildings?: string[] }>)) {
    const kinds = (st.buildings ?? []) as Structure['kind'][];
    delete st.buildings;
    st.structures ??= kinds.map((kind, i) => ({ id: `mig${(n++).toString(36)}`, kind, poi: '', orbit: B.BUILDING_ORBIT[kind], angle: (i * 67) % 360, hp: B.STRUCTURE_HP[kind] }));
    st.stationHp ??= st.owner ? B.STATION_HP : 0;
    st.stock ??= B.emptyStock();
    st.engaged ??= false;
    for (const j of st.buildQueue) (j as { orbit?: number }).orbit ??= B.BUILDING_ORBIT[j.building];
  }
  for (const c of Object.values(s.colonies)) {
    const stock = c.stock as Record<string, number> | undefined;
    if (stock) {
      const cap = s.systems[c.capital];
      if (cap) for (const r of B.RESOURCE_LIST) cap.stock[r] += stock[r] ?? 0;
      delete c.stock;
    }
    c.marketSystem ??= c.capital;
    c.lastOverflow ??= B.emptyStock();
  }
  for (const f of Object.values(s.fleets)) {
    f.units = { ...emptyFleet(), ...f.units };
    f.damage ??= emptyDamage();
    f.cargo ??= B.emptyStock();
    f.path ??= f.destination ? [f.destination] : [];
    f.pos ??= null;
    f.focus ??= null;
    const o = f.order as unknown as { kind: string; target?: string; relay?: string };
    if (o.kind === 'raid' && o.relay !== undefined) {
      const relay = s.relays[o.relay];
      f.order = relay ? { kind: 'raid', target: 'station', via: relay.a } : { kind: 'idle' };
    }
  }
  s.routes ??= {};
  s.battles ??= {};
  s.engagedSystems ??= [];
  return s;
}

/** v2 → v3: everything that stood on the system's single plateau now stands at its main point of interest. */
function migrateV2(s: Omit<World, 'galaxy'>, galaxy: ReturnType<typeof generateGalaxy>): Omit<World, 'galaxy'> {
  for (const [id, st] of Object.entries(s.systems)) {
    const main = layoutOf(galaxy, id).main;
    st.mainPoi ||= main;
    for (const x of st.structures) x.poi ||= st.mainPoi;
    for (const j of st.buildQueue) j.poi ||= st.mainPoi;
    st.engagedPois ??= st.engaged ? [st.mainPoi] : [];
  }
  for (const f of Object.values(s.fleets)) {
    f.poi ??= f.at ? s.systems[f.at]?.mainPoi ?? null : null;
    f.hops ??= [];
    f.hop ??= null;
  }
  for (const b of Object.values(s.battles)) b.poi ||= s.systems[b.system]?.mainPoi ?? '';
  s.known ??= {};
  return s;
}
