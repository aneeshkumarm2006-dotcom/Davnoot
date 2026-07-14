/* GET /api/seoteam/media — the library, with usage computed on read. */
import { media } from '../../../lib/db.js';
import { requireSession } from '../../../lib/auth.js';
import { withErrors, methods } from '../../../lib/api.js';
import { buildUsageMap, normalizeUrl } from '../../../lib/media-usage.js';

async function list(req, res) {
  if (!(await requireSession(req, res))) return;

  const col = await media();
  const { q, folder, tag, usage } = req.query || {};

  const filter = {};
  if (q && String(q).trim()) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ filename: rx }, { alt: rx }, { title: rx }, { url: rx }];
  }
  if (folder) filter.folder = String(folder);
  if (tag) filter.tags = String(tag);

  const [docs, usageMap] = await Promise.all([
    col.find(filter).sort({ createdAt: -1 }).limit(500).toArray(),
    buildUsageMap(),
  ]);

  let items = docs.map((doc) => {
    const usedIn = usageMap.get(normalizeUrl(doc.url)) || [];
    return { ...doc, usedIn, usedCount: usedIn.length };
  });

  // Filtering by usage happens AFTER the usage join, because usage isn't stored —
  // it can't be a Mongo query.
  if (usage === 'used') items = items.filter((i) => i.usedCount > 0);
  if (usage === 'unused') items = items.filter((i) => i.usedCount === 0);

  const folders = [...new Set(docs.map((d) => d.folder).filter(Boolean))].sort();
  const tags = [...new Set(docs.flatMap((d) => d.tags || []))].sort();

  return res.status(200).json({
    media: items,
    folders,
    tags,
    stats: {
      total: docs.length,
      unused: docs.filter((d) => !(usageMap.get(normalizeUrl(d.url)) || []).length).length,
      bytes: docs.reduce((sum, d) => sum + (d.bytes || 0), 0),
    },
  });
}

export default withErrors(methods({ GET: list }));
