// Every tunable number in one place. Balanced by accelerated seasons, not by feel.
import type { Building, Resource, Stock, UnitType } from '@aurane/protocol';

export const SECTOR_SIZE = 1000;          // world units per sector edge box
export const BASE_RANGE = 260;            // relay range in world units (systems are ~130 apart on average)
export const PULSAR_RANGE_MULT = 1.5;
export const AMPLIFIER_RANGE_MULT = 1.25;
export const CONCORDAT_RANGE_MULT = 1.1;
export const NEBULA_COST_MULT = 2;
export const RELAY_COST_PER_UNIT: Stock = { metal: 0.08, energy: 0.04, food: 0, crystal: 0 };
export const RELAY_UPKEEP_PER_UNIT = 0.006;// energy per draw per world unit of relay
export const UPKEEP_SCALE_PER_RELAY = 0.03; // total upkeep × (1 + 0.03 × active relays): big networks pay superlinearly
export const RELAY_BUILD_SECONDS_PER_UNIT = 4; // 190 units ≈ 13 min
export const RELAY_REPAIR_COST_FRACTION = 0.5;
export const RELAY_CUT_HOURS = 6;

export const DRAW_INTERVAL_S = 3600;
export const DRAW_MATCH_MULT = 3;         // systems whose band is drawn produce ×3
export const DRAW_ERUPTION_MULT = 5;
export const DRAW_EVENT_PROBABILITY = 1 / 12;
export const DRAW_MEMORY_PENALTY = 0.5;   // probability weight of a band drawn last hour
export const STORM_RANGE_MULT = 0.8;

export const BASE_YIELD = 4;              // specialty yield per system per draw, before multipliers
export const GENERIC_YIELD = 1;           // every connected system also trickles 1 of each resource
export const CAPITAL_GENERIC_YIELD = 3;   // a capital is a developed world: 3 of each per draw
export const CREDITS_PER_SYSTEM_PER_DRAW = 2; // market liquidity grows with the network; fees destroy it
export const EXTRACTOR_MULT = 1.5;
export const POP_GROWTH = 0.02;           // per draw when fed
export const POP_FOOD_PER_UNIT = 0.05;
export const POP_YIELD_BONUS = 0.5;       // extra yield fraction at full population

export const MARKET_FEE = 0.05;
export const MARKET_FEE_TRADEPOST = 0.03;
export const GUILD_FEE_MULT = 0.5;
export const ALLY_TRANSFER_CAP_PER_DRAW = 200;

export const BUILDING_COST: Record<Building, Partial<Stock>> = {
  extractor: { metal: 60 },
  shipyard: { metal: 80, crystal: 20 },
  bastion: { metal: 90, energy: 30 },
  tradepost: { food: 50, metal: 40 },
  amplifier: { energy: 40, crystal: 25 },
  antenna: { energy: 30 },
};
export const BUILDING_SECONDS: Record<Building, number> = {
  extractor: 900, shipyard: 1800, bastion: 1800, tradepost: 1200, amplifier: 1500, antenna: 600,
};
export const CAPITAL_EXTRA_SLOTS = 3;

export const UNIT_COST: Record<UnitType, Partial<Stock>> = {
  corvette: { metal: 20, food: 10 },
  frigate: { metal: 30, energy: 15 },
  cruiser: { metal: 50, crystal: 15 },
};
export const UNIT_SECONDS: Record<UnitType, number> = { corvette: 300, frigate: 450, cruiser: 900 };
export const UNIT_POWER: Record<UnitType, number> = { corvette: 1, frigate: 1.4, cruiser: 2.2 };
/** Attacker type → defender type it counters. */
export const COUNTERS: Record<UnitType, UnitType> = { corvette: 'cruiser', frigate: 'corvette', cruiser: 'frigate' };
export const COUNTER_MULT = 1.5;
export const COMBAT_VARIANCE = 0.15;
export const FLEET_SPEED_ON_NET = 60;     // world units per minute
export const OFF_NET_SPEED_MULT = 0.5;
export const OFF_NET_ENERGY_PER_UNIT = 0.02;
export const CORSAIR_SHIP_COST_MULT = 0.85;
export const CORSAIR_SPEED_MULT = 1.1;
export const BASTION_DEFENSE_MULT = 2;
export const WATCH_HOURS = 8;
export const WATCH_DEFENSE_MULT = 2;
export const NEWCOMER_SHIELD_HOURS = 72;
export const BLOCKADE_CAPTURE_HOURS = 12;
export const LOOT_FRACTION = 0.25;
export const BULLY_SCORE_RATIO = 3;

export const AGENT_COST_INFLUENCE = { spy: 10, sabotage: 25, envoy: 15 } as const;
export const AGENT_SECONDS = { spy: 1800, sabotage: 3600, envoy: 2700 } as const;
export const SPY_REVEAL_HOURS = 6;
export const SABOTAGE_BASE_SUCCESS = 0.6;
export const INFLUENCE_PER_CRYSTAL = 0.1;

export const TREATY_COST_INFLUENCE = { nap: 20, trade: 15, transit: 15, federation: 60 } as const;
export const NAP_DAYS = 7;
export const TREATY_BREAK_INFLUENCE = 40;

export const BEACON_CRYSTAL = 2000;
export const BEACON_RANGE_MULT = 1.3;
export const BEACON_RADIUS = 2;           // in sectors
export const BEACON_SCORE = 10;
export const TITLE_SCORE = 5;
export const SCORE_WINDOW_DRAWS = 24;
export const SEASON_DAYS = 56;
export const RENAISSANCE_HOURS = 24;

export const STARTING_STOCK: Stock = { metal: 300, energy: 200, food: 200, crystal: 40 };
export const STARTING_INFLUENCE = 20;

export const RESOURCE_LIST: readonly Resource[] = ['metal', 'energy', 'food', 'crystal'];
export const emptyStock = (): Stock => ({ metal: 0, energy: 0, food: 0, crystal: 0 });
