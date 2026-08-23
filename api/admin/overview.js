/* GET /api/admin/overview — the dashboard home: counts, drafts, unread leads, feed. */
import { withErrors, methods } from '../../lib/api.js';
import { requireRole } from '../../lib/auth.js';
import { pages, posts, leads, media, auditLog, IS_PREVIEW_ENV } from '../../lib/db.js';
import { COMPILED_PAGES } from '../../lib/compiled-pages.gen.js';

async function overview(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const [pageDocs, postCounts, unreadLeads, mediaCount, recent] = await Promise.all([
    (await pages()).find({}).project({ path: 1, base: 1, status: 1, hasUnpublishedChanges: 1 }).toArray(),
    (await posts()).aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    // Spam is excluded deliberately. Before the classifier existed this badge
    // read "62 unread" while 61 of them were bots, which is the same as reading
    // nothing at all — a notification you learn to ignore has negative value.
    // `promo` is the pre-classifier hand-set flag; both must be absent.
    (await leads()).countDocuments({ status: 'new', spam: { $ne: true }, promo: { $ne: true } }),
    (await media()).countDocuments({}),
    (await auditLog()).find({}).sort({ at: -1 }).limit(10).toArray(),
  ]);

  const overlayCount = Object.keys(COMPILED_PAGES).length;
  const composed = pageDocs.filter((d) => d.base === null);
  const drafts = pageDocs.filter((d) => d.hasUnpublishedChanges).length;
  const postsByStatus = Object.fromEntries(postCounts.map((c) => [c._id, c.n]));

  res.status(200).json({
    role: session.role,
    // Surfaced so the admin shell can show a loud "editing the PREVIEW database"
    // banner. On a preview deploy, lib/db.js has already isolated the DB, but the
    // human still needs to know their publishes won't reach production.
    previewEnv: IS_PREVIEW_ENV,
    pages: { total: overlayCount + composed.length, marketing: overlayCount, composed: composed.length, unpublishedDrafts: drafts },
    posts: { published: postsByStatus.published || 0, draft: postsByStatus.draft || 0 },
    leads: { unread: unreadLeads },
    media: { total: mediaCount },
    activity: recent.map((r) => ({ ...r, _id: String(r._id) })),
  });
}

export default withErrors(methods({ GET: overview }));
