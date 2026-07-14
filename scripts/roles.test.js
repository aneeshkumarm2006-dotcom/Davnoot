/* Roles + session claims.
 *
 *   node --test scripts/
 *
 * The /admin surface can rewrite the whole marketing site, so the role boundary is
 * load-bearing. Every case here is "a writer must not become an admin, and a legacy
 * cookie must fail closed."
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionToken, verifySessionToken } from '../lib/session.js';
import { requireRole } from '../lib/auth.js';

const SECRET = 'test-secret-please-do-not-use-in-production';

/** Minimal req/res doubles matching what the handlers use. */
function fakeReqRes(cookie) {
  const req = { headers: cookie ? { cookie } : {} };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

async function cookieFor(claims) {
  const token = await createSessionToken(SECRET, undefined, claims);
  return `davnoot_seoteam=${encodeURIComponent(token)}`;
}

describe('session carries a role claim without breaking the format', () => {
  test('a role round-trips through sign + verify', async () => {
    const token = await createSessionToken(SECRET, undefined, { role: 'admin', v: 1 });
    const payload = await verifySessionToken(SECRET, token);
    assert.equal(payload.role, 'admin');
    assert.equal(payload.v, 1);
    assert.equal(typeof payload.exp, 'number');
  });

  test('a legacy {exp}-only token still verifies, with no role', async () => {
    const token = await createSessionToken(SECRET); // no claims — the old signature
    const payload = await verifySessionToken(SECRET, token);
    assert.ok(payload, 'a cookie minted before roles existed must keep working');
    assert.equal(payload.role, undefined);
  });

  test('ttlMs is still the SECOND positional arg (invariants.test.js depends on it)', async () => {
    const expired = await createSessionToken(SECRET, -1000, { role: 'admin' });
    assert.equal(await verifySessionToken(SECRET, expired), null);
  });

  test('a client cannot forge a role onto an existing signature', async () => {
    const token = await createSessionToken(SECRET, undefined, { role: 'writer' });
    const [, sig] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ exp: Date.now() + 1e9, role: 'admin' })).toString('base64url');
    assert.equal(await verifySessionToken(SECRET, `${forgedBody}.${sig}`), null);
  });
});

describe('requireRole fails closed', () => {
  test('an admin cookie passes an admin-only guard', async () => {
    const { req, res } = fakeReqRes(await cookieFor({ role: 'admin' }));
    process.env.SESSION_SECRET = SECRET;
    const session = await requireRole(req, res, 'admin');
    assert.ok(session);
    assert.equal(session.role, 'admin');
    assert.equal(res.statusCode, 200);
  });

  test('an editor cookie is refused an admin-only guard', async () => {
    const { req, res } = fakeReqRes(await cookieFor({ role: 'editor' }));
    process.env.SESSION_SECRET = SECRET;
    assert.equal(await requireRole(req, res, 'admin'), null);
    assert.equal(res.statusCode, 403);
  });

  test('a writer cookie is refused every admin route', async () => {
    const { req, res } = fakeReqRes(await cookieFor({ role: 'writer' }));
    process.env.SESSION_SECRET = SECRET;
    assert.equal(await requireRole(req, res, 'admin', 'editor'), null);
    assert.equal(res.statusCode, 403);
  });

  test('a legacy cookie with NO role is treated as the lowest privilege (403 on admin)', async () => {
    const { req, res } = fakeReqRes(await cookieFor({})); // {exp} only
    process.env.SESSION_SECRET = SECRET;
    assert.equal(await requireRole(req, res, 'admin', 'editor'), null);
    assert.equal(res.statusCode, 403, 'undefined role must NOT be promoted to admin');
  });

  test('a signed-out request gets 401, not 403', async () => {
    const { req, res } = fakeReqRes(null);
    process.env.SESSION_SECRET = SECRET;
    assert.equal(await requireRole(req, res, 'admin'), null);
    assert.equal(res.statusCode, 401);
  });
});
