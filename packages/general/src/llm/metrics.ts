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

export interface Budget { eurPerMonth: number; alertRatio: number }

export class LlmMetrics {
  private series = new Map<string, Series>();
  /** Spend of the current calendar month (UTC), EUR, seeded from the store at start and persisted through `onSpend`. */
  private month = '';
  private monthEur = 0;
  private alerted = false;
  budget: Budget | null = null;
  /** Called after every priced call with the month key and the new monthly total (the world persists it). */
  onSpend: ((month: string, eur: number) => void) | null = null;
  /** Called once when the month's spend crosses the alert ratio, and once when it crosses the cap. */
  onAlert: ((kind: 'alert' | 'cap', month: string, eur: number, budget: Budget) => void) | null = null;
  private degraded = new Map<string, number>();       // `${cls}|${task}|${reason}`
  private queueDepth = new Map<string, () => number>(); // provider → live depth
  private pricing = new Map<string, Pricing>();
  private jobs = { enqueued: 0, done: 0, failed: 0, expired: 0 };
  readonly startedAt = Date.now();

  price(provider: string, p: Pricing): void { this.pricing.set(provider, p); }

  static monthKey(now = Date.now()): string { return new Date(now).toISOString().slice(0, 7); }

  /** Restore the month's spend (from the store) at start. */
  seedSpend(month: string, eur: number): void { this.month = month; this.monthEur = eur; this.alerted = this.budget ? eur >= this.budget.eurPerMonth * this.budget.alertRatio : false; }

  private addSpend(eur: number): void {
    const key = LlmMetrics.monthKey();
    if (key !== this.month) { this.month = key; this.monthEur = 0; this.alerted = false; }
    if (eur <= 0) return;
    const before = this.monthEur;
    this.monthEur += eur;
    this.onSpend?.(key, this.monthEur);
    if (this.budget) {
      const cap = this.budget.eurPerMonth, alertAt = cap * this.budget.alertRatio;
      if (!this.alerted && this.monthEur >= alertAt) { this.alerted = true; this.onAlert?.('alert', key, this.monthEur, this.budget); }
      if (before < cap && this.monthEur >= cap) this.onAlert?.('cap', key, this.monthEur, this.budget);
    }
  }

  /** The month's spend so far and where it stands against the budget. */
  spend(): { month: string; eur: number; budgetEur: number | null; ratio: number | null; overBudget: boolean } {
    const key = LlmMetrics.monthKey();
    const eur = key === this.month ? this.monthEur : 0;
    const cap = this.budget?.eurPerMonth ?? null;
    return { month: key, eur: Math.round(eur * 1e4) / 1e4, budgetEur: cap, ratio: cap ? Math.round((eur / cap) * 1000) / 1000 : null, overBudget: cap !== null && eur >= cap };
  }

  /** True when the month's cap is reached: every task degrades in character until the month turns. */
  overBudget(): boolean { return this.spend().overBudget; }
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
    const p = this.pricing.get(r.provider);
    if (p) this.addSpend((r.inputTokens * p.inPerM + r.outputTokens * p.outPerM) / 1e6);
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
    spend: ReturnType<LlmMetrics['spend']>;
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
    return { uptimeS: Math.round((Date.now() - this.startedAt) / 1000), providers, degradations, jobs: { ...this.jobs }, spend: this.spend() };
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
    lines.push('# TYPE aurane_llm_spend_eur gauge', `aurane_llm_spend_eur{month="${snap.spend.month}"} ${snap.spend.eur}`);
    if (snap.spend.budgetEur !== null) { lines.push('# TYPE aurane_llm_budget_eur gauge', `aurane_llm_budget_eur ${snap.spend.budgetEur}`, '# TYPE aurane_llm_budget_ratio gauge', `aurane_llm_budget_ratio ${snap.spend.ratio}`, '# TYPE aurane_llm_over_budget gauge', `aurane_llm_over_budget ${snap.spend.overBudget ? 1 : 0}`); }
    return lines.join('\n') + '\n';
  }
}

/** The process-wide registry; tests build their own. */
export const metrics = new LlmMetrics();
