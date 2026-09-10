/* POST /api/content-review
 *
 * The FOURTH front door into the leads inbox: the optional "have a human read this
 * draft" card that appears UNDER the score on /tools/content-analyzer, once the
 * analyzer has actually produced one.
 *
 * ===========================================================================
 * WHY THIS EXISTS, AND WHAT IT IS NOT ALLOWED TO BREAK
 * ===========================================================================
 * The analyzer itself is 100% client-side and stays that way. It computes its score
 * in the visitor's browser, it has no endpoint, and nothing the person pastes is
 * uploaded — that is the trust pitch on the page, the reason the tool costs nothing
 * to run, and a claim the page makes in plain words in two languages.
 *
 * This endpoint does not change any of that. It fires ONLY when the visitor types an
 * address into a card they were not required to touch and presses a button labelled
 * with what it does. No email, no POST: the score renders either way, in full, with
 * no gate and no blurred section. If that ever stops being true, the page's copy,
 * its FAQ and its SoftwareApplication JSON-LD all become false together — which is
 * the reason the capture lives in its own endpoint rather than inside tools.js, where
 * the next person to edit the analyzer would find a fetch() in a file whose header
 * says there is none.
 *
 * WHAT IT STORES, AND WHY THE DRAFT
 * ---------------------------------
 * The email, and the draft that was analyzed. The draft is the entire point: "someone
 * wants content help" is not actionable, while "here is the 900-word post they are
 * about to publish, scoring 54, failing on H2s and keyword placement" is a reply that
 * writes itself. We keep the numbers the tool produced too, so the state of the draft
 * at the moment they asked is recoverable even after they have rewritten it.
 *
 * WHERE IT GOES
 * -------------
 * The same `leads` collection as the other three intakes, tagged
 * `source: 'content-review'`, worked in /admin -> Leads.
 *
 * NO NOTIFICATION EMAIL — the same call api/funnel-teardown.js makes, for the same
 * reason. See the note near the end of this file.
 */
import { leads, blockedSubmissions } from '../lib/db.js';
import {
  classifyContentReview, contentHash, ipPrefix, EMAIL_RE, REVIEW_HASH_FIELDS,
} from '../lib/spam.js';
import {
  clientIp, verifyTurnstile, turnstileEnabled,
  mailer, mailFrom, mailTo, mailConfigured,
  dwellFrom, throttle, normalizeWebsite, esc,
} from '../lib/lead-intake.js';

/** What the visitor was promised. Stored on the lead and quoted back to them. */
const OFFER = 'Human review of an analyzed draft';

/* How much of the draft is kept.
 *
 * Enough that the reviewer reads what the visitor actually wrote rather than a
 * teaser — 25k characters is roughly 4,000 words, which covers all but the longest
 * pillar pages. The analyzer itself happily eats a 33k-WORD paste, so the cap is
 * real, and when it bites the record says so (`contentTruncated`) instead of quietly
 * handing the reviewer a draft that stops mid-sentence with no explanation. */
const MAX_CONTENT = 25000;

/** Per-field caps for the analyzer's own inputs. Generous: these are SEO fields
 *  whose whole point is that the tool tells you when they are too long, so the
 *  interesting submissions are the ones well over the recommended length. */
const MAX_KEYWORD = 200;
const MAX_TITLE = 400;
const MAX_SLUG = 400;
const MAX_META = 1000;

/** Checks the analyzer reported as failing, capped so a hand-assembled POST cannot
 *  write an unbounded array into the document. Ids only — the human-readable labels
 *  are locale-dependent and live in tools.js, so storing them would freeze one
 *  language's wording into a record the other language's visitor produced. */
const MAX_FAILED = 60;

/* ── Confirmation to the VISITOR ───────────────────────────────────────────
 * Deliberately modest about what they are getting. A person who pasted a draft into
 * a free tool has not hired us, and an email that reads like the start of a sales
 * sequence is the fastest way to make the next visitor not type their address. */

function buildClientEmail(d) {
  const what = d.keyword
    ? `your draft targeting <strong style="color:#0a0a0a;">${esc(d.keyword)}</strong>`
    : 'the draft you analyzed';
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#e8eee9;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eee9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #d4ddd5;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #eef1ee;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Davnoot Digital</td></tr>
        <tr><td style="padding:28px 28px 6px;">
          <h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">We have ${d.keyword ? 'it' : 'your draft'}.</h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#545b55;">Someone here will read ${what} and reply with what we would change — the parts the score cannot see, like whether it answers the question the searcher actually typed.</p>
          <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#545b55;">Expect a reply within two business days. It comes from a person, and it is free.</p>
        </td></tr>
        <tr><td style="padding:18px 28px 30px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#545b55;">Want us to look at something specific in it? Just reply to this email.</p>
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
    d.keyword ? 'We have it.' : 'We have your draft.',
    '',
    `Someone here will read ${d.keyword ? `your draft targeting "${d.keyword}"` : 'the draft you analyzed'} and reply with what we would change — the parts the score cannot see, like whether it answers the question the searcher actually typed.`,
    '',
    'Expect a reply within two business days. It comes from a person, and it is free.',
    '',
    'Want us to look at something specific in it? Just reply to this email.',
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

  // The ONE field the visitor types. Validated here rather than left to the
  // classifier so a human with a typo is told, instead of being promised a review
  // that can never be delivered.
  const email = String(d.email || '').trim().slice(0, 320);
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.', field: 'email' });
  }

  const rawContent = String(d.content || '');
  const content = rawContent.slice(0, MAX_CONTENT);
  /* No draft, no review. The card is rendered only after the analyzer has scored
   * something, so this cannot happen through the UI — but a request with nothing to
   * review is not a lead under any reading, and answering 400 tells a developer
   * poking at the endpoint exactly what is missing. */
  if (!content.trim()) {
    return res.status(400).json({ error: 'Analyze a draft first, then ask for a review.', field: 'content' });
  }

  /* Optional, and only ever used to enrich the reply: someone who tells us their
   * site gets advice about their site. A malformed value is dropped rather than
   * rejected — this field is not why they are here. */
  const site = normalizeWebsite(d.website);

  const ip = clientIp(req);
  const prefix = ipPrefix(ip);
  const lowerEmail = email.toLowerCase();
  const hash = contentHash({ content }, REVIEW_HASH_FIELDS);
  const { dwellMs, hasJsStamp } = dwellFrom(d.t0);

  // ── ANTI-SPAM: TURNSTILE ──────────────────────────────────────────────────
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
  // Transport and shape only. The DRAFT is never run through the prose rules — see
  // the long note on classifyContentReview in lib/spam.js for why doing so would
  // destroy ordinary ecommerce and newsletter copy.
  const verdict = classifyContentReview({ email, content }, { hasJsStamp, dwellMs, duplicateCount });

  const score = Number(d.score);
  const wordCount = Number(d.wordCount);

  const lead = {
    source: 'content-review',
    offer: OFFER,
    email,
    /* The card asks for an address and nothing else, so there is no name to store.
     * Left empty rather than derived from the email local part: "jsmith" is not a
     * name, and the inbox falls back to the website (then to a dash) for the
     * identity column anyway. */
    name: '',
    company: '',
    role: '',
    service: '',
    timeSlot: '',
    phone: '',
    website: site ? site.url : '',
    websiteHost: site ? site.host : '',
    /* ── WHAT THEY TRIED TO ANALYZE ──────────────────────────────────────────
     * The five inputs the analyzer takes, plus the two numbers it produced and the
     * ids of the checks it failed. Stored under an `analysis` sub-document so the
     * lead's own fields stay the shape every other intake writes, and so the admin
     * can render "what they were working on" as one block. */
    analysis: {
      keyword: String(d.keyword || '').trim().slice(0, MAX_KEYWORD),
      seoTitle: String(d.title || '').trim().slice(0, MAX_TITLE),
      slug: String(d.slug || '').trim().slice(0, MAX_SLUG),
      metaDescription: String(d.meta || '').trim().slice(0, MAX_META),
      content,
      // True when the cap bit, so a reviewer reading a draft that stops abruptly
      // knows it is our truncation and not theirs.
      contentTruncated: rawContent.length > MAX_CONTENT,
      // The tool's own verdict, as the visitor saw it. Coerced rather than trusted:
      // these arrive from the browser and a hand-made POST can put anything here.
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
      wordCount: Number.isFinite(wordCount) ? Math.max(0, Math.round(wordCount)) : null,
      locale: String(d.locale || '').slice(0, 5),
      failed: Array.isArray(d.failed)
        ? d.failed.slice(0, MAX_FAILED).map((id) => String(id).slice(0, 40))
        : [],
    },
    sourceUrl: String(d.sourceUrl || '').slice(0, 500),
  };

  if (verdict.verdict === 'reject') {
    console.warn(`[content-review] blocked (${verdict.category}, ${verdict.score}): ${verdict.reasons.join('; ')}`);
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

  // ── PERSIST ──────────────────────────────────────────────────────────────
  let leadId = null;
  try {
    const col = await leads();
    const { insertedId } = await col.insertOne({
      ...lead,
      status: 'new',
      notes: '',
      /* null, not false: `false` means "we tried to notify and it failed", which is
       * what the admin's red "failed" pill is for. Nothing is tried here — see the
       * note below — so null is the honest value and the admin reads it as
       * "admin only". api/admin/leads/index.js lists this source as non-notifying so
       * an older document missing the flag resolves the same way. */
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
    console.error('Content-review persist error (continuing):', err);
  }

  if (isSpam) {
    console.warn(`[content-review] quarantined (${verdict.category}, ${verdict.score}): ${verdict.reasons.join('; ')}`);
    return res.status(200).json({ ok: true });
  }

  /* ── NO NOTIFICATION EMAIL. THIS IS DELIBERATE. ───────────────────────────
   *
   * api/book-call.js and api/site-audit.js email every allowed lead to LEAD_TO.
   * This endpoint does not, the same call api/funnel-teardown.js made and for the
   * same reason: /tools/content-analyzer is a free tool built to attract search
   * traffic, so its volume is whatever the SERP gives it, and one email per opt-in
   * would eventually turn the inbox that exists for real enquiries back into a feed
   * — the exact failure ANTISPAM.md was written to fix, arriving through the front
   * door instead of from bots.
   *
   * /admin -> Leads is the destination, and it is not a lesser one: the lead is
   * persisted before anything else can fail, it carries a status, private notes and
   * the spam verdict, it drives the sidebar's unread badge, and it exports to CSV.
   * Nothing is dropped — only the notification channel.
   *
   * IF YOU TURN THIS ON, set emailSent on insert (false, then flipped by markEmail)
   * and drop 'content-review' from NON_NOTIFYING in api/admin/leads/index.js. Do NOT
   * backfill the existing nulls to false: false means "we tried and it failed", and
   * would make every historical row look broken. */
  if (leadId) {
    console.info(`[content-review] captured ${lowerEmail}${isSpam ? ' (held)' : ''} — admin only, no notification`);
  }

  /* The confirmation to the VISITOR stays on: they handed over a draft and should
   * know a person has it. Gated on verifiedHuman for the same reason as the other
   * doors, and never sent for a held submission — promising a review we may never
   * write is worse than saying nothing. */
  if (verifiedHuman && !isSpam && mailConfigured()) {
    try {
      await mailer().sendMail({
        from: mailFrom(),
        to: email,
        replyTo: mailTo()[0],
        subject: lead.analysis.keyword
          ? `Your draft is with us — ${lead.analysis.keyword}`
          : 'Your draft is with us — Davnoot',
        html: buildClientEmail(lead.analysis),
        text: buildClientText(lead.analysis),
      });
    } catch (err) {
      console.error('Content-review confirmation email failed (non-fatal):', String(err?.message || err));
    }
  }

  return res.status(200).json({ ok: true });
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
