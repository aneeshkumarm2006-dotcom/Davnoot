/* POST /api/seoteam/logout — clear the session cookie.
 *
 * Whitelisted past the Edge guard: logout must work even when the session is
 * already expired or corrupt, otherwise a user with a bad cookie gets bounced to
 * login, tries to log out to fix it, and is bounced again.
 */
import { clearSessionCookie, isSecureRequest } from '../../lib/cookies.js';
import { withErrors, methods } from '../../lib/api.js';

async function logout(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: isSecureRequest(req) }));
  return res.status(200).json({ ok: true });
}

export default withErrors(methods({ POST: logout }));
