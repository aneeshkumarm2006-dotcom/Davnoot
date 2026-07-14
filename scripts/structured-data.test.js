/* Structured-data unification proof.
 *
 * templates.js's jsonLd() used to hand-build a second JSON-LD graph, separate from
 * lib/structured-data.js's buildGraph(). Two builders drift. jsonLd() now delegates
 * to buildGraph() via CONFIG[type].nodes, so there is one builder for the whole site.
 *
 * The end-to-end proof is scripts/pages-golden.test.js (the compiled BUILD:SEO region
 * is a function of jsonLd()'s output, so any drift fails `npm run site` and the golden
 * byte-identity test). These tests add the direct, readable assertions: the emitted
 * graph is well-formed, correctly typed per page kind, and structurally what Google
 * expects. If jsonLd() ever regrows its own builder, or CONFIG drifts, this fails.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { jsonLd, schemaTypeFor, SERVICE_PAGES, canonicalFor } from '../lib/templates.js';
import { buildGraph, CONFIG } from '../lib/structured-data.js';

const parse = (jsonLdString) => JSON.parse(jsonLdString.replace(/\\u003c/g, '<'));
const typesIn = (graph) => graph['@graph'].map((n) => n['@type']);

describe('jsonLd() delegates to the one site-wide builder', () => {
  test('every marketing file maps to a real CONFIG type', () => {
    for (const file of ['index.html', 'book-call.html', ...SERVICE_PAGES, 'ai-seo-agency.html']) {
      const type = schemaTypeFor(file);
      assert.ok(CONFIG[type], `${file} -> type "${type}" has no CONFIG entry`);
    }
  });

  test('the homepage emits Organization + WebSite + ProfessionalService', () => {
    const g = parse(jsonLd('index.html', 'Home', 'desc', []));
    assert.deepEqual(typesIn(g), ['Organization', 'WebSite', 'ProfessionalService']);
    assert.equal(g['@context'], 'https://schema.org');
  });

  test('a service page emits Organization + Service (+ FAQPage when it has questions)', () => {
    const noFaq = parse(jsonLd('seo.html', 'SEO — Davnoot', 'desc', []));
    assert.deepEqual(typesIn(noFaq), ['Organization', 'Service']);

    const withFaq = parse(jsonLd('seo.html', 'SEO — Davnoot', 'desc', [{ q: 'Q?', a: 'A.' }]));
    assert.deepEqual(typesIn(withFaq), ['Organization', 'Service', 'FAQPage']);
    const service = withFaq['@graph'][1];
    assert.equal(service.name, 'SEO', 'Service name strips the " — Davnoot" suffix');
    const faq = withFaq['@graph'][2];
    assert.equal(faq['@id'], canonicalFor('seo.html') + '#faq');
    assert.equal(faq.mainEntity[0].acceptedAnswer.text, 'A.', 'marketing FAQ answers are used verbatim (already plain text)');
  });

  test('a landing/contact page emits only Organization (+ FAQPage)', () => {
    assert.deepEqual(typesIn(parse(jsonLd('book-call.html', 'Book', 'd', []))), ['Organization']);
    assert.deepEqual(typesIn(parse(jsonLd('ai-seo-agency.html', 'X', 'd', []))), ['Organization']);
  });

  test('the Organization node is stable and referenced by @id everywhere', () => {
    const g = parse(jsonLd('index.html', 'Home', 'd', []));
    const org = g['@graph'][0];
    assert.equal(org['@id'], 'https://www.davnoot.com/#organization');
    // WebSite.publisher and ProfessionalService.parentOrganization both point back.
    assert.equal(g['@graph'][1].publisher['@id'], org['@id']);
    assert.equal(g['@graph'][2].parentOrganization['@id'], org['@id']);
  });

  test('buildGraph still serves the blog unchanged (default type = blogPost)', () => {
    const post = { title: 'Post', slug: 'p', excerpt: 'e', publishedAt: new Date('2026-01-01'), blocks: [], structuredData: {} };
    const graph = buildGraph(post, 'https://www.davnoot.com/blog/p');
    const types = graph.map((n) => n['@type']);
    assert.ok(types.includes('Organization'));
    assert.ok(types.includes('BlogPosting'));
    assert.ok(types.includes('BreadcrumbList'));
  });

  test('every ld+json a marketing page emits is valid JSON', () => {
    for (const file of ['index.html', 'seo.html', 'book-call.html']) {
      assert.doesNotThrow(() => parse(jsonLd(file, 'T', 'D', [{ q: 'a', a: 'b' }])));
    }
  });
});
