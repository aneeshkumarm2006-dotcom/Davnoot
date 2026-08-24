/* GET    /api/admin/leads   — the booking inbox: real leads, quarantined spam, and
 *                             the 30-day bin of submissions that were blocked outright.
 * PATCH  /api/admin/leads   — update a lead's status/notes, or re-file it as spam / not spam.
 * DELETE /api/admin/leads   — permanently delete leads by id, or empty the whole Spam tab.
 */
import { withErrors, methods, readJson, validationError, ApiError } from '../../../lib/api.js';
import { requireRole } from '../../../lib/auth.js';
import { leads, blockedSubmissions } from '../../../lib/db.js';
import { audit } from '../../../lib/audit.js';
import { SPAM_CATEGORIES, SPAM_CATEGORY_KEYS } from '../../../lib/spam.js';

const STATUSES = new Set(['new', 'contacted', 'won', 'lost']);
const CATEGORIES = new Set(SPAM_CATEGORY_KEYS);

/* Where a lead came in. Two intakes write to this collection now — the strategy-
 * call form (api/book-call.js) and the funnel-teardown modal on the blog
 * (api/funnel-teardown.js) — and they carry different fields, so the inbox has to
 * know which shape it is rendering.
 *
 * Documents written before the teardown existed have no `source` at all, and are
 * treated as 'book-call' on READ rather than being backfilled: the inference is
 * exact (nothing else could have written them), and a migration that rewrites
 * every historical lead to add a field the code can derive is a risk taken for
 * nothing. Keep in sync with the labels in src/admin/views/leads.js. */
export const LEAD_SOURCES = [
  { key: 'book-call', label: 'Booking form' },
  { key: 'funnel-teardown', label: 'Blog teardown' },
];
const SOURCE_KEYS = new Set(LEAD_SOURCES.map((s) => s.key));

/* `promo` was the original hand-set "this is junk" flag, from before the
 * classifier existed. Documents written under it are still in the collection and
 * still have to disappear from the inbox, so it is folded into `spam` on read
 * rather than migrated — one less destructive backfill, and the old admin's
 * "Mark as promotion" clicks keep meaning what the person meant by them. */
function normalise(doc) {
  const spam = doc.spam === true || (doc.spam == null && doc.promo === true);
  const source = SOURCE_KEYS.has(doc.source) ? doc.source : 'book-call';
  return {
    ...doc,
    _id: String(doc._id),
    spam,
    spamCategory: doc.spamCategory || (spam ? 'manual' : null),
    spamScore: doc.spamScore ?? null,
    spamReasons: doc.spamReasons || [],
    source,
    website: doc.website || '',
    sourceUrl: doc.sourceUrl || '',
    /* Tri-state, and the resolution happens HERE so the client never has to guess.
     *   true/false  a notification was attempted, and this is how it went
     *   null        none was ever attempted — the intake does not notify
     *
     * Teardowns don't notify at all (api/funnel-teardown.js), so a missing flag on
     * one means null. A missing flag on a booking lead means the opposite — those
     * always attempt, so absence is an old document from before the flag existed,
     * and `false` is the truthful reading. Collapsing the two would either paint a
     * red "failed" on every teardown or quietly excuse a booking lead that never
     * got emailed. */
    emailSent: doc.emailSent == null
      ? (source === 'funnel-teardown' ? null : false)
      : doc.emailSent,
  };
}

async function list(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const [rows, blocked] = await Promise.all([
    (await leads()).find({}).sort({ createdAt: -1 }).limit(500).toArray(),
    // The blocked bin is smaller and colder; it exists to be audited for false
    // positives, not worked, so a shorter window is plenty.
    (await blockedSubmissions()).find({}).sort({ at: -1 }).limit(200).toArray(),
  ]);

  const all = rows.map(normalise);
  const real = all.filter((r) => !r.spam);

  res.status(200).json({
    leads: all,
    blocked: blocked.map((b) => ({ ...normalise({ ...b, _id: b._id }), createdAt: b.at })),
    // Counts only genuine unworked leads. This drives the sidebar badge, and a
    // badge that includes spam is a badge nobody trusts within a week.
    unread: real.filter((r) => r.status === 'new').length,
    spamCount: all.length - real.length,
    // Shipped with the payload rather than duplicated in the client, so a
    // category the classifier can assign always has a label to render. It also
    // keeps src/ free of any import from lib/ — see the guard in
    // scripts/imports.test.js for why that matters more than it looks.
    categories: SPAM_CATEGORIES,
    // Same contract for the intake labels: shipped, never restated in the client.
    sources: LEAD_SOURCES,
    // Per-intake breakdown of the real inbox, so "the blog modal is working" is
    // answerable at a glance without exporting the CSV.
    bySource: Object.fromEntries(
      LEAD_SOURCES.map((s) => [s.key, real.filter((r) => r.source === s.key).length]),
    ),
  });
}

async function patch(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;
  const { ObjectId } = await import('mongodb');
  const body = await readJson(req);
  let _id;
  try { _id = new ObjectId(body?.id); } catch { throw new ApiError(400, 'Bad lead id.'); }

  const $set = {};
  if (body.status != null) {
    if (!STATUSES.has(body.status)) throw validationError({ status: 'Unknown status.' });
    $set.status = body.status;
  }
  if (typeof body.notes === 'string') $set.notes = body.notes.slice(0, 4000);

  /* Re-filing a lead. `spam: true` hides it behind the Spam tab; `spam: false`
   * is the correction path for a classifier mistake and must clear the machine's
   * reasoning with it, otherwise the row still displays the score that got it
   * wrong. `promo` is written in lockstep so the legacy flag can never contradict
   * the new one on a document that carries both. */
  if (typeof body.spam === 'boolean') {
    $set.spam = body.spam;
    $set.promo = body.spam;
    if (body.spam) {
      const cat = body.spamCategory || 'manual';
      if (!CATEGORIES.has(cat)) throw validationError({ spamCategory: 'Unknown category.' });
      $set.spamCategory = cat;
    } else {
      $set.spamCategory = null;
      $set.spamScore = null;
      $set.spamReasons = [];
    }
  } else if (typeof body.promo === 'boolean') {
    // Back-compat with any older client still sending the promo flag alone.
    $set.spam = body.promo;
    $set.promo = body.promo;
    $set.spamCategory = body.promo ? 'manual' : null;
  }

  if (!Object.keys($set).length) throw new ApiError(400, 'Nothing to update.');

  const r = await (await leads()).updateOne({ _id }, { $set });
  if (r.matchedCount === 0) throw new ApiError(404, 'No such lead.');
  audit(session, 'lead.update', String(_id), Object.keys($set).join(', '));
  res.status(200).json({ ok: true });
}

/* Deleting is admin-only and irreversible, which is why it is not offered for
 * anything the classifier merely SUSPECTS. `{ purge: 'spam' }` empties the Spam
 * tab in one call — the realistic maintenance action when a flood has been sitting
 * there — and explicit ids cover deleting a single row. */
async function remove(req, res) {
  const session = await requireRole(req, res, 'admin');
  if (!session) return;
  const body = await readJson(req);
  const col = await leads();

  if (body?.purge === 'spam') {
    const r = await col.deleteMany({ $or: [{ spam: true }, { promo: true }] });
    audit(session, 'lead.purge', 'spam', `${r.deletedCount} deleted`);
    return res.status(200).json({ ok: true, deleted: r.deletedCount });
  }

  const ids = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length) throw new ApiError(400, 'Nothing to delete.');
  const { ObjectId } = await import('mongodb');
  let oids;
  try { oids = ids.map((id) => new ObjectId(id)); } catch { throw new ApiError(400, 'Bad lead id.'); }

  const r = await col.deleteMany({ _id: { $in: oids } });
  audit(session, 'lead.delete', ids.join(','), `${r.deletedCount} deleted`);
  res.status(200).json({ ok: true, deleted: r.deletedCount });
}

export default withErrors(methods({ GET: list, PATCH: patch, DELETE: remove }));
