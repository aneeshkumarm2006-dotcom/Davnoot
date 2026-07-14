#!/usr/bin/env node
/* Davnoot static-site builder — bakes nav, footer, and the SEO head into every page.
 *
 *   node build.js      (or: npm run site)
 *
 * Each .html file has three idempotent regions marked by HTML comments:
 *   <!-- BUILD:SEO -->...<!-- /BUILD:SEO -->      (canonical, OG/Twitter, JSON-LD, favicon)
 *   <!-- BUILD:NAV -->...<!-- /BUILD:NAV -->       (site nav)
 *   <!-- BUILD:FOOTER -->...<!-- /BUILD:FOOTER -->  (site footer)
 *
 * The templates themselves now live in lib/templates.js, which the blog's
 * server-rendered pages import too — so the marketing site and the blog share
 * one nav, one footer, and one Organization schema node. Edit lib/templates.js,
 * run `node build.js`, and every static page is rebuilt in place.
 *
 * Output is fully static HTML — crawlable by Google AND non-JS AI bots (GPTBot, etc.).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ORG_DESC, SERVICE_PAGES, canonicalFor, navHtml, footerHtml, seoHtml, toPlainText } from './lib/templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Helpers ---------------------------------------------------------------
const fmtDate = (d) => d.toISOString().slice(0, 10); // -> YYYY-MM-DD
const TODAY = fmtDate(new Date());

// Extract the on-page FAQ accordion (.faq-item → .faq-q / .faq-a) so we can emit
// FAQPage JSON-LD that stays in sync with the visible copy. The question is the
// first <span> inside .faq-q (the second span is the "+" toggle).
//
// ATTRIBUTE TOLERANCE IS LOAD-BEARING. The CMS annotates the FAQ copy with
// data-cms attributes in pages/*.html, so the tags arrive here as
// `<div class="faq-a" data-cms="faq.0.a" …>` and `<span data-cms="faq.0.q" …>`.
// The original regexes required a LITERAL `<span>` and a literal `<div class="faq-a">`,
// so the moment a page was annotated they matched nothing, extractFaq() returned [],
// and the FAQPage JSON-LD silently VANISHED from that page's BUILD:SEO region —
// losing its FAQ rich result with no error anywhere. `[^>]*` fixes that.
//
// The non-greedy `</div>` / `</span>` semantics are deliberately UNCHANGED: the
// compiled seoRegion (and therefore every frozen fixture) is a byte-for-byte
// function of this output, so "improving" the parsing here would rewrite the
// JSON-LD on 8 live pages. Any change to what this RETURNS must be a conscious,
// fixture-updating act. See scripts/pages-golden.test.js.
function extractFaq(html) {
  const questions = [];
  const answers = [];
  let m;
  const qre = /<div class="faq-q"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/g;
  while ((m = qre.exec(html))) questions.push(toPlainText(m[1]));
  const are = /<div class="faq-a"[^>]*>([\s\S]*?)<\/div>/g;
  while ((m = are.exec(html))) answers.push(toPlainText(m[1]));
  const n = Math.min(questions.length, answers.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (questions[i] && answers[i]) out.push({ q: questions[i], a: answers[i] });
  }
  return out;
}

// Per-page sitemap weighting. Home ranks highest; the booking page slightly lower
// than the service pages. Anything new defaults to a sensible service-tier weight.
function sitemapMeta(file) {
  if (file === 'index.html') return { priority: '1.0', changefreq: 'weekly' };
  if (file === 'book-call.html') return { priority: '0.7', changefreq: 'monthly' };
  return { priority: '0.8', changefreq: 'monthly' };
}

function fill(html, region, body) {
  const re = new RegExp('<!-- BUILD:' + region + ' -->[\\s\\S]*?<!-- /BUILD:' + region + ' -->');
  const replacement = `<!-- BUILD:${region} -->\n${body}\n<!-- /BUILD:${region} -->`;
  if (!re.test(html)) {
    console.warn(`  ! no BUILD:${region} markers found — skipped`);
    return html;
  }
  // Use a function replacer so `$` sequences in the body (e.g. "$$" priceRange,
  // "$5" in a FAQ answer) are inserted literally rather than treated as
  // String.replace() special patterns.
  return html.replace(re, () => replacement);
}

/* Emit the STATIC half of the sitemap as a JSON manifest.
 *
 * WHY A MANIFEST AND NOT sitemap.xml
 * ----------------------------------
 * /sitemap.xml is now served by api/sitemap.js, which merges these static pages
 * with the published blog posts from MongoDB. Vercel `rewrites` only fire when
 * NO static file matches the path — so if this script still wrote a real
 * sitemap.xml to disk, that file would shadow the rewrite and the blog posts
 * would never appear in the sitemap. Hence: a manifest the function imports,
 * not an XML file the CDN would serve instead.
 *
 * WHAT IS *NOT* IN HERE ANY MORE
 * ------------------------------
 * The 8 CMS-managed marketing pages (the ones that exist under pages/) are NO
 * LONGER listed here. api/sitemap.js now sources them from COMPILED_PAGES — a
 * plain ESM import that cannot fail — overlaid with each page's Mongo `sitemap`
 * settings. Listing them in both places would emit every marketing URL TWICE.
 *
 * This manifest is therefore exactly "the static pages that are NOT CMS-managed"
 * — today: ai-seo-agency.html and ai-seo-montreal.html. They are ordinary root
 * .html files with no pages/ counterpart, and if we simply pointed this script at
 * pages/ they would have dropped out of the sitemap silently.
 *
 * Ordering (home, then service pages, then the rest) is preserved so the final XML
 * still mirrors site priority.
 */
function buildStaticManifest(files, lastmod) {
  const order = ['index.html', ...SERVICE_PAGES];
  const rest = files.filter((f) => !order.includes(f)).sort();
  const ordered = [...order.filter((f) => files.includes(f)), ...rest];

  return ordered.map((file) => ({
    loc: canonicalFor(file),
    lastmod: lastmod[file],
    ...sitemapMeta(file),
  }));
}

// ---- Run -------------------------------------------------------------------
// Google Search Console verification files (googleXXXX.html) are served as-is —
// they carry no BUILD markers and must stay out of the sitemap.
const isVerificationFile = (f) => /^google[0-9a-f]+\.html$/i.test(f);
const htmlIn = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !isVerificationFile(f)) : [];

const PAGES_DIR = path.join(__dirname, 'pages');

/* The CMS-managed pages: the annotated design source under pages/. These are the
 * source of truth for the 8 marketing pages and are compiled into
 * lib/compiled-pages.gen.js by scripts/compile-pages.js (which runs right after
 * this script — `npm run site` is `node build.js && node scripts/compile-pages.js`). */
const cmsFiles = htmlIn(PAGES_DIR);

/* The root .html files. PRE-CUTOVER, the 8 marketing pages exist in BOTH places:
 * the root copy is what Vercel actually serves today (a static file shadows its own
 * rewrite), and the pages/ copy is the annotated source. We must bake the chrome
 * into BOTH, or they drift — and the drift would only surface at cutover, as a
 * diff on a live revenue page. scripts/pages-golden.test.js pins root === fixture
 * precisely so this can never rot silently.
 *
 * POST-CUTOVER the root copies are gone, this list shrinks to the non-CMS pages,
 * and nothing else here changes. */
const rootFiles = htmlIn(__dirname);
const rootOnly = rootFiles.filter((f) => !cmsFiles.includes(f)); // the sitemap manifest's job

// Build every target: the CMS source AND (while they still exist) the root copies.
const targets = [
  ...cmsFiles.map((file) => ({ file, dir: PAGES_DIR, label: `pages/${file}` })),
  ...rootFiles.map((file) => ({ file, dir: __dirname, label: file })),
];

const lastmod = {}; // file -> YYYY-MM-DD, collected for the sitemap
let built = 0;
for (const { file, dir, label } of targets) {
  const p = path.join(dir, file);
  const original = fs.readFileSync(p, 'utf8');
  const title = (original.match(/<title>([\s\S]*?)<\/title>/) || [, file])[1].trim();
  const descM = original.match(/<meta\s+name="description"\s+content="([\s\S]*?)"\s*\/?>/i);
  const desc = descM ? descM[1].trim() : ORG_DESC;
  const faqs = extractFaq(original);

  // Every template keys off the BASENAME (canonicalFor, KEYWORDS, SERVICE_PAGES),
  // so pages/seo.html and ./seo.html bake byte-identical chrome. That identity is
  // what makes the cutover a no-op.
  let html = fill(original, 'SEO', seoHtml(file, title, desc, faqs));
  html = fill(html, 'NAV', navHtml(file));
  html = fill(html, 'FOOTER', footerHtml(file));

  if (html !== original) {
    fs.writeFileSync(p, html);
    lastmod[file] = TODAY; // content changed on this build
    console.log(`  ✓ ${label}`);
    built++;
  } else {
    // Unchanged — keep its real edit date. When a page exists in both places, the
    // pages/ copy is authoritative and is visited first, so the root copy's mtime
    // never overwrites it with a later date.
    if (lastmod[file] === undefined) lastmod[file] = fmtDate(fs.statSync(p).mtime);
    console.log(`  · ${label} (unchanged)`);
  }
}

// ---- Sitemap manifest (merged with the blog posts by api/sitemap.js) --------
// Emitted as a .js MODULE, not .json, on purpose: a plain ESM export is always
// picked up by Vercel's serverless file tracing, whereas a JSON import relies on
// import attributes (`with { type: 'json' }`) and on the tracer following them.
// A sitemap that 500s in production because a JSON file wasn't bundled is a very
// annoying way to find that out.
const manifest = buildStaticManifest(rootOnly, lastmod);
fs.writeFileSync(
  path.join(__dirname, 'lib', 'sitemap-static.js'),
  `/* AUTO-GENERATED by build.js — do not edit by hand.\n` +
    ` * The NON-CMS static pages of /sitemap.xml — i.e. root .html files that have no\n` +
    ` * counterpart under pages/ and are therefore not in COMPILED_PAGES.\n` +
    ` *\n` +
    ` * api/sitemap.js merges three sources: the CMS marketing pages (from\n` +
    ` * COMPILED_PAGES + their Mongo sitemap settings), THESE static pages, and the\n` +
    ` * published blog posts from MongoDB. A page listed here AND in COMPILED_PAGES\n` +
    ` * would appear in the sitemap twice, so build.js excludes the CMS pages.\n */\n` +
    `export const STATIC_URLS = ${JSON.stringify(manifest, null, 2)};\n`,
);
console.log(`  ✓ lib/sitemap-static.js (${manifest.length} non-CMS static URL(s); the ${cmsFiles.length} CMS pages come from COMPILED_PAGES)`);

// The old on-disk sitemap.xml would SHADOW the /sitemap.xml rewrite (Vercel only
// rewrites when no static file matches), so the blog would silently never make it
// into the sitemap. Remove it if it's still lying around from a previous build.
const staleSitemap = path.join(__dirname, 'sitemap.xml');
if (fs.existsSync(staleSitemap)) {
  fs.unlinkSync(staleSitemap);
  console.log('  ✓ removed stale sitemap.xml (now served by api/sitemap.js)');
}

console.log(`\nBuilt ${built} page(s) + sitemap manifest. Static HTML — nav, footer & SEO baked in.`);
