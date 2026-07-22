/* Davnoot — shared site chrome & SEO templates.
 *
 * SINGLE SOURCE OF TRUTH for nav, footer, and the SEO <head>.
 *
 * Two consumers:
 *   1. build.js          — bakes these into the static .html marketing pages.
 *   2. api/blog/*.js     — server-renders them into the blog pages.
 *
 * Because both import from here, the blog can never drift from the marketing
 * site. Change the nav in one place and `node build.js` + the next blog render
 * both pick it up.
 *
 * ---------------------------------------------------------------------------
 * Asset URLs are ROOT-ABSOLUTE
 * ---------------------------------------------------------------------------
 * Inter-page LINKS are absolute and extensionless (/seo, / for home). ASSET srcs
 * (the logo image, favicon) are now root-absolute too — "/images/davnoot-logo.png",
 * not "images/…" — because marketing pages are served one level deep under
 * /services/*, where a relative "images/…" resolves to "/services/images/…" and
 * 404s. Absolute paths are depth-independent and work at /, /services/*, and /blog/*.
 *
 * The `base` parameter is therefore VESTIGIAL for output, but retained in the
 * navHtml/footerHtml signatures because callers pass settings positionally after it
 * (e.g. composed-render's `navHtml('composed', '/', settings)`).
 */

// The site-wide JSON-LD builder. This creates a templates.js <-> structured-data.js
// import cycle; it is SAFE because neither module uses the other's exports at module
// EVALUATION time — only inside functions that run later (see structured-data.js's
// header). Do not add a top-level call to buildGraph() (or a top-level use of a
// structured-data export) here, or the cycle becomes a temporal-dead-zone crash.
import { buildGraph } from './structured-data.js';
// Today's chrome constants, as a committed default. The settings screen edits a diff
// over these; mergeSettings(diff) yields the effective values. No diff -> these exact
// values -> byte-identical output. site-defaults.js imports nothing, so no cycle.
import { SITE_DEFAULTS } from './site-defaults.js';

// ---- Site config -----------------------------------------------------------
export const SITE_URL = 'https://www.davnoot.com'; // canonical host (www; matches GSC + Vercel apex→www 308)
export const LOGO = 'images/davnoot-logo.png';
export const OG_IMAGE = SITE_URL + '/' + LOGO;
export const ORG_DESC =
  'Davnoot is an independent growth agency. Six disciplines: SEO, paid social, email, AI search, ChatGPT ads, and custom software. Engineered into one revenue engine.';

export const SERVICE_PAGES = ['seo.html', 'meta-ads.html', 'email.html', 'ai-seo.html', 'chatgpt-ads.html', 'software.html', 'shopify.html'];
// The /ads/* namespace: per-platform paid-advertising hub pages. Same shape as
// SERVICE_PAGES (root-only static files served at a namespaced clean URL) but under
// /ads/<name> instead of /services/<name>. The /ads overview (ads.html) is NOT a
// member — it's a flat page served at /ads, like services.html at /services.
export const ADS_PAGES = ['reddit-ads.html', 'pinterest-ads.html', 'amazon-ads.html', 'spotify-ads.html'];
export const SERVICE_TYPE = {
  'seo.html': 'Search Engine Optimization',
  'meta-ads.html': 'Paid Advertising (Google & Meta)',
  'email.html': 'Email Marketing',
  'ai-seo.html': 'AI Search Optimization',
  'chatgpt-ads.html': 'AI Search Advertising',
  'software.html': 'Custom Software Development',
  'shopify.html': 'Shopify Development',
  'reddit-ads.html': 'Reddit Ads Management',
  'pinterest-ads.html': 'Pinterest Ads Management',
  'amazon-ads.html': 'Amazon Ads Management',
  'spotify-ads.html': 'Spotify Ads Management',
};

// Per-page meta keywords. Modern search engines largely ignore this tag for
// ranking, but it's still a low-cost, self-documenting signal (and some AI
// crawlers / internal search read it). Keep each list tight and page-specific —
// 6–10 terms that mirror the title, H1, and body. Pages with no entry get none.
export const KEYWORDS = {
  'index.html': [
    'growth marketing agency', 'digital marketing agency Montreal', 'SEO agency',
    'paid social advertising', 'email marketing', 'AI search optimization',
    'ChatGPT ads', 'custom software development', 'revenue marketing',
  ],
  'seo.html': [
    'SEO agency Montreal', 'technical SEO services', 'SEO audit',
    'keyword strategy', 'on-page optimization', 'link building',
    'organic search growth', 'search engine optimization',
  ],
  'meta-ads.html': [
    'Google Ads management', 'Meta Ads management', 'paid search',
    'paid social advertising', 'PPC agency', 'Facebook ads',
    'Instagram ads', 'performance marketing',
  ],
  'email.html': [
    'email marketing agency', 'email marketing automation', 'lifecycle marketing',
    'email flows', 'list segmentation', 'lead nurturing',
    'retention marketing', 'Klaviyo agency',
  ],
  'ai-seo.html': [
    'AI SEO services', 'generative engine optimization', 'GEO agency',
    'ChatGPT SEO', 'Perplexity optimization', 'Google AI Overviews',
    'AI search visibility', 'answer engine optimization',
  ],
  'ai-seo-agency.html': [
    'AI SEO agency', 'AI SEO company', 'generative engine optimization agency',
    'AI search agency', 'ChatGPT optimization agency', 'LLM SEO agency',
    'answer engine optimization agency', 'hire AI SEO agency',
  ],
  'ai-seo-montreal.html': [
    'AI SEO Montreal', 'AI SEO agency Montreal', 'generative engine optimization Montreal',
    'GEO agency Montreal', 'ChatGPT SEO Montreal', 'AI search optimization Montreal',
    'Montreal SEO agency', 'bilingual AI SEO', 'Google AI Overviews Montreal',
  ],
  'etf-marketing.html': [
    'ETF marketing agency', 'ETF marketing services', 'asset manager marketing',
    'ETF distribution', 'ETF launch marketing', 'financial advisor targeting',
    'fund marketing', 'AUM growth',
  ],
  'chatgpt-ads.html': [
    'ChatGPT ads', 'ChatGPT ads manager', 'AI platform advertising',
    'AI search advertising', 'generative AI ads', 'OpenAI advertising',
  ],
  'software.html': [
    'custom software development', 'CRM development services', 'custom CRM',
    'business dashboards', 'software integration', 'marketing automation software',
    'internal tools development',
  ],
  'shopify.html': [
    'Shopify development agency', 'Shopify store design', 'Shopify Plus development',
    'Shopify theme development', 'headless Shopify', 'Shopify migration',
    'ecommerce conversion optimization', 'Shopify SEO',
  ],
  'ads.html': [
    'paid advertising agency', 'ad management agency', 'Reddit ads agency',
    'Pinterest ads agency', 'Amazon ads agency', 'Spotify ads agency',
    'paid media agency Montreal', 'performance advertising',
  ],
  'reddit-ads.html': [
    'Reddit ads agency', 'Reddit ads management', 'Reddit advertising',
    'Promoted Posts', 'subreddit targeting', 'Reddit PPC',
    'Reddit ads Montreal', 'community advertising',
  ],
  'pinterest-ads.html': [
    'Pinterest ads agency', 'Pinterest ads management', 'Pinterest advertising',
    'Pinterest shopping ads', 'promoted pins', 'Pinterest ecommerce ads',
    'Pinterest ads Montreal', 'visual discovery advertising',
  ],
  'amazon-ads.html': [
    'Amazon ads agency', 'Amazon PPC agency', 'Amazon advertising management',
    'Sponsored Products', 'Sponsored Brands', 'Amazon DSP',
    'ACOS optimization', 'Amazon ads Montreal',
  ],
  'spotify-ads.html': [
    'Spotify ads agency', 'Spotify advertising', 'audio ads agency',
    'podcast advertising', 'Spotify Ad Studio', 'streaming audio ads',
    'Spotify ads Montreal', 'audio branding',
  ],
  'book-call.html': [
    'book a strategy call', 'marketing consultation', 'growth strategy call',
    'free marketing audit', 'Davnoot contact',
  ],
};

// Business contact / local-SEO details (used for LocalBusiness + Organization schema).
export const PHONE = '+1-438-223-7131';

// ---- Helpers ---------------------------------------------------------------
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Turn an HTML fragment into clean plain text (for JSON-LD answer bodies):
// strip inline tags, decode the handful of entities we actually use, collapse whitespace.
export const toPlainText = (s) =>
  String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

// Public URLs are EXTENSIONLESS: /seo, not /seo.html (home is /). vercel.json
// 301-redirects every /<name>.html to its clean path and serves the static file
// at the clean URL, so this is the one canonical form Google sees. `pathFor()` in
// scripts/compile-pages.js keeps the DB overlay key as /<name>.html (an internal
// join key the admin CMS writes) — that is deliberately NOT the public URL.
export function cleanPath(file) {
  if (file === 'index.html') return '/';
  const name = file.replace(/\.html$/, '');
  // The 7-service pages live under /services/* (e.g. /services/seo). Everything
  // else (book-call, privacy, the two AI-SEO landing pages, the /services index)
  // stays at the top level. The DB overlay key (pathFor in compile-pages.js) is
  // deliberately still /seo.html — public URL ≠ storage key.
  // ADS_PAGES live one level down at /ads/<name> (e.g. /ads/reddit-ads); the
  // 7-service pages at /services/<name>; everything else (book-call, privacy, the
  // /services and /ads overview indexes, the landing pages) stays top-level.
  return (SERVICE_PAGES.includes(file) ? '/services/' : ADS_PAGES.includes(file) ? '/ads/' : '/') + name;
}
export function canonicalFor(file) {
  return SITE_URL + cleanPath(file);
}

/**
 * Serialize a JSON-LD graph for embedding inside <script type="application/ld+json">.
 *
 * The `<` escaping is NOT cosmetic. JSON.stringify happily emits a literal
 * `</script>` if one appears in any string — a post titled `Why </script> tags
 * break SEO` would CLOSE the JSON-LD block early and inject the remainder of the
 * title into the document as live HTML. Escaping `<` to < is still valid
 * JSON, parses identically, and makes the breakout impossible.
 *
 * Use this everywhere instead of a bare JSON.stringify into a <script> tag.
 */
export function jsonLdSafe(graph) {
  return JSON.stringify(graph, null, 2).replace(/</g, '\\u003c');
}

// ---- Chrome ----------------------------------------------------------------
export function navHtml(file, base = '', settings = SITE_DEFAULTS) {
  const brand = (settings || SITE_DEFAULTS).brand || {};
  const logo = brand.logo || LOGO;
  const wordmark = brand.wordmark || 'Davnoot Digital';
  const isHome = file === 'index.html';
  const home = isHome ? '' : '/'; // anchor prefix: "#services" on home, "/#services" elsewhere
  let active = '';
  if (file === 'book-call.html') active = 'contact';
  else if (file === 'blog') active = 'blog';
  else if (file === 'services.html' || SERVICE_PAGES.includes(file)) active = 'services';
  const act = (n) => (active === n ? ' class="active"' : '');
  const ctaHref = file === 'book-call.html' ? '#form' : '/book-call';
  const ctaText = file === 'book-call.html' ? 'Jump to form →' : 'Book a call →';
  return `<nav>
  <a href="/" class="logo" data-cursor>
    <img src="/${logo}" alt="${esc(brand.name || 'Davnoot')}" class="logo-mark" />
    <span class="wordmark">${wordmark}</span>
  </a>
  <ul class="nav-links">
    <li><a href="/services"${act('services')} data-cursor>Services</a></li>
    <li><a href="${home}#process" data-cursor>Process</a></li>
    <li><a href="${home}#results" data-cursor>Work</a></li>
    <li><a href="/blog"${act('blog')} data-cursor>Blog</a></li>
    <li><a href="/book-call"${act('contact')} data-cursor>Contact</a></li>
  </ul>
  <a href="${ctaHref}" class="nav-cta" data-cursor>${ctaText}</a>
  <button class="nav-toggle" type="button" aria-label="Toggle menu" aria-expanded="false"><span></span><span></span><span></span></button>
</nav>`;
}

export function footerHtml(file, base = '', settings = SITE_DEFAULTS) {
  const s = settings || SITE_DEFAULTS;
  const brand = s.brand || {};
  const contact = s.contact || {};
  const logo = brand.logo || LOGO;
  const wordmark = brand.wordmark || 'Davnoot Digital';
  const email = contact.email || 'info@davnoot.com';
  const phoneHref = (contact.phone || PHONE).replace(/[^\d+]/g, '');
  const phoneDisplay = contact.phoneDisplay || '+1 (438) 223-7131';
  const home = file === 'index.html' ? '' : '/'; // anchor prefix, as in navHtml
  return `<footer id="contact">
  <div class="footer-top">
    <div>
      <a href="/" class="logo" data-cursor>
        <img src="/${logo}" alt="${esc(brand.name || 'Davnoot')}" class="logo-mark footer-logo-mark" />
        <span class="wordmark">${wordmark}</span>
      </a>
      <p class="footer-tagline">Independent growth agency. Built for <em>revenue</em>.</p>
    </div>
    <div class="footer-col">
      <h4>Services</h4>
      <ul>
        <li><a href="/services/seo" data-cursor>SEO</a></li>
        <li><a href="/services/meta-ads" data-cursor>Paid Ads</a></li>
        <li><a href="/services/email" data-cursor>Email</a></li>
        <li><a href="/services/ai-seo" data-cursor>AI SEO</a></li>
        <li><a href="/services/chatgpt-ads" data-cursor>ChatGPT Ads</a></li>
        <li><a href="/services/software" data-cursor>Custom Software</a></li>
        <li><a href="/services/shopify" data-cursor>Shopify</a></li>
        <li><a href="/ads" data-cursor>Ad Platforms</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>Company</h4>
      <ul>
        <li><a href="${home}#about" data-cursor>About</a></li>
        <li><a href="${home}#results" data-cursor>Work</a></li>
        <li><a href="${home}#process" data-cursor>Process</a></li>
        <li><a href="#" data-cursor>Careers</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>Contact</h4>
      <ul>
        <li><a href="mailto:${email}" data-cursor>${email}</a></li>
        <li><a href="tel:${phoneHref}" data-cursor>${phoneDisplay}</a></li>
        <li><a href="#" data-cursor>LinkedIn ↗</a></li>
        <li><a href="#" data-cursor>Instagram ↗</a></li>
      </ul>
    </div>
  </div>

  <div class="footer-big">Davnoot<em>.</em></div>

  <div class="footer-bottom">
    <span>© 2025 Davnoot. All rights reserved.</span>
    <span>Built with intent in Montreal</span>
  </div>
</footer>`;
}

// ---- Structured data -------------------------------------------------------
// The Organization node is referenced by @id from every other node (including
// BlogPosting's publisher), so it must stay stable.
//
// SETTINGS-DRIVEN, byte-identically at defaults. Every field reads from the merged
// site settings (SITE_DEFAULTS + the db.settings diff), and each default value in
// SITE_DEFAULTS mirrors the constant it replaced — so orgNode() === orgNode(defaults)
// to the byte (asserted in scripts/settings-render.test.js and, end-to-end, by the
// golden test, since build.js bakes this node into every page's JSON-LD). A brand /
// contact / org edit in /admin therefore flows into the Organization schema anywhere
// orgNode is regenerated from live settings (the blog today; the marketing pages once
// their <head> JSON-LD is modelled as a hole — see the settings→render note in TODO).
export function orgNode(settings = SITE_DEFAULTS) {
  const s = settings || SITE_DEFAULTS;
  const brand = s.brand || {};
  const contact = s.contact || {};
  const org = s.org || {};
  const addr = contact.address || {};
  const siteUrl = s.defaults?.siteUrl || SITE_URL;
  const ogImage = s.defaults?.ogImage || OG_IMAGE;
  return {
    '@type': 'Organization',
    '@id': siteUrl + '/#organization',
    name: brand.name || 'Davnoot',
    url: siteUrl + '/',
    logo: ogImage,
    image: ogImage,
    description: org.description || ORG_DESC,
    email: contact.email || 'info@davnoot.com',
    telephone: contact.phone || PHONE,
    foundingDate: org.foundingDate || '2025',
    address: { '@type': 'PostalAddress', addressLocality: addr.locality || 'Montreal', addressRegion: addr.region || 'QC', addressCountry: addr.country || 'CA' },
    areaServed: 'Worldwide',
  };
}

/** The content type of a marketing FILE, for the structured-data registry. */
export function schemaTypeFor(file) {
  if (file === 'index.html') return 'home';
  if (file === 'book-call.html') return 'contact';
  if (SERVICE_PAGES.includes(file)) return 'service';
  if (ADS_PAGES.includes(file)) return 'service'; // ad hubs emit Service + FAQPage, like /services/* (serviceType from SERVICE_TYPE)
  return 'landing';
}

/**
 * The marketing-page JSON-LD. This is now a thin adapter over the single site-wide
 * builder in lib/structured-data.js — there is no second, hand-written graph here to
 * drift from the blog's. The node set and order come from CONFIG[type].nodes; this
 * function only picks the type and wraps the result.
 *
 * Proven byte-identical to the previous inline builder by scripts/pages-golden.test.js
 * (the compiled BUILD:SEO region is a pure function of this output, so any drift fails
 * `npm run site`) and by scripts/structured-data.test.js.
 */
export function jsonLd(file, title, desc, faqs) {
  const graph = buildGraph({ file, title, desc, faqs }, canonicalFor(file), schemaTypeFor(file));
  return jsonLdSafe({ '@context': 'https://schema.org', '@graph': graph });
}

export function seoHtml(file, title, desc, faqs) {
  const canonical = canonicalFor(file);
  const kw = KEYWORDS[file];
  return [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta name="robots" content="index, follow" />`,
    ...(kw && kw.length ? [`<meta name="keywords" content="${esc(kw.join(', '))}" />`] : []),
    `<link rel="icon" type="image/png" href="/${LOGO}" />`,
    `<link rel="apple-touch-icon" href="/${LOGO}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Davnoot" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    `<script type="application/ld+json">\n${jsonLd(file, title, desc, faqs)}\n</script>`,
  ].join('\n');
}
