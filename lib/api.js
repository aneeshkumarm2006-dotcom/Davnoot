/* Shared plumbing for the serverless API handlers: body reading, method routing,
 * and one canonical error mapping.
 *
 * Error contract (the editor's form relies on this exact shape):
 *   400  validation   { error, fields: { "seo.metaTitle": "Too long" } }
 *   401  signed out   { error }
 *   403  wrong role   { error }
 *   404  missing      { error }
 *   409  duplicate    { error }
 *   500  anything else{ error: "Something went wrong." }   <- generic ON PURPOSE
 *
 * A 500 logs the real error server-side and returns a generic message. Never leak
 * a stack trace, a Mongo error, or a connection string to the client.
 */

/** Read and JSON-parse the request body. Vercel usually pre-parses; handle both. */
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new ApiError(400, 'Request body is not valid JSON.');
    }
  }
  // Stream fallback (some runtimes don't pre-parse).
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'Request body is not valid JSON.');
  }
}

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

/** 400 with per-field errors the form can render inline. */
export function validationError(fields, message = 'Please fix the highlighted fields.') {
  return new ApiError(400, message, fields);
}

/**
 * Wrap a handler so every throw lands in the same place.
 * Also sets no-store: dashboard API responses must never be cached by the CDN.
 */
export function withErrors(handler) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = { error: err.message };
        if (err.fields) body.fields = err.fields;
        return res.status(err.status).json(body);
      }

      // MongoDB duplicate key -> 409. The unique index on `slug` is the last line
      // of defence behind resolveUniqueSlug(); a concurrent create can still race it.
      if (err && err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0] || 'value';
        return res.status(409).json({
          error: `That ${field} is already taken.`,
          fields: { [field]: 'Already taken.' },
        });
      }

      console.error('[api] unhandled error:', err);
      return res.status(500).json({ error: 'Something went wrong.' });
    }
  };
}

/** Route by HTTP method. Sends 405 + Allow for anything unlisted. */
export function methods(map) {
  return async (req, res) => {
    const handler = map[req.method];
    if (!handler) {
      res.setHeader('Allow', Object.keys(map).join(', '));
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return handler(req, res);
  };
}
