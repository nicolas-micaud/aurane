// Bench a candidate model for the General: latency, tokens, JSON validity, and a persona reply to read.
// Run from the repo root after `npm run build`, with the candidate in LLM_PRIMARY_* (no fallback needed):
//   LLM_PRIMARY_BASE_URL=... LLM_PRIMARY_API_KEY=... LLM_PRIMARY_MODEL=... node tools/llm-bench/bench.mjs [rounds]
// Optional: LLM_PRIMARY_EXTRA_BODY='{"enable_thinking":false}' (Alibaba Qwen3), LLM_PRIMARY_JSON_MODE=1.
// Prints one line per call and a summary; never prints keys.
/* global process, console */
import { providerFromEnv, extractJson, converse, situationSummary, PERSONA_VOICES } from '../../packages/general/dist/index.js';
import { DEFAULT_POLICY } from '../../packages/protocol/dist/index.js';
import { createWorld, spawnColony, viewFor } from '../../packages/sim/dist/index.js';

const rounds = Number(process.argv[2] ?? 2);
const client = providerFromEnv('PRIMARY');
if (!client) { console.error('set LLM_PRIMARY_BASE_URL and LLM_PRIMARY_MODEL'); process.exit(2); }

const w = createWorld('bench', { radius: 4 });
const c = spawnColony(w, { name: 'Banc', faction: 'guild', persona: 'kestrel' });
const view = viewFor(w, c);
const ctx = { lang: 'fr', current: DEFAULT_POLICY, systems: { [c.capital]: w.galaxy.systems[c.capital].name }, colonies: {}, alliances: {}, persona: 'kestrel' };
const prompts = [
  ['kestrel', 'Fais-moi rire.'],
  ['oriel', 'C\'est quoi le Rium et comment j\'en ai plus ?'],
  ['vane', 'Défends la capitale, ne déclenche jamais la guerre sans moi, vends le surplus de Vivres au-dessus de 1,2.'],
  ['solen', 'Qui sont mes voisins et que me conseilles-tu pour le prochain Tirage ?'],
];
const rows = [];
for (let r = 0; r < rounds; r++) {
  for (const [persona, text] of prompts) {
    const t0 = Date.now();
    let ok = false, reply = '', orders = null, err = '';
    try {
      const res = await converse({ text, lang: 'fr', persona, history: [], view, ctx: { ...ctx, persona } }, client);
      ok = res.source === 'llm'; reply = res.reply; orders = res.policy ? 'orders' : '-';
    } catch (e) { err = String(e.message ?? e); }
    const ms = Date.now() - t0;
    rows.push({ persona, ms, ok });
    console.log(`${ok ? 'OK ' : 'KO '} ${String(ms).padStart(5)} ms  ${persona.padEnd(7)} ${orders ?? ''}  ${err || reply.replace(/\s+/g, ' ').slice(0, 140)}`);
  }
}
const okRows = rows.filter((x) => x.ok).map((x) => x.ms).sort((a, b) => a - b);
const p = (q) => okRows[Math.min(okRows.length - 1, Math.floor(q * okRows.length))] ?? null;
console.log(`\nmodel ${process.env.LLM_PRIMARY_MODEL}: ${okRows.length}/${rows.length} model answers (the rest fell back), p50 ${p(0.5)} ms, p90 ${p(0.9)} ms`);
// A raw call to read token counts and the provider's own model name.
try {
  const raw = await client.chat([{ role: 'system', content: `Tu es ${PERSONA_VOICES.vane.name.fr}.` }, { role: 'user', content: 'Réponds par un JSON {"ok":true}.' }], { maxTokens: 50, json: true, timeoutMs: 20000 });
  console.log(`raw: ${raw.ms} ms, in ${raw.inputTokens} / out ${raw.outputTokens} tokens, served by ${raw.model}, json ${(() => { try { extractJson(raw.text); return 'valid'; } catch { return 'INVALID'; } })()}`);
  console.log(`situation summary is ${situationSummary(view, 'fr', {}).length} chars`);
} catch (e) { console.log('raw call failed:', String(e.message ?? e)); }
