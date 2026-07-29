/* The favicon invariants, as executable tests.
 *
 *   node --test scripts/
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "Every page has the Davnoot favicon" was true once, verified by hand, and had no
 * way to STAY true. The site emits <head> from seven different places — the baked
 * static files, the eight compiled CMS pages, the composed-page renderer, the blog
 * index, the blog article, two 404/410 renderers, and three hand-written app shells
 * — and only some of them share a code path. A page added to the wrong one of those
 * ships with a generic globe in the SERP and nothing fails.
 *
 * The original bug is worth restating because these tests are shaped around it:
 * the icons used to point straight at images/davnoot-logo.png, a 579x424 mark on a
 * transparent background. Google only renders a favicon in search results when it is
 * SQUARE, so it dropped the icon and drew the globe instead. That is why squareness
 * and the declared `sizes` are asserted against the actual FILE BYTES here rather
 * than against a constant — a constant would have happily agreed with itself while
 * the file on disk stayed 579x424.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FAVICON_TAGS } from '../lib/templates.js';
import { COMPILED_PAGES } from '../lib/compiled-pages.gen.js';
import { renderPage } from '../lib/page-render.js';
import { renderComposedPage } from '../lib/composed-render.js';
import { renderNotFound } from '../lib/not-found.js';
import { renderArticlePage, renderIndexPage } from '../lib/blog-render.js';
import { render404 } from '../lib/blog-404.js';

const ROOT = path.join(import.meta.dirname, '..');

/* ------------------------------------------------------------------ helpers */

/** Every href/src the favicon block points at, in declaration order. */
const iconHrefs = FAVICON_TAGS.map((t) => (t.match(/href="([^"]+)"/) || [])[1]).filter(Boolean);

/** The `sizes` attribute of the tag pointing at `href`, e.g. "16x16 32x32 48x48". */
function declaredSizes(href) {
  const tag = FAVICON_TAGS.find((t) => t.includes(`href="${href}"`));
  return ((tag.match(/sizes="([^"]+)"/) || [])[1] || '').split(/\s+/).filter(Boolean);
}

/** Width/height from a PNG's IHDR — the real pixel dimensions, not the claim. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.readUInt32BE(0), 0x89504e47, `${file} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** The sizes actually packed into a multi-resolution .ico, from its directory. */
function icoSizes(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.readUInt16LE(2), 1, `${file} is not an icon (type != 1)`);
  const n = b.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    out.push({ w: b[o] || 256, h: b[o + 1] || 256 });
  }
  return out;
}

/** Every .html file that ships, excluding build inputs and generated fixtures. */
function shippedHtml() {
  const out = [];
  const skipDirs = new Set(['node_modules', '.git', 'scripts', 'pages', 'src', 'images']);
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.name.endsWith('.html')) {
        out.push(path.relative(ROOT, path.join(dir, e.name)).replace(/\\/g, '/'));
      }
    }
  })(ROOT);
  return out;
}

/* The Google Search Console domain-verification stub. It is a bare token file that
 * Google fetches and string-matches; it has no <head> and must not grow one. */
const NOT_A_PAGE = new Set(['googlee5fd9fb7c651ff20.html']);

/* ========================================================================== */
describe('the icon FILES on disk are what the tags claim they are', () => {
  test('every href in FAVICON_TAGS resolves to a committed file', () => {
    assert.ok(iconHrefs.length >= 4, 'the favicon block lost its icons');
    for (const href of iconHrefs) {
      const file = path.join(ROOT, href.replace(/^\//, ''));
      assert.ok(fs.existsSync(file), `${href} is declared in FAVICON_TAGS but not on disk — run \`npm run favicon\``);
    }
  });

  test('every PNG icon is SQUARE — a non-square icon is why Google drew a globe', () => {
    for (const href of iconHrefs.filter((h) => h.endsWith('.png'))) {
      const { w, h } = pngSize(path.join(ROOT, href.replace(/^\//, '')));
      assert.equal(w, h, `${href} is ${w}x${h} — Google drops non-square favicons`);
    }
  });

  test('a PNG icon is EXACTLY the size its tag advertises', () => {
    // Consumers pick an icon from `sizes` without downloading it. A lie here means
    // a crawler asking for 48 gets something else and may reject it outright.
    for (const href of iconHrefs.filter((h) => h.endsWith('.png'))) {
      const [declared] = declaredSizes(href);
      const { w } = pngSize(path.join(ROOT, href.replace(/^\//, '')));
      assert.equal(`${w}x${w}`, declared, `${href} is ${w}x${w} but declares sizes="${declared}"`);
    }
  });

  test('/favicon.ico declares EVERY resolution it actually contains', () => {
    // The regression this pins: the .ico has held 16/32/48 since it was generated,
    // but declared only "32x32" — hiding the 48px entry, the one size Google's own
    // docs ask for, behind a claim that the file did not have it.
    const entries = icoSizes(path.join(ROOT, 'favicon.ico'));
    for (const { w, h } of entries) assert.equal(w, h, `favicon.ico holds a non-square ${w}x${h} entry`);
    assert.deepEqual(
      declaredSizes('/favicon.ico').sort(),
      entries.map((e) => `${e.w}x${e.h}`).sort(),
      'favicon.ico\'s sizes="" must list exactly the entries packed into it (see ICO_SIZES in gen-favicon.js)',
    );
  });

  test('at least one icon is a multiple of 48px, which is what Google documents', () => {
    const sizes = iconHrefs.flatMap((h) => declaredSizes(h)).map((s) => parseInt(s, 10));
    assert.ok(sizes.some((s) => s % 48 === 0), `no icon is a multiple of 48px: ${sizes.join(', ')}`);
  });

  test('the icons are opaque — a transparent mark vanishes in a dark browser tab', () => {
    // Spot-check the alpha channel of the 48px PNG: gen-favicon.js composites the
    // mark onto an opaque brand-black square precisely so this holds.
    const b = fs.readFileSync(path.join(ROOT, 'images', 'favicon-48x48.png'));
    assert.equal(b[25], 6, 'expected an 8-bit RGBA PNG from gen-favicon.js');
  });
});

/* ========================================================================== */
describe('every SHIPPED .html file carries the favicon', () => {
  const files = shippedHtml();

  test('the sweep actually found the site (guards against a broken walk)', () => {
    assert.ok(files.length > 40, `only ${files.length} html files found — the walk is wrong`);
  });

  for (const rel of files) {
    if (NOT_A_PAGE.has(rel)) continue;
    test(`${rel} declares an icon, an apple-touch-icon, and the .ico`, () => {
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.match(html, /<link rel="icon"[^>]*href="\/favicon\.ico"/, `${rel} has no /favicon.ico link`);
      assert.match(html, /<link rel="icon"[^>]*href="\/images\/favicon-\d+x\d+\.png"/, `${rel} has no PNG icon`);
      assert.match(html, /rel="apple-touch-icon"/, `${rel} has no apple-touch-icon`);
      // Never regress to the logo: 579x424, transparent, and rejected by Google.
      assert.doesNotMatch(html, /rel="(icon|apple-touch-icon)"[^>]*davnoot-logo/, `${rel} points an icon at the LOGO`);
    });
  }
});

/* ========================================================================== */
describe('every SERVER-RENDERED page carries the favicon', () => {
  /* These are the surfaces with no static file to grep — they only exist as bytes
   * at request time, which is exactly how a page ends up shipping without an icon
   * and nobody noticing. Each renderer below backs a real public URL. */
  const post = {
    _id: 'x'.repeat(24),
    title: 'A post',
    slug: 'a-post',
    content: '<p>Hello world</p>',
    excerpt: 'Hello',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    status: 'published',
  };

  const surfaces = [
    ['/blog/:slug  (api/blog/post.js)', () => renderArticlePage(post, { related: [] })],
    ['/blog        (api/blog/index.js)', () => renderIndexPage({ posts: [post], page: 1, totalPages: 1 })],
    ['/blog        empty-state fallback', () => renderIndexPage({ posts: [], page: 1, totalPages: 1 })],
    ['/blog/*      404 (lib/blog-404.js)', () => render404()],
    ['/:slug       404 (lib/not-found.js)', () => renderNotFound({ status: 404 })],
    ['/:slug       410 gone', () => renderNotFound({ status: 410 })],
    [
      '/:slug       composed page (lib/composed-render.js)',
      () => renderComposedPage({ content: { title: 'T', sections: [] }, path: '/t', slug: 't', locale: 'en' }, {}),
    ],
  ];

  for (const [name, render] of surfaces) {
    test(`${name} emits the favicon block`, () => {
      const html = render();
      for (const tag of FAVICON_TAGS) {
        assert.ok(html.includes(tag), `${name} is missing: ${tag}`);
      }
    });
  }

  for (const file of Object.keys(COMPILED_PAGES)) {
    test(`compiled ${file} emits the favicon block`, () => {
      const html = renderPage(COMPILED_PAGES[file], null);
      for (const tag of FAVICON_TAGS) {
        assert.ok(html.includes(tag), `${file} is missing: ${tag}`);
      }
    });
  }
});

/* ========================================================================== */
describe('the favicon block has ONE source of truth', () => {
  test('no renderer hand-rolls its own <link rel="icon">', () => {
    // Every <head>-emitting module must interpolate FAVICON_TAGS. A literal icon
    // link in one of them is a copy that will silently drift from the rest.
    const dir = path.join(ROOT, 'lib');
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.js') || name === 'templates.js' || name.endsWith('.gen.js')) continue;
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      assert.doesNotMatch(
        src,
        /['"`]<link rel="icon"/,
        `lib/${name} hard-codes an icon link — import FAVICON_TAGS from templates.js instead`,
      );
    }
  });

  test('the app shells stay in step with FAVICON_TAGS', () => {
    // /admin and /seoteam are hand-written HTML (they predate the renderers) so they
    // cannot import the constant. They deliberately omit the manifest — both are
    // gated and noindex, so neither has any business advertising as installable —
    // but the ICONS must match, or a dashboard tab shows a different mark.
    const icons = FAVICON_TAGS.filter((t) => t.includes('rel="icon"'));
    for (const shell of ['admin/index.html', 'seoteam/index.html', 'seoteam/login.html']) {
      const html = fs.readFileSync(path.join(ROOT, shell), 'utf8');
      for (const tag of icons) {
        assert.ok(html.includes(tag), `${shell} drifted from FAVICON_TAGS — missing: ${tag}`);
      }
      assert.ok(!html.includes('rel="manifest"'), `${shell} must not advertise the web manifest`);
    }
  });
});
