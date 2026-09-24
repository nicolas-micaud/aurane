// Renders the PWA icon set from public/icon.svg with headless Chromium (no native image deps).
// Usage: node apps/web/scripts/icons.mjs   (from the repo root)
/* global process, console */
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const pub = resolve('apps/web/public');
const svg = await readFile(resolve(pub, 'icon.svg'), 'utf8');
const bg = '#070b16';
// name → [size, glyph scale]. Maskable icons keep the glyph inside the 80% safe zone; the plain ones fill more.
const set = {
  'icon-192.png': [192, 0.78], 'icon-512.png': [512, 0.78], 'apple-touch-icon.png': [180, 0.78],
  'icon-maskable-192.png': [192, 0.58], 'icon-maskable-512.png': [512, 0.58],
};
const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, [size, scale]] of Object.entries(set)) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * scale);
  await page.setContent(`<html><body style="margin:0;background:${bg};width:${size}px;height:${size}px;display:grid;place-items:center"><div style="width:${inner}px;height:${inner}px">${svg.replace(/width="[^"]*pt"\s+height="[^"]*pt"/, 'width="100%" height="100%"')}</div></body></html>`);
  await page.screenshot({ path: resolve(pub, name), clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
  console.log('wrote', name);
}
await browser.close();
