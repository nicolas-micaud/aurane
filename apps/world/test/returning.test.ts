// A returning player (an account from a past season, here protected by an e-mail only, no passkey) gets a colony in the
// new season: the sign-in hands a single-use found ticket, the colony is linked to the account without an invitation even
// in a closed beta, the General remembers the previous season from the first minute, and a guest still needs a code.
import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryJobStore } from '@aurane/general';
import { loadConfig } from '../src/config.js';
import { Engine, FOUND_TICKET_TTL_MS } from '../src/engine.js';
import { createHttpServer } from '../src/http.js';
import { FileMemoryStore } from '../src/llmstore.js';
import type { Mailer, MailMessage } from '../src/mail.js';
import { FileStore } from '../src/store.js';

const sent: MailMessage[] = [];
const outbox: Mailer = { kind: 'log', send: async (m) => { sent.push(m); } };
const lastCode = (): string => /(\d{3}) (\d{3})/.exec(sent[sent.length - 1]!.text)!.slice(1).join('');

async function boot(dir: string, memDir: string, seed: string) {
  const env = { SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '3', SEASON_SEED: seed, REQUIRE_INVITE: '1', INVITE_CODES: 'AUR-FIRST,AUR-SECOND', ADMIN_TOKEN: 'adm', AUTH_SECRET: 'secret' };
  // The memory directory plays Postgres' general_memory: it outlives the season, as the table does.
  const engine = new Engine(loadConfig(env), new FileStore(dir), { jobStore: new MemoryJobStore(), memoryStore: new FileMemoryStore(memDir) });
  await engine.init();
  await engine.general.init();
  const server = createHttpServer(engine, { mailer: outbox, codeResendMs: 0 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, token?: string) => fetch(`${base}${path}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  /** Sign in by e-mail code, the way the landing page does. */
  const emailLogin = async (email: string) => {
    const { handle } = await (await post('/api/auth/email/start', { email, lang: 'fr' })).json() as { handle: string };
    const res = await post('/api/auth/email/verify', { handle, code: lastCode() });
    return { status: res.status, body: await res.json() as { token?: string; colonyId?: string; error?: string; found?: { ticket: string; expiresAt: number; previous: { name: string; faction: string; persona: string } | null; remembers: boolean } } };
  };
  const close = async () => { await engine.stop(); await new Promise<void>((r) => server.close(() => r())); };
  return { engine, post, get, emailLogin, close };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('a returning account in a new season', () => {
  it('founds a colony linked to the account, without an invitation, with its General\'s memory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aurane-ret-'));
    const memDir = await mkdtemp(join(tmpdir(), 'aurane-ret-mem-'));

    // Season 1: an invited guest takes a Counsel card (a memory), then protects the colony with an e-mail (the account).
    const s1 = await boot(dir, memDir, 'ret-1');
    const made = await (await s1.post('/api/guest', { name: 'Nick', faction: 'oracles', persona: 'oriel', invite: 'AUR-FIRST' })).json() as { token: string; colonyId: string };
    const counsel = await (await s1.get('/api/counsel?lang=fr', made.token)).json() as { cards: { id: string }[] };
    const card = counsel.cards[0]!.id;
    expect((await s1.post('/api/counsel/take', { id: card }, made.token)).status).toBe(200);
    expect((await s1.post('/api/account/email/start', { email: 'nick@example.test', lang: 'fr' }, made.token)).status).toBe(200);
    expect((await s1.post('/api/account/email/verify', { code: lastCode() }, made.token)).status).toBe(200);
    const accountId = (await s1.engine.persistence.accountOfColony(made.colonyId))!;
    expect(accountId).toBeTruthy();
    await s1.close();

    // Season 2, closed beta: the account signs in and has no colony yet; the answer carries the found ticket.
    const s2 = await boot(dir, memDir, 'ret-2');
    const signIn = await s2.emailLogin('nick@example.test');
    expect(signIn.status).toBe(404);
    expect(signIn.body.error).toBe('no colony this season');
    const offer = signIn.body.found!;
    expect(offer.ticket.length).toBeGreaterThanOrEqual(24);
    expect(offer.expiresAt).toBeGreaterThan(Date.now());
    expect(offer.previous).toEqual({ name: 'Nick', faction: 'oracles', persona: 'oriel' });
    expect(offer.remembers).toBe(true);
    // A second sign-in before founding (another tab, a double tap): a second ticket.
    const other = (await s2.emailLogin('nick@example.test')).body.found!;
    expect(other.ticket).not.toBe(offer.ticket);

    // A guest still needs an invitation.
    expect((await s2.post('/api/guest', { name: 'Stranger', faction: 'guild', persona: 'oriel' })).status).toBe(403);
    // A made-up ticket founds nothing.
    expect((await s2.post('/api/account/found', { ticket: 'x'.repeat(32), name: 'Nick', faction: 'oracles', persona: 'oriel' })).status).toBe(403);

    // Founding: no invitation, linked to the account, a device session of the account.
    const found = await s2.post('/api/account/found', { ticket: offer.ticket, name: 'Nick II', faction: 'oracles', persona: 'oriel' });
    expect(found.status).toBe(201);
    const colony = await found.json() as { token: string; colonyId: string; created: boolean };
    expect(colony.created).toBe(true);
    expect(colony.colonyId).not.toBe(made.colonyId);
    expect(await s2.engine.persistence.accountOfColony(colony.colonyId)).toBe(accountId);
    expect(await s2.engine.memoryKeyOf(colony.colonyId)).toBe(`account:${accountId}`);
    const sessions = await s2.engine.persistence.listPlayers(colony.colonyId);
    expect(sessions.map((p) => p.accountId)).toEqual([accountId]);
    expect(((await (await s2.get('/api/account', colony.token)).json()) as { account: { email: string } | null }).account?.email).toBe('nick@example.test');
    // The General remembers season 1 from the first minute.
    const memory = await (await s2.get('/api/memory', colony.token)).json() as { record: { notes: { kind: string; text: string }[] } };
    expect(memory.record.notes.some((n) => n.kind === 'counsel.taken' && n.text === card)).toBe(true);

    // Replay of the spent ticket: refused.
    expect((await s2.post('/api/account/found', { ticket: offer.ticket, name: 'Nick III', faction: 'guild', persona: 'oriel' })).status).toBe(403);
    // The other ticket: the same colony, no second one.
    const humans = () => Object.values(s2.engine.world.colonies).filter((c) => !c.npc).length;
    const before = humans();
    const again = await s2.post('/api/account/found', { ticket: other.ticket, name: 'Nick III', faction: 'guild', persona: 'oriel' });
    expect(again.status).toBe(200);
    expect((await again.json() as { colonyId: string; created: boolean })).toMatchObject({ colonyId: colony.colonyId, created: false });
    expect(humans()).toBe(before);
    // From now on the sign-in opens the colony directly.
    const back = await s2.emailLogin('nick@example.test');
    expect(back.status).toBe(200);
    expect(back.body.colonyId).toBe(colony.colonyId);
    expect(back.body.found).toBeUndefined();
    await s2.close();
  });

  it('refuses an expired ticket and says nothing is remembered for a fresh account', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aurane-ret-exp-'));
    const s1 = await boot(dir, dir, 'exp-1');
    const made = await (await s1.post('/api/guest', { name: 'Ada', faction: 'guild', persona: 'oriel', invite: 'AUR-SECOND' })).json() as { token: string; colonyId: string };
    expect((await s1.post('/api/account/email/start', { email: 'ada@example.test' }, made.token)).status).toBe(200);
    expect((await s1.post('/api/account/email/verify', { code: lastCode() }, made.token)).status).toBe(200);
    await s1.close();

    const s2 = await boot(dir, dir, 'exp-2');
    const offer = (await s2.emailLogin('ada@example.test')).body.found!;
    expect(offer.remembers).toBe(false);
    expect(offer.previous).toEqual({ name: 'Ada', faction: 'guild', persona: 'oriel' });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + FOUND_TICKET_TTL_MS + 1000);
    const late = await s2.post('/api/account/found', { ticket: offer.ticket, name: 'Ada', faction: 'guild', persona: 'oriel' });
    expect(late.status).toBe(403);
    expect(((await late.json()) as { error: string }).error).toBe('ticket expired or used');
    vi.restoreAllMocks();
    expect(Object.values(s2.engine.world.colonies).filter((c) => !c.npc)).toHaveLength(0);
    await s2.close();
  });
});
