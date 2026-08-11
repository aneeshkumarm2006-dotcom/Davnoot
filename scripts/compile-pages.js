#!/usr/bin/env node
/* Compile the annotated marketing pages into editable templates.
 *
 *   node scripts/compile-pages.js      (also run by `npm run site`)
 *
 * ===========================================================================
 * THE ONE RULE: NEVER re-serialize. Slice the ORIGINAL source bytes.
 * ===========================================================================
 * The source pages use XHTML-style void tags (`<br />`, `<img … />`). parse5's
 * serialize() emits `<br>` — so a parse -> serialize round trip is NOT byte
 * identical, and the golden test (renderPage(tpl, {}) === the frozen fixture)
 * would be unsatisfiable. We parse ONLY to learn node offsets, then slice the
 * source string at those offsets. The output chunks ARE the file.
 *
 * Each page compiles to an ordered array of `chunks`: literal strings and typed
 * HOLES. Rendering with no overrides emits each hole's default (its exact source
 * slice), so the output is byte-identical to the source with the `data-cms-*`
 * annotation attributes removed — which is the frozen fixture.
 *
 * Holes come from three places, none of which move, reformat, or add markup:
 *   - the <title> inner text                       -> hole `seo.metaTitle`
 *   - <meta name="description"> content=            -> hole `seo.metaDescription`
 *   - any element carrying data-cms="key"           -> a content hole
 *       data-cms-kind = text | inline | richtext | url | image (default: inline)
 *       data-cms="key@attr"  targets an ATTRIBUTE value instead of the inner text
 *
 * Output: lib/compiled-pages.gen.js (COMMITTED — there is no Vercel build step,
 * so generated modules are built locally and committed, exactly like
 * lib/sitemap-static.js). A self-check asserts byte-identity against the fixtures
 * and FAILS the build if a hole doesn't round-trip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

import { SERVICE_PAGES } from '../lib/templates.js';
import { renderPage } from '../lib/page-render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'pages');

export const PAGE_FILES = [
  'index.html', 'seo.html', 'meta-ads.html', 'email.html',
  'ai-seo.html', 'chatgpt-ads.html', 'software.html', 'book-call.html',
  'startup-seo.html', 'ppc-agency-montreal.html', 'google-ads-for-small-business.html',
  'google-ads-for-dentists.html', 'google-ads-for-law-firms.html',
];

/* The French counterparts, compiled from pages/fr/ and keyed "fr/<file>" in
 * COMPILED_PAGES so api/page.js can look one up straight from the URL prefix.
 *
 * They are compiled only if the directory exists, so a checkout that has not run
 * `node scripts/i18n.js build` yet still compiles the English site cleanly rather
 * than failing on a missing folder. */
const FR_DIR = path.join(PAGES_DIR, 'fr');
const FR_FILES = fs.existsSync(FR_DIR) ? PAGE_FILES.filter((f) => fs.existsSync(path.join(FR_DIR, f))) : [];

// ---- DOM helpers -----------------------------------------------------------
const childrenOf = (node) => node.childNodes || [];
const attrOf = (node, name) => (node.attrs || []).find((a) => a.name === name);
const tagName = (node) => node.tagName;

function* walk(node) {
  yield node;
  for (const child of childrenOf(node)) yield* walk(child);
}

/** The [start, end) source range of an element's INNER content (between tags). */
function innerRange(node) {
  const loc = node.sourceCodeLocation;
  if (!loc || !loc.startTag || !loc.endTag) return null;
  return [loc.startTag.endOffset, loc.endTag.startOffset];
}

/** The [start, end) source range of an attribute's VALUE (inside the quotes). */
function attrValueRange(src, node, name) {
  const loc = node.sourceCodeLocation;
  const span = loc && loc.attrs && loc.attrs[name];
  if (!span) return null;
  const seg = src.slice(span.startOffset, span.endOffset); // e.g. content="Foo bar"
  const eq = seg.indexOf('=');
  if (eq < 0) return null;
  let i = eq + 1;
  while (i < seg.length && /\s/.test(seg[i])) i++;
  const quote = seg[i];
  if (quote !== '"' && quote !== "'") return null;
  const valStart = span.startOffset + i + 1;
  const valEnd = span.startOffset + seg.indexOf(quote, i + 1);
  return [valStart, valEnd];
}

/** The full [start, end) source range of an attribute (name="value"), incl. leading space. */
function attrFullRange(src, node, name) {
  const loc = node.sourceCodeLocation;
  const span = loc && loc.attrs && loc.attrs[name];
  if (!span) return null;
  // Swallow the single leading whitespace so removing the attr leaves clean markup.
  let start = span.startOffset;
  if (start > 0 && /\s/.test(src[start - 1])) start -= 1;
  return [start, span.endOffset];
}

// ---- Compile one page ------------------------------------------------------
/* The DB OVERLAY KEY, not the public URL — /seo.html, never /services/seo. The
 * admin CMS writes documents against this key; canonicalFor() owns the public form.
 * French keeps the same convention one level down: /fr/seo.html. */
function pathFor(file, locale = 'en') {
  const pre = locale === 'en' ? '' : '/' + locale;
  return file === 'index.html' ? pre || '/' : pre + '/' + file;
}
function kindFor(file) {
  if (file === 'index.html') return 'home';
  if (file === 'book-call.html') return 'contact';
  if (SERVICE_PAGES.includes(file)) return 'service';
  return 'landing';
}

// The BUILD:SEO region (canonical, robots, keywords, OG/Twitter, JSON-LD) is baked
// by build.js from lib/templates.js::seoHtml(). We capture it verbatim so Phase 6
// can regenerate it from edited SEO fields; for now it renders as its own default.
function seoRegionRange(src) {
  const open = src.indexOf('<!-- BUILD:SEO -->');
  const close = src.indexOf('<!-- /BUILD:SEO -->');
  if (open < 0 || close < 0) return null;
  return [open, close + '<!-- /BUILD:SEO -->'.length];
}

function compilePage(file, src, { locale = 'en', dir = PAGES_DIR } = {}) {
  const doc = parse(src, { sourceCodeLocationInfo: true });

  const cuts = []; // { start, end, hole?|excise }
  const slots = []; // admin-form metadata
  const demoted = []; // holes that failed round-trip and were dropped
  let faqRegion = null;

  const addHole = (start, end, key, kind, group, label) => {
    const def = src.slice(start, end);
    cuts.push({ start, end, hole: { h: key, kind, def } });
    slots.push({ key, kind, group: group || 'General', label: label || key, def });
  };

  // 1) <title> inner -> seo.metaTitle
  for (const node of walk(doc)) {
    if (tagName(node) === 'title') {
      const r = innerRange(node);
      if (r) addHole(r[0], r[1], 'seo.metaTitle', 'text', 'SEO', 'Page title');
      break;
    }
  }

  // 2) <meta name="description"> content -> seo.metaDescription
  for (const node of walk(doc)) {
    if (tagName(node) === 'meta' && attrOf(node, 'name')?.value === 'description') {
      const r = attrValueRange(src, node, 'content');
      if (r) addHole(r[0], r[1], 'seo.metaDescription', 'text', 'SEO', 'Meta description');
      break;
    }
  }

  // 3) data-cms annotations -> content holes; excise the annotation attributes.
  for (const node of walk(doc)) {
    const cms = attrOf(node, 'data-cms');
    // Every data-cms* attribute is excised from the output so it never ships.
    for (const a of node.attrs || []) {
      if (a.name.startsWith('data-cms')) {
        const r = attrFullRange(src, node, a.name);
        if (r) cuts.push({ start: r[0], end: r[1], excise: true });
      }
    }
    if (!cms) continue;

    const raw = cms.value; // "key" or "key@attr"
    const at = raw.indexOf('@');
    const key = at >= 0 ? raw.slice(0, at) : raw;
    const attr = at >= 0 ? raw.slice(at + 1) : null;
    const kind = attrOf(node, 'data-cms-kind')?.value || (attr ? 'text' : 'inline');
    const group = attrOf(node, 'data-cms-group')?.value || sectionGroup(node);
    const label = attrOf(node, 'data-cms-label')?.value || key;

    const r = attr ? attrValueRange(src, node, attr) : innerRange(node);
    if (!r) { demoted.push({ key, reason: 'no source range' }); continue; }
    addHole(r[0], r[1], key, kind, group, label);
  }

  // 4) Punch holes into the BUILD:SEO region for the fields the SEO manager edits,
  //    so a page-level canonical / robots / OG / keywords edit actually renders —
  //    while an UN-edited page still emits the exact original bytes (the hole's
  //    default IS the original value). robots is a COMPUTED hole (tri-state), so it
  //    gets the sentinel key __robots__ and the renderer derives its content.
  const seoRange = seoRegionRange(src);
  const seoRegion = seoRange ? src.slice(seoRange[0], seoRange[1]) : '';
  if (seoRange) punchSeoHoles(src, seoRange[0], seoRegion, cuts, slots);

  // Build the chunk stream by slicing the source between cut points.
  cuts.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i].start < cuts[i - 1].end) {
      throw new Error(
        `${file}: overlapping annotations at offset ${cuts[i].start} — a data-cms slot may not nest inside another.`,
      );
    }
  }

  const chunks = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start > cursor) chunks.push(src.slice(cursor, cut.start));
    if (cut.hole) chunks.push(cut.hole);
    // excise: emit nothing
    cursor = cut.end;
  }
  if (cursor < src.length) chunks.push(src.slice(cursor));

  return {
    // `file` stays the BASENAME in both languages, because canonicalFor(),
    // KEYWORDS and SERVICE_PAGES are all keyed by it — a French template must
    // resolve to the same service page, just at a different URL. `locale` is what
    // distinguishes them, and COMPILED_PAGES keys the French one "fr/<file>".
    file,
    locale,
    path: pathFor(file, locale),
    kind: kindFor(file),
    compiledAt: fmtDate(fs.statSync(path.join(dir, file)).mtime),
    chunks,
    slots,
    seoRegion,
    demoted,
  };
}

/* Punch holes into the generated BUILD:SEO region. The region is machine-emitted
 * by seoHtml(), so its shape is predictable — we match each tag and slice its
 * attribute value. Holes are added to `cuts` (they render) but NOT to `slots` (they
 * aren't shown as content-form fields; the SEO manager edits them). */
function punchSeoHoles(src, regionStart, region, cuts, slots) {
  const add = (relStart, relEnd, key) => {
    cuts.push({ start: regionStart + relStart, end: regionStart + relEnd, hole: { h: key, kind: 'text', def: region.slice(relStart, relEnd) } });
  };
  // Each entry: a regex whose group 1 is the attribute value, and the hole key.
  const patterns = [
    [/<link rel="canonical" href="([^"]*)"/, 'seo.canonicalUrl'],
    [/<meta name="robots" content="([^"]*)"/, '__robots__'],
    [/<meta name="keywords" content="([^"]*)"/, 'seo.keywords'],
    [/<meta property="og:title" content="([^"]*)"/, 'seo.ogTitle'],
    [/<meta property="og:description" content="([^"]*)"/, 'seo.ogDescription'],
    [/<meta property="og:image" content="([^"]*)"/, 'seo.ogImage'],
    [/<meta name="twitter:title" content="([^"]*)"/, 'seo.ogTitle'],
    [/<meta name="twitter:description" content="([^"]*)"/, 'seo.ogDescription'],
    [/<meta name="twitter:image" content="([^"]*)"/, 'seo.ogImage'],
  ];
  for (const [re, key] of patterns) {
    const m = re.exec(region);
    if (!m) continue;
    // m[0] ends with `VALUE"` — so the value ends one char before m[0]'s end, and
    // starts len(VALUE) before that. Robust regardless of the attribute name.
    const valEnd = m.index + m[0].length - 1;
    const valStart = valEnd - m[1].length;
    add(valStart, valEnd, key);
  }
}

/** A human-facing section group for the admin form, derived from an enclosing
 *  [data-cms-section] ancestor's label, else "Content". */
function sectionGroup(node) {
  let p = node.parentNode;
  while (p) {
    const s = attrOf(p, 'data-cms-section');
    if (s) return attrOf(p, 'data-cms-label')?.value || s.value;
    p = p.parentNode;
  }
  return 'Content';
}

const fmtDate = (d) => d.toISOString().slice(0, 10);

// ---- Run -------------------------------------------------------------------
function serializeChunks(chunks) {
  // Emit a compact but valid JS array literal. Strings via JSON.stringify (handles
  // </script>, quotes, newlines); holes as object literals.
  const parts = chunks.map((c) =>
    typeof c === 'string' ? JSON.stringify(c) : JSON.stringify(c),
  );
  return '[' + parts.join(',') + ']';
}

/** Compile all pages in memory (no file writes). Used by the currency test. */
export function compileAll() {
  const out = {};
  for (const file of PAGE_FILES) {
    const src = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
    out[file] = compilePage(file, src);
  }
  for (const file of FR_FILES) {
    const src = fs.readFileSync(path.join(FR_DIR, file), 'utf8');
    out['fr/' + file] = compilePage(file, src, { locale: 'fr', dir: FR_DIR });
  }
  return out;
}

/* The FRENCH self-check reference.
 *
 * English has a hand-frozen fixture: the exact bytes Vercel serves today, which is
 * what makes "the cutover is a no-op" provable. French has no such history, so the
 * property to prove is the other half of what the English fixture proves — that
 * THE COMPILER ROUND-TRIPS ITS SOURCE: renderPage(tpl, null) reproduces
 * pages/fr/<file> exactly, minus the data-cms annotations it exists to excise.
 *
 * The reference is derived by REGEX where the compiler uses parse5 source offsets,
 * so the two are independent implementations of "strip the annotations" and a bug
 * in either shows up as a diff.
 *
 * NOT DERIVED FROM THE ENGLISH FIXTURE, and the reason is worth recording: the
 * annotations CHANGE UNIT BOUNDARIES. In the annotated source a FAQ question is
 * its own data-cms element, so the unit is the question text; in the annotation-
 * free fixture the whole .faq-q (question span + "+" toggle span) is one leaf
 * unit, a different dictionary key. Translating the fixture therefore produces
 * legitimately different bytes, and a check built on it fails on correct output.
 */
function frReference(file) {
  const src = fs.readFileSync(path.join(FR_DIR, file), 'utf8');
  // Mirrors attrFullRange()'s single-leading-whitespace swallow in the compiler.
  return src.replace(/\s?data-cms[a-z-]*="[^"]*"/g, '');
}

function generate() {
  const out = compileAll();
  const report = Object.values(out).map((tpl) => ({
    file: tpl.file, holes: tpl.slots.length, demoted: tpl.demoted.length,
  }));

  // ---- SELF-CHECK: render with no overrides MUST equal the frozen fixture ----
  for (const file of PAGE_FILES) {
    const fixture = fs.readFileSync(path.join(FIXTURES_DIR, file.replace('.html', '.expected.html')), 'utf8');
    const rendered = renderPage(out[file], null);
    if (rendered !== fixture) {
      const at = firstDiff(rendered, fixture);
      throw new Error(
        `${file}: renderPage(tpl, {}) is NOT byte-identical to the fixture (first diff at offset ${at}).\n` +
          `  rendered: …${JSON.stringify(rendered.slice(Math.max(0, at - 40), at + 40))}…\n` +
          `  fixture : …${JSON.stringify(fixture.slice(Math.max(0, at - 40), at + 40))}…`,
      );
    }
    if (out[file].demoted.length) {
      throw new Error(`${file}: ${out[file].demoted.length} slot(s) were demoted — fix the annotation:\n` +
        out[file].demoted.map((d) => `    ${d.key}: ${d.reason}`).join('\n'));
    }
  }

  // ---- The same proof for French, against the independently-derived reference ----
  for (const file of FR_FILES) {
    const key = 'fr/' + file;
    const rendered = renderPage(out[key], null);
    const reference = frReference(file);
    if (rendered !== reference) {
      const at = firstDiff(rendered, reference);
      throw new Error(
        `${key}: renderPage(tpl, null) does not reproduce pages/fr/${file} at offset ${at}.\n` +
          `  The compiler is not round-tripping the French source. Re-run \`npm run site\`.\n` +
          `  compiled : …${JSON.stringify(rendered.slice(Math.max(0, at - 40), at + 40))}…\n` +
          `  reference: …${JSON.stringify(reference.slice(Math.max(0, at - 40), at + 40))}…`,
      );
    }
    if (out[key].demoted.length) {
      throw new Error(`${key}: ${out[key].demoted.length} slot(s) were demoted — fix the annotation:\n` +
        out[key].demoted.map((d) => `    ${d.key}: ${d.reason}`).join('\n'));
    }
  }

  // ---- Emit the committed module ----
  const body = Object.entries(out)
    .map(([key, tpl]) => {
      // Keyed by the MAP KEY ("seo.html" / "fr/seo.html"), never by tpl.file — the
      // French template deliberately keeps the English basename, so keying by it
      // would emit both under "seo.html" and the second would silently win.
      const meta = { file: tpl.file, locale: tpl.locale, path: tpl.path, kind: tpl.kind, compiledAt: tpl.compiledAt };
      return (
        `  ${JSON.stringify(key)}: {\n` +
        `    ...${JSON.stringify(meta)},\n` +
        `    chunks: ${serializeChunks(tpl.chunks)},\n` +
        `    slots: ${JSON.stringify(tpl.slots)},\n` +
        `    seoRegion: ${JSON.stringify(tpl.seoRegion)},\n` +
        `  }`
      );
    })
    .join(',\n');

  const header =
    `/* AUTO-GENERATED by scripts/compile-pages.js — do not edit by hand.\n` +
    ` * The compiled marketing pages: literal source chunks + typed holes.\n` +
    ` * renderPage(tpl, null) is byte-identical to scripts/fixtures/pages/*.expected.html.\n` +
    ` * Regenerate with \`npm run site\` and COMMIT the result. */\n`;

  fs.writeFileSync(
    path.join(ROOT, 'lib', 'compiled-pages.gen.js'),
    `${header}export const COMPILED_PAGES = {\n${body},\n};\n`,
  );

  return report;
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

// Allow importing the compiler in a test without running it.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('compile-pages.js')) {
  const report = generate();
  for (const r of report) console.log(`  ✓ ${r.file} — ${r.holes} editable slot(s)${r.demoted ? `, ${r.demoted} demoted` : ''}`);
  console.log(`  ✓ lib/compiled-pages.gen.js (${report.length} pages, byte-identical to fixtures)`);
}

// compileAll and PAGE_FILES are exported inline at their definitions.
export { compilePage, generate };
