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
import crypto from 'node:crypto';

import { COMPILED_PAGES } from '../lib/compiled-pages.gen.js';
import { renderPage } from '../lib/page-render.js';

const ROOT = path.join(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const sha256 = (s) => 'sha256-' + crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const csp = () => (config.headers || []).flatMap((h) => h.headers).find((kv) => kv.key === 'Content-Security-Policy')?.value || '';

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

  test('the /:slug catch-all rewrite is LAST (nothing shadows it)', () => {
    const sources = (config.rewrites || []).map((r) => r.source);
    assert.equal(sources[sources.length - 1], '/:slug', 'the composed-page catch-all must be the final rewrite');
  });

  test('every marketing page is served at its CLEAN URL and its .html 301s to it', () => {
    // Public URLs are extensionless. For each root marketing page <name>.html:
    //   redirect  /<name>.html -> /<name>   (301 — the one canonical URL)
    //   rewrite   /<name>      -> /<name>.html   (serve the static file cleanly)
    // The home page is the special case: /index.html -> / (and / serves the root
    // index.html statically, so it needs no rewrite). A .html link left un-redirected
    // would give Google two URLs for one page; a clean path with no rewrite would 404.
    const redirect = (src) => (config.redirects || []).find((r) => r.source === src);
    const rewrite = (src) => (config.rewrites || []).find((r) => r.source === src);

    const isVerification = (f) => /^google[0-9a-f]+\.html$/i.test(f);
    const rootHtml = fs
      .readdirSync(ROOT)
      .filter((f) => f.endsWith('.html') && !isVerification(f));

    for (const file of rootHtml) {
      const name = file.replace(/\.html$/, '');
      if (file === 'index.html') {
        const rd = redirect('/index.html');
        assert.ok(rd && rd.destination === '/' && rd.permanent, '/index.html must 301 to /');
        continue;
      }
      const rd = redirect(`/${file}`);
      assert.ok(rd && rd.destination === `/${name}` && rd.permanent, `/${file} must 301 to /${name}`);
      const rw = rewrite(`/${name}`);
      assert.ok(rw && rw.destination === `/${file}`, `/${name} must rewrite to /${file} (serve the static page cleanly)`);
    }

    // Inverse guard: no leftover /<name>.html REWRITE (those became redirects). A
    // stray one would fire post-cutover and mask the redirect.
    const htmlRewrite = (config.rewrites || []).find((r) => /^\/[a-z0-9-]+\.html$/.test(r.source));
    assert.equal(htmlRewrite, undefined, `stale .html rewrite source: ${htmlRewrite?.source}`);

    // Every compiled (pages/) page must have a matching root file above, so it is
    // reachable — the compiler and the router agree on the page set.
    const pagesDir = fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html'));
    for (const file of pagesDir) {
      assert.ok(rootHtml.includes(file), `pages/${file} has no root ${file} to serve at its clean URL`);
    }
  });

  test('a dynamic file+directory collision has an explicit index rewrite', () => {
    // Shipped as a 404 once. api/admin/pages/ holds BOTH `[id].js` AND an `[id]/`
    // directory (publish.js, revisions.js). Vercel builds every lambda correctly,
    // but that collision makes it drop the IMPLICIT `/api/admin/pages` ->
    // `.../pages/index` route, so listing pages 404s in production while
    // /api/admin/seo (index.js alone) and /api/seoteam/posts ([id].js, no [id]/ dir)
    // both work. scripts/dev.js routes by its own rules and never reproduces it, so
    // the whole suite passed green. The fix is an explicit rewrite naming the index
    // lambda — the same shape as /blog -> /api/blog/index.
    const sources = new Set((config.rewrites || []).map((r) => r.source));
    const apiRoot = path.join(ROOT, 'api');

    const collisions = [];
    (function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
      const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));

      // A dynamic segment present as BOTH `[x].js` and `[x]/`, in a directory that
      // also has an index.js to reach — that index route is the one Vercel drops.
      const collides = [...dirs].some((d) => files.has(`${d}.js`));
      if (collides && files.has('index.js')) {
        collisions.push('/' + path.relative(ROOT, dir).replace(/\\/g, '/'));
      }
      for (const d of dirs) walk(path.join(dir, d));
    })(apiRoot);

    for (const route of collisions) {
      assert.ok(
        sources.has(route),
        `${route} has a [param].js file AND a [param]/ dir, so Vercel will NOT route ${route} to its index ` +
          `lambda — production 404s. Add: { "source": "${route}", "destination": "${route}/index" }`,
      );
    }
  });

  test('.vercelignore hides source dirs but never lib/', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8');
    for (const dir of ['pages/', 'src/', 'scripts/']) {
      assert.match(ignore, new RegExp(`^${dir.replace('/', '\\/')}`, 'm'), `.vercelignore must contain ${dir}`);
    }
    assert.doesNotMatch(ignore, /^lib\//m, 'lib/ in .vercelignore breaks @vercel/nft tracing -> MODULE_NOT_FOUND on every function');
  });

  test('every config.headers entry is well-formed (a malformed one fails the deploy with no logs)', () => {
    // vercel.json's schema rejects a bad headers entry at config validation — the same
    // silent, log-less failure class the unknown-key test above guards. Validate shape.
    for (const h of config.headers || []) {
      assert.equal(typeof h.source, 'string', `headers entry missing string source: ${JSON.stringify(h)}`);
      assert.ok(Array.isArray(h.headers), `headers entry missing headers array: ${JSON.stringify(h)}`);
      for (const kv of h.headers) {
        assert.equal(typeof kv.key, 'string', `header missing key: ${JSON.stringify(kv)}`);
        assert.equal(typeof kv.value, 'string', `header missing value: ${JSON.stringify(kv)}`);
      }
    }
  });
});

describe('the CSP allowlists exactly the two inline scripts on the site', () => {
  // The whole site has ONLY two inline executable scripts: the login form wiring and
  // the preview click-to-edit hook. script-src has NO 'unsafe-inline', so each must be
  // allowlisted by its sha256 — and if either script is edited, its hash changes and
  // the login page / preview silently breaks under CSP. These tests recompute the
  // hashes from the ACTUAL source, so an edit fails `npm test` instead of production.

  test('security headers are present', () => {
    const set = new Map((config.headers || []).flatMap((h) => h.headers).map((kv) => [kv.key, kv.value]));
    assert.ok(set.has('Content-Security-Policy'), 'no CSP header');
    assert.equal(set.get('X-Content-Type-Options'), 'nosniff');
    assert.match(set.get('Referrer-Policy') || '', /strict-origin/);
  });

  test('CSP contains the login inline-script hash', () => {
    const login = fs.readFileSync(path.join(ROOT, 'seoteam', 'login.html'), 'utf8');
    const m = login.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(m, 'login.html has no inline script');
    assert.ok(csp().includes(sha256(m[1])), 'CSP is missing the current login-script hash — recompute and update vercel.json');
  });

  test('CSP contains the preview-hook inline-script hash', () => {
    // Render a page in preview mode and extract the exact hook script renderPage emits.
    const html = renderPage(COMPILED_PAGES['seo.html'], null, { preview: true });
    const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    assert.ok(m, 'no preview hook was injected before </body>');
    assert.ok(csp().includes(sha256(m[1])), 'CSP is missing the current preview-hook hash — recompute and update vercel.json');
  });

  test("frame-ancestors is 'self' (allows the admin preview iframe, blocks external clickjacking)", () => {
    assert.match(csp(), /frame-ancestors 'self'/, "must be 'self' — 'none' would blank the /admin preview iframe");
  });

  test("script-src has no 'unsafe-inline' (the hashes are the whole point)", () => {
    const scriptSrc = csp().match(/script-src[^;]*/)?.[0] || '';
    assert.doesNotMatch(scriptSrc, /'unsafe-inline'/, "script-src 'unsafe-inline' defeats the CSP — allowlist by hash instead");
  });
});

describe('admin routes are role-gated (middleware is NOT the boundary)', () => {
  // The Edge middleware is documented as a convenience, not the security boundary.
  // Every /api/admin/* handler must call requireRole( itself — a lone requireSession(
  // would let any signed-in `writer` (the shared SEOTEAM_PASSWORD) into admin CRUD.
  function walk(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(full));
      else if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
  }
  const adminDir = path.join(ROOT, 'api', 'admin');
  const files = fs.existsSync(adminDir) ? walk(adminDir) : [];

  test('there are admin routes to check', () => {
    assert.ok(files.length >= 8, `expected the api/admin routes, found ${files.length}`);
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    test(`${rel} enforces a ROLE and never leans on a bare requireSession(`, () => {
      const src = fs.readFileSync(file, 'utf8');
      // Strip comments so a doc-comment mentioning requireSession isn't a false hit.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

      // Two acceptable role gates:
      //  (a) requireRole(req,res,'admin',...) — the standard JSON API guard.
      //  (b) getSession(...) + an EXPLICIT role check — used by api/admin/preview.js,
      //      an HTML iframe route that must 302-redirect a signed-out user (a JSON 401
      //      is an unreadable blank frame). It checks ADMIN_ROLES.has(session.role).
      const hasRequireRole = /requireRole\s*\(/.test(code);
      const hasExplicitRoleGate = /getSession\s*\(/.test(code) && /session\.role/.test(code);
      assert.ok(
        hasRequireRole || hasExplicitRoleGate,
        `${rel} must gate on requireRole( (or getSession + an explicit session.role check for HTML routes)`,
      );

      // The escalation bug: requireSession( as the ONLY guard. requireSession proves
      // signed-in but NOT the role, so a writer (shared SEOTEAM_PASSWORD) would get in.
      const bareRequireSession = /requireSession\s*\(/.test(code) && !hasRequireRole && !hasExplicitRoleGate;
      assert.equal(bareRequireSession, false, `${rel} authorizes with a bare requireSession( — a writer would get in`);
    });
  }
});
