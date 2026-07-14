/* HTML sanitization for author-submitted post bodies.
 *
 * WHY THIS EXISTS
 * The editor ships a `<>` Show-HTML toggle, which means an author can paste
 * literally anything into the body. These authors are trusted (they hold the
 * shared dashboard password), so this is DEFENCE IN DEPTH — a backstop against
 * a pasted-from-the-web payload or a compromised password — NOT an allowlist
 * for untrusted input. Never relax it on the grounds that "our writers are fine".
 *
 * WHAT GETS STRIPPED
 *   <script> <style> <object> <embed> <form>   — removed entirely, content and all
 *   on* attributes (onclick, onerror, onload…)  — removed
 *   javascript: / vbscript: / data:text/html    — removed from every URL attribute
 *
 * WHAT SURVIVES — DELIBERATELY
 *   <iframe>. This is intentional and load-bearing: YouTube and Vimeo embeds are
 *   the single most common thing a content writer pastes into a post. Removing
 *   iframes silently breaks every video embed on the blog. We restrict them to
 *   https:// (see allowedSchemesByTag) but do not restrict the hostname, because
 *   an allowlist here means an engineer has to ship a code change every time
 *   marketing wants to embed a Loom, a Spotify player, or a Google Map.
 *
 * A note on scheme obfuscation: `java\tscript:alert(1)` and `  javascript:` are
 * classic bypasses. sanitize-html normalizes by stripping whitespace and control
 * characters (\x00-\x20) from a URL before it scheme-checks it, so both are
 * caught. We rely on that — do not swap this library for a hand-rolled regex.
 */
import sanitizeHtml from 'sanitize-html';

const CONFIG = {
  allowedTags: [
    // structure
    'p', 'div', 'span', 'br', 'hr', 'section', 'article',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // text
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'sub', 'sup', 'small',
    'blockquote', 'q', 'cite', 'abbr',
    // lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // code
    'code', 'pre', 'kbd', 'samp', 'var',
    // links & media
    'a', 'img', 'figure', 'figcaption', 'picture', 'source',
    'iframe', 'video', 'audio', 'track',
    // tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  ],

  allowedAttributes: {
    // No wildcard `on*` can appear here, and sanitize-html drops any attribute
    // not explicitly listed — so event handlers are removed by construction.
    a: ['href', 'name', 'target', 'rel', 'title', 'id'],
    img: ['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'class'],
    source: ['src', 'srcset', 'sizes', 'type', 'media'],
    iframe: ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy'],
    video: ['src', 'poster', 'width', 'height', 'controls', 'muted', 'loop', 'playsinline', 'preload'],
    audio: ['src', 'controls', 'loop', 'preload'],
    track: ['src', 'kind', 'srclang', 'label', 'default'],
    td: ['colspan', 'rowspan', 'align'],
    th: ['colspan', 'rowspan', 'align', 'scope'],
    col: ['span', 'width'],
    '*': ['class', 'id', 'dir', 'lang'],
  },

  // Anything not on this list (javascript:, vbscript:, data:, file:…) is dropped
  // from href/src/cite. `data:` is excluded on purpose — data:text/html is a
  // script-execution vector, and we have a media library for real images.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
  allowedSchemesByTag: {
    iframe: ['https'], // embeds must be secure — no http, no protocol-relative
  },

  // Drop these tags AND everything inside them. Without `nonTextTags`, the text
  // content of a stripped <script> would survive as visible page text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],

  allowedIframeHostnames: false, // see the header comment — hostname is not restricted
  allowProtocolRelative: false,
  enforceHtmlBoundary: false,

  transformTags: {
    // Any link the author points off-site gets the safe-external treatment.
    // (Keyword-backlink anchors are injected at RENDER time and get their own
    // rel handling — see lib/keyword-links.js.)
    a: (tagName, attribs) => {
      if (attribs.target === '_blank') {
        const rel = new Set((attribs.rel || '').split(/\s+/).filter(Boolean));
        rel.add('noopener');
        rel.add('noreferrer');
        attribs.rel = [...rel].join(' ');
      }
      return { tagName, attribs };
    },
  },
};

/**
 * Sanitize an author-supplied HTML body. Call this on EVERY write path
 * (POST and PUT alike) — never trust that an earlier layer did it.
 *
 * @param {unknown} html
 * @returns {string} safe HTML ('' for nullish input)
 */
export function sanitizeBody(html) {
  if (html == null) return '';
  return sanitizeHtml(String(html), CONFIG);
}

/* ---------------------------------------------------------------------------
 * INLINE fields — the CMS's constrained accent editor (hero titles, eyebrows).
 * `<em>` is load-bearing accent typography on the marketing pages, and script.js
 * has an <em> branch in splitWords(). A plain <input> here would silently destroy
 * the site's typography on every save. So inline fields allow ONLY inline accent
 * tags — no block elements, no media, no iframe.
 * ------------------------------------------------------------------------- */
const INLINE_CONFIG = {
  allowedTags: ['em', 'strong', 'b', 'i', 'u', 's', 'br', 'span', 'a', 'sup', 'sub', 'mark', 'small'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], span: ['class'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  allowProtocolRelative: false,
  transformTags: CONFIG.transformTags,
};

/** Sanitize a constrained inline field (em/strong/br/a/span). */
export function sanitizeInline(html) {
  if (html == null) return '';
  return sanitizeHtml(String(html), INLINE_CONFIG);
}

/* ---------------------------------------------------------------------------
 * SECTION fields — a raw-HTML escape hatch (admin-only) AND the carrier for the
 * marketing pages' hand-authored inline SVG (meta-ads alone has 33 <path>s).
 * sanitizeBody() would strip all of it. So we widen the allowlist to SVG — but
 * SVG XSS lives OUTSIDE <script>/on*: <animate>/<set> can point an href at
 * javascript:, <foreignObject> reintroduces the full HTML namespace, and <use>
 * can pull a remote payload. Those are DISALLOWED here; only static drawing
 * primitives survive, and href/xlink:href are scheme-checked. (C3.)
 * ------------------------------------------------------------------------- */
const SVG_TAGS = ['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'text', 'tspan', 'title', 'desc'];
const SVG_ATTRS = ['viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'preserveAspectRatio', 'class', 'id', 'clip-path', 'text-anchor',
  'font-size', 'font-family', 'font-weight', 'dx', 'dy'];

const SECTION_CONFIG = {
  ...CONFIG,
  allowedTags: [...CONFIG.allowedTags, ...SVG_TAGS],
  allowedAttributes: {
    ...CONFIG.allowedAttributes,
    ...Object.fromEntries(SVG_TAGS.map((t) => [t, SVG_ATTRS])),
  },
  // SVG attribute names are CASE-SENSITIVE and camelCased: viewBox, gradientUnits,
  // gradientTransform, preserveAspectRatio, clipPath. htmlparser2 (which sanitize-html
  // wraps) lowercases attribute names by default, turning `viewBox` into `viewbox`,
  // which then fails the case-sensitive allowlist and is DROPPED — silently breaking
  // every hand-authored SVG (meta-ads ships 33 inline <path>s in a scaled viewBox).
  // Preserve case so the camelCase SVG attributes survive. This does NOT weaken the
  // XSS guard: any-case on* / unknown attributes are still absent from the allowlist
  // and therefore removed regardless of casing.
  parser: { ...(CONFIG.parser || {}), lowerCaseAttributeNames: false },
  // Explicitly refuse the SVG script vectors even though they aren't in allowedTags —
  // nonTextTags also drops their text content so nothing leaks through.
  nonTextTags: [...CONFIG.nonTextTags, 'foreignObject', 'animate', 'animateTransform', 'animateMotion', 'set', 'use'],
};

/** Sanitize a raw section/SVG blob (admin-only escape hatch). */
export function sanitizeSection(html) {
  if (html == null) return '';
  return sanitizeHtml(String(html), SECTION_CONFIG);
}
