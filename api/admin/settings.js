/* GET /api/admin/settings — the effective site settings (defaults + stored diff).
 * PUT /api/admin/settings — store a settings diff (admin only).
 *
 * Settings changes have the highest blast radius on the site (they touch every
 * page), so writes are admin-only and audited. The deep render integration
 * (making lib/templates.js read the stored diff) is tracked separately; this
 * persists and returns the effective values today.
 */
import { withErrors, methods, readJson, ApiError } from '../../lib/api.js';
import { requireRole } from '../../lib/auth.js';
import { settings } from '../../lib/db.js';
import { SITE_DEFAULTS, mergeSettings } from '../../lib/site-defaults.js';
import { audit } from '../../lib/audit.js';

async function get(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;
  const stored = await (await settings()).findOne({ _id: 'site' });
  const { _id, ...diff } = stored || {};
  res.status(200).json({ defaults: SITE_DEFAULTS, effective: mergeSettings(diff), diff });
}

async function put(req, res) {
  const session = await requireRole(req, res, 'admin'); // highest blast radius -> admin only
  if (!session) return;
  const body = await readJson(req);
  if (!body || typeof body !== 'object') throw new ApiError(400, 'Invalid settings.');

  const { _id, ...diff } = body;
  await (await settings()).updateOne(
    { _id: 'site' },
    { $set: { ...diff, updatedAt: new Date(), updatedBy: session.role } },
    { upsert: true },
  );
  audit(session, 'settings.update', 'site', 'settings changed');
  res.status(200).json({ ok: true, effective: mergeSettings(diff) });
}

export default withErrors(methods({ GET: get, PUT: put }));
