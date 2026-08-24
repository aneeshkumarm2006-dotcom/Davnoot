/* Shared plumbing for every PUBLIC lead-intake endpoint.
 *
 * There are now two front doors into the `leads` collection:
 *
 *   api/book-call.js        the strategy-call form on /book-call
 *   api/funnel-teardown.js  the "free 15-min funnel teardown" modal on /blog/*
 *
 * Everything they have in common lives here: how the client IP is trusted, how a
 * Turnstile token is verified, how the Mongo-backed throttle is consulted, and
 * the one Gmail transport both of them send through.
 *
 * WHY EXTRACT IT RATHER THAN COPY IT
 * ----------------------------------
 * The anti-spam posture (see ANTISPAM.md) is a set of numbers that were tuned
 * against a real 2026-08 flood. Two copies of those numbers means the next tuning
 * pass fixes one door and leaves the other standing open — and the endpoint that
 * gets forgotten is always the newer, less-watched one. One module, one set of
 * knobs, both doors move together.
 *
 * NOTHING HERE DECIDES A VERDICT. Classification lives in lib/spam.js; this file
 * only measures. Keeping the two apart is what lets the classifier stay unit-
 * testable without a database.
 */
import nodemailer from 'nodemailer';
import { formAttempts } from './db.js';

/* ── Rate-limit knobs ──────────────────────────────────────────────────────
 * Generous enough that a whole office submitting once each is fine, tight enough
 * that a flooding bot is capped. Keyed on IP AND email. */
export const RL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const RL_MAX_PER_IP = 5;
export const RL_MAX_PER_EMAIL = 3;

/* The neighbourhood limit, over a longer window. The 2026-08 flood put 33
 * submissions through by rotating addresses inside a handful of rented /24s, each
 * address politely staying under RL_MAX_PER_IP. Capping the subnet is what makes
 * that rotation cost the operator something. */
export const RL_SUBNET_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const RL_MAX_PER_SUBNET = 8;

/* How far back the duplicate-payload check looks. Bounded by the form_attempts
 * TTL (24h) — asking for more than that silently gets less. */
export const DUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/* A form stamp older than this is a stale tab, not a session — treat it as absent
 * rather than as a suspiciously long dwell. */
export const MAX_DWELL_MS = 12 * 60 * 60 * 1000;

/* Cloudflare Turnstile (invisible CAPTCHA). Enforced ONLY when the secret is set,
 * so both forms keep working until the keys are added — then bots are blocked.
 * The site key is served publicly by api/form-config.js; this one never leaves
 * the server. */
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || '';
export const turnstileEnabled = () => Boolean(TURNSTILE_SECRET);

/* Trust only the platform-set client IP. x-forwarded-for's leftmost entry is
 * attacker-controlled (a client prepends its own), so keying a throttle on it lets
 * a bot rotate past the limit. Mirrors api/seoteam/login.js. */
export function clientIp(req) {
  const h = req.headers || {};
  const vercel = h['x-vercel-forwarded-for'] || h['x-real-ip'];
  if (typeof vercel === 'string' && vercel) return vercel.split(',')[0].trim();
  const fwd = h['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/* Verify a Turnstile token with Cloudflare. Returns true only on a confirmed
 * human. Any error/timeout returns false so a broken verifier fails CLOSED. */
export async function verifyTurnstile(token, ip) {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json();
    return data?.success === true;
  } catch (err) {
    console.error('Turnstile verify error (failing closed):', String(err?.message || err));
    return false;
  }
}

/* ── Mail ──────────────────────────────────────────────────────────────────
 * Gmail requires the From address to be the authenticated account (or one of its
 * verified aliases), so FROM is always built from GMAIL_USER — an arbitrary
 * sender cannot be spoofed here.
 *
 * Read through getters rather than captured at import so that a test (or a local
 * script) which sets the env AFTER importing this module still gets the value it
 * set. The old module-scope constants silently baked in the empty string. */
const gmailUser = () => process.env.GMAIL_USER || '';
// App passwords are shown grouped as "abcd efgh ijkl mnop"; Google accepts them
// with or without the spaces, so strip them to be forgiving of a copy-paste.
const gmailPass = () => (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

export const mailFrom = () => `Davnoot Digital <${gmailUser()}>`;
export const mailTo = () =>
  (process.env.LEAD_TO || gmailUser() || 'info@davnoot.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** False when the Gmail credentials are missing — the caller captures the lead anyway. */
export const mailConfigured = () => Boolean(gmailUser() && gmailPass());

// One transport per warm lambda. Created lazily so a cold start with missing
// credentials fails in the handler (with a captured lead) rather than at import.
let _transport;
export function mailer() {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // implicit TLS
      auth: { user: gmailUser(), pass: gmailPass() },
    });
  }
  return _transport;
}

/** HTML-escape for the notification templates. */
export const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* A hostname with a real TLD. Deliberately permissive about the label characters
 * (IDN punycode, digits, hyphens) and strict about the shape: at least one dot,
 * and a final label of two or more letters. */
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Normalise the website a visitor typed into the teardown modal.
 *
 * People type "acme.com", "www.acme.com", "https://acme.com/pricing?utm=x" and
 * "ACME.COM " interchangeably. All four are the same business, and the duplicate
 * check is only worth anything if they hash to the same thing — so the HOST is
 * canonicalised (lowercased, www stripped) and is what gets fingerprinted, while
 * the full URL is kept for the inbox because /pricing is genuinely useful context
 * for whoever runs the teardown.
 *
 * @returns {{url:string, host:string}|null}  null when it isn't a hostname at all.
 */
export function normalizeWebsite(raw) {
  const input = String(raw == null ? '' : raw).trim().slice(0, 300);
  if (!input || /\s/.test(input)) return null;

  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  // A visitor pasting "mailto:…" or "javascript:…" is not giving us a website.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  /* And neither is a URL carrying userinfo. This is not a hypothetical tidy-up:
   * "mailto:me@acme.com" has no "//", so the https:// prefix above turns it into
   * "https://mailto:me@acme.com" — which parses perfectly, with host "acme.com".
   * Someone who pasted their email address would have had it silently recorded as
   * their website. Credentials in a URL are equally never a real answer here. */
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!HOSTNAME_RE.test(host) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;

  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  return { url: `https://${host}${path}${parsed.search}`.slice(0, 300), host };
}

/**
 * How long the form was open before it was submitted.
 *
 * script.js stamps `t0` with Date.now() when it wires a form up, so a POST made
 * straight at the endpoint — no browser, no our-JS — carries no stamp at all.
 * That absence is a signal in its own right, SCORED (not enforced) by the
 * classifier, so that a browser holding a stale cached script.js right after a
 * deploy still gets through rather than having every real lead bounced.
 */
export function dwellFrom(t0) {
  const n = Number(t0);
  const dwellMs = Number.isFinite(n) && n > 0 ? Date.now() - n : null;
  return { dwellMs, hasJsStamp: dwellMs !== null && dwellMs >= 0 && dwellMs < MAX_DWELL_MS };
}

/**
 * Consult (and extend) the Mongo-backed submission throttle.
 *
 * BEST-EFFORT BY DESIGN: if the store is unreachable we ALLOW the submission. A
 * lead form that fails closed on a DB blip drops real prospects, which is a worse
 * outcome than letting a burst of spam through.
 *
 * @returns {{limited:boolean, duplicateCount:number}}
 *   `limited` means "send 429". `duplicateCount` is how many byte-identical
 *   payloads arrived in the last 24h — not a limit, an input to the verdict. One
 *   payload replayed from many addresses is the flood signature, and it survives
 *   every per-address cap.
 */
export async function throttle({ ip, prefix, email, hash }) {
  try {
    const col = await formAttempts();
    const now = Date.now();
    const since = new Date(now - RL_WINDOW_MS);
    const [byIp, byEmail, bySubnet, byHash] = await Promise.all([
      col.countDocuments({ ip, at: { $gte: since } }),
      email ? col.countDocuments({ email, at: { $gte: since } }) : Promise.resolve(0),
      col.countDocuments({ prefix, at: { $gte: new Date(now - RL_SUBNET_WINDOW_MS) } }),
      col.countDocuments({ hash, at: { $gte: new Date(now - DUPE_WINDOW_MS) } }),
    ]);

    if (byIp >= RL_MAX_PER_IP || byEmail >= RL_MAX_PER_EMAIL || (prefix !== 'unknown' && bySubnet >= RL_MAX_PER_SUBNET)) {
      return { limited: true, duplicateCount: byHash };
    }

    await col.insertOne({ ip, prefix, email, hash, at: new Date() });
    return { limited: false, duplicateCount: byHash };
  } catch (err) {
    console.error('Form rate-limit check failed (allowing submission):', String(err?.message || err));
    return { limited: false, duplicateCount: 0 };
  }
}
