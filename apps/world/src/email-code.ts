// E-mail codes (decision 0010, lot C): the second way to be oneself, and the rescue when the passkeys are gone.
// A six-digit code, ten minutes, typed in the app (never a link: a link opens the browser, not the installed PWA).
// Adding an address creates the account if the colony has none yet, like the first passkey does.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Colony } from '@aurane/sim';
import type { PasskeyService } from './auth.js';
import { codeMail, type Mailer } from './mail.js';
import type { AccountRecord, Store } from './store.js';

const CODE_TTL_MS = 10 * 60000;
const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Pending { hash: string; email: string; accountId: string | null; at: number; attempts: number }

export const normalizeEmail = (e: string): string => e.trim().toLowerCase();
export const validEmail = (e: string): boolean => e.length <= 254 && EMAIL_RE.test(e);
const hash = (code: string): string => createHash('sha256').update(code).digest('hex');
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class EmailCodeService {
  private readonly pending = new Map<string, Pending>();
  /** The last time a code left for an address, whatever the purpose: one a minute per address. */
  private readonly lastSent = new Map<string, number>();
  /** One code a minute per address; tests shorten the window. */
  constructor(private readonly store: Store, private readonly passkeys: PasskeyService, readonly mailer: Mailer, private readonly resendAfterMs = 60000) {}

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.at < now - CODE_TTL_MS) this.pending.delete(k);
    for (const [k, v] of this.lastSent) if (v < now - CODE_TTL_MS) this.lastSent.delete(k);
  }

  private async issue(key: string, email: string, accountId: string | null, lang: 'fr' | 'en', purpose: 'add' | 'login', colony: string | null): Promise<'sent' | 'too soon'> {
    this.sweep();
    const now = Date.now();
    if ((this.lastSent.get(email) ?? 0) > now - this.resendAfterMs) return 'too soon';
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    this.pending.set(key, { hash: hash(code), email, accountId, at: now, attempts: 0 });
    this.lastSent.set(email, now);
    const m = codeMail(lang, purpose, code, colony);
    await this.mailer.send({ to: email, ...m });
    return 'sent';
  }

  /** Checks a code against a pending entry: spent on success, discarded after too many tries or when stale. */
  private check(key: string, code: string): { ok: true; p: Pending } | { ok: false; reason: string } {
    const p = this.pending.get(key);
    if (!p || p.at < Date.now() - CODE_TTL_MS) { this.pending.delete(key); return { ok: false, reason: 'code expired' }; }
    if (!same(p.hash, hash(code.replace(/\D/g, '')))) {
      p.attempts += 1;
      if (p.attempts >= MAX_ATTEMPTS) { this.pending.delete(key); return { ok: false, reason: 'too many attempts' }; }
      return { ok: false, reason: 'wrong code' };
    }
    this.pending.delete(key);
    return { ok: true, p };
  }

  /** Step one of "add a rescue e-mail": the address must be free; the account is born here if need be. */
  async startAdd(colony: Colony, lang: 'fr' | 'en', rawEmail: string): Promise<{ ok: true } | { ok: false; reason: 'invalid email' | 'already used' | 'too soon' }> {
    const email = normalizeEmail(rawEmail);
    if (!validEmail(email)) return { ok: false, reason: 'invalid email' };
    const account = (await this.passkeys.accountFor(colony, lang, true))!;
    const holder = await this.store.findAccountByEmail(email);
    if (holder && holder.id !== account.id) return { ok: false, reason: 'already used' };
    const r = await this.issue(`add:${account.id}`, email, account.id, lang, 'add', colony.name);
    return r === 'sent' ? { ok: true } : { ok: false, reason: 'too soon' };
  }

  /** Step two: the code matches, the address is the account's, verified now. */
  async verifyAdd(colony: Colony, code: string): Promise<{ ok: true; email: string; account: AccountRecord } | { ok: false; reason: string }> {
    const account = await this.passkeys.accountFor(colony, 'fr', false);
    if (!account) return { ok: false, reason: 'no code pending' };
    const r = this.check(`add:${account.id}`, code);
    if (!r.ok) return r;
    const holder = await this.store.findAccountByEmail(r.p.email);
    if (holder && holder.id !== account.id) return { ok: false, reason: 'already used' };
    await this.store.updateAccount(account.id, { email: r.p.email, emailVerifiedAt: Date.now() });
    return { ok: true, email: r.p.email, account: { ...account, email: r.p.email, emailVerifiedAt: Date.now() } };
  }

  /** Sign in by e-mail: the answer never says whether the address is known; a code only leaves for a real account. */
  async startLogin(rawEmail: string, lang: 'fr' | 'en'): Promise<{ handle: string }> {
    const email = normalizeEmail(rawEmail);
    const handle = randomBytes(12).toString('base64url');
    if (!validEmail(email)) return { handle };
    const account = await this.store.findAccountByEmail(email);
    if (account) await this.issue(`login:${handle}`, email, account.id, lang, 'login', null);
    return { handle };
  }

  async verifyLogin(handle: string, code: string): Promise<{ ok: true; account: AccountRecord } | { ok: false; reason: string }> {
    const r = this.check(`login:${handle}`, code);
    if (!r.ok) return r;
    const account = r.p.accountId ? await this.store.findAccount(r.p.accountId) : null;
    if (!account || !account.email || normalizeEmail(account.email) !== r.p.email) return { ok: false, reason: 'account gone' };
    return { ok: true, account };
  }

  /** Forgetting the address: allowed, the player is warned client-side when nothing else protects the colony. */
  async removeEmail(colony: Colony): Promise<boolean> {
    const account = await this.passkeys.accountFor(colony, 'fr', false);
    if (!account || !account.email) return false;
    await this.store.updateAccount(account.id, { email: null, emailVerifiedAt: null });
    return true;
  }
}
