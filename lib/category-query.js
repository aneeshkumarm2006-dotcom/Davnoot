/* Shared read queries for CATEGORIES on the PUBLIC blog surface.
 *
 * Categories are a managed taxonomy (created/deleted in /seoteam), NOT free-text
 * tags. A post stores an array of category SLUGS; the renderer resolves each slug
 * back to its display name through the map these helpers feed it.
 *
 * There is nothing to hide here — categories are public by definition (they are
 * the filter pills on /blog) — so, unlike lib/blog-query.js, there is no
 * publishedFilter equivalent. An empty category (no published posts) still appears
 * as a pill; the archive page for it just renders its empty state.
 */
import { categories } from './db.js';

/** Every category, alphabetised — the order the filter pills render in. */
export async function listAllCategories() {
  const col = await categories();
  return col
    .find({}, { projection: { name: 1, slug: 1, _id: 0 } })
    .sort({ name: 1 })
    .toArray();
}

/** One category by its slug, or null. Used to validate /blog/category/<slug>. */
export async function findCategoryBySlug(slug) {
  const col = await categories();
  return col.findOne({ slug: String(slug) }, { projection: { name: 1, slug: 1, _id: 0 } });
}
