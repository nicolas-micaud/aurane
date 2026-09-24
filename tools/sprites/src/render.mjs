/* global process, URL, console, Buffer, window */
// Renders every model of web/models.js to sprite sheets in apps/web/public/sprites/.
// Runs three.js in headless Chromium (Playwright core), so no Blender and no GPU needed:
//   node tools/sprites/src/render.mjs [--px 128] [--only cruiser,station]
// Set CHROMIUM_PATH to a Chromium binary when Playwright has none installed.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const webDir = resolve(here, '../web');
const threeDir = join(root, 'node_modules/three/build');
const outDir = join(root, 'apps/web/public/sprites');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const px = Number(arg('px', '128'));
const only = arg('only', '').split(',').filter(Boolean);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file;
  if (url.pathname.startsWith('/three/')) file = join(threeDir, url.pathname.slice('/three/'.length));
  else file = join(webDir, url.pathname === '/' ? 'index.html' : url.pathname);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', '/opt/pw-browsers/chromium/chrome-linux/chrome'].filter(Boolean);
let executablePath;
for (const c of candidates) { try { await readFile(c); executablePath = c; break; } catch { /* next */ } }
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
const kinds = (await page.evaluate(() => window.MODEL_KINDS)).filter((k) => !only.length || only.includes(k));
const icons = arg('icons', '');
if (icons) {
  // Icons for the showcase site: one 512 px frame per model, faction colour baked in.
  const dir = join(root, 'apps/web/public/images');
  await mkdir(dir, { recursive: true });
  const team = arg('team', '#e8c872');
  const units = new Set(['corvette', 'frigate', 'cruiser', 'cargo']);
  for (const kind of kinds) {
    const data = await page.evaluate(({ kind, px, team }) => window.renderIcon(kind, px, team), { kind, px: Number(icons), team });
    const name = `${units.has(kind) ? 'unit' : 'structure'}-${kind.replace('_', '-')}.png`;
    await writeFile(join(dir, name), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`icon ${name}`);
  }
  await browser.close(); server.close();
  process.exit(0);
}
await mkdir(outDir, { recursive: true });
const manifest = { px, frames: 16, elevation: 52, models: {} };
for (const kind of kinds) {
  const r = await page.evaluate(({ kind, px }) => window.renderModel(kind, px), { kind, px });
  await writeFile(join(outDir, `${kind}.png`), Buffer.from(r.base.split(',')[1], 'base64'));
  await writeFile(join(outDir, `${kind}.lights.png`), Buffer.from(r.lights.split(',')[1], 'base64'));
  manifest.models[kind] = { radius: r.radius };
  console.log(`${kind}: ${r.frames} frames @ ${px}px (radius ${r.radius.toFixed(2)})`);
}
await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await browser.close();
server.close();
