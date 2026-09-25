import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { DECREES, type Command, type Resource } from '@aurane/protocol';
import { AGENT_COST_INFLUENCE, DECREE_COST_CREDITS, DECREE_HOURS, counselLine, counselTitle, type PlayerView, type SystemView } from '@aurane/sim';
import { GalaxyMap } from '../map/GalaxyMap.js';
import { act, answerCounsel, fetchBriefing, fetchCounsel, fetchTalk, status, talk as sendTalk, toast, view, requestLink, type CounselCard, type CounselView, type Turn } from '../net.js';
import { lang, t, tError } from '../i18n/index.js';
import { useSig } from './useSig.js';
import { Icon } from './Icon.js';
import { SystemMode } from './SystemView.js';
import { LogisticsPanel } from './Logistics.js';
import { InstallButton, RES, UpdateBanner, fmt, hms } from './bits.js';
import { decreeLabel, describeEvent, describeNote, etaText, stamp } from './feed.js';

type Tab = 'colony' | 'system' | 'logistics' | 'market' | 'fleets' | 'diplomacy' | 'general' | 'log';
type TplKey = 'tplForge' | 'tplOasis' | 'tplCrossroads' | 'tplGraveyard' | 'tplSanctuary' | 'tplLair' | 'tplBurnt';
const TPL_KEY: Record<string, TplKey> = { forge: 'tplForge', oasis: 'tplOasis', crossroads: 'tplCrossroads', graveyard: 'tplGraveyard', sanctuary: 'tplSanctuary', lair: 'tplLair', burnt: 'tplBurnt' };
const selected = signal<string | null>(null);
const linkFrom = signal<string | null>(null);
const tab = signal<Tab>('colony');
const briefing = signal<{ text: string; source: string } | null>(null);
/** The system whose plateau is open full-screen, or null for the galaxy. */
export const systemMode = signal<string | null>(null);
/** Bumped when something asks the panel to unfold (the Counsel's "Show me" on a phone), or to fold so the map shows. */
const openPanel = signal(0);
const foldPanel = signal(0);

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
      <Hud v={v} map={map} />
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

/** Live alerts: fights and blockades first, then hostile fleets on their way (with the hour of arrival), then what waits for an answer. */
function Alerts({ v }: { v: PlayerView }) {
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 30000); return () => clearInterval(i); }, []);
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  const mine = new Set(v.systems.filter((s) => s.owner === v.me.id).map((s) => s.id));
  const rows: { key: string; kind: 'hot' | 'inbound' | 'soft'; text: string; cta: string; go: () => void }[] = [];
  for (const s of v.systems) if (mine.has(s.id) && (s.engaged || s.blockadedBy)) rows.push({ key: `hot-${s.id}`, kind: 'hot', text: (s.engaged ? t('alertBattle') : t('alertBlockade')).replace('{s}', s.name), cta: t('enter'), go: () => { systemMode.value = s.id; } });
  const now = v.time + ((Date.now() - hudReceivedAt) / 1000) * v.timeScale;
  for (const f of v.fleets) {
    if (f.owner === v.me.id || !f.destination || !mine.has(f.destination) || f.combat === 0 || f.at !== null) continue;
    if (v.colonies.find((c) => c.id === f.owner)?.ally) continue;
    const sys = v.systems.find((x) => x.id === f.destination);
    rows.push({ key: `in-${f.id}`, kind: 'inbound', text: t('alertInbound').replace('{n}', String(f.combat)).replace('{a}', name(f.owner)).replace('{s}', sys?.name ?? f.destination).replace('{t}', etaText(f.arriveAt - now)), cta: t('enter'), go: () => { systemMode.value = f.destination; } });
  }
  for (const b of v.barters) if (b.to === v.me.id && !b.accepted) rows.push({ key: `offer-${b.id}`, kind: 'soft', text: t('alertOffer').replace('{a}', name(b.from)), cta: t('review'), go: () => { tab.value = 'market'; } });
  for (const p of v.proposals) if (p.to === v.me.id) rows.push({ key: `prop-${p.from}-${p.kind}`, kind: 'soft', text: t('alertProposal').replace('{a}', name(p.from)).replace('{k}', t(p.kind as 'nap')), cta: t('review'), go: () => { tab.value = 'diplomacy'; } });
  for (const i of v.invites) rows.push({ key: `inv-${i.alliance}`, kind: 'soft', text: t('alertInvite').replace('{a}', i.name), cta: t('review'), go: () => { tab.value = 'diplomacy'; } });
  if (!rows.length) return null;
  const shown = rows.slice(0, 3);
  return (
    <div class="alerts">
      {shown.map((r) => (
        <button key={r.key} class={`alert ${r.kind}`} onClick={r.go}>
          <i /> <span>{r.text}</span> <b>{r.cta} ›</b>
        </button>
      ))}
      {rows.length > shown.length && <small class="muted">{t('alertsMore').replace('{n}', String(rows.length - shown.length))}</small>}
    </div>
  );
}

function Hud({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
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
      {v.me.counsel.length > 0 ? <Counsel v={v} map={map} /> : <Coach v={v} />}
    </div>
  );
}

/** The Draw Counsel (0009): the Partner's cards. In the General's voice when the LLM layer wrote them (one fetch
 *  per Draw), else the simulation's cards with fixed lines. "Show me" opens the screen, "Do it" runs the ready
 *  command, "Not now" hides the card for this Draw; the General remembers both answers. */
const skippedCounsel = signal<Set<string>>(new Set());
const voiceCounsel = signal<CounselView | null>(null);
let counselFetching = false;

type UiCard = { id: string; title: string; line: string; hasCommand: boolean; urgency: 0 | 1 | 2; voice: boolean; go: () => void; run: () => Promise<boolean> };

function showTarget(show: PlayerView['me']['counsel'][number]['show'], map: GalaxyMap | null): void {
  if (show.kind === 'star') { selected.value = show.system; tab.value = 'system'; map?.centerOn(show.system); map?.flash(show.system); }
  else if (show.kind === 'link') { selected.value = show.from; tab.value = 'system'; linkFrom.value = show.from; map?.centerOn(show.from); map?.flash(show.from); }
  else if (show.kind === 'plateau') { systemMode.value = show.system; }
  else tab.value = show.tab;
  openPanel.value++;
}

function showVoiceTarget(show: CounselCard['show'], map: GalaxyMap | null): void {
  if (!show) return;
  if (show.screen === 'system' && show.system) {
    if (show.slot === 'link') { selected.value = show.system; tab.value = 'system'; linkFrom.value = show.system; }
    else if (show.slot || show.poi) systemMode.value = show.system;
    else { selected.value = show.system; tab.value = 'system'; }
    if (systemMode.value !== show.system) { map?.centerOn(show.system); map?.flash(show.system); }
  } else if (show.screen === 'journal') tab.value = 'log';
  else if (show.screen === 'colony' || show.screen === 'market' || show.screen === 'general') tab.value = show.screen;
  else { systemMode.value = null; tab.value = 'colony'; }
  openPanel.value++;
}

/** The star a command acts on, to show where the General just did something. */
function commandTarget(cmd: Command | null): string | null {
  if (!cmd) return null;
  switch (cmd.type) {
    case 'build_relay': return cmd.b;
    case 'build': case 'train': return cmd.system;
    case 'fleet_order': return cmd.target;
    default: return null;
  }
}

function Counsel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const skipped = useSig(skippedCounsel);
  const voice = useSig(voiceCounsel);
  const nextDraw = Math.floor(v.time / 3600) + 1;
  // One fetch per Draw: the voice cards are cached server-side until the Draw.
  useEffect(() => {
    if (counselFetching || (voice && voice.drawIndex === nextDraw)) return;
    counselFetching = true;
    void fetchCounsel(lang.value).then((c) => { if (c && c.cards.length) voiceCounsel.value = c; }).finally(() => { counselFetching = false; });
  }, [nextDraw]);
  const answer = (id: string, taken: boolean, viaVoice: boolean) => {
    skippedCounsel.value = new Set([...skippedCounsel.value, id]);
    if (viaVoice) void answerCounsel(id, taken); else void act({ type: 'counsel_answer', id, taken });
  };
  // After "Do it": the star flashes and is selected, and the General's acknowledgement shows as a toast.
  const acted = (target: string | null, reply: string | null) => {
    if (target) { selected.value = target; map.current?.centerOn(target); map.current?.flash(target); foldPanel.value++; }
    if (reply) { toast.value = { text: reply, kind: 'ok' }; setTimeout(() => { if (toast.value?.text === reply) toast.value = null; }, 3500); }
  };
  const cards: UiCard[] = voice && voice.drawIndex === nextDraw && voice.cards.length
    ? voice.cards.map((c) => ({ id: c.id, title: c.title, line: c.line, hasCommand: !!c.command, urgency: 1 as const, voice: true, go: () => showVoiceTarget(c.show, map.current),
      run: async () => { const r = await answerCounsel(c.id, true); if (r.ok) acted(commandTarget(c.command), r.reply ?? t('counselDone')); return r.ok; } }))
    : v.me.counsel.map((c) => ({ id: c.id, title: counselTitle(c, lang.value), line: counselLine(c, lang.value), hasCommand: !!c.command, urgency: c.urgency, voice: false, go: () => showTarget(c.show, map.current),
      run: async () => { const ok = await act(c.command!); if (ok) acted(commandTarget(c.command), t('counselDone')); return ok; } }));
  const shown = cards.filter((c) => !skipped.has(c.id));
  if (shown.length === 0) return null;
  return (
    <div class="counsel">
      <small class="who">{t(v.me.persona as 'vane')} · {t('counselTitle')}</small>
      {shown.map((c) => (
        <div key={c.id} class={`card u${c.urgency}`}>
          <p><b>{c.title}</b> · {c.line}</p>
          <div class="acts">
            <button onClick={c.go}>{t('showMe')}</button>
            {c.hasCommand && <button class="primary" onClick={() => { void c.run().then((ok) => { if (ok) { skippedCounsel.value = new Set([...skippedCounsel.value, c.id]); if (!c.voice) void act({ type: 'counsel_answer', id: c.id, taken: true }); } }); }}>{t('doIt')}</button>}
            <button class="link" onClick={() => answer(c.id, false, c.voice)}>{t('notNow')}</button>
          </div>
        </div>
      ))}
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
  const openReq = useSig(openPanel);
  useEffect(() => { if (openReq > 0) setOpen(true); }, [openReq]);
  const foldReq = useSig(foldPanel);
  useEffect(() => { if (foldReq > 0 && isNarrow()) setOpen(false); }, [foldReq]);
  // Progressive onboarding: a tab appears with its tier (docs/design/ONBOARDING-S0.md), the General says why.
  const tier = v.me.onboarding?.tier ?? 6;
  const TAB_TIER: Partial<Record<Tab, number>> = { logistics: 1, market: 2, fleets: 3, diplomacy: 5 };
  const all: Tab[] = (['colony', 'system', 'logistics', 'market', 'fleets', 'diplomacy', 'general', 'log'] as Tab[]).filter((k) => (TAB_TIER[k] ?? 0) <= tier);
  const primary: Tab[] = ['colony', 'system', 'general', 'log'];
  useEffect(() => { if (!all.includes(current)) tab.value = 'colony'; }, [tier]);
  const read = useSig(logRead);
  const unread = current === 'log' ? 0 : v.events.filter((e) => e.at > read && e.kind !== 'draw').length;
  useEffect(() => { if (current === 'log') markLogRead(v); }, [current, v.events.length]);
  const tabs: Tab[] = isNarrow() && !more ? [...primary, ...(primary.includes(current) ? [] : [current])] : all;
  const labels: Record<Tab, string> = { colony: t('tabColony'), system: t('tabSystem'), logistics: t('tabLogistics'), market: t('tabMarket'), fleets: t('tabFleets'), diplomacy: t('tabDiplomacy'), general: t('tabGeneral'), log: t('tabLog') };
  return (
    <div class={`panel ${open ? 'open' : ''}`}>
      <div class="tabs" onClick={() => setOpen(true)}>
        {tabs.map((k) => <button key={k} class={current === k ? 'on' : ''} onClick={(e) => { e.stopPropagation(); tab.value = k; setOpen(true); setMore(false); }}>{labels[k]}{k === 'log' && unread > 0 ? <i class="badge">{unread > 9 ? '9+' : unread}</i> : null}</button>)}
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
      <Decrees v={v} />
    </div>
  );
}

/** Decrees: three public, temporary bonuses bought with Credits (GDD § 8). */
function Decrees({ v }: { v: PlayerView }) {
  const now = v.time;
  const desc = { range: t('decreeRangeDesc'), freefees: t('decreeFreefeesDesc'), longwatch: t('decreeLongwatchDesc') } as const;
  return (
    <div class="decrees">
      <h3>{t('decrees')} <small>{Math.floor(v.me.credits)} {t('credits')}</small></h3>
      <p class="muted small">{t('decreesHint')}</p>
      <div class="cards">
        {DECREES.map((k) => {
          const active = v.me.decrees.find((d) => d.kind === k && d.until > now);
          const cost = DECREE_COST_CREDITS[k];
          return (
            <button key={k} class={`card-btn ${active ? 'has' : ''}`} disabled={!!active || v.me.credits < cost} onClick={() => void act({ type: 'decree', kind: k })}>
              <b>{decreeLabel(k)}</b><small>{desc[k]}</small>
              {active ? <small class="ok">{t('inForce')} · {hms(active.until - now)} {t('remaining')}</small> : <small class="r-credits">{cost} {t('credits')} · {DECREE_HOURS[k]} h</small>}
            </button>
          );
        })}
      </div>
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

const talk = signal<Turn[]>([]);
let talkLoaded = false;

function GeneralPanel({ v }: { v: PlayerView }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const thread = useSig(talk);
  const endRef = useRef<HTMLDivElement>(null);
  const p = v.me.policy;
  useEffect(() => { if (!talkLoaded) { talkLoaded = true; void fetchTalk().then((h) => { if (h.length) talk.value = h; }); } }, []);
  // The General speaks first when a hostile fleet heads our way: pick up its line when such an event lands.
  const inboundCount = v.events.filter((e) => e.kind === 'fleet.inbound' && e.actors[1] === v.me.id).length;
  useEffect(() => { if (talkLoaded && inboundCount > 0) void fetchTalk().then((h) => { if (h.length > talk.value.length) talk.value = h; }); }, [inboundCount]);
  const journal = [...v.me.journal].reverse().slice(0, 12);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [thread.length, busy]);
  const submit = async () => {
    const said = text.trim();
    if (!said) return;
    setBusy(true); setText('');
    talk.value = [...talk.value, { who: 'me', text: said, at: Date.now() }];
    const r = await sendTalk(said, lang.value);
    setBusy(false);
    if (r) { talk.value = r.history; if (r.policyChanged) toast.value = { text: t('compiled'), kind: 'ok' }; }
    else talk.value = [...talk.value, { who: 'general', text: t('generalOffline'), at: Date.now() }];
  };
  return (
    <div class="generalpanel">
      <h2>{t(v.me.persona as 'vane')} <small class="muted">{t(`${v.me.persona}Desc` as 'vaneDesc')}</small></h2>
      {(v.me.onboarding?.tier ?? 6) < 6 && (
        <p class="tag">{t('tierOpened').replace('{k}', t(`tier${v.me.onboarding.tier}` as 'tier1'))} · <button class="link" onClick={() => void act({ type: 'onboarding_unlock' }, t('showMeAllDone'))}>{t('showMeAll')}</button></p>
      )}
      <div class="say">
        <textarea rows={2} value={text} placeholder={t('doctrinePlaceholder')} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
        <button class="primary" disabled={busy || text.trim().length < 1} onClick={() => void submit()}>{t('send')}</button>
      </div>
      <div class="talk">
        {thread.length === 0 && <p class="bubble general">{t('generalHello')}</p>}
        {thread.slice(-12).map((m, i) => <p key={`${m.at}-${i}`} class={`bubble ${m.who}`}>{m.text}</p>)}
        {busy && <p class="bubble general muted">{t('thinking')}</p>}
        <div ref={endRef} />
      </div>
      {p.notes && <p class="muted small">{t('doctrine')} : {p.notes}</p>}
      <h3>{t('journalGeneral')}</h3>
      {journal.length === 0 ? <p class="muted small">{t('journalEmpty')}</p> : (
        <ul class="list journal">{journal.map((n, i) => <li key={`${n.at}-${i}`}><small>{stamp(n.at)}</small> <span>{describeNote(n, v)}</span></li>)}</ul>
      )}
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

const LOG_READ_KEY = 'aurane.logread';
const logRead = signal<number>((() => { try { return Number(localStorage.getItem(LOG_READ_KEY) ?? -1); } catch { return -1; } })());
function markLogRead(v: PlayerView): void {
  const last = v.events.length ? v.events[v.events.length - 1]!.at : v.time;
  if (last <= logRead.value) return;
  logRead.value = last;
  try { localStorage.setItem(LOG_READ_KEY, String(last)); } catch { /* ignore */ }
}

/** The living log: one readable line per event, the hourly recap as a card, newest first. */
function LogPanel({ v }: { v: PlayerView }) {
  const lines = v.events.map((e, i) => describeEvent(e, v, i)).filter((x): x is NonNullable<typeof x> => x !== null).reverse();
  if (!lines.length) return <p class="muted">{t('noEvents')}</p>;
  return (
    <ul class="list feed">
      {lines.map((l) => (
        <li key={l.key} class={`tone-${l.tone} ${l.system ? 'has-sys' : ''}`} onClick={l.system ? () => { selected.value = l.system; } : undefined}>
          {l.recap ? (
            <div class="recap">
              <div class="head"><b>{l.text}</b> <small>{stamp(l.at)}</small></div>
              <div class="chips">
                {RES.map((r) => <span key={r} class={`chip r-${r}`}><Icon name={r} size={12} /> <b>+{fmt(l.recap!.produced[r] ?? 0)}</b></span>)}
                <span class="chip r-credits"><Icon name="credits" size={12} /> <b>+{l.recap.credits}</b></span>
              </div>
              <small class="muted">{l.recap.productive} {t('recapSystems')} · {l.recap.drawn} {t('recapDrawn')}{l.recap.overflow > 0 ? <> · <span class="bad">{l.recap.overflow} {t('recapLost')}</span></> : null}{l.recap.unpowered > 0 ? <> · <span class="bad">{l.recap.unpowered} {t('recapUnpowered')}</span></> : null}</small>
            </div>
          ) : (
            <><i /> <span>{l.text}</span> <small>{stamp(l.at)}</small></>
          )}
        </li>
      ))}
    </ul>
  );
}
