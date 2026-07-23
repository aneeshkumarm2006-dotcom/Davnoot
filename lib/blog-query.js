/* Shared read queries for the PUBLIC blog surface.
 *
 * Every public read goes through publishedFilter(). It is the single definition
 * of "visible to the world", and it is what makes SCHEDULING work with no cron
 * job, no queue, and no background worker:
 *
 *     a post with a FUTURE publishedAt simply does not match the filter yet.
 *
 * When its date arrives, the next render picks it up on its own. This is the main
 * reason the blog is server-rendered rather than statically baked at deploy time —
 * a static build would need a scheduled rebuild to make a scheduled post appear.
 *
 * If you add a new public read path (a feed, a tag page, an AMP variant), USE
 * THIS FILTER. Hand-rolling `{status:'published'}` there would leak every
 * scheduled post to the public the moment it was written.
 */
import { posts } from './db.js';

export function publishedFilter(now = new Date()) {
  return { status: 'published', publishedAt: { $lte: now } };
}

/** Fields the list/card views need. Deliberately excludes the (large) body. */
export const CARD_FIELDS = {
  slug: 1,
  title: 1,
  excerpt: 1,
  coverImage: 1,
  coverImageAlt: 1,
  tags: 1,
  categories: 1,
  author: 1,
  publishedAt: 1,
  readingTimeMinutes: 1,
};

export async function listPublished({ page = 1, perPage = 12, category } = {}) {
  const col = await posts();
  const filter = publishedFilter();

  // Category archive (/blog/category/<slug>). A post stores category SLUGS in an
  // array, so an equality match on the array field is Mongo's "contains this slug".
  // Still ANDed with publishedFilter(), so a scheduled/draft post never leaks here.
  if (category) filter.categories = String(category);

  const [docs, total] = await Promise.all([
    col
      .find(filter, { projection: CARD_FIELDS })
      .sort({ publishedAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .toArray(),
    col.countDocuments(filter),
  ]);

  return { posts: docs, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function findPublishedBySlug(slug) {
  const col = await posts();
  return col.findOne({ ...publishedFilter(), slug: String(slug) });
}

/** "More from the blog" — prefer posts sharing a tag, then fall back to recent. */
export async function relatedTo(post, limit = 3) {
  const col = await posts();
  const base = { ...publishedFilter(), _id: { $ne: post._id } };

  const byTag = post.tags?.length
    ? await col
        .find({ ...base, tags: { $in: post.tags } }, { projection: CARD_FIELDS })
        .sort({ publishedAt: -1 })
        .limit(limit)
        .toArray()
    : [];

  if (byTag.length >= limit) return byTag;

  const seen = new Set(byTag.map((p) => String(p._id)));
  const filler = await col
    .find({ ...base, _id: { $nin: [post._id, ...byTag.map((p) => p._id)] } }, { projection: CARD_FIELDS })
    .sort({ publishedAt: -1 })
    .limit(limit - byTag.length)
    .toArray();

  return [...byTag, ...filler.filter((p) => !seen.has(String(p._id)))];
}
