/* POST /api/admin/pages/:key/publish — copy draft -> live (make edits go live).
 *
 * Optional body: { scheduledAt } to schedule (a future date) or backdate. A
 * scheduled page stays status:'live' but livePageFilter hides it until the date —
 * no cron. Middleware is not the boundary: role is re-checked here.
 */
import { withErrors, methods, readJson, ApiError } from '../../../../lib/api.js';
import { requireRole } from '../../../../lib/auth.js';
import { pages } from '../../../../lib/db.js';
import { COMPILED_PAGES } from '../../../../lib/compiled-pages.gen.js';
import { buildPublishOps } from '../../../../lib/page-model.js';
import { audit, snapshotRevision } from '../../../../lib/audit.js';

function pathFor(key) {
  const tpl = COMPILED_PAGES[key];
  return tpl ? tpl.path : '/' + String(key).replace(/^\/+/, '');
}

async function publish(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const path = pathFor(req.query.id);
  const body = await readJson(req).catch(() => ({}));
  const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : undefined;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new ApiError(400, 'Invalid schedule date.');

  const col = await pages();
  const existing = await col.findOne({ path });
  if (!existing) throw new ApiError(404, 'Nothing to publish — save a draft first.');

  await snapshotRevision(existing, session);
  await col.updateOne({ path }, buildPublishOps(existing, { scheduledAt }));
  audit(session, 'page.publish', path, scheduledAt ? `scheduled for ${scheduledAt.toISOString()}` : 'published');
  res.status(200).json({ ok: true, scheduledAt: scheduledAt || null });
}

export default withErrors(methods({ POST: publish }));
