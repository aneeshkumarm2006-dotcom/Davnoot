/* The blank-page guard.
 *
 * script.js does querySelector('[data-intro]') — FIRST MATCH ONLY — and runs a
 * full-screen intro takeover that adds `.intro-lock` to <html> and hides every
 * `.reveal` element (opacity:0) until the showcase runner finishes and end() calls
 * startReveals(). If two elements carried data-intro, or the runner threw without
 * end() ever running, the page would stay blank-white. Three defences, all pinned
 * here — because the failure mode is a live, fully-invisible revenue page.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';

import { COMPILED_PAGES } from '../lib/compiled-pages.gen.js';
import { renderPage } from '../lib/page-render.js';
import { PAGE_FILES } from './compile-pages.js';

const ROOT = path.join(import.meta.dirname, '..');
const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

function* walk(node) {
  yield node;
  for (const c of node.childNodes || []) yield* walk(c);
}
const attr = (n, name) => (n.attrs || []).find((a) => a.name === name)?.value;
function countAttr(html, name) {
  let n = 0;
  for (const node of walk(parse(html))) if (typeof node.tagName === 'string' && attr(node, name) !== undefined) n++;
  return n;
}

describe('data-intro appears on at most one element per rendered page', () => {
  for (const file of PAGE_FILES) {
    test(`${file}: <= 1 [data-intro]`, () => {
      const out = renderPage(COMPILED_PAGES[file], null);
      assert.ok(countAttr(out, 'data-intro') <= 1, `${file} renders more than one [data-intro] — script.js only runs the first, the rest are dead`);
    });
  }

  test('a bogus doc.intro can never inject a second [data-intro]', () => {
    // doc.intro is not wired to stamp data-intro on the 8 overlay pages (that is the
    // Phase-5 composed renderer); pin that a hostile value changes nothing here.
    for (const file of PAGE_FILES) {
      const out = renderPage(COMPILED_PAGES[file], { content: { intro: 'showcase', sections: [] } });
      assert.ok(countAttr(out, 'data-intro') <= 1, `${file}: doc.intro leaked a second [data-intro]`);
    }
  });
});

describe('the showcase-runner contract', () => {
  test('every data-showcase value used on a page has a SHOWCASE_RUNNERS entry', () => {
    // A [data-intro] page whose .showcase-frame has a data-showcase with no runner
    // hits the `if (!frame || !runner) { startReveals(); return; }` safety path — the
    // page shows, but the intro silently no-ops. Catch a new showcase with no runner.
    const runnerKeys = new Set(
      [...script.matchAll(/^\s*'?([a-z-]+)'?\s*:\s*anim\w+Showcase,/gm)].map((m) => m[1]),
    );
    assert.ok(runnerKeys.size >= 5, `expected the SHOWCASE_RUNNERS map, parsed ${runnerKeys.size} keys`);
    const used = new Set();
    for (const file of PAGE_FILES) {
      const src = fs.readFileSync(path.join(ROOT, 'pages', file), 'utf8');
      for (const m of src.matchAll(/data-showcase="([^"]+)"/g)) used.add(m[1]);
    }
    for (const key of used) {
      assert.ok(runnerKeys.has(key), `data-showcase="${key}" has no SHOWCASE_RUNNERS entry in script.js`);
    }
  });
});

describe('runIntro can never leave the page hidden', () => {
  test('runIntro calls end() in a finally block', () => {
    // end() -> startReveals(). If a showcase runner throws and end() is skippable, the
    // page stays at opacity:0 forever. The finally is the whole fix (Phase 0).
    assert.match(script, /finally\s*\{[^}]*end\(\)/, 'runIntro must call end() in finally { } so a throwing runner cannot blank the page');
  });

  test('the intro runner is bounded by a watchdog race', () => {
    // Even without a throw, a runner that hangs would never reach end(). The 6s
    // Promise.race watchdog guarantees progress.
    assert.match(script, /Promise\.race\(\[runner\(clone\)/, 'the showcase runner must be raced against a timeout watchdog');
  });
});
