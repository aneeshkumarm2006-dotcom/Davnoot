/* POST /api/seoteam/media/sync — discover images that posts already reference but
 * the library has never heard of.
 *
 * Where they come from: pasted URLs, images that predate the library, and anything
 * inserted through the editor's raw-HTML view. Without this, the gallery's "unused"
 * count is a lie and the library slowly drifts out of sync with reality.
 */
import { media } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { withErrors, methods } from '../../../lib/api.js';
import { discoverUnregistered } from '../../../lib/media-usage.js';

async function sync(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await media();
  const known = (await col.find({}, { projection: { url: 1 } }).toArray()).map((d) => d.url);

  const found = await discoverUnregistered(known);
  if (!found.length) return res.status(200).json({ discovered: 0 });

  const now = new Date();
  await col.bulkWrite(
    found.map((url) => ({
      updateOne: {
        filter: { url },
        update: {
          $set: { url, provider: guessProvider(url), updatedAt: now },
          $setOnInsert: {
            createdAt: now,
            source: 'discovered',
            filename: filenameFrom(url),
            alt: '',
            title: '',
            tags: [],
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return res.status(200).json({ discovered: found.length });
}

const guessProvider = (url) => (/res\.cloudinary\.com/i.test(url) ? 'cloudinary' : 'external');

function filenameFrom(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image');
  } catch {
    return 'image';
  }
}

export default withErrors(methods({ POST: sync }));
