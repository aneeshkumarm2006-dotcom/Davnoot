/* /llms.txt — the answer-engine manifest.
 *
 * WHY IT IS TESTED AT ALL
 * This site sells AI search optimization, robots.txt explicitly welcomes GPTBot,
 * OAI-SearchBot, PerplexityBot and ClaudeBot, and until now /llms.txt 404'd. The
 * failure mode of the fix is not "the file is missing" — it is "the file is there
 * but MALFORMED", which is worse: a consumer that can't parse the H1/blockquote/H2
 * shape drops the whole document silently. So these tests pin the FORMAT
 * (llmstxt.org) as hard as they pin the content.
 *
 * The other failure mode is drift: llms.txt and sitemap.xml both claim to enumerate
 * the site, so a page in one and not the other is a lie in whichever is stale. The
 * last test pins them together.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SITE_URL, SERVICE_PAGES, ADS_PAGES, canonicalFor } from '../lib/templates.js';
import { STATIC_URLS } from '../lib/sitemap-static.js';

const REPO = path.join(import.meta.dirname, '..');

/* NO mongodb-memory-server here, deliberately.
 *
 * The blog section is the ONE part of llms.txt that reads the database, and
 * api/llms.js wraps that read in a try/catch precisely so a Mongo outage costs us the
 * post list and nothing else. Pointing MONGODB_URI at an unroutable port exercises
 * exactly that path — which is the property actually worth pinning: /llms.txt must
 * never 500 and must never emit a half-written document. (scripts/sitemap.test.js
 * already covers the identical published-posts query against a real mongod; spinning
 * a SECOND one up here bought duplicate coverage and, in practice, a hung suite.) */
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/llms-test-no-db';

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    send(d) { this.body = d; return this; },
  };
}

const render = async (method = 'GET') => {
  const { default: llms } = await import('../api/llms.js');
  const res = mockRes();
  await llms({ method, query: {} }, res);
  return res;
};

let doc;
before(async () => {
  doc = (await render()).body;
});

const lines = () => doc.split('\n');
const linkLines = () => lines().filter((l) => l.startsWith('- ['));
const urls = () => linkLines().map((l) => /\]\(([^)]+)\)/.exec(l)[1]);

describe('/llms.txt is served and well-formed', () => {
  test('200s as text/plain', async () => {
    const res = await render();
    assert.equal(res.statusCode, 200);
    assert.match(res.getHeader('content-type'), /^text\/plain/);
  });

  test('rejects a write method rather than silently accepting it', async () => {
    const res = await render('POST');
    assert.equal(res.statusCode, 405);
  });

  /* ---- the llmstxt.org shape ---- */

  test('the first non-blank line is the one and only H1', () => {
    const first = lines().find((l) => l.trim());
    assert.equal(first, '# Davnoot');
    assert.equal(lines().filter((l) => /^# /.test(l)).length, 1, 'exactly one H1');
  });

  test('the H1 is immediately followed by a blockquote summary', () => {
    const i = lines().findIndex((l) => l.startsWith('# '));
    const next = lines().slice(i + 1).find((l) => l.trim());
    assert.match(next, /^> \S/, 'the line after the H1 must be the > summary');
  });

  test('every section heading is an H2 (no H3+, which the format does not define)', () => {
    for (const l of lines()) {
      if (/^#{3,}\s/.test(l)) assert.fail(`heading deeper than H2: ${l}`);
    }
    assert.ok(lines().some((l) => l.startsWith('## ')), 'there is at least one H2 section');
  });

  test('every line inside an H2 section is either blank or a markdown link item', () => {
    let inSection = false;
    for (const l of lines()) {
      if (l.startsWith('## ')) { inSection = true; continue; }
      if (!inSection || !l.trim()) continue;
      assert.match(l, /^- \[[^\]]+\]\([^)]+\)(: .+)?$/, `malformed list item inside a section: ${l}`);
    }
  });

  test('every URL is absolute and on our own origin', () => {
    for (const u of urls()) {
      assert.ok(u.startsWith(SITE_URL + '/'), `not an absolute same-origin URL: ${u}`);
    }
  });

  test('no URL is listed twice', () => {
    const seen = new Set();
    for (const u of urls()) {
      assert.ok(!seen.has(u), `duplicated in llms.txt: ${u}`);
      seen.add(u);
    }
  });

  test('the "Optional" section is last, per the spec', () => {
    const headings = lines().filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    if (headings.includes('Optional')) {
      assert.equal(headings.at(-1), 'Optional', 'Optional must be the final section');
    }
  });
});

describe('/llms.txt enumerates the same site the sitemap does', () => {
  test('every service page and ad hub is listed', () => {
    const listed = new Set(urls());
    for (const f of [...SERVICE_PAGES, ...ADS_PAGES]) {
      assert.ok(listed.has(canonicalFor(f)), `${f} is missing from llms.txt`);
    }
  });

  test('the four pages that the crawler could not reach are listed (they were sitemap orphans)', () => {
    const listed = new Set(urls());
    for (const f of ['ai-seo-agency.html', 'ai-seo-montreal.html', 'etf-marketing.html', 'privacy.html']) {
      assert.ok(listed.has(canonicalFor(f)), `${f} is missing from llms.txt`);
    }
  });

  test('every non-CMS static page in the sitemap manifest is also in llms.txt', () => {
    const listed = new Set(urls());
    const missing = STATIC_URLS.map((u) => u.loc).filter((loc) => !listed.has(loc));
    assert.deepEqual(missing, [], 'in sitemap.xml but not llms.txt');
  });

  test('/blog is listed', () => {
    assert.ok(urls().includes(SITE_URL + '/blog'));
  });

  test('a database outage costs the post list and NOTHING else', () => {
    // This whole file runs with an unreachable MONGODB_URI, so `doc` IS the degraded
    // document. Every assertion above therefore already proves the degraded path is a
    // complete, well-formed file; this makes that explicit rather than incidental.
    assert.ok(doc.trimEnd().endsWith(')') || /\)\s*$/.test(doc.trimEnd()) || /: [^\n]+$/.test(doc.trimEnd()),
      'the document must not end mid-line');
    assert.ok(urls().length > 20, `degraded document is too short: ${urls().length} links`);
    assert.ok(doc.includes('## Services'), 'the non-database sections must survive a Mongo outage');
  });

  test('the degraded document is cached only briefly, so the posts come back fast', async () => {
    const res = await render();
    assert.match(res.getHeader('cache-control'), /s-maxage=60\b/);
  });
});

describe('/llms.txt routing', () => {
  const config = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));

  test('is rewritten to the handler', () => {
    const r = config.rewrites.find((x) => x.source === '/llms.txt');
    assert.ok(r, '/llms.txt has no rewrite — it would fall through to the /:slug catch-all');
    assert.equal(r.destination, '/api/llms');
  });

  test('the rewrite comes BEFORE the /:slug catch-all (which would otherwise swallow it)', () => {
    const i = config.rewrites.findIndex((x) => x.source === '/llms.txt');
    const j = config.rewrites.findIndex((x) => x.source === '/:slug');
    assert.ok(i >= 0 && j >= 0 && i < j, 'the catch-all must not shadow /llms.txt');
  });

  test('there is no llms.txt on disk to shadow the rewrite (the sitemap.xml lesson)', () => {
    assert.ok(!fs.existsSync(path.join(REPO, 'llms.txt')),
      'a static llms.txt would shadow the rewrite and go stale the moment a post is published');
  });
});
