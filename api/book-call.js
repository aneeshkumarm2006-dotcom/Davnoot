// Vercel serverless function — receives the booking form and emails the lead to
// Davnoot via Resend, using an on-brand HTML template.
//
// Required env var (set in Vercel → Settings → Environment Variables):
//   RESEND_API_KEY   your Resend API key (re_...)
// Optional:
//   RESEND_FROM      e.g. "Davnoot Digital <hello@davnoot.com>"  (needs a verified
//                    domain in Resend; defaults to Resend's test sender)
//   LEAD_TO          where leads are delivered (defaults to hello@davnoot.com)

const FROM = process.env.RESEND_FROM || 'Davnoot Digital <onboarding@resend.dev>';
const TO = (process.env.LEAD_TO || 'hello@davnoot.com').split(',').map((s) => s.trim());

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel parses JSON and urlencoded bodies into req.body.
  const d = (typeof req.body === 'string' ? safeJson(req.body) : req.body) || {};

  // Honeypot — silently accept bots without sending.
  if (d['bot-field']) return res.status(200).json({ ok: true });

  if (!d.name || !d.email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email is not configured (missing RESEND_API_KEY).' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        reply_to: d.email,
        subject: `New strategy call — ${d.name}${d.company ? ' · ' + d.company : ''}`,
        html: buildEmail(d),
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Resend error:', r.status, detail);
      return res.status(502).json({ error: 'Could not send the email.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
