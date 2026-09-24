import { generateGalaxy, type GalaxyOptions } from './galaxy.js';
import type { World } from './state.js';

export interface WorldSnapshot { version: 1; galaxyOptions: GalaxyOptions; state: Omit<World, 'galaxy'> }

/** The galaxy is deterministic from the seed, so a snapshot stores only the mutable state. */
export function snapshotWorld(w: World, galaxyOptions: GalaxyOptions): WorldSnapshot {
  const { galaxy: _galaxy, ...state } = w;
  return { version: 1, galaxyOptions, state: JSON.parse(JSON.stringify(state)) as Omit<World, 'galaxy'> };
}

export function restoreWorld(snap: WorldSnapshot): World {
  const galaxy = generateGalaxy(snap.state.seed, snap.galaxyOptions);
  return { ...snap.state, galaxy };
}
