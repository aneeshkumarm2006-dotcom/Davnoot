/* Lead-form spam classifiers.
 *
 * Two entry points, one set of thresholds: classifyLead() for the seven-field
 * booking form, classifyTeardown() for the two-field blog modal. The second half
 * of this file explains why the two-field form needs its own rules rather than a
 * flag on the first.
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
export const SERVICE_CODES = ['', 'seo', 'meta', 'email', 'ai-seo', 'chatgpt-ads', 'software', 'multi', 'other'];

/** What the /tools/site-audit form's "what should we look at" <select> can emit.
 *
 *  Key + English label, because three places need them and none of them can read
 *  the others: api/site-audit.js validates the key and prints the label in the
 *  notification email, src/admin/views/leads.js renders it in the inbox (shipped in
 *  the GET payload, never hand-copied — see the note on SPAM_CATEGORIES), and the
 *  page's own <option> text is authored in the HTML so scripts/i18n.js can translate
 *  it. The HTML labels and these labels therefore say the same thing in two places
 *  on purpose: the visitor's copy is translatable, the operator's is not.
 *
 *  An unknown key is DROPPED by the endpoint rather than scored as a bot tell —
 *  see the comment there for why this list is not treated like SERVICE_CODES. */
export const AUDIT_SCOPES = [
  { key: 'full', label: 'Whole site' },
  { key: 'seo', label: 'SEO and organic search' },
  { key: 'ads', label: 'Paid ads' },
  { key: 'content', label: 'Content and messaging' },
  { key: 'ai', label: 'AI search visibility' },
  { key: 'speed', label: 'Speed and technical health' },
];
export const AUDIT_SCOPE_KEYS = AUDIT_SCOPES.map((s) => s.key);

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
export const EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

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

/* ── The prose rules, extracted so every intake that collects a MESSAGE scores
 * it identically ───────────────────────────────────────────────────────────
 * Two front doors now take free text: the booking form's "biggest challenge"
 * brief and the site-audit form's "anything we should know" note. A pitch is a
 * pitch whichever box it is pasted into, and the whole reason lib/lead-intake.js
 * exists is that two copies of a tuned number means the next tuning pass fixes
 * one door and leaves the other standing open.
 *
 * Both helpers return [points, reason, category] tuples rather than mutating a
 * score, so the CALLER decides where in its own rule order they land — which is
 * what keeps classifyLead's verdicts and category precedence byte-identical to
 * what the corpus in scripts/spam.test.js was pinned against.
 *
 * NOTE the one intake that must NEVER be run through these: the content-analyzer
 * review request. See classifyContentReview for why.
 */

/** The two prose rules that are conclusive on their own. */
function proseRejects(text) {
  const out = [];
  if (UNSUB_RE.test(text)) out.push([REJECT_AT, 'carries a bulk-mail unsubscribe footer', 'promo']);
  if (isGibberish(text)) out.push([REJECT_AT, 'message is keyboard mash', 'gibberish']);
  return out;
}

/** The graduated prose rules — links, channels, prices, pitches, list requests. */
function proseHits(text, email, company) {
  const out = [];
  // Links, but only the ones pointing somewhere OTHER than the sender's own
  // business. "Here's our site: acme.com" from bob@acme.com is what a genuine
  // prospect writes, and scoring it would quarantine half the real pipeline.
  // A single foreign link sits just under the quarantine line on purpose: alone
  // it means little, combined with anything else it decides the verdict.
  const urls = foreignLinks(text, email, company);
  if (urls.length) out.push([urls.length > 1 ? 80 : 40, `${urls.length} outbound link${urls.length > 1 ? 's' : ''} in the message`, 'link-drop']);
  if (CHANNEL_RE.test(text)) out.push([60, 'pushes an off-platform contact channel', 'link-drop']);
  if (PRICE_RE.test(text)) out.push([50, 'quotes a price or discount', 'promo']);

  const pitches = countMatches(text, PITCH_RE);
  if (pitches) out.push([pitches > 1 ? 65 : 40, `cold-outreach phrasing (${pitches} markers)`, 'agency-pitch']);

  // Graduated, because one of these phrases could just about survive in a real
  // message and three could not. Two still only quarantines — the lead stays
  // readable in the Spam tab, which costs nothing if we got it wrong.
  const subs = countMatches(text, SUBSCRIBE_RE);
  if (subs) out.push([subs >= 3 ? REJECT_AT : subs === 2 ? 85 : 60, `mailing-list request (${subs} markers)`, 'bot-subscribe']);

  // Templated mail-merge: our own domain pasted into the body. A prospect writes
  // "your site"; a bot writes the variable it was fed.
  if (/\bdavnoot\.com\b/i.test(text)) out.push([35, 'templates our domain into the message', 'agency-pitch']);

  return out;
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

  proseRejects(brief).forEach((h) => hit(...h));

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
  // Shared with the site-audit form — see proseHits above.
  proseHits(brief, email, company).forEach((h) => hit(...h));

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

/* ===========================================================================
 * THE SECOND FRONT DOOR: the /blog funnel-teardown modal
 * ===========================================================================
 * The teardown modal collects TWO fields — an email and a website. Almost every
 * rule above is therefore inapplicable to it, and one of them is actively
 * catastrophic: `isFiller('')` is true, so a teardown lead run through
 * classifyLead trips "placeholder name/company/message" (empty name, empty
 * company, empty brief) and is REJECTED. Every single one of them. Hence a
 * separate entry point rather than a flag on the existing one.
 *
 * With no prose to read, the signal has to come from somewhere else, and it comes
 * almost entirely from TRANSPORT: was the form stamped by our script, how fast was
 * it filled, and has this exact website been submitted before. Those are the three
 * things a scripted POST cannot fake cheaply, and they are what this scores.
 */

/** Hosts nobody submits as "my website" except to route us somewhere else. */
const OFF_PLATFORM_HOST = /^(?:t\.me|wa\.me|telegram\.me|bit\.ly|tinyurl\.com|goo\.gl|cutt\.ly|is\.gd|rebrand\.ly|shorturl\.at)$/i;

/** A bare IP address is what a scanner submits, never what a business types. */
const IP_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/* The teardown modal opens on exit-intent or 60% scroll, so `t0` measures time
 * from the modal APPEARING to the POST — not from page load. A person still has
 * to read a headline and type two fields. Two seconds is below anything human,
 * while leaving room for a browser autofilling both boxes at once. */
const TEARDOWN_MIN_DWELL_MS = 2000;

/**
 * Classify one funnel-teardown submission.
 *
 * @param {object} lead   { email, websiteHost } — websiteHost is the bare
 *                        lowercased host from normalizeWebsite(), not the raw input.
 * @param {object} [ctx]  { hasJsStamp, dwellMs, duplicateCount }
 * @returns {{verdict:'allow'|'quarantine'|'reject', category:string|null, score:number, reasons:string[]}}
 */
export function classifyTeardown(lead = {}, ctx = {}) {
  const email = String(lead.email || '').trim();
  const host = String(lead.websiteHost || '').trim().toLowerCase();

  const reasons = [];
  let score = 0;
  let category = null;
  const hit = (points, reason, cat) => {
    score += points;
    reasons.push(reason);
    if (cat && !category) category = cat;
  };

  // Internal diagnostics must never be filtered, exactly as on the booking form.
  if (/@davnoot\.com$/i.test(email)) {
    return { verdict: 'allow', category: null, score: 0, reasons: ['internal sender'] };
  }

  // An address we cannot send the teardown to makes the submission worthless.
  // The handler 400s on this first so a human with a typo is TOLD; reaching it
  // here means the POST bypassed the form.
  if (!EMAIL_RE.test(email)) hit(REJECT_AT, 'email field is not an email address', 'promo');
  if (!host) hit(REJECT_AT, 'no website supplied', 'test');

  // test@test.com + test.com — the two-field version of the 33-submission flood.
  const localPart = email.split('@')[0] || '';
  const hostLabel = host.split('.')[0] || '';
  if (host && isFiller(localPart) && isFiller(hostLabel)) {
    hit(REJECT_AT, 'placeholder email and website', 'test');
  }

  // Someone auditing their own agency's funnel. Held rather than rejected — it is
  // most often one of us testing the modal, and that should be visible somewhere.
  if (/(?:^|\.)davnoot\.com$/.test(host)) hit(QUARANTINE_AT, 'submitted our own domain as the website', 'test');

  if (OFF_PLATFORM_HOST.test(host)) hit(60, 'website is a redirect/messaging link', 'link-drop');
  if (IP_HOST.test(host)) hit(60, 'website is a bare IP address', 'test');

  // ── Transport tells ──────────────────────────────────────────────────────
  // Weighted exactly as on the booking form: the missing stamp sits below the
  // quarantine line alone (a stale cached script.js after a deploy would also miss
  // it) but tips anything else over.
  if (ctx.hasJsStamp === false) hit(35, 'submitted without the browser form stamp');
  if (typeof ctx.dwellMs === 'number' && ctx.dwellMs >= 0 && ctx.dwellMs < TEARDOWN_MIN_DWELL_MS) {
    hit(45, 'both fields filled in under two seconds');
  }

  /* The duplicate check fingerprints the WEBSITE only (see TEARDOWN_HASH_FIELDS).
   * With two fields and one of them rotatable, the site is the payload — including
   * the email would let a bot defeat this by changing an address it never reads.
   *
   * THE LADDER IS GENTLER THAN THE BOOKING FORM'S, on purpose. There, a repeat is
   * a byte-identical MESSAGE, which a human essentially never sends twice. Here a
   * repeat is just "someone typed acme.com again" — which is what happens when a
   * second person at the same company asks, or when the first one resubmits after
   * a flaky connection. One repeat is therefore scored BELOW the quarantine line
   * on its own: it colours the verdict without deciding it. It takes four before
   * anything is refused outright. */
  if (ctx.duplicateCount >= 3) {
    hit(REJECT_AT, `same website submitted ${ctx.duplicateCount}x recently`, 'test');
  } else if (ctx.duplicateCount === 2) {
    hit(55, 'same website submitted 2x recently', 'test');
  } else if (ctx.duplicateCount === 1) {
    hit(25, 'same website submitted once already today');
  }

  if (!category && score >= QUARANTINE_AT) category = 'test';

  const verdict = score >= REJECT_AT ? 'reject' : score >= QUARANTINE_AT ? 'quarantine' : 'allow';
  return { verdict, category: verdict === 'allow' ? null : category, score, reasons };
}

/** The fields contentHash fingerprints for a teardown. See the note above. */
export const TEARDOWN_HASH_FIELDS = ['websiteHost'];

/* ===========================================================================
 * THE THIRD FRONT DOOR: the free site-audit request (/tools/site-audit)
 * ===========================================================================
 * Seven fields, three of them required (name, email, website) and three optional
 * (company, phone, note). Shape-wise it sits between the booking form and the
 * teardown modal, and it needs its OWN entry point for exactly the reason the
 * teardown did, only worse:
 *
 *   classifyLead's first hard tell is `isFiller(brief) && (isFiller(name) ||
 *   isFiller(company))`, and isFiller('') is TRUE. An audit request with no note
 *   and no company — which is the NORMAL, most common shape, since both fields
 *   are optional — trips it and is REJECTED outright. Every single one.
 *
 * What it keeps from the booking form is the prose scoring (proseHits), because a
 * free-audit form is the most attractive door on the site for a cold agency pitch:
 * the note box is a free text field on a page that advertises we will read it.
 * What it keeps from the teardown is the website fingerprint, because the site is
 * the payload — the one field a duplicate check can meaningfully key on.
 */

/* The form is seven fields on a page people arrive at having already decided to
 * ask. Three seconds is the same floor the booking form uses, and for the same
 * reason: it is below anything human but above a password manager filling the
 * contact fields in one go. */
const AUDIT_MIN_DWELL_MS = 3000;

/**
 * Classify one site-audit request.
 *
 * @param {object} lead   { email, websiteHost, name, company, brief } — websiteHost is
 *                        the bare lowercased host from normalizeWebsite(); brief is
 *                        the optional "anything we should know" note.
 * @param {object} [ctx]  { hasJsStamp, dwellMs, duplicateCount }
 * @returns {{verdict:'allow'|'quarantine'|'reject', category:string|null, score:number, reasons:string[]}}
 */
export function classifyAudit(lead = {}, ctx = {}) {
  const email = String(lead.email || '').trim();
  const host = String(lead.websiteHost || '').trim().toLowerCase();
  const name = String(lead.name || '');
  const company = String(lead.company || '');
  const brief = String(lead.brief || '');

  const reasons = [];
  let score = 0;
  let category = null;
  const hit = (points, reason, cat) => {
    score += points;
    reasons.push(reason);
    if (cat && !category) category = cat;
  };

  // Internal diagnostics must never be filtered, exactly as on the other doors.
  if (/@davnoot\.com$/i.test(email)) {
    return { verdict: 'allow', category: null, score: 0, reasons: ['internal sender'] };
  }

  // ── Hard tells ───────────────────────────────────────────────────────────
  // A human with a typo is 400'd by the handler before reaching here, so an
  // invalid address at this point means the POST bypassed the form. An audit we
  // cannot deliver is worthless however sincere it was.
  if (!EMAIL_RE.test(email)) hit(REJECT_AT, 'email field is not an email address', 'promo');
  if (!host) hit(REJECT_AT, 'no website supplied', 'test');

  // test@test.com + test.com, the shape the 2026-08 flood used.
  const localPart = email.split('@')[0] || '';
  const hostLabel = host.split('.')[0] || '';
  if (host && isFiller(localPart) && isFiller(hostLabel)) {
    hit(REJECT_AT, 'placeholder email and website', 'test');
  }

  /* The name is REQUIRED by this form, so filler in it is evidence — unlike the
   * optional company and note fields, whose emptiness means nothing and must
   * never be scored. Guarded on `name &&` because isFiller('') is true and an
   * unguarded call would reject every request that somehow arrived without one. */
  if (name && isFiller(name)) hit(45, 'placeholder name', 'test');

  proseRejects(brief).forEach((h) => hit(...h));

  // Someone requesting an audit of our own site. Held rather than rejected: it is
  // most often one of us testing the form, and that should be visible somewhere.
  if (/(?:^|\.)davnoot\.com$/.test(host)) hit(QUARANTINE_AT, 'submitted our own domain as the website', 'test');

  if (OFF_PLATFORM_HOST.test(host)) hit(60, 'website is a redirect/messaging link', 'link-drop');
  if (IP_HOST.test(host)) hit(60, 'website is a bare IP address', 'test');

  // ── Transport tells ──────────────────────────────────────────────────────
  if (ctx.hasJsStamp === false) hit(35, 'submitted without the browser form stamp');
  if (typeof ctx.dwellMs === 'number' && ctx.dwellMs >= 0 && ctx.dwellMs < AUDIT_MIN_DWELL_MS) {
    hit(45, 'whole form filled in under three seconds');
  }

  /* Keyed on the WEBSITE (AUDIT_HASH_FIELDS), and the ladder is the teardown's
   * rather than the booking form's. A repeat here is "someone typed acme.com
   * again", which happens when a second person at the company asks or when the
   * first one resubmits after a flaky connection — not the booking form's
   * byte-identical MESSAGE, which a human essentially never sends twice. */
  if (ctx.duplicateCount >= 3) {
    hit(REJECT_AT, `same website submitted ${ctx.duplicateCount}x recently`, 'test');
  } else if (ctx.duplicateCount === 2) {
    hit(55, 'same website submitted 2x recently', 'test');
  } else if (ctx.duplicateCount === 1) {
    hit(25, 'same website submitted once already today');
  }

  // ── Content tells ────────────────────────────────────────────────────────
  // The same rules the booking form's brief gets. An empty note scores nothing:
  // every regex here needs something to match.
  proseHits(brief, email, company).forEach((h) => hit(...h));

  if (!category && score >= QUARANTINE_AT) category = 'agency-pitch';

  const verdict = score >= REJECT_AT ? 'reject' : score >= QUARANTINE_AT ? 'quarantine' : 'allow';
  return { verdict, category: verdict === 'allow' ? null : category, score, reasons };
}

/** The fields contentHash fingerprints for an audit request — the website, as for
 *  the teardown. Name and note are NOT included: a person who resubmits after
 *  rewording their note has not sent a duplicate, they have sent a correction. */
export const AUDIT_HASH_FIELDS = ['websiteHost'];

/* ===========================================================================
 * THE FOURTH FRONT DOOR: "have a human review this draft" (/tools/content-analyzer)
 * ===========================================================================
 * One field the visitor types — an email — plus the draft they had already pasted
 * into a tool that scored it in their own browser. The card only appears AFTER a
 * successful analysis, so by the time this runs the person has written something
 * and watched it graded.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  THE ANALYZED DRAFT MUST NEVER BE RUN THROUGH proseHits / proseRejects.
 * ───────────────────────────────────────────────────────────────────────────
 * This is the single most important line in this section. The draft is a piece of
 * MARKETING COPY the person is about to publish — so it legitimately contains
 * outbound links, prices and discounts, "subscribe to our newsletter", "free
 * shipping", "reply YES", and every other phrase those rules exist to catch. A
 * Shopify owner pasting a perfectly ordinary product-launch post would score past
 * REJECT_AT on its own merits and be silently destroyed. The rules are calibrated
 * for a message written TO US; this field is not that, and the distinction is the
 * whole reason this classifier exists separately instead of reusing classifyLead.
 *
 * So the signal here is transport and shape only: was the form stamped by our
 * script, is there actually a draft attached, and has this exact draft been sent
 * before.
 */

/* t0 is stamped when the capture card is REVEALED, not at page load — someone
 * can spend twenty minutes in the analyzer before the card even exists, and
 * measuring from load would read every real submission as a twenty-minute dwell
 * and every bot's as suspicious only by accident. Two seconds from "a card
 * appeared" to "an address was typed and submitted" is below human. */
const REVIEW_MIN_DWELL_MS = 2000;

/** A draft shorter than this was never analyzed — the tool needs 20 words before
 *  it will even show a score, let alone the capture card. */
const REVIEW_MIN_CHARS = 60;

/**
 * Classify one content-review request.
 *
 * @param {object} lead   { email, content } — `content` is the draft the visitor
 *                        analyzed, already truncated by the handler.
 * @param {object} [ctx]  { hasJsStamp, dwellMs, duplicateCount }
 * @returns {{verdict:'allow'|'quarantine'|'reject', category:string|null, score:number, reasons:string[]}}
 */
export function classifyContentReview(lead = {}, ctx = {}) {
  const email = String(lead.email || '').trim();
  const content = String(lead.content || '');

  const reasons = [];
  let score = 0;
  let category = null;
  const hit = (points, reason, cat) => {
    score += points;
    reasons.push(reason);
    if (cat && !category) category = cat;
  };

  if (/@davnoot\.com$/i.test(email)) {
    return { verdict: 'allow', category: null, score: 0, reasons: ['internal sender'] };
  }

  if (!EMAIL_RE.test(email)) hit(REJECT_AT, 'email field is not an email address', 'promo');

  /* No draft, no request. The card is rendered only once the analyzer has scored
   * something, so an empty payload means the POST was assembled by hand — and a
   * review request with nothing to review is not a lead under any reading. */
  if (content.trim().length < REVIEW_MIN_CHARS) {
    hit(REJECT_AT, 'no draft attached to the review request', 'test');
  }

  // A filler address with a filler draft. Checked on the LOCAL PART only: the
  // domain is routinely a real mailbox provider and says nothing either way.
  const localPart = email.split('@')[0] || '';
  if (isFiller(localPart) && isFiller(content)) hit(REJECT_AT, 'placeholder email and draft', 'test');

  // ── Transport tells ──────────────────────────────────────────────────────
  if (ctx.hasJsStamp === false) hit(35, 'submitted without the browser form stamp');
  if (typeof ctx.dwellMs === 'number' && ctx.dwellMs >= 0 && ctx.dwellMs < REVIEW_MIN_DWELL_MS) {
    hit(45, 'address typed and submitted in under two seconds');
  }

  /* Keyed on the DRAFT (REVIEW_HASH_FIELDS). Deliberately the gentlest ladder of
   * the four doors: the expected good behaviour here is a writer pasting draft
   * after draft, and each one is a DIFFERENT payload, so a genuine power user
   * never trips this at all. What it catches is the same draft replayed — a
   * double-click, or a script looping one body through many addresses. The first
   * repeat scores well under the line because a double-click is not spam. */
  if (ctx.duplicateCount >= 3) {
    hit(REJECT_AT, `same draft submitted ${ctx.duplicateCount}x recently`, 'test');
  } else if (ctx.duplicateCount === 2) {
    hit(50, 'same draft submitted 2x recently', 'test');
  } else if (ctx.duplicateCount === 1) {
    hit(20, 'same draft submitted once already today');
  }

  if (!category && score >= QUARANTINE_AT) category = 'test';

  const verdict = score >= REJECT_AT ? 'reject' : score >= QUARANTINE_AT ? 'quarantine' : 'allow';
  return { verdict, category: verdict === 'allow' ? null : category, score, reasons };
}

/** The fields contentHash fingerprints for a content review — the draft itself. */
export const REVIEW_HASH_FIELDS = ['content'];

/**
 * Stable fingerprint of a submission's human-authored content, used to spot a
 * flood replaying one payload from many IPs. For the booking form it deliberately
 * ignores email and timeSlot: the flood rotated the email field while
 * name/company/brief stayed byte-identical.
 *
 * @param {object} lead
 * @param {string[]} [fields]  which fields make up the payload. Defaults to the
 *                             booking form's; pass TEARDOWN_HASH_FIELDS for the
 *                             two-field modal, whose only payload is the website.
 */
export function contentHash(lead = {}, fields = ['name', 'company', 'brief']) {
  const basis = fields.map((f) => norm(lead[f])).join('|');
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
