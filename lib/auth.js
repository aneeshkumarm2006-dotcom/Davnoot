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
