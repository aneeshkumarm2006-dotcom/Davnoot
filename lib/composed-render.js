/* Render a COMPOSED page (base:null) — one built in /admin from library sections.
 *
 * Unlike the 8 overlay pages (whose layout is a disk template), a composed page has
 * no disk source: its layout IS doc.sections. This renderer assembles the same
 * marketing shell every disk page ships (styles.css, the ambient canvas, the shared
 * nav/footer, script.js) around the section renderers in lib/sections.gen.js — so a
 * page created in /admin looks, styles, and animates like a hand-built one, with no
 * new CSS. It emits a proper <head> (one canonical, one robots, one title, valid
 * JSON-LD via the unified buildGraph) so a composed page is a first-class, indexable
 * URL — not the thin fallback shell it used to be.
 *
 * Pure: pass it a document (and optional merged settings). No I/O.
 */
import { SITE_URL, esc, navHtml, footerHtml, jsonLdSafe, canonicalFor } from './templates.js';
import { buildGraph } from './structured-data.js';
import { renderSection } from './sections.gen.js';
import { SITE_DEFAULTS } from './site-defaults.js';

const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400;1,9..144,500;1,9..144,600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';

/** The <head>, mirroring a disk marketing page's head, with SEO from the doc. */
function head(content, url, settings, lang) {
  const seo = content.seo || {};
  const title = seo.metaTitle || content.title || 'Davnoot';
  const desc = seo.metaDescription || '';
  const canonical = isSameOrigin(seo.canonicalUrl) ? seo.canonicalUrl : url;
  const robots = robotsContent(seo);
  const ogImage = seo.ogImage || settings.defaults?.ogImage || SITE_URL + '/images/Firefly.png';
  const logo = settings.brand?.logo || 'images/Firefly.png';
  const graph = buildGraph({ file: null, title, desc, faqs: faqsFromSections(content.sections) }, url, 'landing');

  return `<!DOCTYPE html>
<html lang="${esc(lang || 'en')}">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${FONTS}" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta name="robots" content="${robots}" />
  <link rel="icon" type="image/png" href="/${esc(logo)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(settings.brand?.name || 'Davnoot')}" />
  <meta property="og:title" content="${esc(seo.ogTitle || title)}" />
  <meta property="og:description" content="${esc(seo.ogDescription || desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">
${jsonLdSafe({ '@context': 'https://schema.org', '@graph': graph })}
  </script>
</head>`;
}

// A composed page uses ABSOLUTE chrome links (base '/'), like the blog — it lives at a
// clean extensionless URL, so a relative "index.html" would resolve wrong.
export function renderComposedPage(doc, { preview = false, settings = SITE_DEFAULTS } = {}) {
  const s = settings || SITE_DEFAULTS;
  const content = doc?.content || {};
  const url = SITE_URL + (doc?.path || '/' + (doc?.slug || ''));
  const lang = doc?.locale || 'en';
  const body = (content.sections || []).map(renderSection).filter(Boolean).join('\n\n');

  let html = `${head(content, url, s, lang)}

<body${content.bodyClass ? ` class="${esc(content.bodyClass)}"` : ''}>

  <canvas id="ambient"></canvas>
  <div class="cursor"></div>
  <div class="cursor-ring"></div>

${navHtml('composed', '/', s)}

${body}

${footerHtml('composed', '/', s)}

  <script src="/script.js"></script>
</body>

</html>`;

  if (preview) {
    html = html.replace(
      '</body>',
      '<script>(function(){document.addEventListener("click",function(e){' +
        'var el=e.target.closest("[data-cms-preview]");if(!el)return;e.preventDefault();' +
        'parent.postMessage({type:"cms:click",key:el.getAttribute("data-cms-preview")},"*");});})();</script></body>',
    );
  }
  return html;
}

/* ---- helpers ---- */
function robotsContent(seo) {
  if (seo.robotsIndex === undefined && seo.robotsFollow === undefined) return 'index, follow';
  const idx = seo.robotsIndex === false ? 'noindex' : 'index';
  const fol = seo.robotsFollow === false ? 'nofollow' : 'follow';
  return `${idx}, ${fol}`;
}
function isSameOrigin(u) {
  if (!u) return false;
  try { return new URL(u).origin === new URL(SITE_URL).origin; } catch { return false; }
}
// Derive FAQPage JSON-LD from a composed page's faq section — the same "schema is a
// projection of visible content" rule the disk pages follow.
function faqsFromSections(sections) {
  const faq = (sections || []).find((s) => s?.type === 'faq' && !s.hidden);
  if (!faq) return [];
  return (faq.items || []).map((it) => ({ q: stripTags(it.q), a: stripTags(it.a) })).filter((f) => f.q && f.a);
}
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
