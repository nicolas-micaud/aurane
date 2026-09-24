import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { Resource } from '@aurane/protocol';
import { AGENT_COST_INFLUENCE, type PlayerView, type SystemView } from '@aurane/sim';
import { GalaxyMap } from '../map/GalaxyMap.js';
import { act, fetchBriefing, status, submitDoctrine, toast, view, requestLink } from '../net.js';
import { lang, t, tError } from '../i18n/index.js';
import { useSig } from './useSig.js';
import { Icon } from './Icon.js';
import { SystemMode } from './SystemView.js';
import { LogisticsPanel } from './Logistics.js';
import { InstallButton, RES, UpdateBanner, fmt, hms } from './bits.js';

type Tab = 'colony' | 'system' | 'logistics' | 'market' | 'fleets' | 'diplomacy' | 'general' | 'log';
type TplKey = 'tplForge' | 'tplOasis' | 'tplCrossroads' | 'tplGraveyard' | 'tplSanctuary' | 'tplLair' | 'tplBurnt';
const TPL_KEY: Record<string, TplKey> = { forge: 'tplForge', oasis: 'tplOasis', crossroads: 'tplCrossroads', graveyard: 'tplGraveyard', sanctuary: 'tplSanctuary', lair: 'tplLair', burnt: 'tplBurnt' };
const selected = signal<string | null>(null);
const linkFrom = signal<string | null>(null);
const tab = signal<Tab>('colony');
const briefing = signal<{ text: string; source: string } | null>(null);
/** The system whose plateau is open full-screen, or null for the galaxy. */
export const systemMode = signal<string | null>(null);

export function Game() {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<GalaxyMap | null>(null);
  const v = useSig(view)!;
  const st = useSig(status);
  const toastV = useSig(toast);
  const linkV = useSig(linkFrom);
  const selV = useSig(selected);
  const sysMode = useSig(systemMode);

  useEffect(() => {
    const m = new GalaxyMap({
      onSelect: (id) => {
        if (linkFrom.value && id && id !== linkFrom.value) {
          const from = linkFrom.value;
          linkFrom.value = null;
          void act({ type: 'build_relay', a: from, b: id }).then((ok) => { if (!ok && toast.value) toast.value = { text: tError(toast.value.text), kind: 'err' }; });
          selected.value = id;
          tab.value = 'system';
          return;
        }
        selected.value = id;
        if (id) tab.value = 'system';
      },
    });
    map.current = m;
    void m.mount(host.current!).then(() => m.update(view.value!));
    return () => m.destroy();
  }, []);

  useEffect(() => { map.current?.update(v); }, [v]);
  useEffect(() => { void fetchBriefing(lang.value).then((b) => { if (b && b.awaySeconds >= 600) briefing.value = b; }); }, []);
  const brief = useSig(briefing);
  useEffect(() => { map.current?.setSelection(selV); }, [selV]);
  useEffect(() => { map.current?.setLinkFrom(linkV); }, [linkV]);

  return (
    <div class="game">
      <div class="map" ref={host} />
      <Hud v={v} />
      {st !== 'online' && <div class="banner">{t('offline')}</div>}
      {toastV && <div class={`toast ${toastV.kind}`}>{toastV.text}</div>}
      {linkV && <div class="hint">{t('tapToLink')} <button onClick={() => { linkFrom.value = null; }}>{t('cancel')}</button></div>}
      {brief && (
        <div class="briefing">
          <h3>{t('briefing')} · {t(v.me.persona as 'vane')}</h3>
          <pre>{brief.text}</pre>
          <button class="primary" onClick={() => { briefing.value = null; }}>{t('dismiss')}</button>
        </div>
      )}
      <Panel v={v} map={map} />
      {sysMode && <SystemMode v={v} systemId={sysMode} onLeave={() => { systemMode.value = null; selected.value = sysMode; tab.value = 'system'; }} />}
    </div>
  );
}

/** Live alerts: fights and blockades on the colony's systems, one tap from the plateau. */
function Alerts({ v }: { v: PlayerView }) {
  const hot = v.systems.filter((s) => s.owner === v.me.id && (s.engaged || s.blockadedBy));
  if (!hot.length) return null;
  return (
    <div class="alerts">
      {hot.slice(0, 3).map((s) => (
        <button key={s.id} class="alert" onClick={() => { systemMode.value = s.id; }}>
          <i /> {(s.engaged ? t('alertBattle') : t('alertBlockade')).replace('{s}', s.name)} <b>{t('enter')} ›</b>
        </button>
      ))}
    </div>
  );
}

function Hud({ v }: { v: PlayerView }) {
  const [, force] = useState(0);
  const [legend, setLegend] = useState(false);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const secondsLeft = Math.max(0, v.nextDrawAt - v.time - ((Date.now() - hudReceivedAt) / 1000) * v.timeScale);
  const frac = 1 - secondsLeft / 3600;
  const ev = v.draw?.event.kind ?? 'none';
  const evLabel = ev === 'eruption' ? t('drawEventEruption') : ev === 'storm' ? t('drawEventStorm') : ev === 'echo' ? t('drawEventEcho') : t('drawEventNone');
  return (
    <div class="hud">
      <div class="chips">
        {RES.map((r) => (
          <span class={`chip r-${r}`} key={r} title={`${t(r)} — ${t(`${r}Desc`)}`}>
            <Icon name={r} /> <b>{fmt(v.me.stock[r])}</b><small>+{fmt(v.me.lastProduced[r])}</small><em>{t(r)}</em>
          </span>
        ))}
        <span class="chip r-credits" title={`${t('credits')} — ${t('creditsDesc')}`}><Icon name="credits" /> <b>{fmt(v.me.credits)}</b><em>{t('credits')}</em></span>
        <span class="chip r-influence" title={`${t('influence')} — ${t('influenceDesc')}`}><Icon name="influence" /> <b>{fmt(v.me.influence)}</b><em>{t('influence')}</em></span>
        <button class="chip help" onClick={() => setLegend(!legend)} title={t('help')}><Icon name="help" /></button>
      </div>
      <div class="status">
        <span class="draw" title={t('nextDraw')}>
          <svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="10" fill="none" stroke="#2a3760" stroke-width="3" /><circle cx="13" cy="13" r="10" fill="none" stroke="#7dd3fc" stroke-width="3" stroke-dasharray={`${Math.max(0, frac) * 62.8} 62.8`} transform="rotate(-90 13 13)" /></svg>
          <span>{t('nextDraw')} <b>{hms(secondsLeft)}</b></span>
        </span>
        {v.draw && <span title={t('bands')}>{t('bands')} <b>{v.draw.bands.join(' · ')}</b> · <b class={`ev-${ev}`}>{evLabel}</b></span>}
        <span>{t('score')} <b>{v.me.score.toFixed(1)}</b> · <b>{v.me.connectedCount}</b> {t('connected')}</span>
        {v.me.shielded && <span class="tag">{t('shielded')}</span>}
      </div>
      {legend && (
        <div class="legend" onClick={() => setLegend(false)}>
          <h3>{t('legend')}</h3>
          {RES.map((r) => <p key={r}><span class={`r-${r}`}><Icon name={r} /></span> <b>{t(r)}</b> — {t(`${r}Desc`)}</p>)}
          <p><span class="r-credits"><Icon name="credits" /></span> <b>{t('credits')}</b> — {t('creditsDesc')}</p>
          <p><span class="r-influence"><Icon name="influence" /></span> <b>{t('influence')}</b> — {t('influenceDesc')}</p>
          <p class="muted">{t('coach3')}</p>
          <InstallButton compact />
        </div>
      )}
      <UpdateBanner />
      <Alerts v={v} />
      <Coach v={v} />
    </div>
  );
}

/** First minutes: objectives that tick themselves off as the player acts, each with a way in. */
const COACH_KEY = 'aurane.coach';
const coachDone = signal<number>((() => { try { return Number(localStorage.getItem(COACH_KEY) ?? 0); } catch { return 0; } })());
const enteredSystem = signal(false);
systemMode.subscribe((id) => { if (id) enteredSystem.value = true; });

function Coach({ v }: { v: PlayerView }) {
  const done = useSig(coachDone);
  const entered = useSig(enteredSystem);
  const sel = useSig(selected);
  const owned = v.systems.filter((s) => s.owner === v.me.id);
  const built = owned.some((s) => (s.buildings?.length ?? 0) > 2 || (s.buildQueue?.length ?? 0) > 0);
  const steps: { text: string; why: string; met: boolean; go?: () => void }[] = [
    { text: t('coach1'), why: t('coach1Why'), met: sel !== null, go: () => { selected.value = v.me.capital; tab.value = 'system'; } },
    { text: t('coach2'), why: t('coach2Why'), met: v.me.connectedCount >= 2 || v.relays.some((r) => r.owner === v.me.id), go: () => { selected.value = v.me.capital; tab.value = 'system'; linkFrom.value = v.me.capital; } },
    { text: t('coach6'), why: t('coach6Why'), met: entered, go: () => { systemMode.value = v.me.capital; } },
    { text: t('coach7'), why: t('coach7Why'), met: built, go: () => { systemMode.value = v.me.capital; } },
    { text: t('coach8'), why: t('coach8Why'), met: (v.me.policy.notes ?? '').length > 0, go: () => { tab.value = 'general'; } },
    { text: t('coach3'), why: t('coach3Why'), met: (v.draw?.index ?? -1) >= 0 && v.me.lastProduced.metal > 0, go: () => { tab.value = 'logistics'; } },
  ];
  // Objectives are ordered; the first unmet one is shown, earlier ones count as done once met.
  const idx = Math.max(done, steps.findIndex((s) => !s.met));
  const current = idx < 0 || idx >= steps.length ? null : steps[idx]!;
  useEffect(() => {
    // Persist progress when the current objective becomes met.
    if (current?.met) { const n = idx + 1; coachDone.value = n; try { localStorage.setItem(COACH_KEY, String(n)); } catch { /* ignore */ } }
  }, [current?.met, idx]);
  if (!current) return null;
  const skip = () => { const n = idx + 1; coachDone.value = n; try { localStorage.setItem(COACH_KEY, String(n)); } catch { /* ignore */ } };
  return (
    <div class="coach">
      <span class="step">{idx + 1}/{steps.length}</span>
      <div class="text"><p>{current.text}</p><small>{current.why}</small></div>
      {current.go && <button class="primary" onClick={current.go}>{t('show')}</button>}
      <button onClick={skip} title={t('skip')}>✕</button>
    </div>
  );
}

let hudReceivedAt = Date.now();
view.subscribe(() => { hudReceivedAt = Date.now(); });

const isNarrow = (): boolean => window.innerWidth < 900;

function Panel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const [open, setOpen] = useState(() => !isNarrow());
  const [more, setMore] = useState(false);
  const current = useSig(tab);
  const sel = useSig(selected);
  // On a phone the panel stays folded until something is selected or a tab is tapped: the map comes first.
  useEffect(() => { if (sel && isNarrow()) setOpen(true); }, [sel]);
  const all: Tab[] = ['colony', 'system', 'logistics', 'market', 'fleets', 'diplomacy', 'general', 'log'];
  const primary: Tab[] = ['colony', 'system', 'general'];
  const tabs: Tab[] = isNarrow() && !more ? [...primary, ...(primary.includes(current) ? [] : [current])] : all;
  const labels: Record<Tab, string> = { colony: t('tabColony'), system: t('tabSystem'), logistics: t('tabLogistics'), market: t('tabMarket'), fleets: t('tabFleets'), diplomacy: t('tabDiplomacy'), general: t('tabGeneral'), log: t('tabLog') };
  return (
    <div class={`panel ${open ? 'open' : ''}`}>
      <div class="tabs" onClick={() => setOpen(true)}>
        {tabs.map((k) => <button key={k} class={current === k ? 'on' : ''} onClick={(e) => { e.stopPropagation(); tab.value = k; setOpen(true); setMore(false); }}>{labels[k]}{k === 'log' && v.events.length > 0 ? <i class="dotn" /> : null}</button>)}
        {isNarrow() && <button class={more ? 'on' : ''} onClick={(e) => { e.stopPropagation(); setMore(!more); }} title={t('more')}>⋯</button>}
        <button class="collapse" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? '▾' : '▴'}</button>
      </div>
      <div class="body">
        {current === 'colony' && <ColonyPanel v={v} map={map} />}
        {current === 'system' && <SystemPanel v={v} />}
        {current === 'logistics' && <LogisticsPanel v={v} onCenter={(id) => { selected.value = id; map.current?.centerOn(id); }} />}
        {current === 'market' && <MarketPanel v={v} />}
        {current === 'fleets' && <FleetsPanel v={v} map={map} />}
        {current === 'diplomacy' && <DiplomacyPanel v={v} />}
        {current === 'general' && <GeneralPanel v={v} />}
        {current === 'log' && <LogPanel v={v} />}
      </div>
    </div>
  );
}

function ColonyPanel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const mine = v.systems.filter((s) => s.owner === v.me.id);
  return (
    <div>
      <h2>{v.me.name} <small class={`f-${v.me.faction}`}>{t(v.me.faction as 'guild')}</small></h2>
      <p>{t(v.me.persona as 'vane')} · {v.me.watching ? t('watching') : ''}</p>
      <ul class="list">
        {mine.map((s) => (
          <li key={s.id} onClick={() => { selected.value = s.id; tab.value = 'system'; map.current?.centerOn(s.id); }}>
            <span class={`dot r-${s.resource}`} /> {s.name} {s.id === v.me.capital ? '★' : ''} <small>{s.connected ? '●' : '○'} {t('band')} {s.band}</small>
            <small>{(s.buildings ?? []).map((b) => t(b)).join(', ')}</small>
          </li>
        ))}
      </ul>
      {v.ended && <p class="tag">{v.ended.reason === 'silence' ? t('ended') : t('renaissance')}</p>}
    </div>
  );
}

function SystemPanel({ v }: { v: PlayerView }) {
  const sel = useSig(selected);
  const s = v.systems.find((x) => x.id === sel);
  if (!s) return <p class="muted">{t('selectHint')}</p>;
  const mine = s.owner === v.me.id;
  const ownerName = s.owner ? v.colonies.find((c) => c.id === s.owner)?.name ?? s.owner : t('unclaimed');
  const totalSlots = s.slots + (s.id === v.me.capital ? 3 : 0);
  const free = s.buildings ? totalSlots - s.buildings.length : 0;
  const fleetsHere = v.fleets.filter((f) => f.at === s.id && f.owner === v.me.id);
  const drawn = v.draw?.bands.includes(s.band) ?? false;
  const targets = v.linkTargets[s.id]?.length ?? 0;
  const linking = useSig(linkFrom) === s.id;
  return (
    <div>
      <h2><span class={`r-${s.resource}`}><Icon name={s.resource} size={18} /></span> {s.name} {s.id === v.me.capital && <span class="tag">{t('capitalTag')}</span>} {s.kind === 'pulsar' && <span class="tag">{t('kindPulsar')}</span>} {s.kind === 'beacon' && <span class="tag">{t('kindBeacon')}</span>}</h2>
      <div class="facts">
        <span><b class={`r-${s.resource}`}>{t(s.resource)}</b> · {t(`${s.resource}Desc`)}</span>
        <span>{t('band')} <b class={drawn ? 'ev-eruption' : ''}>{s.band}</b>{drawn ? ` ×3 ${t('yieldNow')}` : ''} · {t('slots')} <b>{totalSlots}</b> · {t('owner')}: <b>{ownerName}</b>{s.connected ? ' ●' : ''}</span>
        <span>{t(TPL_KEY[s.template] ?? 'tplForge')} · <b>{s.pois}</b> {t('bodies')}{s.signature ? <> · <b class="bad">{t('hiddenOwner')}</b></> : null}</span>
        {s.population !== null && <span>{t('population')} <b>{(s.population * 100).toFixed(0)} %</b></span>}
        {s.stationHp !== null && <span>{t('station')} <b>{Math.round(s.stationHp)}</b> / 300{s.engaged ? ` · ${t('underAttack')}` : ''}</span>}
        {s.stock && <span>{t('localStock')} : {RES.map((r) => <b key={r} class={`r-${r}`}> {Math.round(s.stock![r])}</b>)} <small>/ {s.capacity}</small></span>}
      </div>
      <div class="actions">
        <button class={`enter ${s.engaged ? 'hot' : ''}`} onClick={() => { systemMode.value = s.id; }}>◎ {t('enterSystem')}</button>
        <button class="primary" onClick={() => { linkFrom.value = linking ? null : s.id; }} disabled={!s.connected || targets === 0}>{t('linkMode')} {s.connected ? `(${targets} ${t('inRange')})` : ''}</button>
        {s.kind === 'beacon' && mine && !s.lit && <button onClick={() => void act({ type: 'light_beacon', system: s.id })}>{t('lightBeacon')}</button>}
        {!mine && <button disabled={v.me.influence < AGENT_COST_INFLUENCE.probe} onClick={() => void act({ type: 'agent_mission', mission: 'probe', target: s.id })}>{t('probe')} ★{AGENT_COST_INFLUENCE.probe}</button>}
        {s.lit && <span class="tag">{t('lit')} {t('by')} {v.colonies.find((c) => c.id === s.lit!.by)?.name}</span>}
      </div>
      {linking && <LinkTargets v={v} from={s.id} />}
      {mine && s.buildings && <p class="muted small">{t('buildHint')} · {free > 0 ? `${free}/${totalSlots} ${t('slots').toLowerCase()}` : t('noSlot')}</p>}
      {fleetsHere.length > 0 && <FleetList v={v} fleets={fleetsHere} />}
      {!mine && s.owner && <SystemHostile v={v} s={s} />}
    </div>
  );
}

/** Link mode: the systems a relay can reach from here, with their cost. Tap a row to build; no need to find the star. */
function LinkTargets({ v, from }: { v: PlayerView; from: string }) {
  const cands = (v.linkTargets[from] ?? []).map((c) => ({ ...c, sys: v.systems.find((x) => x.id === c.to) })).filter((c) => c.sys);
  const stock = v.systems.find((x) => x.id === from)?.stock ?? v.me.stock;
  return (
    <div class="linktargets">
      <h3>{t('targetsInRange')} <small>{cands.length}</small></h3>
      {cands.length === 0 && <p class="muted small">{t('noTargets')}</p>}
      <ul class="list">
        {cands.map((c) => {
          const afford = c.metal <= Math.max(stock.metal, v.me.stock.metal) && c.energy <= Math.max(stock.energy, v.me.stock.energy);
          return (
            <li key={c.to}>
              <span class={`dot r-${c.sys!.resource}`} /> <b>{c.sys!.name}</b> <small>{t(c.sys!.resource)} · {t('band')} {c.sys!.band}</small>
              <span class="cost"><span class="r-metal"><Icon name="metal" size={12} />{c.metal}</span><span class="r-energy"><Icon name="energy" size={12} />{c.energy}</span></span>
              <button class="primary" disabled={!afford} onClick={() => { linkFrom.value = null; void act({ type: 'build_relay', a: from, b: c.to }).then((ok) => { if (!ok && toast.value) toast.value = { text: tError(toast.value.text), kind: 'err' }; }); }}>{t('linkTo')}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SystemHostile({ v, s }: { v: PlayerView; s: SystemView }) {
  const idle = v.fleets.filter((f) => f.owner === v.me.id && f.at !== null && f.order === 'idle');
  const relays = v.relays.filter((r) => r.owner === s.owner && (r.a === s.id || r.b === s.id) && r.ready && !r.cut);
  return (
    <div>
      {idle.length > 0 && (
        <div class="actions">
          <button onClick={() => void act({ type: 'fleet_order', fleet: idle[0]!.id, order: 'blockade', target: s.id })}>{t('blockade')}</button>
          {s.owner && <button onClick={() => void act({ type: 'fleet_order', fleet: idle[0]!.id, order: 'raid', target: s.id })}>{t('raid')}</button>}
        </div>
      )}
      <h3>{t('agents')} <small>{Math.floor(v.me.influence)} {t('influence')}</small></h3>
      <div class="cards">
        <button class="card-btn" disabled={v.me.influence < AGENT_COST_INFLUENCE.spy} onClick={() => void act({ type: 'agent_mission', mission: 'spy', target: s.sector })}><b>{t('spy')}</b><small>{t('spyDesc')}</small><small class="r-influence">★ {AGENT_COST_INFLUENCE.spy}</small></button>
        {relays[0] && <button class="card-btn" disabled={v.me.influence < AGENT_COST_INFLUENCE.sabotage} onClick={() => void act({ type: 'agent_mission', mission: 'sabotage', target: relays[0]!.id })}><b>{t('sabotage')}</b><small>{t('sabotageDesc')}</small><small class="r-influence">★ {AGENT_COST_INFLUENCE.sabotage}</small></button>}
        {s.owner && <button class="card-btn" disabled={v.me.influence < AGENT_COST_INFLUENCE.envoy} onClick={() => void act({ type: 'agent_mission', mission: 'envoy', target: s.owner! })}><b>{t('envoy')}</b><small>{t('envoyDesc')}</small><small class="r-influence">★ {AGENT_COST_INFLUENCE.envoy}</small></button>}
      </div>
    </div>
  );
}

function FleetList({ v, fleets }: { v: PlayerView; fleets: PlayerView['fleets'] }) {
  return (
    <ul class="list">
      {fleets.map((f) => (
        <li key={f.id}>
          <b>{f.units ? `${f.units.corvette}c ${f.units.frigate}f ${f.units.cruiser}k` : f.size}</b> · {f.order}
          {f.at ? ` ${t('at')} ${v.systems.find((s) => s.id === f.at)?.name ?? f.at}` : ` ${t('inTransit')}`}
          {f.owner === v.me.id && f.at && f.order !== 'blockade' && selected.value && selected.value !== f.at && (
            <span class="actions inline">
              <button onClick={() => void act({ type: 'fleet_order', fleet: f.id, order: 'move', target: selected.value! })}>{t('move')}</button>
              <button onClick={() => void act({ type: 'fleet_order', fleet: f.id, order: 'defend', target: selected.value! })}>{t('defend')}</button>
            </span>
          )}
          {f.owner === v.me.id && f.at && f.at !== v.me.capital && <button onClick={() => void act({ type: 'fleet_order', fleet: f.id, order: 'return', target: v.me.capital })}>{t('return')}</button>}
        </li>
      ))}
    </ul>
  );
}

function FleetsPanel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const mine = v.fleets.filter((f) => f.owner === v.me.id);
  if (!mine.length) return <p class="muted">—</p>;
  return (
    <div>
      <FleetList v={v} fleets={mine} />
      <p class="muted" onClick={() => mine[0]?.at && map.current?.centerOn(mine[0].at)}>{t('selectHint')}</p>
    </div>
  );
}

function MarketPanel({ v }: { v: PlayerView }) {
  const [region, setRegion] = useState(v.me.regions[0]?.key ?? '');
  const [res, setRes] = useState<Resource>('food');
  const [side, setSide] = useState<'buy' | 'sell'>('sell');
  const [qty, setQty] = useState(20);
  const [price, setPrice] = useState(1);
  if (!v.me.regions.length) return <p class="muted">{t('noMarket')}</p>;
  const last = v.clearing.find((c) => c.region === region && c.resource === res);
  return (
    <div>
      <h3>{t('lastPrice')}</h3>
      <table class="prices"><thead><tr><th>{t('region')}</th>{RES.map((r) => <th key={r} class={`r-${r}`}><Icon name={r} size={12} /></th>)}</tr></thead>
        <tbody>{v.me.regions.map((rg) => <tr key={rg.key} class={rg.key === region ? 'on' : ''} onClick={() => setRegion(rg.key)}><td>{rg.name}</td>{RES.map((r) => { const c = v.clearing.find((x) => x.region === rg.key && x.resource === r); return <td key={r}>{c ? c.price : '—'}</td>; })}</tr>)}</tbody></table>
      <div class="row">
        <label>{t('region')}<select value={region} onChange={(e) => setRegion((e.target as HTMLSelectElement).value)}>{v.me.regions.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></label>
        <label>{t(res)}<select value={res} onChange={(e) => setRes((e.target as HTMLSelectElement).value as Resource)}>{RES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></label>
      </div>
      <div class="seg wide"><button class={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>{t('buy')}</button><button class={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>{t('sell')}</button></div>
      <div class="row">
        <label>{t('qty')}<input type="number" min={1} value={qty} onInput={(e) => setQty(Number((e.target as HTMLInputElement).value))} /></label>
        <label>{t('price')}<input type="number" min={0.1} step={0.1} value={price} onInput={(e) => setPrice(Number((e.target as HTMLInputElement).value))} /></label>
        <button class="primary" onClick={() => void act({ type: 'market_order', region, resource: res, side, qty, price })}>{t('place')}</button>
      </div>
      {last && <p class="muted">{t('lastPrice')}: {last.price} ({last.qty})</p>}
      <h3>{t('myOrders')}</h3>
      <ul class="list">{v.orders.map((o) => <li key={o.id}>{t(o.side)} {o.qty} {t(o.resource)} @ {o.price} <button onClick={() => void act({ type: 'cancel_order', order: o.id })}>{t('cancel')}</button></li>)}</ul>
      <Barter v={v} />
    </div>
  );
}

function Barter({ v }: { v: PlayerView }) {
  const partners = v.colonies.filter((c) => c.id !== v.me.id).sort((a, b) => (b.ally ? 1 : 0) - (a.ally ? 1 : 0) || b.score - a.score).slice(0, 40);
  const [to, setTo] = useState(partners[0]?.id ?? '');
  const [giveR, setGiveR] = useState<Resource>('food');
  const [giveQ, setGiveQ] = useState(20);
  const [wantR, setWantR] = useState<Resource>('energy');
  const [wantQ, setWantQ] = useState(10);
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  const fmtStock = (st: Partial<Record<Resource, number | undefined>>): string => RES.filter((r) => st[r]).map((r) => `${st[r]} ${t(r)}`).join(' + ');
  return (
    <div>
      <h3>{t('barter')}</h3>
      <div class="row">
        <label>{t('offerTo')}<select value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>{partners.map((c) => <option key={c.id} value={c.id}>{c.name}{c.ally ? ' ✓' : ''}{c.npc ? ' (PNJ)' : ''}</option>)}</select></label>
      </div>
      <div class="row">
        <label>{t('give')}<div class="seg"><input type="number" min={1} value={giveQ} onInput={(e) => setGiveQ(Number((e.target as HTMLInputElement).value))} /><select value={giveR} onChange={(e) => setGiveR((e.target as HTMLSelectElement).value as Resource)}>{RES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></div></label>
        <label>{t('want')}<div class="seg"><input type="number" min={1} value={wantQ} onInput={(e) => setWantQ(Number((e.target as HTMLInputElement).value))} /><select value={wantR} onChange={(e) => setWantR((e.target as HTMLSelectElement).value as Resource)}>{RES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></div></label>
        <button class="primary" disabled={!to} onClick={() => void act({ type: 'barter_offer', to, give: { [giveR]: giveQ }, want: { [wantR]: wantQ } })}>{t('send')}</button>
      </div>
      <p class="muted">{t('settledAtDraw')}</p>
      {v.barters.length > 0 && <h3>{t('offers')}</h3>}
      <ul class="list">
        {v.barters.map((b) => (
          <li key={b.id}>
            <span>{name(b.from)} → {name(b.to)}: <b>{fmtStock(b.give)}</b> ⇄ <b>{fmtStock(b.want)}</b> {b.accepted ? '✓' : ''}</span>
            {b.to === v.me.id && !b.accepted && <button class="primary" onClick={() => void act({ type: 'barter_accept', offer: b.id })}>{t('accept')}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiplomacyPanel({ v }: { v: PlayerView }) {
  const [name, setName] = useState('');
  const others = v.colonies.filter((c) => c.id !== v.me.id).sort((a, b) => b.score - a.score).slice(0, 30);
  return (
    <div>
      <h3>{t('alliance')}</h3>
      {v.me.alliance ? <p>{v.colonies.find((c) => c.id === v.me.id)?.allianceName}</p> : (
        <div class="row"><input placeholder={t('createAlliance')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /><button onClick={() => void act({ type: 'alliance_create', name })} disabled={name.length < 2}>{t('createAlliance')}</button></div>
      )}
      {v.invites.map((i) => <p key={i.alliance}>{i.name} <button onClick={() => void act({ type: 'alliance_join', alliance: i.alliance })}>{t('join')}</button></p>)}
      <h3>{t('treaties')}</h3>
      <ul class="list">{v.treaties.map((tr) => <li key={tr.id}>{t(tr.kind as 'nap')} — {v.colonies.find((c) => c.id === tr.with)?.name}</li>)}</ul>
      <ul class="list">
        {others.map((c) => (
          <li key={c.id}>
            <span class={`f-${c.faction}`}>{c.name}</span> <small>{c.score} {c.npc ? '· PNJ' : ''} {c.ally ? '· ✓' : ''}</small>
            <span class="actions inline">
              {(['nap', 'trade', 'transit'] as const).map((k) => <button key={k} onClick={() => void act({ type: 'treaty', with: c.id, kind: k })}>{t(k)}</button>)}
              {v.me.alliance && <button onClick={() => void act({ type: 'alliance_invite', colony: c.id })}>+</button>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const talk = signal<{ who: 'me' | 'general'; text: string }[]>([]);

function GeneralPanel({ v }: { v: PlayerView }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const thread = useSig(talk);
  const p = v.me.policy;
  const submit = async () => {
    const said = text.trim();
    if (!said) return;
    setBusy(true); setText('');
    talk.value = [...talk.value.slice(-5), { who: 'me', text: said }];
    const r = await submitDoctrine(said, lang.value);
    setBusy(false);
    talk.value = [...talk.value.slice(-5), { who: 'general', text: r ? r.reply : t('generalOffline') }];
  };
  return (
    <div>
      <h2>{t(v.me.persona as 'vane')}</h2>
      <p class="muted">{t('doctrineHint')}</p>
      <div class="talk">
        {thread.length === 0 && <p class="bubble general">{t('generalHello')}</p>}
        {thread.map((m, i) => <p key={i} class={`bubble ${m.who}`}>{m.text}</p>)}
        {busy && <p class="bubble general muted">{t('compiling')}</p>}
      </div>
      <div class="say">
        <textarea rows={2} value={text} placeholder={t('doctrinePlaceholder')} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
        <button class="primary" disabled={busy || text.trim().length < 2} onClick={() => void submit()}>{t('send')}</button>
      </div>
      {p.notes && <p class="muted small">{t('doctrine')} : {p.notes}</p>}
      <h3>{t('policy')}</h3>
      <p>{t('expansion')}: {(p.expansion * 100).toFixed(0)} % · {t('aggression')}: {(p.aggression * 100).toFixed(0)} %</p>
      <div class="row">
        <label>{t('expansion')}<input type="range" min={0} max={1} step={0.1} value={p.expansion} onChange={(e) => void act({ type: 'set_policy', policy: { ...p, expansion: Number((e.target as HTMLInputElement).value) } })} /></label>
        <label>{t('aggression')}<input type="range" min={0} max={1} step={0.1} value={p.aggression} onChange={(e) => void act({ type: 'set_policy', policy: { ...p, aggression: Number((e.target as HTMLInputElement).value) } })} /></label>
      </div>
      <button onClick={() => void fetchBriefing(lang.value).then((b) => { if (b) briefing.value = b; })}>{t('briefing')}</button>
      <DeviceLink />
    </div>
  );
}

/** A 24 h link to open this colony on another device (phone, laptop). */
function DeviceLink() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div class="devicelink">
      {!url && <button onClick={() => void requestLink().then((r) => setUrl(r?.url ?? null))}>{t('linkDevice')}</button>}
      {url && (
        <>
          <p class="muted">{t('linkDeviceHelp')}</p>
          <input readOnly value={url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>{copied ? t('copied') : t('copy')}</button>
        </>
      )}
    </div>
  );
}

function LogPanel({ v }: { v: PlayerView }) {
  const events = [...v.events].reverse();
  if (!events.length) return <p class="muted">{t('noEvents')}</p>;
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  return (
    <ul class="list log">
      {events.map((e, i) => <li key={i}><small>{hms(e.at)}</small> <b>{e.kind}</b> {e.actors.map(name).join(' → ')}</li>)}
    </ul>
  );
}
