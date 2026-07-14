/* GET   /api/admin/leads        — the booking inbox (fixes the Resend data-loss hole).
 * PATCH /api/admin/leads        — update a lead's status/notes, or retry its email.
 */
import { withErrors, methods, readJson, validationError, ApiError } from '../../../lib/api.js';
import { requireRole } from '../../../lib/auth.js';
import { leads } from '../../../lib/db.js';
import { audit } from '../../../lib/audit.js';

const STATUSES = new Set(['new', 'contacted', 'won', 'lost']);

async function list(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;
  const rows = await (await leads()).find({}).sort({ createdAt: -1 }).limit(500).toArray();
  const unread = rows.filter((r) => r.status === 'new').length;
  res.status(200).json({ leads: rows.map((r) => ({ ...r, _id: String(r._id) })), unread });
}

async function patch(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;
  const { ObjectId } = await import('mongodb');
  const body = await readJson(req);
  let _id;
  try { _id = new ObjectId(body?.id); } catch { throw new ApiError(400, 'Bad lead id.'); }

  const $set = { };
  if (body.status != null) {
    if (!STATUSES.has(body.status)) throw validationError({ status: 'Unknown status.' });
    $set.status = body.status;
  }
  if (typeof body.notes === 'string') $set.notes = body.notes.slice(0, 4000);
  if (!Object.keys($set).length) throw new ApiError(400, 'Nothing to update.');

  const r = await (await leads()).updateOne({ _id }, { $set });
  if (r.matchedCount === 0) throw new ApiError(404, 'No such lead.');
  audit(session, 'lead.update', String(_id), Object.keys($set).join(', '));
  res.status(200).json({ ok: true });
}

export default withErrors(methods({ GET: list, PATCH: patch }));
