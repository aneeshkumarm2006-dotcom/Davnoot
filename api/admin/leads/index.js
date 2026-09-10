/* GET    /api/admin/leads   — the booking inbox: real leads, quarantined spam, and
 *                             the 30-day bin of submissions that were blocked outright.
 * PATCH  /api/admin/leads   — update a lead's status/notes, or re-file it as spam / not spam.
 * DELETE /api/admin/leads   — permanently delete leads by id, or empty the whole Spam tab.
 */
import { withErrors, methods, readJson, validationError, ApiError } from '../../../lib/api.js';
import { requireRole } from '../../../lib/auth.js';
import { leads, blockedSubmissions } from '../../../lib/db.js';
import { audit } from '../../../lib/audit.js';
import { SPAM_CATEGORIES, SPAM_CATEGORY_KEYS, AUDIT_SCOPES } from '../../../lib/spam.js';

const STATUSES = new Set(['new', 'contacted', 'won', 'lost']);
const CATEGORIES = new Set(SPAM_CATEGORY_KEYS);

/* Where a lead came in. FOUR intakes write to this collection now — the strategy-call
 * form (api/book-call.js), the funnel-teardown modal on the blog
 * (api/funnel-teardown.js), the free site-audit request (api/site-audit.js) and the
 * content-analyzer's optional review card (api/content-review.js) — and they carry
 * different fields, so the inbox has to know which shape it is rendering.
 *
 * Documents written before the teardown existed have no `source` at all, and are
 * treated as 'book-call' on READ rather than being backfilled: the inference is
 * exact (nothing else could have written them), and a migration that rewrites
 * every historical lead to add a field the code can derive is a risk taken for
 * nothing. Keep in sync with the labels in src/admin/views/leads.js.
 *
 * ORDER IS THE UI ORDER — the client renders the source filter chips straight from
 * this array, so the two doors that oblige somebody to do work sit first. */
export const LEAD_SOURCES = [
  { key: 'book-call', label: 'Booking form' },
  { key: 'site-audit', label: 'Site audit' },
  { key: 'funnel-teardown', label: 'Blog teardown' },
  { key: 'content-review', label: 'Content review' },
];
const SOURCE_KEYS = new Set(LEAD_SOURCES.map((s) => s.key));

/* Which intakes never attempt a notification email, by design.
 *
 * This set is the whole basis of the tri-state `emailSent` resolution below, and it
 * has to be a LIST rather than the old `source === 'funnel-teardown'` check now that
 * two sources are admin-only. Getting it wrong is not cosmetic in either direction:
 * a source missing from here paints a red "failed" pill on every one of its leads and
 * has the operator chasing an outage that does not exist, while a source wrongly
 * listed here would quietly excuse a booking lead that genuinely never got emailed.
 *
 * Each entry is justified at its endpoint — see the NO NOTIFICATION EMAIL notes in
 * api/funnel-teardown.js and api/content-review.js. If one of them is ever switched
 * to notify, remove it here in the same commit. */
const NON_NOTIFYING = new Set(['funnel-teardown', 'content-review']);

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
    // Site-audit fields. Absent on every other intake, so they default rather than
    // being conditioned on `source` — the client drops empty values anyway, and a
    // shape that depends on the source is a shape that breaks when a source changes.
    phone: doc.phone || '',
    auditScope: doc.auditScope || '',
    /* Content-review payload: what they pasted into the analyzer and what it scored.
     * Passed through whole. It is the reason that intake exists — "someone wants
     * content help" is not actionable, the draft is — and the only consumer is the
     * detail dialog, which reads it defensively. */
    analysis: doc.analysis || null,
    /* Tri-state, and the resolution happens HERE so the client never has to guess.
     *   true/false  a notification was attempted, and this is how it went
     *   null        none was ever attempted — the intake does not notify
     *
     * The NON_NOTIFYING sources don't notify at all, so a missing flag on one of
     * those means null. A missing flag on a booking or audit lead means the opposite —
     * those always attempt, so absence is an old document from before the flag
     * existed, and `false` is the truthful reading. Collapsing the two would either
     * paint a red "failed" on every teardown or quietly excuse a booking lead that
     * never got emailed. */
    emailSent: doc.emailSent == null
      ? (NON_NOTIFYING.has(source) ? null : false)
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
    // And for the audit form's scope codes, which lib/spam.js owns. The client has
    // no way to read lib/ (scripts/imports.test.js guards that boundary), so a
    // hand-copied map there would render "undefined" the first time a code changes.
    auditScopes: AUDIT_SCOPES,
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
