// HTTP + WebSocket boundary. Everything that comes in is validated with the protocol schemas;
// everything that goes out is a PlayerView (fog of war applied) or a public summary.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
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

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export function createHttpServer(engine: Engine): Server {
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
        const made = await engine.createGuest(parsed.data.name, parsed.data.faction, parsed.data.persona, parsed.data.invite, engine.originHash(clientIp(req)));
        if ('error' in made) return json(res, 403, { error: made.error });
        return json(res, 201, { token: made.token, colonyId: made.colony.id });
      }
      if (req.method === 'POST' && url.pathname === '/api/redeem') {
        const parsed = z.object({ code: z.string().min(10).max(400) }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid code' });
        const made = await engine.redeemLink(parsed.data.code.trim());
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
          if (url.searchParams.get('format') === 'prometheus') { const body = engine.general.prometheus(); res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }); return res.end(body); }
          return json(res, 200, await engine.general.snapshot());
        }
        return json(res, 404, { error: 'not found' });
      }
      const token = bearer(req);
      const colony = token ? await engine.authenticate(token) : null;
      if (!colony) return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, engine.view(colony.id));
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
    void engine.authenticate(token).then((colony) => {
      if (!colony) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => attach(ws, colony.id));
    });
  });

  const WatchSchema = z.object({ watch: z.string().max(64).nullable() });
  const EnvelopeSchema = z.object({ id: z.string().optional(), command: CommandSchema });

  function attach(ws: WebSocket, colonyId: string): void {
    const unsubscribe = engine.subscribe(colonyId, (view) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'view', view }));
    });
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
