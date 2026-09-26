// Server-rendered public pages: indexable, shareable, readable without an account.
import type { GazetteIssue } from '@aurane/general';

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function shell(title: string, description: string, body: string, lang: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:site_name" content="Aurane"><link rel="icon" href="/icon.svg"><style>
:root{color-scheme:dark}body{margin:0;background:#05070f;color:#d7dfee;font:16px/1.55 Inter,system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 20px 60px}h1,h2{font-family:Rajdhani,Inter,system-ui,sans-serif;letter-spacing:.04em}h1{font-size:34px;margin:0 0 4px}h2{font-size:18px;color:#7dd3fc;margin:26px 0 6px;text-transform:uppercase;letter-spacing:.1em}.lead{color:#9fb0d0;font-size:18px;margin:0 0 20px}.brand{color:#7dd3fc;letter-spacing:.3em;text-transform:uppercase;font-size:12px;text-decoration:none}nav{display:flex;gap:14px;margin-bottom:24px;font-size:14px}nav a{color:#9fb0d0}a.cta{display:inline-block;margin-top:28px;background:#7dd3fc;color:#06121f;padding:12px 18px;border-radius:10px;font-weight:600;text-decoration:none}.muted{color:#8391b3;font-size:13px}table{border-collapse:collapse;width:100%}td,th{padding:6px 4px;border-bottom:1px solid #1e2947;text-align:left}.founder{color:#f5c76b;font-size:12px;letter-spacing:.04em}
</style></head><body><main><a class="brand" href="/">Aurane · can't stop the signal</a>${body}<a class="cta" href="/">${lang === 'fr' ? 'Entrer dans l\'Aurane' : 'Enter the Aurane'}</a></main></body></html>`;
}

/** The founder title (« Soutenir Aurane », decision 0011): cosmetic, shown next to the name, nothing else. */
export const founderTitle = (lang: 'fr' | 'en'): string => (lang === 'fr' ? 'Fondateur de l\'Aurane' : 'Founder of the Aurane');
const founderMark = (lang: 'fr' | 'en'): string => ` <span class="founder" title="${esc(founderTitle(lang))}">✦ ${esc(founderTitle(lang))}</span>`;

export function renderGazettePage(issue: GazetteIssue | null, lang: 'fr' | 'en', summary: { colonies: { id: string; name: string; faction: string; score: number; founder?: boolean }[] }): string {
  if (!issue) {
    const t = lang === 'fr' ? 'La Gazette paraît demain' : 'The Gazette comes out tomorrow';
    return shell(`Gazette — Aurane`, t, `<h1>${t}</h1><p class="lead">${lang === 'fr' ? 'Le premier jour de la saison est encore en cours.' : 'The first day of the season is still under way.'}</p>`, lang);
  }
  const nav = `<nav><a href="/gazette?lang=fr&day=${issue.day}">FR</a><a href="/gazette?lang=en&day=${issue.day}">EN</a>${issue.day > 1 ? `<a href="/gazette?lang=${lang}&day=${issue.day - 1}">← ${lang === 'fr' ? 'veille' : 'previous'}</a>` : ''}<a href="/gazette?lang=${lang}&day=${issue.day + 1}">${lang === 'fr' ? 'lendemain' : 'next'} →</a></nav>`;
  const sections = issue.sections.map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>`).join('');
  const board = `<h2>${lang === 'fr' ? 'Classement' : 'Standings'}</h2><table>${summary.colonies.slice(0, 10).map((c, i) => `<tr><td>${i + 1}</td><td><a href="/c/${esc(c.id)}" style="color:#d7dfee">${esc(c.name)}</a>${c.founder ? founderMark(lang) : ''}</td><td class="muted">${esc(c.faction)}</td><td>${c.score}</td></tr>`).join('')}</table>`;
  return shell(issue.title, issue.lead, `${nav}<h1>${esc(issue.title)}</h1><p class="lead">${esc(issue.lead)}</p>${sections}${board}<p class="muted">${issue.source === 'llm' ? (lang === 'fr' ? 'Rédigé par la Gazette à partir du journal de la galaxie.' : 'Written by the Gazette from the galaxy\'s log.') : (lang === 'fr' ? 'Dépêche automatique.' : 'Automatic dispatch.')}</p>`, lang);
}

export function renderColonyPage(c: { id: string; name: string; faction: string; persona: string; alliance: string | null; score: number; connected: number; npc: boolean; beacons: string[]; founder?: boolean }): string {
  const body = `<h1>${esc(c.name)}</h1>${c.founder ? `<p class="founder">✦ ${esc(founderTitle('fr'))}</p>` : ''}<p class="lead">${esc(c.faction)}${c.alliance ? ` · ${esc(c.alliance)}` : ''}${c.npc ? ' · PNJ' : ''}</p><table><tr><th>Score</th><td>${c.score}</td></tr><tr><th>Systèmes</th><td>${c.connected}</td></tr><tr><th>Général</th><td>${esc(c.persona)}</td></tr>${c.beacons.length ? `<tr><th>Phares</th><td>${esc(c.beacons.join(', '))}</td></tr>` : ''}</table>`;
  return shell(`${c.name} — Aurane`, `${c.name}, ${c.faction}, score ${c.score}`, body, 'fr');
}
