// Season rules: the knobs the Season 0 design review (docs/design/REVIEW-S0.md) added, all configurable per
// season rather than hard-coded, so a rule can be measured on and off in a headless season.

export interface SeasonRules {
  /** The Renaissance cannot end the season before this fraction of it has elapsed (0.75 = the sixth week of eight). */
  renaissanceEarliestFraction: number;
  /** Hours the Seven Beacons must be held simultaneously by one bloc (alliance or lone colony). */
  renaissanceHoldHours: number;
  /** Extra hold hours per bloc member beyond `renaissanceFreeMembers`: a coalition of twenty holds longer than a band of five. */
  renaissanceHoldHoursPerMember: number;
  renaissanceFreeMembers: number;
  /** Beacons lit by a bloc that holds at least this many trigger the public Beacon Alert (halved capture time on its beacon systems). */
  beaconAlertAt: number;
  /** A captured beacon system passes its lit Beacon (and restarts the hold clock) to the captor. */
  beaconFollowsCapture: boolean;
  /** Below this age (hours) a colony cannot gift, cannot lend its relays to partners' networks, and cannot grant transit. */
  youngColonyHours: number;
  /** A young colony's barter may give at most this many times the value it asks for (base prices). */
  giftRatioMax: number;
  /** Total barter value (base prices) two colonies may exchange per day, in either direction. 0 disables the cap. */
  pairTransferCapPerDay: number;
  /** Whether colonies created from the same origin (device or address hash, set by the server) may trade or share transit. */
  sameOriginTrade: boolean;
  /** Hours between two changes of the Night Watch window. */
  watchChangeCooldownHours: number;
  /** A captured system the captor cannot connect within this many hours falls neutral again. 0 disables. */
  captureGraceHours: number;
  /** The galaxy grows one ring when the rim is this occupied (fraction of rim sectors holding a capital), up to maxRadius. */
  galaxyGrowth: { enabled: boolean; rimOccupancy: number; maxRadius: number };
  /** Minutes before the Draw at which the Oracles learn one band of it. 0 disables the faction perk. */
  oracleHintMinutes: number;
  /** The Concordat's relay range multiplier: +5 % in Season 0 (+10 % gave the faction +42 % of score in a week, REVIEW-S0 § 3). */
  concordatRangeMult: number;
  /** Corsair capitals prefer lair systems (hidden main body); others avoid them. Measured in REVIEW-S0 § 3. */
  spawnLairBias: boolean;
}

export const DEFAULT_RULES: SeasonRules = {
  renaissanceEarliestFraction: 0.75,
  renaissanceHoldHours: 24,
  renaissanceHoldHoursPerMember: 2,
  renaissanceFreeMembers: 5,
  beaconAlertAt: 5,
  beaconFollowsCapture: true,
  youngColonyHours: 24,
  giftRatioMax: 1.25,
  pairTransferCapPerDay: 600,
  sameOriginTrade: false,
  watchChangeCooldownHours: 24,
  captureGraceHours: 24,
  galaxyGrowth: { enabled: true, rimOccupancy: 0.5, maxRadius: 12 },
  oracleHintMinutes: 60,
  concordatRangeMult: 1.05,
  spawnLairBias: true,
};

/** The rules of the first prototype seasons, for measuring what each guard-rail changes. */
export const LEGACY_RULES: SeasonRules = {
  renaissanceEarliestFraction: 0,
  renaissanceHoldHours: 24,
  renaissanceHoldHoursPerMember: 0,
  renaissanceFreeMembers: 20,
  beaconAlertAt: 99,
  beaconFollowsCapture: false,
  youngColonyHours: 0,
  giftRatioMax: Infinity,
  pairTransferCapPerDay: 0,
  sameOriginTrade: true,
  watchChangeCooldownHours: 0,
  captureGraceHours: 0,
  galaxyGrowth: { enabled: false, rimOccupancy: 1, maxRadius: 12 },
  oracleHintMinutes: 0,
  concordatRangeMult: 1.1,
  spawnLairBias: true,
};

export function mergeRules(partial?: Partial<SeasonRules>): SeasonRules {
  return { ...DEFAULT_RULES, ...(partial ?? {}), galaxyGrowth: { ...DEFAULT_RULES.galaxyGrowth, ...(partial?.galaxyGrowth ?? {}) } };
}
