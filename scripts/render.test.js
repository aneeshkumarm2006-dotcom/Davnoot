/* The rendered <head> — where an SEO bug is silent and expensive.
 *
 * These run with no database: renderArticlePage() is a pure function of a post
 * object, which is exactly why the <head> can be tested at all.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderArticlePage, robotsMeta, safeCanonical, renderIndexPage } from '../lib/blog-render.js';

const POST = {
  _id: '507f1f77bcf86cd799439011',
  title: 'How to choose an SEO agency',
  slug: 'how-to-choose-an-seo-agency',
  excerpt: 'A practical checklist for picking an agency that actually moves revenue.',
  content: '<h2>Start here</h2><p>An SEO agency should show you pipeline, not pageviews.</p>',
  author: 'Prem',
  tags: ['SEO'],
  status: 'published',
  publishedAt: new Date('2026-06-01T10:00:00Z'),
  updatedAt: new Date('2026-06-02T10:00:00Z'),
  readingTimeMinutes: 4,
};

/* ========================================================================== */
describe('Invariant 1 — a post with no robots setting emits NO robots directive', () => {
  test('robotsMeta returns empty string when both are undefined', () => {
    assert.equal(robotsMeta({}), '');
    assert.equal(robotsMeta({ metaTitle: 'x' }), '');
    assert.equal(robotsMeta(undefined), '');
  });

  test('the rendered <head> of a legacy post has no robots tag at all', () => {
    const html = renderArticlePage(POST);
    assert.equal(
      /<meta name="robots"/.test(html),
      false,
      'a default here would de-index every existing post on the next deploy',
    );
  });

  test('an explicit noindex IS emitted', () => {
    assert.equal(robotsMeta({ robotsIndex: false }), '<meta name="robots" content="noindex" />');
  });

  test('explicit true is emitted as index, follow', () => {
    assert.equal(
      robotsMeta({ robotsIndex: true, robotsFollow: true }),
      '<meta name="robots" content="index, follow" />',
    );
  });

  test('a mixed pair works (index but nofollow)', () => {
    assert.equal(
      robotsMeta({ robotsIndex: true, robotsFollow: false }),
      '<meta name="robots" content="index, nofollow" />',
    );
  });

  test('null does not become false (i.e. does not become noindex)', () => {
    assert.equal(robotsMeta({ robotsIndex: null, robotsFollow: null }), '');
  });
});

/* ========================================================================== */
describe('Invariant 2 — cross-origin canonicals are ignored', () => {
  test('no custom canonical -> the post’s own URL', () => {
    assert.equal(safeCanonical(POST), 'https://www.davnoot.com/blog/how-to-choose-an-seo-agency');
  });

  test('a SAME-origin custom canonical is honoured', () => {
    const p = { ...POST, seo: { canonicalUrl: 'https://www.davnoot.com/seo.html' } };
    assert.equal(safeCanonical(p), 'https://www.davnoot.com/seo.html');
  });

  test('a CROSS-origin canonical is IGNORED — it would de-index the page', () => {
    const p = { ...POST, seo: { canonicalUrl: 'https://competitor.com/their-post' } };
    assert.equal(safeCanonical(p), 'https://www.davnoot.com/blog/how-to-choose-an-seo-agency');
  });

  test('a garbage canonical falls back rather than throwing', () => {
    const p = { ...POST, seo: { canonicalUrl: 'not a url' } };
    assert.equal(safeCanonical(p), 'https://www.davnoot.com/blog/how-to-choose-an-seo-agency');
  });
});

/* ========================================================================== */
describe('Invariant 6 — the OG headline never leaks into <title>', () => {
  test('a custom metaTitle is ABSOLUTE — no site-name suffix', () => {
    const p = { ...POST, seo: { metaTitle: 'SEO Agency Checklist | Davnoot' } };
    const html = renderArticlePage(p);
    assert.ok(html.includes('<title>SEO Agency Checklist | Davnoot</title>'));
  });

  test('with no metaTitle, the title is branded', () => {
    const html = renderArticlePage(POST);
    assert.ok(html.includes('<title>How to choose an SEO agency — Davnoot</title>'));
  });

  test('og:title falls back to the POST TITLE, never to metaTitle', () => {
    const p = { ...POST, seo: { metaTitle: 'A Very SEO Meta Title For Google' } };
    const html = renderArticlePage(p);
    assert.ok(
      html.includes('<meta property="og:title" content="How to choose an SEO agency" />'),
      'og:title must not inherit metaTitle',
    );
  });

  test('an explicit ogTitle wins for social but does NOT touch <title>', () => {
    const p = { ...POST, seo: { metaTitle: 'Meta For Google', ogTitle: 'Punchy Social Hook' } };
    const html = renderArticlePage(p);
    assert.ok(html.includes('<title>Meta For Google</title>'));
    assert.ok(html.includes('content="Punchy Social Hook"'));
  });
});

/* ========================================================================== */
describe('Article <head> basics', () => {
  test('metaDescription falls back to the excerpt', () => {
    const html = renderArticlePage(POST);
    assert.ok(html.includes(`<meta name="description" content="${POST.excerpt}" />`));
  });

  test('emits og:type=article and BlogPosting + BreadcrumbList JSON-LD', () => {
    const html = renderArticlePage(POST);
    assert.ok(html.includes('<meta property="og:type" content="article" />'));
    assert.ok(html.includes('"@type": "BlogPosting"'));
    assert.ok(html.includes('"@type": "BreadcrumbList"'));
    assert.ok(html.includes('"@type": "Organization"'), 'must reuse the shared Organization node');
  });

  test('escapes a title containing quotes and angle brackets', () => {
    const html = renderArticlePage({ ...POST, title: 'A "quoted" <script> title & more' });
    assert.equal(html.includes('<script> title'), false);
    assert.ok(html.includes('&quot;quoted&quot;'));
  });

  test('a title containing </script> cannot break OUT of the JSON-LD block', () => {
    // JSON.stringify emits `</script>` verbatim. Dropped into a
    // <script type="application/ld+json">, that CLOSES the block and everything
    // after it becomes live HTML in the document.
    const html = renderArticlePage({ ...POST, title: 'Why </script><img src=x onerror=alert(1)> breaks SEO' });

    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.equal(ld.includes('</script>'), false, 'the JSON-LD block was terminated early');
    assert.ok(ld.includes('\\u003c/script'), 'the < must be unicode-escaped');

    // The payload text may still APPEAR (inside a JSON string, with its `<`
    // escaped) — that is harmless. What must never exist anywhere in the document
    // is a literal `<img`, because that is the only form that becomes a real tag.
    assert.equal(html.includes('<img src=x'), false, 'a live <img> tag was injected');

    // And it must still be valid, parseable JSON-LD.
    assert.doesNotThrow(() => JSON.parse(ld));
    assert.equal(JSON.parse(ld)['@graph'][1].headline, 'Why </script><img src=x onerror=alert(1)> breaks SEO');
  });
});

/* ========================================================================== */
describe('Preview and public use the SAME renderer', () => {
  test('preview is ALWAYS noindex, even for a post that says index', () => {
    const p = { ...POST, seo: { robotsIndex: true, robotsFollow: true } };
    const html = renderArticlePage(p, { preview: true });
    assert.ok(html.includes('<meta name="robots" content="noindex, nofollow" />'));
    assert.equal(html.includes('content="index, follow"'), false);
  });

  test('preview does NOT fire the view beacon', () => {
    assert.equal(renderArticlePage(POST, { preview: true }).includes('/view'), false);
    assert.ok(renderArticlePage(POST).includes('/view'), 'the public page does');
  });

  test('the article body is byte-identical between preview and public', () => {
    const pub = renderArticlePage(POST).match(/<div class="post-body">([\s\S]*?)<\/div>/)[1];
    const pre = renderArticlePage(POST, { preview: true }).match(/<div class="post-body">([\s\S]*?)<\/div>/)[1];
    assert.equal(pub, pre, 'preview and production must render identically');
  });
});

/* ========================================================================== */
describe('Keyword backlinks are applied at render time', () => {
  test('the link appears in the rendered body without being stored', () => {
    const p = {
      ...POST,
      keywords: [{ keyword: 'SEO agency', url: 'https://www.davnoot.com/seo.html', rel: 'dofollow' }],
    };
    const html = renderArticlePage(p);
    assert.ok(html.includes('class="kw-link"'));
    assert.ok(p.content.includes('class="kw-link"') === false, 'the STORED body must be untouched');
  });

  test('the H2 mention is not linked, the body mention is', () => {
    const p = {
      ...POST,
      content: '<h2>Pick an SEO agency</h2><p>Any SEO agency will pitch you.</p>',
      keywords: [{ keyword: 'SEO agency', url: 'https://www.davnoot.com/seo.html', rel: 'dofollow' }],
    };
    const html = renderArticlePage(p);
    assert.ok(html.includes('<h2>Pick an SEO agency</h2>'), 'headings must never be linked');
    assert.equal((html.match(/kw-link/g) || []).length, 1);
  });
});

/* ========================================================================== */
describe('Index page', () => {
  test('renders a real empty state, not a blank grid', () => {
    const html = renderIndexPage({ posts: [], page: 1, totalPages: 1 });
    assert.ok(html.includes('Nothing published yet.'));
  });

  test('emits ItemList + BreadcrumbList JSON-LD', () => {
    const html = renderIndexPage({ posts: [POST], page: 1, totalPages: 1 });
    assert.ok(html.includes('"@type": "ItemList"'));
    assert.ok(html.includes('"@type": "BreadcrumbList"'));
  });

  test('page 2 carries rel=prev and a page-specific canonical', () => {
    const html = renderIndexPage({ posts: [POST], page: 2, totalPages: 3 });
    assert.ok(html.includes('rel="prev"'));
    assert.ok(html.includes('<link rel="canonical" href="https://www.davnoot.com/blog?page=2" />'));
  });
});
