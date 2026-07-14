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
 * The `base` parameter
 * ---------------------------------------------------------------------------
 * The static pages live at the root (/seo.html) and link to each other with
 * RELATIVE hrefs ("index.html"). The blog lives one level down (/blog/my-post),
 * where a relative "index.html" would resolve to /blog/index.html and 404.
 *
 * So every link-emitting template takes a `base`:
 *   base = ''   -> "index.html"    (static pages — byte-identical to before)
 *   base = '/'  -> "/index.html"   (blog pages — absolute, depth-independent)
 *
 * Do not "simplify" this by making the static pages absolute too: that would
 * rewrite all 8 hand-audited pages for no benefit.
 */

// ---- Site config -----------------------------------------------------------
export const SITE_URL = 'https://www.davnoot.com'; // canonical host (www; matches GSC + Vercel apex→www 308)
export const LOGO = 'images/Firefly.png';
export const OG_IMAGE = SITE_URL + '/' + LOGO;
export const ORG_DESC =
  'Davnoot is an independent growth agency. Six disciplines — SEO, paid social, email, AI search, ChatGPT ads, and custom software — engineered into one revenue engine.';

export const SERVICE_PAGES = ['seo.html', 'meta-ads.html', 'email.html', 'ai-seo.html', 'chatgpt-ads.html', 'software.html'];
export const SERVICE_TYPE = {
  'seo.html': 'Search Engine Optimization',
  'meta-ads.html': 'Paid Advertising (Google & Meta)',
  'email.html': 'Email Marketing',
  'ai-seo.html': 'AI Search Optimization',
  'chatgpt-ads.html': 'AI Search Advertising',
  'software.html': 'Custom Software Development',
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
  'ai-seo-montreal.html': [
    'AI SEO Montreal', 'AI SEO agency Montreal', 'generative engine optimization Montreal',
    'GEO agency Montreal', 'ChatGPT SEO Montreal', 'AI search optimization Montreal',
    'Montreal SEO agency', 'bilingual AI SEO', 'Google AI Overviews Montreal',
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

export function canonicalFor(file) {
  return file === 'index.html' ? SITE_URL + '/' : SITE_URL + '/' + file;
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
export function navHtml(file, base = '') {
  const isHome = file === 'index.html';
  const home = isHome ? '' : base + 'index.html';
  let active = '';
  if (file === 'book-call.html') active = 'contact';
  else if (file === 'blog') active = 'blog';
  else if (SERVICE_PAGES.includes(file)) active = 'services';
  const act = (n) => (active === n ? ' class="active"' : '');
  const ctaHref = file === 'book-call.html' ? '#form' : base + 'book-call.html';
  const ctaText = file === 'book-call.html' ? 'Jump to form →' : 'Book a call →';
  return `<nav>
  <a href="${base}index.html" class="logo" data-cursor>
    <img src="${base}${LOGO}" alt="Davnoot" class="logo-mark" />
    <span class="wordmark">Davnoot Digital</span>
  </a>
  <ul class="nav-links">
    <li><a href="${home}#services"${act('services')} data-cursor>Services</a></li>
    <li><a href="${home}#process" data-cursor>Process</a></li>
    <li><a href="${home}#results" data-cursor>Work</a></li>
    <li><a href="/blog"${act('blog')} data-cursor>Blog</a></li>
    <li><a href="${home}#contact"${act('contact')} data-cursor>Contact</a></li>
  </ul>
  <a href="${ctaHref}" class="nav-cta" data-cursor>${ctaText}</a>
  <button class="nav-toggle" type="button" aria-label="Toggle menu" aria-expanded="false"><span></span><span></span><span></span></button>
</nav>`;
}

export function footerHtml(file, base = '') {
  const home = file === 'index.html' ? '' : base + 'index.html';
  return `<footer id="contact">
  <div class="footer-top">
    <div>
      <a href="${base}index.html" class="logo" data-cursor>
        <img src="${base}${LOGO}" alt="Davnoot" class="logo-mark footer-logo-mark" />
        <span class="wordmark">Davnoot Digital</span>
      </a>
      <p class="footer-tagline">Independent growth agency. Built for <em>revenue</em>.</p>
    </div>
    <div class="footer-col">
      <h4>Services</h4>
      <ul>
        <li><a href="${base}seo.html" data-cursor>SEO</a></li>
        <li><a href="${base}meta-ads.html" data-cursor>Paid Ads</a></li>
        <li><a href="${base}email.html" data-cursor>Email</a></li>
        <li><a href="${base}ai-seo.html" data-cursor>AI SEO</a></li>
        <li><a href="${base}chatgpt-ads.html" data-cursor>ChatGPT Ads</a></li>
        <li><a href="${base}software.html" data-cursor>Custom Software</a></li>
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
        <li><a href="mailto:info@davnoot.com" data-cursor>info@davnoot.com</a></li>
        <li><a href="tel:+14382237131" data-cursor>+1 (438) 223-7131</a></li>
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
export function orgNode() {
  return {
    '@type': 'Organization',
    '@id': SITE_URL + '/#organization',
    name: 'Davnoot',
    url: SITE_URL + '/',
    logo: OG_IMAGE,
    image: OG_IMAGE,
    description: ORG_DESC,
    email: 'info@davnoot.com',
    telephone: PHONE,
    foundingDate: '2025',
    address: { '@type': 'PostalAddress', addressLocality: 'Montreal', addressRegion: 'QC', addressCountry: 'CA' },
    areaServed: 'Worldwide',
  };
}

export function jsonLd(file, title, desc, faqs) {
  const graph = [orgNode()];
  if (file === 'index.html') {
    graph.push({
      '@type': 'WebSite',
      '@id': SITE_URL + '/#website',
      url: SITE_URL + '/',
      name: 'Davnoot',
      description: ORG_DESC,
      publisher: { '@id': SITE_URL + '/#organization' },
    });
    // LocalBusiness node — supports the Montreal / local-SEO keyword cluster.
    graph.push({
      '@type': 'ProfessionalService',
      '@id': SITE_URL + '/#localbusiness',
      name: 'Davnoot',
      image: OG_IMAGE,
      url: SITE_URL + '/',
      telephone: PHONE,
      email: 'info@davnoot.com',
      description: ORG_DESC,
      priceRange: '$$',
      address: { '@type': 'PostalAddress', addressLocality: 'Montreal', addressRegion: 'QC', addressCountry: 'CA' },
      areaServed: ['Montreal', 'Canada', 'Worldwide'],
      parentOrganization: { '@id': SITE_URL + '/#organization' },
    });
  }
  if (SERVICE_PAGES.includes(file)) {
    graph.push({
      '@type': 'Service',
      name: title.replace(/\s*[—|]\s*Davnoot\s*$/, ''),
      serviceType: SERVICE_TYPE[file],
      description: desc,
      url: canonicalFor(file),
      provider: { '@id': SITE_URL + '/#organization' },
      areaServed: 'Worldwide',
    });
  }
  if (faqs && faqs.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': canonicalFor(file) + '#faq',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  return jsonLdSafe({ '@context': 'https://schema.org', '@graph': graph });
}

export function seoHtml(file, title, desc, faqs) {
  const canonical = canonicalFor(file);
  const kw = KEYWORDS[file];
  return [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta name="robots" content="index, follow" />`,
    ...(kw && kw.length ? [`<meta name="keywords" content="${esc(kw.join(', '))}" />`] : []),
    `<link rel="icon" type="image/png" href="${LOGO}" />`,
    `<link rel="apple-touch-icon" href="${LOGO}" />`,
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
