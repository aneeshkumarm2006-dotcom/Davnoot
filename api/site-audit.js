/* POST /api/site-audit
 *
 * The THIRD front door into the leads inbox: the "free site audit" request form on
 * /tools/site-audit.
 *
 * WHAT THIS ENDPOINT IS NOT
 * -------------------------
 * It does not audit anything. There is no crawler here, no Lighthouse run, no score
 * returned to the browser — and that is the entire product decision behind the
 * page. /tools/content-analyzer is a real tool that computes a real result in the
 * visitor's browser; this is a REQUEST FORM for work a human on the team then does
 * by hand and emails back. So the only job of this file is to capture the request
 * completely, tell us it arrived, and promise the visitor nothing the team is not
 * going to do.
 *
 * That asymmetry is why the page copy never says "instant" or "automated", and why
 * this handler returns `{ ok: true }` rather than any kind of result object: a shape
 * that looked like a result would invite someone to render it later.
 *
 * WHERE THE LEAD GOES
 * -------------------
 * Into the SAME `leads` collection as the other three intakes, tagged
 * `source: 'site-audit'`. /admin -> Leads is where it is worked: statuses, private
 * notes, the spam tab, the blocked bin and the CSV export already exist there, and a
 * lead that lands anywhere else is a lead nobody works.
 *
 * AND IT ALSO EMAILS US. Unlike api/funnel-teardown.js, this one notifies LEAD_TO on
 * every allowed request — by explicit decision (Prem, 2026-09-10). The teardown is a
 * low-friction two-field ask on a blog page; an audit request is seven fields from
 * someone who wants a named deliverable, it obliges a human to do several hours of
 * work, and the turnaround promised on the page only holds if somebody knows it came
 * in. See the note at the send site.
 *
 * Env vars: GMAIL_USER / GMAIL_APP_PASSWORD, optional LEAD_TO, optional
 * TURNSTILE_SECRET_KEY. Nothing new to configure.
 */
import { leads, blockedSubmissions } from '../lib/db.js';
import {
  classifyAudit, contentHash, ipPrefix, EMAIL_RE, AUDIT_HASH_FIELDS, AUDIT_SCOPES,
} from '../lib/spam.js';
import {
  clientIp, verifyTurnstile, turnstileEnabled,
  mailer, mailFrom, mailTo, mailConfigured,
  dwellFrom, throttle, normalizeWebsite, esc,
} from '../lib/lead-intake.js';

/** What the visitor was promised. Stored on the lead and quoted back to them. */
const OFFER = 'Free website audit';

/** Turnaround from request to delivered audit. The PAGE says the same thing;
 *  change both or neither — a confirmation email that contradicts the page the
 *  person just read is worse than one that says nothing. */
const TURNAROUND = 'three business days';

const SCOPE_LABELS = Object.fromEntries(AUDIT_SCOPES.map((s) => [s.key, s.label]));

/* ── Notification to US ───────────────────────────────────────────────────── */

function row(label, value, isLast) {
  if (!value) return '';
  const border = isLast ? '' : 'border-bottom:1px solid #eef1ee;';
  return `<tr>
    <td style="padding:11px 0;${border}width:140px;vertical-align:top;font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8d958e;">${esc(label)}</td>
    <td style="padding:11px 0;${border}font-size:14px;line-height:1.5;color:#0a0a0a;">${esc(value)}</td>
  </tr>`;
}

function buildTeamEmail(d) {
  const rows = [
    row('Website', d.website),
    row('Name', d.name),
    row('Email', d.email),
    row('Company', d.company),
    row('Phone', d.phone),
    row('Wants audited', SCOPE_LABELS[d.auditScope] || d.auditScope),
    row('Notes', d.brief, true),
  ].join('');

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#e8eee9;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eee9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #d4ddd5;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #eef1ee;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Davnoot Digital</td>
            <td align="right"><span style="font-family:'Courier New',monospace;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;background:#0a0a0a;border-radius:6px;padding:5px 11px;">Audit request</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 28px 6px;">
          <h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Someone asked for a site audit</h1>
          <p style="margin:7px 0 0;font-size:14px;line-height:1.5;color:#545b55;">They have been told a person will go through their site and send the findings within ${esc(TURNAROUND)}. The clock is running.</p>
        </td></tr>
        <tr><td style="padding:14px 28px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td></tr>
        <tr><td style="padding:18px 28px 30px;">
          <a href="${esc(d.website)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 24px;border-radius:100px;">Open their site &rarr;</a>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f5f8f5;border-top:1px solid #eef1ee;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#8d958e;">Sent automatically from the audit form at davnoot.com/tools/site-audit. The full record is in /admin &rarr; Leads.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildTeamText(d) {
  return [
    'New site-audit request — via davnoot.com/tools/site-audit',
    '',
    `Website:       ${d.website || ''}`,
    `Name:          ${d.name || ''}`,
    `Email:         ${d.email || ''}`,
    `Company:       ${d.company || ''}`,
    `Phone:         ${d.phone || ''}`,
    `Wants audited: ${SCOPE_LABELS[d.auditScope] || d.auditScope || ''}`,
    `Notes:         ${d.brief || ''}`,
    '',
    `Promised within ${TURNAROUND}. Reply directly to ${d.email || ''}.`,
  ].join('\n');
}

/* ── Confirmation to the VISITOR ──────────────────────────────────────────── */

function buildClientEmail(d) {
  const first = esc((d.name || 'there').split(' ')[0]);
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#e8eee9;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eee9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #d4ddd5;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #eef1ee;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Davnoot Digital</td></tr>
        <tr><td style="padding:28px 28px 6px;">
          <h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Your audit is on the list, ${first}.</h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#545b55;">Someone on our team will go through <strong style="color:#0a0a0a;">${esc(d.website)}</strong> by hand — not a scanner — and email you what we find within ${esc(TURNAROUND)}.</p>
          <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#545b55;">You will get the things actually costing you traffic or conversions, in the order we would fix them, with enough detail that your own developer could action it without us. No 40-page export, and no invoice attached.</p>
        </td></tr>
        <tr><td style="padding:18px 28px 30px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#545b55;">Anything you already suspect is wrong, or a page you want us to start with? Just reply to this email.</p>
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
    `Your audit is on the list, ${(d.name || 'there').split(' ')[0]}.`,
    '',
    `Someone on our team will go through ${d.website} by hand — not a scanner — and email you what we find within ${TURNAROUND}.`,
    '',
    'You will get the things actually costing you traffic or conversions, in the order we would fix them, with enough detail that your own developer could action it without us. No 40-page export, and no invoice attached.',
    '',
    'Anything you already suspect is wrong, or a page you want us to start with? Just reply to this email.',
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

  /* ── Validate the three required fields ────────────────────────────────────
   * Each one 400s with its own `field` so the browser can point at the box that is
   * wrong. The classifier is for bots; a person who fat-fingers their address must
   * be TOLD, not handed a cheerful confirmation for an audit that can never be
   * delivered. */
  const email = String(d.email || '').trim().slice(0, 320);
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.', field: 'email' });
  }

  const site = normalizeWebsite(d.website);
  if (!site) {
    return res.status(400).json({ error: 'Please enter the site you want audited, e.g. acme.com.', field: 'website' });
  }

  const name = String(d.name || '').trim().slice(0, 120);
  if (!name) {
    return res.status(400).json({ error: 'Please tell us your name.', field: 'name' });
  }

  /* An unknown scope is DROPPED rather than scored as a bot tell, which is the
   * opposite of how api/book-call.js treats an unknown `service`. The reason is
   * cache: these codes are new, a future copy pass could rename one, and a visitor
   * holding a stale script.js would then have a perfectly genuine request penalised
   * for a string we changed. The transport tells already cover the bot case, and an
   * audit request is not worth a reject risk for a cosmetic field. */
  const rawScope = String(d.scope || '').trim();
  const auditScope = AUDIT_SCOPES.some((s) => s.key === rawScope) ? rawScope : '';

  const ip = clientIp(req);
  const prefix = ipPrefix(ip);
  const lowerEmail = email.toLowerCase();
  const hash = contentHash({ websiteHost: site.host }, AUDIT_HASH_FIELDS);
  const { dwellMs, hasJsStamp } = dwellFrom(d.t0);

  // ── ANTI-SPAM: TURNSTILE ──────────────────────────────────────────────────
  // The same widget, from the same env-var-driven site key, as the other three
  // doors — script.js has one loader, so setting TURNSTILE_SECRET_KEY protects all
  // of them at once.
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

  const lead = {
    source: 'site-audit',
    offer: OFFER,
    email,
    name,
    company: String(d.company || '').trim().slice(0, 160),
    phone: String(d.phone || '').trim().slice(0, 40),
    website: site.url,
    websiteHost: site.host,
    auditScope,
    /* The optional "anything we should know" note, stored as `brief` so the inbox's
     * existing message row and detail dialog render it with no new branch. It is the
     * same thing the booking form collects, asked in fewer words. */
    brief: String(d.brief || '').trim().slice(0, 4000),
    // The booking form's shape, left empty rather than faked.
    role: '',
    service: '',
    timeSlot: '',
    // Which page the request came from. Always /tools/site-audit today, but the form
    // is cheap to embed elsewhere and then this is the only way to know.
    sourceUrl: String(d.sourceUrl || '').slice(0, 500),
  };

  // ── ANTI-SPAM: CLASSIFY ────────────────────────────────────────────────────
  const verdict = classifyAudit(
    { email, websiteHost: site.host, name, company: lead.company, brief: lead.brief },
    { hasJsStamp, dwellMs, duplicateCount },
  );

  if (verdict.verdict === 'reject') {
    // 200, not 4xx, and deliberately: an error teaches the sender which rule it
    // tripped. Kept 30 days in blocked_submissions so a false positive is one click
    // from being spotted in /admin.
    console.warn(`[site-audit] blocked (${verdict.category}, ${verdict.score}): ${verdict.reasons.join('; ')}`);
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
  // The request is the thing we must never lose. Mongo before SMTP, so a Gmail
  // outage cannot drop someone who asked us to do several hours of work.
  let leadId = null;
  try {
    const col = await leads();
    const { insertedId } = await col.insertOne({
      ...lead,
      status: 'new',
      notes: '',
      emailSent: false,
      emailError: null,
      createdAt: new Date(),
      spam: isSpam,
      spamCategory: isSpam ? verdict.category : null,
      spamScore: verdict.score,
      spamReasons: verdict.reasons,
    });
    leadId = insertedId;
  } catch (err) {
    console.error('Audit-request persist error (continuing to email):', err);
  }

  // Quarantined: captured, categorised, and NOT delivered. Emailing it would defeat
  // the point — /admin -> Leads -> Spam is where this is read.
  if (isSpam) {
    console.warn(`[site-audit] quarantined (${verdict.category}, ${verdict.score}): ${verdict.reasons.join('; ')}`);
    return res.status(200).json({ ok: true });
  }

  /* ── THEN EMAIL US ─────────────────────────────────────────────────────────
   * This endpoint DOES notify, where api/funnel-teardown.js deliberately does not.
   * The distinction is what the submission obliges us to do: a teardown is a
   * two-field blog ask, and one email per submission at blog volume turns the inbox
   * that exists for real enquiries back into a feed. An audit request is a
   * seven-field form with a stated turnaround attached, so the notification IS the
   * commitment — /admin alone would mean the promise depends on someone happening to
   * look. If this ever becomes a flood, turn it off HERE and say so on the page,
   * rather than quietly widening the spam rules. */
  if (!mailConfigured()) {
    console.error('GMAIL_USER / GMAIL_APP_PASSWORD not set — audit request captured but no email sent.');
    return leadId
      ? res.status(200).json({ ok: true })
      : res.status(500).json({ error: 'Email is not configured (missing Gmail credentials).' });
  }

  let emailError = null;
  try {
    await mailer().sendMail({
      from: mailFrom(),
      to: mailTo(),
      replyTo: email,
      subject: `Site audit request — ${site.host}${lead.company ? ' · ' + lead.company : ''}`,
      html: buildTeamEmail(lead),
      text: buildTeamText(lead),
    });
  } catch (err) {
    emailError = String(err?.message || err);
  }

  /* The confirmation to the VISITOR, gated on verifiedHuman for the same reason as
   * the other doors: this must never become a spam relay, and mailing addresses a
   * bot invented would wreck our Gmail deliverability. Until Turnstile is configured
   * this is inert and the on-page confirmation is the only acknowledgement — the
   * person still gets their audit, because WE were told. */
  if (verifiedHuman) {
    try {
      await mailer().sendMail({
        from: mailFrom(),
        to: email,
        replyTo: mailTo()[0],
        subject: `Your free site audit — ${site.host}`,
        html: buildClientEmail(lead),
        text: buildClientText(lead),
      });
    } catch (err) {
      console.error('Audit confirmation email failed (non-fatal):', String(err?.message || err));
    }
  }

  if (!emailError) {
    if (leadId) markEmail(leadId, true, null); // fire-and-forget flag update
    return res.status(200).json({ ok: true });
  }

  // Email failed. If the request was captured, this is our vendor's problem, not the
  // visitor's — the admin inbox still has it, flagged red.
  console.error('Gmail SMTP error:', emailError);
  if (leadId) {
    markEmail(leadId, false, emailError);
    return res.status(200).json({ ok: true });
  }
  return res.status(502).json({ error: 'Could not send the email.' });
}

/** Best-effort update of the lead's email status. Never throws into the response. */
function markEmail(id, sent, error) {
  leads()
    .then((col) => col.updateOne({ _id: id }, { $set: { emailSent: sent, emailError: error } }))
    .catch((err) => console.error('Lead email-flag update failed:', err));
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
