// Produces site/media: hero.webm (the relay Network spreading, recorded from the real game), hero-poster.webp,
// bg.webp and og.png. Run from the repo root with the world server on :8080 and the client preview on :4173
// (see site/README.md). Usage: node site/tools/media.mjs [seconds=20] [warmupSeconds=45]
/* global process, console, Buffer, fetch, document, Image, MediaRecorder, Blob, FileReader, localStorage, setTimeout */
import { chromium } from 'playwright-core';
import { writeFile, readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
const out = 'site/media';
const exe = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const seconds = Number(process.argv[2] ?? 20);
const warmup = Number(process.argv[3] ?? 45); // real seconds the General plays before the recording starts (relays appear)

// 1. The game: a fresh colony whose General plays while the "player" is away; the map only.
const res = await fetch('http://127.0.0.1:8080/api/guest', { method: 'POST', body: JSON.stringify({ name: 'Aurane', faction: 'concordat', persona: 'vane' }) });
const { token } = await res.json();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:4173/');
await page.evaluate((t) => { localStorage.setItem('aurane.token', t); localStorage.setItem('aurane.lang', 'fr'); localStorage.setItem('aurane.coach', '9'); }, token);
await page.reload();
await page.waitForSelector('.hud', { timeout: 20000 });
await page.addStyleTag({ content: '.hud,.panel,.toast,.briefing,.hint,.banner{display:none !important}' });
await page.waitForTimeout(warmup * 1000);
// Zoom in on the capital so relays read at 720p.
const box = await page.locator('canvas').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -200);
await page.waitForTimeout(800);
const posterPng = await page.screenshot({ type: 'png' });
const webm = await page.evaluate(async ({ seconds }) => {
  const canvas = document.querySelector('canvas');
  const stream = canvas.captureStream(24);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 850_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start(500);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: mime });
  const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  return { mime, b64 };
}, { seconds });
await writeFile(`${out}/hero.webm`, Buffer.from(webm.b64, 'base64'));
console.log('video', webm.mime, Buffer.from(webm.b64, 'base64').length, 'bytes');
// The game page saturates the software renderer after a capture: kill that browser outright and start a fresh one.
try { execSync(`pkill -9 -P ${browser.process().pid}; kill -9 ${browser.process().pid}`); } catch { /* already gone */ }
const browser2 = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
// Check the recording is not blank: a frame from the middle of the clip.
const chk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await writeFile('site/dist/hero.webm', Buffer.from(webm.b64, 'base64')).catch(() => undefined); // served by the local static server on :4180
await chk.setContent(`<video id=v muted playsinline width=1280 height=720 src="http://127.0.0.1:4180/hero.webm"></video>`);
await chk.evaluate(() => new Promise((r) => { const v = document.getElementById('v'); v.addEventListener('loadedmetadata', () => { v.currentTime = 10; }); v.addEventListener('seeked', () => r(), { once: true }); }));
await chk.screenshot({ path: 'site/media/.check-frame10.png' });
await chk.close();

// 2. WebP conversions in a blank page (no cwebp here): poster (1280 wide) and background (1920 wide).
const conv = await browser2.newPage();
await conv.goto('about:blank');
const toWebp = async (png, width, quality) => conv.evaluate(async ({ b64, width, quality }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const w = Math.min(width, img.naturalWidth), h = Math.round(img.naturalHeight * (w / img.naturalWidth));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/webp', quality).split(',')[1];
}, { b64: png.toString('base64'), width, quality });
await writeFile(`${out}/hero-poster.webp`, Buffer.from(await toWebp(posterPng, 1280, 0.72), 'base64'));
const bgJpg = await readFile('site/public/bg.jpg');
const bgB64 = await conv.evaluate(async ({ b64 }) => {
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
  const w = Math.min(1920, img.naturalWidth), h = Math.round(img.naturalHeight * (w / img.naturalWidth));
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/webp', 0.66).split(',')[1];
}, { b64: bgJpg.toString('base64') });
await writeFile(`${out}/bg.webp`, Buffer.from(bgB64, 'base64'));

// 3. The social image: logo, tagline and the game, 1200 × 630.
const og = await browser2.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const logo = await readFile('site/public/aurane.svg', 'utf8');
await og.setContent(`<!doctype html><html><head><style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#05070f;font-family:Inter,system-ui,sans-serif;color:#d7dfee}
.bg{position:absolute;inset:0;background:url(data:image/webp;base64,${bgB64}) center/cover;opacity:.55}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,7,15,.92) 0 42%,rgba(5,7,15,.2))}
.shot{position:absolute;right:-40px;top:70px;width:760px;height:490px;border-radius:18px;overflow:hidden;border:2px solid #2a3760;box-shadow:0 30px 80px rgba(0,0,0,.7);transform:rotate(-3deg)}
.shot img{width:100%;height:100%;object-fit:cover}
.txt{position:absolute;left:64px;top:120px;width:520px}
.txt svg{width:96px;height:96px;fill:#fff}
h1{font-size:96px;letter-spacing:.18em;margin:6px 0 0;font-weight:700;text-shadow:0 0 40px rgba(125,211,252,.35)}
.tag{color:#7dd3fc;letter-spacing:.32em;text-transform:uppercase;font-size:22px;margin:4px 0 26px}
.hook{font-size:34px;font-weight:600;line-height:1.2;margin:0}
.hook small{display:block;font-size:22px;color:#9fb0d0;font-weight:400;margin-top:8px}
</style></head><body><div class="bg"></div><div class="fade"></div>
<div class="shot"><img src="data:image/png;base64,${posterPng.toString('base64')}"></div>
<div class="txt">${logo.replace('<?xml version="1.0" standalone="no"?>', '').replace(/<!DOCTYPE[^>]*>/, '')}<h1>AURANE</h1><p class="tag">can't stop the signal</p><p class="hook">Ton Général IA joue pendant que tu dors.<small>Your AI General plays while you sleep.</small></p></div>
</body></html>`);
await og.waitForTimeout(500);
await og.screenshot({ path: `${out}/og.png`, type: 'png' });
await browser2.close();
console.log('media done');
