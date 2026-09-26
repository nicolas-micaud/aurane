// The payment provider seen from the world server: open a hosted checkout, read a verified webhook. The provider is
// the merchant of record; no card ever reaches us (decision 0011). One implementation today: Stripe Managed Payments.
import type { SkuId } from './catalog.js';

export interface CheckoutRequest {
  sku: SkuId;
  accountId: string;
  successUrl: string;
  cancelUrl: string;
  locale: 'fr' | 'en';
}

export interface CheckoutSession {
  /** The hosted payment page the client is sent to. */
  url: string;
  /** The provider's reference for this checkout (Stripe: cs_…). */
  externalRef: string;
}

/** What a verified webhook means for us. Anything we do not act on comes back as `ignored`. */
export type PaymentEvent =
  | { kind: 'paid'; eventId: string; externalRef: string; paymentRef: string | null; accountId: string; sku: string; amountCents: number; currency: string }
  | { kind: 'refunded'; eventId: string; /** A checkout reference or a payment reference. */ ref: string }
  | { kind: 'ignored'; eventId: string; type: string; reason: string };

/** Thrown by parseWebhook when the request is not a genuine, fresh provider event. */
export class WebhookError extends Error {}

export interface PaymentProvider {
  readonly name: 'stripe';
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies the signature over the raw body, then decodes the event. Throws WebhookError when it cannot be trusted. */
  parseWebhook(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): PaymentEvent;
}
