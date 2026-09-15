/* IndexNow must be INCAPABLE of breaking a publish.
 *
 * Every test here is about one of two promises lib/indexnow.js makes to its
 * callers, because both are invisible until the day they are broken in production:
 *
 *   1. IT NEVER THROWS AND NEVER GATES WRONG. It is called unawaited from the
 *      middle of a write handler. A rejection there is an unhandled rejection that
 *      can take the function down AFTER the database write has already committed —
 *      a 500 on a publish that actually succeeded. And an env gate that leaks would
 *      have local dev and every contractor's preview branch submitting live
 *      production URLs.
 *
 *   2. IT SUBMITS THE PUBLIC URL. /seo.html is the DB overlay key, /services/seo
 *      is the URL. Submitting the key would ask five search engines to crawl a
 *      path that 301s, on every publish, forever.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  pingIndexNow,
  submitIndexNow,
  normalizeUrls,
  skipReason,
  keyLocation,
  INDEXNOW_HOST,
} from '../lib/indexnow.js';
import { publicUrlFor } from '../lib/page-url.js';
import { isPostLive } from '../lib/blog-query.js';
import { SITE_URL } from '../lib/templates.js';

const ROOT = path.join(import.meta.dirname, '..');
const PROD = { INDEXNOW_KEY: 'test-key', VERCEL_ENV: 'production' };

/** A fetch stand-in that records calls and returns a chosen status. */
function fakeFetch(status = 200) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), opts });
    return { status };
  };
  impl.calls = calls;
  return impl;
}

/* ------------------------------------------------------------------ gate -- */

describe('the production gate', () => {
  test('no key -> no request, whatever the environment', async () => {
    const f = fakeFetch();
    await pingIndexNow('/blog/x', { env: { VERCEL_ENV: 'production' }, fetchImpl: f });
    assert.equal(f.calls.length, 0);
  });

  test('a key alone is not enough — preview and dev must not submit', async () => {
    for (const env of [{ INDEXNOW_KEY: 'k' }, { INDEXNOW_KEY: 'k', VERCEL_ENV: 'preview' }, { INDEXNOW_KEY: 'k', VERCEL_ENV: 'development' }]) {
      const f = fakeFetch();
      const r = await pingIndexNow('/blog/x', { env, fetchImpl: f });
      assert.equal(f.calls.length, 0, `submitted from VERCEL_ENV=${env.VERCEL_ENV}`);
      assert.match(r.skipped, /not production/);
    }
  });

  test('key + production does submit', async () => {
    const f = fakeFetch();
    await pingIndexNow('/blog/x', { env: PROD, fetchImpl: f });
    assert.equal(f.calls.length, 1);
  });

  test('a whitespace-only key counts as unset', () => {
    assert.match(skipReason({ INDEXNOW_KEY: '   ', VERCEL_ENV: 'production' }), /not set/);
  });
});

/* ------------------------------------------------------- never throws ------ */

describe('it can never break the write that called it', () => {
  test('a network failure resolves instead of rejecting', async () => {
    const boom = async () => {
      throw new Error('ECONNREFUSED');
    };
    const r = await pingIndexNow('/blog/x', { env: PROD, fetchImpl: boom });
    assert.equal(r.ok, false); // reported...
    assert.equal(r.batches[0].status, 0); // ...but not thrown
  });

  test('a 403 (bad key file) resolves, marked not-ok', async () => {
    const r = await pingIndexNow('/blog/x', { env: PROD, fetchImpl: fakeFetch(403) });
    assert.equal(r.ok, false);
    assert.equal(r.batches[0].status, 403);
  });

  test('garbage input does not throw and sends nothing', async () => {
    // NB a bare string like 'whatever' is NOT garbage — it resolves against
    // SITE_URL as a relative path, which is the documented convenience the
    // routes rely on ('/blog/x'). Only non-strings and off-host values vanish.
    for (const input of [null, undefined, [], [null, '', '   '], 42, [{}], 'https://elsewhere.test/x']) {
      const f = fakeFetch();
      await assert.doesNotReject(() => pingIndexNow(input, { env: PROD, fetchImpl: f }));
      assert.equal(f.calls.length, 0, `sent a request for ${JSON.stringify(input)}`);
    }
  });

  test('the returned promise is safe to drop on the floor', async () => {
    // The API routes call this WITHOUT await. If it could reject, that would be an
    // unhandled rejection in a serverless function after the write committed.
    const rejections = [];
    const onReject = (err) => rejections.push(err);
    process.on('unhandledRejection', onReject);

    pingIndexNow('/blog/x', { env: PROD, fetchImpl: async () => { throw new Error('down'); } });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    process.off('unhandledRejection', onReject);
    assert.deepEqual(rejections, []);
  });
});

/* ------------------------------------------------------ the payload -------- */

describe('the submitted payload', () => {
  test('host, key and keyLocation all agree', async () => {
    const f = fakeFetch();
    await submitIndexNow('/blog/x', { key: 'abc', fetchImpl: f });
    const { body, url } = f.calls[0];

    assert.equal(url, 'https://api.indexnow.org/indexnow');
    assert.equal(body.host, INDEXNOW_HOST);
    assert.equal(body.key, 'abc');
    assert.equal(body.keyLocation, keyLocation('abc'));
    // A mismatch between any two of these is a 422 for the whole batch.
    assert.equal(new URL(body.keyLocation).host, body.host);
    assert.ok(body.urlList.every((u) => new URL(u).host === body.host));
  });

  test('relative paths become absolute production URLs', () => {
    assert.deepEqual(normalizeUrls(['/blog/my-post']), [SITE_URL + '/blog/my-post']);
  });

  test('off-host URLs are dropped, not passed through', () => {
    // One foreign URL 422s the ENTIRE submission, so this is not cosmetic.
    assert.deepEqual(normalizeUrls(['https://example.com/x', '/ok']), [SITE_URL + '/ok']);
  });

  test('non-http schemes are dropped', () => {
    assert.deepEqual(normalizeUrls(['javascript:alert(1)', 'mailto:a@b.c', 'ftp://x/y']), []);
  });

  test('duplicates collapse and fragments are stripped', () => {
    assert.deepEqual(normalizeUrls(['/a', '/a', SITE_URL + '/a', '/a#top']), [SITE_URL + '/a']);
  });

  test('a batch never exceeds the protocol ceiling of 10,000', async () => {
    const f = fakeFetch();
    const many = Array.from({ length: 10001 }, (_, i) => `/p/${i}`);
    const r = await submitIndexNow(many, { key: 'k', fetchImpl: f });

    assert.equal(r.submitted, 10001);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].body.urlList.length, 10000);
    assert.equal(f.calls[1].body.urlList.length, 1);
  });
});

/* -------------------------------------------- what the routes will send ---- */

describe('the URLs the write routes will actually submit', () => {
  test('a page key resolves to its PUBLIC url, not the DB overlay key', () => {
    // /seo.html is the storage key; /services/seo is what Google and Bing see.
    assert.equal(publicUrlFor('seo.html'), SITE_URL + '/services/seo');
    assert.equal(publicUrlFor('index.html'), SITE_URL + '/');
    assert.equal(publicUrlFor('reddit-ads.html'), SITE_URL + '/ads/reddit-ads');
    assert.equal(publicUrlFor('training-seo.html'), SITE_URL + '/free-training/seo');
    assert.equal(publicUrlFor('content-analyzer.html'), SITE_URL + '/tools/content-analyzer');
  });

  test('the French twin keeps its /fr URL', () => {
    assert.equal(publicUrlFor('fr/seo.html'), SITE_URL + '/fr/services/seo');
    assert.equal(publicUrlFor('fr/index.html'), SITE_URL + '/fr');
  });

  test('a composed page resolves to /<slug>', () => {
    assert.equal(publicUrlFor('some-landing'), SITE_URL + '/some-landing');
  });

  test('every page URL survives normalizeUrls unchanged', () => {
    // If publicUrlFor ever produced something normalizeUrls drops (wrong host,
    // a relative string), the ping would silently become a no-op.
    for (const key of ['seo.html', 'fr/seo.html', 'index.html', 'a-composed-page']) {
      assert.deepEqual(normalizeUrls(publicUrlFor(key)), [publicUrlFor(key)], key);
    }
  });
});

describe('isPostLive matches publishedFilter', () => {
  const now = new Date('2026-09-14T12:00:00Z');

  test('a draft is not live', () => {
    assert.equal(isPostLive({ status: 'draft', publishedAt: new Date('2020-01-01') }, now), false);
  });

  test('a SCHEDULED post is not live — the case a status check gets wrong', () => {
    assert.equal(isPostLive({ status: 'published', publishedAt: new Date('2027-01-01') }, now), false);
  });

  test('a published, dated post is live', () => {
    assert.equal(isPostLive({ status: 'published', publishedAt: new Date('2026-01-01') }, now), true);
  });

  test('missing or invalid dates are not live', () => {
    assert.equal(isPostLive({ status: 'published' }, now), false);
    assert.equal(isPostLive({ status: 'published', publishedAt: 'nonsense' }, now), false);
    assert.equal(isPostLive(null, now), false);
  });
});

/* --------------------------------------------------- the key file ---------- */

describe('the key file at the repo root', () => {
  /* The one manual step. These assertions are skipped until the file exists, so
   * they do not block anyone before IndexNow is switched on — but the moment a
   * <key>.txt is committed, they enforce the format. A key file whose contents do
   * not exactly match its filename is a 403 on every single submission. */
  const keyFiles = fs
    .readdirSync(ROOT)
    .filter((f) => /^[A-Za-z0-9-]{8,128}\.txt$/.test(f) && f !== 'robots.txt' && f !== 'llms.txt');

  test('at most one IndexNow key file is committed', () => {
    assert.ok(keyFiles.length <= 1, `found several candidate key files: ${keyFiles.join(', ')}`);
  });

  test('the key file contains exactly its own name', { skip: !keyFiles.length }, () => {
    const file = keyFiles[0];
    const contents = fs.readFileSync(path.join(ROOT, file), 'utf8').trim();
    assert.equal(
      contents,
      file.replace(/\.txt$/, ''),
      `${file} must contain exactly "${file.replace(/\.txt$/, '')}" — anything else is a 403 from IndexNow`,
    );
  });

  test('INDEXNOW_KEY, when set locally, matches the committed file', { skip: !keyFiles.length || !process.env.INDEXNOW_KEY }, () => {
    assert.equal(process.env.INDEXNOW_KEY.trim(), keyFiles[0].replace(/\.txt$/, ''));
  });
});

/* ----------------------------------------------- vercel.json routing ------- */

describe('vercel.json does not shadow the key file', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

  /* Rewrites are applied AFTER the filesystem check, so the catch-all
   * `/:slug -> /api/page` cannot shadow a real file at the root — robots.txt has
   * proved that since day one. REDIRECTS run BEFORE it, though, and one matching
   * a root .txt would 30x the key file out of existence and silently disable
   * IndexNow. This asserts none does. */
  const sample = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.txt';

  const matches = (source, pathname) => {
    // vercel.json path syntax: ':param' is one segment, ':param*' is any number.
    const re = new RegExp(
      '^' +
        source
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/:[A-Za-z0-9_]+\*/g, '.*')
          .replace(/:[A-Za-z0-9_]+/g, '[^/]+') +
        '$',
    );
    return re.test(pathname);
  };

  test('no redirect matches a root .txt file', () => {
    const hit = (config.redirects || []).find((r) => matches(r.source, '/' + sample));
    assert.equal(hit, undefined, `redirect ${hit?.source} would shadow the IndexNow key file`);
  });

  test('robots.txt is likewise unshadowed (the control case)', () => {
    const hit = (config.redirects || []).find((r) => matches(r.source, '/robots.txt'));
    assert.equal(hit, undefined, 'robots.txt is served today, so this must hold');
  });

  test('no rewrite claims a root .txt other than the generated /llms.txt', () => {
    const claimed = (config.rewrites || [])
      .filter((r) => matches(r.source, '/' + sample))
      .map((r) => r.source);
    // The `/:slug` catch-all matches by pattern but loses to the filesystem, so
    // it is expected here; anything ELSE would be a deliberate .txt route.
    assert.deepEqual(claimed, ['/:slug']);
  });
});
