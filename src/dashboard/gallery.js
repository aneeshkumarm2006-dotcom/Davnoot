/* The media library — /seoteam/gallery */
import { api } from './api.js';
import { esc, $, confirmDialog, toast, fmtDate } from './dom.js';

const fmtBytes = (n) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export class Gallery {
  constructor(root) {
    this.root = root;
    this.view = 'grid';
    this.filter = { q: '', folder: '', tag: '', usage: '' };
    this.data = null;
  }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    await this.load();
    this.wire();
  }

  async load() {
    try {
      this.data = await api.listMedia(this.filter);
      this.render();
    } catch (err) {
      this.root.innerHTML = `<div class="empty"><h2>Couldn't load the library</h2><p>${esc(err.message)}</p></div>`;
    }
  }

  render() {
    const { media, stats, folders, tags } = this.data;

    this.root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>Media library</h1>
        <p class="muted">${stats.total} images · ${stats.unused} unused · ${fmtBytes(stats.bytes)}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="/seoteam">← Posts</a>
        <button class="btn btn-ghost" id="m-sync" title="Find images used in posts that aren't in the library yet">Sync from posts</button>
        <button class="btn btn-ghost" id="m-import">Import by URL</button>
        <label class="btn btn-dark">
          Upload
          <input type="file" id="m-file" accept="image/*" multiple hidden />
        </label>
      </div>
    </header>

    <div class="table-controls">
      <input class="input" id="m-q" placeholder="Search…" value="${esc(this.filter.q)}" />
      <select class="input input-sm" id="m-folder">
        <option value="">All folders</option>
        ${folders.map((f) => `<option value="${esc(f)}" ${this.filter.folder === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
      </select>
      <select class="input input-sm" id="m-tag">
        <option value="">All tags</option>
        ${tags.map((t) => `<option value="${esc(t)}" ${this.filter.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      <select class="input input-sm" id="m-usage">
        <option value="">Used or not</option>
        <option value="used" ${this.filter.usage === 'used' ? 'selected' : ''}>In use</option>
        <option value="unused" ${this.filter.usage === 'unused' ? 'selected' : ''}>Unused</option>
      </select>
      <div class="view-toggle">
        <button class="${this.view === 'grid' ? 'active' : ''}" data-view="grid">Grid</button>
        <button class="${this.view === 'table' ? 'active' : ''}" data-view="table">Table</button>
      </div>
    </div>

    <div class="dropzone" id="m-drop">Drop images here to upload</div>

    ${media.length ? (this.view === 'grid' ? this.grid(media) : this.table(media)) : this.empty()}
    `;
  }

  empty() {
    return `<div class="empty"><h2>Nothing here yet.</h2><p>Upload an image, import one by URL, or run “Sync from posts” to pull in images your posts already use.</p></div>`;
  }

  grid(media) {
    return `<div class="media-grid">
      ${media
        .map(
          (m) => `
        <div class="media-card ${m.usedCount ? '' : 'is-unused'}" data-id="${esc(m._id)}">
          <div class="media-thumb"><img src="${esc(m.url)}" alt="${esc(m.alt || '')}" loading="lazy" /></div>
          <div class="media-info">
            <span class="media-name">${esc(m.filename || 'image')}</span>
            <span class="media-sub">${m.width && m.height ? `${m.width}×${m.height}` : ''} ${fmtBytes(m.bytes)}</span>
            <span class="badge ${m.usedCount ? 'is-published' : 'is-draft'}">${m.usedCount ? `Used in ${m.usedCount}` : 'Unused'}</span>
            ${m.alt ? '' : '<span class="badge is-warn">No alt</span>'}
          </div>
        </div>`,
        )
        .join('')}
    </div>`;
  }

  table(media) {
    return `<table class="posts-table">
      <thead><tr><th></th><th>File</th><th>Alt</th><th>Size</th><th>Used in</th><th>Added</th></tr></thead>
      <tbody>
        ${media
          .map(
            (m) => `
          <tr data-id="${esc(m._id)}">
            <td><img class="row-thumb" src="${esc(m.url)}" alt="" loading="lazy" /></td>
            <td class="cell-title"><a href="#" data-open="${esc(m._id)}">${esc(m.filename || 'image')}</a></td>
            <td class="muted small">${m.alt ? esc(m.alt) : '<span class="badge is-warn">No alt</span>'}</td>
            <td class="muted small">${fmtBytes(m.bytes)}</td>
            <td class="muted small">${m.usedCount || 0}</td>
            <td class="muted small">${fmtDate(m.createdAt)}</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
  }

  wire() {
    const root = this.root;
    let timer;

    root.addEventListener('input', (e) => {
      if (e.target.id !== 'm-q') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.filter.q = e.target.value.trim();
        this.load();
      }, 250);
    });

    root.addEventListener('change', async (e) => {
      if (['m-folder', 'm-tag', 'm-usage'].includes(e.target.id)) {
        this.filter[e.target.id.slice(2)] = e.target.value;
        return this.load();
      }
      if (e.target.id === 'm-file') {
        await this.upload([...e.target.files]);
      }
    });

    root.addEventListener('click', async (e) => {
      const view = e.target.closest('[data-view]');
      if (view) {
        this.view = view.dataset.view;
        return this.render();
      }

      if (e.target.id === 'm-sync') return this.sync();
      if (e.target.id === 'm-import') return this.importUrls();

      const card = e.target.closest('.media-card') || e.target.closest('[data-open]');
      if (card) {
        e.preventDefault();
        const id = card.dataset.id || card.dataset.open;
        const item = this.data.media.find((m) => String(m._id) === String(id));
        if (item) this.openDetail(item);
      }
    });

    const drop = $('#m-drop', root);
    if (drop) {
      ['dragenter', 'dragover'].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add('over');
        }),
      );
      ['dragleave', 'drop'].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove('over');
        }),
      );
      drop.addEventListener('drop', (e) => {
        const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (files.length) this.upload(files);
      });
    }
  }

  /** Bulk upload = loop single uploads, so one bad file doesn't sink the batch. */
  async upload(files) {
    if (!files.length) return;
    const drop = $('#m-drop', this.root);

    let done = 0;
    let failed = 0;

    for (const file of files) {
      if (drop) drop.textContent = `Uploading ${done + failed + 1} of ${files.length}…`;
      try {
        await api.uploadMedia(file);
        done++;
      } catch (err) {
        failed++;
        toast(`${file.name}: ${err.message}`, 'error');
      }
    }

    if (done) toast(`Uploaded ${done} image${done > 1 ? 's' : ''}.`);
    await this.load();
  }

  async sync() {
    const btn = $('#m-sync', this.root);
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    try {
      const { discovered } = await api.syncMedia();
      toast(discovered ? `Found ${discovered} new image${discovered > 1 ? 's' : ''}.` : 'Library is already up to date.');
      await this.load();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Sync from posts';
    }
  }

  async importUrls() {
    const raw = window.prompt('Paste image URLs — one per line, or comma separated.');
    if (!raw) return;
    try {
      const { imported, alreadyKnown, rejected } = await api.importMedia(raw.split(/[\n,]/));
      toast(`Imported ${imported}. ${alreadyKnown} already known. ${rejected.length} rejected.`);
      await this.load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  openDetail(item) {
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `
      <div class="modal modal-lg" role="dialog" aria-modal="true">
        <header class="modal-head">
          <h2>${esc(item.filename || 'Image')}</h2>
          <button type="button" class="modal-x" data-act="close" aria-label="Close">×</button>
        </header>

        <div class="detail">
          <div class="detail-preview">
            <img src="${esc(item.url)}" alt="${esc(item.alt || '')}" />
          </div>
          <div class="detail-fields">
            <div class="field">
              <label for="d-alt">Alt text</label>
              <input class="input" id="d-alt" value="${esc(item.alt || '')}" placeholder="Describe the image" />
            </div>
            <div class="field">
              <label for="d-title">Title</label>
              <input class="input" id="d-title" value="${esc(item.title || '')}" />
            </div>
            <div class="field">
              <label for="d-tags">Tags</label>
              <input class="input" id="d-tags" value="${esc((item.tags || []).join(', '))}" placeholder="comma, separated" />
            </div>

            <dl class="detail-meta">
              <dt>Dimensions</dt><dd>${item.width && item.height ? `${item.width} × ${item.height}` : '—'}</dd>
              <dt>Size</dt><dd>${fmtBytes(item.bytes)}</dd>
              <dt>Format</dt><dd>${esc(item.format || item.contentType || '—')}</dd>
              <dt>Source</dt><dd>${esc(item.source || '—')}</dd>
            </dl>

            <div class="detail-usage">
              <strong>Used in ${item.usedCount} post${item.usedCount === 1 ? '' : 's'}</strong>
              ${
                item.usedIn?.length
                  ? `<ul>${item.usedIn.map((p) => `<li><a href="/seoteam/${esc(p._id)}">${esc(p.title || 'Untitled')}</a></li>`).join('')}</ul>`
                  : '<p class="muted small">Not referenced by any post.</p>'
              }
            </div>

            <div class="detail-url">
              <input class="input input-sm" readonly value="${esc(item.url)}" />
              <button type="button" class="btn btn-ghost btn-sm" data-act="copy">Copy URL</button>
            </div>
          </div>
        </div>

        <footer class="modal-foot">
          <button type="button" class="btn btn-danger-ghost btn-sm" data-act="delete">Delete</button>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-act="close">Close</button>
            <button type="button" class="btn btn-dark" data-act="save">Save</button>
          </div>
        </footer>
      </div>`;

    const close = () => el.remove();

    el.addEventListener('click', async (e) => {
      const act = e.target.dataset.act;
      if (e.target === el || act === 'close') return close();

      if (act === 'copy') {
        await navigator.clipboard?.writeText(item.url);
        toast('URL copied.');
        return;
      }

      if (act === 'save') {
        try {
          await api.updateMedia(item._id, {
            alt: $('#d-alt', el).value.trim(),
            title: $('#d-title', el).value.trim(),
            tags: $('#d-tags', el).value,
          });
          toast('Saved.');
          close();
          await this.load();
        } catch (err) {
          toast(err.message, 'error');
        }
        return;
      }

      if (act === 'delete') {
        // The server ALSO guards this with a 409 — the dialog is a courtesy, not
        // the protection. A gallery bug must not be able to break a live post.
        const warning = item.usedCount
          ? `This image is used by ${item.usedCount} post${item.usedCount > 1 ? 's' : ''}. Deleting it will leave a broken image on the live site. Delete anyway?`
          : 'Delete this image? This cannot be undone.';

        if (!(await confirmDialog(warning, { confirmLabel: 'Delete', danger: true }))) return;

        try {
          await api.deleteMedia(item.usedCount ? `${item._id}?force=1` : item._id);
          toast('Deleted.');
          close();
          await this.load();
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });

    document.body.appendChild(el);
  }
}
