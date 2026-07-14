/* The image upload interface.
 *
 * ===========================================================================
 * ONE FUNCTION. SWAPPING PROVIDER IS A ONE-FILE CHANGE.
 * ===========================================================================
 * Everything upstream — the gallery, the cover-image field, the editor's insert
 * button — only ever calls uploadImage(). Nothing else in the codebase knows the
 * word "Cloudinary". Moving to S3/R2 means rewriting this file and nothing else.
 *
 * There is always a way to get an image into a post WITHOUT a cloud provider:
 *   - paste a URL (works with no credentials at all)
 *   - the local-disk fallback in dev
 * Content entry must never hard-depend on a third party being configured.
 *
 * ===========================================================================
 * THE 4.5 MB CEILING IS THE PLATFORM'S, NOT OURS
 * ===========================================================================
 * A Vercel serverless function can receive a request body of at most 4.5 MB.
 * The file streams THROUGH our function on its way to Cloudinary, so that cap
 * applies to uploads. We reject at 4 MB with a clear message rather than letting
 * the platform return an opaque 413 that looks like a bug in the dashboard.
 *
 * If you need bigger files, the fix is NOT to raise this number — it is to switch
 * to Cloudinary *signed direct uploads*, where the browser posts straight to
 * Cloudinary and the function only signs the request. That bypasses the function
 * body entirely. It is a bigger change and wasn't needed for blog imagery.
 */
import { v2 as cloudinary } from 'cloudinary';

export const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — see the note above

export const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

export function isConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

function configure() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  return cloudinary;
}

/** Validate before we spend a network round trip on it. */
export function validateUpload({ contentType, bytes }) {
  if (!ALLOWED_TYPES[contentType]) {
    return `That file type isn't supported. Use PNG, JPG, WebP, GIF, AVIF, or SVG.`;
  }
  if (!bytes) return 'The file appears to be empty.';
  if (bytes > MAX_BYTES) {
    return `That image is ${(bytes / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB — please compress it first.`;
  }
  return null;
}

/**
 * Upload an image buffer and return a normalized Media-shaped record.
 * THE one function every caller uses.
 *
 * @param {Buffer} buffer
 * @param {{filename?: string, contentType: string, folder?: string}} meta
 */
export async function uploadImage(buffer, { filename, contentType, folder } = {}) {
  if (!isConfigured()) {
    throw Object.assign(
      new Error(
        'Image uploads are not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET — or paste an image URL instead.',
      ),
      { status: 503 },
    );
  }

  const cl = configure();
  const targetFolder = folder || process.env.CLOUDINARY_FOLDER || 'davnoot/blog';

  const result = await new Promise((resolve, reject) => {
    const stream = cl.uploader.upload_stream(
      {
        folder: targetFolder,
        resource_type: 'image',
        // Keep the author's filename as the public id stem — a human-readable URL
        // is worth more for SEO than a random hash.
        public_id: filename ? baseName(filename) : undefined,
        unique_filename: true,
        overwrite: false,
      },
      (err, res) => (err ? reject(err) : resolve(res)),
    );
    stream.end(buffer);
  });

  return {
    url: result.secure_url,
    pathname: result.public_id,
    provider: 'cloudinary',
    folder: targetFolder,
    filename: filename || result.original_filename,
    contentType,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    format: result.format,
    source: 'upload',
  };
}

/** Delete from the provider. Best-effort: a failure here must not block the DB delete. */
export async function deleteImage(record) {
  if (record?.provider !== 'cloudinary' || !record.pathname || !isConfigured()) return;
  try {
    await configure().uploader.destroy(record.pathname, { resource_type: 'image' });
  } catch (err) {
    console.error('[uploader] provider delete failed (continuing):', err.message);
  }
}

function baseName(filename) {
  return String(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
