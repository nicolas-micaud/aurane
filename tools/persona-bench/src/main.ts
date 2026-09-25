// Headless persona bench: every scenario × General × language × provider, then a side-by-side report.
//
//   node tools/persona-bench/dist/main.js                      # mock: synthetic answers from the sheets (no network)
//   node tools/persona-bench/dist/main.js --live               # every provider of LLM_VOICE_PROVIDERS, separately
//   node tools/persona-bench/dist/main.js --live --record      # and save the answers to recordings/live.json
//   node tools/persona-bench/dist/main.js --replay recordings/live.json
//   options: --providers a,b  --personas vane,oriel  --langs fr  --scenarios joke,energy-crisis  --out docs/ai/persona-report.md
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { PERSONAS, type Persona } from '@aurane/protocol';
import { viewFor } from '@aurane/sim';
import { OpenAICompatibleClient, ProviderPool, analyze, compileDoctrine, converse, factsFrom, emptyMemory, providerConfigFromEnv, renderAnalysis, renderMemory, writeBriefing, writeCounsel, type LlmClient } from '@aurane/general';
import { SCENARIOS, type Lang } from './scenarios.js';
import { recordingKey, replayClient, syntheticClient, type Recording } from './mock.js';
import { aggregate, markdown, type Sample } from './report.js';

const { values: a } = parseArgs({ options: {
  live: { type: 'boolean', default: false }, record: { type: 'boolean', default: false }, replay: { type: 'string' },
  providers: { type: 'string' }, personas: { type: 'string' }, langs: { type: 'string', default: 'fr,en' }, scenarios: { type: 'string' },
  out: { type: 'string', default: 'docs/ai/persona-report.md' },
} });

const langs = a.langs!.split(',').filter(Boolean) as Lang[];
const personas = (a.personas ? a.personas.split(',') : [...PERSONAS]) as Persona[];
const scenarios = SCENARIOS.filter((s) => !a.scenarios || a.scenarios.split(',').includes(s.id));

// Providers: live = one pool per provider of the voice class (to compare voices across providers); else mock.
let current = { provider: 'mock', scenario: '', persona: 'vane' as Persona, lang: 'fr' as Lang, task: 'talk' as 'talk' | 'doctrine' | 'briefing' | 'counsel', crisis: false };
const synthetic = syntheticClient(() => current);
const recording: Recording = a.replay ? JSON.parse(await readFile(a.replay, 'utf8')) as Recording : {};
const clients = new Map<string, LlmClient>();
if (a.live) {
  const names = (a.providers ?? process.env.LLM_VOICE_PROVIDERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    const cfg = providerConfigFromEnv(n, process.env);
    if (!cfg) { console.error(`provider ${n}: LLM_PROVIDER_${n.toUpperCase().replace(/-/g, '_')}_BASE_URL/_MODEL missing, skipped`); continue; }
    const c = new OpenAICompatibleClient(cfg);
    clients.set(n, new ProviderPool('voice', c.modelId, [c]));
  }
  if (!clients.size) { console.error('no live provider configured'); process.exit(2); }
} else if (a.replay) {
  for (const p of new Set(Object.keys(recording).map((k) => k.split('|')[0]!))) clients.set(p, replayClient(recording, () => recordingKey(current.provider, current.scenario, current.persona, current.lang), synthetic));
} else {
  clients.set('mock', synthetic);
}
// The heuristic column: no model at all, the floor every provider must beat.
clients.set('heuristic', null as unknown as LlmClient);

const samples: Sample[] = [];
const recorded: Recording = {};
for (const [provider, client] of clients) {
  for (const sc of scenarios) for (const persona of personas) for (const lang of langs) {
    const { w, c, awaySeconds } = sc.build(persona, lang);
    const systems: Record<string, string> = {}; for (const [id, st] of Object.entries(w.systems)) if (st.owner === c.id) systems[id] = w.galaxy.systems[id]!.name;
    const colonies: Record<string, string> = {}; for (const o of Object.values(w.colonies)) if (o.id !== c.id) colonies[o.id] = o.name;
    const ctx = { lang, current: c.policy, systems, colonies, alliances: {} as Record<string, string>, persona };
    const analysis = analyze(w, c);
    const memory = renderMemory(factsFrom(w, c), emptyMemory(), lang);
    current = { provider, scenario: sc.id, persona, lang, task: sc.kind, crisis: analysis.crisis };
    const started = Date.now();
    let recordText: ((t: string) => void) | null = null;
    const wrapped: LlmClient | null = client ? { name: client.name, healthy: () => client.healthy(), chat: async (m, o) => { const r = await client.chat(m, o); recordText?.(r.text); return r; } } : null;
    recordText = (t) => { recorded[recordingKey(provider, sc.id, persona, lang)] = t; };
    let sample: Sample;
    try {
      if (sc.kind === 'talk') {
        const r = await converse({ text: sc.text[lang], lang, persona, history: [], ctx, analysis, memory, seed: `${sc.id}:${persona}` }, wrapped);
        sample = { provider, scenario: sc.id, persona, lang, kind: sc.kind, source: r.source, reply: r.reply, question: r.question, ordersApplied: r.policy !== null, numbersStripped: r.numbersStripped, ms: Date.now() - started, expect: sc.expect };
      } else if (sc.kind === 'doctrine') {
        const r = await compileDoctrine(sc.text[lang], ctx, wrapped, { analysis: renderAnalysis(analysis, lang), memory, crisis: analysis.crisis, seed: `${sc.id}:${persona}` });
        sample = { provider, scenario: sc.id, persona, lang, kind: sc.kind, source: r.source, reply: r.reply, question: r.question, ordersApplied: r.question === null && JSON.stringify(r.policy) !== JSON.stringify(ctx.current), numbersStripped: false, ms: Date.now() - started, expect: sc.expect };
      } else if (sc.kind === 'counsel') {
        const r = await writeCounsel({ persona, lang, tier: 6, options: analysis.options, analysis: renderAnalysis(analysis, lang), memory, crisis: analysis.crisis, minutesToDraw: 20, seed: `${sc.id}:${persona}` }, wrapped);
        sample = { provider, scenario: sc.id, persona, lang, kind: sc.kind, source: r.source, reply: r.cards.map((c) => `[${c.title}] ${c.line}`).join(' / '), question: null, ordersApplied: false, numbersStripped: r.numbersStripped, ms: Date.now() - started, expect: sc.expect };
      } else {
        const names: Record<string, string> = {}; for (const o of Object.values(w.colonies)) names[o.id] = o.name;
        const events = w.events.filter((e) => e.at > w.time - (awaySeconds ?? 3600) && (e.actors.includes(c.id) || e.kind === 'draw'));
        const r = await writeBriefing({ view: viewFor(w, c), events, awaySeconds: awaySeconds ?? 3600, persona, lang, names, analysis, memory, seed: `${sc.id}:${persona}` }, wrapped);
        sample = { provider, scenario: sc.id, persona, lang, kind: sc.kind, source: r.source, reply: r.text, question: null, ordersApplied: false, numbersStripped: r.numbersStripped ?? false, ms: Date.now() - started, expect: sc.expect };
      }
    } catch (err) {
      sample = { provider, scenario: sc.id, persona, lang, kind: sc.kind, source: `error: ${(err as Error).message.slice(0, 80)}`, reply: '', question: null, ordersApplied: false, numbersStripped: false, ms: Date.now() - started, expect: sc.expect };
    }
    samples.push(sample);
    process.stderr.write(`${provider} ${sc.id} ${persona} ${lang} → ${sample.source} (${sample.ms} ms)\n`);
  }
}

if (a.record) { await mkdir('tools/persona-bench/recordings', { recursive: true }); await writeFile('tools/persona-bench/recordings/live.json', JSON.stringify(recorded, null, 1)); console.error('recorded → tools/persona-bench/recordings/live.json'); }
const rows = aggregate(samples);
const md = markdown(rows, samples, { mode: a.live ? 'réel' : a.replay ? `rejeu (${a.replay})` : 'simulé (réponses synthétiques tirées des fiches)', date: new Date().toISOString().slice(0, 10), providers: [...clients.keys()], scenarios: scenarios.map((s) => s.id) });
await mkdir(dirname(a.out!), { recursive: true });
await writeFile(a.out!, md);
console.log(`${samples.length} réponses, rapport → ${a.out}`);
for (const r of rows) console.log(`${r.provider.padEnd(10)} ${r.persona.padEnd(8)} ${r.lang}  modèle ${Math.round(r.modelRate * 100)} %  voix ${Math.round(r.voiceRate * 100)} %  chiffres ${Math.round(r.numbersOk * 100)} %  question ${Math.round(r.questionOk * 100)} %  ordres ${Math.round(r.ordersOk * 100)} %  humour ${Math.round(r.humourOk * 100)} %  ${Math.round(r.avgChars)} c`);
