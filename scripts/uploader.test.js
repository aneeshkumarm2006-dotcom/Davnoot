/* Pure-logic tests for the upload transform decision.
 *
 *   node --test scripts/uploader.test.js
 *
 * webpTransform() is the SEO/performance rule for blog images:
 *   - raster photos/graphics are converted to WebP on upload
 *   - compression (q_auto) is applied only when the ORIGINAL is over 300 KB
 *   - vector (SVG), animated (GIF) and already-modern (AVIF) files are left as-is
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { webpTransform, COMPRESS_OVER_BYTES } from '../lib/uploader.js';

const KB = 1024;

describe('webpTransform', () => {
  test('the threshold is 300 KB', () => {
    assert.equal(COMPRESS_OVER_BYTES, 300 * KB);
  });

  test('a small PNG converts to WebP but is NOT compressed', () => {
    const t = webpTransform({ contentType: 'image/png', bytes: 100 * KB });
    assert.equal(t.format, 'webp');
    assert.equal(t.transformation, undefined, 'no quality transform under the threshold');
  });

  test('a large PNG converts to WebP AND compresses with q_auto', () => {
    const t = webpTransform({ contentType: 'image/png', bytes: 500 * KB });
    assert.equal(t.format, 'webp');
    assert.deepEqual(t.transformation, [{ quality: 'auto:good' }]);
  });

  test('a large JPEG converts and compresses', () => {
    const t = webpTransform({ contentType: 'image/jpeg', bytes: 800 * KB });
    assert.equal(t.format, 'webp');
    assert.deepEqual(t.transformation, [{ quality: 'auto:good' }]);
  });

  test('exactly 300 KB is NOT over the threshold — convert only', () => {
    const t = webpTransform({ contentType: 'image/png', bytes: 300 * KB });
    assert.equal(t.format, 'webp');
    assert.equal(t.transformation, undefined);
  });

  test('one byte over 300 KB tips into compression', () => {
    const t = webpTransform({ contentType: 'image/png', bytes: 300 * KB + 1 });
    assert.deepEqual(t.transformation, [{ quality: 'auto:good' }]);
  });

  test('an already-WebP over the threshold is still compressed', () => {
    const t = webpTransform({ contentType: 'image/webp', bytes: 400 * KB });
    assert.equal(t.format, 'webp');
    assert.deepEqual(t.transformation, [{ quality: 'auto:good' }]);
  });

  test('SVG is left untouched — never rasterized to WebP', () => {
    const t = webpTransform({ contentType: 'image/svg+xml', bytes: 900 * KB });
    assert.deepEqual(t, {}, 'vector stays vector');
  });

  test('GIF is left untouched — a plain WebP would drop animation', () => {
    const t = webpTransform({ contentType: 'image/gif', bytes: 900 * KB });
    assert.deepEqual(t, {});
  });

  test('AVIF is left untouched — already smaller than WebP', () => {
    const t = webpTransform({ contentType: 'image/avif', bytes: 900 * KB });
    assert.deepEqual(t, {});
  });
});
