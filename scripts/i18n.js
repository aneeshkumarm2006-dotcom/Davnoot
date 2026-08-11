#!/usr/bin/env node
/* The translation pipeline for the marketing pages.
 *
 *   node scripts/i18n.js extract    # pages/*.html      -> lib/i18n/catalog.gen.json
 *   node scripts/i18n.js build      # + lib/i18n/fr.json -> pages/fr/*.html
 *   node scripts/i18n.js check      # report coverage, write nothing
 *
 * ===========================================================================
 * WHY A STRING CATALOG AND NOT TRANSLATED HTML FILES
 * ===========================================================================
 * A French site needs every word on the page, but the CMS hole system only
 * reaches annotated elements — index.html is 30KB of literal markup behind 12
 * holes. Translating via holes would ship a 95%-English "French" page.
 *
 * The other obvious option — hand-translating a second copy of each .html —
 * duplicates the LAYOUT, so every future design change has to be made twice and
 * the two copies drift. The drift only surfaces as a visual diff on a live
 * revenue page, in the language nobody on the team reads first.
 *
 * So: pages/*.html stays the ONE hand-edited source of layout, and French is a
 * dictionary of strings keyed by the English text. pages/fr/*.html is GENERATED
 * and committed (like lib/compiled-pages.gen.js — there is no Vercel build step).
 * A layout change re-generates both languages; a copy change touches fr.json.
 *
 * ===========================================================================
 * THE ONE RULE, INHERITED FROM compile-pages.js: NEVER re-serialize.
 * ===========================================================================
 * parse5's serialize() rewrites `<br />` to `<br>`, and these pages use XHTML
 * void tags throughout. We parse ONLY to learn node offsets, then splice the
 * ORIGINAL source string at those offsets. Everything we do not translate is
 * copied through byte-for-byte — which is what lets scripts/i18n.test.js assert
 * that a French page with an EMPTY dictionary is byte-identical to its English
 * source (modulo lang=""). That property is the whole safety net: it proves the
 * generator moves, reformats and drops nothing.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS ONE TRANSLATION UNIT
 * ---------------------------------------------------------------------------
 * The inner HTML of a "leaf block" — an element with no block-level children and
 * no annotated descendants. Whole phrases, not text nodes:
 *
 *     <h1>Search that <em>compounds</em>.</h1>
 *        -> ONE unit: "Search that <em>compounds</em>."
 *
 * Splitting that into "Search that", "compounds", "." would be untranslatable —
 * French reorders the words, and <em> has to move with the word it emphasises.
 * <em> placement is load-bearing here (script.js's splitWords has an <em> branch
 * and styles.css styles it), so the translator MUST be able to place it.
 *
 * Units are keyed by their exact English string, so a phrase repeated across the
 * 8 pages (they are ~93% structurally identical) is translated ONCE.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

import { TRANSLATED_PAGES, cleanPath, DEFAULT_LOCALE } from '../lib/templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');
const FR_DIR = path.join(PAGES_DIR, 'fr');
const I18N_DIR = path.join(ROOT, 'lib', 'i18n');

export const PAGE_FILES = [
  'index.html', 'seo.html', 'meta-ads.html', 'email.html',
  'ai-seo.html', 'chatgpt-ads.html', 'software.html', 'book-call.html',
  'startup-seo.html', 'ppc-agency-montreal.html', 'google-ads-for-small-business.html',
  'google-ads-for-dentists.html', 'google-ads-for-law-firms.html',
];

/* Inline elements may appear INSIDE a translation unit; the French keeps them.
 * Anything not listed is treated as block-level, i.e. a boundary between units. */
const INLINE = new Set([
  'em', 'strong', 'b', 'i', 'span', 'a', 'br', 'small', 'sup', 'sub',
  'u', 'code', 'mark', 'abbr', 'cite', 'q', 'time', 'wbr',
]);

/* Never descend into these — their text is code or graphics, not copy. */
const OPAQUE = new Set(['script', 'style', 'svg', 'noscript', 'template', 'canvas']);

/* Attribute values that are user-visible copy. `content` is handled separately
 * (only on <title>-adjacent meta tags, and only outside BUILD:SEO).
 *
 * `data-slots` is the odd one out and has to be here: it is a JSON array of the
 * booking page's time slots that script.js renders into the calendar at runtime.
 * The element holding it has no text children, so it belongs to no translation
 * unit and nothing else in this file would ever reach it — leaving the French
 * booking page offering "1:00 PM", which is not how a time is written in Quebec.
 * Its French value is the whole JSON array, rewritten to a 24-hour clock. */
const TEXT_ATTRS = ['alt', 'placeholder', 'aria-label', 'title', 'data-slots'];

/* A string worth translating has at least one letter. This drops "→", "—", "01",
 * "$$", "&nbsp;" and the whitespace between tags — noise that would bloat the
 * catalog and that a translator would have to skip one by one. */
const hasLetter = (s) => /[a-zA-ZÀ-ɏ]/.test(s);

// ---- DOM helpers (same shape as compile-pages.js) ---------------------------
const childrenOf = (node) => node.childNodes || [];
const attrOf = (node, name) => (node.attrs || []).find((a) => a.name === name);
const tagName = (node) => node.tagName;

function* walk(node) {
  yield node;
  for (const child of childrenOf(node)) yield* walk(child);
}

function innerRange(node) {
  const loc = node.sourceCodeLocation;
  if (!loc || !loc.startTag || !loc.endTag) return null;
  return [loc.startTag.endOffset, loc.endTag.startOffset];
}

function attrValueRange(src, node, name) {
  const loc = node.sourceCodeLocation;
  const span = loc && loc.attrs && loc.attrs[name];
  if (!span) return null;
  const seg = src.slice(span.startOffset, span.endOffset);
  const eq = seg.indexOf('=');
  if (eq < 0) return null;
  let i = eq + 1;
  while (i < seg.length && /\s/.test(seg[i])) i++;
  const quote = seg[i];
  if (quote !== '"' && quote !== "'") return null;
  return [span.startOffset + i + 1, span.startOffset + seg.indexOf(quote, i + 1)];
}

/* The BUILD regions are regenerated by build.js from lib/templates.js, which owns
 * its own French. Anything we translated in here would be overwritten on the next
 * `npm run site` — silently, and only in French. So they are hard-excluded. */
function buildRegions(src) {
  const out = [];
  for (const name of ['SEO', 'NAV', 'FOOTER']) {
    const open = src.indexOf(`<!-- BUILD:${name} -->`);
    const close = src.indexOf(`<!-- /BUILD:${name} -->`);
    if (open >= 0 && close > open) out.push([open, close + `<!-- /BUILD:${name} -->`.length]);
  }
  return out;
}
const inRegions = (regions, start) => regions.some(([a, b]) => start >= a && start < b);

/** Does this subtree contain a data-cms annotation strictly below `node`? */
function hasAnnotatedDescendant(node) {
  for (const child of childrenOf(node)) {
    for (const n of walk(child)) {
      if ((n.attrs || []).some((a) => a.name === 'data-cms')) return true;
    }
  }
  return false;
}

/** A leaf block: element children are all inline, and nothing below is annotated. */
function isTranslationUnit(node) {
  if (!node.childNodes || node.childNodes.length === 0) return false;
  if (hasAnnotatedDescendant(node)) return false;
  let sawText = false;
  for (const child of childrenOf(node)) {
    if (child.nodeName === '#text') {
      if (hasLetter(child.value)) sawText = true;
      continue;
    }
    if (child.nodeName === '#comment') continue;
    if (!child.tagName) return false;
    if (OPAQUE.has(child.tagName)) return false;
    if (!INLINE.has(child.tagName)) return false; // a block child -> recurse instead
    for (const n of walk(child)) {
      if (n.nodeName === '#text' && hasLetter(n.value)) sawText = true;
      if (n.tagName && !INLINE.has(n.tagName)) return false;
    }
  }
  return sawText;
}

/**
 * Every translatable [start, end) range in a page source, ascending and
 * non-overlapping. Each entry: { start, end, en, kind, tag }.
 *
 * `en` is the TRIMMED inner slice; the surrounding whitespace stays in the
 * literal chunks so the generated file keeps the source's indentation exactly.
 */
export function translatableRanges(src) {
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const regions = buildRegions(src);
  const found = [];

  const push = (r, kind, tag) => {
    if (!r) return;
    let [start, end] = r;
    if (inRegions(regions, start)) return;
    const raw = src.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const en = raw.slice(lead, raw.length - trail);
    if (!en || !hasLetter(en)) return;
    found.push({ start: start + lead, end: end - trail, en, kind, tag });
  };

  // <title> and <meta name="description"> sit in <head> OUTSIDE the BUILD:SEO
  // region (build.js only replaces the region), so they are ours to translate —
  // and they are the two most important strings on the page for French search.
  for (const node of walk(doc)) {
    if (tagName(node) === 'title') { push(innerRange(node), 'title', 'title'); break; }
  }
  for (const node of walk(doc)) {
    if (tagName(node) === 'meta' && attrOf(node, 'name')?.value === 'description') {
      push(attrValueRange(src, node, 'content'), 'description', 'meta');
      break;
    }
  }

  // Body copy: walk down, stopping at the first leaf block on each branch.
  const visit = (node) => {
    if (!node.tagName && node.nodeName !== '#document' && node.nodeName !== '#document-fragment') {
      // text/comment at this level is handled by the parent's unit check
      return;
    }
    if (node.tagName && OPAQUE.has(node.tagName)) return;

    if (node.tagName) {
      for (const name of TEXT_ATTRS) {
        if (attrOf(node, name)) push(attrValueRange(src, node, name), 'attr:' + name, node.tagName);
      }
    }
    if (node.tagName && node.tagName !== 'head' && isTranslationUnit(node)) {
      push(innerRange(node), 'text', node.tagName);
      return; // do not descend — the whole inner is one unit
    }
    for (const child of childrenOf(node)) visit(child);
  };
  for (const child of childrenOf(doc)) visit(child);

  found.sort((a, b) => a.start - b.start || a.end - b.end);

  // Defensive: a unit must never nest inside another, or splicing would corrupt.
  const out = [];
  for (const r of found) {
    if (out.length && r.start < out[out.length - 1].end) continue;
    out.push(r);
  }
  return out;
}

// ---- extract ---------------------------------------------------------------
function extract() {
  const byString = new Map(); // en -> { en, kind, pages:Set, count }
  for (const file of PAGE_FILES) {
    const src = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
    for (const r of translatableRanges(src)) {
      const hit = byString.get(r.en) || { en: r.en, kind: r.kind, tag: r.tag, pages: new Set(), count: 0 };
      hit.pages.add(file);
      hit.count++;
      byString.set(r.en, hit);
    }
  }
  // Longest first: the translator meets the meaty prose before the one-word CTAs,
  // and a shared phrase is obviously shared (it lists every page it appears on).
  const entries = [...byString.values()]
    .sort((a, b) => b.count - a.count || b.en.length - a.en.length || a.en.localeCompare(b.en))
    .map((e) => ({ en: e.en, kind: e.kind, tag: e.tag, count: e.count, pages: [...e.pages].sort() }));

  fs.mkdirSync(I18N_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(I18N_DIR, 'catalog.gen.json'),
    JSON.stringify({ generatedFrom: PAGE_FILES, total: entries.length, entries }, null, 2) + '\n',
  );
  return entries;
}

// ---- build -----------------------------------------------------------------
export function loadDict(locale) {
  const p = path.join(I18N_DIR, `${locale}.json`);
  if (!fs.existsSync(p)) return {};
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Accept both { "en": "fr" } and { strings: { "en": "fr" } }.
  const src = raw.strings || raw;
  // Drop `_`-prefixed bookkeeping keys (the file's own usage notes) and anything
  // non-string. JSON has no comments, so the notes have to live in the object —
  // and a stray array reaching the splicer would stringify into the page as
  // "[object Object]" on whichever element happened to match.
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('_') || typeof v !== 'string') continue;
    out[k] = v;
  }
  /* `_verbatim`: strings that are DELIBERATELY identical in both languages —
   * brand names ("Majestic Filatures"), initials on an avatar ("WF"), and the
   * code samples in the software page's terminal mock, where the "copy" is
   * JavaScript and translating it would be actively wrong.
   *
   * They are listed rather than just omitted so that "reviewed, stays as-is" is
   * distinguishable from "nobody has got to it yet". Omitting them would leave
   * `npm run i18n:check` permanently short of 100% and train everyone to ignore
   * the number, which is the fastest way to lose a real gap in the noise. */
  for (const s of raw._verbatim || []) if (typeof s === 'string') out[s] = s;
  return out;
}

/** The strings explicitly declared identical, for tests that police identity pairs. */
export function loadVerbatim(locale) {
  const p = path.join(I18N_DIR, `${locale}.json`);
  if (!fs.existsSync(p)) return new Set();
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return new Set(raw._verbatim || []);
}

/**
 * Translate one page source. Untranslated units are left in ENGLISH rather than
 * blanked — a half-translated page is a bad look, but a page with holes in it is
 * a broken one, and `check` reports the gap loudly either way.
 */
export function translateSource(src, dict) {
  const ranges = translatableRanges(src);
  let out = '';
  let cursor = 0;
  let hit = 0;
  const missing = [];
  for (const r of ranges) {
    out += src.slice(cursor, r.start);
    const fr = dict[r.en];
    if (fr) { out += fr; hit++; } else { out += r.en; missing.push(r.en); }
    cursor = r.end;
  }
  out += src.slice(cursor);
  return { html: out, total: ranges.length, hit, missing };
}

/** Swap the document language. The tag is a literal chunk, not a hole. */
function setLang(html, locale) {
  return html.replace(/(<html[^>]*\blang=")[^"]*(")/i, `$1${locale}$2`);
}

/**
 * Point every in-page link at the French version of any page that HAS one.
 *
 * ===========================================================================
 * WHY THIS CANNOT BE THE TRANSLATOR'S JOB
 * ===========================================================================
 * Most links on these pages are `href`s on block-level <a> wrappers — the six
 * service cards on the homepage each wrap a whole card in one anchor. Those never
 * enter a translation unit (a unit is inner CONTENT, and `href` is not in
 * TEXT_ATTRS), so no dictionary entry can reach them. Translate the whole site and
 * every service card on the French homepage still lands on the English page.
 *
 * Rewriting them here means the routing table is derived from ONE source of truth
 * — TRANSLATED_PAGES + cleanPath(), the same pair the nav and hreflang use — so
 * adding a page to that set moves every link to it across both languages at once.
 *
 * BUILD regions are skipped: build.js regenerates them from templates.js (which
 * already emits French hrefs), and rewriting inside them would break the language
 * switcher specifically — its `href="/"` points at the English home ON PURPOSE,
 * and is exactly what the English-path rule would rewrite to "/fr".
 */
export function localizeLinks(html, locale, translated = TRANSLATED_PAGES) {
  if (locale === DEFAULT_LOCALE) return html;
  const map = new Map();
  for (const file of translated) map.set(cleanPath(file, 'en'), cleanPath(file, locale));

  const regions = buildRegions(html);
  return html.replace(/href="([^"]*)"/g, (full, href, offset) => {
    if (inRegions(regions, offset)) return full;
    // Split off #fragment / ?query so "/#results" and "/book-call#form" still match.
    const m = /^([^#?]*)([#?].*)?$/.exec(href);
    const target = map.get(m[1]);
    return target ? `href="${target}${m[2] || ''}"` : full;
  });
}

function build({ write = true } = {}) {
  const dict = loadDict('fr');
  const report = [];
  if (write) fs.mkdirSync(FR_DIR, { recursive: true });

  /* PASS 1 — translate in memory to find out which pages are actually COMPLETE.
   *
   * This has to happen before anything is written, because "is this page French
   * yet?" decides how the OTHER pages link to it. A page at 92% is not French: it
   * is the English page with a French nav, and advertising it as the fr-CA
   * alternate of the English page submits a near-duplicate under an hreflang
   * annotation — exactly the duplicate-content case hreflang exists to prevent.
   * So completeness is MEASURED here, never declared by hand. */
  const translations = PAGE_FILES.map((file) => {
    const src = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
    return { file, src, ...translateSource(src, dict) };
  });
  const complete = new Set(translations.filter((t) => t.hit === t.total).map((t) => t.file));

  if (write) writeCoverage(complete);

  // PASS 2 — emit, linking only to pages that pass 1 found complete.
  for (const t of translations) {
    const finalHtml = localizeLinks(setLang(t.html, 'fr'), 'fr', complete);
    if (write) fs.writeFileSync(path.join(FR_DIR, t.file), finalHtml);
    report.push({ file: t.file, total: t.total, hit: t.hit, missing: t.missing, complete: complete.has(t.file) });
  }
  return report;
}

/* The generated source of truth for "which pages exist in French".
 *
 * lib/templates.js reads this, so the sitemap, the hreflang cluster, the nav, the
 * footer and the language switcher all follow ONE measured fact. Finish a page's
 * dictionary entries and it joins the French site everywhere at once; leave one
 * string untranslated and it stays out of all of them. There is no list to keep
 * in sync by hand, which is the only reason this can't drift.
 *
 * A .js module rather than .json for the same reason as lib/sitemap-static.js:
 * Vercel's file tracing always follows a plain ESM import, and this one is
 * imported by a serverless function (api/sitemap.js, via templates.js).
 */
function writeCoverage(complete) {
  const list = PAGE_FILES.filter((f) => complete.has(f));
  fs.mkdirSync(I18N_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(I18N_DIR, 'coverage.gen.js'),
    `/* AUTO-GENERATED by scripts/i18n.js — do not edit by hand.\n` +
      ` * The pages whose French translation is 100% COMPLETE, measured by\n` +
      ` * comparing every translatable unit against lib/i18n/fr.json.\n` +
      ` *\n` +
      ` * lib/templates.js turns this into TRANSLATED_PAGES, which drives hreflang,\n` +
      ` * the sitemap, the nav/footer hrefs and the language switcher. A page that is\n` +
      ` * only PARTLY translated must never appear here: it would be advertised to\n` +
      ` * Google as the French alternate of a page it is still mostly a copy of.\n` +
      ` *\n` +
      ` * Regenerate with \`npm run site\` and COMMIT the result. */\n` +
      `export const FULLY_TRANSLATED = ${JSON.stringify(list, null, 2)};\n`,
  );
}

// ---- CLI -------------------------------------------------------------------
// Guarded so scripts/i18n.test.js can import translatableRanges/translateSource
// without the CLI firing (and rewriting the catalog) as an import side effect.
const isCli = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('i18n.js');
const cmd = isCli ? process.argv[2] || 'extract' : null;

if (!isCli) {
  // imported as a library — nothing to do
} else if (cmd === 'extract') {
  const entries = extract();
  const words = entries.reduce((a, e) => a + e.en.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length, 0);
  console.log(`  ✓ lib/i18n/catalog.gen.json — ${entries.length} unique string(s), ~${words} words`);
  const shared = entries.filter((e) => e.pages.length > 1).length;
  console.log(`    ${shared} appear on more than one page (translated once).`);
} else if (cmd === 'build' || cmd === 'check') {
  const report = build({ write: cmd === 'build' });
  let total = 0, hit = 0;
  for (const r of report) {
    total += r.total; hit += r.hit;
    const pct = r.total ? Math.round((r.hit / r.total) * 100) : 100;
    console.log(`  ${r.hit === r.total ? '✓' : '·'} pages/fr/${r.file} — ${r.hit}/${r.total} translated (${pct}%)`);
  }
  const pct = total ? Math.round((hit / total) * 100) : 100;
  console.log(`\n${hit}/${total} string(s) translated (${pct}%).`);
  if (hit < total) {
    const missing = [...new Set(report.flatMap((r) => r.missing))];
    console.log(`${missing.length} unique string(s) still English. First 10:`);
    for (const m of missing.slice(0, 10)) console.log('   ·', JSON.stringify(m.slice(0, 90)));
  }
} else {
  console.error(`unknown command: ${cmd} (expected extract | build | check)`);
  process.exit(1);
}
