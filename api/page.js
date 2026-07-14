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
import { renderComposedPage } from '../lib/composed-render.js';
import { pages, redirects, settings as siteSettings } from '../lib/db.js';
import { isPageLive } from '../lib/page-model.js';
import { mergeSettings } from '../lib/site-defaults.js';

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
  // We fetch by path WITHOUT the live filter so we can tell 'archived' (→ 410) apart
  // from 'draft'/'scheduled' (→ base template). A filter that hid both would make
  // an intentionally-retired URL indistinguishable from an as-yet-unpublished one.
  let doc = null;
  let degraded = false;
  try {
    const read = (async () => (await pages()).findOne({ path }))();
    doc = await Promise.race([read, rejectAfter(2000)]);
    read.catch(() => {}); // swallow a late rejection after the race settled
  } catch (err) {
    degraded = true; // timeout OR mongo error — we do NOT know if a doc exists
    console.error('[page] mongo unavailable, serving base template:', err?.message || err);
  }

  // ---- A retired page returns 410 Gone (de-indexes ~2× faster than 404, stops
  // crawl retries) — but only if a replacement redirect isn't configured. This
  // applies to overlay AND composed pages. ----
  if (doc?.status === 'archived') {
    try {
      const rd = await (await redirects()).findOne({ source: path });
      if (rd) return sendRedirect(res, rd);
    } catch { /* redirects unavailable — fall through to 410 */ }
    return gone(res);
  }

  const live = isPageLive(doc) ? doc : null; // draft/scheduled overlay ⇒ base template

  // ---- Overlay page (one of the 8): render the compiled template. ----
  if (tpl) {
    const source = live ? 'db' : degraded ? 'base-degraded' : 'base';
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
    // Render the LIVE content (doc.live). A non-live doc -> renderPage emits defaults.
    return res.status(200).send(renderPage(tpl, live ? { content: live.live } : null));
  }

  // ---- Composed page (created in /admin) or unknown slug. ----
  // A file-looking path (has an extension) that isn't one of the 8 is a 404 — do
  // not spend a Mongo round trip on /favicon.ico or bot probes.
  if (/\.[a-z0-9]+$/i.test(p)) return notFound(res);

  if (live && live.base === null) {
    // Composed pages are assembled from the section library into a full marketing
    // shell (Phase 5). Settings drive the chrome; a Mongo hiccup on the settings read
    // just falls back to defaults (the sections still render), never a 500.
    let merged;
    try {
      const read = (async () => (await siteSettings()).findOne({ _id: 'site' }))();
      const stored = await Promise.race([read, rejectAfter(1500)]);
      read.catch(() => {});
      const { _id, ...diff } = stored || {};
      merged = mergeSettings(diff);
    } catch { merged = mergeSettings({}); }
    res.setHeader('X-Cms-Source', 'db');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=86400');
    return res.status(200).send(
      renderComposedPage({ content: live.live, path: live.path, slug: live.slug, locale: live.locale }, { settings: merged }),
    );
  }

  // No live page — check for a redirect before 404ing.
  try {
    const rd = await (await redirects()).findOne({ source: path });
    if (rd) return sendRedirect(res, rd);
  } catch { /* redirects unavailable — fall through to 404 */ }

  return notFound(res);
}

function sendRedirect(res, rd) {
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  res.statusCode = rd.status || 308;
  res.setHeader('Location', rd.destination);
  return res.end();
}

function notFound(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Not found</title><h1>404 — Not found</h1>');
}

/* 410 Gone — an intentionally retired URL. Google de-indexes a 410 roughly twice as
 * fast as a 404 and stops re-crawling it, which is the point of "archive" vs a page
 * that merely 404s by accident. noindex belt-and-braces; cached briefly so bot
 * retries hit the CDN, not a lambda. */
function gone(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(410).send('<!doctype html><meta charset="utf-8"><title>Gone</title><h1>410 — This page has been retired</h1>');
}

// The composed-page renderer now lives in lib/composed-render.js (renderComposedPage),
// which assembles the full marketing shell from the section library.
