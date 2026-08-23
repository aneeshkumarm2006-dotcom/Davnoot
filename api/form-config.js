/* GET /api/form-config — public, cacheable form configuration.
 *
 * Today this returns one thing: the Cloudflare Turnstile SITE key, if one is
 * configured. The site key is public by design (it ships in the widget markup on
 * every page that uses Turnstile); the SECRET key never leaves the server and is
 * read only by api/book-call.js.
 *
 * WHY AN ENDPOINT RATHER THAN THE KEY IN THE HTML
 * -----------------------------------------------
 * book-call.html is one of the CMS marketing pages, which means it exists in four
 * synchronised copies — site/book-call.html, pages/book-call.html, the frozen
 * fixture under scripts/fixtures/, and a French translation keyed on the exact
 * English source string. Adding a widget <div> to it is a four-file change plus a
 * re-freeze plus an fr.json entry, and getting any of that wrong either fails the
 * byte-exact golden test or silently de-indexes the French twin.
 *
 * Serving the key from here instead means Turnstile is switched on and off purely
 * by setting TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY in Vercel — no HTML edit,
 * no rebuild, no redeploy of the marketing pages. script.js reads this, and only
 * injects the widget when a key comes back.
 *
 * Fails open: no key configured returns an empty string, and the form keeps
 * working exactly as it does today.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Safe to cache at the edge — it is public config, identical for every visitor,
  // and changes only when an env var does (which redeploys and busts this anyway).
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return res.status(200).json({
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
  });
}
