import type { Fleet, UnitType } from '@aurane/protocol';
import { COMBAT_VARIANCE, COUNTERS, COUNTER_MULT, UNIT_POWER } from './balance.js';
import { createRng } from './rng.js';
import { combatSize as fleetSize } from './state.js';

const TYPES: readonly UnitType[] = ['corvette', 'frigate', 'cruiser'];

/** ×1.5 when `attacker` counters `defender` (rock-paper-scissors). */
export function counterMult(attacker: UnitType, defender: UnitType | null): number {
  return defender && COUNTERS[attacker] === defender ? COUNTER_MULT : 1;
}

/** Power of `f` against composition `vs`, with rock-paper-scissors bonuses. */
export function fleetPower(f: Fleet, vs: Fleet): number {
  const total = Math.max(1, fleetSize(vs));
  let power = 0;
  for (const t of TYPES) {
    const c = COUNTERS[t];
    const counteredShare = c ? vs[c] / total : 0;
    power += f[t] * UNIT_POWER[t] * (1 + (COUNTER_MULT - 1) * counteredShare);
  }
  return power;
}

export interface BattleResult {
  attackerWins: boolean;
  attackerLosses: Fleet;
  defenderLosses: Fleet;
  attackerPower: number;
  defenderPower: number;
}

function applyLosses(f: Fleet, fraction: number, rng: () => number): Fleet {
  const out: Fleet = { ...f };
  for (const t of TYPES) {
    const exact = f[t] * fraction;
    const lost = Math.min(f[t], Math.floor(exact) + (rng() < exact - Math.floor(exact) ? 1 : 0));
    out[t] = lost;
  }
  return out;
}

/**
 * One-pass deterministic resolution (seeded). Losses are proportional to the power ratio:
 * the loser loses most of its fleet, the winner loses in proportion to how close it was.
 * `defenseMult` folds in bastions and the night watch.
 */
export function resolveBattle(attacker: Fleet, defender: Fleet, defenseMult: number, seed: number): BattleResult {
  const rng = createRng(seed);
  const va = 1 + (rng.next() * 2 - 1) * COMBAT_VARIANCE;
  const vd = 1 + (rng.next() * 2 - 1) * COMBAT_VARIANCE;
  const attackerPower = fleetPower(attacker, defender) * va;
  const defenderPower = fleetPower(defender, attacker) * defenseMult * vd;
  if (fleetSize(defender) === 0) {
    return { attackerWins: true, attackerLosses: { corvette: 0, frigate: 0, cruiser: 0, cargo: 0 }, defenderLosses: { ...defender }, attackerPower, defenderPower };
  }
  const attackerWins = attackerPower > defenderPower;
  const ratio = Math.min(attackerPower, defenderPower) / Math.max(attackerPower, defenderPower, 1e-9);
  const winnerLoss = 0.15 + 0.45 * ratio;   // 15 % .. 60 %
  const loserLoss = 0.5 + 0.4 * ratio;      // 50 % .. 90 %
  return {
    attackerWins,
    attackerLosses: applyLosses(attacker, attackerWins ? winnerLoss : loserLoss, rng.next),
    defenderLosses: applyLosses(defender, attackerWins ? loserLoss : winnerLoss, rng.next),
    attackerPower,
    defenderPower,
  };
}

export function subtractFleet(f: Fleet, losses: Fleet): Fleet {
  return { corvette: f.corvette - losses.corvette, frigate: f.frigate - losses.frigate, cruiser: f.cruiser - losses.cruiser, cargo: f.cargo - (losses.cargo ?? 0) };
}

export function addFleet(a: Fleet, b: Fleet): Fleet {
  return { corvette: a.corvette + b.corvette, frigate: a.frigate + b.frigate, cruiser: a.cruiser + b.cruiser, cargo: a.cargo + b.cargo };
}
