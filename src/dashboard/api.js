/* Dashboard API client. */

class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

export { ApiError };

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  // The session expired mid-session (the cookie is 7 days, so this is rare but
  // real). Bounce to login rather than letting the caller render a broken page —
  // and remember where we were so the author lands back on their post.
  if (res.status === 401) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/seoteam/login?next=${next}`;
    throw new ApiError(401, 'Signed out.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 204s and empty bodies */
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.fields);
  }

  return data;
}

export const api = {
  listPosts: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    return request('GET', `/api/seoteam/posts?${qs}`);
  },
  getPost: (id) => request('GET', `/api/seoteam/posts/${id}`),
  createPost: (body) => request('POST', '/api/seoteam/posts', body),
  updatePost: (id, body) => request('PUT', `/api/seoteam/posts/${id}`, body),
  patchPost: (id, body) => request('PATCH', `/api/seoteam/posts/${id}`, body),
  deletePost: (id) => request('DELETE', `/api/seoteam/posts/${id}`),

  listMedia: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    return request('GET', `/api/seoteam/media?${qs}`);
  },
  updateMedia: (id, body) => request('PATCH', `/api/seoteam/media/${id}`, body),
  deleteMedia: (id) => request('DELETE', `/api/seoteam/media/${id}`),
  importMedia: (urls) => request('POST', '/api/seoteam/media/import', { urls }),
  syncMedia: () => request('POST', '/api/seoteam/media/sync', {}),

  /**
   * Upload one image.
   *
   * The file goes as the RAW request body with its own Content-Type — not
   * multipart — so the server doesn't need a multipart parser for what is a
   * one-field form. Bulk upload is the caller looping this: per-file progress,
   * per-file errors, and one bad file in a batch doesn't sink the rest.
   */
  uploadMedia: async (file) => {
    const res = await fetch('/api/seoteam/media/upload', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'image'),
      },
      body: file,
      credentials: 'same-origin',
    });

    if (res.status === 401) {
      location.href = '/seoteam/login';
      throw new ApiError(401, 'Signed out.');
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.error || 'Upload failed.');
    return data;
  },

  logout: () => request('POST', '/api/seoteam/logout', {}),
};
