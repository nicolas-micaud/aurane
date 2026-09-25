// Smoke test against the configured providers: `npm run -w packages/general smoke`.
// Reads LLM_PRIMARY_* / LLM_FALLBACK_* from the environment; prints nothing secret.
import { DEFAULT_POLICY } from '@aurane/protocol';
import { stackFromEnv } from './llm/index.js';
import { compilePolicy } from './doctrine.js';

const client = stackFromEnv().voice;
if (!client) { console.error('no LLM configured (LLM_PRIMARY_BASE_URL/LLM_PRIMARY_MODEL or LLM_FALLBACK_*)'); process.exit(2); }
console.log(JSON.stringify({ healthy: await client.healthy() }));
const started = Date.now();
const res = await compilePolicy(
  'Défends Thair à tout prix, vends le surplus de Vivres au-dessus de 2, garde 150 d\'Énergie, ne déclenche jamais de guerre sans moi, commerce avec la Maison Vantor.',
  { lang: 'fr', current: DEFAULT_POLICY, systems: { 'S0,0#1': 'Thair', 'S0,0#2': 'Amqua' }, colonies: { C1: 'Colonie Ilse Vantor', C2: 'Colonie Kael Draven' }, alliances: {} },
  client,
);
console.log(JSON.stringify({ ms: Date.now() - started, source: res.source, summary: res.summary, warnings: res.warnings, policy: res.policy }, null, 2));
