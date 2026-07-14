/* The invariants, as executable tests.
 *
 *   node --test scripts/
 *
 * Every case here is a bug that has ALREADY happened once. They are pure-logic
 * tests (no database) because that is precisely where the invariants live: the
 * validator, the $set/$unset split, the sanitizer, the publish-date rules, and
 * the session signer.
 *
 * If you are about to "simplify" one of these modules, run this first, and then
 * again after. A green diff here is the difference between a tidy refactor and
 * de-indexing the entire blog.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createPostSchema, updatePostSchema, fieldErrors } from '../lib/validators.js';
import { buildPostUpdate, buildPostInsert, resolvePublishedAt } from '../lib/post-write.js';
import { sanitizeBody } from '../lib/sanitize.js';
import { createSessionToken, verifySessionToken, passwordMatches } from '../lib/session.js';
import { scorePost } from '../lib/seo-score.js';
import { readingTimeMinutes } from '../lib/html-text.js';

const base = { title: 'A post', content: '<p>Hello world</p>' };

/* ========================================================================== */
describe('Invariant 1 — robotsIndex/robotsFollow are TRI-STATE', () => {
  test('a blank form value does NOT become false (which would mean noindex)', () => {
    const parsed = createPostSchema.parse({ ...base, seo: { robotsIndex: '', robotsFollow: '' } });
    assert.equal(parsed.seo.robotsIndex, undefined, 'blank robotsIndex must be undefined, not false');
    assert.equal(parsed.seo.robotsFollow, undefined, 'blank robotsFollow must be undefined, not false');
  });

  test('an absent robots field stays absent — no default is applied anywhere', () => {
    const parsed = createPostSchema.parse({ ...base, seo: { metaTitle: 'x' } });
    assert.equal(parsed.seo.robotsIndex, undefined);
    assert.equal('robotsIndex' in buildPostInsert(parsed).seo, false, 'must not be persisted at all');
  });

  test('an explicit false SURVIVES (a deliberate noindex must still work)', () => {
    const parsed = createPostSchema.parse({ ...base, seo: { robotsIndex: false } });
    assert.equal(parsed.seo.robotsIndex, false);
    assert.equal(buildPostInsert(parsed).seo.robotsIndex, false);
  });

  test('clearing robots in the edit form REMOVES the key rather than storing false', () => {
    const parsed = updatePostSchema.parse({ ...base, seo: { robotsIndex: null } });
    const ops = buildPostUpdate(parsed, { ...base, seo: { robotsIndex: null } }, { existing: {} });
    // seo has no defined keys left -> the whole block is unset. Either way, what
    // must NOT happen is robotsIndex landing in $set as `false`.
    assert.notEqual(ops.$set.seo?.robotsIndex, false);
  });
});

/* ========================================================================== */
describe('Empty string -> undefined, before coercion', () => {
  test('a blank optional URL does not fail validation', () => {
    const parsed = createPostSchema.parse({ ...base, coverImage: '', seo: { canonicalUrl: '' } });
    assert.equal(parsed.coverImage, undefined);
    assert.equal(parsed.seo.canonicalUrl, undefined);
  });

  test('a genuinely malformed URL still errors', () => {
    const r = createPostSchema.safeParse({ ...base, coverImage: 'not-a-url' });
    assert.equal(r.success, false);
    assert.match(fieldErrors(r.error).coverImage, /full URL/);
  });
});

/* ========================================================================== */
describe('Caps are guardrails, not style advice', () => {
  test('a 90-char meta title SAVES (the 60-char ideal is a warning, not an error)', () => {
    const metaTitle = 'x'.repeat(90);
    const r = createPostSchema.safeParse({ ...base, seo: { metaTitle } });
    assert.equal(r.success, true, 'a long-but-deliberate title must remain saveable');
  });

  test('the editor still WARNS about it — same pure scorer the table badge uses', () => {
    const { checks } = scorePost({ ...base, seo: { metaTitle: 'x'.repeat(90) } });
    const c = checks.find((c) => c.id === 'meta-title');
    assert.equal(c.status, 'warn');
  });

  test('an absurd 500-char meta title is rejected — that IS data corruption', () => {
    const r = createPostSchema.safeParse({ ...base, seo: { metaTitle: 'x'.repeat(500) } });
    assert.equal(r.success, false);
  });
});

/* ========================================================================== */
describe('Keyword-backlink rows: blank dropped, partial errors', () => {
  test('the editor trailing empty row is dropped silently', () => {
    const parsed = createPostSchema.parse({
      ...base,
      keywords: [
        { keyword: 'seo agency', url: 'https://www.davnoot.com/seo.html', rel: 'dofollow' },
        { keyword: '', url: '', rel: 'dofollow' }, // the always-present trailing row
      ],
    });
    assert.equal(parsed.keywords.length, 1);
  });

  test('a HALF-filled row errors rather than vanishing', () => {
    const r = createPostSchema.safeParse({
      ...base,
      keywords: [{ keyword: 'seo agency', url: '', rel: 'dofollow' }],
    });
    assert.equal(r.success, false, 'a half-typed link must not be silently discarded');
    assert.ok(fieldErrors(r.error)['keywords.0.url']);
  });
});

/* ========================================================================== */
describe('Publish-date logic', () => {
  const past = new Date('2024-01-01T00:00:00Z');
  const future = new Date('2099-01-01T00:00:00Z');
  const now = new Date('2026-07-14T12:00:00Z');

  test('draft clears the date', () => {
    assert.equal(resolvePublishedAt('draft', undefined, past, now), undefined);
  });

  test('an explicit date always wins — backdating', () => {
    assert.equal(resolvePublishedAt('published', past, undefined, now), past);
  });

  test('an explicit FUTURE date always wins — scheduling', () => {
    assert.equal(resolvePublishedAt('published', future, undefined, now), future);
  });

  test('an existing PAST date is kept — re-saving must not bump the pub date', () => {
    assert.equal(resolvePublishedAt('published', undefined, past, now), past);
  });

  test('an existing FUTURE date + no explicit date -> stamp NOW (Scheduled -> Publish now)', () => {
    // THE bug: keeping the future date here leaves the post invisible even though
    // the author just pressed "Publish now".
    assert.equal(resolvePublishedAt('published', undefined, future, now), now);
  });

  test('nothing at all -> stamp now', () => {
    assert.equal(resolvePublishedAt('published', undefined, undefined, now), now);
  });
});

/* ========================================================================== */
describe('Invariant 3 — a save from one surface must not wipe another surface', () => {
  const raw = { ...base };
  const parsed = updatePostSchema.parse(raw);

  test('blocks/structuredData absent from the payload are NOT unset', () => {
    const ops = buildPostUpdate(parsed, raw, { existing: {} });
    assert.equal(ops.$unset?.blocks, undefined, 'the dashboard must never delete the block editor’s work');
    assert.equal(ops.$unset?.structuredData, undefined);
    assert.equal(ops.$set.blocks, undefined, 'and must not touch them either');
  });

  test('an explicit [] DOES clear — an author can delete their last block', () => {
    // Parse the SAME object we send: presence is read from the raw body, but the
    // value is taken from the validated output (so nothing bypasses the schema).
    const withEmpty = { ...raw, blocks: [] };
    const ops = buildPostUpdate(updatePostSchema.parse(withEmpty), withEmpty, { existing: {} });
    assert.deepEqual(ops.$set.blocks, [], 'normalizing [] away would trap the last block forever');
  });

  test('explicit null clears blocks rather than failing validation', () => {
    const cleared = { ...raw, blocks: null };
    const ops = buildPostUpdate(updatePostSchema.parse(cleared), cleared, { existing: {} });
    assert.equal(ops.$unset.blocks, '');
  });

  test('a block payload cannot bypass the schema (value comes from VALIDATED, not raw)', () => {
    // The raw body carries a block whose `data` is junk. If buildPostUpdate took
    // the value straight from rawBody, this arbitrary JSON would land in Mongo —
    // block.data is schema-less at the DB layer, so the validator is the ONLY gate.
    const evil = { ...raw, blocks: [{ type: 'cta', id: '1', data: { evil: true } }] };
    assert.equal(updatePostSchema.safeParse(evil).success, false, 'the union must reject a malformed block');
  });

  test('a field the form DOES own is still cleared when blanked', () => {
    const cleared = { ...base, coverImage: '' };
    const ops = buildPostUpdate(updatePostSchema.parse(cleared), cleared, { existing: {} });
    assert.equal(ops.$unset.coverImage, '', 'clearing a form field must remove it from the document');
  });
});

/* ========================================================================== */
describe('Invariant 5 — sanitize author HTML', () => {
  test('strips <script>, including its text content', () => {
    const out = sanitizeBody('<p>ok</p><script>alert(1)</script>');
    assert.equal(out.includes('script'), false);
    assert.equal(out.includes('alert(1)'), false, 'the tag went but the payload text stayed');
  });

  test('strips on* handlers', () => {
    const out = sanitizeBody('<img src="https://x.com/a.png" onerror="alert(1)">');
    assert.equal(out.includes('onerror'), false);
  });

  test('strips javascript: URLs', () => {
    assert.equal(sanitizeBody('<a href="javascript:alert(1)">x</a>').includes('javascript'), false);
  });

  test('strips OBFUSCATED javascript: URLs (control chars / whitespace in the scheme)', () => {
    const out = sanitizeBody('<a href="java\tscript:alert(1)">x</a>');
    assert.equal(/javascript/i.test(out.replace(/\s/g, '')), false);
  });

  test('strips data:text/html', () => {
    assert.equal(sanitizeBody('<a href="data:text/html;base64,PHN2Zz4=">x</a>').includes('data:'), false);
  });

  test('PRESERVES <iframe> — YouTube/Vimeo embeds must keep working', () => {
    const out = sanitizeBody('<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>');
    assert.ok(out.includes('<iframe'), 'removing iframes silently breaks every video embed');
    assert.ok(out.includes('youtube.com/embed/abc'));
  });

  test('strips <style>, <form>, <object>, <embed>', () => {
    const out = sanitizeBody('<style>a{}</style><form></form><object></object><embed>');
    assert.equal(/<(style|form|object|embed)/.test(out), false);
  });
});

/* ========================================================================== */
describe('Invariant 7 — views & reading time are server-managed', () => {
  test('the validator REJECTS a crafted views / readingTimeMinutes payload', () => {
    const r = createPostSchema.safeParse({ ...base, views: 999999, readingTimeMinutes: 1 });
    assert.equal(r.success, false, 'these must not be settable from a form');
  });

  test('reading time is recomputed from the body on save', () => {
    const doc = buildPostInsert(createPostSchema.parse({ ...base, content: `<p>${'word '.repeat(600)}</p>` }));
    assert.equal(doc.readingTimeMinutes, 3); // 600 words / 200wpm
    assert.equal(doc.views, 0);
  });

  test('reading time has a floor of 1 minute', () => {
    assert.equal(readingTimeMinutes('<p>hi</p>'), 1);
  });
});

/* ========================================================================== */
describe('Sessions', () => {
  const SECRET = 'test-secret-please-do-not-use-in-production';

  test('a freshly minted token verifies', async () => {
    const t = await createSessionToken(SECRET);
    assert.ok(await verifySessionToken(SECRET, t));
  });

  test('a tampered payload fails', async () => {
    const t = await createSessionToken(SECRET);
    const [, sig] = t.split('.');
    const forged = `${Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url')}.${sig}`;
    assert.equal(await verifySessionToken(SECRET, forged), null);
  });

  test('a token signed with a different secret fails', async () => {
    const t = await createSessionToken('other-secret');
    assert.equal(await verifySessionToken(SECRET, t), null);
  });

  test('an expired token fails', async () => {
    const t = await createSessionToken(SECRET, -1000); // already expired
    assert.equal(await verifySessionToken(SECRET, t), null);
  });

  test('garbage fails instead of throwing', async () => {
    for (const junk of ['', 'x', 'a.b', '....', null, undefined, 'a.'])
      assert.equal(await verifySessionToken(SECRET, junk), null);
  });

  test('an UNSET password can never authenticate', async () => {
    assert.equal(await passwordMatches('', undefined), false);
    assert.equal(await passwordMatches('anything', undefined), false);
    assert.equal(await passwordMatches('', ''), false);
  });

  test('the right password matches; a wrong one does not', async () => {
    assert.equal(await passwordMatches('hunter2', 'hunter2'), true);
    assert.equal(await passwordMatches('hunter3', 'hunter2'), false);
    assert.equal(await passwordMatches('hunter2extra', 'hunter2'), false);
  });
});

/* ========================================================================== */
describe('SEO scorer — one function, two callers', () => {
  test('a thin, unoptimized post is not SEO-ready', () => {
    const { ready } = scorePost({ title: 'Hi', content: '<p>short</p>' });
    assert.equal(ready, false);
  });

  test('"mark as reviewed" flips a warning to pass but stays tagged as an override', () => {
    const post = { title: 'Hi', content: '<p>short</p>', seoOverrides: ['content-length'] };
    const check = scorePost(post).checks.find((c) => c.id === 'content-length');
    assert.equal(check.status, 'pass');
    assert.equal(check.overridden, true, 'the UI must still be able to show this was a manual override');
  });

  test('link count is INFORMATIONAL — it never blocks SEO-ready', () => {
    const check = scorePost({ title: 'Hi', content: '<p>x</p>' }).checks.find((c) => c.id === 'links');
    assert.equal(check.blocking, false);
  });

  test('a fully optimized post reaches SEO-ready', () => {
    const post = {
      title: 'How to choose an SEO agency in Montreal', // 39 chars — inside the 30–60 ideal
      excerpt: 'x'.repeat(140),
      content: `<p>seo agency ${'word '.repeat(400)}</p><img src="a.png" alt="a chart">`,
      coverImage: 'https://www.davnoot.com/images/cover.png',
      coverImageAlt: 'Cover',
      seo: { focusKeyword: 'seo agency' },
    };
    const { ready, checks } = scorePost(post);
    assert.equal(ready, true, JSON.stringify(checks.filter((c) => c.status === 'warn'), null, 2));
  });
});
