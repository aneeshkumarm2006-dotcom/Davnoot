/* POST /api/blog/<id>/view — fire-and-forget view counter.
 *
 * `views` is SERVER-MANAGED (Invariant 7): it is absent from every input
 * validator, and the only thing that can ever move it is this $inc. A crafted
 * form payload cannot set it to an arbitrary number.
 *
 * Best-effort by design: it is called from a beacon on the public page, and a
 * failure here must never surface to the reader. We always return 204.
 */
import { ObjectId } from 'mongodb';
import { posts } from '../../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    const id = String(req.query?.id || '');
    if (ObjectId.isValid(id)) {
      const col = await posts();
      // Only count views on posts that are actually live.
      await col.updateOne(
        { _id: new ObjectId(id), status: 'published' },
        { $inc: { views: 1 } },
      );
    }
  } catch (err) {
    // Swallow. A counter is not worth a visible error.
    console.error('[blog/view] failed:', err);
  }

  return res.status(204).end();
}
