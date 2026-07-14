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

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(root, 'src', 'dashboard', 'main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: path.join(root, 'seoteam', 'app.js'),
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching src/dashboard …');
} else {
  const result = await esbuild.build({ ...options, metafile: true });
  const out = Object.values(result.metafile.outputs)[0];
  console.log(`✓ seoteam/app.js — ${(out.bytes / 1024).toFixed(1)} kB`);
}
