/* GET    /api/admin/redirects   — list.
 * POST   /api/admin/redirects   — create (admin only).
 * DELETE /api/admin/redirects?source=/old  — remove.
 *
 * Applied by api/page.js on the 404 path, so a redirect only fires for a path
 * that reaches the page renderer (the explicit .html rewrites and the /:slug
 * catch-all — i.e. single-segment paths). The UI says as much.
 */
import { withErrors, methods, readJson, validationError, ApiError } from '../../../lib/api.js';
import { requireRole } from '../../../lib/auth.js';
import { redirects } from '../../../lib/db.js';
import { audit } from '../../../lib/audit.js';

const PATH_RE = /^\/[^\s]*$/;

async function list(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;
  const rows = await (await redirects()).find({}).sort({ createdAt: -1 }).toArray();
  res.status(200).json({ redirects: rows.map((r) => ({ ...r, _id: String(r._id) })) });
}

async function create(req, res) {
  const session = await requireRole(req, res, 'admin');
  if (!session) return;
  const body = await readJson(req);
  const source = String(body?.source || '').trim();
  const destination = String(body?.destination || '').trim();
  const status = Number(body?.status) === 302 ? 302 : Number(body?.status) === 410 ? 410 : 308;

  const errs = {};
  if (!PATH_RE.test(source)) errs.source = 'Must be a path starting with /';
  if (status !== 410 && !(destination.startsWith('/') || /^https?:\/\//.test(destination)))
    errs.destination = 'Must be a path or a full URL (or use 410 Gone).';
  if (Object.keys(errs).length) throw validationError(errs);

  await (await redirects()).insertOne({
    source, destination: status === 410 ? null : destination, status,
    hits: 0, createdAt: new Date(), createdBy: session.role,
  }); // unique index on source -> 409 on a duplicate
  audit(session, 'redirect.create', source, `-> ${destination} (${status})`);
  res.status(201).json({ ok: true });
}

async function del(req, res) {
  const session = await requireRole(req, res, 'admin');
  if (!session) return;
  const source = req.query?.source;
  if (!source) throw new ApiError(400, 'Which redirect?');
  await (await redirects()).deleteOne({ source });
  audit(session, 'redirect.delete', source, 'removed');
  res.status(200).json({ ok: true });
}

export default withErrors(methods({ GET: list, POST: create, DELETE: del }));
