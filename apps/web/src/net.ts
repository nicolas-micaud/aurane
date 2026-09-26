// Talks to the world server: guest creation, the WebSocket view stream and commands.
import { signal } from '@preact/signals';
import type { Command, Faction, Persona } from '@aurane/protocol';
import type { ApplyResult, BattleReport, PlayerView, SystemDetailView } from '@aurane/sim';
import { tError } from './i18n/index.js';

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
  // A token from a past season (or a wiped server) is refused at the upgrade with a plain 401 the socket cannot see:
  // probe once over HTTP and go back to the landing page instead of retrying forever.
  void fetch('/api/me', { headers: { authorization: `Bearer ${token}` } })
    .then((r) => { if (r.status === 401) { forget(); view.value = null; status.value = 'idle'; return; } openSocket(token); })
    .catch(() => openSocket(token));
}

function openSocket(token: string): void {
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
  else toast.value = { text: tError(r.reason), kind: 'err' };
  setTimeout(() => { toast.value = null; }, 2500);
  return r.ok;
}

const authHeaders = (): Record<string, string> => ({ authorization: `Bearer ${getToken() ?? ''}`, 'content-type': 'application/json' });

export async function fetchBriefing(lang: 'fr' | 'en'): Promise<{ text: string; source: string; awaySeconds: number } | null> {
  const res = await fetch(`/api/briefing?lang=${lang}`, { headers: authHeaders() });
  return res.ok ? (await res.json() as { text: string; source: string; awaySeconds: number }) : null;
}

export interface Turn { who: 'me' | 'general'; text: string; at: number }
/** Talk to the General: small talk, questions, orders. */
export async function talk(text: string, lang: 'fr' | 'en'): Promise<{ reply: string; source: string; policyChanged: boolean; history: Turn[] } | null> {
  try {
    const res = await fetch('/api/talk', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text, lang }) });
    return res.ok ? (await res.json() as { reply: string; source: string; policyChanged: boolean; history: Turn[] }) : null;
  } catch { return null; }
}
/** A card of the Draw Counsel in the General's voice (LLM layer, decision 0009). */
export interface CounselCard { id: string; title: string; line: string; command: Command | null; show: { screen: 'galaxy' | 'system' | 'colony' | 'market' | 'general' | 'journal'; system?: string; poi?: string; slot?: string } | null; /** The simulation's own target when the card came from its Counsel. */ raw?: unknown }
export interface CounselView { drawIndex: number; minutesToDraw: number; cards: CounselCard[]; source: string; writtenAt: number }

export async function fetchCounsel(lang: 'fr' | 'en'): Promise<CounselView | null> {
  try { const res = await fetch(`/api/counsel?lang=${lang}`, { headers: authHeaders() }); return res.ok ? (await res.json() as CounselView) : null; } catch { return null; }
}

/** "Do it" / "Not now" on a voice card: the world runs the command and the General remembers the choice. */
export async function answerCounsel(id: string, take: boolean): Promise<{ ok: boolean; reply: string | null }> {
  try {
    const res = await fetch(`/api/counsel/${take ? 'take' : 'skip'}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }) });
    if (!res.ok) return { ok: false, reply: null };
    const body = await res.json() as { ok?: boolean; reply?: string; result?: { ok?: boolean; reason?: string } };
    if (body.result && body.result.ok === false) { toast.value = { text: tError(body.result.reason ?? ''), kind: 'err' }; setTimeout(() => { toast.value = null; }, 2500); return { ok: false, reply: null }; }
    return { ok: body.ok !== false, reply: body.reply ?? null };
  } catch { return { ok: false, reply: null }; }
}

export async function fetchTalk(): Promise<Turn[]> {
  try { const res = await fetch('/api/talk', { headers: authHeaders() }); return res.ok ? ((await res.json() as { history: Turn[] }).history) : []; } catch { return []; }
}

export async function submitDoctrine(text: string, lang: 'fr' | 'en'): Promise<{ summary: string; source: string; warnings: string[]; reply: string } | null> {
  try {
    const res = await fetch('/api/doctrine', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text, lang }) });
    return res.ok ? (await res.json() as { summary: string; source: string; warnings: string[]; reply: string }) : null;
  } catch { return null; }
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

// --- sessions (decision 0010, lot A): the devices holding this colony, leave, cut one off ------------------

export interface SessionInfo { id: string; label: string; createdAt: number; lastSeenAt: number | null; current: boolean }

export async function fetchSessions(): Promise<SessionInfo[]> {
  try { const res = await fetch('/api/sessions', { headers: authHeaders() }); return res.ok ? ((await res.json() as { sessions: SessionInfo[] }).sessions) : []; } catch { return []; }
}

export async function revokeSession(id: string): Promise<boolean> {
  try { return (await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })).ok; } catch { return false; }
}

/** Ends this device's session on the server, forgets the token and returns to the landing page. */
export async function logout(): Promise<void> {
  try { await fetch('/api/session', { method: 'DELETE', headers: authHeaders() }); } catch { /* the token is dropped anyway */ }
  forget();
  const sock = ws; ws = null;
  try { sock?.close(1000, 'logout'); } catch { /* ignore */ }
  view.value = null;
  status.value = 'idle';
}

/** The General's memory of this player, as a file to keep or read; null when the endpoint is not there. */
export async function exportMemory(): Promise<unknown | null> {
  try { const res = await fetch('/api/memory', { headers: authHeaders() }); return res.ok ? await res.json() : null; } catch { return null; }
}

export async function eraseMemory(): Promise<boolean> {
  try { return (await fetch('/api/memory', { method: 'DELETE', headers: authHeaders() })).ok; } catch { return false; }
}

// --- passkeys (decision 0010, lot B) ------------------------------------------------------------------------

export interface AccountInfo { account: { id: string; createdAt: number; email: string | null } | null; passkeys: { id: string; label: string; createdAt: number; lastUsedAt: number | null }[] }

export async function fetchAccount(): Promise<AccountInfo | null> {
  try { const res = await fetch('/api/account', { headers: authHeaders() }); return res.ok ? await res.json() as AccountInfo : null; } catch { return null; }
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && typeof navigator.credentials?.create === 'function';
}

/** Adds a passkey to this colony's account (created on the spot): one tap on the device's own unlock. */
export async function addPasskey(lang: 'fr' | 'en'): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const optRes = await fetch(`/api/auth/passkey/register/options?lang=${lang}`, { method: 'POST', headers: authHeaders() });
    if (!optRes.ok) return { ok: false, reason: 'options' };
    const optionsJSON = await optRes.json();
    const response = await startRegistration({ optionsJSON });
    const res = await fetch('/api/auth/passkey/register/verify', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ response }) });
    if (!res.ok) return { ok: false, reason: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'verify' };
    return { ok: true };
  } catch (err) { return { ok: false, reason: (err as Error).name === 'NotAllowedError' ? 'cancelled' : (err as Error).message }; }
}

/** Signs in with a passkey from the landing page: the account's colony opens here with a fresh session. */
export async function loginWithPasskey(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const optRes = await fetch('/api/auth/passkey/login/options', { method: 'POST' });
    if (!optRes.ok) return { ok: false, reason: 'options' };
    const { handle, options } = await optRes.json() as { handle: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };
    const response = await startAuthentication({ optionsJSON: options });
    const res = await fetch('/api/auth/passkey/login/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, response }) });
    const body = await res.json().catch(() => ({})) as { token?: string; error?: string };
    if (!res.ok || !body.token) return { ok: false, reason: body.error ?? 'verify' };
    setToken(body.token);
    return { ok: true };
  } catch (err) { return { ok: false, reason: (err as Error).name === 'NotAllowedError' ? 'cancelled' : (err as Error).message }; }
}

export async function removePasskey(id: string): Promise<boolean> {
  try { return (await fetch(`/api/account/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })).ok; } catch { return false; }
}

