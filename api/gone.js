/* 410 Gone — the retired URL namespaces of the pre-2026 site.
 *
 * /project/*, /legal/* and a handful of deleted blog posts were real pages on the
 * old site. Google still has them, still crawls them, and still reports them under
 * "Not found (404)" in Search Console. A 404 says "maybe this comes back, I'll
 * check again"; a 410 says "this is gone", which Google de-indexes roughly twice as
 * fast and stops re-crawling. Neither has a modern equivalent to 301 to — a
 * redirect to a generic hub would just be read as a soft 404.
 *
 * These reach here through a REWRITE (see vercel.json), not a redirect: a redirect
 * cannot carry a status other than 30x, and the whole point is the 410.
 *
 * Shares renderNotFound() with api/page.js and the static 404.html, so all three
 * "this page isn't here" surfaces look identical and can never drift apart.
 */
import { renderNotFound } from '../lib/not-found.js';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cached briefly so bot retries hit the CDN rather than a lambda.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(410).send(renderNotFound({ status: 410 }));
}
