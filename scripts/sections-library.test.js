/* The section library — the palette a composed (base:null) /admin page is built from.
 *
 * The whole promise of composed pages is "no new CSS, no script.js change, no drift —
 * the library and the live site are the same bytes." These tests pin that:
 *   1. Every card/item class a renderer emits is one script.js animates (BOX_SELECTORS)
 *      — else the section renders visible but UN-animated next to its neighbours.
 *   2. Each renderer's CLASS STRUCTURE matches the corresponding real section on
 *      seo.html — so styles.css styles it. (Structural, not byte: a composed page has
 *      different copy than seo.html, but the class skeleton must be identical.)
 *   3. Field substitution is a clean, single-location swap (sentinel fuzz), and per
 *      kind (text escaped, inline passed through already-sanitized).
 *   4. A composed page renders one canonical / one robots / one title / valid JSON-LD.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';

import { SECTION_RENDERERS, SECTION_TYPES, renderSection } from '../lib/sections.gen.js';
import { renderComposedPage } from '../lib/composed-render.js';
import { SECTION_FIELDS } from '../lib/section-fields.gen.js';

const ROOT = path.join(import.meta.dirname, '..');
const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const seoFixture = fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'pages', 'seo.expected.html'), 'utf8');

/** Parse the BOX_SELECTORS array out of script.js (the classes it animates). */
const BOX_SELECTORS = new Set(
  (scriptJs.match(/const BOX_SELECTORS = \[([\s\S]*?)\]/)[1].match(/'\.([a-z-]+)'/g) || []).map((s) => s.slice(2, -1)),
);

/** All class names present in an HTML string. */
function classesIn(html) {
  const set = new Set();
  (function walk(n) {
    const cls = (n.attrs || []).find((a) => a.name === 'class')?.value;
    if (cls) cls.split(/\s+/).filter(Boolean).forEach((c) => set.add(c));
    for (const c of n.childNodes || []) walk(c);
  })(parse(html));
  return set;
}

// A representative section object per type, with two items where the type repeats.
const SAMPLES = {
  hero: { type: 'hero', fields: { badge: 'B', title: 'T', sub: 'S', ctaHref: 'book-call.html', ctaLabel: 'Go' } },
  capabilities: { type: 'capabilities', fields: { eyebrow: 'E', title: 'T', sub: 'S' }, items: [{ num: '01', title: 'A', desc: 'D' }, { num: '02', title: 'B', desc: 'D' }] },
  deliverables: { type: 'deliverables', fields: { eyebrow: 'E', title: 'T', sub: 'S', intro1: 'I', intro2: 'J' }, items: [{ title: 'A', desc: 'D', freq: 'M1' }] },
  approach: { type: 'approach', fields: { eyebrow: 'E', title: 'T', sub: 'S' }, items: [{ num: '01', label: 'L', title: 'A', desc: 'D' }] },
  tiers: { type: 'tiers', fields: { eyebrow: 'E', title: 'T', sub: 'S' }, items: [{ featured: true, name: 'N', tagline: 'G', for: 'F', timeline: 'T', includes: ['x', 'y'], ctaHref: 'book-call.html', ctaLabel: 'Buy' }] },
  testimonials: { type: 'testimonials', fields: { eyebrow: 'E', title: 'T', sub: 'S' }, items: [{ quote: 'Q', avatar: 'AB', name: 'N', role: 'R' }] },
  faq: { type: 'faq', fields: { eyebrow: 'E', title: 'T', sub: 'S' }, items: [{ q: 'Q?', a: 'A.' }] },
  finalCta: { type: 'finalCta', fields: { eyebrow: 'E', title: 'T', sub: 'S', ctaHref: 'book-call.html', ctaLabel: 'Go' } },
};

describe('every reusable section type is complete and self-consistent', () => {
  test('SECTION_TYPES, SECTION_RENDERERS and SECTION_FIELDS agree', () => {
    for (const type of SECTION_TYPES) {
      assert.equal(typeof SECTION_RENDERERS[type], 'function', `no renderer for ${type}`);
      assert.ok(SECTION_FIELDS[type], `no field schema for ${type}`);
      assert.ok(SAMPLES[type], `no test sample for ${type}`);
    }
  });
});

describe('animated card classes are all in script.js BOX_SELECTORS', () => {
  // The card/item classes that script.js reveals on scroll. If a renderer emits one
  // that script.js does not animate, the section is visible-but-dead.
  const ANIMATED = { capabilities: 'cap-card', approach: 'approach-step', tiers: 'tier-card', testimonials: 't-card', faq: 'faq-item', deliverables: 'deliv-item' };
  for (const [type, cls] of Object.entries(ANIMATED)) {
    test(`${type} emits .${cls}, which script.js animates`, () => {
      assert.ok(classesIn(renderSection(SAMPLES[type])).has(cls), `${type} does not emit .${cls}`);
      assert.ok(BOX_SELECTORS.has(cls), `.${cls} is not in script.js BOX_SELECTORS — it would render un-animated`);
    });
  }
});

describe('each renderer matches the real section class structure on seo.html', () => {
  // Structural fidelity: every class the live section uses must appear in the library
  // renderer's output. (The reverse need not hold — the live section may carry extra
  // page-specific decoration — but a MISSING class means broken styling.)
  const LIVE_CONTAINERS = {
    capabilities: 'cap-grid', approach: 'approach-list', tiers: 'tier-grid',
    testimonials: 't-grid', faq: 'faq-list', deliverables: 'deliv-layout',
  };
  const REQUIRED = {
    capabilities: ['section-eyebrow', 'section-title', 'section-sub', 'cap-grid', 'cap-card', 'cap-num', 'cap-title', 'cap-desc'],
    approach: ['approach-list', 'approach-step', 'approach-step-num', 'approach-step-label', 'approach-step-title', 'approach-step-desc'],
    tiers: ['tier-grid', 'tier-card', 'tier-header', 'tier-name', 'tier-tagline', 'tier-row', 'tier-includes', 'tier-cta'],
    testimonials: ['t-grid', 't-card', 't-card-quote-mark', 't-card-quote', 't-card-author', 't-card-avatar', 't-card-name', 't-card-role'],
    faq: ['faq-list', 'faq-item', 'faq-q', 'faq-toggle', 'faq-a'],
    deliverables: ['deliv-layout', 'deliv-list', 'deliv-item', 'deliv-check', 'deliv-title', 'deliv-desc', 'deliv-freq'],
  };
  const liveClasses = classesIn(seoFixture);

  for (const [type, required] of Object.entries(REQUIRED)) {
    test(`${type} emits every class the live section uses`, () => {
      const emitted = classesIn(renderSection(SAMPLES[type]));
      for (const cls of required) {
        assert.ok(liveClasses.has(cls), `sanity: .${cls} not present on seo.html — update the test`);
        assert.ok(emitted.has(cls), `${type} renderer is missing .${cls} — composed page would render unstyled`);
      }
      assert.ok(liveClasses.has(LIVE_CONTAINERS[type]));
    });
  }
});

describe('field substitution is a clean single-location swap', () => {
  const A = 'Zqx9SECTIONalpha', B = 'Kp3SECTIONbravo';
  for (const type of SECTION_TYPES) {
    test(`${type}: swapping one field value perturbs nothing else`, () => {
      const spec = SECTION_FIELDS[type];
      const base = SAMPLES[type];
      // Fuzz the section-level 'title' field where present.
      if (spec.fields.some((f) => f.key === 'title')) {
        const outA = renderSection({ ...base, fields: { ...base.fields, title: A } });
        const outB = renderSection({ ...base, fields: { ...base.fields, title: B } });
        assert.equal((outA.match(new RegExp(A, 'g')) || []).length, 1, `${type} title appears more than once`);
        assert.equal(outA.split(A).join(B), outB, `${type} title is not an isolated substitution`);
      }
    });
  }

  test('a text field is escaped; an inline field passes through', () => {
    // cap.num is text -> escaped; cap.title is inline -> passed through (sanitized on write).
    const out = renderSection({ type: 'capabilities', fields: { title: 'T' }, items: [{ num: '<b>1</b>', title: 'Safe <em>x</em>', desc: 'd' }] });
    assert.match(out, /&lt;b&gt;1&lt;\/b&gt;/, 'text field must be escaped');
    assert.match(out, /Safe <em>x<\/em>/, 'inline field passes through');
  });

  test('a hidden section renders nothing', () => {
    assert.equal(renderSection({ type: 'capabilities', hidden: true, fields: {}, items: [] }), '');
  });

  test('an unknown section type is skipped, not thrown', () => {
    assert.equal(renderSection({ type: 'no-such-type', fields: {} }), '');
  });
});

describe('a composed page is a first-class, indexable document', () => {
  const doc = {
    path: '/pricing', locale: 'en',
    content: {
      title: 'Pricing', seo: { metaTitle: 'Pricing — Davnoot', metaDescription: 'Plans and pricing.' },
      sections: [SAMPLES.hero, SAMPLES.capabilities, SAMPLES.faq, SAMPLES.finalCta],
    },
  };
  const html = renderComposedPage(doc);

  test('exactly one canonical, robots, title', () => {
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.equal((html.match(/name="robots"/g) || []).length, 1);
    assert.equal((html.match(/<title>/g) || []).length, 1);
  });
  test('the shared marketing shell is present (styles.css, nav, footer, script.js)', () => {
    assert.match(html, /<link rel="stylesheet" href="\/styles\.css"/);
    assert.match(html, /<nav>/);
    assert.match(html, /<\/footer>/);
    assert.match(html, /<script src="\/script\.js">/);
  });
  test('the JSON-LD parses and includes a FAQPage derived from the faq section', () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const graph = JSON.parse(m[1].replace(/\\u003c/g, '<'));
    assert.ok(graph['@graph'].some((n) => n['@type'] === 'FAQPage'), 'FAQPage should be derived from the visible faq section');
  });
  test('a noindex composed page emits noindex, and canonical stays same-origin', () => {
    const ni = renderComposedPage({ ...doc, content: { ...doc.content, seo: { robotsIndex: false, canonicalUrl: 'https://evil.example/x' } } });
    assert.match(ni, /content="noindex, follow"/);
    assert.doesNotMatch(ni, /evil\.example/, 'a cross-origin canonical must be ignored');
  });
});
