// A class of usage = one pinned model served by an ordered list of providers. The pool tries them in
// order, skips open breakers and saturated queues, and when nothing answers it throws LlmUnavailable.
// It never falls back to a different model: the caller degrades in character instead.
import type { LlmMetrics } from './metrics.js';
import { OpenAICompatibleClient, ProviderError } from './provider.js';
import { LlmUnavailable, TASK_PARAMS, type ChatMessage, type ChatOptions, type ChatResult, type LlmClass, type LlmClient, type LlmTask } from './types.js';

export class ProviderPool implements LlmClient {
  readonly name: string;
  readonly providers: OpenAICompatibleClient[];
  constructor(readonly cls: LlmClass, readonly model: string, providers: OpenAICompatibleClient[], private readonly metrics?: LlmMetrics) {
    this.name = `${cls}:${model}`;
    const wrong = providers.filter((p) => p.modelId !== model);
    if (wrong.length) throw new Error(`class ${cls} is pinned to ${model}; refused provider(s) ${wrong.map((p) => `${p.name} (${p.modelId})`).join(', ')}`);
    this.providers = providers;
    for (const p of providers) {
      if (p.cfg.priceIn !== undefined || p.cfg.priceOut !== undefined) metrics?.price(p.name, { inPerM: p.cfg.priceIn ?? 0, outPerM: p.cfg.priceOut ?? 0 });
      metrics?.gauge(p.name, () => p.queued + p.running);
    }
  }

  /** The task's fixed sampling, then the caller's schema/task hints. Temperature and tokens are never provider-specific. */
  static paramsFor(task: LlmTask, opts: ChatOptions = {}): ChatOptions {
    const p = TASK_PARAMS[task];
    const out: ChatOptions = { temperature: p.temperature, topP: p.topP, maxTokens: p.maxTokens, timeoutMs: p.timeoutMs, json: p.json, task };
    if (opts.schema) out.schema = opts.schema;
    if (opts.maxTokens !== undefined && opts.maxTokens < p.maxTokens) out.maxTokens = opts.maxTokens;
    return out;
  }

  /** Providers that would take a call right now, in order. */
  available(): OpenAICompatibleClient[] { return this.providers.filter((p) => p.breaker.state !== 'open' && !p.saturated); }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    if (!this.providers.length) throw new LlmUnavailable(this.cls, 'unconfigured');
    const task = opts.task ?? 'talk';
    const params = opts.task ? ProviderPool.paramsFor(task, opts) : opts;
    let attempts = 0;
    let lastError: ProviderError | null = null;
    let skippedOpen = 0, skippedSaturated = 0;
    for (const p of this.providers) {
      if (p.saturated) { skippedSaturated++; continue; }
      if (!p.breaker.allow()) { skippedOpen++; continue; }
      const started = Date.now();
      try {
        const r = await p.chat(messages, params);
        attempts += r.attempts;
        this.metrics?.record({ cls: this.cls, provider: p.name, task, ok: true, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
        return { ...r, attempts };
      } catch (err) {
        const e = err instanceof ProviderError ? err : new ProviderError(p.name, 'other', (err as Error).message);
        attempts++;
        lastError = e;
        this.metrics?.record({ cls: this.cls, provider: p.name, task, ok: false, ms: Date.now() - started, inputTokens: 0, outputTokens: 0, error: e.kind });
        if (p.breaker.state === 'open') this.metrics?.breakerOpened(this.cls, p.name);
      }
    }
    if (lastError) throw new LlmUnavailable(this.cls, 'failed', lastError.message);
    if (skippedOpen && !skippedSaturated) throw new LlmUnavailable(this.cls, 'open', `${skippedOpen} breaker(s) open`);
    throw new LlmUnavailable(this.cls, 'saturated', `${skippedSaturated} saturated, ${skippedOpen} open`);
  }

  async healthy(): Promise<boolean> {
    for (const p of this.providers) if (await p.healthy()) return true;
    return false;
  }
}
