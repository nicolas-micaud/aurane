// One OpenAI-compatible provider: bounded concurrency, per-attempt timeout, retries with
// exponential backoff and jitter, and a circuit breaker (closed → open → half-open). It never
// decides which model to use: the pool checks that before letting a provider into a class.
import type { ChatMessage, ChatOptions, ChatResult, LlmClient } from './types.js';

export interface ProviderConfig {
  name: string;
  baseUrl: string;                 // e.g. https://api.scaleway.ai/v1
  apiKey?: string | undefined;
  /** Exact model name at this provider (what goes in the request body). */
  model: string;
  /** Canonical model id, compared with the class's pinned model. Defaults to `model`. */
  modelId?: string | undefined;
  concurrency: number;
  timeoutMs?: number | undefined;
  /** Send reasoning_effort: "none" (Infomaniak-style gateways). */
  disableReasoning?: boolean | undefined;
  /** Provider-specific fields merged into every request body, e.g. { enable_thinking: false }. */
  extraBody?: Record<string, unknown> | undefined;
  /** How the provider takes JSON requests: json_object, json_schema (guided decoding), or nothing. */
  jsonMode?: 'off' | 'object' | 'schema' | undefined;
  /** Calls waiting for a slot beyond which the pool treats the provider as saturated. */
  maxQueued?: number | undefined;
  /** Attempts beyond the first on retryable errors (default 1). */
  retries?: number | undefined;
  breaker?: Partial<BreakerConfig> | undefined;
  /** Price per million tokens, EUR, for the cost estimate. */
  priceIn?: number | undefined;
  priceOut?: number | undefined;
}

export interface BreakerConfig {
  /** Consecutive failures that open the circuit. */
  failures: number;
  /** First open window; doubles at each reopening up to `maxOpenMs`. */
  openMs: number;
  maxOpenMs: number;
}

/** Bounded concurrency: excess calls wait, they never hit the model in parallel. */
export class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.queue.shift()?.(); }
  }
  get pending(): number { return this.queue.length; }
  get running(): number { return this.active; }
}

export type BreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker. Closed: calls pass. After N consecutive failures: open for a window, every call is
 * refused without touching the network. When the window ends: half-open, one probe call passes; success
 * closes the circuit, failure reopens it for twice the window.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private window: number;
  private probing = false;
  private opens = 0;
  readonly cfg: BreakerConfig;
  constructor(cfg: Partial<BreakerConfig> = {}, private readonly now: () => number = Date.now) {
    this.cfg = { failures: cfg.failures ?? 3, openMs: cfg.openMs ?? 30000, maxOpenMs: cfg.maxOpenMs ?? 300000 };
    this.window = this.cfg.openMs;
  }
  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.window ? 'half-open' : 'open';
  }
  get timesOpened(): number { return this.opens; }
  /** May a call go through right now? Half-open lets exactly one probe pass at a time. */
  allow(): boolean {
    const s = this.state;
    if (s === 'closed') return true;
    if (s === 'open') return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }
  success(): void { this.failures = 0; this.openedAt = null; this.window = this.cfg.openMs; this.probing = false; }
  failure(): void {
    this.probing = false;
    if (this.openedAt !== null) { // failed while half-open: reopen, longer
      this.window = Math.min(this.cfg.maxOpenMs, this.window * 2);
      this.openedAt = this.now();
      this.opens++;
      return;
    }
    this.failures++;
    if (this.failures >= this.cfg.failures) { this.openedAt = this.now(); this.opens++; }
  }
}

export type ErrorKind = 'timeout' | 'http' | 'network' | 'empty' | 'other';
export class ProviderError extends Error {
  constructor(readonly provider: string, readonly kind: ErrorKind, message: string, readonly status?: number) { super(`${provider}: ${message}`); this.name = 'ProviderError'; }
  /** Worth another attempt? Timeouts, network errors, 429 and 5xx are; other 4xx are not. */
  get retryable(): boolean { return this.kind === 'timeout' || this.kind === 'network' || this.kind === 'empty' || (this.kind === 'http' && (this.status === 429 || (this.status ?? 0) >= 500)); }
}

export type FetchLike = typeof fetch;
export interface ProviderHooks { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; random?: () => number; now?: () => number }

export class OpenAICompatibleClient implements LlmClient {
  readonly name: string;
  readonly modelId: string;
  readonly breaker: CircuitBreaker;
  private readonly sem: Semaphore;
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  constructor(readonly cfg: ProviderConfig, hooks: ProviderHooks = {}) {
    this.name = cfg.name;
    this.modelId = cfg.modelId ?? cfg.model;
    this.sem = new Semaphore(Math.max(1, cfg.concurrency));
    this.breaker = new CircuitBreaker(cfg.breaker ?? {}, hooks.now ?? Date.now);
    this.fetchFn = hooks.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = hooks.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = hooks.random ?? Math.random;
  }

  /** Calls waiting for a slot. */
  get queued(): number { return this.sem.pending; }
  get running(): number { return this.sem.running; }
  get saturated(): boolean { return this.sem.pending >= Math.max(1, this.cfg.maxQueued ?? 8); }

  /** One attempt: the raw request. Throws ProviderError. */
  private async attempt(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      max_tokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.4,
      stream: false,
    };
    if (opts.topP !== undefined) body.top_p = opts.topP;
    if (this.cfg.disableReasoning) body.reasoning_effort = 'none';
    const mode = this.cfg.jsonMode ?? 'off';
    if (opts.json && mode !== 'off') {
      body.response_format = opts.schema && mode === 'schema'
        ? { type: 'json_schema', json_schema: { name: opts.schema.name, schema: opts.schema.schema, strict: true } }
        : { type: 'json_object' };
    }
    if (this.cfg.extraBody) Object.assign(body, this.cfg.extraBody);
    const ctrl = new AbortController();
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs ?? 45000;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw new ProviderError(this.name, 'timeout', `timeout after ${timeoutMs} ms`);
        throw new ProviderError(this.name, 'network', (err as Error).message);
      }
      if (!res.ok) throw new ProviderError(this.name, 'http', `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
      const data = await res.json() as { model?: string; choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? '';
      if (!text) throw new ProviderError(this.name, 'empty', `empty content (finish_reason=${choice?.finish_reason ?? '?'})`);
      return { text, model: data.model ?? this.cfg.model, provider: this.name, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, ms: Date.now() - started, attempts: 1 };
    } finally { clearTimeout(timer); }
  }

  /** Attempts with backoff and jitter behind the semaphore; the breaker is consulted by the pool and updated here. */
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    return this.sem.run(async () => {
      const retries = this.cfg.retries ?? 1;
      let attempts = 0;
      for (;;) {
        attempts++;
        try {
          const r = await this.attempt(messages, opts);
          this.breaker.success();
          return { ...r, attempts };
        } catch (err) {
          const e = err instanceof ProviderError ? err : new ProviderError(this.name, 'other', (err as Error).message);
          this.breaker.failure();
          if (attempts > retries || !e.retryable || this.breaker.state !== 'closed') throw e;
          const backoff = 300 * 2 ** (attempts - 1);
          await this.sleep(backoff + Math.floor(this.random() * backoff));
        }
      }
    });
  }

  async healthy(): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await this.fetchFn(`${this.cfg.baseUrl.replace(/\/$/, '')}/models`, { headers: this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}, signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch { return false; }
  }
}
