#!/usr/bin/env node
/* Manual IndexNow submission — the backfill and the escape hatch.
 *
 *   npm run indexnow:ping -- /blog/my-post /services/seo
 *   npm run indexnow:ping -- --all                 # every <loc> in the live sitemap
 *   npm run indexnow:ping -- --all --dry-run       # print what would be sent
 *
 * The API routes ping automatically on publish and the CI workflow pings what a
 * deploy changed, so this is for the cases neither covers:
 *
 *   - the FIRST submission after turning IndexNow on (nothing has been pinged yet)
 *   - a bulk recrawl after a migration, a redirect sweep, or a mass copy edit
 *   - re-sending after a 403 has been fixed, without waiting for another publish
 *
 * Unlike the routes, this does NOT gate on VERCEL_ENV — you are running it by
 * hand against production on purpose. It reads INDEXNOW_KEY from the environment
 * or .env.local, the same way every other script in here reads its config.
 */
import { loadEnv } from './_env.js';
import { SITE_URL } from '../lib/templates.js';
import { submitIndexNow, normalizeUrls, indexNowKey, keyLocation } from '../lib/indexnow.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const dryRun = flag('--dry-run');
const all = flag('--all');

/* Positional args = the URLs. Anything starting with '-' is a flag, and the token
 * straight after --key is its VALUE, not a URL — skipping it by index rather than
 * by value matters, because a key is an opaque string that could look like anything. */
const keyIndex = argv.indexOf('--key');
const key = keyIndex >= 0 ? argv[keyIndex + 1] : undefined;
const positional = argv.filter((a, i) => !a.startsWith('-') && i !== keyIndex + 1);

if (flag('--help') || flag('-h') || (!all && !positional.length)) {
  console.log(
    [
      'Usage:',
      '  node scripts/indexnow-ping.js <url|path> [more...]',
      '  node scripts/indexnow-ping.js --all          submit every <loc> in ' + SITE_URL + '/sitemap.xml',
      '',
      'Options:',
      '  --all        pull the URL list from the LIVE production sitemap',
      '  --dry-run    print the URLs, submit nothing',
      '  --key <k>    override INDEXNOW_KEY',
    ].join('\n'),
  );
  process.exit(flag('--help') || flag('-h') ? 0 : 1);
}

loadEnv();

/* Pull every <loc> out of the LIVE sitemap rather than rebuilding the URL list
 * here. api/sitemap.js already merges three sources and applies the archived /
 * noindex / sitemap.include exclusions; re-deriving any of that would guarantee
 * the two lists drift, and submitting a noindexed URL is the exact contradiction
 * that file refuses to commit. The sitemap is the source of truth for "every URL
 * we want indexed", so ask it. */
async function urlsFromSitemap() {
  const url = SITE_URL + '/sitemap.xml';
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('GET ' + url + ' -> ' + res.status);

  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!locs.length) throw new Error('no <loc> entries in ' + url);

  // Only <url><loc>, never an <xhtml:link> alternate — those are already their own
  // <url> entries, so taking both would submit every bilingual page twice.
  console.log('· ' + locs.length + ' URL(s) from ' + url);
  return locs;
}

const raw = all ? await urlsFromSitemap() : positional;
const urls = normalizeUrls(raw);

if (raw.length !== urls.length) {
  console.warn('! dropped ' + (raw.length - urls.length) + ' URL(s): off-host, duplicate, or unparseable');
}
if (!urls.length) {
  console.error('! nothing to submit');
  process.exit(1);
}

if (dryRun) {
  for (const u of urls) console.log(u);
  console.log('· --dry-run: ' + urls.length + ' URL(s), nothing sent');
  process.exit(0);
}

const resolvedKey = key || indexNowKey();
if (!resolvedKey) {
  console.error('! INDEXNOW_KEY is not set. Put it in .env.local, or pass --key <k>.');
  console.error('  Generate one at https://www.bing.com/webmasters -> IndexNow, then commit <key>.txt to the repo root.');
  process.exit(1);
}

console.log('· key file must be live at ' + keyLocation(resolvedKey));
const report = await submitIndexNow(urls, { key: resolvedKey });

if (report.skipped) {
  console.error('! skipped: ' + report.skipped);
  process.exit(1);
}

// submitIndexNow never throws, so the exit code is the only failure signal a CI
// step can act on. A rejected batch must fail the run, not pass quietly.
console.log((report.ok ? '✓' : '✗') + ' ' + report.submitted + ' URL(s) in ' + report.batches.length + ' batch(es)');
process.exit(report.ok ? 0 : 1);
