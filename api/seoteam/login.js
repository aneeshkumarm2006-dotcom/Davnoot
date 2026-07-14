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

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
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

  // passwordMatches() hashes BOTH sides to a fixed 32 bytes before a constant-time
  // compare — so it can't throw on a length mismatch, can't leak the secret's
  // length through timing, and takes the same time even when SEOTEAM_PASSWORD is
  // unset. See lib/session.js.
  const ok = await passwordMatches(body?.password, process.env.SEOTEAM_PASSWORD);

  if (!ok) {
    await attempts.insertOne({ ip, at: new Date() });
    // Deliberately vague: never reveal whether the password was wrong vs. the
    // server misconfigured (SEOTEAM_PASSWORD unset). Both are "no".
    throw new ApiError(401, 'Incorrect password.');
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error('[login] SESSION_SECRET is not set — cannot mint a session.');
    throw new ApiError(500, 'Something went wrong.');
  }

  // Successful login clears the throttle for this IP.
  await attempts.deleteMany({ ip });

  const token = await createSessionToken(secret);
  res.setHeader('Set-Cookie', sessionCookie(token, { secure: isSecureRequest(req) }));
  return res.status(200).json({ ok: true });
}

export default withErrors(methods({ POST: login }));
