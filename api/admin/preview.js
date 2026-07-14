/* GET /api/admin/preview?id=:key — server-render a page's DRAFT for the editor iframe.
 *
 * Rewritten from /admin/preview/:id. Uses the SAME renderPage() the public route
 * uses, so preview can never drift from production. Always no-store + noindex.
 */
import { getSession } from '../../lib/auth.js';
import { pages } from '../../lib/db.js';
import { COMPILED_PAGES } from '../../lib/compiled-pages.gen.js';
import { renderPage } from '../../lib/page-render.js';

const ADMIN_ROLES = new Set(['admin', 'editor']);

export default async function handler(req, res) {
  // This is an HTML route, so a signed-out request gets a redirect (not a JSON 401)
  // — a raw 401 in an iframe is a confusing blank frame.
  const session = await getSession(req);
  if (!session || !ADMIN_ROLES.has(session.role)) {
    res.statusCode = 302;
    res.setHeader('Location', '/seoteam/login?next=' + encodeURIComponent(req.url || '/admin'));
    return res.end();
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const key = req.query?.id;
  const tpl = COMPILED_PAGES[key];
  const path = tpl ? tpl.path : '/' + String(key || '').replace(/^\/+/, '');

  let doc = null;
  try {
    doc = await (await pages()).findOne({ path });
  } catch (err) {
    console.error('[preview] mongo error:', err);
  }

  if (!tpl && !doc) return res.status(404).send('<h1>No such page</h1>');

  // Preview shows the DRAFT (doc.draft); the public route shows doc.live.
  const content = doc?.draft || null;
  return res.status(200).send(renderPage(tpl, content ? { content } : null, { preview: true }));
}
