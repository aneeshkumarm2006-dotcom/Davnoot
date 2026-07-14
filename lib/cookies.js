/* Cookie parsing + serialization.
 *
 * Deliberately SEPARATE from lib/session.js: that file holds the signing
 * primitives and must stay Edge-safe and dependency-free. This file is pure
 * string manipulation and is imported by both the Edge middleware and the Node
 * API handlers, so it must stay runtime-agnostic too — no `document`, no
 * `node:http`, no framework cookie library.
 */
import { COOKIE_NAME, SESSION_TTL_MS } from './session.js';

/** Parse a raw `Cookie:` header into a plain object. */
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    const v = part.slice(eq + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v; // a malformed %-escape shouldn't nuke the whole header
    }
  }
  return out;
}

/**
 * Read the session token off a request.
 * Works with both a Web `Request` (Edge middleware) and a Node `req` (API routes).
 */
export function readSessionCookie(req) {
  const header =
    typeof req?.headers?.get === 'function'
      ? req.headers.get('cookie') // Web Request (Edge)
      : req?.headers?.cookie; // Node IncomingMessage
  return parseCookies(header)[COOKIE_NAME] || null;
}

/**
 * Build the Set-Cookie value for a fresh session.
 *
 * httpOnly  — JS can't read it, so an XSS on the dashboard can't exfiltrate it.
 * secure    — HTTPS only (skipped on localhost, or you can't log in during dev).
 * sameSite=lax — the dashboard is same-origin; lax blocks CSRF from other sites
 *                while still surviving a normal top-level navigation into /seoteam.
 */
export function sessionCookie(token, { secure = true } = {}) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/** Build the Set-Cookie value that clears the session (logout). */
export function clearSessionCookie({ secure = true } = {}) {
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/** Are we serving over HTTPS? Used to decide whether to set the Secure flag. */
export function isSecureRequest(req) {
  const proto =
    (typeof req?.headers?.get === 'function'
      ? req.headers.get('x-forwarded-proto')
      : req?.headers?.['x-forwarded-proto']) || '';
  if (proto) return proto.split(',')[0].trim() === 'https';
  return process.env.NODE_ENV === 'production';
}

export { COOKIE_NAME };
