/* Signal extraction from a post's HTML body.
 *
 * IMPORTANT: this module must run IDENTICALLY in Node (the API, computing the
 * "SEO ready" badge for the dashboard table) and in the browser (the editor,
 * running the same checks live as you type). That is why it is regex-based and
 * has zero dependencies: there is no DOM in the serverless function, and no
 * cheerio/jsdom in the browser bundle. One implementation, two callers — if you
 * reach for `document.createElement` here, the two will drift and the badge will
 * disagree with the panel.
 */

/** Strip all tags and decode the entities we actually emit; collapse whitespace. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(html) {
  const text = htmlToText(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Reading time in whole minutes at ~200 wpm, minimum 1.
 *
 * SERVER-MANAGED: recomputed from the body on every save. It is deliberately
 * absent from the input validators, so a crafted payload can never set it.
 */
export function readingTimeMinutes(html) {
  return Math.max(1, Math.round(wordCount(html) / 200) || 1);
}

/** Every <img> in the body, with its alt (empty string when absent). */
export function extractImages(html) {
  const out = [];
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    const src = (tag.match(/\ssrc\s*=\s*["']([^"']*)["']/i) || [, ''])[1];
    const altMatch = tag.match(/\salt\s*=\s*["']([^"']*)["']/i);
    out.push({ src, alt: altMatch ? altMatch[1].trim() : '', hasAlt: Boolean(altMatch && altMatch[1].trim()) });
  }
  return out;
}

/** Every <a href> in the body, split into internal vs external. */
export function extractLinks(html, siteHost = 'davnoot.com') {
  const out = [];
  const re = /<a\b[^>]*\shref\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const href = m[1].trim();
    if (!href || href.startsWith('#')) continue;
    const isAbsolute = /^https?:\/\//i.test(href);
    const external = isAbsolute && !new RegExp(`//([a-z0-9-]+\\.)*${siteHost.replace(/\./g, '\\.')}`, 'i').test(href);
    out.push({ href, external });
  }
  return out;
}

/** Case-insensitive, word-boundary-aware "does this phrase appear in the body?" */
export function containsKeyword(html, keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return false;
  const text = htmlToText(html).toLowerCase();
  const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}
