/* Google Analytics 4 — the configuration half of Google's gtag.js snippet.
 *
 * Google hands you this as an INLINE <script>. It is a file here because the site's
 * CSP (vercel.json) has no 'unsafe-inline' in script-src: an inline script must be
 * allowlisted by a sha256 that changes with every byte edited, and this one would
 * ship on every page. Served from 'self', it needs no hash at all.
 *
 * Loaded by ANALYTICS_TAGS in lib/templates.js, alongside the gtag.js loader.
 * Both tags are async, so this may execute BEFORE or AFTER gtag.js — the dataLayer
 * stub below is what makes either order work.
 *
 * The ID must match GA_MEASUREMENT_ID in lib/templates.js; scripts/analytics.test.js
 * fails if the two drift. Plain ES5, no module syntax: it is a classic script and
 * `gtag` has to land on the global scope for gtag.js to find it.
 */
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());

gtag('config', 'G-8M1NRDL18V');
