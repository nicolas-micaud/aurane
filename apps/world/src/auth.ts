// Passkeys (decision 0010, lot B): an account is born with its first passkey and holds the Colony; signing in
// with a passkey on another device opens the Colony there. WebAuthn ceremonies by @simplewebauthn/server; the
// RP ID is the registrable domain (playaurane.com) so every subdomain, now and later, shares the passkeys.
import { randomBytes } from 'node:crypto';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Colony } from '@aurane/sim';
import type { AccountRecord, CredentialRecord, Store } from './store.js';

export interface PasskeyConfig { rpName: string; rpId: string; origins: string[] }

/** The RP ID for a public origin: the registrable domain when the host has three labels or more, the host otherwise. */
export function rpIdFor(publicOrigin: string): string {
  let host = 'localhost';
  try { host = new URL(publicOrigin).hostname; } catch { /* keep localhost */ }
  if (/^\d+(\.\d+){3}$/.test(host) || host === 'localhost') return host;
  const labels = host.split('.');
  return labels.length >= 3 ? labels.slice(1).join('.') : host;
}

const CHALLENGE_TTL_MS = 5 * 60000;
const toB64 = (u: Uint8Array): string => Buffer.from(u).toString('base64url');
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(Buffer.from(s, 'base64url'));

export class PasskeyService {
  /** Pending challenges: registration keyed by account id, login by a random handle. Single process, short-lived. */
  private readonly challenges = new Map<string, { challenge: string; at: number }>();
  constructor(private readonly store: Store, readonly cfg: PasskeyConfig) {}

  private remember(key: string, challenge: string): void {
    const now = Date.now();
    for (const [k, v] of this.challenges) if (v.at < now - CHALLENGE_TTL_MS) this.challenges.delete(k);
    this.challenges.set(key, { challenge, at: now });
  }
  private take(key: string): string | null {
    const v = this.challenges.get(key);
    this.challenges.delete(key);
    return v && v.at >= Date.now() - CHALLENGE_TTL_MS ? v.challenge : null;
  }

  /** The account holding this colony, created on the spot when the first passkey is about to be added. */
  async accountFor(colony: Colony, lang: 'fr' | 'en', create: boolean): Promise<AccountRecord | null> {
    const id = await this.store.accountOfColony(colony.id);
    if (id) return this.store.findAccount(id);
    if (!create) return null;
    const account: AccountRecord = { id: `A${randomBytes(9).toString('base64url')}`, createdAt: Date.now(), lang, email: null, emailVerifiedAt: null };
    await this.store.createAccount(account);
    await this.store.linkColony(account.id, colony.id, Date.now());
    return account;
  }

  /** What the client shows in the Account tab. */
  async summary(colony: Colony): Promise<{ account: { id: string; createdAt: number; email: string | null } | null; passkeys: { id: string; label: string; createdAt: number; lastUsedAt: number | null }[] }> {
    const account = await this.accountFor(colony, 'fr', false);
    if (!account) return { account: null, passkeys: [] };
    const creds = await this.store.listCredentials(account.id);
    return { account: { id: account.id, createdAt: account.createdAt, email: account.email }, passkeys: creds.map((c) => ({ id: c.id, label: c.label, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })) };
  }

  async registrationOptions(colony: Colony, lang: 'fr' | 'en') {
    const account = (await this.accountFor(colony, lang, true))!;
    const existing = await this.store.listCredentials(account.id);
    const options = await generateRegistrationOptions({
      rpName: this.cfg.rpName, rpID: this.cfg.rpId,
      userName: colony.name, userDisplayName: colony.name, userID: new TextEncoder().encode(account.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    this.remember(`reg:${account.id}`, options.challenge);
    return options;
  }

  async registrationVerify(colony: Colony, response: RegistrationResponseJSON, label: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    const account = await this.accountFor(colony, 'fr', false);
    if (!account) return { ok: false, reason: 'no registration in progress' };
    const expectedChallenge = this.take(`reg:${account.id}`);
    if (!expectedChallenge) return { ok: false, reason: 'challenge expired' };
    let verified;
    try {
      verified = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: this.cfg.origins, expectedRPID: this.cfg.rpId, requireUserVerification: false });
    } catch (err) { return { ok: false, reason: (err as Error).message }; }
    if (!verified.verified || !verified.registrationInfo) return { ok: false, reason: 'not verified' };
    const cred = verified.registrationInfo.credential;
    await this.store.addCredential({ id: cred.id, accountId: account.id, publicKey: toB64(cred.publicKey), counter: cred.counter, transports: cred.transports ?? [], label, createdAt: Date.now(), lastUsedAt: null });
    return { ok: true, id: cred.id };
  }

  async loginOptions(): Promise<{ handle: string; options: Awaited<ReturnType<typeof generateAuthenticationOptions>> }> {
    const options = await generateAuthenticationOptions({ rpID: this.cfg.rpId, userVerification: 'preferred' });
    const handle = randomBytes(12).toString('base64url');
    this.remember(`login:${handle}`, options.challenge);
    return { handle, options };
  }

  /** The account behind a signed assertion, or the reason it is refused. */
  async loginVerify(handle: string, response: AuthenticationResponseJSON): Promise<{ ok: true; account: AccountRecord; credential: CredentialRecord } | { ok: false; reason: string }> {
    const expectedChallenge = this.take(`login:${handle}`);
    if (!expectedChallenge) return { ok: false, reason: 'challenge expired' };
    const cred = await this.store.findCredential(response.id);
    if (!cred) return { ok: false, reason: 'unknown passkey' };
    let verified;
    try {
      verified = await verifyAuthenticationResponse({ response, expectedChallenge, expectedOrigin: this.cfg.origins, expectedRPID: this.cfg.rpId, requireUserVerification: false, credential: { id: cred.id, publicKey: fromB64(cred.publicKey), counter: cred.counter, transports: cred.transports } });
    } catch (err) { return { ok: false, reason: (err as Error).message }; }
    if (!verified.verified) return { ok: false, reason: 'not verified' };
    await this.store.updateCredential(cred.id, { counter: verified.authenticationInfo.newCounter, lastUsedAt: Date.now() });
    const account = await this.store.findAccount(cred.accountId);
    if (!account) return { ok: false, reason: 'account gone' };
    return { ok: true, account, credential: cred };
  }

  async removePasskey(colony: Colony, id: string): Promise<boolean> {
    const account = await this.accountFor(colony, 'fr', false);
    return account ? this.store.deleteCredential(id, account.id) : false;
  }
}
