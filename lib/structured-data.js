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
import { SITE_URL, OG_IMAGE, orgNode } from './templates.js';
import { htmlToText } from './html-text.js';
import { findFaqBlock } from './blocks.js';

const BLOG_BASE = SITE_URL + '/blog';

/** Which fields an author may override, per node type. Anything else is ignored. */
export const OVERRIDABLE_FIELDS = {
  BlogPosting: ['headline', 'description', 'image', 'datePublished', 'dateModified', 'articleSection', 'keywords'],
  BreadcrumbList: [],
  FAQPage: [],
};

/** The content-type registry. Add a type here; the builder does the rest. */
export const CONFIG = {
  blogPost: {
    nodes: ['Organization', 'BlogPosting', 'BreadcrumbList', 'FAQPage'],
  },
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

  BreadcrumbList: (post, ctx) => ({
    '@type': 'BreadcrumbList',
    '@id': ctx.url + '#breadcrumb',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: BLOG_BASE },
      { '@type': 'ListItem', position: 3, name: post.title, item: ctx.url },
    ],
  }),

  /* DERIVED, not authored: FAQPage exists only if the post actually has an FAQ
   * block. Emitting FAQPage schema for questions that are not visible on the page
   * is a structured-data violation and Google will hand out a manual action. So
   * the schema is a projection of the content, and can never disagree with it. */
  FAQPage: (post, ctx) => {
    const block = findFaqBlock(post.blocks);
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
  },
};

/** Strip undefined so they don't serialize as nulls in the JSON-LD. */
function prune(node) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Build the @graph for a post.
 *
 * @param {object} post
 * @param {string} url   the post's canonical URL (already origin-validated)
 * @returns {object[]}   graph nodes, ready for jsonLdSafe()
 */
export function buildGraph(post, url) {
  const sd = post.structuredData || {};
  const disabled = new Set(sd.disabledTypes || []);
  const ctx = { url };

  // replace mode: the author's raw JSON IS the graph. Nothing else is emitted.
  if (sd.customJsonLd && sd.customMode === 'replace') {
    return toNodes(sd.customJsonLd);
  }

  const graph = [];

  for (const type of CONFIG.blogPost.nodes) {
    if (disabled.has(type)) continue;

    const build = BUILDERS[type];
    if (!build) continue;

    let node = build(post, ctx);
    if (!node) continue; // e.g. FAQPage with no FAQ block

    // Apply whitelisted field overrides.
    const overrides = sd.fieldOverrides?.[type];
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (!OVERRIDABLE_FIELDS[type]?.includes(key)) continue; // ignore, don't throw
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
