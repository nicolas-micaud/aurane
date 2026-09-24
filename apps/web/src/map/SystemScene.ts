// The System view: one plateau seen from above, StarCraft-readable. The star and its
// station-relais at the centre, three orbits of structures, fleets moving on the plateau,
// turret arcs and shots while an engagement runs. Rebuilt from each SystemDetailView frame
// (2 Hz); the ticker only interpolates ships, spins the decor and flickers the fire.
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type { SystemDetailView } from '@aurane/sim';
import { FACTION_COLOR, RESOURCE_COLOR } from './GalaxyMap.js';
import { cargoTexture, coreTexture, glowTexture, shipTexture, stationTexture, structureTexture } from './textures.js';
import { hasSprite, lightsFrame, loadSprites, spriteFrame, spriteRadius } from './sprites.js';
import { PlanetFilter, planetTypeFor } from './PlanetFilter.js';

export type SceneSelection =
  | { kind: 'structure'; id: string }
  | { kind: 'fleet'; id: string }
  | { kind: 'station' }
  | { kind: 'slot'; orbit: 1 | 2 | 3; angle: number }
  | null;

export interface SceneCallbacks { onSelect(sel: SceneSelection): void }
export interface SceneContext { me: string; allies: Set<string>; factionOf: Map<string, string> }

interface FleetAnim { node: Container; fromX: number; fromY: number; toX: number; toY: number; t0: number }
interface Shot { x1: number; y1: number; x2: number; y2: number; color: number; phase: number; heavy: boolean }

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
  private ready = false;
  private tex!: { glow: Texture; core: Texture; ship: Texture; cargo: Texture; station: Texture };
  private lastFrameAt = 0;
  private planet: PlanetFilter | null = null;
  private planetKey = '';
  private planetSprite: Sprite | null = null;
  /** The station sits in orbit beside the planet (the plateau's centre in the simulation). */
  private static readonly STATION_VIS = { r: 1.15, a: 325 };

  /** Orbit captions, set by the UI in the player's language. */
  orbitNames: string[] = ['I', 'II', 'III'];

  constructor(private readonly cb: SceneCallbacks) {}

  async mount(el: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: el, background: 0x04060d, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    el.appendChild(this.app.canvas);
    this.tex = { glow: glowTexture(), core: coreTexture(), ship: shipTexture(), cargo: cargoTexture(), station: stationTexture() };
    this.plateau.addChild(this.bg, this.rings, this.slots, this.structures, this.stationLayer, this.fleets, this.fx, this.reticle);
    this.root.addChild(this.plateau, this.orbitLabels);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', (e) => { if (e.target === this.app.stage) this.cb.onSelect(null); });
    this.app.ticker.add((tk) => this.animate(tk.deltaMS));
    this.app.renderer.on('resize', () => this.layout());
    this.ready = true;
    this.layout();
    if (this.view && this.ctx) this.render(this.view, this.ctx);
    void loadSprites().then(() => { if (this.ready && this.view && this.ctx) this.render(this.view, this.ctx); });
  }

  destroy(): void { this.app.destroy(true, { children: true }); }

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

  update(view: SystemDetailView, ctx: SceneContext): void {
    this.view = view; this.ctx = ctx;
    this.lastFrameAt = performance.now();
    if (this.ready) this.render(view, ctx);
  }

  private layout(): void {
    const w = this.app.screen.width, h = this.app.screen.height;
    const narrow = w < 700;
    const top = narrow ? 150 : 100; // the title bar overlays the top of the scene
    this.unit = Math.max(22, Math.min(w / 2 / 4.6, (h - top) / 2 / 4.5));
    this.root.position.set(w / 2, top + (h - top) / 2);
  }

  /** Polar (orbit units, degrees) → scene pixels. */
  private xy(r: number, a: number): { x: number; y: number } {
    const rad = (a * Math.PI) / 180;
    return { x: r * this.unit * Math.cos(rad), y: r * this.unit * Math.sin(rad) };
  }

  // --- rendering -----------------------------------------------------------

  private render(v: SystemDetailView, ctx: SceneContext): void {
    this.drawBackground(v);
    this.drawRings(v);
    this.drawSlots(v);
    this.drawStructures(v, ctx);
    this.drawStation(v, ctx);
    this.drawFleets(v, ctx);
    this.planShots(v, ctx);
  }

  private drawBackground(v: SystemDetailView): void {
    this.bg.removeChildren();
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
    // The planet this plateau orbits, drawn by shader.
    const type = planetTypeFor(v.resource, v.hue);
    const key = `${v.id}:${type}`;
    if (this.planetKey !== key || !this.planet) { this.planet = new PlanetFilter(type, (v.hue % 97) * 0.37 + 1.3, { ring: type === 'gas' }); this.planetKey = key; }
    const R = this.unit * 0.64;
    const pad = this.planet.padFraction;
    const sprite = new Sprite(Texture.WHITE);
    sprite.anchor.set(0.5); sprite.width = sprite.height = R * 2 * (1 + 2 * pad);
    sprite.filters = [this.planet];
    this.planet.padding = 0;
    this.planetSprite = sprite;
    this.bg.addChild(sprite);
    // Plateau edge: where fleets arrive.
    const edge = new Graphics();
    edge.circle(0, 0, v.plateauRadius * this.unit);
    edge.stroke({ color: 0x223055, width: 1.5, alpha: 0.9 });
    for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; const r0 = v.plateauRadius * this.unit, r1 = r0 + (i % 3 === 0 ? 10 : 5); edge.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * r1, Math.sin(a) * r1); }
    edge.stroke({ color: 0x2f3f6a, width: 1.5, alpha: 0.7 });
    this.bg.addChild(edge);
  }

  private drawRings(v: SystemDetailView): void {
    const g = this.rings;
    g.clear();
    this.orbitLabels.removeChildren();
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
          g.on('pointertap', () => this.cb.onSelect({ kind: 'slot', orbit: o, angle }));
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
      node.on('pointertap', () => this.cb.onSelect({ kind: 'structure', id: s.id }));
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
    node.on('pointertap', () => this.cb.onSelect({ kind: 'station' }));
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
      node.on('pointertap', () => this.cb.onSelect({ kind: 'fleet', id: f.id }));
      this.fleets.addChild(node);
    }
    for (const id of [...this.anims.keys()]) if (!seen.has(id)) this.anims.delete(id);
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
    for (const f of attackers) {
      const me = pos(f);
      const targets: { x: number; y: number }[] = [
        ...defenders.map(pos),
        ...v.structures.map((s) => this.xy(s.orbit, s.angle)),
        ...(v.station && v.station.hp > 0 ? [this.stationXY()] : []),
      ];
      const t = nearest(me, targets, (p) => p, R);
      if (t) this.shots.push({ x1: me.x, y1: me.y, x2: t.x, y2: t.y, color: colorOf(f.owner), phase: Math.random() * Math.PI * 2, heavy: f.size >= 6 });
    }
    for (const f of defenders) {
      const me = pos(f);
      const t = nearest(me, attackers.map(pos), (p) => p, R);
      if (t) this.shots.push({ x1: me.x, y1: me.y, x2: t.x, y2: t.y, color: colorOf(f.owner), phase: Math.random() * Math.PI * 2, heavy: f.size >= 6 });
    }
    for (const s of v.structures) {
      if (!s.armed || !s.range) continue;
      const me = this.xy(s.orbit, s.angle);
      const t = nearest(me, attackers.map(pos), (p) => p, s.range * this.unit);
      if (t) this.shots.push({ x1: me.x, y1: me.y, x2: t.x, y2: t.y, color: 0xffd166, phase: Math.random() * Math.PI * 2, heavy: s.kind === 'turret_heavy' });
    }
  }

  private animate(dtMs: number): void {
    if (!this.view) return;
    const now = performance.now();
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
      }
      if (now - this.lastFrameAt > 4000) { /* stale frame: keep drawing, the stream will resume */ }
    }
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
