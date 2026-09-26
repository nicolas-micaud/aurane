import { randomBytes } from 'node:crypto';
import { limitsFromEnv, type QuotaLimits } from '@aurane/general';
import { rpIdFor } from './auth.js';

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
  /** WebAuthn RP ID (decision 0010): the registrable domain of the public origin unless RP_ID says otherwise. */
  rpId: string;
  /** Origins a passkey ceremony may come from: the public origin, plus RP_ORIGINS (comma separated) for development. */
  rpOrigins: string[];
  /** A compiled doctrine waits for the player's confirmation before it is active (DOCTRINE_CONFIRM=1). */
  doctrineConfirm: boolean;
  /** How long a live request waits for the model before the General answers in character without it. */
  talkDeadlineMs: number;
  briefingDeadlineMs: number;
  /** The daily Gazette is written in batch, spread over this many minutes after the day turns. */
  gazetteSpreadMin: number;
  /** Jobs the scheduler runs at once (the providers bound their own concurrency). */
  llmWorkers: number;
  /** Per-player LLM quotas (LLM_QUOTA_*). */
  quotas: QuotaLimits;
  /** The Draw Counsel is written this many minutes before each Draw (decision 0009). */
  counselLeadMin: number;
  /** Budget of a live counsel request before the fallback cards answer. */
  counselDeadlineMs: number;
  /** Daily episodes are written over this many minutes after the day turns. */
  episodeSpreadMin: number;
  /** Monthly LLM budget, EUR, models and memory included (decision 0009: 100); 0 disables the cap. */
  budgetEurMonth: number;
  /** Share of the budget at which the alert fires (0.8). */
  budgetAlertRatio: number;
  /** The dedicated long-memory instance of Aurane (PUT/GET/DELETE /memory/{colony}, Bearer); absent = Postgres only. */
  memoryUrl: string | null;
  memoryToken: string | null;
  /** Outbox flush period (ms, 5000) and reconciliation period with the instance (ms, one hour). */
  memoryFlushMs: number;
  memoryReconcileMs: number;
  /** Health thresholds: oldest unconfirmed write (s, 900) and backup age (h, 26: one missed nightly run). */
  memoryAlertOutboxS: number;
  memoryAlertBackupH: number;
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
    rpId: env.RP_ID || rpIdFor(env.PUBLIC_ORIGIN ?? 'https://play.playaurane.com'),
    rpOrigins: [env.PUBLIC_ORIGIN ?? 'https://play.playaurane.com', ...(env.RP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)],
    doctrineConfirm: env.DOCTRINE_CONFIRM === '1' || env.DOCTRINE_CONFIRM === 'true',
    talkDeadlineMs: num(env.LLM_TALK_DEADLINE_MS, 25000),
    briefingDeadlineMs: num(env.LLM_BRIEFING_DEADLINE_MS, 8000),
    gazetteSpreadMin: num(env.LLM_GAZETTE_SPREAD_MIN, 40),
    llmWorkers: num(env.LLM_WORKERS, 4),
    quotas: limitsFromEnv(env),
    counselLeadMin: num(env.LLM_COUNSEL_LEAD_MIN, 20),
    counselDeadlineMs: num(env.LLM_COUNSEL_DEADLINE_MS, 3000),
    episodeSpreadMin: num(env.LLM_EPISODE_SPREAD_MIN, 30),
    budgetEurMonth: num(env.LLM_BUDGET_EUR_MONTH, 100),
    budgetAlertRatio: num(env.LLM_BUDGET_ALERT_RATIO, 0.8),
    memoryUrl: env.AURANE_MEMORY_URL || null,
    memoryToken: env.AURANE_MEMORY_TOKEN || null,
    memoryFlushMs: num(env.AURANE_MEMORY_FLUSH_MS, 5000),
    memoryReconcileMs: num(env.AURANE_MEMORY_RECONCILE_MS, 3600000),
    memoryAlertOutboxS: num(env.AURANE_MEMORY_ALERT_OUTBOX_S, 900),
    memoryAlertBackupH: num(env.AURANE_MEMORY_ALERT_BACKUP_H, 26),
  };
}
