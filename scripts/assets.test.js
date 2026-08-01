/* The committed minified assets — and the silent failure they create.
 *
 * styles.min.css / blog.min.css / script.min.js are what every page actually loads.
 * They are GENERATED (scripts/minify-assets.js) and COMMITTED, because this project
 * deliberately has no build step on Vercel. So the failure mode is the same one the
 * SPA bundles have, and it is silent: edit styles.css, forget `npm run site`, deploy,
 * and the live site serves yesterday's CSS with no error anywhere.
 *
 * Each generated file carries a `sha256(source)` stamp in its first line. These tests
 * recompute it. A stale .min file therefore fails `npm test` instead of shipping —
 * which is the entire reason the stamp exists.
 *
 * The second half pins the other direction: nothing may still reference the
 * UNMINIFIED file. A single page left on /styles.css would put the 154 kB source back
 * on the wire and quietly re-open the audit finding this replaced.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ASSETS, hashOf, stampIn } from './minify-assets.js';

const ROOT = path.join(import.meta.dirname, '..');

/** Every .html and .js file in the repo that could carry an asset reference. */
function sourceFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(html|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// This file and the generator legitimately mention the unminified names.
const EXEMPT = new Set(['scripts/minify-assets.js', 'scripts/assets.test.js']);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

describe('the committed minified assets are current', () => {
  for (const { src, out } of ASSETS) {
    test(`${out} exists`, () => {
      assert.ok(fs.existsSync(path.join(ROOT, out)), `${out} is missing — run \`npm run site\``);
    });

    test(`${out} is not stale relative to ${src}`, () => {
      const stamp = stampIn(out);
      assert.ok(stamp, `${out} has no source stamp — was it hand-edited?`);
      assert.equal(stamp.src, src, `${out} is stamped from ${stamp.src}, not ${src}`);
      assert.equal(
        stamp.hash,
        hashOf(src),
        `${out} is STALE: ${src} has changed since it was generated. Run \`npm run site\` and commit the result.`,
      );
    });

    test(`${out} is actually smaller than ${src}`, () => {
      const a = fs.statSync(path.join(ROOT, src)).size;
      const b = fs.statSync(path.join(ROOT, out)).size;
      assert.ok(b < a, `${out} (${b}) is not smaller than ${src} (${a}) — minification did nothing`);
    });
  }

  test('the generated files say they are generated', () => {
    for (const { out } of ASSETS) {
      const head = fs.readFileSync(path.join(ROOT, out), 'utf8').slice(0, 200);
      assert.match(head, /Do not edit/, `${out} must warn that hand-edits will be overwritten`);
    }
  });
});

describe('nothing still links the unminified source', () => {
  const files = sourceFiles().filter((f) => !EXEMPT.has(rel(f)));

  for (const { src } of ASSETS) {
    test(`no page references /${src}`, () => {
      const attr = src.endsWith('.css') ? `href="/${src}"` : `src="/${src}"`;
      const offenders = files.filter((f) => fs.readFileSync(f, 'utf8').includes(attr));
      assert.deepEqual(
        offenders.map(rel),
        [],
        `these still load the unminified ${src} — repoint them at the .min sibling`,
      );
    });
  }

  test('every page that loads CSS loads the minified one', () => {
    const pages = files.filter((f) => f.endsWith('.html') && fs.readFileSync(f, 'utf8').includes('<body'));
    const withCss = pages.filter((f) => /rel="stylesheet"\s+href="\/[a-z.]+\.css"/.test(fs.readFileSync(f, 'utf8')));
    assert.ok(withCss.length > 0, 'no page loads a local stylesheet — the check is measuring nothing');
    for (const f of withCss) {
      assert.match(fs.readFileSync(f, 'utf8'), /href="\/styles\.min\.css"/, `${rel(f)} does not load styles.min.css`);
    }
  });
});
