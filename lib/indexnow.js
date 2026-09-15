/* IndexNow — tell the search engines the moment a URL is published, changed or removed.
 *
 * IndexNow (https://www.indexnow.org) is a free, open protocol with no signup and
 * no paid API. One POST to api.indexnow.org fans out to every participating engine:
 *
 *     Bing · Yandex · Naver · Seznam · Yep
 *
 * GOOGLE DOES NOT PARTICIPATE. Nothing here replaces /sitemap.xml or Search
 * Console; it sits beside them. What earns it its place anyway is Bing: Bing's
 * index is a primary retrieval layer for ChatGPT Search, so the gap between
 * "published" and "quotable by an answer engine" collapses from days to minutes.
 * That is the payoff — treat this as an AEO tool, not an SEO one.
 *
 * ---------------------------------------------------------------------------
 * THE ONE MANUAL STEP
 * ---------------------------------------------------------------------------
 * A key file must exist at the site root and be readable:
 *
 *     https://www.davnoot.com/<key>.txt      containing exactly <key>
 *
 * That file is what proves we own the host. It is a plain .txt committed to the
 * repo root and served as a static asset — NOT a route, NOT generated. If it is
 * missing or its contents do not match, every submission is rejected with 403,
 * which is why a 403 is logged loudly below rather than swallowed. See README.md.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT WITH ITS CALLERS
 * ---------------------------------------------------------------------------
 * pingIndexNow() is FIRE-AND-FORGET and must stay that way. A publish is the
 * user's write; a search-engine notification is a courtesy to a third party we do
 * not control. So:
 *
 *   - it NEVER throws (every path is caught, including the network),
 *   - it is NEVER awaited in a request handler, so it cannot delay a response,
 *   - it NEVER turns a successful publish into a 5xx.
 *
 * Same degrade-gracefully discipline as api/sitemap.js, and the same shape as
 * lib/audit.js: the side effect logs its own failure and the caller moves on.
 *
 * It also no-ops OUTSIDE PRODUCTION. Every URL it builds carries the production
 * domain (SITE_URL), so an ungated ping from a preview deploy would submit real
 * production URLs off a contractor's branch, and local `npm run dev` would do it
 * on every save. Only VERCEL_ENV === 'production' actually sends.
 */
import { SITE_URL } from './templates.js';

const ENDPOINT = 'https://api.indexnow.org/indexnow';

/* The protocol's own ceiling: at most 10,000 URLs in a single submission. */
const MAX_URLS_PER_REQUEST = 10000;

/* Bounded so a hung connection can never hold a serverless instance open to the
 * platform's maxDuration. The ping is optional; the timeout is not. */
const TIMEOUT_MS = 5000;

/* Derived from SITE_URL, never written out. The host in the body, the host of
 * every submitted URL and the host serving the key file must all be identical —
 * a mismatch is a 422 for the WHOLE batch, not a skipped URL. */
export const INDEXNOW_HOST = new URL(SITE_URL).host;

/** The key, or '' when unset. Trimmed: a trailing newline from a paste is a 403. */
export const indexNowKey = (env = process.env) => String(env.INDEXNOW_KEY || '').trim();

/** Where the engines will look for the proof-of-ownership file. */
export const keyLocation = (key) => SITE_URL + '/' + key + '.txt';

/**
 * Why a ping would be skipped, or null if it would actually send.
 * Exported so the CLI and the tests can state the reason instead of guessing.
 */
export function skipReason(env = process.env) {
  if (!indexNowKey(env)) return 'INDEXNOW_KEY is not set';
  if (env.VERCEL_ENV !== 'production') {
    return 'VERCEL_ENV is ' + (env.VERCEL_ENV || 'unset') + ', not production';
  }
  return null;
}

/**
 * Normalize caller input into absolute, deduped, on-host URLs.
 *
 * Callers pass whatever is natural at the call site — '/blog/my-post', a full
 * canonicalFor() URL, a mixed array, a stray null from an optional field. This is
 * the one place that turns all of it into what the protocol requires.
 *
 * OFF-HOST URLS ARE DROPPED, not passed through. IndexNow rejects an ENTIRE
 * submission (422) if a single URL belongs to another host, so one stray absolute
 * link would silently cost us every other URL in the batch.
 */
export function normalizeUrls(urls) {
  const out = [];
  const seen = new Set();

  for (const raw of Array.isArray(urls) ? urls : [urls]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;

    let url;
    try {
      url = new URL(raw.trim(), SITE_URL);
    } catch {
      continue; // unparseable — a caller bug, never a reason to fail a publish
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (url.host !== INDEXNOW_HOST) continue; // see above: one of these 422s the batch
    url.hash = ''; // a fragment is not a distinct URL to a crawler

    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push(url.href);
  }

  return out;
}

/** Split into submissions of at most MAX_URLS_PER_REQUEST. */
function batches(urls) {
  const out = [];
  for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
    out.push(urls.slice(i, i + MAX_URLS_PER_REQUEST));
  }
  return out;
}

/* Vercel's Node runtime may freeze an instance the moment the response is sent,
 * which would cut a floating promise off mid-flight. `waitUntil` is the platform's
 * answer: it keeps the invocation alive for the promise WITHOUT the handler
 * awaiting it, so the response still goes out immediately.
 *
 * Reached through the runtime's own symbol rather than the @vercel/functions
 * package, because this repo takes no new dependencies. Every step is optional —
 * off Vercel (local dev, the CLI, the test suite) the promise simply runs as an
 * ordinary floating promise, which is the correct behaviour there. */
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

function keepAlive(promise) {
  try {
    globalThis[REQUEST_CONTEXT]?.get?.()?.waitUntil?.(promise);
  } catch {
    /* No request context (CLI, tests, cold module load). The promise still runs. */
  }
  return promise;
}

/**
 * Submit one batch. Resolves to a small report; never rejects.
 *
 * Status handling is the diagnostic surface for the one thing that actually goes
 * wrong in practice — the key file. 403 and 422 mean the submission was refused
 * for a reason a human must fix, so they are logged at error level with the
 * keyLocation spelled out. Everything else is a transient we drop on the floor.
 */
async function submitBatch(key, urlList, fetchImpl) {
  const body = {
    host: INDEXNOW_HOST,
    key,
    keyLocation: keyLocation(key),
    urlList,
  };

  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Network error, DNS, or our own timeout. Not worth a retry: /sitemap.xml and
    // the CI workflow both re-cover anything a dropped ping missed.
    console.error('[indexnow] submission failed (' + urlList.length + ' URL(s)):', err?.message || err);
    return { ok: false, count: urlList.length, status: 0, error: String(err?.message || err) };
  }

  const ok = res.status === 200 || res.status === 202;

  if (ok) {
    console.log('[indexnow] submitted ' + urlList.length + ' URL(s) — ' + res.status);
  } else if (res.status === 403) {
    console.error(
      '[indexnow] 403 REJECTED — the key file is missing or does not match. Confirm ' +
        keyLocation(key) +
        ' exists, is served as text/plain, and contains exactly the key. ' +
        'Nothing will be indexed until this is fixed.',
    );
  } else if (res.status === 422) {
    console.error(
      '[indexnow] 422 REJECTED — the URLs do not belong to ' +
        INDEXNOW_HOST +
        ', or the key does not match ' +
        keyLocation(key) +
        '. The WHOLE batch of ' +
        urlList.length +
        ' was discarded.',
    );
  } else if (res.status === 429) {
    console.warn('[indexnow] 429 rate limited — dropped ' + urlList.length + ' URL(s).');
  } else {
    console.warn('[indexnow] unexpected ' + res.status + ' for ' + urlList.length + ' URL(s).');
  }

  return { ok, count: urlList.length, status: res.status };
}

/**
 * Submit URLs, IGNORING the production/env gate. The CLI and the CI workflow use
 * this; a request handler should not — it wants pingIndexNow() below.
 *
 * Awaitable and total: it resolves to a report and never rejects.
 *
 * @param urls              string | string[] — absolute URLs or site-relative paths
 * @param opts.key          override INDEXNOW_KEY (the CLI's --key)
 * @param opts.env          environment to read the key from
 * @param opts.fetchImpl    injected by the tests
 * @returns {Promise<{ok:boolean, skipped?:string, submitted:number, batches:Array}>}
 */
export async function submitIndexNow(urls, { key, env = process.env, fetchImpl = fetch } = {}) {
  const resolvedKey = (key && String(key).trim()) || indexNowKey(env);
  if (!resolvedKey) return { ok: false, skipped: 'INDEXNOW_KEY is not set', submitted: 0, batches: [] };

  const list = normalizeUrls(urls);
  if (!list.length) return { ok: true, skipped: 'no submittable URLs', submitted: 0, batches: [] };

  const reports = [];
  // Sequential on purpose: batches only exist above 10,000 URLs (a full backfill),
  // and firing those concurrently is exactly what gets an endpoint to 429 us.
  for (const batch of batches(list)) {
    reports.push(await submitBatch(resolvedKey, batch, fetchImpl));
  }

  return { ok: reports.every((r) => r.ok), submitted: list.length, batches: reports };
}

/**
 * Notify the engines that these URLs changed. THE ENTRY POINT FOR API ROUTES.
 *
 *     pingIndexNow(['/blog/' + slug, '/blog']);   // note: no await
 *
 * DO NOT AWAIT THIS IN A HANDLER. It is deliberately fire-and-forget: the returned
 * promise exists for the tests and for keepAlive, not for the response path. It
 * never rejects, so an unawaited call can never produce an unhandled rejection.
 *
 * No-ops silently unless INDEXNOW_KEY is set AND VERCEL_ENV === 'production'.
 */
export function pingIndexNow(urls, opts = {}) {
  const env = opts.env || process.env;

  const skip = skipReason(env);
  if (skip) return Promise.resolve({ ok: true, skipped: skip, submitted: 0, batches: [] });

  // Normalizing up front keeps the common "nothing to do" case entirely
  // synchronous — no request, no timer, no keepAlive registration.
  const list = normalizeUrls(urls);
  if (!list.length) return Promise.resolve({ ok: true, skipped: 'no submittable URLs', submitted: 0, batches: [] });

  return keepAlive(submitIndexNow(list, { ...opts, env }));
}
