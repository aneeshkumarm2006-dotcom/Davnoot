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

  return res.status(200).json({ post: doc });
}

/* ----------------------------------------------------------------- DELETE -- */

async function remove(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await posts();
  const id = objectId(req.query.id);

  const result = await col.deleteOne({ _id: id });
  if (!result.deletedCount) throw new ApiError(404, 'Post not found.');

  return res.status(200).json({ ok: true });
}

export default withErrors(methods({ GET: read, PUT: replace, PATCH: patch, DELETE: remove }));
