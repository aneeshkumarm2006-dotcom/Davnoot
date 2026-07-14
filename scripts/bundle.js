#!/usr/bin/env node
/* Bundle the dashboard SPA.
 *
 *   npm run bundle
 *
 * Input:  src/dashboard/main.js  (ESM + Tiptap)
 * Output: seoteam/app.js         (one file, COMMITTED to the repo)
 *
 * WHY THE OUTPUT IS COMMITTED
 * ---------------------------
 * package.json deliberately has no `build` script, because adding one flips
 * Vercel from "serve these static files" to "run a build and figure out an output
 * directory" — a change in deploy behaviour we don't want for a site that has
 * shipped fine as static files for its whole life. So the bundle is built here,
 * locally, and committed. Run this whenever you touch anything under src/.
 *
 * The marketing site is untouched by this: it has no bundler and doesn't need one.
 */
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSrcHash, bannerFor } from './src-hash.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

// Stamp the source-tree hash into every bundle. imports.test.js recomputes it, so
// a committed bundle that is stale relative to src/ fails `npm test` instead of
// shipping silently. Skipped in --watch (sourcemaps + rapid rebuilds; not committed).
const SRC_HASH = watch ? null : computeSrcHash();

// Two SPAs, two committed bundles: the /seoteam writer dashboard and the /admin
// website manager. They share src/dashboard/dom.js and media-picker.js; the admin
// bundle deliberately does NOT pull in Tiptap (its content fields are constrained
// contenteditable), so there is no second 450 kB editor blob in git.
const makeOptions = (entry, outfile) => ({
  entryPoints: [path.join(root, ...entry)],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: path.join(root, ...outfile),
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  ...(SRC_HASH ? { banner: { js: bannerFor(SRC_HASH) } } : {}),
});

const BUNDLES = [
  { entry: ['src', 'dashboard', 'main.js'], outfile: ['seoteam', 'app.js'], label: 'seoteam/app.js' },
  { entry: ['src', 'admin', 'main.js'], outfile: ['admin', 'app.js'], label: 'admin/app.js' },
];

if (watch) {
  for (const b of BUNDLES) {
    const ctx = await esbuild.context(makeOptions(b.entry, b.outfile));
    await ctx.watch();
  }
  console.log('watching src/dashboard and src/admin …');
} else {
  for (const b of BUNDLES) {
    const result = await esbuild.build({ ...makeOptions(b.entry, b.outfile), metafile: true });
    const out = Object.values(result.metafile.outputs)[0];
    console.log(`✓ ${b.label} — ${(out.bytes / 1024).toFixed(1)} kB`);
  }
}
