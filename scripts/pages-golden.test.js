/* The golden test — the entire migration risk budget lives here.
 *
 *   node --test scripts/
 *
 * If any of these fail, a marketing page would render differently than the bytes
 * that ship today. That is the ONE thing this whole architecture exists to prevent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { COMPILED_PAGES } from '../lib/compiled-pages.gen.js';
import { renderPage, effectiveTitle, effectiveDescription } from '../lib/page-render.js';
import { compileAll, PAGE_FILES } from './compile-pages.js';

const ROOT = path.join(import.meta.dirname, '..');
const fixture = (file) =>
  fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'pages', file.replace('.html', '.expected.html')), 'utf8');

describe('renderPage(tpl, null) is byte-identical to the frozen fixture', () => {
  for (const file of PAGE_FILES) {
    test(file, () => {
      const tpl = COMPILED_PAGES[file];
      assert.ok(tpl, `${file} is missing from COMPILED_PAGES`);
      const out = renderPage(tpl, null);
      const fx = fixture(file);
      if (out !== fx) {
        const i = firstDiff(out, fx);
        assert.fail(
          `byte diff at offset ${i}\n  rendered …${JSON.stringify(out.slice(Math.max(0, i - 40), i + 40))}…\n` +
            `  fixture  …${JSON.stringify(fx.slice(Math.max(0, i - 40), i + 40))}…`,
        );
      }
    });
  }
});

describe('an empty document renders exactly like a null document', () => {
  for (const file of PAGE_FILES) {
    test(file, () => {
      const tpl = COMPILED_PAGES[file];
      assert.equal(renderPage(tpl, { content: { sections: [] } }), fixture(file));
    });
  }
});

describe('the committed compiled module is current (did you run `npm run site`?)', () => {
  test('recompiling pages/ in memory matches lib/compiled-pages.gen.js', () => {
    const fresh = compileAll();
    for (const file of PAGE_FILES) {
      assert.deepEqual(
        { chunks: fresh[file].chunks, slots: fresh[file].slots, seoRegion: fresh[file].seoRegion },
        { chunks: COMPILED_PAGES[file].chunks, slots: COMPILED_PAGES[file].slots, seoRegion: COMPILED_PAGES[file].seoRegion },
        `${file} is stale — run \`npm run site\` and commit lib/compiled-pages.gen.js`,
      );
    }
  });

  test('no page compiled with a demoted slot', () => {
    const fresh = compileAll();
    for (const file of PAGE_FILES) {
      assert.equal(fresh[file].demoted.length, 0, `${file}: ${JSON.stringify(fresh[file].demoted)}`);
    }
  });
});

describe('the <head> — where SEO lives, and where the reference plan had zero tests', () => {
  for (const file of PAGE_FILES) {
    test(`${file}: exactly one canonical, robots, and title`, () => {
      const out = renderPage(COMPILED_PAGES[file], null);
      assert.equal((out.match(/<link[^>]+rel="canonical"/g) || []).length, 1, 'one canonical only');
      assert.equal((out.match(/<meta[^>]+name="robots"/g) || []).length, 1, 'one robots only');
      assert.equal((out.match(/<title>/g) || []).length, 1, 'one <title> only');
    });
    test(`${file}: every ld+json block parses`, () => {
      const out = renderPage(COMPILED_PAGES[file], null);
      const blocks = [...out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      for (const b of blocks) JSON.parse(b[1].replace(/\\u003c/g, '<'));
    });
  }

  test('doc.content.title (an admin label) NEVER reaches <title>', () => {
    const tpl = COMPILED_PAGES['seo.html'];
    const withLabel = { content: { title: 'ADMIN LABEL ONLY', sections: [] } };
    assert.equal(renderPage(tpl, withLabel), fixture('seo.html'), 'a label must not touch the head or body');
    assert.equal(effectiveTitle(tpl, withLabel), effectiveTitle(tpl, null), 'title stays the source default');
  });

  test('seo.metaTitle override DOES change <title>, seo.metaDescription changes the description', () => {
    const tpl = COMPILED_PAGES['seo.html'];
    const doc = { content: { seo: { metaTitle: 'New Title Here', metaDescription: 'New description here.' }, sections: [] } };
    const out = renderPage(tpl, doc);
    assert.match(out, /<title>New Title Here<\/title>/);
    assert.match(out, /name="description"\s+content="New description here\."/);
  });
});

describe('content overrides change exactly the annotated text', () => {
  test('seo.html hero.title override replaces only that heading', () => {
    const tpl = COMPILED_PAGES['seo.html'];
    const doc = { content: { sections: [{ id: 'hero', fields: { 'hero.title': 'Rank #1. <em>Forever.</em>' } }] } };
    const out = renderPage(tpl, doc);
    assert.match(out, /Rank #1\. <em>Forever\.<\/em>/);
    assert.doesNotMatch(out, /Technical SEO that<br \/>drives <em>organic growth<\/em>\./);
  });

  test('a hidden section falls back to the compiled default', () => {
    const tpl = COMPILED_PAGES['seo.html'];
    const doc = { content: { sections: [{ id: 'hero', hidden: true, fields: { 'hero.title': 'IGNORED' } }] } };
    assert.equal(renderPage(tpl, doc), fixture('seo.html'), 'a hidden section emits its default bytes');
  });
});

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}
