/* One deterministic hash of the SPA source tree.
 *
 * The dashboards ship as COMMITTED esbuild bundles (seoteam/app.js, admin/app.js)
 * because this project has no build step on Vercel. That creates the repo's worst
 * silent failure: edit something under src/, forget `npm run bundle`, and the
 * deployed dashboard is stale — with no build error anywhere, because there is no
 * build. bundle.js stamps this hash into each bundle as a "srchash" banner comment,
 * and scripts/imports.test.js recomputes it — so a forgotten rebuild fails `npm test`.
 *
 * Pure and side-effect free (bundle.js must be importable without running esbuild).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');

/** Every .js file under src/, sorted, for a stable hash regardless of readdir order. */
export function srcFiles(dir = SRC_DIR) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/* The shared modules under lib/ that the bundles pull in, found by following
 * import statements out of src/ transitively.
 *
 * ===========================================================================
 * THE HOLE THIS CLOSES
 * ===========================================================================
 * Hashing src/ alone was never enough. esbuild follows imports wherever they
 * lead, so `src/dashboard/seo-panel.js` importing `lib/seo-score.js` INLINES
 * that module into the committed bundle — while the banner keeps reporting a
 * hash of an unchanged src/. Edit lib/seo-score.js afterwards and every
 * staleness check stays green while the deployed dashboard runs the old copy:
 * precisely the silent failure the banner exists to catch, entering through a
 * side door. Six files already had such an import before anyone noticed.
 *
 * Following imports rather than hashing all of lib/ is deliberate. lib/ also
 * holds compiled-pages.gen.js, which `npm run site` rewrites on every content
 * edit — folding that in would mark both bundles stale every time a sentence of
 * marketing copy changed, and a staleness alarm that cries wolf gets ignored,
 * which is how the original hole would come straight back.
 */
export function bundledLibFiles() {
  const seen = new Set();
  const queue = srcFiles();

  while (queue.length) {
    const file = queue.shift();
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }

    // Static ESM only: `import … from '…'` and `export … from '…'`. A dynamic
    // import() of a lib module would be missed, but esbuild splits those into a
    // separate chunk rather than inlining them, so they are not part of the
    // committed single-file bundle this hash describes.
    for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue; // bare specifier: node_modules, not ours
      const resolved = path.resolve(path.dirname(file), spec);
      const rel = path.relative(ROOT, resolved).replace(/\\/g, '/');
      if (!rel.startsWith('lib/') || seen.has(resolved)) continue;
      if (!fs.existsSync(resolved)) continue;
      seen.add(resolved);
      queue.push(resolved); // lib modules import each other — keep walking
    }
  }

  return [...seen].sort();
}

/** sha256 over (relative path + content) of every file the bundles are built from. */
export function computeSrcHash() {
  const h = crypto.createHash('sha256');
  for (const file of [...srcFiles(), ...bundledLibFiles()]) {
    h.update(path.relative(ROOT, file).replace(/\\/g, '/'));
    h.update('\0');
    h.update(fs.readFileSync(file));
    h.update('\0');
  }
  return h.digest('hex');
}

/** The banner bundle.js prepends, and imports.test.js looks for. */
export const bannerFor = (hash) => `/*srchash:${hash}*/`;
