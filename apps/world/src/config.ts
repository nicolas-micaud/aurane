export interface Config {
  port: number;
  host: string;
  databaseUrl: string | null;
  snapshotDir: string;
  seasonSeed: string;
  galaxyRadius: number;
  seasonDays: number;
  npcCount: number;
  /** Simulated seconds per real second (1 in production, higher for local play-testing). */
  timeScale: number;
  snapshotEverySeconds: number;
  /** Real-time origin of the season: sim time 0 corresponds to this Unix ms. */
  seasonStartMs: number;
}

const num = (v: string | undefined, d: number): number => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 8080),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? null,
    snapshotDir: env.SNAPSHOT_DIR ?? './data',
    seasonSeed: env.SEASON_SEED ?? 'season-0',
    galaxyRadius: num(env.GALAXY_RADIUS, 12),
    seasonDays: num(env.SEASON_DAYS, 56),
    npcCount: num(env.NPC_COUNT, 30),
    timeScale: num(env.TIME_SCALE, 1),
    snapshotEverySeconds: num(env.SNAPSHOT_EVERY, 60),
    seasonStartMs: num(env.SEASON_START_MS, Date.now()),
  };
}
