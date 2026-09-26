// Persistence behind one small interface: Postgres in production, JSON files for local
// development and tests. The world is a single snapshot; players map tokens to colonies.
import { mkdir, readdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { WorldSnapshot } from '@aurane/sim';

/** One row per device token: a session of the colony (decision 0010, lot A). `label` names the device, `revokedAt`
 *  ends the session (logout here, or from another device). */
export interface PlayerRecord { id: string; colonyId: string; tokenHash: string; name: string; createdAt: number; label?: string; lastSeenAt?: number; revokedAt?: number | null; accountId?: string | null }
/** Decision 0010, lot B: an account is born with its first passkey; it holds the Colony and its sessions. */
export interface AccountRecord { id: string; createdAt: number; lang: 'fr' | 'en'; email: string | null; emailVerifiedAt: number | null }
/** A passkey: the public key the authenticator handed us, its signature counter, a label for the list. */
export interface CredentialRecord { id: string; accountId: string; publicKey: string; counter: number; transports: string[]; label: string; createdAt: number; lastUsedAt: number | null }
/** Decision 0011: what an account bought, held by the ACCOUNT (never the season's Colony) and never read by the
 *  simulation. `externalRef` is the provider's reference (Stripe Checkout Session id), unique: webhooks are replayed. */
export interface EntitlementRecord {
  id: string; accountId: string; sku: string; source: 'stripe';
  externalRef: string; /** The provider's payment reference (Stripe PaymentIntent), to revoke on a refund. */ paymentRef: string | null;
  amountCents: number; currency: string; createdAt: number; expiresAt: number | null; revokedAt: number | null;
}
/** How a colony of a finished season looked to its player: what a returning account is offered again. */
export interface PastColony { name: string; faction: string; persona: string }
export interface InviteRecord { code: string; note: string; createdAt: number; usedBy: string | null; usedAt: number | null }

export interface Store {
  loadSnapshot(): Promise<WorldSnapshot | null>;
  saveSnapshot(snap: WorldSnapshot): Promise<void>;
  /** Keep the current snapshot under a label (a finished season) before a fresh world replaces it. */
  archiveSnapshot(label: string): Promise<void>;
  /** The colony with this id in an archived season (ids never repeat across seasons), newest archive first. */
  pastColony(colonyId: string): Promise<PastColony | null>;
  createPlayer(p: PlayerRecord): Promise<void>;
  findPlayerByToken(tokenHash: string): Promise<PlayerRecord | null>;
  /** Every session of a colony, revoked ones included (the client hides them). */
  listPlayers(colonyId: string): Promise<PlayerRecord[]>;
  /** Device label, last activity, revocation, account. */
  updatePlayer(id: string, patch: Partial<Pick<PlayerRecord, 'label' | 'lastSeenAt' | 'revokedAt' | 'accountId'>>): Promise<void>;
  createAccount(a: AccountRecord): Promise<void>;
  findAccount(id: string): Promise<AccountRecord | null>;
  /** The account that verified this e-mail address (compared case-insensitively). */
  findAccountByEmail(email: string): Promise<AccountRecord | null>;
  updateAccount(id: string, patch: Partial<Pick<AccountRecord, 'email' | 'emailVerifiedAt' | 'lang'>>): Promise<void>;
  /** The account that holds this colony, if a passkey was ever added. */
  accountOfColony(colonyId: string): Promise<string | null>;
  /** The colonies of an account (one active per season; past seasons keep theirs). */
  coloniesOfAccount(accountId: string): Promise<string[]>;
  linkColony(accountId: string, colonyId: string, at: number): Promise<void>;
  addCredential(c: CredentialRecord): Promise<void>;
  findCredential(id: string): Promise<CredentialRecord | null>;
  listCredentials(accountId: string): Promise<CredentialRecord[]>;
  updateCredential(id: string, patch: Partial<Pick<CredentialRecord, 'counter' | 'lastUsedAt' | 'label'>>): Promise<void>;
  deleteCredential(id: string, accountId: string): Promise<boolean>;
  createInvite(i: InviteRecord): Promise<void>;
  findInvite(code: string): Promise<InviteRecord | null>;
  /** Marks the invitation used; false when it was already used or unknown. */
  useInvite(code: string, colonyId: string, at: number): Promise<boolean>;
  listInvites(): Promise<InviteRecord[]>;
  /** Make a used invitation usable again (its colony belonged to a season that is over). */
  releaseInvite(code: string): Promise<void>;
  /** Records a purchase; false (and nothing written) when this external reference was already granted. */
  grantEntitlement(e: EntitlementRecord): Promise<boolean>;
  listEntitlements(accountId: string): Promise<EntitlementRecord[]>;
  /** Marks revoked the entitlement(s) bought with this external or payment reference; the number of rows touched. */
  revokeEntitlement(ref: string, at: number): Promise<number>;
  /** Accounts holding this SKU right now (not revoked, not expired). */
  accountsWithSku(sku: string, now: number): Promise<string[]>;
  close(): Promise<void>;
}

const activeAt = (e: EntitlementRecord, now: number): boolean => e.revokedAt === null && (e.expiresAt === null || e.expiresAt > now);


export class FileStore implements Store {
  private players = new Map<string, PlayerRecord>();
  private invites = new Map<string, InviteRecord>();
  private accounts = new Map<string, AccountRecord>();
  private credentials = new Map<string, CredentialRecord>();
  private links: { accountId: string; colonyId: string; createdAt: number }[] = [];
  private entitlements: EntitlementRecord[] = [];
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
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'accounts.json'), 'utf8')) as { accounts: AccountRecord[]; credentials: CredentialRecord[]; links: { accountId: string; colonyId: string; createdAt: number }[] };
      for (const a of raw.accounts) this.accounts.set(a.id, a);
      for (const c of raw.credentials) this.credentials.set(c.id, c);
      this.links = raw.links;
    } catch { /* first run */ }
    try { this.entitlements = JSON.parse(await readFile(join(this.dir, 'entitlements.json'), 'utf8')) as EntitlementRecord[]; } catch { /* first run */ }
  }
  private async flushEntitlements(): Promise<void> {
    const tmp = join(this.dir, 'entitlements.json.tmp');
    await writeFile(tmp, JSON.stringify(this.entitlements));
    await rename(tmp, join(this.dir, 'entitlements.json'));
  }
  private async flushAccounts(): Promise<void> {
    await writeFile(join(this.dir, 'accounts.json'), JSON.stringify({ accounts: [...this.accounts.values()], credentials: [...this.credentials.values()], links: this.links }));
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

  async pastColony(colonyId: string): Promise<PastColony | null> {
    await this.ensure();
    const files = (await readdir(this.dir)).filter((f) => /^world-.+\.json$/.test(f));
    const dated = await Promise.all(files.map(async (f) => ({ f, t: (await stat(join(this.dir, f))).mtimeMs })));
    for (const { f } of dated.sort((a, b) => b.t - a.t)) {
      try {
        const snap = JSON.parse(await readFile(join(this.dir, f), 'utf8')) as { state?: { colonies?: Record<string, Partial<PastColony> & { npc?: boolean }> } };
        const c = snap.state?.colonies?.[colonyId];
        if (c && !c.npc && c.name && c.faction && c.persona) return { name: c.name, faction: c.faction, persona: c.persona };
      } catch { /* unreadable archive: skip */ }
    }
    return null;
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

  async listPlayers(colonyId: string): Promise<PlayerRecord[]> {
    await this.ensure();
    return [...this.players.values()].filter((p) => p.colonyId === colonyId);
  }

  async updatePlayer(id: string, patch: Partial<Pick<PlayerRecord, 'label' | 'lastSeenAt' | 'revokedAt' | 'accountId'>>): Promise<void> {
    await this.ensure();
    const p = [...this.players.values()].find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, patch);
    await writeFile(join(this.dir, 'players.json'), JSON.stringify([...this.players.values()]));
  }

  async createAccount(a: AccountRecord): Promise<void> { await this.ensure(); this.accounts.set(a.id, a); await this.flushAccounts(); }
  async findAccount(id: string): Promise<AccountRecord | null> { await this.ensure(); return this.accounts.get(id) ?? null; }
  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    await this.ensure();
    const e = email.toLowerCase();
    return [...this.accounts.values()].find((a) => a.email?.toLowerCase() === e) ?? null;
  }
  async updateAccount(id: string, patch: Partial<Pick<AccountRecord, 'email' | 'emailVerifiedAt' | 'lang'>>): Promise<void> {
    await this.ensure();
    const a = this.accounts.get(id);
    if (!a) return;
    Object.assign(a, patch);
    await this.flushAccounts();
  }
  async accountOfColony(colonyId: string): Promise<string | null> { await this.ensure(); return this.links.find((l) => l.colonyId === colonyId)?.accountId ?? null; }
  async coloniesOfAccount(accountId: string): Promise<string[]> { await this.ensure(); return this.links.filter((l) => l.accountId === accountId).map((l) => l.colonyId); }
  async linkColony(accountId: string, colonyId: string, at: number): Promise<void> {
    await this.ensure();
    if (!this.links.some((l) => l.accountId === accountId && l.colonyId === colonyId)) { this.links.push({ accountId, colonyId, createdAt: at }); await this.flushAccounts(); }
  }
  async addCredential(c: CredentialRecord): Promise<void> { await this.ensure(); this.credentials.set(c.id, c); await this.flushAccounts(); }
  async findCredential(id: string): Promise<CredentialRecord | null> { await this.ensure(); return this.credentials.get(id) ?? null; }
  async listCredentials(accountId: string): Promise<CredentialRecord[]> { await this.ensure(); return [...this.credentials.values()].filter((c) => c.accountId === accountId).sort((a, b) => a.createdAt - b.createdAt); }
  async updateCredential(id: string, patch: Partial<Pick<CredentialRecord, 'counter' | 'lastUsedAt' | 'label'>>): Promise<void> {
    await this.ensure();
    const c = this.credentials.get(id);
    if (!c) return;
    Object.assign(c, patch);
    await this.flushAccounts();
  }
  async deleteCredential(id: string, accountId: string): Promise<boolean> {
    await this.ensure();
    const c = this.credentials.get(id);
    if (!c || c.accountId !== accountId) return false;
    this.credentials.delete(id);
    await this.flushAccounts();
    return true;
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

  async grantEntitlement(e: EntitlementRecord): Promise<boolean> {
    await this.ensure();
    if (this.entitlements.some((x) => x.externalRef === e.externalRef)) return false;
    this.entitlements.push({ ...e });
    await this.flushEntitlements();
    return true;
  }
  async listEntitlements(accountId: string): Promise<EntitlementRecord[]> {
    await this.ensure();
    return this.entitlements.filter((e) => e.accountId === accountId).sort((a, b) => a.createdAt - b.createdAt).map((e) => ({ ...e }));
  }
  async revokeEntitlement(ref: string, at: number): Promise<number> {
    await this.ensure();
    let n = 0;
    for (const e of this.entitlements) if ((e.externalRef === ref || e.paymentRef === ref) && e.revokedAt === null) { e.revokedAt = at; n++; }
    if (n) await this.flushEntitlements();
    return n;
  }
  async accountsWithSku(sku: string, now: number): Promise<string[]> {
    await this.ensure();
    return [...new Set(this.entitlements.filter((e) => e.sku === sku && activeAt(e, now)).map((e) => e.accountId))];
  }

  async close(): Promise<void> { /* nothing to release */ }
}

export class PgStore implements Store {
  private readonly pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 6 }); }
  /** Shared with the LLM layer's stores (jobs, memory). */
  get pgPool(): pg.Pool { return this.pool; }

  async migrate(): Promise<void> {
    await this.pool.query(`
      create table if not exists world_snapshots (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
      create table if not exists players (id text primary key, colony_id text not null, token_hash text not null unique, name text not null, created_at bigint not null);
      create table if not exists invites (code text primary key, note text not null default '', created_at bigint not null, used_by text, used_at bigint);
      alter table players add column if not exists label text not null default '';
      alter table players add column if not exists last_seen_at bigint;
      alter table players add column if not exists revoked_at bigint;
      alter table players add column if not exists account_id text;
      create index if not exists players_colony_idx on players (colony_id);
      create table if not exists accounts (id text primary key, created_at bigint not null, lang text not null default 'fr', email text, email_verified_at bigint);
      create unique index if not exists accounts_email_idx on accounts (lower(email)) where email is not null;
      create table if not exists credentials (id text primary key, account_id text not null references accounts(id), public_key text not null, counter bigint not null default 0, transports jsonb not null default '[]', label text not null default '', created_at bigint not null, last_used_at bigint);
      create index if not exists credentials_account_idx on credentials (account_id);
      create table if not exists account_colonies (account_id text not null references accounts(id), colony_id text not null, created_at bigint not null, primary key (account_id, colony_id));
      create index if not exists account_colonies_colony_idx on account_colonies (colony_id);
      create table if not exists entitlements (id text primary key, account_id text not null references accounts(id), sku text not null, source text not null, external_ref text not null unique, payment_ref text, amount_cents integer not null, currency text not null, created_at bigint not null, expires_at bigint, revoked_at bigint);
      create index if not exists entitlements_account_idx on entitlements (account_id);
      create index if not exists entitlements_payment_idx on entitlements (payment_ref) where payment_ref is not null;
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

  async pastColony(colonyId: string): Promise<PastColony | null> {
    const r = await this.pool.query<{ c: (Partial<PastColony> & { npc?: boolean }) | null }>(
      "select data->'state'->'colonies'->$1 as c from world_snapshots where id like 'season:%' and data->'state'->'colonies' ? $1 order by updated_at desc limit 1",
      [colonyId],
    );
    const c = r.rows[0]?.c;
    return c && !c.npc && c.name && c.faction && c.persona ? { name: c.name, faction: c.faction, persona: c.persona } : null;
  }

  async createPlayer(p: PlayerRecord): Promise<void> {
    await this.pool.query('insert into players (id, colony_id, token_hash, name, created_at, label, last_seen_at, revoked_at, account_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [p.id, p.colonyId, p.tokenHash, p.name, p.createdAt, p.label ?? '', p.lastSeenAt ?? null, p.revokedAt ?? null, p.accountId ?? null]);
  }

  private static player(row: { id: string; colony_id: string; token_hash: string; name: string; created_at: string; label: string | null; last_seen_at: string | null; revoked_at: string | null; account_id?: string | null }): PlayerRecord {
    return { id: row.id, colonyId: row.colony_id, tokenHash: row.token_hash, name: row.name, createdAt: Number(row.created_at), label: row.label ?? '', ...(row.last_seen_at !== null ? { lastSeenAt: Number(row.last_seen_at) } : {}), revokedAt: row.revoked_at !== null ? Number(row.revoked_at) : null, accountId: row.account_id ?? null };
  }

  async findPlayerByToken(tokenHash: string): Promise<PlayerRecord | null> {
    const r = await this.pool.query<Parameters<typeof PgStore.player>[0]>('select * from players where token_hash = $1', [tokenHash]);
    const row = r.rows[0];
    return row ? PgStore.player(row) : null;
  }

  async listPlayers(colonyId: string): Promise<PlayerRecord[]> {
    const r = await this.pool.query<Parameters<typeof PgStore.player>[0]>('select * from players where colony_id = $1 order by created_at', [colonyId]);
    return r.rows.map((row) => PgStore.player(row));
  }

  async updatePlayer(id: string, patch: Partial<Pick<PlayerRecord, 'label' | 'lastSeenAt' | 'revokedAt' | 'accountId'>>): Promise<void> {
    const sets: string[] = []; const vals: unknown[] = [id];
    if (patch.label !== undefined) { vals.push(patch.label); sets.push(`label = $${vals.length}`); }
    if (patch.lastSeenAt !== undefined) { vals.push(patch.lastSeenAt); sets.push(`last_seen_at = $${vals.length}`); }
    if (patch.revokedAt !== undefined) { vals.push(patch.revokedAt); sets.push(`revoked_at = $${vals.length}`); }
    if (patch.accountId !== undefined) { vals.push(patch.accountId); sets.push(`account_id = $${vals.length}`); }
    if (!sets.length) return;
    await this.pool.query(`update players set ${sets.join(', ')} where id = $1`, vals);
  }

  async createAccount(a: AccountRecord): Promise<void> {
    await this.pool.query('insert into accounts (id, created_at, lang, email, email_verified_at) values ($1, $2, $3, $4, $5)', [a.id, a.createdAt, a.lang, a.email, a.emailVerifiedAt]);
  }
  async findAccount(id: string): Promise<AccountRecord | null> {
    const r = await this.pool.query<{ id: string; created_at: string; lang: string; email: string | null; email_verified_at: string | null }>('select * from accounts where id = $1', [id]);
    const row = r.rows[0];
    return row ? { id: row.id, createdAt: Number(row.created_at), lang: row.lang === 'en' ? 'en' : 'fr', email: row.email, emailVerifiedAt: row.email_verified_at !== null ? Number(row.email_verified_at) : null } : null;
  }
  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    const r = await this.pool.query<{ id: string }>('select id from accounts where lower(email) = lower($1)', [email]);
    return r.rows[0] ? this.findAccount(r.rows[0].id) : null;
  }
  async updateAccount(id: string, patch: Partial<Pick<AccountRecord, 'email' | 'emailVerifiedAt' | 'lang'>>): Promise<void> {
    const sets: string[] = []; const vals: unknown[] = [id];
    if (patch.email !== undefined) { vals.push(patch.email); sets.push(`email = $${vals.length}`); }
    if (patch.emailVerifiedAt !== undefined) { vals.push(patch.emailVerifiedAt); sets.push(`email_verified_at = $${vals.length}`); }
    if (patch.lang !== undefined) { vals.push(patch.lang); sets.push(`lang = $${vals.length}`); }
    if (!sets.length) return;
    await this.pool.query(`update accounts set ${sets.join(', ')} where id = $1`, vals);
  }
  async accountOfColony(colonyId: string): Promise<string | null> {
    const r = await this.pool.query<{ account_id: string }>('select account_id from account_colonies where colony_id = $1 order by created_at limit 1', [colonyId]);
    return r.rows[0]?.account_id ?? null;
  }
  async coloniesOfAccount(accountId: string): Promise<string[]> {
    const r = await this.pool.query<{ colony_id: string }>('select colony_id from account_colonies where account_id = $1 order by created_at', [accountId]);
    return r.rows.map((x) => x.colony_id);
  }
  async linkColony(accountId: string, colonyId: string, at: number): Promise<void> {
    await this.pool.query('insert into account_colonies (account_id, colony_id, created_at) values ($1, $2, $3) on conflict do nothing', [accountId, colonyId, at]);
  }
  private static credential(row: { id: string; account_id: string; public_key: string; counter: string; transports: string[]; label: string; created_at: string; last_used_at: string | null }): CredentialRecord {
    return { id: row.id, accountId: row.account_id, publicKey: row.public_key, counter: Number(row.counter), transports: row.transports ?? [], label: row.label, createdAt: Number(row.created_at), lastUsedAt: row.last_used_at !== null ? Number(row.last_used_at) : null };
  }
  async addCredential(c: CredentialRecord): Promise<void> {
    await this.pool.query('insert into credentials (id, account_id, public_key, counter, transports, label, created_at, last_used_at) values ($1, $2, $3, $4, $5, $6, $7, $8)', [c.id, c.accountId, c.publicKey, c.counter, JSON.stringify(c.transports), c.label, c.createdAt, c.lastUsedAt]);
  }
  async findCredential(id: string): Promise<CredentialRecord | null> {
    const r = await this.pool.query<Parameters<typeof PgStore.credential>[0]>('select * from credentials where id = $1', [id]);
    return r.rows[0] ? PgStore.credential(r.rows[0]) : null;
  }
  async listCredentials(accountId: string): Promise<CredentialRecord[]> {
    const r = await this.pool.query<Parameters<typeof PgStore.credential>[0]>('select * from credentials where account_id = $1 order by created_at', [accountId]);
    return r.rows.map((row) => PgStore.credential(row));
  }
  async updateCredential(id: string, patch: Partial<Pick<CredentialRecord, 'counter' | 'lastUsedAt' | 'label'>>): Promise<void> {
    const sets: string[] = []; const vals: unknown[] = [id];
    if (patch.counter !== undefined) { vals.push(patch.counter); sets.push(`counter = $${vals.length}`); }
    if (patch.lastUsedAt !== undefined) { vals.push(patch.lastUsedAt); sets.push(`last_used_at = $${vals.length}`); }
    if (patch.label !== undefined) { vals.push(patch.label); sets.push(`label = $${vals.length}`); }
    if (!sets.length) return;
    await this.pool.query(`update credentials set ${sets.join(', ')} where id = $1`, vals);
  }
  async deleteCredential(id: string, accountId: string): Promise<boolean> {
    const r = await this.pool.query('delete from credentials where id = $1 and account_id = $2', [id, accountId]);
    return (r.rowCount ?? 0) > 0;
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

  private static entitlement(row: { id: string; account_id: string; sku: string; source: string; external_ref: string; payment_ref: string | null; amount_cents: number; currency: string; created_at: string; expires_at: string | null; revoked_at: string | null }): EntitlementRecord {
    return { id: row.id, accountId: row.account_id, sku: row.sku, source: 'stripe', externalRef: row.external_ref, paymentRef: row.payment_ref, amountCents: Number(row.amount_cents), currency: row.currency, createdAt: Number(row.created_at), expiresAt: row.expires_at !== null ? Number(row.expires_at) : null, revokedAt: row.revoked_at !== null ? Number(row.revoked_at) : null };
  }
  async grantEntitlement(e: EntitlementRecord): Promise<boolean> {
    const r = await this.pool.query('insert into entitlements (id, account_id, sku, source, external_ref, payment_ref, amount_cents, currency, created_at, expires_at, revoked_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (external_ref) do nothing', [e.id, e.accountId, e.sku, e.source, e.externalRef, e.paymentRef, e.amountCents, e.currency, e.createdAt, e.expiresAt, e.revokedAt]);
    return (r.rowCount ?? 0) > 0;
  }
  async listEntitlements(accountId: string): Promise<EntitlementRecord[]> {
    const r = await this.pool.query<Parameters<typeof PgStore.entitlement>[0]>('select * from entitlements where account_id = $1 order by created_at', [accountId]);
    return r.rows.map((row) => PgStore.entitlement(row));
  }
  async revokeEntitlement(ref: string, at: number): Promise<number> {
    const r = await this.pool.query('update entitlements set revoked_at = $2 where (external_ref = $1 or payment_ref = $1) and revoked_at is null', [ref, at]);
    return r.rowCount ?? 0;
  }
  async accountsWithSku(sku: string, now: number): Promise<string[]> {
    const r = await this.pool.query<{ account_id: string }>('select distinct account_id from entitlements where sku = $1 and revoked_at is null and (expires_at is null or expires_at > $2)', [sku, now]);
    return r.rows.map((x) => x.account_id);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
