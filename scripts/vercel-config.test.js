/* vercel.json must be VALID, not just well-formed JSON.
 *
 * Vercel validates vercel.json against a STRICT schema and rejects any unknown
 * top-level property — including the "//comment" keys people habitually add to
 * JSON files that have no comment syntax. The deployment then fails at config
 * validation, BEFORE the build, so there are no build logs and the error is easy
 * to misread as something wrong with the code:
 *
 *     The `vercel.json` schema validation failed with the following message:
 *     should NOT have additional property `//redirects`
 *
 * This test caught that after it had already broken a production deploy.
 * Put explanatory notes in BLOG.md, not in vercel.json.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

/* The properties Vercel actually accepts at the top level. If you legitimately
 * need one that isn't here, add it — but confirm it against Vercel's schema
 * first, because an invented key fails the deploy rather than being ignored. */
const ALLOWED = new Set([
  '$schema',
  'buildCommand',
  'cleanUrls',
  'crons',
  'devCommand',
  'framework',
  'functions',
  'headers',
  'ignoreCommand',
  'images',
  'installCommand',
  'outputDirectory',
  'public',
  'redirects',
  'regions',
  'rewrites',
  'trailingSlash',
]);

describe('vercel.json', () => {
  test('has no properties Vercel will reject (e.g. "//comment" keys)', () => {
    const unknown = Object.keys(config).filter((k) => !ALLOWED.has(k));
    assert.deepEqual(
      unknown,
      [],
      `Vercel fails the deploy on unknown top-level keys. Offending: ${unknown.join(', ')}`,
    );
  });

  test('every redirect and rewrite has a source and a destination', () => {
    for (const rule of [...(config.redirects || []), ...(config.rewrites || [])]) {
      assert.ok(rule.source, `rule missing source: ${JSON.stringify(rule)}`);
      assert.ok(rule.destination, `rule missing destination: ${JSON.stringify(rule)}`);
    }
  });

  test('the /blog -> / redirects are GONE (they made the blog unreachable)', () => {
    const blogRedirect = (config.redirects || []).find((r) => r.source.startsWith('/blog'));
    assert.equal(blogRedirect, undefined, 'a /blog redirect would shadow the entire blog');
  });

  test('/blog, /blog/:slug and /sitemap.xml are rewritten to their handlers', () => {
    const sources = (config.rewrites || []).map((r) => r.source);
    assert.ok(sources.includes('/blog'));
    assert.ok(sources.includes('/blog/:slug'));
    assert.ok(sources.includes('/sitemap.xml'));
  });

  test('there is no sitemap.xml on disk to shadow the rewrite', () => {
    // Rewrites only fire when NO static file matches. A real sitemap.xml would be
    // served instead of the function, and blog posts would never reach Google.
    assert.equal(
      fs.existsSync(path.join(ROOT, 'sitemap.xml')),
      false,
      'delete it — build.js writes lib/sitemap-static.js instead',
    );
  });

  test('/seoteam/preview/:id is matched BEFORE the /seoteam/:path* catch-all', () => {
    const sources = (config.rewrites || []).map((r) => r.source);
    const preview = sources.indexOf('/seoteam/preview/:id');
    const catchAll = sources.indexOf('/seoteam/:path*');
    assert.ok(preview >= 0 && catchAll >= 0);
    assert.ok(preview < catchAll, 'first match wins — the catch-all would swallow preview');
  });

  test('there is no `build` script for Vercel to pick up', () => {
    // Adding one flips Vercel from "serve these static files" to "run a build and
    // resolve an output directory" — a deploy-behaviour change this site does not want.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.build, undefined);
  });
});
