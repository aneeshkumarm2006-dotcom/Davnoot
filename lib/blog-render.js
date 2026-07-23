/* The blog's HTML renderer — the "article component".
 *
 * ===========================================================================
 * ONE RENDERER, TWO CALLERS. DO NOT FORK IT.
 * ===========================================================================
 *   - api/blog/post.js        renders the PUBLIC page.
 *   - api/seoteam/preview.js  renders the AUTHOR PREVIEW.
 *
 * Both call renderArticlePage(). That is the only way "preview looks exactly
 * like production" can be true by construction rather than by vigilance. If you
 * ever find yourself writing a second, "just for preview" template, stop.
 *
 * Chrome (nav/footer/Organization schema) comes from lib/templates.js, shared
 * with build.js — so the blog cannot drift from the 8 static marketing pages.
 */
import {
  SITE_URL,
  LOGO,
  OG_IMAGE,
  esc,
  navHtml,
  footerHtml,
  orgNode,
  jsonLdSafe,
} from './templates.js';
import { injectKeywordLinks } from './keyword-links.js';
import { htmlToText } from './html-text.js';
import { renderBlocks } from './blocks.js';
import { buildGraph } from './structured-data.js';

const SITE_HOST = new URL(SITE_URL).hostname; // www.davnoot.com
const BLOG_BASE = SITE_URL + '/blog';

/* Blog pages live at /blog/<slug>, one level below the static pages, so the
 * shared nav/footer must emit ABSOLUTE hrefs. See lib/templates.js. */
const BASE = '/';

/* ------------------------------------------------------------------ helpers -- */

export const postUrl = (post) => `${BLOG_BASE}/${post.slug}`;

function fmtDate(d) {
  if (!(d instanceof Date)) return '';
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

const iso = (d) => (d instanceof Date ? d.toISOString() : undefined);

/**
 * INVARIANT 2 — a custom canonical is honoured ONLY when its origin is ours.
 *
 * A cross-origin canonical tells Google "the real version of this page lives
 * over there", which silently de-indexes the page that sets it. An author who
 * pastes a competitor's URL (or a stray localhost URL) into this field would
 * quietly remove the post from search. So: validate the origin, and fall back to
 * the post's own URL otherwise. The editor also warns, but the RENDERER is the
 * thing that must not be fooled.
 */
export function safeCanonical(post) {
  const custom = post?.seo?.canonicalUrl;
  if (!custom) return postUrl(post);
  try {
    const u = new URL(custom);
    if (u.hostname.replace(/^www\./, '') === SITE_HOST.replace(/^www\./, '')) return custom;
  } catch {
    /* not a URL — fall through */
  }
  return postUrl(post);
}

/**
 * INVARIANT 1 — robots is TRI-STATE.
 *
 * `undefined` means EMIT NOTHING. It does not mean noindex. Every pre-existing
 * post has undefined here. This function must return '' in that case — and it
 * must never apply a default, coerce with Boolean(), or "helpfully" assume
 * index,follow. Only an explicit boolean produces a directive.
 */
export function robotsMeta(seo = {}) {
  const { robotsIndex, robotsFollow } = seo;

  // Note the strict typeof checks: `false` is meaningful, `undefined` is not.
  const hasIndex = typeof robotsIndex === 'boolean';
  const hasFollow = typeof robotsFollow === 'boolean';
  if (!hasIndex && !hasFollow) return ''; // <- the whole point. No tag at all.

  const parts = [];
  if (hasIndex) parts.push(robotsIndex ? 'index' : 'noindex');
  if (hasFollow) parts.push(robotsFollow ? 'follow' : 'nofollow');
  return `<meta name="robots" content="${esc(parts.join(', '))}" />`;
}

/**
 * INVARIANT 6 — the OG headline must never fall back into metaTitle.
 *
 * The <title> treats a custom metaTitle as ABSOLUTE (no " — Davnoot" suffix),
 * because an SEO author writing a meta title has already decided exactly what
 * should appear in the SERP. So if a social headline were allowed to leak into
 * metaTitle, it would strip the branding off every search result. og:title falls
 * back to the plain post TITLE, never to metaTitle.
 */
function titles(post) {
  const seo = post.seo || {};
  const metaTitle = seo.metaTitle?.trim();

  return {
    // absolute when set by the author; branded otherwise
    documentTitle: metaTitle || `${post.title} — Davnoot`,
    ogTitle: seo.ogTitle?.trim() || post.title,
    metaDescription: seo.metaDescription?.trim() || post.excerpt?.trim() || '',
    ogDescription: seo.ogDescription?.trim() || seo.metaDescription?.trim() || post.excerpt?.trim() || '',
  };
}

/* -------------------------------------------------------------- structured -- */

/* The JSON-LD graph now comes from the structured-data ENGINE (lib/structured-data.js),
 * which owns the node builders, the per-post overrides, and the FAQPage derivation.
 * The canonical URL is passed in already origin-validated, so a cross-origin
 * canonical can never leak into the schema's @id either.
 *
 * jsonLdSafe, not JSON.stringify — a title containing `</script>` would otherwise
 * close this block early and inject live HTML. See lib/templates.js. */
function blogPostingJsonLd(post, canonical) {
  return jsonLdSafe({ '@context': 'https://schema.org', '@graph': buildGraph(post, canonical) });
}

/* -------------------------------------------------------------------- shell -- */

function shell({ head, body, bodyClass = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${head}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css" />
<link rel="stylesheet" href="/blog.css" />
</head>
<body class="${bodyClass}">
<div class="cursor"></div>
<div class="cursor-ring"></div>
<!-- BUILD:NAV -->
${navHtml('blog', BASE)}
<!-- /BUILD:NAV -->
${body}
<!-- BUILD:FOOTER -->
${footerHtml('blog', BASE)}
<!-- /BUILD:FOOTER -->
<script src="/script.js"></script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ article -- */

/**
 * Render one post as a complete HTML document.
 *
 * @param {object} post
 * @param {object} opts
 * @param {boolean} opts.preview   author preview: adds a banner, suppresses the
 *                                 view beacon, and forces noindex regardless of
 *                                 the post's own robots settings.
 * @param {object[]} opts.related  other posts for the "more from the blog" rail
 */
export function renderArticlePage(post, { preview = false, related = [] } = {}) {
  const t = titles(post);
  const canonical = safeCanonical(post);
  const seo = post.seo || {};
  const ogImage = seo.ogImage || post.coverImage || OG_IMAGE;

  // Keyword backlinks are injected HERE, at render time — never baked into the
  // stored body. Edit the keyword list and every post picks it up on next render.
  const body = injectKeywordLinks(post.content || '', post.keywords || [], {
    firstOnly: post.linkFirstOccurrenceOnly !== false,
    siteHost: SITE_HOST,
  });

  const head = [
    `<title>${esc(t.documentTitle)}</title>`,
    t.metaDescription ? `<meta name="description" content="${esc(t.metaDescription)}" />` : '',
    `<link rel="canonical" href="${esc(canonical)}" />`,

    // A preview is ALWAYS noindex — an unpublished draft must never be indexable,
    // whatever the post's own robots settings say.
    preview ? '<meta name="robots" content="noindex, nofollow" />' : robotsMeta(seo),

    seo.keywords?.length ? `<meta name="keywords" content="${esc(seo.keywords.join(', '))}" />` : '',
    `<link rel="icon" type="image/png" href="/${LOGO}" />`,

    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Davnoot" />`,
    `<meta property="og:title" content="${esc(t.ogTitle)}" />`,
    t.ogDescription ? `<meta property="og:description" content="${esc(t.ogDescription)}" />` : '',
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:image" content="${esc(ogImage)}" />`,
    iso(post.publishedAt) ? `<meta property="article:published_time" content="${iso(post.publishedAt)}" />` : '',
    iso(post.updatedAt) ? `<meta property="article:modified_time" content="${iso(post.updatedAt)}" />` : '',
    ...(post.tags || []).map((tag) => `<meta property="article:tag" content="${esc(tag)}" />`),

    `<meta name="twitter:card" content="${esc(seo.twitterCard || 'summary_large_image')}" />`,
    `<meta name="twitter:title" content="${esc(t.ogTitle)}" />`,
    t.ogDescription ? `<meta name="twitter:description" content="${esc(t.ogDescription)}" />` : '',
    `<meta name="twitter:image" content="${esc(ogImage)}" />`,

    `<script type="application/ld+json">\n${blogPostingJsonLd(post, canonical)}\n</script>`,
  ]
    .filter(Boolean)
    .join('\n');

  const shareUrl = encodeURIComponent(canonical);
  const shareText = encodeURIComponent(post.title);

  const cover = post.coverImage
    ? `<figure class="post-cover ${post.coverLayout === 'wide' ? 'is-wide' : ''}">
    <img src="${esc(post.coverImage)}" alt="${esc(post.coverImageAlt || '')}" width="1200" height="630" />
  </figure>`
    : '';

  const banner = preview
    ? `<div class="preview-banner">
    <strong>Preview</strong> — this is exactly how the post will render once live.
    ${post.status === 'draft' ? 'It is still a <strong>draft</strong> and is not public.' : ''}
  </div>`
    : '';

  const content = `
${banner}
<article class="post ${post.contentWidth === 'wide' ? 'is-wide' : ''}" data-post-id="${esc(String(post._id || ''))}">
  <nav class="post-breadcrumb" aria-label="Breadcrumb">
    <a href="/index.html">Home</a> <span>/</span> <a href="/blog">Blog</a> <span>/</span>
    <span aria-current="page">${esc(post.title)}</span>
  </nav>

  <header class="post-head">
    ${(post.tags || []).length ? `<ul class="post-tags">${post.tags.map((tag) => `<li>${esc(tag)}</li>`).join('')}</ul>` : ''}
    <h1>${esc(post.title)}</h1>
    ${post.excerpt ? `<p class="post-excerpt">${esc(post.excerpt)}</p>` : ''}
    <div class="post-meta">
      ${post.author ? `<span class="post-author">${esc(post.author)}</span>` : ''}
      ${post.publishedAt ? `<time datetime="${iso(post.publishedAt)}">${fmtDate(post.publishedAt)}</time>` : ''}
      <span>${post.readingTimeMinutes || 1} min read</span>
    </div>
    <div class="post-share">
      <a href="https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}" target="_blank" rel="noopener nofollow" aria-label="Share on X">X</a>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener nofollow" aria-label="Share on LinkedIn">in</a>
      <button type="button" class="post-copy" data-url="${esc(canonical)}">Copy link</button>
    </div>
  </header>

  ${cover}

  <div class="post-body">
${body}
  </div>

  ${/* Blocks render AFTER the body, never instead of it — Invariant 4. */ ''}
  ${renderBlocks(post.blocks)}
</article>

${renderRelated(related)}

<section class="post-cta">
  <h2>Want this kind of growth for your business?</h2>
  <p>Six disciplines, one revenue engine. Book a strategy call and we'll show you where the gaps are.</p>
  <a href="/book-call.html" class="btn-primary" data-cursor>Book a call →</a>
</section>

${copyLinkScript()}
${preview ? '' : viewBeacon(post)}
`;

  return shell({ head, body: content, bodyClass: 'blog-post-page' });
}

/* "Copy link" — progressive enhancement. The button is inert without JS, which is
 * fine; nothing else on the page depends on it. */
function copyLinkScript() {
  return `<script>
(function(){
  var b = document.querySelector('.post-copy');
  if (!b || !navigator.clipboard) return;
  b.addEventListener('click', function(){
    navigator.clipboard.writeText(b.dataset.url).then(function(){
      var t = b.textContent;
      b.textContent = 'Copied';
      setTimeout(function(){ b.textContent = t; }, 1600);
    }).catch(function(){});
  });
})();
</script>`;
}

/* Fire-and-forget view counter. Deliberately inline and tiny — no framework, and
 * a failure here must never affect the page. */
function viewBeacon(post) {
  const id = String(post._id || '');
  if (!id) return '';
  return `<script>
(function(){try{
  fetch('/api/blog/${encodeURIComponent(id)}/view',{method:'POST',keepalive:true}).catch(function(){});
}catch(e){}})();
</script>`;
}

function renderRelated(related) {
  if (!related?.length) return '';
  return `<section class="post-related">
  <h2>More from the blog</h2>
  <div class="post-grid">
    ${related.map(postCard).join('\n')}
  </div>
</section>`;
}

/* --------------------------------------------------------------------- index -- */

/**
 * @param {object} post
 * @param {Map<string,string>} [catNames]  slug -> display name, so the card can
 *   show the category's real label. When absent (e.g. the related rail), the card
 *   falls back to the post's first free-text tag — the pre-categories behaviour.
 */
export function postCard(post, catNames) {
  const img = post.coverImage
    ? `<img src="${esc(post.coverImage)}" alt="${esc(post.coverImageAlt || '')}" loading="lazy" />`
    : `<div class="card-noimg" aria-hidden="true"></div>`;

  // Prefer the managed category (resolved slug -> name); fall back to a free-text
  // tag so a post with no category still shows a chip.
  const primarySlug = post.categories?.[0];
  const label = (primarySlug && catNames?.get(primarySlug)) || post.tags?.[0] || '';

  return `<a class="post-card" href="/blog/${esc(post.slug)}" data-cursor>
  <div class="card-media">${img}</div>
  <div class="card-body">
    ${label ? `<span class="card-tag">${esc(label)}</span>` : ''}
    <h3>${esc(post.title)}</h3>
    ${post.excerpt ? `<p>${esc(post.excerpt)}</p>` : ''}
    <div class="card-meta">
      ${post.publishedAt ? `<time datetime="${iso(post.publishedAt)}">${fmtDate(post.publishedAt)}</time>` : ''}
      <span>${post.readingTimeMinutes || 1} min</span>
    </div>
  </div>
</a>`;
}

/* The horizontal pill bar under the hero — "All" plus one pill per category, each
 * linking to its clean archive URL. Rendered on both /blog and every
 * /blog/category/<slug>. Omitted entirely when no categories exist yet, so the blog
 * looks exactly as it did before any were created. */
function renderCategoryFilter(categories, activeSlug) {
  if (!categories?.length) return '';

  const pill = (href, label, active) =>
    `<a class="cat-pill${active ? ' is-active' : ''}" href="${esc(href)}"${active ? ' aria-current="page"' : ''}>${esc(label)}</a>`;

  return `<nav class="blog-filter" aria-label="Filter posts by category">
  ${pill('/blog', 'All', !activeSlug)}
  ${categories.map((c) => pill(`/blog/category/${c.slug}`, c.name, c.slug === activeSlug)).join('\n  ')}
</nav>`;
}

/**
 * Render the /blog index (paginated), optionally scoped to one category archive.
 *
 * @param {object[]} opts.posts          the page of cards
 * @param {number}   opts.page
 * @param {number}   opts.totalPages
 * @param {object[]} opts.categories     ALL categories, for the filter pills
 * @param {object|null} opts.activeCategory  the category being filtered, or null
 */
export function renderIndexPage({ posts: list, page = 1, totalPages = 1, categories = [], activeCategory = null }) {
  const catNames = new Map(categories.map((c) => [c.slug, c.name]));

  // A category archive lives at /blog/category/<slug>; the unfiltered index at /blog.
  const basePath = activeCategory ? `${BLOG_BASE}/category/${activeCategory.slug}` : BLOG_BASE;
  const pageHref = (p) => {
    const root = activeCategory ? `/blog/category/${activeCategory.slug}` : '/blog';
    return p === 1 ? root : `${root}?page=${p}`;
  };

  const canonical = page > 1 ? `${basePath}?page=${page}` : basePath;

  const title = activeCategory
    ? page > 1
      ? `${activeCategory.name} — Page ${page} — Davnoot Blog`
      : `${activeCategory.name} — Davnoot Blog`
    : page > 1
      ? `Blog — Page ${page} — Davnoot`
      : 'Blog — Growth, SEO & AI Search Insights — Davnoot';

  const desc = activeCategory
    ? `Articles on ${activeCategory.name} from the Davnoot blog — practical writing on growth, SEO, paid media, and AI search.`
    : 'Practical writing on SEO, paid media, email, AI search optimization, and the systems that turn traffic into revenue.';

  const breadcrumb = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: BLOG_BASE },
  ];
  if (activeCategory) {
    breadcrumb.push({ '@type': 'ListItem', position: 3, name: activeCategory.name, item: basePath });
  }

  const jsonLd = jsonLdSafe({
    '@context': 'https://schema.org',
    '@graph': [
      orgNode(),
      { '@type': 'BreadcrumbList', itemListElement: breadcrumb },
      {
        '@type': 'ItemList',
        itemListElement: list.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: postUrl(p),
          name: p.title,
        })),
      },
    ],
  });

  const prevHref = page - 1 === 1 ? basePath : `${basePath}?page=${page - 1}`;

  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<link rel="icon" type="image/png" href="/${LOGO}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Davnoot" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    page > 1 ? `<link rel="prev" href="${esc(prevHref)}" />` : '',
    page < totalPages ? `<link rel="next" href="${esc(`${basePath}?page=${page + 1}`)}" />` : '',
    `<script type="application/ld+json">\n${jsonLd}\n</script>`,
  ]
    .filter(Boolean)
    .join('\n');

  const empty = activeCategory
    ? `<div class="blog-empty">
  <h2>Nothing here yet.</h2>
  <p>No posts filed under <strong>${esc(activeCategory.name)}</strong> so far. <a href="/blog">Browse everything</a> instead.</p>
</div>`
    : `<div class="blog-empty">
  <h2>Nothing published yet.</h2>
  <p>We're writing. Check back shortly — or <a href="/book-call.html">book a call</a> and skip the reading.</p>
</div>`;

  const heroHeading = activeCategory
    ? `<h1>${esc(activeCategory.name)}</h1>`
    : `<h1>The <em>Davnoot</em> blog</h1>`;
  const heroSub = activeCategory
    ? `<p>Everything we've written on ${esc(activeCategory.name)}.</p>`
    : `<p>Growth, SEO, paid media, and AI search — written by the people doing the work.</p>`;

  const breadcrumbNav = activeCategory
    ? `<a href="/index.html">Home</a> <span>/</span> <a href="/blog">Blog</a> <span>/</span> <span aria-current="page">${esc(activeCategory.name)}</span>`
    : `<a href="/index.html">Home</a> <span>/</span> <span aria-current="page">Blog</span>`;

  const body = `
<header class="blog-hero">
  <nav class="post-breadcrumb" aria-label="Breadcrumb">
    ${breadcrumbNav}
  </nav>
  ${heroHeading}
  ${heroSub}
</header>

<main class="blog-index">
  ${renderCategoryFilter(categories, activeCategory?.slug)}
  ${list.length ? `<div class="post-grid">${list.map((p) => postCard(p, catNames)).join('\n')}</div>` : empty}
  ${renderPagination(page, totalPages, pageHref)}
</main>`;

  return shell({ head, body, bodyClass: 'blog-index-page' });
}

function renderPagination(page, totalPages, href = (p) => (p === 1 ? '/blog' : `/blog?page=${p}`)) {
  if (totalPages <= 1) return '';
  return `<nav class="blog-pagination" aria-label="Pagination">
  ${page > 1 ? `<a href="${esc(href(page - 1))}" rel="prev">← Newer</a>` : '<span></span>'}
  <span class="page-count">Page ${page} of ${totalPages}</span>
  ${page < totalPages ? `<a href="${esc(href(page + 1))}" rel="next">Older →</a>` : '<span></span>'}
</nav>`;
}
