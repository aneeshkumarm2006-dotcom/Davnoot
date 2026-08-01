/* Normalize `rel` and `target` on author-written links, at RENDER time.
 *
 * ===========================================================================
 * WHY THIS EXISTS: THE EDITOR NOFOLLOWED OUR OWN SITE.
 * ===========================================================================
 * @tiptap/extension-link ships with
 *
 *     HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' }
 *
 * as its DEFAULT, and src/dashboard/rich-text.js configured it without overriding
 * that. So every link an author has ever inserted from the /seoteam toolbar —
 * including links to davnoot.com — was stored as
 *
 *     <a target="_blank" rel="noopener noreferrer nofollow" href="https://www.davnoot.com/">
 *
 * i.e. the blog spent its entire life telling Google not to follow links to the very
 * pages the blog exists to support. The 2026-08-01 Semrush audit found 15 of these
 * across 12 posts. Nobody chose that: the rich-text toolbar has no follow/nofollow
 * control at all (the only rel UI on the site is the keyword-backlink table, which
 * has always emitted rel correctly — see lib/keyword-links.js). So a nofollow in a
 * stored body is an ARTEFACT, not an editorial decision, and stripping it restores
 * author intent rather than overriding it.
 *
 * ---------------------------------------------------------------------------
 * WHY AT RENDER TIME AND NOT AS A ONE-OFF DB MIGRATION
 * ---------------------------------------------------------------------------
 * Same reasoning as lib/keyword-links.js: the stored body is the author's, and a
 * bulk rewrite of ~20 post bodies is a thing you cannot take back if it goes wrong.
 * Normalizing on the way out fixes every post that exists AND every post written
 * before the editor fix propagates, costs one pass over a string already being
 * assembled, and is reversible by deleting one call.
 *
 * ---------------------------------------------------------------------------
 * THE RULES
 * ---------------------------------------------------------------------------
 * INTERNAL (our host, or a root-relative/anchor href):
 *   - drop `nofollow`   — the bug. Never withhold PageRank from our own pages.
 *   - drop `noreferrer` — it strips the Referer header on our OWN navigations,
 *                         which blanks out internal referral data in analytics.
 *   - drop `target="_blank"` and its `noopener` — opening an internal page in a new
 *                         tab is not a thing anyone asked for; the editor did it.
 *
 * EXTERNAL:
 *   - drop `nofollow`, UNLESS the link also carries `sponsored` or `ugc`. Those two
 *     ARE deliberate — nothing auto-inserts them, so their presence proves a human
 *     put them there, and a paid link that loses its nofollow is a Google policy
 *     violation, not a missed opportunity. This is the one asymmetry in the file
 *     and it is load-bearing: never "simplify" it into an unconditional strip.
 *   - keep `noopener`/`noreferrer` and add `noopener` when target="_blank" —
 *     that is a security property (reverse tabnabbing), not an SEO one.
 *
 * Links OUTSIDE the author body — the X/LinkedIn share buttons in
 * lib/blog-render.js — are template-owned and keep their nofollow deliberately.
 * They point at share-intent endpoints, not at content worth endorsing.
 */

/* Matches an <a> open tag and captures its attribute blob. Deliberately a regex and
 * not a DOM parse, for the same reason lib/keyword-links.js hand-rolls a tokenizer:
 * this runs in a serverless function on every blog render and a jsdom cold start
 * costs more than the entire rest of the render. Attribute values are matched
 * quote-aware, so a `>` inside an href or a title can't end the tag early. */
const A_TAG = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTR = (name) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');

const attrValue = (attrs, name) => {
  const m = ATTR(name).exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};

/**
 * Is this href one of ours?
 *
 * Root-relative ("/blog/x"), fragment ("#faq") and query-only ("?page=2") hrefs are
 * internal by definition. Absolute hrefs are compared by hostname with the www.
 * prefix ignored, exactly as lib/blog-render.js's safeCanonical does — davnoot.com
 * and www.davnoot.com are the same site, and treating them as different is how you
 * end up nofollowing half your own links.
 *
 * A PROTOCOL-RELATIVE href ("//evil.com/x") looks root-relative to a naive check and
 * is not; it is handled before the leading-slash test.
 */
export function isInternalHref(href, siteHost) {
  const h = String(href || '').trim();
  if (!h) return false;
  if (h.startsWith('//')) {
    try {
      return new URL('https:' + h).hostname.replace(/^www\./, '') === siteHost.replace(/^www\./, '');
    } catch {
      return false;
    }
  }
  if (h.startsWith('/') || h.startsWith('#') || h.startsWith('?')) return true;
  if (/^(mailto|tel|sms):/i.test(h)) return false; // not a page, and not ours to follow
  try {
    return new URL(h).hostname.replace(/^www\./, '') === siteHost.replace(/^www\./, '');
  } catch {
    return false; // a relative path with no leading slash, or junk — leave it alone
  }
}

const stripAttr = (attrs, name) => attrs.replace(new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+)`, 'gi'), '');

function setRel(attrs, tokens) {
  const cleaned = stripAttr(attrs, 'rel');
  if (!tokens.length) return cleaned;
  // Re-attach at the end; attribute order is not semantic and this keeps the
  // rewrite to one predictable shape that the tests can assert on.
  return `${cleaned.replace(/\s+$/, '')} rel="${tokens.join(' ')}"`;
}

/**
 * Rewrite rel/target on every <a> in an author-supplied HTML fragment.
 *
 * @param {string} html
 * @param {{siteHost?: string}} [opts]
 * @returns {string}
 */
export function normalizeLinkRel(html, { siteHost = 'davnoot.com' } = {}) {
  if (!html || typeof html !== 'string' || html.indexOf('<a') === -1) return html || '';

  return html.replace(A_TAG, (whole, attrs) => {
    const href = attrValue(attrs, 'href');
    if (href === null) return whole; // an <a name="..."> anchor target, not a link

    const rel = new Set(
      (attrValue(attrs, 'rel') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.toLowerCase()),
    );
    const blank = (attrValue(attrs, 'target') || '').toLowerCase() === '_blank';
    const internal = isInternalHref(href, siteHost);

    let next = attrs;

    if (internal) {
      rel.delete('nofollow');
      rel.delete('noreferrer');
      if (blank) {
        // The editor's doing, not the author's. Drop the new tab and the noopener
        // that only existed to make the new tab safe.
        next = stripAttr(next, 'target');
        rel.delete('noopener');
      }
    } else {
      // `sponsored` and `ugc` are never auto-inserted, so their presence is proof of
      // a deliberate choice. Everything else keeping nofollow is the TipTap default.
      if (!rel.has('sponsored') && !rel.has('ugc')) rel.delete('nofollow');
      if (blank) rel.add('noopener');
    }

    // Stable token order, so two links with the same semantics render the same bytes.
    const ORDER = ['noopener', 'noreferrer', 'nofollow', 'sponsored', 'ugc'];
    const tokens = [
      ...ORDER.filter((t) => rel.has(t)),
      ...[...rel].filter((t) => !ORDER.includes(t)).sort(),
    ];

    const out = setRel(next, tokens);
    return `<a${out}>`;
  });
}
