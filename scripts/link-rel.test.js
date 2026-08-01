/* lib/link-rel.js — the internal-nofollow repair.
 *
 * The bug being pinned: @tiptap/extension-link defaults to
 * rel="noopener noreferrer nofollow" target="_blank" on EVERY link it inserts, so
 * every link an author ever added from the /seoteam toolbar — including links to
 * davnoot.com — told Google not to follow it. 15 of them across 12 posts in the
 * 2026-08-01 Semrush audit.
 *
 * The one asymmetry worth reading before you touch this file: external nofollow is
 * stripped, EXCEPT when the link also carries `sponsored` or `ugc`. Nothing
 * auto-inserts those, so they prove human intent, and un-nofollowing a paid link is
 * a Google policy violation. There is a test for exactly that below; if it starts
 * failing because someone "simplified" the rule, the simplification is the bug.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLinkRel, isInternalHref } from '../lib/link-rel.js';

const HOST = 'www.davnoot.com';
const norm = (html) => normalizeLinkRel(html, { siteHost: HOST });
const relOf = (html) => (/\srel="([^"]*)"/.exec(html) || [, null])[1];
const hasTargetBlank = (html) => /target\s*=\s*"_blank"/.test(html);

describe('isInternalHref', () => {
  for (const href of ['/blog', '/blog/x?y=1', '#faq', '?page=2', 'https://davnoot.com/', 'https://www.davnoot.com/services/seo', '//www.davnoot.com/x']) {
    test(`internal: ${href}`, () => assert.equal(isInternalHref(href, HOST), true));
  }
  for (const href of ['https://google.com/', 'https://notdavnoot.com/', 'http://davnoot.com.evil.test/', '//evil.test/x', 'mailto:info@davnoot.com', 'tel:+15145551234', '']) {
    test(`external/ignored: ${href}`, () => assert.equal(isInternalHref(href, HOST), false));
  }
});

describe('internal links — the actual audit finding', () => {
  test('the exact markup the editor stored loses nofollow, noreferrer and the new tab', () => {
    const out = norm('<a target="_blank" rel="noopener noreferrer nofollow" href="https://www.davnoot.com/">Davnoot</a>');
    assert.equal(relOf(out), null, 'an internal link needs no rel at all once the artefacts are gone');
    assert.equal(hasTargetBlank(out), false);
    assert.match(out, /href="https:\/\/www\.davnoot\.com\/"/, 'the href must survive untouched');
    assert.match(out, />Davnoot<\/a>/, 'the anchor text must survive untouched');
  });

  test('a root-relative internal link is repaired too', () => {
    const out = norm('<a href="/services/seo" rel="nofollow">SEO</a>');
    assert.equal(relOf(out), null);
  });

  test('the apex host counts as internal (www is not a different site)', () => {
    assert.equal(relOf(norm('<a href="https://davnoot.com/blog" rel="nofollow">x</a>')), null);
  });

  test('an internal link the author left alone is not rewritten into something new', () => {
    const src = '<a href="/book-call">Book a call</a>';
    assert.equal(norm(src), src);
  });
});

describe('external links', () => {
  test('the editor default nofollow is stripped, the security rel is kept', () => {
    const out = norm('<a target="_blank" rel="noopener noreferrer nofollow" href="https://www.wikipedia.org/">Wikipedia</a>');
    assert.equal(relOf(out), 'noopener noreferrer');
    assert.equal(hasTargetBlank(out), true, 'an external new tab is a real choice — leave it');
  });

  test('rel=sponsored KEEPS its nofollow (removing it is a Google policy violation)', () => {
    const out = norm('<a href="https://partner.example/" rel="nofollow sponsored">Partner</a>');
    assert.match(relOf(out), /nofollow/);
    assert.match(relOf(out), /sponsored/);
  });

  test('rel=ugc keeps its nofollow too', () => {
    assert.match(relOf(norm('<a href="https://x.example/" rel="nofollow ugc">c</a>')), /nofollow/);
  });

  test('noopener is ADDED to an external target=_blank that lacks it (tabnabbing)', () => {
    assert.match(relOf(norm('<a href="https://x.example/" target="_blank">x</a>')), /noopener/);
  });

  test('a protocol-relative off-site href is treated as external, not as a root-relative path', () => {
    const out = norm('<a href="//evil.test/x" target="_blank" rel="nofollow">x</a>');
    assert.equal(hasTargetBlank(out), true, 'external: the new tab stays');
    assert.match(relOf(out), /noopener/);
  });
});

describe('it does not break the HTML around it', () => {
  test('a > inside an attribute value does not end the tag early', () => {
    const out = norm('<a href="/x" title="a > b" rel="nofollow">t</a>');
    assert.match(out, /title="a > b"/);
    assert.equal(relOf(out), null);
  });

  test('<a name="..."> with no href is left completely alone', () => {
    const src = '<a name="section-2"></a>';
    assert.equal(norm(src), src);
  });

  test('multiple links in one body are each judged on their own href', () => {
    const out = norm(
      '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://www.davnoot.com/">us</a> and ' +
        '<a target="_blank" rel="noopener noreferrer nofollow" href="https://www.google.com/">them</a></p>',
    );
    const rels = [...out.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(!/nofollow/.test(rels[0]), 'internal link keeps no nofollow');
    assert.ok(!/nofollow/.test(rels[1]), 'plain external editorial link loses its accidental nofollow');
    assert.ok(/noopener/.test(rels[1]), 'but keeps the security rel');
  });

  test('non-anchor HTML passes through byte-identically', () => {
    const src = '<p>Some <strong>copy</strong> with <em>no links</em>.</p>';
    assert.equal(norm(src), src);
  });

  test('nullish and empty input are safe', () => {
    assert.equal(normalizeLinkRel(null), '');
    assert.equal(normalizeLinkRel(undefined), '');
    assert.equal(normalizeLinkRel(''), '');
  });

  test('rel token order is stable, so the same link always renders the same bytes', () => {
    const a = relOf(norm('<a href="https://x.example/" target="_blank" rel="noreferrer noopener">x</a>'));
    const b = relOf(norm('<a href="https://x.example/" target="_blank" rel="noopener noreferrer">x</a>'));
    assert.equal(a, b);
  });
});

describe('the editor that caused this is fixed at source too', () => {
  test('rich-text.js no longer lets Tiptap apply its nofollow default', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'src', 'dashboard', 'rich-text.js'),
      'utf8',
    );
    const cfg = /Link\.configure\(\{[\s\S]*?\}\)/.exec(src);
    assert.ok(cfg, 'Link.configure( … ) not found — did the editor move?');
    assert.match(cfg[0], /HTMLAttributes/, 'Link.configure must override HTMLAttributes or Tiptap re-adds nofollow');
    assert.ok(!/nofollow/.test(cfg[0]), 'the editor must not write nofollow into new links');
  });
});
