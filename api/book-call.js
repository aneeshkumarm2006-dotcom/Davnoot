// Vercel serverless function — receives the booking form and emails the lead to
// Davnoot over Gmail SMTP (a Google Workspace app password), using an on-brand
// HTML template.
//
// Required env vars (set in Vercel → Settings → Environment Variables):
//   GMAIL_USER           the Gmail / Google Workspace address that sends, e.g. info@davnoot.com
//   GMAIL_APP_PASSWORD   a 16-char Google App Password for that account (NOT the login password).
//                        Requires 2-Step Verification on the account. Spaces are ignored.
// Optional:
//   LEAD_TO              where leads are delivered (defaults to GMAIL_USER, then info@davnoot.com)
//
// Gmail requires the From address to be the authenticated account (or one of its
// verified aliases), so FROM is always built from GMAIL_USER — you cannot spoof
// an arbitrary sender here.

import { leads, blockedSubmissions } from '../lib/db.js';
import { classifyLead, contentHash, ipPrefix } from '../lib/spam.js';
import {
  clientIp, verifyTurnstile, turnstileEnabled,
  mailer, mailFrom, mailTo, mailConfigured,
  dwellFrom, throttle, esc,
} from '../lib/lead-intake.js';

// The transport, the throttle, the IP trust rule and the Turnstile check all live
// in lib/lead-intake.js — shared with api/funnel-teardown.js so the anti-spam
// posture can only ever be tuned in one place. What stays here is what is specific
// to the strategy-call form: its fields, its labels and its two email templates.

const SERVICE_LABELS = {
  seo: 'SEO',
  meta: 'Meta Ads',
  email: 'Email Marketing',
  'ai-seo': 'AI SEO',
  'chatgpt-ads': 'ChatGPT / AI Ads',
  software: 'Custom Software',
  multi: 'Multi-channel / Not sure yet',
  other: 'Other',
};

function row(label, value, isLast) {
  if (!value) return '';
  const border = isLast ? '' : 'border-bottom:1px solid #eef1ee;';
  return `<tr>
    <td style="padding:11px 0;${border}width:140px;vertical-align:top;font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8d958e;">${esc(label)}</td>
    <td style="padding:11px 0;${border}font-size:14px;line-height:1.5;color:#0a0a0a;">${esc(value)}</td>
  </tr>`;
}

function buildEmail(d) {
  const service = SERVICE_LABELS[d.service] || d.service || '';
  const rows = [
    row('Name', d.name),
    row('Email', d.email),
    row('Company', d.company),
    row('Role', d.role),
    row('Interested in', service),
    row('Preferred slot', d.time_slot),
    row('Challenge', d.brief, true),
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
            <td align="right"><span style="font-family:'Courier New',monospace;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;background:#0a0a0a;border-radius:6px;padding:5px 11px;">New lead</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 28px 6px;">
          <h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">New strategy call request</h1>
          <p style="margin:7px 0 0;font-size:14px;line-height:1.5;color:#545b55;">Someone just booked through davnoot.com. Their details are below — reply within 60 minutes to keep the momentum.</p>
        </td></tr>
        <tr><td style="padding:14px 28px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td></tr>
        <tr><td style="padding:18px 28px 30px;">
          <a href="mailto:${esc(d.email)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 24px;border-radius:100px;">Reply to ${esc((d.name || 'them').split(' ')[0])} &rarr;</a>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f5f8f5;border-top:1px solid #eef1ee;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#8d958e;">Sent automatically from the booking form at davnoot.com.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(d) {
  const service = SERVICE_LABELS[d.service] || d.service || '';
  return [
    'New strategy call request — via davnoot.com',
    '',
    `Name:           ${d.name || ''}`,
    `Email:          ${d.email || ''}`,
    `Company:        ${d.company || ''}`,
    `Role:           ${d.role || ''}`,
    `Interested in:  ${service}`,
    `Preferred slot: ${d.time_slot || ''}`,
    `Challenge:      ${d.brief || ''}`,
    '',
    `Reply directly to ${d.email || ''}.`,
  ].join('\n');
}

// ── Auto-reply sent to the PERSON who filled the form ──────────────────────
// A warm confirmation so they know the message landed and someone will follow up.
function buildClientEmail(d) {
  const first = esc((d.name || 'there').split(' ')[0]);
  const slot = d.time_slot
    ? `<tr><td style="padding:11px 0;font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8d958e;width:140px;">Requested slot</td><td style="padding:11px 0;font-size:14px;color:#0a0a0a;">${esc(d.time_slot)}</td></tr>`
    : '';
  const brief = d.brief
    ? `<tr><td style="padding:11px 0;font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#8d958e;width:140px;vertical-align:top;">Your message</td><td style="padding:11px 0;font-size:14px;line-height:1.5;color:#545b55;">${esc(d.brief)}</td></tr>`
    : '';
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#e8eee9;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eee9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #d4ddd5;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #eef1ee;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Davnoot Digital</td></tr>
        <tr><td style="padding:28px 28px 6px;">
          <h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Thanks, ${first} — we've got it.</h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#545b55;">Your message just reached the Davnoot team. One of us will get back to you personally, usually within one business day. Here's a copy of what you sent:</p>
        </td></tr>
        <tr><td style="padding:14px 28px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${slot}${brief}</table>
        </td></tr>
        <tr><td style="padding:18px 28px 30px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#545b55;">Need us sooner? Just reply to this email or reach us at <a href="mailto:info@davnoot.com" style="color:#0a0a0a;">info@davnoot.com</a>.</p>
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
  const first = (d.name || 'there').split(' ')[0];
  return [
    `Thanks, ${first} — we've got it.`,
    '',
    "Your message just reached the Davnoot team. One of us will get back to you personally, usually within one business day.",
    d.brief ? `\nYour message:\n${d.brief}` : '',
    '',
    'Need us sooner? Reply to this email or reach us at info@davnoot.com.',
    '',
    'Davnoot Digital · Montreal, QC',
  ].filter(Boolean).join('\n');
}

// Keep only the fields we recognise, coerced to strings and length-capped so a
// crafted body can't store unbounded junk in the leads collection.
function cleanLead(d) {
  const str = (v, max) => (v == null ? '' : String(v)).slice(0, max);
  return {
    name: str(d.name, 200),
    email: str(d.email, 320),
    company: str(d.company, 200),
    role: str(d.role, 200),
    service: str(d.service, 60),
    timeSlot: str(d.time_slot, 120),
    brief: str(d.brief, 4000),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel parses JSON and urlencoded bodies into req.body.
  const d = (typeof req.body === 'string' ? safeJson(req.body) : req.body) || {};

  // Honeypot — silently accept bots without sending or persisting.
  if (d['bot-field']) return res.status(200).json({ ok: true });

  if (!d.name || !d.email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const ip = clientIp(req);
  const prefix = ipPrefix(ip);
  const email = String(d.email || '').toLowerCase().slice(0, 320);
  const lead = cleanLead(d);
  const hash = contentHash(lead);

  // How long the form was open before it was submitted (see lib/lead-intake.js).
  const { dwellMs, hasJsStamp } = dwellFrom(d.t0);

  // ── ANTI-SPAM: TURNSTILE (invisible CAPTCHA) ───────────────────────────────
  // Enforced only once TURNSTILE_SECRET_KEY is configured, so the form keeps
  // working until the keys are added. A verified human is remembered so we only
  // send the auto-reply to real people (never amplifying spam).
  let verifiedHuman = false;
  if (turnstileEnabled()) {
    verifiedHuman = await verifyTurnstile(d['cf-turnstile-response'], ip);
    if (!verifiedHuman) {
      return res.status(400).json({ error: "Couldn't verify you're human. Please refresh and try again." });
    }
  }

  // ── ANTI-SPAM: RATE LIMIT (per IP, email and /24) ──────────────────────────
  const { limited, duplicateCount } = await throttle({ ip, prefix, email, hash });
  if (limited) {
    return res.status(429).json({ error: 'Too many submissions. Please try again in a few minutes.' });
  }

  // ── ANTI-SPAM: CLASSIFY ────────────────────────────────────────────────────
  // Three verdicts (see lib/spam.js): allow through, quarantine into the Spam
  // tab without emailing, or reject before the leads collection ever sees it.
  const verdict = classifyLead(lead, { hasJsStamp, dwellMs, duplicateCount });

  if (verdict.verdict === 'reject') {
    // 200, not 4xx, and deliberately: an error teaches the sender which rule it
    // tripped and what to change. Silence teaches nothing. The submission is
    // kept for 30 days in blocked_submissions so a false positive is one click
    // from being recovered in /admin rather than gone forever.
    console.warn(`[book-call] blocked (${verdict.category}, ${verdict.score}): ${verdict.reasons.join('; ')}`);
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
  // The lead is the thing we must never lose. Write it to Mongo BEFORE emailing,
  // so an SMTP outage (or a missing app password) can't drop a paying prospect on the
  // floor. Best-effort: if Mongo itself is down, we do NOT fail the form — a lead
  // that emails but isn't stored still beats a booking form that returns an error.
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
      // Quarantine is a display + notification decision, never a storage one.
      // The document is identical either way; `spam` only decides which tab it
      // appears under and whether the phone buzzes.
      spam: isSpam,
      spamCategory: isSpam ? verdict.category : null,
      spamScore: verdict.score,
      spamReasons: verdict.reasons,
    });
    leadId = insertedId;
  } catch (err) {
    console.error('Lead persist error (continuing to email):', err);
  }

  // Quarantined: captured, categorised, and NOT delivered. Emailing it would
  // defeat the entire point — the inbox flood is the problem being solved, and
  // the Spam tab in /admin is where this is now read.
  if (isSpam) {
    console.warn(`[book-call] quarantined (${verdict.category}, ${verdict.score}): ${verdict.reasons.join('; ')}`);
    return res.status(200).json({ ok: true });
  }

  // ── THEN EMAIL ───────────────────────────────────────────────────────────
  if (!mailConfigured()) {
    console.error('GMAIL_USER / GMAIL_APP_PASSWORD not set — lead captured but no email sent.');
    // The lead is safe in Mongo if it persisted; only report failure if it didn't.
    return leadId
      ? res.status(200).json({ ok: true })
      : res.status(500).json({ error: 'Email is not configured (missing Gmail credentials).' });
  }

  let emailError = null;
  try {
    await mailer().sendMail({
      from: mailFrom(),
      to: mailTo(),
      replyTo: d.email,
      subject: `New strategy call — ${d.name}${d.company ? ' · ' + d.company : ''}`,
      html: buildEmail(d),
      text: buildText(d),
    });
  } catch (err) {
    emailError = String(err?.message || err);
  }

  // Auto-reply to the prospect — best-effort. A failed confirmation must NOT flip
  // the lead's emailSent flag (that tracks OUR notification) or fail the request.
  //
  // Gated on verifiedHuman so we NEVER email an address a bot supplied — the form
  // must not become a spam relay, and sending to fake addresses would wreck our
  // Gmail deliverability. So: confirmations go out only when Turnstile has proven
  // the sender is human. Until Turnstile is configured, we skip the auto-reply and
  // just capture + notify (you still get every lead).
  if (verifiedHuman && d.email && /.+@.+\..+/.test(d.email)) {
    try {
      await mailer().sendMail({
        from: mailFrom(),
        to: d.email,
        replyTo: mailTo()[0],
        subject: 'We got your message — Davnoot',
        html: buildClientEmail(d),
        text: buildClientText(d),
      });
    } catch (err) {
      console.error('Client confirmation email failed (non-fatal):', String(err?.message || err));
    }
  }

  if (!emailError) {
    if (leadId) markEmail(leadId, true, null); // fire-and-forget flag update
    return res.status(200).json({ ok: true });
  }

  // Email failed. If we captured the lead, this is our vendor's problem, not the
  // prospect's — return success; the admin retries the send from the leads inbox.
  console.error('Gmail SMTP error:', emailError);
  if (leadId) {
    markEmail(leadId, false, emailError);
    return res.status(200).json({ ok: true });
  }
  // Neither stored nor sent — the lead is genuinely lost, so surface it.
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
