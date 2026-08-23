/* Every serverless route must IMPORT cleanly.
 *
 * A bad relative path (../../lib vs ../../../lib) or a typo'd export is invisible
 * until the route is first hit in production, where it surfaces as an opaque 500.
 * This walks every file under api/ and imports it. Module-level code runs, so this
 * also proves nothing tries to open a database connection at import time — which
 * would break cold starts and, worse, hang the function.
 *
 * No MONGODB_URI is set here on purpose: lib/db.js must connect LAZILY.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeSrcHash, bannerFor, bundledLibFiles } from './src-hash.js';

const ROOT = path.join(import.meta.dirname, '..');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('serverless routes import cleanly', () => {
  const routes = walk(path.join(ROOT, 'api'));

  test('there are routes to check', () => {
    assert.ok(routes.length >= 8, `expected the api/ routes, found ${routes.length}`);
  });

  for (const file of routes) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');

    test(rel, async () => {
      const mod = await import(pathToFileURL(file).href);
      assert.equal(
        typeof mod.default,
        'function',
        `${rel} must default-export a handler — Vercel will 500 without one`,
      );
    });
  }
});

describe('the Edge bundle stays Edge-safe', () => {
  // middleware.js runs on the Edge runtime, which has NO Node built-ins. If it (or
  // anything it imports) reaches for node:crypto or the mongodb driver, the Edge
  // bundle fails to build at DEPLOY time and takes the site's middleware with it.
  const EDGE_FILES = ['middleware.js', 'lib/session.js', 'lib/cookies.js'];
  const FORBIDDEN = [/from\s+['"]node:/, /require\(['"]node:/, /from\s+['"]mongodb['"]/, /from\s+['"]crypto['"]/];

  /* Strip comments before scanning. These files DOCUMENT the very imports they
   * must not contain ("never write `import crypto from 'node:crypto'` here"), so
   * a naive scan flags the warning label rather than the hazard. */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

  for (const rel of EDGE_FILES) {
    test(`${rel} imports no Node built-ins`, () => {
      const code = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      for (const pattern of FORBIDDEN) {
        assert.equal(pattern.test(code), false, `${rel} matches ${pattern} — this breaks the Edge bundle`);
      }
    });
  }

  test('the comment-stripper actually works (or the guard above is vacuous)', () => {
    assert.match(stripComments(`import x from 'node:fs';`), /node:fs/, 'real code must survive');
    assert.doesNotMatch(stripComments(`/* import x from 'node:fs' */`), /node:fs/, 'comments must be removed');
  });

  test('session.js signs with Web Crypto, not node:crypto', async () => {
    const { createSessionToken, verifySessionToken } = await import('../lib/session.js');
    const token = await createSessionToken('secret');
    assert.ok(await verifySessionToken('secret', token));
  });
});

describe('the signed-out login page has no gated dependencies', () => {
  const middleware = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
  const loginHtml = fs.readFileSync(path.join(ROOT, 'seoteam', 'login.html'), 'utf8');

  // Everything under /seoteam/ is behind the auth gate — INCLUDING static assets.
  // So any asset the LOGIN page references must be explicitly whitelisted, or a
  // signed-out visitor is redirected to login for the asset too and the form
  // renders unstyled/broken. (Found by curling the real server, not by a unit test.)
  const referenced = [...loginHtml.matchAll(/(?:href|src)="(\/seoteam\/[^"]+)"/g)].map((m) => m[1]);

  test('login.html references at least one /seoteam asset (or this guard is vacuous)', () => {
    assert.ok(referenced.length > 0);
  });

  for (const asset of referenced) {
    test(`${asset} is whitelisted past the auth gate`, () => {
      assert.ok(
        middleware.includes(`'${asset}'`),
        `${asset} is loaded by the signed-out login page but is not in PUBLIC_PATHS`,
      );
    });
  }

  test('login.html does NOT load the gated dashboard bundle', () => {
    // Strip HTML comments first — login.html DOCUMENTS why it doesn't load app.js
    // ("app.js is behind the auth gate, so this script is inlined"), and a naive
    // scan flags that explanation as the violation it warns about.
    const markup = loginHtml.replace(/<!--[\s\S]*?-->/g, '');
    assert.equal(
      /(?:src|href)="[^"]*\/seoteam\/app\.js"/.test(markup),
      false,
      'the login script is inlined precisely so it has no gated dependencies',
    );
  });
});

describe('the committed SPA bundles are current (did you run `npm run bundle`?)', () => {
  // The repo's worst silent failure: edit src/, forget to rebundle, and the dashboard
  // ships stale — no build error, because there is no build step. bundle.js stamps a
  // /*srchash:…*/ banner over src/**/*.js AND every lib/ module those files import
  // (esbuild inlines them); we recompute it and demand a match.
  const BUNDLES = ['seoteam/app.js', 'admin/app.js'];

  for (const rel of BUNDLES) {
    test(`${rel} carries the current srchash banner`, () => {
      const bundle = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const m = bundle.match(/\/\*srchash:([0-9a-f]{64})\*\//);
      assert.ok(m, `${rel} has no /*srchash:…*/ banner — run \`npm run bundle\` and commit it`);
      assert.equal(
        bundle.slice(0, 200).includes(bannerFor(computeSrcHash())),
        true,
        `${rel} is STALE — src/ changed since the last \`npm run bundle\`. Rebundle and commit.`,
      );
    });
  }

  /* THE HOLE THE BANNER ALONE DOES NOT CLOSE.
   *
   * esbuild follows imports wherever they lead, so a src/ file importing from
   * lib/ gets that module INLINED into the committed bundle. If the hash covered
   * only src/, editing such a lib/ module would leave every staleness check green
   * while the deployed dashboard ran the old copy — the exact silent failure the
   * banner exists to catch, entering through a side door. computeSrcHash() now
   * walks those imports; these tests make sure it keeps doing so. */
  test('the freshness hash follows src/ imports into lib/', () => {
    const covered = bundledLibFiles().map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));

    const imported = new Set();
    for (const file of walk(path.join(ROOT, 'src'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const m of source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
        const rel = path.relative(ROOT, path.resolve(path.dirname(file), m[1])).replace(/\\/g, '/');
        if (rel.startsWith('lib/')) imported.add(rel);
      }
    }

    assert.ok(imported.size > 0, 'expected src/ to share at least one module with lib/');
    for (const dep of imported) {
      assert.ok(covered.includes(dep), `${dep} is inlined into a bundle but not covered by the freshness hash`);
    }
  });

  test('editing a bundled lib/ module changes the hash', () => {
    // The property that actually matters, asserted directly rather than inferred
    // from the file list: perturb a covered file, and the hash must move.
    const target = bundledLibFiles()[0];
    assert.ok(target, 'no bundled lib/ module to test with');
    const before = computeSrcHash();
    const original = fs.readFileSync(target);
    try {
      fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\n// srchash probe\n')]));
      assert.notEqual(computeSrcHash(), before, 'a change to an inlined lib/ module went unnoticed');
    } finally {
      fs.writeFileSync(target, original);
    }
    assert.equal(computeSrcHash(), before, 'the probe did not restore the file');
  });
});

describe('dev.js gates from the middleware matcher, not a hardcoded regex', () => {
  // scripts/dev.js used to hardcode /^\/(seoteam|api\/seoteam)(\/|$)/, so adding a
  // gated route (e.g. /admin) to middleware.js left it wide open in dev — a dev/prod
  // auth divergence nobody notices because everything "works" locally. It must read
  // config.matcher from middleware.js.
  const dev = fs.readFileSync(path.join(ROOT, 'scripts', 'dev.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

  test('dev.js loads the matcher from middleware.js', () => {
    assert.match(dev, /matcher/, 'dev.js must read the middleware matcher');
    assert.match(dev, /middleware\.js/, 'dev.js must import middleware.js to read its matcher');
  });

  test('dev.js contains no hardcoded seoteam gate regex', () => {
    assert.doesNotMatch(dev, /\/\^\\\/\(seoteam/, 'dev.js still hardcodes a gate regex — read config.matcher instead');
    assert.doesNotMatch(dev, /seoteam\|api\\?\/seoteam/, 'dev.js still hardcodes the seoteam gate — read config.matcher instead');
  });
});
