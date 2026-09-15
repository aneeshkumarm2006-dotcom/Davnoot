/* The PUBLIC URL of a page, from the key /admin identifies it by.
 *
 * The admin key is not the URL and neither is the DB path — there are three
 * spellings of the same page and they diverge on purpose:
 *
 *   admin key   'seo.html'      'fr/seo.html'       'pricing'   (composed)
 *   DB path     '/seo.html'     '/fr/seo.html'      '/pricing'
 *   PUBLIC URL  '/services/seo' '/fr/services/seo'  '/pricing'
 *
 * cleanPath() in lib/templates.js owns that last column (the /services/*, /ads/*,
 * /free-training/* and /tools/* namespaces, and the /fr prefix). Anything that
 * needs to tell an outside system where a page lives — IndexNow, today — must go
 * through here, or it will advertise the internal join key as a URL and submit a
 * path that 301s at best and 404s at worst.
 */
import { COMPILED_PAGES } from './compiled-pages.gen.js';
import { SITE_URL, canonicalFor } from './templates.js';

/**
 * @param key  an /admin page key: a COMPILED_PAGES key for one of the overlay
 *             marketing pages, or the slug of a composed page.
 * @returns the absolute, canonical public URL.
 */
export function publicUrlFor(key) {
  // tpl.locale is what keeps the French twin at /fr/services/seo. Dropping it
  // would hand back the English URL for a French page — the same bug api/sitemap.js
  // guards against when it advertises canonicalFor(tpl.file, tpl.locale).
  const tpl = COMPILED_PAGES[key];
  if (tpl) return canonicalFor(tpl.file, tpl.locale);

  const raw = String(key).replace(/^\/+/, '');

  /* A key naming an .html FILE is a page file, not a composed slug — even when it
   * has no COMPILED_PAGES entry, which is precisely the case for the root-only
   * static pages (reddit-ads.html, ai-seo-agency.html, the city pages…).
   *
   * Without this branch the slug fallback below would hand back
   * '/reddit-ads.html', a URL that 301s to /ads/reddit-ads — so every consumer
   * would submit the redirect instead of the destination. canonicalFor is the one
   * thing that knows about the /services, /ads, /free-training and /tools
   * namespaces, so a file key always goes through it. */
  if (raw.endsWith('.html')) {
    const m = raw.match(/^(?:(fr)\/)?(.+)$/);
    return canonicalFor(m[2], m[1] || 'en');
  }

  // Composed pages (base:null) are served at /<slug> by the catch-all rewrite.
  return SITE_URL + '/' + raw;
}
