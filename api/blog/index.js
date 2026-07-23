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
import { listAllCategories, findCategoryBySlug } from '../../lib/category-query.js';
import { renderIndexPage } from '../../lib/blog-render.js';
import { render404 } from '../../lib/blog-404.js';

const PER_PAGE = 12;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  // Set on /blog/category/:slug by the vercel.json rewrite. Empty on the plain /blog.
  const categorySlug = String(req.query?.category || '').trim();

  try {
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);

    // The full list drives the filter pills on every variant of the page; the active
    // category (if any) both scopes the query and titles/canonicalises the archive.
    const [categories, activeCategory] = await Promise.all([
      listAllCategories(),
      categorySlug ? findCategoryBySlug(categorySlug) : Promise.resolve(null),
    ]);

    // A category URL that doesn't resolve is a real 404 — never a thin, indexable
    // "0 results" archive that Google would treat as a soft 404.
    if (categorySlug && !activeCategory) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      return res.status(404).send(render404({ title: 'No such category' }));
    }

    const { posts, totalPages } = await listPublished({
      page,
      perPage: PER_PAGE,
      category: activeCategory?.slug,
    });

    const html = renderIndexPage({ posts, page, totalPages, categories, activeCategory });

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
