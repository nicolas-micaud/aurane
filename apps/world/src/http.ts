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
      if (req.method === 'POST' && url.pathname === '/api/guest') {
        const parsed = GuestSchema.safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid guest', issues: parsed.error.issues });
        const { token, colony } = await engine.createGuest(parsed.data.name, parsed.data.faction, parsed.data.persona);
        return json(res, 201, { token, colonyId: colony.id });
      }
      const token = bearer(req);
      const colony = token ? await engine.authenticate(token) : null;
      if (!colony) return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, engine.view(colony.id));
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
      if (req.method === 'POST' && url.pathname === '/api/doctrine') {
        const parsed = z.object({ text: z.string().max(2000), lang: z.enum(['fr', 'en']).default('fr') }).safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: 'invalid doctrine' });
        return json(res, 200, await engine.doctrine(colony.id, parsed.data.text, parsed.data.lang));
      }
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
