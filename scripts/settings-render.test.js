/* Settings → render.
 *
 * The site chrome (nav, footer) and the Organization schema now read their values
 * from the MERGED site settings (SITE_DEFAULTS + the db.settings diff) instead of
 * hardcoded constants. Two properties must both hold:
 *
 *   1. AT DEFAULTS, byte-identical. Every default in SITE_DEFAULTS mirrors the
 *      constant it replaced, so navHtml(f) === navHtml(f, defaults) to the byte. If
 *      this drifts, the marketing pages (which build.js bakes from these templates)
 *      change bytes and the golden test fails — this catches it directly and cheaply.
 *   2. A DIFF actually renders. An admin's brand/contact/org edit must change the
 *      output, or "settings" is a write-only screen.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { navHtml, footerHtml, orgNode } from '../lib/templates.js';
import { SITE_DEFAULTS, mergeSettings } from '../lib/site-defaults.js';

const FILES = ['index.html', 'seo.html', 'book-call.html', 'blog'];

describe('chrome is byte-identical when settings are at their defaults', () => {
  for (const f of FILES) {
    test(`navHtml(${f}) is unchanged by passing the defaults explicitly`, () => {
      assert.equal(navHtml(f, ''), navHtml(f, '', SITE_DEFAULTS));
      assert.equal(navHtml(f, ''), navHtml(f, '', mergeSettings({})));
    });
    test(`footerHtml(${f}) is unchanged by passing the defaults explicitly`, () => {
      assert.equal(footerHtml(f, ''), footerHtml(f, '', SITE_DEFAULTS));
      assert.equal(footerHtml(f, ''), footerHtml(f, '', mergeSettings({})));
    });
  }

  test('orgNode() is unchanged by passing the defaults explicitly', () => {
    assert.deepEqual(orgNode(), orgNode(SITE_DEFAULTS));
    assert.deepEqual(orgNode(), orgNode(mergeSettings({})));
  });
});

describe('a settings diff actually changes the rendered output', () => {
  test('a brand wordmark edit appears in the nav', () => {
    const s = mergeSettings({ brand: { wordmark: 'Acme Growth' } });
    assert.match(navHtml('index.html', '', s), /Acme Growth/);
    assert.doesNotMatch(navHtml('index.html', '', s), /Davnoot Digital/);
  });

  test('a contact edit appears in the footer', () => {
    const s = mergeSettings({ contact: { email: 'hi@acme.co', phoneDisplay: '+1 (555) 000-1111', phone: '+1-555-000-1111' } });
    const out = footerHtml('index.html', '', s);
    assert.match(out, /mailto:hi@acme\.co/);
    assert.match(out, />hi@acme\.co</);
    assert.match(out, /tel:\+15550001111/, 'the tel: href strips formatting to digits');
    assert.match(out, /\+1 \(555\) 000-1111/);
  });

  test('an org description edit appears in the Organization schema', () => {
    const s = mergeSettings({ org: { description: 'A new description.' } });
    assert.equal(orgNode(s).description, 'A new description.');
    // The @id stays stable — every other node references it.
    assert.equal(orgNode(s)['@id'], orgNode()['@id']);
  });

  test('a brand name edit flows into the logo alt text (escaped)', () => {
    const s = mergeSettings({ brand: { name: 'A & B' } });
    assert.match(navHtml('index.html', '', s), /alt="A &amp; B"/);
  });
});

describe('mergeSettings is a faithful deep merge over the defaults', () => {
  test('an empty diff returns the defaults verbatim', () => {
    assert.deepEqual(mergeSettings({}), SITE_DEFAULTS);
    assert.deepEqual(mergeSettings(null), SITE_DEFAULTS);
  });
  test('a nested diff overrides only the named leaf', () => {
    const s = mergeSettings({ contact: { email: 'x@y.z' } });
    assert.equal(s.contact.email, 'x@y.z');
    assert.equal(s.contact.phone, SITE_DEFAULTS.contact.phone, 'sibling keys are preserved');
    assert.equal(s.brand.name, SITE_DEFAULTS.brand.name, 'sibling branches are preserved');
  });
});
