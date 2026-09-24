// OpenAI-compatible chat client with primary/fallback failover and a bounded queue.
// rog1 (llama.cpp) serves ~2 concurrent requests; Infomaniak has its own quirks (no
// json_object, reasoning_effort "none" to silence chain-of-thought). Nothing else in the
// game talks to a model directly.

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatOptions { maxTokens?: number; temperature?: number; json?: boolean; timeoutMs?: number }
export interface ChatResult { text: string; model: string; provider: string; inputTokens: number; outputTokens: number; ms: number }

export interface LlmClient {
  readonly name: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  healthy(): Promise<boolean>;
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;          // e.g. http://rog1:8007/v1 or https://api.infomaniak.com/2/ai/<id>/openai/v1
  apiKey?: string | undefined;
  model: string;
  concurrency: number;
  /** Send reasoning_effort: "none" (Infomaniak-style gateways). */
  disableReasoning?: boolean;
  timeoutMs?: number;
}

/** Bounded concurrency: excess calls wait, they never hit the model in parallel. */
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.queue.shift()?.(); }
  }
  get pending(): number { return this.queue.length; }
}

export class OpenAICompatibleClient implements LlmClient {
  readonly name: string;
  private readonly sem: Semaphore;
  constructor(private readonly cfg: ProviderConfig) {
    this.name = cfg.name;
    this.sem = new Semaphore(Math.max(1, cfg.concurrency));
  }

  get queued(): number { return this.sem.pending; }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    return this.sem.run(async () => {
      const started = Date.now();
      const body: Record<string, unknown> = {
        model: this.cfg.model,
        messages,
        max_tokens: opts.maxTokens ?? 800,
        temperature: opts.temperature ?? 0.4,
        stream: false,
      };
      if (this.cfg.disableReasoning) body.reasoning_effort = 'none';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? this.cfg.timeoutMs ?? 45000);
      try {
        const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`${this.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        const data = await res.json() as { model?: string; choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const choice = data.choices?.[0];
        const text = choice?.message?.content ?? '';
        if (!text) throw new Error(`${this.name}: empty content (finish_reason=${choice?.finish_reason ?? '?'})`);
        return { text, model: data.model ?? this.cfg.model, provider: this.name, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, ms: Date.now() - started };
      } finally { clearTimeout(timer); }
    });
  }

  async healthy(): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/models`, { headers: this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}, signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch { return false; }
  }
}

/** Primary first; on error, timeout or saturation, the fallback. Primary is retried after a cool-down. */
export class FailoverClient implements LlmClient {
  readonly name = 'failover';
  private primaryDownUntil = 0;
  constructor(private readonly primary: OpenAICompatibleClient, private readonly fallback: LlmClient | null, private readonly opts: { maxQueued?: number; cooldownMs?: number } = {}) {}

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const now = Date.now();
    const saturated = this.primary.queued >= (this.opts.maxQueued ?? 8);
    if (now >= this.primaryDownUntil && !saturated) {
      try { return await this.primary.chat(messages, opts); } catch (err) {
        this.primaryDownUntil = now + (this.opts.cooldownMs ?? 60000);
        if (!this.fallback) throw err;
      }
    }
    if (!this.fallback) throw new Error('primary unavailable and no fallback configured');
    return this.fallback.chat(messages, opts);
  }

  async healthy(): Promise<boolean> {
    return (await this.primary.healthy()) || (this.fallback ? this.fallback.healthy() : false);
  }
}

/** Build the client stack from LLM_PRIMARY_* / LLM_FALLBACK_* env vars; null when nothing is configured. */
export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient | null {
  const primary = env.LLM_PRIMARY_BASE_URL && env.LLM_PRIMARY_MODEL
    ? new OpenAICompatibleClient({ name: 'primary', baseUrl: env.LLM_PRIMARY_BASE_URL, apiKey: env.LLM_PRIMARY_API_KEY, model: env.LLM_PRIMARY_MODEL, concurrency: Number(env.LLM_PRIMARY_CONCURRENCY ?? 2), disableReasoning: env.LLM_PRIMARY_DISABLE_REASONING === '1' })
    : null;
  const fallback = env.LLM_FALLBACK_BASE_URL && env.LLM_FALLBACK_MODEL
    ? new OpenAICompatibleClient({ name: 'fallback', baseUrl: env.LLM_FALLBACK_BASE_URL, apiKey: env.LLM_FALLBACK_API_KEY, model: env.LLM_FALLBACK_MODEL, concurrency: Number(env.LLM_FALLBACK_CONCURRENCY ?? 4), disableReasoning: env.LLM_FALLBACK_DISABLE_REASONING !== '0' })
    : null;
  if (primary) return new FailoverClient(primary, fallback);
  return fallback;
}

/** Pull the first JSON object out of a model answer, fences and prose included. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in answer');
  return JSON.parse(cleaned.slice(start, end + 1));
}
