/* PATCH / DELETE /api/seoteam/media/[id] */
import { ObjectId } from 'mongodb';
import { media } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { readJson, withErrors, methods, validationError, ApiError } from '../../../lib/api.js';
import { mediaUpdateSchema, fieldErrors } from '../../../lib/validators.js';
import { deleteImage } from '../../../lib/uploader.js';
import { buildUsageMap, normalizeUrl } from '../../../lib/media-usage.js';

function objectId(id) {
  if (!id || !ObjectId.isValid(String(id))) throw new ApiError(404, 'Image not found.');
  return new ObjectId(String(id));
}

async function patch(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await media();
  const id = objectId(req.query.id);

  const parsed = mediaUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError(fieldErrors(parsed.error));

  const $set = { updatedAt: new Date() };
  const $unset = {};
  for (const key of ['alt', 'title', 'tags', 'folder']) {
    if (parsed.data[key] === undefined) $unset[key] = '';
    else $set[key] = parsed.data[key];
  }

  const ops = { $set };
  if (Object.keys($unset).length) ops.$unset = $unset;

  const result = await col.updateOne({ _id: id }, ops);
  if (!result.matchedCount) throw new ApiError(404, 'Image not found.');

  return res.status(200).json({ media: await col.findOne({ _id: id }) });
}

async function remove(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await media();
  const id = objectId(req.query.id);

  const doc = await col.findOne({ _id: id });
  if (!doc) throw new ApiError(404, 'Image not found.');

  // Guard: deleting an image that is live on a post leaves a broken <img> on the
  // public site. Force an explicit ?force=1 rather than making it a silent footgun.
  const usage = (await buildUsageMap()).get(normalizeUrl(doc.url)) || [];
  if (usage.length && req.query.force !== '1') {
    throw new ApiError(
      409,
      `This image is used by ${usage.length} post${usage.length > 1 ? 's' : ''}: ${usage.map((p) => p.title).join(', ')}. Deleting it will break them.`,
    );
  }

  // Remove from the DB first: if the provider delete fails, we'd rather have an
  // orphaned file at Cloudinary than a library row pointing at a dead URL.
  await col.deleteOne({ _id: id });
  await deleteImage(doc);

  return res.status(200).json({ ok: true });
}

export default withErrors(methods({ PATCH: patch, DELETE: remove }));
