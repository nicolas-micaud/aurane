#!/usr/bin/env node
/* global process, console, URL */
// Static generator for playaurane.com. No dependency: reads site/content, writes site/dist.
// Pages: / (French, x-default, redirects English browsers once), /fr/, /en/, /fr/regles/, /en/rules/,
// /fr/confidentialite/, /en/privacy/, 404.html, sitemap.xml, robots.txt, site.webmanifest.
// Configuration by environment (all optional): SITE_ORIGIN, PLAY_URL, WAITLIST_URL, TURNSTILE_SITEKEY,
// DISCORD_URL, X_URL, CONTACT_EMAIL. Social links are rendered only when their URL is set.
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SITE_OUT ?? join(here, 'dist');
const cfg = {
  origin: (process.env.SITE_ORIGIN ?? 'https://playaurane.com').replace(/\/$/, ''),
  play: process.env.PLAY_URL ?? 'https://play.playaurane.com',
  waitlist: process.env.WAITLIST_URL ?? 'https://api.playaurane.com/waitlist',
  turnstile: process.env.TURNSTILE_SITEKEY ?? '0x4AAAAAAFCSIqXFBc1hwh8k',
  discord: process.env.DISCORD_URL ?? '',
  x: process.env.X_URL ?? '',
  contact: process.env.CONTACT_EMAIL ?? '',
};

const strings = JSON.parse(await readFile(join(here, 'content/strings.json'), 'utf8'));
const sections = JSON.parse(await readFile(join(here, 'content/sections.json'), 'utf8'));
const css = await readFile(join(here, 'styles.css'), 'utf8');
const exists = async (p) => stat(p).then(() => true, () => false);
const media = {
  video: await exists(join(here, 'media/hero.webm')),
  poster: await exists(join(here, 'media/hero-poster.webp')),
  og: await exists(join(here, 'media/og.png')),
  bg: await exists(join(here, 'media/bg.webp')),
};

const PATHS = {
  fr: { home: '/fr/', rules: '/fr/regles/', privacy: '/fr/confidentialite/', waitlist: '#liste-d-attente' },
  en: { home: '/en/', rules: '/en/rules/', privacy: '/en/privacy/', waitlist: '#waitlist' },
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (html) => html.replace(/<[^>]+>/g, '');

/** The <head> shared by every page: meta, OG/Twitter, hreflang, icons, inline CSS. */
function head({ lang, title, description, path, alternates, canonical, noindex = false }) {
  const t = strings[lang];
  const url = cfg.origin + path;
  const ogImage = `${cfg.origin}/og.png`;
  const alt = Object.entries(alternates).map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${cfg.origin}${p}">`).join('\n');
  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${cfg.origin}${canonical ?? path}">
${alt}
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Aurane">
<meta property="og:locale" content="${lang === 'fr' ? 'fr_FR' : 'en_GB'}">
<meta property="og:locale:alternate" content="${lang === 'fr' ? 'en_GB' : 'fr_FR'}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Aurane — ${esc(t.tagline)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImage}">
${cfg.x ? `<meta name="twitter:site" content="@playaurane">` : ''}
<meta name="theme-color" content="#05070f">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/svg+xml" href="/aurane.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<style>${css}</style>
</head>`;
}

function top(lang, page) {
  const t = strings[lang];
  const p = PATHS[lang];
  const other = t.otherLang;
  const otherPath = page === 'rules' ? PATHS[other].rules : page === 'privacy' ? PATHS[other].privacy : PATHS[other].home;
  const nav = page === 'home'
    ? `<a href="#jeu" class="sec">${esc(t.nav.game)}</a><a href="#general" class="sec">${esc(t.nav.general)}</a><a href="#factions" class="sec">${esc(t.nav.factions)}</a><a href="${p.rules}">${esc(t.nav.rules)}</a><a href="${p.waitlist}">${esc(t.nav.waitlist)}</a>`
    : `<a href="${p.home}">${esc(t.backHome)}</a><a href="${p.home}${p.waitlist}">${esc(t.nav.waitlist)}</a>`;
  return `<a class="skip" href="#main">${esc(t.skip)}</a>
<div class="bg" aria-hidden="true"></div>
<header class="wrap top">
<a class="brand" href="${p.home}" data-setlang="${lang}"><img src="/aurane.svg" alt="" width="34" height="34">AURANE</a>
<nav aria-label="${lang === 'fr' ? 'Navigation' : 'Navigation'}">${nav}
<span class="lang" aria-label="${lang === 'fr' ? 'Langue' : 'Language'}">${lang === 'fr' ? '<span lang="fr">FR</span>' : `<a href="${otherPath}" hreflang="fr" lang="fr" data-setlang="fr">FR</a>`}${lang === 'en' ? '<span lang="en">EN</span>' : `<a href="${otherPath}" hreflang="en" lang="en" data-setlang="en">EN</a>`}</span></nav>
</header>`;
}

function footer(lang) {
  const t = strings[lang];
  const p = PATHS[lang];
  const social = [cfg.discord ? `<a href="${esc(cfg.discord)}" rel="noopener">${esc(t.footer.discord)}</a>` : '', cfg.x ? `<a href="${esc(cfg.x)}" rel="noopener">${esc(t.footer.x)}</a>` : ''].filter(Boolean).join('');
  const contact = cfg.contact ? `<a href="mailto:${esc(cfg.contact)}">${esc(cfg.contact)}</a>` : '';
  return `<footer><div class="wrap"><span>${esc(t.footer.legal)}</span><nav aria-label="${lang === 'fr' ? 'Pied de page' : 'Footer'}"><a href="${p.rules}">${esc(t.nav.rules)}</a><a href="${p.privacy}">${esc(t.nav.privacy)}</a><a href="${cfg.play}">${esc(t.nav.play)}</a>${social}${contact}</nav></div></footer>`;
}

/** Language memory, the one-time redirect at "/", UTM and referrer capture, and the waitlist submission. */
function script(lang, isRoot) {
  return `<script>
(function(){
var L=${JSON.stringify(lang)};
try{
var saved=localStorage.getItem('aurane.lang');
${isRoot ? `if(!saved&&(navigator.language||'').toLowerCase().indexOf('fr')!==0){location.replace('/en/'+location.search+location.hash);return;}
if(saved==='en'){location.replace('/en/'+location.search+location.hash);return;}` : ''}
document.querySelectorAll('[data-setlang]').forEach(function(a){a.addEventListener('click',function(){try{localStorage.setItem('aurane.lang',a.getAttribute('data-setlang'))}catch(e){}})});
}catch(e){}
var f=document.getElementById('waitlist');if(!f)return;
var M=${JSON.stringify(strings[lang].form)};
try{
var q=new URLSearchParams(location.search),keep={};
['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){var v=q.get(k);if(v)keep[k]=v.slice(0,120)});
var s=sessionStorage.getItem('aurane.utm');if(s&&!Object.keys(keep).length)keep=JSON.parse(s);else if(Object.keys(keep).length)sessionStorage.setItem('aurane.utm',JSON.stringify(keep));
Object.keys(keep).forEach(function(k){if(f.elements[k])f.elements[k].value=keep[k]});
var r=document.referrer;if(r&&r.indexOf(location.host)<0)f.elements.referrer.value=r.slice(0,300);
f.elements.page.value=location.pathname;
}catch(e){}
var st=document.getElementById('wl-status'),btn=f.querySelector('button[type=submit]');
function say(k,ok){st.textContent=M[k]||M.err;st.className='status '+(ok?'ok':'err')}
f.addEventListener('submit',function(e){
e.preventDefault();
if(!f.elements.email.value||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(f.elements.email.value)){say('invalid');f.elements.email.focus();return}
if(!f.elements.consent.checked){say('consentRequired');f.elements.consent.focus();return}
btn.disabled=true;st.className='status';st.textContent=M.sending;
fetch(f.action,{method:'POST',body:new FormData(f)}).then(function(r){return r.json().catch(function(){return{}})}).then(function(j){
if(j.ok){say('ok',true);f.reset()}else{say(j.error||'err')}
if(window.turnstile){try{window.turnstile.reset()}catch(_){}}
}).catch(function(){say('err')}).then(function(){btn.disabled=false});
});
})();
</script>`;
}

function waitlistForm(lang) {
  const t = strings[lang];
  const p = PATHS[lang];
  const id = p.waitlist.slice(1);
  return `<section id="${id}" class="waitlist" aria-labelledby="wl-title">
<h2 id="wl-title">${esc(t.form.title)}</h2>
<p class="lead">${esc(t.form.lead)}</p>
<form id="waitlist" method="post" action="${esc(cfg.waitlist)}" novalidate>
<label class="field">${esc(t.form.email)}<input type="email" name="email" required autocomplete="email" inputmode="email"></label>
<label class="field">${esc(t.form.name)}<input type="text" name="name" autocomplete="nickname" maxlength="60"></label>
<label class="field">${esc(t.form.langLabel)}<select name="lang"><option value="fr"${lang === 'fr' ? ' selected' : ''}>${esc(t.form.fr)}</option><option value="en"${lang === 'en' ? ' selected' : ''}>${esc(t.form.en)}</option></select></label>
<label class="consent"><input type="checkbox" name="consent" value="1" required><span>${esc(t.form.consent)} <a href="${p.privacy}">${esc(t.form.privacyLink)}</a>.</span></label>
<div class="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<input type="hidden" name="utm_source"><input type="hidden" name="utm_medium"><input type="hidden" name="utm_campaign"><input type="hidden" name="utm_content"><input type="hidden" name="utm_term"><input type="hidden" name="referrer"><input type="hidden" name="page">
<div class="cf-turnstile" data-sitekey="${esc(cfg.turnstile)}" data-theme="dark" data-language="${lang}"></div>
<button type="submit" class="btn">${esc(t.form.submit)}</button>
<p id="wl-status" class="status" role="status" aria-live="polite"></p>
</form>
</section>`;
}

function hero(lang) {
  const t = strings[lang];
  const p = PATHS[lang];
  const poster = media.poster ? '/hero-poster.webp' : '/images/game/section-system.jpg';
  const visual = media.video
    ? `<video autoplay muted loop playsinline preload="metadata" poster="${poster}" width="1280" height="720" aria-label="${esc(t.videoCaption)}"><source src="/hero.webm" type="video/webm"><img src="${poster}" alt="${esc(t.videoFallback)}" width="1280" height="720"></video>`
    : `<img src="${poster}" alt="${esc(t.videoFallback)}" width="1280" height="720" fetchpriority="high">`;
  return `<section class="hero" aria-labelledby="h1">
<img class="logo" src="/aurane.svg" alt="" width="84" height="84">
<h1 id="h1">AURANE</h1>
<p class="tagline">${esc(t.tagline)}</p>
<p class="hook">${esc(t.hook)}</p>
<p><a class="cta" href="${p.waitlist}">${esc(t.cta)}<small>${esc(t.ctaSub)}</small></a></p>
<p class="alt"><a href="${cfg.play}">${esc(t.haveCode)} →</a></p>
<p class="season-line">${esc(t.seasonLine)}</p>
<figure class="shot">${visual}<figcaption>${esc(t.videoCaption)}</figcaption></figure>
</section>`;
}

function landing(lang, { isRoot = false } = {}) {
  const t = strings[lang];
  const p = PATHS[lang];
  const intro = sections.intro.intro[lang];
  const about = sections.about.intro[lang];
  const lore = sections.work.intro[lang];
  const factions = sections.factions.sections.filter((s) => s.id.en !== 'beacons');
  const season = sections.contact.intro[lang][0];
  const path = isRoot ? '/' : p.home;
  const body = `${top(lang, 'home')}
<main id="main" class="wrap">
${hero(lang)}
<section id="jeu" aria-labelledby="h-jeu">
<h2 id="h-jeu">${esc(sections.intro.title[lang])}</h2>
<div class="prose">${intro.map((x) => `<p>${x}</p>`).join('')}</div>
<h3 style="margin-top:22px">${esc(t.threeTitle)}</h3>
<div class="cards">${t.points.map((pt) => `<article class="card" id="${pt.id}"><img src="${pt.icon}" alt="" width="64" height="64" loading="lazy"><h3>${esc(pt.title)}</h3><p>${pt.quote}</p></article>`).join('')}</div>
<p><a class="more" href="${p.rules}">${esc(t.rulesLink)} →</a></p>
</section>
<section id="general" aria-labelledby="h-general">
<h2 id="h-general">${esc(sections.about.title[lang])}</h2>
<div class="prose">${about.map((x) => `<p>${x}</p>`).join('')}</div>
</section>
<section id="aurane" aria-labelledby="h-aurane">
<h2 id="h-aurane">${esc(sections.work.title[lang])}</h2>
<div class="prose">${lore.map((x) => `<p>${x}</p>`).join('')}</div>
</section>
<section id="factions" aria-labelledby="h-factions">
<h2 id="h-factions">${esc(sections.factions.title[lang])}</h2>
<p class="lead">${sections.factions.intro[lang][0]}</p>
<div class="cards">${factions.map((f) => `<article class="card faction f-${f.id.fr}"><h3>${esc(f.title[lang])}</h3><p>${f[lang][0]}</p></article>`).join('')}</div>
<p><a class="more" href="${p.rules}#${sections.factions.sections.find((s) => s.id.en === 'beacons').id[lang]}">${esc(sections.factions.sections.find((s) => s.id.en === 'beacons').title[lang])} →</a></p>
</section>
<section id="saison" aria-labelledby="h-saison">
<h2 id="h-saison">${esc(sections.contact.title[lang])}</h2>
<div class="prose"><p>${season}</p><p><strong>${esc(t.seasonLine)}</strong> <a href="${cfg.play}">${esc(t.haveCode)} →</a></p></div>
${waitlistForm(lang)}
</section>
</main>
${footer(lang)}
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
${script(lang, isRoot)}
</body></html>`;
  return head({ lang, title: t.title, description: t.description, path, canonical: p.home, alternates: { fr: PATHS.fr.home, en: PATHS.en.home, 'x-default': '/' } }) + '\n<body>\n' + body;
}

function rules(lang) {
  const t = strings[lang];
  const p = PATHS[lang];
  const play = sections.play;
  const beacons = sections.factions.sections.find((s) => s.id.en === 'beacons');
  const list = [...play.sections, beacons];
  const one = (s) => `<article class="rule" id="${s.id[lang]}"><h2>${esc(s.title[lang])} <a class="anchor" href="#${s.id[lang]}" title="${esc(t.anchorTitle)}">#</a></h2>
${s.icons.length ? `<ul class="icons">${s.icons.map((i) => `<li><img src="${i.src}" alt="${esc(i.alt)}" width="64" height="64" loading="lazy">${esc(i[lang])}</li>`).join('')}</ul>` : ''}
${s[lang].map((x) => `<p>${x}</p>`).join('')}</article>`;
  const body = `${top(lang, 'rules')}
<main id="main" class="wrap doc">
<h1>${esc(t.rulesH1)}</h1>
<img class="banner" src="/images/game/section-system.jpg" alt="${lang === 'fr' ? 'Un système et ses orbites : signal, défense, industrie' : 'A system and its orbits: signal, defence, industry'}" width="1200" height="400" loading="lazy">
<p class="lead">${play.intro[lang][0]}</p>
<nav class="toc" aria-labelledby="toc"><h2 id="toc">${esc(t.toc)}</h2><ol>${list.map((s) => `<li><a href="#${s.id[lang]}">${esc(s.title[lang])}</a></li>`).join('')}</ol></nav>
${list.map(one).join('\n')}
<p style="margin-top:28px"><a class="cta" href="${p.home}${p.waitlist}">${esc(t.cta)}<small>${esc(t.ctaSub)}</small></a></p>
</main>
${footer(lang)}
${script(lang, false)}
</body></html>`;
  return head({ lang, title: t.rulesTitle, description: t.rulesDescription, path: p.rules, alternates: { fr: PATHS.fr.rules, en: PATHS.en.rules, 'x-default': PATHS.fr.rules } }) + '\n<body>\n' + body;
}

function privacy(lang) {
  const t = strings[lang];
  const p = PATHS[lang];
  const contactLine = cfg.contact ? `<p><a href="mailto:${esc(cfg.contact)}">${esc(cfg.contact)}</a></p>` : '';
  const body = `${top(lang, 'privacy')}
<main id="main" class="wrap doc prose">
<h1>${esc(t.privacy.h1)}</h1>
<p class="lead">${esc(t.privacy.updated)}</p>
${t.privacy.blocks.map((b) => `<h2>${esc(b.h)}</h2>${b.p.map((x) => `<p>${x}</p>`).join('')}`).join('\n')}
${contactLine}
</main>
${footer(lang)}
${script(lang, false)}
</body></html>`;
  return head({ lang, title: t.privacyTitle, description: t.privacyDescription, path: p.privacy, alternates: { fr: PATHS.fr.privacy, en: PATHS.en.privacy, 'x-default': PATHS.fr.privacy } }) + '\n<body>\n' + body;
}

function notFound() {
  return head({ lang: 'fr', title: 'Aurane — 404', description: strings.fr.description, path: '/404.html', alternates: {}, noindex: true }) + `
<body>${top('fr', 'privacy')}<main id="main" class="wrap doc"><h1>404</h1><p>Cette page n'existe pas. / This page does not exist.</p><p><a href="/fr/">Accueil</a> · <a href="/en/">Home</a></p></main>${footer('fr')}</body></html>`;
}

function sitemap() {
  const pages = [
    { fr: PATHS.fr.home, en: PATHS.en.home, root: '/' },
    { fr: PATHS.fr.rules, en: PATHS.en.rules },
    { fr: PATHS.fr.privacy, en: PATHS.en.privacy },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc, alts) => `<url><loc>${cfg.origin}${loc}</loc><lastmod>${today}</lastmod>${Object.entries(alts).map(([l, h]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${cfg.origin}${h}"/>`).join('')}</url>`;
  const urls = [];
  for (const pg of pages) {
    const alts = { fr: pg.fr, en: pg.en, 'x-default': pg.root ?? pg.fr };
    if (pg.root) urls.push(url(pg.root, alts));
    urls.push(url(pg.fr, alts), url(pg.en, alts));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

async function write(path, content) {
  const file = join(OUT, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(join(here, 'public'), OUT, { recursive: true });
for (const [key, name] of [['video', 'hero.webm'], ['poster', 'hero-poster.webp'], ['og', 'og.png'], ['bg', 'bg.webp']]) {
  if (media[key]) await cp(join(here, 'media', name), join(OUT, name));
  else console.warn(`[site] media/${name} missing: ${key === 'og' ? 'social previews will have no image' : key === 'bg' ? 'the background falls back to bg.jpg' : 'the hero shows the fallback image'}`);
}
if (!media.bg) await cp(join(here, 'public/bg.jpg'), join(OUT, 'bg.webp')).catch(() => undefined); // same bytes, wrong name: browsers sniff it
await write('index.html', landing('fr', { isRoot: true }));
await write('fr/index.html', landing('fr'));
await write('en/index.html', landing('en'));
await write('fr/regles/index.html', rules('fr'));
await write('en/rules/index.html', rules('en'));
await write('fr/confidentialite/index.html', privacy('fr'));
await write('en/privacy/index.html', privacy('en'));
await write('404.html', notFound());
await write('sitemap.xml', sitemap());
await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${cfg.origin}/sitemap.xml\n`);
await write('site.webmanifest', JSON.stringify({ name: 'Aurane', short_name: 'Aurane', description: text(strings.fr.description), start_url: '/', display: 'browser', background_color: '#05070f', theme_color: '#05070f', icons: [{ src: '/favicon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] }, null, 1));
await write('CNAME', `${new URL(cfg.origin).host}\n`);
await write('.nojekyll', '');
console.log(`[site] built into ${OUT}`);
