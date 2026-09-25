// System mode: the system map (points of interest joined by lanes) or one body's plateau
// full-screen, with a dock: bodies and probing, per-orbit construction, training, fleets
// present, logistics touching this system and the battle.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { BUILDINGS, UNITS, type Building, type Resource, type UnitType } from '@aurane/protocol';
import { AGENT_COST_INFLUENCE, BUILDING_COST, BUILDING_ORBIT, UNIT_COST, type BattleReport, type PlayerView, type SystemDetailView } from '@aurane/sim';
import { SystemScene, type SceneSelection } from '../map/SystemScene.js';
import { act, fetchBattle, fetchBattles, systemView, watch, type BattleSummary } from '../net.js';
import { t } from '../i18n/index.js';
import { useSig } from './useSig.js';
import { Icon } from './Icon.js';
import { Cost, hms } from './bits.js';

type DockTab = 'plateau' | 'fleets' | 'logistics' | 'battle';
type PoiView = SystemDetailView['pois'][number];
const dockTab = signal<DockTab>('plateau');
const sceneSel = signal<SceneSelection>(null);
/** Body whose plateau is open; null = the system map. */
const focusPoi = signal<string | null>(null);
/** Last fleet of mine picked on the map: orders to a body go to it. */
const pickedFleet = signal<string | null>(null);

/** Shortest lane path inside the system, client side, for previews. */
function pathOnMap(sv: SystemDetailView, from: string, to: string): string[] {
  if (from === to) return [from];
  const dist = new Map<string, number>([[from, 0]]); const prev = new Map<string, string>(); const done = new Set<string>();
  for (;;) {
    let u: string | null = null, du = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < du) { u = k; du = d; }
    if (u === null || u === to) break;
    done.add(u);
    for (const l of sv.lanes) { const v = l.a === u ? l.b : l.b === u ? l.a : null; if (!v) continue; const nd = du + l.seconds; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); } }
  }
  if (!dist.has(to)) return [];
  const out = [to]; for (let v = to; v !== from; v = prev.get(v)!) out.unshift(prev.get(v)!);
  return out;
}
const RES: Resource[] = ['metal', 'energy', 'food', 'crystal', 'rium'];

const POI_LABEL: Record<PoiView['kind'], 'poiRocky' | 'poiGas' | 'poiMoon' | 'poiBelt' | 'poiIce' | 'poiNebula' | 'poiWreck' | 'poiDerelict' | 'poiJump'> = {
  rocky: 'poiRocky', gas: 'poiGas', moon: 'poiMoon', belt: 'poiBelt', ice: 'poiIce', nebula: 'poiNebula', wreck: 'poiWreck', derelict: 'poiDerelict', jump: 'poiJump',
};
const TPL_LABEL: Record<SystemDetailView['template'], 'tplForge' | 'tplOasis' | 'tplCrossroads' | 'tplGraveyard' | 'tplSanctuary' | 'tplLair' | 'tplBurnt'> = {
  forge: 'tplForge', oasis: 'tplOasis', crossroads: 'tplCrossroads', graveyard: 'tplGraveyard', sanctuary: 'tplSanctuary', lair: 'tplLair', burnt: 'tplBurnt',
};
const poiName = (sv: SystemDetailView, p: PoiView): string => (p.kind === 'jump' ? `${t('poiJump')} ${p.designation}` : `${sv.name} ${p.designation}`);

export function SystemMode({ v, systemId, onLeave }: { v: PlayerView; systemId: string; onLeave: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SystemScene | null>(null);
  const sv = useSig(systemView);
  const sel = useSig(sceneSel);
  const focus = useSig(focusPoi);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    watch(systemId);
    sceneSel.value = null;
    focusPoi.value = null;
    dockTab.value = 'plateau';
    const sc = new SystemScene({ onSelect: (s) => {
      if (s?.kind === 'poi') { sceneSel.value = s; dockTab.value = 'plateau'; return; }
      if (s?.kind === 'fleet') { const f = systemView.value?.fleets.find((x) => x.id === s.id); if (f && f.owner === v.me.id) pickedFleet.value = f.id; }
      sceneSel.value = s;
      if (s?.kind === 'fleet') dockTab.value = 'fleets'; else if (s) dockTab.value = 'plateau';
    } });
    sc.orbitNames = [t('orbitShort1').toUpperCase(), t('orbitShort2').toUpperCase(), t('orbitShort3').toUpperCase()];
    scene.current = sc;
    void sc.mount(host.current!).then(() => { if (systemView.value) sc.update(systemView.value, ctxOf(v)); });
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => { cancelAnimationFrame(raf); sc.destroy(); watch(null); };
  }, [systemId]);
  // The title bar wraps differently per phone and the dock is as tall as its content: the scene keeps their real
  // heights free, so a short dock shows more of the plateau. Measured after every render (the dock's content
  // changes with the tab and the selection) and whenever either element resizes.
  const observed = useRef<{ ro: ResizeObserver | null; nodes: HTMLElement[] }>({ ro: null, nodes: [] });
  useEffect(() => {
    const sc = scene.current, root = host.current?.parentElement;
    if (!sc || !root) return;
    const bar = root.querySelector<HTMLElement>('.sysbar'), dock = root.querySelector<HTMLElement>('.dock');
    const measure = (): void => sc.setInsets(bar?.offsetHeight ?? 0, dock?.offsetHeight ?? 0);
    measure();
    const nodes = [bar, dock].filter((n): n is HTMLElement => n !== null);
    const o = observed.current;
    if ('ResizeObserver' in window && (nodes.length !== o.nodes.length || nodes.some((n, i) => n !== o.nodes[i]))) {
      o.ro?.disconnect();
      o.ro = new ResizeObserver(measure);
      for (const n of nodes) o.ro.observe(n);
      o.nodes = nodes;
    }
  });
  useEffect(() => () => { observed.current.ro?.disconnect(); }, []);
  useEffect(() => { if (sv && scene.current) scene.current.update(sv, ctxOf(v)); }, [sv, v]);
  useEffect(() => { scene.current?.setSelection(sel); if (sv && scene.current) scene.current.update(sv, ctxOf(v)); }, [sel]);
  useEffect(() => { scene.current?.setFocus(focus); }, [focus]);
  const picked = useSig(pickedFleet);
  // Route preview: from the picked fleet's body (or the entry jump point) to the selected body.
  useEffect(() => {
    if (!sv || !scene.current) return;
    const target = sel?.kind === 'poi' ? sel.id : null;
    const f = picked ? sv.fleets.find((x) => x.id === picked) : undefined;
    const from = f ? (f.poi ?? f.hop?.to ?? null) : sv.jumps[0] ?? null;
    scene.current.setRoute(target && from && target !== from ? pathOnMap(sv, from, target) : []);
  }, [sel, picked, sv?.id]);
  // A system with a single body goes straight to its plateau.
  useEffect(() => { if (sv && focus === null && sv.pois.filter((p) => p.kind !== 'jump').length === 1) focusPoi.value = sv.mainPoi; }, [sv?.id]);

  const s = v.systems.find((x) => x.id === systemId);
  const fp = sv && focus ? sv.pois.find((p) => p.id === focus) ?? null : null;
  return (
    <div class={`sysmode ${entered ? 'in' : ''}`}>
      <div class="sysmap" ref={host} />
      <div class="sysbar">
        {focus && sv && sv.pois.filter((p) => p.kind !== 'jump').length > 1
          ? <button class="back" onClick={() => { focusPoi.value = null; sceneSel.value = null; }}>‹ {t('systemMap')}</button>
          : <button class="back" onClick={onLeave}>‹ {t('leaveSystem')}</button>}
        <h2>
          <span class={`r-${s?.resource ?? 'metal'}`}><Icon name={s?.resource ?? 'metal'} size={18} /></span> {sv?.name ?? s?.name ?? systemId}
          {fp && <small>· {fp.designation} · {t(POI_LABEL[fp.kind])}</small>}
          {!fp && sv && <small>· {t(TPL_LABEL[sv.template])} · {sv.pois.filter((p) => p.kind !== 'jump').length} {t('bodies')}</small>}
          {sv?.ownerName && <small>· {sv.ownerName}</small>}
          {sv?.signature && <small class="bad">· {t('hiddenOwner')}</small>}
        </h2>
        <button class="back recenter" title={t('recenter')} onClick={() => scene.current?.resetCamera()}>⌖</button>
        {sv && <SystemStatus sv={sv} />}
      </div>
      {sv && <Dock v={v} sv={sv} sel={sel} focus={fp} picked={picked} />}
      {!sv && <div class="dock"><p class="muted">{t('connecting')}</p></div>}
    </div>
  );
}

function ctxOf(v: PlayerView) {
  return { me: v.me.id, allies: new Set(v.colonies.filter((c) => c.ally).map((c) => c.id)), factionOf: new Map(v.colonies.map((c) => [c.id, c.faction])) };
}

function SystemStatus({ sv }: { sv: SystemDetailView }) {
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  return (
    <div class="sysstatus">
      {sv.station && <span class={sv.station.hp <= 0 ? 'bad' : ''}>{t('station')} <b>{Math.round(sv.station.hp)}</b>/{sv.station.maxHp}</span>}
      {sv.engaged && <span class="bad blink">● {t('engaged')}</span>}
      {sv.blockade && <span class="bad">{t('blockadeSince')} · {t('captureIn')} {hms(sv.blockade.captureAt - sv.time)}</span>}
      {sv.shield && <span class="good">{t('shieldActive')} −{Math.round(sv.shield.fraction * 100)} %</span>}
      {sv.stock && sv.capacity !== null && (
        <span class="stocks">
          {RES.map((r) => <span key={r} class={`r-${r}`} title={t(r)}><Icon name={r} size={12} /> {Math.round(sv.stock![r])}<i style={{ width: `${Math.min(100, (sv.stock![r] / sv.capacity!) * 100)}%` }} /></span>)}
          <small>/ {sv.capacity}</small>
        </span>
      )}
      {!sv.visible && <span class="muted">{t('outOfSignal')}</span>}
    </div>
  );
}

function Dock({ v, sv, sel, focus, picked }: { v: PlayerView; sv: SystemDetailView; sel: SceneSelection; focus: PoiView | null; picked: string | null }) {
  const tab = useSig(dockTab);
  const tabs: DockTab[] = ['plateau', 'fleets', 'logistics', 'battle'];
  const labels: Record<DockTab, string> = { plateau: focus ? t('plateau') : t('systemMap'), fleets: t('tabFleets'), logistics: t('tabLogistics'), battle: t('tabBattle') };
  return (
    <div class="dock">
      <div class="tabs">
        {tabs.map((k) => <button key={k} class={tab === k ? 'on' : ''} onClick={() => { dockTab.value = k; }}>{labels[k]}{k === 'battle' && sv.engaged ? <i class="dotn bad" /> : null}</button>)}
      </div>
      <div class="body">
        {tab === 'plateau' && (focus ? <PlateauTab v={v} sv={sv} sel={sel} poi={focus} /> : <MapTab v={v} sv={sv} sel={sel} picked={picked} />)}
        {tab === 'fleets' && <FleetsTab v={v} sv={sv} sel={sel} poi={focus} />}
        {tab === 'logistics' && <LogisticsHere v={v} sv={sv} />}
        {tab === 'battle' && <BattleTab v={v} sv={sv} poi={focus} />}
      </div>
    </div>
  );
}

const ORDER_KEYS = new Set(['move', 'raid', 'blockade', 'defend', 'return', 'ambush', 'convoy', 'idle', 'fleet']);
const orderLabel = (o: string): string => (ORDER_KEYS.has(o) ? t(o as 'move') : o);
const unitLine = (u: { corvette: number; frigate: number; cruiser: number; cargo: number } | null, size: number): string =>
  u ? [u.corvette && `${u.corvette} ${t('corvette')}`, u.frigate && `${u.frigate} ${t('frigate')}`, u.cruiser && `${u.cruiser} ${t('cruiser')}`, u.cargo && `${u.cargo} ${t('cargo')}`].filter(Boolean).join(' · ') : `${size} · ${t('unknownComposition')}`;

/** The system map's list: every body, what stands there, probing. */
function MapTab({ v, sv, sel, picked }: { v: PlayerView; sv: SystemDetailView; sel: SceneSelection; picked: string | null }) {
  const bodies = sv.pois.filter((p) => p.kind !== 'jump');
  const unknown = sv.pois.filter((p) => !p.known).length;
  const canProbe = v.me.influence >= AGENT_COST_INFLUENCE.probe;
  const selected = sel?.kind === 'poi' ? sv.pois.find((p) => p.id === sel.id) ?? null : null;
  const pickedFleetView = picked ? sv.fleets.find((f) => f.id === picked && f.owner === v.me.id) ?? null : null;
  const eta = selected && pickedFleetView ? (() => { const from = pickedFleetView.poi ?? pickedFleetView.hop?.to; if (!from) return 0; const path = pathOnMap(sv, from, selected.id); let s = 0; for (let i = 0; i + 1 < path.length; i++) { const l = sv.lanes.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1])); s += l?.seconds ?? 0; } return sv.mine || sv.allied ? s / 1.5 : s; })() : 0;
  return (
    <div>
      {selected && (
        <div class="selbox">
          <h3>{poiName(sv, selected)} <small>{selected.known ? t(POI_LABEL[selected.kind]) : t('unknownPoi')}</small></h3>
          {selected.known && selected.kind !== 'jump' && <p class="muted">{selected.structures.length} {t('structure').toLowerCase()} · {selected.orbitSlots.join(' / ')} {t('slots').toLowerCase()}{selected.main ? ` · ${t('mainBody')}` : ''}{selected.cover >= 2 ? ` · ${t('probed')}` : ''}{selected.salvage !== null ? ` · ${t('salvage')} ${Math.round(selected.salvage * 100)} %` : ''}{selected.depot !== null ? ` · ${t('depot')} ${selected.depot}` : ''}</p>}
          {pickedFleetView && <p class="muted">{unitLine(pickedFleetView.units, pickedFleetView.size)} → {selected.designation}{eta ? ` · ${hms(eta)}` : ''}</p>}
          <div class="actions">
            {selected.known && selected.kind !== 'jump' && <button class="primary" onClick={() => { focusPoi.value = selected.id; sceneSel.value = null; }}>{t('enterPoi')}</button>}
            <FleetSendButtons v={v} sv={sv} poi={selected} fleetId={pickedFleetView?.id ?? null} />
          </div>
        </div>
      )}
      {(unknown > 0 || sv.signature) && (
        <div class="selbox">
          <h3 class="bad">{t('unknownPoi')} <small>×{unknown}</small></h3>
          <p class="muted">{t('probeDesc')}</p>
          <button class="primary" disabled={!canProbe} onClick={() => void act({ type: 'agent_mission', mission: 'probe', target: sv.id })}>{t('probe')} <small class="r-influence">★ {AGENT_COST_INFLUENCE.probe}</small></button>
        </div>
      )}
      <ul class="list">
        {bodies.map((p) => (
          <li key={p.id} class={sel?.kind === 'poi' && sel.id === p.id ? 'on' : ''} onClick={() => { sceneSel.value = { kind: 'poi', id: p.id }; }}>
            <span><b>{p.designation}</b> {p.known ? t(POI_LABEL[p.kind]) : t('unknownPoi')} {p.main && <span class="tag">{t('mainBody')}</span>} {p.engaged && <span class="bad">● {t('engaged')}</span>}</span>
            <small>{p.known ? `${p.structures.length} ⚙ · ${p.structures.filter((x) => x.armed).length} ⚔${p.station ? ` · ${t('station')} ${Math.round(p.station.hp)}` : ''}` : '?'}</small>
            {p.known && <button onClick={(e) => { e.stopPropagation(); focusPoi.value = p.id; sceneSel.value = null; }}>{t('enterPoi')}</button>}
          </li>
        ))}
      </ul>
      <p class="muted">{t('poiJump')}: {sv.jumps.map((j) => sv.pois.find((p) => p.id === j)?.designation ?? j).join(', ')}</p>
    </div>
  );
}

/** Orders that send an idle fleet of mine to a body: defend/move when the system is friendly, raid/blockade/ambush otherwise. */
function FleetSendButtons({ v, sv, poi, fleetId }: { v: PlayerView; sv: SystemDetailView; poi: PoiView; fleetId: string | null }) {
  const idle = v.fleets.filter((f) => f.owner === v.me.id && f.at !== null && f.order !== 'convoy' && f.combat > 0);
  const here = (fleetId ? idle.find((f) => f.id === fleetId) : undefined) ?? idle.find((f) => f.at === sv.id && f.order === 'idle') ?? idle.find((f) => f.order === 'idle');
  if (!here) return null;
  const target = `${sv.id}:${poi.designation}`;
  const friendly = sv.mine || sv.allied;
  const go = (order: 'defend' | 'blockade' | 'ambush' | 'move'): void => { void act({ type: 'fleet_order', fleet: here.id, order, target }); };
  return (
    <>
      {friendly && poi.kind !== 'jump' && <button onClick={() => go('defend')}>{t('defend')}</button>}
      {poi.kind === 'jump' && <button onClick={() => go(friendly ? 'defend' : 'ambush')}>{friendly ? t('defend') : t('ambush')}</button>}
      {!friendly && sv.owner && poi.kind !== 'jump' && <button onClick={() => go('blockade')}>{t('blockade')}</button>}
      {!friendly && poi.kind !== 'jump' && <button onClick={() => go('ambush')}>{t('ambush')}</button>}
      {poi.kind === 'wreck' && <button onClick={() => go(friendly ? 'defend' : 'ambush')}>{t('salvageHere')}</button>}
      {!friendly && !sv.owner && poi.kind !== 'jump' && poi.kind !== 'wreck' && <button onClick={() => go('move')}>{t('move')}</button>}
      <CargoShuttleButton v={v} sv={sv} poi={poi} />
    </>
  );
}

/** A refinery depot away from the station: park a cargo there and it shuttles the Rium home. */
function CargoShuttleButton({ v, sv, poi }: { v: PlayerView; sv: SystemDetailView; poi: PoiView }) {
  if (!sv.mine || poi.main || !poi.structures.some((s) => s.kind === 'refinery')) return null;
  const cargo = v.fleets.find((f) => f.owner === v.me.id && f.at === sv.id && f.combat === 0 && f.size > 0 && f.order === 'idle')
    ?? v.fleets.find((f) => f.owner === v.me.id && f.at !== null && f.combat === 0 && f.size > 0 && f.order === 'idle');
  if (!cargo) return null;
  return <button onClick={() => void act({ type: 'fleet_order', fleet: cargo.id, order: 'move', target: `${sv.id}:${poi.designation}` })}>{t('shuttleHere')}</button>;
}

function PlateauTab({ v, sv, sel, poi }: { v: PlayerView; sv: SystemDetailView; sel: SceneSelection; poi: PoiView }) {
  const mine = sv.mine;
  const queue = (sv.buildQueue ?? []).filter((j) => j.poi === poi.id);
  const queuedOn = (o: 1 | 2 | 3): number => queue.filter((j) => j.orbit === o).length;
  const freeOn = (o: 1 | 2 | 3): number => poi.orbitSlots[o - 1]! - poi.structures.filter((s) => s.orbit === o).length - queuedOn(o);
  const orbitFilter: (1 | 2 | 3) | null = sel?.kind === 'slot' ? sel.orbit : null;
  const struct = sel?.kind === 'structure' ? poi.structures.find((s) => s.id === sel.id) : null;
  const uniqueSystem: Building[] = ['extractor', 'shipyard', 'bastion', 'tradepost', 'amplifier', 'antenna'];
  return (
    <div>
      {sel?.kind === 'station' && poi.station && (
        <div class="selbox">
          <h3>{t('station')}</h3>
          <p>{t('hp')} <b>{Math.round(poi.station.hp)}</b> / {poi.station.maxHp}{poi.station.hp <= 0 ? <><br /><span class="bad">{t('stationDown')}</span></> : null}</p>
          {!mine && sv.owner && <RaidButtons v={v} sv={sv} target={sv.id} />}
        </div>
      )}
      {struct && (
        <div class="selbox">
          <h3>{t(struct.kind)} <small>{t(`orbitShort${struct.orbit}` as 'orbitShort1')}</small></h3>
          <p>{t(`${struct.kind}Desc` as 'extractorDesc')}</p>
          <p>{t('hp')} <b>{Math.round(struct.hp)}</b> / {struct.maxHp}{struct.range ? <> · {t('range')} <b>{struct.range}</b></> : null}</p>
          {!mine && sv.owner && <RaidButtons v={v} sv={sv} target={`${sv.id}:${struct.id}`} />}
        </div>
      )}
      {sel?.kind === 'slot' && <p class="tag">{t('freeSlot')} · {t(`orbit${sel.orbit}` as 'orbit1')}</p>}
      {mine && ([1, 2, 3] as const).filter((o) => poi.orbitSlots[o - 1]! > 0 && (!orbitFilter || orbitFilter === o)).map((o) => {
        const free = freeOn(o);
        const kinds = BUILDINGS.filter((b) => BUILDING_ORBIT[b] === o && (b !== 'relay' || !poi.main) && (b !== 'refinery' || poi.kind === 'gas'));
        return (
          <div key={o}>
            <h3>{t(`orbit${o}` as 'orbit1')} <small>{free > 0 ? `${free}/${poi.orbitSlots[o - 1]}` : t('noSlot')}</small></h3>
            <div class="cards">
              {kinds.map((b) => {
                const has = (uniqueSystem.includes(b) && (sv.pois.some((p) => p.structures.some((s) => s.kind === b)) || (sv.buildQueue ?? []).some((j) => j.building === b)))
                  || (b === 'relay' && (poi.structures.some((s) => s.kind === 'relay') || queue.some((j) => j.building === 'relay')));
                const afford = sv.stock ? RES.every((r) => (BUILDING_COST[b][r] ?? 0) <= sv.stock![r]) : false;
                return (
                  <button key={b} class={`card-btn ${has ? 'has' : ''}`} disabled={has || free <= 0 || !afford} onClick={() => void act({ type: 'build', system: sv.id, building: b, orbit: o, poi: poi.id })}>
                    <b>{t(b)}</b><small>{t(`${b}Desc` as 'extractorDesc')}</small>{!has && <Cost cost={BUILDING_COST[b]} />}{has && <small class="ok">✓</small>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {mine && queue.length > 0 && <p class="muted">{t('queue')}: {queue.map((j) => `${t(j.building)} (${hms(j.readyAt - sv.time)})`).join(', ')}</p>}
      {mine && poi.structures.some((s) => s.kind === 'shipyard') && (
        <>
          <h3>{t('train')}</h3>
          <div class="cards">
            {UNITS.map((u: UnitType) => {
              const n = u === 'cargo' ? 2 : 4;
              const cost = Object.fromEntries(Object.entries(UNIT_COST[u]).map(([k, x]) => [k, (x ?? 0) * n])) as Partial<Record<Resource, number>>;
              const afford = sv.stock ? RES.every((r) => (cost[r] ?? 0) <= sv.stock![r]) : false;
              return (
                <button key={u} class="card-btn" disabled={!afford} onClick={() => void act({ type: 'train', system: sv.id, unit: u, count: n })}>
                  <b>{t(u)} ×{n}</b><small>{t(`${u}Desc` as 'corvetteDesc')}</small><Cost cost={cost} />
                </button>
              );
            })}
          </div>
          {(sv.trainQueue?.length ?? 0) > 0 && <p class="muted">{t('queue')}: {sv.trainQueue!.map((j) => `${j.count} ${t(j.unit)} (${hms(j.readyAt - sv.time)})`).join(', ')}</p>}
        </>
      )}
      {!mine && !sel && sv.owner && <RaidButtons v={v} sv={sv} target={sv.id} />}
      {!sel && !struct && <p class="muted">{poi.kind === 'nebula' ? t('plateauNebula') : poi.orbitSlots.every((n) => n === 0) ? t('plateauNoSlots') : t('plateauHint')}</p>}
    </div>
  );
}

function RaidButtons({ v, sv, target }: { v: PlayerView; sv: SystemDetailView; target: string }) {
  const idle = v.fleets.filter((f) => f.owner === v.me.id && f.at !== null && f.order === 'idle' && f.combat > 0);
  const here = idle.find((f) => f.at === sv.id) ?? idle[0];
  if (!here) return <p class="muted">—</p>;
  return (
    <div class="actions">
      <button onClick={() => void act({ type: 'fleet_order', fleet: here.id, order: 'raid', target })}>{t('raid')}</button>
      <button onClick={() => void act({ type: 'fleet_order', fleet: here.id, order: 'blockade', target: sv.id })}>{t('blockade')}</button>
      <button onClick={() => void act({ type: 'fleet_order', fleet: here.id, order: 'ambush', target: sv.id })}>{t('ambush')}</button>
    </div>
  );
}

function FleetsTab({ v, sv, sel, poi }: { v: PlayerView; sv: SystemDetailView; sel: SceneSelection; poi: PoiView | null }) {
  const inScope = (f: SystemDetailView['fleets'][number]): boolean => !poi || f.poi === poi.id || (!!f.hop && (f.hop.to === poi.id || f.hop.from === poi.id));
  const mineHere = sv.fleets.filter((f) => f.owner === v.me.id && inScope(f));
  const others = sv.fleets.filter((f) => f.owner !== v.me.id && inScope(f));
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  const where = (f: SystemDetailView['fleets'][number]): string => f.hop ? `${t('laneTravel')} ${sv.pois.find((p) => p.id === f.hop!.to)?.designation ?? ''}` : f.docked ? t('docked') : t('onPlateau');
  const elsewhere = v.fleets.filter((f) => f.owner === v.me.id && f.at !== null && f.at !== sv.id && f.order === 'idle' && f.combat > 0);
  const targetHere = poi ? `${sv.id}:${poi.designation}` : sv.id;
  return (
    <div>
      <h3>{t('fleetsHere')}</h3>
      {mineHere.length === 0 && <p class="muted">—</p>}
      <ul class="list">
        {mineHere.map((f) => (
          <li key={f.id} class={sel?.kind === 'fleet' && sel.id === f.id ? 'on' : ''} onClick={() => { sceneSel.value = { kind: 'fleet', id: f.id }; }}>
            <span><b>{unitLine(f.units, f.size)}</b> <small>· {where(f)}{!poi && f.poi ? ` ${sv.pois.find((p) => p.id === f.poi)?.designation ?? ''}` : ''} · {t('hp')} {Math.round(f.hp * 100)} % · {orderLabel(f.order)}</small></span>
            <span class="actions inline">
              {f.combat > 0 && sv.owner && sv.owner !== v.me.id && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'focus', fleet: f.id, target: f.focus === 'station' ? null : 'station' }); }}>{f.focus === 'station' ? t('clearFocus') : t('focusStation')}</button>}
              {f.combat > 0 && sel?.kind === 'structure' && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'focus', fleet: f.id, target: sel.id }); }}>{t('focus')}</button>}
              {f.combat >= 2 && f.units && <button onClick={(e) => { e.stopPropagation(); const u = f.units!; void act({ type: 'split_fleet', fleet: f.id, units: { corvette: Math.floor(u.corvette / 2), frigate: Math.floor(u.frigate / 2), cruiser: Math.floor(u.cruiser / 2) } }); }}>{t('split')}</button>}
              {sv.id !== v.me.capital && !f.hop && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'fleet_order', fleet: f.id, order: 'return', target: v.me.capital }); }}>{f.pos ? t('retreat') : t('return')}</button>}
              {f.combat > 0 && sv.mine && !f.hop && poi && f.poi !== poi.id && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'fleet_order', fleet: f.id, order: 'defend', target: targetHere }); }}>{t('sendHere')}</button>}
              {f.combat > 0 && sv.mine && !f.hop && f.order !== 'defend' && (!poi || f.poi === poi.id) && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'fleet_order', fleet: f.id, order: 'defend', target: targetHere }); }}>{t('defend')}</button>}
            </span>
          </li>
        ))}
      </ul>
      {others.length > 0 && <h3>{t('onPlateau')}</h3>}
      <ul class="list">
        {others.map((f) => <li key={f.id} onClick={() => { sceneSel.value = { kind: 'fleet', id: f.id }; }}><span class={`f-${v.colonies.find((c) => c.id === f.owner)?.faction ?? ''}`}>{name(f.owner)}</span> <small>{unitLine(f.units, f.size)} · {where(f)} · {t('hp')} {Math.round(f.hp * 100)} % · {orderLabel(f.order)}</small></li>)}
      </ul>
      {sv.inbound.length > 0 && <h3>{t('inbound')}</h3>}
      <ul class="list">
        {sv.inbound.map((f) => <li key={f.id}><span>{name(f.owner)} · {f.convoy ? t('convoy') : t('tabFleets')} {f.size}</span><small>{t('eta')} {hms(f.arriveAt - sv.time)}</small></li>)}
      </ul>
      {elsewhere.length > 0 && (
        <>
          <h3>{t('defend')}</h3>
          <ul class="list">
            {elsewhere.slice(0, 6).map((f) => <li key={f.id}><span>{unitLine(f.units, f.size)} <small>{t('at')} {v.systems.find((s) => s.id === f.at)?.name ?? f.at}</small></span><span class="actions inline"><button onClick={() => void act({ type: 'fleet_order', fleet: f.id, order: sv.mine ? 'defend' : 'move', target: targetHere })}>{sv.mine ? t('defend') : t('move')}</button></span></li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function LogisticsHere({ v, sv }: { v: PlayerView; sv: SystemDetailView }) {
  const sysName = (id: string): string => v.systems.find((s) => s.id === id)?.name ?? id;
  const idleCargos = sv.fleets.filter((f) => f.owner === v.me.id && f.order === 'idle' && f.units && f.units.cargo > 0).reduce((s, f) => s + (f.units?.cargo ?? 0), 0);
  const [to, setTo] = useState(v.me.capital === sv.id ? (v.systems.find((s) => s.owner === v.me.id && s.id !== sv.id)?.id ?? '') : v.me.capital);
  const [qty, setQty] = useState<Record<Resource, number>>({ metal: 0, energy: 0, food: 0, crystal: 0, rium: 0 });
  const [escort, setEscort] = useState('');
  const escorts = sv.fleets.filter((f) => f.owner === v.me.id && f.order === 'idle' && f.combat > 0);
  const total = RES.reduce((s, r) => s + qty[r], 0);
  const owned = v.systems.filter((s) => s.owner === v.me.id && s.id !== sv.id);
  if (!sv.mine) return <p class="muted">—</p>;
  return (
    <div>
      <h3>{t('routes')}</h3>
      {sv.routes.length === 0 && <p class="muted">—</p>}
      <ul class="list">
        {sv.routes.map((r) => <li key={r.id}><span>{sysName(r.from)} → {sysName(r.to)} · <b>{r.resource === 'all' ? t('all') : t(r.resource)}</b> <small>{r.perTrip}/{t('perTrip').toLowerCase()}{Number.isFinite(r.whenBelow) ? ` · < ${r.whenBelow}` : ''}</small></span><button onClick={() => void act({ type: 'route_remove', route: r.id })}>{t('remove')}</button></li>)}
      </ul>
      <h3>{t('sendConvoy')} <small>{idleCargos} {t('cargosIdle')} · {Math.ceil(total / 120)} {t('cargo')}</small></h3>
      {idleCargos === 0 && <p class="muted">{t('needCargos')}</p>}
      <div class="row">
        <label>{t('to')}<select value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>{owned.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === v.me.capital ? ' ★' : ''}</option>)}</select></label>
        <label>{t('escort')}<select value={escort} onChange={(e) => setEscort((e.target as HTMLSelectElement).value)}><option value="">{t('noEscort')}</option>{escorts.map((f) => <option key={f.id} value={f.id}>{unitLine(f.units, f.size)}</option>)}</select></label>
      </div>
      <div class="row qty">
        {RES.map((r) => <label key={r} class={`r-${r}`}><span><Icon name={r} size={12} /> {t(r)} <small>({Math.floor(sv.stock?.[r] ?? 0)})</small></span><input type="number" min={0} max={Math.floor(sv.stock?.[r] ?? 0)} value={qty[r]} onInput={(e) => setQty({ ...qty, [r]: Math.max(0, Number((e.target as HTMLInputElement).value)) })} /></label>)}
      </div>
      <button class="primary" disabled={!to || total <= 0 || idleCargos === 0} onClick={() => { const cargo: Partial<Record<Resource, number>> = {}; for (const r of RES) if (qty[r] > 0) cargo[r] = qty[r]; void act({ type: 'convoy_send', from: sv.id, to, cargo, ...(escort ? { escort } : {}) }).then((ok) => { if (ok) setQty({ metal: 0, energy: 0, food: 0, crystal: 0, rium: 0 }); }); }}>{t('send')}</button>
    </div>
  );
}

function BattleTab({ v, sv, poi }: { v: PlayerView; sv: SystemDetailView; poi: PoiView | null }) {
  const [list, setList] = useState<BattleSummary[]>([]);
  const [report, setReport] = useState<BattleReport | null>(null);
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  useEffect(() => { void fetchBattles().then((l) => setList(l.filter((b) => b.system === sv.id))); }, [sv.id, sv.engaged]);
  const open = (id: string): void => { void fetchBattle(id).then(setReport); };
  const live = poi ? poi.battle : sv.pois.map((p) => p.battle).find((b) => b) ?? null;
  const placeOf = (poiId: string): string => sv.pois.find((p) => p.id === poiId)?.designation ?? '';
  return (
    <div>
      {live && (
        <div class="selbox">
          <h3 class="bad">{t('battleLive')} <small>{hms(sv.time - live.startedAt)}</small></h3>
          <p>{live.sides.map((s) => <span key={s}>{name(s)} <b>{live.kills[s] ?? 0}</b> {t('kills')} &nbsp;</span>)}</p>
          <button onClick={() => open(live.id)}>{t('battleReports')}</button>
        </div>
      )}
      {report && <Report r={report} v={v} onClose={() => setReport(null)} />}
      <h3>{t('battleReports')}</h3>
      {list.length === 0 && <p class="muted">{t('noBattles')}</p>}
      <ul class="list">
        {list.map((b) => <li key={b.id} onClick={() => open(b.id)}><span>{b.sides.map(name).join(' ⚔ ')} <small>{placeOf((b as BattleSummary & { poi?: string }).poi ?? '')}</small></span><small>{hms(b.startedAt)} · {b.kills} {t('kills')}{b.endedAt === null ? ` · ${t('ongoing')}` : ''}</small></li>)}
      </ul>
    </div>
  );
}

function Report({ r, v, onClose }: { r: BattleReport; v: PlayerView; onClose: () => void }) {
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  const units = (c: Record<UnitType, number>): string => (Object.entries(c) as [UnitType, number][]).filter(([, n]) => n > 0).map(([u, n]) => `${n} ${t(u)}`).join(', ') || '—';
  return (
    <div class="selbox report">
      <h3>{r.systemName} <small>{t('outcome')}: <b class={r.outcome === 'lost' ? 'bad' : r.outcome === 'held' ? 'good' : ''}>{t(r.outcome)}</b> · {t('duration')} {hms(r.seconds)}</small> <button class="x" onClick={onClose}>×</button></h3>
      <table class="prices"><thead><tr><th></th><th>{t('kills')}</th><th>{t('losses')}</th><th>{t('destroyed')}</th></tr></thead>
        <tbody>{r.sides.map((s) => <tr key={s.id}><td>{name(s.id)}{s.defender ? ' 🛡' : ''}</td><td>{units(s.kills)}</td><td>{units(s.losses)}</td><td>{[...s.structuresDestroyed.map((k) => t(k as Building)), ...(s.stationDown ? [t('station')] : [])].join(', ') || '—'}</td></tr>)}</tbody></table>
      <ul class="list log">
        {r.timeline.slice(-30).reverse().map((e, i) => <li key={i}><small>+{hms(e.at - r.startedAt)}</small> <b>{name(e.who)}</b> {e.kind === 'kill' ? `${t('kills')} ${e.amount} ${t(e.what as UnitType)}` : e.kind === 'destroyed' ? `${t('destroyed')} ${t(e.what as Building)}` : e.kind}{e.target ? ` → ${name(e.target)}` : ''}</li>)}
      </ul>
    </div>
  );
}
