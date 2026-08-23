/* Booking-form spam classifier.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * On 2026-08-23 the leads collection held 62 documents. ONE was a real
 * prospect. The other 61 were: 33 byte-identical `Test / Test Company / Test`
 * submissions from rotating proxies, 10 fake "subscribe me to your newsletter"
 * bots, 15 cold-outreach pitches, and 3 internal diagnostics. The single real
 * lead — a referred white-label agency partnership — was buried under the noise
 * AND never emailed (the Resend era). That is the failure this file addresses:
 * not "spam is annoying" but "spam is how a real lead gets missed".
 *
 * ===========================================================================
 * THE THREE-VERDICT MODEL
 * ===========================================================================
 *   allow       normal lead. Stored, emailed, shown in the inbox.
 *   quarantine  stored and categorised, NOT emailed, hidden behind the Spam
 *               tab. For things that are probably spam but a human might
 *               plausibly have written.
 *   reject      never enters the leads collection at all. The response is still
 *               200 {ok:true} so the bot sees success and neither retries nor
 *               adapts. A copy goes to `blocked_submissions` (30-day TTL) so a
 *               false positive is recoverable — this codebase's cardinal rule
 *               is that a lead is never lost, and a silent black hole would
 *               break it.
 *
 * ===========================================================================
 * THE RULE THAT MATTERS MOST
 * ===========================================================================
 * Every rule below fires on the DIRECTION of the message, never on its topic.
 * "We can get you ranking on Google, reply YES" is spam; "we need help ranking
 * on Google" is the exact lead this agency sells to. A classifier that keyed on
 * the word "SEO" would delete the business. So the signals are things a buyer
 * never does: drop a URL, quote a discount, hand over a WhatsApp number,
 * template our own domain into the message, ask to join a mailing list.
 *
 * Anything from an @davnoot.com address is whitelisted outright — internal
 * diagnostics must always come through.
 */

/** Service codes the booking form's <select> can actually emit. A value outside
 *  this set means the POST did not come from our form. The 33-submission flood
 *  posted the placeholder OPTION LABEL ("Choose one (or leave blank)") rather
 *  than its value — a browser cannot do that, so it is a hard bot tell. */
export const SERVICE_CODES = ['', 'seo', 'meta', 'email', 'ai-seo', 'chatgpt-ads', 'software', 'multi'];

/** Categories a flagged submission can carry. `manual` is only ever set by a
 *  human clicking "Mark as spam" in /admin. Keep in sync with the labels in
 *  src/admin/views/leads.js. */
export const SPAM_CATEGORIES = [
  { key: 'test', label: 'Test / filler' },
  { key: 'gibberish', label: 'Gibberish' },
  { key: 'bot-subscribe', label: 'Subscribe bot' },
  { key: 'link-drop', label: 'Link drop' },
  { key: 'promo', label: 'Product promo' },
  { key: 'agency-pitch', label: 'Agency pitch' },
  { key: 'manual', label: 'Marked by hand' },
];
export const SPAM_CATEGORY_KEYS = SPAM_CATEGORIES.map((c) => c.key);

/** Score at or above which a submission is quarantined rather than delivered. */
export const QUARANTINE_AT = 45;
/** Score at or above which a submission never reaches the leads collection. */
export const REJECT_AT = 100;

// Words that are the whole message when someone is testing a form, not using it.
const FILLER = new Set([
  'test', 'testing', 'tests', 'testtest', 'test123',
  'asdf', 'asdfasdf', 'qwerty', 'qwe', 'abc', 'abcd', 'aaa', 'xxx', 'xyz',
  'na', 'n/a', 'none', 'nil', 'null', 'undefined', 'sample', 'demo', 'example',
  'hello', 'hi', 'hey', 'hola', 'ok', 'okay', 'yes', 'no', '1', '123',
]);

// Company suffixes stripped before the filler check, so "Test Company" and
// "Test Inc" both reduce to "test".
const CO_SUFFIX = /\b(company|co|inc|incorporated|llc|ltd|limited|corp|corporation|gmbh|group|agency|consulting|solutions)\b/g;

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']{3,}|\b[a-z0-9-]+\.(?:com|net|org|io|co|uk|us|shop|store|xyz|top|ru|info|biz|lu|me|link|site|online)\b(?:\/[^\s<>"']*)?/gi;
const EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

// Off-platform contact channels. A prospect books a call; a spammer hands you a
// Telegram handle because they cannot receive replies at the address they used.
const CHANNEL_RE = /\b(?:wa\.me|t\.me|whats\s?app|telegram|viber|skype\s*:|signal\s*:)\b/i;

/* Retail promo boilerplate.
 *
 * NOTE what is deliberately ABSENT here: a bare dollar figure. Half the real
 * briefs this form exists to collect say "our budget is $8k a month" or "we're
 * doing $2M a year and ROAS fell off a cliff" — scoring "$" would quarantine
 * the best leads on the site. Only language that belongs on a product listing,
 * and never in a description of a business problem, counts. */
const PRICE_RE = /(?:\d+\s?%\s*off|\bfree shipping\b|\btoday only\b|\bbest prices?\b|\bjackpot\b|\blifetime warranty\b|\border yours\b|\bgrab it today\b)/i;

// Cold-outreach scaffolding: the seller announcing themselves and asking for a
// reply. Each phrase is one a BUYER has no reason to write.
const PITCH_RE = [
  /\bi (?:just )?(?:visited|came across|stumbled (?:up)?on|was looking at|checked out) (?:your|davnoot)/i,
  /\bwe (?:help|work with|specialise in|specialize in|provide|offer|deliver) (?:businesses|companies|brands|local business|clients)/i,
  /\b(?:simply )?reply\s+(?:with\s+)?["']?yes["']?/i,
  /\bmight be (?:getting|attracting) more (?:potential )?(?:visitors|customers|traffic)/i,
  // An offer VERB is required. Bare "free audit" would also match a prospect
  // writing "…and a free audit of our content if you offer one", which is a
  // buying signal, not a pitch.
  /\b(?:offer|send|give|provide|run|prepare|do)\s+(?:you\s+)?(?:a\s+)?(?:free|complimentary|no[- ]obligation)\s+(?:audit|report|analysis|consultation|trial|sample)\b/i,
  /\blet me know if you(?:'re| are) interested/i,
  /\b(?:grab|book|pick) a time here\b/i,
  /\bcheck out (?:all )?our (?:services|work|portfolio|website)/i,
  /\bi(?:'m| am) (?:reaching out|writing to you|contacting you)\b/i,
  /\bcan (?:i|we) send (?:you )?(?:some|a few|over)\b/i,
  /\bshow you some (?:previous|past|sample)\b/i,
  /\bwould you (?:be interested|like) (?:in|to see)\b/i,
  /\bmore (?:positive )?reviews? (?:for|on) your (?:business|profile)/i,
  /\bnegative reviews? removal\b|\bremoval of (?:genuine )?(?:fake|negative)/i,
];

// Mailing-list bots. TWO of these in one message is conclusive; one is enough
// to quarantine. Nobody filling in "what's your biggest challenge right now?"
// on a strategy-call form asks to be added to a list.
const SUBSCRIBE_RE = [
  /\b(?:i(?:'d| would) like to |please )?subscribed?\b/i,
  /\bnewsletter\b/i,
  /\bmailing list\b/i,
  /\badd me to (?:your|the) list\b/i,
  /\b(?:send me )?news and updates\b/i,
  /\bsend me news\b/i,
  /\bkeep me posted\b/i,
  /\bstay informed\b/i,
  /\bconfirm my subscription\b/i,
  /\blatest news\b/i,
  /\bhear more about .{0,40}\bby email\b/i,
  /\blook forward to (?:your )?updates\b/i,
  /\bi want to (?:stay|be) (?:informed|updated)\b/i,
];

// A mass-mailer's unsubscribe footer, pasted into a contact form. Unambiguous.
const UNSUB_RE = /\b(?:to )?unsubscribe\b[^.]{0,60}\b(?:reply|subject|click|link|email)\b|\breply with subject\s*:?\s*unsubscribe/i;

// Single-token pseudonyms of the shape spam engines generate: one word, no
// space, a capital or digit run inside it. "Terrysup", "Davidunows", "RussellPix".
const BOT_HANDLE_RE = /^[A-Z][a-z]{2,}(?:[A-Z][a-z]*|[a-z]*\d+[a-z]*)$/;

// Mailbox providers, so a sender's address is never mistaken for their website.
const FREEMAIL = new Set([
  'gmail', 'googlemail', 'yahoo', 'ymail', 'hotmail', 'outlook', 'live', 'msn',
  'aol', 'icloud', 'me', 'mac', 'proton', 'protonmail', 'gmx', 'web', 'mail',
  'zoho', 'yandex', 'inbox', 'fastmail', 'hey', 'qq', '163', 'naver',
]);

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Strip punctuation/company suffixes and test whether what's left is filler. */
function isFiller(value) {
  const base = norm(value).replace(CO_SUFFIX, ' ').replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return true;
  if (FILLER.has(base)) return true;
  // "test test test", "test1", "test-2" all collapse to a repeat of one filler word.
  const words = [...new Set(base.split(' '))];
  return words.length <= 2 && words.every((w) => FILLER.has(w.replace(/\d+$/, '')));
}

/* Keyboard mash, detected by consonant runs only.
 *
 * THE FIRST VERSION OF THIS FUNCTION REJECTED THE ONLY REAL LEAD IN THE
 * COLLECTION. It scored a word as mash when its vowel ratio fell below 0.28 —
 * which is true of "partnership" (3/11) and "projects" (2/8), both of which
 * appear in Ria Johnston's genuine partnership enquiry. Two hits, verdict
 * reject, lead destroyed. English is simply not vowel-dense enough for a ratio
 * test to be safe.
 *
 * A run of six or more consecutive consonants is the honest signal: the actual
 * mash ("fkmdkdwdwkdwjj", "Egjnjmfnefjwdifj") is nothing but such runs, and the
 * longest English has is five ("strengths"). Two mashed words are required so a
 * single unusual surname or product code can never trip it. */
const CONSONANT_RUN = /[bcdfghjklmnpqrstvwxz]{6,}/;
function isGibberish(text) {
  const words = norm(text).split(/[^a-z]+/).filter((w) => w.length >= 8);
  return words.filter((w) => CONSONANT_RUN.test(w)).length >= 2;
}

function countMatches(text, patterns) {
  return patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

/* Links in the message that point somewhere OTHER than the sender's own business.
 *
 * "Here's our site: acme.com" from bob@acme.com is what a genuine prospect
 * writes, and treating every URL as a spam signal would quarantine a large slice
 * of the real pipeline. So a link is discounted when its host echoes either the
 * sender's email domain or their company name — the two ways someone identifies
 * their own property. Everything else is an outbound link somebody wants us to
 * click, which is the actual signal.
 *
 * This also (correctly) softens the human cold-outreach case: a founder pitching
 * from hannah@melottogroup.com and linking calendar.melottogroup.com is still
 * caught by the pitch phrasing, but is no longer double-counted into a hard
 * reject on a link to her own calendar. */
function foreignLinks(brief, email, company) {
  const found = brief.match(URL_RE) || [];
  if (!found.length) return found;

  const own = new Set();
  // A free-mail domain says nothing about which site is the sender's, and
  // treating "gmail" as an owned token would whitelist any URL containing it.
  const domain = (email.split('@')[1] || '').toLowerCase().split('.')[0];
  if (domain && !FREEMAIL.has(domain)) own.add(domain);
  const coSlug = norm(company).replace(CO_SUFFIX, ' ').replace(/[^a-z0-9]+/g, '');
  if (coSlug) own.add(coSlug);

  return found.filter((url) => {
    // Compare against the WHOLE flattened host, not just its second level:
    // "calendar.melottogroup.com" is still melottogroup's, and a check that
    // looked only at the leftmost label would read it as "calendar" and treat a
    // founder's link to her own booking page as an outbound link drop.
    const host = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
    const flat = host.replace(/[^a-z0-9]+/g, '');
    // Four characters minimum: shorter tokens ("web", "co") collide with far too
    // much to be evidence of ownership.
    return ![...own].some((o) => o.length >= 4 && flat.includes(o));
  });
}

/**
 * Classify one booking-form submission.
 *
 * @param {object} lead    cleaned lead fields (name, email, company, role, service, timeSlot, brief)
 * @param {object} [ctx]   { hasJsStamp, dwellMs, duplicateCount } — transport signals the
 *                         handler measures. Omitted in tests that only exercise content rules.
 * @returns {{verdict:'allow'|'quarantine'|'reject', category:string|null, score:number, reasons:string[]}}
 */
export function classifyLead(lead = {}, ctx = {}) {
  const name = String(lead.name || '');
  const email = String(lead.email || '').trim();
  const company = String(lead.company || '');
  const brief = String(lead.brief || '');
  const service = String(lead.service || '');

  const reasons = [];
  let score = 0;
  let category = null;
  const hit = (points, reason, cat) => {
    score += points;
    reasons.push(reason);
    if (cat && !category) category = cat;
  };

  // ── Internal escape hatch ────────────────────────────────────────────────
  // Diagnostics from the team must never be filtered, whatever they contain.
  if (/@davnoot\.com$/i.test(email)) {
    return { verdict: 'allow', category: null, score: 0, reasons: ['internal sender'] };
  }

  // ── Hard tells ───────────────────────────────────────────────────────────
  // An address we cannot reply to makes the submission worthless even if it were
  // sincere, and it is what produced the two `Resend 422 invalid reply_to` errors.
  if (!EMAIL_RE.test(email)) hit(REJECT_AT, 'email field is not an email address', 'promo');

  // The 33-submission flood: a filler message with a filler name or company.
  if (isFiller(brief) && (isFiller(name) || isFiller(company))) {
    hit(REJECT_AT, 'placeholder name/company/message', 'test');
  }

  if (UNSUB_RE.test(brief)) hit(REJECT_AT, 'carries a bulk-mail unsubscribe footer', 'promo');
  if (isGibberish(brief)) hit(REJECT_AT, 'message is keyboard mash', 'gibberish');

  // ── Transport tells ──────────────────────────────────────────────────────
  // Our own script.js stamps the form on load; a POST straight to the endpoint
  // has no stamp. Weighted below the quarantine line on its own, because a
  // browser holding a stale cached script.js right after a deploy would also
  // miss it — but enough to tip anything else over.
  if (ctx.hasJsStamp === false) hit(35, 'submitted without the browser form stamp');
  if (typeof ctx.dwellMs === 'number' && ctx.dwellMs >= 0 && ctx.dwellMs < 3000) {
    hit(45, 'four fields filled in under 3 seconds');
  }
  if (ctx.duplicateCount > 0) {
    hit(ctx.duplicateCount >= 2 ? REJECT_AT : 55, `identical message sent ${ctx.duplicateCount}x recently`, 'test');
  }

  // A value the <select> cannot emit means the POST was assembled by hand.
  if (service && !SERVICE_CODES.includes(service)) {
    hit(45, 'service value the form cannot produce', 'test');
  }

  // ── Content tells ────────────────────────────────────────────────────────
  // Links, but only the ones pointing somewhere OTHER than the sender's own
  // business. "Here's our site: acme.com" from bob@acme.com is what a genuine
  // prospect writes, and scoring it would quarantine half the real pipeline.
  // A single foreign link sits just under the quarantine line on purpose: alone
  // it means little, combined with anything else it decides the verdict.
  const urls = foreignLinks(brief, email, company);
  if (urls.length) hit(urls.length > 1 ? 80 : 40, `${urls.length} outbound link${urls.length > 1 ? 's' : ''} in the message`, 'link-drop');
  if (CHANNEL_RE.test(brief)) hit(60, 'pushes an off-platform contact channel', 'link-drop');
  if (PRICE_RE.test(brief)) hit(50, 'quotes a price or discount', 'promo');

  const pitches = countMatches(brief, PITCH_RE);
  if (pitches) hit(pitches > 1 ? 65 : 40, `cold-outreach phrasing (${pitches} markers)`, 'agency-pitch');

  // Graduated, because one of these phrases could just about survive in a real
  // message and three could not. Two still only quarantines — the lead stays
  // readable in the Spam tab, which costs nothing if we got it wrong.
  const subs = countMatches(brief, SUBSCRIBE_RE);
  if (subs) hit(subs >= 3 ? REJECT_AT : subs === 2 ? 85 : 60, `mailing-list request (${subs} markers)`, 'bot-subscribe');

  // Templated mail-merge: our own domain pasted into the body. A prospect writes
  // "your site"; a bot writes the variable it was fed.
  if (/\bdavnoot\.com\b/i.test(brief)) hit(35, 'templates our domain into the message', 'agency-pitch');

  // Name and company identical is what a scraper produces when it only ever had
  // one string for the person.
  if (name && norm(name) === norm(company)) hit(30, 'name and company are the same string');

  const nameToken = name.trim();
  if (nameToken && !/\s/.test(nameToken) && nameToken.length >= 7 && BOT_HANDLE_RE.test(nameToken)) {
    hit(35, 'machine-generated display name', 'promo');
  }

  // Fallback category so nothing lands in the Spam tab uncategorised.
  if (!category && score >= QUARANTINE_AT) category = 'agency-pitch';

  const verdict = score >= REJECT_AT ? 'reject' : score >= QUARANTINE_AT ? 'quarantine' : 'allow';
  return { verdict, category: verdict === 'allow' ? null : category, score, reasons };
}

/**
 * Stable fingerprint of a submission's human-authored content, used to spot a
 * flood replaying one payload from many IPs. Deliberately ignores email and
 * timeSlot: the flood rotated the email field while name/company/brief stayed
 * byte-identical.
 */
export function contentHash(lead = {}) {
  const basis = [lead.name, lead.company, lead.brief].map(norm).join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Coarse network neighbourhood of an IP — /24 for v4, /48 for v6.
 *
 * The flood came from 193.233.203.141, .149 and .150: three addresses, one
 * rented subnet, each staying under the per-IP limit. Throttling the
 * neighbourhood rather than the address is what makes rotation expensive.
 */
export function ipPrefix(ip) {
  const s = String(ip || '');
  if (!s || s === 'unknown') return 'unknown';
  if (s.includes(':')) {
    // A compressed address shorter than three groups (loopback "::1", say) has
    // no /48 to speak of — truncating it would produce a nonsense key like
    // "::1::/48" in the logs and the blocked-submission records.
    const groups = s.split(':');
    if (groups.filter(Boolean).length < 3) return s;
    return groups.slice(0, 3).join(':') + '::/48';
  }
  const parts = s.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') + '.0/24' : s;
}
