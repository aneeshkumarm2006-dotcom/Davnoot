/* GET  /api/admin/pages/:key/revisions        — list the page's revisions.
 * POST /api/admin/pages/:key/revisions {version} — restore one into the draft.
 *
 * Restore writes the old snapshot back into `draft` (never straight to live), so a
 * rollback is itself reviewable and publishable — one bad restore can't take the
 * page live without a publish.
 */
import { withErrors, methods, readJson, ApiError } from '../../../../lib/api.js';
import { requireRole } from '../../../../lib/auth.js';
import { pages, pageRevisions } from '../../../../lib/db.js';
import { COMPILED_PAGES } from '../../../../lib/compiled-pages.gen.js';
import { audit, snapshotRevision } from '../../../../lib/audit.js';

function pathFor(key) {
  const tpl = COMPILED_PAGES[key];
  return tpl ? tpl.path : '/' + String(key).replace(/^\/+/, '');
}

async function get(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;
  const path = pathFor(req.query.id);
  const page = await (await pages()).findOne({ path }, { projection: { _id: 1 } });
  if (!page) return res.status(200).json({ revisions: [] });
  const rows = await (await pageRevisions())
    .find({ pageId: page._id })
    .sort({ version: -1, at: -1 })
    .limit(50)
    .project({ doc: 0 })
    .toArray();
  res.status(200).json({ revisions: rows.map((r) => ({ ...r, _id: String(r._id), pageId: String(r.pageId) })) });
}

async function restore(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;
  const path = pathFor(req.query.id);
  const body = await readJson(req);
  const version = Number(body?.version);

  const col = await pages();
  const page = await col.findOne({ path });
  if (!page) throw new ApiError(404, 'No such page.');

  const rev = await (await pageRevisions()).findOne({ pageId: page._id, version });
  if (!rev) throw new ApiError(404, 'No such revision.');

  await snapshotRevision(page, session); // snapshot the CURRENT state before overwriting
  await col.updateOne(
    { path },
    { $set: { draft: rev.doc?.draft || {}, hasUnpublishedChanges: true, updatedAt: new Date() }, $inc: { version: 1 } },
  );
  audit(session, 'page.restore', path, `restored revision ${version} into draft`);
  res.status(200).json({ ok: true });
}

export default withErrors(methods({ GET: get, POST: restore }));
