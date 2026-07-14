/* Slug generation and uniqueness resolution. */

/**
 * Turn arbitrary text into a URL-safe slug.
 * Strips accents (Montréal -> montreal) so French copy produces clean URLs.
 */
export function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents (Montréal -> montreal)
    .toLowerCase()
    .replace(/['‘’]/g, '') // don't turn "don't" into "don-t"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, ''); // the slice may have left a trailing hyphen
}

/**
 * Resolve a unique slug against the posts collection, suffixing -2, -3, … on
 * collision.
 *
 * `excludeId` is REQUIRED on update paths: without it, a post always collides
 * with itself and its slug grows a new suffix on every single save
 * (my-post -> my-post-2 -> my-post-3 …), silently changing the live URL each
 * time you hit save.
 *
 * @param {import('mongodb').Collection} collection
 * @param {string} desired      raw slug or title to derive from
 * @param {import('mongodb').ObjectId} [excludeId]  the post being updated
 */
export async function resolveUniqueSlug(collection, desired, excludeId) {
  const base = slugify(desired) || 'post';
  let candidate = base;

  for (let i = 2; ; i++) {
    const query = { slug: candidate };
    if (excludeId) query._id = { $ne: excludeId };

    const clash = await collection.findOne(query, { projection: { _id: 1 } });
    if (!clash) return candidate;

    candidate = `${base}-${i}`;
    if (i > 500) throw new Error(`Could not find a free slug for "${base}"`);
  }
}
