/* Dependencies must load under VERCEL's constraints, not just this laptop's.
 *
 * ===========================================================================
 * THE BUG THIS EXISTS TO PREVENT
 * ===========================================================================
 * `sanitize-html` is CommonJS and does `require('htmlparser2')`. From
 * htmlparser2 v9 onwards that package is ESM-only ("type": "module"), so the
 * require() is illegal:
 *
 *     Error [ERR_REQUIRE_ESM]: require() of ES Module
 *     .../htmlparser2/dist/index.js from .../sanitize-html/index.js
 *
 * Modern Node (22.12+) permits require(esm), so this works fine locally and
 * every test passes. Vercel's serverless loader does NOT permit it — so the
 * function crashes on the FIRST REQUEST IN PRODUCTION with a 500, and only in
 * production. It took down /blog and the whole dashboard once already.
 *
 * The version range `^2.13.1` was what allowed npm to float sanitize-html up to
 * 2.17.6, which pulls htmlparser2 v12. sanitize-html is therefore PINNED, and an
 * `overrides` entry holds htmlparser2 on the last CommonJS line.
 *
 * The test below reproduces Vercel's constraint honestly, by disabling Node's
 * require(esm) support — rather than asserting a version number, which would
 * pass while telling us nothing about whether the thing actually loads.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Every runtime dependency — these get bundled into the serverless functions. */
const RUNTIME_DEPS = Object.keys(pkg.dependencies || {}).filter((d) => d !== '@vercel/edge');

describe('runtime deps load the way Vercel loads them', () => {
  for (const dep of RUNTIME_DEPS) {
    test(`${dep} is require()-able with require(esm) DISABLED`, () => {
      // --no-experimental-require-module makes Node behave like Vercel's function
      // loader: a CJS package that require()s an ESM-only dependency will throw
      // ERR_REQUIRE_ESM here, exactly as it does in production.
      assert.doesNotThrow(() => {
        execFileSync(
          process.execPath,
          ['--no-experimental-require-module', '--input-type=commonjs', '-e', `require(${JSON.stringify(dep)})`],
          { cwd: ROOT, stdio: 'pipe' },
        );
      }, `${dep} fails to load under Vercel's loader — it will 500 on the first production request`);
    });
  }
});

describe('the sanitize-html / htmlparser2 pin holds', () => {
  test('sanitize-html is pinned exactly (no ^ range)', () => {
    assert.equal(
      /^\d+\.\d+\.\d+$/.test(pkg.dependencies['sanitize-html']),
      true,
      'a caret range lets npm float into a version that requires ESM-only htmlparser2',
    );
  });

  test('htmlparser2 resolves to a CommonJS build', () => {
    const hp = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'node_modules', 'htmlparser2', 'package.json'), 'utf8'),
    );
    assert.notEqual(
      hp.type,
      'module',
      `htmlparser2@${hp.version} is ESM-only; sanitize-html require()s it and will crash on Vercel`,
    );
  });

  test('the sanitizer still actually works after the downgrade', async () => {
    const { sanitizeBody } = await import('../lib/sanitize.js');
    assert.equal(sanitizeBody('<p>ok</p><script>bad()</script>').includes('script'), false);
    assert.ok(sanitizeBody('<iframe src="https://youtube.com/embed/a"></iframe>').includes('<iframe'));
  });
});
