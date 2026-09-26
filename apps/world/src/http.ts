// HTTP + WebSocket boundary. Everything that comes in is validated with the protocol schemas;
// everything that goes out is a PlayerView (fog of war applied) or a public summary.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { PasskeyService } from './auth.js';
import { EmailCodeService } from './email-code.js';
import { mailerFromEnv, type Mailer } from './mail.js';
import { CommandSchema, FACTIONS, PERSONAS } from '@aurane/protocol';
import type { Engine } from './engine.js';
import { renderColonyPage, renderGazettePage } from './pages.js';

const GuestSchema = z.object({
  name: z.string().trim().min(2).max(32),
  faction: z.enum(FACTIONS),
  persona: z.enum(PERSONAS),
  invite: z.string().trim().max(40).optional(),
});

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** The client address as the tunnel reports it (Cloudflare, then any proxy), else the socket's. */
function clientIp(req: IncomingMessage): string | undefined {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? undefined;
}

/** A short device name from the user agent, for the sessions list ("iPhone · Safari"); never the raw string. */
export function deviceLabel(ua: string | string[] | undefined): string {
  const u = (Array.isArray(ua) ? ua[0] : ua) ?? '';
  const device = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : '';
  const browser = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  return [device, browser].filter(Boolean).join(' · ');
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export function createHttpServer(engine: Engine, deps: { mailer?: Mailer; codeResendMs?: number } = {}): Server {
  const passkeys = new PasskeyService(engine.persistence, { rpName: 'Aurane', rpId: engine.cfg.rpId, origins: engine.cfg.rpOrigins });
  const emails = new EmailCodeService(engine.persistence, passkeys, deps.mailer ?? mailerFromEnv(), deps.codeResendMs);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, time: engine.world.time, draw: engine.world.drawIndex });
      if (req.method === 'GET' && url.pathname === '/api/public/summary') return json(res, 200, engine.publicSummary());
      if (req.method === 'GET' && url.pathname === '/api/public/gazette') {
        const day = url.searchParams.get('day');
        const issue = await engine.gazette(url.searchParams.get('lang') === 'en' ? 'en' : 'fr', day ? Number(day) : undefined);
        return issue ? json(res, 200, issue) : json(res, 404, { error: 'no issue yet' });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/public/colony/')) {
        const c = engine.publicColony(decodeURIComponent(url.pathname.slice('/api/public/colony/'.length)));
        return c ? json(res, 200, c) : json(res, 404, { error: 'no such colony' });
      }
      if (req.method === 'GET' && (url.pathname === '/gazette' || url.pathname === '/gazette/')) {
        const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';
        const issue = await engine.gazette(lang, url.searchParams.get('day') ? Number(url.searchParams.get('day')) : undefined);
        return html(res, 200, renderGazettePage(issue, lang, engine.publicSummary()));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/c/')) {
        const c = engine.publicColony(decodeURIComponent(url.pathname.slice(3)));
        return c ? html(res, 200, renderColonyPage(c)) : html(res, 404, '<h1>404</h1>');
      }
      if (req.method === 'GET' && url.pathname === '/api/public/config') return json(res, 200, engine.publicConfig());
      if (req.method === 'POST' && url.pathname === '/api/guest') {
        const parsed = GuestSchema.safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid guest', issues: parsed.error.issues });
        const made = await engine.createGuest(parsed.data.name, parsed.data.faction, parsed.data.persona, parsed.data.invite, engine.originHash(clientIp(req)), deviceLabel(req.headers['user-agent']));
        if ('error' in made) return json(res, 403, { error: made.error });
        return json(res, 201, { token: made.token, colonyId: made.colony.id });
      }
      // Passkeys (decision 0010, lot B): sign in with a passkey from any device; the ceremony needs no session.
      if (req.method === 'POST' && url.pathname === '/api/auth/passkey/login/options') return json(res, 200, await passkeys.loginOptions());
      if (req.method === 'POST' && url.pathname === '/api/auth/passkey/login/verify') {
        const parsed = z.object({ handle: z.string().min(8).max(64), response: z.object({ id: z.string().min(1) }).passthrough() }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid response' });
        const r = await passkeys.loginVerify(parsed.data.handle, parsed.data.response as unknown as Parameters<typeof passkeys.loginVerify>[1]);
        if (!r.ok) return json(res, 403, { error: r.reason });
        const colony = await engine.colonyOfAccount(r.account.id);
        if (!colony) return json(res, 404, { error: 'no colony this season' });
        const made = await engine.openSession(colony, deviceLabel(req.headers['user-agent']), r.account.id);
        return json(res, 200, { token: made.token, colonyId: colony.id });
      }
      // E-mail codes (decision 0010, lot C): the rescue sign-in; the first answer never tells whether the address is known.
      if (req.method === 'POST' && url.pathname === '/api/auth/email/start') {
        const parsed = z.object({ email: z.string().trim().min(3).max(254), lang: z.enum(['fr', 'en']).default('fr') }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid email' });
        return json(res, 200, await emails.startLogin(parsed.data.email, parsed.data.lang));
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/email/verify') {
        const parsed = z.object({ handle: z.string().min(8).max(64), code: z.string().trim().min(6).max(8) }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid code' });
        const r = await emails.verifyLogin(parsed.data.handle, parsed.data.code);
        if (!r.ok) return json(res, 403, { error: r.reason });
        const colony = await engine.colonyOfAccount(r.account.id);
        if (!colony) return json(res, 404, { error: 'no colony this season' });
        const made = await engine.openSession(colony, deviceLabel(req.headers['user-agent']), r.account.id);
        return json(res, 200, { token: made.token, colonyId: colony.id });
      }
      if (req.method === 'POST' && url.pathname === '/api/redeem') {
        const parsed = z.object({ code: z.string().min(10).max(400) }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid code' });
        const made = await engine.redeemLink(parsed.data.code.trim(), deviceLabel(req.headers['user-agent']));
        return made ? json(res, 200, { token: made.token, colonyId: made.colony.id }) : json(res, 403, { error: 'link expired or invalid' });
      }
      if (url.pathname.startsWith('/api/admin/')) {
        const admin = engine.cfg.adminToken;
        if (!admin || req.headers['x-admin-token'] !== admin) return json(res, 401, { error: 'unauthorized' });
        if (req.method === 'POST' && url.pathname === '/api/admin/invites') {
          const parsed = z.object({ count: z.number().int().min(1).max(200).default(10), note: z.string().max(120).default('') }).safeParse(await readBody(req));
          if (!parsed.success) return json(res, 400, { error: 'invalid request' });
          return json(res, 201, { codes: await engine.createInvites(parsed.data.count, parsed.data.note) });
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/invites') return json(res, 200, { invites: await engine.invites() });
        if (req.method === 'GET' && url.pathname === '/api/admin/llm/metrics') {
          if (url.searchParams.get('format') === 'prometheus') { const body = await engine.general.prometheus(); res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }); return res.end(body); }
          return json(res, 200, await engine.general.snapshot());
        }
        // For Uptime Kuma (HTTP monitor with the x-admin-token header): 503 as soon as a problem is listed.
        if (req.method === 'GET' && url.pathname === '/api/admin/memory/health') { const h = await engine.general.memoryHealth(); return json(res, h.ok ? 200 : 503, h); }
        return json(res, 404, { error: 'not found' });
      }
      const token = bearer(req);
      const session = token ? await engine.authenticateSession(token) : null;
      if (!session) return json(res, 401, { error: 'unauthorized' });
      const colony = session.colony;
      if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, engine.view(colony.id));
      // Sessions (decision 0010, lot A): the devices that hold this colony; leave here, or cut another one off.
      if (req.method === 'GET' && url.pathname === '/api/sessions') return json(res, 200, { sessions: await engine.sessions(colony.id, session.playerId) });
      if (req.method === 'DELETE' && url.pathname === '/api/session') { await engine.revokeSession(colony.id, session.playerId); return json(res, 200, { ok: true }); }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
        const ok = await engine.revokeSession(colony.id, decodeURIComponent(url.pathname.slice('/api/sessions/'.length)));
        return ok ? json(res, 200, { ok: true }) : json(res, 404, { error: 'no such session' });
      }
      // The account behind this colony and its passkeys; adding one creates the account (decision 0010, lot B).
      if (req.method === 'GET' && url.pathname === '/api/account') return json(res, 200, await passkeys.summary(colony));
      if (req.method === 'POST' && url.pathname === '/api/auth/passkey/register/options') {
        const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';
        return json(res, 200, await passkeys.registrationOptions(colony, lang));
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/passkey/register/verify') {
        const parsed = z.object({ response: z.object({ id: z.string().min(1) }).passthrough(), label: z.string().max(60).optional() }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid response' });
        const r = await passkeys.registrationVerify(colony, parsed.data.response as unknown as Parameters<typeof passkeys.registrationVerify>[1], parsed.data.label || deviceLabel(req.headers['user-agent']));
        if (!r.ok) return json(res, 400, { error: r.reason });
        const account = await passkeys.accountFor(colony, 'fr', false);
        if (account) await engine.adoptSessions(colony.id, account.id);
        return json(res, 200, { ok: true, id: r.id });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/account/passkeys/')) {
        const ok = await passkeys.removePasskey(colony, decodeURIComponent(url.pathname.slice('/api/account/passkeys/'.length)));
        return ok ? json(res, 200, { ok: true }) : json(res, 404, { error: 'no such passkey' });
      }
      // The rescue e-mail (decision 0010, lot C): a code to the address, typed here; adding one creates the account too.
      if (req.method === 'POST' && url.pathname === '/api/account/email/start') {
        const parsed = z.object({ email: z.string().trim().min(3).max(254), lang: z.enum(['fr', 'en']).default('fr') }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid email' });
        const r = await emails.startAdd(colony, parsed.data.lang, parsed.data.email);
        if (!r.ok) return json(res, r.reason === 'already used' ? 409 : r.reason === 'too soon' ? 429 : 400, { error: r.reason });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/account/email/verify') {
        const parsed = z.object({ code: z.string().trim().min(6).max(8) }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid code' });
        const r = await emails.verifyAdd(colony, parsed.data.code);
        if (!r.ok) return json(res, 400, { error: r.reason });
        await engine.adoptSessions(colony.id, r.account.id);
        return json(res, 200, { ok: true, email: r.email });
      }
      if (req.method === 'DELETE' && url.pathname === '/api/account/email') {
        return (await emails.removeEmail(colony)) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'no e-mail' });
      }
      if (req.method === 'POST' && url.pathname === '/api/link') { const code = engine.linkCode(colony.id); return json(res, 200, { code, url: `${engine.cfg.publicOrigin}/#join=${encodeURIComponent(code)}` }); }
      if (req.method === 'GET' && url.pathname.startsWith('/api/system/')) {
        const v = engine.systemView(colony.id, decodeURIComponent(url.pathname.slice('/api/system/'.length)));
        return v ? json(res, 200, v) : json(res, 404, { error: 'no such system' });
      }
      if (req.method === 'GET' && url.pathname === '/api/battles') return json(res, 200, engine.battles(colony.id));
      if (req.method === 'GET' && url.pathname.startsWith('/api/battle/')) {
        const r = engine.battle(colony.id, decodeURIComponent(url.pathname.slice('/api/battle/'.length)));
        return r ? json(res, 200, r) : json(res, 404, { error: 'no such battle' });
      }
      if (req.method === 'GET' && url.pathname === '/api/briefing') return json(res, 200, await engine.briefing(colony.id, url.searchParams.get('lang') === 'en' ? 'en' : 'fr'));
      if (req.method === 'GET' && url.pathname === '/api/talk') return json(res, 200, { history: engine.history(colony.id) });
      if (req.method === 'POST' && url.pathname === '/api/talk') {
        const parsed = z.object({ text: z.string().trim().min(1).max(1500), lang: z.enum(['fr', 'en']).default('fr') }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid message' });
        return json(res, 200, await engine.talk(colony.id, parsed.data.text, parsed.data.lang));
      }
      if (req.method === 'POST' && url.pathname === '/api/doctrine') {
        const parsed = z.object({ text: z.string().max(2000), lang: z.enum(['fr', 'en']).default('fr') }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid doctrine' });
        return json(res, 200, await engine.doctrine(colony.id, parsed.data.text, parsed.data.lang));
      }
      // The doctrine shown to the player, waiting for a yes (DOCTRINE_CONFIRM=1), and the yes itself.
      if (req.method === 'GET' && url.pathname === '/api/doctrine/pending') { const p = engine.general.pendingDoctrine(colony.id); return json(res, 200, p ? { id: p.id, readable: p.readable, summary: p.summary, reply: p.reply } : null); }
      if (req.method === 'POST' && url.pathname === '/api/doctrine/confirm') {
        const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid confirmation' });
        const r = engine.confirmDoctrine(colony.id, parsed.data.id);
        return json(res, r.ok ? 200 : 404, r);
      }
      if (req.method === 'POST' && url.pathname === '/api/doctrine/discard') { engine.general.discardDoctrine(colony.id); return json(res, 200, { ok: true }); }
      // The Draw Counsel (decision 0009): three cards; "Do it" runs the card's command, "Not now" remembers the refusal.
      if (req.method === 'GET' && url.pathname === '/api/counsel') return json(res, 200, await engine.general.counsel(colony.id, url.searchParams.get('lang') === 'en' ? 'en' : 'fr'));
      if (req.method === 'POST' && (url.pathname === '/api/counsel/take' || url.pathname === '/api/counsel/skip')) {
        const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid card' });
        const r = await engine.general.decideCounsel(colony.id, parsed.data.id, url.pathname.endsWith('/take'));
        return json(res, r.ok ? 200 : 404, r);
      }
      // What my General knows about me: readable, exportable, erasable (LPD/RGPD).
      if (req.method === 'GET' && url.pathname === '/api/memory') return json(res, 200, await engine.general.exportMemory(colony.id));
      if (req.method === 'DELETE' && url.pathname === '/api/memory') return json(res, 200, await engine.general.eraseMemory(colony.id));
      if (req.method === 'POST' && url.pathname === '/api/cmd') {
        const parsed = CommandSchema.safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid command', issues: parsed.error.issues });
        return json(res, 200, engine.command(colony.id, parsed.data));
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      return json(res, 400, { error: (err as Error).message });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const token = url.searchParams.get('token') ?? '';
    void engine.authenticateSession(token).then((session) => {
      if (!session) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => attach(ws, session.colony.id, session.playerId));
    });
  });

  const WatchSchema = z.object({ watch: z.string().max(64).nullable() });
  const EnvelopeSchema = z.object({ id: z.string().optional(), command: CommandSchema });

  function attach(ws: WebSocket, colonyId: string, playerId: string): void {
    const unsubscribe = engine.subscribe(colonyId, (view) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'view', view }));
    });
    // A revoked session loses its socket at once; the client reads 4401 as "go back to the landing page".
    const offRevoke = engine.onRevoke((id) => { if (id === playerId && ws.readyState === ws.OPEN) ws.close(4401, 'session revoked'); });
    ws.once('close', offRevoke);
    // One watched plateau per connection: {"watch": systemId} starts the 2 Hz stream, {"watch": null} stops it.
    let unwatch: (() => void) | null = null;
    ws.on('message', (raw) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch { ws.send(JSON.stringify({ type: 'error', error: 'bad json' })); return; }
      const watch = WatchSchema.safeParse(msg);
      if (watch.success) {
        unwatch?.(); unwatch = null;
        if (watch.data.watch !== null) {
          const systemId = watch.data.watch;
          unwatch = engine.watchSystem(colonyId, systemId, (view) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'system', view })); });
          if (!engine.systemView(colonyId, systemId)) ws.send(JSON.stringify({ type: 'error', error: 'no such system' }));
        }
        return;
      }
      const env = EnvelopeSchema.safeParse(msg);
      if (!env.success) { ws.send(JSON.stringify({ type: 'error', error: 'invalid command', issues: env.error.issues })); return; }
      const result = engine.command(colonyId, env.data.command);
      ws.send(JSON.stringify({ type: 'result', id: env.data.id, result }));
    });
    ws.on('close', () => { unsubscribe(); unwatch?.(); });
  }

  return server;
}
