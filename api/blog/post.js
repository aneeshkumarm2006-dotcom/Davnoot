/* GET /blog/<slug> — a single published post.
 *
 * Served via a rewrite in vercel.json (/blog/:slug -> /api/blog/post?slug=:slug).
 *
 * Renders through renderArticlePage() — the SAME function the author preview uses,
 * so preview and production cannot drift. See lib/blog-render.js.
 *
 * A draft or a not-yet-due scheduled post 404s here: findPublishedBySlug() applies
 * publishedFilter(), which requires publishedAt <= now.
 */
import { findPublishedBySlug, relatedTo } from '../../lib/blog-query.js';
import { renderArticlePage } from '../../lib/blog-render.js';
import { render404 } from '../../lib/blog-404.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  const slug = String(req.query?.slug || '').trim();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  try {
    const post = slug ? await findPublishedBySlug(slug) : null;

    if (!post) {
      // Not published, scheduled for later, or simply gone. All look the same to
      // the public — we must not reveal that a draft exists at this slug.
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      return res.status(404).send(render404());
    }

    const related = await relatedTo(post, 3);
    const html = renderArticlePage(post, { related });

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[blog/post] render failed:', slug, err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send(render404({ title: 'Something went wrong' }));
  }
}
