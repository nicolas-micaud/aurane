import { BAND_COUNT, BANDS_PER_DRAW } from '@starnet/protocol';
import { DRAW_EVENT_PROBABILITY, DRAW_MEMORY_PENALTY } from './balance.js';
import { createRng, subSeed } from './rng.js';

export type DrawEvent =
  | { kind: 'none' }
  | { kind: 'eruption'; band: number }
  | { kind: 'storm'; region: string }
  | { kind: 'echo'; beacon: string };

export interface Draw {
  index: number;         // hour index since season start
  bands: number[];       // BANDS_PER_DRAW distinct bands in 1..BAND_COUNT
  event: DrawEvent;
}

export interface DrawInputs {
  seasonSeed: number;
  index: number;
  previous?: Draw | undefined;
  regions: readonly string[];
  beacons: readonly string[];
}

/**
 * The hourly Draw. Bands drawn last hour are half as likely this hour: observable, never
 * certain. Deterministic from the season seed and the hour index, so every node and every
 * client can verify it.
 */
export function rollDraw(input: DrawInputs): Draw {
  const rng = createRng(subSeed(input.seasonSeed, 'draw', input.index));
  const prev = new Set(input.previous?.bands ?? []);
  const pool = Array.from({ length: BAND_COUNT }, (_, i) => i + 1);
  const bands: number[] = [];
  while (bands.length < BANDS_PER_DRAW) {
    const weights = pool.map((b) => (prev.has(b) ? DRAW_MEMORY_PENALTY : 1));
    const total = weights.reduce((s, w) => s + w, 0);
    let x = rng.next() * total;
    let picked = pool[pool.length - 1]!;
    for (let i = 0; i < pool.length; i++) { x -= weights[i]!; if (x <= 0) { picked = pool[i]!; break; } }
    bands.push(picked);
    pool.splice(pool.indexOf(picked), 1);
  }
  bands.sort((a, b) => a - b);
  let event: DrawEvent = { kind: 'none' };
  if (rng.next() < DRAW_EVENT_PROBABILITY) {
    const roll = rng.next();
    if (roll < 0.4) event = { kind: 'eruption', band: rng.pick(bands) };
    else if (roll < 0.75 && input.regions.length) event = { kind: 'storm', region: rng.pick(input.regions) };
    else if (input.beacons.length) event = { kind: 'echo', beacon: rng.pick(input.beacons) };
  }
  return { index: input.index, bands, event };
}

/** The Oracles know one band of the next draw an hour early. Which one is also deterministic. */
export function oracleHint(seasonSeed: number, next: Draw): number {
  const rng = createRng(subSeed(seasonSeed, 'oracle', next.index));
  return rng.pick(next.bands);
}
