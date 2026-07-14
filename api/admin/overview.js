/* GET /api/admin/overview — the dashboard home: counts, drafts, unread leads, feed. */
import { withErrors, methods } from '../../lib/api.js';
import { requireRole } from '../../lib/auth.js';
import { pages, posts, leads, media, auditLog } from '../../lib/db.js';
import { COMPILED_PAGES } from '../../lib/compiled-pages.gen.js';

async function overview(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const [pageDocs, postCounts, unreadLeads, mediaCount, recent] = await Promise.all([
    (await pages()).find({}).project({ path: 1, base: 1, status: 1, hasUnpublishedChanges: 1 }).toArray(),
    (await posts()).aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    (await leads()).countDocuments({ status: 'new' }),
    (await media()).countDocuments({}),
    (await auditLog()).find({}).sort({ at: -1 }).limit(10).toArray(),
  ]);

  const overlayCount = Object.keys(COMPILED_PAGES).length;
  const composed = pageDocs.filter((d) => d.base === null);
  const drafts = pageDocs.filter((d) => d.hasUnpublishedChanges).length;
  const postsByStatus = Object.fromEntries(postCounts.map((c) => [c._id, c.n]));

  res.status(200).json({
    role: session.role,
    pages: { total: overlayCount + composed.length, marketing: overlayCount, composed: composed.length, unpublishedDrafts: drafts },
    posts: { published: postsByStatus.published || 0, draft: postsByStatus.draft || 0 },
    leads: { unread: unreadLeads },
    media: { total: mediaCount },
    activity: recent.map((r) => ({ ...r, _id: String(r._id) })),
  });
}

export default withErrors(methods({ GET: overview }));
