#!/usr/bin/env node
/* global fetch, console, process */
// Capacity projection for the Generals' LLM layer, from real metrics.
//
//   node tools/llm-capacity/project.mjs --players 1000 [--metrics https://…/api/admin/llm/metrics --token …]
//   node tools/llm-capacity/project.mjs --players 1000 --calls-per-player 9 --p95-ms 1200 --peak-share 0.25
//
// Reads the world's metrics endpoint when given (calls per task, p95 latency, tokens, cost), else the
// flags. Prints calls/day, the peak hour, the concurrency needed per class, and the daily cost.
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: {
  players: { type: 'string', default: '1000' },
  metrics: { type: 'string' }, token: { type: 'string' },
  'calls-per-player': { type: 'string' },      // per active player per day, voice class
  'p95-ms': { type: 'string' },                 // voice p95 latency
  'tokens-in': { type: 'string' }, 'tokens-out': { type: 'string' },
  'price-in': { type: 'string', default: '0.15' }, 'price-out': { type: 'string', default: '0.35' }, // EUR per M tokens
  'peak-share': { type: 'string', default: '0.25' }, // share of the day's calls that land in the busiest hour
  'peak-minutes': { type: 'string', default: '15' }, // and within that hour, the minutes that carry half of them (post-Draw wave)
  json: { type: 'boolean', default: false },
} });

const players = Number(a.players);
let callsPerPlayer = a['calls-per-player'] ? Number(a['calls-per-player']) : null;
let p95 = a['p95-ms'] ? Number(a['p95-ms']) : null;
let tokIn = a['tokens-in'] ? Number(a['tokens-in']) : null, tokOut = a['tokens-out'] ? Number(a['tokens-out']) : null;
let narrativeCallsPerDay = 2; // the Gazette, FR and EN
let source = 'flags';

if (a.metrics) {
  const res = await fetch(a.metrics, { headers: a.token ? { 'x-admin-token': a.token } : {} });
  if (!res.ok) { console.error(`metrics: HTTP ${res.status}`); process.exit(2); }
  const m = await res.json();
  const voice = m.llm.providers.filter((p) => p.cls === 'voice' && p.task === '*');
  const calls = voice.reduce((s, p) => s + p.calls, 0);
  const uptimeDays = Math.max(1 / 24, m.llm.uptimeS / 86400);
  const activePlayers = Math.max(1, m.activePlayers ?? players); // the endpoint may not know; fall back to the target
  callsPerPlayer ??= calls / uptimeDays / activePlayers;
  p95 ??= Math.max(...voice.map((p) => p.p95Ms), 1);
  tokIn ??= calls ? voice.reduce((s, p) => s + p.inputTokens, 0) / calls : null;
  tokOut ??= calls ? voice.reduce((s, p) => s + p.outputTokens, 0) / calls : null;
  const narr = m.llm.providers.filter((p) => p.cls === 'narrative' && p.task === '*').reduce((s, p) => s + p.calls, 0);
  narrativeCallsPerDay = Math.max(2, narr / uptimeDays);
  source = a.metrics;
}
callsPerPlayer ??= 9;      // GDD order of magnitude: 2 briefings + a handful of turns + a doctrine
p95 ??= 1200;
tokIn ??= 2800; tokOut ??= 160;

const callsPerDay = players * callsPerPlayer;
const peakHourCalls = callsPerDay * Number(a['peak-share']);
const peakMinutes = Number(a['peak-minutes']);
const burstCallsPerSecond = (peakHourCalls * 0.5) / (peakMinutes * 60);
const concurrency = Math.ceil(burstCallsPerSecond * (p95 / 1000));
const steadyCallsPerSecond = peakHourCalls / 3600;
const steadyConcurrency = Math.ceil(steadyCallsPerSecond * (p95 / 1000));
const costPerDay = (callsPerDay * (tokIn * Number(a['price-in']) + tokOut * Number(a['price-out']))) / 1e6;

const out = {
  source, players, callsPerPlayerPerDay: round(callsPerPlayer), callsPerDay: Math.round(callsPerDay),
  peakHourCalls: Math.round(peakHourCalls), burstCallsPerSecond: round(burstCallsPerSecond), steadyCallsPerSecond: round(steadyCallsPerSecond),
  p95Ms: Math.round(p95), voiceConcurrencyNeeded: { burst: concurrency, steady: steadyConcurrency },
  tokensPerCall: { in: Math.round(tokIn), out: Math.round(tokOut) }, tokensPerDay: Math.round(callsPerDay * (tokIn + tokOut)),
  costEurPerDay: round(costPerDay), costEurPerActivePlayerPerDay: round(costPerDay / players, 4),
  narrativeCallsPerDay: Math.round(narrativeCallsPerDay),
  note: 'concurrency = calls/s × p95 (Little); size the sum of LLM_PROVIDER_*_CONCURRENCY of the voice class to the burst figure, the queue absorbs the rest with the talk deadline.',
};
function round(x, d = 2) { return Math.round(x * 10 ** d) / 10 ** d; }
if (a.json) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`Source: ${out.source}`);
  console.log(`${out.players} active players × ${out.callsPerPlayerPerDay} calls/day = ${out.callsPerDay} voice calls/day (${out.tokensPerDay} tokens)`);
  console.log(`Peak hour: ${out.peakHourCalls} calls; post-Draw burst ${out.burstCallsPerSecond} calls/s, steady ${out.steadyCallsPerSecond} calls/s; p95 ${out.p95Ms} ms`);
  console.log(`Voice concurrency needed: ${out.voiceConcurrencyNeeded.burst} in the burst, ${out.voiceConcurrencyNeeded.steady} steady`);
  console.log(`Cost: ${out.costEurPerDay} EUR/day, ${out.costEurPerActivePlayerPerDay} EUR per active player per day; narrative: ${out.narrativeCallsPerDay} calls/day`);
  console.log(out.note);
}
