// Talks to the world server: guest creation, the WebSocket view stream and commands.
import { signal } from '@preact/signals';
import type { Command, Faction, Persona } from '@aurane/protocol';
import type { ApplyResult, BattleReport, PlayerView, SystemDetailView } from '@aurane/sim';

export const view = signal<PlayerView | null>(null);
export const status = signal<'idle' | 'connecting' | 'online' | 'offline'>('idle');
export const toast = signal<{ text: string; kind: 'ok' | 'err' } | null>(null);

const TOKEN_KEY = 'aurane.token';
export const getToken = (): string | null => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t: string): void => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } };
export const forget = (): void => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

export async function createGuest(name: string, faction: Faction, persona: Persona, invite?: string): Promise<void> {
  const res = await fetch('/api/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, faction, persona, ...(invite ? { invite } : {}) }) });
  if (!res.ok) throw new Error((await res.json() as { error: string }).error);
  const { token } = await res.json() as { token: string };
  setToken(token);
}

export interface PublicConfig { requireInvite: boolean; seasonDays: number; seasonSeed: string }
export async function fetchPublicConfig(): Promise<PublicConfig> {
  try { const r = await fetch('/api/public/config'); if (r.ok) return await r.json() as PublicConfig; } catch { /* offline */ }
  return { requireInvite: false, seasonDays: 56, seasonSeed: '' };
}

/** Opens an existing colony on this device from a link code (see requestLink). */
export async function redeem(code: string): Promise<void> {
  const res = await fetch('/api/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  if (!res.ok) throw new Error((await res.json() as { error: string }).error);
  const { token } = await res.json() as { token: string };
  setToken(token);
}

/** A 24 h link that opens this colony on another device. */
export async function requestLink(): Promise<{ code: string; url: string } | null> {
  const token = getToken();
  if (!token) return null;
  const res = await fetch('/api/link', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  return res.ok ? await res.json() as { code: string; url: string } : null;
}

/** `#join=<code>` in the URL: a device link pasted or scanned. */
export function joinCodeFromUrl(): string | null {
  const m = /[#&]join=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]!) : null;
}

let ws: WebSocket | null = null;
let pending = new Map<string, (r: ApplyResult) => void>();
let seq = 0;
let retry = 1000;

export function connect(): void {
  const token = getToken();
  if (!token) return;
  status.value = 'connecting';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onopen = () => { status.value = 'online'; retry = 1000; if (watched) ws?.send(JSON.stringify({ watch: watched })); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as { type: 'view'; view: PlayerView } | { type: 'system'; view: SystemDetailView } | { type: 'result'; id?: string; result: ApplyResult } | { type: 'error'; error: string };
    if (msg.type === 'view') view.value = msg.view;
    else if (msg.type === 'system') { if (msg.view.id === watched && !frozen) systemView.value = msg.view; }
    else if (msg.type === 'result' && msg.id) { pending.get(msg.id)?.(msg.result); pending.delete(msg.id); }
    else if (msg.type === 'error') toast.value = { text: msg.error, kind: 'err' };
  };
  ws.onclose = (ev) => {
    status.value = 'offline';
    for (const fn of pending.values()) fn({ ok: false, reason: 'offline' });
    pending = new Map();
    if (ev.code === 1008 || ev.code === 4401) { forget(); view.value = null; status.value = 'idle'; return; }
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 15000);
  };
}

/** The plateau currently streamed at 2 Hz (System view), or null. */
export const systemView = signal<SystemDetailView | null>(null);
let watched: string | null = null;
export function watch(systemId: string | null): void {
  watched = systemId;
  if (!systemId) systemView.value = null;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ watch: systemId }));
}

export function send(command: Command): Promise<ApplyResult> {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { resolve({ ok: false, reason: 'offline' }); return; }
    const id = String(++seq);
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, command }));
  });
}

export async function act(command: Command, okText?: string): Promise<boolean> {
  const r = await send(command);
  if (r.ok) { if (okText) toast.value = { text: okText, kind: 'ok' }; }
  else toast.value = { text: r.reason, kind: 'err' };
  setTimeout(() => { toast.value = null; }, 2500);
  return r.ok;
}

const authHeaders = (): Record<string, string> => ({ authorization: `Bearer ${getToken() ?? ''}`, 'content-type': 'application/json' });

export async function fetchBriefing(lang: 'fr' | 'en'): Promise<{ text: string; source: string; awaySeconds: number } | null> {
  const res = await fetch(`/api/briefing?lang=${lang}`, { headers: authHeaders() });
  return res.ok ? (await res.json() as { text: string; source: string; awaySeconds: number }) : null;
}

export async function submitDoctrine(text: string, lang: 'fr' | 'en'): Promise<{ summary: string; source: string; warnings: string[] } | null> {
  const res = await fetch('/api/doctrine', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text, lang }) });
  return res.ok ? (await res.json() as { summary: string; source: string; warnings: string[] }) : null;
}

export type BattleSummary = { id: string; system: string; systemName: string; poi: string; startedAt: number; endedAt: number | null; sides: string[]; kills: number };
export async function fetchBattles(): Promise<BattleSummary[]> {
  const res = await fetch('/api/battles', { headers: authHeaders() });
  return res.ok ? (await res.json() as BattleSummary[]) : [];
}
export async function fetchBattle(id: string): Promise<BattleReport | null> {
  const res = await fetch(`/api/battle/${encodeURIComponent(id)}`, { headers: authHeaders() });
  return res.ok ? (await res.json() as BattleReport) : null;
}

// Debug hook for visual checks: open the app with #debug, freeze the stream and set a System frame by hand.
let frozen = false;
if (typeof location !== 'undefined' && location.hash === '#debug') (globalThis as unknown as { __aurane: unknown }).__aurane = { systemView, view, freeze: (on: boolean) => { frozen = on; } };
