// The catalogue (decision 0011, § Décision 5 and 6). One reference price in CHF, here and in the documentation; the
// merchant of record (Stripe Managed Payments) converts and adds the customer's VAT at checkout. Nothing here is ever
// read by the simulation (packages/sim/test/isolation.test.ts): an SKU grants presence, memory or time with the
// characters, never an advantage.

export const SKU_IDS = ['support_founder', 'mecene_season', 'eclats_300', 'companion_season'] as const;
export type SkuId = (typeof SKU_IDS)[number];

export interface Sku {
  id: SkuId;
  /** Reference price, CHF cents, VAT included (the Stripe price is tax_behavior 'inclusive'). */
  priceChfCents: number;
  /** Only sellable SKUs can be put in a checkout. The others are declared so the schema and the copy are ready. */
  sellable: boolean;
  /** Environment variable holding the Stripe price id (price_…) of this SKU. */
  priceEnv: string;
  /** Lifetime of the entitlement after purchase; null = held by the account for good. */
  durationDays: number | null;
  /** A permanent one-off the account can only own once (the checkout refuses a second purchase). */
  unique: boolean;
  /** What it gives, for the documentation and the admin; never a game effect. */
  grants: string;
}

export const CATALOG: Record<SkuId, Sku> = {
  // S0: « Soutenir Aurane », a real one-off purchase from the beta on. A cosmetic founder title, no game effect.
  support_founder: { id: 'support_founder', priceChfCents: 500, sellable: true, priceEnv: 'STRIPE_PRICE_SUPPORT_FOUNDER', durationDays: null, unique: true, grants: 'cosmetic:founder_title' },
  // Declared, not sold yet (Mécène S1, Éclats de Signal, the Chronicler companion).
  mecene_season: { id: 'mecene_season', priceChfCents: 1200, sellable: false, priceEnv: 'STRIPE_PRICE_MECENE_SEASON', durationDays: null, unique: false, grants: 'patron (season): longer conversation caps, richer memoirs, cosmetics' },
  eclats_300: { id: 'eclats_300', priceChfCents: 300, sellable: false, priceEnv: 'STRIPE_PRICE_ECLATS_300', durationDays: 30, unique: false, grants: 'tokens: 300 extra General messages, expire 30 days after purchase' },
  companion_season: { id: 'companion_season', priceChfCents: 300, sellable: false, priceEnv: 'STRIPE_PRICE_COMPANION_SEASON', durationDays: null, unique: false, grants: 'companion:chronicler (season)' },
};

export const isSkuId = (s: unknown): s is SkuId => typeof s === 'string' && (SKU_IDS as readonly string[]).includes(s);

/** The cosmetic founder title is carried by whoever holds this SKU. */
export const FOUNDER_SKU: SkuId = 'support_founder';
