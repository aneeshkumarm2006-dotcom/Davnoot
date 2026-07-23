/* Zod schemas — the ONLY thing between a request body and the database.
 *
 * Every write path (POST, PUT, PATCH) parses through here BEFORE touching Mongo.
 * Mongo is schema-less: if this file lets it through, it lands in the document.
 *
 * =========================================================================
 * FOUR RULES THAT LOOK LIKE NITPICKS AND ARE NOT
 * =========================================================================
 *
 * 1. TRI-STATE ROBOTS — read this before you touch robotsIndex/robotsFollow.
 *    They have THREE states, and `undefined` is a real one:
 *        undefined -> emit NO robots meta tag at all   (the default; what every
 *                     pre-existing post has)
 *        true      -> index / follow
 *        false     -> noindex / nofollow
 *    There is NO `.default()` on these fields, and there must never be one — not
 *    here, not in the serializer, not in the metadata builder. A blank form value
 *    coerced through Boolean("") becomes `false`, which means `noindex`, which
 *    de-indexes every post that never set the field — i.e. all of them — on the
 *    next deploy. Do not "tidy" this into z.coerce.boolean().
 *
 * 2. "" -> undefined, BEFORE coercion, everywhere.
 *    HTML forms submit "" for every untouched optional field. Without this
 *    normalization an optional URL fails validation ("" is not a URL) and an
 *    optional number silently persists as 0.
 *
 * 3. CAPS HERE ARE GUARDRAILS, NOT STYLE ADVICE.
 *    metaTitle is capped at 120, not 60. The 50–60 ideal is surfaced as a
 *    WARNING in the editor (lib/seo-score.js), never as a save-blocking error.
 *    If you tighten this to 60, some day an author edits a typo in a long-published
 *    post and simply cannot save it, because a title written months ago now fails
 *    validation. Blocking must mean "this would corrupt data", not "I'd have
 *    written it differently".
 *
 * 4. BLANK ROWS ARE DROPPED, PARTIAL ROWS ERROR.
 *    The keyword-backlink editor always keeps one trailing empty row. A row with
 *    every field blank is stripped before validation. A row with SOME fields
 *    filled still errors — so a half-typed link surfaces as "finish this row"
 *    rather than vanishing on save.
 *
 * =========================================================================
 * NOT IN THIS FILE, ON PURPOSE
 * =========================================================================
 *   views, readingTimeMinutes, createdAt, updatedAt   — SERVER-MANAGED. They are
 *   absent from every input schema so that a crafted payload can never set them.
 *   The API computes them; the client only ever reads them.
 *
 *   blocks, structuredData   — not shipped in v1 (no UI writes them). They are on
 *   the PRESERVE_KEYS list in lib/post-write.js so that a save from this dashboard
 *   can never delete them if a future surface starts writing them. When you add
 *   the block editor, add the discriminated union here — and remember that this
 *   union is the only thing stopping arbitrary JSON from landing in `block.data`.
 */
import { z } from 'zod';
import { blocksSchema } from './blocks.js';

/* ---------------------------------------------------------------- helpers -- */

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/** "" / null / whitespace -> undefined. Applied BEFORE any coercion. See rule 2. */
const blank = (v) => (isBlank(v) ? undefined : v);

const optStr = (max) => z.preprocess(blank, z.string().trim().max(max).optional());

const optUrl = (max = 2048) =>
  z.preprocess(
    blank,
    z.string().trim().max(max).url('Must be a full URL, including https://').optional(),
  );

/**
 * TRI-STATE BOOLEAN. See rule 1. No .default(), ever.
 * `null` is treated as "clear it" -> undefined -> the field is $unset on save ->
 * no directive is emitted. That is the intended way to go back to the default.
 */
const triStateBool = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.boolean().optional());

/** An array of non-empty strings. Accepts a comma-separated string too (tag inputs). */
const stringList = (max = 50, itemMax = 80) =>
  z.preprocess((v) => {
    if (typeof v === 'string') v = v.split(',');
    if (!Array.isArray(v)) return v;
    const cleaned = v.map((s) => String(s ?? '').trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }, z.array(z.string().max(itemMax)).max(max).optional());

/**
 * Date field. Accepts an ISO string, a Date, or nothing.
 * A malformed value is passed THROUGH to z.date() so it produces a proper field
 * error, rather than being silently swallowed into undefined.
 */
const optDate = z.preprocess((v) => {
  if (isBlank(v)) return undefined;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d;
}, z.date().optional());

/* ------------------------------------------------------------------- SEO --- */

/**
 * The SEO block — an embedded, reusable object. It is deliberately NOT
 * blog-specific, so the same schema can hang off a service page or a case study
 * later without a rewrite.
 */
export const seoSchema = z
  .object({
    // Guardrail caps (rule 3). The IDEALs live in lib/seo-score.js as warnings.
    metaTitle: optStr(120),
    metaDescription: optStr(320),
    ogImage: optUrl(),
    keywords: stringList(30),

    // OG title/description are SEPARATE from metaTitle/metaDescription and must
    // stay that way. See lib/blog-render.js — a metadata builder treats a custom
    // meta title as ABSOLUTE (no " — Davnoot" suffix), so letting a social
    // headline leak into metaTitle strips the branding off every search result.
    ogTitle: optStr(120),
    ogDescription: optStr(320),
    twitterCard: z.preprocess(blank, z.enum(['summary', 'summary_large_image']).optional()),

    // Format-validated here; ORIGIN-validated at render time (lib/blog-render.js).
    // A cross-origin canonical silently de-indexes the page that sets it, so the
    // renderer ignores any canonical whose origin isn't ours. We still store what
    // the author typed, and the editor warns them — we don't reject the save,
    // because a legitimate syndication canonical is a real (rare) use case and a
    // hard reject here would be unfixable from the UI.
    canonicalUrl: optUrl(),

    robotsIndex: triStateBool, // <- NO DEFAULT. Rule 1.
    robotsFollow: triStateBool, // <- NO DEFAULT. Rule 1.

    focusKeyword: optStr(120),
  })
  .strict()
  .optional();

/* -------------------------------------------------------- keyword backlinks -- */

export const REL_VALUES = ['dofollow', 'nofollow', 'sponsored'];

const backlinkRow = z.object({
  keyword: z.string().trim().min(1, 'Keyword is required').max(120),
  url: z.string().trim().min(1, 'URL is required').max(2048).url('Must be a full URL, including https://'),
  rel: z.enum(REL_VALUES).default('dofollow'),
});

/** See rule 4: fully-blank rows are dropped; partially-filled rows still error. */
const backlinkList = z.preprocess((v) => {
  if (!Array.isArray(v)) return v;
  return v.filter((r) => r && !(isBlank(r.keyword) && isBlank(r.url)));
}, z.array(backlinkRow).max(100).optional());

/* -------------------------------------------------------- structured data --- */

const structuredDataObject = z
  .object({
    disabledTypes: stringList(20, 60),
    fieldOverrides: z.record(z.string(), z.record(z.string(), z.any())).optional(),

    /**
     * Raw JSON-LD, as typed by the author.
     *
     * It MUST parse before the save is allowed. Storing an unparseable blob would
     * emit a broken <script type="application/ld+json"> on a live page — which
     * Google reports as invalid structured data, and which the author would only
     * discover weeks later in Search Console. Blocking the save is the kind thing.
     */
    customJsonLd: z.preprocess(
      blank,
      z
        .string()
        .max(20_000)
        .refine(
          (s) => {
            try {
              JSON.parse(s);
              return true;
            } catch {
              return false;
            }
          },
          { message: "That isn't valid JSON. Check for a trailing comma or a missing quote." },
        )
        .optional(),
    ),

    customMode: z.preprocess(blank, z.enum(['append', 'replace']).optional()),
  })
  .strict()
  .optional();

/** `null` clears the whole block — see blocksSchema for the same reasoning. */
export const structuredDataSchema = z.preprocess(
  (v) => (v === null ? undefined : v),
  structuredDataObject,
);

/* ------------------------------------------------------------------ posts --- */

const postCore = {
  title: z.preprocess(blank, z.string().trim().min(1, 'Title is required').max(300)),
  slug: optStr(96), // derived from the title when blank; uniqueness resolved server-side
  excerpt: optStr(1000),
  content: z.preprocess(blank, z.string().max(1_000_000).optional()), // sanitized server-side, never here
  coverImage: optUrl(),
  coverImageAlt: optStr(300),
  author: optStr(120),
  tags: stringList(30),

  // The managed taxonomy: an array of category SLUGS (not names). The editor only
  // ever sends slugs that exist in the categories collection; we store them as-is
  // and the renderer resolves each back to its display name. Kept SEPARATE from
  // free-text `tags` above — tags still drive search, related posts, article:tag.
  categories: stringList(30, 96),

  status: z.enum(['draft', 'published']).default('draft'),

  // A FUTURE date on a published post means SCHEDULED: it stays out of the public
  // list and sitemap until the date arrives. See resolvePublishedAt() in lib/post-write.js.
  publishedAt: optDate,

  seo: seoSchema,

  template: optStr(40),
  keywords: backlinkList, // <- backlinks {keyword,url,rel}[], NOT seo.keywords (meta keywords)
  linkFirstOccurrenceOnly: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.boolean().default(true)),

  seoOverrides: stringList(80, 200), // ids of checks the author marked "reviewed"

  contentWidth: z.enum(['standard', 'wide']).default('standard'),
  coverLayout: z.enum(['standard', 'wide']).default('standard'),

  /**
   * Blocks and structuredData are VALIDATED here but are NOT in POST_FORM_KEYS.
   * They stay on PRESERVE_KEYS (lib/post-write.js) and go through the three-state
   * rule instead:
   *
   *     absent from the body -> left alone   (a surface that doesn't render them
   *                                            can never delete them — Invariant 3)
   *     []  / {}             -> cleared      (the author deleted their last block)
   *     a value              -> set
   *
   * The dashboard editor always SENDS blocks (as [] when empty), so it can both
   * set and clear them. A future admin panel that doesn't render blocks simply
   * omits the key and leaves them untouched. Moving these into POST_FORM_KEYS
   * would make that other panel wipe them on every save.
   */
  blocks: blocksSchema,
  structuredData: structuredDataSchema,
};

/** POST /api/seoteam/posts — create. */
export const createPostSchema = z.object(postCore).strict();

/** PUT /api/seoteam/posts/[id] — full replace (the edit form). */
export const updatePostSchema = z.object(postCore).strict();

/**
 * PATCH /api/seoteam/posts/[id] — partial (the list view's quick publish toggle).
 * Everything optional; only the keys actually present are touched.
 */
export const patchPostSchema = z
  .object({
    status: z.enum(['draft', 'published']).optional(),
    publishedAt: optDate,
  })
  .strict();

/* -------------------------------------------------------------- categories --- */

/**
 * A blog category. `name` is what the reader sees on the filter pill and the card;
 * `slug` is the archive URL (/blog/category/<slug>) and the value stored on posts.
 *
 * On CREATE the slug is optional — the API derives it from the name and resolves
 * collisions. On RENAME (PATCH) we accept `name` only and deliberately leave the
 * slug untouched: changing it would break the live archive URL and orphan every
 * post that already references the old slug.
 */
export const categoryCreateSchema = z
  .object({
    name: z.preprocess(blank, z.string().trim().min(1, 'Name is required').max(60)),
    slug: optStr(96),
  })
  .strict();

export const categoryUpdateSchema = z
  .object({
    name: z.preprocess(blank, z.string().trim().min(1, 'Name is required').max(60)),
  })
  .strict();

/* ------------------------------------------------------------------ media --- */

export const mediaCreateSchema = z
  .object({
    url: z.string().trim().min(1).max(2048).url(),
    pathname: optStr(512),
    provider: z.enum(['cloudinary', 'local', 'external']).default('external'),
    folder: optStr(200),
    filename: optStr(300),
    contentType: optStr(120),
    bytes: z.preprocess(blank, z.number().int().nonnegative().optional()),
    width: z.preprocess(blank, z.number().int().nonnegative().optional()),
    height: z.preprocess(blank, z.number().int().nonnegative().optional()),
    format: optStr(20),
    alt: optStr(300),
    title: optStr(300),
    tags: stringList(30),
    source: z.enum(['upload', 'import', 'discovered']).default('upload'),
  })
  .strict();

export const mediaUpdateSchema = z
  .object({
    alt: optStr(300),
    title: optStr(300),
    tags: stringList(30),
    folder: optStr(200),
  })
  .strict();

/* ------------------------------------------------------------------ errors -- */

/**
 * Flatten a ZodError into { field: "message" } so the form can render the error
 * next to the offending input instead of dumping a blob at the top.
 * Nested paths become dotted: "seo.metaTitle", "keywords.2.url".
 */
export function fieldErrors(zodError) {
  const out = {};
  for (const issue of zodError.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
