// Talks to the world server: guest creation, the WebSocket view stream and commands.
import { signal } from '@preact/signals';
import type { Command, Faction, Persona } from '@aurane/protocol';
import type { ApplyResult, PlayerView, SystemDetailView } from '@aurane/sim';

export const view = signal<PlayerView | null>(null);
export const status = signal<'idle' | 'connecting' | 'online' | 'offline'>('idle');
export const toast = signal<{ text: string; kind: 'ok' | 'err' } | null>(null);

const TOKEN_KEY = 'aurane.token';
export const getToken = (): string | null => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t: string): void => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } };
export const forget = (): void => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

export async function createGuest(name: string, faction: Faction, persona: Persona): Promise<void> {
  const res = await fetch('/api/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, faction, persona }) });
  if (!res.ok) throw new Error((await res.json() as { error: string }).error);
  const { token } = await res.json() as { token: string };
  setToken(token);
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
    else if (msg.type === 'system') { if (msg.view.id === watched) systemView.value = msg.view; }
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
