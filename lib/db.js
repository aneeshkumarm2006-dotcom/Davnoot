/* MongoDB connection + collection accessors.
 *
 * Serverless note: every warm Vercel function invocation reuses the same Node
 * process, so we must NOT open a new MongoClient per request — that exhausts
 * Atlas's connection pool under any real traffic. We cache the connection
 * promise on globalThis (not a module-local, which module reloads can drop) and
 * await the same promise on every invocation.
 *
 * We cache the *promise*, not the resolved client, so that concurrent cold
 * invocations racing to connect all await one in-flight connect() rather than
 * each starting their own.
 */
import { MongoClient } from 'mongodb';

const URI = process.env.MONGODB_URI;

/* Which database does this deployment write to?
 *
 * THE HAZARD: a Vercel PREVIEW deployment (every branch push, every contractor PR)
 * inherits Production environment variables unless each is scoped per-environment.
 * So an /admin running on a preview URL would, by default, read and PUBLISH to the
 * PRODUCTION page collection — a contractor's throwaway branch mutating live copy.
 *
 * FAIL CLOSED: only VERCEL_ENV === 'production' is allowed to touch the configured
 * production database. On a preview deploy we IGNORE the (inherited, prod-pointing)
 * MONGODB_DB and derive an isolated `<name>_preview` database instead, unless an
 * explicit MONGODB_DB_PREVIEW is set. Local dev and tests (VERCEL_ENV unset) keep
 * honouring MONGODB_DB so `npm run dev` shows real content and the suite is stable.
 */
export function resolveDbName(env = process.env) {
  if (env.VERCEL_ENV === 'preview') {
    return env.MONGODB_DB_PREVIEW || `${env.MONGODB_DB || 'davnoot'}_preview`;
  }
  return env.MONGODB_DB || 'davnoot';
}
const DB_NAME = resolveDbName();

/** True on a Vercel preview deploy — the admin shell shows a red "editing preview" banner. */
export const IS_PREVIEW_ENV = process.env.VERCEL_ENV === 'preview';

const g = globalThis;

function clientPromise() {
  if (!URI) {
    throw new Error('MONGODB_URI is not set. Add it in Vercel → Settings → Environment Variables.');
  }
  if (!g.__davnootMongo) {
    const client = new MongoClient(URI, {
      // Keep the pool small: Vercel runs many isolated instances, each with its
      // own pool, and Atlas's shared tiers cap total connections aggressively.
      maxPoolSize: 5,
      retryWrites: true,

      // A page renderer and the sitemap have no business waiting the driver's
      // DEFAULT 30s to discover a server. api/page.js and api/sitemap.js each also
      // race their reads against a ~2s app-level timeout, but that only bounds the
      // read they issue AFTER the connect resolves — a cold/broken Atlas would still
      // block inside connect() for 30s (a 504, the opposite of graceful degradation).
      // Capping server selection + connect at 2s makes the connect itself fail fast,
      // so the app-level fallback (base template / compiled sitemap) actually fires.
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,

      // CRITICAL for the tri-state robots fields (Invariant 1). By default the
      // driver serializes `undefined` as NULL, so `{ robotsIndex: undefined }`
      // would persist as `robotsIndex: null` — a value, not an absence. With
      // ignoreUndefined, the key is simply omitted, which is what "emit no robots
      // directive" actually means. lib/post-write.js prunes undefined as well;
      // this is the belt to that pair of braces.
      ignoreUndefined: true,
    });
    g.__davnootMongo = client.connect().catch((err) => {
      // Don't cache a failed connection — otherwise every subsequent request on
      // this warm instance replays the same rejection forever.
      g.__davnootMongo = undefined;
      throw err;
    });
  }
  return g.__davnootMongo;
}

export async function getDb() {
  const client = await clientPromise();
  return client.db(DB_NAME);
}

export async function posts() {
  return (await getDb()).collection('posts');
}

export async function media() {
  return (await getDb()).collection('media');
}

export async function loginAttempts() {
  return (await getDb()).collection('login_attempts');
}

export async function leads() {
  return (await getDb()).collection('leads');
}

/* ---- CMS: the /admin website-manager collections ------------------------- */

export async function pages() {
  return (await getDb()).collection('pages');
}

export async function pageRevisions() {
  return (await getDb()).collection('page_revisions');
}

export async function redirects() {
  return (await getDb()).collection('redirects');
}

export async function pageLayouts() {
  return (await getDb()).collection('page_layouts');
}

export async function auditLog() {
  return (await getDb()).collection('audit');
}

/** The site-settings singleton lives in its own collection, one document (_id:'site'). */
export async function settings() {
  return (await getDb()).collection('settings');
}

/* ---------------------------------------------------------------------------
 * Indexes
 * -------------------------------------------------------------------------
 * Called from the ensure-indexes script (npm run db:indexes). Safe to re-run —
 * createIndex is idempotent when the spec matches.
 */
export async function ensureIndexes() {
  const p = await posts();
  await p.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });
  await p.createIndex({ status: 1, publishedAt: -1 }, { name: 'status_publishedAt' });
  await p.createIndex({ tags: 1 }, { name: 'tags' });
  await p.createIndex(
    { title: 'text', excerpt: 'text', tags: 'text' },
    { name: 'post_search', weights: { title: 10, excerpt: 4, tags: 2 } },
  );

  const m = await media();
  // url is the natural key for media — the same image must never be registered
  // twice, whether it arrived by upload, URL import, or the post-scan discovery.
  await m.createIndex({ url: 1 }, { unique: true, name: 'url_unique' });
  await m.createIndex({ folder: 1 }, { name: 'folder' });
  await m.createIndex({ tags: 1 }, { name: 'media_tags' });
  await m.createIndex({ createdAt: -1 }, { name: 'media_created' });

  // Login throttling. Rate limiting lives in Mongo rather than in a module-level
  // Map because serverless gives every concurrent instance its OWN memory — an
  // in-process counter is trivially defeated by the platform simply scaling out.
  // The TTL index expires each attempt 15 minutes after it was recorded, so the
  // window cleans itself and the collection can't grow without bound.
  const la = await loginAttempts();
  await la.createIndex({ at: 1 }, { name: 'attempt_ttl', expireAfterSeconds: 15 * 60 });
  await la.createIndex({ ip: 1, at: -1 }, { name: 'ip_at' });

  // Booking leads. The booking form persists here BEFORE emailing, so a Resend
  // outage can never lose a lead. status defaults to 'new'; emailSent records
  // whether the notification went out, so the admin can retry the ones that didn't.
  const l = await leads();
  await l.createIndex({ createdAt: -1 }, { name: 'leads_created' });
  await l.createIndex({ status: 1, createdAt: -1 }, { name: 'leads_status_created' });
  await l.createIndex({ emailSent: 1 }, { name: 'leads_email_sent' });

  // CMS pages. `path` is the URL and the natural key — one document per URL.
  const pg = await pages();
  await pg.createIndex({ path: 1 }, { unique: true, name: 'page_path_unique' });
  await pg.createIndex({ status: 1, updatedAt: -1 }, { name: 'page_status_updated' });
  await pg.createIndex({ base: 1 }, { name: 'page_base' });
  await pg.createIndex({ locale: 1 }, { name: 'page_locale' });

  // Revisions: the pre-image before each save. Bounded per page in app code;
  // a TTL sweeps anything older than 180 days so the collection can't grow forever.
  const rev = await pageRevisions();
  await rev.createIndex({ pageId: 1, version: -1 }, { name: 'rev_page_version' });
  await rev.createIndex({ at: 1 }, { name: 'rev_ttl', expireAfterSeconds: 180 * 24 * 60 * 60 });

  // Redirects, applied by api/page.js on the 404 path. `source` is the unique key.
  const rd = await redirects();
  await rd.createIndex({ source: 1 }, { unique: true, name: 'redirect_source_unique' });

  // Saved layout templates.
  const pl = await pageLayouts();
  await pl.createIndex({ createdAt: -1 }, { name: 'layout_created' });

  // Audit log — who/what/when. TTL 365 days.
  const au = await auditLog();
  await au.createIndex({ at: -1 }, { name: 'audit_at' });
  await au.createIndex({ at: 1 }, { name: 'audit_ttl', expireAfterSeconds: 365 * 24 * 60 * 60 });
  await au.createIndex({ target: 1, at: -1 }, { name: 'audit_target' });

  // Settings singleton — _id is the fixed string 'site', so no index is needed
  // beyond the default _id one. Accessor exists for symmetry.
}
