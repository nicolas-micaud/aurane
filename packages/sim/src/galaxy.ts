import type { Hex, Resource } from '@starnet/protocol';
import { createRng, subSeed, type Rng } from './rng.js';
import { hexDisk, hexKey, hexRing, hexToPixel, regionKey } from './hex.js';
import { SECTOR_SIZE } from './balance.js';
import type { Point, Circle } from './geometry.js';
import { dist, pointSegmentDistance, segmentLengthInCircle } from './geometry.js';
import { hexNeighbors } from './hex.js';

export type SystemKind = 'normal' | 'pulsar' | 'beacon';

export interface StarSystem extends Point {
  id: string;
  name: string;
  sector: string;
  region: string;
  kind: SystemKind;
  resource: Resource;
  band: number;          // 1..8
  baseYield: number;
  slots: number;
  hue: number;
  /** Beacon lore name, only for kind === 'beacon'. */
  beaconName?: string;
}

export interface Sector {
  key: string;
  hex: Hex;
  region: string;
  ring: number;
  origin: Point;         // world position of the sector's bounding box origin
  systems: string[];
  nebulae: Circle[];
  blackHoles: Circle[];
}

/** Static part of a possible relay: geometry never changes, only the owner's range does. */
export interface LinkCandidate { to: string; length: number; extra: number }

export interface Galaxy {
  seed: number;
  radius: number;
  sectors: Record<string, Sector>;
  systems: Record<string, StarSystem>;
  beacons: string[];
  /** Per system: reachable neighbours within MAX_LINK_LENGTH, not blocked by a black hole. */
  candidates: Record<string, LinkCandidate[]>;
}

/** Upper bound of any relay range with every multiplier stacked. */
export const MAX_LINK_LENGTH = 520;

const SYLLABLES = ['ka', 'ra', 'vex', 'lo', 'mi', 'zen', 'tor', 'qua', 'nyx', 'sol', 'dra', 'eo',
  'lum', 'is', 'ar', 'cy', 'ven', 'tha', 'or', 'phe', 'xi', 'ul', 'no', 'bel', 'am', 'ir'];

export const BEACON_NAMES = ['Ancre', 'Méridien', 'Aube', 'Vigie', 'Clef', 'Serment', 'Dernier'] as const;

function makeName(rng: Rng): string {
  const n = rng.int(2, 3);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(SYLLABLES);
  return s[0]!.toUpperCase() + s.slice(1) + (rng.next() < 0.3 ? `-${rng.int(2, 99)}` : '');
}

/**
 * Resource geography, deliberately unbalanced: energy and crystal concentrate towards the
 * core, food towards the rim, metal everywhere. Nobody is self-sufficient.
 */
function resourceWeights(ring: number, radius: number): Record<Resource, number> {
  const t = radius === 0 ? 0 : ring / radius; // 0 core .. 1 rim
  return {
    metal: 1,
    energy: 0.4 + 1.0 * (1 - t),
    food: 0.4 + 1.0 * t,
    crystal: 0.15 + 0.6 * (1 - t) ** 2,
  };
}

function weightedPick(rng: Rng, weights: Record<Resource, number>): Resource {
  const entries = Object.entries(weights) as [Resource, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rng.next() * total;
  for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
  return entries[entries.length - 1]![0];
}

export interface GalaxyOptions {
  radius?: number;
  systemsPerSector?: [number, number];
}

/** Deterministic galaxy for a season seed. Same seed and options ⇒ identical galaxy. */
export function generateGalaxy(seed: number | string, opts: GalaxyOptions = {}): Galaxy {
  const root = typeof seed === 'string' ? createRng(seed).state() : seed >>> 0;
  const radius = opts.radius ?? 12;
  const [minSys, maxSys] = opts.systemsPerSector ?? [6, 12];
  const galaxy: Galaxy = { seed: root, radius, sectors: {}, systems: {}, beacons: [], candidates: {} };
  const hexes = hexDisk(radius);

  // Beacon sectors: the centre plus six around it at distance 2, one per direction.
  const beaconHexes: Hex[] = [{ q: 0, r: 0 }, { q: 2, r: -1 }, { q: 1, r: 1 }, { q: -1, r: 2 }, { q: -2, r: 1 }, { q: -1, r: -1 }, { q: 1, r: -2 }];
  const beaconSet = new Set(beaconHexes.map(hexKey));

  for (const hex of hexes) {
    const key = hexKey(hex);
    const rng = createRng(subSeed(root, 'sector', key));
    const px = hexToPixel(hex, SECTOR_SIZE * 0.62);
    const origin = { x: px.x - SECTOR_SIZE / 2, y: px.y - SECTOR_SIZE / 2 };
    const ring = hexRing(hex);
    const sector: Sector = { key, hex, region: regionKey(hex), ring, origin, systems: [], nebulae: [], blackHoles: [] };

    const bhCount = rng.next() < 0.55 ? 1 : rng.next() < 0.3 ? 2 : 0;
    while (sector.blackHoles.length < bhCount) {
      const bh = { x: origin.x + rng.range(200, 800), y: origin.y + rng.range(200, 800), r: rng.range(30, 50) };
      if (sector.blackHoles.every((o) => dist(o, bh) > 300)) sector.blackHoles.push(bh);
    }
    const nebCount = rng.int(1, 3);
    for (let i = 0; i < nebCount; i++) {
      sector.nebulae.push({ x: origin.x + rng.range(100, 900), y: origin.y + rng.range(100, 900), r: rng.range(80, 140) });
    }

    const count = rng.int(minSys, maxSys);
    const weights = resourceWeights(ring, radius);
    const placed: Point[] = [];
    for (let tries = 0; tries < 4000 && placed.length < count; tries++) {
      const p = { x: origin.x + rng.range(60, SECTOR_SIZE - 60), y: origin.y + rng.range(60, SECTOR_SIZE - 60) };
      if (placed.some((s) => dist(s, p) < 90)) continue;
      if (sector.blackHoles.some((bh) => dist(bh, p) < bh.r + 40)) continue;
      placed.push(p);
      const idx = placed.length - 1;
      const id = `S${key}#${idx}`;
      const sys: StarSystem = {
        id, name: makeName(rng), sector: key, region: sector.region, kind: rng.next() < 0.08 ? 'pulsar' : 'normal',
        resource: weightedPick(rng, weights), band: rng.int(1, 8),
        baseYield: 1, slots: rng.next() < 0.2 ? 3 : rng.next() < 0.5 ? 2 : 1,
        hue: rng.int(0, 360), ...p,
      };
      galaxy.systems[id] = sys;
      sector.systems.push(id);
    }

    if (beaconSet.has(key) && sector.systems.length > 0) {
      const beaconIdx = beaconHexes.findIndex((h) => hexKey(h) === key);
      const target = galaxy.systems[sector.systems[0]!]!;
      target.kind = 'beacon';
      target.resource = 'crystal';
      target.beaconName = BEACON_NAMES[beaconIdx]!;
      target.name = target.beaconName;
      target.slots = 3;
      galaxy.beacons.push(target.id);
    }
    galaxy.sectors[key] = sector;
  }
  computeCandidates(galaxy);
  return galaxy;
}

/** Static geometry of every possible relay (same or adjacent sector, within MAX_LINK_LENGTH). */
function computeCandidates(galaxy: Galaxy): void {
  for (const id of Object.keys(galaxy.systems)) galaxy.candidates[id] = [];
  for (const sector of Object.values(galaxy.sectors)) {
    const nearby = [sector, ...hexNeighbors(sector.hex).map((h) => galaxy.sectors[hexKey(h)]).filter((x): x is Sector => !!x)];
    for (const aId of sector.systems) {
      const a = galaxy.systems[aId]!;
      for (const other of nearby) {
        for (const bId of other.systems) {
          if (bId <= aId && other.key === sector.key) continue; // each intra-sector pair once
          if (other.key !== sector.key && bId < aId) continue;
          const b = galaxy.systems[bId]!;
          const length = dist(a, b);
          if (length > MAX_LINK_LENGTH) continue;
          const sectors = other.key === sector.key ? [sector] : [sector, other];
          if (sectors.some((s) => s.blackHoles.some((bh) => pointSegmentDistance(bh, a, b) < bh.r))) continue;
          let extra = 0;
          for (const s of sectors) for (const neb of s.nebulae) extra += segmentLengthInCircle(a, b, neb);
          galaxy.candidates[aId]!.push({ to: bId, length, extra });
          galaxy.candidates[bId]!.push({ to: aId, length, extra });
        }
      }
    }
  }
  for (const list of Object.values(galaxy.candidates)) list.sort((x, y) => x.length - y.length || (x.to < y.to ? -1 : 1));
}

/** Sectors adjacent to a given sector key, restricted to those that exist. */
export function sectorNeighbors(galaxy: Galaxy, key: string): Sector[] {
  const s = galaxy.sectors[key];
  if (!s) return [];
  const out: Sector[] = [];
  for (const d of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const) {
    const n = galaxy.sectors[hexKey({ q: s.hex.q + d[0], r: s.hex.r + d[1] })];
    if (n) out.push(n);
  }
  return out;
}
