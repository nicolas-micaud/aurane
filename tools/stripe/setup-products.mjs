// Creates, once, the Stripe product and price of « Soutenir Aurane » (decision 0011) and prints the price id to put in
// STRIPE_PRICE_SUPPORT_FOUNDER. Idempotent: the product has a fixed id, the price a lookup_key; a second run finds
// both and changes nothing. Run by hand, never by the CI:
//   STRIPE_SECRET_KEY=sk_live_… node tools/stripe/setup-products.mjs
// A restricted key needs Products: write and Prices: write. Managed Payments must be active on the account first.
//
// Tax code: txcd_10201003 « Video Games - streamed - non subscription - with limited rights ». Aurane is a video game
// played in the browser (streamed from our servers, nothing downloaded), bought once (no subscription), and what is
// bought lives as long as the service does (limited, not permanent, rights: no copy the buyer keeps). It is on the
// Managed Payments allowlist. Stripe asks for the most specific category rather than the generic
// txcd_10000000 « General - Electronically Supplied Services », which remains the fallback (STRIPE_TAX_CODE) if
// Stripe or the fiduciary ever reads the founder title as a donation-like digital service rather than game content.
/* global process, console, fetch, URLSearchParams */

const KEY = process.env.STRIPE_SECRET_KEY;
const VERSION = process.env.STRIPE_API_VERSION || '2025-03-31.basil';
const TAX_CODE = process.env.STRIPE_TAX_CODE || 'txcd_10201003';
const PRODUCT_ID = 'aurane_support_founder';
const LOOKUP_KEY = 'support_founder_chf';
const AMOUNT = 500; // CHF cents, VAT included
if (!KEY) { console.error('set STRIPE_SECRET_KEY (a restricted key with Products: write, Prices: write is enough)'); process.exit(2); }

async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'stripe-version': VERSION, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body,
  });
  const json = await res.json();
  return { status: res.status, json };
}

let product = await stripe('GET', `/products/${PRODUCT_ID}`);
if (product.status === 404) {
  product = await stripe('POST', '/products', {
    id: PRODUCT_ID,
    name: 'Soutenir Aurane — titre de fondateur',
    description: 'Titre cosmétique de Fondateur de l\'Aurane, porté par le compte. Aucun effet sur le jeu.',
    tax_code: TAX_CODE,
    'metadata[sku]': 'support_founder',
  });
  if (product.status >= 300) { console.error('product creation failed:', product.json.error?.message); process.exit(1); }
  console.log(`product created: ${PRODUCT_ID} (tax_code ${TAX_CODE})`);
} else if (product.status >= 300) {
  console.error('product lookup failed:', product.json.error?.message); process.exit(1);
} else {
  console.log(`product exists: ${PRODUCT_ID} (tax_code ${product.json.tax_code ?? 'none'})`);
  if (product.json.tax_code !== TAX_CODE) console.warn(`  warning: tax_code is ${product.json.tax_code}, expected ${TAX_CODE}; not changed`);
}

const found = await stripe('GET', `/prices?${new URLSearchParams({ 'lookup_keys[]': LOOKUP_KEY, active: 'true', limit: '1' })}`);
if (found.status >= 300) { console.error('price lookup failed:', found.json.error?.message); process.exit(1); }
let price = found.json.data?.[0];
if (price) {
  console.log(`price exists: ${price.id}`);
  if (price.unit_amount !== AMOUNT || price.currency !== 'chf' || price.tax_behavior !== 'inclusive' || price.product !== PRODUCT_ID) {
    console.warn(`  warning: existing price is ${price.unit_amount} ${price.currency}, tax_behavior ${price.tax_behavior}, product ${price.product}; not changed`);
  }
} else {
  const created = await stripe('POST', '/prices', {
    product: PRODUCT_ID,
    currency: 'chf',
    unit_amount: String(AMOUNT),
    tax_behavior: 'inclusive',
    lookup_key: LOOKUP_KEY,
    nickname: 'Soutenir Aurane 5 CHF TTC',
    'metadata[sku]': 'support_founder',
  });
  if (created.status >= 300) { console.error('price creation failed:', created.json.error?.message); process.exit(1); }
  price = created.json;
  console.log(`price created: ${price.id}`);
}
console.log(`\nSTRIPE_PRICE_SUPPORT_FOUNDER=${price.id}`);
