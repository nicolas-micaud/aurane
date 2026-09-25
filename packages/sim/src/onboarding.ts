import type { Building, Command } from '@aurane/protocol';
import { colonyNetwork, hasBuilding, isShielded, logEvent, ownedSystems, visibleSectors } from './world.js';
import type { Colony, Onboarding, World } from './state.js';
import * as B from './balance.js';

/**
 * Progressive onboarding (docs/design/ONBOARDING-S0.md): seven tiers unlocked by game facts, with time floors.
 * Tiers change no simulation rule; they only decide which commands a colony may give and what the client shows.
 * NPCs and veterans sit at the last tier.
 */
export type { Onboarding } from './state.js';

export const ONBOARDING_MAX_TIER = 6;
export const TIER_LINK = 0, TIER_PRODUCE = 1, TIER_MARKET = 2, TIER_HOLD = 3, TIER_STRIKE = 4, TIER_TALK = 5, TIER_BEACONS = 6;

export function freshOnboarding(w: World, npc: boolean): Onboarding {
  return npc || !w.rules.onboarding ? { tier: ONBOARDING_MAX_TIER, unlockedAt: [] } : { tier: 0, unlockedAt: [w.time] };
}

/** Lowest tier at which each command is accepted; commands not listed are open from the start. */
const COMMAND_TIER: Partial<Record<Command['type'], number>> = {
  build: TIER_PRODUCE,
  market_order: TIER_MARKET, cancel_order: TIER_MARKET, barter_offer: TIER_MARKET, barter_accept: TIER_MARKET, decree: TIER_MARKET,
  route_set: TIER_MARKET, route_remove: TIER_MARKET, convoy_send: TIER_MARKET,
  train: TIER_HOLD, fleet_order: TIER_HOLD, focus: TIER_HOLD, split_fleet: TIER_HOLD, set_watch: TIER_HOLD,
  treaty: TIER_TALK, agent_mission: TIER_TALK, alliance_create: TIER_TALK, alliance_invite: TIER_TALK, alliance_join: TIER_TALK, alliance_leave: TIER_TALK,
  light_beacon: TIER_BEACONS,
};

const BUILDING_TIER: Partial<Record<Building, number>> = {
  tradepost: TIER_MARKET,
  shipyard: TIER_HOLD, bastion: TIER_HOLD, turret_light: TIER_HOLD, turret_heavy: TIER_HOLD, launcher: TIER_HOLD, refinery: TIER_HOLD, synthesizer: TIER_HOLD,
};

const STRIKE_ORDERS = new Set(['raid', 'blockade', 'ambush']);

/** The tier a command needs (0 when it is always open). */
export function commandTier(cmd: Command): number {
  if (cmd.type === 'build') return Math.max(TIER_PRODUCE, BUILDING_TIER[cmd.building] ?? 0);
  if (cmd.type === 'fleet_order') return STRIKE_ORDERS.has(cmd.order) ? TIER_STRIKE : TIER_HOLD;
  return COMMAND_TIER[cmd.type] ?? 0;
}

/** `locked:<tier>` when the colony has not reached the command's tier, otherwise null. */
export function lockedReason(colony: Colony, cmd: Command): string | null {
  const need = commandTier(cmd);
  return colony.onboarding.tier >= need ? null : `locked:${need}`;
}

function hasWarship(w: World, colony: Colony): boolean {
  return Object.values(w.fleets).some((f) => f.owner === colony.id && f.units.corvette + f.units.frigate + f.units.cruiser > 0);
}

function inboundAlert(w: World, colony: Colony): boolean {
  return w.events.some((e) => e.kind === 'fleet.inbound' && e.actors[1] === colony.id);
}

/** Whether the next tier's condition holds (docs/design/ONBOARDING-S0.md, table of tiers). */
function reached(w: World, colony: Colony, tier: number): boolean {
  const age = w.time - colony.createdAt;
  switch (tier) {
    case TIER_PRODUCE: return Object.values(w.relays).some((r) => r.owner === colony.id);
    case TIER_MARKET: {
      if (age < 3600 || colony.scoreWindow.length === 0) return false;
      const net = colonyNetwork(w, colony);
      return ownedSystems(w, colony.id).filter((id) => net.has(id)).length >= 3;
    }
    case TIER_HOLD: {
      if (age < 6 * 3600) return false;
      const shieldLeft = colony.createdAt + B.shieldHours(w.seasonEndsAt / 86400) * 3600 - w.time;
      return hasBuilding(w, colony.capital, 'shipyard') || inboundAlert(w, colony) || shieldLeft < 12 * 3600;
    }
    case TIER_STRIKE: return !isShielded(w, colony) && hasWarship(w, colony);
    case TIER_TALK: {
      if (age < 86400) return false;
      const seen = visibleSectors(w, colony);
      return Object.values(w.colonies).some((c) => c.id !== colony.id && !c.npc && seen.has(w.galaxy.systems[c.capital]!.sector));
    }
    case TIER_BEACONS: {
      const net = colonyNetwork(w, colony);
      if (ownedSystems(w, colony.id).filter((id) => net.has(id)).length >= 10) return true;
      const seen = visibleSectors(w, colony);
      return w.galaxy.beacons.some((b) => seen.has(w.galaxy.systems[b]?.sector ?? ''));
    }
    default: return false;
  }
}


/**
 * Raise the colony's tier while the next condition holds. Called at every Draw and around every command; each
 * unlock leaves a journal line (`onboarding.<tier>`) and an event (`onboarding.unlocked`) the client turns into
 * the General's first word on the new screen.
 */
export function advanceOnboarding(w: World, colony: Colony): number {
  let unlocked = 0;
  while (colony.onboarding.tier < ONBOARDING_MAX_TIER && reached(w, colony, colony.onboarding.tier + 1)) {
    unlockTier(w, colony, colony.onboarding.tier + 1);
    unlocked++;
  }
  return unlocked;
}

function unlockTier(w: World, colony: Colony, tier: number): void {
  colony.onboarding.tier = tier;
  colony.onboarding.unlockedAt[tier] = w.time;
  if (colony.npc) return;
  colony.journal.push({ at: w.time, kind: `onboarding.${tier}` });
  if (colony.journal.length > B.JOURNAL_MAX) colony.journal.splice(0, colony.journal.length - B.JOURNAL_MAX);
  logEvent(w, 'onboarding.unlocked', [colony.id], { tier });
}

/** "Show me everything": a veteran opens every tier at once. */
export function unlockAll(w: World, colony: Colony): void {
  if (colony.onboarding.tier >= ONBOARDING_MAX_TIER) return;
  colony.onboarding.tier = ONBOARDING_MAX_TIER;
  colony.onboarding.unlockedAt[ONBOARDING_MAX_TIER] = w.time;
  if (!colony.npc) { colony.journal.push({ at: w.time, kind: 'onboarding.all' }); logEvent(w, 'onboarding.unlocked', [colony.id], { tier: ONBOARDING_MAX_TIER, all: true }); }
}
