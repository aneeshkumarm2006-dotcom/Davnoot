/* GET   /api/admin/seo   — every URL on the site (pages + posts) in one table.
 * PATCH /api/admin/seo   — inline-edit ONE whitelisted SEO field on one row.
 *
 * The PATCH is the sharp edge: dotted-path $set is the canonical Mongo
 * mass-assignment vector, so the field key is NEVER taken from the client. Only
 * SEO_PATCH_FIELDS may be written, each value validated by seoSchema first, and
 * the dotted set can structurally never reach `blocks` or `sections`. (C1)
 */
import { withErrors, methods, readJson, validationError, ApiError } from '../../../lib/api.js';
import { requireRole } from '../../../lib/auth.js';
import { pages, posts } from '../../../lib/db.js';
import { COMPILED_PAGES } from '../../../lib/compiled-pages.gen.js';
import { effectiveTitle, effectiveDescription } from '../../../lib/page-render.js';
import { SEO_PATCH_FIELDS } from '../../../lib/page-model.js';
import { seoSchema, fieldErrors } from '../../../lib/validators.js';
import { isSeoReady, scorePost, IDEAL } from '../../../lib/seo-score.js';
import { audit } from '../../../lib/audit.js';

async function list(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const [pageDocs, postDocs] = await Promise.all([
    (await pages()).find({}).toArray(),
    (await posts()).find({}).project({ title: 1, slug: 1, status: 1, seo: 1, excerpt: 1, content: 1 }).toArray(),
  ]);
  const byPath = new Map(pageDocs.map((d) => [d.path, d]));

  const rows = [];

  // The 8 overlay pages always exist; a composed page only if it has a document.
  for (const tpl of Object.values(COMPILED_PAGES)) {
    const doc = byPath.get(tpl.path);
    rows.push(pageRow(tpl, doc));
  }
  for (const d of pageDocs) {
    if (d.base === null) rows.push(composedRow(d));
  }
  for (const p of postDocs) rows.push(postRow(p));

  res.status(200).json({ rows });
}

function pageRow(tpl, doc) {
  const seo = doc?.draft?.seo || {};
  const title = effectiveTitle(tpl, doc ? { content: doc.draft } : null);
  const desc = effectiveDescription(tpl, doc ? { content: doc.draft } : null);
  return {
    type: 'page',
    key: tpl.file,
    url: tpl.path,
    editUrl: `/admin/pages/${tpl.file}`,
    title,
    metaTitle: seo.metaTitle || '',
    metaDescription: seo.metaDescription || desc,
    focusKeyword: seo.focusKeyword || '',
    robotsIndex: seo.robotsIndex,
    canonicalUrl: seo.canonicalUrl || '',
    ogImage: seo.ogImage || '',
    inSitemap: doc?.draft?.sitemap?.include !== false,
    status: doc?.status || 'live',
    titleLen: (seo.metaTitle || title || '').length,
    descLen: (seo.metaDescription || desc || '').length,
    seoReady: metaReady(seo.metaTitle || title, seo.metaDescription || desc),
    hasDoc: !!doc,
  };
}

function composedRow(d) {
  const seo = d.draft?.seo || {};
  return {
    type: 'page',
    key: d.slug,
    url: d.path,
    editUrl: `/admin/pages/${d.slug}`,
    title: d.draft?.title || d.slug,
    metaTitle: seo.metaTitle || '',
    metaDescription: seo.metaDescription || '',
    focusKeyword: seo.focusKeyword || '',
    robotsIndex: seo.robotsIndex,
    canonicalUrl: seo.canonicalUrl || '',
    ogImage: seo.ogImage || '',
    inSitemap: d.draft?.sitemap?.include !== false,
    status: d.status,
    titleLen: (seo.metaTitle || '').length,
    descLen: (seo.metaDescription || '').length,
    seoReady: metaReady(seo.metaTitle, seo.metaDescription),
    hasDoc: true,
  };
}

function postRow(p) {
  const seo = p.seo || {};
  const title = seo.metaTitle || p.title || '';
  const desc = seo.metaDescription || p.excerpt || '';
  return {
    type: 'post',
    key: String(p._id),
    url: `/blog/${p.slug}`,
    editUrl: `/seoteam/${p._id}`,
    title: p.title,
    metaTitle: seo.metaTitle || '',
    metaDescription: seo.metaDescription || '',
    focusKeyword: seo.focusKeyword || '',
    robotsIndex: seo.robotsIndex,
    canonicalUrl: seo.canonicalUrl || '',
    ogImage: seo.ogImage || '',
    inSitemap: p.status === 'published',
    status: p.status,
    titleLen: title.length,
    descLen: desc.length,
    seoReady: isSeoReady(scorePost(p).checks),
    hasDoc: true,
  };
}

/** A light title/description readiness for pages (no body to score). */
function metaReady(title, desc) {
  const t = (title || '').length;
  const d = (desc || '').length;
  return t >= IDEAL.titleMin && t <= IDEAL.titleMax && d >= IDEAL.descMin && d <= IDEAL.descMax;
}

async function patch(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const body = await readJson(req);
  const { type, key, field } = body || {};
  let { value } = body || {};

  if (!SEO_PATCH_FIELDS.has(field)) throw new ApiError(400, `Field "${field}" is not editable here.`);

  // Validate the VALUE through the real schema before it can touch Mongo. We build
  // a partial seo object and parse it, so triStateBool / optUrl / caps all apply.
  if (field.startsWith('seo.')) {
    const seoField = field.slice(4);
    const probe = seoSchema.safeParse({ [seoField]: value });
    if (!probe.success) throw validationError({ [field]: fieldErrors(probe.error)[seoField] || 'Invalid value.' });
    value = probe.data ? probe.data[seoField] : undefined; // normalized ('' -> undefined, etc.)
  } else if (field.startsWith('sitemap.')) {
    if (type === 'post') throw new ApiError(400, 'A post is in the sitemap when it is published.');
    value = normalizeSitemap(field.slice(8), value);
  }

  if (type === 'post') return patchPost(res, session, key, field, value);
  return patchPage(res, session, key, field, value);
}

const CHANGEFREQ = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
function normalizeSitemap(sub, value) {
  if (sub === 'include') return value === false || value === 'false' ? false : true;
  if (sub === 'priority') {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0 || n > 1) throw new ApiError(400, 'Priority must be between 0.0 and 1.0.');
    return n.toFixed(1);
  }
  if (sub === 'changefreq') {
    if (value && !CHANGEFREQ.has(value)) throw new ApiError(400, 'Invalid change frequency.');
    return value || undefined;
  }
  throw new ApiError(400, 'Unknown sitemap field.');
}

function opsFor(field, value, prefix) {
  const path = prefix + field;
  return value === undefined || value === null
    ? { $unset: { [path]: '' }, $set: { updatedAt: new Date() } }
    : { $set: { [path]: value, updatedAt: new Date() } };
}

async function patchPage(res, session, key, field, value) {
  const tpl = COMPILED_PAGES[key];
  const path = tpl ? tpl.path : '/' + String(key).replace(/^\/+/, '');
  const col = await pages();
  const existing = await col.findOne({ path });

  // Overlay page with no doc yet: create one so the SEO edit has somewhere to live.
  if (!existing) {
    if (!tpl) throw new ApiError(404, 'No such page.');
    const now = new Date();
    await col.insertOne({
      base: key, path, kind: tpl.kind, locale: 'en', translationOf: null, locked: true,
      status: 'live', publishedAt: now, hasUnpublishedChanges: true,
      live: undefined, draft: {}, version: 1, createdAt: now, updatedAt: now, updatedBy: session.role,
    });
  }
  // SEO edits land on the DRAFT (they go live on publish, like every other edit).
  await col.updateOne({ path }, opsFor(field, value, 'draft.'), { });
  await col.updateOne({ path }, { $set: { hasUnpublishedChanges: true } });
  audit(session, 'seo.patch', path, `${field} updated`);
  res.status(200).json({ ok: true });
}

async function patchPost(res, session, id, field, value) {
  const { ObjectId } = await import('mongodb');
  let _id;
  try { _id = new ObjectId(id); } catch { throw new ApiError(400, 'Bad post id.'); }
  const col = await posts();
  // A dotted $set on seo.* structurally cannot reach `blocks`/`content` — Invariant 3
  // is never at risk from this surface.
  const r = await col.updateOne({ _id }, opsFor(field, value, ''));
  if (r.matchedCount === 0) throw new ApiError(404, 'No such post.');
  audit(session, 'seo.patch', `/blog post ${id}`, `${field} updated`);
  res.status(200).json({ ok: true });
}

export default withErrors(methods({ GET: list, PATCH: patch }));
