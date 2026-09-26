import { describe, expect, it } from 'vitest';
import { CircuitBreaker, LlmMetrics, LlmUnavailable, OpenAICompatibleClient, ProviderPool, stackFromEnv, TASK_PARAMS, type FetchLike } from '../src/llm/index.js';

/** A fake OpenAI-compatible endpoint: a script of answers, one per call. */
function fakeFetch(script: (() => { status?: number; body?: unknown; abort?: boolean })[]): { fetch: FetchLike; calls: { url: string; body: Record<string, unknown> }[] } {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let i = 0;
  const fetch: FetchLike = async (input, init) => {
    const step = (script[Math.min(i, script.length - 1)] ?? (() => ({})))();
    i++;
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} });
    if (step.abort) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    const status = step.status ?? 200;
    const body = step.body ?? { model: 'm', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

const noSleep = { sleep: async (): Promise<void> => undefined, random: (): number => 0 };
const provider = (name: string, fetch: FetchLike, extra: Partial<ConstructorParameters<typeof OpenAICompatibleClient>[0]> = {}, now?: () => number): OpenAICompatibleClient =>
  new OpenAICompatibleClient({ name, baseUrl: 'http://x/v1', model: 'model-a', concurrency: 2, retries: 1, breaker: { failures: 2, openMs: 1000 }, ...extra }, { fetch, ...noSleep, ...(now ? { now } : {}) });

describe('provider client', () => {
  it('retries a retryable error with backoff, not a 4xx', async () => {
    const a = fakeFetch([() => ({ status: 503, body: 'busy' }), () => ({})]);
    const r = await provider('p', a.fetch).chat([{ role: 'user', content: 'hi' }]);
    expect(r.text).toBe('ok');
    expect(r.attempts).toBe(2);
    expect(a.calls.length).toBe(2);
    const b = fakeFetch([() => ({ status: 400, body: 'bad request' })]);
    await expect(provider('p', b.fetch).chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/HTTP 400/);
    expect(b.calls.length).toBe(1);
  });

  it('sends the task sampling and the JSON schema when the provider supports guided decoding', async () => {
    const a = fakeFetch([() => ({})]);
    const p = provider('p', a.fetch, { jsonMode: 'schema' });
    const pool = new ProviderPool('voice', 'model-a', [p]);
    await pool.chat([{ role: 'user', content: 'hi' }], { task: 'doctrine', schema: { name: 'policy', schema: { type: 'object' } } });
    const body = a.calls[0]!.body;
    expect(body.temperature).toBe(TASK_PARAMS.doctrine.temperature);
    expect(body.top_p).toBe(TASK_PARAMS.doctrine.topP);
    expect(body.max_tokens).toBe(TASK_PARAMS.doctrine.maxTokens);
    expect((body.response_format as { type: string }).type).toBe('json_schema');
    const b = fakeFetch([() => ({})]);
    await new ProviderPool('voice', 'model-a', [provider('q', b.fetch, { jsonMode: 'object' })]).chat([{ role: 'user', content: 'hi' }], { task: 'doctrine', schema: { name: 'policy', schema: {} } });
    expect((b.calls[0]!.body.response_format as { type: string }).type).toBe('json_object');
    // A schema provider asked for JSON without a schema (the Gazette) sends no response_format: Infomaniak 400s json_object.
    const c = fakeFetch([() => ({})]);
    await new ProviderPool('narrative', 'model-a', [provider('ik', c.fetch, { jsonMode: 'schema' })]).chat([{ role: 'user', content: 'hi' }], { task: 'gazette' });
    expect(c.calls[0]!.body.response_format).toBeUndefined();
  });

  it('opens the breaker after consecutive failures, half-opens after the window, closes on a good probe', async () => {
    let t = 0;
    const now = (): number => t;
    const br = new CircuitBreaker({ failures: 2, openMs: 1000, maxOpenMs: 4000 }, now);
    expect(br.state).toBe('closed');
    br.failure(); expect(br.state).toBe('closed');
    br.failure(); expect(br.state).toBe('open'); expect(br.allow()).toBe(false);
    t = 1000; expect(br.state).toBe('half-open');
    expect(br.allow()).toBe(true);   // one probe
    expect(br.allow()).toBe(false);  // not two
    br.failure(); expect(br.state).toBe('open'); // reopened, window doubled
    t = 2000; expect(br.state).toBe('open');
    t = 3000; expect(br.state).toBe('half-open');
    expect(br.allow()).toBe(true); br.success(); expect(br.state).toBe('closed');
    expect(br.timesOpened).toBe(2);
  });
});

describe('provider pool', () => {
  it('refuses a provider that serves another model: no cross-model fallback, ever', () => {
    const a = provider('scaleway', fakeFetch([]).fetch);
    const b = provider('other', fakeFetch([]).fetch, { model: 'model-b' });
    expect(() => new ProviderPool('voice', 'model-a', [a, b])).toThrow(/pinned to model-a/);
  });

  it('moves to the next provider of the same model, skips open breakers, and throws LlmUnavailable when all fail', async () => {
    const t = 0;
    const down = fakeFetch([() => ({ status: 500, body: 'boom' })]);
    const up = fakeFetch([() => ({})]);
    const m = new LlmMetrics();
    const p1 = provider('p1', down.fetch, { retries: 0 }, () => t);
    const p2 = provider('p2', up.fetch, { retries: 0 }, () => t);
    const pool = new ProviderPool('voice', 'model-a', [p1, p2], m);
    const r1 = await pool.chat([{ role: 'user', content: 'hi' }], { task: 'talk' });
    expect(r1.provider).toBe('p2');
    expect(r1.attempts).toBe(2);
    const r2 = await pool.chat([{ role: 'user', content: 'hi' }], { task: 'talk' });
    expect(r2.provider).toBe('p2');
    expect(p1.breaker.state).toBe('open'); // two failures → open
    const before = down.calls.length;
    await pool.chat([{ role: 'user', content: 'hi' }], { task: 'talk' });
    expect(down.calls.length).toBe(before); // open breaker: p1 not even tried
    const snap = m.snapshot();
    expect(snap.providers.find((x) => x.provider === 'p1' && x.task === '*')!.errors).toBe(2);
    expect(snap.providers.find((x) => x.provider === 'p2' && x.task === 'talk')!.calls).toBe(3);
    // Everything down: the pool says so, it does not invent another model.
    const dead = new ProviderPool('voice', 'model-a', [provider('d', fakeFetch([() => ({ status: 502, body: 'x' })]).fetch, { retries: 0 })]);
    await expect(dead.chat([{ role: 'user', content: 'hi' }], { task: 'talk' })).rejects.toBeInstanceOf(LlmUnavailable);
    expect(() => new ProviderPool('voice', 'model-a', [])).not.toThrow();
    await expect(new ProviderPool('voice', 'model-a', []).chat([])).rejects.toThrow(/unconfigured/);
  });

  it('treats a saturated provider as unavailable rather than queueing forever', async () => {
    let release: (() => void) | null = null;
    const slow: FetchLike = async () => { await new Promise<void>((r) => { release = r; }); return new Response(JSON.stringify({ choices: [{ message: { content: 'late' } }] })); };
    const p = new OpenAICompatibleClient({ name: 's', baseUrl: 'http://x', model: 'model-a', concurrency: 1, maxQueued: 1, retries: 0 }, { fetch: slow, ...noSleep });
    const pool = new ProviderPool('voice', 'model-a', [p]);
    const first = pool.chat([{ role: 'user', content: '1' }], { task: 'talk' });
    await new Promise((r) => setTimeout(r, 5));
    // The first call holds the only slot; the second waits (pending = 1 = maxQueued); the third finds the provider saturated.
    const second = pool.chat([{ role: 'user', content: '2' }], { task: 'talk' });
    await new Promise((r) => setTimeout(r, 5));
    await expect(pool.chat([{ role: 'user', content: '3' }], { task: 'talk' })).rejects.toThrow(/saturated/);
    release!();
    await first;
    await new Promise((r) => setTimeout(r, 5));
    release!();
    await second;
  });
});

describe('metrics', () => {
  it('computes p50/p95, tokens and cost per class, provider and task', () => {
    const m = new LlmMetrics();
    m.price('p', { inPerM: 0.15, outPerM: 0.35 });
    for (const ms of [100, 200, 300, 400, 1000]) m.record({ cls: 'voice', provider: 'p', task: 'talk', ok: true, ms, inputTokens: 1000, outputTokens: 100 });
    m.record({ cls: 'voice', provider: 'p', task: 'talk', ok: false, ms: 20000, inputTokens: 0, outputTokens: 0, error: 'timeout' });
    m.degradation('voice', 'talk', 'quota');
    const s = m.snapshot().providers.find((x) => x.task === 'talk')!;
    expect(s.calls).toBe(6); expect(s.errors).toBe(1); expect(s.timeouts).toBe(1);
    expect(s.p50Ms).toBe(300); expect(s.p95Ms).toBe(1000);
    expect(s.inputTokens).toBe(5000);
    expect(s.costEur).toBeCloseTo((5000 * 0.15 + 500 * 0.35) / 1e6, 6);
    expect(m.prometheus()).toContain('aurane_llm_degradations_total{class="voice",task="talk",reason="quota"} 1');
  });
});

describe('configuration', () => {
  it('builds the classes from LLM_<CLASS>_PROVIDERS and refuses a provider of another model', () => {
    const env = {
      LLM_VOICE_MODEL: 'mistral-small-3.2-24b-instruct-2506',
      LLM_VOICE_PROVIDERS: 'scaleway, infomaniak, vllm-local, ghost',
      LLM_PROVIDER_SCALEWAY_BASE_URL: 'https://api.scaleway.ai/v1', LLM_PROVIDER_SCALEWAY_MODEL: 'mistral-small-3.2-24b-instruct-2506', LLM_PROVIDER_SCALEWAY_CONCURRENCY: '8', LLM_PROVIDER_SCALEWAY_JSON_MODE: 'object', LLM_PROVIDER_SCALEWAY_PRICE_IN: '0.15', LLM_PROVIDER_SCALEWAY_PRICE_OUT: '0.35',
      LLM_PROVIDER_INFOMANIAK_BASE_URL: 'https://api.infomaniak.com/2/ai/1/openai/v1', LLM_PROVIDER_INFOMANIAK_MODEL: 'mistralai/Mistral-Small-3.2-24B-Instruct-2506', LLM_PROVIDER_INFOMANIAK_MODEL_ID: 'mistral-small-3.2-24b-instruct-2506', LLM_PROVIDER_INFOMANIAK_DISABLE_REASONING: '1',
      LLM_PROVIDER_VLLM_LOCAL_BASE_URL: 'http://vllm:8000/v1', LLM_PROVIDER_VLLM_LOCAL_MODEL: 'mistralai/Mistral-Small-3.2-24B-Instruct-2506', LLM_PROVIDER_VLLM_LOCAL_MODEL_ID: 'gemma-4-26b',
      LLM_NARRATIVE_MODEL: 'swiss-ai/Apertus-v1.5-70B', LLM_NARRATIVE_PROVIDERS: 'apertus',
      LLM_PROVIDER_APERTUS_BASE_URL: 'https://api.infomaniak.com/2/ai/1/openai/v1', LLM_PROVIDER_APERTUS_MODEL: 'swiss-ai/Apertus-v1.5-70B',
    } as NodeJS.ProcessEnv;
    const s = stackFromEnv(env, new LlmMetrics());
    expect(s.voice!.model).toBe('mistral-small-3.2-24b-instruct-2506');
    expect(s.voice!.providers.map((p) => p.name)).toEqual(['scaleway', 'infomaniak']);
    expect(s.voice!.providers[0]!.cfg.concurrency).toBe(8);
    expect(s.narrative!.providers.map((p) => p.name)).toEqual(['apertus']);
    expect(s.warnings.join('\n')).toMatch(/vllm-local serves gemma-4-26b/);
    expect(s.warnings.join('\n')).toMatch(/ghost listed but/);
  });

  it('builds the recommended stack: a smart voice on two providers, a routine class on its own pinned model', () => {
    const env = {
      LLM_VOICE_MODEL: 'qwen3.5-397b-a17b', LLM_VOICE_PROVIDERS: 'scaleway,infomaniak',
      LLM_PROVIDER_SCALEWAY_BASE_URL: 'https://api.scaleway.ai/v1', LLM_PROVIDER_SCALEWAY_MODEL: 'qwen3.5-397b-a17b', LLM_PROVIDER_SCALEWAY_DISABLE_REASONING: '1', LLM_PROVIDER_SCALEWAY_JSON_MODE: 'schema', LLM_PROVIDER_SCALEWAY_TIMEOUT_MS: '9000',
      LLM_PROVIDER_INFOMANIAK_BASE_URL: 'https://api.infomaniak.com/2/ai/110008/openai/v1', LLM_PROVIDER_INFOMANIAK_MODEL: 'Qwen/Qwen3.5-397B-A17B-FP8', LLM_PROVIDER_INFOMANIAK_MODEL_ID: 'qwen3.5-397b-a17b', LLM_PROVIDER_INFOMANIAK_DISABLE_REASONING: '1', LLM_PROVIDER_INFOMANIAK_JSON_MODE: 'schema',
      LLM_ROUTINE_MODEL: 'mistral-small-3.2-24b-instruct-2506', LLM_ROUTINE_PROVIDERS: 'scaleway-small',
      LLM_PROVIDER_SCALEWAY_SMALL_BASE_URL: 'https://api.scaleway.ai/v1', LLM_PROVIDER_SCALEWAY_SMALL_MODEL: 'mistral-small-3.2-24b-instruct-2506',
    } as NodeJS.ProcessEnv;
    const s = stackFromEnv(env);
    expect(s.voice!.providers.map((p) => p.name)).toEqual(['scaleway', 'infomaniak']);
    expect(s.voice!.providers[0]!.cfg.timeoutMs).toBe(9000);
    expect(s.forTask('talk')).toBe(s.voice);
    expect(s.forTask('doctrine')).toBe(s.voice);
    for (const t of ['counsel', 'briefing', 'episode', 'reaction'] as const) expect(s.forTask(t)!.model).toBe('mistral-small-3.2-24b-instruct-2506');
    expect(s.forTask('gazette')).toBeNull();
    // Without a routine class, routine tasks ride the voice pool (legacy layout unchanged).
    const legacy = stackFromEnv({ LLM_PRIMARY_BASE_URL: 'https://a/v1', LLM_PRIMARY_MODEL: 'm-a' });
    expect(legacy.routine).toBeNull();
    expect(legacy.forTask('counsel')).toBe(legacy.voice);
    expect(legacy.warnings.join('\n')).toMatch(/primary has no _PRICE_IN/);
    expect(s.warnings.join('\n')).toMatch(/scaleway has no _PRICE_IN/);
    const priced = stackFromEnv({ LLM_PRIMARY_BASE_URL: 'https://a/v1', LLM_PRIMARY_MODEL: 'm-a', LLM_PRIMARY_PRICE_IN: '0.15', LLM_PRIMARY_PRICE_OUT: '0.35' });
    expect(priced.voice!.providers[0]!.cfg.priceIn).toBe(0.15);
    expect(priced.warnings.join('\n')).not.toMatch(/PRICE_IN/);
  });

  it('maps the legacy PRIMARY/FALLBACK variables: same model joins voice, another model becomes narrative', () => {
    const base = { LLM_PRIMARY_BASE_URL: 'https://a/v1', LLM_PRIMARY_MODEL: 'm-a', LLM_PRIMARY_CONCURRENCY: '8', LLM_FALLBACK_BASE_URL: 'https://b/v1' } as NodeJS.ProcessEnv;
    const same = stackFromEnv({ ...base, LLM_FALLBACK_MODEL: 'm-a' });
    expect(same.voice!.providers.map((p) => p.name)).toEqual(['primary', 'fallback']);
    expect(same.narrative).toBeNull();
    const other = stackFromEnv({ ...base, LLM_FALLBACK_MODEL: 'apertus-70b' });
    expect(other.voice!.providers.map((p) => p.name)).toEqual(['primary']);
    expect(other.narrative!.model).toBe('apertus-70b');
    expect(other.warnings.join('\n')).toMatch(/not a voice fallback/);
    expect(stackFromEnv({}).voice).toBeNull();
  });
});

describe('monthly budget', () => {
  it('tracks the month\'s spend, fires the alert once at 80 % and the cap once, and resets when the month turns', () => {
    const m = new LlmMetrics();
    m.budget = { eurPerMonth: 10, alertRatio: 0.8 };
    m.price('p', { inPerM: 1e6, outPerM: 0 }); // 1 token = 1 EUR
    const events: string[] = [];
    m.onAlert = (kind) => events.push(kind);
    const saved: number[] = [];
    m.onSpend = (_month, eur) => saved.push(eur);
    const call = (tokens: number): void => m.record({ cls: 'voice', provider: 'p', task: 'talk', ok: true, ms: 1, inputTokens: tokens, outputTokens: 0 });
    call(5); expect(m.overBudget()).toBe(false); expect(events).toEqual([]);
    call(3); expect(events).toEqual(['alert']);
    call(1); expect(events).toEqual(['alert']); // no second alert
    call(2); expect(events).toEqual(['alert', 'cap']); expect(m.overBudget()).toBe(true);
    call(1); expect(events).toEqual(['alert', 'cap']); // no second cap
    expect(saved.at(-1)).toBe(12);
    expect(m.spend()).toMatchObject({ eur: 12, budgetEur: 10, ratio: 1.2, overBudget: true });
    m.seedSpend('1999-01', 12); // another month's figure: the current month starts at zero again
    expect(m.spend().eur).toBe(0);
    expect(m.overBudget()).toBe(false);
    expect(m.prometheus()).toContain('aurane_llm_over_budget 0');
  });
});

describe('call budget and breaker hygiene', () => {
  /** A provider that never answers until its request is aborted (a hung upstream). */
  const hanging: FetchLike = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const hi = [{ role: 'user' as const, content: 'hi' }];

  it('caps each attempt by the provider TIMEOUT_MS so the next provider still gets the rest of the budget', async () => {
    const up = fakeFetch([() => ({})]);
    const slow = provider('scaleway', hanging, { timeoutMs: 60, retries: 0 });
    const fast = provider('infomaniak', up.fetch);
    const t0 = Date.now();
    const r = await new ProviderPool('voice', 'model-a', [slow, fast]).chat(hi, { timeoutMs: 2000 });
    expect(r.provider).toBe('infomaniak');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a call cut by its own tight budget (counsel) neither retries nor opens the breaker', async () => {
    const p = provider('scaleway', hanging, { timeoutMs: 20000, retries: 2, breaker: { failures: 2, openMs: 60000 } });
    const pool = new ProviderPool('voice', 'model-a', [p]);
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await expect(pool.chat(hi, { timeoutMs: 450 })).rejects.toThrow(LlmUnavailable);
      expect(Date.now() - t0).toBeLessThan(1200);
    }
    expect(p.breaker.state).toBe('closed');
  });

  it('a real provider timeout still counts, and is retried only while the budget allows', async () => {
    let n = 0;
    const counting: FetchLike = (input, init) => { n++; return hanging(input, init); };
    const p = provider('scaleway', counting, { timeoutMs: 50, retries: 3, breaker: { failures: 5, openMs: 60000 } });
    await expect(p.chat(hi, { timeoutMs: 700 })).rejects.toThrow(/timeout/);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(3); // 50 ms attempts, 300/600 ms backoffs: the budget stops the fourth
    const q = provider('q', hanging, { timeoutMs: 30, retries: 0, breaker: { failures: 2, openMs: 60000 } });
    await expect(q.chat(hi, { timeoutMs: 5000 })).rejects.toThrow(/timeout/);
    await expect(q.chat(hi, { timeoutMs: 5000 })).rejects.toThrow(/timeout/);
    expect(q.breaker.state).toBe('open');
  });

  it('an answer truncated by max_tokens (reasoning burnt the budget) fails over at once, without retry or breaker', async () => {
    const cut = fakeFetch([() => ({ body: { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 500 } } })]);
    const ok = fakeFetch([() => ({})]);
    const a = provider('a', cut.fetch, { retries: 2 });
    const r = await new ProviderPool('voice', 'model-a', [a, provider('b', ok.fetch)]).chat(hi, { timeoutMs: 5000 });
    expect(r.provider).toBe('b');
    expect(cut.calls.length).toBe(1);
    expect(a.breaker.state).toBe('closed');
  });

  it('a 400 about this request does not open the breaker; a 401 does', async () => {
    const bad = provider('a', fakeFetch([() => ({ status: 400, body: 'context too long' })]).fetch);
    for (let i = 0; i < 3; i++) await expect(bad.chat(hi)).rejects.toThrow(/HTTP 400/);
    expect(bad.breaker.state).toBe('closed');
    const unauth = provider('b', fakeFetch([() => ({ status: 401, body: 'Invalid Authentication' })]).fetch);
    for (let i = 0; i < 2; i++) await expect(unauth.chat(hi)).rejects.toThrow(/HTTP 401/);
    expect(unauth.breaker.state).toBe('open');
  });

  it('frees the half-open probe when the probe ends on a neutral outcome', async () => {
    let t = 0;
    const script = [() => ({ status: 503, body: 'x' }), () => ({ status: 503, body: 'x' }), () => ({ status: 400, body: 'bad' }), () => ({})];
    const p = provider('a', fakeFetch(script).fetch, { retries: 0 }, () => t);
    await expect(p.chat(hi)).rejects.toThrow(); await expect(p.chat(hi)).rejects.toThrow();
    expect(p.breaker.state).toBe('open');
    t = 1000;
    expect(p.breaker.allow()).toBe(true);
    await expect(p.chat(hi)).rejects.toThrow(/HTTP 400/); // neutral: says nothing about health
    expect(p.breaker.allow()).toBe(true);                 // the probe slot is free again
    await p.chat(hi);
    expect(p.breaker.state).toBe('closed');
  });

  it('waiting for a slot counts against the budget', async () => {
    const p = provider('a', hanging, { concurrency: 1, timeoutMs: 5000, retries: 0 });
    const first = p.chat(hi, { timeoutMs: 1500 }).catch(() => undefined);
    const t0 = Date.now();
    await expect(p.chat(hi, { timeoutMs: 600 })).rejects.toThrow(/budget|slot/);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(p.queued).toBe(0);
    await first;
  });
});

describe('breaker and tight budgets without a provider TIMEOUT_MS', () => {
  it('a short task budget on a provider with no TIMEOUT_MS is our budget, not a provider failure', async () => {
    const hang: FetchLike = (_i, init) => new Promise((_r, reject) => { init?.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }); });
    const p = new OpenAICompatibleClient({ name: 'p', baseUrl: 'http://x/v1', model: 'model-a', concurrency: 2, retries: 0, breaker: { failures: 1, openMs: 60000 } }, { fetch: hang });
    await expect(p.chat([{ role: 'user', content: 'hi' }], { timeoutMs: 450 })).rejects.toThrow(/budget/);
    expect(p.breaker.state).toBe('closed');
  });
});
