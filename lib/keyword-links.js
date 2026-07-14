/* Keyword backlink injection.
 *
 * ===========================================================================
 * THIS RUNS AT RENDER TIME. IT NEVER TOUCHES THE STORED BODY.
 * ===========================================================================
 * The links are spliced into the HTML on the way out to the browser, not baked
 * into `content` on save. That is deliberate and it is the whole point: edit the
 * keyword list once and EVERY post picks up the change on its next render, with
 * no re-save, no migration, and no risk of a botched rewrite corrupting a body
 * that authors have been editing for months. Bake them in at save time and you
 * can never take them back out.
 *
 * ---------------------------------------------------------------------------
 * THE RULES (each one is a real over-optimization or correctness trap)
 * ---------------------------------------------------------------------------
 *  - FIRST OCCURRENCE ONLY by default. Linking all 14 mentions of "SEO agency"
 *    in one article is a spam signal. `linkFirstOccurrenceOnly: false` opts out.
 *
 *  - LONGEST KEYWORD FIRST. Otherwise "SEO" links first and eats the inside of
 *    "SEO agency Montreal", leaving a shorter, worse anchor and a mangled phrase.
 *
 *  - NEVER inside <a>, <h1>-<h6>, <code>, or <pre>.
 *      <a>       -> nested anchors are invalid HTML; browsers silently unnest
 *                   them and the result is unpredictable.
 *      headings  -> linking a heading wrecks the document outline and looks spammy.
 *      code/pre  -> a code sample must render as written, not become a hyperlink.
 *
 *  - WORD BOUNDARIES, case-insensitive match, ORIGINAL CASING PRESERVED in the
 *    anchor. We match "seo agency" but the page keeps showing "SEO Agency" if
 *    that is what the author wrote.
 *
 *  - ESCAPE everything we splice in. The keyword and URL come from a form.
 *
 *  - External links get target="_blank" and rel="noopener" ALWAYS, plus
 *    nofollow / sponsored per the row's setting. (rel=dofollow is the absence of
 *    nofollow — it is not a real rel token and must not be emitted.)
 */

const SKIP_TAGS = new Set(['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'code', 'pre', 'script', 'style', 'textarea']);

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isInternal(url, siteHost) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === siteHost.replace(/^www\./, '');
  } catch {
    return false;
  }
}

/** Build the <a ...> open tag for one backlink row. */
function anchorOpen(url, rel, siteHost) {
  const internal = isInternal(url, siteHost);

  const relTokens = [];
  if (!internal) relTokens.push('noopener');
  // 'dofollow' is NOT a rel value — it simply means "don't add nofollow".
  if (rel === 'nofollow') relTokens.push('nofollow');
  if (rel === 'sponsored') relTokens.push('sponsored');

  const attrs = [`href="${escapeHtml(url)}"`, 'class="kw-link"'];
  if (!internal) attrs.push('target="_blank"');
  if (relTokens.length) attrs.push(`rel="${relTokens.join(' ')}"`);

  return `<a ${attrs.join(' ')}>`;
}

/**
 * Split HTML into tokens: tags (passed through untouched) and text runs
 * (candidates for linking). We track which skip-tag we're inside so that text in
 * a heading or an existing anchor is never a candidate.
 *
 * A tiny hand-rolled tokenizer rather than a DOM parse: this must run inside a
 * serverless function on every blog render, and pulling in jsdom/cheerio to walk
 * a few hundred text nodes is not worth the cold-start cost.
 */
function* tokenize(html) {
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>|<!--[\s\S]*?-->/g;
  let last = 0;
  let m;

  while ((m = re.exec(html))) {
    if (m.index > last) yield { type: 'text', value: html.slice(last, m.index) };

    const raw = m[0];
    const tag = (m[1] || '').toLowerCase();
    const closing = raw.startsWith('</');
    const selfClosing = raw.endsWith('/>');

    yield { type: 'tag', value: raw, tag, closing, selfClosing };
    last = re.lastIndex;
  }

  if (last < html.length) yield { type: 'text', value: html.slice(last) };
}

/**
 * Inject keyword backlinks into a rendered body.
 *
 * @param {string} html
 * @param {{keyword:string,url:string,rel:string}[]} keywords
 * @param {{firstOnly?:boolean, siteHost?:string}} opts
 */
export function injectKeywordLinks(html, keywords, { firstOnly = true, siteHost = 'davnoot.com' } = {}) {
  if (!html || !Array.isArray(keywords) || !keywords.length) return html || '';

  // LONGEST FIRST — see the header. A short keyword must never get the chance to
  // link inside a longer phrase that is also on the list.
  const rows = keywords
    .filter((k) => k && k.keyword && k.url)
    .slice()
    .sort((a, b) => b.keyword.length - a.keyword.length);

  if (!rows.length) return html;

  const linked = new Set(); // keywords already used, for firstOnly
  const skipDepth = new Map(); // tag -> open count

  let out = '';

  for (const token of tokenize(html)) {
    if (token.type === 'tag') {
      out += token.value;

      if (SKIP_TAGS.has(token.tag) && !token.selfClosing) {
        const depth = skipDepth.get(token.tag) || 0;
        // Guard against a stray closing tag pushing the depth negative, which
        // would make everything after it look "inside" a skip region forever.
        skipDepth.set(token.tag, Math.max(0, depth + (token.closing ? -1 : 1)));
      }
      continue;
    }

    const inSkipRegion = [...skipDepth.values()].some((d) => d > 0);
    if (inSkipRegion || !token.value.trim()) {
      out += token.value;
      continue;
    }

    out += linkTextRun(token.value, rows, linked, firstOnly, siteHost);
  }

  return out;
}

/**
 * Link keywords inside one plain-text run (never inside a tag or a skip region).
 *
 * ---------------------------------------------------------------------------
 * WHY SEGMENTS AND NOT A SIMPLE String.replace() CHAIN
 * ---------------------------------------------------------------------------
 * The obvious implementation — loop the keywords, call result.replace() on the
 * whole run each time — produces NESTED ANCHORS. Once the first keyword has been
 * spliced in, the run is no longer plain text: it contains `<a ...>keyword</a>`.
 * The next (shorter) keyword then happily matches inside that anchor's text and
 * wraps a second <a> around it:
 *
 *     <a href="/long"><a href="/seo">SEO</a> agency in Montreal</a>
 *
 * Skipping <a> in the tokenizer only protects anchors that were in the SOURCE.
 * It cannot protect anchors this function is creating as it goes.
 *
 * So we keep the run as a list of segments and mark every injected anchor as
 * `linked: true`. Later keywords only ever scan `linked: false` segments, which
 * makes a nested anchor structurally impossible rather than merely unlikely.
 */
function linkTextRun(text, rows, linked, firstOnly, siteHost) {
  let segments = [{ linked: false, value: text }];

  for (const row of rows) {
    const key = row.keyword.toLowerCase();
    if (firstOnly && linked.has(key)) continue;

    // Word-boundary aware, case-insensitive. We can't use \b: it misbehaves for
    // keywords that start or end with a non-word char (e.g. "C++", ".NET").
    const re = new RegExp(`(^|[^\\w-])(${escapeRegex(row.keyword)})(?![\\w-])`, 'gi');
    const next = [];

    for (const seg of segments) {
      // An anchor we already injected is off-limits, forever. This is the line
      // that prevents the nested-anchor bug above.
      if (seg.linked || (firstOnly && linked.has(key))) {
        next.push(seg);
        continue;
      }

      let lastIndex = 0;
      let m;
      re.lastIndex = 0;

      while ((m = re.exec(seg.value))) {
        const start = m.index + m[1].length;
        const end = start + m[2].length;

        if (start > lastIndex) {
          next.push({ linked: false, value: seg.value.slice(lastIndex, start) });
        }

        // m[2] is a verbatim slice of the SOURCE text run, so it is already valid
        // HTML text — it preserves the author's original casing and any entities
        // exactly as written. Do NOT escapeHtml() it: that would turn a legitimate
        // "&amp;" into "&amp;amp;". Only the URL, which comes from a form, is escaped
        // (see anchorOpen).
        next.push({
          linked: true,
          value: `${anchorOpen(row.url, row.rel, siteHost)}${m[2]}</a>`,
        });

        lastIndex = end;
        linked.add(key);

        if (firstOnly) break;
      }

      if (lastIndex < seg.value.length) {
        next.push({ linked: false, value: seg.value.slice(lastIndex) });
      }
    }

    segments = next;
  }

  return segments.map((s) => s.value).join('');
}
