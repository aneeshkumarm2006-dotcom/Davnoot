/* POST /api/funnel-teardown
 *
 * The second front door into the leads inbox: the "Free 15-min funnel teardown"
 * modal that fires on /blog/* pages (see the LEAD MAGNET MODAL section of
 * script.js). Two fields — email and website — versus the booking form's seven.
 *
 * WHERE THE LEAD GOES — AND WHERE IT DOESN'T
 * ------------------------------------------
 * It goes into the SAME `leads` collection as /api/book-call, tagged
 * `source: 'funnel-teardown'` and carrying the visitor's `website`. Not a separate
 * store, and not an external ESP: /admin already has an inbox with statuses, notes,
 * a spam tab, a blocked bin and a CSV export, and a lead that lands anywhere else
 * is a lead nobody works.
 *
 * It does NOT go to your inbox. Unlike the booking form, this endpoint sends NO
 * notification email — see the note further down for why, and for what to know if
 * you ever switch it back on. /admin → Leads is the destination, and the sidebar's
 * unread badge is the signal.
 *
 * Env vars: GMAIL_USER / GMAIL_APP_PASSWORD (only for the visitor's confirmation),
 * optional LEAD_TO, optional TURNSTILE_SECRET_KEY. Nothing new to configure.
 */
import { leads, blockedSubmissions } from '../lib/db.js';
import { classifyTeardown, contentHash, ipPrefix, EMAIL_RE, TEARDOWN_HASH_FIELDS } from '../lib/spam.js';
import {
  clientIp, verifyTurnstile, turnstileEnabled,
  mailer, mailFrom, mailTo, mailConfigured,
  dwellFrom, throttle, normalizeWebsite, esc,
} from '../lib/lead-intake.js';

/** What the visitor was promised. Stored on the lead and quoted back in their confirmation. */
const OFFER = 'Free 15-min funnel teardown';

/* ── Auto-reply to the visitor ────────────────────────────────────────────
 * Only ever sent to a Turnstile-verified human (see the note at the call site).
 * It repeats the "no pitch" promise, because the whole offer rests on it. */

function buildClientEmail(d) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#e8eee9;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eee9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #d4ddd5;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #eef1ee;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Davnoot Digital</td></tr>
        <tr><td style="padding:28px 28px 6px;">
          <h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Your funnel teardown is booked in.</h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#545b55;">We'll go through <strong style="color:#0a0a0a;">${esc(d.website)}</strong> — the ad, the click, the landing page, the form — and come back within one business day with where the spend is leaking and what we'd change first.</p>
          <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#545b55;">No pitch. Just the audit. If you want to talk after reading it, you'll tell us.</p>
        </td></tr>
        <tr><td style="padding:18px 28px 30px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#545b55;">Anything we should look at first? Just reply to this email.</p>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f5f8f5;border-top:1px solid #eef1ee;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#8d958e;">Davnoot Digital · Independent growth agency · Montreal, QC</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildClientText(d) {
  return [
    'Your funnel teardown is booked in.',
    '',
    `We'll go through ${d.website} — the ad, the click, the landing page, the form — and come back within one business day with where the spend is leaking and what we'd change first.`,
    '',
    'No pitch. Just the audit. If you want to talk after reading it, you\'ll tell us.',
    '',
    'Anything we should look at first? Just reply to this email.',
    '',
    'Davnoot Digital · Montreal, QC',
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const d = (typeof req.body === 'string' ? safeJson(req.body) : req.body) || {};

  // Honeypot — silently accept bots without sending or persisting.
  if (d['bot-field']) return res.status(200).json({ ok: true });

  const email = String(d.email || '').trim().slice(0, 320);
  // Validated here rather than left to the classifier so a human who fat-fingers
  // their address is TOLD, instead of getting a cheerful "check your inbox" for a
  // teardown that can never arrive. Classification is for bots, not for typos.
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.', field: 'email' });
  }

  const site = normalizeWebsite(d.website);
  if (!site) {
    return res.status(400).json({ error: 'Please enter your website, e.g. acme.com.', field: 'website' });
  }

  const ip = clientIp(req);
  const prefix = ipPrefix(ip);
  const lowerEmail = email.toLowerCase();
  const hash = contentHash({ websiteHost: site.host }, TEARDOWN_HASH_FIELDS);
  const { dwellMs, hasJsStamp } = dwellFrom(d.t0);

  // ── ANTI-SPAM: TURNSTILE ──────────────────────────────────────────────────
  // Enforced only once TURNSTILE_SECRET_KEY is set. The modal mounts the same
  // widget the booking form does (script.js shares one loader), so switching the
  // env var on protects BOTH doors at once — which is the whole reason the
  // widget is script-injected rather than baked into markup.
  let verifiedHuman = false;
  if (turnstileEnabled()) {
    verifiedHuman = await verifyTurnstile(d['cf-turnstile-response'], ip);
    if (!verifiedHuman) {
      return res.status(400).json({ error: "Couldn't verify you're human. Please refresh and try again." });
    }
  }

  // ── ANTI-SPAM: RATE LIMIT (per IP, email and /24) ──────────────────────────
  const { limited, duplicateCount } = await throttle({ ip, prefix, email: lowerEmail, hash });
  if (limited) {
    return res.status(429).json({ error: 'Too many submissions. Please try again in a few minutes.' });
  }

  // ── ANTI-SPAM: CLASSIFY ────────────────────────────────────────────────────
  const verdict = classifyTeardown({ email, websiteHost: site.host }, { hasJsStamp, dwellMs, duplicateCount });

  const lead = {
    // `source` is what the admin inbox filters and labels on. Every document
    // written by this route carries it; book-call documents predate it and are
    // treated as 'book-call' on read (api/admin/leads/index.js).
    source: 'funnel-teardown',
    offer: OFFER,
    email,
    website: site.url,
    websiteHost: site.host,
    // The booking form's shape, left empty rather than faked. The inbox renders a
    // teardown row from `website`; inventing a name here would put a string in the
    // CRM that the person never typed.
    name: '',
    company: '',
    role: '',
    service: '',
    timeSlot: '',
    brief: '',
    // Which article was being read when they asked. The single most useful thing
    // to know before writing the teardown, and free to collect.
    sourceUrl: String(d.sourceUrl || '').slice(0, 500),
  };

  if (verdict.verdict === 'reject') {
    // 200, not 4xx, and deliberately: an error teaches the sender which rule it
    // tripped. The submission is kept for 30 days in blocked_submissions so a
    // false positive is one click from being spotted in /admin.
    console.warn(`[funnel-teardown] blocked (${verdict.category}, ${verdict.score}): ${verdict.reasons.join('; ')}`);
    try {
      await (await blockedSubmissions()).insertOne({
        ...lead,
        ip,
        prefix,
        spamCategory: verdict.category,
        spamScore: verdict.score,
        spamReasons: verdict.reasons,
        at: new Date(),
      });
    } catch (err) {
      console.error('Blocked-submission log failed (non-fatal):', String(err?.message || err));
    }
    return res.status(200).json({ ok: true });
  }

  const isSpam = verdict.verdict === 'quarantine';

  // ── PERSIST FIRST ────────────────────────────────────────────────────────
  let leadId = null;
  try {
    const col = await leads();
    const { insertedId } = await col.insertOne({
      ...lead,
      status: 'new',
      notes: '',
      // null, not false: `false` means "we tried to notify and it failed", which is
      // what the admin's red "failed" pill is for. Nothing is tried here — see the
      // NO NOTIFICATION EMAIL note below — so null is the honest value, and the
      // admin renders it as "admin only".
      emailSent: null,
      emailError: null,
      createdAt: new Date(),
      spam: isSpam,
      spamCategory: isSpam ? verdict.category : null,
      spamScore: verdict.score,
      spamReasons: verdict.reasons,
    });
    leadId = insertedId;
  } catch (err) {
    console.error('Teardown persist error (continuing to email):', err);
  }

  if (isSpam) {
    console.warn(`[funnel-teardown] quarantined (${verdict.category}, ${verdict.score}): ${verdict.reasons.join('; ')}`);
  }

  /* ── NO NOTIFICATION EMAIL. THIS IS DELIBERATE. ───────────────────────────
   *
   * api/book-call.js emails every allowed lead to LEAD_TO. This endpoint does NOT,
   * by explicit decision (Prem, 2026-08-24): a teardown is a low-friction blog
   * ask, not a booking, and at blog volume one email per submission turns the
   * inbox that exists for real enquiries back into a feed — which is the exact
   * failure ANTISPAM.md was written to fix, just arriving through the front door
   * instead of from bots.
   *
   * So the destination for these is /admin → Leads, and only that. It is not a
   * lesser destination: the lead is persisted BEFORE anything else can fail, it
   * carries a status, notes and the spam verdict, it drives the sidebar's unread
   * badge, and it exports to CSV. Nothing is dropped — the notification channel is.
   *
   * IF YOU EVER TURN THIS BACK ON, note that leads written while it was off carry
   * `emailSent: null` (meaning "notification not applicable"), which is what the
   * admin's "admin only" pill reads. Don't backfill those to false — false means
   * "we tried and it failed", and would make historical rows look broken. */
  if (leadId) {
    console.info(`[funnel-teardown] captured ${site.host}${isSpam ? ' (held)' : ''} — admin only, no notification`);
  }

  /* The confirmation to the VISITOR is a different question and stays on: they
   * asked for a teardown and should know it landed. Gated on verifiedHuman for the
   * same reason as the booking form — this must never become a spam relay, and
   * mailing addresses a bot invented would wreck our Gmail deliverability. Until
   * Turnstile is configured this is inert, and the modal's on-screen confirmation
   * is the only acknowledgement. Never sent for a held submission: promising an
   * audit we may never write is worse than saying nothing. */
  if (verifiedHuman && !isSpam && mailConfigured()) {
    try {
      await mailer().sendMail({
        from: mailFrom(),
        to: email,
        replyTo: mailTo()[0],
        subject: `Your funnel teardown — ${site.host}`,
        html: buildClientEmail(lead),
        text: buildClientText(lead),
      });
    } catch (err) {
      console.error('Teardown confirmation email failed (non-fatal):', String(err?.message || err));
    }
  }

  return res.status(200).json({ ok: true });
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
