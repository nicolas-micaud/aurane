// Persistence behind one small interface: Postgres in production, JSON files for local
// development and tests. The world is a single snapshot; players map tokens to colonies.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { WorldSnapshot } from '@aurane/sim';

export interface PlayerRecord { id: string; colonyId: string; tokenHash: string; name: string; createdAt: number }
export interface InviteRecord { code: string; note: string; createdAt: number; usedBy: string | null; usedAt: number | null }

export interface Store {
  loadSnapshot(): Promise<WorldSnapshot | null>;
  saveSnapshot(snap: WorldSnapshot): Promise<void>;
  /** Keep the current snapshot under a label (a finished season) before a fresh world replaces it. */
  archiveSnapshot(label: string): Promise<void>;
  createPlayer(p: PlayerRecord): Promise<void>;
  findPlayerByToken(tokenHash: string): Promise<PlayerRecord | null>;
  createInvite(i: InviteRecord): Promise<void>;
  findInvite(code: string): Promise<InviteRecord | null>;
  /** Marks the invitation used; false when it was already used or unknown. */
  useInvite(code: string, colonyId: string, at: number): Promise<boolean>;
  listInvites(): Promise<InviteRecord[]>;
  /** Make a used invitation usable again (its colony belonged to a season that is over). */
  releaseInvite(code: string): Promise<void>;
  close(): Promise<void>;
}

export class FileStore implements Store {
  private players = new Map<string, PlayerRecord>();
  private invites = new Map<string, InviteRecord>();
  private loaded = false;
  constructor(private readonly dir: string) {}

  private async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(join(this.dir, 'players.json'), 'utf8');
      for (const p of JSON.parse(raw) as PlayerRecord[]) this.players.set(p.tokenHash, p);
    } catch { /* first run */ }
    try {
      const raw = await readFile(join(this.dir, 'invites.json'), 'utf8');
      for (const i of JSON.parse(raw) as InviteRecord[]) this.invites.set(i.code, i);
    } catch { /* first run */ }
  }

  async loadSnapshot(): Promise<WorldSnapshot | null> {
    await this.ensure();
    try { return JSON.parse(await readFile(join(this.dir, 'world.json'), 'utf8')) as WorldSnapshot; } catch { return null; }
  }

  async saveSnapshot(snap: WorldSnapshot): Promise<void> {
    await this.ensure();
    const tmp = join(this.dir, 'world.json.tmp');
    await writeFile(tmp, JSON.stringify(snap));
    await rename(tmp, join(this.dir, 'world.json'));
  }

  async archiveSnapshot(label: string): Promise<void> {
    await this.ensure();
    try { await rename(join(this.dir, 'world.json'), join(this.dir, `world-${label.replace(/[^\w.-]/g, '_')}.json`)); } catch { /* nothing to archive */ }
  }

  async createPlayer(p: PlayerRecord): Promise<void> {
    await this.ensure();
    this.players.set(p.tokenHash, p);
    await writeFile(join(this.dir, 'players.json'), JSON.stringify([...this.players.values()]));
  }

  async findPlayerByToken(tokenHash: string): Promise<PlayerRecord | null> {
    await this.ensure();
    return this.players.get(tokenHash) ?? null;
  }

  private async flushInvites(): Promise<void> { await writeFile(join(this.dir, 'invites.json'), JSON.stringify([...this.invites.values()])); }
  async createInvite(i: InviteRecord): Promise<void> { await this.ensure(); this.invites.set(i.code, i); await this.flushInvites(); }
  async findInvite(code: string): Promise<InviteRecord | null> { await this.ensure(); return this.invites.get(code) ?? null; }
  async useInvite(code: string, colonyId: string, at: number): Promise<boolean> {
    await this.ensure();
    const i = this.invites.get(code);
    if (!i || i.usedBy) return false;
    i.usedBy = colonyId; i.usedAt = at;
    await this.flushInvites();
    return true;
  }
  async listInvites(): Promise<InviteRecord[]> { await this.ensure(); return [...this.invites.values()]; }
  async releaseInvite(code: string): Promise<void> {
    await this.ensure();
    const i = this.invites.get(code);
    if (!i) return;
    i.usedBy = null; i.usedAt = null;
    await this.flushInvites();
  }

  async close(): Promise<void> { /* nothing to release */ }
}

export class PgStore implements Store {
  private readonly pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 4 }); }

  async migrate(): Promise<void> {
    await this.pool.query(`
      create table if not exists world_snapshots (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
      create table if not exists players (id text primary key, colony_id text not null, token_hash text not null unique, name text not null, created_at bigint not null);
      create table if not exists invites (code text primary key, note text not null default '', created_at bigint not null, used_by text, used_at bigint);
    `);
  }

  async loadSnapshot(): Promise<WorldSnapshot | null> {
    const r = await this.pool.query<{ data: WorldSnapshot }>('select data from world_snapshots where id = $1', ['current']);
    return r.rows[0]?.data ?? null;
  }

  async saveSnapshot(snap: WorldSnapshot): Promise<void> {
    await this.pool.query(
      'insert into world_snapshots (id, data, updated_at) values ($1, $2, now()) on conflict (id) do update set data = excluded.data, updated_at = now()',
      ['current', JSON.stringify(snap)],
    );
  }

  async archiveSnapshot(label: string): Promise<void> {
    await this.pool.query(
      'insert into world_snapshots (id, data, updated_at) select $1, data, now() from world_snapshots where id = $2 on conflict (id) do update set data = excluded.data, updated_at = now()',
      [`season:${label}`, 'current'],
    );
  }

  async createPlayer(p: PlayerRecord): Promise<void> {
    await this.pool.query('insert into players (id, colony_id, token_hash, name, created_at) values ($1, $2, $3, $4, $5)', [p.id, p.colonyId, p.tokenHash, p.name, p.createdAt]);
  }

  async findPlayerByToken(tokenHash: string): Promise<PlayerRecord | null> {
    const r = await this.pool.query<{ id: string; colony_id: string; token_hash: string; name: string; created_at: string }>('select * from players where token_hash = $1', [tokenHash]);
    const row = r.rows[0];
    return row ? { id: row.id, colonyId: row.colony_id, tokenHash: row.token_hash, name: row.name, createdAt: Number(row.created_at) } : null;
  }

  async createInvite(i: InviteRecord): Promise<void> {
    await this.pool.query('insert into invites (code, note, created_at, used_by, used_at) values ($1, $2, $3, $4, $5) on conflict (code) do nothing', [i.code, i.note, i.createdAt, i.usedBy, i.usedAt]);
  }
  async findInvite(code: string): Promise<InviteRecord | null> {
    const r = await this.pool.query<{ code: string; note: string; created_at: string; used_by: string | null; used_at: string | null }>('select * from invites where code = $1', [code]);
    const row = r.rows[0];
    return row ? { code: row.code, note: row.note, createdAt: Number(row.created_at), usedBy: row.used_by, usedAt: row.used_at === null ? null : Number(row.used_at) } : null;
  }
  async useInvite(code: string, colonyId: string, at: number): Promise<boolean> {
    const r = await this.pool.query('update invites set used_by = $2, used_at = $3 where code = $1 and used_by is null', [code, colonyId, at]);
    return (r.rowCount ?? 0) > 0;
  }
  async listInvites(): Promise<InviteRecord[]> {
    const r = await this.pool.query<{ code: string; note: string; created_at: string; used_by: string | null; used_at: string | null }>('select * from invites order by created_at');
    return r.rows.map((row) => ({ code: row.code, note: row.note, createdAt: Number(row.created_at), usedBy: row.used_by, usedAt: row.used_at === null ? null : Number(row.used_at) }));
  }
  async releaseInvite(code: string): Promise<void> {
    await this.pool.query('update invites set used_by = null, used_at = null where code = $1', [code]);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
