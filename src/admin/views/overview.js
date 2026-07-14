import { api } from '../api.js';
import { esc, relTime } from '../../dashboard/dom.js';

export class Overview {
  constructor(root) { this.root = root; }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    let data;
    try {
      data = await api.overview();
    } catch (err) {
      this.root.innerHTML = `<div class="empty"><h2>Couldn't load the overview</h2><p class="muted">${esc(err.message)}</p></div>`;
      return;
    }
    this.render(data);
  }

  render(d) {
    this.root.innerHTML = `
      ${d.previewEnv ? `<div class="preview-banner" role="alert">⚠ PREVIEW deployment — you are editing the <strong>preview</strong> database. Publishing here does <strong>not</strong> change the live site.</div>` : ''}
      <header class="page-head">
        <div><h1>Overview</h1><p class="muted">Signed in as <strong>${esc(d.role)}</strong>.</p></div>
        <div class="page-actions"><a class="btn btn-dark" href="/admin/new">New page</a></div>
      </header>

      <div class="ov-grid">
        ${card(d.pages.total, 'Pages', `${d.pages.marketing} marketing · ${d.pages.composed} custom`)}
        ${card(d.pages.unpublishedDrafts, 'Unpublished drafts', 'pages with pending edits')}
        ${card(d.posts.published, 'Blog posts', `${d.posts.draft} drafts`)}
        ${card(d.leads.unread, 'New leads', d.leads.unread ? 'awaiting a reply' : 'inbox clear', d.leads.unread ? 'warn' : '')}
        ${card(d.media.total, 'Media', 'in the library')}
      </div>

      <h2 style="font-size:15px;margin:0 0 10px;">Recent activity</h2>
      ${d.activity.length ? this.feed(d.activity) : '<p class="muted">No activity yet.</p>'}
    `;
  }

  feed(rows) {
    return `<div class="feed">${rows.map((r) => `
      <div class="feed-row">
        <span class="when">${esc(relTime(r.at))}</span>
        <span><strong>${esc(r.action)}</strong> — ${esc(r.target)} <span class="muted">${esc(r.summary || '')}</span></span>
      </div>`).join('')}</div>`;
  }
}

function card(n, label, sub, kind) {
  return `<div class="ov-card">
    <div class="n"${kind === 'warn' && n ? ' style="color:var(--warn)"' : ''}>${esc(n)}</div>
    <div class="l">${esc(label)}</div>
    <div class="muted small" style="margin-top:6px">${esc(sub)}</div>
  </div>`;
}
