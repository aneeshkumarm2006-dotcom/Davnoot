/* Audit log + revision snapshots — the safety net behind every /admin write.
 *
 * Both are fire-and-forget from the caller's perspective: a failure to log must
 * never fail the actual save. The audit log answers "who changed the homepage";
 * revisions answer "put it back".
 */
import { auditLog, pageRevisions } from './db.js';

/** Record an admin action. Never throws into the response path. */
export function audit(session, action, target, summary, extra = {}) {
  auditLog()
    .then((col) =>
      col.insertOne({
        at: new Date(),
        by: session?.role || 'unknown',
        role: session?.role || 'unknown',
        action,
        target,
        summary,
        ...extra,
      }),
    )
    .catch((err) => console.error('[audit] write failed:', err));
}

/**
 * Snapshot the pre-image of a page before it is overwritten. Bounded to `keep`
 * newest per page (a TTL also sweeps anything older than 180 days). Best-effort.
 */
export async function snapshotRevision(page, session, { keep = 50 } = {}) {
  if (!page?._id) return;
  try {
    const col = await pageRevisions();
    await col.insertOne({
      pageId: page._id,
      version: page.version || 0,
      at: new Date(),
      by: session?.role || 'unknown',
      doc: { live: page.live, draft: page.draft, seo: page.seo, status: page.status },
    });
    // Trim to the newest `keep`.
    const old = await col
      .find({ pageId: page._id })
      .sort({ version: -1, at: -1 })
      .skip(keep)
      .project({ _id: 1 })
      .toArray();
    if (old.length) await col.deleteMany({ _id: { $in: old.map((d) => d._id) } });
  } catch (err) {
    console.error('[revision] snapshot failed:', err);
  }
}
