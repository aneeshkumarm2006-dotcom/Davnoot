/* Vercel Edge Middleware — the gate in front of the writer dashboard.
 *
 * ===========================================================================
 * THIS IS NOT THE SECURITY BOUNDARY.
 * ===========================================================================
 * Middleware is a convenience layer: it bounces signed-out browsers to the login
 * page and short-circuits signed-out API calls with a 401. It is NOT sufficient
 * on its own, and you must not treat it as such. Every /api/seoteam/* handler
 * independently re-checks the session server-side via requireSession() in
 * lib/auth.js. If matcher config ever drifts, or a route is added under a path
 * the matcher doesn't cover, the handler still refuses. Defence in depth.
 *
 * EDGE RUNTIME: this file and everything it imports (lib/session.js,
 * lib/cookies.js) may use only Web APIs — no node:crypto, no mongodb driver.
 * See the header of lib/session.js.
 */
import { next } from '@vercel/edge';
import { verifySessionToken } from './lib/session.js';
import { readSessionCookie } from './lib/cookies.js';

export const config = {
  matcher: [
    '/seoteam',
    '/seoteam/:path*',
    '/api/seoteam/:path*',
    '/admin',
    '/admin/:path*',
    '/api/admin/:path*',
  ],
};

// Roles allowed into the website manager. A `writer` (the pre-existing shared
// SEOTEAM_PASSWORD, and any legacy cookie with no role claim) is confined to
// /seoteam. This Edge check is a CONVENIENCE — every /api/admin/* handler
// re-checks the role via requireRole() in lib/auth.js. Do not treat it as the boundary.
const ADMIN_ROLES = new Set(['admin', 'editor']);

/* The dashboard must never appear in a search index. This header goes on EVERY
 * response from these paths — including the login page and the API — because
 * X-Robots-Tag works on non-HTML responses too, where a <meta> tag cannot reach. */
const NOINDEX = 'noindex, nofollow, noarchive, nosnippet';

/* Whitelisted past the guard. Miss this and the login page redirects to itself,
 * forever, and nobody can ever sign in. */
const PUBLIC_PATHS = new Set([
  '/seoteam/login', // the login page itself
  '/api/seoteam/login', // POST credentials
  '/api/seoteam/logout', // must work even with a dead/expired session

  // The login page's OWN stylesheet. It lives under /seoteam/, so the matcher
  // catches it — and a signed-out visitor would be redirected to login for the
  // CSS as well as the page, leaving the login form completely unstyled. It is
  // just a stylesheet; there is nothing in it worth protecting.
  //
  // NOTE the asymmetry: /seoteam/app.js stays GATED. The bundle is the dashboard
  // itself, and the login page does not load it (its script is inlined precisely
  // so it has no gated dependencies).
  '/seoteam/app.css',
]);

export default async function middleware(request) {
  const url = new URL(request.url);

  // Normalize a trailing slash so /seoteam/login/ can't sneak past the whitelist
  // check and cause the redirect loop described above.
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

  if (PUBLIC_PATHS.has(path)) {
    return next({ headers: { 'X-Robots-Tag': NOINDEX } });
  }

  const session = await verifySessionToken(process.env.SESSION_SECRET, readSessionCookie(request));

  if (!session) {
    // API callers get a machine-readable 401. Redirecting an fetch() to an HTML
    // login page would hand the editor's autosave a 200 full of HTML, which it
    // would happily treat as success.
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not signed in.' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'X-Robots-Tag': NOINDEX,
          'Cache-Control': 'no-store',
        },
      });
    }

    // Browsers get bounced to login, remembering where they were headed.
    const login = new URL('/seoteam/login', url.origin);
    const target = url.pathname + url.search;
    if (target && target !== '/seoteam') login.searchParams.set('next', target);

    return Response.redirect(login.toString(), 302);
  }

  // Signed in — but is the ROLE allowed here? The token payload carries `role`
  // (undefined for legacy cookies -> treated as the lowest privilege). Only
  // admin/editor may reach /admin and /api/admin. Fail closed.
  if ((path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin')) &&
      !ADMIN_ROLES.has(session.role)) {
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'You do not have access to that.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': NOINDEX, 'Cache-Control': 'no-store' },
      });
    }
    // A signed-in writer who wandered to /admin goes back to the surface they can use.
    return Response.redirect(new URL('/seoteam', url.origin).toString(), 302);
  }

  return next({ headers: { 'X-Robots-Tag': NOINDEX } });
}
