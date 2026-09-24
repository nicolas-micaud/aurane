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
  warehouse: { metal: 60 },
  turret_light: { metal: 40, energy: 20 },
  turret_heavy: { metal: 90, energy: 30, crystal: 10 },
  launcher: { metal: 70, energy: 40 },
};
export const BUILDING_SECONDS: Record<Building, number> = {
  extractor: 900, shipyard: 1800, bastion: 1800, tradepost: 1200, amplifier: 1500, antenna: 600,
  warehouse: 900, turret_light: 600, turret_heavy: 1200, launcher: 900,
};
/** Which orbit each structure lives on: 1 industry, 2 military, 3 Signal. */
export const BUILDING_ORBIT: Record<Building, 1 | 2 | 3> = {
  extractor: 1, warehouse: 1, tradepost: 1,
  shipyard: 2, bastion: 2, turret_light: 2, turret_heavy: 2, launcher: 2,
  amplifier: 3, antenna: 3,
};
export const STRUCTURE_HP: Record<Building, number> = {
  extractor: 250, shipyard: 350, bastion: 600, tradepost: 250, amplifier: 250, antenna: 250,
  warehouse: 400, turret_light: 150, turret_heavy: 300, launcher: 200,
};
/** Armed structures: damage per second, range in orbit units (crans), what they counter. */
export const TURRET_STATS: Partial<Record<Building, { dps: number; range: number; counters: 'corvette' | 'frigate' | 'cruiser' }>> = {
  // Ranges are measured from the turret on orbit 2; the station sits at the centre, so a light
  // turret covers ships parked on the station from most angles, a launcher reaches orbit 3.
  turret_light: { dps: 1.0, range: 2.2, counters: 'corvette' },
  turret_heavy: { dps: 2.0, range: 2.8, counters: 'cruiser' },
  launcher: { dps: 1.4, range: 3.4, counters: 'frigate' },
};
export const STATION_HP = 300;
export const STATION_REGEN_PER_S = 0.5;
export const STATION_REBUILD_HOURS = 6;       // from 0 HP, when connected
export const STRUCTURE_REGEN_PER_S = 0.5;
export const SHIP_REPAIR_DOCK_PER_S = 10;
export const SHIP_REPAIR_FIELD_PER_S = 2;
export const BASTION_SHIELD = 0.35;           // damage reduction inside its range
export const BASTION_SHIELD_WATCH = 0.5;
export const BASTION_RANGE = 2.0;
export const PLATEAU_RADIUS = 4;              // fleets enter at this orbit distance
export const COMBAT_VARIANCE_SALVO = 0.1;

export const WAREHOUSE_BASE_CAPACITY = 600;   // per resource per system
export const WAREHOUSE_EXTRA_CAPACITY = 900;  // per Warehouse structure
export const CAPITAL_CAPACITY_MULT = 3;
export const STARTING_CARGOS = 2;
export const ROUTES_BASE = 3;
export const ROUTES_PER_TRADEPOST = 2;
export const CAPITAL_EXTRA_SLOTS = 3;

export const UNIT_COST: Record<UnitType, Partial<Stock>> = {
  corvette: { metal: 20, food: 10 },
  frigate: { metal: 30, energy: 15 },
  cruiser: { metal: 50, crystal: 15 },
  cargo: { metal: 25, food: 10 },
};
export const UNIT_SECONDS: Record<UnitType, number> = { corvette: 300, frigate: 450, cruiser: 900, cargo: 240 };
export const UNIT_POWER: Record<UnitType, number> = { corvette: 1, frigate: 1.4, cruiser: 2.2, cargo: 0 };
/** Continuous combat: hit points, damage per second, range and speed (orbit units per minute). */
export const UNIT_STATS: Record<UnitType, { hp: number; dps: number; range: number; speed: number }> = {
  // Engagements last minutes, not seconds, so a present player can retreat or refocus.
  corvette: { hp: 40, dps: 0.6, range: 0.6, speed: 30 },
  frigate: { hp: 90, dps: 0.8, range: 1.0, speed: 18 },
  cruiser: { hp: 220, dps: 1.8, range: 1.6, speed: 12 },
  cargo: { hp: 1, dps: 0, range: 0, speed: 15 },
};
export const CARGO_CAPACITY = 120;
export const CARGO_SPEED_ON_NET = 45;         // world units per minute (military: 60)
/** Attacker type → defender type it counters. */
export const COUNTERS: Record<UnitType, UnitType | null> = { corvette: 'cruiser', frigate: 'corvette', cruiser: 'frigate', cargo: null };
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
