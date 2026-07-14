/* POST /api/seoteam/media/import — register images that already live somewhere
 * else, by URL. No upload, no provider, no credentials needed.
 *
 * This is the escape hatch that keeps content entry working when Cloudinary isn't
 * configured (or is down, or the author is using a client's CDN). The library is
 * an INDEX of images the blog uses; it does not have to own the bytes.
 */
import { media } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { readJson, withErrors, methods, ApiError } from '../../../lib/api.js';

async function importUrls(req, res) {
  if (!(await requireSession(req, res))) return;

  const body = await readJson(req);
  const urls = Array.isArray(body?.urls)
    ? body.urls
    : String(body?.urls || '')
        .split(/[\n,]/)
        .map((s) => s.trim());

  const valid = [];
  const rejected = [];

  for (const raw of urls.filter(Boolean)) {
    try {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
      valid.push(u.toString());
    } catch {
      rejected.push(raw);
    }
  }

  if (!valid.length) throw new ApiError(400, 'No valid image URLs found.');

  const col = await media();
  const now = new Date();

  const ops = valid.map((url) => ({
    updateOne: {
      filter: { url },
      update: {
        $set: { url, provider: 'external', updatedAt: now },
        $setOnInsert: {
          createdAt: now,
          source: 'import',
          filename: filenameFrom(url),
          alt: '',
          title: '',
          tags: [],
        },
      },
      upsert: true,
    },
  }));

  const result = await col.bulkWrite(ops, { ordered: false });

  return res.status(200).json({
    imported: result.upsertedCount,
    alreadyKnown: valid.length - result.upsertedCount,
    rejected,
  });
}

function filenameFrom(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image');
  } catch {
    return 'image';
  }
}

export default withErrors(methods({ POST: importUrls }));
