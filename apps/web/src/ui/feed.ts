// The living log: every world event becomes one readable line (or a card for the hourly recap),
// and the General's structured notes become sentences. Nothing here talks to the server.
import type { Decree } from '@aurane/protocol';
import type { PlayerView } from '@aurane/sim';
import { t } from '../i18n/index.js';

type Ev = PlayerView['events'][number];
export type Tone = 'bad' | 'good' | 'info' | 'draw';

export interface FeedLine { key: string; at: number; tone: Tone; text: string; system: string | null; recap?: Recap }
export interface Recap { index: number; produced: Record<string, number>; overflow: number; credits: number; productive: number; drawn: number; unpowered: number }

const HOSTILE = new Set(['fleet.inbound', 'blockade.start', 'relay.cut', 'raid.loot', 'refinery.raided', 'sabotage.success', 'fleets.dry', 'relays.unpowered']);
const GOOD = new Set(['system.claimed', 'barter.done', 'treaty.signed', 'alliance.created', 'alliance.joined', 'beacon.lit', 'echo.bonus', 'convoy.arrived', 'salvage', 'probe.done', 'envoy.done', 'depot.loaded']);

export const fill = (tpl: string, vars: Record<string, string | number>): string => tpl.replace(/\{(\w)\}/g, (_, k: string) => String(vars[k] ?? '?'));

export const decreeLabel = (k: Decree | string): string => (k === 'range' ? t('decreeRange') : k === 'freefees' ? t('decreeFreefees') : k === 'longwatch' ? t('decreeLongwatch') : String(k));

export const etaText = (seconds: number): string => {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
};

/** One line per event, from the point of view of `v.me`. Returns null for events the player need not read. */
export function describeEvent(e: Ev, v: PlayerView, i: number): FeedLine | null {
  const me = v.me.id;
  if (e.kind === 'draw') return null; // the per-colony recap replaces the galaxy-wide draw line
  const d = (e.data ?? {}) as Record<string, unknown>;
  const name = (id: string | undefined): string => (id === undefined ? '?' : id === me ? (v.me.name) : v.colonies.find((c) => c.id === id)?.name ?? id);
  const sysName = (id: unknown): string => (typeof id === 'string' ? v.systems.find((s) => s.id === id)?.name ?? id : '?');
  const system = typeof d.system === 'string' ? d.system : null;
  const key = `${e.at}-${e.kind}-${i}`;
  if (e.kind === 'draw.recap') {
    const recap: Recap = { index: Number(d.index ?? 0), produced: (d.produced as Record<string, number>) ?? {}, overflow: Number(d.overflow ?? 0), credits: Number(d.credits ?? 0), productive: Number(d.productive ?? 0), drawn: Number(d.drawn ?? 0), unpowered: Number(d.unpowered ?? 0) };
    return { key, at: e.at, tone: 'draw', text: fill(t('events')['draw.recap'] ?? 'Draw {n}', { n: recap.index + 1 }), system: null, recap };
  }
  const contactKind = e.kind === 'contact.first' ? (d.kind === 'seen' ? 'contact.seen' : Number(d.sectors ?? 0) <= 1 ? 'contact.near' : 'contact.first') : null;
  const tpl = t('events')[contactKind ?? e.kind];
  if (!tpl) return { key, at: e.at, tone: 'info', text: `${e.kind} ${e.actors.map(name).join(' → ')}`, system };
  // Two-party events name the other party as {b} when we are one of the two ("Barter settled with X").
  const other = e.actors.length === 2 && e.actors.includes(me) ? e.actors.find((x) => x !== me) : undefined;
  const a = name(e.actors[0]), b = name(e.kind === 'barter.done' && other ? other : e.actors[1]);
  const n = e.kind === 'battle' ? Number(d.kills ?? 0) : e.kind === 'fleet.inbound' ? Number(d.size ?? 0) : e.kind === 'refinery.raided' || e.kind === 'depot.loaded' ? Number(d.rium ?? 0)
    : e.kind === 'salvage' ? Number(d.metal ?? 0) : e.kind === 'probe.done' ? Number(d.found ?? 0) : e.kind === 'onboarding.unlocked' ? Number(d.tier ?? 0) : e.kind === 'contact.first' ? Number(d.sectors ?? 0) : Number(d.count ?? d.index ?? 0);
  const k = e.kind === 'onboarding.unlocked' ? t(`tier${Number(d.tier ?? 0)}` as 'tier1') : e.kind === 'decree' ? decreeLabel(String(d.kind ?? '')) : e.kind === 'treaty.signed' ? t(String(d.kind ?? 'nap') as 'nap') : String(d.name ?? d.beacon ?? (Array.isArray(d.bands) ? (d.bands as number[]).join(' · ') : ''));
  const eta = e.kind === 'fleet.inbound' ? etaText(Number(d.arriveAt ?? e.at) - e.at) : '';
  const text = fill(tpl, { a, b, s: sysName(d.system), n, k, t: eta });
  // Hostile things done by me are operations; suffered, they are alarms.
  const suffered = e.actors[1] === me || (e.kind === 'fleets.dry' || e.kind === 'relays.unpowered');
  const tone: Tone = HOSTILE.has(e.kind) || (e.kind === 'system.captured' && e.actors[1] === me) ? (suffered ? 'bad' : 'info') : GOOD.has(e.kind) || (e.kind === 'system.captured' && e.actors[0] === me) ? 'good' : 'info';
  return { key, at: e.at, tone, text, system };
}

/** A structured note from the General's journal as a sentence. */
export function describeNote(n: PlayerView['me']['journal'][number], v: PlayerView): string {
  const tpl = t('notes')[n.kind] ?? n.kind;
  const s = n.system ? v.systems.find((x) => x.id === n.system)?.name ?? n.system : '';
  const c = n.colony ? v.colonies.find((x) => x.id === n.colony)?.name ?? n.colony : '';
  return fill(tpl, { s, c });
}

/** Sim seconds → "j2 14:05" (season day and hour), for log timestamps. */
export const stamp = (at: number): string => {
  const day = Math.floor(at / 86400) + 1;
  const h = Math.floor((at % 86400) / 3600), m = Math.floor((at % 3600) / 60);
  return `j${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
