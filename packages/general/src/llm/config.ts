// The whole LLM layer is configured by environment variables; nothing else knows a URL or a key.
//
//   LLM_VOICE_MODEL=mistral-small-3.2-24b-instruct-2506      pinned model of the class (canonical id)
//   LLM_VOICE_PROVIDERS=scaleway,infomaniak,vllm             ordered list of provider names
//   LLM_ROUTINE_MODEL=…  LLM_ROUTINE_PROVIDERS=…              optional: counsel, briefing, reaction, episode on their own
//                                                             pinned model (else they ride the voice pool)
//   LLM_NARRATIVE_MODEL=…  LLM_NARRATIVE_PROVIDERS=…          same for long-form prose
//   LLM_PROVIDER_<NAME>_BASE_URL / _API_KEY / _MODEL (exact name at the provider) / _MODEL_ID (canonical,
//     defaults to _MODEL) / _CONCURRENCY / _TIMEOUT_MS / _JSON_MODE (off|object|schema) / _EXTRA_BODY (JSON) /
//     _DISABLE_REASONING (1) / _MAX_QUEUED / _RETRIES / _PRICE_IN / _PRICE_OUT (EUR per million tokens) /
//     _BREAKER_FAILURES / _BREAKER_OPEN_MS
//   <NAME> is the provider name upper-cased with '-' turned into '_'.
//
// Compatibility: with no LLM_VOICE_PROVIDERS, the legacy LLM_PRIMARY_* becomes the voice class; LLM_FALLBACK_*
// joins it when it serves the same model, otherwise it becomes the narrative class on its own.
import type { LlmMetrics } from './metrics.js';
import { ProviderPool } from './pool.js';
import { OpenAICompatibleClient, type ProviderConfig, type ProviderHooks } from './provider.js';
import { TASK_CLASS, type LlmClass, type LlmTask } from './types.js';

export interface LlmStack {
  voice: ProviderPool | null;
  /** Routine tasks' own pool when LLM_ROUTINE_PROVIDERS is set; null means they ride the voice pool. */
  routine: ProviderPool | null;
  narrative: ProviderPool | null;
  /** Configuration problems worth a log line (a provider refused, legacy variables in use…). */
  warnings: string[];
  /** The pool a class maps to (routine → voice when no routine class is configured). Chosen once, by configuration: never a runtime fallback. */
  forClass(cls: LlmClass): ProviderPool | null;
  /** The pool serving a task. */
  forTask(task: LlmTask): ProviderPool | null;
}

const envKey = (name: string): string => name.toUpperCase().replace(/-/g, '_');

function parseExtra(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try { const v = JSON.parse(raw) as unknown; return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined; } catch { return undefined; }
}

const num = (v: string | undefined): number | undefined => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** `LLM_PROVIDER_<NAME>_*` → ProviderConfig, or null when URL or model is missing. */
export function providerConfigFromEnv(name: string, env: NodeJS.ProcessEnv): ProviderConfig | null {
  const P = `LLM_PROVIDER_${envKey(name)}_`;
  const baseUrl = env[`${P}BASE_URL`], model = env[`${P}MODEL`];
  if (!baseUrl || !model) return null;
  const cfg: ProviderConfig = { name, baseUrl, model, concurrency: num(env[`${P}CONCURRENCY`]) ?? 2 };
  const apiKey = env[`${P}API_KEY`]; if (apiKey) cfg.apiKey = apiKey;
  const modelId = env[`${P}MODEL_ID`]; if (modelId) cfg.modelId = modelId;
  const timeout = num(env[`${P}TIMEOUT_MS`]); if (timeout) cfg.timeoutMs = timeout;
  const jm = env[`${P}JSON_MODE`]; if (jm === 'object' || jm === 'schema' || jm === 'off') cfg.jsonMode = jm; else if (jm === '1') cfg.jsonMode = 'object';
  const extra = parseExtra(env[`${P}EXTRA_BODY`]); if (extra) cfg.extraBody = extra;
  if (env[`${P}DISABLE_REASONING`] === '1') cfg.disableReasoning = true;
  const mq = num(env[`${P}MAX_QUEUED`]); if (mq !== undefined) cfg.maxQueued = mq;
  const rt = num(env[`${P}RETRIES`]); if (rt !== undefined) cfg.retries = rt;
  const pin = num(env[`${P}PRICE_IN`]); if (pin !== undefined) cfg.priceIn = pin;
  const pout = num(env[`${P}PRICE_OUT`]); if (pout !== undefined) cfg.priceOut = pout;
  const bf = num(env[`${P}BREAKER_FAILURES`]), bo = num(env[`${P}BREAKER_OPEN_MS`]);
  if (bf !== undefined || bo !== undefined) cfg.breaker = { ...(bf !== undefined ? { failures: bf } : {}), ...(bo !== undefined ? { openMs: bo } : {}) };
  return cfg;
}

/** Legacy `LLM_<ROLE>_*` → ProviderConfig. */
function legacyConfig(role: 'PRIMARY' | 'FALLBACK', env: NodeJS.ProcessEnv): ProviderConfig | null {
  const baseUrl = env[`LLM_${role}_BASE_URL`], model = env[`LLM_${role}_MODEL`];
  if (!baseUrl || !model) return null;
  const cfg: ProviderConfig = {
    name: role.toLowerCase(), baseUrl, model,
    concurrency: num(env[`LLM_${role}_CONCURRENCY`]) ?? (role === 'PRIMARY' ? 2 : 4),
    disableReasoning: role === 'PRIMARY' ? env.LLM_PRIMARY_DISABLE_REASONING === '1' : env.LLM_FALLBACK_DISABLE_REASONING !== '0',
    jsonMode: env[`LLM_${role}_JSON_MODE`] === '1' ? 'object' : 'off',
  };
  const apiKey = env[`LLM_${role}_API_KEY`]; if (apiKey) cfg.apiKey = apiKey;
  const timeout = num(env[`LLM_${role}_TIMEOUT_MS`]); if (timeout) cfg.timeoutMs = timeout;
  const extra = parseExtra(env[`LLM_${role}_EXTRA_BODY`]); if (extra) cfg.extraBody = extra;
  const pin = num(env[`LLM_${role}_PRICE_IN`]); if (pin !== undefined) cfg.priceIn = pin;
  const pout = num(env[`LLM_${role}_PRICE_OUT`]); if (pout !== undefined) cfg.priceOut = pout;
  return cfg;
}

function buildPool(cls: LlmClass, env: NodeJS.ProcessEnv, warnings: string[], metrics: LlmMetrics | undefined, hooks: ProviderHooks): ProviderPool | null {
  const K = cls.toUpperCase();
  const names = (env[`LLM_${K}_PROVIDERS`] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) return null;
  const clients: OpenAICompatibleClient[] = [];
  for (const n of names) {
    const cfg = providerConfigFromEnv(n, env);
    if (!cfg) { warnings.push(`${cls}: provider ${n} listed but LLM_PROVIDER_${envKey(n)}_BASE_URL/_MODEL missing, skipped`); continue; }
    clients.push(new OpenAICompatibleClient(cfg, hooks));
  }
  if (!clients.length) return null;
  const model = env[`LLM_${K}_MODEL`] ?? clients[0]!.modelId;
  if (!env[`LLM_${K}_MODEL`]) warnings.push(`${cls}: LLM_${K}_MODEL not set, pinned to the first provider's model ${model}`);
  const kept = clients.filter((c) => c.modelId === model);
  for (const c of clients) if (c.modelId !== model) warnings.push(`${cls}: provider ${c.name} serves ${c.modelId}, class is pinned to ${model}: refused (no cross-model fallback)`);
  if (!kept.length) return null;
  return new ProviderPool(cls, model, kept, metrics);
}

export function stackFromEnv(env: NodeJS.ProcessEnv = process.env, metrics?: LlmMetrics, hooks: ProviderHooks = {}): LlmStack {
  const warnings: string[] = [];
  let voice = buildPool('voice', env, warnings, metrics, hooks);
  const routine = buildPool('routine', env, warnings, metrics, hooks);
  let narrative = buildPool('narrative', env, warnings, metrics, hooks);
  if (!voice && !env.LLM_VOICE_PROVIDERS) {
    const primary = legacyConfig('PRIMARY', env), fallback = legacyConfig('FALLBACK', env);
    if (primary) {
      warnings.push('legacy LLM_PRIMARY_*/LLM_FALLBACK_* in use; move to LLM_VOICE_PROVIDERS + LLM_PROVIDER_<NAME>_*');
      const p = new OpenAICompatibleClient(primary, hooks);
      const voiceClients = [p];
      if (fallback) {
        const f = new OpenAICompatibleClient(fallback, hooks);
        if (f.modelId === p.modelId) voiceClients.push(f);
        else if (!narrative) { narrative = new ProviderPool('narrative', f.modelId, [f], metrics); warnings.push(`legacy fallback ${fallback.model} serves another model: it is the narrative class, not a voice fallback`); }
      }
      voice = new ProviderPool('voice', p.modelId, voiceClients, metrics);
    } else if (fallback) {
      warnings.push('only LLM_FALLBACK_* set: it is the voice class on its own');
      voice = new ProviderPool('voice', fallback.model, [new OpenAICompatibleClient(fallback, hooks)], metrics);
    }
  }
  // A provider without prices is invisible to the monthly budget ceiling: say so at startup.
  const seen = new Set<string>();
  for (const pool of [voice, routine, narrative]) for (const p of pool?.providers ?? []) {
    if (seen.has(p.name)) continue; seen.add(p.name);
    if (p.cfg.priceIn === undefined || p.cfg.priceOut === undefined) warnings.push(`provider ${p.name} has no _PRICE_IN/_PRICE_OUT: its spend is not counted against LLM_BUDGET_EUR_MONTH`);
  }
  return {
    voice, routine, narrative, warnings,
    forClass(cls) { return cls === 'voice' ? this.voice : cls === 'routine' ? (this.routine ?? this.voice) : this.narrative; },
    forTask(task) { return this.forClass(TASK_CLASS[task]); },
  };
}

/** @deprecated The voice pool of the stack; kept for callers that still expect one client. */
export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderPool | null { return stackFromEnv(env).voice; }
