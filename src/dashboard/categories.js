/* Categories manager — /seoteam/categories.
 *
 * The managed taxonomy behind the public /blog filter pills. Writers create and
 * delete categories here; the editor then offers them as checkboxes on each post,
 * and /blog renders one pill per category.
 *
 * Deleting a category also detaches it from every post it was on (the API does the
 * $pull), so there are never ghost labels or dead archive URLs — hence the
 * "used by N posts" count and the extra confirmation when N > 0.
 */
import { api } from './api.js';
import { esc, $, fmtDate, confirmDialog, toast } from './dom.js';

export class Categories {
  constructor(root) {
    this.root = root;
    this.items = [];
    this.editingId = null;
  }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    await this.load();
    this.wire();
  }

  async load() {
    try {
      const { categories } = await api.listCategories();
      this.items = categories || [];
      this.render();
    } catch (err) {
      this.root.innerHTML = `<div class="empty"><h2>Couldn't load categories</h2><p>${esc(err.message)}</p></div>`;
    }
  }

  render() {
    this.root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>Categories</h1>
        <p class="muted">The filter shown on the blog. Create a category, then tick it on any post.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="/seoteam">← Posts</a>
        <a class="btn btn-ghost" href="/blog" target="_blank" rel="noopener">View blog ↗</a>
      </div>
    </header>

    <form class="cat-create" id="cat-create">
      <input class="input" id="cat-name" placeholder="New category name — e.g. Local SEO" maxlength="60" autocomplete="off" />
      <button type="submit" class="btn btn-dark" id="cat-add">Add category</button>
    </form>

    ${this.items.length ? this.table() : this.emptyState()}
    `;
    $('#cat-name', this.root)?.focus();
  }

  emptyState() {
    return `
    <div class="empty">
      <h2>No categories yet.</h2>
      <p>Add your first one above — like “SEO”, “Paid Media”, or “AI Search”.</p>
    </div>`;
  }

  table() {
    return `
    <table class="posts-table cat-table">
      <thead>
        <tr><th>Name</th><th>URL</th><th>Posts</th><th>Created</th><th></th></tr>
      </thead>
      <tbody>
        ${this.items.map((c) => this.row(c)).join('')}
      </tbody>
    </table>`;
  }

  row(c) {
    const editing = this.editingId === String(c._id);

    const nameCell = editing
      ? `<input class="input input-sm cat-rename-input" value="${esc(c.name)}" maxlength="60" />`
      : `<strong>${esc(c.name)}</strong>`;

    const actions = editing
      ? `<button class="icon-btn" data-save="${esc(c._id)}">Save</button>
         <button class="icon-btn" data-cancel="1">Cancel</button>`
      : `<button class="icon-btn" data-rename="${esc(c._id)}">Rename</button>
         <button class="icon-btn is-danger" data-delete="${esc(c._id)}" data-count="${c.postCount || 0}" data-name="${esc(c.name)}">Delete</button>`;

    return `
    <tr data-id="${esc(c._id)}">
      <td class="cell-title">${nameCell}</td>
      <td><a class="muted small" href="/blog/category/${esc(c.slug)}" target="_blank" rel="noopener">/blog/category/${esc(c.slug)}</a></td>
      <td>${c.postCount || 0}</td>
      <td class="muted small">${fmtDate(c.createdAt)}</td>
      <td class="cell-actions">${actions}</td>
    </tr>`;
  }

  wire() {
    this.root.addEventListener('submit', async (e) => {
      if (e.target.id !== 'cat-create') return;
      e.preventDefault();
      await this.create();
    });

    this.root.addEventListener('click', async (e) => {
      const rename = e.target.closest('[data-rename]');
      if (rename) {
        this.editingId = rename.dataset.rename;
        this.render();
        $('.cat-rename-input', this.root)?.focus();
        return;
      }

      if (e.target.closest('[data-cancel]')) {
        this.editingId = null;
        this.render();
        return;
      }

      const save = e.target.closest('[data-save]');
      if (save) {
        await this.saveRename(save.dataset.save);
        return;
      }

      const del = e.target.closest('[data-delete]');
      if (del) {
        await this.remove(del.dataset.delete, Number(del.dataset.count) || 0, del.dataset.name);
        return;
      }
    });

    // Enter/Escape while inline-renaming.
    this.root.addEventListener('keydown', (e) => {
      const input = e.target.closest('.cat-rename-input');
      if (!input) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.editingId) this.saveRename(this.editingId);
      } else if (e.key === 'Escape') {
        this.editingId = null;
        this.render();
      }
    });
  }

  async create() {
    const input = $('#cat-name', this.root);
    const name = input.value.trim();
    if (!name) return;

    const btn = $('#cat-add', this.root);
    btn.disabled = true;
    try {
      await api.createCategory({ name });
      toast('Category added.');
      await this.load();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  async saveRename(id) {
    const name = $('.cat-rename-input', this.root)?.value.trim();
    if (!name) return;
    try {
      await api.renameCategory(id, { name });
      this.editingId = null;
      toast('Renamed.');
      await this.load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async remove(id, count, name) {
    const warning =
      count > 0
        ? `Delete “${name}”? It's used by ${count} post${count === 1 ? '' : 's'} — they'll be uncategorized (the posts themselves stay).`
        : `Delete “${name}”?`;
    const ok = await confirmDialog(warning, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;

    try {
      await api.deleteCategory(id);
      toast('Deleted.');
      await this.load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}
