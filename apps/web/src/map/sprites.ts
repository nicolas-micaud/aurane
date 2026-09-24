// Pre-rendered 3D sprite sheets (tools/sprites): 16 headings per model, a base sheet and a
// "lights" sheet carrying the faction colour. Loaded once; the scenes fall back to glyphs
// while loading or when a sheet is missing.
import { Assets, Rectangle, Texture } from 'pixi.js';

interface Manifest { px: number; frames: number; elevation: number; models: Record<string, { radius: number }> }

let manifest: Manifest | null = null;
const base = new Map<string, Texture>();
const lights = new Map<string, Texture>();
const frameCache = new Map<string, Texture>();
let loading: Promise<void> | null = null;

export function loadSprites(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch('/sprites/manifest.json');
      if (!res.ok) return;
      manifest = await res.json() as Manifest;
      await Promise.all(Object.keys(manifest.models).map(async (kind) => {
        const [b, l] = await Promise.all([Assets.load<Texture>(`/sprites/${kind}.png`), Assets.load<Texture>(`/sprites/${kind}.lights.png`)]);
        base.set(kind, b); lights.set(kind, l);
      }));
    } catch { manifest = null; }
  })();
  return loading;
}

export const spritesReady = (): boolean => manifest !== null && base.size > 0;
export const hasSprite = (kind: string): boolean => base.has(kind);

/** Frame index for a heading (radians, screen convention: clockwise, 0 = +x). */
function frameFor(heading: number): number {
  const n = manifest?.frames ?? 16;
  // The renderer rotates the model counter-clockwise (seen from above) by i/n turns; Pixi angles run clockwise.
  const turns = (((-heading) / (Math.PI * 2)) % 1 + 1) % 1;
  return Math.round(turns * n) % n;
}

function frame(map: Map<string, Texture>, tag: string, kind: string, heading: number): Texture | null {
  const sheet = map.get(kind);
  if (!sheet || !manifest) return null;
  const i = frameFor(heading);
  const key = `${tag}:${kind}:${i}`;
  const hit = frameCache.get(key);
  if (hit) return hit;
  const px = manifest.px;
  const tex = new Texture({ source: sheet.source, frame: new Rectangle(i * px, 0, px, px) });
  frameCache.set(key, tex);
  return tex;
}

export const spriteFrame = (kind: string, heading: number): Texture | null => frame(base, 'b', kind, heading);
export const lightsFrame = (kind: string, heading: number): Texture | null => frame(lights, 'l', kind, heading);
/** Model radius in its own units, to scale sheets consistently (a cruiser is bigger than a corvette). */
export const spriteRadius = (kind: string): number => manifest?.models[kind]?.radius ?? 3;
