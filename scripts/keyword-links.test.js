/* Keyword backlink injection — every rule in the spec, as a test.
 *
 *   node --test scripts/keyword-links.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { injectKeywordLinks } from '../lib/keyword-links.js';

const KW = (keyword, url = 'https://example.com/x', rel = 'dofollow') => ({ keyword, url, rel });
const INTERNAL = (keyword) => KW(keyword, 'https://www.davnoot.com/seo.html');

describe('keyword backlinks', () => {
  test('links the FIRST occurrence only, by default', () => {
    const html = '<p>An SEO agency is an SEO agency is an SEO agency.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('SEO agency')]);
    assert.equal((out.match(/<a /g) || []).length, 1, 'linking every mention is an over-optimization signal');
  });

  test('firstOnly:false links every occurrence', () => {
    const html = '<p>An SEO agency is an SEO agency.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('SEO agency')], { firstOnly: false });
    assert.equal((out.match(/<a /g) || []).length, 2);
  });

  test('NEVER links inside an existing <a> — nested anchors are invalid HTML', () => {
    const html = '<p><a href="/other">Our SEO agency page</a> is here.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('SEO agency')]);
    assert.equal((out.match(/<a /g) || []).length, 1, 'the only <a> should be the original one');
    assert.ok(out.includes('<a href="/other">Our SEO agency page</a>'));
  });

  test('NEVER links inside a heading', () => {
    const html = '<h2>The best SEO agency</h2><p>Pick an SEO agency.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('SEO agency')]);
    assert.ok(out.includes('<h2>The best SEO agency</h2>'), 'the heading must be untouched');
    assert.equal((out.match(/<a /g) || []).length, 1, 'and the body mention still gets the link');
  });

  test('NEVER links inside <code> or <pre>', () => {
    const html = '<pre><code>npm install seo agency</code></pre><p>An seo agency helps.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('seo agency')]);
    assert.ok(out.includes('<code>npm install seo agency</code>'));
    assert.equal((out.match(/<a /g) || []).length, 1);
  });

  test('LONGEST keyword first — a short keyword cannot link inside a longer phrase', () => {
    const html = '<p>We are an SEO agency in Montreal today.</p>';
    const out = injectKeywordLinks(html, [
      KW('SEO', 'https://example.com/seo'),
      KW('SEO agency in Montreal', 'https://example.com/long'),
    ]);
    // The long phrase must win the span outright.
    assert.ok(out.includes('>SEO agency in Montreal</a>'), out);
    assert.ok(!out.includes('/seo"'), 'the short keyword must not have carved up the longer phrase');
  });

  test('matching is case-insensitive but the ORIGINAL casing is preserved', () => {
    const html = '<p>A great SEO Agency.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('seo agency')]);
    assert.ok(out.includes('>SEO Agency</a>'), 'the page must still read as the author wrote it');
  });

  test('respects word boundaries — no matches inside a longer word', () => {
    const html = '<p>Cats are categorically great.</p>';
    const out = injectKeywordLinks(html, [KW('cat')]);
    assert.equal(out.includes('<a '), false, '"cat" must not match inside "categorically"');
  });

  test('external links get target=_blank and rel=noopener', () => {
    const out = injectKeywordLinks('<p>Try ahrefs today.</p>', [KW('ahrefs', 'https://ahrefs.com')]);
    assert.ok(out.includes('target="_blank"'));
    assert.ok(/rel="[^"]*noopener/.test(out));
  });

  test('rel=nofollow and rel=sponsored are emitted; dofollow is NOT a rel token', () => {
    const nf = injectKeywordLinks('<p>Try ahrefs.</p>', [KW('ahrefs', 'https://ahrefs.com', 'nofollow')]);
    assert.ok(/rel="[^"]*nofollow/.test(nf));

    const sp = injectKeywordLinks('<p>Try ahrefs.</p>', [KW('ahrefs', 'https://ahrefs.com', 'sponsored')]);
    assert.ok(/rel="[^"]*sponsored/.test(sp));

    const df = injectKeywordLinks('<p>Try ahrefs.</p>', [KW('ahrefs', 'https://ahrefs.com', 'dofollow')]);
    assert.equal(/dofollow/.test(df), false, '"dofollow" is not a real rel value and must never be emitted');
  });

  test('internal links do NOT get target=_blank', () => {
    const out = injectKeywordLinks('<p>Our SEO agency.</p>', [INTERNAL('SEO agency')]);
    assert.equal(out.includes('target="_blank"'), false);
  });

  test('HTML-escapes the URL and the anchor text it splices in', () => {
    const out = injectKeywordLinks('<p>Find seo here.</p>', [
      KW('seo', 'https://example.com/?a=1&b="2"'),
    ]);
    assert.ok(out.includes('&amp;b=&quot;2&quot;'), 'attribute values must be escaped');
    assert.equal(out.includes('&b="2"'), false);
  });

  test('REGRESSION: an injected anchor is never re-scanned by a later keyword', () => {
    // The bug: after "SEO agency in Montreal" is linked, the shorter keyword "SEO"
    // matched inside the anchor TEXT that had just been injected, yielding
    //   <a href="/long"><a href="/seo">SEO</a> agency in Montreal</a>
    // Nested anchors are invalid HTML and browsers unnest them unpredictably.
    const html = '<p>We are an SEO agency in Montreal today.</p>';
    const out = injectKeywordLinks(html, [
      KW('SEO', 'https://example.com/seo'),
      KW('SEO agency in Montreal', 'https://example.com/long'),
    ]);
    assert.equal((out.match(/<a /g) || []).length, 1, `exactly one anchor, got: ${out}`);
    assert.equal(/<a[^>]*>[^<]*<a /.test(out), false, 'no anchor may open inside another anchor');
  });

  test('does not double-escape entities in the anchor text it preserves', () => {
    const html = '<p>Ben &amp; Jerry SEO agency rocks.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('Jerry SEO agency')]);
    assert.ok(out.includes('&amp;'), 'the original entity must survive');
    assert.equal(out.includes('&amp;amp;'), false, 're-escaping source text corrupts it');
  });

  test('leaves the body alone when there are no keywords', () => {
    const html = '<p>Nothing to do.</p>';
    assert.equal(injectKeywordLinks(html, []), html);
    assert.equal(injectKeywordLinks(html, undefined), html);
  });

  test('a keyword spanning an inline tag boundary is simply not matched (no corruption)', () => {
    const html = '<p>An <em>SEO</em> agency.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('SEO agency')]);
    assert.equal(out, html, 'must never splice an anchor across a tag boundary');
  });

  test('a stray closing tag does not permanently disable linking', () => {
    const html = '</code><p>An SEO agency here.</p>';
    const out = injectKeywordLinks(html, [INTERNAL('SEO agency')]);
    assert.ok(out.includes('<a '), 'a negative skip-depth would have swallowed the rest of the document');
  });
});
