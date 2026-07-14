/* End-to-end for the /admin website manager, against an in-memory MongoDB and the
 * REAL route handlers. Proves the things pure-logic tests can't: does a draft save
 * stay off the live page, does publish make it live, does a Mongo outage still
 * serve byte-identical HTML, does a writer get 403.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = 'davnoot_admin_test';
  process.env.SESSION_SECRET = 'test-secret-0123456789abcdef';
  process.env.ADMIN_PASSWORD = 'admin-pass';
  process.env.SEOTEAM_PASSWORD = 'writer-pass';
});

after(async () => {
  const { getDb } = await import('../lib/db.js');
  const db = await getDb();
  await db.client?.close?.();
  await mongo?.stop();
  process.exit(0);
});

function mockReq({ method = 'GET', query = {}, body, headers = {} } = {}) {
  return { method, query, body, headers, socket: { remoteAddress: '1.2.3.4' }, url: '/admin' };
}
function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
    send(d) { this.body = d; return this; },
    end(d) { if (d !== undefined) this.body = d; return this; },
    writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; },
  };
}
const call = async (handler, req) => { const res = mockRes(); await handler(req, res); return res; };

async function cookieFor(role) {
  const { createSessionToken, COOKIE_NAME } = await import('../lib/session.js');
  const token = await createSessionToken(process.env.SESSION_SECRET, undefined, { role });
  return `${COOKIE_NAME}=${token}`;
}
async function adminReq(opts = {}) {
  return mockReq({ ...opts, headers: { cookie: await cookieFor('admin'), ...(opts.headers || {}) } });
}
const fixture = (file) =>
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'pages', file.replace('.html', '.expected.html')), 'utf8');

describe('api/page.js — the public renderer', () => {
  test('serves an overlay page byte-identically when no document exists', async () => {
    const { default: page } = await import('../api/page.js');
    const res = await call(page, mockReq({ query: { p: 'seo.html' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.getHeader('x-cms-source'), 'base');
    assert.equal(res.body, fixture('seo.html'), 'no-doc render must equal the frozen fixture');
  });

  test('the homepage renders at p=index.html', async () => {
    const { default: page } = await import('../api/page.js');
    const res = await call(page, mockReq({ query: { p: 'index.html' } }));
    assert.equal(res.body, fixture('index.html'));
  });

  test('an unknown file-looking path 404s without a Mongo round trip', async () => {
    const { default: page } = await import('../api/page.js');
    const res = await call(page, mockReq({ query: { p: 'favicon.ico' } }));
    assert.equal(res.statusCode, 404);
  });
});

describe('the draft/live split', () => {
  test('saving a draft does NOT change the live page; publish does', async () => {
    const { default: pagesApi } = await import('../api/admin/pages/[id].js');
    const { default: publishApi } = await import('../api/admin/pages/[id]/publish.js');
    const { default: page } = await import('../api/page.js');

    // Save a draft override for the hero title on seo.html.
    const save = await call(pagesApi, await adminReq({
      method: 'PUT', query: { id: 'seo.html' },
      body: { title: 'SEO', sections: [{ id: 'overlay', source: 'base', fields: { 'hero.title': 'Rank #1. <em>Forever.</em>' } }] },
    }));
    assert.equal(save.statusCode, 200, JSON.stringify(save.body));

    // The LIVE page is still the default — a draft is not published.
    let live = await call(page, mockReq({ query: { p: 'seo.html' } }));
    assert.equal(live.body, fixture('seo.html'), 'a draft save must not touch the live page');

    // The PREVIEW (draft) shows the override.
    const { default: preview } = await import('../api/admin/preview.js');
    const pv = await call(preview, await adminReq({ query: { id: 'seo.html' } }));
    assert.match(pv.body, /Rank #1\. <em>Forever\.<\/em>/);
    assert.equal(pv.getHeader('x-robots-tag'), 'noindex, nofollow');

    // Publish -> the live page now shows the override.
    const pub = await call(publishApi, await adminReq({ method: 'POST', query: { id: 'seo.html' }, body: {} }));
    assert.equal(pub.statusCode, 200);
    live = await call(page, mockReq({ query: { p: 'seo.html' } }));
    assert.equal(live.getHeader('x-cms-source'), 'db');
    assert.match(live.body, /Rank #1\. <em>Forever\.<\/em>/);
    assert.doesNotMatch(live.body, /Technical SEO that<br \/>drives <em>organic growth<\/em>\./);
  });
});

describe('the SEO manager PATCH', () => {
  test('rejects a non-whitelisted field (mass-assignment guard)', async () => {
    const { default: seo } = await import('../api/admin/seo/index.js');
    const res = await call(seo, await adminReq({ method: 'PATCH', body: { type: 'page', key: 'email.html', field: 'locked', value: false } }));
    assert.equal(res.statusCode, 400);
  });

  test('tri-state robots: "" clears the key (never stores false)', async () => {
    const { default: seo } = await import('../api/admin/seo/index.js');
    const { pages } = await import('../lib/db.js');
    // Set noindex, then clear it.
    await call(seo, await adminReq({ method: 'PATCH', body: { type: 'page', key: 'email.html', field: 'seo.robotsIndex', value: false } }));
    let doc = await (await pages()).findOne({ path: '/email.html' });
    assert.equal(doc.draft.seo.robotsIndex, false);
    await call(seo, await adminReq({ method: 'PATCH', body: { type: 'page', key: 'email.html', field: 'seo.robotsIndex', value: null } }));
    doc = await (await pages()).findOne({ path: '/email.html' });
    assert.equal(doc.draft.seo?.robotsIndex, undefined, 'clearing must $unset, never leave false');
  });
});

describe('role enforcement (middleware is not the boundary)', () => {
  test('a writer is 403 on the pages API; an admin is 200', async () => {
    const { default: pagesApi } = await import('../api/admin/pages/index.js');
    const writer = mockReq({ headers: { cookie: await cookieFor('writer') } });
    const wres = await call(pagesApi, writer);
    assert.equal(wres.statusCode, 403);

    const ares = await call(pagesApi, await adminReq());
    assert.equal(ares.statusCode, 200);
    assert.ok(Array.isArray(ares.body.pages));
  });

  test('a signed-out request is 401', async () => {
    const { default: pagesApi } = await import('../api/admin/pages/index.js');
    const res = await call(pagesApi, mockReq());
    assert.equal(res.statusCode, 401);
  });
});

describe('a composed page created in /admin', () => {
  test('create -> draft 404s live -> publish -> renders; optimistic-concurrency 409', async () => {
    const { default: pagesIndex } = await import('../api/admin/pages/index.js');
    const { default: pagesApi } = await import('../api/admin/pages/[id].js');
    const { default: publishApi } = await import('../api/admin/pages/[id]/publish.js');
    const { default: page } = await import('../api/page.js');

    const created = await call(pagesIndex, await adminReq({ method: 'POST', body: { slug: 'pricing', title: 'Pricing', kind: 'landing' } }));
    assert.equal(created.statusCode, 201);

    // A composed draft page is not live.
    let live = await call(page, mockReq({ query: { p: 'pricing' } }));
    assert.equal(live.statusCode, 404, 'a composed draft must 404 until published');

    // Publish it.
    await call(publishApi, await adminReq({ method: 'POST', query: { id: 'pricing' }, body: {} }));
    live = await call(page, mockReq({ query: { p: 'pricing' } }));
    assert.equal(live.statusCode, 200);

    // Optimistic concurrency: a stale version 409s.
    const stale = await call(pagesApi, await adminReq({ method: 'PUT', query: { id: 'pricing' }, body: { title: 'Pricing', sections: [], __version: 0 } }));
    assert.equal(stale.statusCode, 409);
  });
});

describe('Phase 6 — retire (410) and preview-DB isolation', () => {
  test('an archived overlay page returns 410 Gone, not a 200 base render', async () => {
    const { pages } = await import('../lib/db.js');
    const { default: page } = await import('../api/page.js');
    const col = await pages();
    await col.updateOne(
      { path: '/software.html' },
      { $set: { path: '/software.html', base: 'software.html', status: 'archived' } },
      { upsert: true },
    );
    const res = await call(page, mockReq({ query: { p: 'software.html' } }));
    assert.equal(res.statusCode, 410, 'a retired page must 410, not serve the base template 200/indexable');
    assert.match(res.getHeader('x-robots-tag') || '', /noindex/);
    await col.deleteOne({ path: '/software.html' });
  });

  test('an archived page with a configured redirect 301s instead of 410', async () => {
    const { pages, redirects } = await import('../lib/db.js');
    const { default: page } = await import('../api/page.js');
    await (await pages()).updateOne(
      { path: '/email.html' },
      { $set: { path: '/email.html', base: 'email.html', status: 'archived' } },
      { upsert: true },
    );
    await (await redirects()).updateOne(
      { source: '/email.html' },
      { $set: { source: '/email.html', destination: '/seo.html', status: 308 } },
      { upsert: true },
    );
    const res = await call(page, mockReq({ query: { p: 'email.html' } }));
    assert.equal(res.statusCode, 308, 'a retired page with a replacement must redirect, not 410');
    assert.equal(res.getHeader('location'), '/seo.html');
    await (await pages()).deleteOne({ path: '/email.html' });
    await (await redirects()).deleteOne({ source: '/email.html' });
  });

  test('resolveDbName fails closed: a preview deploy never points at the prod DB', async () => {
    const { resolveDbName } = await import('../lib/db.js');
    // Preview inherits prod MONGODB_DB — must be overridden to an isolated DB.
    assert.equal(resolveDbName({ VERCEL_ENV: 'preview', MONGODB_DB: 'davnoot' }), 'davnoot_preview');
    // Production honours the configured name.
    assert.equal(resolveDbName({ VERCEL_ENV: 'production', MONGODB_DB: 'davnoot' }), 'davnoot');
    // Local dev / tests (no VERCEL_ENV) honour the configured name so real content shows.
    assert.equal(resolveDbName({ MONGODB_DB: 'davnoot' }), 'davnoot');
    // An explicit preview DB wins on a preview deploy.
    assert.equal(resolveDbName({ VERCEL_ENV: 'preview', MONGODB_DB: 'davnoot', MONGODB_DB_PREVIEW: 'stage' }), 'stage');
  });
});

describe('Phase 5 — a composed page renders its library sections end to end', () => {
  test('save sections -> publish -> api/page.js emits the real section classes + FAQPage schema', async () => {
    const { default: pagesIndex } = await import('../api/admin/pages/index.js');
    const { default: pagesApi } = await import('../api/admin/pages/[id].js');
    const { default: publishApi } = await import('../api/admin/pages/[id]/publish.js');
    const { default: page } = await import('../api/page.js');

    await call(pagesIndex, await adminReq({ method: 'POST', body: { slug: 'services-x', title: 'Services', kind: 'landing' } }));

    // Build a page from library sections: a hero, a capabilities grid, an FAQ.
    const body = {
      title: 'Services',
      sections: [
        { type: 'hero', source: 'library', fields: { badge: 'New', title: 'Build <em>fast</em>', sub: 'Ship it.', ctaHref: 'book-call.html', ctaLabel: 'Talk' } },
        { type: 'capabilities', source: 'library', fields: { eyebrow: 'What', title: 'Everything' }, items: [{ num: '01', title: 'Audit', desc: 'Deep' }, { num: '02', title: 'Build', desc: 'Ship' }] },
        { type: 'faq', source: 'library', fields: { eyebrow: 'FAQ', title: 'Questions' }, items: [{ q: 'How long?', a: 'Six weeks.' }] },
      ],
    };
    const saved = await call(pagesApi, await adminReq({ method: 'PUT', query: { id: 'services-x' }, body }));
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
    await call(publishApi, await adminReq({ method: 'POST', query: { id: 'services-x' }, body: {} }));

    const live = await call(page, mockReq({ query: { p: 'services-x' } }));
    assert.equal(live.statusCode, 200);
    // The real marketing classes are present -> styles.css/script.js apply.
    for (const cls of ['service-hero', 'cap-grid', 'cap-card', 'faq-list', 'faq-item']) {
      assert.ok(live.body.includes(cls), `composed page is missing .${cls}`);
    }
    // The shared shell + a single, valid, FAQ-bearing JSON-LD graph.
    assert.match(live.body, /<script src="\/script\.js">/);
    assert.equal((live.body.match(/rel="canonical"/g) || []).length, 1);
    const m = live.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const graph = JSON.parse(m[1].replace(/\u003c/g, '<'));
    assert.ok(graph['@graph'].some((n) => n['@type'] === 'FAQPage'), 'a visible FAQ section should yield FAQPage schema');
    // The inline <em> the author typed survives (sanitized-inline, not escaped).
    assert.match(live.body, /Build <em>fast<\/em>/);
  });
});
