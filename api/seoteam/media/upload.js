/* POST /api/seoteam/media/upload — a single image.
 *
 * The browser posts the file as the RAW request body with its own Content-Type
 * and an X-Filename header. No multipart parsing: multipart would mean shipping a
 * parser dependency into the function for a form with exactly one field.
 *
 * Bulk upload is the CLIENT looping this endpoint one file at a time. That keeps
 * each request comfortably under Vercel's 4.5 MB body cap (see lib/uploader.js),
 * gives per-file progress and per-file error messages, and means one bad image in
 * a batch of twenty doesn't fail the other nineteen.
 */
import { media } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { withErrors, methods, ApiError } from '../../../lib/api.js';
import { uploadImage, validateUpload, MAX_BYTES } from '../../../lib/uploader.js';

/* Vercel gives us a Buffer in req.body for non-JSON content types. */
async function readBinary(req) {
  if (Buffer.isBuffer(req.body)) return req.body;

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    // Bail early rather than buffering an oversized upload into memory.
    if (total > MAX_BYTES) throw new ApiError(413, `Image is too large. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function upload(req, res) {
  if (!(await requireSession(req, res))) return;

  const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
  const filename = decodeURIComponent(req.headers['x-filename'] || 'image');

  const buffer = await readBinary(req);

  const problem = validateUpload({ contentType, bytes: buffer.length });
  if (problem) throw new ApiError(400, problem);

  let record;
  try {
    record = await uploadImage(buffer, { filename, contentType });
  } catch (err) {
    if (err.status === 503) throw new ApiError(503, err.message); // not configured
    console.error('[media/upload] provider error:', err);
    throw new ApiError(502, 'The image host rejected the upload.');
  }

  const col = await media();
  const now = new Date();

  // url is the natural key. An upsert makes re-uploading the same asset idempotent
  // instead of a duplicate-key 500.
  await col.updateOne(
    { url: record.url },
    { $set: { ...record, updatedAt: now }, $setOnInsert: { createdAt: now, alt: '', title: '', tags: [] } },
    { upsert: true },
  );

  const doc = await col.findOne({ url: record.url });
  return res.status(201).json({ media: doc });
}

export default withErrors(methods({ POST: upload }));
