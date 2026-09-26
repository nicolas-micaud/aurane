// The landing build: every page exists, no dead link, bilingual markup, form contract, verbatim quotes.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
let out: string;
const read = (p: string) => readFile(join(out, p), 'utf8');
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), 'aurane-site-'));
  await promisify(execFile)('node', [join(site, 'build.mjs')], { env: { ...process.env, SITE_OUT: out, DISCORD_URL: '', X_URL: '' } });
}, 60000);

const PAGES = ['index.html', 'fr/index.html', 'en/index.html', 'fr/regles/index.html', 'en/rules/index.html', 'fr/confidentialite/index.html', 'en/privacy/index.html', '404.html'];

describe('landing build', () => {
  it('writes every page and the crawl files', async () => {
    for (const p of [...PAGES, 'sitemap.xml', 'robots.txt', 'site.webmanifest', 'CNAME', '.nojekyll', 'favicon.ico', 'aurane.svg']) expect((await stat(join(out, p))).isFile(), p).toBe(true);
    expect(await read('CNAME')).toBe('playaurane.com\n');
    expect(await read('robots.txt')).toContain('Sitemap: https://playaurane.com/sitemap.xml');
  });

  it('has no dead link and no template leftovers', async () => {
    for (const p of PAGES) {
      const html = await read(p);
      expect(html, p).not.toMatch(/href="#"/);
      expect(html, p).not.toMatch(/href=""/);
      expect(html, p).not.toMatch(/lorem|html5up|jquery|fontawesome|Dimension by/i);
      expect(html, p).not.toMatch(/pic0[123]\.jpg/);
      // Every in-page anchor points at an existing id.
      for (const m of html.matchAll(/href="#([^"]+)"/g)) expect(html, `${p} #${m[1]}`).toContain(`id="${m[1]}"`);
    }
  });

  it('is bilingual with hreflang, canonical and social tags', async () => {
    const fr = await read('fr/index.html'), en = await read('en/index.html'), root = await read('index.html');
    expect(fr).toContain('<html lang="fr">');
    expect(en).toContain('<html lang="en">');
    for (const html of [fr, en, root]) {
      expect(html).toContain('hreflang="fr" href="https://playaurane.com/fr/"');
      expect(html).toContain('hreflang="en" href="https://playaurane.com/en/"');
      expect(html).toContain('hreflang="x-default" href="https://playaurane.com/"');
      expect(html).toContain('property="og:image" content="https://playaurane.com/og.png"');
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
    }
    expect(root).toContain('<link rel="canonical" href="https://playaurane.com/fr/">');
    expect(root).toContain("location.replace('/en/'");
    expect(fr).not.toContain("location.replace('/en/'");
    expect(en).toContain('Your General thinks with you, plays while you sleep and forgets nothing: not your choices, not your allies, not those who betrayed you. A partner, not an autopilot.');
    expect(fr).toContain("Ton Général pense avec toi, joue quand tu dors et n'oublie rien : ni tes choix, ni tes alliés, ni ceux qui t'ont trahi. Un partenaire, pas un pilote automatique.");
    // The tagline stays as it is.
    expect(text(fr)).toContain("can't stop the signal");
  });

  it('keeps the original texts and quotes them verbatim in the three points', async () => {
    const sections = JSON.parse(await readFile(join(site, 'content/sections.json'), 'utf8')) as Record<string, { intro: Record<string, string[]>; sections: { fr: string[]; en: string[] }[] }>;
    const strings = JSON.parse(await readFile(join(site, 'content/strings.json'), 'utf8')) as Record<string, { points: { quote: string }[] }>;
    for (const lang of ['fr', 'en'] as const) {
      const corpus = text(Object.values(sections).flatMap((a) => [...a.intro[lang]!, ...a.sections.flatMap((s) => s[lang])]).join(' '));
      for (const pt of strings[lang]!.points) expect(corpus, `${lang}: ${pt.quote.slice(0, 40)}`).toContain(text(pt.quote));
      const rules = text(await read(lang === 'fr' ? 'fr/regles/index.html' : 'en/rules/index.html'));
      for (const s of sections.play!.sections) for (const p of s[lang]) expect(rules).toContain(text(p));
    }
  });

  it('renders the rules with a table of contents and shareable anchors', async () => {
    const fr = await read('fr/regles/index.html');
    for (const id of ['relier', 'tirage', 'marche', 'construire', 'combattre', 'diplomatie', 'phares']) {
      expect(fr).toContain(`id="${id}"`);
      expect(fr).toContain(`href="#${id}"`);
    }
    const en = await read('en/rules/index.html');
    for (const id of ['link', 'draw', 'market', 'build', 'fight', 'diplomacy', 'beacons']) expect(en).toContain(`id="${id}"`);
  });

  it('posts the waitlist form with consent, honeypot, UTM and referrer fields', async () => {
    const fr = await read('fr/index.html');
    expect(fr).toContain('action="https://api.playaurane.com/waitlist"');
    for (const name of ['email', 'name', 'lang', 'consent', 'website', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer', 'page']) expect(fr, name).toContain(`name="${name}"`);
    expect(fr).toContain('cf-turnstile');
    expect(fr).toContain('href="/fr/confidentialite/"');
    expect(fr).toContain('href="https://play.playaurane.com"');
  });

  it('shows social links only when configured', async () => {
    const fr = await read('fr/index.html');
    expect(fr).not.toContain('Discord');
    expect(fr).not.toContain('@playaurane');
    const other = await mkdtemp(join(tmpdir(), 'aurane-site2-'));
    await promisify(execFile)('node', [join(site, 'build.mjs')], { env: { ...process.env, SITE_OUT: other, DISCORD_URL: 'https://discord.gg/example', X_URL: 'https://x.com/playaurane' } });
    const withSocial = await readFile(join(other, 'fr/index.html'), 'utf8');
    expect(withSocial).toContain('href="https://discord.gg/example"');
    expect(withSocial).toContain('href="https://x.com/playaurane"');
  }, 60000);

  it('lists every page in the sitemap with alternates and keeps pages light', async () => {
    const sm = await read('sitemap.xml');
    for (const loc of ['/', '/fr/', '/en/', '/fr/regles/', '/en/rules/', '/fr/confidentialite/', '/en/privacy/']) expect(sm).toContain(`<loc>https://playaurane.com${loc}</loc>`);
    expect(sm).toContain('hreflang="x-default"');
    for (const p of PAGES) expect((await stat(join(out, p))).size, p).toBeLessThan(60_000);
  });
});
