// Shared types of the LLM layer. One rule above all: a General's voice is one model, pinned by
// version, whatever provider happens to serve it. The class decides the model; the task decides the
// sampling; the provider only decides where the request goes.

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/** A JSON Schema the answer must follow (guided decoding when the provider supports it). */
export interface JsonSchemaSpec { name: string; schema: Record<string, unknown> }

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /** Ask for a JSON object (json_object) or a schema-constrained one when `schema` is given. */
  json?: boolean;
  schema?: JsonSchemaSpec;
  timeoutMs?: number;
  /** Bookkeeping: the task name, so metrics can be read per task. */
  task?: LlmTask;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  /** Attempts across providers before this answer (1 = first try). */
  attempts: number;
}

export interface LlmClient {
  readonly name: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  healthy(): Promise<boolean>;
}

/** Usage classes: `voice` is the General speaking (identical model everywhere); `narrative` is long-form prose. */
export type LlmClass = 'voice' | 'narrative';
export type LlmTask = 'talk' | 'doctrine' | 'briefing' | 'reaction' | 'counsel' | 'episode' | 'gazette' | 'memoir';

export const TASK_CLASS: Record<LlmTask, LlmClass> = {
  talk: 'voice', doctrine: 'voice', briefing: 'voice', reaction: 'voice', counsel: 'voice', episode: 'voice',
  gazette: 'narrative', memoir: 'narrative',
};

/** Sampling per task, fixed in code: the same numbers reach every provider of the class. */
export interface TaskParams { temperature: number; topP: number; maxTokens: number; timeoutMs: number; json: boolean }
export const TASK_PARAMS: Record<LlmTask, TaskParams> = {
  talk:     { temperature: 0.7, topP: 0.9, maxTokens: 500, timeoutMs: 20000, json: true },
  doctrine: { temperature: 0.2, topP: 0.9, maxTokens: 700, timeoutMs: 20000, json: true },
  briefing: { temperature: 0.6, topP: 0.9, maxTokens: 400, timeoutMs: 20000, json: false },
  reaction: { temperature: 0.7, topP: 0.9, maxTokens: 200, timeoutMs: 15000, json: false },
  counsel:  { temperature: 0.6, topP: 0.9, maxTokens: 450, timeoutMs: 3000, json: true },
  episode:  { temperature: 0.6, topP: 0.9, maxTokens: 220, timeoutMs: 15000, json: false },
  gazette:  { temperature: 0.6, topP: 0.95, maxTokens: 900, timeoutMs: 60000, json: true },
  memoir:   { temperature: 0.8, topP: 0.95, maxTokens: 1200, timeoutMs: 90000, json: false },
};

/** Thrown by a pool when no provider of the class can answer. Callers degrade in character; they never switch model. */
export class LlmUnavailable extends Error {
  constructor(readonly cls: LlmClass, readonly reason: 'unconfigured' | 'saturated' | 'open' | 'failed', detail = '') {
    super(`llm ${cls} unavailable (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'LlmUnavailable';
  }
}
