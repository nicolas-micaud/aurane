// Logistics tab (galaxy mode): the colony's routes, convoys on the move, and a form to
// add a route or send a convoy from any owned system.
import { useState } from 'preact/hooks';
import type { Resource } from '@aurane/protocol';
import type { PlayerView } from '@aurane/sim';
import { act } from '../net.js';
import { t } from '../i18n/index.js';
import { Icon } from './Icon.js';
import { RES, hms, zeroStock } from './bits.js';

export function LogisticsPanel({ v, onCenter }: { v: PlayerView; onCenter: (systemId: string) => void }) {
  const owned = v.systems.filter((s) => s.owner === v.me.id);
  const sysName = (id: string): string => v.systems.find((s) => s.id === id)?.name ?? id;
  const overflow = Math.round(RES.reduce((s, r) => s + v.me.lastOverflow[r], 0));
  const convoys = v.fleets.filter((f) => f.owner === v.me.id && f.order === 'convoy');
  const cargosAt = (id: string): number => v.fleets.filter((f) => f.owner === v.me.id && f.at === id && f.order === 'idle' && f.units).reduce((s, f) => s + (f.units?.cargo ?? 0), 0);
  const [from, setFrom] = useState(v.me.capital);
  const [to, setTo] = useState(owned.find((s) => s.id !== v.me.capital)?.id ?? '');
  const [res, setRes] = useState<Resource | 'all'>('all');
  const [perTrip, setPerTrip] = useState(240);
  const [below, setBelow] = useState(300);
  const [qty, setQty] = useState<Record<Resource, number>>(zeroStock());
  const total = RES.reduce((s, r) => s + qty[r], 0);
  const fromSys = v.systems.find((s) => s.id === from);
  return (
    <div>
      {overflow > 0 && <p class="warn">{t('overflowWarn').replace('{n}', String(overflow))}</p>}
      <h3>{t('routes')} <small>{v.routes.length}/{v.me.routeLimit} {t('routeLimit')}</small></h3>
      {v.routes.length === 0 && <p class="muted">—</p>}
      <ul class="list">
        {v.routes.map((r) => (
          <li key={r.id}>
            <span onClick={() => onCenter(r.from)}>{sysName(r.from)} → {sysName(r.to)} · <b>{r.resource === 'all' ? t('all') : t(r.resource)}</b> <small>{r.perTrip}/{t('perTrip').toLowerCase()}{Number.isFinite(r.whenBelow) ? ` · < ${r.whenBelow}` : ''} · {cargosAt(r.from)} {t('cargo')}</small></span>
            <button onClick={() => void act({ type: 'route_remove', route: r.id })}>{t('remove')}</button>
          </li>
        ))}
      </ul>
      <h3>{t('newRoute')}</h3>
      <div class="row">
        <label>{t('from')}<select value={from} onChange={(e) => setFrom((e.target as HTMLSelectElement).value)}>{owned.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === v.me.capital ? ' ★' : ''}</option>)}</select></label>
        <label>{t('to')}<select value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>{owned.filter((s) => s.id !== from).map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === v.me.capital ? ' ★' : ''}</option>)}</select></label>
        <label>{t('resource')}<select value={res} onChange={(e) => setRes((e.target as HTMLSelectElement).value as Resource | 'all')}><option value="all">{t('all')}</option>{RES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></label>
      </div>
      <div class="row">
        <label>{t('perTrip')}<input type="number" min={20} step={20} value={perTrip} onInput={(e) => setPerTrip(Number((e.target as HTMLInputElement).value))} /></label>
        {res !== 'all' && <label>{t('whenBelow')}<input type="number" min={0} step={50} value={below} onInput={(e) => setBelow(Number((e.target as HTMLInputElement).value))} /></label>}
        <button class="primary" disabled={!from || !to || v.routes.length >= v.me.routeLimit} onClick={() => void act({ type: 'route_set', from, to, resource: res, perTrip, whenBelow: res === 'all' ? 1e9 : below })}>{t('create')}</button>
      </div>
      <h3>{t('sendConvoy')} <small>{cargosAt(from)} {t('cargosIdle')} {t('at')} {sysName(from)} · {Math.ceil(total / 120)} {t('cargo')}</small></h3>
      <div class="row qty">
        {RES.map((r) => <label key={r} class={`r-${r}`}><span><Icon name={r} size={12} /> {t(r)} <small>({Math.floor(fromSys?.stock?.[r] ?? 0)})</small></span><input type="number" min={0} max={Math.floor(fromSys?.stock?.[r] ?? 0)} value={qty[r]} onInput={(e) => setQty({ ...qty, [r]: Math.max(0, Number((e.target as HTMLInputElement).value)) })} /></label>)}
      </div>
      <button class="primary" disabled={!from || !to || total <= 0 || cargosAt(from) === 0} onClick={() => { const cargo: Partial<Record<Resource, number>> = {}; for (const r of RES) if (qty[r] > 0) cargo[r] = qty[r]; void act({ type: 'convoy_send', from, to, cargo }).then((ok) => { if (ok) setQty(zeroStock()); }); }}>{t('send')}</button>
      {cargosAt(from) === 0 && <p class="muted">{t('needCargos')}</p>}
      <h3>{t('convoysInTransit')} <small>{convoys.length}</small></h3>
      {convoys.length === 0 && <p class="muted">—</p>}
      <ul class="list">
        {convoys.map((f) => (
          <li key={f.id} onClick={() => f.destination && onCenter(f.destination)}>
            <span>{f.from ? sysName(f.from) : '?'} → {sysName(f.orderTarget ?? f.destination ?? '')} <small>{f.units?.cargo ?? 0} {t('cargo')}{f.combat ? ` + ${f.combat} ${t('escort').toLowerCase()}` : ''}</small></span>
            <small>{f.cargo ? RES.filter((r) => f.cargo![r] > 0).map((r) => `${Math.round(f.cargo![r])} ${t(r)}`).join(', ') : ''} · {f.at ? t('at') + ' ' + sysName(f.at) : `${t('eta')} ${hms(f.arriveAt - v.time)}`}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
