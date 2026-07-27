/* The site-wide not-found page (404) and retired page (410).
 *
 * ONE renderer, TWO consumers — because a visitor can reach a dead URL by two
 * completely different routes and both must land on the same page:
 *
 *   1. build.js writes the output to `site/404.html`. Vercel serves that file
 *      for any request that matches NO route at all — e.g. /services/ch, which
 *      is two segments and therefore never reaches the /:slug catch-all rewrite.
 *      Without the file on disk you get Vercel's grey "404: NOT_FOUND" panel.
 *   2. api/page.js renders it live for a single-segment slug that reached the
 *      catch-all but has no page document (404) or an archived one (410).
 *
 * No inline <script> and no inline <style> — the CSP allowlists exactly two
 * inline scripts site-wide and this is not one of them. Everything visual comes
 * from /styles.css (see the "404 / 410" block at the bottom of it), and the
 * copy animates with pure CSS keyframes, NOT the .reveal IntersectionObserver:
 * .reveal starts at opacity 0 and only becomes visible once script.js runs, so
 * using it here would mean a blank page whenever the JS is slow or blocked. A
 * 404 page is exactly the page that must never depend on anything.
 */
import { esc, navHtml, footerHtml, FAVICON_TAGS } from './templates.js';

/* Where people actually wanted to go. Six cards, because .nf-grid is a fixed
 * repeat(3, 1fr) — 3 or 6 fill the rows evenly, 4 or 5 leave a gap. */
const DESTINATIONS = [
  { num: '01 · Services', href: '/services', title: 'Everything <em>we run</em>', arrow: 'Browse' },
  { num: '02 · SEO', href: '/services/seo', title: 'Rank for what <em>buyers</em> search', arrow: 'Explore' },
  { num: '03 · Google Ads', href: '/google-ads', title: 'Buy the clicks that <em>convert</em>', arrow: 'Explore' },
  { num: '04 · Meta Ads', href: '/services/meta-ads', title: 'Create demand on <em>paid social</em>', arrow: 'Explore' },
  { num: '05 · Blog', href: '/blog', title: 'The <em>playbooks</em>, written out', arrow: 'Read' },
  { num: '06 · Contact', href: '/book-call', title: 'Talk to a <em>strategist</em>', arrow: 'Book a call' },
];

const COPY = {
  404: {
    title: 'Page not found (404)',
    eyebrow: 'Error 404',
    eyebrowNote: 'Page not found',
    heading: "This page <em>isn't</em> here.",
    sub: 'The link is broken, the page moved, or the URL has a typo in it. Nothing on your end. Here is where most people were heading anyway.',
    desc: 'That page does not exist on davnoot.com. Browse our services, read the blog, or book a call.',
  },
  410: {
    title: 'Page retired (410)',
    eyebrow: 'Error 410',
    eyebrowNote: 'Page retired',
    heading: 'This page has <em>retired</em>.',
    sub: 'We took it down on purpose, so there is nothing to fix. The work behind it still happens — it just lives somewhere else now.',
    desc: 'This page has been permanently retired. Browse our current services, read the blog, or book a call.',
  },
};

const card = (d) => `        <a href="${d.href}" class="nf-card" data-cursor>
          <div class="nf-card-num">${d.num}</div>
          <div class="nf-card-title">${d.title}</div>
          <div class="nf-card-arrow">${d.arrow} →</div>
        </a>`;

/**
 * @param {{ status?: 404 | 410 }} [opts]
 * @returns {string} a complete HTML document
 */
export function renderNotFound({ status = 404 } = {}) {
  const c = COPY[status] || COPY[404];

  return `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(c.title)} | Davnoot</title>
  <meta name="description" content="${esc(c.desc)}" />
  <meta name="robots" content="noindex, follow" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400;1,9..144,500;1,9..144,600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
    rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
${FAVICON_TAGS.map((t) => '  ' + t).join('\n')}
</head>

<body>
  <div class="cursor"></div>
  <div class="cursor-ring"></div>

${navHtml('')}

  <main class="nf">
    <p class="nf-code">${esc(c.eyebrow)} <span class="sep"></span> ${esc(c.eyebrowNote)}</p>
    <h1 class="nf-title">${c.heading}</h1>
    <p class="nf-sub">${esc(c.sub)}</p>
    <div class="nf-cta-row">
      <a href="/" class="btn-primary" data-cursor>
        Back to the homepage
        <span class="arrow">→</span>
      </a>
      <a href="/book-call" class="btn-secondary" data-cursor>Book a call</a>
    </div>

    <div class="nf-links">
      <p class="nf-links-label">Popular destinations</p>
      <div class="nf-grid">
${DESTINATIONS.map(card).join('\n')}
      </div>
    </div>
  </main>

${footerHtml('')}

  <script src="/script.js"></script>
</body>

</html>
`;
}
