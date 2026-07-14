/* GET /api/admin/audit — the recent activity feed (who changed what, when). */
import { withErrors, methods } from '../../lib/api.js';
import { requireRole } from '../../lib/auth.js';
import { auditLog } from '../../lib/db.js';

async function list(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;
  const limit = Math.min(Number(req.query?.limit) || 100, 500);
  const rows = await (await auditLog()).find({}).sort({ at: -1 }).limit(limit).toArray();
  res.status(200).json({ entries: rows.map((r) => ({ ...r, _id: String(r._id) })) });
}

export default withErrors(methods({ GET: list }));
