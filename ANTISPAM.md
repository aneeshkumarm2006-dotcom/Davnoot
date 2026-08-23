# Booking-form anti-spam

What protects `/api/book-call`, why each layer exists, and the one thing left for
a human to do (turn on Turnstile).

## Why

On 2026-08-23 the `leads` collection held 62 documents. **One** was a real
prospect — a referred white-label agency partnership from Ria Johnston — and it
was buried under 33 identical `Test / Test Company / Test` submissions, 10 fake
newsletter bots, and 15 cold pitches. It had also never been emailed (a Resend
misconfiguration from before the Gmail switch), so nobody replied to it.

The problem was never that spam is annoying. It is that spam is how a real lead
gets missed.

## The layers, in the order a request meets them

| # | Layer | Where | Fails |
|---|-------|-------|-------|
| 1 | Honeypot (`bot-field`) | `book-call.html` + handler | open |
| 2 | Turnstile (invisible CAPTCHA) | `api/book-call.js` | **closed**, only when `TURNSTILE_SECRET_KEY` is set |
| 3 | Rate limits: per IP, per email, per /24 subnet | `api/book-call.js` | open |
| 4 | Duplicate-payload detection (24h) | `api/book-call.js` | open |
| 5 | Content classifier | `lib/spam.js` | open |

"Fails open" means: if Mongo is unreachable or Cloudflare is down, the
submission is **allowed**. A booking form that drops real leads when a dependency
blips is worse than one that occasionally lets a bot through.

### 3 — why a subnet limit

The flood came from `193.233.203.141`, `.149` and `.150`: three addresses, one
rented /24, each politely staying under the 5-per-IP limit. Capping the
neighbourhood (8/hour) is what makes rotation cost the operator something.

### 4 — why a duplicate check

All 33 flood submissions were byte-identical in name, company and message while
the email field rotated through harvested third-party addresses. `contentHash()`
hashes only the human-authored fields, so the payload is recognisable however
many addresses it arrives under.

### 5 — the classifier

Three verdicts:

- **allow** — stored, emailed, in the Inbox tab.
- **quarantine** — stored and categorised, **not emailed**, in the Spam tab.
- **reject** — never written to `leads` at all. The response is still
  `200 {ok:true}` so the bot sees success and does not adapt. A copy goes to
  `blocked_submissions` with a 30-day TTL and shows in the Blocked tab.

Categories: `test`, `gibberish`, `bot-subscribe`, `link-drop`, `promo`,
`agency-pitch`, `manual`.

**Every rule fires on the DIRECTION of a message, never its topic.** "We can get
you ranking on Google, reply YES" is spam; "we need help ranking on Google" is
the exact lead this agency sells to. The signals are things a buyer never does:
drop an outbound link, quote a discount, hand over a WhatsApp number, template
our own domain into the message, ask to join a mailing list.

Two rules were removed during development for exactly this reason, and both are
worth remembering before adding anything:

- **A bare `$` figure is not a spam signal.** Real briefs constantly say "our
  budget is $8k/month". Only retail boilerplate (`50% OFF`, `FREE shipping`)
  counts.
- **A link to the sender's own site is not a spam signal.** `foreignLinks()`
  discounts any URL whose host echoes the sender's email domain or company name.

Anything from `@davnoot.com` is whitelisted outright, so internal diagnostics
always come through.

## Turning Turnstile on

Free, needs no Cloudflare DNS, and does not require moving the domain.

1. <https://dash.cloudflare.com> → **Turnstile** → **Add widget**
2. Hostnames: `www.davnoot.com`, `davnoot.com`, `localhost`
3. Widget mode: **Managed**
4. Copy the **Site Key** and **Secret Key**
5. Vercel → Project → Settings → Environment Variables, for **Production**:
   - `TURNSTILE_SITE_KEY` = the site key
   - `TURNSTILE_SECRET_KEY` = the secret key
6. Redeploy

That is the whole change — **no code edit, no HTML edit**. `script.js` reads the
site key from `/api/form-config` and injects the widget; `api/book-call.js` sees
the secret and starts requiring a valid token.

Set **both** keys or neither. The secret is what enforces, the site key is what
renders; setting only the secret would reject every submission.

### Why the widget is injected by script rather than written into the HTML

`book-call.html` is a CMS marketing page, which means it exists in four
synchronised copies (`site/`, `pages/`, the frozen golden fixture, and a French
translation keyed on the exact English source string). Adding a `<div>` to it is
a four-file change plus a re-freeze plus an `fr.json` entry — and getting it
wrong either fails the byte-exact golden test or silently de-indexes
`/fr/book-call`. An env var costs nothing.

### One thing to remember about the CSP

`vercel.json` allowlists `https://challenges.cloudflare.com` in both `script-src`
and `connect-src`. Without those the widget is silently blocked and every
submission fails verification. `frame-src` already permits `https:`.

## Operating it

**The Spam tab** — `/admin` → Leads. Each row shows its category and the exact
reasons that produced the verdict, so a call is never a black box. "Not spam"
moves a row back to the Inbox and clears the machine's reasoning. "Delete all
spam" empties the tab (admin role only, irreversible).

**The Blocked tab** — submissions rejected at the door, kept 30 days. This is
what makes the hard-reject rules safe to be sharp: check it occasionally, and if
something real is in there, the filter needs fixing and that person needs an
email.

**Backfilling existing leads** — `node scripts/classify-leads.js` prints what it
would do; `--apply` writes. It never deletes, and it never overrides a human's
hand-marked call.

**Indexes** — `npm run db:indexes` after pulling. It retunes the `form_attempts`
TTL from 1h to 24h in place via `collMod` (dropping and recreating would leave
the collection with no TTL in between).

## Changing the rules

`scripts/spam.test.js` pins the classifier against real traffic: verbatim spam
from the 2026-07/08 window, and a set of genuine-lead shapes.

The GENUINE block matters far more than the SPAM block. **If a new rule breaks a
case in it, the rule is wrong, however much junk it catches.** The first draft of
this classifier scored words by vowel ratio, decided "partnership" and "projects"
were keyboard mash, and rejected the only real lead in the collection.
