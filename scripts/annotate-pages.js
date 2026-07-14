#!/usr/bin/env node
/* Annotate the marketing pages for the CMS — deterministically, in place.
 *
 *   node scripts/annotate-pages.js            # annotate pages/*.html
 *   node scripts/annotate-pages.js --check    # report coverage, write nothing
 *
 * ===========================================================================
 * WHY A CODEMOD AND NOT HAND-EDITING
 * ===========================================================================
 * The 8 pages are ~93% structurally identical. Hand-adding ~200 data-cms
 * attributes across them is exactly the kind of repetitive edit that goes wrong
 * on page 6: a typo'd key, a missed <em>, an attribute dropped inside a BUILD
 * region. This codemod adds the attributes from a small, reviewable RULE TABLE,
 * using parse5 to find the elements and OFFSET-INSERTING the attributes into the
 * source string — never re-serializing (the pages use XHTML void tags, and a
 * parse->serialize round trip would rewrite <br /> to <br> and break byte
 * identity). It is the same discipline scripts/compile-pages.js uses to read.
 *
 * SAFETY: it is idempotent (skips any element that already carries data-cms),
 * never annotates inside BUILD:NAV/FOOTER/SEO (build.js regenerates those and
 * would wipe the attributes), and only ever ADDS attributes — it moves, deletes
 * or reformats nothing. And the real backstop is downstream: after this runs,
 * `node scripts/compile-pages.js` self-verifies that renderPage(tpl, null) is
 * byte-identical to the frozen fixture and THROWS on any demoted slot. So the
 * worst this codemod can do is fail the build — never ship a broken page.
 * ===========================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, '..', 'pages');

const CHECK = process.argv.includes('--check');

/* ---- The rule table -------------------------------------------------------
 * `kind`: inline = accent typography allowed (<em>/<br />/<strong>); text = plain
 * string. Nearly all marketing copy is inline because <em> is load-bearing on
 * this site (script.js's splitWords has an <em> branch and styles.css styles it).
 */

// A section's body container class -> its stable id + admin label. The header
// fields (eyebrow/title/sub) of a section inherit this id, so keys read
// "capabilities.title", "faq.3.q", etc.
const SECTION_GRIDS = {
  'cap-grid': { id: 'capabilities', label: 'Capabilities' },
  'deliv-layout': { id: 'deliverables', label: "What's included" },
  'approach-list': { id: 'approach', label: 'Approach' },
  'compare-grid': { id: 'compare', label: 'Comparison' },
  'case-spotlight': { id: 'caseStudy', label: 'Case study' },
  't-grid': { id: 'testimonials', label: 'Testimonials' },
  'tier-grid': { id: 'pricing', label: 'Pricing' },
  'faq-list': { id: 'faq', label: 'FAQ' },
};

// Header leaves present in (almost) every section, keyed <sectionId>.<field>.
const HEADER_LEAVES = [
  { cls: 'section-eyebrow', field: 'eyebrow', kind: 'inline' },
  { cls: 'section-title', field: 'title', kind: 'inline' },
  { cls: 'section-sub', field: 'sub', kind: 'inline' },
];

// Repeating item rules, keyed by the resolved section id.
const ITEM_RULES = {
  capabilities: { item: 'cap-card', fields: [['cap-title', 'title', 'inline'], ['cap-desc', 'desc', 'inline']] },
  deliverables: { item: 'deliv-item', fields: [['deliv-title', 'title', 'inline'], ['deliv-desc', 'desc', 'inline'], ['deliv-freq', 'freq', 'text']] },
  approach: { item: 'approach-step', fields: [['approach-step-label', 'label', 'inline'], ['approach-step-title', 'title', 'inline'], ['approach-step-desc', 'desc', 'inline']] },
  testimonials: { item: 't-card', fields: [['t-card-quote', 'quote', 'inline'], ['t-card-name', 'name', 'text'], ['t-card-role', 'role', 'text']] },
  pricing: { item: 'tier-card', fields: [['tier-name', 'name', 'inline'], ['tier-tagline', 'tagline', 'inline']] },
  faq: { item: 'faq-item', fields: [['@faq-q', 'q', 'inline'], ['faq-a', 'a', 'inline']] }, // @faq-q = first span in .faq-q
};

// The hero (a <header class="service-hero">) — its own leaf map.
const HERO_LEAVES = [
  { cls: 'service-num-badge', key: 'hero.badge', kind: 'inline' },
  { cls: 'service-hero-title', key: 'hero.title', kind: 'inline' },
  { cls: 'service-hero-sub', key: 'hero.sub', kind: 'inline' },
];

// The final CTA (a <section class="final-cta">).
const CTA_LEAVES = [
  { cls: 'final-cta-eyebrow', key: 'cta.eyebrow', kind: 'inline' },
  { cls: 'final-cta-title', key: 'cta.title', kind: 'inline' },
  { cls: 'final-cta-sub', key: 'cta.sub', kind: 'inline' },
];

/* ---- parse5 helpers (read-only; never serialize) -------------------------- */
const attrOf = (node, name) => (node.attrs || []).find((a) => a.name === name);
const classes = (node) => (attrOf(node, 'class')?.value || '').split(/\s+/).filter(Boolean);
const hasClass = (node, c) => classes(node).includes(c);
const isEl = (node) => typeof node.tagName === 'string';

function* walk(node) {
  yield node;
  for (const child of node.childNodes || []) yield* walk(child);
}
function children(node) {
  return (node.childNodes || []).filter(isEl);
}
/** First descendant element (depth-first) matching a predicate. */
function findDesc(node, pred) {
  for (const n of walk(node)) if (n !== node && isEl(n) && pred(n)) return n;
  return null;
}
/** All descendant elements matching a predicate. */
function allDesc(node, pred) {
  const out = [];
  for (const n of walk(node)) if (n !== node && isEl(n) && pred(n)) out.push(n);
  return out;
}
const alreadyAnnotated = (node) => (node.attrs || []).some((a) => a.name.startsWith('data-cms'));

/* ---- The BUILD regions we must never annotate inside ---------------------- */
function buildRegions(src) {
  const ranges = [];
  for (const region of ['NAV', 'FOOTER', 'SEO']) {
    const open = src.indexOf(`<!-- BUILD:${region} -->`);
    const close = src.indexOf(`<!-- /BUILD:${region} -->`);
    if (open >= 0 && close >= 0) ranges.push([open, close + `<!-- /BUILD:${region} -->`.length]);
  }
  return ranges;
}
const inRanges = (offset, ranges) => ranges.some(([a, b]) => offset >= a && offset < b);

/* ---- Insertion planning ---------------------------------------------------
 * We collect { offset, text } insertions and splice them into the source in
 * DESCENDING offset order, so earlier offsets are never shifted by later inserts.
 */
function insertionFor(node, attrString, src) {
  const st = node.sourceCodeLocation?.startTag;
  if (!st) return null; // no start tag (void element parsed without one) — skip
  // APPEND at the END of the start tag, so every existing attribute keeps its
  // position. This is not cosmetic:
  //   1. It keeps `class="..."` in first position, which build.js's extractFaq()
  //      anchors on (`<div class="faq-a"`). Inserting after the tag name instead
  //      would push class out of first place and silently drop FAQPage JSON-LD.
  //   2. It matches the convention of the annotations already in seo.html
  //      (`class="service-num-badge" data-cms="hero.badge"` — data-cms last).
  const tag = src.slice(st.startOffset, st.endOffset); // e.g. `<div class="faq-a">`
  let rel = tag.length - 1; // the final '>'
  // If self-closing (`<img … />`), insert before the slash (and any space run).
  let j = rel - 1;
  while (j >= 0 && /\s/.test(tag[j])) j--;
  if (tag[j] === '/') rel = j;
  return { offset: st.startOffset + rel, text: attrString };
}

function attrString({ key, kind, attr }) {
  const raw = attr ? `${key}@${attr}` : key;
  let s = ` data-cms="${raw}"`;
  // Only emit data-cms-kind when it differs from the compiler's default for the
  // target shape (inline for inner-text holes, text for attribute holes), to keep
  // the diff minimal. The compiler: kind = data-cms-kind || (attr ? 'text' : 'inline').
  const defaultKind = attr ? 'text' : 'inline';
  if (kind && kind !== defaultKind) s += ` data-cms-kind="${kind}"`;
  return s;
}
function sectionAttr(id, label) {
  return ` data-cms-section="${id}" data-cms-label="${label.replace(/"/g, '&quot;')}"`;
}

/* ---- Annotate one page ---------------------------------------------------- */
function annotate(file, src) {
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const regions = buildRegions(src);
  const inserts = [];
  const report = { file, added: 0, sections: 0, skipped: [] };
  const usedKeys = new Set();

  // Pre-seed used keys with any annotations the page ALREADY has (idempotency +
  // uniqueness across a re-run). seo.html ships with hero.badge/title/sub.
  for (const n of walk(doc)) {
    if (!isEl(n)) continue;
    const v = attrOf(n, 'data-cms')?.value;
    if (v) usedKeys.add(v.split('@')[0]);
  }

  const plan = (node, spec) => {
    if (!isEl(node) || alreadyAnnotated(node)) return false;
    const off = node.sourceCodeLocation?.startTag?.startOffset;
    if (off == null || inRanges(off, regions)) return false;
    const baseKey = spec.attr ? spec.key : spec.key;
    if (usedKeys.has(baseKey)) return false; // never emit a duplicate key
    const ins = insertionFor(node, attrString(spec), src);
    if (!ins) return false;
    inserts.push(ins);
    usedKeys.add(baseKey);
    report.added++;
    return true;
  };

  const planSection = (node, id, label) => {
    if (!isEl(node) || alreadyAnnotated(node)) return;
    const off = node.sourceCodeLocation?.startTag?.startOffset;
    if (off == null || inRanges(off, regions)) return;
    inserts.push(insertionFor(node, sectionAttr(id, label), src));
    report.sections++;
  };

  // Top-level content blocks: <header class="service-hero"> and every <section>.
  const body = findDesc(doc, (n) => n.tagName === 'body');
  if (!body) throw new Error(`${file}: no <body>`);

  let ordinal = 0;
  for (const block of walk(body)) {
    if (!isEl(block)) continue;
    const isHero = block.tagName === 'header' && hasClass(block, 'service-hero');
    const isCta = block.tagName === 'section' && hasClass(block, 'final-cta');
    const isSection = block.tagName === 'section' && !isCta;
    if (!isHero && !isCta && !isSection) continue;

    // ---- Hero ----
    if (isHero) {
      planSection(block, 'hero', 'Hero');
      for (const leaf of HERO_LEAVES) {
        const el = findDesc(block, (n) => hasClass(n, leaf.cls));
        if (el) plan(el, { key: leaf.key, kind: leaf.kind });
      }
      continue;
    }

    // ---- Final CTA ----
    if (isCta) {
      planSection(block, 'cta', 'Final CTA');
      for (const leaf of CTA_LEAVES) {
        const el = findDesc(block, (n) => hasClass(n, leaf.cls));
        if (el) plan(el, { key: leaf.key, kind: leaf.kind });
      }
      continue;
    }

    // ---- A content <section>: resolve its id from a known body grid class ----
    ordinal++;
    let resolved = null;
    for (const [gridCls, meta] of Object.entries(SECTION_GRIDS)) {
      if (findDesc(block, (n) => hasClass(n, gridCls))) { resolved = meta; break; }
    }
    const sec = resolved || { id: `section${ordinal}`, label: `Section ${ordinal}` };
    planSection(block, sec.id, sec.label);

    // Header leaves (eyebrow/title/sub), keyed <sectionId>.<field>. Take the FIRST
    // of each within the section that isn't inside a repeating item.
    const itemRule = ITEM_RULES[sec.id];
    const itemClass = itemRule?.item;
    const insideItem = (n) => itemClass && ancestorHasClass(n, block, itemClass);
    for (const h of HEADER_LEAVES) {
      const el = findDesc(block, (n) => hasClass(n, h.cls) && !insideItem(n));
      if (el) plan(el, { key: `${sec.id}.${h.field}`, kind: h.kind });
    }

    // Repeating items.
    if (itemRule) {
      const items = topLevelItems(block, itemRule.item);
      items.forEach((item, i) => {
        for (const [cls, field, kind] of itemRule.fields) {
          const el = cls === '@faq-q'
            ? firstQuestionSpan(item)
            : findDesc(item, (n) => hasClass(n, cls));
          if (el) plan(el, { key: `${sec.id}.${i}.${field}`, kind });
        }
      });
    }
  }

  if (!inserts.length) return { src, report };

  // Splice descending so offsets stay valid.
  inserts.sort((a, b) => b.offset - a.offset);
  let out = src;
  for (const ins of inserts) out = out.slice(0, ins.offset) + ins.text + out.slice(ins.offset);
  return { src: out, report };
}

/** True if `node` has an ancestor (up to but excluding `stop`) with class `cls`. */
function ancestorHasClass(node, stop, cls) {
  let p = node.parentNode;
  while (p && p !== stop) {
    if (isEl(p) && hasClass(p, cls)) return true;
    p = p.parentNode;
  }
  return false;
}

/** Direct repeating items of class `cls` under `block` (dedup nested matches). */
function topLevelItems(block, cls) {
  const all = allDesc(block, (n) => hasClass(n, cls));
  // Keep only the outermost matches (an item never nests inside another item here,
  // but this is defensive against a class appearing twice in a hierarchy).
  return all.filter((n) => !all.some((m) => m !== n && contains(m, n)));
}
function contains(anc, node) {
  for (const n of walk(anc)) if (n === node && n !== anc) return true;
  return false;
}

/** The question <span> inside a .faq-item: first <span> child of .faq-q. */
function firstQuestionSpan(item) {
  const q = findDesc(item, (n) => hasClass(n, 'faq-q'));
  if (!q) return null;
  return children(q).find((n) => n.tagName === 'span' && !hasClass(n, 'faq-toggle')) || null;
}

/* ---- Run ------------------------------------------------------------------ */
const PAGE_FILES = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.html')).sort();
let totalAdded = 0;
let totalSections = 0;
for (const file of PAGE_FILES) {
  const p = path.join(PAGES_DIR, file);
  const src = fs.readFileSync(p, 'utf8');
  const { src: out, report } = annotate(file, src);
  totalAdded += report.added;
  totalSections += report.sections;
  if (!CHECK && out !== src) fs.writeFileSync(p, out);
  const verb = out !== src ? (CHECK ? 'would add' : 'added') : 'no change';
  console.log(`  ${out !== src ? '✓' : '·'} ${file} — ${verb} ${report.added} field(s) in ${report.sections} section(s)`);
}
console.log(`\n${CHECK ? 'Would annotate' : 'Annotated'} ${totalAdded} field(s) across ${totalSections} section(s) in ${PAGE_FILES.length} page(s).`);
if (!CHECK) console.log('Next: `npm run site` (recompiles + reasserts byte-identity) then `npm test`.');

export { annotate };
