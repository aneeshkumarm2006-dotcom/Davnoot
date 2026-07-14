/* The public marketing-page renderer.
 *
 *   /            -> /api/page?p=index.html
 *   /seo.html    -> /api/page?p=seo.html
 *   /:slug       -> /api/page?p=:slug        (composed pages; catch-all, LAST)
 *
 * Byte-identical to the frozen fixtures when no page document exists, because the
 * layout and every default live in lib/compiled-pages.gen.js (bundled in this
 * function). Mongo supplies only the diff — so a Mongo outage degrades a marketing
 * page to TODAY'S EXACT BYTES, never a 500. This is the whole resilience story.
 */
import { COMPILED_PAGES } from '../lib/compiled-pages.gen.js';
import { renderPage } from '../lib/page-render.js';
import { pages, redirects } from '../lib/db.js';
import { livePageFilter } from '../lib/page-model.js';

// Kick the Mongo connect at MODULE scope so it overlaps the (synchronous) template
// lookup instead of serializing after it. Warm invocations reuse the cached promise.
let warmed = false;
function kickConnect() {
  if (warmed) return;
  warmed = true;
  pages().catch(() => { warmed = false; }); // let a failed connect retry next request
}

const rejectAfter = (ms) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('mongo-timeout')), ms));

function toFile(p) {
  // The catch-all passes a slug; the explicit rewrites pass a filename. Normalize.
  if (!p) return 'index.html';
  return p;
}

export default async function handler(req, res) {
  const p = toFile(req.query?.p || req.query?.slug);
  const tpl = COMPILED_PAGES[p]; // overlay page (one of the 8) — or undefined

  kickConnect();

  // Resolve the URL path this request represents.
  const path = tpl ? tpl.path : '/' + String(p).replace(/^\/+/, '');

  // ---- Read the page document, bounded. The connect is INSIDE the race, so a
  // cold/broken Atlas can't block the driver's 30s serverSelectionTimeoutMS. ----
  let doc = null;
  let degraded = false;
  try {
    const read = (async () => (await pages()).findOne({ path, ...livePageFilter() }))();
    doc = await Promise.race([read, rejectAfter(2000)]);
    read.catch(() => {}); // swallow a late rejection after the race settled
  } catch (err) {
    degraded = true; // timeout OR mongo error — we do NOT know if a doc exists
    console.error('[page] mongo unavailable, serving base template:', err?.message || err);
  }

  // ---- Overlay page (one of the 8): render the compiled template. ----
  if (tpl) {
    const source = doc ? 'db' : degraded ? 'base-degraded' : 'base';
    res.setHeader('X-Cms-Source', source);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // A degraded render (Mongo down) must NEVER enter the CDN, or a routine cold
    // start pins launch-era copy at the edge for minutes. Only a real DB render caches.
    res.setHeader(
      'Cache-Control',
      source === 'db'
        ? 'public, s-maxage=60, stale-while-revalidate=86400'
        : source === 'base'
          ? 'public, s-maxage=30, stale-while-revalidate=300'
          : 'no-store',
    );
    // Render the LIVE content (doc.live). doc is null -> renderPage emits defaults.
    return res.status(200).send(renderPage(tpl, doc ? { content: doc.live } : null));
  }

  // ---- Composed page (created in /admin) or unknown slug. ----
  // A file-looking path (has an extension) that isn't one of the 8 is a 404 — do
  // not spend a Mongo round trip on /favicon.ico or bot probes.
  if (/\.[a-z0-9]+$/i.test(p)) return notFound(res);

  if (doc && doc.base === null) {
    // Composed pages are rendered by the section library (Phase 5). Until that
    // ships, a composed page returns a minimal valid shell rather than a 500.
    res.setHeader('X-Cms-Source', doc ? 'db' : 'base');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=86400');
    return res.status(200).send(renderComposedFallback(doc));
  }

  // No page — check for a redirect before 404ing.
  try {
    const rd = await (await redirects()).findOne({ source: path });
    if (rd) {
      res.setHeader('Cache-Control', 'public, s-maxage=300');
      res.statusCode = rd.status || 308;
      res.setHeader('Location', rd.destination);
      return res.end();
    }
  } catch { /* redirects unavailable — fall through to 404 */ }

  return notFound(res);
}

function notFound(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Not found</title><h1>404 — Not found</h1>');
}

// Minimal placeholder for a composed page until the Phase-5 section renderer lands.
function renderComposedFallback(doc) {
  const c = doc.live || {};
  const esc = (s) => String(s || '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
  return `<!doctype html><html lang="${esc(doc.locale || 'en')}"><head><meta charset="utf-8">` +
    `<title>${esc(c.title || doc.slug)}</title></head><body><h1>${esc(c.title || doc.slug)}</h1></body></html>`;
}
