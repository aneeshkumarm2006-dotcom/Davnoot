/* Admin API client. Mirrors src/dashboard/api.js: same 401 -> login bounce, same
 * ApiError shape the forms render inline. */

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

async function request(method, url, body, headers) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  if (res.status === 401) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/seoteam/login?next=${next}`;
    throw new ApiError(401, 'Signed out.');
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.fields);
  return data;
}

export const api = {
  overview: () => request('GET', '/api/admin/overview'),

  listPages: () => request('GET', '/api/admin/pages'),
  createPage: (body) => request('POST', '/api/admin/pages', body),
  getPage: (key) => request('GET', `/api/admin/pages/${encodeURIComponent(key)}`),
  savePageDraft: (key, body, version) =>
    request('PUT', `/api/admin/pages/${encodeURIComponent(key)}`, body, version != null ? { 'If-Match': String(version) } : null),
  publishPage: (key, body) => request('POST', `/api/admin/pages/${encodeURIComponent(key)}/publish`, body || {}),
  deletePage: (key) => request('DELETE', `/api/admin/pages/${encodeURIComponent(key)}`),
  pageRevisions: (key) => request('GET', `/api/admin/pages/${encodeURIComponent(key)}/revisions`),
  restoreRevision: (key, version) => request('POST', `/api/admin/pages/${encodeURIComponent(key)}/revisions`, { version }),

  seoTable: () => request('GET', '/api/admin/seo'),
  patchSeo: (body) => request('PATCH', '/api/admin/seo', body),

  listLeads: () => request('GET', '/api/admin/leads'),
  patchLead: (body) => request('PATCH', '/api/admin/leads', body),

  listRedirects: () => request('GET', '/api/admin/redirects'),
  createRedirect: (body) => request('POST', '/api/admin/redirects', body),
  deleteRedirect: (source) => request('DELETE', `/api/admin/redirects?source=${encodeURIComponent(source)}`),

  getSettings: () => request('GET', '/api/admin/settings'),
  saveSettings: (body) => request('PUT', '/api/admin/settings', body),

  audit: () => request('GET', '/api/admin/audit'),

  logout: () => request('POST', '/api/seoteam/logout', {}),
};
