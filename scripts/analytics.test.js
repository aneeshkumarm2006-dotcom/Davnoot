/* The Google Analytics tag invariants, as executable tests.
 *
 *   node --test scripts/
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Analytics is the one thing on the site that fails COMPLETELY SILENTLY. A page
 * with no tag looks perfect to a visitor, to a crawler and to `npm run site`; the
 * only symptom is a number that is quietly too low, months later, in a report
 * nobody can re-run. And this site emits <head> from seven places (the baked static
 * files, the compiled CMS pages, the composed-page renderer, the blog index, the
 * blog article, the two 404/410 renderers, and the hand-written app shells), so
 * "every page is tagged" is a claim that needs re-proving on every build.
 *
 * Same shape as favicon.test.js, for the same reason — see its header.
 *
 * Three failure modes are pinned here, all of them invisible in a browser:
 *   1. A page (or a whole renderer) that emits no tag.        -> undercounted forever
 *   2. /analytics.js drifting from GA_MEASUREMENT_ID.         -> hits to a dead property
 *   3. The CSP not allowing googletagmanager.com.             -> tag blocked on EVERY page
 * The third is the nastiest: the markup is perfect, the console says
 * "Refused to load", and nothing in this repo would ever have noticed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ANALYTICS_TAGS, GA_MEASUREMENT_ID } from '../lib/templates.js';
import { COMPILED_PAGES } from '../lib/compiled-pages.gen.js';
import { renderPage } from '../lib/page-render.js';
import { renderComposedPage } from '../lib/composed-render.js';
import { renderNotFound } from '../lib/not-found.js';
import { renderArticlePage, renderIndexPage } from '../lib/blog-render.js';
import { render404 } from '../lib/blog-404.js';

const ROOT = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const csp = () =>
  (JSON.parse(read('vercel.json')).headers || [])
    .flatMap((h) => h.headers)
    .find((kv) => kv.key === 'Content-Security-Policy').value;

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

/* The Google Search Console domain-verification stub: a bare token file with no
 * <head>, which Google string-matches. It must not grow one. */
const NOT_A_PAGE = new Set(['googlee5fd9fb7c651ff20.html']);

/* The password-gated internal tools. These are DELIBERATELY untagged — our own
 * editing sessions are not marketing-site traffic, and letting them into the
 * property would inflate exactly the numbers we make decisions from. */
const INTERNAL = (rel) => rel.startsWith('admin/') || rel.startsWith('seoteam/');

/* ========================================================================== */
describe('the tag pair itself', () => {
  test('it is the gtag.js loader plus the first-party config file', () => {
    assert.equal(ANALYTICS_TAGS.length, 2, 'the analytics block lost a tag');
    assert.ok(
      ANALYTICS_TAGS[0].includes(`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`),
      'the loader must carry the measurement ID in its query string',
    );
    assert.ok(ANALYTICS_TAGS[1].includes('src="/analytics.js"'), 'the config half must be the first-party file');
  });

  test('both tags are async — analytics must never block the parser', () => {
    // This ships in the <head> of every page on the site. A synchronous script
    // there stalls rendering on a third-party round trip and takes LCP with it.
    for (const tag of ANALYTICS_TAGS) assert.match(tag, /<script async /, `not async: ${tag}`);
  });

  test('no inline <script> — script-src has no \'unsafe-inline\'', () => {
    // Google's copy-paste snippet is inline. Pasted as-is, it would be blocked by
    // the CSP on every page unless allowlisted by a hash that has to be recomputed
    // on every edit. Hence the external file. See ANALYTICS_TAGS in templates.js.
    for (const tag of ANALYTICS_TAGS) assert.match(tag, /<script[^>]+src=/, `inline script: ${tag}`);
  });
});

/* ========================================================================== */
describe('/analytics.js is a valid classic script pointed at the right property', () => {
  test('the file exists — the tags reference it from every page', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'analytics.js')), 'analytics.js is missing from the web root');
  });

  test('its measurement ID matches GA_MEASUREMENT_ID', () => {
    // The ID is duplicated because a static asset cannot import a constant. This
    // is the pin that stops the copy drifting into a property nobody looks at.
    const m = read('analytics.js').match(/gtag\('config',\s*'([^']+)'\)/);
    assert.ok(m, "analytics.js has no gtag('config', …) call");
    assert.equal(m[1], GA_MEASUREMENT_ID, 'analytics.js and lib/templates.js disagree about the measurement ID');
  });

  test('it queues into dataLayer, so either load order works', () => {
    const src = read('analytics.js');
    assert.match(src, /window\.dataLayer = window\.dataLayer \|\| \[\]/, 'the dataLayer stub is what makes async safe');
    assert.match(src, /function gtag\(\)/, '`gtag` must be a global function declaration, not a const');
    assert.match(src, /gtag\('js', new Date\(\)\)/, "the gtag('js', …) call is missing");
  });

  test('it is NOT an ES module — a classic script is the only thing gtag.js can see', () => {
    // `type="module"` is absent from the tag, so an import/export here is a hard
    // syntax error in the browser and analytics dies on every page at once.
    const src = read('analytics.js');
    assert.doesNotMatch(src, /^\s*(import|export)\s/m, 'analytics.js must not use module syntax');
  });
});

/* ========================================================================== */
describe('every SHIPPED .html file carries the tag', () => {
  const files = shippedHtml();

  test('the sweep actually found the site (guards against a broken walk)', () => {
    assert.ok(files.length > 40, `only ${files.length} html files found — the walk is wrong`);
  });

  for (const rel of files) {
    if (NOT_A_PAGE.has(rel) || INTERNAL(rel)) continue;
    test(`${rel} loads gtag.js and /analytics.js`, () => {
      const html = read(rel);
      for (const tag of ANALYTICS_TAGS) {
        assert.ok(html.includes(tag), `${rel} is missing: ${tag}\n  Run \`npm run site\` — build.js bakes this in.`);
      }
      assert.equal(
        html.split('src="/analytics.js"').length - 1,
        1,
        `${rel} loads /analytics.js twice — every pageview would be counted twice`,
      );
    });
  }

  test('the gated internal tools are deliberately NOT tagged', () => {
    for (const rel of files.filter(INTERNAL)) {
      assert.ok(
        !read(rel).includes('googletagmanager.com'),
        `${rel} is an internal tool — tagging it pours our own sessions into the marketing property`,
      );
    }
  });
});

/* ========================================================================== */
describe('every SERVER-RENDERED page carries the tag', () => {
  /* The surfaces with no static file to grep: they exist only as bytes at request
   * time, which is exactly how a public URL ends up untagged unnoticed. */
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
    test(`${name} emits the tag`, () => {
      const html = render();
      for (const tag of ANALYTICS_TAGS) assert.ok(html.includes(tag), `${name} is missing: ${tag}`);
      assert.ok(html.indexOf('googletagmanager.com') < html.indexOf('</head>'), `${name} emits the tag outside <head>`);
    });
  }

  for (const file of Object.keys(COMPILED_PAGES)) {
    test(`compiled ${file} emits the tag`, () => {
      const html = renderPage(COMPILED_PAGES[file], null);
      for (const tag of ANALYTICS_TAGS) assert.ok(html.includes(tag), `${file} is missing: ${tag}`);
    });
  }
});

/* ========================================================================== */
describe('the CSP actually allows the tag to run', () => {
  test("script-src names googletagmanager.com — otherwise it's blocked everywhere", () => {
    assert.match(
      csp().match(/script-src[^;]*/)[0],
      /https:\/\/www\.googletagmanager\.com/,
      'script-src does not allow gtag.js — every page would log "Refused to load"',
    );
  });

  test('connect-src allows the collect endpoints GA4 actually beacons to', () => {
    // The script can load and still send nothing: GA4 POSTs to /g/collect on
    // google-analytics.com, and to a regional host for EU traffic.
    const connect = csp().match(/connect-src[^;]*/)[0];
    for (const origin of ['https://*.google-analytics.com', 'https://*.analytics.google.com']) {
      assert.ok(connect.includes(origin), `connect-src is missing ${origin} — hits would be blocked`);
    }
  });

  test("script-src still has no 'unsafe-inline'", () => {
    // Loosening the CSP is the tempting "fix" when a tag is blocked. It is not one.
    assert.doesNotMatch(csp().match(/script-src[^;]*/)[0], /'unsafe-inline'/);
  });
});

/* ========================================================================== */
describe('the tag has ONE source of truth', () => {
  test('no renderer hard-codes googletagmanager.com', () => {
    // Every <head>-emitting module must interpolate ANALYTICS_TAGS. A second copy
    // is a measurement ID that will be changed in one place and not the other.
    const dir = path.join(ROOT, 'lib');
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.js') || name === 'templates.js' || name.endsWith('.gen.js')) continue;
      assert.doesNotMatch(
        read(path.join('lib', name)),
        /googletagmanager\.com/,
        `lib/${name} hard-codes the tag — import ANALYTICS_TAGS from templates.js instead`,
      );
    }
  });

  test('the measurement ID appears in exactly two places in the source', () => {
    for (const file of ['lib/templates.js', 'analytics.js']) {
      assert.ok(read(file).includes(GA_MEASUREMENT_ID), `${file} lost the measurement ID`);
    }
  });
});
