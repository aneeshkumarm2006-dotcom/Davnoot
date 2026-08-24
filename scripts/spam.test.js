/* The booking-form spam classifier, pinned against real traffic.
 *
 * ===========================================================================
 * WHY THESE FIXTURES ARE VERBATIM
 * ===========================================================================
 * Every SPAM case below is a message that actually arrived at /api/book-call
 * between 2026-07-15 and 2026-08-23, copied out of the leads collection with
 * only the sender's address changed where it was a third party's. Every GENUINE
 * case is either the one real lead in that same window (Ria Johnston, whose
 * enquiry the first draft of this classifier rejected as keyboard mash) or a
 * shape the agency demonstrably sells to.
 *
 * A spam filter is a piece of code that silently decides which prospects the
 * business never hears from. The only defensible way to change one is to have
 * the corpus assert it still lets the good ones through — so the GENUINE block
 * matters far more than the SPAM block. If a future rule breaks a case in it,
 * that rule is wrong, however much junk it catches.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLead, classifyTeardown, contentHash, ipPrefix,
  SERVICE_CODES, SPAM_CATEGORY_KEYS, QUARANTINE_AT, REJECT_AT, TEARDOWN_HASH_FIELDS,
} from '../lib/spam.js';
import { normalizeWebsite } from '../lib/lead-intake.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

/* ── Messages that must NEVER be filtered ──────────────────────────────────
 * These are the business. A failure here is a lost customer, not a noisy inbox. */
const GENUINE = [
  {
    what: 'the real 2026-07-31 partnership lead (rejected by the first draft)',
    name: 'Ria Johnston', email: 'ria@studio-kind.com', company: 'Studio-kind.com',
    role: 'Founder', service: 'multi',
    brief: "Hello, David Ohayon sent me your way. I'm interested in talking about a potential white label partnership and having your team support my agency with SEO and website development. I have two projects I'd like to get your eyes on so we can talk about collaborating and getting a quote from you. Looking forward to speaking! Ria",
  },
  {
    what: 'a budget quoted in dollars — the single most common real-lead shape',
    name: 'Sam Reyes', email: 'sam@northpeak.io', company: 'Northpeak', role: 'CMO', service: 'meta',
    brief: "We're spending $45,000/month on Meta and ROAS dropped from 3.2 to 1.4 since June. Need someone to audit the account and rebuild creative testing.",
  },
  {
    what: 'a prospect linking their OWN site',
    name: 'Bob Chen', email: 'bob@acmesupply.com', company: 'Acme Supply', role: 'Founder', service: 'seo',
    brief: 'Our site is https://acmesupply.com and we rank nowhere for our main product terms. Can you take a look before we talk?',
  },
  {
    what: 'a free-mail address linking the company site',
    name: 'Dana Fox', email: 'danafox88@gmail.com', company: 'Fox Dental', service: '',
    brief: 'Hi, I run foxdental.ca in Laval. We get no calls from Google. What would it cost to fix?',
  },
  {
    what: 'a terse brief with no detail at all',
    name: 'Marc Tremblay', email: 'marc@boulangerie-tr.ca', company: 'Boulangerie TR', service: 'multi',
    brief: 'Need help with everything. Not sure where to start.',
  },
  {
    what: 'a buyer using the same vocabulary as the spammers (SEO, audit, backlinks)',
    name: 'Priya Nair', email: 'priya@saasly.com', company: 'Saasly', role: 'Head of Growth', service: 'ai-seo',
    brief: 'We want to show up in AI Overviews and ChatGPT answers. Competitors are getting cited and we are not. Also need backlinks and a free audit of our current content if you offer one.',
  },
  {
    what: 'French, with a dollar amount',
    name: 'Julie Gagnon', email: 'julie@lesjardins.qc.ca', company: 'Les Jardins', service: 'seo',
    brief: 'Bonjour, nous cherchons une agence pour ameliorer notre referencement local a Montreal. Notre budget est de 3000$ par mois.',
  },
  {
    what: 'a solo consultant whose company is their own name',
    name: 'Jane Smith', email: 'jane@janesmith.co', company: 'Jane Smith', service: 'email',
    brief: 'Solo consultant, need Klaviyo flows rebuilt for a client launching in October.',
  },
];

/* ── Messages that must be rejected outright ──────────────────────────────── */
const REJECT = [
  {
    what: 'the 33x flood payload',
    name: 'Test', email: 'someone@gmail.com', company: 'Test Company',
    service: 'Choose one (or leave blank)', brief: 'Test',
    category: 'test',
  },
  {
    what: 'a name in the email field (produced the Resend 422s)',
    name: 'Lance', email: 'Lance Luffman', company: 'Lance Luffman', service: 'multi',
    brief: 'I wanted to reach out about our new dog harness. Get yours today with 50% OFF: https://caredogbest.com FREE Shipping - TODAY ONLY!',
  },
  {
    what: 'a URL in the email field',
    name: 'Waqar', email: 'https://alfareviews.com', company: 'Alfa Agency', service: 'chatgpt-ads',
    brief: "Most local businesses lose customers because they don't rank on Google. Reply to this email and we'll send you the audit, free.",
  },
  {
    what: 'keyboard mash',
    name: 'Terrysup', email: 'dylan-wood32pjfj@gmx.us', company: 'google', service: 'email',
    brief: 'Egjnjmfnefjwdifj fkmdkdwdwkdwjj fkmfkengjkfmsdnfejfk mkfmkdmwjefnejfem davnoot.com',
  },
  {
    what: 'a bulk-mail unsubscribe footer',
    name: 'Dotty', email: 'turnerf.isher348382@gmail.com', company: 'Dotty Lockett', service: 'chatgpt-ads',
    brief: 'Need a stronger online presence for davnoot.com? We are SEObyAxy. Check out all our services here: http://utraker.com/InrHo To unsubscribe, please reply with subject: Unsubscribe !davnoot.com',
  },
  {
    what: 'a WhatsApp drop',
    name: 'Oliver', email: 'oliver@reviewremoval.uk', company: 'Reviews Management', service: 'multi',
    brief: 'Get some Positive Reviews on your business profile. We also handle negative reviews removal. Reply by email or via WhatsApp: https://wa.me/447575802542',
  },
  {
    what: 'a Telegram form-blaster advertising itself',
    name: 'Davidunows', email: 'no.reply.RobertVisser@gmail.com', company: 'google', service: 'ai-seo',
    brief: 'I came across davnoot.com while browsing websites. Our service allows automated contact form messaging. A free test is available. Telegram - https://t.me/FeedbackFormEU WhatsApp - https://wa.me/+375259112693',
  },
  {
    what: 'a three-marker mailing-list bot',
    name: 'Ashley Jones', email: 'matthewng2007@icloud.com', company: 'Jones Consulting', service: '',
    brief: "Hi! I'd like to subscribe to your newsletter. I am interested in your latest news. Thank you.",
    category: 'bot-subscribe',
  },
  {
    what: 'a video-production cold pitch',
    name: 'Joanna', email: 'joriggsvideo3@gmail.com', company: 'Lucas Ryan', service: '',
    brief: "Hi, I just visited davnoot.com and wondered if you've ever considered an impactful video to advertise your business? I can show you some previous videos we've done if you want me to send some over. Let me know if you're interested in seeing samples of our previous work.",
  },
];

/* ── Messages that should be held, not destroyed ───────────────────────────
 * Plausibly human, definitely unwanted. Quarantine keeps them readable in the
 * Spam tab, which costs nothing if the call was wrong. */
const QUARANTINE = [
  {
    what: 'a two-marker mailing-list bot',
    name: 'Amanda Garcia', email: 'zogglezumzums@gmail.com', company: 'Redwood Co', service: '',
    brief: "Hi! I'm interested in your mailing list. I look forward to updates. Thanks in advance.",
    category: 'bot-subscribe',
  },
  {
    what: 'a real human sending real cold outreach from their real company',
    name: 'Hannah Melotto', email: 'hannah.melotto@melottogroup.com', company: 'Melotto Group',
    role: 'Software Developer', service: '',
    brief: 'Hi, I am Hannah from Melotto Group. We help businesses redesign their websites. I took a quick look at your site and saw a few opportunities. Grab a time here: http://calendar.melottogroup.com/',
  },
];

describe('genuine leads are never filtered', () => {
  for (const lead of GENUINE) {
    test(lead.what, () => {
      const v = classifyLead(lead, { hasJsStamp: true, dwellMs: 60000, duplicateCount: 0 });
      assert.equal(
        v.verdict, 'allow',
        `scored ${v.score} (${v.reasons.join('; ')}) — this rule would cost the business a customer`,
      );
    });
  }
});

describe('spam is rejected before it reaches the inbox', () => {
  for (const lead of REJECT) {
    test(lead.what, () => {
      const v = classifyLead(lead, { hasJsStamp: false, dwellMs: null, duplicateCount: 0 });
      assert.equal(v.verdict, 'reject', `only scored ${v.score}: ${v.reasons.join('; ')}`);
      if (lead.category) assert.equal(v.category, lead.category);
    });
  }
});

describe('borderline spam is held, not destroyed', () => {
  for (const lead of QUARANTINE) {
    test(lead.what, () => {
      const v = classifyLead(lead, { hasJsStamp: true, dwellMs: 60000, duplicateCount: 0 });
      assert.equal(v.verdict, 'quarantine', `scored ${v.score}: ${v.reasons.join('; ')}`);
      if (lead.category) assert.equal(v.category, lead.category);
    });
  }
});

describe('the internal escape hatch', () => {
  // Prem's own form diagnostics all say "test" and would otherwise be the first
  // thing the filler rule eats. Losing them means losing the ability to check
  // that the form works at all.
  test('an @davnoot.com sender is always allowed, whatever they write', () => {
    const v = classifyLead({
      name: 'Test', email: 'prem@davnoot.com', company: 'Test Company', brief: 'Test',
      service: 'Choose one (or leave blank)',
    }, { hasJsStamp: false, duplicateCount: 5 });
    assert.equal(v.verdict, 'allow');
  });
});

describe('transport signals', () => {
  const clean = { name: 'Alex Roy', email: 'alex@roygroup.ca', company: 'Roy Group', service: 'seo', brief: 'We need help with local SEO in Montreal for three locations.' };

  test('a clean lead with no JS stamp still gets through', () => {
    // 35 points on its own. A browser holding a stale cached script.js right
    // after a deploy must not have its lead bounced.
    const v = classifyLead(clean, { hasJsStamp: false });
    assert.equal(v.verdict, 'allow');
    assert.ok(v.score < QUARANTINE_AT);
  });

  test('a form filled in under three seconds is held', () => {
    const v = classifyLead(clean, { hasJsStamp: true, dwellMs: 900 });
    assert.equal(v.verdict, 'quarantine');
  });

  test('the same payload seen twice more in 24h is rejected', () => {
    const v = classifyLead(clean, { hasJsStamp: true, dwellMs: 60000, duplicateCount: 2 });
    assert.equal(v.verdict, 'reject');
  });

  test('a service value the <select> cannot emit is a bot tell', () => {
    const v = classifyLead({ ...clean, service: 'Choose one (or leave blank)' }, { hasJsStamp: true, dwellMs: 60000 });
    assert.notEqual(v.verdict, 'allow');
  });
});

describe('the service enum cannot drift from the form or the email template', () => {
  // Three copies of this list exist: the <select> in book-call.html, the label
  // map in api/book-call.js, and SERVICE_CODES. If they disagree, either a real
  // submission gets scored as a bot tell or a bot tell stops being one.
  const html = fs.readFileSync(path.join(ROOT, 'book-call.html'), 'utf8');
  const select = html.match(/<select[^>]*name="service"[\s\S]*?<\/select>/)?.[0] || '';
  const fromHtml = [...select.matchAll(/value="([^"]*)"/g)].map((m) => m[1]);

  test('book-call.html emits exactly the codes SERVICE_CODES allows', () => {
    assert.deepEqual([...fromHtml].sort(), [...SERVICE_CODES].sort());
  });

  test('api/book-call.js labels every non-empty code', () => {
    const api = fs.readFileSync(path.join(ROOT, 'api', 'book-call.js'), 'utf8');
    const block = api.match(/const SERVICE_LABELS = \{[\s\S]*?\};/)?.[0] || '';
    for (const code of SERVICE_CODES.filter(Boolean)) {
      assert.ok(
        block.includes(`'${code}'`) || new RegExp(`\\b${code.replace(/[-]/g, '-')}\\s*:`).test(block),
        `SERVICE_LABELS has no entry for "${code}"`,
      );
    }
  });
});

describe('helpers', () => {
  test('contentHash ignores the rotating email but not the message', () => {
    const a = { name: 'Test', company: 'Test Company', brief: 'Test', email: 'a@x.com' };
    const b = { name: 'Test', company: 'Test Company', brief: 'Test', email: 'b@y.com' };
    assert.equal(contentHash(a), contentHash(b), 'the flood rotated addresses, not payloads');
    assert.notEqual(contentHash(a), contentHash({ ...a, brief: 'Something else entirely' }));
  });

  test('ipPrefix collapses the rented /24 the flood rotated inside', () => {
    assert.equal(ipPrefix('193.233.203.141'), '193.233.203.0/24');
    assert.equal(ipPrefix('193.233.203.150'), '193.233.203.0/24');
    assert.notEqual(ipPrefix('95.182.114.251'), ipPrefix('193.233.203.150'));
    assert.equal(ipPrefix('unknown'), 'unknown');
    assert.equal(ipPrefix('2a02:c7f:1234:5678::1'), '2a02:c7f:1234::/48');
  });

  test('thresholds are ordered', () => {
    assert.ok(QUARANTINE_AT > 0 && REJECT_AT > QUARANTINE_AT);
  });

  test('every category the classifier can assign has a label the admin can render', () => {
    // The labels travel with the leads payload. The admin must not restate the
    // list (it would drift) and must not import lib/spam.js either (that would
    // inline it into a bundle whose freshness hash only covers src/).
    const api = fs.readFileSync(path.join(ROOT, 'api', 'admin', 'leads', 'index.js'), 'utf8');
    assert.match(api, /categories: SPAM_CATEGORIES/, 'the leads endpoint must ship the category labels');

    const view = fs.readFileSync(path.join(ROOT, 'src', 'admin', 'views', 'leads.js'), 'utf8');
    assert.doesNotMatch(view, /from '[^']*lib\/spam\.js'/, 'the admin must take categories from the payload');
    assert.match(view, /data\.categories/, 'the admin must read the payload it is sent');

    assert.ok(SPAM_CATEGORY_KEYS.includes('manual'), 'hand-marked spam needs a category');
  });
});

/* ===========================================================================
 * THE SECOND FRONT DOOR: the /blog funnel-teardown modal
 * ===========================================================================
 * The trap this whole block exists to nail down: the teardown lead has NO name,
 * NO company and NO brief, and `isFiller('')` is true — so running one through
 * classifyLead() rejects it as "placeholder name/company/message". Every single
 * teardown, silently, with a 200 OK to the visitor. The first assertion below is
 * that failure written down, so nobody ever "simplifies" the two classifiers back
 * into one without meeting it.
 */
describe('the funnel-teardown classifier', () => {
  const good = { email: 'sam@northpeak.io', websiteHost: 'northpeak.io' };
  const browser = { hasJsStamp: true, dwellMs: 30000, duplicateCount: 0 };

  test('a teardown run through the BOOKING classifier is destroyed — hence the split', () => {
    const asBookingLead = { name: '', company: '', brief: '', email: good.email };
    assert.equal(classifyLead(asBookingLead, browser).verdict, 'reject');
    assert.equal(classifyTeardown(good, browser).verdict, 'allow');
  });

  test('an ordinary request from a browser is allowed', () => {
    const v = classifyTeardown(good, browser);
    assert.equal(v.verdict, 'allow', v.reasons.join('; '));
    assert.equal(v.category, null);
  });

  test('a free-mail address with an unrelated website is still a real lead', () => {
    // The most common shape a small business submits. Nothing about it is a signal.
    const v = classifyTeardown({ email: 'joanne@gmail.com', websiteHost: 'joannesflowers.ca' }, browser);
    assert.equal(v.verdict, 'allow', v.reasons.join('; '));
  });

  test('an @davnoot.com sender is always allowed', () => {
    const v = classifyTeardown({ email: 'prem@davnoot.com', websiteHost: 'davnoot.com' }, { hasJsStamp: false, dwellMs: 5, duplicateCount: 9 });
    assert.equal(v.verdict, 'allow');
  });

  test('an address we cannot reply to is rejected', () => {
    assert.equal(classifyTeardown({ email: 'not-an-email', websiteHost: 'acme.com' }, browser).verdict, 'reject');
  });

  test('test@test.com + test.com is rejected', () => {
    assert.equal(classifyTeardown({ email: 'test@test.com', websiteHost: 'test.com' }, browser).verdict, 'reject');
  });

  test('a messaging link submitted as a website is held', () => {
    const v = classifyTeardown({ email: 'x@mail.com', websiteHost: 't.me' }, browser);
    assert.equal(v.verdict, 'quarantine');
    assert.equal(v.category, 'link-drop');
  });

  test('our own domain is held, not rejected — it is usually one of us testing', () => {
    const v = classifyTeardown({ email: 'someone@elsewhere.com', websiteHost: 'davnoot.com' }, browser);
    assert.equal(v.verdict, 'quarantine');
  });

  test('a clean submission with no browser stamp still gets through', () => {
    // Same posture as the booking form: a stale cached script.js right after a
    // deploy must not bounce real leads.
    const v = classifyTeardown(good, { hasJsStamp: false, dwellMs: null, duplicateCount: 0 });
    assert.equal(v.verdict, 'allow', v.reasons.join('; '));
  });

  test('no stamp AND an instant fill is held', () => {
    const v = classifyTeardown(good, { hasJsStamp: false, dwellMs: 200, duplicateCount: 0 });
    assert.equal(v.verdict, 'quarantine');
  });

  /* The gentler ladder. A repeat here is 'someone typed acme.com again', not a
   * byte-identical message — so one repeat must NOT be enough to hold a lead. */
  test('a second person at the same company is a lead, not a duplicate', () => {
    const v = classifyTeardown({ email: 'cfo@northpeak.io', websiteHost: 'northpeak.io' }, { ...browser, duplicateCount: 1 });
    assert.equal(v.verdict, 'allow', v.reasons.join('; '));
  });

  test('a third and fourth repeat escalate — held, then refused', () => {
    assert.equal(classifyTeardown(good, { ...browser, duplicateCount: 2 }).verdict, 'quarantine');
    assert.equal(classifyTeardown(good, { ...browser, duplicateCount: 3 }).verdict, 'reject');
  });

  test('one repeat still colours the verdict when something else is off', () => {
    // 25 (repeat) + 35 (no browser stamp) clears the quarantine line together,
    // which is the point of scoring it below the line rather than ignoring it.
    const v = classifyTeardown(good, { hasJsStamp: false, dwellMs: null, duplicateCount: 1 });
    assert.equal(v.verdict, 'quarantine');
  });

  test('every category it can assign has a label the admin can render', () => {
    for (const shape of [
      { lead: { email: 'x@y.com', websiteHost: 't.me' }, ctx: browser },
      { lead: { email: 'test@test.com', websiteHost: 'test.com' }, ctx: browser },
      { lead: { email: 'bad', websiteHost: 'acme.com' }, ctx: browser },
    ]) {
      const v = classifyTeardown(shape.lead, shape.ctx);
      assert.ok(SPAM_CATEGORY_KEYS.includes(v.category), `unlabelled category: ${v.category}`);
    }
  });

  test('the duplicate fingerprint keys on the website, not the rotating email', () => {
    const a = contentHash({ websiteHost: 'acme.com' }, TEARDOWN_HASH_FIELDS);
    const b = contentHash({ websiteHost: 'acme.com', email: 'someone-else@x.com' }, TEARDOWN_HASH_FIELDS);
    assert.equal(a, b, 'a bot rotating addresses must not defeat the duplicate check');
    assert.notEqual(a, contentHash({ websiteHost: 'othersite.com' }, TEARDOWN_HASH_FIELDS));
  });

  test('contentHash still defaults to the booking form fields', () => {
    // The teardown added a second argument; the booking form calls it with one.
    const lead = { name: 'A', company: 'B', brief: 'C' };
    assert.equal(contentHash(lead), contentHash(lead, ['name', 'company', 'brief']));
  });

  test('the intake labels travel with the payload, like the spam categories do', () => {
    const api = fs.readFileSync(path.join(ROOT, 'api', 'admin', 'leads', 'index.js'), 'utf8');
    assert.match(api, /sources: LEAD_SOURCES/, 'the leads endpoint must ship the source labels');
    const view = fs.readFileSync(path.join(ROOT, 'src', 'admin', 'views', 'leads.js'), 'utf8');
    assert.match(view, /data\.sources/, 'the admin must read the source labels it is sent');
  });
});

describe('normalizeWebsite', () => {
  test('the four ways people type the same site collapse to one host', () => {
    const hosts = ['acme.com', 'www.acme.com', 'https://acme.com/', 'HTTPS://WWW.ACME.COM'].map(
      (raw) => normalizeWebsite(raw).host,
    );
    assert.deepEqual(hosts, ['acme.com', 'acme.com', 'acme.com', 'acme.com']);
  });

  test('a path is kept — /pricing is real context for the teardown', () => {
    assert.equal(normalizeWebsite('acme.com/pricing').url, 'https://acme.com/pricing');
    assert.equal(normalizeWebsite('https://acme.com/pricing/').url, 'https://acme.com/pricing');
  });

  test('the scheme is normalised to https so two spellings hash alike', () => {
    assert.equal(normalizeWebsite('http://acme.com').host, normalizeWebsite('https://acme.com').host);
  });

  test('non-websites are refused', () => {
    for (const bad of ['', '   ', 'acme', 'not a url', 'mailto:me@acme.com', 'javascript:alert(1)', 'https://', '.com']) {
      assert.equal(normalizeWebsite(bad), null, `should have refused: ${JSON.stringify(bad)}`);
    }
  });

  test('a bare IP parses but is scored as a bot tell rather than silently accepted', () => {
    const site = normalizeWebsite('203.0.113.7');
    assert.equal(site.host, '203.0.113.7');
    assert.equal(classifyTeardown({ email: 'x@y.com', websiteHost: site.host }, { hasJsStamp: true, dwellMs: 9000, duplicateCount: 0 }).verdict, 'quarantine');
  });

  test('a subdomain is preserved — app.acme.com is not acme.com', () => {
    assert.equal(normalizeWebsite('app.acme.com').host, 'app.acme.com');
  });
});
