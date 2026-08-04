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

import nodemailer from 'nodemailer';
import { leads } from '../lib/db.js';

const GMAIL_USER = process.env.GMAIL_USER || '';
// App passwords are shown grouped as "abcd efgh ijkl mnop"; Google accepts them
// with or without the spaces, so strip them to be forgiving of a copy-paste.
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const FROM = `Davnoot Digital <${GMAIL_USER}>`;
const TO = (process.env.LEAD_TO || GMAIL_USER || 'info@davnoot.com').split(',').map((s) => s.trim()).filter(Boolean);

// One transport per warm lambda. Created lazily so a cold start with missing
// credentials fails in the handler (with a captured lead) rather than at import.
let _transport;
function mailer() {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // implicit TLS
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });
  }
  return _transport;
}

const SERVICE_LABELS = {
  seo: 'SEO',
  meta: 'Meta Ads',
  email: 'Email Marketing',
  'ai-seo': 'AI SEO',
  'chatgpt-ads': 'ChatGPT / AI Ads',
  software: 'Custom Software',
  multi: 'Multi-channel / Not sure yet',
};

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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

  // ── PERSIST FIRST ────────────────────────────────────────────────────────
  // The lead is the thing we must never lose. Write it to Mongo BEFORE emailing,
  // so an SMTP outage (or a missing app password) can't drop a paying prospect on the
  // floor. Best-effort: if Mongo itself is down, we do NOT fail the form — a lead
  // that emails but isn't stored still beats a booking form that returns an error.
  let leadId = null;
  try {
    const col = await leads();
    const lead = cleanLead(d);
    const { insertedId } = await col.insertOne({
      ...lead,
      status: 'new',
      notes: '',
      emailSent: false,
      emailError: null,
      createdAt: new Date(),
    });
    leadId = insertedId;
  } catch (err) {
    console.error('Lead persist error (continuing to email):', err);
  }

  // ── THEN EMAIL ───────────────────────────────────────────────────────────
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.error('GMAIL_USER / GMAIL_APP_PASSWORD not set — lead captured but no email sent.');
    // The lead is safe in Mongo if it persisted; only report failure if it didn't.
    return leadId
      ? res.status(200).json({ ok: true })
      : res.status(500).json({ error: 'Email is not configured (missing Gmail credentials).' });
  }

  let emailError = null;
  try {
    await mailer().sendMail({
      from: FROM,
      to: TO,
      replyTo: d.email,
      subject: `New strategy call — ${d.name}${d.company ? ' · ' + d.company : ''}`,
      html: buildEmail(d),
      text: buildText(d),
    });
  } catch (err) {
    emailError = String(err?.message || err);
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
