/* GET /seoteam/preview/<id> — the author's "Open full preview".
 *
 * Renders through renderArticlePage(), the EXACT function that serves the public
 * page. That is the whole point of this route: preview and production cannot
 * drift, because there is only one renderer. If you are tempted to build a
 * lighter "preview-only" template here, don't — the drift it introduces is
 * precisely the bug this design eliminates.
 *
 * Differences from the public page, all of them deliberate:
 *   - shows DRAFTS and not-yet-due SCHEDULED posts (that's what a preview is for)
 *   - always noindex, whatever the post's own robots settings say
 *   - no view beacon (previewing your own post must not inflate its view count)
 *   - never cached
 *
 * Session-gated by the Edge middleware AND re-checked here.
 */
import { ObjectId } from 'mongodb';
import { posts } from '../../lib/db.js';
import { getSession } from '../../lib/auth.js';
import { renderArticlePage } from '../../lib/blog-render.js';
import { relatedTo } from '../../lib/blog-query.js';
import { render404 } from '../../lib/blog-404.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  // Re-check server-side. Middleware is not the security boundary.
  if (!(await getSession(req))) {
    res.writeHead(302, { Location: '/seoteam/login' });
    return res.end();
  }

  const id = String(req.query?.id || '');
  if (!ObjectId.isValid(id)) return res.status(404).send(render404());

  try {
    const col = await posts();
    const post = await col.findOne({ _id: new ObjectId(id) });
    if (!post) return res.status(404).send(render404());

    const related = await relatedTo(post, 3);
    return res.status(200).send(renderArticlePage(post, { preview: true, related }));
  } catch (err) {
    console.error('[preview] failed:', err);
    return res.status(500).send(render404({ title: 'Preview failed' }));
  }
}
