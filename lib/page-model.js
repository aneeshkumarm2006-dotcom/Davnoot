/* The page document model — validation + the draft/live write logic.
 *
 * A page holds TWO content states: `live` (what api/page.js serves) and `draft`
 * (what the editor and preview render). Editing writes to `draft`; publishing
 * copies draft -> live and snapshots a revision. Without this split, autosave
 * would publish every keystroke to the live homepage, and switching a page to
 * "draft" would revert the live page to its base template. See BLOG.md / the plan.
 *
 * Reuses lib/validators.js's seoSchema and helpers so the SAME SEO object hangs
 * off a page and a post — one schema, one scorer, one structured-data builder.
 */
import { z } from 'zod';
import { seoSchema } from './validators.js';
import { sanitizeInline, sanitizeBody, sanitizeSection } from './sanitize.js';
import { composedFieldKind } from './section-fields.gen.js';

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const blank = (v) => (isBlank(v) ? undefined : v);
const optStr = (max) => z.preprocess(blank, z.string().trim().max(max).optional());

/* ------------------------------------------------------------------ content -- */

// A section carries field overrides for an overlay page, or a full library
// section for a composed page. `fields` values are sanitized by slot kind in the
// write step (sanitizeContentFields), NOT here — zod doesn't know the slot kinds.
const sectionSchema = z
  .object({
    // Optional: overlay sections carry a compiled-hole id ('overlay'); composed
    // library sections are keyed by `type` and don't need one, though the editor
    // assigns a stable id for reorder identity when it can.
    id: z.string().trim().min(1).max(64).optional(),
    source: z.enum(['base', 'library']).default('base'),
    type: optStr(60),
    hidden: z.boolean().optional(),
    widget: optStr(40),
    fields: z.record(z.string().max(80), z.any()).optional(),
    items: z.array(z.record(z.string().max(80), z.any())).max(60).optional(),
    html: optStr(50_000), // raw-section escape hatch, sanitizeSection()'d on write
  })
  .strip();

const sitemapSchema = z
  .object({
    include: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.boolean().optional()),
    priority: optStr(4),
    changefreq: z.preprocess(blank, z.enum(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).optional()),
  })
  .strip()
  .optional();

/** The editable content payload (one state — draft or live). */
export const pageContentSchema = z
  .object({
    title: optStr(300), // admin label + JSON-LD name; NEVER reaches <title>
    excerpt: optStr(1000),
    sections: z.array(sectionSchema).max(120).optional(),
    seo: seoSchema,
    sitemap: sitemapSchema,
    intro: z.preprocess((v) => (v === '' ? null : v), z.string().max(64).nullable().optional()),
    bodyClass: optStr(200),
  })
  .strict();

/* --------------------------------------------------------------- page-level -- */

const PAGE_KINDS = ['home', 'service', 'landing', 'legal', 'contact', 'caseStudy'];

/** Create a NEW composed page (base is null; sections come from the library). */
export const pageCreateSchema = z
  .object({
    slug: z.string().trim().min(1, 'A URL slug is required').max(96)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens'),
    title: optStr(300),
    kind: z.enum(PAGE_KINDS).default('landing'),
    locale: z.preprocess(blank, z.string().max(10).optional()),
    template: optStr(60), // a page_layouts id, or a built-in template name
  })
  .strict();

/** Update the draft content of an existing page. */
export const pageUpdateSchema = pageContentSchema;

export const PAGE_STATUS = ['draft', 'live', 'archived'];

/* ---------------------------------------------------- field sanitization ---- */

/**
 * Sanitize section field values by their slot KIND. inline -> accent tags only,
 * richtext -> full body allowlist, raw/html -> SVG-aware section allowlist, and
 * text/url/image are left raw (they are esc()'d at render). Unknown kinds default
 * to inline (safe: strips scripts, keeps accent tags).
 *
 * @param content  a validated content object
 * @param tpl      the compiled template (COMPILED_PAGES[base]) or null for composed
 */
export function sanitizeContentFields(content, tpl) {
  if (!content?.sections) return content;
  for (const section of content.sections) {
    if (section.html != null) section.html = sanitizeSection(section.html);
    // OVERLAY page (tpl set): kinds come from the compiled template's slots, keyed by
    // the compiled hole key. COMPOSED page (tpl null): kinds come from the section
    // library's field schema, keyed by (section.type, fieldKey). Without the composed
    // branch every field on a new page would default to 'inline' — fine for safety,
    // but it would strip an author's intended richtext/list markup.
    const kindOf = tpl ? buildKindLookup(tpl) : (key) => composedFieldKind(section.type, key);
    if (section.fields) sanitizeFieldMap(section.fields, kindOf);
    for (const item of section.items || []) sanitizeFieldMap(item, kindOf);
  }
  return content;
}

function buildKindLookup(tpl) {
  const map = new Map();
  for (const slot of tpl?.slots || []) map.set(slot.key, slot.kind);
  return (key) => map.get(key) || 'inline';
}

function sanitizeFieldMap(fields, kindOf) {
  for (const [key, value] of Object.entries(fields)) {
    const kind = kindOf(key);
    // An inline-list (e.g. a pricing tier's "includes") is an array of inline strings.
    if (kind === 'inline-list' && Array.isArray(value)) {
      fields[key] = value.filter((v) => typeof v === 'string').map((v) => sanitizeInline(v));
      continue;
    }
    if (typeof value !== 'string') continue; // bool/number/nested — nothing to sanitize
    if (kind === 'richtext') fields[key] = sanitizeBody(value);
    else if (kind === 'section' || kind === 'html' || kind === 'raw') fields[key] = sanitizeSection(value);
    else if (kind === 'text' || kind === 'url' || kind === 'image') fields[key] = value; // esc()'d at render
    else fields[key] = sanitizeInline(value);
  }
}

/* --------------------------------------------------------- SEO PATCH (C1) --- */

/**
 * The whitelist for the global SEO manager's inline PATCH. The field key is NEVER
 * taken from the client — dotted-path $set is the canonical Mongo mass-assignment
 * vector. Only these keys may be written, and each value is validated by seoSchema
 * before it reaches Mongo. A key not in this set is rejected.
 */
export const SEO_PATCH_FIELDS = new Set([
  'seo.metaTitle', 'seo.metaDescription', 'seo.focusKeyword',
  'seo.canonicalUrl', 'seo.ogTitle', 'seo.ogDescription', 'seo.ogImage',
  'seo.robotsIndex', 'seo.robotsFollow',
  'sitemap.include', 'sitemap.priority', 'sitemap.changefreq',
]);

/* -------------------------------------------------- draft/live write logic -- */

/**
 * Build the update ops for saving DRAFT content (autosave / editor save).
 * Everything the editor sends lands under `draft.*`. `live` is untouched until publish.
 *
 * Three-state on sections (Invariant 3): absent from the raw body -> leave alone;
 * [] or null -> clear; a value -> set. So a metadata-only save can't wipe layout.
 */
export function buildDraftUpdate(validated, rawBody = {}) {
  const $set = { updatedAt: new Date(), hasUnpublishedChanges: true };
  const $unset = {};

  // Simple content fields the editor owns wholesale.
  for (const key of ['title', 'excerpt', 'seo', 'sitemap', 'intro', 'bodyClass']) {
    if (!Object.prototype.hasOwnProperty.call(rawBody, key)) continue; // absent -> leave alone
    const value = validated[key];
    if (value === undefined || value === null) $unset[`draft.${key}`] = '';
    else $set[`draft.${key}`] = value;
  }

  // Sections: presence from raw, value from validated (never write past the schema).
  if (Object.prototype.hasOwnProperty.call(rawBody, 'sections')) {
    const sections = validated.sections;
    if (sections === undefined || sections === null) $unset['draft.sections'] = '';
    else $set['draft.sections'] = sections; // [] lands here -> author cleared the layout
  }

  const ops = { $set };
  if (Object.keys($unset).length) ops.$unset = $unset;
  return ops;
}

/**
 * Publish: copy draft -> live, stamp publishedAt, clear the dirty flag, bump version.
 * A future publishedAt schedules; the public read filter hides it until then.
 */
export function buildPublishOps(existing, { now = new Date(), scheduledAt } = {}) {
  const draft = existing?.draft || {};
  // A scheduled (future) page is still status:'live'; livePageFilter hides it until
  // publishedAt arrives, so scheduling needs no cron — the read filter does it.
  const publishedAt = resolvePublishAt(existing?.publishedAt, scheduledAt, now);
  return {
    $set: { live: draft, status: 'live', publishedAt, hasUnpublishedChanges: false, updatedAt: now },
    $inc: { version: 1 },
  };
}

function resolvePublishAt(existing, scheduledAt, now) {
  if (scheduledAt instanceof Date) return scheduledAt; // explicit schedule/backdate wins
  if (existing instanceof Date && existing.getTime() <= now.getTime()) return existing;
  return now;
}

/** The public read filter — live, published, and not scheduled into the future. */
export function livePageFilter(now = new Date()) {
  return {
    status: 'live',
    $or: [{ publishedAt: { $exists: false } }, { publishedAt: { $lte: now } }],
  };
}

/**
 * Is this document's LIVE content being served right now? The in-code twin of
 * livePageFilter, used where the caller must ALSO see non-live states (e.g.
 * api/page.js must distinguish 'archived' → 410 from 'draft' → base template, and
 * a Mongo filter that hides both would make them indistinguishable). A page with a
 * future publishedAt is scheduled, so not yet live.
 */
export function isPageLive(doc, now = new Date()) {
  if (!doc || doc.status !== 'live') return false;
  if (!doc.publishedAt) return true;
  const at = doc.publishedAt instanceof Date ? doc.publishedAt : new Date(doc.publishedAt);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}

/** Build a fresh composed-page document. */
export function buildPageInsert(meta, content, { now = new Date(), updatedBy = 'admin' } = {}) {
  return {
    base: null,
    path: '/' + meta.slug,
    slug: meta.slug,
    kind: meta.kind,
    locale: meta.locale || 'en',
    translationOf: null,
    locked: false,
    status: 'draft',
    publishedAt: undefined,
    hasUnpublishedChanges: true,
    live: undefined,
    draft: content || { title: meta.title, sections: [] },
    version: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy,
  };
}
