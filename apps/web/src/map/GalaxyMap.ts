// The map: a PixiJS scene of what the player can see, with touch-first camera controls.
// Everything is redrawn from the PlayerView; there is no client-side game state.
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { hexDisk, hexToPixel, SECTOR_SIZE, type PlayerView, type SystemView } from '@aurane/sim';

export const FACTION_COLOR: Record<string, number> = { concordat: 0xe8c872, guild: 0xe07a3f, oracles: 0x9b7bff, corsairs: 0xd9534f };
export const RESOURCE_COLOR: Record<string, number> = { metal: 0x9aa5b1, energy: 0xffd166, food: 0x6fcf97, crystal: 0x7dd3fc };
const HEX_SIZE = SECTOR_SIZE * 0.62;

export interface MapCallbacks {
  onSelect(systemId: string | null): void;
}

export class GalaxyMap {
  readonly app = new Application();
  private world = new Container();
  private fogLayer = new Graphics();
  private sectorLayer = new Graphics();
  private relayLayer = new Graphics();
  private systemLayer = new Container();
  private fleetLayer = new Graphics();
  private labelLayer = new Container();
  private view: PlayerView | null = null;
  private selected: string | null = null;
  private linkFrom: string | null = null;
  private factionOf = new Map<string, string>();
  private systemById = new Map<string, SystemView>();
  private ready = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private dragMoved = false;

  constructor(private readonly cb: MapCallbacks) {}

  async mount(el: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: el, background: 0x070b16, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    el.appendChild(this.app.canvas);
    this.world.addChild(this.fogLayer, this.sectorLayer, this.relayLayer, this.systemLayer, this.fleetLayer, this.labelLayer);
    this.app.stage.addChild(this.world);
    this.world.scale.set(Math.min(0.5, Math.max(0.28, el.clientWidth / 2600)));
    this.world.position.set(el.clientWidth / 2, el.clientHeight / 2);
    this.bindCamera(this.app.canvas);
    this.ready = true;
    if (this.view) { this.render(this.view); this.centerOn(this.view.me.capital); }
  }

  destroy(): void { this.app.destroy(true, { children: true }); }

  setSelection(id: string | null): void { this.selected = id; if (this.view) this.render(this.view); }
  setLinkFrom(id: string | null): void { this.linkFrom = id; if (this.view) this.render(this.view); }

  centerOn(systemId: string): void {
    const s = this.systemById.get(systemId);
    if (!s) return;
    const k = this.world.scale.x;
    this.world.position.set(this.app.screen.width / 2 - s.x * k, this.app.screen.height / 2 - s.y * k);
  }

  update(view: PlayerView): void {
    const first = this.view === null;
    this.view = view;
    this.factionOf = new Map(view.colonies.map((c) => [c.id, c.faction]));
    this.systemById = new Map(view.systems.map((s) => [s.id, s]));
    if (!this.ready) return;
    this.render(view);
    if (first) this.centerOn(view.me.capital);
  }

  // --- rendering -----------------------------------------------------------

  private render(v: PlayerView): void {
    this.drawFog(v);
    this.drawSectors(v);
    this.drawRelays(v);
    this.drawSystems(v);
    this.drawFleets(v);
  }

  private drawFog(v: PlayerView): void {
    const g = this.fogLayer;
    g.clear();
    const visible = new Set(v.sectors.map((s) => s.key));
    for (const h of hexDisk(v.galaxyRadius)) {
      const key = `${h.q},${h.r}`;
      if (visible.has(key)) continue;
      const c = hexToPixel(h, HEX_SIZE);
      hexPath(g, c.x, c.y, HEX_SIZE * 0.98);
      g.fill({ color: 0x0b1224, alpha: 0.9 });
      g.stroke({ color: 0x18213a, width: 3 });
    }
  }

  private drawSectors(v: PlayerView): void {
    const g = this.sectorLayer;
    g.clear();
    for (const s of v.sectors) {
      const c = hexToPixel({ q: s.q, r: s.r }, HEX_SIZE);
      hexPath(g, c.x, c.y, HEX_SIZE * 0.98);
      g.fill({ color: 0x0e1730, alpha: 1 });
      g.stroke({ color: 0x2a3760, width: 3 });
      for (const n of s.nebulae) { g.circle(n.x, n.y, n.r); g.fill({ color: 0x7c4dff, alpha: 0.12 }); }
      for (const b of s.blackHoles) {
        g.circle(b.x, b.y, b.r * 1.6); g.fill({ color: 0x000000, alpha: 0.35 });
        g.circle(b.x, b.y, b.r); g.fill({ color: 0x000000 }); g.stroke({ color: 0xff8a65, width: 2, alpha: 0.6 });
      }
    }
  }

  private drawRelays(v: PlayerView): void {
    const g = this.relayLayer;
    g.clear();
    for (const r of v.relays) {
      const a = this.systemById.get(r.a), b = this.systemById.get(r.b);
      if (!a || !b) continue;
      const mine = r.owner === v.me.id;
      const color = mine ? 0x7dd3fc : FACTION_COLOR[this.factionOf.get(r.owner) ?? ''] ?? 0x8899aa;
      if (r.cut) dashed(g, a.x, a.y, b.x, b.y, 14, 10, { color: 0xff5252, width: 4, alpha: 0.9 });
      else if (!r.ready) dashed(g, a.x, a.y, b.x, b.y, 8, 8, { color, width: 3, alpha: 0.6 });
      else {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color, width: mine ? 5 : 3, alpha: mine ? 0.95 : 0.7 });
        if (r.bridge && mine) g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xffd166, width: 10, alpha: 0.18 });
      }
    }
    if (this.linkFrom && this.selected && this.linkFrom !== this.selected) {
      const a = this.systemById.get(this.linkFrom), b = this.systemById.get(this.selected);
      if (a && b) dashed(g, a.x, a.y, b.x, b.y, 10, 10, { color: 0xffffff, width: 3, alpha: 0.8 });
    }
  }

  private drawSystems(v: PlayerView): void {
    this.systemLayer.removeChildren();
    this.labelLayer.removeChildren();
    const style = new TextStyle({ fill: 0xd7dfee, fontSize: 40, fontFamily: 'system-ui, sans-serif', stroke: { color: 0x070b16, width: 6 } });
    for (const s of v.systems) {
      const g = new Graphics();
      const base = 12 + s.slots * 4;
      const color = RESOURCE_COLOR[s.resource] ?? 0xffffff;
      if (s.connected) { g.circle(s.x, s.y, base * 2.2); g.fill({ color: 0x7dd3fc, alpha: 0.12 }); }
      if (s.owner) {
        const fc = FACTION_COLOR[this.factionOf.get(s.owner) ?? ''] ?? 0xffffff;
        g.circle(s.x, s.y, base + 8); g.stroke({ color: fc, width: s.owner === v.me.id ? 5 : 3, alpha: 0.9 });
      }
      if (s.kind === 'pulsar') { for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + 0.4; g.moveTo(s.x + Math.cos(a) * base, s.y + Math.sin(a) * base).lineTo(s.x + Math.cos(a) * base * 2, s.y + Math.sin(a) * base * 2).stroke({ color: 0xffffff, width: 3, alpha: 0.8 }); } }
      if (s.kind === 'beacon') { g.star(s.x, s.y, 7, base * 2.4, base * 1.2); g.fill({ color: s.lit ? 0xffd166 : 0x334155, alpha: s.lit ? 0.9 : 0.6 }); }
      g.circle(s.x, s.y, base); g.fill({ color });
      if (s.blockadedBy) { g.circle(s.x, s.y, base + 16); g.stroke({ color: 0xff5252, width: 4, alpha: 0.9 }); }
      if (s.id === this.selected) { g.circle(s.x, s.y, base + 26); g.stroke({ color: 0xffffff, width: 3 }); }
      if (s.id === this.linkFrom) { g.circle(s.x, s.y, base + 34); g.stroke({ color: 0x7dd3fc, width: 3 }); }
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.hitArea = { contains: (x: number, y: number) => Math.hypot(x - s.x, y - s.y) <= base + 30 };
      g.on('pointertap', () => { if (!this.dragMoved) this.cb.onSelect(s.id); });
      this.systemLayer.addChild(g);
      if (s.owner === v.me.id || s.id === this.selected || s.kind === 'beacon') {
        const label = new Text({ text: s.name, style });
        label.anchor.set(0.5, 0);
        label.position.set(s.x, s.y + base + 14);
        this.labelLayer.addChild(label);
      }
    }
  }

  private drawFleets(v: PlayerView): void {
    const g = this.fleetLayer;
    g.clear();
    for (const f of v.fleets) {
      const anchor = f.at ?? f.destination;
      const s = anchor ? this.systemById.get(anchor) : undefined;
      if (!s) continue;
      const mine = f.owner === v.me.id;
      const color = mine ? 0xffffff : FACTION_COLOR[this.factionOf.get(f.owner) ?? ''] ?? 0xff5252;
      const ox = s.x + 30, oy = s.y - 30;
      g.moveTo(ox, oy - 12).lineTo(ox + 12, oy + 10).lineTo(ox - 12, oy + 10).closePath();
      g.fill({ color, alpha: f.at ? 1 : 0.5 });
    }
  }

  // --- camera --------------------------------------------------------------

  private bindCamera(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.dragMoved = false; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (this.pointers.size === 1) {
        const dx = cur.x - prev.x, dy = cur.y - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
        this.world.position.x += dx; this.world.position.y += dy;
      } else if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, cur);
        const [p1, p2] = [...this.pointers.values()];
        const d = Math.hypot(p1!.x - p2!.x, p1!.y - p2!.y);
        if (this.pinchDist) this.zoomAt((p1!.x + p2!.x) / 2, (p1!.y + p2!.y) / 2, d / this.pinchDist);
        this.pinchDist = d;
        this.dragMoved = true;
        return;
      }
      this.pointers.set(e.pointerId, cur);
    });
    const up = (e: PointerEvent): void => { this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinchDist = 0; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    canvas.addEventListener('pointertap', () => undefined);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', (e) => { if (!this.dragMoved && e.target === this.app.stage) this.cb.onSelect(null); });
  }

  private zoomAt(cx: number, cy: number, factor: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = cx - rect.left, sy = cy - rect.top;
    const k0 = this.world.scale.x;
    const k1 = Math.min(1.6, Math.max(0.06, k0 * factor));
    const wx = (sx - this.world.position.x) / k0, wy = (sy - this.world.position.y) / k0;
    this.world.scale.set(k1);
    this.world.position.set(sx - wx * k1, sy - wy * k1);
  }
}

function hexPath(g: Graphics, cx: number, cy: number, size: number): void {
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const x = cx + size * Math.cos(a), y = cy + size * Math.sin(a);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

function dashed(g: Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number, stroke: { color: number; width: number; alpha: number }): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e);
  }
  g.stroke(stroke);
}
