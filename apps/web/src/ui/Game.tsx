import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { BUILDINGS, UNITS, type Building, type Resource, type UnitType } from '@aurane/protocol';
import type { PlayerView, SystemView } from '@aurane/sim';
import { GalaxyMap } from '../map/GalaxyMap.js';
import { act, fetchBriefing, status, submitDoctrine, toast, view } from '../net.js';
import { lang, t, tError } from '../i18n/index.js';
import { useSig } from './useSig.js';

type Tab = 'colony' | 'system' | 'market' | 'fleets' | 'diplomacy' | 'general' | 'log';
const selected = signal<string | null>(null);
const linkFrom = signal<string | null>(null);
const tab = signal<Tab>('colony');
const briefing = signal<{ text: string; source: string } | null>(null);
const RES: Resource[] = ['metal', 'energy', 'food', 'crystal'];

const fmt = (n: number): string => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0));
const hms = (s: number): string => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };

export function Game() {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<GalaxyMap | null>(null);
  const v = useSig(view)!;
  const st = useSig(status);
  const toastV = useSig(toast);
  const linkV = useSig(linkFrom);
  const selV = useSig(selected);

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
      {linkV && <div class="hint">{t('linkHint')} <button onClick={() => { linkFrom.value = null; }}>{t('cancel')}</button></div>}
      {brief && (
        <div class="briefing">
          <h3>{t('briefing')} · {t(v.me.persona as 'vane')}</h3>
          <pre>{brief.text}</pre>
          <button class="primary" onClick={() => { briefing.value = null; }}>{t('dismiss')}</button>
        </div>
      )}
      <Panel v={v} map={map} />
    </div>
  );
}

function Hud({ v }: { v: PlayerView }) {
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const secondsLeft = v.nextDrawAt - v.time - (Date.now() - hudReceivedAt) / 1000;
  return (
    <div class="hud">
      <div class="chips">
        {RES.map((r) => <span class={`chip r-${r}`} key={r}><i /> {fmt(v.me.stock[r])}<small>+{fmt(v.me.lastProduced[r])}</small></span>)}
        <span class="chip"><i class="cr" /> {fmt(v.me.credits)}</span>
        <span class="chip"><i class="inf" /> {fmt(v.me.influence)}</span>
      </div>
      <div class="status">
        <span>{t('nextDraw')} <b>{hms(secondsLeft)}</b></span>
        {v.draw && <span>{t('bands')} <b>{v.draw.bands.join(' · ')}</b></span>}
        <span>{t('score')} <b>{v.me.score.toFixed(1)}</b> · {v.me.connectedCount} {t('connected')}</span>
        {v.me.shielded && <span class="tag">{t('shielded')}</span>}
      </div>
    </div>
  );
}
let hudReceivedAt = Date.now();
view.subscribe(() => { hudReceivedAt = Date.now(); });

function Panel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const [open, setOpen] = useState(true);
  const current = useSig(tab);
  const tabs: Tab[] = ['colony', 'system', 'market', 'fleets', 'diplomacy', 'general', 'log'];
  const labels: Record<Tab, string> = { colony: t('tabColony'), system: t('tabSystem'), market: t('tabMarket'), fleets: t('tabFleets'), diplomacy: t('tabDiplomacy'), general: t('tabGeneral'), log: t('tabLog') };
  return (
    <div class={`panel ${open ? 'open' : ''}`}>
      <div class="tabs" onClick={() => setOpen(true)}>
        {tabs.map((k) => <button key={k} class={current === k ? 'on' : ''} onClick={(e) => { e.stopPropagation(); tab.value = k; setOpen(true); }}>{labels[k]}</button>)}
        <button class="collapse" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? '▾' : '▴'}</button>
      </div>
      <div class="body">
        {current === 'colony' && <ColonyPanel v={v} map={map} />}
        {current === 'system' && <SystemPanel v={v} />}
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
  const free = s.buildings ? s.slots + (s.id === v.me.capital ? 3 : 0) - s.buildings.length : 0;
  const fleetsHere = v.fleets.filter((f) => f.at === s.id && f.owner === v.me.id);
  return (
    <div>
      <h2>{s.name} <small>{s.kind === 'pulsar' ? t('kindPulsar') : s.kind === 'beacon' ? t('kindBeacon') : ''}</small></h2>
      <p><span class={`dot r-${s.resource}`} /> {t(s.resource)} · {t('band')} {s.band} · {t('slots')} {s.slots} · {t('owner')}: {ownerName}{s.connected ? ' ●' : ''}</p>
      {s.population !== null && <p>{t('population')}: {(s.population * 100).toFixed(0)} %</p>}
      <div class="actions">
        <button onClick={() => { linkFrom.value = s.id; }} disabled={!s.connected && !mine}>{t('linkMode')}</button>
        {s.kind === 'beacon' && mine && !s.lit && <button onClick={() => void act({ type: 'light_beacon', system: s.id })}>{t('lightBeacon')}</button>}
        {s.lit && <span class="tag">{t('lit')} {t('by')} {v.colonies.find((c) => c.id === s.lit!.by)?.name}</span>}
      </div>
      {mine && s.buildings && (
        <>
          <h3>{t('build')} <small>({free})</small></h3>
          <div class="grid">
            {BUILDINGS.map((b: Building) => <button key={b} disabled={s.buildings!.includes(b) || free <= 0} onClick={() => void act({ type: 'build', system: s.id, building: b })}>{t(b)}</button>)}
          </div>
          {s.buildings.includes('shipyard') && (
            <>
              <h3>{t('train')}</h3>
              <div class="grid">
                {UNITS.map((u: UnitType) => <button key={u} onClick={() => void act({ type: 'train', system: s.id, unit: u, count: 4 })}>{t(u)} ×4</button>)}
              </div>
            </>
          )}
        </>
      )}
      {fleetsHere.length > 0 && <FleetList v={v} fleets={fleetsHere} />}
      {!mine && s.owner && <SystemHostile v={v} s={s} />}
    </div>
  );
}

function SystemHostile({ v, s }: { v: PlayerView; s: SystemView }) {
  const idle = v.fleets.filter((f) => f.owner === v.me.id && f.at !== null && f.order === 'idle');
  const relays = v.relays.filter((r) => r.owner === s.owner && (r.a === s.id || r.b === s.id) && r.ready && !r.cut);
  if (!idle.length) return null;
  return (
    <div class="actions">
      <button onClick={() => void act({ type: 'fleet_order', fleet: idle[0]!.id, order: 'blockade', target: s.id })}>{t('blockade')}</button>
      {relays[0] && <button onClick={() => void act({ type: 'fleet_order', fleet: idle[0]!.id, order: 'raid', target: relays[0]!.id })}>{t('raid')}</button>}
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
  const [region, setRegion] = useState(v.me.regions[0] ?? '');
  const [res, setRes] = useState<Resource>('food');
  const [side, setSide] = useState<'buy' | 'sell'>('sell');
  const [qty, setQty] = useState(20);
  const [price, setPrice] = useState(1);
  if (!v.me.regions.length) return <p class="muted">{t('noMarket')}</p>;
  const last = v.clearing.find((c) => c.region === region && c.resource === res);
  return (
    <div>
      <div class="row">
        <select value={region} onChange={(e) => setRegion((e.target as HTMLSelectElement).value)}>{v.me.regions.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <select value={res} onChange={(e) => setRes((e.target as HTMLSelectElement).value as Resource)}>{RES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select>
        <div class="seg"><button class={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>{t('buy')}</button><button class={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>{t('sell')}</button></div>
      </div>
      <div class="row">
        <label>{t('qty')}<input type="number" min={1} value={qty} onInput={(e) => setQty(Number((e.target as HTMLInputElement).value))} /></label>
        <label>{t('price')}<input type="number" min={0.1} step={0.1} value={price} onInput={(e) => setPrice(Number((e.target as HTMLInputElement).value))} /></label>
        <button class="primary" onClick={() => void act({ type: 'market_order', region, resource: res, side, qty, price })}>{t('place')}</button>
      </div>
      <p class="muted">{t('lastPrice')}: {last ? `${last.price} (${last.qty})` : '—'}</p>
      <h3>{t('myOrders')}</h3>
      <ul class="list">{v.orders.map((o) => <li key={o.id}>{t(o.side)} {o.qty} {t(o.resource)} @ {o.price} <button onClick={() => void act({ type: 'cancel_order', order: o.id })}>{t('cancel')}</button></li>)}</ul>
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

function GeneralPanel({ v }: { v: PlayerView }) {
  const [text, setText] = useState(v.me.policy.notes);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; source: string } | null>(null);
  const p = v.me.policy;
  const submit = async () => {
    setBusy(true);
    const r = await submitDoctrine(text, lang.value);
    setBusy(false);
    if (r) setResult(r);
  };
  return (
    <div>
      <h2>{t(v.me.persona as 'vane')}</h2>
      <p class="muted">{t('doctrineHint')}</p>
      <textarea rows={4} value={text} placeholder={t('doctrinePlaceholder')} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <button class="primary" disabled={busy || text.trim().length < 3} onClick={() => void submit()}>{busy ? t('compiling') : t('apply')}</button>
      {result && <p class="tag">{t('compiled')} · {result.source === 'llm' ? t('viaModel') : t('viaRules')}<br /><small>{result.summary}</small></p>}
      <h3>{t('policy')}</h3>
      <p>{t('expansion')}: {(p.expansion * 100).toFixed(0)} % · {t('aggression')}: {(p.aggression * 100).toFixed(0)} %</p>
      <div class="row">
        <label>{t('expansion')}<input type="range" min={0} max={1} step={0.1} value={p.expansion} onChange={(e) => void act({ type: 'set_policy', policy: { ...p, expansion: Number((e.target as HTMLInputElement).value) } })} /></label>
        <label>{t('aggression')}<input type="range" min={0} max={1} step={0.1} value={p.aggression} onChange={(e) => void act({ type: 'set_policy', policy: { ...p, aggression: Number((e.target as HTMLInputElement).value) } })} /></label>
      </div>
      <button onClick={() => void fetchBriefing(lang.value).then((b) => { if (b) briefing.value = b; })}>{t('briefing')}</button>
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
