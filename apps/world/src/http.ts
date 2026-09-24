// HTTP + WebSocket boundary. Everything that comes in is validated with the protocol schemas;
// everything that goes out is a PlayerView (fog of war applied) or a public summary.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { CommandSchema, FACTIONS, PERSONAS } from '@aurane/protocol';
import type { Engine } from './engine.js';

const GuestSchema = z.object({
  name: z.string().trim().min(2).max(32),
  faction: z.enum(FACTIONS),
  persona: z.enum(PERSONAS),
});

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

  function attach(ws: WebSocket, colonyId: string): void {
    const unsubscribe = engine.subscribe(colonyId, (view) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'view', view }));
    });
    ws.on('message', (raw) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch { ws.send(JSON.stringify({ type: 'error', error: 'bad json' })); return; }
      const env = z.object({ id: z.string().optional(), command: CommandSchema }).safeParse(msg);
      if (!env.success) { ws.send(JSON.stringify({ type: 'error', error: 'invalid command', issues: env.error.issues })); return; }
      const result = engine.command(colonyId, env.data.command);
      ws.send(JSON.stringify({ type: 'result', id: env.data.id, result }));
    });
    ws.on('close', unsubscribe);
  }

  return server;
}
