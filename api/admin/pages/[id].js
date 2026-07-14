/* GET    /api/admin/pages/:key   — the editor payload (draft content + slots).
 * PUT    /api/admin/pages/:key   — save DRAFT content (autosave / manual save).
 * DELETE /api/admin/pages/:key   — delete a composed page (admin only, unlocked).
 *
 * `key` is the file for an overlay page ('seo.html') or the slug for a composed
 * page ('pricing'). Middleware is not the boundary — every method re-checks role.
 */
import { withErrors, methods, readJson, validationError, ApiError } from '../../../lib/api.js';
import { requireRole } from '../../../lib/auth.js';
import { pages } from '../../../lib/db.js';
import { COMPILED_PAGES } from '../../../lib/compiled-pages.gen.js';
import {
  pageUpdateSchema,
  buildDraftUpdate,
  sanitizeContentFields,
} from '../../../lib/page-model.js';
import { fieldErrors } from '../../../lib/validators.js';
import { audit, snapshotRevision } from '../../../lib/audit.js';

/** Resolve a key into { tpl, path, kind, base }. tpl is null for composed pages. */
function resolve(key) {
  const tpl = COMPILED_PAGES[key];
  if (tpl) return { tpl, path: tpl.path, kind: tpl.kind, base: key };
  return { tpl: null, path: '/' + String(key).replace(/^\/+/, ''), kind: 'landing', base: null };
}

async function get(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const { tpl, path, base } = resolve(req.query.id);
  if (!tpl && !isSlug(req.query.id)) throw new ApiError(404, 'No such page.');

  const doc = await (await pages()).findOne({ path });
  if (!tpl && !doc) throw new ApiError(404, 'No such page.');

  res.status(200).json({
    key: req.query.id,
    path,
    base,
    kind: doc?.kind || (tpl ? tpl.kind : 'landing'),
    locked: doc?.locked ?? !!base,
    status: doc?.status || (base ? 'live' : 'draft'),
    hasUnpublishedChanges: doc?.hasUnpublishedChanges || false,
    version: doc?.version || 0,
    // The editor edits the DRAFT. For an overlay page never touched, draft is empty
    // and the form is seeded from the template's slot defaults on the client.
    draft: doc?.draft || { title: '', sections: [] },
    live: doc?.live || null,
    // Slot metadata drives the content form for overlay pages.
    slots: tpl ? tpl.slots : [],
  });
}

async function put(req, res) {
  const session = await requireRole(req, res, 'admin', 'editor');
  if (!session) return;

  const { tpl, path, kind, base } = resolve(req.query.id);
  const rawBody = await readJson(req);
  const expected = clientVersion(req, rawBody);
  delete rawBody.__version; // concurrency token, not content — strip before the strict schema
  const parsed = pageUpdateSchema.safeParse(rawBody);
  if (!parsed.success) throw validationError(fieldErrors(parsed.error));

  // Sanitize every author-supplied field by its slot kind BEFORE it reaches Mongo.
  const content = sanitizeContentFields(parsed.data, tpl);
  const col = await pages();
  const existing = await col.findOne({ path });

  if (!existing) {
    if (!tpl && !isSlug(req.query.id)) throw new ApiError(404, 'No such page.');
    // Lazily create the document on first edit. live is left undefined, so the
    // public page keeps rendering the compiled defaults until the author publishes.
    const now = new Date();
    const doc = {
      base,
      path,
      slug: base ? undefined : req.query.id,
      kind,
      locale: 'en',
      translationOf: null,
      locked: !!base,
      status: base ? 'live' : 'draft', // an overlay page is always live; its live=undefined renders defaults
      publishedAt: base ? now : undefined,
      hasUnpublishedChanges: true,
      live: undefined,
      draft: draftFrom(content),
      version: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: session.role,
    };
    await col.insertOne(doc); // unique index on path -> 409 on a create race
    audit(session, 'page.draft', path, 'first draft saved');
    return res.status(200).json({ ok: true, version: 1, hasUnpublishedChanges: true });
  }

  // Optimistic concurrency: the client sends the version it loaded. A stale write
  // (someone else saved first) 409s instead of silently clobbering their work.
  if (expected != null && existing.version != null && expected !== existing.version) {
    throw new ApiError(409, 'Someone else saved this page. Reload to see their changes.');
  }

  await snapshotRevision(existing, session); // pre-image before we overwrite the draft
  const ops = buildDraftUpdate(content, rawBody);
  ops.$inc = { version: 1 };
  const r = await col.updateOne({ path, version: existing.version }, ops);
  if (r.matchedCount === 0) throw new ApiError(409, 'Someone else saved this page. Reload to see their changes.');
  audit(session, 'page.draft', path, 'draft saved');
  res.status(200).json({ ok: true, version: (existing.version || 0) + 1, hasUnpublishedChanges: true });
}

async function del(req, res) {
  const session = await requireRole(req, res, 'admin'); // delete is admin-only
  if (!session) return;

  const { tpl, path } = resolve(req.query.id);
  if (tpl) throw new ApiError(403, 'The core marketing pages cannot be deleted from here.');

  const col = await pages();
  const existing = await col.findOne({ path });
  if (!existing) throw new ApiError(404, 'No such page.');
  if (existing.locked) throw new ApiError(403, 'This page is locked.');

  await snapshotRevision(existing, session);
  await col.deleteOne({ path });
  audit(session, 'page.delete', path, `deleted ${path}`);
  res.status(200).json({ ok: true });
}

function draftFrom(content) {
  // The draft is exactly the validated content object.
  return { ...content };
}
function isSlug(s) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(s || ''));
}
function clientVersion(req, body) {
  const h = req.headers['if-match'];
  if (h != null && h !== '') return Number(h);
  if (body && body.__version != null) return Number(body.__version);
  return null;
}

export default withErrors(methods({ GET: get, PUT: put, DELETE: del }));
