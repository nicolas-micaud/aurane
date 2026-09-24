// System mode: the plateau scene full-screen, a dock with the selected object, per-orbit
// construction, training, fleets present, logistics touching this system and the battle.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { BUILDINGS, UNITS, type Building, type Resource, type UnitType } from '@aurane/protocol';
import { BUILDING_COST, BUILDING_ORBIT, UNIT_COST, type BattleReport, type PlayerView, type SystemDetailView } from '@aurane/sim';
import { SystemScene, type SceneSelection } from '../map/SystemScene.js';
import { act, fetchBattle, fetchBattles, systemView, watch, type BattleSummary } from '../net.js';
import { t } from '../i18n/index.js';
import { useSig } from './useSig.js';
import { Icon } from './Icon.js';
import { Cost, hms } from './bits.js';

type DockTab = 'plateau' | 'fleets' | 'logistics' | 'battle';
const dockTab = signal<DockTab>('plateau');
const sceneSel = signal<SceneSelection>(null);
const RES: Resource[] = ['metal', 'energy', 'food', 'crystal'];

export function SystemMode({ v, systemId, onLeave }: { v: PlayerView; systemId: string; onLeave: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SystemScene | null>(null);
  const sv = useSig(systemView);
  const sel = useSig(sceneSel);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    watch(systemId);
    sceneSel.value = null;
    dockTab.value = 'plateau';
    const sc = new SystemScene({ onSelect: (s) => { sceneSel.value = s; if (s?.kind === 'fleet') dockTab.value = 'fleets'; else if (s) dockTab.value = 'plateau'; } });
    sc.orbitNames = [t('orbitShort1').toUpperCase(), t('orbitShort2').toUpperCase(), t('orbitShort3').toUpperCase()];
    scene.current = sc;
    void sc.mount(host.current!).then(() => { if (systemView.value) sc.update(systemView.value, ctxOf(v)); });
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => { cancelAnimationFrame(raf); sc.destroy(); watch(null); };
  }, [systemId]);
  useEffect(() => { if (sv && scene.current) scene.current.update(sv, ctxOf(v)); }, [sv, v]);
  useEffect(() => { scene.current?.setSelection(sel); }, [sel]);

  const s = v.systems.find((x) => x.id === systemId);
  return (
    <div class={`sysmode ${entered ? 'in' : ''}`}>
      <div class="sysmap" ref={host} />
      <div class="sysbar">
        <button class="back" onClick={onLeave}>‹ {t('leaveSystem')}</button>
        <h2><span class={`r-${s?.resource ?? 'metal'}`}><Icon name={s?.resource ?? 'metal'} size={18} /></span> {sv?.name ?? s?.name ?? systemId} {sv?.ownerName && <small>· {sv.ownerName}</small>}</h2>
        {sv && <SystemStatus sv={sv} />}
      </div>
      {sv && <Dock v={v} sv={sv} sel={sel} />}
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

function Dock({ v, sv, sel }: { v: PlayerView; sv: SystemDetailView; sel: SceneSelection }) {
  const tab = useSig(dockTab);
  const tabs: DockTab[] = ['plateau', 'fleets', 'logistics', 'battle'];
  const labels: Record<DockTab, string> = { plateau: t('plateau'), fleets: t('tabFleets'), logistics: t('tabLogistics'), battle: t('tabBattle') };
  return (
    <div class="dock">
      <div class="tabs">
        {tabs.map((k) => <button key={k} class={tab === k ? 'on' : ''} onClick={() => { dockTab.value = k; }}>{labels[k]}{k === 'battle' && sv.engaged ? <i class="dotn bad" /> : null}</button>)}
      </div>
      <div class="body">
        {tab === 'plateau' && <PlateauTab v={v} sv={sv} sel={sel} />}
        {tab === 'fleets' && <FleetsTab v={v} sv={sv} sel={sel} />}
        {tab === 'logistics' && <LogisticsHere v={v} sv={sv} />}
        {tab === 'battle' && <BattleTab v={v} sv={sv} />}
      </div>
    </div>
  );
}

const ORDER_KEYS = new Set(['move', 'raid', 'blockade', 'defend', 'return', 'ambush', 'convoy', 'idle', 'fleet']);
const orderLabel = (o: string): string => (ORDER_KEYS.has(o) ? t(o as 'move') : o);

const unitLine = (u: { corvette: number; frigate: number; cruiser: number; cargo: number } | null, size: number): string =>
  u ? [u.corvette && `${u.corvette} ${t('corvette')}`, u.frigate && `${u.frigate} ${t('frigate')}`, u.cruiser && `${u.cruiser} ${t('cruiser')}`, u.cargo && `${u.cargo} ${t('cargo')}`].filter(Boolean).join(' · ') : `${size} · ${t('unknownComposition')}`;

function PlateauTab({ v, sv, sel }: { v: PlayerView; sv: SystemDetailView; sel: SceneSelection }) {
  const mine = sv.mine;
  const queuedOn = (o: 1 | 2 | 3): number => (sv.buildQueue ?? []).filter((j) => j.orbit === o).length;
  const freeOn = (o: 1 | 2 | 3): number => sv.orbitSlots[o - 1]! - sv.structures.filter((s) => s.orbit === o).length - queuedOn(o);
  const orbitFilter: (1 | 2 | 3) | null = sel?.kind === 'slot' ? sel.orbit : null;
  const struct = sel?.kind === 'structure' ? sv.structures.find((s) => s.id === sel.id) : null;
  return (
    <div>
      {sel?.kind === 'station' && sv.station && (
        <div class="selbox">
          <h3>{t('station')}</h3>
          <p>{t('hp')} <b>{Math.round(sv.station.hp)}</b> / {sv.station.maxHp}{sv.station.hp <= 0 ? <><br /><span class="bad">{t('stationDown')}</span></> : null}</p>
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
      {mine && ([1, 2, 3] as const).filter((o) => sv.orbitSlots[o - 1]! > 0 && (!orbitFilter || orbitFilter === o)).map((o) => {
        const free = freeOn(o);
        const kinds = BUILDINGS.filter((b) => BUILDING_ORBIT[b] === o);
        const unique: Building[] = ['extractor', 'shipyard', 'bastion', 'tradepost', 'amplifier', 'antenna'];
        return (
          <div key={o}>
            <h3>{t(`orbit${o}` as 'orbit1')} <small>{free > 0 ? `${free}/${sv.orbitSlots[o - 1]}` : t('noSlot')}</small></h3>
            <div class="cards">
              {kinds.map((b) => {
                const has = unique.includes(b) && (sv.structures.some((s) => s.kind === b) || (sv.buildQueue ?? []).some((j) => j.building === b));
                const afford = sv.stock ? RES.every((r) => (BUILDING_COST[b][r] ?? 0) <= sv.stock![r]) : false;
                return (
                  <button key={b} class={`card-btn ${has ? 'has' : ''}`} disabled={has || free <= 0 || !afford} onClick={() => void act({ type: 'build', system: sv.id, building: b, orbit: o })}>
                    <b>{t(b)}</b><small>{t(`${b}Desc` as 'extractorDesc')}</small>{!has && <Cost cost={BUILDING_COST[b]} />}{has && <small class="ok">✓</small>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {mine && (sv.buildQueue?.length ?? 0) > 0 && <p class="muted">{t('queue')}: {sv.buildQueue!.map((j) => `${t(j.building)} (${hms(j.readyAt - sv.time)})`).join(', ')}</p>}
      {mine && sv.structures.some((s) => s.kind === 'shipyard') && (
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
      {!sel && !struct && <p class="muted">{t('coach6')}</p>}
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

function FleetsTab({ v, sv, sel }: { v: PlayerView; sv: SystemDetailView; sel: SceneSelection }) {
  const mineHere = sv.fleets.filter((f) => f.owner === v.me.id);
  const others = sv.fleets.filter((f) => f.owner !== v.me.id);
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  const elsewhere = v.fleets.filter((f) => f.owner === v.me.id && f.at !== null && f.at !== sv.id && f.order === 'idle' && f.combat > 0);
  return (
    <div>
      <h3>{t('fleetsHere')}</h3>
      {mineHere.length === 0 && <p class="muted">—</p>}
      <ul class="list">
        {mineHere.map((f) => (
          <li key={f.id} class={sel?.kind === 'fleet' && sel.id === f.id ? 'on' : ''} onClick={() => { sceneSel.value = { kind: 'fleet', id: f.id }; }}>
            <span><b>{unitLine(f.units, f.size)}</b> <small>· {f.docked ? t('docked') : t('onPlateau')} · {t('hp')} {Math.round(f.hp * 100)} % · {orderLabel(f.order)}</small></span>
            <span class="actions inline">
              {f.combat > 0 && sv.owner && sv.owner !== v.me.id && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'focus', fleet: f.id, target: f.focus === 'station' ? null : 'station' }); }}>{f.focus === 'station' ? t('clearFocus') : t('focusStation')}</button>}
              {f.combat > 0 && sel?.kind === 'structure' && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'focus', fleet: f.id, target: sel.id }); }}>{t('focus')}</button>}
              {f.combat >= 2 && <button onClick={(e) => { e.stopPropagation(); const u = f.units!; void act({ type: 'split_fleet', fleet: f.id, units: { corvette: Math.floor(u.corvette / 2), frigate: Math.floor(u.frigate / 2), cruiser: Math.floor(u.cruiser / 2) } }); }}>{t('split')}</button>}
              {sv.id !== v.me.capital && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'fleet_order', fleet: f.id, order: 'return', target: v.me.capital }); }}>{f.pos ? t('retreat') : t('return')}</button>}
              {f.combat > 0 && sv.mine && f.order !== 'defend' && <button onClick={(e) => { e.stopPropagation(); void act({ type: 'fleet_order', fleet: f.id, order: 'defend', target: sv.id }); }}>{t('defend')}</button>}
            </span>
          </li>
        ))}
      </ul>
      {others.length > 0 && <h3>{t('onPlateau')}</h3>}
      <ul class="list">
        {others.map((f) => <li key={f.id} onClick={() => { sceneSel.value = { kind: 'fleet', id: f.id }; }}><span class={`f-${v.colonies.find((c) => c.id === f.owner)?.faction ?? ''}`}>{name(f.owner)}</span> <small>{unitLine(f.units, f.size)} · {t('hp')} {Math.round(f.hp * 100)} % · {orderLabel(f.order)}</small></li>)}
      </ul>
      {sv.inbound.length > 0 && <h3>{t('inbound')}</h3>}
      <ul class="list">
        {sv.inbound.map((f) => <li key={f.id}><span>{name(f.owner)} · {f.convoy ? t('convoy') : t('tabFleets')} {f.size}</span><small>{t('eta')} {hms(f.arriveAt - sv.time)}</small></li>)}
      </ul>
      {elsewhere.length > 0 && (
        <>
          <h3>{t('defend')}</h3>
          <ul class="list">
            {elsewhere.slice(0, 6).map((f) => <li key={f.id}><span>{unitLine(f.units, f.size)} <small>{t('at')} {v.systems.find((s) => s.id === f.at)?.name ?? f.at}</small></span><span class="actions inline"><button onClick={() => void act({ type: 'fleet_order', fleet: f.id, order: sv.mine ? 'defend' : 'move', target: sv.id })}>{sv.mine ? t('defend') : t('move')}</button></span></li>)}
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
  const [qty, setQty] = useState<Record<Resource, number>>({ metal: 0, energy: 0, food: 0, crystal: 0 });
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
      <button class="primary" disabled={!to || total <= 0 || idleCargos === 0} onClick={() => { const cargo: Partial<Record<Resource, number>> = {}; for (const r of RES) if (qty[r] > 0) cargo[r] = qty[r]; void act({ type: 'convoy_send', from: sv.id, to, cargo, ...(escort ? { escort } : {}) }).then((ok) => { if (ok) setQty({ metal: 0, energy: 0, food: 0, crystal: 0 }); }); }}>{t('send')}</button>
    </div>
  );
}

function BattleTab({ v, sv }: { v: PlayerView; sv: SystemDetailView }) {
  const [list, setList] = useState<BattleSummary[]>([]);
  const [report, setReport] = useState<BattleReport | null>(null);
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  useEffect(() => { void fetchBattles().then((l) => setList(l.filter((b) => b.system === sv.id))); }, [sv.id, sv.engaged]);
  const open = (id: string): void => { void fetchBattle(id).then(setReport); };
  return (
    <div>
      {sv.battle && (
        <div class="selbox">
          <h3 class="bad">{t('battleLive')} <small>{hms(sv.time - sv.battle.startedAt)}</small></h3>
          <p>{sv.battle.sides.map((s) => <span key={s}>{name(s)} <b>{sv.battle!.kills[s] ?? 0}</b> {t('kills')} &nbsp;</span>)}</p>
          <button onClick={() => open(sv.battle!.id)}>{t('battleReports')}</button>
        </div>
      )}
      {report && <Report r={report} v={v} onClose={() => setReport(null)} />}
      <h3>{t('battleReports')}</h3>
      {list.length === 0 && <p class="muted">{t('noBattles')}</p>}
      <ul class="list">
        {list.map((b) => <li key={b.id} onClick={() => open(b.id)}><span>{b.sides.map(name).join(' ⚔ ')}</span><small>{hms(b.startedAt)} · {b.kills} {t('kills')}{b.endedAt === null ? ` · ${t('ongoing')}` : ''}</small></li>)}
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
