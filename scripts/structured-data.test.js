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

/* BreadcrumbList is the one node here that still earns a Google rich result, so it
 * gets the most assertions. The crumbs are SCRAPED from each page's visible trail
 * by extractBreadcrumb() in build.js — scripts/semantic-html.test.js guards that
 * the scrape keeps matching; these guard the shape of what it produces. */
describe('BreadcrumbList on marketing pages', () => {
  const CRUMBS = [
    { name: 'Davnoot', href: '/' },
    { name: 'Services', href: '/services' },
    { name: 'SEO', href: null },
  ];
  const crumbNode = (file, crumbs, locale = 'en') =>
    parse(jsonLd(file, 'SEO — Davnoot', 'd', [], locale, crumbs))['@graph'].find(
      (n) => n['@type'] === 'BreadcrumbList',
    );

  test('a service page emits the trail its markup shows', () => {
    const bc = crumbNode('seo.html', CRUMBS);
    assert.deepEqual(
      bc.itemListElement.map((i) => i.name),
      ['Davnoot', 'Services', 'SEO'],
    );
    assert.equal(bc['@id'], canonicalFor('seo.html') + '#breadcrumb');
  });

  test('positions are 1-based and sequential', () => {
    const bc = crumbNode('seo.html', CRUMBS);
    assert.deepEqual(
      bc.itemListElement.map((i) => i.position),
      [1, 2, 3],
    );
  });

  test('every item URL is absolute — a relative item is a documented Google error', () => {
    const bc = crumbNode('seo.html', CRUMBS);
    for (const item of bc.itemListElement) {
      assert.match(item.item, /^https:\/\/www\.davnoot\.com\//, `${item.name} is not absolute`);
    }
  });

  test('the final crumb resolves to the page itself', () => {
    const bc = crumbNode('seo.html', CRUMBS);
    assert.equal(bc.itemListElement.at(-1).item, canonicalFor('seo.html'));
  });

  test('a page with no crumbs omits the node entirely, like FAQPage', () => {
    assert.equal(crumbNode('seo.html', undefined), undefined, 'no crumbs -> no node');
    assert.equal(crumbNode('seo.html', []), undefined, 'empty crumbs -> no node');
    // One crumb cannot produce a rich result, so it must not be emitted either.
    assert.equal(crumbNode('seo.html', [{ name: 'Davnoot', href: '/' }]), undefined);
  });

  test('the homepage never emits one — it is the root of every trail', () => {
    const types = typesIn(parse(jsonLd('index.html', 'Home', 'd', [], 'en', CRUMBS)));
    assert.ok(!types.includes('BreadcrumbList'));
  });

  test('landing and contact pages emit it too', () => {
    assert.deepEqual(typesIn(parse(jsonLd('book-call.html', 'Book', 'd', [], 'en', CRUMBS))), [
      'Organization',
      'BreadcrumbList',
    ]);
    assert.deepEqual(typesIn(parse(jsonLd('ai-seo-agency.html', 'X', 'd', [], 'en', CRUMBS))), [
      'Organization',
      'BreadcrumbList',
    ]);
  });

  test('a French page carries its own translated trail', () => {
    const bc = crumbNode(
      'seo.html',
      [
        { name: 'Davnoot', href: '/fr' },
        { name: 'Services', href: '/services' },
        { name: 'Référencement', href: null },
      ],
      'fr',
    );
    assert.equal(bc.itemListElement[0].item, 'https://www.davnoot.com/fr');
    assert.equal(bc.itemListElement.at(-1).name, 'Référencement');
    assert.equal(bc.itemListElement.at(-1).item, canonicalFor('seo.html', 'fr'));
  });
});

describe('the marketing nodes carry stable identity and locale-correct URLs', () => {
  test('Service has an @id so other nodes can reference it', () => {
    const svc = parse(jsonLd('seo.html', 'SEO — Davnoot', 'd', []))['@graph'].find((n) => n['@type'] === 'Service');
    assert.equal(svc['@id'], canonicalFor('seo.html') + '#service');
    assert.equal(svc.provider['@id'], 'https://www.davnoot.com/#organization');
  });

  /* REGRESSION: Service.url was built with canonicalFor(doc.file) and no locale, so
   * every /fr/services/* page advertised its ENGLISH URL — telling Google the French
   * page was about the English one. It now uses the already-localised ctx.url. */
  test('a French service page advertises its French URL, not the English one', () => {
    const svc = parse(jsonLd('seo.html', 'Référencement — Davnoot', 'd', [], 'fr'))['@graph'].find(
      (n) => n['@type'] === 'Service',
    );
    assert.equal(svc.url, 'https://www.davnoot.com/fr/services/seo');
    assert.equal(svc['@id'], 'https://www.davnoot.com/fr/services/seo#service');
  });

  test('WebSite declares both languages and never a retired SearchAction', () => {
    const site = parse(jsonLd('index.html', 'Home', 'd', []))['@graph'].find((n) => n['@type'] === 'WebSite');
    // Mirrors hreflangTags(): plain `en`, and `fr-CA` for Quebec French.
    assert.deepEqual(site.inLanguage, ['en', 'fr-CA']);
    assert.equal(site.potentialAction, undefined, 'the sitelinks search box was retired in 2024');
  });

  test('the LocalBusiness node carries a full postal address', () => {
    const ps = parse(jsonLd('index.html', 'Home', 'd', []))['@graph'].find(
      (n) => n['@type'] === 'ProfessionalService',
    );
    assert.equal(ps.address.streetAddress, '4115 Sherbrooke St W');
    assert.equal(ps.address.postalCode, 'H3Z 1B1');
    // Google requires name + address for LocalBusiness eligibility.
    assert.ok(ps.name && ps.address.addressLocality && ps.address.addressCountry);
    assert.equal(ps.parentOrganization['@id'], 'https://www.davnoot.com/#organization');
  });

  test('areaServed is real Place nodes, not loose strings', () => {
    const ps = parse(jsonLd('index.html', 'Home', 'd', []))['@graph'].find(
      (n) => n['@type'] === 'ProfessionalService',
    );
    assert.deepEqual(
      ps.areaServed.map((p) => `${p['@type']}:${p.name}`),
      ['City:Montreal', 'Country:Canada', 'Country:United States'],
    );
  });

  test('the offer catalog lists every service page, localised', () => {
    const catalogFor = (locale) =>
      parse(jsonLd('index.html', 'Home', 'd', [], locale))['@graph'].find(
        (n) => n['@type'] === 'ProfessionalService',
      ).hasOfferCatalog.itemListElement;

    assert.equal(catalogFor('en').length, SERVICE_PAGES.length);
    for (const item of catalogFor('en')) {
      assert.match(item.url, /^https:\/\/www\.davnoot\.com\/services\//);
      assert.ok(item.name, 'every catalog entry needs a serviceType name');
      assert.equal(item.offers, undefined, 'no fabricated prices');
    }
    // The French homepage links the French twin where one exists, English otherwise.
    const fr = catalogFor('fr').map((i) => i.url);
    assert.ok(fr.some((u) => u.includes('/fr/services/seo')), 'translated services link /fr');
    assert.ok(fr.some((u) => u.includes('/services/klaviyo')), 'untranslated ones stay English');
  });

  test('no self-serving review or rating anywhere in the graph', () => {
    /* Google: an entity that controls the reviews about itself is INELIGIBLE for the
     * star feature on its own Organization/LocalBusiness markup. The homepage
     * testimonials stay visible HTML and out of the JSON-LD, deliberately. */
    for (const file of ['index.html', 'seo.html', 'book-call.html']) {
      const raw = jsonLd(file, 'T', 'D', []);
      assert.ok(!raw.includes('aggregateRating'), `${file} must not self-rate`);
      assert.ok(!raw.includes('"review"'), `${file} must not carry self-serving reviews`);
    }
  });
});
