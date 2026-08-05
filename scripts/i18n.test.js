/* The French site's safety net.
 *
 *   node --test scripts/
 *
 * The English half of the site is protected by scripts/pages-golden.test.js, which
 * pins the exact bytes Vercel serves. French has no frozen history to pin, so what
 * is asserted here instead are the PROPERTIES that make a second language correct:
 * the generator is lossless, the two languages point at each other, and every
 * French URL the site links to is a URL that actually routes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { translatableRanges, translateSource, localizeLinks, loadDict, loadVerbatim, PAGE_FILES } from './i18n.js';
import { COMPILED_PAGES } from '../lib/compiled-pages.gen.js';
import { renderPage } from '../lib/page-render.js';
import {
  TRANSLATED_PAGES, canonicalFor, cleanPath, hreflangTags, hrefFor, KEYWORDS, KEYWORDS_FR,
} from '../lib/templates.js';

const ROOT = path.join(import.meta.dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');
const FR_DIR = path.join(PAGES_DIR, 'fr');
const readPage = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

/* ===========================================================================
 * THE GENERATOR IS LOSSLESS.
 *
 * This is the French equivalent of the golden test, and everything else rests on
 * it. If translating with an EMPTY dictionary reproduces the English source to the
 * byte, then the generator only ever swaps the strings it was told to swap — it is
 * not reformatting, re-serializing (`<br />` -> `<br>`), dropping attributes, or
 * shifting whitespace anywhere in the 30-60KB of markup it copies through.
 * =========================================================================== */
describe('scripts/i18n.js does not disturb anything it is not translating', () => {
  for (const file of PAGE_FILES) {
    test(`${file}: an empty dictionary round-trips byte-for-byte`, () => {
      const src = readPage(PAGES_DIR, file);
      const { html } = translateSource(src, {});
      assert.equal(html, src, `${file}: the generator altered bytes it was not asked to translate`);
    });
  }

  test('every translation unit is non-empty and contains a letter', () => {
    for (const file of PAGE_FILES) {
      for (const r of translatableRanges(readPage(PAGES_DIR, file))) {
        assert.ok(r.en.trim().length > 0, `${file}: empty unit at offset ${r.start}`);
        assert.match(r.en, /[a-zA-ZÀ-ɏ]/, `${file}: letterless unit ${JSON.stringify(r.en)}`);
      }
    }
  });

  test('translation units never overlap (splicing would corrupt the page)', () => {
    for (const file of PAGE_FILES) {
      const ranges = translatableRanges(readPage(PAGES_DIR, file));
      for (let i = 1; i < ranges.length; i++) {
        assert.ok(
          ranges[i].start >= ranges[i - 1].end,
          `${file}: unit at ${ranges[i].start} overlaps the one ending at ${ranges[i - 1].end}`,
        );
      }
    }
  });

  test('the BUILD regions are never translated (build.js would overwrite them)', () => {
    // A French string written inside BUILD:NAV survives exactly until the next
    // `npm run site`, then silently reverts — in French only. Hard-exclude it.
    for (const file of PAGE_FILES) {
      const src = readPage(PAGES_DIR, file);
      for (const name of ['SEO', 'NAV', 'FOOTER']) {
        const open = src.indexOf(`<!-- BUILD:${name} -->`);
        const close = src.indexOf(`<!-- /BUILD:${name} -->`);
        if (open < 0) continue;
        for (const r of translatableRanges(src)) {
          assert.ok(
            r.start < open || r.start >= close,
            `${file}: unit ${JSON.stringify(r.en.slice(0, 50))} sits inside BUILD:${name}`,
          );
        }
      }
    }
  });
});

describe('the French dictionary', () => {
  const dict = loadDict('fr');

  test('every key still exists in the English source (no stale entries)', () => {
    const live = new Set();
    for (const file of PAGE_FILES) {
      for (const r of translatableRanges(readPage(PAGES_DIR, file))) live.add(r.en);
    }
    // A stale key is a translation paying rent on copy that was rewritten or
    // deleted in English — invisible, because it simply stops being applied.
    const stale = Object.keys(dict).filter((k) => !live.has(k));
    assert.deepEqual(stale, [], `stale dictionary keys (English copy changed?): ${stale.slice(0, 5).join(' | ')}`);
  });

  test('no entry is left as its own English source string by accident', () => {
    // A string that is the same in both languages must be DECLARED, in _verbatim.
    // Anything else mapping to itself is a forgotten paste, and the longer it is
    // the more certain that is.
    const verbatim = loadVerbatim('fr');
    const suspicious = Object.entries(dict)
      .filter(([en, fr]) => en === fr && en.length > 24 && !verbatim.has(en));
    assert.deepEqual(
      suspicious.map(([en]) => en),
      [],
      'long strings map to themselves but are not declared in _verbatim — untranslated paste?',
    );
  });

  test('inline markup is preserved by every translation', () => {
    // <em> is load-bearing: styles.css styles it and script.js's splitWords has a
    // branch for it. A French string that dropped the tag would quietly change how
    // the headline renders and animates, and nothing else would complain.
    for (const [en, fr] of Object.entries(dict)) {
      const tags = (s) => (s.match(/<\/?([a-z0-9]+)/gi) || []).map((t) => t.toLowerCase()).sort();
      assert.deepEqual(
        tags(fr), tags(en),
        `translation changes inline markup:\n  en: ${en}\n  fr: ${fr}`,
      );
    }
  });
});

describe('the two languages point at each other', () => {
  test('hreflang is reciprocal and self-inclusive on every bilingual page', () => {
    for (const file of TRANSLATED_PAGES) {
      const tags = hreflangTags(file).join('\n');
      assert.match(tags, new RegExp(`hreflang="en" href="${canonicalFor(file, 'en')}"`));
      assert.match(tags, new RegExp(`hreflang="fr-CA" href="${canonicalFor(file, 'fr')}"`));
      assert.match(tags, /hreflang="x-default"/);
    }
  });

  test('a French page canonicalises to ITSELF, never to the English URL', () => {
    // Canonicalising French at English is the single most effective way to make
    // sure the French pages are never indexed at all.
    for (const file of TRANSLATED_PAGES) {
      const html = renderPage(COMPILED_PAGES['fr/' + file], null);
      const canonical = (html.match(/rel="canonical" href="([^"]+)"/) || [])[1];
      assert.equal(canonical, canonicalFor(file, 'fr'), `fr/${file} canonicalises away from itself`);
    }
  });

  test('French pages declare lang="fr", English pages lang="en"', () => {
    for (const file of TRANSLATED_PAGES) {
      assert.match(renderPage(COMPILED_PAGES['fr/' + file], null), /<html lang="fr"/);
      assert.match(renderPage(COMPILED_PAGES[file], null), /<html lang="en"/);
    }
  });

  test('the ENGLISH page of a bilingual pair advertises its French twin', () => {
    /* Without this half, /fr exists but nobody browsing the English site can get
     * to it — the French pages are reachable only by typing the URL or arriving
     * from Google. That is exactly how it shipped the first time. */
    for (const file of TRANSLATED_PAGES) {
      const html = renderPage(COMPILED_PAGES[file], null);
      const m = html.match(/<li class="nav-lang"><a href="([^"]+)"[^>]*>([^<]+)</);
      assert.ok(m, `${file} is bilingual but its English nav has no language toggle`);
      assert.equal(m[1], cleanPath(file, 'fr'), `${file}'s toggle does not point at its French twin`);
      assert.equal(m[2], 'FR');
    }
  });

  test('a page with NO French version shows no toggle at all', () => {
    // A toggle that means "go to the French homepage and find your own way back"
    // is worse than no toggle: it looks like a promise the site cannot keep.
    for (const file of PAGE_FILES.filter((f) => !TRANSLATED_PAGES.has(f))) {
      const html = renderPage(COMPILED_PAGES[file], null);
      assert.ok(!/nav-lang/.test(html), `${file} has no French version but offers a language toggle`);
    }
  });

  test('the switcher on a French page lands on the SAME page in English', () => {
    // Dumping every visitor on the other language's homepage is the classic
    // bilingual-site failure, and it teaches people never to use the switcher.
    for (const file of TRANSLATED_PAGES) {
      const html = renderPage(COMPILED_PAGES['fr/' + file], null);
      const m = html.match(/<li class="nav-lang"><a href="([^"]+)"/);
      assert.ok(m, `fr/${file} has no language switcher`);
      assert.equal(m[1], cleanPath(file, 'en'), `fr/${file}'s switcher goes somewhere else`);
    }
  });

  test('French keyword targeting is not a translation of the English list', () => {
    // "agence SEO Montréal" is a translation; "référencement naturel" is the query
    // Quebecers actually type. If these lists ever match term-for-term, someone has
    // run the English through a translator and the French pages target nothing.
    for (const file of Object.keys(KEYWORDS_FR)) {
      const en = new Set((KEYWORDS[file] || []).map((s) => s.toLowerCase()));
      const overlap = (KEYWORDS_FR[file] || []).filter((k) => en.has(k.toLowerCase()));
      assert.deepEqual(overlap, [], `${file}: French keywords duplicate the English ones: ${overlap.join(', ')}`);
    }
  });
});

describe('every French URL the site links to actually routes', () => {
  const frRewrites = (vercel.rewrites || []).filter((r) => r.source === '/fr' || r.source.startsWith('/fr/'));

  test('each /fr rewrite points at a compiled French template', () => {
    for (const r of frRewrites) {
      const key = decodeURIComponent(r.destination.split('p=')[1] || '');
      assert.ok(COMPILED_PAGES[key], `${r.source} -> ${r.destination}: no COMPILED_PAGES["${key}"]`);
    }
  });

  test('every translated page has a route at its canonical French path', () => {
    const sources = new Set(frRewrites.map((r) => r.source));
    for (const file of TRANSLATED_PAGES) {
      const p = cleanPath(file, 'fr');
      assert.ok(sources.has(p), `${file}: nothing routes ${p} — the French page is unreachable`);
    }
  });

  test('/fr is matched before the single-segment /:slug catch-all', () => {
    // /fr IS a single segment. If the catch-all came first it would swallow it and
    // the French homepage would 404 while every other French URL worked.
    const idxFr = vercel.rewrites.findIndex((r) => r.source === '/fr');
    const idxCatch = vercel.rewrites.findIndex((r) => r.source === '/:slug');
    assert.ok(idxFr >= 0, 'no rewrite for /fr');
    assert.ok(idxFr < idxCatch, '/fr is shadowed by the /:slug catch-all');
  });

  test('no French page links to a /fr path that nothing routes', () => {
    const routed = new Set((vercel.rewrites || []).map((r) => r.source));
    for (const file of TRANSLATED_PAGES) {
      const html = renderPage(COMPILED_PAGES['fr/' + file], null);
      const hrefs = [...html.matchAll(/href="(\/fr[^"#?]*)"/g)].map((m) => m[1]);
      for (const href of new Set(hrefs)) {
        assert.ok(routed.has(href), `fr/${file} links to ${href}, which nothing routes`);
      }
    }
  });

  test('a French page never links to the English version of a page it has in French', () => {
    /* The trap this catches: a call-to-action lives INSIDE a translation unit —
     *   <a href="/book-call" class="btn-primary">Book a free strategy call</a>
     * — so its href travels through the dictionary as part of the string. Translate
     * the words, forget the path, and every French CTA quietly dumps the visitor
     * back onto the English site. The chrome links are generated by hrefFor() and
     * are safe; these are the ones written by hand in fr.json. */
    const frByEnPath = new Map([...TRANSLATED_PAGES].map((f) => [cleanPath(f, 'en'), f]));
    for (const file of TRANSLATED_PAGES) {
      const html = renderPage(COMPILED_PAGES['fr/' + file], null);
      // Ignore the language switcher — pointing at English is its entire job.
      const body = html.replace(/<li class="nav-lang">[\s\S]*?<\/li>/g, '');
      for (const m of body.matchAll(/href="(\/[^"#?]*)"/g)) {
        const target = frByEnPath.get(m[1]);
        assert.ok(
          !target,
          `fr/${file} links to the ENGLISH ${m[1]} — should be ${cleanPath(target || 'index.html', 'fr')}`,
        );
      }
    }
  });

  test('an untranslated destination falls back to English rather than a dead /fr URL', () => {
    // /services and /ads have no French page yet. hrefFor must send a French
    // visitor to the English page, not to a /fr URL that 404s.
    for (const file of ['services.html', 'ads.html', 'privacy.html', 'klaviyo.html']) {
      assert.equal(hrefFor(file, 'fr'), cleanPath(file, 'en'), `${file} should fall back to English`);
    }
    // ...and a page that IS fully translated must NOT fall back. Derived from the
    // measured set rather than naming a page: which pages are French changes as
    // the dictionary fills up, and a hardcoded name here would just go stale.
    for (const file of TRANSLATED_PAGES) {
      assert.equal(hrefFor(file, 'fr'), cleanPath(file, 'fr'), `${file} is translated but links to English`);
    }
    // A page still mid-translation must be excluded from the French site entirely.
    const partial = PAGE_FILES.filter((f) => !TRANSLATED_PAGES.has(f));
    for (const file of partial) {
      assert.equal(hrefFor(file, 'fr'), cleanPath(file, 'en'), `${file} is incomplete but is linked as French`);
    }
  });

  test('an incomplete French page is routed but noindex, and never sitemapped', () => {
    // It must be viewable for review, and invisible to Google until it is finished
    // — otherwise it competes with the English original it is still a copy of.
    for (const file of PAGE_FILES.filter((f) => !TRANSLATED_PAGES.has(f))) {
      const tpl = COMPILED_PAGES['fr/' + file];
      if (!tpl) continue;
      const html = renderPage(tpl, null);
      assert.match(html, /<meta name="robots" content="noindex, follow" \/>/, `fr/${file} is incomplete but indexable`);
      assert.ok(!/hreflang="fr-CA"/.test(html), `fr/${file} is incomplete but advertises itself as an alternate`);
    }
  });
});

describe('the generated French sources stay in sync with the English ones', () => {
  test('pages/fr exists for every page claimed as translated', () => {
    for (const file of TRANSLATED_PAGES) {
      assert.ok(fs.existsSync(path.join(FR_DIR, file)), `pages/fr/${file} is missing — run \`npm run site\``);
      assert.ok(COMPILED_PAGES['fr/' + file], `COMPILED_PAGES has no fr/${file} — run \`npm run site\``);
    }
  });

  test('regenerating from the current dictionary reproduces the committed file', () => {
    // Catches a hand-edit to pages/fr/*.html — which would be silently reverted by
    // the next build, and is the one way this pipeline can lie to you.
    const dict = loadDict('fr');
    for (const file of PAGE_FILES) {
      if (!fs.existsSync(path.join(FR_DIR, file))) continue;
      const regenerated = localizeLinks(translateSource(readPage(PAGES_DIR, file), dict).html, 'fr');
      const committed = readPage(FR_DIR, file);
      // Compare the BODY only: build.js owns the BUILD regions and bakes French
      // chrome into the committed file after the generator has run.
      const mask = (s) => s
        .replace(/<!-- BUILD:(SEO|NAV|FOOTER) -->[\s\S]*?<!-- \/BUILD:\1 -->/g, '')
        .replace(/(<html[^>]*\blang=")[^"]*(")/i, '$1X$2');
      assert.equal(mask(regenerated), mask(committed), `pages/fr/${file} was hand-edited — edit lib/i18n/fr.json instead`);
    }
  });

  test('the French page carries the same CMS holes as the English one', () => {
    // The data-cms annotations must survive translation, or the French pages can
    // never be edited in /admin and the CMS silently becomes English-only.
    for (const file of TRANSLATED_PAGES) {
      const en = COMPILED_PAGES[file].slots.map((s) => s.key).sort();
      const fr = COMPILED_PAGES['fr/' + file].slots.map((s) => s.key).sort();
      assert.deepEqual(fr, en, `fr/${file} lost CMS holes during translation`);
    }
  });
});
