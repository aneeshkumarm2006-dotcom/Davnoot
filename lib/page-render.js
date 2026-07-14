/* The marketing-page renderer — ONE function, used by the public route
 * (api/page.js) AND the admin preview (api/admin/preview.js), so "preview looks
 * like production" is true by construction.
 *
 * renderPage(tpl, doc) walks the compiled chunk stream and fills each hole with
 * the document's override or the hole's compiled default. With doc = null (or a
 * doc with no overrides), every hole emits its default -> the output is
 * BYTE-IDENTICAL to the frozen fixture. That single property is the entire
 * migration risk budget, and scripts/pages-golden.test.js enforces it.
 *
 * Pure: no I/O, no database. Feed it a compiled template and a page document.
 */
import { esc, SITE_URL } from './templates.js';

/**
 * Flatten a page document's overridable values into a `key -> value` map.
 * Content holes live at doc.content.sections[].fields[key] and doc.content.seo.*.
 * We read from `doc.content` (the state the renderer is asked to show — `live`
 * for the public route, `draft` for preview; the caller passes the right one).
 */
function collectValues(content) {
  const values = {};
  if (!content) return values;

  const seo = content.seo || {};
  // SEO holes are keyed "seo.metaTitle" etc. so a compiled <title> hole maps
  // straight onto the edited field. keywords is an array -> the tag wants ", ".
  for (const [k, v] of Object.entries(seo)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'keywords') { if (Array.isArray(v) && v.length) values['seo.keywords'] = v.join(', '); continue; }
    values['seo.' + k] = v;
  }

  // Section field holes. For overlay (content-only) pages, sections carry field
  // overrides keyed exactly as the compiled holes ("hero.title", "cap.0.desc", …).
  for (const section of content.sections || []) {
    if (!section || section.hidden) continue;
    for (const [k, v] of Object.entries(section.fields || {})) {
      if (v !== undefined && v !== null && v !== '') values[k] = v;
    }
  }
  return values;
}

/** How a hole's OVERRIDE value is emitted, by kind. Defaults are emitted verbatim. */
function emitOverride(kind, value) {
  const s = String(value);
  switch (kind) {
    case 'text':
      return esc(s); // plain text — escape everything
    case 'url':
    case 'image':
      return esc(s); // attribute value — escape quotes/angle brackets
    case 'inline':
    case 'richtext':
      // Author-supplied markup. The API sanitizes on WRITE (sanitizeInline /
      // sanitizeBody), so what reaches the document is already safe; emit as-is.
      return s;
    default:
      return esc(s);
  }
}

/**
 * Render a compiled page template with an optional page document.
 *
 * @param {object} tpl   a COMPILED_PAGES entry
 * @param {object|null} doc  the page document, or null. The caller decides whether
 *                           to pass doc.live or doc.draft as `doc.content`.
 * @param {object} [opts] { preview } — preview mode injects click-to-edit hooks.
 */
export function renderPage(tpl, doc, opts = {}) {
  const content = doc?.content || null;
  const values = collectValues(content);

  const seo = content?.seo || {};

  let out = '';
  for (const chunk of tpl.chunks) {
    if (typeof chunk === 'string') {
      out += chunk;
      continue;
    }
    out += renderHole(chunk, values, seo);
  }

  if (opts.preview) out = injectPreviewHooks(out);
  return out;
}

/** Emit one hole: computed robots, origin-checked canonical, or a plain override. */
function renderHole(chunk, values, seo) {
  // The robots tag is DERIVED from the tri-state fields (Invariant 1). Both unset
  // -> the compiled default ("index, follow"). A Boolean('') here would noindex the
  // whole site, so we branch only on an EXPLICIT boolean.
  if (chunk.h === '__robots__') {
    if (seo.robotsIndex === undefined && seo.robotsFollow === undefined) return chunk.def;
    const idx = seo.robotsIndex === false ? 'noindex' : 'index';
    const fol = seo.robotsFollow === false ? 'nofollow' : 'follow';
    return `${idx}, ${fol}`;
  }

  // A cross-origin canonical silently de-indexes the page that sets it (Invariant 2),
  // so honour an override only when it is same-origin; otherwise keep the default.
  if (chunk.h === 'seo.canonicalUrl') {
    const v = seo.canonicalUrl;
    if (v && isSameOrigin(v)) return esc(v);
    return chunk.def;
  }

  const has = Object.prototype.hasOwnProperty.call(values, chunk.h);
  return has ? emitOverride(chunk.kind, values[chunk.h]) : chunk.def;
}

function isSameOrigin(url) {
  try { return new URL(url).origin === new URL(SITE_URL).origin; }
  catch { return false; }
}

/**
 * The effective <title> and <meta description>. Exposed so tests and the SEO
 * table can assert that doc.content.title (an ADMIN LABEL) never reaches the head.
 */
export function effectiveTitle(tpl, doc) {
  const metaTitle = doc?.content?.seo?.metaTitle;
  if (metaTitle) return metaTitle;
  const hole = (tpl.slots || []).find((s) => s.key === 'seo.metaTitle');
  return hole ? hole.def : '';
}
export function effectiveDescription(tpl, doc) {
  const metaDesc = doc?.content?.seo?.metaDescription;
  if (metaDesc) return metaDesc;
  const hole = (tpl.slots || []).find((s) => s.key === 'seo.metaDescription');
  return hole ? hole.def : '';
}

/* Preview-only: outline editable regions and postMessage on click, so the admin
 * can click the page to focus a field. Never shipped to the public route. */
function injectPreviewHooks(html) {
  const script =
    '<script>(function(){document.addEventListener("click",function(e){' +
    'var el=e.target.closest("[data-cms-preview]");if(!el)return;e.preventDefault();' +
    'parent.postMessage({type:"cms:click",key:el.getAttribute("data-cms-preview")},"*");});})();</script>';
  return html.replace('</body>', script + '</body>');
}
