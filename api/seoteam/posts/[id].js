/* /api/seoteam/posts/[id]
 *
 *   GET     read one post (the editor's load)
 *   PUT     FULL REPLACE — the edit form. Clearing a field removes it.
 *   PATCH   partial — the list view's quick publish/unpublish toggle.
 *   DELETE  delete.
 *
 * A note on cache invalidation: this site is not Next.js, so there is no
 * revalidatePath(). The public blog pages are served by api/blog/* with
 * `s-maxage=60, stale-while-revalidate`, so a publish goes live within about a
 * minute without any purge call. Do not add a "revalidate" fetch here expecting
 * Next-style behaviour — it would be a no-op. If you need instant, drop s-maxage
 * in lib/blog-render.js; that is the single knob.
 */
import { ObjectId } from 'mongodb';
import { posts } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { readJson, withErrors, methods, validationError, ApiError } from '../../../lib/api.js';
import { updatePostSchema, patchPostSchema, fieldErrors } from '../../../lib/validators.js';
import { buildPostUpdate, resolvePublishedAt } from '../../../lib/post-write.js';
import { resolveUniqueSlug, slugify } from '../../../lib/slug.js';
import { isPostLive } from '../../../lib/blog-query.js';
import { pingIndexNow } from '../../../lib/indexnow.js';

/**
 * Tell IndexNow what this write changed on the PUBLIC blog. Fire-and-forget —
 * never awaited, never able to fail the save (see lib/indexnow.js).
 *
 * Derived from the before/after pair rather than from the request, because the
 * same three events reach here through three different methods:
 *
 *   published / unpublished   -> the post URL appeared or disappeared, and the
 *                                /blog listing gained or lost a card
 *   slug changed on a live post -> TWO URLs changed: the old one now 404s and
 *                                must be recrawled to be dropped, the new one
 *                                must be discovered
 *   body edited on a live post  -> one URL, and /blog is untouched
 *
 * /blog is pinged only when a post enters or leaves the listing. Pinging it on
 * every body edit would submit the same unchanged URL dozens of times a day,
 * which is how a host gets rate limited into being ignored.
 */
function pingPostChange(before, after) {
  const wasLive = isPostLive(before);
  const nowLive = isPostLive(after);

  const urls = [];
  if (wasLive) urls.push('/blog/' + before.slug); // deduped when the slug is unchanged
  if (nowLive) urls.push('/blog/' + after.slug);
  if (wasLive !== nowLive) urls.push('/blog');

  if (urls.length) pingIndexNow(urls);
}

function objectId(id) {
  if (!id || !ObjectId.isValid(String(id))) throw new ApiError(404, 'Post not found.');
  return new ObjectId(String(id));
}

async function loadOr404(col, id) {
  const doc = await col.findOne({ _id: id });
  if (!doc) throw new ApiError(404, 'Post not found.');
  return doc;
}

/* -------------------------------------------------------------------- GET -- */

async function read(req, res) {
  if (!(await requireSession(req, res))) return;
  const col = await posts();
  const doc = await loadOr404(col, objectId(req.query.id));
  return res.status(200).json({ post: doc });
}

/* -------------------------------------------------------------------- PUT -- */

async function replace(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await posts();
  const id = objectId(req.query.id);
  const existing = await loadOr404(col, id);

  const body = await readJson(req);

  const parsed = updatePostSchema.safeParse(body);
  if (!parsed.success) throw validationError(fieldErrors(parsed.error));

  // Re-resolve the slug whenever the title or the slug changed — excluding SELF,
  // or the post collides with its own stored slug and grows a new -2/-3 suffix on
  // every save, silently changing the live URL each time.
  const desired = slugify(parsed.data.slug || parsed.data.title);
  const slug =
    desired && desired !== existing.slug ? await resolveUniqueSlug(col, desired, id) : existing.slug;

  // buildPostUpdate splits the payload into $set / $unset so that clearing a
  // field in the form actually REMOVES it from the document — while never
  // touching keys owned by another surface (Invariant 3). It also sanitizes the
  // body, recomputes readingTimeMinutes, and applies the publish-date rules.
  const ops = buildPostUpdate({ ...parsed.data, slug }, body, { existing });

  await col.updateOne({ _id: id }, ops);
  const doc = await col.findOne({ _id: id });

  pingPostChange(existing, doc);

  return res.status(200).json({ post: doc, slugChanged: slug !== existing.slug, previousSlug: existing.slug });
}

/* ------------------------------------------------------------------ PATCH -- */

async function patch(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await posts();
  const id = objectId(req.query.id);
  const existing = await loadOr404(col, id);

  const body = await readJson(req);

  const parsed = patchPostSchema.safeParse(body);
  if (!parsed.success) throw validationError(fieldErrors(parsed.error));

  const $set = {};
  const $unset = {};

  if (parsed.data.status) {
    $set.status = parsed.data.status;

    // Same publish-date rules as PUT — a quick toggle in the table must behave
    // identically to pressing Publish in the editor.
    const when = resolvePublishedAt(
      parsed.data.status,
      parsed.data.publishedAt,
      existing.publishedAt,
    );
    if (when === undefined) $unset.publishedAt = '';
    else $set.publishedAt = when;
  } else if (parsed.data.publishedAt) {
    $set.publishedAt = parsed.data.publishedAt;
  }

  $set.updatedAt = new Date();

  const ops = { $set };
  if (Object.keys($unset).length) ops.$unset = $unset;

  await col.updateOne({ _id: id }, ops);
  const doc = await col.findOne({ _id: id });

  pingPostChange(existing, doc);

  return res.status(200).json({ post: doc });
}

/* ----------------------------------------------------------------- DELETE -- */

async function remove(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await posts();
  const id = objectId(req.query.id);
  // Read before deleting: once the document is gone there is no slug left to
  // tell the engines about, and a deleted URL is exactly the case where a ping
  // is most valuable — it is how a dead page leaves the index in hours instead
  // of waiting for the next organic recrawl of a 404.
  const existing = await loadOr404(col, id);

  const result = await col.deleteOne({ _id: id });
  if (!result.deletedCount) throw new ApiError(404, 'Post not found.');

  // Ping regardless of whether it was live: a post can have been published,
  // indexed, unpublished and then deleted, and that URL is still in the index.
  pingIndexNow(isPostLive(existing) ? ['/blog/' + existing.slug, '/blog'] : ['/blog/' + existing.slug]);

  return res.status(200).json({ ok: true });
}

export default withErrors(methods({ GET: read, PUT: replace, PATCH: patch, DELETE: remove }));
