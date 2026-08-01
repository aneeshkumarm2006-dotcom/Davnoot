/* Category archives and pagination — the two thin-content findings.
 *
 * Semrush, 2026-08-01:
 *   "Low word count"                  — all six /blog/category/<slug> pages
 *   "Pages with only one internal link" — /blog?page=2
 *
 * Both were structural, not editorial. An archive rendered an <h1>, a generated
 * one-liner, and a card grid; pagination rendered prev/next only, so page 2 was
 * reachable from exactly one URL on the site. The fixes are a category `description`
 * plus a real "where next" rail, and a numbered page window.
 *
 * The one thing these tests are most concerned with is the OPPOSITE failure: an
 * archive with no description must still render, and must still render EXACTLY as it
 * did before, because there are six live ones with no description in the database
 * right now.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderIndexPage } from '../lib/blog-render.js';

const CATS = [
  { name: 'SEO', slug: 'seo' },
  { name: 'AI Search', slug: 'ai-search' },
  { name: 'Content Marketing', slug: 'content-marketing' },
];
const POSTS = [
  { slug: 'a', title: 'Post A', excerpt: 'One', publishedAt: new Date('2026-01-02'), readingTimeMinutes: 4 },
  { slug: 'b', title: 'Post B', excerpt: 'Two', publishedAt: new Date('2026-01-01'), readingTimeMinutes: 6 },
];

const render = (opts) => renderIndexPage({ posts: POSTS, page: 1, totalPages: 1, categories: CATS, ...opts });
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const words = (html) => textOf(html).split(' ').filter(Boolean).length;

describe('a category archive is no longer thin', () => {
  const bare = render({ activeCategory: { name: 'SEO', slug: 'seo' } });

  test('an archive WITHOUT a description still renders', () => {
    assert.match(bare, /<h1>SEO<\/h1>/);
    assert.ok(!bare.includes('archive-intro'), 'no description -> no empty intro block');
  });

  test('an archive with no description still gains the "where next" rail', () => {
    assert.match(bare, /class="archive-more"/);
    assert.match(bare, /Work with us on SEO/);
  });

  test('the rail links to services AND to the sibling archives', () => {
    assert.match(bare, /href="\/services\/seo"/);
    assert.match(bare, /href="\/blog\/category\/ai-search"/);
    assert.match(bare, /href="\/blog\/category\/content-marketing"/);
    assert.ok(!bare.includes('href="/blog/category/seo"><'), 'an archive must not link to itself');
  });

  test('it carries meaningfully more copy than it used to', () => {
    // The pre-fix page was h1 + one generated line + card titles. 120 words is a low
    // bar on purpose — this asserts the block is THERE, not that it is padded.
    assert.ok(words(bare) > 120, `archive still thin: ${words(bare)} words`);
  });

  test('a description becomes the intro copy AND the meta description', () => {
    const desc =
      'Everything we have published on search engine optimization: technical audits, ' +
      'content architecture, internal linking, and the measurement that tells you whether any of it worked.';
    const html = render({ activeCategory: { name: 'SEO', slug: 'seo', description: desc } });
    assert.match(html, /class="archive-intro"/);
    assert.ok(textOf(html).includes('technical audits'), 'the description is not on the page');
    const meta = /<meta name="description" content="([^"]*)"/.exec(html)[1];
    assert.ok(meta.startsWith('Everything we have published'), `meta description not from the category: ${meta}`);
  });

  test('a long description is clamped for the SERP, not truncated mid-word', () => {
    const desc = 'word '.repeat(120).trim();
    const html = render({ activeCategory: { name: 'SEO', slug: 'seo', description: desc } });
    const meta = /<meta name="description" content="([^"]*)"/.exec(html)[1];
    assert.ok(meta.length <= 160, `meta description is ${meta.length} chars`);
    assert.match(meta, /…$/);
  });

  test('a description with two paragraphs renders as two paragraphs', () => {
    const html = render({ activeCategory: { name: 'SEO', slug: 'seo', description: 'First para.\n\nSecond para.' } });
    const intro = /<div class="archive-intro">([\s\S]*?)<\/div>/.exec(html)[1];
    assert.equal((intro.match(/<p>/g) || []).length, 2);
  });

  test('a description is escaped, not injected', () => {
    const html = render({ activeCategory: { name: 'SEO', slug: 'seo', description: '<script>alert(1)</script>' } });
    assert.ok(!html.includes('<script>alert(1)'), 'category copy must not be able to inject a script');
  });

  test('the UNFILTERED /blog is left exactly as it was — no rail, no intro', () => {
    const html = render({ activeCategory: null });
    assert.ok(!html.includes('archive-more'), '/blog is not a topic archive');
    assert.ok(!html.includes('archive-intro'));
  });

  test('an EMPTY archive is still noindex (the soft-404 rule survives the new copy)', () => {
    const html = renderIndexPage({ posts: [], page: 1, totalPages: 1, categories: CATS, activeCategory: CATS[0] });
    assert.match(html, /<meta name="robots" content="noindex, follow"/);
  });
});

describe('pagination is numbered, so no page is a one-link island', () => {
  const nums = (html) => [...html.matchAll(/class="page-num[^"]*"[^>]*>(\d+)</g)].map((m) => Number(m[1]));

  test('a single page renders no pagination at all', () => {
    assert.ok(!render({ totalPages: 1 }).includes('blog-pagination'));
  });

  test('page 1 of 2 links to page 2 by number as well as by "Older"', () => {
    const html = renderIndexPage({ posts: POSTS, page: 1, totalPages: 2, categories: CATS });
    assert.deepEqual(nums(html), [1, 2]);
    assert.match(html, /href="\/blog\?page=2"/);
  });

  test('page 1 is linked as "/blog", never as "/blog?page=1" (that would be a duplicate)', () => {
    const html = renderIndexPage({ posts: POSTS, page: 2, totalPages: 3, categories: CATS });
    assert.ok(!html.includes('?page=1"'), 'page 1 must be the bare URL');
    assert.match(html, /href="\/blog"/);
  });

  test('the current page is marked, and is not a link', () => {
    const html = renderIndexPage({ posts: POSTS, page: 2, totalPages: 3, categories: CATS });
    assert.match(html, /<span class="page-num is-current" aria-current="page">2<\/span>/);
  });

  test('a long run is windowed with first/last pinned and a gap marker', () => {
    const html = renderIndexPage({ posts: POSTS, page: 10, totalPages: 20, categories: CATS });
    const shown = nums(html);
    assert.deepEqual(shown, [1, 8, 9, 10, 11, 12, 20]);
    assert.ok(html.includes('page-gap'), 'a windowed run needs the … marker');
  });

  test('a category archive paginates within its own URL space', () => {
    const html = renderIndexPage({
      posts: POSTS, page: 1, totalPages: 3, categories: CATS, activeCategory: CATS[0],
    });
    assert.match(html, /href="\/blog\/category\/seo\?page=2"/);
    assert.ok(!/href="\/blog\?page=2"/.test(html), 'archive pagination must not leak into the main index');
  });
});
