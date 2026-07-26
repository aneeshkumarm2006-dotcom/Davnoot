/**
 * gen-favicon.js — build the square favicon set from images/davnoot-logo.png.
 *
 * WHY THIS EXISTS
 * ---------------
 * The site used to point every `<link rel="icon">` straight at the logo:
 * a 579x424 PNG of a black mark on a fully transparent background. That fails
 * twice over:
 *   1. Google only shows a site favicon in search results if it is SQUARE
 *      (ideally a multiple of 48px). A 579x424 icon is rejected and the generic
 *      globe is shown instead — which is exactly what SERPs were rendering.
 *   2. A black-on-transparent mark is invisible in a dark browser tab.
 *
 * So we bake a real icon: the mark knocked out in white, centred on an opaque
 * brand-black square, rendered at every size browsers and crawlers ask for,
 * plus a multi-resolution /favicon.ico for the root-path probe.
 *
 * Zero dependencies on purpose — package.json has no image toolchain and must
 * not grow one (see the "no-build-script" note there). PNG decode/encode is
 * done here with node:zlib. Run it with `npm run favicon`; outputs are
 * COMMITTED, exactly like the esbuild bundles.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = path.join(ROOT, 'images', 'davnoot-logo.png');
/** Opaque backdrop — matches --accent / --accent-text in styles.css. */
const BG = [10, 10, 10];
const FG = [255, 255, 255];
/**
 * Fraction of the square the mark spans on its longest side. The mark is a wide
 * infinity glyph (~1.4:1), so at 16-32px an 0.78 inset leaves the strokes barely
 * a pixel thick and the whole thing mushes into a blob. Small sizes get pushed
 * closer to full bleed to buy back that pixel.
 */
const inset = (size) => (size <= 32 ? 0.9 : 0.78);

/* ---------------------------------------------------------------- PNG read */

/** Decode a non-interlaced 8-bit truecolour-alpha PNG to a flat RGBA buffer. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  if (depth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG (depth=${depth} colorType=${colorType} interlace=${interlace})`);
  }

  const idat = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * bpp);

  // Undo the per-scanline filters (PNG spec 9.2).
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0;
      const b = y > 0 ? px[row - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[row - stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad filter ${filter} on row ${y}`);
      px[row + x] = v & 255;
    }
  }
  return { width, height, px };
}

/* --------------------------------------------------------------- PNG write */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode an opaque RGBA buffer as an 8-bit RGBA PNG (filter 0 throughout). */
function encodePng(width, height, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ raster */

/** Tight bounding box of everything that is not fully transparent. */
function alphaBounds(img) {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.px[(y * img.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('source logo is fully transparent');
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Render one square icon.
 *
 * The mark is resampled with an area-average (box) filter over the source
 * bounding box — the right filter for the heavy downscales we do here, and it
 * keeps the anti-aliased edges smooth at 16px instead of aliasing them away.
 * Only the source ALPHA is sampled; colour is then reconstructed as FG over BG,
 * which is what flips the black mark to white without touching the artwork.
 */
function render(img, box, size) {
  const scale = (size * inset(size)) / Math.max(box.w, box.h);
  const drawW = Math.max(1, Math.round(box.w * scale));
  const drawH = Math.max(1, Math.round(box.h * scale));
  const offX = Math.round((size - drawW) / 2);
  const offY = Math.round((size - drawH) / 2);

  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = BG[0];
    out[i * 4 + 1] = BG[1];
    out[i * 4 + 2] = BG[2];
    out[i * 4 + 3] = 255;
  }

  for (let y = 0; y < drawH; y++) {
    // Source window this destination row averages over.
    const sy0 = box.y0 + (y * box.h) / drawH;
    const sy1 = box.y0 + ((y + 1) * box.h) / drawH;
    for (let x = 0; x < drawW; x++) {
      const sx0 = box.x0 + (x * box.w) / drawW;
      const sx1 = box.x0 + ((x + 1) * box.w) / drawW;

      let sum = 0;
      let n = 0;
      const yA = Math.floor(sy0);
      const yB = Math.max(yA + 1, Math.ceil(sy1));
      const xA = Math.floor(sx0);
      const xB = Math.max(xA + 1, Math.ceil(sx1));
      for (let sy = yA; sy < yB && sy < img.height; sy++) {
        for (let sx = xA; sx < xB && sx < img.width; sx++) {
          sum += img.px[(sy * img.width + sx) * 4 + 3];
          n++;
        }
      }
      const a = n ? sum / n / 255 : 0;
      if (a <= 0) continue;

      const d = ((offY + y) * size + offX + x) * 4;
      out[d] = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      out[d + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      out[d + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      out[d + 3] = 255;
    }
  }
  return out;
}

/* --------------------------------------------------------------------- ICO */

/**
 * Pack sized RGBA rasters into a multi-resolution .ico.
 *
 * Entries are classic BMP (BITMAPINFOHEADER + bottom-up BGRA + AND mask) rather
 * than the newer PNG-in-ICO payload: every parser ever written reads BMP
 * entries, and at 16-48px the size difference is a couple of KB.
 */
function encodeIco(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // 1 = icon
  dir.writeUInt16LE(images.length, 4);

  const entries = [];
  const blobs = [];
  let offset = 6 + images.length * 16;

  for (const { size, px } of images) {
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8); // XOR + AND stacked
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);

    const xor = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4; // BMP rows run bottom-up
      for (let x = 0; x < size; x++) {
        const s = src + x * 4;
        const d = (y * size + x) * 4;
        xor[d] = px[s + 2];
        xor[d + 1] = px[s + 1];
        xor[d + 2] = px[s];
        xor[d + 3] = px[s + 3];
      }
    }
    // 1bpp AND mask, rows padded to 4 bytes. All-zero = fully opaque.
    const maskStride = Math.ceil(size / 32) * 4;
    const mask = Buffer.alloc(maskStride * size);

    const blob = Buffer.concat([header, xor, mask]);
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(blob.length, 8);
    entry.writeUInt32LE(offset, 12);

    entries.push(entry);
    blobs.push(blob);
    offset += blob.length;
  }
  return Buffer.concat([dir, ...entries, ...blobs]);
}

/* ---------------------------------------------------------------- pipeline */

/** PNG sizes we emit. 48/96/192 are the multiples of 48 Google looks for. */
const PNG_SIZES = [
  [48, 'images/favicon-48x48.png'],
  [96, 'images/favicon-96x96.png'],
  [180, 'images/apple-touch-icon.png'],
  [192, 'images/favicon-192x192.png'],
  [512, 'images/favicon-512x512.png'],
];
const ICO_SIZES = [16, 32, 48];

export function build({ quiet = false } = {}) {
  const img = decodePng(fs.readFileSync(SOURCE));
  const box = alphaBounds(img);
  const written = [];

  for (const [size, rel] of PNG_SIZES) {
    const file = path.join(ROOT, rel);
    fs.writeFileSync(file, encodePng(size, size, render(img, box, size)));
    written.push(rel);
  }

  const ico = encodeIco(ICO_SIZES.map((size) => ({ size, px: render(img, box, size) })));
  fs.writeFileSync(path.join(ROOT, 'favicon.ico'), ico);
  written.push('favicon.ico');

  if (!quiet) {
    for (const rel of written) {
      console.log(`  ${rel}  ${fs.statSync(path.join(ROOT, rel)).size} bytes`);
    }
  }
  return written;
}

if (process.argv[1] && process.argv[1].endsWith('gen-favicon.js')) {
  console.log('Generating favicons from images/davnoot-logo.png');
  build();
}
