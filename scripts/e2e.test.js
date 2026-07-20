/* End-to-end, against a REAL MongoDB (in-memory) and the REAL route handlers.
 *
 *   node --test scripts/e2e.test.js
 *
 * This exercises the actual serverless handlers — the same modules Vercel loads —
 * with a Vercel-shaped req/res. It is the closest thing to production we can run
 * without deploying, and it's what proves the Definition of Done items that the
 * pure-logic tests can't reach: does a scheduled post really stay hidden, does a
 * publish really appear, does clearing a field really remove it from the document.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo;

// Env must be set BEFORE lib/db.js is first imported — it reads process.env at
// module scope.
before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = 'davnoot_test';
  process.env.SESSION_SECRET = 'test-secret-0123456789abcdef';
  process.env.SEOTEAM_PASSWORD = 'correct-horse-battery-staple';
});

after(async () => {
  const { getDb } = await import('../lib/db.js');
  const db = await getDb();
  await db.client?.close?.();
  await mongo?.stop();
  // The cached Mongo client keeps the event loop alive otherwise.
  process.exit(0);
});

/* ---- a Vercel-shaped req/res ------------------------------------------- */

function mockReq({ method = 'GET', query = {}, body, headers = {} } = {}) {
  return { method, query, body, headers, socket: { remoteAddress: '1.2.3.4' } };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return this.headers[k.toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    end(data) {
      if (data !== undefined) this.body = data;
      return this;
    },
    writeHead(code, hdrs) {
      this.statusCode = code;
      Object.assign(this.headers, hdrs || {});
      return this;
    },
  };
  return res;
}

const call = async (handler, req) => {
  const res = mockRes();
  await handler(req, res);
  return res;
};

/** A request carrying a valid session cookie. */
async function authed(opts = {}) {
  const { createSessionToken, COOKIE_NAME } = await import('../lib/session.js');
  const token = await createSessionToken(process.env.SESSION_SECRET);
  return mockReq({ ...opts, headers: { cookie: `${COOKIE_NAME}=${token}`, ...(opts.headers || {}) } });
}

/* ========================================================================== */

describe('auth', () => {
  test('the wrong password is rejected', async () => {
    const { default: login } = await import('../api/seoteam/login.js');
    const res = await call(login, mockReq({ method: 'POST', body: { password: 'nope' } }));
    assert.equal(res.statusCode, 401);
    assert.equal(res.getHeader('set-cookie'), undefined, 'no session may be issued');
  });

  test('the right password issues an httpOnly session cookie', async () => {
    const { default: login } = await import('../api/seoteam/login.js');
    const res = await call(login, mockReq({ method: 'POST', body: { password: process.env.SEOTEAM_PASSWORD } }));

    assert.equal(res.statusCode, 200);
    const cookie = res.getHeader('set-cookie');
    assert.match(cookie, /HttpOnly/i, 'an XSS must not be able to read the session');
    assert.match(cookie, /SameSite=Lax/i);
  });

  test('the posts API refuses an unauthenticated request (middleware is NOT the boundary)', async () => {
    const { default: posts } = await import('../api/seoteam/posts/index.js');
    const res = await call(posts, mockReq({ method: 'GET' })); // no cookie, no middleware
    assert.equal(res.statusCode, 401);
  });

  test('rate limiting kicks in after 5 failures', async () => {
    const { default: login } = await import('../api/seoteam/login.js');
    let last;
    for (let i = 0; i < 7; i++) {
      last = await call(login, mockReq({ method: 'POST', body: { password: 'wrong' }, headers: { 'x-forwarded-for': '9.9.9.9' } }));
    }
    assert.equal(last.statusCode, 429);
  });
});

/* ========================================================================== */

describe('the full author journey', () => {
  let postId;

  test('create a draft', async () => {
    const { default: handler } = await import('../api/seoteam/posts/index.js');
    const res = await call(
      handler,
      await authed({
        method: 'POST',
        body: {
          title: 'How to choose an SEO agency',
          content: '<h2>Start here</h2><p>An SEO agency should show pipeline.</p>',
          excerpt: 'A checklist.',
          status: 'draft',
          coverImage: 'https://res.cloudinary.com/x/image/upload/v1/cover.png',
          seo: { metaTitle: '', robotsIndex: '' }, // blank form fields
        },
      }),
    );

    assert.equal(res.statusCode, 201);
    postId = String(res.body.post._id);

    const post = res.body.post;
    assert.equal(post.slug, 'how-to-choose-an-seo-agency', 'slug derived from the title');
    assert.equal(post.readingTimeMinutes, 1, 'reading time computed server-side');
    assert.equal(post.views, 0);
    assert.equal(post.publishedAt, undefined, 'a draft has no publish date');
    assert.equal(post.seo?.robotsIndex, undefined, 'a blank robots field must NOT become false');
  });

  test('a draft is NOT visible on the public blog', async () => {
    const { findPublishedBySlug } = await import('../lib/blog-query.js');
    assert.equal(await findPublishedBySlug('how-to-choose-an-seo-agency'), null);
  });

  test('schedule it for the future', async () => {
    const { default: handler } = await import('../api/seoteam/posts/[id].js');
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const res = await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id: postId },
        body: {
          title: 'How to choose an SEO agency',
          content: '<h2>Start here</h2><p>An SEO agency should show pipeline.</p>',
          status: 'published',
          publishedAt: future,
        },
      }),
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.post.status, 'published');
    assert.ok(new Date(res.body.post.publishedAt) > new Date(), 'the future date was honoured');
  });

  test('a SCHEDULED post stays hidden from the public blog and the sitemap', async () => {
    const { findPublishedBySlug, listPublished } = await import('../lib/blog-query.js');

    assert.equal(
      await findPublishedBySlug('how-to-choose-an-seo-agency'),
      null,
      'a scheduled post must not be reachable before its date',
    );

    const { posts: live } = await listPublished({});
    assert.equal(live.length, 0);

    const { default: sitemap } = await import('../api/sitemap.js');
    const res = await call(sitemap, mockReq());
    assert.equal(
      res.body.includes('how-to-choose-an-seo-agency'),
      false,
      'submitting a scheduled post to Google earns a soft-404',
    );
  });

  test('switching Scheduled -> "Publish now" stamps NOW, not the old future date', async () => {
    const { default: handler } = await import('../api/seoteam/posts/[id].js');

    // The author picks "Published" and clears the date — exactly what the editor
    // sends. If we kept the stored future date here, the post would stay invisible
    // even though they just pressed Publish. This is THE scheduling bug.
    const res = await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id: postId },
        body: {
          title: 'How to choose an SEO agency',
          content: '<h2>Start here</h2><p>An SEO agency should show pipeline.</p>',
          status: 'published',
          publishedAt: '',
        },
      }),
    );

    assert.equal(res.statusCode, 200);
    assert.ok(
      new Date(res.body.post.publishedAt) <= new Date(),
      'the future date must be replaced with now',
    );
  });

  test('the post is now LIVE on the public blog', async () => {
    const { findPublishedBySlug } = await import('../lib/blog-query.js');
    const post = await findPublishedBySlug('how-to-choose-an-seo-agency');
    assert.ok(post, 'publishing did not make it public');
  });

  test('the public page renders, and emits NO robots directive', async () => {
    const { default: handler } = await import('../api/blog/post.js');
    const res = await call(handler, mockReq({ query: { slug: 'how-to-choose-an-seo-agency' } }));

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1>How to choose an SEO agency<\/h1>/);
    assert.match(res.body, /"@type": "BlogPosting"/);
    assert.match(res.body, /<link rel="canonical" href="https:\/\/www\.davnoot\.com\/blog\/how-to-choose-an-seo-agency"/);

    // THE spot-check from the Definition of Done.
    assert.equal(
      /<meta name="robots"/.test(res.body),
      false,
      'a post that never set robots must emit no robots tag',
    );

    // Cached at the edge, so CWV are static-like, but only for 60s so a publish is
    // live within a minute.
    assert.match(res.getHeader('cache-control'), /s-maxage=60/);
  });

  test('it appears in the sitemap', async () => {
    const { default: sitemap } = await import('../api/sitemap.js');
    const res = await call(sitemap, mockReq());
    assert.match(res.body, /https:\/\/www\.davnoot\.com\/blog\/how-to-choose-an-seo-agency/);
    assert.match(res.body, /www\.davnoot\.com\/services\/seo<\/loc>/, 'the 8 static pages must still be there (clean URL under /services)');
  });

  test('the view counter increments (server-managed)', async () => {
    const { default: view } = await import('../api/blog/[id]/view.js');
    await call(view, mockReq({ method: 'POST', query: { id: postId } }));

    const { posts } = await import('../lib/db.js');
    const { ObjectId } = await import('mongodb');
    const doc = await (await posts()).findOne({ _id: new ObjectId(postId) });
    assert.equal(doc.views, 1);
  });

  test('clearing a field in the edit form REMOVES it from the document', async () => {
    const { default: handler } = await import('../api/seoteam/posts/[id].js');

    const res = await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id: postId },
        body: {
          title: 'How to choose an SEO agency',
          content: '<p>x</p>',
          status: 'published',
          coverImage: '', // the author cleared it
        },
      }),
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.post.coverImage, undefined, 'a sparse patch could not have done this');
  });

  test('Invariant 3: a dashboard save does not wipe another surface’s field', async () => {
    const { posts } = await import('../lib/db.js');
    const { ObjectId } = await import('mongodb');
    const col = await posts();
    const _id = new ObjectId(postId);

    // Pretend a future admin panel (or the Phase-5 block editor) wrote `blocks`.
    await col.updateOne({ _id }, { $set: { blocks: [{ type: 'faq', id: 'a', data: {} }] } });

    const { default: handler } = await import('../api/seoteam/posts/[id].js');
    await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id: postId },
        // The dashboard form does not render `blocks`, so it is ABSENT here.
        body: { title: 'How to choose an SEO agency', content: '<p>x</p>', status: 'published' },
      }),
    );

    const doc = await col.findOne({ _id });
    assert.equal(doc.blocks?.length, 1, 'the dashboard silently deleted the other surface’s work');
  });

  test('the body is sanitized on save, but <iframe> survives', async () => {
    const { default: handler } = await import('../api/seoteam/posts/[id].js');
    const res = await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id: postId },
        body: {
          title: 'How to choose an SEO agency',
          status: 'draft',
          content:
            '<p>ok</p><script>alert(1)</script><iframe src="https://www.youtube.com/embed/x"></iframe><img src="https://a.co/b.png" onerror="alert(1)">',
        },
      }),
    );

    const content = res.body.post.content;
    assert.equal(content.includes('<script'), false);
    assert.equal(content.includes('onerror'), false);
    assert.ok(content.includes('<iframe'), 'YouTube embeds must keep working');
  });

  test('a duplicate slug is suffixed, not rejected', async () => {
    const { default: handler } = await import('../api/seoteam/posts/index.js');
    const res = await call(
      handler,
      await authed({
        method: 'POST',
        body: { title: 'How to choose an SEO agency', content: '<p>another</p>' },
      }),
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.post.slug, 'how-to-choose-an-seo-agency-2');
  });

  test('re-saving does NOT keep suffixing the slug (it must exclude itself)', async () => {
    const { default: handler } = await import('../api/seoteam/posts/[id].js');
    const res = await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id: postId },
        body: { title: 'How to choose an SEO agency', content: '<p>x</p>', status: 'draft' },
      }),
    );
    assert.equal(res.body.post.slug, 'how-to-choose-an-seo-agency', 'the live URL must not drift on every save');
  });

  test('the list view returns the SEO-ready badge and the stat cards', async () => {
    const { default: handler } = await import('../api/seoteam/posts/index.js');
    const res = await call(handler, await authed({ method: 'GET', query: {} }));

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.stats);
    assert.equal(typeof res.body.posts[0].seoReady, 'boolean');
    assert.equal(res.body.posts[0].content, undefined, 'the body must not be shipped to the table');
  });

  test('a 400 returns per-field errors the form can render inline', async () => {
    const { default: handler } = await import('../api/seoteam/posts/index.js');
    const res = await call(
      handler,
      await authed({ method: 'POST', body: { title: 'x', coverImage: 'not-a-url' } }),
    );
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.fields.coverImage);
  });
});

/* ========================================================================== */

describe('blocks + structured data, round-tripped through the real API', () => {
  let id;

  const FAQ = {
    type: 'faq',
    id: 'blk1',
    data: { heading: 'FAQ', items: [{ q: 'What is GEO?', a: '<p>Generative engine optimization.</p>' }] },
  };

  test('create a post WITH blocks', async () => {
    const { default: handler } = await import('../api/seoteam/posts/index.js');
    const res = await call(
      handler,
      await authed({
        method: 'POST',
        body: {
          title: 'GEO vs SEO explained',
          content: '<p>The body remains the authoritative content.</p>',
          status: 'published',
          blocks: [FAQ, { type: 'cta', id: 'blk2', data: { heading: 'Talk to us', buttonLabel: 'Book', buttonUrl: 'https://www.davnoot.com/book-call.html' } }],
        },
      }),
    );

    assert.equal(res.statusCode, 201);
    id = String(res.body.post._id);
    assert.equal(res.body.post.blocks.length, 2);
  });

  test('the public page renders the blocks AFTER the body (Invariant 4)', async () => {
    const { default: handler } = await import('../api/blog/post.js');
    const res = await call(handler, mockReq({ query: { slug: 'geo-vs-seo-explained' } }));

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('The body remains the authoritative content.'), 'the body must survive');
    assert.match(res.body, /blk-faq/);
    assert.match(res.body, /blk-cta/);
    assert.ok(res.body.indexOf('post-body') < res.body.indexOf('post-blocks'));
  });

  test('the FAQ block emits FAQPage schema, derived from the VISIBLE questions', async () => {
    const { default: handler } = await import('../api/blog/post.js');
    const res = await call(handler, mockReq({ query: { slug: 'geo-vs-seo-explained' } }));

    const ld = JSON.parse(res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage');

    assert.ok(faq, 'an FAQ block must produce FAQPage schema');
    assert.equal(faq.mainEntity[0].name, 'What is GEO?');
    // Schema that claims questions the page doesn't show earns a manual action.
    assert.ok(res.body.includes('What is GEO?'), 'the question must also be VISIBLE on the page');
  });

  test('a malformed block is REJECTED — block.data is schema-less in Mongo', async () => {
    const { default: handler } = await import('../api/seoteam/posts/[id].js');
    const res = await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id },
        body: {
          title: 'GEO vs SEO explained',
          content: '<p>x</p>',
          status: 'published',
          blocks: [{ type: 'cta', id: 'x', data: { arbitrary: 'json' } }],
        },
      }),
    );
    assert.equal(res.statusCode, 400, 'the discriminated union is the only gate here');
  });

  test('invalid custom JSON-LD BLOCKS the save (it would emit a broken <script>)', async () => {
    const { default: handler } = await import('../api/seoteam/posts/[id].js');
    const res = await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id },
        body: {
          title: 'GEO vs SEO explained',
          content: '<p>x</p>',
          status: 'published',
          structuredData: { customJsonLd: '{ not json', customMode: 'append' },
        },
      }),
    );
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.fields['structuredData.customJsonLd']);
  });

  test('an author CAN delete their last block (explicit [] clears)', async () => {
    const { default: handler } = await import('../api/seoteam/posts/[id].js');
    const res = await call(
      handler,
      await authed({
        method: 'PUT',
        query: { id },
        body: {
          title: 'GEO vs SEO explained',
          content: '<p>x</p>',
          status: 'published',
          blocks: [], // the editor always sends this key, even when empty
        },
      }),
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.post.blocks, [], 'normalizing [] away would trap the last block forever');
  });

  test('and FAQPage disappears with it', async () => {
    const { default: handler } = await import('../api/blog/post.js');
    const res = await call(handler, mockReq({ query: { slug: 'geo-vs-seo-explained' } }));
    const ld = JSON.parse(res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld['@graph'].some((n) => n['@type'] === 'FAQPage'), false);
  });
});

/* ========================================================================== */

describe('media', () => {
  test('usage is computed on READ by scanning posts', async () => {
    const { media, posts } = await import('../lib/db.js');
    const now = new Date();

    const url = 'https://res.cloudinary.com/demo/image/upload/v1/used.png';
    await (await media()).insertOne({ url, filename: 'used.png', createdAt: now, tags: [] });
    await (await media()).insertOne({
      url: 'https://res.cloudinary.com/demo/image/upload/v1/orphan.png',
      filename: 'orphan.png',
      createdAt: now,
      tags: [],
    });

    await (await posts()).insertOne({
      title: 'Uses the image',
      slug: 'uses-the-image',
      status: 'draft',
      // Referenced with a TRANSFORMATION in the URL — a raw string compare would
      // call this image "unused" and happily offer to delete it.
      content: '<img src="https://res.cloudinary.com/demo/image/upload/w_800,q_auto/v1/used.png">',
      createdAt: now,
      updatedAt: now,
    });

    const { default: handler } = await import('../api/seoteam/media/index.js');
    const res = await call(handler, await authed({ method: 'GET', query: {} }));

    const used = res.body.media.find((m) => m.filename === 'used.png');
    const orphan = res.body.media.find((m) => m.filename === 'orphan.png');

    assert.equal(used.usedCount, 1, 'a transformed Cloudinary URL must still match');
    assert.equal(used.usedIn[0].title, 'Uses the image');
    assert.equal(orphan.usedCount, 0);
    assert.equal(res.body.stats.unused, 1);
  });

  test('deleting an in-use image is blocked with a 409', async () => {
    const { media } = await import('../lib/db.js');
    const doc = await (await media()).findOne({ filename: 'used.png' });

    const { default: handler } = await import('../api/seoteam/media/[id].js');
    const res = await call(handler, await authed({ method: 'DELETE', query: { id: String(doc._id) } }));

    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /Uses the image/, 'tell the author WHICH post breaks');
  });

  test('sync discovers images that posts reference but the library never knew about', async () => {
    const { posts } = await import('../lib/db.js');
    await (await posts()).insertOne({
      title: 'Pasted an image',
      slug: 'pasted',
      status: 'draft',
      content: '<img src="https://cdn.example.com/pasted.png">',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { default: sync } = await import('../api/seoteam/media/sync.js');
    const res = await call(sync, await authed({ method: 'POST' }));

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.discovered >= 1);
  });
});
