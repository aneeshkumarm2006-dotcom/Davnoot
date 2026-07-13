#!/usr/bin/env node
/* Davnoot static-site builder — single source of truth for nav, footer, and SEO head.
 *
 *   node build.js
 *
 * Each .html file has three idempotent regions marked by HTML comments:
 *   <!-- BUILD:SEO -->...<!-- /BUILD:SEO -->      (canonical, OG/Twitter, JSON-LD, favicon)
 *   <!-- BUILD:NAV -->...<!-- /BUILD:NAV -->       (site nav)
 *   <!-- BUILD:FOOTER -->...<!-- /BUILD:FOOTER -->  (site footer)
 *
 * Edit the templates below, run `node build.js`, and every page is rebuilt in place.
 * Output is fully static HTML — crawlable by Google AND non-JS AI bots (GPTBot, etc.).
 */
const fs = require('fs');
const path = require('path');

// ---- Site config -----------------------------------------------------------
const SITE_URL = 'https://davnoot.com';            // <-- change here if the domain differs
const LOGO = 'images/Firefly.png';
const OG_IMAGE = SITE_URL + '/' + LOGO;
const ORG_DESC = 'Davnoot is an independent growth agency. Six disciplines — SEO, paid social, email, AI search, ChatGPT ads, and custom software — engineered into one revenue engine.';

const SERVICE_PAGES = ['seo.html', 'meta-ads.html', 'email.html', 'ai-seo.html', 'chatgpt-ads.html', 'software.html'];
const SERVICE_TYPE = {
  'seo.html': 'Search Engine Optimization',
  'meta-ads.html': 'Paid Advertising (Google & Meta)',
  'email.html': 'Email Marketing',
  'ai-seo.html': 'AI Search Optimization',
  'chatgpt-ads.html': 'AI Search Advertising',
  'software.html': 'Custom Software Development',
};

// ---- Helpers ---------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (d) => d.toISOString().slice(0, 10);         // -> YYYY-MM-DD
const TODAY = fmtDate(new Date());

// Per-page sitemap weighting. Home ranks highest; the booking page slightly lower
// than the service pages. Anything new defaults to a sensible service-tier weight.
function sitemapMeta(file) {
  if (file === 'index.html') return { priority: '1.0', changefreq: 'weekly' };
  if (file === 'book-call.html') return { priority: '0.7', changefreq: 'monthly' };
  return { priority: '0.8', changefreq: 'monthly' };
}

function fill(html, region, body) {
  const re = new RegExp('<!-- BUILD:' + region + ' -->[\\s\\S]*?<!-- /BUILD:' + region + ' -->');
  const replacement = `<!-- BUILD:${region} -->\n${body}\n<!-- /BUILD:${region} -->`;
  if (!re.test(html)) {
    console.warn(`  ! no BUILD:${region} markers found — skipped`);
    return html;
  }
  return html.replace(re, replacement);
}

function canonicalFor(file) {
  return file === 'index.html' ? SITE_URL + '/' : SITE_URL + '/' + file;
}

// ---- Templates -------------------------------------------------------------
function navHtml(file) {
  const isHome = file === 'index.html';
  const home = isHome ? '' : 'index.html';
  let active = '';
  if (file === 'book-call.html') active = 'contact';
  else if (SERVICE_PAGES.includes(file)) active = 'services';
  const act = (n) => (active === n ? ' class="active"' : '');
  const ctaHref = file === 'book-call.html' ? '#form' : 'book-call.html';
  const ctaText = file === 'book-call.html' ? 'Jump to form →' : 'Book a call →';
  return `<nav>
  <a href="index.html" class="logo" data-cursor>
    <img src="${LOGO}" alt="Davnoot" class="logo-mark" />
    <span class="wordmark">Davnoot Digital</span>
  </a>
  <ul class="nav-links">
    <li><a href="${home}#services"${act('services')} data-cursor>Services</a></li>
    <li><a href="${home}#process" data-cursor>Process</a></li>
    <li><a href="${home}#results" data-cursor>Work</a></li>
    <li><a href="${home}#contact"${act('contact')} data-cursor>Contact</a></li>
  </ul>
  <a href="${ctaHref}" class="nav-cta" data-cursor>${ctaText}</a>
  <button class="nav-toggle" type="button" aria-label="Toggle menu" aria-expanded="false"><span></span><span></span><span></span></button>
</nav>`;
}

function footerHtml(file) {
  const home = file === 'index.html' ? '' : 'index.html';
  return `<footer id="contact">
  <div class="footer-top">
    <div>
      <a href="index.html" class="logo" data-cursor>
        <img src="${LOGO}" alt="Davnoot" class="logo-mark footer-logo-mark" />
        <span class="wordmark">Davnoot Digital</span>
      </a>
      <p class="footer-tagline">Independent growth agency. Built for <em>revenue</em>.</p>
    </div>
    <div class="footer-col">
      <h4>Services</h4>
      <ul>
        <li><a href="seo.html" data-cursor>SEO</a></li>
        <li><a href="meta-ads.html" data-cursor>Paid Ads</a></li>
        <li><a href="email.html" data-cursor>Email</a></li>
        <li><a href="ai-seo.html" data-cursor>AI SEO</a></li>
        <li><a href="chatgpt-ads.html" data-cursor>ChatGPT Ads</a></li>
        <li><a href="software.html" data-cursor>Custom Software</a></li>
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

function jsonLd(file, title, desc) {
  const org = {
    '@type': 'Organization',
    '@id': SITE_URL + '/#organization',
    name: 'Davnoot',
    url: SITE_URL + '/',
    logo: OG_IMAGE,
    image: OG_IMAGE,
    description: ORG_DESC,
    email: 'info@davnoot.com',
    foundingDate: '2025',
    address: { '@type': 'PostalAddress', addressLocality: 'Montreal', addressRegion: 'QC', addressCountry: 'CA' },
    areaServed: 'Worldwide',
  };
  const graph = [org];
  if (file === 'index.html') {
    graph.push({
      '@type': 'WebSite',
      '@id': SITE_URL + '/#website',
      url: SITE_URL + '/',
      name: 'Davnoot',
      description: ORG_DESC,
      publisher: { '@id': SITE_URL + '/#organization' },
    });
  }
  if (SERVICE_PAGES.includes(file)) {
    graph.push({
      '@type': 'Service',
      name: title.replace(/\s*—\s*Davnoot\s*$/, ''),
      serviceType: SERVICE_TYPE[file],
      description: desc,
      url: canonicalFor(file),
      provider: { '@id': SITE_URL + '/#organization' },
      areaServed: 'Worldwide',
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
}

function seoHtml(file, title, desc) {
  const canonical = canonicalFor(file);
  return [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta name="robots" content="index, follow" />`,
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
    `<script type="application/ld+json">\n${jsonLd(file, title, desc)}\n</script>`,
  ].join('\n');
}

// Build sitemap.xml from the pages that were just processed. Ordering: home,
// then the service pages, then everything else — so the XML mirrors site priority.
function buildSitemap(files, lastmod) {
  const order = ['index.html', ...SERVICE_PAGES];
  const rest = files.filter((f) => !order.includes(f)).sort();
  const ordered = [...order.filter((f) => files.includes(f)), ...rest];
  const urls = ordered
    .map((file) => {
      const { priority, changefreq } = sitemapMeta(file);
      return `  <url>
    <loc>${canonicalFor(file)}</loc>
    <lastmod>${lastmod[file]}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Auto-generated by build.js — do not edit by hand. Run \`node build.js\` to regenerate. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

// ---- Run -------------------------------------------------------------------
// Google Search Console verification files (googleXXXX.html) are served as-is —
// they carry no BUILD markers and must stay out of the sitemap.
const isVerificationFile = (f) => /^google[0-9a-f]+\.html$/i.test(f);
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.html') && !isVerificationFile(f));
const lastmod = {};   // file -> YYYY-MM-DD, collected for the sitemap
let built = 0;
for (const file of files) {
  const p = path.join(__dirname, file);
  const original = fs.readFileSync(p, 'utf8');
  const title = (original.match(/<title>([\s\S]*?)<\/title>/) || [, file])[1].trim();
  const descM = original.match(/<meta\s+name="description"\s+content="([\s\S]*?)"\s*\/?>/i);
  const desc = descM ? descM[1].trim() : ORG_DESC;

  let html = fill(original, 'SEO', seoHtml(file, title, desc));
  html = fill(html, 'NAV', navHtml(file));
  html = fill(html, 'FOOTER', footerHtml(file));

  if (html !== original) {
    fs.writeFileSync(p, html);
    lastmod[file] = TODAY;                              // content changed on this build
    console.log(`  ✓ ${file}`);
    built++;
  } else {
    lastmod[file] = fmtDate(fs.statSync(p).mtime);      // unchanged — keep its real edit date
    console.log(`  · ${file} (unchanged)`);
  }
}

// ---- Sitemap (auto-generated from the pages above) -------------------------
fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), buildSitemap(files, lastmod));
console.log(`  ✓ sitemap.xml (${files.length} URLs)`);

console.log(`\nBuilt ${built} page(s) + sitemap. Static HTML — nav, footer & SEO baked in.`);
