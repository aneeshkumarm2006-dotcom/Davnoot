/* /api/seoteam/categories/[id]
 *
 *   PATCH   rename a category (name only — the slug is immutable, see below)
 *   DELETE  delete a category AND $pull its slug from every post
 *
 * WHY THE SLUG IS IMMUTABLE ON RENAME
 * -----------------------------------
 * The slug is the archive URL (/blog/category/<slug>) and the value stored on every
 * post that uses the category. Re-slugging on rename would 404 the live archive and
 * silently orphan those posts (their stored slug would no longer resolve to a
 * category). So PATCH only touches the display `name`; the URL keeps working.
 *
 * WHY DELETE MUST $pull
 * ---------------------
 * Categories live in one collection and are referenced by slug from another. Drop
 * the document without cleaning the references and every post keeps a dangling slug
 * that renders as a ghost card label and can never be filtered to. The $pull runs
 * in the same request so the two collections can't drift.
 */
import { ObjectId } from 'mongodb';
import { categories, posts } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { readJson, withErrors, methods, validationError, ApiError } from '../../../lib/api.js';
import { categoryUpdateSchema, fieldErrors } from '../../../lib/validators.js';

function objectId(id) {
  if (!id || !ObjectId.isValid(String(id))) throw new ApiError(404, 'Category not found.');
  return new ObjectId(String(id));
}

/* ------------------------------------------------------------------ PATCH -- */

async function rename(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await categories();
  const id = objectId(req.query.id);

  const body = await readJson(req);
  const parsed = categoryUpdateSchema.safeParse(body);
  if (!parsed.success) throw validationError(fieldErrors(parsed.error));

  const result = await col.findOneAndUpdate(
    { _id: id },
    { $set: { name: parsed.data.name, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );

  const doc = result?.value ?? result; // driver v5/v6 return-shape tolerance
  if (!doc) throw new ApiError(404, 'Category not found.');

  return res.status(200).json({ category: doc });
}

/* ----------------------------------------------------------------- DELETE -- */

async function remove(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await categories();
  const id = objectId(req.query.id);

  const doc = await col.findOne({ _id: id });
  if (!doc) throw new ApiError(404, 'Category not found.');

  await col.deleteOne({ _id: id });

  // Detach the slug from every post that referenced it, so no card renders a ghost
  // label and no /blog/category/<slug> lingers with orphaned members.
  const p = await posts();
  const { modifiedCount } = await p.updateMany(
    { categories: doc.slug },
    { $pull: { categories: doc.slug } },
  );

  return res.status(200).json({ ok: true, detachedFrom: modifiedCount });
}

export default withErrors(methods({ PATCH: rename, DELETE: remove }));
