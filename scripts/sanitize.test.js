/* The CMS sanitizers, by field kind.
 *
 * sanitizeInline guards the constrained accent editor (hero titles, eyebrows) —
 * <em> is load-bearing typography, but nothing block-level or scriptable may pass.
 * sanitizeSection guards the raw-HTML / SVG escape hatch — meta-ads alone ships 33
 * hand-authored inline SVG <path>s that sanitizeBody would eat, so the allowlist is
 * WIDER (svg/path/…) but must still refuse the SVG-specific script vectors that live
 * OUTSIDE <script>/on*: <animate>/<set> href=javascript:, <foreignObject>, <use>.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeInline, sanitizeSection, sanitizeBody } from '../lib/sanitize.js';

describe('sanitizeInline — accent typography only', () => {
  test('keeps <em>, <strong>, <br>', () => {
    assert.match(sanitizeInline('Rank <em>#1</em>. <strong>Forever</strong>.<br />Really.'), /<em>#1<\/em>/);
    assert.match(sanitizeInline('a<br />b'), /<br \/?>/);
  });
  test('strips <script> and its text', () => {
    const out = sanitizeInline('ok<script>alert(1)</script>');
    assert.doesNotMatch(out, /<script/i);
    assert.doesNotMatch(out, /alert\(1\)/);
  });
  test('strips block elements (div/p/h2)', () => {
    assert.doesNotMatch(sanitizeInline('<div>x</div><p>y</p><h2>z</h2>'), /<(div|p|h2)/i);
  });
  test('strips event handlers and javascript: hrefs', () => {
    assert.doesNotMatch(sanitizeInline('<a href="javascript:alert(1)">x</a>'), /javascript:/i);
    assert.doesNotMatch(sanitizeInline('<em onmouseover="x()">y</em>'), /onmouseover/i);
  });
  test('keeps a safe https link', () => {
    assert.match(sanitizeInline('<a href="https://davnoot.com">x</a>'), /href="https:\/\/davnoot\.com"/);
  });
});

describe('sanitizeSection — SVG-aware, but no SVG script vectors', () => {
  test('keeps static SVG drawing primitives (<svg>, <path>, viewBox, d)', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 10" fill="#16a34a" /></svg>';
    const out = sanitizeSection(svg);
    assert.match(out, /<svg[^>]*viewBox="0 0 10 10"/);
    assert.match(out, /<path[^>]*d="M0 0 L10 10"/);
  });
  test('strips <animate> (can point href at javascript:)', () => {
    assert.doesNotMatch(sanitizeSection('<svg><animate attributeName="x" /></svg>'), /<animate/i);
  });
  test('strips <foreignObject> (reintroduces the full HTML namespace)', () => {
    assert.doesNotMatch(sanitizeSection('<svg><foreignObject><script>alert(1)</script></foreignObject></svg>'), /foreignObject/i);
  });
  test('strips <use> (can pull a remote payload)', () => {
    assert.doesNotMatch(sanitizeSection('<svg><use href="//evil/x.svg#a" /></svg>'), /<use/i);
  });
  test('strips <set> and animateTransform', () => {
    const out = sanitizeSection('<svg><set /><animateTransform /></svg>');
    assert.doesNotMatch(out, /<set/i);
    assert.doesNotMatch(out, /animateTransform/i);
  });
  test('strips <script> and on* handlers even inside SVG', () => {
    const out = sanitizeSection('<svg onload="x()"><script>alert(1)</script><rect /></svg>');
    assert.doesNotMatch(out, /<script/i);
    assert.doesNotMatch(out, /onload/i);
  });
});

describe('the three sanitizers are actually different allowlists', () => {
  test('sanitizeBody eats SVG paths that sanitizeSection keeps (why sanitizeSection exists)', () => {
    const svg = '<svg viewBox="0 0 1 1"><path d="M0 0" /></svg>';
    assert.doesNotMatch(sanitizeBody(svg), /<path/i);
    assert.match(sanitizeSection(svg), /<path/i);
  });
  test('sanitizeInline strips <img> that sanitizeBody keeps', () => {
    const img = '<img src="https://x/y.png" alt="a" />';
    assert.match(sanitizeBody(img), /<img/i);
    assert.doesNotMatch(sanitizeInline(img), /<img/i);
  });
});
