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

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

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

/** sha256 over (relative path + content) of every JS file under src/. */
export function computeSrcHash() {
  const h = crypto.createHash('sha256');
  for (const file of srcFiles()) {
    h.update(path.relative(SRC_DIR, file).replace(/\\/g, '/'));
    h.update('\0');
    h.update(fs.readFileSync(file));
    h.update('\0');
  }
  return h.digest('hex');
}

/** The banner bundle.js prepends, and imports.test.js looks for. */
export const bannerFor = (hash) => `/*srchash:${hash}*/`;
