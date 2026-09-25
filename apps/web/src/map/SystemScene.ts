// The System view: one plateau seen from above, StarCraft-readable. The star and its
// station-relais at the centre, three orbits of structures, fleets moving on the plateau,
// turret arcs and shots while an engagement runs. Rebuilt from each SystemDetailView frame
// (2 Hz); the ticker only interpolates ships, spins the decor and flickers the fire.
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type { SystemDetailView } from '@aurane/sim';
import { FACTION_COLOR, RESOURCE_COLOR } from './GalaxyMap.js';
import { cargoTexture, coreTexture, glowTexture, shipTexture, stationTexture, structureTexture } from './textures.js';
import { hasSprite, lightsFrame, loadSprites, spriteFrame, spriteRadius } from './sprites.js';
import { PlanetFilter, planetTypeFor, type PlanetType } from './PlanetFilter.js';

export type SceneSelection =
  | { kind: 'structure'; id: string }
  | { kind: 'fleet'; id: string }
  | { kind: 'station' }
  | { kind: 'slot'; orbit: 1 | 2 | 3; angle: number }
  | { kind: 'poi'; id: string }
  | null;
type PoiView = SystemDetailView['pois'][number];
interface LaneShip { node: Container; ax: number; ay: number; bx: number; by: number; departAt: number; arriveAt: number }

export interface SceneCallbacks { onSelect(sel: SceneSelection): void }
export interface SceneContext { me: string; allies: Set<string>; factionOf: Map<string, string> }

interface FleetAnim { node: Container; fromX: number; fromY: number; toX: number; toY: number; t0: number }
interface Shot { x1: number; y1: number; x2: number; y2: number; color: number; phase: number; heavy: boolean; shielded: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; ttl: number; size: number; color: number; kind: 'spark' | 'debris' | 'trail' | 'flash' }

const SIGNAL = 0x7dd3fc;
const DANGER = 0xff5252;
const ORBIT_TINT = [0x3a4a7a, 0x4a3a5a, 0x2f4a5a];

export class SystemScene {
  readonly app = new Application();
  private root = new Container();
  private plateau = new Container();     // rotates slowly (decor) except in combat
  private bg = new Container();
  private rings = new Graphics();
  private slots = new Container();
  private structures = new Container();
  private stationLayer = new Container();
  private fleets = new Container();
  private fx = new Graphics();
  private reticle = new Graphics();
  private orbitLabels = new Container();
  private view: SystemDetailView | null = null;
  private ctx: SceneContext | null = null;
  private selection: SceneSelection = null;
  private unit = 60;
  private spin = 0;
  private anims = new Map<string, FleetAnim>();
  private labels: Text[] = [];
  private shots: Shot[] = [];
  private particles: Particle[] = [];
  private lastAnimPos = new Map<string, { x: number; y: number }>();
  private ready = false;
  private tex!: { glow: Texture; core: Texture; ship: Texture; cargo: Texture; station: Texture };
  private lastFrameAt = 0;
  private planet: PlanetFilter | null = null;
  private planetKey = '';
  private planetSprite: Sprite | null = null;
  /** The station sits in orbit beside the planet (the plateau's centre in the simulation). */
  private static readonly STATION_VIS = { r: 1.15, a: 325 };
  /** Point of interest whose plateau is shown; null shows the system map. */
  private focus: string | null = null;
  /** A planned in-system route to preview on the map (POI ids, in order). */
  private route: string[] = [];
  private mapUnit = 30;
  private laneShips: LaneShip[] = [];
  private mapPlanets: PlanetFilter[] = [];
  private mapLayer = new Container();
  private mapFx = new Graphics();
  private mapPulse: Graphics[] = [];
  // Camera: pan and zoom over the plateau or the map (pointer drag, wheel, pinch).
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private dragMoved = false;
  private centre = { x: 0, y: 0 };

  /** Orbit captions, set by the UI in the player's language. */
  orbitNames: string[] = ['I', 'II', 'III'];

  constructor(private readonly cb: SceneCallbacks) {}

  async mount(el: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: el, background: 0x04060d, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    el.appendChild(this.app.canvas);
    this.tex = { glow: glowTexture(), core: coreTexture(), ship: shipTexture(), cargo: cargoTexture(), station: stationTexture() };
    this.plateau.addChild(this.bg, this.rings, this.slots, this.structures, this.stationLayer, this.fleets, this.fx, this.reticle);
    this.root.addChild(this.plateau, this.orbitLabels, this.mapLayer, this.mapFx);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', (e) => { if (e.target === this.app.stage && !this.dragMoved) this.cb.onSelect(null); });
    this.bindCamera(this.app.canvas);
    this.app.ticker.add((tk) => this.animate(tk.deltaMS));
    this.app.renderer.on('resize', () => this.layout());
    this.ready = true;
    this.layout();
    if (this.view && this.ctx) this.render(this.view, this.ctx);
    void loadSprites().then(() => { if (this.ready && this.view && this.ctx) this.render(this.view, this.ctx); });
  }

  /** Removes the canvas and frees this scene's GPU objects. `releaseGlobalResources` stays off: with `true` Pixi
   *  empties pools shared by every renderer on the page (the batch pool among them), and the other scene's next
   *  frame crashes on a destroyed batch, which left the galaxy black after leaving a system. */
  destroy(): void { this.app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true }); }

  private stationXY(): { x: number; y: number } { return this.xy(SystemScene.STATION_VIS.r, SystemScene.STATION_VIS.a); }

  /** A pre-rendered model at a heading, with its faction lights; null when the sheet is not loaded. */
  private spriteNode(kind: string, heading: number, size: number, tint: number, alpha = 1): Container | null {
    const b = spriteFrame(kind, heading), l = lightsFrame(kind, heading);
    if (!b || !l) return null;
    const node = new Container();
    const shadow = new Sprite(this.tex.glow);
    shadow.anchor.set(0.5); shadow.tint = 0x000000; shadow.alpha = 0.45 * alpha; shadow.width = size * 1.3; shadow.height = size * 0.9; shadow.position.set(size * 0.04, size * 0.1);
    const base = new Sprite(b); base.anchor.set(0.5); base.width = base.height = size; base.alpha = alpha;
    const lights = new Sprite(l); lights.anchor.set(0.5); lights.width = lights.height = size; lights.tint = tint; lights.blendMode = 'add'; lights.alpha = alpha;
    const glow = new Sprite(l); glow.anchor.set(0.5); glow.width = glow.height = size * 1.06; glow.tint = tint; glow.blendMode = 'add'; glow.alpha = 0.5 * alpha;
    node.addChild(shadow, base, glow, lights);
    return node;
  }

  setSelection(sel: SceneSelection): void { this.selection = sel; }

  /** Show one point of interest's plateau, or the whole system map (null). */
  setFocus(poi: string | null): void {
    if (this.focus === poi) return;
    this.focus = poi;
    this.resetCamera();
    this.anims.clear(); this.lastAnimPos.clear(); this.particles = []; this.shots = [];
    if (this.ready && this.view && this.ctx) this.render(this.view, this.ctx);
  }
  get focused(): string | null { return this.focus; }

  /** Preview an in-system route on the map (empty to clear). */
  setRoute(pois: string[]): void {
    this.route = pois;
    if (this.ready && this.view && this.ctx && this.focus === null) this.render(this.view, this.ctx);
  }

  update(view: SystemDetailView, ctx: SceneContext): void {
    this.view = view; this.ctx = ctx;
    this.lastFrameAt = performance.now();
    if (this.ready) this.render(view, ctx);
  }

  private topInset: number | null = null;
  private bottomInset: number | null = null;
  /** Heights of the title bar and of the dock that overlay the scene, measured by the view; the layout keeps them free
   *  and the plateau grows when the dock is short. */
  setInsets(top: number, bottom: number): void {
    const t = Math.round(top) + 8, b = Math.round(bottom);
    if (t === this.topInset && b === this.bottomInset) return;
    this.topInset = t; this.bottomInset = b;
    if (this.ready) this.layout();
  }

  private layout(): void {
    const w = this.app.screen.width, h = this.app.screen.height;
    const narrow = w < 700;
    const top = this.topInset ?? (narrow ? 150 : 100); // the title bar overlays the top of the scene
    const bottom = narrow ? this.bottomInset ?? h * 0.46 : 0; // on phones the dock overlays the bottom of the scene
    const free = h - top - bottom;
    this.unit = Math.max(22, Math.min(w / 2 / 4.6, free / 2 / 4.5));
    this.mapUnit = Math.max(10, Math.min(w / 2 / 10.2, free / 2 / 10.2));
    this.centre = { x: w / 2, y: top + free / 2 };
    this.applyCamera();
  }

  private applyCamera(): void {
    this.root.scale.set(this.zoom);
    this.root.position.set(this.centre.x + this.pan.x, this.centre.y + this.pan.y);
  }

  /** Back to the whole view, centred. */
  resetCamera(): void { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.applyCamera(); }

  private zoomAt(cx: number, cy: number, factor: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = cx - rect.left, sy = cy - rect.top;
    const k0 = this.zoom;
    const k1 = Math.min(4, Math.max(0.6, k0 * factor));
    // Keep the point under the cursor still.
    const wx = (sx - this.root.position.x) / k0, wy = (sy - this.root.position.y) / k0;
    this.zoom = k1;
    this.pan = { x: sx - wx * k1 - this.centre.x, y: sy - wy * k1 - this.centre.y };
    this.applyCamera();
  }

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
        if (this.dragMoved) { this.pan.x += dx; this.pan.y += dy; this.applyCamera(); }
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
    canvas.addEventListener('dblclick', () => this.resetCamera());
  }

  /** The view narrowed to the focused point of interest, so the plateau code stays one-plateau. */
  private focusedView(v: SystemDetailView): { view: SystemDetailView; poi: PoiView | null } {
    const poi = v.pois.find((p) => p.id === this.focus) ?? v.pois.find((p) => p.id === v.mainPoi) ?? null;
    if (!poi) return { view: v, poi: null };
    const view: SystemDetailView = {
      ...v,
      structures: poi.structures, station: poi.station, orbitSlots: poi.orbitSlots, shield: poi.shield, battle: poi.battle, engaged: poi.engaged,
      fleets: v.fleets.filter((f) => f.poi === poi.id),
      buildQueue: v.buildQueue ? v.buildQueue.filter((j) => j.poi === poi.id) : null,
      blockade: poi.id === v.mainPoi ? v.blockade : null,
    };
    return { view, poi };
  }

  private mapXY(p: { x: number; y: number }): { x: number; y: number } { return { x: p.x * this.mapUnit, y: p.y * this.mapUnit }; }

  private static planetTypeForPoi(p: PoiView, resource: string): PlanetType | null {
    switch (p.kind) {
      case 'rocky': return resource === 'energy' ? (p.hue % 2 ? 'lava' : 'desert') : p.hue % 3 === 0 ? 'ocean' : p.hue % 3 === 1 ? 'rocky' : 'desert';
      case 'gas': return 'gas';
      case 'moon': return p.hue % 2 ? 'ice' : 'rocky';
      case 'ice': return 'ice';
      default: return null;
    }
  }

  /** Polar (orbit units, degrees) → scene pixels. */
  private xy(r: number, a: number): { x: number; y: number } {
    const rad = (a * Math.PI) / 180;
    return { x: r * this.unit * Math.cos(rad), y: r * this.unit * Math.sin(rad) };
  }

  // --- rendering -----------------------------------------------------------

  private render(v0: SystemDetailView, ctx: SceneContext): void {
    if (this.focus === null) {
      this.plateau.visible = false; this.orbitLabels.visible = false; this.mapLayer.visible = true; this.mapFx.visible = true;
      this.renderMap(v0, ctx);
      return;
    }
    this.plateau.visible = true; this.orbitLabels.visible = true; this.mapLayer.visible = false; this.mapFx.visible = false;
    this.mapFx.clear(); this.laneShips = []; this.mapPulse = [];
    const { view: v, poi } = this.focusedView(v0);
    this.drawBackground(v, poi);
    this.drawRings(v, poi);
    this.drawSlots(v);
    this.drawStructures(v, ctx);
    this.drawStation(v, ctx);
    this.drawFleets(v, ctx);
    this.planShots(v, ctx);
  }

  // --- the system map ---------------------------------------------------------

  private renderMap(v: SystemDetailView, ctx: SceneContext): void {
    this.mapLayer.removeChildren();
    this.mapPlanets = [];
    this.laneShips = [];
    this.mapPulse = [];
    this.labels = [];
    const u = this.mapUnit;
    const color = RESOURCE_COLOR[v.resource] ?? 0xffffff;
    const ownerColor = v.owner ? (v.owner === ctx.me ? SIGNAL : FACTION_COLOR[ctx.factionOf.get(v.owner) ?? ''] ?? 0xaaaaaa) : 0x8899aa;
    // The star at the centre of the map.
    const corona = new Sprite(this.tex.glow); corona.anchor.set(0.5); corona.tint = color; corona.blendMode = 'add'; corona.alpha = 0.55; corona.width = corona.height = u * 7;
    const star = new Sprite(this.tex.core); star.anchor.set(0.5); star.tint = 0xffffff; star.width = star.height = u * 1.3;
    const halo = new Sprite(this.tex.glow); halo.anchor.set(0.5); halo.tint = v.engaged ? DANGER : SIGNAL; halo.blendMode = 'add'; halo.alpha = v.engaged ? 0.12 : 0.06; halo.width = halo.height = u * 22;
    this.mapLayer.addChild(halo, corona, star);
    // Faint orbit guides and the rim.
    const guides = new Graphics();
    for (const r of [2.6, 4.4, 6.4]) { guides.circle(0, 0, r * u); guides.stroke({ color: 0x1c2744, width: 1, alpha: 0.8 }); }
    guides.circle(0, 0, 8.6 * u); guides.stroke({ color: 0x27345a, width: 1.5, alpha: 0.9 });
    this.mapLayer.addChild(guides);
    // Lanes.
    const lanes = new Graphics();
    const byId = new Map(v.pois.map((p) => [p.id, p]));
    for (const l of v.lanes) {
      const a = byId.get(l.a), b = byId.get(l.b);
      if (!a || !b) continue;
      const pa = this.mapXY(a), pb = this.mapXY(b);
      const jumpLane = a.kind === 'jump' || b.kind === 'jump';
      lanes.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y);
      lanes.stroke({ color: jumpLane ? 0xffb060 : v.mine || v.allied ? SIGNAL : 0x6f7fa8, width: jumpLane ? 1.5 : 2, alpha: jumpLane ? 0.45 : 0.35 });
    }
    this.mapLayer.addChild(lanes);
    // Route of the selected (or any moving) friendly fleet: its remaining hops.
    const routeG = new Graphics();
    for (const f of v.fleets) {
      if (f.owner !== ctx.me || !f.hop) continue;
      const a = byId.get(f.hop.from), b = byId.get(f.hop.to);
      if (a && b) { const pa = this.mapXY(a), pb = this.mapXY(b); routeG.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y); routeG.stroke({ color: 0xffffff, width: 2.5, alpha: 0.5 }); }
    }
    // Planned route preview: a bright dashed line with arrowheads.
    for (let i = 0; i + 1 < this.route.length; i++) {
      const a = byId.get(this.route[i]!), b = byId.get(this.route[i + 1]!);
      if (!a || !b) continue;
      const pa = this.mapXY(a), pb = this.mapXY(b);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y); const ux = (pb.x - pa.x) / len, uy = (pb.y - pa.y) / len;
      for (let d = 0; d < len; d += 14) { const e = Math.min(len, d + 8); routeG.moveTo(pa.x + ux * d, pa.y + uy * d).lineTo(pa.x + ux * e, pa.y + uy * e); }
      routeG.stroke({ color: 0xffffff, width: 2.5, alpha: 0.85 });
      const mx = pa.x + ux * len * 0.55, my = pa.y + uy * len * 0.55;
      routeG.moveTo(mx + ux * 7, my + uy * 7).lineTo(mx - ux * 5 - uy * 6, my - uy * 5 + ux * 6).lineTo(mx - ux * 5 + uy * 6, my - uy * 5 - ux * 6).closePath();
      routeG.fill({ color: 0xffffff, alpha: 0.9 });
    }
    this.mapLayer.addChild(routeG);
    // Points of interest.
    for (const p of v.pois) {
      const node = new Container();
      const pos = this.mapXY(p);
      node.position.set(pos.x, pos.y);
      const R = u * (p.kind === 'gas' ? 0.95 : p.kind === 'rocky' ? 0.7 : p.kind === 'moon' ? 0.36 : p.kind === 'derelict' ? 0.55 : 0.65) * (0.8 + p.size * 0.12);
      if (!p.known) {
        const q = new Graphics(); q.circle(0, 0, R * 0.9); q.stroke({ color: 0xffb060, width: 1.5, alpha: 0.7 });
        for (let i = 0; i < 8; i++) { const a0 = (i / 8) * Math.PI * 2; q.arc(0, 0, R * 1.25, a0, a0 + 0.35); q.stroke({ color: 0xffb060, width: 1.5, alpha: 0.5 }); }
        node.addChild(q);
        const t = new Text({ text: '?', style: new TextStyle({ fill: 0xffb060, fontSize: Math.max(12, R), fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '700' }) });
        t.anchor.set(0.5); node.addChild(t); this.labels.push(t);
      } else if (p.kind === 'jump') {
        const g = new Graphics();
        g.moveTo(0, -R * 0.8).lineTo(R * 0.8, 0).lineTo(0, R * 0.8).lineTo(-R * 0.8, 0).closePath();
        g.stroke({ color: 0xffb060, width: 2, alpha: 0.95 });
        g.moveTo(0, -R * 0.4).lineTo(R * 0.4, 0).lineTo(0, R * 0.4).lineTo(-R * 0.4, 0).closePath(); g.fill({ color: 0xffb060, alpha: 0.5 });
        node.addChild(g);
        const glow = new Sprite(this.tex.glow); glow.anchor.set(0.5); glow.tint = 0xffb060; glow.blendMode = 'add'; glow.alpha = 0.35; glow.width = glow.height = R * 4; node.addChildAt(glow, 0);
      } else if (p.kind === 'belt') {
        const g = new Graphics();
        let seed = p.hue * 131 + 7;
        const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        for (let i = 0; i < 46; i++) { const a = rnd() * Math.PI * 2, rr = R * (0.55 + rnd() * 0.9); g.circle(Math.cos(a) * rr, Math.sin(a) * rr * 0.55, 1 + rnd() * 2.6); g.fill({ color: [0x8a93a6, 0x6e7688, 0xa8b0c0][i % 3]!, alpha: 0.9 }); }
        node.addChild(g);
      } else if (p.kind === 'nebula') {
        const n = new Sprite(this.tex.glow); n.anchor.set(0.5); n.tint = p.hue % 2 ? 0x8a46c9 : 0x2a8f9d; n.blendMode = 'add'; n.alpha = 0.55; n.width = n.height = R * 4.2; node.addChild(n);
        const n2 = new Sprite(this.tex.glow); n2.anchor.set(0.5); n2.tint = 0x5a4bd6; n2.blendMode = 'add'; n2.alpha = 0.35; n2.width = R * 3; n2.height = R * 2; n2.rotation = 0.6; node.addChild(n2);
      } else if (p.kind === 'wreck' || p.kind === 'derelict') {
        const model = hasSprite(p.kind) ? this.spriteNode(p.kind, (p.hue * Math.PI) / 180, R * 2.4, 0xffb060, 0.95) : null;
        if (model) node.addChild(model);
        else { const g = new Graphics(); g.circle(0, 0, R * 0.6); g.stroke({ color: 0x8a93a6, width: 2 }); node.addChild(g); }
      } else {
        const type = SystemScene.planetTypeForPoi(p, v.resource);
        if (type) {
          const pf = new PlanetFilter(type, (p.hue % 97) * 0.37 + 1.3 + p.x, { ring: type === 'gas' && p.size === 3 });
          pf.padding = 0;
          const sp = new Sprite(Texture.WHITE); sp.anchor.set(0.5); sp.width = sp.height = R * 2 * (1 + 2 * pf.padFraction); sp.filters = [pf];
          node.addChild(sp); this.mapPlanets.push(pf);
        }
      }
      // What stands here: owner ring, station, structure count, engagement, fleets.
      if (p.known && p.kind !== 'jump') {
        if (p.structures.length || p.station) { const ring = new Graphics(); ring.circle(0, 0, R * 1.35); ring.stroke({ color: ownerColor, width: p.main ? 2.5 : 1.5, alpha: 0.9 }); node.addChild(ring); }
        if (p.station) {
          const sm = hasSprite('station') ? this.spriteNode('station', 0, R * 1.1, p.station.hp > 0 ? ownerColor : 0x444a55, p.station.hp > 0 ? 1 : 0.5) : null;
          if (sm) { sm.position.set(R * 1.15, -R * 0.9); node.addChild(sm); }
        }
        const relay = p.structures.find((x) => x.kind === 'relay');
        if (relay) { const rm = hasSprite('relay') ? this.spriteNode('relay', 0, R * 0.9, ownerColor) : null; if (rm) { rm.position.set(R * 1.1, -R * 0.8); node.addChild(rm); } }
        const guns = p.structures.filter((x) => x.armed).length;
        if (p.structures.length) {
          const badge = new Text({ text: `${p.structures.length}${guns ? ` ⚔${guns}` : ''}`, style: new TextStyle({ fill: 0xe6ecf7, fontSize: 12, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '700', stroke: { color: 0x04060d, width: 4 } }) });
          badge.anchor.set(0.5, 0); badge.position.set(0, R * 1.4); node.addChild(badge); this.labels.push(badge);
        }
        if (p.engaged) { const eg = new Graphics(); eg.circle(0, 0, R * 1.7); eg.stroke({ color: DANGER, width: 3, alpha: 0.9 }); node.addChild(eg); this.mapPulse.push(eg); }
        if (p.shield) { const sh = new Graphics(); sh.circle(0, 0, R * 1.55); sh.stroke({ color: SIGNAL, width: 1.5, alpha: 0.6 }); node.addChild(sh); }
      }
      // Designation.
      const name = new Text({ text: p.kind === 'jump' ? p.designation : p.designation.toUpperCase(), style: new TextStyle({ fill: p.main ? 0xffffff : 0x9fb0d0, fontSize: p.main ? 14 : 12, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '600', letterSpacing: 1, stroke: { color: 0x04060d, width: 4 } }) });
      name.anchor.set(0.5, 1); name.position.set(0, -R * 1.45); node.addChild(name); this.labels.push(name);
      if (this.selection?.kind === 'poi' && this.selection.id === p.id) { const r = new Graphics(); r.circle(0, 0, R * 1.9); r.stroke({ color: 0xffffff, width: 2 }); node.addChild(r); }
      node.eventMode = 'static'; node.cursor = 'pointer';
      node.hitArea = { contains: (x: number, y: number) => Math.hypot(x, y) <= Math.max(R * 1.6, u * 0.9) };
      node.on('pointertap', () => { if (!this.dragMoved) this.cb.onSelect({ kind: 'poi', id: p.id }); });
      this.mapLayer.addChild(node);
    }
    // Fleets: clustered at their point of interest, or gliding along a lane.
    const atPoi = new Map<string, number>();
    for (const f of v.fleets) {
      const mine = f.owner === ctx.me;
      const color = mine ? 0xffffff : ctx.allies.has(f.owner) ? 0x7ee2a8 : FACTION_COLOR[ctx.factionOf.get(f.owner) ?? ''] ?? DANGER;
      const cargoOnly = f.combat === 0 && f.size > 0;
      const kind = cargoOnly ? 'cargo' : f.units ? (f.units.cruiser > 0 ? 'cruiser' : f.units.frigate >= f.units.corvette ? 'frigate' : 'corvette') : f.size >= 6 ? 'cruiser' : 'frigate';
      const size = u * (cargoOnly ? 0.7 : 0.85) * (1 + Math.log2(1 + f.size) * 0.1);
      let heading = 0;
      let pos: { x: number; y: number } | null = null;
      let lane: LaneShip | null = null;
      if (f.hop) {
        const a = byId.get(f.hop.from), b = byId.get(f.hop.to);
        if (!a || !b) continue;
        const pa = this.mapXY(a), pb = this.mapXY(b);
        heading = Math.atan2(pb.y - pa.y, pb.x - pa.x);
        const t = Math.min(1, Math.max(0, (v.time - f.hop.departAt) / Math.max(1, f.hop.arriveAt - f.hop.departAt)));
        pos = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
        lane = { node: new Container(), ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, departAt: f.hop.departAt, arriveAt: f.hop.arriveAt };
      } else if (f.poi) {
        const p = byId.get(f.poi);
        if (!p) continue;
        const n = atPoi.get(f.poi) ?? 0; atPoi.set(f.poi, n + 1);
        const a = 2.3 + n * 0.7 + (mine ? 0 : Math.PI);
        const c = this.mapXY(p);
        const R = u * 1.6;
        pos = { x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R };
        heading = Math.atan2(c.y - pos.y, c.x - pos.x);
      }
      if (!pos) continue;
      const node = lane ? lane.node : new Container();
      node.position.set(pos.x, pos.y);
      const model = hasSprite(kind) ? this.spriteNode(kind, heading, size, color, f.docked ? 0.75 : 1) : null;
      if (model) node.addChild(model);
      else { const g = new Graphics(); g.moveTo(size / 2, 0).lineTo(-size / 2, size / 3).lineTo(-size / 2, -size / 3).closePath(); g.fill({ color }); g.rotation = heading; node.addChild(g); }
      const label = new Text({ text: String(f.size), style: new TextStyle({ fill: color, fontSize: 12, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '700', stroke: { color: 0x04060d, width: 4 } }) });
      label.anchor.set(0.5); label.position.set(size * 0.55, -size * 0.5); node.addChild(label); this.labels.push(label);
      if (f.order === 'blockade' || f.order === 'raid' || f.order === 'ambush') { const r = new Graphics(); r.circle(0, 0, size * 0.6); r.stroke({ color: DANGER, width: 1.5, alpha: 0.8 }); node.addChild(r); }
      if (this.selection?.kind === 'fleet' && this.selection.id === f.id) { const r = new Graphics(); r.circle(0, 0, size * 0.7); r.stroke({ color: 0xffffff, width: 2 }); node.addChild(r); }
      node.eventMode = 'static'; node.cursor = 'pointer';
      node.hitArea = { contains: (x: number, y: number) => Math.hypot(x, y) <= size * 0.7 };
      node.on('pointertap', () => { if (!this.dragMoved) this.cb.onSelect({ kind: 'fleet', id: f.id }); });
      if (lane) this.laneShips.push(lane);
      this.mapLayer.addChild(node);
    }
    // Inbound fleets on the rim near their jump point.
    for (const inb of v.inbound) {
      const mine = inb.owner === ctx.me;
      const color = mine ? 0xffffff : ctx.allies.has(inb.owner) ? 0x7ee2a8 : FACTION_COLOR[ctx.factionOf.get(inb.owner) ?? ''] ?? DANGER;
      const jp = byId.get(v.jumps[0] ?? '');
      const a = jp ? Math.atan2(jp.y, jp.x) + ((inb.id.charCodeAt(1) % 7) - 3) * 0.08 : 0;
      const p = { x: Math.cos(a) * 9.4 * u, y: Math.sin(a) * 9.4 * u };
      const label = new Text({ text: `${inb.convoy ? '▭' : '➤'} ${Math.ceil(Math.max(0, inb.arriveAt - v.time) / 60)}'`, style: new TextStyle({ fill: color, fontSize: 12, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '600', stroke: { color: 0x04060d, width: 4 } }) });
      label.anchor.set(0.5); label.position.set(p.x, p.y); this.mapLayer.addChild(label); this.labels.push(label);
    }
  }

  private drawBackground(v: SystemDetailView, poi: PoiView | null): void {
    this.bg.removeChildren();
    this.planetSprite = null;
    const color = RESOURCE_COLOR[v.resource] ?? 0xffffff;
    // The star, far off to the upper left: it lights the planet from that side.
    const sx = -this.unit * 5.2, sy = -this.unit * 3.9;
    const corona = new Sprite(this.tex.glow);
    corona.anchor.set(0.5); corona.tint = color; corona.blendMode = 'add'; corona.alpha = 0.5;
    corona.width = corona.height = this.unit * 9; corona.position.set(sx, sy);
    const star = new Sprite(this.tex.core);
    star.anchor.set(0.5); star.tint = 0xffffff; star.width = star.height = this.unit * 1.6; star.position.set(sx, sy);
    const tint = new Sprite(this.tex.glow);
    tint.anchor.set(0.5); tint.tint = v.engaged ? DANGER : SIGNAL; tint.blendMode = 'add'; tint.alpha = v.engaged ? 0.16 : 0.08;
    tint.width = tint.height = this.unit * 9.6;
    this.bg.addChild(corona, star, tint);
    // The body this plateau orbits: a planet drawn by shader, or a belt, a wreck, a derelict station.
    const type = poi ? SystemScene.planetTypeForPoi(poi, v.resource) : planetTypeFor(v.resource, v.hue);
    if (type) {
      const key = `${v.id}:${poi?.id ?? ''}:${type}`;
      const seed = ((poi?.hue ?? v.hue) % 97) * 0.37 + 1.3 + (poi?.x ?? 0);
      if (this.planetKey !== key || !this.planet) { this.planet = new PlanetFilter(type, seed, { ring: type === 'gas' && (poi?.size ?? 3) === 3 }); this.planetKey = key; }
      const R = this.unit * (poi?.kind === 'moon' ? 0.4 : poi?.kind === 'gas' ? 0.8 : 0.64);
      const pad = this.planet.padFraction;
      const sprite = new Sprite(Texture.WHITE);
      sprite.anchor.set(0.5); sprite.width = sprite.height = R * 2 * (1 + 2 * pad);
      sprite.filters = [this.planet];
      this.planet.padding = 0;
      this.planetSprite = sprite;
      this.bg.addChild(sprite);
    } else if (poi?.kind === 'belt') {
      const g = new Graphics();
      let seed = poi.hue * 131 + 7;
      const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < 90; i++) { const a = rnd() * Math.PI * 2, rr = this.unit * (0.2 + rnd() * 0.7); g.circle(Math.cos(a) * rr, Math.sin(a) * rr * 0.7, 1.5 + rnd() * 4); g.fill({ color: [0x8a93a6, 0x6e7688, 0xa8b0c0][i % 3]!, alpha: 0.9 }); }
      this.bg.addChild(g);
    } else if (poi && (poi.kind === 'wreck' || poi.kind === 'derelict')) {
      const model = this.spriteNode(poi.kind, (poi.hue * Math.PI) / 180, this.unit * (poi.kind === 'wreck' ? 1.9 : 2.3), 0xffb060, 1);
      if (model) this.bg.addChild(model);
    } else if (poi?.kind === 'nebula') {
      // A nebula pocket has no body and no slot: a soft cloud, so the plateau is not an empty ring.
      const n = new Sprite(this.tex.glow); n.anchor.set(0.5); n.tint = poi.hue % 2 ? 0x8a46c9 : 0x2a8f9d; n.blendMode = 'add'; n.alpha = 0.5; n.width = n.height = this.unit * 4.6; this.bg.addChild(n);
      const n2 = new Sprite(this.tex.glow); n2.anchor.set(0.5); n2.tint = 0x5a4bd6; n2.blendMode = 'add'; n2.alpha = 0.35; n2.width = this.unit * 3.4; n2.height = this.unit * 2.2; n2.rotation = 0.6; this.bg.addChild(n2);
    }
    // Plateau edge: where fleets arrive.
    const edge = new Graphics();
    edge.circle(0, 0, v.plateauRadius * this.unit);
    edge.stroke({ color: 0x223055, width: 1.5, alpha: 0.9 });
    for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; const r0 = v.plateauRadius * this.unit, r1 = r0 + (i % 3 === 0 ? 10 : 5); edge.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * r1, Math.sin(a) * r1); }
    edge.stroke({ color: 0x2f3f6a, width: 1.5, alpha: 0.7 });
    this.bg.addChild(edge);
  }

  private drawRings(v: SystemDetailView, poi: PoiView | null): void {
    const g = this.rings;
    g.clear();
    this.orbitLabels.removeChildren();
    if (poi && poi.orbitSlots.every((n) => n === 0)) return; // nothing to build here: no Defence / Industry rings
    const orbits = v.orbitSlots[2] > 0 ? 3 : 2;
    const names = this.orbitNames;
    for (let o = 1; o <= orbits; o++) {
      const label = new Text({ text: names[o - 1] ?? '', style: new TextStyle({ fill: 0x7f90bf, fontSize: 12, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '600', letterSpacing: 2 }) });
      label.anchor.set(0.5, 1);
      label.position.set(0, -o * this.unit - 4);
      this.orbitLabels.addChild(label);
    }
    for (let o = 1; o <= orbits; o++) {
      g.circle(0, 0, o * this.unit);
      g.stroke({ color: ORBIT_TINT[o - 1]!, width: o === 2 ? 2.5 : 1.5, alpha: 0.9 });
      // Faint band so the ring reads as a zone, not a line.
      g.circle(0, 0, o * this.unit);
      g.stroke({ color: ORBIT_TINT[o - 1]!, width: 18, alpha: 0.06 });
    }
    if (v.shield) {
      const b = v.structures.find((s) => s.kind === 'bastion');
      if (b) { const p = this.xy(b.orbit, b.angle); g.circle(p.x, p.y, (b.range ?? 2) * this.unit); g.fill({ color: SIGNAL, alpha: 0.05 }); g.stroke({ color: SIGNAL, width: 1.5, alpha: 0.5 }); }
    }
  }

  private drawSlots(v: SystemDetailView): void {
    this.slots.removeChildren();
    for (let o = 1 as 1 | 2 | 3; o <= 3; o = (o + 1) as 1 | 2 | 3) {
      const cap = v.orbitSlots[o - 1]!;
      if (!cap) continue;
      for (let i = 0; i < cap; i++) {
        const angle = Math.round((360 / cap) * i + 30 * (o - 1)) % 360;
        const taken = v.structures.some((s) => s.orbit === o && Math.abs(((s.angle - angle + 540) % 360) - 180) < 1) || (v.buildQueue ?? []).some((j) => j.orbit === o) && false;
        if (taken) continue;
        const p = this.xy(o, angle);
        const g = new Graphics();
        g.circle(0, 0, this.unit * 0.3);
        g.stroke({ color: 0x4a5f96, width: 1.5, alpha: 0.9 });
        g.moveTo(-6, 0).lineTo(6, 0).moveTo(0, -6).lineTo(0, 6); g.stroke({ color: 0x3d4f80, width: 1.5, alpha: 0.9 });
        g.position.set(p.x, p.y);
        if (v.mine) {
          g.eventMode = 'static'; g.cursor = 'pointer';
          g.hitArea = { contains: (x: number, y: number) => Math.hypot(x, y) <= this.unit * 0.3 };
          g.on('pointertap', () => { if (!this.dragMoved) this.cb.onSelect({ kind: 'slot', orbit: o, angle }); });
        }
        this.slots.addChild(g);
      }
    }
    // Queued builds show as ghost markers on their orbit.
    for (const j of v.buildQueue ?? []) {
      const p = this.xy(j.orbit, 0);
      const ghost = new Sprite(structureTexture(j.building));
      ghost.anchor.set(0.5); ghost.tint = SIGNAL; ghost.alpha = 0.35; ghost.width = ghost.height = this.unit * 0.55;
      ghost.position.set(p.x, p.y); ghost.rotation = Math.PI / 2;
      this.slots.addChild(ghost);
    }
  }

  private drawStructures(v: SystemDetailView, ctx: SceneContext): void {
    this.structures.removeChildren();
    const ownerColor = v.owner ? (v.owner === ctx.me ? SIGNAL : FACTION_COLOR[ctx.factionOf.get(v.owner) ?? ''] ?? 0xaaaaaa) : 0x8899aa;
    for (const s of v.structures) {
      const node = new Container();
      const p = this.xy(s.orbit, s.angle);
      node.position.set(p.x, p.y);
      const selected = this.selection?.kind === 'structure' && this.selection.id === s.id;
      if (s.armed && s.range) {
        const arc = new Graphics();
        arc.circle(0, 0, s.range * this.unit);
        arc.fill({ color: v.engaged ? DANGER : ownerColor, alpha: selected ? 0.06 : v.engaged ? 0.025 : 0.015 });
        arc.stroke({ color: v.engaged ? DANGER : ownerColor, width: 1, alpha: selected ? 0.7 : v.engaged ? 0.3 : 0.15 });
        node.addChild(arc);
      }
      const heading = (s.angle * Math.PI) / 180; // faces outward, away from the planet
      const size = this.unit * Math.min(1.35, Math.max(0.7, 0.36 * spriteRadius(s.kind)));
      const model = hasSprite(s.kind) ? this.spriteNode(s.kind, heading, size, ownerColor) : null;
      if (model) {
        if (selected) { const ring = new Graphics(); ring.circle(0, 0, size * 0.55); ring.stroke({ color: 0xffffff, width: 2, alpha: 0.9 }); node.addChild(ring); }
        if (s.hp < s.maxHp * 0.35) { const fire = new Sprite(this.tex.glow); fire.anchor.set(0.5); fire.tint = DANGER; fire.blendMode = 'add'; fire.width = fire.height = size; fire.alpha = 0.6; node.addChild(fire); }
        node.addChild(model);
      } else {
        const pad = new Graphics();
        pad.circle(0, 0, this.unit * 0.4); pad.fill({ color: 0x0a1020, alpha: 0.9 }); pad.stroke({ color: ownerColor, width: selected ? 3 : 1.5, alpha: selected ? 1 : 0.8 });
        node.addChild(pad);
        const sp = new Sprite(structureTexture(s.kind));
        sp.anchor.set(0.5); sp.tint = s.hp < s.maxHp * 0.35 ? DANGER : 0xe8eefc; sp.width = sp.height = this.unit * 0.62;
        sp.rotation = heading + Math.PI / 2;
        node.addChild(sp);
      }
      if (s.hp < s.maxHp) node.addChild(this.hpBar(s.hp / s.maxHp, this.unit * 0.6, this.unit * 0.42));
      node.eventMode = 'static'; node.cursor = 'pointer';
      node.hitArea = { contains: (x: number, y: number) => Math.hypot(x, y) <= this.unit * 0.46 };
      node.on('pointertap', () => { if (!this.dragMoved) this.cb.onSelect({ kind: 'structure', id: s.id }); });
      this.structures.addChild(node);
    }
  }

  private drawStation(v: SystemDetailView, ctx: SceneContext): void {
    this.stationLayer.removeChildren();
    if (!v.station || !v.owner) return;
    const color = v.owner === ctx.me ? SIGNAL : FACTION_COLOR[ctx.factionOf.get(v.owner) ?? ''] ?? 0xaaaaaa;
    const node = new Container();
    const pos = this.stationXY();
    node.position.set(pos.x, pos.y);
    const down = v.station.hp <= 0;
    const size = this.unit * 2.1;
    const model = hasSprite('station') ? this.spriteNode('station', (SystemScene.STATION_VIS.a * Math.PI) / 180, size, down ? 0x444a55 : color, down ? 0.55 : 1) : null;
    if (model) {
      node.addChild(model);
      if (down) { const fire = new Sprite(this.tex.glow); fire.anchor.set(0.5); fire.tint = DANGER; fire.blendMode = 'add'; fire.width = fire.height = size * 0.8; fire.alpha = 0.5; node.addChild(fire); }
    } else {
      const halo = new Sprite(this.tex.glow);
      halo.anchor.set(0.5); halo.tint = down ? DANGER : color; halo.blendMode = 'add'; halo.alpha = down ? 0.25 : 0.5; halo.width = halo.height = this.unit * 1.8;
      const sp = new Sprite(this.tex.station);
      sp.anchor.set(0.5); sp.tint = down ? 0x66707f : 0xf2f6ff; sp.width = sp.height = this.unit * 1.1; sp.alpha = down ? 0.6 : 1;
      node.addChild(halo, sp);
    }
    if (this.selection?.kind === 'station') { const ring = new Graphics(); ring.circle(0, 0, size * 0.5); ring.stroke({ color: 0xffffff, width: 2, alpha: 0.9 }); node.addChild(ring); }
    // Station HP as an arc around the hub.
    const frac = Math.max(0, v.station.hp / v.station.maxHp);
    const arc = new Graphics();
    arc.arc(0, 0, size * 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    arc.stroke({ color: frac < 0.35 ? DANGER : frac < 0.7 ? 0xffd166 : 0x7ee2a8, width: 3, alpha: 0.95 });
    node.addChild(arc);
    node.eventMode = 'static'; node.cursor = 'pointer';
    node.hitArea = { contains: (x: number, y: number) => Math.hypot(x, y) <= size * 0.5 };
    node.on('pointertap', () => { if (!this.dragMoved) this.cb.onSelect({ kind: 'station' }); });
    this.stationLayer.addChild(node);
  }

  private drawFleets(v: SystemDetailView, ctx: SceneContext): void {
    this.fleets.removeChildren();
    this.labels = [];
    const seen = new Set<string>();
    const now = performance.now();
    let dockIdx = 0;
    for (const f of v.fleets) {
      const mine = f.owner === ctx.me;
      const ally = ctx.allies.has(f.owner);
      const color = mine ? 0xffffff : ally ? 0x7ee2a8 : FACTION_COLOR[ctx.factionOf.get(f.owner) ?? ''] ?? DANGER;
      const node = new Container();
      let target: { x: number; y: number };
      if (f.pos) target = this.xy(f.pos.r, f.pos.a);
      else { // docked: parked in a bay beside the station
        const a = 250 + dockIdx * 30; dockIdx++;
        const st = this.stationXY();
        target = { x: st.x + Math.cos((a * Math.PI) / 180) * this.unit * 0.95, y: st.y + Math.sin((a * Math.PI) / 180) * this.unit * 0.95 };
      }
      const prev = this.anims.get(f.id);
      const from = prev ? { x: prev.node.position.x, y: prev.node.position.y } : target;
      node.position.set(from.x, from.y);
      this.anims.set(f.id, { node, fromX: from.x, fromY: from.y, toX: target.x, toY: target.y, t0: now });
      seen.add(f.id);

      const cargoOnly = f.combat === 0 && f.size > 0;
      const heading = f.pos ? Math.atan2(-target.y, -target.x) : Math.PI; // nose toward the planet, or parked
      const kind = cargoOnly ? 'cargo' : f.units ? (f.units.cruiser > 0 ? 'cruiser' : f.units.frigate >= f.units.corvette ? 'frigate' : 'corvette') : f.size >= 6 ? 'cruiser' : 'frigate';
      const size = this.unit * Math.min(1.3, (cargoOnly ? 0.5 : kind === 'cruiser' ? 0.95 : kind === 'frigate' ? 0.68 : 0.52) * (1 + Math.log2(1 + f.size) * 0.12));
      const model = hasSprite(kind) ? this.spriteNode(kind, heading, size, color, f.docked ? 0.7 : 1) : null;
      if (model) {
        if (!cargoOnly && f.size > 1) { // wingmen: a couple of smaller silhouettes behind
          const wing = Math.min(2, Math.floor(f.size / 3));
          for (let i = 0; i < wing; i++) { const w = this.spriteNode(kind, heading, size * 0.7, color, 0.8)!; const side = i === 0 ? 1 : -1; w.position.set(-Math.cos(heading) * size * 0.45 + Math.sin(heading) * side * size * 0.42, -Math.sin(heading) * size * 0.45 - Math.cos(heading) * side * size * 0.42); node.addChild(w); }
        }
        node.addChild(model);
      } else {
        const tex = cargoOnly ? this.tex.cargo : this.tex.ship;
        const count = Math.min(5, Math.max(1, Math.ceil(f.size / 2)));
        for (let i = 0; i < count; i++) {
          const sp = new Sprite(tex);
          sp.anchor.set(0.5); sp.tint = color; sp.width = sp.height = this.unit * (cargoOnly ? 0.32 : 0.4);
          const spread = (i - (count - 1) / 2) * this.unit * 0.16;
          sp.position.set(-spread * 0.4, spread);
          sp.rotation = heading;
          sp.alpha = f.docked ? 0.6 : 1;
          node.addChild(sp);
        }
      }
      if (f.hp < 1) node.addChild(this.hpBar(f.hp, this.unit * 0.5, this.unit * 0.36));
      const label = new Text({ text: String(f.size), style: new TextStyle({ fill: color, fontSize: 13, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '700', stroke: { color: 0x04060d, width: 4 } }) });
      label.anchor.set(0.5); label.position.set(this.unit * 0.3, -this.unit * 0.3);
      node.addChild(label);
      this.labels.push(label);
      const selected = this.selection?.kind === 'fleet' && this.selection.id === f.id;
      if (selected) { const r = new Graphics(); r.circle(0, 0, this.unit * 0.42); r.stroke({ color: 0xffffff, width: 2 }); node.addChild(r); }
      if (f.order === 'blockade' || f.order === 'raid' || f.order === 'ambush') { const r = new Graphics(); r.circle(0, 0, this.unit * 0.36); r.stroke({ color: DANGER, width: 1.5, alpha: 0.8 }); node.addChild(r); }
      node.eventMode = 'static'; node.cursor = 'pointer';
      node.hitArea = { contains: (x: number, y: number) => Math.hypot(x, y) <= this.unit * 0.45 };
      node.on('pointertap', () => { if (!this.dragMoved) this.cb.onSelect({ kind: 'fleet', id: f.id }); });
      this.fleets.addChild(node);
    }
    for (const id of [...this.anims.keys()]) if (!seen.has(id)) {
      const a = this.anims.get(id)!;
      if (v.engaged) this.burst(a.node.position.x, a.node.position.y, 26, 0xffb060);
      this.anims.delete(id);
    }
    // Inbound fleets sit just outside the edge, on their approach bearing.
    for (const inb of v.inbound) {
      const mine = inb.owner === ctx.me;
      const color = mine ? 0xffffff : ctx.allies.has(inb.owner) ? 0x7ee2a8 : FACTION_COLOR[ctx.factionOf.get(inb.owner) ?? ''] ?? DANGER;
      const a = (inb.id.charCodeAt(1) * 37 + inb.id.length * 91) % 360;
      const p = this.xy(v.plateauRadius + 0.35, a);
      const g = new Graphics();
      g.moveTo(0, -8).lineTo(6, 6).lineTo(-6, 6).closePath(); g.fill({ color, alpha: 0.9 });
      g.position.set(p.x, p.y); g.rotation = (a * Math.PI) / 180 - Math.PI / 2;
      this.fleets.addChild(g);
      const eta = Math.max(0, inb.arriveAt - v.time);
      const label = new Text({ text: `${inb.convoy ? '▭' : '➤'} ${Math.ceil(eta / 60)}'`, style: new TextStyle({ fill: color, fontSize: 12, fontFamily: 'Rajdhani, system-ui, sans-serif', fontWeight: '600', stroke: { color: 0x04060d, width: 4 } }) });
      label.anchor.set(0.5); label.position.set(p.x * 1.08, p.y * 1.08);
      this.fleets.addChild(label);
      this.labels.push(label);
    }
  }

  private hpBar(frac: number, width: number, dy: number): Graphics {
    const g = new Graphics();
    g.rect(-width / 2, dy, width, 4); g.fill({ color: 0x000000, alpha: 0.7 });
    g.rect(-width / 2, dy, width * Math.max(0, Math.min(1, frac)), 4); g.fill({ color: frac < 0.35 ? DANGER : frac < 0.7 ? 0xffd166 : 0x7ee2a8 });
    return g;
  }

  /** Who shoots whom, approximated client-side from positions: enough for the eye, the sim decides the rest. */
  private planShots(v: SystemDetailView, ctx: SceneContext): void {
    this.shots = [];
    if (!v.engaged) return;
    const hostileToSystem = (owner: string): boolean => v.owner !== null && owner !== v.owner && !(v.mine && ctx.allies.has(owner));
    const attackers = v.fleets.filter((f) => f.pos && f.combat > 0 && hostileToSystem(f.owner));
    const defenders = v.fleets.filter((f) => f.pos && f.combat > 0 && !hostileToSystem(f.owner));
    const colorOf = (owner: string): number => owner === ctx.me ? 0xbfefff : FACTION_COLOR[ctx.factionOf.get(owner) ?? ''] ?? DANGER;
    const pos = (f: { pos: { r: number; a: number } | null }): { x: number; y: number } => this.xy(f.pos!.r, f.pos!.a);
    const nearest = <T>(from: { x: number; y: number }, list: T[], at: (t: T) => { x: number; y: number }, maxDist: number): T | null => {
      let best: T | null = null, bd = maxDist;
      for (const t of list) { const p = at(t); const d = Math.hypot(p.x - from.x, p.y - from.y); if (d <= bd) { bd = d; best = t; } }
      return best;
    };
    const R = 1.7 * this.unit;
    const bastions = v.shield ? v.structures.filter((s) => s.kind === 'bastion').map((s) => ({ p: this.xy(s.orbit, s.angle), r: (s.range ?? 2) * this.unit })) : [];
    const shieldedAt = (p: { x: number; y: number }): boolean => bastions.some((b) => Math.hypot(p.x - b.p.x, p.y - b.p.y) <= b.r);
    for (const f of attackers) {
      const me = pos(f);
      const targets: { x: number; y: number }[] = [
        ...defenders.map(pos),
        ...v.structures.map((s) => this.xy(s.orbit, s.angle)),
        ...(v.station && v.station.hp > 0 ? [this.stationXY()] : []),
      ];
      const t = nearest(me, targets, (p) => p, R);
      if (t) this.shots.push({ x1: me.x, y1: me.y, x2: t.x, y2: t.y, color: colorOf(f.owner), phase: Math.random() * Math.PI * 2, heavy: f.size >= 6, shielded: shieldedAt(t) });
    }
    for (const f of defenders) {
      const me = pos(f);
      const t = nearest(me, attackers.map(pos), (p) => p, R);
      if (t) this.shots.push({ x1: me.x, y1: me.y, x2: t.x, y2: t.y, color: colorOf(f.owner), phase: Math.random() * Math.PI * 2, heavy: f.size >= 6, shielded: false });
    }
    for (const s of v.structures) {
      if (!s.armed || !s.range) continue;
      const me = this.xy(s.orbit, s.angle);
      const t = nearest(me, attackers.map(pos), (p) => p, s.range * this.unit);
      if (t) this.shots.push({ x1: me.x, y1: me.y, x2: t.x, y2: t.y, color: 0xffd166, phase: Math.random() * Math.PI * 2, heavy: s.kind === 'turret_heavy', shielded: false });
    }
  }

  private spawn(p: Omit<Particle, 'life'>): void { if (this.particles.length < 600) this.particles.push({ ...p, life: 0 }); }
  private burst(x: number, y: number, n: number, color: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.02 + Math.random() * 0.08) * this.unit;
      this.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 500 + Math.random() * 700, size: 1.5 + Math.random() * 3, color: Math.random() < 0.5 ? color : 0x8a93a6, kind: Math.random() < 0.5 ? 'spark' : 'debris' });
    }
    this.spawn({ x, y, vx: 0, vy: 0, ttl: 260, size: this.unit * 0.5, color: 0xffffff, kind: 'flash' });
  }

  private animate(dtMs: number): void {
    if (!this.view) return;
    const now = performance.now();
    // Labels keep a readable screen size whatever the zoom (they grow only a little up close).
    const ls = Math.pow(this.zoom, -0.85);
    for (const l of this.labels) l.scale.set(ls);
    for (const l of this.orbitLabels.children) l.scale.set(ls);
    if (this.focus === null) {
      // System map: planets turn, ships glide along their lanes, engaged bodies pulse.
      for (const pf of this.mapPlanets) pf.time = now / 1000;
      const simNow = this.view.time + (now - this.lastFrameAt) / 1000;
      for (const s of this.laneShips) {
        const t = Math.min(1, Math.max(0, (simNow - s.departAt) / Math.max(1, s.arriveAt - s.departAt)));
        s.node.position.set(s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t);
      }
      const pulse = 0.55 + 0.45 * Math.sin(now / 180);
      for (const g of this.mapPulse) g.alpha = pulse;
      this.reticle.clear();
      return;
    }
    // Decor rotation: very slow, stopped during a fight.
    if (!this.view.engaged) this.spin += dtMs * 0.000012;
    this.plateau.rotation = this.spin;
    if (this.planet) this.planet.time = now / 1000;
    if (this.planetSprite) this.planetSprite.rotation = -this.spin; // the shader's light stays with the star
    for (const l of this.labels) l.rotation = -this.spin;
    // Ships glide between frames (the stream is 2 Hz).
    for (const a of this.anims.values()) {
      const t = Math.min(1, (now - a.t0) / 520);
      const e = 1 - (1 - t) * (1 - t);
      a.node.position.set(a.fromX + (a.toX - a.fromX) * e, a.fromY + (a.toY - a.fromY) * e);
    }
    // Engine trails behind ships that are moving on the plateau.
    for (const [id, a] of this.anims) {
      const prev = this.lastAnimPos.get(id);
      const cur = { x: a.node.position.x, y: a.node.position.y };
      if (prev) {
        const dx = cur.x - prev.x, dy = cur.y - prev.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.15 && Math.random() < 0.6) this.spawn({ x: cur.x - dx * 6, y: cur.y - dy * 6, vx: -dx * 0.15 + (Math.random() - 0.5) * 0.3, vy: -dy * 0.15 + (Math.random() - 0.5) * 0.3, ttl: 500, size: 2 + Math.random() * 2.5, color: 0x9fd8ff, kind: 'trail' });
      }
      this.lastAnimPos.set(id, cur);
    }
    for (const id of [...this.lastAnimPos.keys()]) if (!this.anims.has(id)) this.lastAnimPos.delete(id);
    // Fire.
    const g = this.fx;
    g.clear();
    if (this.view.engaged) {
      const tt = now / 1000;
      for (const s of this.shots) {
        const on = (Math.sin(tt * (s.heavy ? 5 : 11) + s.phase) + 1) / 2;
        if (on < 0.45) continue;
        g.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
        g.stroke({ color: s.color, width: s.heavy ? 2.5 : 1.2, alpha: 0.25 + on * 0.6 });
        g.circle(s.x2, s.y2, 2 + on * 3); g.fill({ color: 0xffffff, alpha: on * 0.8 });
        if (on > 0.92 && Math.random() < 0.5) {
          const ang = Math.atan2(s.y1 - s.y2, s.x1 - s.x2) + (Math.random() - 0.5) * 1.6;
          const sp = (0.03 + Math.random() * 0.06) * this.unit;
          this.spawn({ x: s.x2, y: s.y2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, ttl: 250 + Math.random() * 350, size: 1 + Math.random() * 2, color: s.heavy ? 0xffc27a : 0xffe9b0, kind: 'spark' });
          if (s.shielded) this.spawn({ x: s.x2, y: s.y2, vx: 0, vy: 0, ttl: 220, size: this.unit * 0.42, color: SIGNAL, kind: 'flash' });
        }
      }
    }
    // Particles.
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life += dtMs;
      if (p.life >= p.ttl) continue;
      const k = p.life / p.ttl;
      p.x += p.vx * dtMs / 16; p.y += p.vy * dtMs / 16;
      if (p.kind === 'debris') { p.vx *= 0.985; p.vy *= 0.985; }
      if (p.kind === 'flash') { g.circle(p.x, p.y, p.size * (0.6 + k * 0.6)); g.stroke({ color: p.color, width: 2, alpha: (1 - k) * 0.8 }); g.circle(p.x, p.y, p.size * 0.5 * (1 - k)); g.fill({ color: p.color, alpha: (1 - k) * 0.35 }); }
      else { g.circle(p.x, p.y, p.size * (p.kind === 'trail' ? 1 - k * 0.6 : 1 - k * 0.4)); g.fill({ color: p.color, alpha: (1 - k) * (p.kind === 'trail' ? 0.35 : 0.9) }); }
      alive.push(p);
    }
    this.particles = alive;
    // Selection reticle.
    this.reticle.clear();
    const sel = this.selection;
    if (sel) {
      let p: { x: number; y: number } | null = null, r = this.unit * 0.5;
      if (sel.kind === 'station') { p = this.stationXY(); r = this.unit * 0.8; }
      else if (sel.kind === 'structure') { const s = this.view.structures.find((x) => x.id === sel.id); if (s) p = this.xy(s.orbit, s.angle); }
      else if (sel.kind === 'fleet') { const a = this.anims.get(sel.id); if (a) { p = { x: a.node.position.x, y: a.node.position.y }; r = this.unit * 0.55; } }
      else if (sel.kind === 'slot') { p = this.xy(sel.orbit, sel.angle); r = this.unit * 0.36; }
      if (p) {
        const a0 = (now / 900) % (Math.PI * 2);
        for (let i = 0; i < 3; i++) { this.reticle.arc(p.x, p.y, r, a0 + i * (Math.PI * 2 / 3), a0 + i * (Math.PI * 2 / 3) + 1.1); this.reticle.stroke({ color: 0xffffff, width: 2, alpha: 0.9 }); }
      }
    }
  }
}
