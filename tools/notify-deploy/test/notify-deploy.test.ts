import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../notify-deploy.sh', import.meta.url));
const SECRET = 'whsec_' + Buffer.from('a test key of 24 bytes!!').toString('base64');

function run(env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('bash', [SCRIPT], { env: { PATH: process.env.PATH ?? '', ...env } }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }));
  });
}

function receiver(status: number): Promise<{ url: string; got: Promise<{ body: string; headers: IncomingHttpHeaders }>; close: () => void }> {
  return new Promise((resolve) => {
    let deliver: (v: { body: string; headers: IncomingHttpHeaders }) => void = () => {};
    const got = new Promise<{ body: string; headers: IncomingHttpHeaders }>((r) => { deliver = r; });
    const srv = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { res.statusCode = status; res.end(); deliver({ body, headers: req.headers }); });
    });
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      resolve({ url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/hook`, got, close: () => srv.close() });
    });
  });
}

describe('notify-deploy.sh', () => {
  it('skips quietly when the webhook URL is absent', async () => {
    const r = await run({});
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('not set, skipped');
  });

  it('posts the deploy payload, signed the Standard Webhooks way', async () => {
    const rx = await receiver(200);
    const r = await run({ GROK_DEPLOY_WEBHOOK_URL: rx.url, GROK_DEPLOY_WEBHOOK_SECRET: SECRET, NOTIFY_REPO: process.cwd() });
    const { body, headers } = await rx.got;
    rx.close();
    expect(r.code).toBe(0);
    const p = JSON.parse(body) as Record<string, string>;
    expect(p).toMatchObject({ project: 'aurane', env: 'prod', url: 'https://play.playaurane.com' });
    expect(p.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(p.deployed_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64');
    const expected = createHmac('sha256', key).update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${body}`).digest('base64');
    expect(headers['webhook-signature']).toBe(`v1,${expected}`);
  });

  it('never fails the deploy when the webhook errors', async () => {
    const rx = await receiver(500);
    const r = await run({ GROK_DEPLOY_WEBHOOK_URL: rx.url });
    await rx.got; rx.close();
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('answered 500');
    const dead = await run({ GROK_DEPLOY_WEBHOOK_URL: 'http://127.0.0.1:9/none' });
    expect(dead.code).toBe(0);
  });
});
