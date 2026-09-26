import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { createHttpServer } from '../src/http.js';
import { FileStore } from '../src/store.js';
import { CATALOG } from '../src/payments/catalog.js';
import { PaymentService } from '../src/payments/service.js';
import { signStripePayload, StripeManagedPayments, stripeConfigFromEnv, verifyStripeSignature } from '../src/payments/stripe.js';
import { WebhookError } from '../src/payments/provider.js';

const SECRET = 'whsec_test_secret';
const now = () => Math.floor(Date.now() / 1000);

function completed(session: string, account: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: `evt_${session}`, type: 'checkout.session.completed', data: { object: { id: session, object: 'checkout.session', payment_status: 'paid', client_reference_id: account, metadata: { sku: 'support_founder', account }, amount_total: 500, currency: 'chf', payment_intent: `pi_${session}`, ...extra } } });
}

/** A fake Stripe API: records the checkout requests, answers a hosted URL. */
function fakeStripe() {
  const calls: { url: string; headers: Record<string, string>; form: URLSearchParams }[] = [];
  let n = 0;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, form: new URLSearchParams(String(init?.body)) });
    n++;
    return new Response(JSON.stringify({ id: `cs_test_${n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}` }), { status: 200 });
  }) as typeof fetch;
  return { calls, provider: new StripeManagedPayments({ secretKey: 'sk_test_x', webhookSecret: SECRET, prices: { support_founder: 'price_founder' }, fetch: fetchFn }) };
}

describe('Stripe-Signature verification', () => {
  const body = completed('cs_1', 'Aabc');
  it('accepts a valid signature', () => {
    expect(() => verifyStripeSignature(body, signStripePayload(body, SECRET, now()), SECRET, now())).not.toThrow();
    // Several v1 entries (secret rotation): one match is enough.
    const t = now();
    const header = `t=${t},v1=${'0'.repeat(64)},${signStripePayload(body, SECRET, t).split(',')[1]}`;
    expect(() => verifyStripeSignature(Buffer.from(body), header, SECRET, t)).not.toThrow();
  });
  it('refuses a bad signature, a tampered body, another secret', () => {
    const t = now();
    expect(() => verifyStripeSignature(body, `t=${t},v1=${'a'.repeat(64)}`, SECRET, t)).toThrow('bad signature');
    expect(() => verifyStripeSignature(body.replace('500', '5'), signStripePayload(body, SECRET, t), SECRET, t)).toThrow('bad signature');
    expect(() => verifyStripeSignature(body, signStripePayload(body, 'whsec_other', t), SECRET, t)).toThrow(WebhookError);
  });
  it('refuses a stale or future timestamp (5 minutes)', () => {
    const t = now() - 301;
    expect(() => verifyStripeSignature(body, signStripePayload(body, SECRET, t), SECRET, now())).toThrow('stale signature');
    expect(() => verifyStripeSignature(body, signStripePayload(body, SECRET, now() + 400), SECRET, now())).toThrow('stale signature');
    expect(() => verifyStripeSignature(body, signStripePayload(body, SECRET, now() - 299), SECRET, now())).not.toThrow();
  });
  it('refuses a missing or malformed header', () => {
    expect(() => verifyStripeSignature(body, undefined, SECRET, now())).toThrow('missing signature');
    expect(() => verifyStripeSignature(body, 'v1=abc', SECRET, now())).toThrow('malformed signature');
  });
});

describe('Stripe Managed Payments provider', () => {
  it('opens a managed-payments checkout, form-encoded, on the pinned API version', async () => {
    const { calls, provider } = fakeStripe();
    const s = await provider.createCheckout({ sku: 'support_founder', accountId: 'Aabc', successUrl: 'https://play.example/?paid=support_founder', cancelUrl: 'https://play.example/?paid=cancel', locale: 'en' });
    expect(s.url).toContain('checkout.stripe.com');
    const c = calls[0]!;
    expect(c.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(c.headers.authorization).toBe('Bearer sk_test_x');
    expect(c.headers['stripe-version']).toBe('2025-03-31.basil');
    expect(Object.fromEntries(c.form)).toMatchObject({ mode: 'payment', 'line_items[0][price]': 'price_founder', 'line_items[0][quantity]': '1', 'managed_payments[enabled]': 'true', client_reference_id: 'Aabc', 'metadata[sku]': 'support_founder', 'metadata[account]': 'Aabc', locale: 'en' });
  });
  it('decodes paid, pending, refunded and foreign events', () => {
    const { provider } = fakeStripe();
    const sign = (b: string) => ({ 'stripe-signature': signStripePayload(b, SECRET, now()) });
    const paid = completed('cs_2', 'Aabc');
    expect(provider.parseWebhook(paid, sign(paid))).toMatchObject({ kind: 'paid', externalRef: 'cs_2', paymentRef: 'pi_cs_2', accountId: 'Aabc', sku: 'support_founder', amountCents: 500, currency: 'chf' });
    const pending = completed('cs_3', 'Aabc', { payment_status: 'unpaid' });
    expect(provider.parseWebhook(pending, sign(pending)).kind).toBe('ignored');
    const later = completed('cs_3', 'Aabc').replace('checkout.session.completed', 'checkout.session.async_payment_succeeded');
    expect(provider.parseWebhook(later, sign(later)).kind).toBe('paid');
    const refund = JSON.stringify({ id: 'evt_r', type: 'charge.refunded', data: { object: { payment_intent: 'pi_cs_2', refunded: true } } });
    expect(provider.parseWebhook(refund, sign(refund))).toEqual({ kind: 'refunded', eventId: 'evt_r', ref: 'pi_cs_2' });
    const partial = refund.replace('"refunded":true', '"refunded":false');
    expect(provider.parseWebhook(partial, sign(partial)).kind).toBe('ignored');
    const foreign = JSON.stringify({ id: 'evt_f', type: 'checkout.session.completed', data: { object: { id: 'cs_f', payment_status: 'paid', metadata: {} } } });
    expect(provider.parseWebhook(foreign, sign(foreign)).kind).toBe('ignored');
    expect(() => provider.parseWebhook(paid, { 'stripe-signature': 't=1,v1=' + 'b'.repeat(64) })).toThrow(WebhookError);
  });
  it('is disabled unless the key, the webhook secret and the founder price are all set', () => {
    expect(stripeConfigFromEnv({})).toBeNull();
    expect(stripeConfigFromEnv({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' })).toBeNull();
    expect(stripeConfigFromEnv({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', STRIPE_PRICE_SUPPORT_FOUNDER: 'price_1' })?.prices.support_founder).toBe('price_1');
  });
});

describe('catalogue (decision 0011)', () => {
  it('sells only « Soutenir Aurane » for now, at 5 CHF', () => {
    expect(Object.values(CATALOG).filter((s) => s.sellable).map((s) => s.id)).toEqual(['support_founder']);
    expect(CATALOG.support_founder.priceChfCents).toBe(500);
    expect(CATALOG.mecene_season.priceChfCents).toBe(1200);
    expect(CATALOG.eclats_300.durationDays).toBe(30);
  });
});

describe('entitlement grant', () => {
  it('grants once per checkout session, however many times Stripe replays it', async () => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), 'aurane-pay-')));
    await store.createAccount({ id: 'Aone', createdAt: Date.now(), lang: 'fr', email: null, emailVerifiedAt: null });
    const { provider } = fakeStripe();
    const svc = new PaymentService(store, provider, { publicOrigin: 'https://play.example' });
    const body = completed('cs_idem', 'Aone');
    const headers = { 'stripe-signature': signStripePayload(body, SECRET, now()) };
    const first = await svc.webhook(Buffer.from(body), headers);
    const second = await svc.webhook(Buffer.from(body), headers);
    const third = await svc.webhook(Buffer.from(body.replace('checkout.session.completed', 'checkout.session.async_payment_succeeded')), { 'stripe-signature': signStripePayload(body.replace('checkout.session.completed', 'checkout.session.async_payment_succeeded'), SECRET, now()) });
    expect([first.body.granted, second.body.granted, third.body.granted]).toEqual([true, false, false]);
    expect(await store.listEntitlements('Aone')).toHaveLength(1);
    // Survives a restart of the file store.
    expect(await new FileStore((store as unknown as { dir: string }).dir).listEntitlements('Aone')).toHaveLength(1);
  });
  it('answers payments_disabled without a provider', async () => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), 'aurane-pay-')));
    const svc = new PaymentService(store, null, { publicOrigin: 'https://play.example' });
    expect(svc.publicConfig()).toEqual({ enabled: false, skus: [] });
    expect(await svc.checkout('Aone', 'support_founder', 'fr')).toEqual({ ok: false, status: 503, error: 'payments_disabled' });
    expect((await svc.webhook(Buffer.from('{}'), {})).status).toBe(503);
  });
});

describe('payment routes', () => {
  let engine: Engine; let server: ReturnType<typeof createHttpServer>; let base: string;
  let off: { engine: Engine; server: ReturnType<typeof createHttpServer>; base: string };
  const stripe = fakeStripe();

  async function start(env: Record<string, string>, payments?: StripeManagedPayments | null) {
    const dir = await mkdtemp(join(tmpdir(), 'aurane-pay-'));
    const e = new Engine(loadConfig({ SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '2', SEASON_SEED: 'pay-test', PUBLIC_ORIGIN: 'https://play.example', ...env }), new FileStore(dir));
    await e.init();
    const s = createHttpServer(e, payments === undefined ? {} : { payments });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    return { engine: e, server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
  }

  beforeAll(async () => {
    ({ engine, server, base } = await start({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_SUPPORT_FOUNDER: 'price_founder' }, stripe.provider));
    off = await start({});
  });
  afterAll(async () => {
    for (const x of [{ engine, server }, off]) { await x.engine.stop(); await new Promise<void>((r) => x.server.close(() => r())); }
  });

  const guest = async (b: string, name: string) => (await (await fetch(`${b}/api/guest`, { method: 'POST', body: JSON.stringify({ name, faction: 'guild', persona: 'oriel' }) })).json()) as { token: string; colonyId: string };
  const post = (url: string, token: string, body: unknown) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const webhook = (body: string, sig = signStripePayload(body, SECRET, now())) => fetch(`${base}/api/pay/webhook`, { method: 'POST', headers: { 'stripe-signature': sig, 'content-type': 'application/json' }, body });

  it('disabled: config says so, the routes answer 503 payments_disabled', async () => {
    const cfg = await (await fetch(`${off.base}/api/public/config`)).json() as { payments: { enabled: boolean } };
    expect(cfg.payments.enabled).toBe(false);
    const g = await guest(off.base, 'Off');
    const r = await post(`${off.base}/api/pay/checkout`, g.token, { sku: 'support_founder' });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'payments_disabled' });
    expect((await fetch(`${off.base}/api/pay/webhook`, { method: 'POST', body: '{}' })).status).toBe(503);
  });

  it('checkout needs an account, a known and sellable SKU; the webhook grants the founder title once', async () => {
    const cfg = await (await fetch(`${base}/api/public/config`)).json() as { payments: { enabled: boolean; skus: { id: string; priceChf: number }[] } };
    expect(cfg.payments).toEqual({ enabled: true, skus: [{ id: 'support_founder', priceChf: 5 }] });
    const g = await guest(base, 'Payer');
    expect((await fetch(`${base}/api/account/entitlements`)).status).toBe(401);
    // A guest has no account yet: buy nothing that could be lost with the device.
    let r = await post(`${base}/api/pay/checkout`, g.token, { sku: 'support_founder' });
    expect([r.status, (await r.json() as { error: string }).error]).toEqual([409, 'account_required']);
    const store = engine.persistence;
    await store.createAccount({ id: 'Apayer', createdAt: Date.now(), lang: 'fr', email: 'p@example.com', emailVerifiedAt: Date.now() });
    await store.linkColony('Apayer', g.colonyId, Date.now());
    r = await post(`${base}/api/pay/checkout`, g.token, { sku: 'nope' });
    expect([r.status, (await r.json() as { error: string }).error]).toEqual([400, 'unknown_sku']);
    r = await post(`${base}/api/pay/checkout`, g.token, { sku: 'mecene_season' });
    expect([r.status, (await r.json() as { error: string }).error]).toEqual([400, 'not_sellable']);
    r = await post(`${base}/api/pay/checkout`, g.token, { sku: 'support_founder', lang: 'en' });
    expect(r.status).toBe(200);
    expect((await r.json() as { url: string }).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const form = stripe.calls.at(-1)!.form;
    expect(form.get('client_reference_id')).toBe('Apayer');
    expect(form.get('success_url')).toBe('https://play.example/?paid=support_founder');

    expect((await webhook(completed('cs_route', 'Apayer'), `t=${now()},v1=${'c'.repeat(64)}`)).status).toBe(400);
    expect(engine.publicSummary().colonies.find((c) => c.id === g.colonyId)?.founder).toBe(false);
    const w1 = await webhook(completed('cs_route', 'Apayer'));
    const w2 = await webhook(completed('cs_route', 'Apayer'));
    expect([w1.status, w2.status]).toEqual([200, 200]);
    expect([(await w1.json() as { granted: boolean }).granted, (await w2.json() as { granted: boolean }).granted]).toEqual([true, false]);
    const mine = await (await fetch(`${base}/api/account/entitlements`, { headers: { authorization: `Bearer ${g.token}` } })).json() as { account: boolean; entitlements: { sku: string; active: boolean }[] };
    expect(mine.account).toBe(true);
    expect(mine.entitlements).toEqual([expect.objectContaining({ sku: 'support_founder', active: true })]);
    // The title is shown where the colony is shown to others: presentation only.
    expect(engine.publicSummary().colonies.find((c) => c.id === g.colonyId)?.founder).toBe(true);
    expect(await (await fetch(`${base}/c/${g.colonyId}`)).text()).toContain('Fondateur de l');
    r = await post(`${base}/api/pay/checkout`, g.token, { sku: 'support_founder' });
    expect([r.status, (await r.json() as { error: string }).error]).toEqual([409, 'already_owned']);

    // A full refund takes the title back.
    const refund = JSON.stringify({ id: 'evt_refund', type: 'charge.refunded', data: { object: { payment_intent: 'pi_cs_route', refunded: true } } });
    expect((await webhook(refund)).status).toBe(200);
    expect(engine.publicSummary().colonies.find((c) => c.id === g.colonyId)?.founder).toBe(false);
    const after = await (await fetch(`${base}/api/account/entitlements`, { headers: { authorization: `Bearer ${g.token}` } })).json() as { entitlements: { active: boolean }[] };
    expect(after.entitlements[0]!.active).toBe(false);
  });
});
