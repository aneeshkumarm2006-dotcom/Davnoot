/* Shared write logic for posts: publish-date resolution, and the $set/$unset
 * split that makes a full-replace PUT actually able to CLEAR a field.
 *
 * ===========================================================================
 * WHY A FULL REPLACE NEEDS AN EXPLICIT $unset
 * ===========================================================================
 * The edit form must be able to clear an optional field — blank out the canonical
 * URL, remove the cover image — and have that field actually LEAVE the document.
 * A naive `$set: validatedObject` cannot do this: JSON.stringify drops undefined
 * keys before the request ever leaves the browser, so "cleared" and "not sent"
 * look identical on the server. So we drive the split off an explicit key list —
 * the fields THIS FORM OWNS — rather than off whatever keys happen to survive
 * serialization.
 *
 * ===========================================================================
 * INVARIANT 3 — TWO WRITERS, ONE DOCUMENT
 * ===========================================================================
 * "$unset every key that isn't in the payload" is the obvious implementation and
 * it is a data-loss bug. A field that only ONE editing surface renders (blocks,
 * structuredData) is simply ABSENT from the other surface's payload — so saving
 * from the dashboard would silently delete work done in the admin panel, and
 * vice-versa.
 *
 * The fix is that a key has THREE states, not two:
 *
 *      key absent from the request  ->  leave the stored value ALONE
 *      key present, [] or {}        ->  clear it  (the author deleted their last block)
 *      key present with a value     ->  set it
 *
 * Both halves are load-bearing. Normalize `[]` away to "absent" and an author can
 * never delete their last block. Drop the preserve-list and one panel wipes the
 * other.
 *
 * Today there is exactly ONE writing surface (the /seoteam dashboard) — this site
 * has no admin panel. So PRESERVE_KEYS is currently insurance rather than an
 * active fix, and it is enforced structurally: these keys are not in
 * POST_FORM_KEYS, so the dashboard's $unset pass cannot reach them. When the block
 * editor ships (Phase 5), add the field to the validator and it flows through the
 * three-state logic below automatically.
 */
import { sanitizeBody } from './sanitize.js';
import { readingTimeMinutes } from './html-text.js';

/**
 * Keys the /seoteam edit form RENDERS and therefore OWNS.
 * If a key is here and arrives undefined, the author cleared it -> $unset.
 * Keep this in sync with postCore in lib/validators.js.
 */
export const POST_FORM_KEYS = [
  'title',
  'slug',
  'excerpt',
  'content',
  'coverImage',
  'coverImageAlt',
  'author',
  'tags',
  'categories',
  'status',
  'publishedAt',
  'seo',
  'template',
  'keywords',
  'linkFirstOccurrenceOnly',
  'seoOverrides',
  'contentWidth',
  'coverLayout',
];

/**
 * Keys that go through the THREE-STATE rule instead of the form's set/unset split.
 *
 *     key absent from the request body -> leave the stored value ALONE
 *     key present as null              -> clear it
 *     key present ([] / {} / a value)  -> set it (validated)
 *
 * These are NOT in POST_FORM_KEYS, and that is the point: a surface that does not
 * render them omits them, and therefore cannot delete them (Invariant 3). The
 * dashboard editor DOES render blocks, and always sends them (as [] when empty),
 * so it can both set and clear. A future admin panel that only edits metadata will
 * omit them and leave an author's blocks intact.
 */
export const PRESERVE_KEYS = ['blocks', 'structuredData'];

/**
 * Resolve publishedAt. Get this exactly right — it is the whole scheduling feature.
 *
 *   - Draft                     -> no date at all (undefined -> $unset).
 *   - Explicit date always wins -> supports BACKDATING (a past date) and
 *                                  SCHEDULING (a future date).
 *   - No date supplied:
 *       existing date in the PAST   -> keep it. Re-saving a published post must
 *                                      not bump its publication date.
 *       existing date in the FUTURE -> the author just switched Scheduled ->
 *                                      "Publish now". Stamp NOW. Keeping the future
 *                                      date here is the bug: the post would stay
 *                                      invisible even though they pressed Publish.
 *       no existing date            -> stamp NOW.
 *
 * @returns {Date|undefined}  undefined means "$unset this field"
 */
export function resolvePublishedAt(status, incoming, existing, now = new Date()) {
  if (status !== 'published') return undefined;
  if (incoming instanceof Date) return incoming;
  if (existing instanceof Date && existing.getTime() <= now.getTime()) return existing;
  return now;
}

/** Drop undefined keys so they never reach Mongo as nulls. */
function defined(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Turn a validated payload into Mongo update operators.
 *
 * @param {object} validated  output of updatePostSchema.parse()
 * @param {object} rawBody    the ORIGINAL request body — needed to tell
 *                            "key absent" from "key present but empty" for
 *                            PRESERVE_KEYS. Do not pass the validated object here.
 * @param {object} opts       { existing } the current document, for publish-date logic
 */
export function buildPostUpdate(validated, rawBody = {}, { existing } = {}) {
  const $set = {};
  const $unset = {};

  const publishedAt = resolvePublishedAt(
    validated.status,
    validated.publishedAt,
    existing?.publishedAt,
  );

  for (const key of POST_FORM_KEYS) {
    let value = validated[key];

    if (key === 'publishedAt') value = publishedAt;

    if (key === 'content') {
      // Sanitize on EVERY write path. Never trust that an earlier layer did it.
      value = sanitizeBody(value);
    }

    if (key === 'seo') {
      // The form owns the whole SEO block, so we replace it wholesale. Undefined
      // sub-keys are pruned, which is precisely how a cleared field leaves the
      // document — and why robotsIndex/robotsFollow correctly vanish (rather than
      // becoming `false`, i.e. noindex) when the author picks "Default".
      const seo = defined(value);
      if (seo && Object.keys(seo).length) $set.seo = seo;
      else $unset.seo = '';
      continue;
    }

    if (value === undefined) {
      $unset[key] = ''; // the author cleared a field this form owns
    } else {
      $set[key] = value;
    }
  }

  // --- SERVER-MANAGED FIELDS ---
  // Recomputed here, never accepted from the client (they aren't in the validator).
  $set.readingTimeMinutes = readingTimeMinutes($set.content);
  $set.updatedAt = new Date();

  // --- PRESERVE_KEYS: the three-state rule (Invariant 3) ---
  for (const key of PRESERVE_KEYS) {
    // PRESENCE is read from the RAW body — that is the only place "the caller
    // didn't send this key" is distinguishable from "the caller sent it empty",
    // because Zod cannot represent that difference in its output.
    if (!Object.prototype.hasOwnProperty.call(rawBody, key)) continue; // absent -> untouched

    // The VALUE, however, comes from the VALIDATED object. Taking it from rawBody
    // would write straight past the schema — and block.data is exactly the
    // schema-less field where arbitrary JSON must never land. Presence from raw,
    // value from validated.
    const value = validated[key];

    if (value === undefined || value === null) {
      $unset[key] = ''; // explicit null -> clear
    } else {
      $set[key] = value; // [] and {} land here: an author CAN delete their last block
    }
  }

  const ops = { $set };
  if (Object.keys($unset).length) ops.$unset = $unset;
  return ops;
}

/** Build the document for a brand-new post (POST). */
export function buildPostInsert(validated) {
  const now = new Date();
  const doc = defined({
    ...validated,
    seo: defined(validated.seo),
    content: sanitizeBody(validated.content),
    publishedAt: resolvePublishedAt(validated.status, validated.publishedAt, undefined, now),
  });

  if (doc.seo && !Object.keys(doc.seo).length) delete doc.seo;

  doc.readingTimeMinutes = readingTimeMinutes(doc.content);
  doc.views = 0; // server-managed, initialized once, never settable from a form
  doc.createdAt = now;
  doc.updatedAt = now;

  return doc;
}
