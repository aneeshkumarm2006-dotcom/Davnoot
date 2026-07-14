/* /api/seoteam/posts
 *
 *   GET   list posts (+ the dashboard's stat-card numbers, in one round trip)
 *   POST  create a post
 *
 * Gated by the Edge middleware AND re-checked here with requireSession() —
 * middleware is not the security boundary. See middleware.js.
 */
import { posts } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { readJson, withErrors, methods, validationError } from '../../../lib/api.js';
import { createPostSchema, fieldErrors } from '../../../lib/validators.js';
import { buildPostInsert } from '../../../lib/post-write.js';
import { resolveUniqueSlug } from '../../../lib/slug.js';
import { scorePost } from '../../../lib/seo-score.js';

/* -------------------------------------------------------------------- GET -- */

async function list(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await posts();
  const { status, q, page = '1', limit = '50' } = req.query || {};

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

  const filter = {};
  if (status === 'draft' || status === 'published') filter.status = status;
  if (q && String(q).trim()) filter.$text = { $search: String(q).trim() };

  const [docs, total, stats] = await Promise.all([
    col
      .find(filter)
      .sort({ updatedAt: -1 })
      .skip((pageNum - 1) * perPage)
      .limit(perPage)
      .toArray(),
    col.countDocuments(filter),
    computeStats(col),
  ]);

  const now = new Date();

  const rows = docs.map((doc) => {
    // The "SEO ready" badge is computed with the SAME pure function the editor
    // runs live in the browser (lib/seo-score.js). One implementation, two
    // callers — so the badge in this table can never disagree with the panel in
    // the editor. That requires the body, which is why we fetch `content` and
    // then drop it from the response rather than projecting it away in Mongo.
    const { ready, warnings } = scorePost(doc);
    const { content, ...rest } = doc;

    return {
      ...rest,
      seoReady: ready,
      seoWarnings: warnings,
      // "Scheduled" is not a stored status — it is a published post whose date
      // hasn't arrived. Derived here so the table and the stat cards agree.
      scheduled: doc.status === 'published' && doc.publishedAt instanceof Date && doc.publishedAt > now,
    };
  });

  return res.status(200).json({ posts: rows, total, page: pageNum, limit: perPage, stats });
}

async function computeStats(col) {
  const now = new Date();
  const [published, scheduled, drafts, viewsAgg] = await Promise.all([
    col.countDocuments({ status: 'published', publishedAt: { $lte: now } }),
    col.countDocuments({ status: 'published', publishedAt: { $gt: now } }),
    col.countDocuments({ status: 'draft' }),
    col.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]).toArray(),
  ]);

  return {
    published, // LIVE — excludes scheduled, which is the whole point of the split
    scheduled,
    drafts,
    views: viewsAgg[0]?.total || 0,
  };
}

/* ------------------------------------------------------------------- POST -- */

async function create(req, res) {
  if (!(await requireSession(req, res))) return;

  const body = await readJson(req);

  const parsed = createPostSchema.safeParse(body);
  if (!parsed.success) throw validationError(fieldErrors(parsed.error));

  const col = await posts();

  // Slug: use what the author typed, else derive from the title. Uniqueness is
  // resolved with -2/-3 suffixes; the unique index catches any concurrent race.
  const slug = await resolveUniqueSlug(col, parsed.data.slug || parsed.data.title);

  // buildPostInsert sanitizes the body, computes readingTimeMinutes, seeds
  // views: 0, and stamps publishedAt when status=published with no date given.
  const doc = buildPostInsert({ ...parsed.data, slug });

  const result = await col.insertOne(doc);

  return res.status(201).json({ post: { _id: result.insertedId, ...doc } });
}

export default withErrors(methods({ GET: list, POST: create }));
