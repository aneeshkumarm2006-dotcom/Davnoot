/* The document outline — <main>, and the semantic elements around it.
 *
 * The 2026-08-01 Semrush audit flagged / and /services/google-ads for "Low Semantic
 * HTML usage": the marketing pages were nav + a pile of <div>s + footer, with no
 * element saying "the page's content starts here". That is an accessibility problem
 * first (a screen-reader user has nothing to skip to) and a machine-readability
 * problem second — and every AI crawler this site courts in robots.txt reads the
 * outline before it reads the copy.
 *
 * These are pinned because the failure mode is additive: a new page copy-pasted from
 * an old one before this change would silently be the one page with no landmark, and
 * nothing else in the build would notice.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { renderIndexPage, renderArticlePage } from '../lib/blog-render.js';

const ROOT = path.join(import.meta.dirname, '..');

const isVerification = (f) => /^google[0-9a-f]+\.html$/i.test(f);
const htmlIn = (dir) =>
  fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !isVerification(f));

const PAGES = [
  ...htmlIn(ROOT).map((f) => ({ label: f, file: path.join(ROOT, f) })),
  ...htmlIn(path.join(ROOT, 'pages')).map((f) => ({ label: `pages/${f}`, file: path.join(ROOT, 'pages', f) })),
];

describe('every marketing page has exactly one <main> content landmark', () => {
  test('there are pages to check', () => assert.ok(PAGES.length > 30, `only found ${PAGES.length}`));

  for (const { label, file } of PAGES) {
    test(label, () => {
      const html = fs.readFileSync(file, 'utf8');
      const opens = html.match(/<main\b[^>]*>/g) || [];
      const closes = html.match(/<\/main>/g) || [];
      assert.equal(opens.length, 1, `${label} has ${opens.length} <main> elements — it must have exactly 1`);
      assert.equal(closes.length, 1, `${label} has ${closes.length} </main>`);

      // Order: nav, then main, then footer. A <main> that swallowed the nav or the
      // footer would be worse than none at all — the landmark would mean nothing.
      const navAt = html.indexOf('<nav');
      const mainAt = html.indexOf('<main');
      const mainEnd = html.indexOf('</main>');
      const footAt = html.indexOf('<footer');
      assert.ok(navAt < mainAt, `${label}: <main> must come after the site nav`);
      assert.ok(mainEnd < footAt, `${label}: </main> must come before the site footer`);
    });
  }
});

describe('the FAQ accordions are <article>, and build.js still finds them', () => {
  /* extractFaq() in build.js scrapes the VISIBLE FAQ copy to emit FAQPage JSON-LD.
   * It matches on `.faq-q` / `.faq-a`, which are INSIDE the item — so renaming the
   * item wrapper from <div class="faq-item"> to <article class="faq-item"> is safe.
   * "Safe" is a claim, so here is the test for it: any page with FAQ items must also
   * still be carrying FAQPage schema. */
  const withFaq = PAGES.filter(({ file }) => fs.readFileSync(file, 'utf8').includes('class="faq-item"'));

  test('some pages have FAQ items', () => assert.ok(withFaq.length > 10, `only ${withFaq.length}`));

  for (const { label, file } of withFaq) {
    test(`${label} kept its FAQPage schema`, () => {
      const html = fs.readFileSync(file, 'utf8');
      assert.match(html, /<article class="faq-item"/, `${label}: faq items should be <article>`);
      assert.ok(html.includes('"FAQPage"'), `${label}: the FAQ schema vanished — extractFaq stopped matching`);
    });
  }
});

describe('the visible breadcrumb trail reaches the JSON-LD', () => {
  /* Exactly the FAQ guard above, for the same trap. extractBreadcrumb() in build.js
   * scrapes the VISIBLE `.breadcrumb` div to emit BreadcrumbList JSON-LD, so it is
   * anchored on markup that a CMS annotation pass or a class rename can move out
   * from under it — which is precisely how FAQPage silently vanished from 8 live
   * pages once. BreadcrumbList is a real Google rich result with its own Search
   * Console report, so losing it costs something visible. */
  const withCrumbs = PAGES.filter(({ file }) => fs.readFileSync(file, 'utf8').includes('class="breadcrumb"'));

  test('nearly every page has a breadcrumb', () =>
    assert.ok(withCrumbs.length > 30, `only ${withCrumbs.length} pages carry a breadcrumb`));

  for (const { label, file } of withCrumbs) {
    test(`${label} kept its BreadcrumbList schema`, () => {
      const html = fs.readFileSync(file, 'utf8');
      assert.ok(
        html.includes('"BreadcrumbList"'),
        `${label}: the breadcrumb schema vanished — extractBreadcrumb stopped matching`,
      );
    });
  }

  test('the homepage has neither a visible breadcrumb nor a BreadcrumbList', () => {
    const home = PAGES.find(({ label }) => /(^|[\\/])index\.html/.test(label));
    if (!home) return;
    const html = fs.readFileSync(home.file, 'utf8');
    assert.ok(!html.includes('class="breadcrumb"'), 'the homepage should not render a breadcrumb');
    assert.ok(!html.includes('"BreadcrumbList"'), 'the homepage is the root — it has no trail to describe');
  });
});

describe('the server-rendered pages carry the same landmark', () => {
  const post = {
    _id: 'x', slug: 'a-post', title: 'A post', content: '<p>Body</p>',
    publishedAt: new Date('2026-01-01'), readingTimeMinutes: 3,
  };

  test('a blog post page', () => {
    const html = renderArticlePage(post);
    assert.equal((html.match(/<main\b[^>]*>/g) || []).length, 1);
    assert.ok(html.indexOf('<main') < html.indexOf('<article class="post'));
  });

  test('an author preview keeps the banner OUTSIDE <main> (it is chrome, not content)', () => {
    const html = renderArticlePage(post, { preview: true });
    assert.ok(html.indexOf('preview-banner') < html.indexOf('<main'));
  });

  test('the blog index', () => {
    const html = renderIndexPage({ posts: [], page: 1, totalPages: 1 });
    assert.equal((html.match(/<main\b[^>]*>/g) || []).length, 1);
    assert.match(html, /<main id="main" class="blog-index">/);
  });
});
