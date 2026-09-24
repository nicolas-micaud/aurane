import { randomBytes } from 'node:crypto';

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
  /** Closed beta: a new colony needs an invitation code. */
  requireInvite: boolean;
  /** Bootstrap invitation codes from the environment (comma separated), usable once each. */
  inviteCodes: string[];
  /** Token for the admin endpoints (invitations); null disables them. */
  adminToken: string | null;
  /** Signs device-link codes. Random per process when unset: links then die with the process. */
  authSecret: string;
  /** Public origin used in device links, e.g. https://play.playaurane.com. */
  publicOrigin: string;
}

const num = (v: string | undefined, d: number): number => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 8080),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? null,
    snapshotDir: env.SNAPSHOT_DIR ?? './data',
    seasonSeed: env.SEASON_SEED ?? 'aurane-s0',
    galaxyRadius: num(env.GALAXY_RADIUS, 12),
    seasonDays: num(env.SEASON_DAYS, 56),
    npcCount: num(env.NPC_COUNT, 30),
    timeScale: num(env.TIME_SCALE, 1),
    snapshotEverySeconds: num(env.SNAPSHOT_EVERY, 60),
    seasonStartMs: num(env.SEASON_START_MS, Date.now()),
    requireInvite: env.REQUIRE_INVITE === '1' || env.REQUIRE_INVITE === 'true',
    inviteCodes: (env.INVITE_CODES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    adminToken: env.ADMIN_TOKEN || null,
    authSecret: env.AUTH_SECRET || randomBytes(32).toString('hex'),
    publicOrigin: env.PUBLIC_ORIGIN ?? 'https://play.playaurane.com',
  };
}
