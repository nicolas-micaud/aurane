// Purchases on the world side: open a checkout for an account, turn a verified webhook into an entitlement (exactly
// once, whatever Stripe replays), list what an account holds. The simulation never sees any of it.
import { randomBytes } from 'node:crypto';
import type { EntitlementRecord, Store } from '../store.js';
import { CATALOG, isSkuId, SKU_IDS, type SkuId } from './catalog.js';
import { WebhookError, type PaymentProvider } from './provider.js';

export type CheckoutResult = { ok: true; url: string } | { ok: false; status: number; error: string };
export interface PublicEntitlement { sku: string; createdAt: number; expiresAt: number | null; active: boolean }

export class PaymentService {
  constructor(
    private readonly store: Store,
    private readonly provider: PaymentProvider | null,
    private readonly opts: { publicOrigin: string; onChange?: () => void | Promise<void>; log?: (msg: Record<string, unknown>) => void } ,
  ) {}

  get enabled(): boolean { return this.provider !== null; }

  /** What the client needs to show or hide the buy button: the SKUs on sale and their reference price. */
  publicConfig(): { enabled: boolean; skus: { id: SkuId; priceChf: number }[] } {
    return { enabled: this.enabled, skus: this.enabled ? SKU_IDS.filter((id) => CATALOG[id].sellable).map((id) => ({ id, priceChf: CATALOG[id].priceChfCents / 100 })) : [] };
  }

  async checkout(accountId: string | null, sku: unknown, lang: 'fr' | 'en'): Promise<CheckoutResult> {
    if (!this.provider) return { ok: false, status: 503, error: 'payments_disabled' };
    if (!isSkuId(sku)) return { ok: false, status: 400, error: 'unknown_sku' };
    if (!CATALOG[sku].sellable) return { ok: false, status: 400, error: 'not_sellable' };
    // A purchase belongs to an account (decision 0010): a guest adds a passkey or a rescue e-mail first.
    if (!accountId || !(await this.store.findAccount(accountId))) return { ok: false, status: 409, error: 'account_required' };
    if (CATALOG[sku].unique && (await this.entitlements(accountId)).some((e) => e.sku === sku && e.active)) return { ok: false, status: 409, error: 'already_owned' };
    const base = this.opts.publicOrigin.replace(/\/+$/, '');
    try {
      const s = await this.provider.createCheckout({ sku, accountId, locale: lang, successUrl: `${base}/?paid=${sku}`, cancelUrl: `${base}/?paid=cancel` });
      return { ok: true, url: s.url };
    } catch (err) {
      this.opts.log?.({ msg: 'checkout failed', sku, error: (err as Error).message });
      return { ok: false, status: 502, error: 'provider_error' };
    }
  }

  /**
   * A webhook from the provider. 400 when it cannot be trusted (Stripe will not retry a forged event forever: it
   * gives up after three days), 200 once handled or deliberately ignored, a thrown error (500) when the store failed
   * so that Stripe retries.
   */
  async webhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!this.provider) return { status: 503, body: { error: 'payments_disabled' } };
    let event;
    try { event = this.provider.parseWebhook(rawBody, headers); } catch (err) {
      if (err instanceof WebhookError) return { status: 400, body: { error: err.message } };
      throw err;
    }
    if (event.kind === 'ignored') return { status: 200, body: { received: true, ignored: event.reason } };
    if (event.kind === 'refunded') {
      const n = await this.store.revokeEntitlement(event.ref, Date.now());
      if (n) { this.opts.log?.({ msg: 'entitlement revoked', ref: event.ref, event: event.eventId }); await this.opts.onChange?.(); }
      return { status: 200, body: { received: true, revoked: n } };
    }
    const granted = await this.grant(event);
    return { status: 200, body: { received: true, granted } };
  }

  /** Idempotent: the same checkout reference grants once, however many times the event arrives. */
  async grant(p: { externalRef: string; paymentRef: string | null; accountId: string; sku: string; amountCents: number; currency: string; eventId?: string }): Promise<boolean> {
    if (!isSkuId(p.sku)) { this.opts.log?.({ msg: 'paid for an unknown sku; refund by hand', ...p }); return false; }
    if (!(await this.store.findAccount(p.accountId))) { this.opts.log?.({ msg: 'paid for an unknown account; refund by hand', ...p }); return false; }
    const now = Date.now();
    const days = CATALOG[p.sku].durationDays;
    const rec: EntitlementRecord = {
      id: `E${randomBytes(9).toString('base64url')}`, accountId: p.accountId, sku: p.sku, source: 'stripe',
      externalRef: p.externalRef, paymentRef: p.paymentRef, amountCents: p.amountCents, currency: p.currency,
      createdAt: now, expiresAt: days === null ? null : now + days * 86400000, revokedAt: null,
    };
    const inserted = await this.store.grantEntitlement(rec);
    if (inserted) { this.opts.log?.({ msg: 'entitlement granted', sku: p.sku, account: p.accountId, ref: p.externalRef }); await this.opts.onChange?.(); }
    return inserted;
  }

  async entitlements(accountId: string | null): Promise<PublicEntitlement[]> {
    if (!accountId) return [];
    const now = Date.now();
    return (await this.store.listEntitlements(accountId)).map((e) => ({ sku: e.sku, createdAt: e.createdAt, expiresAt: e.expiresAt, active: e.revokedAt === null && (e.expiresAt === null || e.expiresAt > now) }));
  }
}
