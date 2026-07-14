/* Blocks + the structured-data engine. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderBlocks, blocksSchema, findFaqBlock } from '../lib/blocks.js';
import { buildGraph } from '../lib/structured-data.js';
import { createPostSchema, fieldErrors } from '../lib/validators.js';
import { renderArticlePage } from '../lib/blog-render.js';

const URL = 'https://www.davnoot.com/blog/x';

const POST = {
  title: 'GEO vs SEO',
  slug: 'x',
  content: '<p>The body is still the authoritative content.</p>',
  status: 'published',
  publishedAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-02T00:00:00Z'),
};

const FAQ_BLOCK = {
  type: 'faq',
  id: 'f1',
  data: {
    heading: 'Common questions',
    items: [
      { q: 'What is GEO?', a: '<p>Generative engine optimization.</p>' },
      { q: 'Is it different from SEO?', a: '<p>Yes.</p>' },
    ],
  },
};

/* ========================================================================== */
describe('the block validator is the only gate on block.data', () => {
  test('a valid block passes', () => {
    const r = blocksSchema.safeParse([FAQ_BLOCK]);
    assert.equal(r.success, true);
  });

  test('an unknown block TYPE is rejected', () => {
    const r = blocksSchema.safeParse([{ type: 'wormhole', id: '1', data: {} }]);
    assert.equal(r.success, false);
  });

  test('a known type with the WRONG data shape is rejected', () => {
    // block.data is schema-less in Mongo. If this union lets it through, arbitrary
    // JSON lands in the database.
    const r = blocksSchema.safeParse([{ type: 'cta', id: '1', data: { lol: 'nope' } }]);
    assert.equal(r.success, false);
  });

  test('a cta with a non-URL button is rejected', () => {
    const r = blocksSchema.safeParse([
      { type: 'cta', id: '1', data: { heading: 'Hi', buttonLabel: 'Go', buttonUrl: 'not-a-url' } },
    ]);
    assert.equal(r.success, false);
  });

  test('an empty array is preserved (it is how you delete the last block)', () => {
    assert.deepEqual(blocksSchema.parse([]), []);
  });
});

/* ========================================================================== */
describe('rendering', () => {
  test('renders each block type without throwing', () => {
    const blocks = [
      { type: 'richtext', id: '1', data: { html: '<p>rich</p>' } },
      FAQ_BLOCK,
      { type: 'comparison', id: '3', data: { headers: ['A', 'B'], rows: [['1', '2']] } },
      { type: 'featureGrid', id: '4', data: { items: [{ title: 'T', description: 'D' }] } },
      { type: 'prosCons', id: '5', data: { pros: ['good'], cons: ['bad'] } },
      { type: 'cta', id: '6', data: { heading: 'H', buttonLabel: 'Go', buttonUrl: 'https://a.co' } },
      { type: 'media', id: '7', data: { url: 'https://a.co/i.png', alt: 'x', caption: 'c' } },
      { type: 'htmlEmbed', id: '8', data: { html: '<iframe src="https://youtube.com/embed/a"></iframe>' } },
    ];

    const html = renderBlocks(blocks);
    assert.match(html, /blk-faq/);
    assert.match(html, /blk-comparison/);
    assert.match(html, /blk-cta/);
    assert.ok(html.includes('<iframe'), 'embeds must survive the block sanitizer too');
  });

  test('block HTML is SANITIZED', () => {
    const html = renderBlocks([{ type: 'htmlEmbed', id: '1', data: { html: '<script>alert(1)</script><p>ok</p>' } }]);
    assert.equal(html.includes('<script'), false);
    assert.equal(html.includes('alert(1)'), false);
  });

  test('block text is escaped', () => {
    const html = renderBlocks([
      { type: 'cta', id: '1', data: { heading: '<img src=x onerror=alert(1)>', buttonLabel: 'Go', buttonUrl: 'https://a.co' } },
    ]);
    assert.equal(html.includes('<img src=x'), false);
  });

  test('an UNKNOWN block type is skipped, not thrown (a rollback must not 500 a live post)', () => {
    const html = renderBlocks([{ type: 'from-the-future', id: '1', data: {} }, FAQ_BLOCK]);
    assert.match(html, /blk-faq/, 'the good blocks must still render');
  });

  test('no blocks -> no markup at all', () => {
    assert.equal(renderBlocks([]), '');
    assert.equal(renderBlocks(undefined), '');
  });
});

/* ========================================================================== */
describe('Invariant 4 — blocks render AROUND the body, not instead of it', () => {
  test('the body still appears when blocks exist', () => {
    const html = renderArticlePage({ ...POST, blocks: [FAQ_BLOCK] });
    assert.ok(html.includes('The body is still the authoritative content.'), 'the body was replaced');
    assert.match(html, /blk-faq/);
  });

  test('the body comes BEFORE the blocks', () => {
    const html = renderArticlePage({ ...POST, blocks: [FAQ_BLOCK] });
    assert.ok(html.indexOf('post-body') < html.indexOf('post-blocks'));
  });

  test('keyword backlinks still target the BODY, not the blocks', () => {
    // The injector reads `content`. This is why the body must stay authoritative.
    const html = renderArticlePage({
      ...POST,
      content: '<p>Hire an SEO agency today.</p>',
      blocks: [FAQ_BLOCK],
      keywords: [{ keyword: 'SEO agency', url: 'https://www.davnoot.com/seo.html', rel: 'dofollow' }],
    });
    assert.match(html, /class="kw-link"/);
  });
});

/* ========================================================================== */
describe('structured-data engine', () => {
  const types = (post, url = URL) => buildGraph(post, url).map((n) => n['@type']);

  test('a plain post emits Organization + BlogPosting + BreadcrumbList', () => {
    assert.deepEqual(types(POST), ['Organization', 'BlogPosting', 'BreadcrumbList']);
  });

  test('FAQPage is DERIVED from an FAQ block, and only from one', () => {
    assert.equal(types(POST).includes('FAQPage'), false, 'no FAQ block -> no FAQPage');

    const withFaq = types({ ...POST, blocks: [FAQ_BLOCK] });
    assert.ok(withFaq.includes('FAQPage'), 'an FAQ block must produce FAQPage schema');
  });

  test('the FAQPage questions match the VISIBLE block (schema can never lie)', () => {
    const graph = buildGraph({ ...POST, blocks: [FAQ_BLOCK] }, URL);
    const faq = graph.find((n) => n['@type'] === 'FAQPage');
    assert.equal(faq.mainEntity.length, 2);
    assert.equal(faq.mainEntity[0].name, 'What is GEO?');
    assert.equal(faq.mainEntity[0].acceptedAnswer.text, 'Generative engine optimization.');
  });

  test('disabledTypes drops a node', () => {
    const post = { ...POST, blocks: [FAQ_BLOCK], structuredData: { disabledTypes: ['FAQPage'] } };
    assert.equal(types(post).includes('FAQPage'), false);
  });

  test('fieldOverrides can override a WHITELISTED field', () => {
    const post = { ...POST, structuredData: { fieldOverrides: { BlogPosting: { headline: 'Custom headline' } } } };
    const node = buildGraph(post, URL).find((n) => n['@type'] === 'BlogPosting');
    assert.equal(node.headline, 'Custom headline');
  });

  test('a NON-whitelisted field is ignored — a typo must not corrupt the schema', () => {
    const post = {
      ...POST,
      structuredData: { fieldOverrides: { BlogPosting: { '@type': 'Recipe', '@id': 'junk', evil: 1 } } },
    };
    const node = buildGraph(post, URL).find((n) => n['@type'] === 'BlogPosting');
    assert.equal(node['@type'], 'BlogPosting', 'overriding @type would invalidate the whole node');
    assert.equal(node['@id'], `${URL}#post`, 'a broken @id detaches every publisher reference');
    assert.equal(node.evil, undefined);
  });

  test('customJsonLd in APPEND mode adds to the graph', () => {
    const post = {
      ...POST,
      structuredData: { customJsonLd: '{"@type":"HowTo","name":"Do it"}', customMode: 'append' },
    };
    assert.ok(types(post).includes('HowTo'));
    assert.ok(types(post).includes('BlogPosting'), 'append must keep the generated nodes');
  });

  test('customJsonLd in REPLACE mode becomes the ENTIRE graph', () => {
    const post = {
      ...POST,
      structuredData: { customJsonLd: '{"@type":"HowTo","name":"Do it"}', customMode: 'replace' },
    };
    assert.deepEqual(types(post), ['HowTo']);
  });

  test('a malformed customJsonLd that somehow reached the DB is DROPPED, not emitted', () => {
    const post = { ...POST, structuredData: { customJsonLd: '{ broken', customMode: 'append' } };
    const html = renderArticlePage(post);
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => JSON.parse(ld), 'a broken <script> tag must never reach the page');
  });
});

/* ========================================================================== */
describe('customJsonLd must parse BEFORE the save is allowed', () => {
  const base = { title: 'x', content: '<p>y</p>' };

  test('invalid JSON blocks the save', () => {
    const r = createPostSchema.safeParse({
      ...base,
      structuredData: { customJsonLd: '{ "a": }', customMode: 'append' },
    });
    assert.equal(r.success, false, 'an invalid blob would emit a broken <script> on a live page');
    assert.match(fieldErrors(r.error)['structuredData.customJsonLd'], /valid JSON/);
  });

  test('valid JSON saves', () => {
    const r = createPostSchema.safeParse({
      ...base,
      structuredData: { customJsonLd: '{"@type":"HowTo"}', customMode: 'append' },
    });
    assert.equal(r.success, true);
  });

  test('a blank customJsonLd is fine (it becomes undefined, not a parse error)', () => {
    const r = createPostSchema.safeParse({ ...base, structuredData: { customJsonLd: '' } });
    assert.equal(r.success, true);
  });
});

/* ========================================================================== */
describe('findFaqBlock', () => {
  test('ignores an FAQ block with no items', () => {
    assert.equal(findFaqBlock([{ type: 'faq', id: '1', data: { items: [] } }]), null);
  });
  test('finds the first real one', () => {
    assert.equal(findFaqBlock([{ type: 'cta', id: '0', data: {} }, FAQ_BLOCK]).id, 'f1');
  });
});
