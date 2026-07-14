/* Modular content blocks — schema + renderers.
 *
 * ===========================================================================
 * BLOCKS RENDER *AROUND* THE BODY, NEVER INSTEAD OF IT (Invariant 4)
 * ===========================================================================
 * `content` stays the authoritative body. Blocks are appended AFTER it. This is
 * not a stylistic choice — three separate systems read `content` and only
 * `content`:
 *
 *     lib/keyword-links.js   injects backlinks into it
 *     lib/html-text.js       computes reading time and word count from it
 *     lib/seo-score.js       runs the "is this thin content?" check on it
 *
 * A post written entirely in blocks with an empty body looks EMPTY to all three:
 * no backlinks, 1-minute reading time, and a permanent "thin content" warning.
 * If you ever make blocks the primary body, you must update all three together.
 *
 * ===========================================================================
 * ADDING A BLOCK TYPE IS A THREE-PLACE CHANGE
 * ===========================================================================
 *   1. a member of BLOCK_SCHEMAS below      (the validator)
 *   2. a renderer in RENDERERS below        (the public page)
 *   3. an edit form in src/dashboard/block-editor.js
 *
 * The discriminated union in BLOCK_SCHEMAS is THE ONLY THING standing between a
 * request body and arbitrary JSON landing in `block.data` — Mongo will not stop
 * you. Every write path must parse through it.
 *
 * `id` is generated client-side and is stable across reorders (it is the DOM key).
 * Array order IS render order.
 */
import { z } from 'zod';
import { esc } from './templates.js';
import { sanitizeBody } from './sanitize.js';

/* ------------------------------------------------------------------ schema -- */

const id = z.string().min(1).max(64);
const short = (max = 300) => z.string().trim().max(max);

const richtext = z.object({
  type: z.literal('richtext'),
  id,
  data: z.object({ html: z.string().max(200_000) }),
});

const faq = z.object({
  type: z.literal('faq'),
  id,
  data: z.object({
    heading: short(200).optional(),
    items: z
      .array(z.object({ q: short(400), a: z.string().max(5000) }))
      .max(50),
  }),
});

const comparison = z.object({
  type: z.literal('comparison'),
  id,
  data: z.object({
    heading: short(200).optional(),
    headers: z.array(short(120)).max(8),
    rows: z.array(z.array(short(400)).max(8)).max(60),
  }),
});

const featureGrid = z.object({
  type: z.literal('featureGrid'),
  id,
  data: z.object({
    heading: short(200).optional(),
    items: z.array(z.object({ title: short(160), description: z.string().max(800) })).max(24),
  }),
});

const prosCons = z.object({
  type: z.literal('prosCons'),
  id,
  data: z.object({
    heading: short(200).optional(),
    pros: z.array(short(400)).max(30),
    cons: z.array(short(400)).max(30),
  }),
});

const cta = z.object({
  type: z.literal('cta'),
  id,
  data: z.object({
    heading: short(200),
    body: z.string().max(1000).optional(),
    buttonLabel: short(80),
    buttonUrl: z.string().max(2048).url(),
  }),
});

const media = z.object({
  type: z.literal('media'),
  id,
  data: z.object({
    url: z.string().max(2048).url(),
    alt: short(300).optional(),
    caption: short(500).optional(),
  }),
});

const htmlEmbed = z.object({
  type: z.literal('htmlEmbed'),
  id,
  data: z.object({ html: z.string().max(50_000) }),
});

export const BLOCK_SCHEMAS = [richtext, faq, comparison, featureGrid, prosCons, cta, media, htmlEmbed];

export const blockSchema = z.discriminatedUnion('type', BLOCK_SCHEMAS);

/**
 * The blocks array.
 *
 * NOTE the absence of a `.default([])`, and the absence of any "normalize empty
 * away" step. An explicit `[]` must survive all the way to the database, because
 * that is how an author DELETES THEIR LAST BLOCK. Normalize it to undefined and
 * the last block becomes immortal. See PRESERVE_KEYS in lib/post-write.js.
 */
export const blocksSchema = z.preprocess(
  // `null` is how a caller says "clear these". Without this it would fail
  // validation instead, and the author could never remove their blocks.
  (v) => (v === null ? undefined : v),
  z.array(blockSchema).max(60).optional(),
);

export const BLOCK_TYPES = [
  { type: 'richtext', label: 'Rich text', hint: 'A free-form section.' },
  { type: 'faq', label: 'FAQ', hint: 'Q&A pairs. Also emits FAQPage schema — AI answers quote these.' },
  { type: 'comparison', label: 'Comparison table', hint: 'Headers + rows. Good for "X vs Y".' },
  { type: 'featureGrid', label: 'Feature grid', hint: 'A grid of title + description cards.' },
  { type: 'prosCons', label: 'Pros & cons', hint: 'Two columns. Reviews and comparisons.' },
  { type: 'cta', label: 'Call to action', hint: 'Heading, body, and a button.' },
  { type: 'media', label: 'Image', hint: 'A full-width image with a caption.' },
  { type: 'htmlEmbed', label: 'HTML embed', hint: 'Raw markup — sanitized, but <iframe> survives.' },
];

/* ---------------------------------------------------------------- renderers -- */

const RENDERERS = {
  richtext: (d) => `<div class="blk blk-richtext">${sanitizeBody(d.html)}</div>`,

  faq: (d) => `
<section class="blk blk-faq">
  ${d.heading ? `<h2>${esc(d.heading)}</h2>` : ''}
  <dl>
    ${(d.items || [])
      .map(
        (item) => `
    <div class="blk-faq-item">
      <dt>${esc(item.q)}</dt>
      <dd>${sanitizeBody(item.a)}</dd>
    </div>`,
      )
      .join('')}
  </dl>
</section>`,

  comparison: (d) => `
<section class="blk blk-comparison">
  ${d.heading ? `<h2>${esc(d.heading)}</h2>` : ''}
  <div class="blk-table-scroll">
    <table>
      ${
        d.headers?.length
          ? `<thead><tr>${d.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
          : ''
      }
      <tbody>
        ${(d.rows || [])
          .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
          .join('')}
      </tbody>
    </table>
  </div>
</section>`,

  featureGrid: (d) => `
<section class="blk blk-features">
  ${d.heading ? `<h2>${esc(d.heading)}</h2>` : ''}
  <div class="blk-feature-grid">
    ${(d.items || [])
      .map(
        (item) => `
    <div class="blk-feature">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.description)}</p>
    </div>`,
      )
      .join('')}
  </div>
</section>`,

  prosCons: (d) => `
<section class="blk blk-proscons">
  ${d.heading ? `<h2>${esc(d.heading)}</h2>` : ''}
  <div class="blk-proscons-grid">
    <div class="blk-pros">
      <h3>Pros</h3>
      <ul>${(d.pros || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    </div>
    <div class="blk-cons">
      <h3>Cons</h3>
      <ul>${(d.cons || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    </div>
  </div>
</section>`,

  cta: (d) => `
<section class="blk blk-cta">
  <h2>${esc(d.heading)}</h2>
  ${d.body ? `<p>${esc(d.body)}</p>` : ''}
  <a class="btn-primary" href="${esc(d.buttonUrl)}" data-cursor>${esc(d.buttonLabel)}</a>
</section>`,

  media: (d) => `
<figure class="blk blk-media">
  <img src="${esc(d.url)}" alt="${esc(d.alt || '')}" loading="lazy" />
  ${d.caption ? `<figcaption>${esc(d.caption)}</figcaption>` : ''}
</figure>`,

  // Sanitized like any other author HTML — <script> out, <iframe> kept.
  htmlEmbed: (d) => `<div class="blk blk-embed">${sanitizeBody(d.html)}</div>`,
};

/** Render an ordered block array to HTML. Unknown types are skipped, not thrown. */
export function renderBlocks(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return '';

  const html = blocks
    .map((block) => {
      const render = RENDERERS[block?.type];
      if (!render) {
        // A block type that exists in the DB but not in this build (a rollback, a
        // half-deployed feature). Skipping beats throwing a 500 on a live post.
        console.warn('[blocks] unknown block type, skipping:', block?.type);
        return '';
      }
      try {
        return render(block.data || {});
      } catch (err) {
        console.error('[blocks] renderer threw for', block.type, err);
        return '';
      }
    })
    .filter(Boolean)
    .join('\n');

  return html ? `<div class="post-blocks">${html}</div>` : '';
}

/** The first FAQ block, if any — the structured-data engine derives FAQPage from it. */
export function findFaqBlock(blocks) {
  if (!Array.isArray(blocks)) return null;
  return blocks.find((b) => b?.type === 'faq' && b.data?.items?.length) || null;
}
