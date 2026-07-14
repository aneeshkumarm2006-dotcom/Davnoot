/* GET /sitemap.xml — the 8 static pages + every PUBLISHED blog post.
 *
 * Served via a rewrite in vercel.json. There is deliberately no sitemap.xml on
 * disk: a static file would shadow the rewrite and the blog posts would never be
 * submitted to Google. build.js writes lib/sitemap-static.json instead.
 *
 * Scheduled posts are excluded automatically — publishedFilter() requires
 * publishedAt <= now, so a post scheduled for next Tuesday is not advertised to
 * Google until next Tuesday. Submitting it early would earn a soft-404 on crawl.
 *
 * If Mongo is unreachable we still serve the 8 static pages rather than a 500.
 * A sitemap that is briefly missing the blog is a minor problem; a sitemap that
 * 500s is one Google will stop fetching.
 */
import { posts } from '../lib/db.js';
import { publishedFilter } from '../lib/blog-query.js';
import { SITE_URL } from '../lib/templates.js';
import { STATIC_URLS } from '../lib/sitemap-static.js';

const BLOG_INDEX = SITE_URL + '/blog';
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : undefined);

const escXml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return `  <url>
    <loc>${escXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}${
      changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : ''
    }${priority ? `\n    <priority>${priority}</priority>` : ''}
  </url>`;
}

export default async function handler(req, res) {
  const entries = [...STATIC_URLS];

  let blogCount = 0;
  try {
    const col = await posts();
    const docs = await col
      .find(publishedFilter(), { projection: { slug: 1, publishedAt: 1, updatedAt: 1 } })
      .sort({ publishedAt: -1 })
      .limit(5000)
      .toArray();

    if (docs.length) {
      entries.push({
        loc: BLOG_INDEX,
        lastmod: day(docs[0].publishedAt),
        changefreq: 'weekly',
        priority: '0.9',
      });

      for (const doc of docs) {
        entries.push({
          loc: `${BLOG_INDEX}/${doc.slug}`,
          lastmod: day(doc.updatedAt) || day(doc.publishedAt),
          changefreq: 'monthly',
          priority: '0.7',
        });
      }
      blogCount = docs.length;
    }
  } catch (err) {
    // Degrade gracefully — serve the static half rather than failing the sitemap.
    console.error('[sitemap] could not read posts, serving static pages only:', err);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Static pages from lib/sitemap-static.json (via build.js) + ${blogCount} published post(s) from MongoDB. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(urlEntry).join('\n')}
</urlset>
`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  return res.status(200).send(xml);
}
