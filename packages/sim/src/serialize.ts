import { generateGalaxy, type GalaxyOptions } from './galaxy.js';
import * as B from './balance.js';
import type { Colony, Structure, SystemState, World } from './state.js';
import { emptyDamage, emptyFleet } from './state.js';

export interface WorldSnapshot { version: 2; galaxyOptions: GalaxyOptions; state: Omit<World, 'galaxy'> }
/** Season-0 alpha layout: one stock per colony, buildings as a list of kinds, no stations. */
interface WorldSnapshotV1 { version: 1; galaxyOptions: GalaxyOptions; state: Record<string, unknown> }

/** The galaxy is deterministic from the seed, so a snapshot stores only the mutable state. */
export function snapshotWorld(w: World, galaxyOptions: GalaxyOptions): WorldSnapshot {
  const state: Partial<World> = { ...w };
  delete state.galaxy;
  return { version: 2, galaxyOptions, state: JSON.parse(JSON.stringify(state)) as Omit<World, 'galaxy'> };
}

export function restoreWorld(snap: WorldSnapshot | WorldSnapshotV1): World {
  const galaxy = generateGalaxy((snap.state as { seed: number }).seed, snap.galaxyOptions);
  const state = snap.version === 1 ? migrateV1(snap.state) : snap.state;
  return { ...state, galaxy };
}

/** v1 → v2: the colony stock moves to its capital, buildings become structures, stations stand at full HP. */
function migrateV1(raw: Record<string, unknown>): Omit<World, 'galaxy'> {
  const s = raw as unknown as Omit<World, 'galaxy'> & { colonies: Record<string, Colony & { stock?: unknown }> };
  let n = 0;
  for (const [id, st] of Object.entries(s.systems as Record<string, SystemState & { buildings?: string[] }>)) {
    const kinds = (st.buildings ?? []) as Structure['kind'][];
    delete st.buildings;
    st.structures ??= kinds.map((kind, i) => ({ id: `mig${(n++).toString(36)}`, kind, orbit: B.BUILDING_ORBIT[kind], angle: (i * 67) % 360, hp: B.STRUCTURE_HP[kind] }));
    st.stationHp ??= st.owner ? B.STATION_HP : 0;
    st.stock ??= B.emptyStock();
    st.engaged ??= false;
    for (const j of st.buildQueue) (j as { orbit?: number }).orbit ??= B.BUILDING_ORBIT[j.building];
    void id;
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
