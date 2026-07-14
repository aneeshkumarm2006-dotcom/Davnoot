/* GET /api/admin/preview?id=:key — server-render a page's DRAFT for the editor iframe.
 *
 * Rewritten from /admin/preview/:id. Uses the SAME renderPage() the public route
 * uses, so preview can never drift from production. Always no-store + noindex.
 */
import { getSession } from '../../lib/auth.js';
import { pages, settings as siteSettings } from '../../lib/db.js';
import { COMPILED_PAGES } from '../../lib/compiled-pages.gen.js';
import { renderPage } from '../../lib/page-render.js';
import { renderComposedPage } from '../../lib/composed-render.js';
import { mergeSettings } from '../../lib/site-defaults.js';

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

  // A composed page (base:null) is assembled from the section library, exactly as the
  // public route does — so preview can't drift from production here either.
  if (!tpl && doc && doc.base === null) {
    let merged = mergeSettings({});
    try {
      const stored = await (await siteSettings()).findOne({ _id: 'site' });
      const { _id, ...diff } = stored || {};
      merged = mergeSettings(diff);
    } catch { /* settings unavailable — defaults */ }
    return res.status(200).send(
      renderComposedPage({ content, path: doc.path, slug: doc.slug, locale: doc.locale }, { preview: true, settings: merged }),
    );
  }

  return res.status(200).send(renderPage(tpl, content ? { content } : null, { preview: true }));
}
