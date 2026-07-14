/* Server-side session re-check for the Node API handlers.
 *
 * The Edge middleware already bounced signed-out traffic — but middleware is a
 * convenience, not the boundary (see the header of middleware.js). Every mutating
 * handler calls requireSession() itself, so that a route added outside the
 * matcher, or a matcher typo, fails CLOSED instead of silently exposing CRUD.
 */
import { verifySessionToken } from './session.js';
import { readSessionCookie } from './cookies.js';

export async function getSession(req) {
  return verifySessionToken(process.env.SESSION_SECRET, readSessionCookie(req));
}

/**
 * Guard a handler. Returns the session, or sends a 401 and returns null —
 * in which case the caller must `return` immediately.
 *
 *   const session = await requireSession(req, res);
 *   if (!session) return;
 */
export async function requireSession(req, res) {
  const session = await getSession(req);
  if (!session) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: 'Not signed in.' });
    return null;
  }
  return session;
}

/**
 * Guard a handler by ROLE. Returns the session (with a normalized `role`), or
 * sends the right status and returns null — in which case the caller must return.
 *
 *   const session = await requireRole(req, res, 'admin');
 *   if (!session) return;
 *
 * FAIL CLOSED. A legacy cookie minted before roles existed has no `role` claim;
 * it is treated as the LOWEST privilege ('writer'), never promoted to admin. A
 * writer hitting an admin route gets a clean 403, not silent access.
 *
 * Every /api/admin/* handler calls this itself. The Edge middleware role check is
 * a convenience; per middleware.js's own header, it is NOT the security boundary.
 */
export async function requireRole(req, res, ...roles) {
  const session = await requireSession(req, res); // sends its own 401 when signed out
  if (!session) return null;
  const role = session.role || 'writer';
  if (!roles.includes(role)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({ error: 'You do not have access to that.' });
    return null;
  }
  return { ...session, role };
}
