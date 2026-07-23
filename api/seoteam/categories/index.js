/* /api/seoteam/categories
 *
 *   GET   list every category, each with its published-or-not post count
 *   POST  create a category
 *
 * Gated by the Edge middleware AND re-checked here with requireSession() —
 * middleware is not the security boundary. Same contract as api/seoteam/posts.
 *
 * There is no explicit rewrite for this route in vercel.json, and it does not need
 * one: the folder holds `index.js` + `[id].js` with NO `[id]/` subdirectory, so
 * Vercel keeps the implicit `/api/seoteam/categories` -> index route (the same
 * shape as api/seoteam/posts). See scripts/vercel-config.test.js for the collision
 * case that DOES need one.
 */
import { categories, posts } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { readJson, withErrors, methods, validationError } from '../../../lib/api.js';
import { categoryCreateSchema, fieldErrors } from '../../../lib/validators.js';
import { resolveUniqueSlug } from '../../../lib/slug.js';

/* -------------------------------------------------------------------- GET -- */

async function list(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await categories();
  const p = await posts();

  const [docs, counts] = await Promise.all([
    col.find({}).sort({ name: 1 }).toArray(),
    // One pass over posts to count usage per slug, so the management table can warn
    // "used by N posts" before a delete. $unwind turns the categories array into one
    // row per membership; missing/empty arrays simply contribute nothing.
    p.aggregate([
      { $unwind: '$categories' },
      { $group: { _id: '$categories', n: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const countBySlug = new Map(counts.map((c) => [c._id, c.n]));
  const rows = docs.map((d) => ({ ...d, postCount: countBySlug.get(d.slug) || 0 }));

  return res.status(200).json({ categories: rows });
}

/* ------------------------------------------------------------------- POST -- */

async function create(req, res) {
  if (!(await requireSession(req, res))) return;

  const body = await readJson(req);
  const parsed = categoryCreateSchema.safeParse(body);
  if (!parsed.success) throw validationError(fieldErrors(parsed.error));

  const col = await categories();

  // Slug: use what was typed, else derive from the name. Uniqueness is resolved
  // with -2/-3 suffixes here; the unique index catches any concurrent race and the
  // shared error mapper turns an 11000 into a clean 409.
  const slug = await resolveUniqueSlug(col, parsed.data.slug || parsed.data.name);

  const now = new Date();
  const doc = { name: parsed.data.name, slug, createdAt: now, updatedAt: now };
  const result = await col.insertOne(doc);

  return res.status(201).json({ category: { _id: result.insertedId, ...doc } });
}

export default withErrors(methods({ GET: list, POST: create }));
