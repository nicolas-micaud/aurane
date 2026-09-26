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

export class SlotTimeout extends Error { constructor(ms: number) { super(`no free slot within ${ms} ms`); this.name = 'SlotTimeout'; } }

/** Bounded concurrency: excess calls wait, they never hit the model in parallel. */
export class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(readonly max: number) {}
  /** Runs `fn` when a slot frees. With `maxWaitMs`, gives up waiting after that long (throws SlotTimeout, no slot taken). */
  async run<T>(fn: () => Promise<T>, maxWaitMs?: number): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const waiter = (): void => { if (timer) clearTimeout(timer); resolve(); };
        this.queue.push(waiter);
        if (maxWaitMs !== undefined) {
          timer = setTimeout(() => {
            const i = this.queue.indexOf(waiter);
            if (i >= 0) { this.queue.splice(i, 1); reject(new SlotTimeout(maxWaitMs)); }
          }, Math.max(0, maxWaitMs));
        }
      });
    }
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
  /** An outcome that says nothing about the provider's health (our budget ran out, our request was bad): frees a half-open probe slot. */
  neutral(): void { this.probing = false; }
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

/**
 * `timeout`: the provider did not answer within its own TIMEOUT_MS. `budget`: the caller's budget (the task's deadline)
 * ran out first, or no slot freed in time: not the provider's fault. `length`: the answer was cut by max_tokens with no
 * content (a reasoning model thinking aloud): deterministic, not worth a retry on the same provider.
 */
export type ErrorKind = 'timeout' | 'budget' | 'http' | 'network' | 'empty' | 'length' | 'other';
export class ProviderError extends Error {
  constructor(readonly provider: string, readonly kind: ErrorKind, message: string, readonly status?: number) { super(`${provider}: ${message}`); this.name = 'ProviderError'; }
  /** Worth another attempt? Timeouts, network errors, empty answers, 408, 429 and 5xx are; other 4xx, truncations and an exhausted budget are not. */
  get retryable(): boolean { return this.kind === 'timeout' || this.kind === 'network' || this.kind === 'empty' || (this.kind === 'http' && (this.status === 408 || this.status === 429 || (this.status ?? 0) >= 500)); }
  /**
   * Does it say the provider is unhealthy (counts toward its breaker)? Timeouts, network errors, 5xx, 429 and
   * auth/route errors (401/403/404: misconfigured, will not heal by itself) do. Our budget running out, a 400/413/422
   * about this request, or a truncated answer do not: one tight counsel call must not open the breaker for every task.
   */
  get countsAgainstProvider(): boolean {
    if (this.kind === 'budget' || this.kind === 'length') return false;
    if (this.kind === 'http') return this.status === 401 || this.status === 403 || this.status === 404 || this.status === 408 || this.status === 429 || (this.status ?? 0) >= 500;
    return true;
  }
}

/** Below this much remaining budget, an attempt (or a retry) is not started: it could not finish anyway. */
export const MIN_ATTEMPT_MS = 400;

export type FetchLike = typeof fetch;
export interface ProviderHooks { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; random?: () => number; now?: () => number }

/** Per-attempt cap when neither the provider nor the caller sets one. */
const DEFAULT_TIMEOUT_MS = 45000;
/**
 * A timeout says the provider is unhealthy only when the attempt had its full TIMEOUT_MS (or, with none configured,
 * at least this long): a 3 s counsel call cut short is our budget, not the provider's fault.
 */
const HEALTH_TIMEOUT_MS = 10000;

export class OpenAICompatibleClient implements LlmClient {
  readonly name: string;
  readonly modelId: string;
  readonly breaker: CircuitBreaker;
  private readonly sem: Semaphore;
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  constructor(readonly cfg: ProviderConfig, hooks: ProviderHooks = {}) {
    this.name = cfg.name;
    this.modelId = cfg.modelId ?? cfg.model;
    this.sem = new Semaphore(Math.max(1, cfg.concurrency));
    this.breaker = new CircuitBreaker(cfg.breaker ?? {}, hooks.now ?? Date.now);
    this.fetchFn = hooks.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = hooks.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = hooks.random ?? Math.random;
    this.now = hooks.now ?? Date.now;
  }

  /** Calls waiting for a slot. */
  get queued(): number { return this.sem.pending; }
  get running(): number { return this.sem.running; }
  get saturated(): boolean { return this.sem.pending >= Math.max(1, this.cfg.maxQueued ?? 8); }

  /** One attempt: the raw request. Throws ProviderError. */
  private async attempt(messages: ChatMessage[], opts: ChatOptions, timeoutMs: number, cappedByBudget: boolean): Promise<ChatResult> {
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
    // `schema` providers get json_schema when the task has one, and nothing otherwise (the prompt asks for JSON):
    // some gateways (Infomaniak) answer 400 to json_object. `object` providers always get json_object.
    if (opts.json && mode === 'schema' && opts.schema) body.response_format = { type: 'json_schema', json_schema: { name: opts.schema.name, schema: opts.schema.schema, strict: true } };
    else if (opts.json && mode !== 'off' && mode !== 'schema') body.response_format = { type: 'json_object' };
    if (this.cfg.extraBody) Object.assign(body, this.cfg.extraBody);
    const ctrl = new AbortController();
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
        if ((err as Error).name === 'AbortError') throw new ProviderError(this.name, cappedByBudget ? 'budget' : 'timeout', `${cappedByBudget ? 'call budget exhausted' : 'timeout'} after ${timeoutMs} ms`);
        throw new ProviderError(this.name, 'network', (err as Error).message);
      }
      if (!res.ok) throw new ProviderError(this.name, 'http', `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
      const data = await res.json() as { model?: string; choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? '';
      if (!text) throw new ProviderError(this.name, choice?.finish_reason === 'length' ? 'length' : 'empty', `empty content (finish_reason=${choice?.finish_reason ?? '?'})`);
      return { text, model: data.model ?? this.cfg.model, provider: this.name, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, ms: Date.now() - started, attempts: 1 };
    } finally { clearTimeout(timer); }
  }

  /**
   * Attempts with backoff and jitter behind the semaphore, all within one budget: `opts.deadline` (set by the pool) or
   * `opts.timeoutMs` from now. Each attempt is capped by the provider's TIMEOUT_MS and by what is left of the budget;
   * waiting for a slot counts against it. The breaker is consulted by the pool and updated here, only with outcomes
   * that say something about the provider (see ProviderError.countsAgainstProvider).
   */
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const deadline = opts.deadline ?? this.now() + (opts.timeoutMs ?? this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const perAttempt = this.cfg.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const left = (): number => deadline - this.now();
    if (left() < MIN_ATTEMPT_MS) { this.breaker.neutral(); throw new ProviderError(this.name, 'budget', 'call budget exhausted before the first attempt'); }
    try {
      return await this.sem.run(async () => {
        const retries = this.cfg.retries ?? 1;
        let attempts = 0;
        for (;;) {
          attempts++;
          const remaining = left();
          const timeoutMs = Math.max(1, Math.min(perAttempt, remaining));
          try {
            const r = await this.attempt(messages, opts, timeoutMs, timeoutMs < (this.cfg.timeoutMs ?? HEALTH_TIMEOUT_MS));
            this.breaker.success();
            return { ...r, attempts };
          } catch (err) {
            const e = err instanceof ProviderError ? err : new ProviderError(this.name, 'other', (err as Error).message);
            if (e.countsAgainstProvider) this.breaker.failure(); else this.breaker.neutral();
            if (attempts > retries || !e.retryable || this.breaker.state !== 'closed') throw e;
            const backoff = 300 * 2 ** (attempts - 1);
            const pause = backoff + Math.floor(this.random() * backoff);
            if (left() - pause < MIN_ATTEMPT_MS) throw e; // no time left for another try: let the pool move on
            await this.sleep(pause);
          }
        }
      }, Math.max(0, left() - MIN_ATTEMPT_MS));
    } catch (err) {
      if (err instanceof SlotTimeout) { this.breaker.neutral(); throw new ProviderError(this.name, 'budget', err.message); }
      throw err;
    }
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
