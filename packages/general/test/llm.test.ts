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
