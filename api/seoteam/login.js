/* POST /api/seoteam/login — exchange the shared password for a session cookie.
 *
 * Whitelisted past the Edge guard in middleware.js (obviously — you can't require
 * a session to create a session).
 *
 * Rate limited: 5 failed attempts per IP per 15 minutes. Counters live in Mongo,
 * NOT in a module-level Map: every serverless instance has its own memory, so an
 * in-process counter is bypassed simply by the platform scaling out under the
 * attacker's own load. See ensureIndexes() for the TTL that expires the window.
 */
import { loginAttempts } from '../../lib/db.js';
import { passwordMatches, createSessionToken } from '../../lib/session.js';
import { sessionCookie, isSecureRequest } from '../../lib/cookies.js';
import { readJson, withErrors, methods, ApiError } from '../../lib/api.js';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

// Prefer the platform-set client IP. `x-forwarded-for` can be SPOOFED — a client
// prepends its own value and Vercel appends the real one, so the leftmost entry is
// attacker-controlled and keying a rate-limit on it lets an attacker rotate past
// the throttle. `x-vercel-forwarded-for` / `x-real-ip` are set by Vercel and reflect
// the actual connecting address. Fall back to the socket for local dev.
function clientIp(req) {
  const h = req.headers;
  const vercel = h['x-vercel-forwarded-for'] || h['x-real-ip'];
  if (typeof vercel === 'string' && vercel) return vercel.split(',')[0].trim();
  const fwd = h['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// The role is decided SERVER-SIDE from the credential presented — never read from
// the request body. All three comparisons run (constant-time each) so the response
// time doesn't reveal which password was tried. An unset env var can never match
// (passwordMatches returns false for an undefined expected secret), so a deployment
// that sets only SEOTEAM_PASSWORD simply never mints an admin/editor session.
async function resolveRole(password) {
  const [isAdmin, isEditor, isWriter] = await Promise.all([
    passwordMatches(password, process.env.ADMIN_PASSWORD),
    passwordMatches(password, process.env.EDITOR_PASSWORD),
    passwordMatches(password, process.env.SEOTEAM_PASSWORD),
  ]);
  if (isAdmin) return 'admin';
  if (isEditor) return 'editor';
  if (isWriter) return 'writer';
  return null;
}

async function login(req, res) {
  const ip = clientIp(req);
  const attempts = await loginAttempts();

  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await attempts.countDocuments({ ip, at: { $gte: since } });
  if (recent >= MAX_ATTEMPTS) {
    throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.');
  }

  const body = await readJson(req);
  const role = await resolveRole(body?.password);

  if (!role) {
    await attempts.insertOne({ ip, at: new Date() });
    // Deliberately vague: never reveal whether the password was wrong vs. the
    // server misconfigured (a password env var unset). Both are "no".
    throw new ApiError(401, 'Incorrect password.');
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error('[login] SESSION_SECRET is not set — cannot mint a session.');
    throw new ApiError(500, 'Something went wrong.');
  }

  // Successful login clears the throttle for this IP.
  await attempts.deleteMany({ ip });

  const token = await createSessionToken(secret, undefined, { role, v: 1 });
  res.setHeader('Set-Cookie', sessionCookie(token, { secure: isSecureRequest(req) }));
  return res.status(200).json({ ok: true, role });
}

export default withErrors(methods({ POST: login }));
