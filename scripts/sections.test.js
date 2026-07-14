/* Sentinel fuzz — the one test that catches a slot boundary that is correct when
 * empty and CORRUPTS MARKUP the moment someone types into it.
 *
 * For every compiled hole on every page: render with a unique sentinel in that ONE
 * hole, re-parse the result with parse5, and assert the sentinel landed in exactly
 * one text node or attribute value AND the DOM shape is otherwise identical to the
 * baseline (no element added, removed, or renamed). A hole whose default happens to
 * round-trip but whose slice boundary is off by a character would inject or destroy
 * markup here — invisibly, in production, the first time an author edits it.
 *
 * Plus XSS-per-kind: the write-path sanitizer neutralizes hostile input by slot kind.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';

import { COMPILED_PAGES } from '../lib/compiled-pages.gen.js';
import { renderPage } from '../lib/page-render.js';
import { sanitizeContentFields } from '../lib/page-model.js';
import { PAGE_FILES } from './compile-pages.js';

const SENT_A = 'Zqx9SENTINELalpha7Wv'; // alnum, no markup — safe in text AND attribute contexts
const SENT_B = 'Kp3SENTINELbravo8Rn';

/** Build a one-hole override doc for a slot key with a given value. */
function docFor(key, value) {
  if (key.startsWith('seo.')) return { content: { seo: { [key.slice(4)]: value }, sections: [] } };
  return { content: { sections: [{ id: 'o', source: 'base', fields: { [key]: value } }] } };
}

/** Count how many text nodes or attribute values contain `needle` (parse-verified). */
function nodeHits(html, needle) {
  let hits = 0;
  (function walk(n) {
    if (n.nodeName === '#text' && String(n.value).includes(needle)) hits++;
    for (const a of n.attrs || []) if (String(a.value).includes(needle)) hits++;
    for (const c of n.childNodes || []) walk(c);
  })(parse(html));
  return hits;
}

describe('sentinel fuzz — every hole is a clean, single-location substitution', () => {
  for (const file of PAGE_FILES) {
    const tpl = COMPILED_PAGES[file];

    test(`${file}: ${tpl.slots.length} slots each substitute cleanly`, () => {
      for (const slot of tpl.slots) {
        const outA = renderPage(tpl, docFor(slot.key, SENT_A));
        const outB = renderPage(tpl, docFor(slot.key, SENT_B));

        // 1. Parse-verified: the value lands in exactly one text node or attribute —
        //    never split across a tag boundary, never leaked into a second location.
        const hits = nodeHits(outA, SENT_A);
        assert.equal(hits, 1, `${file} slot "${slot.key}" landed in ${hits} nodes (expected 1) — the slice boundary corrupts markup`);

        // 2. Clean substitution: the ONLY difference between two renders is the value
        //    itself. If a boundary were off, changing the value would ripple into the
        //    surrounding markup and this equality would break. Kind-agnostic — it does
        //    not care whether the default held <em>/<br />, only that the hole is inert.
        assert.equal(
          outA.split(SENT_A).join(SENT_B),
          outB,
          `${file} slot "${slot.key}" is not an isolated substitution point — editing it perturbs surrounding markup`,
        );
      }
    });
  }
});

describe('XSS is neutralized on the write path, per slot kind', () => {
  const tpl = COMPILED_PAGES['seo.html'];
  const kindOf = (key) => tpl.slots.find((s) => s.key === key)?.kind;

  test('a text slot escapes angle brackets at render (no live tag)', () => {
    // seo.metaTitle is kind:text -> emitOverride uses esc(). A <script> can never
    // become a live element in the <title>.
    const doc = { content: { seo: { metaTitle: '<script>alert(1)</script>' }, sections: [] } };
    const out = renderPage(tpl, doc);
    assert.doesNotMatch(out, /<title><script>/, 'text slot must escape markup');
    assert.match(out, /&lt;script&gt;/, 'the payload must appear escaped');
  });

  test('an inline slot strips <script> but keeps <em> on write', () => {
    const key = tpl.slots.find((s) => s.kind === 'inline')?.key;
    assert.ok(key, 'expected at least one inline slot');
    const content = { sections: [{ id: 'o', fields: { [key]: 'Safe <em>accent</em><script>alert(1)</script>' } }] };
    sanitizeContentFields(content, tpl);
    const cleaned = content.sections[0].fields[key];
    assert.match(cleaned, /<em>accent<\/em>/, 'inline must keep accent typography');
    assert.doesNotMatch(cleaned, /<script/i, 'inline must strip <script>');
  });

  test('an inline slot strips block elements and event handlers', () => {
    const key = tpl.slots.find((s) => s.kind === 'inline')?.key;
    const content = { sections: [{ id: 'o', fields: { [key]: '<div onclick="x()">no</div><em>yes</em>' } }] };
    sanitizeContentFields(content, tpl);
    const cleaned = content.sections[0].fields[key];
    assert.doesNotMatch(cleaned, /<div/i, 'inline must strip block elements');
    assert.doesNotMatch(cleaned, /onclick/i, 'inline must strip event handlers');
    assert.match(cleaned, /<em>yes<\/em>/);
  });

  test('every compiled slot has a known kind', () => {
    const known = new Set(['inline', 'text', 'richtext', 'url', 'image']);
    for (const file of PAGE_FILES) {
      for (const slot of COMPILED_PAGES[file].slots) {
        assert.ok(known.has(slot.kind), `${file}: slot ${slot.key} has unknown kind ${slot.kind}`);
      }
    }
    assert.ok(kindOf); // silence unused in case seo has no inline (it does)
  });
});
