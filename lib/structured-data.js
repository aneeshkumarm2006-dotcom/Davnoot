/* The structured-data engine.
 *
 * A CONFIG declares, per content type, which schema.org nodes to emit. The
 * builder assembles them, applies the post's overrides, and hands back a @graph.
 *
 * Why a config rather than JSON-LD hand-written in the renderer: the blog is the
 * first content type, not the last. When the service pages or a case-study type
 * want structured data, they register here instead of growing a second, subtly
 * different JSON-LD builder that drifts from this one.
 *
 * ---------------------------------------------------------------------------
 * PER-POST OVERRIDES  (post.structuredData)
 * ---------------------------------------------------------------------------
 *   disabledTypes: ['FAQPage']     drop a node entirely
 *   fieldOverrides: { BlogPosting: { headline: '…' } }
 *                                  override WHITELISTED fields on a node
 *   customJsonLd: '{"@type":"HowTo"}'   raw JSON — validated at save time
 *   customMode: 'append' | 'replace'
 *       append  -> add the custom node(s) to the generated graph
 *       replace -> the custom JSON becomes the ENTIRE graph. An escape hatch for
 *                  a case the engine can't express. It is a foot-gun (you lose
 *                  Organization, BreadcrumbList, everything) so the editor warns.
 *
 * fieldOverrides is whitelisted ON PURPOSE. Letting an author set arbitrary keys
 * on a node means one typo (`@type`, `@id`) silently invalidates the schema, and
 * a broken @id detaches the publisher reference from every other node.
 */
// NOTE ON THE IMPORT CYCLE: templates.js imports buildGraph from HERE (its jsonLd()
// delegates to it, so there is one builder, not two). For that to be safe, this
// module must not USE any templates.js export at module-EVALUATION time — only inside
// builder functions, which run later. So there is deliberately no top-level
// `const BLOG_BASE = SITE_URL + '/blog'` any more; SITE_URL etc. are referenced only
// inside the builders below.
import {
  SITE_URL,
  OG_IMAGE,
  ORG_DESC,
  SERVICE_TYPE,
  SERVICE_PAGES,
  orgNode,
  postalAddress,
  placeNode,
  hrefFor,
} from './templates.js';
import { SITE_DEFAULTS } from './site-defaults.js';
import { htmlToText } from './html-text.js';
import { findFaqBlock } from './blocks.js';

/** Which fields an author may override, per node type. Anything else is ignored. */
export const OVERRIDABLE_FIELDS = {
  BlogPosting: ['headline', 'description', 'image', 'datePublished', 'dateModified', 'articleSection', 'keywords'],
  BreadcrumbList: [],
  FAQPage: [],
};

/* The content-type registry. Each type lists the schema.org nodes to emit, IN ORDER.
 * A builder that returns null (e.g. FAQPage with no questions) is skipped, so a type
 * can list FAQPage unconditionally. Adding a page kind is a one-line entry here.
 *
 * The marketing entries reproduce, node-for-node and in the exact push order,
 * templates.js's former hand-written jsonLd() — proven byte-identical by
 * scripts/pages-golden.test.js (the compiled BUILD:SEO region is a function of this
 * output, so any drift fails `npm run site`). */
/* A NOTE ON FAQPage, because it looks like dead weight and is not quite:
 * Google retired the FAQ rich result on 2026-05-07 and deleted the documentation
 * on 2026-06-15 — there is no FAQ rich result for anyone any more, so these nodes
 * will never draw an accordion in Google again. They are kept because they are
 * DERIVED from visible content (so they cost nothing and can never lie), other
 * consumers still read them, and removing them would rewrite every page. Do not
 * invest further in FAQ markup; the visible Q&A copy is what does the work now.
 *
 * BreadcrumbList, by contrast, IS still a live Google rich result with its own
 * Search Console report — which is why it was added to every inner-page type. */
export const CONFIG = {
  blogPost: { nodes: ['Organization', 'BlogPosting', 'BreadcrumbList', 'FAQPage'] },
  // The homepage has no visible breadcrumb (it IS the root), so it gets none.
  home: { nodes: ['Organization', 'WebSite', 'ProfessionalService', 'FAQPage'] },
  service: { nodes: ['Organization', 'Service', 'BreadcrumbList', 'FAQPage'] },
  landing: { nodes: ['Organization', 'BreadcrumbList', 'FAQPage'] },
  contact: { nodes: ['Organization', 'BreadcrumbList', 'FAQPage'] },
  legal: { nodes: ['Organization', 'BreadcrumbList', 'FAQPage'] },
  caseStudy: { nodes: ['Organization', 'BreadcrumbList', 'FAQPage'] },
  blogArchive: { nodes: ['Organization', 'BreadcrumbList', 'ItemList'] },
};

const iso = (d) => (d instanceof Date ? d.toISOString() : undefined);

/* ------------------------------------------------------------------ builders */

const BUILDERS = {
  Organization: () => orgNode(),

  BlogPosting: (post, ctx) => ({
    '@type': 'BlogPosting',
    '@id': ctx.url + '#post',
    headline: post.title,
    description: post.seo?.metaDescription?.trim() || post.excerpt?.trim() || undefined,
    image: post.coverImage || post.seo?.ogImage || OG_IMAGE,
    url: ctx.url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': ctx.url },
    datePublished: iso(post.publishedAt),
    dateModified: iso(post.updatedAt) || iso(post.publishedAt),
    author: post.author
      ? { '@type': 'Person', name: post.author }
      : { '@id': SITE_URL + '/#organization' },
    publisher: { '@id': SITE_URL + '/#organization' },
    keywords: (post.tags || []).join(', ') || undefined,
    wordCount: htmlToText(post.content || '').split(/\s+/).filter(Boolean).length || undefined,
    articleSection: post.tags?.[0] || undefined,
  }),

  /* DERIVED, like FAQPage: a marketing page's trail is scraped from the
   * `.breadcrumb` div it already renders (extractBreadcrumb in build.js), so the
   * schema and the visible trail cannot disagree — which is Google's actual
   * requirement. It also makes French free: pages/fr/*.html carry translated
   * crumb text and localized hrefs, and build.js reads each file's own bytes.
   *
   * Returns null when there are no crumbs (the homepage, and admin-composed
   * pages, which pass no `crumbs`), so the node is skipped rather than emitted
   * empty. Google needs >= 2 items for the rich result; extractBreadcrumb
   * already enforces that floor. */
  BreadcrumbList: (doc, ctx) => {
    if (ctx.type === 'blogPost') {
      return {
        '@type': 'BreadcrumbList',
        '@id': ctx.url + '#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE_URL + '/blog' },
          { '@type': 'ListItem', position: 3, name: doc.title, item: ctx.url },
        ],
      };
    }
    const crumbs = doc.crumbs;
    if (!crumbs || crumbs.length < 2) return null;
    return {
      '@type': 'BreadcrumbList',
      '@id': ctx.url + '#breadcrumb',
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        // Absolute URLs only — a relative `item` is a documented breadcrumb error.
        // The final crumb has no href of its own and resolves to this page.
        item: c.href ? absoluteUrl(c.href) : ctx.url,
      })),
    };
  },

  /* The blog archive's post list. Positions are 1-based and the URLs are already
   * absolute (postUrl), so this is a straight projection of what is on screen. */
  ItemList: (doc, ctx) => {
    const items = doc.items;
    if (!items || !items.length) return null;
    return {
      '@type': 'ItemList',
      '@id': ctx.url + '#posts',
      itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: it.url,
        name: it.name,
      })),
    };
  },

  /* DERIVED, not authored: FAQPage exists only if the content actually has an FAQ.
   * Emitting FAQPage schema for questions that are not visible on the page is a
   * structured-data violation and Google will hand out a manual action. So the schema
   * is a projection of the content, and can never disagree with it. The blog derives
   * it from its FAQ BLOCK; a marketing page from the {q,a} array extractFaq() lifted
   * out of its .faq-list markup at build time (already plain text — no htmlToText). */
  FAQPage: (doc, ctx) => {
    if (ctx.type === 'blogPost') {
      const block = findFaqBlock(doc.blocks);
      if (!block) return null;
      return {
        '@type': 'FAQPage',
        '@id': ctx.url + '#faq',
        mainEntity: block.data.items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: htmlToText(item.a) },
        })),
      };
    }
    const faqs = doc.faqs;
    if (!faqs || !faqs.length) return null;
    return {
      '@type': 'FAQPage',
      '@id': ctx.url + '#faq',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    };
  },

  /* ---- Marketing-page nodes (formerly templates.js jsonLd()) ---------------- */

  /* Graph plumbing, not a feature. Google retired the sitelinks search box on
   * 2024-11-21, so there is deliberately NO `potentialAction`/SearchAction here —
   * it is provably inert and only adds validator noise. What this node still
   * earns its place for is `publisher` and `inLanguage`.
   *
   * inLanguage mirrors hreflangTags()'s deliberate asymmetry exactly: plain `en`
   * (the English pages target globally, not just Canada) and `fr-CA` (the French
   * copy is Quebec French, not France French). Keep the two in step. */
  WebSite: () => ({
    '@type': 'WebSite',
    '@id': SITE_URL + '/#website',
    url: SITE_URL + '/',
    name: 'Davnoot',
    description: ORG_DESC,
    inLanguage: ['en', 'fr-CA'],
    publisher: { '@id': SITE_URL + '/#organization' },
  }),

  /* The LocalBusiness node (ProfessionalService is a LocalBusiness subtype), on
   * the homepage only. Google requires `name` + `address` for LocalBusiness
   * eligibility, which the real Westmount address now satisfies.
   *
   * It is a LOCATION of the organization, not a second organization — that is
   * what parentOrganization says, and why it must keep pointing at #organization.
   * Settings-driven like orgNode(), so an /admin address or price-range edit
   * reaches both nodes instead of only one. */
  ProfessionalService: (doc) => {
    const s = SITE_DEFAULTS;
    return {
      '@type': 'ProfessionalService',
      '@id': SITE_URL + '/#localbusiness',
      name: s.brand.name,
      image: OG_IMAGE,
      url: SITE_URL + '/',
      telephone: s.contact.phone,
      email: s.contact.email,
      description: s.org.description,
      priceRange: s.org.priceRange,
      address: postalAddress(s.contact.address),
      areaServed: s.org.areaServed.map(placeNode),
      hasOfferCatalog: offerCatalog(doc.locale),
      parentOrganization: { '@id': SITE_URL + '/#organization' },
    };
  },

  /* Service is NOT a Google rich-result type — there is no documentation page and
   * the Rich Results Test will report nothing for it. It is here for entity
   * understanding (and for whatever else parses the graph), so it stays lean: no
   * fabricated Offer prices, no invented ratings. */
  Service: (doc, ctx) => ({
    '@type': 'Service',
    '@id': ctx.url + '#service',
    name: String(doc.title || '').replace(/\s*[—|]\s*Davnoot\s*$/, ''),
    serviceType: SERVICE_TYPE[doc.file],
    description: doc.desc,
    // ctx.url, NOT canonicalFor(doc.file) — the latter drops the locale and made
    // every /fr/services/* page advertise its ENGLISH URL here.
    url: ctx.url,
    provider: { '@id': SITE_URL + '/#organization' },
    areaServed: SITE_DEFAULTS.org.areaServed.map(placeNode),
  }),
};

/* The service list the agency offers, for the homepage LocalBusiness node.
 * Derived from SERVICE_PAGES + SERVICE_TYPE so it cannot drift from the pages
 * that actually exist, and routed through hrefFor() so the FRENCH homepage links
 * the French twin of each service where one exists and the English page where it
 * does not — the same rule the nav and footer follow. */
function offerCatalog(locale) {
  return {
    '@type': 'OfferCatalog',
    name: 'Digital marketing services',
    itemListElement: SERVICE_PAGES.map((file) => ({
      '@type': 'Service',
      name: SERVICE_TYPE[file],
      url: SITE_URL + hrefFor(file, locale),
    })),
  };
}

/** Make a scraped href absolute. A relative breadcrumb `item` is a Google error. */
function absoluteUrl(href) {
  if (/^https?:\/\//i.test(href)) return href;
  return SITE_URL + (href.startsWith('/') ? href : '/' + href);
}

/** Strip undefined so they don't serialize as nulls in the JSON-LD. */
function prune(node) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Build the @graph for a document of the given content type.
 *
 * ONE builder for the whole site. The blog calls it with a post; templates.js's
 * jsonLd() calls it with a marketing-page descriptor {file,title,desc,faqs}. The
 * type selects which schema.org nodes to emit (CONFIG[type].nodes), so there is no
 * second, drifting JSON-LD builder to keep in sync.
 *
 * @param {object} doc   a post, or {file,title,desc,faqs} for a marketing page
 * @param {string} url   the canonical URL (already origin-validated)
 * @param {string} [type='blogPost']  a key of CONFIG
 * @returns {object[]}   graph nodes, ready for jsonLdSafe()
 */
export function buildGraph(doc, url, type = 'blogPost') {
  const spec = CONFIG[type] || CONFIG.blogPost;
  const sd = doc.structuredData || {};
  const disabled = new Set(sd.disabledTypes || []);
  const ctx = { url, type };

  // replace mode: the author's raw JSON IS the graph. Nothing else is emitted.
  if (sd.customJsonLd && sd.customMode === 'replace') {
    return toNodes(sd.customJsonLd);
  }

  const graph = [];

  for (const nodeType of spec.nodes) {
    if (disabled.has(nodeType)) continue;

    const build = BUILDERS[nodeType];
    if (!build) continue;

    let node = build(doc, ctx);
    if (!node) continue; // e.g. FAQPage with no questions

    // Apply whitelisted field overrides.
    const overrides = sd.fieldOverrides?.[nodeType];
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (!OVERRIDABLE_FIELDS[nodeType]?.includes(key)) continue; // ignore, don't throw
        if (value === '' || value == null) continue;
        node[key] = value;
      }
    }

    graph.push(prune(node));
  }

  if (sd.customJsonLd && sd.customMode !== 'replace') {
    graph.push(...toNodes(sd.customJsonLd));
  }

  return graph;
}

/**
 * Parse the author's custom JSON-LD into an array of nodes.
 * Accepts a single node, an array, or a full {"@graph": [...]} document.
 *
 * Returns [] on a parse failure rather than throwing: the save path already
 * REJECTED invalid JSON (see structuredDataSchema in lib/validators.js), so if we
 * are here with a broken blob it means bad data predates the validator. Dropping
 * it beats 500ing a live post — but it must never emit a broken <script> tag.
 */
function toNodes(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed['@graph'])) return parsed['@graph'];
    if (parsed && typeof parsed === 'object') return [parsed];
    return [];
  } catch (err) {
    console.error('[structured-data] custom JSON-LD failed to parse, dropping it:', err.message);
    return [];
  }
}
