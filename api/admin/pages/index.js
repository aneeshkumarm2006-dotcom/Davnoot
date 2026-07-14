/* GET  /api/admin/pages          — every URL on the site (overlay + composed).
 * POST /api/admin/pages          — create a new composed page.
 *
 * Middleware is not the boundary: every handler re-checks the role itself.
 */
import { withErrors, methods, readJson, validationError } from '../../../lib/api.js';
import { requireRole } from '../../../lib/auth.js';
import { pages } from '../../../lib/db.js';
import { COMPILED_PAGES } from '../../../lib/compiled-pages.gen.js';
import { pageCreateSchema, buildPageInsert } from '../../../lib/page-model.js';
import { fieldErrors } from '../../../lib/validators.js';
import { audit } from '../../../lib/audit.js';

async function list(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const docs = await (await pages()).find({}).toArray();
  const byPath = new Map(docs.map((d) => [d.path, d]));

  // The 8 overlay pages always exist (their template ships in the bundle), whether
  // or not a document has been created for them yet.
  const overlay = Object.values(COMPILED_PAGES).map((tpl) => {
    const doc = byPath.get(tpl.path);
    return row({
      key: tpl.file,
      path: tpl.path,
      kind: tpl.kind,
      base: tpl.file,
      editableSlots: tpl.slots.length,
      doc,
    });
  });

  // Composed pages (base === null) that aren't one of the 8.
  const composed = docs
    .filter((d) => d.base === null)
    .map((d) => row({ key: d.slug, path: d.path, kind: d.kind, base: null, editableSlots: null, doc: d }));

  res.status(200).json({ pages: [...overlay, ...composed] });
}

function row({ key, path, kind, base, editableSlots, doc }) {
  return {
    key,
    path,
    kind,
    base,
    editableSlots,
    exists: !!doc,
    title: doc?.draft?.title || doc?.live?.title || key,
    status: doc?.status || (base ? 'live' : 'draft'),
    locked: doc?.locked ?? !!base,
    hasUnpublishedChanges: doc?.hasUnpublishedChanges || false,
    updatedAt: doc?.updatedAt || null,
    seoReady: null, // filled by the SEO manager, not needed for the list
  };
}

async function create(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const body = await readJson(req);
  const parsed = pageCreateSchema.safeParse(body);
  if (!parsed.success) throw validationError(fieldErrors(parsed.error));

  const meta = parsed.data;
  const col = await pages();

  // A composed page must not collide with one of the 8 overlay URLs or an existing page.
  const path = '/' + meta.slug;
  if (Object.values(COMPILED_PAGES).some((t) => t.path === path)) {
    throw validationError({ slug: 'That URL is reserved by an existing page.' });
  }

  const doc = buildPageInsert(meta, { title: meta.title || meta.slug, sections: [] }, { updatedBy: session.role });
  const { insertedId } = await col.insertOne(doc); // unique index on path -> 409 on a race
  audit(session, 'page.create', path, `created composed page ${meta.slug}`);
  res.status(201).json({ key: meta.slug, id: String(insertedId), path });
}

export default withErrors(methods({ GET: list, POST: create }));
