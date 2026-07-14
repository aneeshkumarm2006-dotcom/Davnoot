import { api } from '../api.js';
import { esc, relTime, confirmDialog, toast } from '../../dashboard/dom.js';

export class PagesList {
  constructor(root) { this.root = root; }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    await this.load();
  }

  async load() {
    let data;
    try { data = await api.listPages(); }
    catch (err) { this.root.innerHTML = `<div class="empty"><h2>Couldn't load pages</h2><p class="muted">${esc(err.message)}</p></div>`; return; }
    this.render(data.pages);
    this.wire();
  }

  render(pages) {
    const marketing = pages.filter((p) => p.base);
    const composed = pages.filter((p) => !p.base);
    this.root.innerHTML = `
      <header class="page-head">
        <div><h1>Pages</h1><p class="muted">Every URL on the site. The 8 marketing pages are content-editable; new pages get full layout control.</p></div>
        <div class="page-actions"><a class="btn btn-dark" href="/admin/new">New page</a></div>
      </header>

      <h2 style="font-size:14px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin:6px 0 10px;">Marketing pages</h2>
      ${this.table(marketing, false)}

      <h2 style="font-size:14px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin:26px 0 10px;">Custom pages</h2>
      ${composed.length ? this.table(composed, true) : '<p class="muted">No custom pages yet. <a href="/admin/new">Create one</a> from a template.</p>'}
    `;
  }

  table(rows, deletable) {
    return `<div class="table-scroll"><table class="grid-table">
      <thead><tr><th>Title</th><th>URL</th><th>Status</th><th>Edits</th><th>Editable</th><th>Updated</th>${deletable ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows.map((p) => `
        <tr>
          <td><a href="/admin/pages/${encodeURIComponent(p.key)}"><strong>${esc(p.title)}</strong></a></td>
          <td><a class="url" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></td>
          <td><span class="pill pill-${statusClass(p.status)}">${esc(p.status)}</span></td>
          <td>${p.hasUnpublishedChanges ? '<span class="dot-unpub" title="Unpublished changes">● draft</span>' : '<span class="muted small">live</span>'}</td>
          <td>${p.editableSlots != null ? `<span class="cell-count">${p.editableSlots} fields</span>` : '<span class="pill pill-muted">layout</span>'}</td>
          <td class="muted small">${p.updatedAt ? esc(relTime(p.updatedAt)) : '—'}</td>
          ${deletable ? `<td><button class="btn btn-ghost btn-sm" data-del="${esc(p.key)}">Delete</button></td>` : ''}
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  wire() {
    this.root.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.del;
        if (!(await confirmDialog(`Delete the page "${key}"? This can't be undone.`, { confirmLabel: 'Delete', danger: true }))) return;
        try { await api.deletePage(key); toast('Page deleted.'); this.load(); }
        catch (err) { toast(err.message, 'err'); }
      });
    });
  }
}

function statusClass(s) {
  return s === 'live' || s === 'published' ? 'live' : s === 'archived' ? 'archived' : 'draft';
}
