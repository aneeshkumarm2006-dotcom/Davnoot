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
function extractFaq(html) {
  const questions = [];
  const answers = [];
  let m;
  const qre = /<div class="faq-q">\s*<span>([\s\S]*?)<\/span>/g;
  while ((m = qre.exec(html))) questions.push(toPlainText(m[1]));
  const are = /<div class="faq-a">([\s\S]*?)<\/div>/g;
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
 * Ordering (home, then service pages, then the rest) is preserved here so the
 * final XML still mirrors site priority.
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
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.html') && !isVerificationFile(f));
const lastmod = {}; // file -> YYYY-MM-DD, collected for the sitemap
let built = 0;
for (const file of files) {
  const p = path.join(__dirname, file);
  const original = fs.readFileSync(p, 'utf8');
  const title = (original.match(/<title>([\s\S]*?)<\/title>/) || [, file])[1].trim();
  const descM = original.match(/<meta\s+name="description"\s+content="([\s\S]*?)"\s*\/?>/i);
  const desc = descM ? descM[1].trim() : ORG_DESC;
  const faqs = extractFaq(original);

  let html = fill(original, 'SEO', seoHtml(file, title, desc, faqs));
  html = fill(html, 'NAV', navHtml(file));
  html = fill(html, 'FOOTER', footerHtml(file));

  if (html !== original) {
    fs.writeFileSync(p, html);
    lastmod[file] = TODAY; // content changed on this build
    console.log(`  ✓ ${file}`);
    built++;
  } else {
    lastmod[file] = fmtDate(fs.statSync(p).mtime); // unchanged — keep its real edit date
    console.log(`  · ${file} (unchanged)`);
  }
}

// ---- Sitemap manifest (merged with the blog posts by api/sitemap.js) --------
// Emitted as a .js MODULE, not .json, on purpose: a plain ESM export is always
// picked up by Vercel's serverless file tracing, whereas a JSON import relies on
// import attributes (`with { type: 'json' }`) and on the tracer following them.
// A sitemap that 500s in production because a JSON file wasn't bundled is a very
// annoying way to find that out.
const manifest = buildStaticManifest(files, lastmod);
fs.writeFileSync(
  path.join(__dirname, 'lib', 'sitemap-static.js'),
  `/* AUTO-GENERATED by build.js — do not edit by hand.\n` +
    ` * The static half of /sitemap.xml. api/sitemap.js merges this with the\n` +
    ` * published blog posts from MongoDB at request time.\n */\n` +
    `export const STATIC_URLS = ${JSON.stringify(manifest, null, 2)};\n`,
);
console.log(`  ✓ lib/sitemap-static.js (${manifest.length} static URLs)`);

// The old on-disk sitemap.xml would SHADOW the /sitemap.xml rewrite (Vercel only
// rewrites when no static file matches), so the blog would silently never make it
// into the sitemap. Remove it if it's still lying around from a previous build.
const staleSitemap = path.join(__dirname, 'sitemap.xml');
if (fs.existsSync(staleSitemap)) {
  fs.unlinkSync(staleSitemap);
  console.log('  ✓ removed stale sitemap.xml (now served by api/sitemap.js)');
}

console.log(`\nBuilt ${built} page(s) + sitemap manifest. Static HTML — nav, footer & SEO baked in.`);
