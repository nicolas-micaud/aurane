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

/** A cargo hull: boxy, pointing +x, with a small engine glow. */
export const cargoTexture = (): Texture => canvasTexture('cargo', 96, (ctx, s) => {
  const cx = s / 2, cy = s / 2;
  const eg = ctx.createRadialGradient(cx - 24, cy, 0, cx - 24, cy, 16);
  eg.addColorStop(0, 'rgba(255,255,255,0.7)'); eg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = eg; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath(); ctx.roundRect(cx - 18, cy - 11, 36, 22, 4); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.moveTo(cx + 18, cy - 8); ctx.lineTo(cx + 28, cy); ctx.lineTo(cx + 18, cy + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = -1; i <= 1; i++) ctx.fillRect(cx - 12 + i * 10, cy - 7, 6, 14);
});

/** Structures of the System view, drawn white for tinting, facing outward (+y is away from the star). */
export const structureTexture = (kind: string): Texture => canvasTexture(`struct-${kind}`, 128, (ctx, s) => {
  const c = s / 2;
  ctx.translate(c, c);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const hex = (r: number): void => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; const x = r * Math.cos(a), y = r * Math.sin(a); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); };
  switch (kind) {
    case 'extractor': hex(30); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(0, 30); ctx.moveTo(-26, -15); ctx.lineTo(26, 15); ctx.moveTo(-26, 15); ctx.lineTo(26, -15); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); break;
    case 'warehouse': ctx.beginPath(); ctx.roundRect(-30, -22, 60, 44, 6); ctx.stroke(); for (let i = -1; i <= 1; i++) { ctx.fillRect(-24 + (i + 1) * 17, -14, 12, 28); } break;
    case 'tradepost': ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-18, 8); ctx.lineTo(-6, -10); ctx.lineTo(4, 4); ctx.lineTo(18, -14); ctx.stroke(); ctx.beginPath(); ctx.arc(18, -14, 5, 0, Math.PI * 2); ctx.fill(); break;
    case 'shipyard': ctx.beginPath(); ctx.roundRect(-34, -18, 68, 36, 8); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(14, 0); ctx.lineTo(4, -8); ctx.moveTo(14, 0); ctx.lineTo(4, 8); ctx.stroke(); ctx.fillRect(-34, 18, 68, 6); break;
    case 'bastion': ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(30, -20); ctx.lineTo(26, 14); ctx.lineTo(0, 34); ctx.lineTo(-26, 14); ctx.lineTo(-30, -20); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill(); break;
    case 'turret_light': ctx.beginPath(); ctx.arc(0, 4, 18, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -34); ctx.stroke(); break;
    case 'turret_heavy': ctx.beginPath(); ctx.arc(0, 6, 22, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(-8, 6); ctx.lineTo(-8, -34); ctx.moveTo(8, 6); ctx.lineTo(8, -34); ctx.stroke(); break;
    case 'launcher': ctx.beginPath(); ctx.roundRect(-26, -10, 52, 30, 5); ctx.stroke(); for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 14, -10); ctx.lineTo(i * 14 - 6, -30); ctx.lineTo(i * 14 + 6, -30); ctx.closePath(); ctx.fill(); } break;
    case 'antenna': ctx.beginPath(); ctx.arc(0, 10, 26, Math.PI, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -34); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -34, 6, 0, Math.PI * 2); ctx.fill(); break;
    case 'amplifier': for (let r = 10; r <= 34; r += 12) { ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke(); } ctx.beginPath(); ctx.arc(0, 6, 8, 0, Math.PI * 2); ctx.fill(); break;
    default: hex(26); ctx.stroke();
  }
});

/** The station-relais: a hexagonal hub with three spokes. */
export const stationTexture = (): Texture => canvasTexture('station', 192, (ctx, s) => {
  const c = s / 2;
  ctx.translate(c, c);
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 7; ctx.lineJoin = 'round';
  ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; const x = 42 * Math.cos(a), y = 42 * Math.sin(a); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.stroke();
  ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; const x = 22 * Math.cos(a), y = 22 * Math.sin(a); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.fill();
  for (let i = 0; i < 3; i++) { const a = (Math.PI * 2 / 3) * i - Math.PI / 2; ctx.beginPath(); ctx.moveTo(42 * Math.cos(a), 42 * Math.sin(a)); ctx.lineTo(74 * Math.cos(a), 74 * Math.sin(a)); ctx.stroke(); ctx.beginPath(); ctx.arc(80 * Math.cos(a), 80 * Math.sin(a), 9, 0, Math.PI * 2); ctx.fill(); }
});
