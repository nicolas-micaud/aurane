// Stripe Managed Payments (Stripe is the merchant of record: it sells, collects and remits the customer's VAT, and
// answers the customer). Plain fetch against the REST API, no SDK. Docs:
// https://docs.stripe.com/payments/managed-payments/set-up, https://docs.stripe.com/webhooks#verify-manually.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookError, type CheckoutRequest, type CheckoutSession, type PaymentEvent, type PaymentProvider } from './provider.js';
import type { SkuId } from './catalog.js';

/** Managed Payments needs 2025-03-31.basil or later. */
export const STRIPE_API_VERSION = '2025-03-31.basil';
/** Stripe's own default tolerance: an event older than five minutes is a replay. */
export const SIGNATURE_TOLERANCE_S = 300;

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Stripe price id (price_…) per sellable SKU. */
  prices: Partial<Record<SkuId, string>>;
  apiVersion?: string;
  apiBase?: string;
  fetch?: typeof fetch;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

/**
 * Verifies a `Stripe-Signature` header (`t=…,v1=…[,v1=…]`): HMAC-SHA256 of `${t}.${rawBody}` with the endpoint's
 * signing secret, compared in constant time, timestamp within the tolerance. Throws WebhookError otherwise.
 */
export function verifyStripeSignature(rawBody: Buffer | string, header: string | undefined, secret: string, nowS: number, toleranceS = SIGNATURE_TOLERANCE_S): void {
  if (!header) throw new WebhookError('missing signature');
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (t === null || !v1.length) throw new WebhookError('malformed signature');
  if (Math.abs(nowS - t) > toleranceS) throw new WebhookError('stale signature');
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  const ok = v1.some((sig) => { const got = Buffer.from(sig, 'hex'); return got.length === expected.length && timingSafeEqual(got, expected); });
  if (!ok) throw new WebhookError('bad signature');
}

/** Signs a payload the way Stripe does; used by the tests and by local tooling. */
export function signStripePayload(rawBody: string, secret: string, t: number): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
/** A reference that may come expanded (an object with an id) or as a bare id. */
const ref = (v: unknown): string | null => str(v) ?? (v && typeof v === 'object' ? str((v as Obj).id) : null);

export class StripeManagedPayments implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly fetchFn: typeof fetch;
  constructor(private readonly cfg: StripeConfig) { this.fetchFn = cfg.fetch ?? fetch; }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const price = this.cfg.prices[req.sku];
    if (!price) throw new Error(`no Stripe price for ${req.sku}`);
    const form = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      'managed_payments[enabled]': 'true',
      client_reference_id: req.accountId,
      'metadata[sku]': req.sku,
      'metadata[account]': req.accountId,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      locale: req.locale,
    });
    const res = await this.fetchFn(`${this.cfg.apiBase ?? 'https://api.stripe.com'}/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'stripe-version': this.cfg.apiVersion ?? STRIPE_API_VERSION,
        // One checkout per account, SKU and minute: a double click does not open two sessions.
        'idempotency-key': `checkout:${req.accountId}:${req.sku}:${Math.floor(Date.now() / 60000)}`,
      },
      body: form.toString(),
    });
    const body = await res.json().catch(() => null) as Obj | null;
    if (!res.ok || !body) {
      const err = body?.error as Obj | undefined;
      throw new Error(`stripe checkout failed (${res.status}): ${str(err?.message) ?? 'no body'}`);
    }
    const url = str(body.url); const id = str(body.id);
    if (!url || !id) throw new Error('stripe checkout: no url in the answer');
    return { url, externalRef: id };
  }

  parseWebhook(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): PaymentEvent {
    const h = headers['stripe-signature'];
    verifyStripeSignature(rawBody, Array.isArray(h) ? h[0] : h, this.cfg.webhookSecret, this.cfg.now?.() ?? Math.floor(Date.now() / 1000));
    let event: Obj;
    try { event = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')) as Obj; } catch { throw new WebhookError('bad json'); }
    const eventId = str(event.id) ?? '';
    const type = str(event.type) ?? '';
    const obj = ((event.data as Obj | undefined)?.object ?? {}) as Obj;
    const ignore = (reason: string): PaymentEvent => ({ kind: 'ignored', eventId, type, reason });
    switch (type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        // completed with an unpaid session = a delayed method still pending; async_payment_succeeded will follow.
        if (obj.payment_status !== 'paid') return ignore(`payment_status ${String(obj.payment_status)}`);
        const meta = (obj.metadata ?? {}) as Obj;
        const accountId = str(meta.account) ?? str(obj.client_reference_id);
        const sku = str(meta.sku);
        const id = str(obj.id);
        if (!id || !accountId || !sku) return ignore('not an Aurane checkout (no account or sku metadata)');
        if (str(obj.client_reference_id) && str(obj.client_reference_id) !== accountId) return ignore('account mismatch');
        return { kind: 'paid', eventId, externalRef: id, paymentRef: ref(obj.payment_intent), accountId, sku, amountCents: typeof obj.amount_total === 'number' ? obj.amount_total : 0, currency: (str(obj.currency) ?? 'chf').toLowerCase() };
      }
      case 'charge.refunded': {
        // Only a full refund takes the title back; a partial one is a gesture, not a cancellation.
        const pi = ref(obj.payment_intent);
        if (!pi) return ignore('no payment_intent');
        if (obj.refunded !== true) return ignore('partial refund');
        return { kind: 'refunded', eventId, ref: pi };
      }
      case 'charge.dispute.closed': {
        const pi = ref(obj.payment_intent);
        if (!pi || obj.status !== 'lost') return ignore('dispute not lost');
        return { kind: 'refunded', eventId, ref: pi };
      }
      default:
        return ignore('unhandled type');
    }
  }
}

/** Stripe is configured only when the key, the webhook secret and the founder price are all there; otherwise null and
 *  payments are disabled (the routes answer 503 payments_disabled, the client hides the button). */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY; const webhookSecret = env.STRIPE_WEBHOOK_SECRET; const founder = env.STRIPE_PRICE_SUPPORT_FOUNDER;
  if (!secretKey || !webhookSecret || !founder) return null;
  return { secretKey, webhookSecret, prices: { support_founder: founder }, ...(env.STRIPE_API_VERSION ? { apiVersion: env.STRIPE_API_VERSION } : {}) };
}
