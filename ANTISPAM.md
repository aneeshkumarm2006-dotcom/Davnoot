# Lead-form anti-spam

What protects the two public lead forms, why each layer exists, and the one thing
left for a human to do (turn on Turnstile).

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
| 1 | Honeypot (`bot-field`) | the form markup + each handler | open |
| 2 | Turnstile (invisible CAPTCHA) | `lib/lead-intake.js` | **closed**, only when `TURNSTILE_SECRET_KEY` is set |
| 3 | Rate limits: per IP, per email, per /24 subnet | `lib/lead-intake.js` | open |
| 4 | Duplicate-payload detection (24h) | `lib/lead-intake.js` | open |
| 5 | Content classifier | `lib/spam.js` | open |

Layers 2–4 are shared by both intakes (see below); layer 5 has one classifier per
form shape, because the two forms do not collect the same things.

"Fails open" means: if Mongo is unreachable or Cloudflare is down, the
submission is **allowed**. A lead form that drops real leads when a dependency
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

- **allow** — stored, in the Inbox tab, and emailed *if that intake notifies*
  (`/book-call` does; the teardown deliberately does not — see below).
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

## The second front door: the blog teardown modal

Since 2026-08-24 there are **two** public intakes, not one:

| Intake | Endpoint | Fields | Classifier |
|--------|----------|--------|------------|
| Strategy call, `/book-call` | `api/book-call.js` | name, email, company, role, service, slot, brief | `classifyLead()` |
| Funnel teardown, `/blog/*` modal | `api/funnel-teardown.js` | email, website | `classifyTeardown()` |

Both write to the same `leads` collection and appear in the same `/admin` inbox,
tagged by a `source` field and separable with the source chips above the table.
Both share `lib/lead-intake.js` — one Gmail transport, one throttle, one IP trust
rule, one Turnstile check — so the numbers in the tables above are tuned **once**
and both doors move together. That sharing is the whole point of the module: the
door nobody remembers to re-tune is the one bots end up using.

What they do NOT share is notification policy: the booking form emails you, the
teardown does not. See *The teardown sends NO notification email* below.

### Why the teardown needs its own classifier

It has no name, no company and no message, and `isFiller('')` is true. Run a
teardown through `classifyLead()` and it trips *"placeholder name/company/message"*
— a hard reject, on **every single one**, answered with a cheerful 200. That is
written down as the first assertion in the `classifyTeardown` block of
`scripts/spam.test.js`, so anyone who tries to merge the two classifiers back
together meets it immediately.

With no prose to read, the signal comes almost entirely from transport: was the
form stamped by our script, how fast was it filled, and has this exact website been
submitted before. Two extra content rules cover the shapes that are unambiguous —
a messaging link (`t.me`, `wa.me`) or a bare IP submitted as "my website", and
`test@test.com` + `test.com`.

### Two deliberate differences from the booking form

**The fill-speed floor is 2s, not 3s.** `t0` is stamped when the modal *appears*,
not on page load, and there are only two boxes — a browser autofilling both at once
is a real person, and 3 seconds would flag them.

**The duplicate fingerprint keys on the website alone** (`TEARDOWN_HASH_FIELDS`).
With two fields and one of them trivially rotatable, the site *is* the payload;
including the email would let a bot defeat the check by changing an address it
never reads.

**And the repeat ladder is gentler**, because of exactly that. On the booking form a
repeat is a byte-identical *message*, which a human essentially never sends twice.
Here it is only "someone typed acme.com again" — which is what a second person at
the same company does, or the first one after a flaky connection. So:

| Repeats in 24h | Score | Verdict |
|---|---|---|
| 1 | 25 | allowed — below the line on its own, but colours the verdict |
| 2 | 55 | held — Spam tab in /admin |
| 3+ | reject | refused, kept 30 days in Blocked |

### The teardown sends NO notification email

`/book-call` emails every allowed lead to `LEAD_TO`. `/api/funnel-teardown`
**emails nobody at Davnoot** — allowed or held, it is captured and left in
`/admin` → Leads.

That is an explicit product decision (Prem, 2026-08-24), not an oversight. A
teardown is a low-friction blog ask, not a booking: at blog volume, one email per
submission turns the inbox that exists for real enquiries back into a feed — the
same failure this document was written to fix, just arriving through the front
door instead of from bots.

**Nothing is lost by it.** The lead is persisted before anything else can fail, it
carries a status, notes and the spam verdict, it counts toward the sidebar unread
badge, and it exports to CSV. The notification *channel* was dropped, not the lead.

A teardown is therefore stored with **`emailSent: null`** — "no attempt was made",
as distinct from `false`, which means "we tried and it failed". The admin renders
null as a muted **admin only** pill rather than a red failure. If you ever turn
notifications back on, do not backfill those nulls to `false`: historical rows
would start looking broken.

The **visitor's** confirmation is a separate question and stays enabled — they
asked for a teardown and should know it landed. It is gated on Turnstile (so the
form can never become a spam relay) and is never sent for a held submission.

`scripts/e2e.test.js` asserts the silence by capturing what reached the mail
transport, because every path here returns 200 and the response cannot tell you.

### A typo is not spam

`api/funnel-teardown.js` returns a real **400 with a field name** for a malformed
email or website, before the classifier is consulted. The silent-200 treatment is
for bots; a human who mistyped their address must not be shown a confirmation for
a teardown that can never arrive.

### Turnstile covers both doors at once

`script.js` has one `mountTurnstile()` helper and one `/api/form-config` fetch,
used by the booking form and the modal alike. Setting `TURNSTILE_SITE_KEY` /
`TURNSTILE_SECRET_KEY` protects both — which is also why the modal had to mount
the widget from day one. If it hadn't, switching Turnstile on later would have
silently 400'd every teardown submission while the booking form kept working.


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

**Which door a lead came through** — `/admin` → Leads shows a source pill on every
row, plus filter chips (All sources / Booking form / Blog teardown) once both have
traffic. The CSV export ignores those filters on purpose and always contains
everything, with `source`, `website` and `sourceUrl` columns.

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
