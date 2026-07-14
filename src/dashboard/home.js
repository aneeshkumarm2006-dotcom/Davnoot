/* Dashboard home — stat cards + the posts table. */
import { api } from './api.js';
import { esc, $, relTime, fmtDate, confirmDialog, toast } from './dom.js';

export class Home {
  constructor(root) {
    this.root = root;
    this.filter = { status: '', q: '' };
  }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    await this.load();
    this.wire();
  }

  async load() {
    try {
      const data = await api.listPosts(this.filter);
      this.render(data);
    } catch (err) {
      this.root.innerHTML = `<div class="empty"><h2>Couldn't load posts</h2><p>${esc(err.message)}</p></div>`;
    }
  }

  render({ posts, stats }) {
    this.root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>Posts</h1>
        <p class="muted">Write, optimize, schedule, publish.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="/seoteam/gallery">Media library</a>
        <a class="btn btn-dark" href="/seoteam/new">New post</a>
      </div>
    </header>

    <div class="stats">
      ${statCard('Published', stats.published, 'live on the site')}
      ${statCard('Scheduled', stats.scheduled, 'waiting for their date')}
      ${statCard('Drafts', stats.drafts, 'not public')}
      ${statCard('Total views', stats.views, 'all time')}
    </div>

    <div class="table-controls">
      <input class="input" id="q" placeholder="Search posts…" value="${esc(this.filter.q)}" />
      <select class="input input-sm" id="status">
        <option value="">All statuses</option>
        <option value="published" ${this.filter.status === 'published' ? 'selected' : ''}>Published</option>
        <option value="draft" ${this.filter.status === 'draft' ? 'selected' : ''}>Drafts</option>
      </select>
    </div>

    ${posts.length ? this.table(posts) : this.emptyState()}
    `;
  }

  emptyState() {
    return `
    <div class="empty">
      <h2>No posts yet.</h2>
      <p>Pick a template, write, and hit publish. It'll be live within a minute.</p>
      <a class="btn btn-dark" href="/seoteam/new">Write the first one</a>
    </div>`;
  }

  table(posts) {
    return `
    <table class="posts-table">
      <thead>
        <tr>
          <th>Title</th><th>Status</th><th>SEO</th><th>Views</th><th>Updated</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${posts.map((p) => this.row(p)).join('')}
      </tbody>
    </table>`;
  }

  row(p) {
    // "Scheduled" is derived server-side (published + a future date), so the badge
    // here and the Scheduled stat card can never disagree.
    const badge = p.scheduled
      ? `<span class="badge is-scheduled">Scheduled</span>`
      : p.status === 'published'
        ? `<span class="badge is-published">Published</span>`
        : `<span class="badge is-draft">Draft</span>`;

    const when = p.scheduled ? `<span class="muted small">${fmtDate(p.publishedAt)}</span>` : '';

    // Computed on the server with the SAME scorer the editor runs live.
    const seo = p.seoReady
      ? '<span class="badge is-ready">SEO ready</span>'
      : `<span class="badge is-warn">${p.seoWarnings} to fix</span>`;

    return `
    <tr data-id="${esc(p._id)}">
      <td class="cell-title">
        <a href="/seoteam/${esc(p._id)}">${esc(p.title || 'Untitled')}</a>
        <span class="muted small">/blog/${esc(p.slug)}</span>
      </td>
      <td>${badge} ${when}</td>
      <td>${seo}</td>
      <td>${p.views || 0}</td>
      <td class="muted small">${relTime(p.updatedAt)}</td>
      <td class="cell-actions">
        <a class="icon-btn" href="/seoteam/${esc(p._id)}" title="Edit">Edit</a>
        <a class="icon-btn" href="/seoteam/preview/${esc(p._id)}" target="_blank" rel="noopener" title="Preview">Preview</a>
        <button class="icon-btn" data-toggle="${esc(p._id)}" data-status="${esc(p.status)}">
          ${p.status === 'published' ? 'Unpublish' : 'Publish'}
        </button>
        <button class="icon-btn is-danger" data-delete="${esc(p._id)}">Delete</button>
      </td>
    </tr>`;
  }

  wire() {
    let timer;
    this.root.addEventListener('input', (e) => {
      if (e.target.id !== 'q') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.filter.q = e.target.value.trim();
        this.load();
      }, 300);
    });

    this.root.addEventListener('change', (e) => {
      if (e.target.id !== 'status') return;
      this.filter.status = e.target.value;
      this.load();
    });

    this.root.addEventListener('click', async (e) => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const next = toggle.dataset.status === 'published' ? 'draft' : 'published';
        toggle.disabled = true;
        try {
          // PATCH, not PUT. A quick toggle must not send a full document — the
          // table doesn't have one, and a full replace from here would clear every
          // field the table doesn't render.
          await api.patchPost(toggle.dataset.toggle, { status: next });
          toast(next === 'published' ? 'Published — live within a minute.' : 'Moved back to draft.');
          await this.load();
        } catch (err) {
          toast(err.message, 'error');
          toggle.disabled = false;
        }
        return;
      }

      const del = e.target.closest('[data-delete]');
      if (del) {
        const ok = await confirmDialog('Delete this post? This cannot be undone.', {
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        await api.deletePost(del.dataset.delete);
        toast('Deleted.');
        await this.load();
      }
    });
  }
}

function statCard(label, value, sub) {
  return `
  <div class="stat">
    <span class="stat-label">${esc(label)}</span>
    <span class="stat-value">${Number(value || 0).toLocaleString()}</span>
    <span class="stat-sub">${esc(sub)}</span>
  </div>`;
}
