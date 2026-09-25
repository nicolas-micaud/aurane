// Metrics of the LLM layer, per class, provider and task: latency percentiles, errors, tokens, cost,
// degradations, queue depth. In memory, exported as JSON and in Prometheus text format.
import type { LlmClass, LlmTask } from './types.js';

export interface CallRecord {
  cls: LlmClass; provider: string; task: LlmTask | 'unknown'; ok: boolean; ms: number;
  inputTokens: number; outputTokens: number; error?: 'timeout' | 'http' | 'network' | 'empty' | 'other';
}

interface Series {
  calls: number; errors: number; timeouts: number; inputTokens: number; outputTokens: number; costEur: number;
  latencies: number[]; breakerOpens: number;
}

const WINDOW = 512;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

const fresh = (): Series => ({ calls: 0, errors: 0, timeouts: 0, inputTokens: 0, outputTokens: 0, costEur: 0, latencies: [], breakerOpens: 0 });

export interface Pricing { inPerM: number; outPerM: number }

export class LlmMetrics {
  private series = new Map<string, Series>();
  private degraded = new Map<string, number>();       // `${cls}|${task}|${reason}`
  private queueDepth = new Map<string, () => number>(); // provider → live depth
  private pricing = new Map<string, Pricing>();
  private jobs = { enqueued: 0, done: 0, failed: 0, expired: 0 };
  readonly startedAt = Date.now();

  price(provider: string, p: Pricing): void { this.pricing.set(provider, p); }
  gauge(provider: string, depth: () => number): void { this.queueDepth.set(provider, depth); }

  private key(cls: LlmClass, provider: string, task: string): string { return `${cls}|${provider}|${task}`; }
  private at(cls: LlmClass, provider: string, task: string): Series {
    const k = this.key(cls, provider, task);
    let s = this.series.get(k);
    if (!s) { s = fresh(); this.series.set(k, s); }
    return s;
  }

  record(r: CallRecord): void {
    for (const task of [r.task, '*'] as const) {
      const s = this.at(r.cls, r.provider, task);
      s.calls++;
      if (!r.ok) { s.errors++; if (r.error === 'timeout') s.timeouts++; }
      s.inputTokens += r.inputTokens; s.outputTokens += r.outputTokens;
      const p = this.pricing.get(r.provider);
      if (p) s.costEur += (r.inputTokens * p.inPerM + r.outputTokens * p.outPerM) / 1e6;
      if (r.ok) { s.latencies.push(r.ms); if (s.latencies.length > WINDOW) s.latencies.shift(); }
    }
  }

  breakerOpened(cls: LlmClass, provider: string): void { this.at(cls, provider, '*').breakerOpens++; }

  /** A request answered in character without the model (quota, saturation, unavailable, numbers rejected…). */
  degradation(cls: LlmClass, task: LlmTask, reason: string): void {
    const k = `${cls}|${task}|${reason}`;
    this.degraded.set(k, (this.degraded.get(k) ?? 0) + 1);
  }

  job(kind: 'enqueued' | 'done' | 'failed' | 'expired'): void { this.jobs[kind]++; }

  snapshot(): {
    uptimeS: number;
    providers: { cls: LlmClass; provider: string; task: string; calls: number; errors: number; timeouts: number; p50Ms: number; p95Ms: number; inputTokens: number; outputTokens: number; costEur: number; breakerOpens: number; queueDepth: number | null }[];
    degradations: { cls: string; task: string; reason: string; count: number }[];
    jobs: { enqueued: number; done: number; failed: number; expired: number };
  } {
    const providers = [...this.series.entries()].map(([k, s]) => {
      const [cls, provider, task] = k.split('|') as [LlmClass, string, string];
      const sorted = [...s.latencies].sort((a, b) => a - b);
      return {
        cls, provider, task, calls: s.calls, errors: s.errors, timeouts: s.timeouts,
        p50Ms: Math.round(percentile(sorted, 50)), p95Ms: Math.round(percentile(sorted, 95)),
        inputTokens: s.inputTokens, outputTokens: s.outputTokens, costEur: Math.round(s.costEur * 1e6) / 1e6,
        breakerOpens: s.breakerOpens, queueDepth: task === '*' ? (this.queueDepth.get(provider)?.() ?? null) : null,
      };
    }).sort((a, b) => a.cls.localeCompare(b.cls) || a.provider.localeCompare(b.provider) || a.task.localeCompare(b.task));
    const degradations = [...this.degraded.entries()].map(([k, count]) => { const [cls, task, reason] = k.split('|') as [string, string, string]; return { cls, task, reason, count }; });
    return { uptimeS: Math.round((Date.now() - this.startedAt) / 1000), providers, degradations, jobs: { ...this.jobs } };
  }

  /** Prometheus exposition format, for a scrape behind the admin token. */
  prometheus(): string {
    const snap = this.snapshot();
    const lines: string[] = [];
    const lbl = (p: { cls: string; provider: string; task: string }): string => `class="${p.cls}",provider="${p.provider}",task="${p.task}"`;
    lines.push('# TYPE aurane_llm_calls_total counter');
    for (const p of snap.providers) lines.push(`aurane_llm_calls_total{${lbl(p)}} ${p.calls}`);
    lines.push('# TYPE aurane_llm_errors_total counter');
    for (const p of snap.providers) lines.push(`aurane_llm_errors_total{${lbl(p)}} ${p.errors}`);
    lines.push('# TYPE aurane_llm_latency_ms gauge');
    for (const p of snap.providers) { lines.push(`aurane_llm_latency_ms{${lbl(p)},quantile="0.5"} ${p.p50Ms}`); lines.push(`aurane_llm_latency_ms{${lbl(p)},quantile="0.95"} ${p.p95Ms}`); }
    lines.push('# TYPE aurane_llm_tokens_total counter');
    for (const p of snap.providers) { lines.push(`aurane_llm_tokens_total{${lbl(p)},direction="in"} ${p.inputTokens}`); lines.push(`aurane_llm_tokens_total{${lbl(p)},direction="out"} ${p.outputTokens}`); }
    lines.push('# TYPE aurane_llm_cost_eur_total counter');
    for (const p of snap.providers) lines.push(`aurane_llm_cost_eur_total{${lbl(p)}} ${p.costEur}`);
    lines.push('# TYPE aurane_llm_breaker_opens_total counter');
    for (const p of snap.providers.filter((x) => x.task === '*')) lines.push(`aurane_llm_breaker_opens_total{class="${p.cls}",provider="${p.provider}"} ${p.breakerOpens}`);
    lines.push('# TYPE aurane_llm_queue_depth gauge');
    for (const p of snap.providers.filter((x) => x.task === '*' && x.queueDepth !== null)) lines.push(`aurane_llm_queue_depth{class="${p.cls}",provider="${p.provider}"} ${p.queueDepth}`);
    lines.push('# TYPE aurane_llm_degradations_total counter');
    for (const d of snap.degradations) lines.push(`aurane_llm_degradations_total{class="${d.cls}",task="${d.task}",reason="${d.reason}"} ${d.count}`);
    lines.push('# TYPE aurane_llm_jobs_total counter');
    for (const [k, v] of Object.entries(snap.jobs)) lines.push(`aurane_llm_jobs_total{state="${k}"} ${v}`);
    return lines.join('\n') + '\n';
  }
}

/** The process-wide registry; tests build their own. */
export const metrics = new LlmMetrics();
