/* GET /blog — the paginated card grid.
 *
 * Served via a rewrite in vercel.json (/blog -> /api/blog/index).
 *
 * CACHING — this is the "ISR" of a non-Next project.
 * Vercel has no revalidatePath() outside Next.js, so there is no on-demand purge
 * to call when a post is published. Instead we let the CDN hold the page for 60s
 * and serve stale-while-revalidate after that:
 *
 *   - Googlebot and real users are served from the EDGE cache, so Core Web Vitals
 *     are effectively those of a static file.
 *   - A publish goes live within ~60 seconds, with no build and no deploy.
 *   - A scheduled post appears on its own when its date passes (see publishedFilter).
 *
 * If you ever need TRULY instant publishing, this header is the single knob —
 * drop s-maxage to 0 and accept ~150-250ms TTFB. Do not instead add a "revalidate"
 * fetch somewhere; it would be a no-op on this platform.
 */
import { listPublished } from '../../lib/blog-query.js';
import { renderIndexPage } from '../../lib/blog-render.js';

const PER_PAGE = 12;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  try {
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const { posts, totalPages } = await listPublished({ page, perPage: PER_PAGE });

    const html = renderIndexPage({ posts, page, totalPages });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[blog/index] render failed:', err);
    // Never leak the error. A blank 500 on /blog is bad; a stack trace is worse.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send(renderIndexPage({ posts: [], page: 1, totalPages: 1 }));
  }
}
