// Procedural textures drawn once on a 2D canvas: no asset pipeline, no downloads, and
// every glow, nebula and ship is generated at the device's resolution.
import { Texture } from 'pixi.js';

const cache = new Map<string, Texture>();

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = Texture.from(canvas);
  cache.set(key, tex);
  return tex;
}

/** Soft radial glow, white; tint it. */
export const glowTexture = (): Texture => canvasTexture('glow', 256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
});

/** Hard bright core with a thin corona. */
export const coreTexture = (): Texture => canvasTexture('core', 128, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
});

/** Nebula blob: layered noisy radial gradients. */
export const nebulaTexture = (seed: number): Texture => canvasTexture(`nebula${seed}`, 512, (ctx, s) => {
  let r = seed >>> 0 || 1;
  const rnd = (): number => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  for (let i = 0; i < 26; i++) {
    const x = s / 2 + (rnd() - 0.5) * s * 0.5, y = s / 2 + (rnd() - 0.5) * s * 0.5;
    const rad = s * (0.12 + rnd() * 0.28);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.10 + rnd() * 0.08})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }
});

/** Accretion ring for black holes. */
export const ringTexture = (): Texture => canvasTexture('ring', 256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath(); ctx.ellipse(s / 2, s / 2, s * 0.5, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
});

/** A ship silhouette pointing +x, with an engine glow behind. */
export const shipTexture = (): Texture => canvasTexture('ship', 96, (ctx, s) => {
  const cx = s / 2, cy = s / 2;
  const eg = ctx.createRadialGradient(cx - 22, cy, 0, cx - 22, cy, 22);
  eg.addColorStop(0, 'rgba(255,255,255,0.8)'); eg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = eg; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.moveTo(cx + 30, cy); ctx.lineTo(cx - 14, cy - 14); ctx.lineTo(cx - 6, cy); ctx.lineTo(cx - 14, cy + 14); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 26, cy - 24); ctx.lineTo(cx - 16, cy - 6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx + 4, cy + 4); ctx.lineTo(cx - 26, cy + 24); ctx.lineTo(cx - 16, cy + 6); ctx.closePath(); ctx.fill();
});

/** Tiny star for the background field. */
export const dotTexture = (): Texture => canvasTexture('dot', 32, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
});

/** Signal pulse travelling along a relay. */
export const pulseTexture = (): Texture => canvasTexture('pulse', 64, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
});

/** Resource glyphs, one per resource, drawn white for tinting. */
export const glyphTexture = (kind: 'metal' | 'energy' | 'food' | 'crystal'): Texture => canvasTexture(`glyph-${kind}`, 64, (ctx, s) => {
  const c = s / 2;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'metal') { for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 6; const x = c + 22 * Math.cos(a), y = c + 22 * Math.sin(a); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.fill(); }
  else if (kind === 'energy') { ctx.moveTo(c + 6, c - 26); ctx.lineTo(c - 14, c + 4); ctx.lineTo(c - 1, c + 4); ctx.lineTo(c - 6, c + 26); ctx.lineTo(c + 14, c - 4); ctx.lineTo(c + 1, c - 4); ctx.closePath(); ctx.fill(); }
  else if (kind === 'food') { ctx.ellipse(c, c, 12, 24, Math.PI / 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(c - 10, c + 16); ctx.lineTo(c + 10, c - 16); ctx.stroke(); }
  else { ctx.moveTo(c, c - 26); ctx.lineTo(c + 18, c); ctx.lineTo(c, c + 26); ctx.lineTo(c - 18, c); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.moveTo(c, c - 26); ctx.lineTo(c + 18, c); ctx.lineTo(c, c); ctx.closePath(); ctx.fill(); }
});
