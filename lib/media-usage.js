/* "Which posts use this image?" — computed ON READ, never stored.
 *
 * ===========================================================================
 * WHY WE DO NOT STORE USAGE
 * ===========================================================================
 * A `usedIn: [postId]` field on the media document is the obvious design and it
 * rots immediately. Posts change constantly: an author deletes an <img> from a
 * body, swaps a cover, pastes a new URL — and every one of those edits would have
 * to remember to update a denormalized list on some other collection. It will be
 * wrong within a week, and a WRONG usage list is worse than none, because the
 * gallery's "safe to delete, it's unused" badge starts lying and someone deletes
 * an image that's on a live post.
 *
 * So we scan. The blog has tens of posts, not millions; this is a projection over
 * three small fields and it costs a few milliseconds.
 *
 * Matching is on a NORMALIZED url: Cloudinary serves the same asset under
 * http/https, with and without a transformation segment, and an author may paste
 * any of them. Comparing raw strings would report a used image as unused.
 */
import { posts } from './db.js';

/**
 * Normalize a URL for comparison:
 *   - drop the protocol (http vs https is the same asset)
 *   - drop query strings and fragments (cache-busters, ?w=800)
 *   - drop a Cloudinary transformation segment (/upload/w_800,q_auto/ -> /upload/)
 *   - lowercase, strip a trailing slash
 */
export function normalizeUrl(url) {
  if (!url) return '';
  let s = String(url).trim();

  s = s.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '');
  // Cloudinary: /<cloud>/image/upload/<transformations>/v123/<public_id>.<ext>
  s = s.replace(/\/image\/upload\/[^/]*(?=\/v\d+\/)/i, '/image/upload');
  return s.toLowerCase().replace(/\/+$/, '');
}

/** Every image URL referenced by a post: cover, OG image, and inline <img> tags. */
export function imageUrlsInPost(post) {
  const urls = [];
  if (post.coverImage) urls.push(post.coverImage);
  if (post.seo?.ogImage) urls.push(post.seo.ogImage);

  const re = /<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(post.content || ''))) urls.push(m[1]);

  return urls;
}

/**
 * Build a map: normalizedUrl -> [{_id, title, slug}].
 * One pass over the posts collection; the caller then does O(1) lookups.
 */
export async function buildUsageMap() {
  const col = await posts();
  const docs = await col
    .find({}, { projection: { title: 1, slug: 1, coverImage: 1, content: 1, 'seo.ogImage': 1 } })
    .toArray();

  const map = new Map();
  for (const doc of docs) {
    const ref = { _id: doc._id, title: doc.title, slug: doc.slug };
    for (const url of imageUrlsInPost(doc)) {
      const key = normalizeUrl(url);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (!list.some((p) => String(p._id) === String(ref._id))) list.push(ref);
    }
  }
  return map;
}

/** Every image URL that appears in a post but is NOT yet in the media library. */
export async function discoverUnregistered(known) {
  const col = await posts();
  const docs = await col.find({}, { projection: { coverImage: 1, content: 1, 'seo.ogImage': 1 } }).toArray();

  const knownKeys = new Set([...known].map(normalizeUrl));
  const found = new Map(); // normalized -> the original URL as written

  for (const doc of docs) {
    for (const url of imageUrlsInPost(doc)) {
      const key = normalizeUrl(url);
      if (!key || knownKeys.has(key) || found.has(key)) continue;
      if (!/^https?:\/\//i.test(url)) continue; // skip relative paths — not library assets
      found.set(key, url);
    }
  }

  return [...found.values()];
}
