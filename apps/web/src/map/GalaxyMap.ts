// The map: a PixiJS scene of what the player can see, with touch-first camera controls.
// Everything is rebuilt from the PlayerView (no client-side game state); the ticker only
// animates: the Signal pulsing along relays, ships in flight, the selection reticle.
import { Application, Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import { hexDisk, hexToPixel, SECTOR_SIZE, type PlayerView, type RelayView, type SystemView } from '@aurane/sim';
import { coreTexture, dotTexture, glowTexture, glyphTexture, nebulaTexture, pulseTexture, ringTexture, shipTexture } from './textures.js';

export const FACTION_COLOR: Record<string, number> = { concordat: 0xe8c872, guild: 0xe07a3f, oracles: 0x9b7bff, corsairs: 0xd9534f };
export const RESOURCE_COLOR: Record<string, number> = { metal: 0xb8c4d0, energy: 0xffd166, food: 0x7ee2a8, crystal: 0x8be9ff };
const STAR_TINT: Record<string, number> = { metal: 0xdfe7f0, energy: 0xffe9a8, food: 0xd8ffe8, crystal: 0xd6f7ff };
const HEX_SIZE = SECTOR_SIZE * 0.62;
const SIGNAL = 0x7dd3fc;
const BRIDGE = 0xffd166;
const DANGER = 0xff5252;

export interface MapCallbacks { onSelect(systemId: string | null): void }

interface Pulse { sprite: Sprite; ax: number; ay: number; bx: number; by: number; t: number; speed: number }
interface Ship { sprite: Sprite; fromX: number; fromY: number; toX: number; toY: number; departAt: number; arriveAt: number }

export class GalaxyMap {
  readonly app = new Application();
  private world = new Container();
  private starfield = new Container();
  private fogLayer = new Graphics();
  private sectorLayer = new Graphics();
  private nebulaLayer = new Container();
  private holeLayer = new Container();
  private relayGlow = new Graphics();
  private relayLayer = new Graphics();
  private pulseLayer = new Container();
  private systemLayer = new Container();
  private fleetLayer = new Container();
  private reticle = new Graphics();
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
  private pulses: Pulse[] = [];
  private ships: Ship[] = [];
  private rings: Sprite[] = [];
  private simTimeAtReceive = 0;
  private receivedAt = 0;
  private lastLabelScale = -1;
  private tex!: { glow: Texture; core: Texture; dot: Texture; ring: Texture; ship: Texture; pulse: Texture };

  constructor(private readonly cb: MapCallbacks) {}

  async mount(el: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: el, background: 0x05070f, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    el.appendChild(this.app.canvas);
    this.tex = { glow: glowTexture(), core: coreTexture(), dot: dotTexture(), ring: ringTexture(), ship: shipTexture(), pulse: pulseTexture() };
    this.world.addChild(this.starfield, this.fogLayer, this.sectorLayer, this.nebulaLayer, this.holeLayer, this.relayGlow, this.relayLayer, this.pulseLayer, this.systemLayer, this.fleetLayer, this.reticle, this.labelLayer);
    this.app.stage.addChild(this.world);
    this.world.scale.set(Math.min(0.5, Math.max(0.28, el.clientWidth / 2600)));
    this.world.position.set(el.clientWidth / 2, el.clientHeight / 2);
    this.bindCamera(this.app.canvas);
    this.app.ticker.add((tk) => this.animate(tk.deltaMS));
    this.ready = true;
    if (this.view) { this.render(this.view); this.centerOn(this.view.me.capital); }
  }

  destroy(): void { this.app.destroy(true, { children: true }); }

  setSelection(id: string | null): void { this.selected = id; if (this.view && this.ready) this.render(this.view); }
  setLinkFrom(id: string | null): void { this.linkFrom = id; if (this.view && this.ready) this.render(this.view); }

  centerOn(systemId: string): void {
    const s = this.systemById.get(systemId);
    if (!s) return;
    const k = this.world.scale.x;
    this.world.position.set(this.app.screen.width / 2 - s.x * k, this.app.screen.height / 2 - s.y * k);
  }

  update(view: PlayerView): void {
    const first = this.view === null;
    this.view = view;
    this.simTimeAtReceive = view.time;
    this.receivedAt = performance.now();
    this.factionOf = new Map(view.colonies.map((c) => [c.id, c.faction]));
    this.systemById = new Map(view.systems.map((s) => [s.id, s]));
    if (!this.ready) return;
    if (first) this.buildStarfield(view.galaxyRadius);
    this.render(view);
    if (first) this.centerOn(view.me.capital);
  }

  /** Simulated time right now, extrapolated between server pushes (the server runs 1:1 or a known scale). */
  private simNow(): number {
    return this.simTimeAtReceive + ((performance.now() - this.receivedAt) / 1000) * (this.view?.timeScale ?? 1);
  }

  // --- rendering -----------------------------------------------------------

  private render(v: PlayerView): void {
    this.drawFog(v);
    this.drawSectors(v);
    this.drawRelays(v);
    this.drawSystems(v);
    this.drawFleets(v);
    this.lastLabelScale = -1;
  }

  private buildStarfield(radius: number): void {
    this.starfield.removeChildren();
    const extent = (radius + 2) * HEX_SIZE * 1.6;
    let seed = 1234567;
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 1400; i++) {
      const sp = new Sprite(this.tex.dot);
      sp.anchor.set(0.5);
      sp.position.set((rnd() * 2 - 1) * extent, (rnd() * 2 - 1) * extent);
      const size = 3 + rnd() * rnd() * 12;
      sp.width = size; sp.height = size;
      sp.alpha = 0.25 + rnd() * 0.6;
      sp.tint = [0xffffff, 0xcfe4ff, 0xffe6c7, 0xd8d0ff][Math.floor(rnd() * 4)]!;
      this.starfield.addChild(sp);
    }
  }

  private drawFog(v: PlayerView): void {
    const g = this.fogLayer;
    g.clear();
    const visible = new Set(v.sectors.map((s) => s.key));
    for (const h of hexDisk(v.galaxyRadius)) {
      const key = `${h.q},${h.r}`;
      if (visible.has(key)) continue;
      const c = hexToPixel(h, HEX_SIZE);
      hexPath(g, c.x, c.y, HEX_SIZE * 0.985);
      g.fill({ color: 0x090d1a, alpha: 0.82 });
      g.stroke({ color: 0x141c33, width: 3, alpha: 0.9 });
    }
  }

  private drawSectors(v: PlayerView): void {
    const g = this.sectorLayer;
    g.clear();
    this.nebulaLayer.removeChildren();
    this.holeLayer.removeChildren();
    this.rings = [];
    for (const s of v.sectors) {
      const c = hexToPixel({ q: s.q, r: s.r }, HEX_SIZE);
      hexPath(g, c.x, c.y, HEX_SIZE * 0.985);
      g.fill({ color: 0x0b1226, alpha: 0.55 });
      g.stroke({ color: 0x2c3a66, width: 3, alpha: 0.9 });
      s.nebulae.forEach((n, i) => {
        const hue = (s.q * 53 + s.r * 97 + i * 41) % 3;
        const tint = [0x5a4bd6, 0x2a8f9d, 0x8a46c9][hue]!;
        for (let k = 0; k < 2; k++) {
          const sp = new Sprite(nebulaTexture(1 + ((s.q + 20) * 31 + (s.r + 20) * 7 + i * 3 + k) % 9));
          sp.anchor.set(0.5);
          sp.position.set(n.x + (k ? n.r * 0.2 : 0), n.y - (k ? n.r * 0.15 : 0));
          sp.width = n.r * 2.7; sp.height = n.r * 2.7;
          sp.rotation = (s.q + i + k) * 0.7;
          sp.tint = tint;
          sp.alpha = 0.42;
          sp.blendMode = 'add';
          this.nebulaLayer.addChild(sp);
        }
      });
      for (const b of s.blackHoles) {
        const ring = new Sprite(this.tex.ring);
        ring.anchor.set(0.5); ring.position.set(b.x, b.y);
        ring.width = b.r * 5.2; ring.height = b.r * 5.2; ring.tint = 0xffa060; ring.alpha = 0.85; ring.blendMode = 'add';
        ring.rotation = (b.x * 0.01) % Math.PI;
        this.holeLayer.addChild(ring);
        this.rings.push(ring);
        const halo = new Sprite(this.tex.glow);
        halo.anchor.set(0.5); halo.position.set(b.x, b.y); halo.width = b.r * 6; halo.height = b.r * 6; halo.tint = 0x000000; halo.alpha = 0.9;
        this.holeLayer.addChild(halo);
        const core = new Graphics(); core.circle(b.x, b.y, b.r); core.fill({ color: 0x000000 }); core.stroke({ color: 0xffb27a, width: 2, alpha: 0.5 });
        this.holeLayer.addChild(core);
      }
    }
  }

  private drawRelays(v: PlayerView): void {
    const glow = this.relayGlow, g = this.relayLayer;
    glow.clear(); g.clear();
    this.pulseLayer.removeChildren();
    this.pulses = [];
    for (const r of v.relays) {
      const a = this.systemById.get(r.a), b = this.systemById.get(r.b);
      if (!a || !b) continue;
      const mine = r.owner === v.me.id;
      const color = mine ? SIGNAL : FACTION_COLOR[this.factionOf.get(r.owner) ?? ''] ?? 0x8899aa;
      if (r.cut) { dashed(g, a.x, a.y, b.x, b.y, 16, 12, { color: DANGER, width: 4, alpha: 0.9 }); continue; }
      if (!r.ready) { dashed(g, a.x, a.y, b.x, b.y, 6, 10, { color, width: 3, alpha: 0.55 }); continue; }
      glow.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: r.bridge && mine ? BRIDGE : color, width: mine ? 18 : 10, alpha: mine ? 0.10 : 0.06 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color, width: mine ? 3.5 : 2.5, alpha: mine ? 0.95 : 0.6 });
      if (mine || this.isAlly(v, r.owner)) this.addPulses(r, a, b, color);
    }
    if (this.linkFrom && this.selected && this.linkFrom !== this.selected) {
      const a = this.systemById.get(this.linkFrom), b = this.systemById.get(this.selected);
      if (a && b) dashed(g, a.x, a.y, b.x, b.y, 12, 10, { color: 0xffffff, width: 3, alpha: 0.85 });
    }
  }

  private isAlly(v: PlayerView, colonyId: string): boolean {
    return v.colonies.find((c) => c.id === colonyId)?.ally ?? false;
  }

  private addPulses(r: RelayView, a: SystemView, b: SystemView, color: number): void {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.round(len / 220));
    for (let i = 0; i < count; i++) {
      const sp = new Sprite(this.tex.pulse);
      sp.anchor.set(0.5); sp.width = 22; sp.height = 22; sp.tint = color; sp.alpha = 0.9; sp.blendMode = 'add';
      this.pulseLayer.addChild(sp);
      this.pulses.push({ sprite: sp, ax: a.x, ay: a.y, bx: b.x, by: b.y, t: (i / count + (r.id.length % 7) / 7) % 1, speed: 0.00035 * (220 / Math.max(120, len)) });
    }
  }

  private drawSystems(v: PlayerView): void {
    this.systemLayer.removeChildren();
    this.labelLayer.removeChildren();
    const style = new TextStyle({ fill: 0xe6ecf7, fontSize: 34, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '600', letterSpacing: 1, stroke: { color: 0x05070f, width: 6 } });
    const small = new TextStyle({ fill: 0x9fb0d0, fontSize: 26, fontFamily: 'Rajdhani, system-ui, sans-serif', stroke: { color: 0x05070f, width: 5 } });
    for (const s of v.systems) {
      const node = new Container();
      node.position.set(s.x, s.y);
      const base = 10 + s.slots * 3;
      const color = RESOURCE_COLOR[s.resource] ?? 0xffffff;
      const owned = !!s.owner;
      const mine = s.owner === v.me.id;

      // Connected systems breathe with the Signal; others are quiet.
      const halo = new Sprite(this.tex.glow);
      halo.anchor.set(0.5); halo.tint = s.connected ? SIGNAL : color; halo.blendMode = 'add';
      halo.width = halo.height = base * (s.connected ? 9 : 5); halo.alpha = s.connected ? 0.55 : 0.28;
      node.addChild(halo);

      if (s.kind === 'beacon') {
        const star = new Graphics();
        star.star(0, 0, 7, base * 2.6, base * 1.3, 0);
        star.fill({ color: s.lit ? 0xffd166 : 0x39456b, alpha: s.lit ? 0.95 : 0.8 });
        star.stroke({ color: s.lit ? 0xfff2c2 : 0x5a6a9a, width: 2 });
        node.addChild(star);
        if (s.lit) { const bl = new Sprite(this.tex.glow); bl.anchor.set(0.5); bl.tint = 0xffd166; bl.blendMode = 'add'; bl.width = bl.height = base * 14; bl.alpha = 0.5; node.addChildAt(bl, 0); }
      }
      if (s.kind === 'pulsar') {
        const rays = new Graphics();
        for (let i = 0; i < 2; i++) { const a = i * Math.PI / 2 + 0.5; rays.moveTo(Math.cos(a) * base * 1.4, Math.sin(a) * base * 1.4).lineTo(Math.cos(a) * base * 3.2, Math.sin(a) * base * 3.2); rays.moveTo(-Math.cos(a) * base * 1.4, -Math.sin(a) * base * 1.4).lineTo(-Math.cos(a) * base * 3.2, -Math.sin(a) * base * 3.2); }
        rays.stroke({ color: 0xffffff, width: 2.5, alpha: 0.85 });
        node.addChild(rays);
      }

      const core = new Sprite(this.tex.core);
      core.anchor.set(0.5); core.width = core.height = base * 2.3; core.tint = STAR_TINT[s.resource] ?? 0xffffff;
      node.addChild(core);
      const inner = new Sprite(this.tex.core);
      inner.anchor.set(0.5); inner.width = inner.height = base * 1.3; inner.tint = color;
      node.addChild(inner);

      if (owned) {
        const fc = FACTION_COLOR[this.factionOf.get(s.owner!) ?? ''] ?? 0xffffff;
        const ring = new Graphics();
        ring.circle(0, 0, base + 9); ring.stroke({ color: fc, width: mine ? 4 : 2.5, alpha: 0.95 });
        if (mine && s.id === v.me.capital) { ring.circle(0, 0, base + 15); ring.stroke({ color: fc, width: 1.5, alpha: 0.7 }); }
        node.addChild(ring);
      }
      if (s.blockadedBy) { const bl = new Graphics(); bl.circle(0, 0, base + 20); bl.stroke({ color: DANGER, width: 4, alpha: 0.9 }); node.addChild(bl); }

      // Resource glyph, so the map reads without a legend.
      const glyph = new Sprite(glyphTexture(s.resource));
      glyph.anchor.set(0.5); glyph.width = glyph.height = 20; glyph.tint = color; glyph.alpha = 0.95;
      glyph.position.set(base + 14, base + 10);
      const badge = new Graphics(); badge.circle(base + 14, base + 10, 13); badge.fill({ color: 0x05070f, alpha: 0.85 }); badge.stroke({ color, width: 1.5, alpha: 0.8 });
      node.addChild(badge, glyph);

      if (s.id === this.linkFrom) { const lf = new Graphics(); lf.circle(0, 0, base + 30); lf.stroke({ color: SIGNAL, width: 3 }); node.addChild(lf); }
      if (this.linkFrom && this.linkFrom !== s.id) {
        const cand = v.linkTargets[this.linkFrom]?.find((c) => c.to === s.id);
        if (cand) {
          const ok = new Graphics(); ok.circle(0, 0, base + 22); ok.stroke({ color: 0x7ee2a8, width: 3, alpha: 0.95 }); node.addChild(ok);
          const cost = new Text({ text: `${cand.metal}⬡ ${cand.energy}⚡`, style: new TextStyle({ fill: 0x7ee2a8, fontSize: 24, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '600', stroke: { color: 0x05070f, width: 5 } }) });
          cost.anchor.set(0.5, 1); cost.position.set(0, -base - 24); node.addChild(cost);
        } else {
          node.alpha = 0.45;
        }
      }

      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.hitArea = { contains: (x: number, y: number) => Math.hypot(x, y) <= base + 34 };
      node.on('pointertap', () => { if (!this.dragMoved) this.cb.onSelect(s.id); });
      this.systemLayer.addChild(node);

      const label = new Text({ text: s.name, style: mine || s.kind === 'beacon' || s.id === this.selected ? style : small });
      label.anchor.set(0.5, 0);
      label.position.set(s.x, s.y + base + 24);
      (label as Text & { lod: number }).lod = mine || s.kind === 'beacon' || s.id === this.selected ? 0 : owned ? 0.4 : 0.6;
      this.labelLayer.addChild(label);
    }
  }

  private drawFleets(v: PlayerView): void {
    this.fleetLayer.removeChildren();
    this.ships = [];
    for (const f of v.fleets) {
      const mine = f.owner === v.me.id;
      const color = mine ? 0xffffff : FACTION_COLOR[this.factionOf.get(f.owner) ?? ''] ?? DANGER;
      const sp = new Sprite(this.tex.ship);
      sp.anchor.set(0.5); sp.tint = color; sp.width = sp.height = 44 + Math.min(30, f.size);
      if (f.at) {
        const s = this.systemById.get(f.at);
        if (!s) continue;
        sp.position.set(s.x + 34, s.y - 34); sp.rotation = -Math.PI / 4;
        this.fleetLayer.addChild(sp);
        if (f.order === 'blockade') { const ring = new Graphics(); ring.circle(s.x, s.y, 46); ring.stroke({ color: DANGER, width: 2, alpha: 0.8 }); this.fleetLayer.addChild(ring); }
      } else {
        const from = f.from ? this.systemById.get(f.from) : undefined;
        const to = f.destination ? this.systemById.get(f.destination) : undefined;
        if (!to) continue;
        const fx = from?.x ?? to.x, fy = from?.y ?? to.y;
        sp.rotation = Math.atan2(to.y - fy, to.x - fx);
        this.fleetLayer.addChild(sp);
        const trail = new Graphics(); dashed(trail, fx, fy, to.x, to.y, 6, 14, { color, width: 1.5, alpha: 0.35 }); this.fleetLayer.addChildAt(trail, 0);
        this.ships.push({ sprite: sp, fromX: fx, fromY: fy, toX: to.x, toY: to.y, departAt: f.departAt, arriveAt: f.arriveAt });
      }
    }
  }

  private animate(dtMs: number): void {
    if (!this.view) return;
    for (const p of this.pulses) {
      p.t = (p.t + p.speed * dtMs) % 1;
      p.sprite.position.set(p.ax + (p.bx - p.ax) * p.t, p.ay + (p.by - p.ay) * p.t);
      p.sprite.alpha = 0.4 + 0.6 * Math.sin(p.t * Math.PI);
    }
    const now = this.simNow();
    for (const s of this.ships) {
      const span = Math.max(1, s.arriveAt - s.departAt);
      const t = Math.min(1, Math.max(0, (now - s.departAt) / span));
      s.sprite.position.set(s.fromX + (s.toX - s.fromX) * t, s.fromY + (s.toY - s.fromY) * t);
    }
    for (const r of this.rings) r.rotation += dtMs * 0.00008;
    const sel = this.selected ? this.systemById.get(this.selected) : undefined;
    this.reticle.clear();
    if (sel) {
      const base = 10 + sel.slots * 3 + 28;
      const a0 = (performance.now() / 900) % (Math.PI * 2);
      for (let i = 0; i < 3; i++) { this.reticle.arc(sel.x, sel.y, base, a0 + i * (Math.PI * 2 / 3), a0 + i * (Math.PI * 2 / 3) + 1.1); this.reticle.stroke({ color: 0xffffff, width: 2.5, alpha: 0.9 }); }
    }
    const k = this.world.scale.x;
    if (Math.abs(k - this.lastLabelScale) > 0.01) {
      this.lastLabelScale = k;
      for (const child of this.labelLayer.children) { const lod = (child as Text & { lod: number }).lod ?? 0; child.visible = k >= lod; child.scale.set(Math.min(1.6, 0.5 / k)); }
      this.starfield.alpha = Math.min(1, 0.4 + k);
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
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', (e) => { if (!this.dragMoved && e.target === this.app.stage) this.cb.onSelect(null); });
  }

  private zoomAt(cx: number, cy: number, factor: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = cx - rect.left, sy = cy - rect.top;
    const k0 = this.world.scale.x;
    const k1 = Math.min(1.8, Math.max(0.05, k0 * factor));
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
  if (len === 0) return;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e);
  }
  g.stroke(stroke);
}
