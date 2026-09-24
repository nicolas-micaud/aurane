// Persistence behind one small interface: Postgres in production, JSON files for local
// development and tests. The world is a single snapshot; players map tokens to colonies.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { WorldSnapshot } from '@aurane/sim';

export interface PlayerRecord { id: string; colonyId: string; tokenHash: string; name: string; createdAt: number }

export interface Store {
  loadSnapshot(): Promise<WorldSnapshot | null>;
  saveSnapshot(snap: WorldSnapshot): Promise<void>;
  createPlayer(p: PlayerRecord): Promise<void>;
  findPlayerByToken(tokenHash: string): Promise<PlayerRecord | null>;
  close(): Promise<void>;
}

export class FileStore implements Store {
  private players = new Map<string, PlayerRecord>();
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

  async createPlayer(p: PlayerRecord): Promise<void> {
    await this.ensure();
    this.players.set(p.tokenHash, p);
    await writeFile(join(this.dir, 'players.json'), JSON.stringify([...this.players.values()]));
  }

  async findPlayerByToken(tokenHash: string): Promise<PlayerRecord | null> {
    await this.ensure();
    return this.players.get(tokenHash) ?? null;
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

  async createPlayer(p: PlayerRecord): Promise<void> {
    await this.pool.query('insert into players (id, colony_id, token_hash, name, created_at) values ($1, $2, $3, $4, $5)', [p.id, p.colonyId, p.tokenHash, p.name, p.createdAt]);
  }

  async findPlayerByToken(tokenHash: string): Promise<PlayerRecord | null> {
    const r = await this.pool.query<{ id: string; colony_id: string; token_hash: string; name: string; created_at: string }>('select * from players where token_hash = $1', [tokenHash]);
    const row = r.rows[0];
    return row ? { id: row.id, colonyId: row.colony_id, tokenHash: row.token_hash, name: row.name, createdAt: Number(row.created_at) } : null;
  }

  async close(): Promise<void> { await this.pool.end(); }
}
