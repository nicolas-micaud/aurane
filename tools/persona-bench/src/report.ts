// Side-by-side report: for each provider, persona and language, how the General held its voice.
import { SHEETS, PERSONA_VOICES } from '@aurane/general';
import type { Persona } from '@aurane/protocol';

export interface Sample { provider: string; scenario: string; persona: Persona; lang: 'fr' | 'en'; kind: string; source: string; reply: string; question: string | null; ordersApplied: boolean; numbersStripped: boolean; ms: number; expect: { crisis: boolean; question?: boolean; ordersMustBeNull?: boolean; humourAllowed: boolean } }

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

export function markdown(rows: Row[], samples: Sample[], meta: { mode: string; date: string; providers: string[]; scenarios: string[] }): string {
  const L: string[] = [];
  L.push('# Banc des personas — rapport', '', `Généré le ${meta.date} par \`tools/persona-bench\` en mode **${meta.mode}**. Fournisseurs : ${meta.providers.join(', ')}. Scénarios : ${meta.scenarios.join(', ')}.`, '');
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
