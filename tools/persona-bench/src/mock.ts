// Without network: a synthetic model that answers in valid JSON from the persona sheet (its own example
// lines), or replays a recording made against real providers (--record). Deterministic.
import { SHEETS, type ChatMessage, type ChatOptions, type ChatResult, type LlmClient } from '@aurane/general';
import type { Persona } from '@aurane/protocol';

export type Recording = Record<string, string>; // key → raw model text

export function recordingKey(provider: string, scenario: string, persona: Persona, lang: 'fr' | 'en'): string { return `${provider}|${scenario}|${persona}|${lang}`; }

/** Replays recorded answers; falls back to the synthetic answer when a key is missing. */
export function replayClient(rec: Recording, keyOf: () => string, synthetic: LlmClient): LlmClient {
  return {
    name: 'replay', healthy: async () => true,
    chat: async (messages, opts): Promise<ChatResult> => {
      const k = keyOf();
      const text = rec[k];
      if (text !== undefined) return { text, model: 'recorded', provider: 'replay', inputTokens: 0, outputTokens: 0, ms: 0, attempts: 1 };
      return synthetic.chat(messages, opts);
    },
  };
}

/** Answers with one of the persona's own lines, as the JSON the task expects. */
export function syntheticClient(current: () => { persona: Persona; lang: 'fr' | 'en'; task: 'talk' | 'doctrine' | 'briefing' | 'counsel'; crisis: boolean }): LlmClient {
  return {
    name: 'synthetic', healthy: async () => true,
    chat: async (messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> => {
      const { persona, lang, task, crisis } = current();
      const s = SHEETS[persona];
      const pick = (sit: string): string => s.examples[lang].find((e) => e.situation === sit)?.text ?? s.examples[lang][0]!.text;
      const user = messages.at(-1)?.content ?? '';
      let text: string;
      if (task === 'briefing') text = pick('briefing');
      else if (task === 'counsel') { const ids = [...(messages[0]?.content ?? '').matchAll(/^\d+\. \[([^\]]+)\]/gm)].map((m) => m[1]); text = JSON.stringify({ cards: ids.slice(0, 3).map((id, i) => ({ id, title: ['Priorité', 'Ensuite', 'Si tu veux'][i], line: pick(i === 0 ? 'crisis' : 'advice') })) }); }
      else if (task === 'doctrine') text = JSON.stringify(/tout|everything/i.test(user) ? { orders: null, reply: '', question: pick('clarification') } : { orders: { expansion: 0.7 }, reply: pick('advice'), question: null });
      else text = JSON.stringify({ reply: crisis ? pick('crisis') : /rire|laugh/i.test(user) ? pick('smalltalk') : /Draven/i.test(user) ? pick('betrayal') : pick('advice'), orders: null, question: null });
      void opts;
      return { text, model: 'synthetic', provider: 'synthetic', inputTokens: Math.round(messages.reduce((n, m) => n + m.content.length, 0) / 4), outputTokens: Math.round(text.length / 4), ms: 1, attempts: 1 };
    },
  };
}
