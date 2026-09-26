// Side-by-side report: for each provider, persona and language, how the General held its voice.
import { SHEETS, PERSONA_VOICES } from '@aurane/general';
import type { Persona } from '@aurane/protocol';

export interface Sample { provider: string; scenario: string; persona: Persona; lang: 'fr' | 'en'; kind: string; source: string; reply: string; question: string | null; ordersApplied: boolean; numbersStripped: boolean; ms: number; expect: { crisis: boolean; question?: boolean; ordersMustBeNull?: boolean; humourAllowed: boolean };
  /** Doctrine scenarios with a check: was the compiled result right? */
  correct?: boolean | undefined;
  /** Every raw model call behind the sample (live mode). */
  calls?: Call[] | undefined;
  /** A repair turn was needed (first answer off-schema) / a corrective turn for invented figures. */
  repaired?: boolean | undefined;
  numbersRetry?: boolean | undefined;
}

export interface Call { ms: number; inputTokens: number; outputTokens: number; ok: boolean; json: boolean | null; error?: string | undefined }

export interface ProviderSummary {
  provider: string; samples: number; calls: number; errors: number; timeouts: number;
  /** Final answers from the model (schema-valid, possibly after the one repair). */
  modelRate: number;
  /** JSON tasks: raw answers that parsed as JSON at the first try. */
  jsonFirstTry: number;
  /** Answers with no invented figure (after the corrective turn), and without needing it. */
  numbersOk: number; numbersFirstTry: number;
  voiceRate: number; questionOk: number; ordersOk: number; doctrineOk: number; doctrineN: number;
  p50: number; p90: number; talkP90: number; counselP90: number; avgIn: number; avgOut: number;
  /** EUR per 1000 raw calls at the configured price. */
  eurPer1k: number; spendEur: number;
}

const quant = (xs: number[], q: number): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0; };

/** One line per provider: the numbers that decide a model choice. */
export function summarize(samples: Sample[], prices: Record<string, { inPerM: number; outPerM: number }>): ProviderSummary[] {
  const out: ProviderSummary[] = [];
  for (const provider of [...new Set(samples.map((s) => s.provider))]) {
    const list = samples.filter((s) => s.provider === provider);
    const calls = list.flatMap((s) => s.calls ?? []);
    const okCalls = calls.filter((c) => c.ok);
    const jsonCalls = calls.filter((c) => c.json !== null);
    const firstJson = list.filter((s) => s.calls?.[0]?.json !== null && s.calls?.[0]?.json !== undefined);
    const rows = aggregate(list);
    const avg = (f: (r: Row) => number): number => rows.reduce((a, r) => a + f(r) * r.n, 0) / Math.max(1, rows.reduce((a, r) => a + r.n, 0));
    const doc = list.filter((s) => s.correct !== undefined);
    const price = prices[provider] ?? { inPerM: 0, outPerM: 0 };
    const cost = (c: Call): number => (c.inputTokens * price.inPerM + c.outputTokens * price.outPerM) / 1e6;
    const spend = calls.reduce((a, c) => a + cost(c), 0);
    const talkMs = list.filter((s) => s.kind === 'talk' && s.source === 'llm').map((s) => s.ms);
    const counselMs = list.filter((s) => s.kind === 'counsel').flatMap((s) => (s.calls ?? []).map((c) => c.ms));
    out.push({
      provider, samples: list.length, calls: calls.length, errors: calls.filter((c) => !c.ok).length, timeouts: calls.filter((c) => /timeout/.test(c.error ?? '')).length,
      modelRate: list.filter((s) => s.source === 'llm').length / Math.max(1, list.length),
      jsonFirstTry: jsonCalls.length ? firstJson.filter((s) => s.calls![0]!.json === true).length / Math.max(1, firstJson.length) : 1,
      numbersOk: list.filter((s) => !s.numbersStripped).length / Math.max(1, list.length),
      numbersFirstTry: list.filter((s) => !s.numbersStripped && !s.numbersRetry).length / Math.max(1, list.length),
      voiceRate: avg((r) => r.voiceRate), questionOk: avg((r) => r.questionOk), ordersOk: avg((r) => r.ordersOk),
      doctrineOk: doc.length ? doc.filter((s) => s.correct).length / doc.length : 1, doctrineN: doc.length,
      p50: quant(okCalls.map((c) => c.ms), 0.5), p90: quant(okCalls.map((c) => c.ms), 0.9), talkP90: quant(talkMs, 0.9), counselP90: quant(counselMs, 0.9),
      avgIn: okCalls.reduce((a, c) => a + c.inputTokens, 0) / Math.max(1, okCalls.length), avgOut: okCalls.reduce((a, c) => a + c.outputTokens, 0) / Math.max(1, okCalls.length),
      eurPer1k: calls.length ? (spend / calls.length) * 1000 : 0, spendEur: spend,
    });
  }
  return out;
}

export function summaryMarkdown(rows: ProviderSummary[]): string[] {
  const L = ['## Synthèse par fournisseur', '', 'Appels bruts : **JSON 1er essai** = la première réponse d\'une tâche JSON se lit comme du JSON ; **chiffres 1er essai** = aucun chiffre inventé sans tour correctif ; **doctrine** = compilation juste (champs attendus) et doctrine suicidaire non compilée ; latences sur les appels réussis ; coût au prix configuré (`_PRICE_IN/_OUT`).', '',
    '| Fournisseur | n | appels | erreurs (timeouts) | modèle | JSON 1er essai | chiffres | chiffres 1er essai | voix | question | ordres | doctrine | p50 ms | p90 ms | talk p90 (bout en bout) | counsel p90 | jetons in/out | EUR / 1k appels | dépense EUR |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) L.push(`| ${r.provider} | ${r.samples} | ${r.calls} | ${r.errors} (${r.timeouts}) | ${pct(r.modelRate)} | ${pct(r.jsonFirstTry)} | ${pct(r.numbersOk)} | ${pct(r.numbersFirstTry)} | ${pct(r.voiceRate)} | ${pct(r.questionOk)} | ${pct(r.ordersOk)} | ${pct(r.doctrineOk)} (${r.doctrineN}) | ${r.p50} | ${r.p90} | ${r.talkP90} | ${r.counselP90} | ${Math.round(r.avgIn)}/${Math.round(r.avgOut)} | ${r.eurPer1k.toFixed(3)} | ${r.spendEur.toFixed(4)} |`);
  L.push('');
  return L;
}

const sentences = (t: string): string[] => t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
const JOKE = /blague|rire|joke|laugh|sourire|smile|drôle|funny/i;

/** Markers of a persona's voice: sign-off words, catchphrases, address form, obsessions vocabulary. */
function markers(p: Persona, lang: 'fr' | 'en'): RegExp[] {
  const s = SHEETS[p]; const v = PERSONA_VOICES[p].character[lang];
  const words = [...v.catchphrases, s.signoff[lang], ...s.obsessions[lang], ...s.tics[lang]].flatMap((x) => x.toLowerCase().replace(/[«»"“”.!,;:]/g, '').split(/\s+/)).filter((w) => w.length >= 6);
  const extra: Record<Persona, RegExp[]> = {
    vane: [/\bpont|bridge|tourelle|turret|tenu|held|réserve|reserve|rien ne passe|nothing gets through/i],
    kestrel: [/\bcible|target|raid|rium|chef|boss|patron|dis un mot|say the word/i],
    oriel: [/\bcrédits?|credits?|marge|margin|prix|price|%|rendement|return|comptes|books|vous\b|associé|partner/i],
    solen: [/\bvoisin|neighbour|phare|beacon|traité|treaty|signal|mon ami|my friend|paix|peace/i],
  };
  return [...extra[p], ...[...new Set(words)].slice(0, 20).map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'))];
}

export interface Row { provider: string; persona: Persona; lang: 'fr' | 'en'; n: number; modelRate: number; voiceRate: number; numbersOk: number; questionOk: number; ordersOk: number; humourOk: number; avgChars: number; avgSentences: number; longRate: number; repetition: number; avgMs: number }

export function aggregate(samples: Sample[]): Row[] {
  const groups = new Map<string, Sample[]>();
  for (const s of samples) { const k = `${s.provider}|${s.persona}|${s.lang}`; groups.set(k, [...(groups.get(k) ?? []), s]); }
  const rows: Row[] = [];
  for (const [k, list] of groups) {
    const [provider, persona, lang] = k.split('|') as [string, Persona, 'fr' | 'en'];
    const ms = markers(persona, lang);
    const n = list.length;
    const model = list.filter((s) => s.source === 'llm').length;
    const voice = list.filter((s) => ms.some((m) => m.test(s.reply))).length;
    const numbers = list.filter((s) => !s.numbersStripped).length;
    const qCases = list.filter((s) => s.expect.question !== undefined);
    const qOk = qCases.filter((s) => (s.question !== null) === s.expect.question).length;
    const oCases = list.filter((s) => s.expect.ordersMustBeNull);
    const oOk = oCases.filter((s) => !s.ordersApplied).length;
    const hCases = list.filter((s) => !s.expect.humourAllowed);
    const hOk = hCases.filter((s) => !JOKE.test(s.reply)).length;
    const chars = list.reduce((a, s) => a + s.reply.length, 0) / n;
    const sents = list.reduce((a, s) => a + sentences(s.reply).length, 0) / n;
    const long = list.filter((s) => sentences(s.reply).length > 3 && s.kind !== 'briefing').length;
    const all = list.flatMap((s) => sentences(s.reply).map((x) => x.toLowerCase()));
    const dup = all.length - new Set(all).size;
    rows.push({ provider, persona, lang, n, modelRate: model / n, voiceRate: voice / n, numbersOk: numbers / n, questionOk: qCases.length ? qOk / qCases.length : 1, ordersOk: oCases.length ? oOk / oCases.length : 1, humourOk: hCases.length ? hOk / hCases.length : 1, avgChars: chars, avgSentences: sents, longRate: long / n, repetition: all.length ? dup / all.length : 0, avgMs: list.reduce((a, s) => a + s.ms, 0) / n });
  }
  return rows.sort((a, b) => a.provider.localeCompare(b.provider) || a.persona.localeCompare(b.persona) || a.lang.localeCompare(b.lang));
}

const pct = (x: number): string => `${Math.round(x * 100)} %`;

export function markdown(rows: Row[], samples: Sample[], meta: { mode: string; date: string; providers: string[]; scenarios: string[] }, summary: string[] = []): string {
  const L: string[] = [];
  L.push('# Banc des personas — rapport', '', `Généré le ${meta.date} par \`tools/persona-bench\` en mode **${meta.mode}**. Fournisseurs : ${meta.providers.join(', ')}. Scénarios : ${meta.scenarios.join(', ')}.`, '');
  L.push(...summary);
  L.push('Colonnes : **modèle** = part des réponses venues du modèle (sinon repli heuristique ou dégradation : le schéma a été refusé ou la classe indisponible) ; **voix** = part des réponses portant au moins un marqueur du personnage ; **chiffres** = part des réponses sans chiffre inventé (aucune phrase retirée) ; **question** = le Général a posé une question exactement quand le scénario l\'attendait ; **ordres** = aucun ordre appliqué quand il ne fallait pas (injection, doctrine ambiguë) ; **humour** = pas de plaisanterie dans les scénarios de crise ou de trahison ; **longueur** = caractères et phrases moyens, part des réponses de plus de trois phrases ; **répétition** = part de phrases déjà vues dans les autres réponses du même Général.', '');
  L.push('| Fournisseur | Général | Langue | n | modèle | voix | chiffres | question | ordres | humour | longueur | > 3 phrases | répétition | ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.provider} | ${r.persona} | ${r.lang} | ${r.n} | ${pct(r.modelRate)} | ${pct(r.voiceRate)} | ${pct(r.numbersOk)} | ${pct(r.questionOk)} | ${pct(r.ordersOk)} | ${pct(r.humourOk)} | ${Math.round(r.avgChars)} c, ${r.avgSentences.toFixed(1)} ph | ${pct(r.longRate)} | ${pct(r.repetition)} | ${Math.round(r.avgMs)} |`);
  L.push('', '## Cohérence de voix entre fournisseurs', '');
  const byPersona = new Map<string, Row[]>();
  for (const r of rows) byPersona.set(`${r.persona}|${r.lang}`, [...(byPersona.get(`${r.persona}|${r.lang}`) ?? []), r]);
  for (const [k, list] of byPersona) {
    const [persona, lang] = k.split('|');
    const spread = Math.max(...list.map((r) => r.voiceRate)) - Math.min(...list.map((r) => r.voiceRate));
    L.push(`- **${persona} / ${lang}** : voix de ${pct(Math.min(...list.map((r) => r.voiceRate)))} à ${pct(Math.max(...list.map((r) => r.voiceRate)))} selon le fournisseur (écart ${pct(spread)}) ; longueur de ${Math.round(Math.min(...list.map((r) => r.avgChars)))} à ${Math.round(Math.max(...list.map((r) => r.avgChars)))} caractères.`);
  }
  L.push('', '## Réponses, côte à côte', '');
  const scenarios = [...new Set(samples.map((s) => s.scenario))];
  for (const sc of scenarios) {
    L.push(`### ${sc}`, '');
    for (const persona of ['vane', 'kestrel', 'oriel', 'solen'] as Persona[]) for (const lang of ['fr', 'en'] as const) {
      const rowsFor = samples.filter((s) => s.scenario === sc && s.persona === persona && s.lang === lang);
      if (!rowsFor.length) continue;
      L.push(`**${persona} / ${lang}**`, '');
      for (const s of rowsFor) L.push(`- _${s.provider}_ (${s.source}${s.numbersStripped ? ', chiffres retirés' : ''}${s.question ? ', question' : ''}${s.ordersApplied ? ', ordres appliqués' : ''}) : ${s.reply.replace(/\n/g, ' / ').slice(0, 500)}`);
      L.push('');
    }
  }
  return L.join('\n') + '\n';
}
