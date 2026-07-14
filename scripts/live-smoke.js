#!/usr/bin/env node
/* Boot an in-memory Mongo, seed a published + a scheduled post, and start the
 * real dev server. Lets you drive the ACTUAL routes (through vercel.json) with no
 * Atlas account. Temporary harness — delete once real keys are in .env.local.
 *
 *   PORT=3456 node scripts/live-smoke.js
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri();
process.env.MONGODB_DB = 'davnoot_live';
process.env.SESSION_SECRET = 'live-smoke-secret';
process.env.SEOTEAM_PASSWORD = 'letmein';

const { posts, ensureIndexes } = await import('../lib/db.js');
await ensureIndexes();

const col = await posts();
const now = new Date();

await col.insertOne({
  title: 'What is generative engine optimization?',
  slug: 'what-is-generative-engine-optimization',
  excerpt: 'GEO is the practice of making your content the source an AI answer quotes.',
  content:
    '<h2>Why an SEO agency should care</h2><p>Generative engine optimization is how you get cited by ChatGPT. Any good SEO agency should already be doing it.</p><p>An SEO agency that ignores this is leaving traffic on the table.</p>',
  author: 'Prem',
  tags: ['AI SEO'],
  status: 'published',
  publishedAt: new Date(now.getTime() - 86400000),
  updatedAt: now,
  createdAt: now,
  readingTimeMinutes: 2,
  views: 0,
  linkFirstOccurrenceOnly: true,
  keywords: [{ keyword: 'SEO agency', url: 'https://www.davnoot.com/seo.html', rel: 'dofollow' }],
});

await col.insertOne({
  title: 'A scheduled post nobody should see yet',
  slug: 'scheduled-secret',
  content: '<p>Embargoed.</p>',
  status: 'published',
  publishedAt: new Date(now.getTime() + 7 * 86400000),
  updatedAt: now,
  createdAt: now,
  views: 0,
});

console.log('· seeded 1 published + 1 scheduled post');
await import('./dev.js');
